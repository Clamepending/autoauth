import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/base-url";
import { serviceNotFoundResponse } from "@/lib/service-info";

/**
 * Catch-all for /api/services/<anything> that did not match a more specific route.
 * Returns 404 with message to call GET /api/services for valid service ids.
 */
export async function GET() {
  const baseUrl = getBaseUrl();
  return NextResponse.json(serviceNotFoundResponse(baseUrl), { status: 404 });
}

export async function POST() {
  const baseUrl = getBaseUrl();
  return NextResponse.json(serviceNotFoundResponse(baseUrl), { status: 404 });
}

export async function PUT() {
  const baseUrl = getBaseUrl();
  return NextResponse.json(serviceNotFoundResponse(baseUrl), { status: 404 });
}

export async function DELETE() {
  const baseUrl = getBaseUrl();
  return NextResponse.json(serviceNotFoundResponse(baseUrl), { status: 404 });
}
