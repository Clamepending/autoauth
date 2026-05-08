import { NextResponse } from "next/server";

import { requireCurrentHumanUser } from "@/lib/human-session";
import {
  normalizeSupportedOfferSearchPayload,
  searchSupportedOffers,
} from "@/lib/supported-offer-search";

export async function POST(request: Request) {
  const user = await requireCurrentHumanUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const payload = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  let input: ReturnType<typeof normalizeSupportedOfferSearchPayload>;
  try {
    input = normalizeSupportedOfferSearchPayload(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid search request." },
      { status: 400 },
    );
  }

  const result = await searchSupportedOffers(input);
  return NextResponse.json({ ok: true, ...result });
}
