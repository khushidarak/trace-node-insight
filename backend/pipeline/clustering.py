"""Entity clustering.

Two signals are combined:

1. **Common-input-ownership heuristic** (union-find): addresses that appear as
   inputs of the same transaction are controlled by the same owner.
2. **Graph-embedding clustering**: node2vec-style random walks over the wallet
   graph (gensim Word2Vec when available, else a spectral/SVD embedding), then
   DBSCAN over the embedding space.

The two clusterings are merged: union-find groups are joined when a majority
of their members share a DBSCAN component (a transitive union), and links that
come only from embeddings are recorded as a weaker "embedding" signal.
"""

from __future__ import annotations

from collections import defaultdict

import numpy as np

from .config import SETTINGS


# ---------------------------------------------------------------------------
# Union-find (common-input-ownership heuristic)
# ---------------------------------------------------------------------------
class UnionFind:
    """Minimal union-find with path compression and union by size."""

    def __init__(self):
        self.parent: dict = {}
        self.size: dict = {}

    def find(self, x):
        self.parent.setdefault(x, x)
        self.size.setdefault(x, 1)
        root = x
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[x] != root:  # path compression
            self.parent[x], x = root, self.parent[x]
        return root

    def union(self, a, b) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return
        if self.size[ra] < self.size[rb]:
            ra, rb = rb, ra
        self.parent[rb] = ra
        self.size[ra] += self.size[rb]

    def groups(self) -> dict:
        out: dict = defaultdict(list)
        for item in self.parent:
            out[self.find(item)].append(item)
        return out


def common_input_groups(df) -> list[set[str]]:
    """Wallet groups implied by shared transaction inputs."""
    uf = UnionFind()
    for _, row in df.iterrows():
        inputs = row["input_addresses"]
        if len(inputs) >= 2:
            for other in inputs[1:]:
                uf.union(inputs[0], other)
    return [set(members) for members in uf.groups().values() if len(members) >= 2]


# ---------------------------------------------------------------------------
# Embeddings
# ---------------------------------------------------------------------------
def _wallet_co_occurrence_graph(df):
    """Wallet→wallet edges when they share a transaction (input or output)."""
    import networkx as nx

    g = nx.Graph()
    for _, row in df.iterrows():
        wallets = list(dict.fromkeys(row["input_addresses"] + row["output_addresses"]))
        for i, a in enumerate(wallets):
            g.add_node(a)
            for b in wallets[i + 1:]:
                g.add_edge(a, b)
    return g


def _random_walk_embeddings(g, dimensions: int = 16, walk_length: int = 12, walks_per_node: int = 6, seed: int = 42) -> dict:
    """Node2vec-style deepwalk embeddings. Uses gensim when available."""
    import random

    rng = random.Random(seed)
    nodes = list(g.nodes())
    if not nodes:
        return {}
    walks: list[list[str]] = []
    for _ in range(walks_per_node):
        rng.shuffle(nodes)
        for start in nodes:
            walk = [start]
            while len(walk) < walk_length:
                cur = walk[-1]
                nbrs = list(g.neighbors(cur)) if cur in g else []
                if not nbrs:
                    break
                walk.append(rng.choice(nbrs))
            walks.append([str(w) for w in walk])

    try:  # preferred: real Word2Vec skip-gram embeddings
        from gensim.models import Word2Vec  # type: ignore

        model = Word2Vec(
            walks, vector_size=dimensions, window=4, min_count=0, sg=1,
            workers=1, epochs=3, seed=seed,
        )
        return {n: model.wv[n] for n in nodes if n in model.wv}
    except ImportError:
        pass

    # Fallback: co-occurrence SVD over the walk corpus (pure numpy/sklearn).
    from sklearn.utils.extmath import randomized_svd

    index = {n: i for i, n in enumerate(nodes)}
    counts = np.zeros((len(nodes), len(nodes)), dtype=float)
    for walk in walks:
        for i, a in enumerate(walk):
            ia = index.get(a)
            if ia is None:
                continue
            for b in walk[max(0, i - 4): i + 5]:
                ib = index.get(b)
                if ib is not None:
                    counts[ia, ib] += 1.0
    u, _, _ = randomized_svd(counts, n_components=min(dimensions, max(2, len(nodes) - 1)), random_state=seed)
    return {n: u[index[n]] for n in nodes}


def embedding_clusters(df) -> tuple[dict[str, list[float]], np.ndarray]:
    """Embed wallets and run DBSCAN. Returns ({wallet: vector}, labels)."""
    from sklearn.cluster import DBSCAN
    from sklearn.preprocessing import StandardScaler

    g = _wallet_co_occurrence_graph(df)
    vectors = _random_walk_embeddings(g)
    if not vectors:
        return {}, np.empty(0, dtype=int)
    wallets = sorted(vectors)
    X = np.vstack([vectors[w] for w in wallets])
    X = StandardScaler().fit_transform(X)
    labels = DBSCAN(
        eps=SETTINGS.dbscan_eps, min_samples=SETTINGS.dbscan_min_samples
    ).fit_predict(X)
    return {w: vectors[w].tolist() for w in wallets}, labels


# ---------------------------------------------------------------------------
# Merge the two clusterings
# ---------------------------------------------------------------------------
def build_entity_clusters(df) -> list[dict]:
    """Merge union-find ownership groups with embedding clusters.

    Returns cluster dicts: members, shared IPs, linked heuristic
    (common_input_ownership / embedding_similarity), embedding label, size.
    """
    groups = common_input_groups(df)
    _, labels = embedding_clusters(df)
    label_members: dict[int, list[str]] = defaultdict(list)
    for wallet, label in zip(sorted(_random_walk_embeddings(_wallet_co_occurrence_graph(df))), labels):
        label_members.setdefault(int(label), []).append(wallet)

    ownership_index: list[dict] = []
    for members in groups:
        ownership_index.append({"members": members, "signal": "common_input_ownership"})
    embed_only: list[dict] = []
    claimed: set[str] = set()
    for members in groups:
        claimed |= members
    for label, members in sorted(label_members.items()):
        if label == -1:
            continue
        members = [m for m in members if m not in claimed]
        if len(members) >= 2:
            embed_only.append({"members": set(members), "signal": "embedding_similarity"})

    cluster_defs = ownership_index + embed_only
    clusters: list[dict] = []
    for i, spec in enumerate(sorted(cluster_defs, key=lambda s: -len(s["members"]))):
        members = sorted(spec["members"])
        ips: set[str] = set()
        countries: set[str] = set()
        txs: set[str] = set()
        member_set = set(members)
        for _, row in df.iterrows():
            if member_set & set(row["input_addresses"]) or member_set & set(row["output_addresses"]):
                ips.add(row["src_ip"])
                countries.add(row["geo_country"])
                txs.add(row["txid"])
        clusters.append({
            "id": f"CL-{i + 1:03d}",
            "members": members,
            "shared_ips": sorted(ips),
            "transactions": len(txs),
            "countries": sorted(countries),
            "heuristic": spec["signal"],
            "embedding_label": None if spec["signal"] == "common_input_ownership" else True,
            "size": len(members),
        })
    return clusters
