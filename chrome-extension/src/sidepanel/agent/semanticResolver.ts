import Anthropic from '@anthropic-ai/sdk';
import { generateAccessibilityTree } from '../../content/accessibilityTree';
import type { MacroStepSemantic } from './macroMiner';

const HAIKU_MODEL = 'claude-haiku-4-5-20251001';

export interface ResolvedElement {
  ref: string;
  tier: 'exact' | 'fuzzy' | 'haiku';
}

/**
 * Tier 1: Match a semantic target against the live accessibility tree.
 * Parses the a11y tree text to find an element with matching role + name.
 * Returns the ref if found.
 */
export async function resolveByAccessibilityTree(
  tabId: number,
  target: MacroStepSemantic,
): Promise<ResolvedElement | null> {
  let tree: string;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: generateAccessibilityTree,
      args: ['interactive', 12, 30000, null],
    });
    tree = results?.[0]?.result as string;
  } catch {
    return null;
  }

  if (!tree) return null;

  const match = findElementInTree(tree, target);
  return match;
}

function findElementInTree(
  tree: string,
  target: MacroStepSemantic,
): ResolvedElement | null {
  const lines = tree.split('\n');
  const targetRole = target.role.toLowerCase();
  const targetName = target.name.toLowerCase();

  let bestMatch: { ref: string; score: number } | null = null;

  for (const line of lines) {
    const parsed = parseTreeLine(line);
    if (!parsed) continue;

    const { role, name, ref } = parsed;
    const lineRole = role.toLowerCase();
    const lineName = name.toLowerCase();

    if (lineRole !== targetRole && !isRoleAlias(lineRole, targetRole)) continue;

    if (lineName === targetName) {
      return { ref, tier: 'exact' };
    }

    const score = fuzzyNameScore(lineName, targetName, target.name);
    if (score > 0.5 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { ref, score };
    }
  }

  if (bestMatch) {
    return { ref: bestMatch.ref, tier: 'fuzzy' };
  }

  return null;
}

function parseTreeLine(line: string): { role: string; name: string; ref: string } | null {
  const refMatch = line.match(/\[(ref_\d+)\]/);
  if (!refMatch) return null;

  const ref = refMatch[1];
  const trimmed = line.trim();

  const roleMatch = trimmed.match(/^(\w+)/);
  if (!roleMatch) return null;
  const role = roleMatch[1];

  const nameMatch = trimmed.match(/"([^"]*)"/);
  const name = nameMatch ? nameMatch[1] : '';

  return { role, name, ref };
}

function isRoleAlias(a: string, b: string): boolean {
  const aliases: Record<string, string[]> = {
    textbox: ['searchbox', 'input', 'textarea'],
    searchbox: ['textbox', 'input'],
    button: ['submit', 'link'],
    link: ['button'],
    combobox: ['select', 'listbox'],
  };
  return aliases[a]?.includes(b) || aliases[b]?.includes(a) || false;
}

function fuzzyNameScore(actual: string, target: string, rawTarget: string): number {
  if (!actual || !target) return 0;

  if (actual.includes(target) || target.includes(actual)) return 0.9;

  if (rawTarget.includes('*')) {
    const pattern = rawTarget.replace(/\*/g, '.*');
    try {
      if (new RegExp(pattern, 'i').test(actual)) return 0.85;
    } catch { /* invalid regex */ }
  }

  const targetWords = target.split(/\s+/);
  const matchedWords = targetWords.filter((w) => actual.includes(w));
  if (targetWords.length > 0 && matchedWords.length > 0) {
    return 0.6 * (matchedWords.length / targetWords.length);
  }

  return 0;
}

/**
 * Tier 2: Use Haiku to find the element when tree matching fails.
 * Sends the accessibility tree and a description to Haiku,
 * which returns the ref of the best-matching element.
 */
export async function resolveByHaiku(
  tabId: number,
  target: MacroStepSemantic,
  apiKey: string,
): Promise<ResolvedElement | null> {
  if (!apiKey) return null;

  let tree: string;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      func: generateAccessibilityTree,
      args: ['all', 15, 50000, null],
    });
    tree = results?.[0]?.result as string;
  } catch {
    return null;
  }

  if (!tree) return null;

  const prompt = `You are helping locate a specific element on a web page. Given the accessibility tree below and a target element description, return the ref ID of the matching element.

Accessibility tree:
${tree}

Target element:
- Role: ${target.role}
- Name/Label: "${target.name}"
- Description: ${target.description || 'N/A'}

Find the element that best matches this description. Return ONLY the ref ID (e.g., "ref_42") on a single line. If no matching element exists, return "NONE".`;

  try {
    const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
    const response = await client.messages.create({
      model: HAIKU_MODEL,
      max_tokens: 50,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = (response.content as Array<{ type: string; text?: string }>)
      .filter((b) => b.type === 'text')
      .map((b) => b.text || '')
      .join('')
      .trim();

    const refMatch = text.match(/(ref_\d+)/);
    if (refMatch) {
      return { ref: refMatch[1], tier: 'haiku' };
    }
  } catch (e) {
    console.error('[SemanticResolver] Haiku resolution failed:', e);
  }

  return null;
}

/**
 * Combined resolution: Tier 1 → Tier 2 → null.
 * Returns the resolved ref + which tier succeeded.
 */
export async function resolveSemanticTarget(
  tabId: number,
  target: MacroStepSemantic,
  apiKey: string,
): Promise<ResolvedElement | null> {
  const tier1 = await resolveByAccessibilityTree(tabId, target);
  if (tier1) {
    console.log(`[SemanticResolver] Tier 1 (${tier1.tier}): found ${tier1.ref} for ${target.role} "${target.name}"`);
    return tier1;
  }

  console.log(`[SemanticResolver] Tier 1 miss for ${target.role} "${target.name}", trying Haiku...`);
  const tier2 = await resolveByHaiku(tabId, target, apiKey);
  if (tier2) {
    console.log(`[SemanticResolver] Tier 2 (haiku): found ${tier2.ref} for ${target.role} "${target.name}"`);
    return tier2;
  }

  console.log(`[SemanticResolver] All tiers failed for ${target.role} "${target.name}"`);
  return null;
}
