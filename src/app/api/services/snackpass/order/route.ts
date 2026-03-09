import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/base-url";

function snackpassComingSoonResponse() {
  const baseUrl = getBaseUrl();
  return NextResponse.json(
    {
      error: "SNACKPASS_COMING_SOON",
      message: "Snackpass is not available yet on this hosted OttoAuth server.",
      status: "coming_soon",
      listServicesUrl: `${baseUrl}/api/services`,
      amazonServiceUrl: `${baseUrl}/api/services/amazon`,
      nextStep: `POST ${baseUrl}/api/services/amazon/buy`,
    },
    { status: 503 },
  );
}

export async function POST() {
  return snackpassComingSoonResponse();
}
