import { runAgentLoop } from './agent-loop.mjs';
import { BrowserRuntime } from './browser-runtime.mjs';
import { reportTaskResult, uploadTaskSnapshot, waitForTask } from './ottoauth-client.mjs';
import { createTaskTraceRecorder } from './task-trace.mjs';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stringifyError(error) {
  return error instanceof Error ? error.message : String(error);
}

function taskGoal(task) {
  const goal = String(task.goal || task.taskPrompt || '').trim();
  if (goal) return goal;
  const url = String(task.url || '').trim();
  if (url) return `Open ${url} and complete the requested browser task.`;
  return '';
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

  await runtime.prepareTaskWorkspace();
  await runtime.startTaskTrace(recorder.playwrightTracePath);
  await safeSnapshotUpload({ runtime, config, taskId: task.id, logger });

  let snapshotIntervalId = null;
  let completedTaskPayload = null;
  try {
    snapshotIntervalId = setInterval(() => {
      safeSnapshotUpload({ runtime, config, taskId: task.id, logger }).catch(() => {});
    }, 4000);
    snapshotIntervalId.unref?.();

    const { result, messages, modelUsages: usedUsages } = await runAgentLoop({
      runtime,
      prompt: goal,
      apiKey,
      model,
      onEvent: (type, payload) => recorder.note(type, payload).catch(() => {}),
      onModelUsage: (usage) => {
        modelUsages.push(usage);
      },
    });

    await recorder.setTranscript(messages);
    await recorder.setModelUsages(usedUsages);
    await safeSnapshotUpload({ runtime, config, taskId: task.id, logger });
    completedTaskPayload = {
      result,
      messages,
      usages: usedUsages,
    };
    await recorder.finalize({
      status: 'completed',
      result,
      error: null,
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
  }

  if (!completedTaskPayload) {
    return;
  }

  try {
    await reportTaskResult(config, task.id, {
      status: 'completed',
      result: completedTaskPayload.result,
      error: null,
      usages: completedTaskPayload.usages,
    });
    logger.log?.(`[ottoauth-headless] Task ${task.id} completed.`);
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
  waitMs = 25000,
  model = null,
  logger = console,
}) {
  const runtime = new BrowserRuntime({
    profileDir,
    browserPath: browserPath || config.browserPath || null,
    headless,
    keepTabs,
  });
  await runtime.start();

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
        task = await waitForTask(config, waitMs);
      } catch (error) {
        logger.warn?.(`[ottoauth-headless] wait-task failed: ${stringifyError(error)}`);
        if (once) {
          throw error;
        }
        await sleep(2000);
        continue;
      }

      if (!task) {
        if (once) {
          logger.log?.('[ottoauth-headless] No task available.');
          break;
        }
        continue;
      }

      logger.log?.(`[ottoauth-headless] Claimed task ${task.id}.`);
      await handleTask({
        runtime,
        config,
        apiKey,
        task,
        traceRoot,
        logger,
        model,
      });

      if (once) {
        break;
      }
    }
  } finally {
    process.off('SIGINT', requestStop);
    process.off('SIGTERM', requestStop);
    await runtime.stop();
  }
}
