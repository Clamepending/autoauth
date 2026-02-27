import { NextResponse } from "next/server";
import { getAdminAgentRequests } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const statusParam = searchParams.get("status")?.trim().toLowerCase() ?? "";
  const allowedStatuses = new Set(["pending", "notify_failed", "resolved", "rejected"]);
  const statuses =
    statusParam.length > 0
      ? statusParam
          .split(",")
          .map((part) => part.trim())
          .filter((part) => allowedStatuses.has(part))
      : undefined;

  const requests = await getAdminAgentRequests(statuses);
  return NextResponse.json(requests, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
