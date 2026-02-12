import { NextResponse } from "next/server";
import { getAllAgents } from "@/lib/db";

export async function GET() {
  const agents = await getAllAgents();
  return NextResponse.json(
    agents.map((a) => ({
      id: a.id,
      username_lower: a.username_lower,
      username_display: a.username_display,
      description: a.description,
      created_at: a.created_at,
      updated_at: a.updated_at,
    }))
  );
}
