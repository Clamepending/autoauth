import { NextResponse } from "next/server";

import { approveSdkConnectSession } from "@/lib/ottoauth-connect";
import { getCurrentHumanUser } from "@/lib/human-session";

type Context = {
  params: {
    sessionId: string;
  };
};

export async function POST(request: Request, context: Context) {
  const user = await getCurrentHumanUser();
  const url = new URL(request.url);
  if (!user) {
    return NextResponse.redirect(
      new URL(`/login?returnTo=${encodeURIComponent(`/connect/${context.params.sessionId}`)}`, url.origin),
      { status: 303 },
    );
  }

  try {
    const approved = await approveSdkConnectSession({
      sessionId: context.params.sessionId,
      humanUserId: user.id,
    });
    return NextResponse.redirect(approved.redirectUrl, { status: 303 });
  } catch (error) {
    const target = new URL(`/connect/${encodeURIComponent(context.params.sessionId)}`, url.origin);
    target.searchParams.set(
      "error",
      error instanceof Error ? error.message : "Could not approve connect session.",
    );
    return NextResponse.redirect(target, { status: 303 });
  }
}
