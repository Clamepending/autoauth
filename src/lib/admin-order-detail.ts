import {
  getComputerUseRunById,
  listComputerUseRunEvents,
  type ComputerUseRunEvent,
  type ComputerUseRunRecord,
} from "@/lib/computeruse-runs";
import {
  getComputerUseTaskById,
  type ComputerUseTaskRecord,
} from "@/lib/computeruse-store";
import {
  listGenericBrowserTaskSnapshots,
  type GenericBrowserTaskRecord,
  type GenericBrowserTaskSnapshotRecord,
} from "@/lib/generic-browser-tasks";
import {
  getHumanUserById,
  type HumanUserRecord,
} from "@/lib/human-accounts";
import { resolveAdminOrderTask } from "@/lib/admin-order-actions";

export type AdminOrderDetailData = {
  generated_at: string;
  task: GenericBrowserTaskRecord;
  requester: HumanUserRecord | null;
  fulfiller: HumanUserRecord | null;
  run: ComputerUseRunRecord | null;
  computeruseTask: ComputerUseTaskRecord | null;
  runEvents: ComputerUseRunEvent[];
  snapshots: GenericBrowserTaskSnapshotRecord[];
  debugBundle: string;
};

function parseJson(value: string | null) {
  if (!value) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function stringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function redactSnapshot(snapshot: GenericBrowserTaskSnapshotRecord) {
  return {
    id: snapshot.id,
    task_id: snapshot.task_id,
    run_id: snapshot.run_id,
    computeruse_task_id: snapshot.computeruse_task_id,
    device_id: snapshot.device_id,
    width: snapshot.width,
    height: snapshot.height,
    tabs: snapshot.tabs,
    created_at: snapshot.created_at,
    image_base64_omitted: true,
    approximate_image_bytes: Math.round((snapshot.image_base64.length * 3) / 4),
  };
}

function taskForDebug(task: GenericBrowserTaskRecord) {
  const { result_json, usage_json, ...rest } = task;
  return {
    ...rest,
    result: parseJson(result_json),
    usage: parseJson(usage_json),
  };
}

export function buildAdminOrderDebugBundle(params: {
  generatedAt: string;
  task: GenericBrowserTaskRecord;
  requester: HumanUserRecord | null;
  fulfiller: HumanUserRecord | null;
  run: ComputerUseRunRecord | null;
  computeruseTask: ComputerUseTaskRecord | null;
  runEvents: ComputerUseRunEvent[];
  snapshots: GenericBrowserTaskSnapshotRecord[];
}) {
  const eventTypes = params.runEvents.map((event) => event.type);
  const bundle = {
    generated_at: params.generatedAt,
    order_id: params.task.id,
    status: params.task.status,
    event_types: eventTypes,
    order: taskForDebug(params.task),
    requester: params.requester
      ? {
          id: params.requester.id,
          email: params.requester.email,
          display_name: params.requester.display_name,
          created_at: params.requester.created_at,
        }
      : null,
    fulfiller: params.fulfiller
      ? {
          id: params.fulfiller.id,
          email: params.fulfiller.email,
          display_name: params.fulfiller.display_name,
          created_at: params.fulfiller.created_at,
        }
      : null,
    computeruse_run: params.run,
    computeruse_task: params.computeruseTask,
    run_events_oldest_first: params.runEvents,
    snapshots_latest_first: params.snapshots.map(redactSnapshot),
  };

  return `# OttoAuth Admin Order Debug Bundle

Generated: ${params.generatedAt}
Order: #${params.task.id}
Status: ${params.task.status}

## Suggested Codex Prompt

Please debug OttoAuth order #${params.task.id}. Use the structured bundle below to inspect the order state, computer-use task, run events, result/error payloads, clarification state, and snapshot tab metadata. Identify the most likely failure or stuck point and suggest the smallest safe code or operational fix.

## Structured Bundle

\`\`\`json
${stringify(bundle)}
\`\`\`
`;
}

export async function getAdminOrderDetailData(taskIdRaw: string): Promise<AdminOrderDetailData | null> {
  const task = await resolveAdminOrderTask(taskIdRaw);
  if (!task) return null;

  const generatedAt = new Date().toISOString();
  const [requester, fulfiller, run, snapshots] = await Promise.all([
    getHumanUserById(task.human_user_id),
    task.fulfiller_human_user_id == null
      ? Promise.resolve(null)
      : getHumanUserById(task.fulfiller_human_user_id),
    task.run_id ? getComputerUseRunById(task.run_id) : Promise.resolve(null),
    listGenericBrowserTaskSnapshots(task.id, 12),
  ]);
  const [runEvents, computeruseTask] = await Promise.all([
    task.run_id ? listComputerUseRunEvents({ runId: task.run_id, limit: 500 }) : Promise.resolve([]),
    task.computeruse_task_id
      ? getComputerUseTaskById(task.computeruse_task_id)
      : run?.current_task_id
        ? getComputerUseTaskById(run.current_task_id)
        : Promise.resolve(null),
  ]);
  const oldestFirstEvents = [...runEvents].reverse();
  const debugBundle = buildAdminOrderDebugBundle({
    generatedAt,
    task,
    requester,
    fulfiller,
    run,
    computeruseTask,
    runEvents: oldestFirstEvents,
    snapshots,
  });

  return {
    generated_at: generatedAt,
    task,
    requester,
    fulfiller,
    run,
    computeruseTask,
    runEvents: oldestFirstEvents,
    snapshots,
    debugBundle,
  };
}
