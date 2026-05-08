import { NextResponse } from "next/server";

import {
  exchangeSdkConnectCode,
  formatInstallTokenForApi,
} from "@/lib/ottoauth-connect";
import { sdkOptionsResponse, withSdkCors } from "@/lib/ottoauth-sdk";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request) {
  return sdkOptionsResponse(request);
}

function stringField(payload: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) {
    return withSdkCors(
      NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }),
      request,
    );
  }

  try {
    const exchanged = await exchangeSdkConnectCode({
      code: stringField(payload, "code"),
      codeVerifier: stringField(payload, "code_verifier", "codeVerifier"),
      installId: stringField(payload, "install_id", "installId"),
    });
    return withSdkCors(
      NextResponse.json(formatInstallTokenForApi(exchanged)),
      request,
    );
  } catch (error) {
    return withSdkCors(
      NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Could not exchange connect code.",
        },
        { status: 400 },
      ),
      request,
    );
  }
}
