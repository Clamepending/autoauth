import { NextResponse } from "next/server";

import { cancelCheckoutSession } from "@/lib/ottoauth-checkout-sessions";
import { sdkRequestOrigin } from "@/lib/ottoauth-sdk";

type Props = {
  params: {
    sessionId: string;
  };
};

export async function POST(request: Request, { params }: Props) {
  const baseUrl = sdkRequestOrigin(request);
  const canceled = await cancelCheckoutSession({
    sessionId: params.sessionId,
    baseUrl,
  });
  if (!canceled.ok) {
    const url = new URL(`/checkout/${encodeURIComponent(params.sessionId)}`, baseUrl);
    url.searchParams.set("error", canceled.error.slice(0, 500));
    return NextResponse.redirect(url, { status: 303 });
  }
  return NextResponse.redirect(canceled.redirectUrl, { status: 303 });
}
