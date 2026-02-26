export type AgentEventRecord = {
  id: string;
  type: string;
  agent_username: string;
  device_id: string | null;
  created_at: string;
  data: Record<string, unknown>;
};

type AgentEventStore = {
  events: AgentEventRecord[];
};

declare global {
  // eslint-disable-next-line no-var
  var __ottoauthAgentEventStore: AgentEventStore | undefined;
}

function getStore(): AgentEventStore {
  if (!global.__ottoauthAgentEventStore) {
    global.__ottoauthAgentEventStore = { events: [] };
  }
  return global.__ottoauthAgentEventStore;
}

function makeAgentEventId() {
  return `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function emitAgentEvent(params: {
  type: string;
  agentUsername: string;
  deviceId?: string | null;
  data?: Record<string, unknown>;
}) {
  const type = String(params.type || "").trim();
  const agentUsername = String(params.agentUsername || "").trim().toLowerCase();
  if (!type) throw new Error("event type is required");
  if (!agentUsername) throw new Error("agentUsername is required");

  const event: AgentEventRecord = {
    id: makeAgentEventId(),
    type,
    agent_username: agentUsername,
    device_id: params.deviceId?.trim() || null,
    created_at: new Date().toISOString(),
    data: params.data ?? {},
  };

  const store = getStore();
  store.events.push(event);
  return event;
}

export function listAgentEvents(params?: {
  agentUsername?: string;
  limit?: number;
}) {
  const store = getStore();
  const limit = Math.max(1, Math.min(params?.limit ?? 50, 500));
  const username = params?.agentUsername?.trim().toLowerCase();

  const filtered = username
    ? store.events.filter((evt) => evt.agent_username === username)
    : store.events;

  return [...filtered].slice(-limit).reverse();
}

export function getAgentEventById(id: string) {
  const needle = id.trim();
  if (!needle) return null;
  const store = getStore();
  return store.events.find((evt) => evt.id === needle) ?? null;
}

export function clearAgentEventsForTests() {
  getStore().events = [];
}
