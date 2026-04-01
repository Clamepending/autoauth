import { NextResponse } from "next/server";
import { listFulfillmentAgentsForAdmin } from "@/lib/computeruse-store";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const fulfillmentAgents = await listFulfillmentAgentsForAdmin();
  return NextResponse.json(fulfillmentAgents, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      "Pragma": "no-cache",
      "Expires": "0",
    },
  });
}
