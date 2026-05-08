import { NextResponse } from "next/server";

import { getOttoAuthAddressAvailability } from "@/lib/human-accounts";
import { requireCurrentHumanUser } from "@/lib/human-session";

export async function GET(request: Request) {
  const user = await requireCurrentHumanUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const url = new URL(request.url);
  const requested = url.searchParams.get("username") ?? url.searchParams.get("handle") ?? "";
  if (!requested.trim()) {
    return NextResponse.json({
      ok: true,
      username: user.handle_display,
      address: `@${user.handle_display}`,
      profile_url: `/u/${encodeURIComponent(user.handle_lower)}`,
    });
  }
  const availability = await getOttoAuthAddressAvailability(requested, {
    excludeHumanUserId: user.id,
  });
  if (!availability.ok) {
    return NextResponse.json({ ok: false, available: false, error: availability.error }, { status: 400 });
  }
  return NextResponse.json({
    ok: true,
    username: availability.value,
    address: `@${availability.value}`,
    available: availability.available,
    reason: availability.available ? null : availability.reason,
  });
}

export async function POST() {
  const user = await requireCurrentHumanUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  return NextResponse.json(
    { error: "OttoAuth addresses are permanent and cannot be changed." },
    { status: 403 },
  );
}
