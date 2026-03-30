import Anthropic from '@anthropic-ai/sdk';
import { MAX_TOKENS, MODEL, BETAS, MAX_TOOL_RESULT_CHARS_IN_HISTORY } from '../../shared/constants';
import { sendToBackground } from '../../shared/messaging';
import type { TabInfo } from '../../shared/types';
import { buildSystemPrompt, buildTabContextReminder } from './systemPrompt';
import { getToolDefinitions } from './toolDefinitions';
import { executeTool } from './toolExecutor';
import { permissionManager } from './permissions';
import { useStore, type DisplayBlock } from '../store';

type ApiMessage = {
  role: 'user' | 'assistant';
  content: unknown;
};

export interface AgentLoopEvent {
  type: string;
  payload: Record<string, unknown>;
}

export interface AgentLoopOptions {
  onEvent?: (event: AgentLoopEvent) => void;
}

function emitAgentLoopEvent(options: AgentLoopOptions | undefined, type: string, payload: Record<string, unknown> = {}): void {
  options?.onEvent?.({ type, payload });
}

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

/**
 * Session-scoped helpers that target a specific session for all store mutations,
 * so the loop continues writing to its own session even if the user switches views.
 */
function sessionHelpers(sessionId: string) {
  const s = () => useStore.getState();
  return {
    addMessage: (msg: { id: string; role: 'user' | 'assistant'; blocks: DisplayBlock[]; timestamp: number }) =>
      s().addMessage(msg, sessionId),
    appendToLastAssistant: (block: DisplayBlock) =>
      s().appendToLastAssistant(block, sessionId),
    setIsRunning: (running: boolean) =>
      s().setIsRunning(running, sessionId),
    setError: (error: string | null) =>
      s().setError(error, sessionId),
    setCurrentTool: (tool: string | null) =>
      s().setCurrentTool(tool, sessionId),
    getIsRunning: () => s().getIsRunning(sessionId),
    getMessages: () => s().getMessages(sessionId),
  };
}

export async function runAgentLoop(userPrompt: string, sessionId?: string, options?: AgentLoopOptions): Promise<void> {
  const store = useStore.getState();
  const apiKey = store.apiKey;
  if (!apiKey) throw new Error('API key not set');

  const sid = sessionId ?? store.activeSessionId;
  if (!sid) throw new Error('No active session');

  const h = sessionHelpers(sid);

  h.setIsRunning(true);
  h.setError(null);
  permissionManager.setMode(store.permissionMode);

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  try {
    emitAgentLoopEvent(options, 'agent_loop_started', { sessionId: sid, userPrompt });
    const tabsResp = await sendToBackground({ type: 'tabs-context', sessionId: sid });
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

    const systemPrompt = buildSystemPrompt(tabs);

    const messages: ApiMessage[] = [
      { role: 'user', content: userPrompt },
    ];
    emitAgentLoopEvent(options, 'user_prompt', { text: userPrompt });

    h.addMessage({
      id: `user_${Date.now()}`,
      role: 'user',
      blocks: [{ type: 'text', text: userPrompt }],
      timestamp: Date.now(),
    });

    let loopCount = 0;
    const maxLoops = 50;

    while (loopCount < maxLoops) {
      loopCount++;

      if (!h.getIsRunning()) {
        break;
      }

      const vp = useStore.getState().viewportSize;
      const tools = getToolDefinitions(vp.width, vp.height);

      const assistantMsgId = `asst_${Date.now()}_${loopCount}`;
      h.addMessage({
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
            emitAgentLoopEvent(options, 'model_retry', { attempt, waitMs });
            const secs = Math.round(waitMs / 1000);
            h.appendToLastAssistant({
              type: 'text',
              text: `Rate limited — retrying in ${secs}s (attempt ${attempt}/5)...`,
            });
          },
        );
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        emitAgentLoopEvent(options, 'model_error', { error: errMsg, loopCount });
        h.setError(`API error: ${errMsg}`);
        h.appendToLastAssistant({ type: 'text', text: `Error: ${errMsg}` });
        break;
      }

      const respObj = response as { content: unknown[]; stop_reason?: string };
      const respContent = respObj.content;
      messages.push({ role: 'assistant', content: respContent });

      const textBlocks = (respContent as Array<{ type: string; text?: string }>).filter(
        (b) => b.type === 'text',
      );
      for (const tb of textBlocks) {
        emitAgentLoopEvent(options, 'assistant_text', {
          loopCount,
          text: tb.text || '',
        });
        h.appendToLastAssistant({
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
        if (!h.getIsRunning()) {
          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolUse.id!,
            content: [{ type: 'text', text: 'Cancelled by user.' }],
          });
          continue;
        }

        const toolInput = toolUse.input || {};
        emitAgentLoopEvent(options, 'tool_use', {
          loopCount,
          toolUseId: toolUse.id!,
          name: toolUse.name!,
          input: toolInput,
        });

        h.appendToLastAssistant({
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
          emitAgentLoopEvent(options, 'tool_permission_denied', {
            loopCount,
            toolUseId: toolUse.id!,
            name: toolUse.name!,
            domain,
          });
        } else {
          const toolStart = Date.now();
          try {
            result = await executeTool(toolUse.name!, toolInput, apiKey, sid);
            emitAgentLoopEvent(options, 'tool_result', {
              loopCount,
              toolUseId: toolUse.id!,
              name: toolUse.name!,
              durationMs: Date.now() - toolStart,
              text: (result as Array<{ type: string; text?: string }>)
                .filter((item) => item.type === 'text')
                .map((item) => item.text || '')
                .join('\n'),
              imageCount: (result as Array<{ type: string }>).filter((item) => item.type === 'image').length,
            });
          } catch (e: unknown) {
            const errMsg = e instanceof Error ? e.message : String(e);
            result = [{ type: 'text', text: `Tool error: ${errMsg}` }];
            emitAgentLoopEvent(options, 'tool_error', {
              loopCount,
              toolUseId: toolUse.id!,
              name: toolUse.name!,
              error: errMsg,
            });
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
        h.appendToLastAssistant(toolResultBlock);

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUse.id!,
          content: result,
        });
      }

      const newTabsResp = await sendToBackground({ type: 'tabs-context', sessionId: sid });
      const newTabs = (newTabsResp.data as TabInfo[]) || [];
      const tabsChanged =
        JSON.stringify(newTabs.map((t) => t.id + t.url)) !==
        JSON.stringify(tabs.map((t) => t.id + t.url));

      if (tabsChanged) {
        tabs = newTabs;
        const newActive = newTabs.find((t) => t.active);
        if (newActive) store.setActiveTabId(newActive.id);
        emitAgentLoopEvent(options, 'tabs_changed', {
          loopCount,
          activeTabId: newActive?.id ?? null,
          tabCount: newTabs.length,
        });

        const reminder = buildTabContextReminder(newTabs);
        const lastResult = toolResults[toolResults.length - 1];
        if (lastResult) {
          (lastResult.content as unknown[]).push({ type: 'text', text: reminder });
        }
      }

      messages.push({ role: 'user', content: toolResults });
    }
  } catch (e: unknown) {
    const errMsg = e instanceof Error ? e.message : String(e);
    emitAgentLoopEvent(options, 'agent_loop_error', { error: errMsg });
    h.setError(errMsg);
  } finally {
    await sendToBackground({ type: 'cdp-detach-all' }).catch(() => {});
    h.setIsRunning(false);
    h.setCurrentTool(null);
    emitAgentLoopEvent(options, 'agent_loop_finished', {
      sessionId: sid,
      error: useStore.getState().getError(sid),
    });
  }
}
