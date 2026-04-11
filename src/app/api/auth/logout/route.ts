import { NextResponse } from "next/server";
import { clearHumanSessionCookie } from "@/lib/human-session";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const response = NextResponse.redirect(new URL("/", url.origin));
  await clearHumanSessionCookie(response);
  return response;
}
