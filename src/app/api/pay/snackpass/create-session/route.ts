import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/base-url";

export async function POST() {
  const baseUrl = getBaseUrl();
  return NextResponse.json(
    {
      error: "SNACKPASS_COMING_SOON",
      message: "Snackpass payments are disabled until the hosted Snackpass integration is launched.",
      status: "coming_soon",
      listServicesUrl: `${baseUrl}/api/services`,
      orderServiceUrl: `${baseUrl}/api/services/order`,
    },
    { status: 503 },
  );
}
