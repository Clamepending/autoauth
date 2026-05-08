import { NextResponse } from "next/server";

import { confirmCheckoutSession } from "@/lib/ottoauth-checkout-sessions";
import { sdkRequestOrigin } from "@/lib/ottoauth-sdk";

type Props = {
  params: {
    sessionId: string;
  };
};

function checkoutErrorUrl(request: Request, sessionId: string, error: string) {
  const url = new URL(`/checkout/${encodeURIComponent(sessionId)}`, sdkRequestOrigin(request));
  url.searchParams.set("error", error.slice(0, 500));
  return url;
}

function parseSpendCapCents(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim().replace(/^\$/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) {
    throw new Error("Spend cap must be a valid dollar amount.");
  }
  const [dollars, cents = ""] = normalized.split(".");
  const parsed =
    Number.parseInt(dollars, 10) * 100 +
    Number.parseInt(cents.padEnd(2, "0") || "0", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("Spend cap must be greater than $0.00.");
  }
  return parsed;
}

export async function POST(request: Request, { params }: Props) {
  let maxChargeCents: number | null = null;
  try {
    const formData = await request.formData();
    maxChargeCents = parseSpendCapCents(formData.get("max_charge_usd"));
  } catch (error) {
    return NextResponse.redirect(
      checkoutErrorUrl(
        request,
        params.sessionId,
        error instanceof Error ? error.message : "Invalid spend cap.",
      ),
      { status: 303 },
    );
  }

  const confirmed = await confirmCheckoutSession({
    request,
    sessionId: params.sessionId,
    baseUrl: sdkRequestOrigin(request),
    maxChargeCents,
  });
  if (!confirmed.ok) {
    if (confirmed.status === 401) {
      return NextResponse.redirect(
        new URL(
          `/login?returnTo=${encodeURIComponent(`/checkout/${params.sessionId}`)}`,
          sdkRequestOrigin(request),
        ),
        { status: 303 },
      );
    }
    return NextResponse.redirect(
      checkoutErrorUrl(request, params.sessionId, confirmed.error),
      { status: 303 },
    );
  }
  return NextResponse.redirect(confirmed.redirectUrl, { status: 303 });
}
