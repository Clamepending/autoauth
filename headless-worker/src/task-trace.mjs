import fs from 'node:fs/promises';
import path from 'node:path';

function sanitizeSegment(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'task';
}

function timestampSlug(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-');
}

function compactBlock(block) {
  if (block?.type === 'text') {
    return { type: 'text', text: String(block.text || '').slice(0, 4000) };
  }
  if (block?.type === 'tool_use') {
    return {
      type: 'tool_use',
      id: block.id,
      name: block.name,
      input: block.input,
    };
  }
  if (block?.type === 'tool_result') {
    return {
      type: 'tool_result',
      tool_use_id: block.tool_use_id,
      content: Array.isArray(block.content)
        ? block.content.map((entry) => {
            if (entry?.type === 'text') {
              return { type: 'text', text: String(entry.text || '').slice(0, 4000) };
            }
            if (entry?.type === 'image') {
              return {
                type: 'image',
                bytes: String(entry.source?.data || '').length,
              };
            }
            return entry;
          })
        : [],
    };
  }
  if (block?.type === 'image') {
    return {
      type: 'image',
      bytes: String(block.source?.data || '').length,
    };
  }
  return block;
}

function compactConversation(messages) {
  return (messages || []).map((message) => ({
    role: message.role,
    content: Array.isArray(message.content)
      ? message.content.map((block) => compactBlock(block))
      : message.content,
  }));
}

async function writeJsonFile(targetPath, payload) {
  await fs.writeFile(targetPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

export async function createTaskTraceRecorder({ traceRoot, task, goal }) {
  const directoryName = `${timestampSlug()}_${sanitizeSegment(task.id)}_${sanitizeSegment(task.deviceId || 'device')}`;
  const traceDir = path.join(traceRoot, directoryName);
  await fs.mkdir(traceDir, { recursive: true });

  const state = {
    schemaVersion: 1,
    task: {
      id: task.id,
      type: task.type,
      deviceId: task.deviceId,
      createdAt: task.createdAt,
    },
    goal,
    createdAt: new Date().toISOString(),
    status: 'running',
    events: [],
    modelUsages: [],
    transcript: [],
    result: null,
    error: null,
    playwrightTraceZip: 'playwright-trace.zip',
  };

  async function flush() {
    await writeJsonFile(path.join(traceDir, 'trace.json'), state);
  }

  await flush();

  return {
    traceDir,
    playwrightTracePath: path.join(traceDir, 'playwright-trace.zip'),
    async note(type, payload = {}) {
      state.events.push({
        timestamp: new Date().toISOString(),
        type,
        payload,
      });
      await flush();
    },
    async setModelUsages(usages) {
      state.modelUsages = Array.isArray(usages) ? usages : [];
      await flush();
    },
    async setTranscript(messages) {
      state.transcript = compactConversation(messages);
      await flush();
    },
    async finalize({ status, result, error, messages, usages }) {
      state.status = status;
      state.result = result ?? null;
      state.error = error ?? null;
      state.transcript = compactConversation(messages);
      state.modelUsages = Array.isArray(usages) ? usages : [];
      state.completedAt = new Date().toISOString();
      await flush();
    },
  };
}
