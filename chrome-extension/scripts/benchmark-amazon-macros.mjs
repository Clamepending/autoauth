#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv) {
  const args = { traceRoot: process.env.OTTOAUTH_TRACE_ROOT || '' };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--trace-root' && argv[index + 1]) {
      args.traceRoot = argv[index + 1];
      index += 1;
    }
  }
  return args;
}

function resolveTraceRoot(input) {
  const candidates = [
    input,
    path.resolve(__dirname, '../../../../toolcalltokenization/data/ottoauth'),
    path.resolve(process.cwd(), '../../../../toolcalltokenization/data/ottoauth'),
    path.resolve(process.cwd(), '../toolcalltokenization/data/ottoauth'),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    'Could not find the ottoauth trace root. Pass --trace-root /absolute/path/to/toolcalltokenization/data/ottoauth',
  );
}

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function normalizeToolUse(block) {
  const input = block.input || {};
  if (block.name === 'computer') {
    return {
      kind: `computer:${String(input.action || '')}`,
      name: block.name,
      input,
    };
  }
  return {
    kind: block.name,
    name: block.name,
    input,
  };
}

function loadAmazonTraces(traceRoot) {
  const files = walk(traceRoot).filter((entry) => entry.endsWith('/trace.json') || entry.endsWith(path.sep + 'trace.json'));
  return files
    .filter((tracePath) => tracePath.includes(`${path.sep}amazon.com${path.sep}`))
    .map((tracePath) => {
      const trace = readJson(tracePath);
      const toolUses = [];
      for (const message of trace.messages || []) {
        for (const block of message.blocks || []) {
          if (block.type === 'tool_use') {
            toolUses.push(normalizeToolUse(block));
          }
        }
      }
      return {
        tracePath,
        directoryName: path.basename(path.dirname(tracePath)),
        goal: String(trace.goal || ''),
        status: String(trace.status || ''),
        toolUses,
        toolUseCount: toolUses.length,
        messageCount: Array.isArray(trace.messages) ? trace.messages.length : 0,
      };
    })
    .sort((left, right) => left.directoryName.localeCompare(right.directoryName));
}

function textContains(value, patterns) {
  const text = String(value || '').toLowerCase();
  return patterns.some((pattern) => text.includes(pattern));
}

function isReadPage(step) {
  return step?.kind === 'read_page';
}

function isScreenshot(step) {
  return step?.kind === 'computer:screenshot';
}

function isWait(step) {
  return step?.kind === 'computer:wait';
}

function isClick(step) {
  return step?.kind === 'computer:left_click';
}

function isNavigate(step) {
  return step?.kind === 'navigate';
}

function isKeySubmit(step) {
  return step?.kind === 'computer:key'
    && textContains(step.input.text, ['return', 'enter']);
}

function isSearchFind(step) {
  return step?.kind === 'find'
    && textContains(step.input.query, ['search']);
}

function isSearchSubmitFind(step) {
  return step?.kind === 'find'
    && textContains(step.input.query, ['submit', 'search button', 'search submit']);
}

function isResultFind(step) {
  return step?.kind === 'find'
    && textContains(step.input.query, ['first product', 'product result', 'product link', 'plausible', 'search result']);
}

function isAddToCartFind(step) {
  return step?.kind === 'find'
    && textContains(step.input.query, ['add to cart']);
}

function isCheckoutFind(step) {
  return step?.kind === 'find'
    && textContains(step.input.query, ['checkout']);
}

function isCartNavigate(step) {
  return isNavigate(step)
    && textContains(step.input.url, ['/gp/cart/view', '/cart']);
}

function isSearchResultsJs(step) {
  if (step?.kind !== 'javascript_tool') return false;
  return textContains(step.input.text, [
    's-search-result',
    '.s-result-item h2 a',
    'h2 a[href*="/dp/"]',
    'queryselectorall(\'a[href*="/dp/"]',
  ]);
}

function isProductPageJs(step) {
  if (step?.kind !== 'javascript_tool') return false;
  return textContains(step.input.text, ['#producttitle', 'producttitle']);
}

function matchSearchQuery(steps, index) {
  let cursor = index;
  if (isReadPage(steps[cursor])) cursor += 1;
  if (!isSearchFind(steps[cursor])) return null;
  cursor += 1;
  if (steps[cursor]?.kind !== 'form_input') return null;
  cursor += 1;

  if (isKeySubmit(steps[cursor])) {
    cursor += 1;
  } else {
    if (!isSearchSubmitFind(steps[cursor])) return null;
    cursor += 1;
    if (isScreenshot(steps[cursor])) cursor += 1;
    if (!isClick(steps[cursor])) return null;
    cursor += 1;
  }

  if (isWait(steps[cursor])) cursor += 1;
  return {
    macro: 'amazon_search_query',
    length: cursor - index,
  };
}

function matchOpenFirstResult(steps, index) {
  let cursor = index;
  if (isReadPage(steps[cursor])) cursor += 1;
  if (!isResultFind(steps[cursor])) return null;
  cursor += 1;
  while (isReadPage(steps[cursor]) || isScreenshot(steps[cursor])) {
    cursor += 1;
  }
  if (!isClick(steps[cursor])) return null;
  cursor += 1;
  if (isWait(steps[cursor])) cursor += 1;
  return {
    macro: 'amazon_open_first_result',
    length: cursor - index,
  };
}

function matchSearchAndOpenFirstResult(steps, index) {
  const searchMatch = matchSearchQuery(steps, index);
  if (!searchMatch) return null;

  let cursor = index + searchMatch.length;
  while (isReadPage(steps[cursor]) || isScreenshot(steps[cursor])) {
    cursor += 1;
  }
  if (!isResultFind(steps[cursor])) return null;
  cursor += 1;
  while (isReadPage(steps[cursor]) || isScreenshot(steps[cursor])) {
    cursor += 1;
  }
  if (!isClick(steps[cursor])) return null;
  cursor += 1;
  if (isWait(steps[cursor])) cursor += 1;
  return {
    macro: 'amazon_search_and_open_first_result',
    length: cursor - index,
  };
}

function matchAddToCart(steps, index) {
  let cursor = index;
  if (isReadPage(steps[cursor])) cursor += 1;
  if (!isAddToCartFind(steps[cursor])) return null;
  cursor += 1;
  if (!isClick(steps[cursor])) return null;
  cursor += 1;
  if (isWait(steps[cursor])) cursor += 1;
  return {
    macro: 'amazon_add_to_cart',
    length: cursor - index,
  };
}

function matchProceedToCheckout(steps, index) {
  let cursor = index;
  if (isReadPage(steps[cursor])) cursor += 1;
  if (!isCheckoutFind(steps[cursor])) return null;
  cursor += 1;
  if (!isClick(steps[cursor])) return null;
  cursor += 1;
  if (isWait(steps[cursor])) cursor += 1;
  return {
    macro: 'amazon_proceed_to_checkout',
    length: cursor - index,
  };
}

function matchOpenCart(steps, index) {
  if (!isCartNavigate(steps[index])) return null;
  return {
    macro: 'amazon_open_cart',
    length: 1,
  };
}

function matchDomOpenFirstResult(steps, index) {
  let cursor = index;
  let jsCount = 0;
  while (isSearchResultsJs(steps[cursor])) {
    jsCount += 1;
    cursor += 1;
  }
  if (jsCount < 2) return null;
  if (!isNavigate(steps[cursor])) return null;
  cursor += 1;
  return {
    macro: 'amazon_open_first_result_dom',
    length: cursor - index,
  };
}

function matchReadCurrentProductInfo(steps, index) {
  let cursor = index;
  let jsCount = 0;
  while (isProductPageJs(steps[cursor])) {
    jsCount += 1;
    cursor += 1;
  }
  if (jsCount < 2) return null;
  return {
    macro: 'amazon_read_current_product_info',
    length: cursor - index,
  };
}

function compressTrace(trace, matchers) {
  const matches = [];
  let cursor = 0;
  let compressedToolUses = 0;

  while (cursor < trace.toolUses.length) {
    let bestMatch = null;
    for (const matcher of matchers) {
      const candidate = matcher(trace.toolUses, cursor);
      if (!candidate || candidate.length <= 1) continue;
      if (!bestMatch || candidate.length > bestMatch.length) {
        bestMatch = candidate;
      }
    }

    if (bestMatch) {
      compressedToolUses += 1;
      matches.push({ ...bestMatch, index: cursor });
      cursor += bestMatch.length;
      continue;
    }

    compressedToolUses += 1;
    cursor += 1;
  }

  const savedToolUses = trace.toolUseCount - compressedToolUses;
  return {
    compressedToolUses,
    savedToolUses,
    estimatedCompressedMessages: Math.max(1, trace.messageCount - (savedToolUses * 2)),
    matches,
  };
}

function summarizeIndividualMacro(traces, matcher) {
  const perTrace = [];
  let matchedTraceCount = 0;
  let totalMatches = 0;
  let totalSavedToolUses = 0;

  for (const trace of traces) {
    let cursor = 0;
    let traceSaved = 0;
    const traceMatches = [];
    while (cursor < trace.toolUses.length) {
      const match = matcher(trace.toolUses, cursor);
      if (match && match.length > 1) {
        const saved = match.length - 1;
        traceSaved += saved;
        totalSavedToolUses += saved;
        totalMatches += 1;
        traceMatches.push({ index: cursor, length: match.length, saved });
        cursor += match.length;
      } else {
        cursor += 1;
      }
    }
    if (traceMatches.length > 0) {
      matchedTraceCount += 1;
      perTrace.push({
        trace: trace.directoryName,
        saved: traceSaved,
        matches: traceMatches.length,
      });
    }
  }

  return {
    matchedTraceCount,
    totalMatches,
    totalSavedToolUses,
    perTrace,
  };
}

function formatPct(value) {
  return `${value.toFixed(1)}%`;
}

function main() {
  const args = parseArgs(process.argv);
  const traceRoot = resolveTraceRoot(args.traceRoot);
  const traces = loadAmazonTraces(traceRoot);
  const completedTraces = traces.filter((trace) => trace.status === 'completed');
  const nonCompleted = traces.filter((trace) => trace.status !== 'completed');

  const baselineToolUses = completedTraces.reduce((sum, trace) => sum + trace.toolUseCount, 0);
  const baselineMessages = completedTraces.reduce((sum, trace) => sum + trace.messageCount, 0);

  const matcherMap = {
    amazon_search_query: matchSearchQuery,
    amazon_open_first_result: matchOpenFirstResult,
    amazon_search_and_open_first_result: matchSearchAndOpenFirstResult,
    amazon_add_to_cart: matchAddToCart,
    amazon_proceed_to_checkout: matchProceedToCheckout,
    amazon_open_cart: matchOpenCart,
    amazon_open_first_result_dom: matchDomOpenFirstResult,
    amazon_read_current_product_info: matchReadCurrentProductInfo,
  };

  const scenarios = [
    {
      name: 'none',
      description: 'No Amazon macros',
      matchers: [],
    },
    {
      name: 'search_only',
      description: 'Only amazon_search_query',
      matchers: [matchSearchQuery],
    },
    {
      name: 'current_builtins',
      description: 'Current Amazon built-ins: search, open first result, combined search+open, add to cart, checkout',
      matchers: [
        matchSearchAndOpenFirstResult,
        matchSearchQuery,
        matchOpenFirstResult,
        matchAddToCart,
        matchProceedToCheckout,
        matchOpenCart,
      ],
    },
    {
      name: 'current_plus_dom_extractors',
      description: 'Current built-ins plus DOM-heavy Amazon macros for first-result open and product info extraction',
      matchers: [
        matchSearchAndOpenFirstResult,
        matchDomOpenFirstResult,
        matchReadCurrentProductInfo,
        matchSearchQuery,
        matchOpenFirstResult,
        matchAddToCart,
        matchProceedToCheckout,
        matchOpenCart,
      ],
    },
  ];

  console.log(`Trace root: ${traceRoot}`);
  console.log(`Amazon traces: ${traces.length} total, ${completedTraces.length} completed, ${nonCompleted.length} skipped (non-completed).`);
  console.log(`Baseline on completed traces: ${baselineToolUses} tool uses, ${baselineMessages} messages, ${(
    baselineToolUses / Math.max(1, completedTraces.length)
  ).toFixed(1)} avg tool uses/trace.`);
  console.log('');

  console.log('Individual macro candidates on completed traces');
  for (const [name, matcher] of Object.entries(matcherMap)) {
    const summary = summarizeIndividualMacro(completedTraces, matcher);
    if (summary.totalSavedToolUses === 0) {
      console.log(`- ${name}: no repeat savings found in completed traces`);
      continue;
    }
    const avgMatched = summary.totalSavedToolUses / Math.max(1, summary.matchedTraceCount);
    const overallPct = (summary.totalSavedToolUses / Math.max(1, baselineToolUses)) * 100;
    console.log(
      `- ${name}: matched ${summary.matchedTraceCount}/${completedTraces.length} traces, ${summary.totalMatches} match(es), `
      + `saved ${summary.totalSavedToolUses} tool uses total (${formatPct(overallPct)} of baseline), `
      + `${avgMatched.toFixed(1)} avg saved on matched traces`,
    );
  }

  console.log('');
  console.log('Scenario totals on completed traces');
  for (const scenario of scenarios) {
    let compressedToolUses = 0;
    let compressedMessages = 0;
    const macroCounts = new Map();

    for (const trace of completedTraces) {
      const result = compressTrace(trace, scenario.matchers);
      compressedToolUses += result.compressedToolUses;
      compressedMessages += result.estimatedCompressedMessages;
      for (const match of result.matches) {
        macroCounts.set(match.macro, (macroCounts.get(match.macro) || 0) + 1);
      }
    }

    const savedToolUses = baselineToolUses - compressedToolUses;
    const savedMessages = baselineMessages - compressedMessages;
    const macroBreakdown = Array.from(macroCounts.entries())
      .sort((left, right) => right[1] - left[1])
      .map(([macro, count]) => `${macro} x${count}`)
      .join(', ') || 'none';

    console.log(`- ${scenario.name}: ${compressedToolUses} tool uses (${formatPct((savedToolUses / Math.max(1, baselineToolUses)) * 100)} saved), `
      + `${compressedMessages} est. messages (${formatPct((savedMessages / Math.max(1, baselineMessages)) * 100)} saved)`);
    console.log(`  ${scenario.description}`);
    console.log(`  Matches: ${macroBreakdown}`);
  }
}

main();
