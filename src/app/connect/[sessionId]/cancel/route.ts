import { NextResponse } from "next/server";

import { cancelSdkConnectSession } from "@/lib/ottoauth-connect";

type Context = {
  params: {
    sessionId: string;
  };
};

export async function POST(request: Request, context: Context) {
  const url = new URL(request.url);
  try {
    const canceled = await cancelSdkConnectSession({
      sessionId: context.params.sessionId,
    });
    return NextResponse.redirect(canceled.redirectUrl, { status: 303 });
  } catch {
    return NextResponse.redirect(new URL("/", url.origin), { status: 303 });
  }
}
