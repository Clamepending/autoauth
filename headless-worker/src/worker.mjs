import path from 'node:path';
import { runAgentLoop } from './agent-loop.mjs';
import { BrowserRuntime } from './browser-runtime.mjs';
import {
  fetchTaskMessages,
  reportTaskResult,
  sendTaskMessage,
  uploadTaskSnapshot,
  waitForTask,
} from './ottoauth-client.mjs';
import { createTaskTraceRecorder } from './task-trace.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(baseMs, ratio = 0.25) {
  const span = Math.max(0, Math.floor(baseMs * ratio));
  return Math.floor(baseMs + Math.random() * span);
}

function stringifyError(error) {
  return error instanceof Error ? error.message : String(error);
}

function envFlagEnabled(value, fallback = true) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return fallback;
  return !['0', 'false', 'no', 'off'].includes(normalized);
}

function formatRuntimeStartupError(error) {
  const message = stringifyError(error);
  if (
    /opening in existing browser session/i.test(message)
    || /processsingleton/i.test(message)
    || /profile.*already in use/i.test(message)
  ) {
    return `${message}\n\nChrome is already open on this profile. Quit regular Chrome completely before running OttoAuth against a shared real browser profile.`;
  }
  return message;
}

function taskGoal(task) {
  const goal = String(task.goal || task.taskPrompt || '').trim();
  if (goal) return goal;
  const url = String(task.url || '').trim();
  if (url) return `Open ${url} and complete the requested browser task.`;
  return '';
}

function truncate(text, limit) {
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function sanitizeClarificationQuestion(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const withoutFences = raw.replace(/```[\s\S]*?```/g, ' ');
  const withoutJsonTail = withoutFences.replace(/\{[\s\S]*$/, ' ');
  const collapsed = withoutJsonTail.replace(/\s+/g, ' ').trim();
  if (!collapsed) return '';
  const firstQuestion = collapsed.match(/[^.?!]*(?:\?|$)/)?.[0]?.trim() || collapsed;
  return truncate(firstQuestion || collapsed, 500);
}

function looksLikeClarificationRequest(text) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!normalized) return false;

  const strongMarkers = [
    'how would you like me to proceed',
    'how should i proceed',
    'please clarify',
    'could you clarify',
    'can you clarify',
    'i need clarification',
    'i need more information',
    'i need more detail',
    'what would you like me to do',
    'which option would you like',
    'please let me know how to proceed',
    'tell me how to proceed',
    'waiting for clarification',
    'according to my instructions',
  ];
  if (strongMarkers.some((marker) => normalized.includes(marker))) {
    return true;
  }

  if (!normalized.includes('?')) {
    return false;
  }

  return /(would you like|how should i|how would you like|can you clarify|could you clarify|should i proceed|what should i do|which .* should i)/.test(
    normalized,
  );
}

function collectLastAssistantText(messages) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue;
    const text = message.content
      .filter((block) => block?.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text)
      .join('\n')
      .trim();
    if (text) return text;
  }
  return null;
}

function buildOttoAuthFailureResult(summary, error, clarificationQuestion = null) {
  const result = {
    status: 'failed',
    summary,
    error,
    merchant: null,
    pickup_details: {
      order_number: null,
      confirmation_code: null,
      pickup_code: null,
      ready_time: null,
      pickup_name: null,
      instructions: null,
    },
    tracking_details: {
      tracking_number: null,
      tracking_url: null,
      carrier: null,
      status: null,
      delivery_eta: null,
      delivery_window: null,
      instructions: null,
    },
    receipt_details: {
      order_reference: null,
      receipt_url: null,
      receipt_text: null,
    },
    charges: {
      goods_cents: 0,
      shipping_cents: 0,
      tax_cents: 0,
      other_cents: 0,
      currency: 'usd',
    },
  };
  if (clarificationQuestion) {
    result.clarification_requested = true;
    result.clarification_question = clarificationQuestion;
  }
  return result;
}

function normalizeOttoAuthCompletion(result, messages) {
  const rawText = collectLastAssistantText(messages);
  const statusValue =
    result && typeof result.status === 'string'
      ? result.status.trim().toLowerCase()
      : '';
  const summaryText = [
    result && typeof result.summary === 'string' ? result.summary : '',
    result && typeof result.error === 'string' ? result.error : '',
    rawText || '',
  ]
    .filter(Boolean)
    .join('\n')
    .trim();

  if (looksLikeClarificationRequest(summaryText)) {
    const error =
      'OttoAuth does not support live clarification replies. The fulfiller asked for more direction instead of returning a final result.';
    const clarificationQuestion = sanitizeClarificationQuestion(summaryText);
    return {
      status: 'failed',
      result: buildOttoAuthFailureResult(
        'Task blocked because the fulfiller requested clarification.',
        `${error} Final assistant message: ${truncate(summaryText, 800)}`,
        clarificationQuestion,
      ),
      error,
    };
  }

  if (statusValue === 'failed') {
    return {
      status: 'failed',
      result,
      error:
        (result && typeof result.error === 'string' && result.error.trim()) ||
        (result && typeof result.summary === 'string' && result.summary.trim()) ||
        'Task failed.',
    };
  }

  if (statusValue === 'completed') {
    return {
      status: 'completed',
      result,
      error: null,
    };
  }

  const error = result
    ? 'OttoAuth browser tasks must return a JSON object whose status is "completed" or "failed".'
    : 'OttoAuth browser tasks must finish with a single JSON result.';
  return {
    status: 'failed',
    result: buildOttoAuthFailureResult(
      result
        ? 'Task returned an invalid OttoAuth result payload.'
        : 'Task ended without a final OttoAuth result.',
      `${error}${summaryText ? ` Final assistant message: ${truncate(summaryText, 800)}` : ''}`,
    ),
    error,
  };
}

async function safeSnapshotUpload({ runtime, config, taskId, logger }) {
  try {
    const payload = await runtime.snapshotForOttoAuth();
    await uploadTaskSnapshot(config, taskId, payload);
  } catch (error) {
    logger.warn?.(`[ottoauth-headless] Snapshot upload failed for task ${taskId}: ${stringifyError(error)}`);
  }
}

async function handleTask({
  runtime,
  config,
  apiKey,
  task,
  traceRoot,
  logger,
  model,
}) {
  const goal = taskGoal(task);
  const recorder = await createTaskTraceRecorder({ traceRoot, task, goal });
  const modelUsages = [];

  if (!goal) {
    const error = 'Task did not include a goal or URL.';
    await recorder.finalize({
      status: 'failed',
      result: null,
      error,
      messages: [],
      usages: [],
    });
    await reportTaskResult(config, task.id, {
      status: 'failed',
      result: null,
      error,
      usages: [],
    }).catch((reportError) => {
      logger.warn?.(`[ottoauth-headless] Failed to report goal-less task ${task.id}: ${stringifyError(reportError)}`);
    });
    return;
  }

  await recorder.note('task_claimed', {
    taskId: task.id,
    createdAt: task.createdAt,
    deviceId: task.deviceId,
  });

  let snapshotIntervalId = null;
  let completedTaskPayload = null;
  try {
    await recorder.note('task_workspace_preparing');
    await runtime.prepareTaskWorkspace();
    await recorder.note('task_workspace_ready');
    await runtime.startTaskTrace(recorder.playwrightTracePath);
    await recorder.note('task_trace_started');
    await safeSnapshotUpload({ runtime, config, taskId: task.id, logger });
    await recorder.note('task_initial_snapshot_uploaded');

    const snapshotIntervalMs = Math.max(
      1000,
      Number(process.env.OTTOAUTH_SNAPSHOT_INTERVAL_MS) || 10000,
    );
    snapshotIntervalId = setInterval(() => {
      safeSnapshotUpload({ runtime, config, taskId: task.id, logger }).catch(() => {});
    }, snapshotIntervalMs);
    snapshotIntervalId.unref?.();

    const { result, messages, modelUsages: usedUsages } = await runAgentLoop({
      runtime,
      prompt: goal,
      apiKey,
      model,
      taskChat: {
        fetchRequesterMessages: () => fetchTaskMessages(config, task.id),
        sendAgentMessage: (message) => sendTaskMessage(config, task.id, message),
      },
      onEvent: (type, payload) => recorder.note(type, payload).catch(() => {}),
      onModelUsage: (usage) => {
        modelUsages.push(usage);
      },
    });

    await recorder.setTranscript(messages);
    await recorder.setModelUsages(usedUsages);
    await safeSnapshotUpload({ runtime, config, taskId: task.id, logger });
    const normalizedCompletion = normalizeOttoAuthCompletion(result, messages);
    completedTaskPayload = {
      status: normalizedCompletion.status,
      result: normalizedCompletion.result,
      error: normalizedCompletion.error,
      messages,
      usages: usedUsages,
    };
    await recorder.finalize({
      status: normalizedCompletion.status,
      result: normalizedCompletion.result,
      error: normalizedCompletion.error,
      messages,
      usages: usedUsages,
    });
  } catch (error) {
    const message = stringifyError(error);
    await safeSnapshotUpload({ runtime, config, taskId: task.id, logger });
    await reportTaskResult(config, task.id, {
      status: 'failed',
      result: null,
      error: message,
      usages: modelUsages,
    }).catch((reportError) => {
      logger.warn?.(`[ottoauth-headless] Failed to report failed task ${task.id}: ${stringifyError(reportError)}`);
    });
    await recorder.finalize({
      status: 'failed',
      result: null,
      error: message,
      messages: [],
      usages: modelUsages,
    });
    logger.error?.(`[ottoauth-headless] Task ${task.id} failed: ${message}`);
  } finally {
    if (snapshotIntervalId) {
      clearInterval(snapshotIntervalId);
    }
    await runtime.stopTaskTrace().catch((traceError) => {
      logger.warn?.(`[ottoauth-headless] Failed to stop Playwright trace for task ${task.id}: ${stringifyError(traceError)}`);
    });
    try {
      const videoArtifacts = await runtime.saveTaskVideos(recorder.videoPath);
      if (videoArtifacts.length > 0) {
        await recorder.setVideoArtifacts(videoArtifacts);
        await recorder.note('task_video_saved', { videos: videoArtifacts });
      }
    } catch (videoError) {
      const message = stringifyError(videoError);
      await recorder.note('task_video_failed', { error: message }).catch(() => {});
      logger.warn?.(`[ottoauth-headless] Failed to save browser video for task ${task.id}: ${message}`);
    }
  }

  if (!completedTaskPayload) {
    return;
  }

  try {
    await reportTaskResult(config, task.id, {
      status: completedTaskPayload.status,
      result: completedTaskPayload.result,
      error: completedTaskPayload.error,
      usages: completedTaskPayload.usages,
    });
    logger.log?.(`[ottoauth-headless] Task ${task.id} ${completedTaskPayload.status}.`);
  } catch (error) {
    logger.error?.(
      `[ottoauth-headless] Task ${task.id} completed locally, but OttoAuth result reporting failed: ${stringifyError(error)}`,
    );
  }
}

export async function runWorker({
  config,
  apiKey,
  profileDir,
  traceRoot,
  once = false,
  headless = true,
  browserPath = null,
  keepTabs = false,
  strictHumanInput = false,
  pollIntervalMs = 10000,
  model = null,
  recordVideo = envFlagEnabled(process.env.OTTOAUTH_RECORD_VIDEO, true),
  logger = console,
}) {
  const idlePollIntervalMs = Math.max(1000, Number(pollIntervalMs) || 30000);
  const errorBackoffStartMs = Math.max(idlePollIntervalMs, 5000);
  const errorBackoffMaxMs = Math.max(errorBackoffStartMs, 5 * 60 * 1000);
  let consecutiveWaitErrors = 0;
  let stopRequested = false;
  const requestStop = () => {
    stopRequested = true;
    logger.log?.('[ottoauth-headless] Stop requested. Finishing current work and exiting.');
  };
  process.on('SIGINT', requestStop);
  process.on('SIGTERM', requestStop);

  try {
    while (!stopRequested) {
      let task = null;
      try {
        task = await waitForTask(config);
        consecutiveWaitErrors = 0;
      } catch (error) {
        consecutiveWaitErrors += 1;
        const backoffBase = Math.min(
          errorBackoffMaxMs,
          errorBackoffStartMs * 2 ** Math.min(consecutiveWaitErrors - 1, 6),
        );
        const backoffMs = jitter(backoffBase);
        logger.warn?.(
          `[ottoauth-headless] wait-task failed (attempt ${consecutiveWaitErrors}, backing off ${backoffMs}ms): ${stringifyError(error)}`,
        );
        if (once) {
          throw error;
        }
        await sleep(backoffMs);
        continue;
      }

      if (!task) {
        if (once) {
          logger.log?.('[ottoauth-headless] No task available.');
          break;
        }
        await sleep(jitter(idlePollIntervalMs));
        continue;
      }

      logger.log?.(`[ottoauth-headless] Claimed task ${task.id}.`);
      const runtime = new BrowserRuntime({
        profileDir,
        browserPath: browserPath || config.browserPath || null,
        headless,
        keepTabs,
        strictHumanInput,
        recordVideo,
        videoDir: recordVideo ? path.join(traceRoot, '_videos') : null,
      });

      try {
        await runtime.start();
        await handleTask({
          runtime,
          config,
          apiKey,
          task,
          traceRoot,
          logger,
          model,
        });
      } catch (error) {
        const message = `Failed to start browser runtime: ${formatRuntimeStartupError(error)}`;
        logger.error?.(`[ottoauth-headless] Task ${task.id} failed before execution: ${message}`);
        await reportTaskResult(config, task.id, {
          status: 'failed',
          result: null,
          error: message,
          usages: [],
        }).catch((reportError) => {
          logger.warn?.(
            `[ottoauth-headless] Failed to report startup failure for task ${task.id}: ${stringifyError(reportError)}`,
          );
        });
      } finally {
        await runtime.stop().catch((stopError) => {
          logger.warn?.(
            `[ottoauth-headless] Failed to stop browser runtime after task ${task.id}: ${stringifyError(stopError)}`,
          );
        });
      }

      if (once) {
        break;
      }
    }
  } finally {
    process.off('SIGINT', requestStop);
    process.off('SIGTERM', requestStop);
  }
}
