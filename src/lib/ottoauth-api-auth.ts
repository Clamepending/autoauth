import { NextResponse } from "next/server";

import { getAgentByPrivateKey, type AgentRecord } from "@/lib/db";
import { authenticateAgent } from "@/services/_shared/auth";
import {
  getActiveSdkInstallForBearer,
  sdkInstallHasScope,
  sdkInstallScopeResponse,
  type SdkAppInstallTokenRecord,
  type SdkInstallScope,
} from "@/lib/ottoauth-connect";

export type OttoAuthAgentAuthSuccess = {
  ok: true;
  agent: AgentRecord;
  usernameLower: string;
  source: "bearer" | "body" | "install";
  install?: SdkAppInstallTokenRecord | null;
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
  options?: { scope?: SdkInstallScope },
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
      const install = await getActiveSdkInstallForBearer({
        agentId: agent.id,
        token,
      });
      if (options?.scope && install && !sdkInstallHasScope(install, options.scope)) {
        return {
          ok: false,
          response: sdkInstallScopeResponse(options.scope),
        };
      }
      return {
        ok: true,
        agent,
        usernameLower: agent.username_lower,
        source: install ? "install" : "bearer",
        install,
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
