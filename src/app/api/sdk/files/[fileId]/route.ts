import { NextResponse } from "next/server";

import { getHumanLinkForAgentUsername, getHumanUserById } from "@/lib/human-accounts";
import { getCurrentHumanUser } from "@/lib/human-session";
import { deleteSdkStoredFile, loadSdkStoredFile } from "@/lib/ottoauth-sdk-files";
import { sdkOptionsResponse, withSdkCors } from "@/lib/ottoauth-sdk";
import { authenticateAgent } from "@/services/_shared/auth";

export const dynamic = "force-dynamic";

async function userFromAgentCredentials(payload: Record<string, unknown> | null) {
  if (!payload) return null;
  const auth = await authenticateAgent(payload);
  if (!auth.ok) return null;
  const humanLink = await getHumanLinkForAgentUsername(auth.usernameLower);
  if (!humanLink) return null;
  return getHumanUserById(humanLink.human_user_id);
}

export async function GET(
  request: Request,
  { params }: { params: { fileId: string } },
) {
  const requestUrl = new URL(request.url);
  const file = await loadSdkStoredFile({
    fileId: params.fileId,
    token: requestUrl.searchParams.get("token"),
  });

  if (!file) {
    return withSdkCors(
      NextResponse.json({ error: "File not found." }, { status: 404 }),
      request,
    );
  }

  return withSdkCors(
    new NextResponse(file.bytes, {
      headers: {
        "content-type": file.metadata.content_type || "application/octet-stream",
        "content-length": String(file.metadata.size),
        "content-disposition": `attachment; filename="${file.metadata.safe_name.replace(/"/g, "")}"`,
        "cache-control": "private, max-age=3600",
      },
    }),
    request,
  );
}

export async function DELETE(
  request: Request,
  { params }: { params: { fileId: string } },
) {
  const sessionUser = await getCurrentHumanUser().catch(() => null);
  const payload = (await request.json().catch(() => null)) as
    | Record<string, unknown>
    | null;
  const user = sessionUser ?? (await userFromAgentCredentials(payload));
  if (!user) {
    return withSdkCors(
      NextResponse.json(
        { error: "Authentication required. Use a human session or linked local agent credentials." },
        { status: 401 },
      ),
      request,
    );
  }

  const result = await deleteSdkStoredFile({
    fileId: params.fileId,
    humanUserId: user.id,
  });
  if (!result.deleted) {
    const status =
      result.reason === "wrong_owner"
        ? 403
        : result.reason === "not_found"
          ? 404
          : 400;
    return withSdkCors(
      NextResponse.json({ ok: false, reason: result.reason }, { status }),
      request,
    );
  }

  return withSdkCors(NextResponse.json({ ok: true, file: result.file }), request);
}

export async function OPTIONS(request: Request) {
  return sdkOptionsResponse(request);
}
