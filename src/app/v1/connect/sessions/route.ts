import { NextResponse } from "next/server";

import {
  connectUrl,
  createSdkConnectSession,
  formatConnectSessionForApi,
} from "@/lib/ottoauth-connect";
import { sdkOptionsResponse, sdkRequestOrigin, withSdkCors } from "@/lib/ottoauth-sdk";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request) {
  return sdkOptionsResponse(request);
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
    const baseUrl = sdkRequestOrigin(request);
    const session = await createSdkConnectSession({ payload, baseUrl });
    return withSdkCors(
      NextResponse.json(
        {
          ok: true,
          id: session.id,
          connect_url: connectUrl(session, baseUrl),
          session: formatConnectSessionForApi(session, baseUrl),
        },
        { status: 201 },
      ),
      request,
    );
  } catch (error) {
    return withSdkCors(
      NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : "Could not create connect session.",
        },
        { status: 400 },
      ),
      request,
    );
  }
}
