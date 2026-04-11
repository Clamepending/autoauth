import { NextResponse } from "next/server";
import { upsertHumanUserDev } from "@/lib/human-accounts";
import { isDevHumanLoginEnabled, setHumanSessionCookie } from "@/lib/human-session";

export async function POST(request: Request) {
  if (!isDevHumanLoginEnabled()) {
    return NextResponse.json(
      { error: "Dev human login is disabled." },
      { status: 403 },
    );
  }

  const payload = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  const displayName =
    typeof payload.display_name === "string"
      ? payload.display_name.trim()
      : typeof payload.displayName === "string"
        ? payload.displayName.trim()
        : "";

  if (!email || !email.includes("@")) {
    return NextResponse.json(
      { error: "A valid email is required." },
      { status: 400 },
    );
  }

  const { user } = await upsertHumanUserDev({
    email,
    displayName: displayName || email,
  });

  const response = NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      display_name: user.display_name,
    },
  });
  await setHumanSessionCookie(response, user.id);
  return response;
}
