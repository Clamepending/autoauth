import { NextResponse } from "next/server";
import { emitAgentEvent } from "@/lib/agent-events";
import {
  cancelAgentClarificationTask,
  resumeAgentClarificationTask,
  waitForAgentClarificationResolution,
} from "@/lib/computeruse-agent-clarification";
import { notifyAgentClarificationRequested } from "@/lib/computeruse-agent-callback";
import {
  appendComputerUseRunEvent,
  markComputerUseRunAwaitingAgentClarification,
  markComputerUseRunFinalState,
} from "@/lib/computeruse-runs";
import { normalizeMockDeviceId } from "@/lib/computeruse-mock";
import {
  getComputerUseDeviceById,
  getComputerUseTaskById,
  touchComputerUseDeviceSeen,
  updateComputerUseTaskResult,
  verifyComputerUseDeviceToken,
} from "@/lib/computeruse-store";
import { handleAmazonTaskCompletion } from "@/lib/amazon-fulfillment";
import {
  completeGenericBrowserTaskFromExtension,
  getGenericBrowserTaskById,
  recordGenericBrowserTaskClarificationCallbackAttempt,
} from "@/lib/generic-browser-tasks";
import type { ModelUsageRecord } from "@/lib/model-pricing";
import { getAgentById } from "@/lib/db";

type Context = {
  params: {
    taskId: string;
  };
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers":
      "Content-Type, Authorization, X-OttoAuth-Mock-Device",
    "Cache-Control": "no-store",
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request: Request, context: Context) {
  const taskId = context.params.taskId?.trim() ?? "";
  if (!taskId) {
    return NextResponse.json({ error: "Missing task id." }, { status: 400, headers: corsHeaders() });
  }

  const task = await getComputerUseTaskById(taskId);
  if (!task) {
    return NextResponse.json({ error: "Task not found." }, { status: 404, headers: corsHeaders() });
  }

  const deviceId = normalizeMockDeviceId(request.headers.get("x-ottoauth-mock-device")) || task.deviceId;
  if (!(await getComputerUseDeviceById(deviceId))) {
    return NextResponse.json({ error: "Device is not paired (mock)." }, { status: 401, headers: corsHeaders() });
  }

  const tokenCheck = await verifyComputerUseDeviceToken({
    deviceId,
    authHeader: request.headers.get("authorization"),
  });
  if (!tokenCheck.ok) {
    return NextResponse.json(
      {
        error:
          tokenCheck.reason === "missing_token"
            ? "Missing bearer token for paired device."
            : "Invalid bearer token for paired device.",
      },
      { status: 401, headers: corsHeaders() }
    );
  }

  if (task.deviceId !== "*" && task.deviceId !== deviceId) {
    return NextResponse.json({ error: "Task does not belong to this device." }, { status: 403, headers: corsHeaders() });
  }
  await touchComputerUseDeviceSeen(deviceId).catch(() => null);

  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const status = typeof payload?.status === "string" && payload.status.trim().toLowerCase() === "failed"
    ? "failed"
    : "completed";
  const summary = typeof payload?.summary === "string" ? payload.summary.trim() : "";
  const error = status === "failed" && typeof payload?.error === "string"
    ? payload.error.trim()
    : status === "failed"
      ? "Local browser-agent execution failed"
      : null;
  const result = payload?.result && typeof payload.result === "object"
    ? (payload.result as Record<string, unknown>)
    : (summary ? { summary } : null);
  const usages = Array.isArray(payload?.usages)
    ? (payload?.usages as Array<Record<string, unknown>>)
        .map((usage) => ({
          model: typeof usage.model === "string" ? usage.model : "",
          input_tokens:
            typeof usage.input_tokens === "number"
              ? usage.input_tokens
              : typeof usage.inputTokens === "number"
                ? usage.inputTokens
                : 0,
          output_tokens:
            typeof usage.output_tokens === "number"
              ? usage.output_tokens
              : typeof usage.outputTokens === "number"
                ? usage.outputTokens
                : 0,
          source: typeof usage.source === "string" ? usage.source : null,
        }))
        .filter((usage) => usage.model) as ModelUsageRecord[]
    : [];

  await updateComputerUseTaskResult({
    taskId: task.id,
    status,
    result,
    error,
  });

  let clarificationRequested = false;
  let clarificationQuestion: string | null = null;
  let genericTaskOutcome:
    | Awaited<ReturnType<typeof completeGenericBrowserTaskFromExtension>>
    | null = null;

  try {
    genericTaskOutcome = await completeGenericBrowserTaskFromExtension({
      computeruseTaskId: task.id,
      status,
      result,
      error,
      usages,
    });
    clarificationRequested = Boolean(
      genericTaskOutcome &&
        typeof genericTaskOutcome === "object" &&
        "clarificationRequested" in genericTaskOutcome &&
        genericTaskOutcome.clarificationRequested,
    );
    clarificationQuestion =
      clarificationRequested &&
      genericTaskOutcome &&
      typeof genericTaskOutcome === "object" &&
      "clarificationRequest" in genericTaskOutcome
        ? String(genericTaskOutcome.clarificationRequest || "")
        : null;
  } catch (e) {
    console.error("[local-agent-complete] Generic browser task billing hook error:", e);
  }

  if (task.runId) {
    if (clarificationRequested) {
      const run = await markComputerUseRunAwaitingAgentClarification({
        runId: task.runId,
        taskId: task.id,
        result,
        error: clarificationQuestion,
      });
      await appendComputerUseRunEvent({
        runId: task.runId,
        type: "computeruse.local_agent.clarification_requested",
        data: {
          task_id: task.id,
          status: "awaiting_agent_clarification",
          clarification_question: clarificationQuestion,
          result,
        },
      });
      if (run) {
        await appendComputerUseRunEvent({
          runId: task.runId,
          type: "computeruse.run.awaiting_agent_clarification",
          data: {
            run_id: run.id,
            task_id: task.id,
            status: run.status,
            clarification_question: clarificationQuestion,
          },
        });
      }
    } else {
      const run = await markComputerUseRunFinalState({
        runId: task.runId,
        taskId: task.id,
        status,
        result,
        error,
      });
      await appendComputerUseRunEvent({
        runId: task.runId,
        type: status === "completed" ? "computeruse.local_agent.completed" : "computeruse.local_agent.failed",
        data: {
          task_id: task.id,
          status,
          result,
          error,
        },
      });
      if (run) {
        await appendComputerUseRunEvent({
          runId: task.runId,
          type: status === "completed" ? "computeruse.run.completed" : "computeruse.run.failed",
          data: {
            run_id: run.id,
            task_id: task.id,
            status: run.status,
            result: run.result,
            error: run.error,
          },
        });
      }
    }
  }

  if (task.agentUsername) {
    emitAgentEvent({
      type: clarificationRequested
        ? "computeruse.local_agent.clarification_requested"
        : status === "completed"
          ? "computeruse.local_agent.completed"
          : "computeruse.local_agent.failed",
      agentUsername: task.agentUsername,
      deviceId: task.deviceId,
      data: {
        task_id: task.id,
        run_id: task.runId,
        status: clarificationRequested ? "awaiting_agent_clarification" : status,
        result,
        error: clarificationRequested ? clarificationQuestion : error,
        clarification_question: clarificationRequested ? clarificationQuestion : null,
        executor: "local_browser_agent",
      },
    });
  }

  if (clarificationRequested) {
    const clarifyingTask =
      genericTaskOutcome &&
      typeof genericTaskOutcome === "object" &&
      "task" in genericTaskOutcome
        ? genericTaskOutcome.task
        : null;
    let resumedTaskId: string | null = null;
    let finalClarificationError: string | null = clarificationQuestion;
    if (clarifyingTask?.submission_source === "human") {
      const deadlineAtMs = clarifyingTask.clarification_deadline_at
        ? new Date(clarifyingTask.clarification_deadline_at).getTime()
        : Date.now();
      const remainingMs = Math.max(0, deadlineAtMs - Date.now());
      const resolvedTask =
        remainingMs > 0
          ? await waitForAgentClarificationResolution({
              taskId: clarifyingTask.id,
              timeoutMs: remainingMs,
            })
          : clarifyingTask;
      if (resolvedTask?.status === "queued" && resolvedTask.computeruse_task_id) {
        resumedTaskId = resolvedTask.computeruse_task_id;
        finalClarificationError = null;
      } else {
        const timeoutReason =
          "Human clarification timed out after 30 seconds, so OttoAuth canceled the request.";
        await cancelAgentClarificationTask({
          task: clarifyingTask,
          reason: timeoutReason,
          callbackStatus: "timed_out",
          eventActor: "human",
          emitAgentEvents: false,
        }).catch((timeoutError) => {
          console.error(
            "[local-agent-complete] Human clarification timeout cancel error:",
            timeoutError,
          );
        });
        finalClarificationError = timeoutReason;
      }
    } else if (clarifyingTask?.agent_id) {
      const agent = await getAgentById(clarifyingTask.agent_id).catch(() => null);
      if (agent && clarifyingTask.clarification_request) {
        const callback = await notifyAgentClarificationRequested({
          agent,
          task: clarifyingTask,
          question: clarifyingTask.clarification_request,
          baseUrl: new URL(request.url).origin,
        });
        await recordGenericBrowserTaskClarificationCallbackAttempt({
          taskId: clarifyingTask.id,
          ok: callback.ok,
          httpStatus: callback.statusCode,
          error: callback.error,
        }).catch((callbackUpdateError) => {
          console.error(
            "[local-agent-complete] Clarification callback bookkeeping error:",
            callbackUpdateError,
          );
        });
        if (task.runId) {
          await appendComputerUseRunEvent({
            runId: task.runId,
            type: callback.ok
              ? "computeruse.agent_clarification.callback_sent"
              : "computeruse.agent_clarification.callback_failed",
            data: {
              task_id: task.id,
              generic_task_id: clarifyingTask.id,
              clarification_question: clarifyingTask.clarification_request,
              callback_url: agent.callback_url,
              callback_status_code: callback.statusCode,
              callback_error: callback.error,
            },
          });
        }

        if (callback.ok && callback.clarificationResponse) {
          const resumed = await resumeAgentClarificationTask({
            task: clarifyingTask,
            clarificationResponse: callback.clarificationResponse,
            agentUsernameLower: agent.username_lower,
          }).catch((resumeError) => {
            console.error(
              "[local-agent-complete] Inline clarification resume error:",
              resumeError,
            );
            return null;
          });
          if (resumed) {
            resumedTaskId = resumed.computeruseTaskId;
            finalClarificationError = null;
          } else {
            const inlineResumeReason =
              "OttoAuth could not resume the task after receiving agent clarification, so the request was canceled.";
            await cancelAgentClarificationTask({
              task: clarifyingTask,
              reason: inlineResumeReason,
              callbackStatus: "failed",
            }).catch((cancelError) => {
              console.error(
                "[local-agent-complete] Inline clarification cancel error:",
                cancelError,
              );
            });
            finalClarificationError = inlineResumeReason;
          }
        } else if (callback.ok) {
          const deadlineAtMs = clarifyingTask.clarification_deadline_at
            ? new Date(clarifyingTask.clarification_deadline_at).getTime()
            : Date.now();
          const remainingMs = Math.max(0, deadlineAtMs - Date.now());
          const resolvedTask =
            remainingMs > 0
              ? await waitForAgentClarificationResolution({
                  taskId: clarifyingTask.id,
                  timeoutMs: remainingMs,
                })
              : clarifyingTask;
          if (resolvedTask?.status === "queued" && resolvedTask.computeruse_task_id) {
            resumedTaskId = resolvedTask.computeruse_task_id;
            finalClarificationError = null;
          } else {
            const timeoutReason =
              "Agent clarification timed out after 30 seconds, so OttoAuth canceled the request.";
            await cancelAgentClarificationTask({
              task: clarifyingTask,
              reason: timeoutReason,
              callbackStatus: "timed_out",
            }).catch((timeoutError) => {
              console.error(
                "[local-agent-complete] Clarification timeout cancel error:",
                timeoutError,
              );
            });
            finalClarificationError = timeoutReason;
          }
        } else {
          const callbackFailureReason = callback.error?.trim()
            ? `Agent clarification callback failed: ${callback.error.trim()}`
            : "Agent clarification callback failed, so OttoAuth canceled the request.";
          await cancelAgentClarificationTask({
            task: clarifyingTask,
            reason: callbackFailureReason,
            callbackStatus: "failed",
            callbackHttpStatus: callback.statusCode,
            callbackError: callback.error,
          }).catch((callbackFailureError) => {
            console.error(
              "[local-agent-complete] Clarification callback cancel error:",
              callbackFailureError,
            );
          });
          finalClarificationError = callbackFailureReason;
        }
      } else if (clarifyingTask) {
        const noCallbackReason =
          "Agent clarification callback is not configured, so OttoAuth canceled the request.";
        await cancelAgentClarificationTask({
          task: clarifyingTask,
          reason: noCallbackReason,
          callbackStatus: "failed",
          callbackError: agent ? "Missing clarification question." : "Agent not found for clarification callback.",
        }).catch((cancelError) => {
          console.error(
            "[local-agent-complete] Missing callback cancel error:",
            cancelError,
          );
        });
        finalClarificationError = noCallbackReason;
      }

    }

    if (resumedTaskId) {
      return NextResponse.json(
        {
          ok: true,
          task: {
            id: task.id,
            type: task.type,
            run_id: task.runId,
          },
          local_agent: {
            status: "queued_after_clarification",
            result,
            error: null,
            next_task_id: resumedTaskId,
          },
        },
        { headers: corsHeaders() }
      );
    }

    if (clarifyingTask) {
      const failedClarificationTask = await getGenericBrowserTaskById(clarifyingTask.id).catch(() => null);
      if (failedClarificationTask?.status === "failed") {
        return NextResponse.json(
          {
            ok: true,
            task: {
              id: task.id,
              type: task.type,
              run_id: task.runId,
            },
            local_agent: {
              status: "failed",
              result,
              error: finalClarificationError,
            },
          },
          { headers: corsHeaders() }
        );
      }
    }
  }

  try {
    if (!clarificationRequested) {
      await handleAmazonTaskCompletion({
        taskId: task.id,
        status,
        result,
        error,
      });
    }
  } catch (e) {
    console.error("[local-agent-complete] Amazon fulfillment hook error:", e);
  }

  return NextResponse.json(
    {
      ok: true,
      task: {
        id: task.id,
        type: task.type,
        run_id: task.runId,
      },
      local_agent: {
        status: clarificationRequested ? "awaiting_agent_clarification" : status,
        result,
        error: clarificationRequested ? clarificationQuestion : error,
      },
    },
    { headers: corsHeaders() }
  );
}
