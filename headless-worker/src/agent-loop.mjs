import Anthropic from '@anthropic-ai/sdk';
import { buildQuickAccessPrompt } from './quick-access-links.mjs';

const MAX_TOKENS = Number(process.env.OTTOAUTH_MAX_TOKENS || 4096);
const DEFAULT_MODEL = process.env.OTTOAUTH_MODEL?.trim() || 'claude-sonnet-4-5-20250929';
const FIND_MODEL = process.env.OTTOAUTH_FIND_MODEL?.trim() || 'claude-haiku-4-5-20251001';
const BETAS = ['computer-use-2025-01-24'];

function buildSystemPrompt(tabs) {
  const tabLines = tabs.length > 0
    ? tabs.map((tab) => `- Tab ${tab.id}: "${tab.title}" (${tab.url})${tab.active ? ' [ACTIVE]' : ''}`).join('\n')
    : '- No tabs are open.';
  const quickAccessPrompt = buildQuickAccessPrompt();

  return `You are OttoAuth's headless browser fulfillment agent running through Playwright on a claimed worker device.

Current tabs:
${tabLines}

${quickAccessPrompt}

Guidelines:
- Always start by taking a screenshot with the computer tool.
- Prefer direct navigation with the navigate tool over hunting for links.
- Use read_page to get refs for interactive elements.
- Prefer form_input over click+type for normal form fields when possible.
- Use find when the page is large and you need a specific element quickly.
- If a task does not specify a platform, consult the supported-platform table first and prefer Fantuan or Grubhub for food orders, and Uber Central for Uber rides.
- If the task mentions a business from the quick-access table, go directly to the mapped URL instead of searching from a generic homepage.
- On food-ordering item modals, choose the requested add-ons first. If the site requires extra options that the user did not specify, choose the default or most standard option and keep moving.
- If an "Add to Order", "Add to Cart", or equivalent checkout-progress button is enabled and the visible configuration matches the request well enough, click it instead of stalling to re-check the same modal.
- For pickup food orders, prefer the merchant's default pickup flow unless the task explicitly asks for delivery.
- Set tip to 0 unless the user explicitly asks for a different tip.
- Do not add donations, round-ups, protection plans, or upsells unless the user explicitly asks for them.
- If a site forces a non-zero tip or extra charge with no zero/default-free option, choose the lowest available option and mention it clearly in the final summary.
- After a purchase succeeds, stay on the confirmation or receipt screen long enough to read any visible order number, confirmation code, pickup code, tracking number, tracking URL, carrier, ready time, delivery ETA, or receipt details before you finish.
- If the receipt screen omits the operational info the human needs, switch to the order-status or history view before finishing.
- For Snackpass specifically, the Order tab is often more useful than the Receipt tab for pickup details. Check it before you stop.
- The ACTIVE tab is the one you should drive with the computer tool.
- After scrolling or clicking, request another screenshot if you need confirmation.
- Be decisive and keep going until the task is fully complete or clearly blocked.
- The task goal already includes the required completion format. Follow it exactly.
`;
}

function extractJson(text) {
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1]);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // ignore parse failure
    }
  }

  const directObject = text.match(/\{[\s\S]*\}/);
  if (directObject) {
    try {
      const parsed = JSON.parse(directObject[0]);
      if (parsed && typeof parsed === 'object') return parsed;
    } catch {
      // ignore parse failure
    }
  }
  return null;
}

function compactMessages(messages) {
  let imageCount = 0;
  const recentCutoff = Math.max(0, messages.length - 2);
  for (let msgIndex = messages.length - 1; msgIndex >= 0; msgIndex -= 1) {
    const message = messages[msgIndex];
    const content = Array.isArray(message.content) ? message.content : null;
    if (!content) continue;
    for (let index = content.length - 1; index >= 0; index -= 1) {
      const block = content[index];
      if (block?.type === 'image') {
        imageCount += 1;
        if (imageCount > 1) {
          content[index] = { type: 'text', text: '[previous screenshot removed]' };
        }
        continue;
      }
      if (block?.type === 'tool_result' && Array.isArray(block.content)) {
        for (let innerIndex = block.content.length - 1; innerIndex >= 0; innerIndex -= 1) {
          const entry = block.content[innerIndex];
          if (entry?.type === 'image') {
            imageCount += 1;
            if (imageCount > 1) {
              block.content[innerIndex] = { type: 'text', text: '[previous screenshot removed]' };
            }
          }
          if (entry?.type === 'text' && msgIndex < recentCutoff && entry.text?.length > 3000) {
            entry.text = `${entry.text.slice(0, 3000)}\n[truncated]`;
          }
        }
        continue;
      }
      if (block?.type === 'text' && msgIndex < recentCutoff && block.text?.length > 3000) {
        block.text = `${block.text.slice(0, 3000)}\n[truncated]`;
      }
    }
  }
}

function collectTextFromContent(content) {
  return (content || [])
    .filter((block) => block?.type === 'text')
    .map((block) => block.text || '')
    .join('\n')
    .trim();
}

export async function runAgentLoop({
  runtime,
  prompt,
  apiKey,
  model = DEFAULT_MODEL,
  onEvent,
  onModelUsage,
}) {
  const client = new Anthropic({ apiKey });
  const selectedModel =
    typeof model === 'string' && model.trim()
      ? model.trim()
      : DEFAULT_MODEL;
  const messages = [
    { role: 'user', content: prompt },
  ];

  const modelUsages = [];
  const maxLoops = 50;

  for (let loop = 0; loop < maxLoops; loop += 1) {
    const tabs = await runtime.tabsContext();
    compactMessages(messages);
    onEvent?.('loop_started', { loop: loop + 1, tabCount: tabs.length });

    const response = await client.beta.messages.create({
      model: selectedModel,
      max_tokens: MAX_TOKENS,
      system: buildSystemPrompt(tabs),
      tools: runtime.getToolDefinitions(),
      betas: BETAS,
      messages,
    });

    if ((response.usage?.input_tokens || 0) > 0 || (response.usage?.output_tokens || 0) > 0) {
      const usage = {
        model: selectedModel,
        input_tokens: response.usage?.input_tokens || 0,
        output_tokens: response.usage?.output_tokens || 0,
        source: 'main_loop',
      };
      modelUsages.push(usage);
      onModelUsage?.(usage);
    }

    const assistantContent = Array.isArray(response.content) ? response.content : [];
    messages.push({
      role: 'assistant',
      content: assistantContent,
    });

    const toolUses = assistantContent.filter((block) => block?.type === 'tool_use');
    if (toolUses.length === 0) {
      const finalText = collectTextFromContent(assistantContent);
      const parsed = extractJson(finalText);
      onEvent?.('loop_completed', { loop: loop + 1, hasJsonResult: Boolean(parsed) });
      return {
        result: parsed || (finalText ? { summary: finalText.slice(0, 2000) } : null),
        messages,
        modelUsages,
      };
    }

    const toolResults = [];
    for (const toolUse of toolUses) {
      onEvent?.('tool_started', {
        tool: toolUse.name,
        toolUseId: toolUse.id,
      });
      const content = await runtime.executeTool(toolUse.name, toolUse.input || {}, {
        anthropicClient: {
          messages: {
            create: (...args) => client.messages.create(...args),
          },
        },
        findModel: FIND_MODEL,
        onModelUsage: (usage) => {
          modelUsages.push(usage);
          onModelUsage?.(usage);
        },
      });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content,
      });
      onEvent?.('tool_completed', {
        tool: toolUse.name,
        toolUseId: toolUse.id,
      });
    }

    messages.push({
      role: 'user',
      content: toolResults,
    });
  }

  throw new Error(`Agent loop exceeded ${maxLoops} turns without completing.`);
}
