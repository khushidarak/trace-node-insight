"""Risk propagation from seed illicit wallets across the transaction graph.

Two estimators are combined:

1. **Personalised PageRank**: teleport mass is placed on the highest-scoring
   seed wallets and PageRank diffuses it across the (reversed) spending graph,
   so entities downstream of illicit seeds accumulate risk.
2. **Decay BFS**: a bounded-depth breadth-first pass where each hop multiplies
   the carried risk by ``decay`` — an interpretable hop-count baseline.

The per-wallet risk blends the two (70% PPR, 30% decay BFS), and cluster risk
is the max member risk.
"""

from __future__ import annotations

from collections import deque

import networkx as nx
import numpy as np


def pick_seed_wallets(wallet_scores: dict[str, float], top: int = 12) -> list[str]:
    """Highest-anomaly wallets become the illicit seeds."""
    return [w for w, _ in sorted(wallet_scores.items(), key=lambda kv: -kv[1])[:top]]


def personalised_pagerank(
    g: nx.DiGraph, seeds: list[str], decay: float = 0.7, max_iter: int = 80
) -> dict[str, float]:
    """Personalised PageRank from seed wallets, normalised to 0–1."""
    if g.number_of_nodes() == 0 or not seeds:
        return {}
    personalisation = {n: 0.0 for n in g.nodes()}
    for s in seeds:
        node = ("wallet", s)
        if node in personalisation:
            personalisation[node] = 1.0 / len(seeds)
    if sum(personalisation.values()) == 0:
        return {}
    try:
        ppr = nx.pagerank(
            g, alpha=decay, personalization=personalisation,
            max_iter=max_iter, weight=None, tol=1e-7,
        )
    except nx.PowerIterationFailedConvergence:
        ppr = nx.pagerank(g, alpha=decay, personalization=personalisation, max_iter=30, tol=1e-5)
    # rescale so the top node sits near 1.0
    top = max(ppr.values()) if ppr else 1.0
    if top <= 0:
        return {}
    return {n: float(v / top) for n, v in ppr.items()}


def decay_bfs(
    g: nx.DiGraph, seeds: list[str], decay: float = 0.7, max_depth: int = 5
) -> dict[str, float]:
    """Bounded decay-weighted BFS risk from seeds (forward = spending direction)."""
    risk: dict = {}
    queue: deque = deque()
    for s in seeds:
        node = ("wallet", s)
        if node in g:
            risk[node] = 1.0
            queue.append((node, 0))
    while queue:
        (node, depth) = queue.popleft()
        if depth >= max_depth:
            continue
        carried = risk.get(node, 0.0) * decay
        if carried < 0.01:
            continue
        for nb in g.successors(node):
            if risk.get(nb, 0.0) < carried:
                risk[nb] = carried
                queue.append((nb, depth + 1))
    return risk


def propagate(
    g: nx.DiGraph,
    wallet_scores: dict[str, float],
    decay: float | None = None,
    top_seeds: int = 12,
) -> dict[str, dict]:
    """Full propagation pass.

    Returns per-wallet {risk (0-1), pp_r, bfs_r, seed (bool), depth (for seeds 0)}.
    Also covers tx/ip nodes reachable from seeds (returned under the same
    wallet-score keys only; use `node_risk()` for other layers).
    """
    from .config import SETTINGS

    decay = SETTINGS.risk_propagation_decay if decay is None else decay
    seeds = pick_seed_wallets(wallet_scores, top=top_seeds)
    ppr = personalised_pagerank(g, seeds, decay=decay)
    bfs = decay_bfs(g, seeds, decay=decay)

    def norm(d: dict) -> dict:
        top = max(d.values()) if d else 1.0
        return {k: v / top for k, v in d.items()} if top > 0 else d

    ppr, bfs = norm(ppr), norm(bfs)
    depths = bfs_depths(g, seeds, max_depth=6)
    out: dict[str, dict] = {}
    seed_set = set(seeds)
    for wallet in wallet_scores:
        node = ("wallet", wallet)
        p = ppr.get(node, 0.0)
        b = bfs.get(node, 0.0)
        out[wallet] = {
            "risk": float(min(1.0, 0.7 * p + 0.3 * b)),
            "ppr": round(float(p), 4),
            "bfs": round(float(b), 4),
            "seed": wallet in seed_set,
            "hops": _hop_distance(depths, node),
        }
    return out


def _hop_distance(paths: dict, node) -> int | None:
    d = paths.get(node)
    return None if d is None else int(d)


def bfs_depths(g: nx.DiGraph, seeds: list[str], max_depth: int = 6) -> dict:
    """Node → hop distance from the nearest seed (None when unreachable)."""
    depths: dict = {}
    queue: deque = deque()
    for s in seeds:
        node = ("wallet", s)
        if node in g:
            depths[node] = 0
            queue.append(node)
    while queue:
        node = queue.popleft()
        d = depths[node]
        if d >= max_depth:
            continue
        for nb in g.successors(node):
            if nb not in depths:
                depths[nb] = d + 1
                queue.append(nb)
    return depths


def bfs_paths(g: nx.DiGraph, seeds: list[str]) -> dict:
    """Alias kept for API symmetry — returns bfs_depths."""
    return bfs_depths(g, seeds)


def cluster_risk(member_wallets: list[str], wallet_risk: dict[str, dict]) -> float:
    """Cluster risk = max member propagated risk."""
    vals = [wallet_risk[w]["risk"] for w in member_wallets if w in wallet_risk]
    return float(max(vals)) if vals else 0.0
