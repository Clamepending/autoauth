import { NextResponse } from "next/server";
import { getAllAgents } from "@/lib/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const agents = await getAllAgents();
  return NextResponse.json(
    agents.map((a) => ({
      id: a.id,
      username_lower: a.username_lower,
      username_display: a.username_display,
      callback_url: a.callback_url,
      description: a.description,
      created_at: a.created_at,
      updated_at: a.updated_at,
    })),
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
        "Pragma": "no-cache",
        "Expires": "0",
      },
    }
  );
}
