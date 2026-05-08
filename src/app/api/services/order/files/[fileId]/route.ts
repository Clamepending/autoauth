import { NextResponse } from "next/server";

import { verifyPrivateKey } from "@/lib/agent-auth";
import { getCurrentAdminUser } from "@/lib/admin-auth";
import { getAgentByPrivateKey } from "@/lib/db";
import { getOrderFileByPublicId } from "@/lib/order-orchestration";

type Context = { params: Promise<{ fileId: string }> };

async function canReadFile(request: Request, agentUsernameLower: string) {
  const admin = await getCurrentAdminUser();
  if (admin) return true;

  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!bearer) return false;
  const agent = await getAgentByPrivateKey(bearer);
  if (!agent || !verifyPrivateKey(bearer, agent.private_key)) return false;
  return agent.username_lower === agentUsernameLower;
}

export async function GET(request: Request, context: Context) {
  const { fileId } = await context.params;
  const file = await getOrderFileByPublicId(fileId);
  if (!file) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
  }
  if (!(await canReadFile(request, file.agent_username_lower))) {
    return NextResponse.json(
      {
        error: "File authentication required.",
        hint: "Use Authorization: Bearer <agent_private_key> or sign in as an OttoAuth admin.",
      },
      { status: 401 },
    );
  }
  return new NextResponse(Buffer.from(file.blob_data), {
    headers: {
      "Content-Type": file.content_type,
      "Content-Length": String(file.size_bytes),
      "Content-Disposition": `attachment; filename="${file.filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
