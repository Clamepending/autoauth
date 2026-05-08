import { NextResponse } from "next/server";

import {
  getOttoAuthAddressAvailability,
  setHumanUserHandle,
} from "@/lib/human-accounts";
import { requireCurrentHumanUser } from "@/lib/human-session";

function usernameFromPayload(payload: Record<string, unknown>) {
  const value = payload.username ?? payload.handle ?? payload.address;
  return typeof value === "string" ? value.trim() : "";
}

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

export async function POST(request: Request) {
  const user = await requireCurrentHumanUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }
  const payload = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const username = usernameFromPayload(payload);
  try {
    const updated = await setHumanUserHandle({
      humanUserId: user.id,
      handle: username,
    });
    return NextResponse.json({
      ok: true,
      username: updated.handle_display,
      address: `@${updated.handle_display}`,
      profile_url: `/u/${encodeURIComponent(updated.handle_lower)}`,
      user: updated,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update username.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
