import Anthropic from '@anthropic-ai/sdk';
import { MAX_TOKENS, MODEL, BETAS, MAX_TOOL_RESULT_CHARS_IN_HISTORY } from '../../shared/constants';
import { sendToBackground } from '../../shared/messaging';
import type { TabInfo } from '../../shared/types';
import { buildSystemPrompt, buildTabContextReminder } from './systemPrompt';
import { getToolDefinitions, refreshMacroTools } from './toolDefinitions';
import { executeTool } from './toolExecutor';
import { permissionManager } from './permissions';
import { useStore, type DisplayBlock } from '../store';
import { startTrace, finalizeTrace } from './traceLogger';
import { maybeRunMiningPass, loadMacros } from './macroMiner';

type ApiMessage = {
  role: 'user' | 'assistant';
  content: unknown;
};

async function callWithRetry(
  fn: () => Promise<Record<string, unknown>>,
  maxRetries = 5,
  onRetry?: (attempt: number, waitMs: number) => void,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const is429 = msg.includes('429') || msg.includes('rate_limit');
      const isOverloaded = msg.includes('529') || msg.includes('overloaded');
      if ((is429 || isOverloaded) && attempt < maxRetries) {
        const base = is429 ? 15000 : 5000;
        const waitMs = base * Math.pow(1.5, attempt) + Math.random() * 2000;
        onRetry?.(attempt + 1, Math.round(waitMs));
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw e;
    }
  }
  throw new Error('Max retries exceeded');
}

function compactMessages(messages: ApiMessage[]): void {
  let imageCount = 0;
  const isRecent = (idx: number) => idx >= messages.length - 2;

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const content = msg.content;
    if (!Array.isArray(content)) continue;

    for (let j = content.length - 1; j >= 0; j--) {
      const block = content[j] as Record<string, unknown>;

      if (block.type === 'image') {
        imageCount++;
        if (imageCount > 1) {
          content[j] = { type: 'text', text: '[previous screenshot removed]' };
        }
      }

      if (block.type === 'tool_result') {
        const inner = block.content;
        if (Array.isArray(inner)) {
          for (let k = inner.length - 1; k >= 0; k--) {
            const item = inner[k] as Record<string, unknown>;
            if (item.type === 'image') {
              imageCount++;
              if (imageCount > 1) {
                inner[k] = { type: 'text', text: '[previous screenshot removed]' };
              }
            }
            if (!isRecent(i) && item.type === 'text' && typeof item.text === 'string') {
              if (item.text.length > MAX_TOOL_RESULT_CHARS_IN_HISTORY) {
                item.text = item.text.slice(0, MAX_TOOL_RESULT_CHARS_IN_HISTORY) + '\n[truncated]';
              }
            }
          }
        }
      }

      if (!isRecent(i) && block.type === 'text' && typeof block.text === 'string') {
        if (block.text.length > MAX_TOOL_RESULT_CHARS_IN_HISTORY && msg.role === 'user') {
          block.text = (block.text as string).slice(0, MAX_TOOL_RESULT_CHARS_IN_HISTORY) + '\n[truncated]';
        }
      }
    }
  }
}

export async function runAgentLoop(userPrompt: string): Promise<void> {
  const store = useStore.getState();
  const apiKey = store.apiKey;
  if (!apiKey) throw new Error('API key not set');

  store.setIsRunning(true);
  store.setError(null);
  permissionManager.setMode(store.permissionMode);
  startTrace(userPrompt);

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  let taskSucceeded = false;
  try {
    const tabsResp = await sendToBackground({ type: 'tabs-context' });
    let tabs: TabInfo[] = (tabsResp.data as TabInfo[]) || [];

    const activeTab = tabs.find((t) => t.active);
    if (activeTab) {
      store.setActiveTabId(activeTab.id);

      const vpResp = await sendToBackground({ type: 'get-viewport-size', tabId: activeTab.id });
      if (vpResp.success) {
        const vp = vpResp.data as { width: number; height: number };
        store.setViewportSize(vp);
      }

      await sendToBackground({ type: 'enable-console-capture', tabId: activeTab.id });
      await sendToBackground({ type: 'enable-network-capture', tabId: activeTab.id });
    }

    await refreshMacroTools().catch(() => {});
    const currentMacros = await loadMacros().catch(() => []);
    const systemPrompt = buildSystemPrompt(tabs, currentMacros);

    let augmentedPrompt = userPrompt;
    if (currentMacros.length > 0) {
      const macroList = currentMacros
        .map((m) => `  - macro_${m.name}(${m.parameters.map((p) => p.name).join(', ')}): ${m.description}`)
        .join('\n');
      augmentedPrompt = `${userPrompt}\n\n[SYSTEM: You have ${currentMacros.length} macro(s) available. USE THEM instead of doing steps manually:\n${macroList}\nCall the matching macro as your FIRST action for any sub-task it covers.]`;
    }

    const messages: ApiMessage[] = [
      { role: 'user', content: augmentedPrompt },
    ];

    const msgId = `msg_${Date.now()}`;
    useStore.getState().addMessage({
      id: `user_${Date.now()}`,
      role: 'user',
      blocks: [{ type: 'text', text: userPrompt }],
      timestamp: Date.now(),
    });

    let loopCount = 0;
    const maxLoops = 50;

    while (loopCount < maxLoops) {
      loopCount++;

      if (!useStore.getState().isRunning) {
        break;
      }

      const vp = useStore.getState().viewportSize;
      const tools = getToolDefinitions(vp.width, vp.height);

      const assistantMsgId = `asst_${Date.now()}_${loopCount}`;
      useStore.getState().addMessage({
        id: assistantMsgId,
        role: 'assistant',
        blocks: [],
        timestamp: Date.now(),
      });

      compactMessages(messages);

      let response: Record<string, unknown>;
      try {
        response = await callWithRetry(
          () =>
            (client.beta.messages.create as Function)({
              model: MODEL,
              max_tokens: MAX_TOKENS,
              system: systemPrompt,
              tools,
              messages,
              betas: BETAS,
            }),
          5,
          (attempt, waitMs) => {
            const secs = Math.round(waitMs / 1000);
            useStore.getState().appendToLastAssistant({
              type: 'text',
              text: `Rate limited — retrying in ${secs}s (attempt ${attempt}/5)...`,
            });
          },
        );
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        useStore.getState().setError(`API error: ${errMsg}`);
        useStore.getState().appendToLastAssistant({ type: 'text', text: `Error: ${errMsg}` });
        break;
      }

      const respObj = response as { content: unknown[]; stop_reason?: string };
      const respContent = respObj.content;
      messages.push({ role: 'assistant', content: respContent });

      const textBlocks = (respContent as Array<{ type: string; text?: string }>).filter(
        (b) => b.type === 'text',
      );
      for (const tb of textBlocks) {
        useStore.getState().appendToLastAssistant({
          type: 'text',
          text: tb.text || '',
        });
      }

      if (respObj.stop_reason !== 'tool_use') break;

      const toolUseBlocks = (
        respContent as Array<{ type: string; id?: string; name?: string; input?: Record<string, unknown> }>
      ).filter((b) => b.type === 'tool_use');

      const toolResults: Array<{
        type: 'tool_result';
        tool_use_id: string;
        content: unknown[];
      }> = [];

      for (const toolUse of toolUseBlocks) {
        if (!useStore.getState().isRunning) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id!,
            content: [{ type: 'text', text: 'Cancelled by user.' }],
          });
          continue;
        }

        const toolInput = toolUse.input || {};

        useStore.getState().appendToLastAssistant({
          type: 'tool_use',
          id: toolUse.id!,
          name: toolUse.name!,
          input: toolInput,
        });

        const tabId =
          (toolInput.tabId as number | undefined) || useStore.getState().activeTabId;
        let domain = '';
        if (tabId) {
          try {
            const tab = await chrome.tabs.get(tabId);
            domain = tab.url ? new URL(tab.url).hostname : '';
          } catch {
            // tab might not exist
          }
        }

        const permType = permissionManager.getPermissionTypeForAction(
          toolUse.name!,
          toolInput.action as string | undefined,
        );
        const allowed = await permissionManager.checkPermission(
          domain,
          permType,
          toolUse.name!,
          toolUse.id!,
        );

        let result: unknown[];
        if (!allowed) {
          result = [{ type: 'text', text: 'Permission denied by user.' }];
        } else {
          try {
            result = await executeTool(toolUse.name!, toolInput, apiKey);
          } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            result = [{ type: 'text', text: `Tool error: ${errMsg}` }];
          }
        }

        const resultTexts = (result as Array<{ type: string; text?: string }>)
          .filter((r) => r.type === 'text')
          .map((r) => r.text)
          .join('\n');
        const resultImages = (
          result as Array<{ type: string; source?: { data: string } }>
        ).filter((r) => r.type === 'image');

        const toolResultBlock: DisplayBlock = {
          type: 'tool_result',
          toolUseId: toolUse.id!,
          text: resultTexts || undefined,
          imageData: resultImages.length > 0 ? resultImages[0].source?.data : undefined,
        };
        useStore.getState().appendToLastAssistant(toolResultBlock);

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id!,
          content: result,
        });
      }

      const newTabsResp = await sendToBackground({ type: 'tabs-context' });
      const newTabs = (newTabsResp.data as TabInfo[]) || [];
      const tabsChanged =
        JSON.stringify(newTabs.map((t) => t.id + t.url)) !==
        JSON.stringify(tabs.map((t) => t.id + t.url));

      if (tabsChanged) {
        tabs = newTabs;
        const newActive = newTabs.find((t) => t.active);
        if (newActive) store.setActiveTabId(newActive.id);

        const reminder = buildTabContextReminder(newTabs);
        const lastResult = toolResults[toolResults.length - 1];
        if (lastResult) {
          (lastResult.content as unknown[]).push({ type: 'text', text: reminder });
        }
      }

      messages.push({ role: 'user', content: toolResults });
    }
    taskSucceeded = !useStore.getState().error;
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    useStore.getState().setError(errMsg);
  } finally {
    await sendToBackground({ type: 'cdp-detach-all' }).catch(() => {});
    useStore.getState().setIsRunning(false);
    useStore.getState().setCurrentTool(null);

    const domain = await finalizeTrace(taskSucceeded).catch(() => null);
    if (domain && apiKey) {
      maybeRunMiningPass(domain, apiKey).catch((e) =>
        console.error('[MacroMining] mining pass failed:', e),
      );
    }
  }
}
