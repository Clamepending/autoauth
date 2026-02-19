import { NextResponse } from "next/server";
import { getAgentByUsername, type AgentRecord } from "@/lib/db";
import {
  normalizeUsername,
  validateUsername,
  verifyPrivateKey,
} from "@/lib/agent-auth";

type AuthSuccess = { ok: true; agent: AgentRecord; usernameLower: string };
type AuthFailure = { ok: false; response: NextResponse };
export type AuthResult = AuthSuccess | AuthFailure;

/**
 * Authenticate an agent from a parsed request payload.
 * Returns the agent record on success, or a ready-to-return NextResponse on failure.
 */
export async function authenticateAgent(
  payload: Record<string, unknown>,
): Promise<AuthResult> {
  const rawUsername =
    typeof payload.username === "string" ? payload.username.trim() : "";
  const privateKey =
    typeof payload.private_key === "string"
      ? payload.private_key.trim()
      : "";

  const validation = validateUsername(rawUsername);
  if (!validation.ok) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: validation.error },
        { status: 400 },
      ),
    };
  }
  if (!privateKey) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "private_key is required." },
        { status: 400 },
      ),
    };
  }

  const usernameLower = normalizeUsername(rawUsername);
  const agent = await getAgentByUsername(usernameLower);
  if (!agent) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Agent not found." },
        { status: 404 },
      ),
    };
  }
  if (!verifyPrivateKey(privateKey, agent.private_key)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Invalid credentials." },
        { status: 401 },
      ),
    };
  }

  return { ok: true, agent, usernameLower };
}
