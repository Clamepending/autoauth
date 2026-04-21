#!/usr/bin/env python3
"""
graphminer.py — AWO-style state-graph macro miner with LLM-in-the-loop.

Reads browser agent traces (JSON), builds a weighted state graph,
performs horizontal merging (structural + LLM-assisted), extracts
meta-tool candidates via the greedy Algorithm 1 from the AWO paper,
then converts them to macros using an LLM.

Usage:
    python graphminer.py --traces traces.json --api-key sk-ant-... [options]

Reference:
    Abuzakuk et al., "Optimizing Agentic Workflows using Meta-tools", 2026.
    arXiv:2601.22037v2
"""

from __future__ import annotations

import argparse
import copy
import json
import re
import sys
import time
from collections import defaultdict
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

# ---------------------------------------------------------------------------
# Data types — mirrors the chrome extension's traceLogger.ts
# ---------------------------------------------------------------------------

@dataclass
class SemanticTarget:
    role: str
    name: str
    tag: str | None = None
    inputType: str | None = None


@dataclass
class TraceEvent:
    tool: str
    action: str | None
    input: dict[str, Any]
    url: str
    success: bool
    domain: str = ""
    timestamp: int = 0
    macroReplay: bool = False
    semanticTarget: SemanticTarget | None = None


@dataclass
class TaskTrace:
    id: str
    domain: str
    goal: str
    events: list[TraceEvent]
    taskSuccess: bool
    startedAt: int = 0
    completedAt: int = 0


# ---------------------------------------------------------------------------
# Graph types
# ---------------------------------------------------------------------------

@dataclass
class StateNode:
    id: str
    label: str
    depth: int
    parent_id: str | None = None
    trace_ids: set[str] = field(default_factory=set)
    event_examples: list[TraceEvent] = field(default_factory=list)


@dataclass
class StateEdge:
    source: str
    target: str
    weight: int = 0
    trace_ids: set[str] = field(default_factory=set)


@dataclass
class StateGraph:
    nodes: dict[str, StateNode] = field(default_factory=dict)
    edges: dict[str, dict[str, StateEdge]] = field(default_factory=lambda: defaultdict(dict))
    root_id: str = "root"

    def add_node(self, node: StateNode) -> None:
        self.nodes[node.id] = node

    def add_edge(self, source: str, target: str, trace_id: str) -> None:
        if target in self.edges[source]:
            edge = self.edges[source][target]
            edge.weight += 1
            edge.trace_ids.add(trace_id)
        else:
            self.edges[source][target] = StateEdge(
                source=source, target=target, weight=1, trace_ids={trace_id}
            )

    def children_of(self, node_id: str) -> list[tuple[str, StateEdge]]:
        return list(self.edges.get(node_id, {}).items())

    def total_outgoing_weight(self, node_id: str) -> int:
        return sum(e.weight for e in self.edges.get(node_id, {}).values())

    def node_count(self) -> int:
        return len(self.nodes)

    def edge_count(self) -> int:
        return sum(len(targets) for targets in self.edges.values())

    def sink_count(self) -> int:
        return sum(1 for nid in self.nodes if nid not in self.edges or not self.edges[nid])


@dataclass
class MetaToolCandidate:
    chain_labels: list[str]
    chain_node_ids: list[str]
    weight: int
    trace_ids: set[str]
    example_events: list[list[TraceEvent]]


@dataclass
class MacroStep:
    tool: str
    action: str | None
    inputTemplate: dict[str, Any]
    semanticTarget: dict[str, str] | None = None


@dataclass
class MacroParameter:
    name: str
    type: str
    description: str


@dataclass
class Macro:
    id: str
    name: str
    domain: str
    description: str
    trigger: str
    parameters: list[MacroParameter]
    steps: list[MacroStep]
    sourceTraceCount: int
    confidence: float
    chainWeight: int
    chainLength: int


# ---------------------------------------------------------------------------
# Section 1: Trace Loading
# ---------------------------------------------------------------------------

OBSERVATION_TOOLS = {"read_page", "get_page_text", "find", "tabs_context"}
OBSERVATION_ACTIONS = {"screenshot"}


def load_traces(path: str) -> list[TaskTrace]:
    raw = json.loads(Path(path).read_text())
    if not isinstance(raw, list):
        raw = [raw]

    traces: list[TaskTrace] = []
    for r in raw:
        events = []
        for ev in r.get("events", []):
            sem = None
            if ev.get("semanticTarget"):
                s = ev["semanticTarget"]
                sem = SemanticTarget(
                    role=s.get("role", ""),
                    name=s.get("name", ""),
                    tag=s.get("tag"),
                    inputType=s.get("inputType"),
                )
            events.append(TraceEvent(
                tool=ev.get("tool", ""),
                action=ev.get("action"),
                input=ev.get("input", {}),
                url=ev.get("url", ""),
                success=ev.get("success", True),
                domain=ev.get("domain", ""),
                timestamp=ev.get("timestamp", 0),
                macroReplay=ev.get("macroReplay", False),
                semanticTarget=sem,
            ))
        traces.append(TaskTrace(
            id=r.get("id", ""),
            domain=r.get("domain", ""),
            goal=r.get("goal", ""),
            events=events,
            taskSuccess=r.get("taskSuccess", False),
            startedAt=r.get("startedAt", 0),
            completedAt=r.get("completedAt", 0),
        ))
    return traces


def is_observation_event(ev: TraceEvent) -> bool:
    if ev.tool in OBSERVATION_TOOLS:
        return True
    if ev.tool == "computer" and ev.action in OBSERVATION_ACTIONS:
        return True
    return False


# ---------------------------------------------------------------------------
# Section 2: Event Normalization
# ---------------------------------------------------------------------------

_NUMERIC_SEGMENT = re.compile(r"/\d+")
_ID_LIKE_SEGMENT = re.compile(r"/(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{6,}")
_UUID_SEGMENT = re.compile(r"/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", re.IGNORECASE)


def normalize_url_path(url: str) -> str:
    if not url:
        return ""
    try:
        parsed = urlparse(url)
        path = parsed.path.rstrip("/") or "/"
        path = _UUID_SEGMENT.sub("/{}", path)
        path = _ID_LIKE_SEGMENT.sub("/{}", path)
        path = _NUMERIC_SEGMENT.sub("/{}", path)
        return path
    except Exception:
        return ""


def normalize_semantic_name(name: str) -> str:
    """Collapse minor textual variations in element names."""
    name = name.strip()
    name = re.sub(r"\s+", " ", name)
    if len(name) > 80:
        name = name[:80]
    return name


def canonicalize_event(ev: TraceEvent) -> str | None:
    """Convert a TraceEvent into a canonical state label, or None to skip."""
    if is_observation_event(ev):
        return None
    if ev.macroReplay:
        return None
    if not ev.success:
        return None

    tool = ev.tool
    action = ev.action
    url_path = normalize_url_path(ev.url)

    if tool == "computer":
        if action == "wait":
            return None

        sem_part = ""
        if ev.semanticTarget and ev.semanticTarget.name:
            role = ev.semanticTarget.role
            name = normalize_semantic_name(ev.semanticTarget.name)
            sem_part = f' [{role} "{name}"]'

        if action == "key":
            key_name = ev.input.get("text", "?")
            return f"key({key_name}){sem_part} @ {url_path}"

        if action in ("type",):
            return f"type{sem_part} @ {url_path}"

        if action in ("scroll",):
            direction = ev.input.get("scroll_direction", "down")
            return f"scroll({direction}) @ {url_path}"

        return f"{action}{sem_part} @ {url_path}"

    if tool == "navigate":
        return f"navigate @ {url_path}"

    if tool == "form_input":
        sem_part = ""
        if ev.semanticTarget and ev.semanticTarget.name:
            role = ev.semanticTarget.role
            name = normalize_semantic_name(ev.semanticTarget.name)
            sem_part = f' [{role} "{name}"]'
        return f"fill{sem_part} @ {url_path}"

    if tool in ("javascript_tool", "file_upload", "upload_image", "resize_window"):
        return f"{tool} @ {url_path}"

    if tool == "tabs_create":
        return "tabs_create"

    return f"{tool} @ {url_path}"


# ---------------------------------------------------------------------------
# Section 3: Build State Graph (prefix trie)
# ---------------------------------------------------------------------------

_node_counter = 0


def _fresh_node_id() -> str:
    global _node_counter
    _node_counter += 1
    return f"n_{_node_counter}"


def build_state_graph(traces: list[TaskTrace], verbose: bool = False) -> StateGraph:
    global _node_counter
    _node_counter = 0

    graph = StateGraph()
    root = StateNode(id="root", label="[START]", depth=0)
    graph.add_node(root)

    for trace in traces:
        canonical_events: list[tuple[str, TraceEvent]] = []
        for ev in trace.events:
            label = canonicalize_event(ev)
            if label is not None:
                canonical_events.append((label, ev))

        current_id = "root"
        for depth_idx, (label, ev) in enumerate(canonical_events):
            existing_child = _find_child_with_label(graph, current_id, label)

            if existing_child is not None:
                graph.add_edge(current_id, existing_child, trace.id)
                node = graph.nodes[existing_child]
                node.trace_ids.add(trace.id)
                if len(node.event_examples) < 5:
                    node.event_examples.append(ev)
                current_id = existing_child
            else:
                new_id = _fresh_node_id()
                new_node = StateNode(
                    id=new_id,
                    label=label,
                    depth=depth_idx + 1,
                    parent_id=current_id,
                    trace_ids={trace.id},
                    event_examples=[ev],
                )
                graph.add_node(new_node)
                graph.add_edge(current_id, new_id, trace.id)
                current_id = new_id

    if verbose:
        print(f"  State graph: {graph.node_count()} nodes, {graph.edge_count()} edges, {graph.sink_count()} sinks")

    return graph


def _find_child_with_label(graph: StateGraph, parent_id: str, label: str) -> str | None:
    for child_id, _ in graph.children_of(parent_id):
        if graph.nodes[child_id].label == label:
            return child_id
    return None


# ---------------------------------------------------------------------------
# Section 4: Horizontal Merging
# ---------------------------------------------------------------------------

def structural_merge(graph: StateGraph, verbose: bool = False) -> StateGraph:
    """
    Pass 1: Merge structurally equivalent nodes without LLM.
    Nodes are equivalent if they have the same tool+action+role and
    their URL paths match after collapsing dynamic segments.
    Also handles read-only commutativity.
    """
    label_groups: dict[str, list[str]] = defaultdict(list)
    for nid, node in graph.nodes.items():
        if nid == "root":
            continue
        coarse_label = _coarsen_label(node.label)
        label_groups[coarse_label].append(nid)

    merge_map: dict[str, str] = {}
    for coarse, nids in label_groups.items():
        if len(nids) <= 1:
            continue

        by_depth: dict[int, list[str]] = defaultdict(list)
        for nid in nids:
            by_depth[graph.nodes[nid].depth].append(nid)

        for depth, group in by_depth.items():
            if len(group) <= 1:
                continue

            by_parent: dict[str, list[str]] = defaultdict(list)
            for nid in group:
                effective_parent = merge_map.get(graph.nodes[nid].parent_id, graph.nodes[nid].parent_id)
                by_parent[effective_parent].append(nid)

            for parent, siblings in by_parent.items():
                if len(siblings) <= 1:
                    continue
                canonical = siblings[0]
                for dup in siblings[1:]:
                    merge_map[dup] = canonical

    if not merge_map:
        if verbose:
            print("  Structural merge: no merges found")
        return graph

    merged = _apply_merge_map(graph, merge_map)
    if verbose:
        print(f"  After structural merge: {merged.node_count()} nodes, {merged.edge_count()} edges "
              f"({graph.node_count() - merged.node_count()} nodes merged)")
    return merged


def _coarsen_label(label: str) -> str:
    """Strip the specific semantic name, keep role + tool + action + url structure."""
    coarse = re.sub(r'"[^"]*"', '""', label)
    return coarse


def _apply_merge_map(graph: StateGraph, merge_map: dict[str, str]) -> StateGraph:
    def resolve(nid: str) -> str:
        visited = set()
        while nid in merge_map:
            if nid in visited:
                break
            visited.add(nid)
            nid = merge_map[nid]
        return nid

    new_graph = StateGraph()

    for nid, node in graph.nodes.items():
        canonical = resolve(nid)
        if canonical not in new_graph.nodes:
            merged_node = StateNode(
                id=canonical,
                label=graph.nodes[canonical].label,
                depth=graph.nodes[canonical].depth,
                parent_id=None,
                trace_ids=set(node.trace_ids),
                event_examples=list(graph.nodes[canonical].event_examples),
            )
            new_graph.add_node(merged_node)
        else:
            new_graph.nodes[canonical].trace_ids |= node.trace_ids

    for source, targets in graph.edges.items():
        resolved_source = resolve(source)
        for target, edge in targets.items():
            resolved_target = resolve(target)
            if resolved_source == resolved_target:
                continue
            for tid in edge.trace_ids:
                new_graph.add_edge(resolved_source, resolved_target, tid)

    for nid, node in new_graph.nodes.items():
        if nid == "root":
            continue
        for possible_parent in new_graph.nodes:
            if nid in new_graph.edges.get(possible_parent, {}):
                node.parent_id = possible_parent
                break

    return new_graph


def llm_merge(graph: StateGraph, api_key: str, model: str, verbose: bool = False) -> StateGraph:
    """
    Pass 2: Use LLM to identify semantically equivalent nodes that
    structural merging missed.
    """
    candidates = _find_merge_candidates(graph)

    if not candidates:
        if verbose:
            print("  LLM merge: no candidates found")
        return graph

    if verbose:
        print(f"  LLM merge: evaluating {len(candidates)} candidate pairs...")

    batches = _batch_candidates(candidates, batch_size=25)
    merge_map: dict[str, str] = {}

    for batch in batches:
        approved = _llm_evaluate_merges(batch, graph, api_key, model, verbose)
        for a, b in approved:
            merge_map[b] = a

    if not merge_map:
        if verbose:
            print("  LLM merge: no merges approved")
        return graph

    merged = _apply_merge_map(graph, merge_map)
    if verbose:
        print(f"  After LLM merge: {merged.node_count()} nodes, {merged.edge_count()} edges "
              f"({graph.node_count() - merged.node_count()} nodes merged)")
    return merged


def _find_merge_candidates(graph: StateGraph) -> list[tuple[str, str]]:
    """Find pairs of nodes that might be semantically equivalent."""
    tool_groups: dict[str, list[str]] = defaultdict(list)
    for nid, node in graph.nodes.items():
        if nid == "root":
            continue
        coarse = _coarsen_label(node.label)
        tool_groups[coarse].append(nid)

    candidates: list[tuple[str, str]] = []
    for coarse, nids in tool_groups.items():
        if len(nids) <= 1:
            continue

        by_depth: dict[int, list[str]] = defaultdict(list)
        for nid in nids:
            by_depth[graph.nodes[nid].depth].append(nid)

        for depth, group in by_depth.items():
            if len(group) <= 1:
                continue

            for i in range(len(group)):
                for j in range(i + 1, len(group)):
                    a_label = graph.nodes[group[i]].label
                    b_label = graph.nodes[group[j]].label
                    if a_label != b_label:
                        candidates.append((group[i], group[j]))

    return candidates


def _batch_candidates(candidates: list[tuple[str, str]], batch_size: int) -> list[list[tuple[str, str]]]:
    return [candidates[i:i + batch_size] for i in range(0, len(candidates), batch_size)]


def _llm_evaluate_merges(
    batch: list[tuple[str, str]],
    graph: StateGraph,
    api_key: str,
    model: str,
    verbose: bool,
) -> list[tuple[str, str]]:
    import anthropic

    pair_descriptions = []
    for idx, (a, b) in enumerate(batch):
        a_node = graph.nodes[a]
        b_node = graph.nodes[b]
        a_ctx = _get_node_context(graph, a)
        b_ctx = _get_node_context(graph, b)
        pair_descriptions.append(
            f"Pair {idx}:\n"
            f"  A: {a_node.label} (depth {a_node.depth}, weight {len(a_node.trace_ids)})\n"
            f"     Context: {a_ctx}\n"
            f"  B: {b_node.label} (depth {b_node.depth}, weight {len(b_node.trace_ids)})\n"
            f"     Context: {b_ctx}"
        )

    prompt = f"""You are analyzing a state graph built from browser agent execution traces.
I need you to decide which pairs of nodes represent semantically equivalent states — meaning
they accomplish the same thing in the workflow even if the exact element names or URLs differ slightly.

Two nodes are equivalent if:
- They perform the same action (same tool + action type)
- They target functionally the same element (e.g., "Search" button vs "Go" button on a search page)
- They appear at the same point in a workflow
- Merging them would NOT change the meaning of the workflow

Two nodes are NOT equivalent if:
- They target genuinely different elements (e.g., "Add to Cart" vs "Buy Now")
- They're on fundamentally different pages
- Merging them would conflate different user intents

Here are the candidate pairs:

{chr(10).join(pair_descriptions)}

Return a JSON array of pair indices that SHOULD be merged.
Example: [0, 3, 7] means pairs 0, 3, and 7 are equivalent and should merge.
If none should merge, return [].
Return ONLY the JSON array."""

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model=model,
        max_tokens=256,
        messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(b.text for b in response.content if b.type == "text").strip()

    bracket_start = text.find("[")
    bracket_end = text.rfind("]")
    if bracket_start == -1 or bracket_end == -1:
        return []

    try:
        indices = json.loads(text[bracket_start:bracket_end + 1])
    except json.JSONDecodeError:
        if verbose:
            print(f"    Failed to parse LLM merge response: {text}")
        return []

    approved = []
    for idx in indices:
        if isinstance(idx, int) and 0 <= idx < len(batch):
            approved.append(batch[idx])

    if verbose:
        print(f"    LLM approved {len(approved)}/{len(batch)} merges")

    return approved


def _get_node_context(graph: StateGraph, node_id: str) -> str:
    """Get parent and children labels for context."""
    node = graph.nodes[node_id]
    parts = []
    if node.parent_id and node.parent_id in graph.nodes:
        parts.append(f"parent={graph.nodes[node.parent_id].label}")

    children = graph.children_of(node_id)
    if children:
        child_labels = [graph.nodes[cid].label for cid, _ in children[:3]]
        parts.append(f"children=[{', '.join(child_labels)}]")

    return " | ".join(parts) if parts else "(leaf)"


# ---------------------------------------------------------------------------
# Section 5: Algorithm 1 — Meta-tool Extraction
# ---------------------------------------------------------------------------

def extract_meta_tools(
    graph: StateGraph,
    threshold: int,
    verbose: bool = False,
) -> list[MetaToolCandidate]:
    """
    Greedy meta-tool extraction from AWO paper (Algorithm 1).
    Iteratively finds the heaviest edge pair, extends it into a chain,
    compresses the graph, and repeats.
    """
    G = _deep_copy_graph(graph)
    meta_tools: list[MetaToolCandidate] = []

    iteration = 0
    while True:
        iteration += 1
        pairs = _extract_state_pairs(G, threshold)
        if not pairs:
            break

        nx, ny, edge_weight = pairs[0]
        chain_ids = [nx, ny]
        chain_labels = [G.nodes[nx].label, G.nodes[ny].label]

        current = ny
        while True:
            best_child = _select_dominant_child(G, current)
            if best_child is None:
                break
            chain_ids.append(best_child)
            chain_labels.append(G.nodes[best_child].label)
            current = best_child

        if len(chain_ids) < 2:
            break

        trace_ids = _get_chain_trace_ids(G, chain_ids)
        chain_weight = len(trace_ids) if trace_ids else edge_weight
        examples = _collect_chain_examples(graph, chain_labels)

        candidate = MetaToolCandidate(
            chain_labels=chain_labels,
            chain_node_ids=chain_ids,
            weight=chain_weight,
            trace_ids=trace_ids,
            example_events=examples,
        )
        meta_tools.append(candidate)

        if verbose:
            print(f"  Extracted chain (iter {iteration}): {' → '.join(chain_labels[:6])}"
                  f"{'...' if len(chain_labels) > 6 else ''} "
                  f"(weight={chain_weight}, length={len(chain_ids)})")

        G = _compress_graph(G, chain_ids, f"meta_{iteration}")

    if verbose:
        print(f"  Total meta-tool candidates: {len(meta_tools)}")

    return meta_tools


def _extract_state_pairs(graph: StateGraph, threshold: int) -> list[tuple[str, str, int]]:
    """
    Find all edges with weight >= threshold.
    Sort by weight descending, then depth ascending as tiebreaker.
    """
    pairs: list[tuple[str, str, int, int]] = []
    for source, targets in graph.edges.items():
        if source == "root":
            continue
        for target, edge in targets.items():
            if edge.weight >= threshold:
                depth = graph.nodes[source].depth
                pairs.append((source, target, edge.weight, depth))

    pairs.sort(key=lambda x: (-x[2], x[3]))
    return [(s, t, w) for s, t, w, _ in pairs]


def _select_dominant_child(graph: StateGraph, node_id: str) -> str | None:
    """
    Select a child if its edge weight > 50% of total outgoing weight.
    """
    children = graph.children_of(node_id)
    if not children:
        return None

    total = sum(edge.weight for _, edge in children)
    if total == 0:
        return None

    for child_id, edge in children:
        if edge.weight > total / 2:
            return child_id

    return None


def _get_chain_trace_ids(graph: StateGraph, chain_ids: list[str]) -> set[str]:
    """Get trace IDs that flow through the entire chain."""
    if len(chain_ids) < 2:
        return set()

    ids = None
    for i in range(len(chain_ids) - 1):
        src = chain_ids[i]
        tgt = chain_ids[i + 1]
        edge = graph.edges.get(src, {}).get(tgt)
        if edge is None:
            return set()
        if ids is None:
            ids = set(edge.trace_ids)
        else:
            ids &= edge.trace_ids

    return ids or set()


def _collect_chain_examples(
    original_graph: StateGraph,
    chain_labels: list[str],
) -> list[list[TraceEvent]]:
    """
    Find up to 3 actual event sequences from the original graph
    that match this chain of labels.
    """
    examples: list[list[TraceEvent]] = []

    def _dfs(node_id: str, label_idx: int, current_events: list[TraceEvent]) -> None:
        if len(examples) >= 3:
            return
        if label_idx == len(chain_labels):
            examples.append(list(current_events))
            return

        for child_id, _ in original_graph.children_of(node_id):
            child = original_graph.nodes[child_id]
            if child.label == chain_labels[label_idx] and child.event_examples:
                current_events.append(child.event_examples[0])
                _dfs(child_id, label_idx + 1, current_events)
                current_events.pop()

    _dfs("root", 0, [])
    return examples


def _compress_graph(graph: StateGraph, chain_ids: list[str], meta_id: str) -> StateGraph:
    """
    Collapse a chain of nodes into a single meta-node in the graph.
    Reroute edges: parent of chain[0] → meta_node → children of chain[-1].
    """
    new_graph = StateGraph()
    chain_set = set(chain_ids)

    meta_label = " → ".join(graph.nodes[nid].label for nid in chain_ids)
    meta_node = StateNode(
        id=meta_id,
        label=f"[META: {meta_label}]",
        depth=graph.nodes[chain_ids[0]].depth,
        trace_ids=set(),
    )

    for nid, node in graph.nodes.items():
        if nid in chain_set:
            meta_node.trace_ids |= node.trace_ids
            continue
        new_graph.add_node(StateNode(
            id=node.id,
            label=node.label,
            depth=node.depth,
            parent_id=node.parent_id,
            trace_ids=set(node.trace_ids),
            event_examples=list(node.event_examples),
        ))

    new_graph.add_node(meta_node)

    first_in_chain = chain_ids[0]
    last_in_chain = chain_ids[-1]

    for source, targets in graph.edges.items():
        for target, edge in targets.items():
            new_source = source
            new_target = target

            if target == first_in_chain and source not in chain_set:
                new_target = meta_id
            elif source == last_in_chain and target not in chain_set:
                new_source = meta_id
            elif source in chain_set or target in chain_set:
                continue

            if new_source not in new_graph.nodes or new_target not in new_graph.nodes:
                continue
            if new_source == new_target:
                continue

            for tid in edge.trace_ids:
                new_graph.add_edge(new_source, new_target, tid)

    return new_graph


def _deep_copy_graph(graph: StateGraph) -> StateGraph:
    new_graph = StateGraph()
    for nid, node in graph.nodes.items():
        new_graph.add_node(StateNode(
            id=node.id,
            label=node.label,
            depth=node.depth,
            parent_id=node.parent_id,
            trace_ids=set(node.trace_ids),
            event_examples=list(node.event_examples),
        ))
    for source, targets in graph.edges.items():
        for target, edge in targets.items():
            new_graph.edges[source][target] = StateEdge(
                source=source,
                target=target,
                weight=edge.weight,
                trace_ids=set(edge.trace_ids),
            )
    return new_graph


# ---------------------------------------------------------------------------
# Section 6: Chain → Macro Conversion (LLM)
# ---------------------------------------------------------------------------

def convert_candidates_to_macros(
    candidates: list[MetaToolCandidate],
    traces: list[TaskTrace],
    domain: str,
    api_key: str,
    model: str,
    verbose: bool = False,
) -> list[Macro]:
    import anthropic

    if not candidates:
        return []

    total_traces = len(traces)
    candidate_summaries = []
    for i, c in enumerate(candidates):
        example_text = _format_chain_examples(c)
        candidate_summaries.append(
            f"--- Candidate {i + 1} ---\n"
            f"Chain ({c.weight}/{total_traces} traces, {len(c.chain_labels)} steps): "
            f"{' → '.join(c.chain_labels)}\n"
            f"Example trace events:\n{example_text}"
        )

    prompt = f"""You are converting discovered browser action patterns into reusable macros.
These patterns were algorithmically extracted from {total_traces} execution traces on {domain}.
Each candidate is a sequence of actions that many traces share.

{chr(10).join(candidate_summaries)}

For each candidate, return a JSON object with:
- "name": short snake_case name (e.g., "search_product", "login", "add_to_cart")
- "description": one-sentence description of what this workflow does
- "trigger": when should the agent use this macro
- "parameters": array of {{ "name": string, "type": "string"|"number", "description": string }}
  These are the parts that VARY across traces (search queries, usernames, etc.)
  Constant values should NOT be parameters.
- "steps": array of step objects, each with:
  - "tool": string (exact tool name: computer, navigate, form_input, etc.)
  - "action": string or null (for computer tool: left_click, type, key, etc.)
  - "inputTemplate": object with {{{{param_name}}}} placeholders for variable parts
    and literal values for constants. Include tabId as "{{{{tabId}}}}".
    Do NOT include coordinate or ref values — they are ephemeral.
  - "semanticTarget": {{ "role": string, "name": string, "description": string }} or null
    Use ARIA role and accessible name. The "name" can use wildcards like "Search*".
- "confidence": number 0-1

Rules:
- Match each candidate to exactly one macro
- Keep step count matching the candidate's chain length
- Use the example events to determine what's constant vs variable
- If a candidate is too vague or low-value (e.g., just navigation), set confidence < 0.5

Return a JSON array of macro objects (one per candidate). Return ONLY the JSON array."""

    client = anthropic.Anthropic(api_key=api_key)
    response = client.messages.create(
        model=model,
        max_tokens=4096,
        messages=[{"role": "user", "content": prompt}],
    )
    text = "".join(b.text for b in response.content if b.type == "text").strip()

    bracket_start = text.find("[")
    bracket_end = text.rfind("]")
    if bracket_start == -1 or bracket_end == -1:
        if verbose:
            print(f"    Failed to find JSON array in LLM response")
        return []

    try:
        raw_macros = json.loads(text[bracket_start:bracket_end + 1])
    except json.JSONDecodeError as e:
        if verbose:
            print(f"    Failed to parse LLM response: {e}")
        return []

    macros: list[Macro] = []
    for i, raw in enumerate(raw_macros):
        if not isinstance(raw, dict):
            continue
        if not raw.get("name") or not raw.get("steps"):
            continue
        confidence = raw.get("confidence", 0.5)
        if confidence < 0.5:
            if verbose:
                print(f"    Skipping low-confidence macro: {raw.get('name')} ({confidence})")
            continue

        candidate = candidates[i] if i < len(candidates) else None
        name = re.sub(r"[^a-z0-9_]", "_", raw["name"].lower())

        steps: list[MacroStep] = []
        for s in raw.get("steps", []):
            step = MacroStep(
                tool=s.get("tool", ""),
                action=s.get("action"),
                inputTemplate=s.get("inputTemplate", {}),
                semanticTarget=s.get("semanticTarget"),
            )
            steps.append(step)

        params: list[MacroParameter] = []
        for p in raw.get("parameters", []):
            params.append(MacroParameter(
                name=p.get("name", ""),
                type=p.get("type", "string"),
                description=p.get("description", ""),
            ))

        macros.append(Macro(
            id=f"macro_{domain.replace('.', '_')}_{name}",
            name=name,
            domain=domain,
            description=raw.get("description", f"Macro: {name}"),
            trigger=raw.get("trigger", ""),
            parameters=params,
            steps=steps,
            sourceTraceCount=candidate.weight if candidate else 0,
            confidence=confidence,
            chainWeight=candidate.weight if candidate else 0,
            chainLength=len(candidate.chain_labels) if candidate else len(steps),
        ))

    if verbose:
        print(f"  Converted {len(macros)} macros from {len(candidates)} candidates")

    return macros


def _format_chain_examples(candidate: MetaToolCandidate) -> str:
    if not candidate.example_events:
        return "  (no examples available)"

    parts = []
    for ex_idx, events in enumerate(candidate.example_events[:3]):
        lines = [f"  Example {ex_idx + 1}:"]
        for step_idx, ev in enumerate(events):
            tool_label = f"{ev.tool}({ev.action})" if ev.action else ev.tool
            sem = ""
            if ev.semanticTarget:
                sem = f' [element: {ev.semanticTarget.role} "{ev.semanticTarget.name}"]'

            relevant = {k: v for k, v in ev.input.items()
                        if k not in ("tabId", "action", "screenshot", "imageData", "coordinate", "ref")}
            for k, v in relevant.items():
                if isinstance(v, str) and len(v) > 100:
                    relevant[k] = v[:100] + "..."
            input_str = f" {json.dumps(relevant)}" if relevant else ""

            lines.append(f"    {step_idx + 1}. {tool_label}{input_str}{sem} @ {ev.url}")
        parts.append("\n".join(lines))

    return "\n".join(parts)


# ---------------------------------------------------------------------------
# Section 7: Output
# ---------------------------------------------------------------------------

def macros_to_json(macros: list[Macro]) -> list[dict]:
    """Format macros matching the chrome extension's Macro interface exactly."""
    now = int(time.time() * 1000)
    result = []
    for m in macros:
        result.append({
            "id": m.id,
            "name": m.name,
            "domain": m.domain,
            "description": m.description,
            "trigger": m.trigger,
            "parameters": [asdict(p) for p in m.parameters],
            "steps": [
                {
                    "tool": s.tool,
                    "action": s.action if s.action else None,
                    "inputTemplate": s.inputTemplate,
                    "semanticTarget": s.semanticTarget if s.semanticTarget else None,
                }
                for s in m.steps
            ],
            "sourceTraceCount": m.sourceTraceCount,
            "confidence": m.confidence,
            "createdAt": now,
            "updatedAt": now,
        })
    return result


def print_graph_stats(graph: StateGraph, label: str) -> None:
    total_weight = sum(
        e.weight for targets in graph.edges.values() for e in targets.values()
    )
    avg_branching = 0.0
    internal = [nid for nid in graph.nodes if graph.children_of(nid)]
    if internal:
        avg_branching = sum(len(graph.children_of(nid)) for nid in internal) / len(internal)

    print(f"  [{label}] Nodes: {graph.node_count()}, Edges: {graph.edge_count()}, "
          f"Sinks: {graph.sink_count()}, Total weight: {total_weight}, "
          f"Avg branching: {avg_branching:.2f}")


def print_summary(candidates: list[MetaToolCandidate], macros: list[Macro], total_traces: int) -> None:
    print(f"\n{'='*60}")
    print(f"  RESULTS")
    print(f"{'='*60}")

    if not macros:
        print("  No macros discovered.")
        return

    for i, m in enumerate(macros):
        c = candidates[i] if i < len(candidates) else None
        coverage = f"{c.weight}/{total_traces}" if c else "?"
        print(f"\n  {i+1}. {m.name}")
        print(f"     {m.description}")
        print(f"     Coverage: {coverage} traces | Chain: {m.chainLength} steps | Confidence: {m.confidence}")
        if m.parameters:
            param_names = ", ".join(p.name for p in m.parameters)
            print(f"     Parameters: {param_names}")
        if m.steps:
            for j, s in enumerate(m.steps):
                tool_label = f"{s.tool}({s.action})" if s.action else s.tool
                sem = ""
                if s.semanticTarget:
                    sem = f' → [{s.semanticTarget.get("role", "")} "{s.semanticTarget.get("name", "")}"]'
                print(f"       Step {j+1}: {tool_label}{sem}")


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------

def run_pipeline(
    traces_path: str,
    api_key: str,
    threshold: int = 3,
    model: str = "claude-haiku-4-5-20251001",
    output_path: str | None = None,
    skip_llm_merge: bool = False,
    dry_run: bool = False,
    verbose: bool = False,
) -> list[Macro]:
    print(f"\n{'='*60}")
    print(f"  GRAPHMINER — AWO-style macro discovery")
    print(f"{'='*60}")

    # --- Load ---
    print(f"\n[1/6] Loading traces from {traces_path}...")
    traces = load_traces(traces_path)
    domain = traces[0].domain if traces else "unknown"
    successful = [t for t in traces if t.taskSuccess]
    print(f"  Loaded {len(traces)} traces ({len(successful)} successful) for domain: {domain}")

    if len(traces) < threshold:
        print(f"  Not enough traces (need {threshold}). Exiting.")
        return []

    # --- Build graph ---
    print(f"\n[2/6] Building state graph...")
    graph = build_state_graph(traces, verbose=verbose)
    if verbose:
        print_graph_stats(graph, "Initial")

    # --- Structural merge ---
    print(f"\n[3/6] Structural merging...")
    merged = structural_merge(graph, verbose=verbose)
    if verbose:
        print_graph_stats(merged, "Post-structural")

    # --- LLM merge ---
    if skip_llm_merge or dry_run or not api_key:
        reason = "dry run" if dry_run else "no API key" if not api_key else "skipped"
        print(f"\n[4/6] LLM merging... SKIPPED ({reason})")
    else:
        print(f"\n[4/6] LLM-assisted merging...")
        merged = llm_merge(merged, api_key, model, verbose=verbose)
        if verbose:
            print_graph_stats(merged, "Post-LLM")

    # --- Extract ---
    print(f"\n[5/6] Extracting meta-tool candidates (threshold={threshold})...")
    candidates = extract_meta_tools(merged, threshold, verbose=verbose)

    if not candidates:
        print("  No candidates found. Try lowering --threshold.")
        return []

    # --- Convert ---
    if dry_run:
        print(f"\n[6/6] Converting candidates to macros... SKIPPED (dry run)")
        print(f"\n{'='*60}")
        print(f"  DRY RUN RESULTS — {len(candidates)} candidate(s) found")
        print(f"{'='*60}")
        for i, c in enumerate(candidates):
            print(f"\n  Candidate {i+1}: weight={c.weight}/{len(traces)}, chain={len(c.chain_labels)} steps")
            for label in c.chain_labels:
                print(f"    → {label}")
        return []

    print(f"\n[6/6] Converting {len(candidates)} candidates to macros via LLM...")
    macros = convert_candidates_to_macros(
        candidates, traces, domain, api_key, model, verbose=verbose,
    )

    # --- Output ---
    print_summary(candidates, macros, len(traces))

    if output_path:
        out = macros_to_json(macros)
        Path(output_path).write_text(json.dumps(out, indent=2))
        print(f"\n  Written {len(macros)} macros to {output_path}")

    return macros


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="AWO-style graph-based macro miner with LLM-in-the-loop",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python graphminer.py --traces traces.json --api-key sk-ant-...
  python graphminer.py --traces traces.json --api-key sk-ant-... --threshold 5 --verbose
  python graphminer.py --traces traces.json --api-key sk-ant-... --skip-llm-merge --output macros.json
        """,
    )
    parser.add_argument("--traces", required=True, help="Path to traces JSON file")
    parser.add_argument("--api-key", default="", help="Anthropic API key (required unless --dry-run)")
    parser.add_argument("--threshold", type=int, default=3,
                        help="Minimum trace count for a pattern (default: 3)")
    parser.add_argument("--model", default="claude-haiku-4-5-20251001",
                        help="Anthropic model for LLM steps (default: claude-haiku-4-5-20251001)")
    parser.add_argument("--output", help="Output path for macros JSON")
    parser.add_argument("--skip-llm-merge", action="store_true",
                        help="Skip LLM-assisted horizontal merging (structural only)")
    parser.add_argument("--dry-run", action="store_true",
                        help="Stop after extraction, skip LLM macro conversion")
    parser.add_argument("--verbose", action="store_true", help="Print detailed stats")
    args = parser.parse_args()

    run_pipeline(
        traces_path=args.traces,
        api_key=args.api_key,
        threshold=args.threshold,
        model=args.model,
        output_path=args.output,
        skip_llm_merge=args.skip_llm_merge,
        dry_run=args.dry_run,
        verbose=args.verbose,
    )


if __name__ == "__main__":
    main()
