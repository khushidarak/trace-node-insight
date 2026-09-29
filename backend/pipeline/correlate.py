"""Entity/transaction graph construction and IP↔wallet correlation.

The multi-layer graph uses one node type per layer:

    ("ip", "1.2.3.4")        — network observers/relays
    ("wallet", "bc1q…")      — blockchain entities
    ("tx", "<64-hex txid>")  — transactions

Edges carry a ``kind`` attribute: sent, relayed, spent, received, observed
(wallet seen on the same IP/port inside the dataset's correlation window).
"""

from __future__ import annotations

import networkx as nx


def correlate_ip_wallets(df) -> dict[str, set[str]]:
    """Map src_ip → {wallets whose activity was observed from that IP}."""
    mapping: dict[str, set[str]] = {}
    for _, row in df.iterrows():
        wallets = set(row["input_addresses"]) | set(row["output_addresses"])
        mapping.setdefault(row["src_ip"], set()).update(wallets)
    return mapping


def build_graph(df) -> nx.DiGraph:
    """Build the typed multi-layer graph from a canonical dataframe."""
    g = nx.DiGraph()
    for _, row in df.iterrows():
        tx = row["txid"]
        g.add_node(("tx", tx), timestamp=row["timestamp"])
        g.add_edge(("ip", row["src_ip"]), ("tx", tx), kind="sent")
        g.add_edge(("tx", tx), ("ip", row["dst_ip"]), kind="relayed")
        for w in row["input_addresses"]:
            g.add_edge(("wallet", w), ("tx", tx), kind="spent")
        for w in row["output_addresses"]:
            g.add_edge(("tx", tx), ("wallet", w), kind="received")
        # correlate.py: first input wallet observed on the source IP/port window
        if row["input_addresses"]:
            g.add_edge(("ip", row["src_ip"]), ("wallet", row["input_addresses"][0]), kind="observed")
    return g


def neighbours(g: nx.DiGraph, node) -> list:
    return list(g.predecessors(node)) + list(g.successors(node))


def node_evidence(g: nx.DiGraph, node, kind_filter: tuple[str, ...] = ("tx",), cap: int = 10) -> list[str]:
    """Linked entity ids of a given layer for a node (evidence lists)."""
    out: list[str] = []
    for nb in neighbours(g, node):
        if nb[0] in kind_filter and nb[1] not in out:
            out.append(nb[1])
        if len(out) >= cap:
            break
    return out
