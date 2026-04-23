import type { ToolResultContent } from '../../shared/types';
import { useStore } from '../store';
import { loadMacros, saveMacros, reportMacroOutcome, type Macro, type MacroStep } from './macroMiner';
import { setMacroReplayFlag } from './traceLogger';
import { resolveSemanticTarget, type ResolvedElement } from './semanticResolver';

const DELAY_AFTER_NAVIGATE_MS = 2000;
const DELAY_BETWEEN_STEPS_MS = 300;
const SEMANTIC_RESOLVE_RETRIES = 3;
const SEMANTIC_RETRY_DELAY_MS = 1000;

export async function executeMacro(
  toolName: string,
  input: Record<string, unknown>,
  apiKey: string,
): Promise<ToolResultContent[]> {
  const macroName = toolName.replace(/^macro_/, '');
  const macros = await loadMacros();
  const macro = macros.find((m) => m.name === macroName || m.id === toolName || m.id === macroName);

  if (!macro) {
    return [{ type: 'text', text: `Macro "${macroName}" not found. It may have been removed. Use primitive tools instead.` }];
  }

  const store = useStore.getState();
  const tabId = (input.tabId as number) || store.activeTabId;
  if (!tabId) {
    return [{ type: 'text', text: 'No active tab. Open a tab first.' }];
  }

  console.log(`[MacroExecutor] ▶ Running macro "${macro.name}" (${macro.steps.length} steps) with params:`, input);

  const results: string[] = [];
  let lastScreenshot: string | null = null;
  let macroUpdated = false;

  setMacroReplayFlag(true);
  try {
    for (let i = 0; i < macro.steps.length; i++) {
      const step = macro.steps[i];
      const stepLabel = step.action ? `${step.tool}(${step.action})` : step.tool;
      console.log(`[MacroExecutor]   Step ${i + 1}/${macro.steps.length}: ${stepLabel}`);

      const resolvedInput = resolveInputTemplate(step.inputTemplate, input, tabId);

      if (step.action) {
        resolvedInput.action = step.action;
      }

      if (step.semanticTarget) {
        const resolved = await resolveWithRetry(tabId, step.semanticTarget, apiKey);

        if (!resolved) {
          console.error(`[MacroExecutor]   ✗ Element not found: ${step.semanticTarget.role} "${step.semanticTarget.name}"`);
          results.push(`Step ${i + 1}/${macro.steps.length}: ${stepLabel} — ELEMENT NOT FOUND`);
          reportMacroOutcome(macro.id, false).catch(() => {});

          const content: ToolResultContent[] = [
            { type: 'text', text: `Macro "${macro.name}" failed at step ${i + 1}/${macro.steps.length}: Could not find element ${step.semanticTarget.role} "${step.semanticTarget.name}" (${step.semanticTarget.description}).\n\nCompleted steps:\n${results.join('\n')}\n\nFalling back to primitive tools. Take a screenshot and continue manually.` },
          ];
          if (lastScreenshot) {
            content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: lastScreenshot } });
          }
          return content;
        }

        console.log(`[MacroExecutor]   ✓ Resolved ${step.semanticTarget.role} "${step.semanticTarget.name}" → ${resolved.ref} (${resolved.tier})`);
        applyResolvedRef(resolvedInput, step, resolved.ref);

        if (resolved.tier === 'haiku') {
          await selfHealMacro(macro, i, resolved.ref, tabId);
          macroUpdated = true;
        }
      }

      console.log(`[MacroExecutor]   Executing: ${step.tool}`, resolvedInput);

      const tierNote = step.semanticTarget ? ` [resolved]` : '';
      results.push(`Step ${i + 1}/${macro.steps.length}: ${stepLabel}${tierNote}`);

      try {
        const stepResult = await executeStepDirectly(step.tool, resolvedInput);

        const screenshot = extractScreenshot(stepResult);
        if (screenshot) lastScreenshot = screenshot;

        const textParts = stepResult
          .filter((r): r is { type: 'text'; text: string } => r.type === 'text')
          .map((r) => r.text);

        if (textParts.some((t) => t.startsWith('Error:') || t.startsWith('Tool error:') || t.includes('Unknown computer action'))) {
          const errorText = textParts.join('\n');
          console.error(`[MacroExecutor]   ✗ Step failed: ${errorText}`);
          results.push(`  FAILED: ${errorText}`);
          reportMacroOutcome(macro.id, false).catch(() => {});

          const content: ToolResultContent[] = [
            { type: 'text', text: `Macro "${macro.name}" failed at step ${i + 1}/${macro.steps.length}: ${errorText}\n\nCompleted steps:\n${results.join('\n')}\n\nFalling back to primitive tools. Take a screenshot and continue manually.` },
          ];
          if (lastScreenshot) {
            content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: lastScreenshot } });
          }
          return content;
        }

        console.log(`[MacroExecutor]   ✓ Step ${i + 1} complete`);
      } catch (e) {
        const errMsg = e instanceof Error ? e.message : String(e);
        console.error(`[MacroExecutor]   ✗ Step threw: ${errMsg}`);
        reportMacroOutcome(macro.id, false).catch(() => {});

        const content: ToolResultContent[] = [
          { type: 'text', text: `Macro "${macro.name}" failed at step ${i + 1}/${macro.steps.length}: ${errMsg}\n\nCompleted steps:\n${results.join('\n')}\n\nFalling back to primitive tools.` },
        ];
        if (lastScreenshot) {
          content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: lastScreenshot } });
        }
        return content;
      }

      if (i < macro.steps.length - 1) {
        const waitMs = step.tool === 'navigate' ? DELAY_AFTER_NAVIGATE_MS : DELAY_BETWEEN_STEPS_MS;
        await delay(waitMs);
      }
    }

    results.push('All steps completed successfully.');
    console.log(`[MacroExecutor] ✓ Macro "${macro.name}" completed all ${macro.steps.length} steps`);
    reportMacroOutcome(macro.id, true).catch(() => {});

    if (!lastScreenshot) {
      try {
        const screenshotResult = await executeStepDirectly('computer', { action: 'screenshot', tabId });
        const ss = extractScreenshot(screenshotResult);
        if (ss) lastScreenshot = ss;
      } catch { /* best effort */ }
    }

    if (macroUpdated) {
      await persistMacroUpdate(macro);
    }

    const content: ToolResultContent[] = [
      { type: 'text', text: `Macro "${macro.name}" completed successfully.\n\n${results.join('\n')}` },
    ];
    if (lastScreenshot) {
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: lastScreenshot } });
    }
    return content;
  } finally {
    setMacroReplayFlag(false);
  }
}

async function resolveWithRetry(
  tabId: number,
  target: { role: string; name: string; description: string },
  apiKey: string,
): Promise<ResolvedElement | null> {
  for (let attempt = 0; attempt < SEMANTIC_RESOLVE_RETRIES; attempt++) {
    const resolved = await resolveSemanticTarget(tabId, target, apiKey);
    if (resolved) return resolved;

    if (attempt < SEMANTIC_RESOLVE_RETRIES - 1) {
      console.log(`[MacroExecutor]   Retry ${attempt + 1}/${SEMANTIC_RESOLVE_RETRIES} for ${target.role} "${target.name}"...`);
      await delay(SEMANTIC_RETRY_DELAY_MS);
    }
  }
  return null;
}

function applyResolvedRef(
  resolvedInput: Record<string, unknown>,
  step: MacroStep,
  ref: string,
): void {
  if (step.tool === 'form_input') {
    resolvedInput.ref = ref;
  } else if (step.tool === 'computer') {
    const action = step.action;
    if (action === 'left_click' || action === 'right_click' || action === 'double_click' ||
        action === 'triple_click' || action === 'hover' || action === 'scroll_to') {
      resolvedInput.ref = ref;
      delete resolvedInput.coordinate;
    }
  }
}

async function selfHealMacro(
  macro: Macro,
  stepIndex: number,
  resolvedRef: string,
  tabId: number,
): Promise<void> {
  try {
    const { resolveRefToSemantic } = await import('./toolExecutor');
    const semantic = await resolveRefToSemantic(tabId, resolvedRef);
    if (semantic && macro.steps[stepIndex].semanticTarget) {
      const oldName = macro.steps[stepIndex].semanticTarget!.name;
      macro.steps[stepIndex].semanticTarget!.name = semantic.name;
      macro.updatedAt = Date.now();
      console.log(`[MacroExecutor] Self-healed step ${stepIndex + 1}: "${oldName}" → "${semantic.name}"`);
    }
  } catch (e) {
    console.warn('[MacroExecutor] Self-heal failed:', e);
  }
}

async function persistMacroUpdate(macro: Macro): Promise<void> {
  try {
    const all = await loadMacros();
    const idx = all.findIndex((m) => m.id === macro.id);
    if (idx >= 0) {
      all[idx] = macro;
      await saveMacros(all);
      console.log(`[MacroExecutor] Persisted self-healed macro "${macro.name}"`);
    }
  } catch (e) {
    console.warn('[MacroExecutor] Failed to persist macro update:', e);
  }
}

function resolveInputTemplate(
  template: Record<string, unknown>,
  params: Record<string, unknown>,
  tabId: number,
): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(template)) {
    if (typeof val === 'string' && val.startsWith('{{') && val.endsWith('}}')) {
      const paramName = val.slice(2, -2);
      if (paramName === 'tabId') {
        resolved[key] = tabId;
      } else {
        resolved[key] = params[paramName] ?? val;
      }
    } else if (typeof val === 'string' && val.includes('{{')) {
      let result = val;
      for (const [pName, pVal] of Object.entries(params)) {
        result = result.replace(new RegExp(`\\{\\{${pName}\\}\\}`, 'g'), String(pVal));
      }
      result = result.replace(/\{\{tabId\}\}/g, String(tabId));
      resolved[key] = result;
    } else {
      resolved[key] = val;
    }
  }

  if (!('tabId' in resolved)) {
    resolved.tabId = tabId;
  }

  return resolved;
}

async function executeStepDirectly(
  tool: string,
  input: Record<string, unknown>,
): Promise<ToolResultContent[]> {
  const { executeTool: execTool } = await import('./toolExecutor');
  return execTool(tool, input, '');
}

function extractScreenshot(result: ToolResultContent[]): string | null {
  for (const item of result) {
    if (item.type === 'image' && 'source' in item) {
      return (item as { type: 'image'; source: { data: string } }).source.data;
    }
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
