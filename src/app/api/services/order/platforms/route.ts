import { NextResponse } from "next/server";

import { getPlatformCatalog } from "@/lib/platform-catalog";
import { getProviderCatalog } from "@/lib/order-orchestration";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    catalog: getPlatformCatalog(),
    providers: await getProviderCatalog(),
  });
}
