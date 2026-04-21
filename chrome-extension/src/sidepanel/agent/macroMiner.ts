import Anthropic from '@anthropic-ai/sdk';
import { getTracesSinceLastMine, setLastMineTime } from './traceLogger';
import type { TaskTrace, TraceEvent, SemanticTarget } from './traceLogger';

export interface MacroStepSemantic {
  role: string;
  name: string;
  description: string;
}

export interface MacroStep {
  tool: string;
  action?: string;
  inputTemplate: Record<string, unknown>;
  semanticTarget?: MacroStepSemantic;
}

export interface MacroParameter {
  name: string;
  type: string;
  description: string;
}

export interface Macro {
  id: string;
  name: string;
  domain: string;
  description: string;
  trigger: string;
  parameters: MacroParameter[];
  steps: MacroStep[];
  sourceTraceCount: number;
  confidence: number;
  createdAt: number;
  updatedAt: number;
}

const MACRO_STORAGE_KEY = 'macro_registry';
const MIN_TRACES_FOR_MINING = 5;
const MINING_MODEL = 'claude-haiku-4-5-20251001';

let miningInProgress = false;

export async function maybeRunMiningPass(domain: string, apiKey: string): Promise<void> {
  if (miningInProgress) return;

  const traces = await getTracesSinceLastMine(domain);
  if (traces.length < MIN_TRACES_FOR_MINING) return;

  miningInProgress = true;
  try {
    console.log(`[MacroMining] Starting mining pass for ${domain} with ${traces.length} traces`);
    const newMacros = await mineMacros(domain, traces, apiKey);

    if (newMacros.length > 0) {
      const existing = await loadMacros();
      const merged = mergeMacros(existing, newMacros);
      await saveMacros(merged);
      console.log(`[MacroMining] Discovered ${newMacros.length} macro(s) for ${domain}:`,
        newMacros.map((m) => m.name));
    } else {
      console.log(`[MacroMining] No macros found for ${domain}`);
    }

    await setLastMineTime(domain);
  } finally {
    miningInProgress = false;
  }
}

async function mineMacros(
  domain: string,
  traces: TaskTrace[],
  apiKey: string,
): Promise<Macro[]> {
  const serialized = serializeTraces(traces);
  const prompt = buildMiningPrompt(domain, traces.length, serialized);

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const response = await client.messages.create({
    model: MINING_MODEL,
    max_tokens: 2048,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = (response.content as Array<{ type: string; text?: string }>)
    .filter((b) => b.type === 'text')
    .map((b) => b.text || '')
    .join('');

  return parseMiningResponse(text, domain);
}

function serializeTraces(traces: TaskTrace[]): string {
  const parts: string[] = [];

  for (let i = 0; i < traces.length; i++) {
    const trace = traces[i];
    const lines: string[] = [];
    lines.push(`--- Trace ${i + 1}: goal="${trace.goal}" (${trace.taskSuccess ? 'succeeded' : 'failed'}) ---`);

    for (let j = 0; j < trace.events.length; j++) {
      const ev = trace.events[j];
      lines.push(formatEvent(j + 1, ev));
    }

    parts.push(lines.join('\n'));
  }

  return parts.join('\n\n');
}

function formatEvent(stepNum: number, ev: TraceEvent): string {
  const toolLabel = ev.action ? `${ev.tool}(${ev.action})` : ev.tool;

  const relevantInputs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ev.input)) {
    if (k === 'tabId') continue;
    if (ev.tool === 'computer' && k === 'action') continue;
    if (typeof v === 'string' && v.length > 200) {
      relevantInputs[k] = v.slice(0, 200) + '...';
    } else {
      relevantInputs[k] = v;
    }
  }

  const inputStr = Object.keys(relevantInputs).length > 0
    ? ' ' + JSON.stringify(relevantInputs)
    : '';

  const semanticStr = ev.semanticTarget
    ? ` [element: ${ev.semanticTarget.role} "${ev.semanticTarget.name}"]`
    : '';

  const urlNote = ev.url ? ` @ ${ev.url}` : '';

  return `  ${stepNum}. ${toolLabel}${inputStr}${semanticStr}${urlNote}`;
}

function buildMiningPrompt(domain: string, traceCount: number, serialized: string): string {
  return `You are analyzing browser agent traces to discover reusable macros. Each trace is a sequence of tool calls the agent made to complete a task on ${domain}.

Traces include semantic element info like [element: textbox "Search Amazon.com"] showing the ARIA role and accessible name of interacted elements. Use this to build robust macros.

Here are ${traceCount} recent task traces:

${serialized}

Your job: identify repeated workflows — sequences of actions that accomplish the same sub-goal across 3 or more traces. These should be meaningful, reusable workflows (like "search for a product", "log in", "add to cart") — NOT incidental repetition (like taking screenshots or reading the page).

For each macro found, return a JSON array. Each macro object must have:
- "name": short snake_case name (e.g., "search_product", "add_to_cart")
- "description": one-sentence description of what this workflow does
- "trigger": when should the agent use this macro instead of manual steps
- "parameters": array of { "name": string, "type": "string"|"number", "description": string } for the parts that VARY across traces
- "steps": array of step objects. Each step has:
  - "tool": string (exact tool name from traces)
  - "action": string or null (for computer tool)
  - "inputTemplate": object with variable parts as "{{param_name}}" placeholders. Include tabId as "{{tabId}}".
  - "semanticTarget": object with { "role": string, "name": string, "description": string } — the ARIA role and accessible name of the target element. Use the [element: ...] annotations from traces. The "name" can use wildcards like "Search*" for partial matches. The "description" should be a natural language fallback like "the main search input field".
- "confidence": number 0-1, how confident this is a real reusable pattern

Rules:
- Only return macros with confidence >= 0.7
- Only return macros that appear in at least 3 traces
- Keep macros short (3-8 steps). If a longer workflow exists, break it into smaller composable macros.
- The "steps" must use the exact tool names from the traces (computer, navigate, form_input, read_page, etc.)
- For computer tool steps, always include the "action" field
- EVERY step that targets an element MUST have a "semanticTarget". Steps like navigate, computer(key), computer(scroll), computer(type), computer(wait) that don't target a specific element can omit it.
- Constant values (URLs, key names) should be hardcoded in inputTemplate. Variable values (search queries, product names) should use {{param}} placeholders.
- Do NOT include coordinate values in inputTemplate — they are ephemeral. The executor will resolve elements via semanticTarget.
- Do NOT include ref values (like ref_42) in inputTemplate — they are ephemeral. The executor resolves refs at runtime.
- If no meaningful macros are found, return an empty array: []

Return ONLY the JSON array, no other text.`;
}

function parseMiningResponse(text: string, domain: string): Macro[] {
  let jsonStr = text.trim();

  const fenceMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  const bracketStart = jsonStr.indexOf('[');
  const bracketEnd = jsonStr.lastIndexOf(']');
  if (bracketStart !== -1 && bracketEnd > bracketStart) {
    jsonStr = jsonStr.slice(bracketStart, bracketEnd + 1);
  }

  let parsed: unknown[];
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    console.error('[MacroMining] Failed to parse LLM response:', e, '\nRaw:', text);
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const macros: Macro[] = [];
  const now = Date.now();

  for (const raw of parsed) {
    const r = raw as Record<string, unknown>;
    if (!r.name || !r.steps || !Array.isArray(r.steps)) continue;
    if (typeof r.confidence === 'number' && r.confidence < 0.7) continue;

    const steps: MacroStep[] = (r.steps as Array<Record<string, unknown>>).map((s) => {
      const step: MacroStep = {
        tool: s.tool as string,
        action: (s.action as string) || undefined,
        inputTemplate: (s.inputTemplate as Record<string, unknown>) || {},
      };
      if (s.semanticTarget && typeof s.semanticTarget === 'object') {
        const st = s.semanticTarget as Record<string, unknown>;
        if (st.role && st.name) {
          step.semanticTarget = {
            role: st.role as string,
            name: st.name as string,
            description: (st.description as string) || '',
          };
        }
      }
      return step;
    });

    const parameters: MacroParameter[] = Array.isArray(r.parameters)
      ? (r.parameters as Array<Record<string, unknown>>).map((p) => ({
          name: p.name as string,
          type: (p.type as string) || 'string',
          description: (p.description as string) || '',
        }))
      : [];

    const name = (r.name as string).replace(/[^a-z0-9_]/g, '_');

    macros.push({
      id: `macro_${domain.replace(/\./g, '_')}_${name}`,
      name,
      domain,
      description: (r.description as string) || `Macro: ${name}`,
      trigger: (r.trigger as string) || '',
      parameters,
      steps,
      sourceTraceCount: 0,
      confidence: (r.confidence as number) || 0.7,
      createdAt: now,
      updatedAt: now,
    });
  }

  return macros;
}

function mergeMacros(existing: Macro[], newMacros: Macro[]): Macro[] {
  const byId = new Map(existing.map((m) => [m.id, m]));

  for (const macro of newMacros) {
    const prev = byId.get(macro.id);
    if (prev) {
      byId.set(macro.id, {
        ...macro,
        sourceTraceCount: prev.sourceTraceCount + 1,
        createdAt: prev.createdAt,
      });
    } else {
      macro.sourceTraceCount = 1;
      byId.set(macro.id, macro);
    }
  }

  return Array.from(byId.values());
}

export async function loadMacros(): Promise<Macro[]> {
  return new Promise((resolve) => {
    chrome.storage.local.get([MACRO_STORAGE_KEY], (result) => {
      resolve((result[MACRO_STORAGE_KEY] as Macro[]) || []);
    });
  });
}

export async function saveMacros(macros: Macro[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [MACRO_STORAGE_KEY]: macros }, resolve);
  });
}

export async function getMacrosForDomain(domain: string): Promise<Macro[]> {
  const all = await loadMacros();
  return all.filter((m) => domain.includes(m.domain) || m.domain.includes(domain));
}
