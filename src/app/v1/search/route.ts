import { NextResponse } from "next/server";

import {
  authenticateOrderAgentFromRequest,
  readJsonObject,
  responseFromOrderError,
} from "@/lib/order-api";
import {
  normalizeSupportedOfferSearchPayload,
  searchSupportedOffers,
} from "@/lib/supported-offer-search";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const body = await readJsonObject(request);
  if (!body.ok) return body.response;

  const auth = await authenticateOrderAgentFromRequest(request, body.payload, {
    scope: "offers:read",
  });
  if (!auth.ok) return auth.response;

  let input: ReturnType<typeof normalizeSupportedOfferSearchPayload>;
  try {
    input = normalizeSupportedOfferSearchPayload(body.payload);
  } catch (error) {
    return responseFromOrderError(error, 400);
  }

  const result = await searchSupportedOffers(input);
  return NextResponse.json({ ok: true, ...result });
}
