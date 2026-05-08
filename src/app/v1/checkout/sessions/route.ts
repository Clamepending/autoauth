import { NextResponse } from "next/server";

import { authenticateOttoAuthAgentRequest } from "@/lib/ottoauth-api-auth";
import {
  checkoutSessionUrl,
  createCheckoutSession,
  createHostedCheckoutSession,
  formatCheckoutSessionForApi,
  isHostedCheckoutPayload,
} from "@/lib/ottoauth-checkout-sessions";
import { sdkOptionsResponse, sdkRequestOrigin, withSdkCors } from "@/lib/ottoauth-sdk";

export const dynamic = "force-dynamic";

export async function OPTIONS(request: Request) {
  return sdkOptionsResponse(request);
}

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!payload) {
    return withSdkCors(
      NextResponse.json({ error: "Invalid JSON body." }, { status: 400 }),
      request,
    );
  }

  try {
    const baseUrl = sdkRequestOrigin(request);
    let session;
    if (isHostedCheckoutPayload(payload)) {
      session = await createHostedCheckoutSession({
        request,
        payload,
        baseUrl,
      });
    } else {
      const auth = await authenticateOttoAuthAgentRequest(request, payload, {
        scope: "checkout.sessions:create",
      });
      if (!auth.ok) return withSdkCors(auth.response, request);
      session = await createCheckoutSession({
        request,
        payload,
        auth,
        baseUrl,
      });
    }
    return withSdkCors(
      NextResponse.json(
        {
          ok: true,
          id: session.id,
          url: checkoutSessionUrl(session, baseUrl),
          session: formatCheckoutSessionForApi(session, baseUrl),
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
            error instanceof Error
              ? error.message
              : "Could not create checkout session.",
        },
        { status: 400 },
      ),
      request,
    );
  }
}
