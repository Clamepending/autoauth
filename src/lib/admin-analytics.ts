import { getAgentRequestsForAdmin, getAllAgents } from "@/lib/db";
import { ensureComputerUseTransportSchema } from "@/lib/computeruse-store";
import { ensureGenericBrowserTaskSchema } from "@/lib/generic-browser-tasks";
import { ensureHumanAccountSchema } from "@/lib/human-accounts";
import { getTursoClient } from "@/lib/turso";

type RawRow = Record<string, unknown>;

export type AdminMetricSummary = {
  humans_total: number;
  humans_24h: number;
  humans_7d: number;
  humans_30d: number;
  agents_total: number;
  linked_agent_keys: number;
  orders_total: number;
  orders_24h: number;
  orders_7d: number;
  active_orders: number;
  completed_orders: number;
  failed_orders: number;
  failed_24h: number;
  stuck_orders: number;
  clarification_orders: number;
  callback_failures: number;
  avg_minutes_to_complete: number;
  total_debited_cents: number;
  debited_7d_cents: number;
  outstanding_balance_cents: number;
  total_credit_cents: number;
  device_total: number;
  device_claimed: number;
  device_marketplace: number;
  device_online: number;
  computeruse_queued: number;
  computeruse_delivered: number;
  computeruse_failed_24h: number;
  pending_requests: number;
  notify_failed_requests: number;
};

export type AdminDailyBucket = {
  day: string;
  signups: number;
  orders: number;
  completed: number;
  failed: number;
  active: number;
  debited_cents: number;
};

export type AdminOrderRow = {
  id: number;
  title: string;
  prompt: string;
  status: string;
  submission_source: string;
  human_user_id: number;
  human_label: string;
  agent_username_lower: string;
  agent_id: number;
  device_id: string;
  fulfiller_human_user_id: number | null;
  website_url: string | null;
  max_charge_cents: number | null;
  total_cents: number;
  billing_status: string;
  payout_status: string;
  clarification_callback_status: string;
  summary: string | null;
  error: string | null;
  run_id: string | null;
  computeruse_task_id: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  age_minutes: number;
  updated_minutes_ago: number;
  issue_flags: string[];
  can_restart: boolean;
};

export type AdminSignupRow = {
  id: number;
  label: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  linked_agents: number;
  balance_cents: number;
  orders: number;
  failed_orders: number;
  last_order_at: string | null;
};

export type AdminDeviceRow = {
  device_id: string;
  owner_label: string;
  label: string | null;
  marketplace_enabled: boolean;
  online: boolean;
  last_seen_at: string | null;
  paired_at: string;
  updated_at: string;
  queued_tasks: number;
  delivered_tasks: number;
  failed_tasks_24h: number;
};

export type AdminAgentRow = {
  id: number;
  username_lower: string;
  username_display: string;
  callback_url: string | null;
  linked_humans: number;
  order_count: number;
  failed_orders: number;
  total_spent_cents: number;
  last_order_at: string | null;
  created_at: string;
};

export type AdminControlPlaneData = {
  generated_at: string;
  summary: AdminMetricSummary;
  daily: AdminDailyBucket[];
  status_counts: Array<{ status: string; count: number }>;
  source_counts: Array<{ source: string; count: number }>;
  recent_orders: AdminOrderRow[];
  problem_orders: AdminOrderRow[];
  recent_signups: AdminSignupRow[];
  devices: AdminDeviceRow[];
  top_agents: AdminAgentRow[];
  requests: Awaited<ReturnType<typeof getAgentRequestsForAdmin>>;
};

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function asString(value: unknown) {
  return value == null ? "" : String(value);
}

function asNullableString(value: unknown) {
  const next = asString(value).trim();
  return next ? next : null;
}

function firstRow(rows: unknown[] | undefined): RawRow {
  return ((rows ?? [])[0] ?? {}) as RawRow;
}

function isoMinutesAgo(value: string | null, nowMs: number) {
  if (!value) return 0;
  const parsed = new Date(value).getTime();
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.round((nowMs - parsed) / 60000));
}

function formatHumanLabel(row: RawRow) {
  const displayName = asNullableString(row.human_display_name);
  const email = asNullableString(row.human_email);
  const userId = asNumber(row.human_user_id || row.id);
  return displayName || email || (userId ? `Human #${userId}` : "Unknown human");
}

function getIssueFlags(row: RawRow, nowMs: number) {
  const status = asString(row.status);
  const updatedMinutesAgo = isoMinutesAgo(asNullableString(row.updated_at), nowMs);
  const flags: string[] = [];

  if (status === "failed") flags.push("Failed");
  if (status === "awaiting_agent_clarification") flags.push("Needs clarification");
  if (["queued", "running"].includes(status) && updatedMinutesAgo >= 30) {
    flags.push("Stuck >30m");
  }
  if (asString(row.clarification_callback_status) === "failed") {
    flags.push("Callback failed");
  }
  if (status === "completed" && Number(row.total_cents ?? 0) > 0) {
    const result = asNullableString(row.result_json);
    if (!result || (!result.includes("pickup") && !result.includes("tracking") && !result.includes("order"))) {
      flags.push("Sparse fulfillment details");
    }
  }

  return flags;
}

function mapOrderRow(row: RawRow, nowMs: number): AdminOrderRow {
  const title =
    asNullableString(row.task_title) ||
    asString(row.task_prompt).slice(0, 80) ||
    `Order #${asNumber(row.id)}`;
  const issueFlags = getIssueFlags(row, nowMs);
  const status = asString(row.status) || "queued";
  return {
    id: asNumber(row.id),
    title,
    prompt: asString(row.task_prompt),
    status,
    submission_source: asString(row.submission_source) || "agent",
    human_user_id: asNumber(row.human_user_id),
    human_label: formatHumanLabel(row),
    agent_username_lower: asString(row.agent_username_lower),
    agent_id: asNumber(row.agent_id),
    device_id: asString(row.device_id),
    fulfiller_human_user_id:
      row.fulfiller_human_user_id == null ? null : asNumber(row.fulfiller_human_user_id),
    website_url: asNullableString(row.website_url),
    max_charge_cents: row.max_charge_cents == null ? null : asNumber(row.max_charge_cents),
    total_cents: asNumber(row.total_cents),
    billing_status: asString(row.billing_status),
    payout_status: asString(row.payout_status),
    clarification_callback_status: asString(row.clarification_callback_status),
    summary: asNullableString(row.summary),
    error: asNullableString(row.error),
    run_id: asNullableString(row.run_id),
    computeruse_task_id: asNullableString(row.computeruse_task_id),
    created_at: asString(row.created_at),
    updated_at: asString(row.updated_at),
    completed_at: asNullableString(row.completed_at),
    age_minutes: isoMinutesAgo(asNullableString(row.created_at), nowMs),
    updated_minutes_ago: isoMinutesAgo(asNullableString(row.updated_at), nowMs),
    issue_flags: issueFlags,
    can_restart: status !== "completed",
  };
}

function emptySummary(): AdminMetricSummary {
  return {
    humans_total: 0,
    humans_24h: 0,
    humans_7d: 0,
    humans_30d: 0,
    agents_total: 0,
    linked_agent_keys: 0,
    orders_total: 0,
    orders_24h: 0,
    orders_7d: 0,
    active_orders: 0,
    completed_orders: 0,
    failed_orders: 0,
    failed_24h: 0,
    stuck_orders: 0,
    clarification_orders: 0,
    callback_failures: 0,
    avg_minutes_to_complete: 0,
    total_debited_cents: 0,
    debited_7d_cents: 0,
    outstanding_balance_cents: 0,
    total_credit_cents: 0,
    device_total: 0,
    device_claimed: 0,
    device_marketplace: 0,
    device_online: 0,
    computeruse_queued: 0,
    computeruse_delivered: 0,
    computeruse_failed_24h: 0,
    pending_requests: 0,
    notify_failed_requests: 0,
  };
}

export async function getAdminControlPlaneData(): Promise<AdminControlPlaneData> {
  await Promise.all([
    ensureHumanAccountSchema(),
    ensureGenericBrowserTaskSchema(),
    ensureComputerUseTransportSchema(),
  ]);

  const client = getTursoClient();
  const now = Date.now();
  const generatedAt = new Date(now).toISOString();
  const cutoff24h = new Date(now - 24 * 60 * 60 * 1000).toISOString();
  const cutoff7d = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const cutoff30d = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
  const cutoff14d = new Date(now - 13 * 24 * 60 * 60 * 1000).toISOString();
  const cutoffOnline = new Date(now - 10 * 60 * 1000).toISOString();
  const cutoffStuck = new Date(now - 30 * 60 * 1000).toISOString();

  const [
    humanMetricsResult,
    agentMetricsResult,
    orderMetricsResult,
    ledgerMetricsResult,
    deviceMetricsResult,
    computerUseMetricsResult,
    statusCountsResult,
    sourceCountsResult,
    orderDailyResult,
    signupDailyResult,
    recentOrdersResult,
    problemOrdersResult,
    recentSignupsResult,
    devicesResult,
    topAgentsResult,
    agents,
    requests,
  ] = await Promise.all([
    client.execute({
      sql: `SELECT
              COUNT(*) AS humans_total,
              SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS humans_24h,
              SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS humans_7d,
              SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS humans_30d
            FROM human_users`,
      args: [cutoff24h, cutoff7d, cutoff30d],
    }),
    client.execute({
      sql: `SELECT COUNT(*) AS linked_agent_keys
            FROM human_agent_links`,
      args: [],
    }),
    client.execute({
      sql: `SELECT
              COUNT(*) AS orders_total,
              SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS orders_24h,
              SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS orders_7d,
              SUM(CASE WHEN status IN ('queued', 'running', 'awaiting_agent_clarification') THEN 1 ELSE 0 END) AS active_orders,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_orders,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_orders,
              SUM(CASE WHEN status = 'failed' AND updated_at >= ? THEN 1 ELSE 0 END) AS failed_24h,
              SUM(CASE WHEN status IN ('queued', 'running') AND updated_at < ? THEN 1 ELSE 0 END) AS stuck_orders,
              SUM(CASE WHEN status = 'awaiting_agent_clarification' THEN 1 ELSE 0 END) AS clarification_orders,
              SUM(CASE WHEN clarification_callback_status = 'failed' THEN 1 ELSE 0 END) AS callback_failures,
              COALESCE(AVG(CASE WHEN completed_at IS NOT NULL THEN (julianday(completed_at) - julianday(created_at)) * 24 * 60 END), 0) AS avg_minutes_to_complete,
              COALESCE(SUM(total_cents), 0) AS total_debited_cents,
              COALESCE(SUM(CASE WHEN created_at >= ? THEN total_cents ELSE 0 END), 0) AS debited_7d_cents
            FROM generic_browser_tasks`,
      args: [cutoff24h, cutoff7d, cutoff24h, cutoffStuck, cutoff7d],
    }),
    client.execute({
      sql: `SELECT
              COALESCE(SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END), 0) AS total_credit_cents,
              COALESCE(SUM(amount_cents), 0) AS outstanding_balance_cents
            FROM credit_ledger`,
      args: [],
    }),
    client.execute({
      sql: `SELECT
              COUNT(*) AS device_total,
              SUM(CASE WHEN human_user_id IS NOT NULL THEN 1 ELSE 0 END) AS device_claimed,
              SUM(CASE WHEN marketplace_enabled = 1 THEN 1 ELSE 0 END) AS device_marketplace,
              SUM(CASE WHEN last_seen_at >= ? THEN 1 ELSE 0 END) AS device_online
            FROM computeruse_devices`,
      args: [cutoffOnline],
    }),
    client.execute({
      sql: `SELECT
              SUM(CASE WHEN status = 'queued' THEN 1 ELSE 0 END) AS computeruse_queued,
              SUM(CASE WHEN status = 'delivered' THEN 1 ELSE 0 END) AS computeruse_delivered,
              SUM(CASE WHEN status = 'failed' AND updated_at >= ? THEN 1 ELSE 0 END) AS computeruse_failed_24h
            FROM computeruse_tasks`,
      args: [cutoff24h],
    }),
    client.execute({
      sql: `SELECT status, COUNT(*) AS count
            FROM generic_browser_tasks
            GROUP BY status
            ORDER BY count DESC`,
      args: [],
    }),
    client.execute({
      sql: `SELECT submission_source AS source, COUNT(*) AS count
            FROM generic_browser_tasks
            GROUP BY submission_source
            ORDER BY count DESC`,
      args: [],
    }),
    client.execute({
      sql: `SELECT
              substr(created_at, 1, 10) AS day,
              COUNT(*) AS orders,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
              SUM(CASE WHEN status IN ('queued', 'running', 'awaiting_agent_clarification') THEN 1 ELSE 0 END) AS active,
              COALESCE(SUM(total_cents), 0) AS debited_cents
            FROM generic_browser_tasks
            WHERE created_at >= ?
            GROUP BY day
            ORDER BY day ASC`,
      args: [cutoff14d],
    }),
    client.execute({
      sql: `SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS signups
            FROM human_users
            WHERE created_at >= ?
            GROUP BY day
            ORDER BY day ASC`,
      args: [cutoff14d],
    }),
    client.execute({
      sql: `SELECT t.*, u.email AS human_email, u.display_name AS human_display_name
            FROM generic_browser_tasks t
            LEFT JOIN human_users u ON u.id = t.human_user_id
            ORDER BY t.created_at DESC
            LIMIT 80`,
      args: [],
    }),
    client.execute({
      sql: `SELECT t.*, u.email AS human_email, u.display_name AS human_display_name
            FROM generic_browser_tasks t
            LEFT JOIN human_users u ON u.id = t.human_user_id
            WHERE t.status = 'failed'
               OR t.status = 'awaiting_agent_clarification'
               OR (t.status IN ('queued', 'running') AND t.updated_at < ?)
               OR t.clarification_callback_status = 'failed'
            ORDER BY t.updated_at DESC
            LIMIT 40`,
      args: [cutoffStuck],
    }),
    client.execute({
      sql: `SELECT
              u.id,
              u.email,
              u.display_name,
              u.created_at,
              (SELECT COUNT(*) FROM human_agent_links l WHERE l.human_user_id = u.id) AS linked_agents,
              (SELECT COALESCE(SUM(c.amount_cents), 0) FROM credit_ledger c WHERE c.human_user_id = u.id) AS balance_cents,
              (SELECT COUNT(*) FROM generic_browser_tasks t WHERE t.human_user_id = u.id) AS orders,
              (SELECT COUNT(*) FROM generic_browser_tasks t WHERE t.human_user_id = u.id AND t.status = 'failed') AS failed_orders,
              (SELECT MAX(t.created_at) FROM generic_browser_tasks t WHERE t.human_user_id = u.id) AS last_order_at
            FROM human_users u
            ORDER BY u.created_at DESC
            LIMIT 20`,
      args: [],
    }),
    client.execute({
      sql: `SELECT
              d.device_id,
              d.label,
              d.marketplace_enabled,
              d.last_seen_at,
              d.paired_at,
              d.updated_at,
              u.email AS human_email,
              u.display_name AS human_display_name,
              u.id AS human_user_id,
              SUM(CASE WHEN ct.status = 'queued' THEN 1 ELSE 0 END) AS queued_tasks,
              SUM(CASE WHEN ct.status = 'delivered' THEN 1 ELSE 0 END) AS delivered_tasks,
              SUM(CASE WHEN ct.status = 'failed' AND ct.updated_at >= ? THEN 1 ELSE 0 END) AS failed_tasks_24h
            FROM computeruse_devices d
            LEFT JOIN human_users u ON u.id = d.human_user_id
            LEFT JOIN computeruse_tasks ct ON ct.device_id = d.device_id
            GROUP BY d.device_id
            ORDER BY d.updated_at DESC
            LIMIT 40`,
      args: [cutoff24h],
    }),
    client.execute({
      sql: `SELECT
              a.id,
              a.username_lower,
              a.username_display,
              a.callback_url,
              a.created_at,
              (SELECT COUNT(*) FROM human_agent_links l WHERE l.agent_id = a.id) AS linked_humans,
              (SELECT COUNT(*) FROM generic_browser_tasks t WHERE t.agent_id = a.id) AS order_count,
              (SELECT COUNT(*) FROM generic_browser_tasks t WHERE t.agent_id = a.id AND t.status = 'failed') AS failed_orders,
              (SELECT COALESCE(SUM(t.total_cents), 0) FROM generic_browser_tasks t WHERE t.agent_id = a.id) AS total_spent_cents,
              (SELECT MAX(t.created_at) FROM generic_browser_tasks t WHERE t.agent_id = a.id) AS last_order_at
            FROM agents a
            ORDER BY order_count DESC, a.created_at DESC
            LIMIT 12`,
      args: [],
    }),
    getAllAgents(),
    getAgentRequestsForAdmin(),
  ]);

  const summary = emptySummary();
  const humanMetrics = firstRow(humanMetricsResult.rows);
  const agentMetrics = firstRow(agentMetricsResult.rows);
  const orderMetrics = firstRow(orderMetricsResult.rows);
  const ledgerMetrics = firstRow(ledgerMetricsResult.rows);
  const deviceMetrics = firstRow(deviceMetricsResult.rows);
  const computerUseMetrics = firstRow(computerUseMetricsResult.rows);

  Object.assign(summary, {
    humans_total: asNumber(humanMetrics.humans_total),
    humans_24h: asNumber(humanMetrics.humans_24h),
    humans_7d: asNumber(humanMetrics.humans_7d),
    humans_30d: asNumber(humanMetrics.humans_30d),
    agents_total: agents.length,
    linked_agent_keys: asNumber(agentMetrics.linked_agent_keys),
    orders_total: asNumber(orderMetrics.orders_total),
    orders_24h: asNumber(orderMetrics.orders_24h),
    orders_7d: asNumber(orderMetrics.orders_7d),
    active_orders: asNumber(orderMetrics.active_orders),
    completed_orders: asNumber(orderMetrics.completed_orders),
    failed_orders: asNumber(orderMetrics.failed_orders),
    failed_24h: asNumber(orderMetrics.failed_24h),
    stuck_orders: asNumber(orderMetrics.stuck_orders),
    clarification_orders: asNumber(orderMetrics.clarification_orders),
    callback_failures: asNumber(orderMetrics.callback_failures),
    avg_minutes_to_complete: asNumber(orderMetrics.avg_minutes_to_complete),
    total_debited_cents: asNumber(orderMetrics.total_debited_cents),
    debited_7d_cents: asNumber(orderMetrics.debited_7d_cents),
    outstanding_balance_cents: asNumber(ledgerMetrics.outstanding_balance_cents),
    total_credit_cents: asNumber(ledgerMetrics.total_credit_cents),
    device_total: asNumber(deviceMetrics.device_total),
    device_claimed: asNumber(deviceMetrics.device_claimed),
    device_marketplace: asNumber(deviceMetrics.device_marketplace),
    device_online: asNumber(deviceMetrics.device_online),
    computeruse_queued: asNumber(computerUseMetrics.computeruse_queued),
    computeruse_delivered: asNumber(computerUseMetrics.computeruse_delivered),
    computeruse_failed_24h: asNumber(computerUseMetrics.computeruse_failed_24h),
    pending_requests: requests.filter((request) => request.status === "pending").length,
    notify_failed_requests: requests.filter((request) => request.status === "notify_failed").length,
  });

  const signupDaily = new Map<string, number>();
  const orderDaily = new Map<string, Omit<AdminDailyBucket, "day" | "signups">>();
  ((signupDailyResult.rows ?? []) as unknown as RawRow[]).forEach((row) => {
    signupDaily.set(asString(row.day), asNumber(row.signups));
  });
  ((orderDailyResult.rows ?? []) as unknown as RawRow[]).forEach((row) => {
    orderDaily.set(asString(row.day), {
      orders: asNumber(row.orders),
      completed: asNumber(row.completed),
      failed: asNumber(row.failed),
      active: asNumber(row.active),
      debited_cents: asNumber(row.debited_cents),
    });
  });
  const daily: AdminDailyBucket[] = Array.from({ length: 14 }, (_, index) => {
    const day = new Date(now - (13 - index) * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const orders = orderDaily.get(day);
    return {
      day,
      signups: signupDaily.get(day) ?? 0,
      orders: orders?.orders ?? 0,
      completed: orders?.completed ?? 0,
      failed: orders?.failed ?? 0,
      active: orders?.active ?? 0,
      debited_cents: orders?.debited_cents ?? 0,
    };
  });

  const mapCountRows = (rows: unknown[] | undefined, key: "status" | "source") =>
    ((rows ?? []) as unknown as RawRow[]).map((row) => ({
      [key]: asString(row[key]) || "unknown",
      count: asNumber(row.count),
    })) as Array<{ status: string; count: number }> | Array<{ source: string; count: number }>;

  return {
    generated_at: generatedAt,
    summary,
    daily,
    status_counts: mapCountRows(statusCountsResult.rows, "status") as Array<{
      status: string;
      count: number;
    }>,
    source_counts: mapCountRows(sourceCountsResult.rows, "source") as Array<{
      source: string;
      count: number;
    }>,
    recent_orders: ((recentOrdersResult.rows ?? []) as unknown as RawRow[]).map((row) =>
      mapOrderRow(row, now),
    ),
    problem_orders: ((problemOrdersResult.rows ?? []) as unknown as RawRow[]).map((row) =>
      mapOrderRow(row, now),
    ),
    recent_signups: ((recentSignupsResult.rows ?? []) as unknown as RawRow[]).map((row) => ({
      id: asNumber(row.id),
      label: asNullableString(row.display_name) || asNullableString(row.email) || `Human #${asNumber(row.id)}`,
      email: asNullableString(row.email),
      display_name: asNullableString(row.display_name),
      created_at: asString(row.created_at),
      linked_agents: asNumber(row.linked_agents),
      balance_cents: asNumber(row.balance_cents),
      orders: asNumber(row.orders),
      failed_orders: asNumber(row.failed_orders),
      last_order_at: asNullableString(row.last_order_at),
    })),
    devices: ((devicesResult.rows ?? []) as unknown as RawRow[]).map((row) => ({
      device_id: asString(row.device_id),
      owner_label: formatHumanLabel(row),
      label: asNullableString(row.label),
      marketplace_enabled: Boolean(asNumber(row.marketplace_enabled)),
      online:
        asNullableString(row.last_seen_at) != null &&
        new Date(asString(row.last_seen_at)).getTime() >= new Date(cutoffOnline).getTime(),
      last_seen_at: asNullableString(row.last_seen_at),
      paired_at: asString(row.paired_at),
      updated_at: asString(row.updated_at),
      queued_tasks: asNumber(row.queued_tasks),
      delivered_tasks: asNumber(row.delivered_tasks),
      failed_tasks_24h: asNumber(row.failed_tasks_24h),
    })),
    top_agents: ((topAgentsResult.rows ?? []) as unknown as RawRow[]).map((row) => ({
      id: asNumber(row.id),
      username_lower: asString(row.username_lower),
      username_display: asString(row.username_display),
      callback_url: asNullableString(row.callback_url),
      linked_humans: asNumber(row.linked_humans),
      order_count: asNumber(row.order_count),
      failed_orders: asNumber(row.failed_orders),
      total_spent_cents: asNumber(row.total_spent_cents),
      last_order_at: asNullableString(row.last_order_at),
      created_at: asString(row.created_at),
    })),
    requests,
  };
}
