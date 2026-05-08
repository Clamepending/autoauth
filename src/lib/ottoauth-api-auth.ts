import { NextResponse } from "next/server";

import { getAgentByPrivateKey, type AgentRecord } from "@/lib/db";
import { authenticateAgent } from "@/services/_shared/auth";

export type OttoAuthAgentAuthSuccess = {
  ok: true;
  agent: AgentRecord;
  usernameLower: string;
  source: "bearer" | "body";
};

export type OttoAuthAgentAuthFailure = {
  ok: false;
  response: NextResponse;
};

export type OttoAuthAgentAuthResult =
  | OttoAuthAgentAuthSuccess
  | OttoAuthAgentAuthFailure;

function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^\s*Bearer\s+(.+?)\s*$/i);
  return match?.[1]?.trim() || "";
}

function normalizeLegacyCredentialPayload(payload: Record<string, unknown>) {
  const normalized = { ...payload };
  if (
    typeof normalized.private_key !== "string" &&
    typeof normalized.privateKey === "string"
  ) {
    normalized.private_key = normalized.privateKey;
  }
  return normalized;
}

export async function authenticateOttoAuthAgentRequest(
  request: Request,
  payload?: Record<string, unknown> | null,
): Promise<OttoAuthAgentAuthResult> {
  const token = bearerToken(request);
  if (token) {
    try {
      const agent = await getAgentByPrivateKey(token);
      if (!agent) {
        return {
          ok: false,
          response: NextResponse.json(
            { error: "Invalid bearer token." },
            { status: 401 },
          ),
        };
      }
      return {
        ok: true,
        agent,
        usernameLower: agent.username_lower,
        source: "bearer",
      };
    } catch {
      return {
        ok: false,
        response: NextResponse.json(
          { error: "Invalid bearer token." },
          { status: 401 },
        ),
      };
    }
  }

  if (!payload) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Authorization bearer token is required." },
        { status: 401 },
      ),
    };
  }

  const auth = await authenticateAgent(normalizeLegacyCredentialPayload(payload));
  if (!auth.ok) return auth;
  return { ...auth, source: "body" };
}
