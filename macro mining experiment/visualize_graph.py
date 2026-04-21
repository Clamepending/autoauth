#!/usr/bin/env python3
"""
Visualize the state graph from graphminer.py using graphviz.

Usage:
    python visualize_graph.py --traces sample_traces.json
    python visualize_graph.py --traces sample_traces.json --output graph.png
    python visualize_graph.py --traces sample_traces.json --format svg
"""

import argparse
import sys
from pathlib import Path

try:
    from graphviz import Digraph
except ImportError:
    print("Install graphviz: pip install graphviz")
    print("Also need the system package: brew install graphviz")
    sys.exit(1)

from graphminer import (
    load_traces,
    build_state_graph,
    structural_merge,
    extract_meta_tools,
    StateGraph,
)


def short_label(label: str, max_len: int = 40) -> str:
    if len(label) <= max_len:
        return label
    return label[:max_len - 3] + "..."


def render_graph(
    graph: StateGraph,
    title: str,
    output_path: str,
    fmt: str = "png",
    meta_chains: list[list[str]] | None = None,
) -> str:
    chain_node_ids: set[str] = set()
    if meta_chains:
        for chain in meta_chains:
            chain_node_ids.update(chain)

    dot = Digraph(comment=title, format=fmt)
    dot.attr(rankdir="TB", label=title, fontsize="16", labelloc="t")
    dot.attr("node", fontname="Helvetica", fontsize="10", style="filled")
    dot.attr("edge", fontname="Helvetica", fontsize="9")

    for nid, node in graph.nodes.items():
        label = short_label(node.label)
        trace_count = len(node.trace_ids)

        if nid == "root":
            dot.node(nid, label="START", shape="circle",
                     fillcolor="#2d3436", fontcolor="white", width="0.6")
        elif nid in chain_node_ids:
            dot.node(nid, label=f"{label}\n({trace_count} traces)",
                     shape="box", fillcolor="#fdcb6e", fontcolor="#2d3436",
                     penwidth="2")
        elif "navigate" in node.label:
            dot.node(nid, label=f"{label}\n({trace_count} traces)",
                     shape="box", fillcolor="#74b9ff", fontcolor="#2d3436")
        elif "left_click" in node.label or "right_click" in node.label:
            dot.node(nid, label=f"{label}\n({trace_count} traces)",
                     shape="box", fillcolor="#a29bfe", fontcolor="white")
        elif "type" in node.label:
            dot.node(nid, label=f"{label}\n({trace_count} traces)",
                     shape="box", fillcolor="#55efc4", fontcolor="#2d3436")
        elif "key(" in node.label:
            dot.node(nid, label=f"{label}\n({trace_count} traces)",
                     shape="box", fillcolor="#ffeaa7", fontcolor="#2d3436")
        else:
            dot.node(nid, label=f"{label}\n({trace_count} traces)",
                     shape="box", fillcolor="#dfe6e9", fontcolor="#2d3436")

    for source, targets in graph.edges.items():
        for target, edge in targets.items():
            weight = edge.weight
            is_chain_edge = (source in chain_node_ids and target in chain_node_ids)

            if is_chain_edge:
                dot.edge(source, target, label=str(weight),
                         penwidth=str(max(1, weight * 1.5)),
                         color="#e17055", fontcolor="#e17055")
            elif weight >= 4:
                dot.edge(source, target, label=str(weight),
                         penwidth=str(max(1, weight * 1.5)),
                         color="#2d3436")
            elif weight >= 2:
                dot.edge(source, target, label=str(weight),
                         penwidth=str(max(1, weight)),
                         color="#636e72")
            else:
                dot.edge(source, target, label=str(weight),
                         penwidth="1", color="#b2bec3", style="dashed")

    out = dot.render(output_path, cleanup=True)
    return out


def main():
    parser = argparse.ArgumentParser(description="Visualize the graphminer state graph")
    parser.add_argument("--traces", required=True, help="Path to traces JSON")
    parser.add_argument("--output", default="graph", help="Output filename (no extension)")
    parser.add_argument("--format", default="png", choices=["png", "svg", "pdf"],
                        help="Output format (default: png)")
    parser.add_argument("--threshold", type=int, default=3,
                        help="Extraction threshold (default: 3)")
    parser.add_argument("--no-merge", action="store_true",
                        help="Show graph before merging")
    args = parser.parse_args()

    print("Loading traces...")
    traces = load_traces(args.traces)
    print(f"  {len(traces)} traces loaded")

    print("Building state graph...")
    graph = build_state_graph(traces, verbose=True)

    out = render_graph(graph, "1. Raw State Graph (before merge)", f"{args.output}_1_raw", args.format)
    print(f"  Saved: {out}")

    if not args.no_merge:
        print("Structural merging...")
        merged = structural_merge(graph, verbose=True)

        out = render_graph(merged, "2. After Structural Merge", f"{args.output}_2_merged", args.format)
        print(f"  Saved: {out}")

        print("Extracting meta-tool candidates...")
        candidates = extract_meta_tools(merged, args.threshold, verbose=True)

        if candidates:
            chain_ids = [c.chain_node_ids for c in candidates]
            out = render_graph(
                merged,
                f"3. Extracted Chains (threshold={args.threshold})",
                f"{args.output}_3_chains",
                args.format,
                meta_chains=chain_ids,
            )
            print(f"  Saved: {out}")

            print(f"\nFound {len(candidates)} candidate(s):")
            for i, c in enumerate(candidates):
                print(f"  {i+1}. weight={c.weight}, steps={len(c.chain_labels)}")
                for label in c.chain_labels:
                    print(f"       → {label}")
        else:
            print("  No candidates found")

    print("\nDone!")


if __name__ == "__main__":
    main()
