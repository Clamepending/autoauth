import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/base-url";

function notFoundResponse() {
  const baseUrl = getBaseUrl();
  return NextResponse.json(
    {
      error: "Service not found.",
      message:
        "The requested service is not supported. Call GET /api/services to receive the list of valid service ids.",
      listServicesUrl: `${baseUrl}/api/services`,
      nextStep: `GET ${baseUrl}/api/services`,
    },
    { status: 404 },
  );
}

export async function GET() {
  return notFoundResponse();
}
export async function POST() {
  return notFoundResponse();
}
export async function PUT() {
  return notFoundResponse();
}
export async function DELETE() {
  return notFoundResponse();
}
