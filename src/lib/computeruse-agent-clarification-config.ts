const DEFAULT_AGENT_CLARIFICATION_TIMEOUT_MS = 30_000;

export function getAgentClarificationTimeoutMs() {
  const raw = Number(process.env.OTTOAUTH_AGENT_CLARIFICATION_TIMEOUT_MS ?? "");
  if (!Number.isFinite(raw) || raw <= 0) {
    return DEFAULT_AGENT_CLARIFICATION_TIMEOUT_MS;
  }
  return Math.max(1_000, Math.min(Math.trunc(raw), DEFAULT_AGENT_CLARIFICATION_TIMEOUT_MS));
}

export function makeAgentClarificationDeadline(timeoutMs = getAgentClarificationTimeoutMs()) {
  return new Date(Date.now() + timeoutMs).toISOString();
}
