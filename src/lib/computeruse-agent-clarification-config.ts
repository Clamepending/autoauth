const DEFAULT_AGENT_CLARIFICATION_TIMEOUT_MS = 600_000;

export function getAgentClarificationTimeoutSeconds() {
  return Math.ceil(getAgentClarificationTimeoutMs() / 1000);
}

export function getAgentClarificationTimeoutLabel() {
  const totalSeconds = getAgentClarificationTimeoutSeconds();
  if (totalSeconds % 60 === 0) {
    const minutes = totalSeconds / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${totalSeconds} second${totalSeconds === 1 ? "" : "s"}`;
}

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
