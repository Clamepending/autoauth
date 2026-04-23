/**
 * graph-miner.ts — AWO-style state-graph macro miner with LLM-in-the-loop.
 *
 * TypeScript port of graphminer.py. Takes browser agent traces, builds a
 * weighted state graph, performs horizontal merging (structural + LLM-assisted),
 * extracts meta-tool candidates via greedy Algorithm 1, then converts them to
 * macros using an LLM.
 *
 * Reference: Abuzakuk et al., "Optimizing Agentic Workflows using Meta-tools", 2026.
 */

import Anthropic from "@anthropic-ai/sdk";

// ---------------------------------------------------------------------------
// Data types — mirrors the chrome extension's traceLogger.ts
// ---------------------------------------------------------------------------

export interface SemanticTarget {
  role: string;
  name: string;
  tag?: string | null;
  inputType?: string | null;
}

export interface TraceEvent {
  tool: string;
  action?: string | null;
  input: Record<string, unknown>;
  url: string;
  success: boolean;
  domain?: string;
  timestamp?: number;
  macroReplay?: boolean;
  semanticTarget?: SemanticTarget | null;
}

export interface TaskTrace {
  id: string;
  domain: string;
  goal: string;
  events: TraceEvent[];
  taskSuccess: boolean;
  startedAt?: number;
  completedAt?: number;
}

// ---------------------------------------------------------------------------
// Graph types
// ---------------------------------------------------------------------------

interface StateNode {
  id: string;
  label: string;
  depth: number;
  parentId: string | null;
  traceIds: Set<string>;
  eventExamples: TraceEvent[];
}

interface StateEdge {
  source: string;
  target: string;
  weight: number;
  traceIds: Set<string>;
}

interface StateGraph {
  nodes: Map<string, StateNode>;
  edges: Map<string, Map<string, StateEdge>>;
  rootId: string;
}

interface MetaToolCandidate {
  chainLabels: string[];
  chainNodeIds: string[];
  weight: number;
  traceIds: Set<string>;
  exampleEvents: TraceEvent[][];
}

// ---------------------------------------------------------------------------
// Output types — matches the extension's Macro interface
// ---------------------------------------------------------------------------

export interface MinedMacroStep {
  tool: string;
  action?: string | null;
  inputTemplate: Record<string, unknown>;
  semanticTarget?: { role: string; name: string; description: string } | null;
}

export interface MinedMacroParameter {
  name: string;
  type: string;
  description: string;
}

export interface MinedMacro {
  id: string;
  name: string;
  domain: string;
  description: string;
  trigger: string;
  parameters: MinedMacroParameter[];
  steps: MinedMacroStep[];
  sourceTraceCount: number;
  confidence: number;
  chainWeight: number;
  chainLength: number;
  createdAt: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OBSERVATION_TOOLS = new Set(["read_page", "get_page_text", "find", "tabs_context"]);
const OBSERVATION_ACTIONS = new Set(["screenshot"]);
const MINING_MODEL = "claude-haiku-4-5-20251001";

// ---------------------------------------------------------------------------
// Section 1: Event Normalization
// ---------------------------------------------------------------------------

const NUMERIC_SEGMENT = /\/\d+/g;
const ID_LIKE_SEGMENT = /\/(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{6,}/g;
const UUID_SEGMENT = /\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

function normalizeUrlPath(url: string): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    let path = parsed.pathname.replace(/\/+$/, "") || "/";
    path = path.replace(UUID_SEGMENT, "/{}");
    path = path.replace(ID_LIKE_SEGMENT, "/{}");
    path = path.replace(NUMERIC_SEGMENT, "/{}");
    return path;
  } catch {
    return "";
  }
}

function normalizeSemanticName(name: string): string {
  let n = name.trim().replace(/\s+/g, " ");
  if (n.length > 80) n = n.slice(0, 80);
  return n;
}

function isObservationEvent(ev: TraceEvent): boolean {
  if (OBSERVATION_TOOLS.has(ev.tool)) return true;
  if (ev.tool === "computer" && ev.action && OBSERVATION_ACTIONS.has(ev.action)) return true;
  return false;
}

function canonicalizeEvent(ev: TraceEvent): string | null {
  if (isObservationEvent(ev)) return null;
  if (ev.macroReplay) return null;
  if (!ev.success) return null;

  const tool = ev.tool;
  const action = ev.action;
  const urlPath = normalizeUrlPath(ev.url);

  if (tool === "computer") {
    if (action === "wait") return null;

    let semPart = "";
    if (ev.semanticTarget?.name) {
      const role = ev.semanticTarget.role;
      const name = normalizeSemanticName(ev.semanticTarget.name);
      semPart = ` [${role} "${name}"]`;
    }

    if (action === "key") {
      const keyName = (ev.input.text as string) ?? "?";
      return `key(${keyName})${semPart} @ ${urlPath}`;
    }
    if (action === "type") {
      return `type${semPart} @ ${urlPath}`;
    }
    if (action === "scroll") {
      const direction = (ev.input.scroll_direction as string) ?? "down";
      return `scroll(${direction}) @ ${urlPath}`;
    }
    return `${action}${semPart} @ ${urlPath}`;
  }

  if (tool === "navigate") {
    return `navigate @ ${urlPath}`;
  }

  if (tool === "form_input") {
    let semPart = "";
    if (ev.semanticTarget?.name) {
      const role = ev.semanticTarget.role;
      const name = normalizeSemanticName(ev.semanticTarget.name);
      semPart = ` [${role} "${name}"]`;
    }
    return `fill${semPart} @ ${urlPath}`;
  }

  if (["javascript_tool", "file_upload", "upload_image", "resize_window"].includes(tool)) {
    return `${tool} @ ${urlPath}`;
  }

  if (tool === "tabs_create") return "tabs_create";

  return `${tool} @ ${urlPath}`;
}

// ---------------------------------------------------------------------------
// Section 2: Build State Graph (prefix trie)
// ---------------------------------------------------------------------------

let nodeCounter = 0;

function freshNodeId(): string {
  nodeCounter++;
  return `n_${nodeCounter}`;
}

function createGraph(): StateGraph {
  return {
    nodes: new Map(),
    edges: new Map(),
    rootId: "root",
  };
}

function addNode(graph: StateGraph, node: StateNode): void {
  graph.nodes.set(node.id, node);
}

function addEdge(graph: StateGraph, source: string, target: string, traceId: string): void {
  if (!graph.edges.has(source)) graph.edges.set(source, new Map());
  const targets = graph.edges.get(source)!;
  const existing = targets.get(target);
  if (existing) {
    existing.weight++;
    existing.traceIds.add(traceId);
  } else {
    targets.set(target, { source, target, weight: 1, traceIds: new Set([traceId]) });
  }
}

function childrenOf(graph: StateGraph, nodeId: string): Array<[string, StateEdge]> {
  const targets = graph.edges.get(nodeId);
  if (!targets) return [];
  return Array.from(targets.entries());
}

function totalOutgoingWeight(graph: StateGraph, nodeId: string): number {
  const targets = graph.edges.get(nodeId);
  if (!targets) return 0;
  let sum = 0;
  for (const edge of targets.values()) sum += edge.weight;
  return sum;
}

function findChildWithLabel(graph: StateGraph, parentId: string, label: string): string | null {
  for (const [childId] of childrenOf(graph, parentId)) {
    if (graph.nodes.get(childId)?.label === label) return childId;
  }
  return null;
}

export function buildStateGraph(traces: TaskTrace[]): StateGraph {
  nodeCounter = 0;
  const graph = createGraph();
  addNode(graph, {
    id: "root",
    label: "[START]",
    depth: 0,
    parentId: null,
    traceIds: new Set(),
    eventExamples: [],
  });

  for (const trace of traces) {
    const canonical: Array<[string, TraceEvent]> = [];
    for (const ev of trace.events) {
      const label = canonicalizeEvent(ev);
      if (label !== null) canonical.push([label, ev]);
    }

    let currentId = "root";
    for (let i = 0; i < canonical.length; i++) {
      const [label, ev] = canonical[i];
      const existingChild = findChildWithLabel(graph, currentId, label);

      if (existingChild !== null) {
        addEdge(graph, currentId, existingChild, trace.id);
        const node = graph.nodes.get(existingChild)!;
        node.traceIds.add(trace.id);
        if (node.eventExamples.length < 5) node.eventExamples.push(ev);
        currentId = existingChild;
      } else {
        const newId = freshNodeId();
        addNode(graph, {
          id: newId,
          label,
          depth: i + 1,
          parentId: currentId,
          traceIds: new Set([trace.id]),
          eventExamples: [ev],
        });
        addEdge(graph, currentId, newId, trace.id);
        currentId = newId;
      }
    }
  }

  return graph;
}

// ---------------------------------------------------------------------------
// Section 3: Horizontal Merging
// ---------------------------------------------------------------------------

function coarsenLabel(label: string): string {
  return label.replace(/"[^"]*"/g, '""');
}

function applyMergeMap(graph: StateGraph, mergeMap: Map<string, string>): StateGraph {
  function resolve(nid: string): string {
    const visited = new Set<string>();
    while (mergeMap.has(nid)) {
      if (visited.has(nid)) break;
      visited.add(nid);
      nid = mergeMap.get(nid)!;
    }
    return nid;
  }

  const newGraph = createGraph();

  for (const [nid, node] of graph.nodes) {
    const canonical = resolve(nid);
    if (!newGraph.nodes.has(canonical)) {
      const canonNode = graph.nodes.get(canonical)!;
      addNode(newGraph, {
        id: canonical,
        label: canonNode.label,
        depth: canonNode.depth,
        parentId: null,
        traceIds: new Set(node.traceIds),
        eventExamples: [...canonNode.eventExamples],
      });
    } else {
      for (const tid of node.traceIds) newGraph.nodes.get(canonical)!.traceIds.add(tid);
    }
  }

  for (const [source, targets] of graph.edges) {
    for (const [target, edge] of targets) {
      const rSource = resolve(source);
      const rTarget = resolve(target);
      if (rSource === rTarget) continue;
      if (!newGraph.nodes.has(rSource) || !newGraph.nodes.has(rTarget)) continue;
      for (const tid of edge.traceIds) addEdge(newGraph, rSource, rTarget, tid);
    }
  }

  for (const [nid, node] of newGraph.nodes) {
    if (nid === "root") continue;
    for (const [possibleParent] of newGraph.nodes) {
      if (newGraph.edges.get(possibleParent)?.has(nid)) {
        node.parentId = possibleParent;
        break;
      }
    }
  }

  return newGraph;
}

export function structuralMerge(graph: StateGraph): StateGraph {
  const labelGroups = new Map<string, string[]>();
  for (const [nid, node] of graph.nodes) {
    if (nid === "root") continue;
    const coarse = coarsenLabel(node.label);
    if (!labelGroups.has(coarse)) labelGroups.set(coarse, []);
    labelGroups.get(coarse)!.push(nid);
  }

  const mergeMap = new Map<string, string>();
  for (const [, nids] of labelGroups) {
    if (nids.length <= 1) continue;

    const byDepth = new Map<number, string[]>();
    for (const nid of nids) {
      const d = graph.nodes.get(nid)!.depth;
      if (!byDepth.has(d)) byDepth.set(d, []);
      byDepth.get(d)!.push(nid);
    }

    for (const [, group] of byDepth) {
      if (group.length <= 1) continue;

      const byParent = new Map<string, string[]>();
      for (const nid of group) {
        const effectiveParent = mergeMap.get(graph.nodes.get(nid)!.parentId ?? "") ?? (graph.nodes.get(nid)!.parentId ?? "");
        if (!byParent.has(effectiveParent)) byParent.set(effectiveParent, []);
        byParent.get(effectiveParent)!.push(nid);
      }

      for (const [, siblings] of byParent) {
        if (siblings.length <= 1) continue;
        const canonical = siblings[0];
        for (let i = 1; i < siblings.length; i++) {
          mergeMap.set(siblings[i], canonical);
        }
      }
    }
  }

  if (mergeMap.size === 0) return graph;
  return applyMergeMap(graph, mergeMap);
}

// ---------------------------------------------------------------------------
// Section 3b: LLM-Assisted Merging
// ---------------------------------------------------------------------------

function findMergeCandidates(graph: StateGraph): Array<[string, string]> {
  const toolGroups = new Map<string, string[]>();
  for (const [nid, node] of graph.nodes) {
    if (nid === "root") continue;
    const coarse = coarsenLabel(node.label);
    if (!toolGroups.has(coarse)) toolGroups.set(coarse, []);
    toolGroups.get(coarse)!.push(nid);
  }

  const candidates: Array<[string, string]> = [];
  for (const [, nids] of toolGroups) {
    if (nids.length <= 1) continue;

    const byDepth = new Map<number, string[]>();
    for (const nid of nids) {
      const d = graph.nodes.get(nid)!.depth;
      if (!byDepth.has(d)) byDepth.set(d, []);
      byDepth.get(d)!.push(nid);
    }

    for (const [, group] of byDepth) {
      if (group.length <= 1) continue;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          if (graph.nodes.get(group[i])!.label !== graph.nodes.get(group[j])!.label) {
            candidates.push([group[i], group[j]]);
          }
        }
      }
    }
  }

  return candidates;
}

function getNodeContext(graph: StateGraph, nodeId: string): string {
  const node = graph.nodes.get(nodeId)!;
  const parts: string[] = [];
  if (node.parentId && graph.nodes.has(node.parentId)) {
    parts.push(`parent=${graph.nodes.get(node.parentId)!.label}`);
  }
  const children = childrenOf(graph, nodeId);
  if (children.length > 0) {
    const labels = children.slice(0, 3).map(([cid]) => graph.nodes.get(cid)!.label);
    parts.push(`children=[${labels.join(", ")}]`);
  }
  return parts.length > 0 ? parts.join(" | ") : "(leaf)";
}

function batchCandidates(candidates: Array<[string, string]>, batchSize = 25): Array<Array<[string, string]>> {
  const batches: Array<Array<[string, string]>> = [];
  for (let i = 0; i < candidates.length; i += batchSize) {
    batches.push(candidates.slice(i, i + batchSize));
  }
  return batches;
}

async function llmEvaluateMerges(
  batch: Array<[string, string]>,
  graph: StateGraph,
  apiKey: string,
  model: string,
): Promise<Array<[string, string]>> {
  const pairDescs = batch.map(([a, b], idx) => {
    const aNode = graph.nodes.get(a)!;
    const bNode = graph.nodes.get(b)!;
    return (
      `Pair ${idx}:\n` +
      `  A: ${aNode.label} (depth ${aNode.depth}, weight ${aNode.traceIds.size})\n` +
      `     Context: ${getNodeContext(graph, a)}\n` +
      `  B: ${bNode.label} (depth ${bNode.depth}, weight ${bNode.traceIds.size})\n` +
      `     Context: ${getNodeContext(graph, b)}`
    );
  });

  const prompt = `You are analyzing a state graph built from browser agent execution traces.
Decide which pairs of nodes represent semantically equivalent states — meaning they accomplish the same thing even if exact element names or URLs differ slightly.

Two nodes ARE equivalent if:
- Same action (same tool + action type)
- Target functionally the same element (e.g., "Search" vs "Go" on a search page)
- Same point in a workflow
- Merging would NOT change workflow meaning

Two nodes are NOT equivalent if:
- Target genuinely different elements (e.g., "Add to Cart" vs "Buy Now")
- On fundamentally different pages
- Merging would conflate different user intents

Candidates:

${pairDescs.join("\n\n")}

Return a JSON array of pair indices that SHOULD be merged.
Example: [0, 3, 7] means pairs 0, 3, and 7 should merge.
If none should merge, return [].
Return ONLY the JSON array.`;

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const bracketStart = text.indexOf("[");
  const bracketEnd = text.lastIndexOf("]");
  if (bracketStart === -1 || bracketEnd === -1) return [];

  let indices: unknown;
  try {
    indices = JSON.parse(text.slice(bracketStart, bracketEnd + 1));
  } catch {
    return [];
  }

  if (!Array.isArray(indices)) return [];
  const approved: Array<[string, string]> = [];
  for (const idx of indices) {
    if (typeof idx === "number" && idx >= 0 && idx < batch.length) {
      approved.push(batch[idx]);
    }
  }
  return approved;
}

export async function llmMerge(
  graph: StateGraph,
  apiKey: string,
  model = MINING_MODEL,
): Promise<StateGraph> {
  const candidates = findMergeCandidates(graph);
  if (candidates.length === 0) return graph;

  const batches = batchCandidates(candidates);
  const mergeMap = new Map<string, string>();

  for (const batch of batches) {
    const approved = await llmEvaluateMerges(batch, graph, apiKey, model);
    for (const [a, b] of approved) {
      mergeMap.set(b, a);
    }
  }

  if (mergeMap.size === 0) return graph;
  return applyMergeMap(graph, mergeMap);
}

// ---------------------------------------------------------------------------
// Section 4: Algorithm 1 — Meta-tool Extraction
// ---------------------------------------------------------------------------

function deepCopyGraph(graph: StateGraph): StateGraph {
  const g = createGraph();
  for (const [nid, node] of graph.nodes) {
    addNode(g, {
      id: node.id,
      label: node.label,
      depth: node.depth,
      parentId: node.parentId,
      traceIds: new Set(node.traceIds),
      eventExamples: [...node.eventExamples],
    });
  }
  for (const [source, targets] of graph.edges) {
    for (const [target, edge] of targets) {
      if (!g.edges.has(source)) g.edges.set(source, new Map());
      g.edges.get(source)!.set(target, {
        source: edge.source,
        target: edge.target,
        weight: edge.weight,
        traceIds: new Set(edge.traceIds),
      });
    }
  }
  return g;
}

function extractStatePairs(graph: StateGraph, threshold: number): Array<[string, string, number]> {
  const pairs: Array<[string, string, number, number]> = [];
  for (const [source, targets] of graph.edges) {
    if (source === "root") continue;
    for (const [target, edge] of targets) {
      if (edge.weight >= threshold) {
        const depth = graph.nodes.get(source)?.depth ?? 0;
        pairs.push([source, target, edge.weight, depth]);
      }
    }
  }
  pairs.sort((a, b) => b[2] - a[2] || a[3] - b[3]);
  return pairs.map(([s, t, w]) => [s, t, w]);
}

function selectDominantChild(graph: StateGraph, nodeId: string): string | null {
  const children = childrenOf(graph, nodeId);
  if (children.length === 0) return null;

  let total = 0;
  for (const [, edge] of children) total += edge.weight;
  if (total === 0) return null;

  for (const [childId, edge] of children) {
    if (edge.weight > total / 2) return childId;
  }
  return null;
}

function getChainTraceIds(graph: StateGraph, chainIds: string[]): Set<string> {
  if (chainIds.length < 2) return new Set();
  let ids: Set<string> | null = null;
  for (let i = 0; i < chainIds.length - 1; i++) {
    const edge = graph.edges.get(chainIds[i])?.get(chainIds[i + 1]);
    if (!edge) return new Set();
    if (ids === null) {
      ids = new Set(edge.traceIds);
    } else {
      for (const tid of ids) {
        if (!edge.traceIds.has(tid)) ids.delete(tid);
      }
    }
  }
  return ids ?? new Set();
}

function collectChainExamples(
  originalGraph: StateGraph,
  chainLabels: string[],
): TraceEvent[][] {
  const examples: TraceEvent[][] = [];

  function dfs(nodeId: string, labelIdx: number, current: TraceEvent[]): void {
    if (examples.length >= 3) return;
    if (labelIdx === chainLabels.length) {
      examples.push([...current]);
      return;
    }
    for (const [childId] of childrenOf(originalGraph, nodeId)) {
      const child = originalGraph.nodes.get(childId)!;
      if (child.label === chainLabels[labelIdx] && child.eventExamples.length > 0) {
        current.push(child.eventExamples[0]);
        dfs(childId, labelIdx + 1, current);
        current.pop();
      }
    }
  }

  dfs("root", 0, []);
  return examples;
}

function compressGraph(graph: StateGraph, chainIds: string[], metaId: string): StateGraph {
  const chainSet = new Set(chainIds);
  const newGraph = createGraph();

  const metaLabel = chainIds.map((nid) => graph.nodes.get(nid)!.label).join(" → ");
  const metaNode: StateNode = {
    id: metaId,
    label: `[META: ${metaLabel}]`,
    depth: graph.nodes.get(chainIds[0])!.depth,
    parentId: null,
    traceIds: new Set(),
    eventExamples: [],
  };

  for (const [nid, node] of graph.nodes) {
    if (chainSet.has(nid)) {
      for (const tid of node.traceIds) metaNode.traceIds.add(tid);
      continue;
    }
    addNode(newGraph, {
      id: node.id,
      label: node.label,
      depth: node.depth,
      parentId: node.parentId,
      traceIds: new Set(node.traceIds),
      eventExamples: [...node.eventExamples],
    });
  }
  addNode(newGraph, metaNode);

  const firstInChain = chainIds[0];
  const lastInChain = chainIds[chainIds.length - 1];

  for (const [source, targets] of graph.edges) {
    for (const [target, edge] of targets) {
      let newSource = source;
      let newTarget = target;

      if (target === firstInChain && !chainSet.has(source)) {
        newTarget = metaId;
      } else if (source === lastInChain && !chainSet.has(target)) {
        newSource = metaId;
      } else if (chainSet.has(source) || chainSet.has(target)) {
        continue;
      }

      if (!newGraph.nodes.has(newSource) || !newGraph.nodes.has(newTarget)) continue;
      if (newSource === newTarget) continue;
      for (const tid of edge.traceIds) addEdge(newGraph, newSource, newTarget, tid);
    }
  }

  return newGraph;
}

export function extractMetaTools(
  graph: StateGraph,
  threshold: number,
): MetaToolCandidate[] {
  let G = deepCopyGraph(graph);
  const metaTools: MetaToolCandidate[] = [];
  let iteration = 0;

  while (true) {
    iteration++;
    const pairs = extractStatePairs(G, threshold);
    if (pairs.length === 0) break;

    const [nx, ny] = pairs[0];
    const chainIds = [nx, ny];
    const chainLabels = [G.nodes.get(nx)!.label, G.nodes.get(ny)!.label];

    let current = ny;
    while (true) {
      const bestChild = selectDominantChild(G, current);
      if (bestChild === null) break;
      chainIds.push(bestChild);
      chainLabels.push(G.nodes.get(bestChild)!.label);
      current = bestChild;
    }

    if (chainIds.length < 2) break;

    const traceIds = getChainTraceIds(G, chainIds);
    const examples = collectChainExamples(graph, chainLabels);

    metaTools.push({
      chainLabels,
      chainNodeIds: chainIds,
      weight: traceIds.size || pairs[0][2],
      traceIds,
      exampleEvents: examples,
    });

    G = compressGraph(G, chainIds, `meta_${iteration}`);
  }

  return metaTools;
}

// ---------------------------------------------------------------------------
// Section 5: Chain → Macro Conversion (LLM)
// ---------------------------------------------------------------------------

function formatChainExamples(candidate: MetaToolCandidate): string {
  if (candidate.exampleEvents.length === 0) return "  (no examples available)";

  const parts: string[] = [];
  for (let exIdx = 0; exIdx < Math.min(candidate.exampleEvents.length, 3); exIdx++) {
    const events = candidate.exampleEvents[exIdx];
    const lines = [`  Example ${exIdx + 1}:`];
    for (let stepIdx = 0; stepIdx < events.length; stepIdx++) {
      const ev = events[stepIdx];
      const toolLabel = ev.action ? `${ev.tool}(${ev.action})` : ev.tool;
      const sem = ev.semanticTarget
        ? ` [element: ${ev.semanticTarget.role} "${ev.semanticTarget.name}"]`
        : "";

      const relevant: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(ev.input)) {
        if (["tabId", "action", "screenshot", "imageData", "coordinate", "ref"].includes(k)) continue;
        if (typeof v === "string" && v.length > 100) {
          relevant[k] = v.slice(0, 100) + "...";
        } else {
          relevant[k] = v;
        }
      }
      const inputStr = Object.keys(relevant).length > 0 ? ` ${JSON.stringify(relevant)}` : "";
      lines.push(`    ${stepIdx + 1}. ${toolLabel}${inputStr}${sem} @ ${ev.url}`);
    }
    parts.push(lines.join("\n"));
  }
  return parts.join("\n");
}

export async function convertCandidatesToMacros(
  candidates: MetaToolCandidate[],
  traces: TaskTrace[],
  domain: string,
  apiKey: string,
  model = MINING_MODEL,
): Promise<MinedMacro[]> {
  if (candidates.length === 0) return [];

  const totalTraces = traces.length;
  const summaries = candidates.map((c, i) => {
    const exampleText = formatChainExamples(c);
    return (
      `--- Candidate ${i + 1} ---\n` +
      `Chain (${c.weight}/${totalTraces} traces, ${c.chainLabels.length} steps): ` +
      `${c.chainLabels.join(" → ")}\n` +
      `Example trace events:\n${exampleText}`
    );
  });

  const prompt = `You are converting discovered browser action patterns into reusable macros.
These patterns were algorithmically extracted from ${totalTraces} execution traces on ${domain}.
Each candidate is a sequence of actions that many traces share.

${summaries.join("\n\n")}

For each candidate, return a JSON object with:
- "name": short snake_case name (e.g., "search_product", "login", "add_to_cart")
- "description": one-sentence description of what this workflow does
- "trigger": when should the agent use this macro
- "parameters": array of { "name": string, "type": "string"|"number", "description": string }
  These are the parts that VARY across traces (search queries, usernames, etc.)
  Constant values should NOT be parameters.
- "steps": array of step objects, each with:
  - "tool": string (exact tool name: computer, navigate, form_input, etc.)
  - "action": string or null (for computer tool: left_click, type, key, etc.)
  - "inputTemplate": object with {{param_name}} placeholders for variable parts
    and literal values for constants. Include tabId as "{{tabId}}".
    Do NOT include coordinate or ref values — they are ephemeral.
  - "semanticTarget": { "role": string, "name": string, "description": string } or null
    Use ARIA role and accessible name. The "name" can use wildcards like "Search*".
- "confidence": number 0-1

Rules:
- Match each candidate to exactly one macro
- Keep step count matching the candidate's chain length
- Use the example events to determine what's constant vs variable
- If a candidate is too vague or low-value (e.g., just navigation), set confidence < 0.5

Return a JSON array of macro objects (one per candidate). Return ONLY the JSON array.`;

  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();

  const bracketStart = text.indexOf("[");
  const bracketEnd = text.lastIndexOf("]");
  if (bracketStart === -1 || bracketEnd === -1) return [];

  let rawMacros: unknown[];
  try {
    rawMacros = JSON.parse(text.slice(bracketStart, bracketEnd + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(rawMacros)) return [];

  const now = Date.now();
  const macros: MinedMacro[] = [];

  for (let i = 0; i < rawMacros.length; i++) {
    const raw = rawMacros[i] as Record<string, unknown>;
    if (!raw?.name || !raw?.steps || !Array.isArray(raw.steps)) continue;
    const confidence = typeof raw.confidence === "number" ? raw.confidence : 0.5;
    if (confidence < 0.5) continue;

    const candidate = i < candidates.length ? candidates[i] : null;
    const name = String(raw.name).toLowerCase().replace(/[^a-z0-9_]/g, "_");

    const steps: MinedMacroStep[] = (raw.steps as Array<Record<string, unknown>>).map((s) => ({
      tool: String(s.tool ?? ""),
      action: s.action ? String(s.action) : null,
      inputTemplate: (s.inputTemplate as Record<string, unknown>) ?? {},
      semanticTarget: s.semanticTarget && typeof s.semanticTarget === "object"
        ? (s.semanticTarget as { role: string; name: string; description: string })
        : null,
    }));

    const parameters: MinedMacroParameter[] = Array.isArray(raw.parameters)
      ? (raw.parameters as Array<Record<string, unknown>>).map((p) => ({
          name: String(p.name ?? ""),
          type: String(p.type ?? "string"),
          description: String(p.description ?? ""),
        }))
      : [];

    macros.push({
      id: `macro_${domain.replace(/\./g, "_")}_${name}`,
      name,
      domain,
      description: String(raw.description ?? `Macro: ${name}`),
      trigger: String(raw.trigger ?? ""),
      parameters,
      steps,
      sourceTraceCount: candidate?.weight ?? 0,
      confidence,
      chainWeight: candidate?.weight ?? 0,
      chainLength: candidate?.chainLabels.length ?? steps.length,
      createdAt: now,
      updatedAt: now,
    });
  }

  return macros;
}

// ---------------------------------------------------------------------------
// Section 6: Full Pipeline
// ---------------------------------------------------------------------------

export interface MiningResult {
  macros: MinedMacro[];
  tracesUsed: number;
  candidatesFound: number;
}

export async function runMiningPipeline(
  traces: TaskTrace[],
  domain: string,
  apiKey: string,
  options: {
    threshold?: number;
    model?: string;
    skipLlmMerge?: boolean;
  } = {},
): Promise<MiningResult> {
  const threshold = options.threshold ?? 3;
  const model = options.model ?? MINING_MODEL;

  const successful = traces.filter((t) => t.taskSuccess);
  if (successful.length < threshold) {
    return { macros: [], tracesUsed: successful.length, candidatesFound: 0 };
  }

  const graph = buildStateGraph(successful);
  let merged = structuralMerge(graph);

  if (!options.skipLlmMerge && apiKey) {
    merged = await llmMerge(merged, apiKey, model);
  }

  const candidates = extractMetaTools(merged, threshold);
  if (candidates.length === 0) {
    return { macros: [], tracesUsed: successful.length, candidatesFound: 0 };
  }

  const macros = await convertCandidatesToMacros(
    candidates, successful, domain, apiKey, model,
  );

  return {
    macros,
    tracesUsed: successful.length,
    candidatesFound: candidates.length,
  };
}
