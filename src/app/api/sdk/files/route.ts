import { Buffer } from "node:buffer";
import { NextResponse } from "next/server";

import { authenticateOttoAuthAgentRequest } from "@/lib/ottoauth-api-auth";
import { authenticateAgent } from "@/services/_shared/auth";
import { getHumanLinkForAgentUsername, getHumanUserById } from "@/lib/human-accounts";
import { getCurrentHumanUser } from "@/lib/human-session";
import type { HumanUserRecord } from "@/lib/human-accounts";
import { saveSdkUploadedFile, sdkFileDownloadUrl } from "@/lib/ottoauth-sdk-files";
import {
  sdkOptionsResponse,
  sdkRequestOrigin,
  withSdkCors,
} from "@/lib/ottoauth-sdk";

export const dynamic = "force-dynamic";

type AgentCredentialResult =
  | { ok: false; response: NextResponse }
  | { ok: true; user: HumanUserRecord | null };

function parseMetadata(value: FormDataEntryValue | null) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value.slice(0, 2000);
  }
}

function metadataForIndex(metadata: unknown, index: number) {
  if (Array.isArray(metadata)) return metadata[index] ?? null;
  if (metadata && typeof metadata === "object") {
    const record = metadata as Record<string, unknown>;
    if (Array.isArray(record.files)) return record.files[index] ?? null;
  }
  return metadata;
}

async function fileFromFormEntry(entry: FormDataEntryValue) {
  if (!entry || typeof entry === "string") return null;
  const file = entry as File;
  const bytes = Buffer.from(await file.arrayBuffer());
  return {
    name: file.name || "file",
    contentType: file.type || "application/octet-stream",
    bytes,
  };
}

async function saveJsonFiles(params: {
  payload: Record<string, unknown>;
  humanUserId: number;
  baseUrl: string;
}) {
  const files = Array.isArray(params.payload.files) ? params.payload.files : [];
  const saved = [];

  for (const file of files) {
    if (!file || typeof file !== "object") continue;
    const record = file as Record<string, unknown>;
    const contentBase64 =
      typeof record.content_base64 === "string"
        ? record.content_base64
        : typeof record.contentBase64 === "string"
          ? record.contentBase64
          : "";
    if (!contentBase64) continue;
    const stored = await saveSdkUploadedFile({
      humanUserId: params.humanUserId,
      name:
        typeof record.name === "string" && record.name.trim()
          ? record.name
          : typeof record.filename === "string"
            ? record.filename
            : "file",
      contentType:
        typeof record.content_type === "string"
          ? record.content_type
          : typeof record.contentType === "string"
            ? record.contentType
            : "application/octet-stream",
      bytes: Buffer.from(contentBase64, "base64"),
      metadata: record.metadata ?? null,
    });
    saved.push({
      id: stored.id,
      name: stored.name,
      size: stored.size,
      content_type: stored.content_type,
      storage_backend: stored.storage_backend || "local",
      sha256: stored.sha256,
      url: sdkFileDownloadUrl({ baseUrl: params.baseUrl, file: stored }),
      metadata: stored.metadata,
    });
  }

  return saved;
}

async function userFromAgentCredentials(
  request: Request,
  payload: Record<string, unknown>,
): Promise<AgentCredentialResult> {
  const auth = await authenticateOttoAuthAgentRequest(request, payload, {
    scope: "files:write",
  });
  if (!auth.ok) return { ok: false, response: auth.response };
  const humanLink = await getHumanLinkForAgentUsername(auth.usernameLower);
  if (!humanLink) return { ok: true, user: null };
  return { ok: true, user: await getHumanUserById(humanLink.human_user_id) };
}

async function userFromLegacyAgentCredentials(payload: Record<string, unknown>) {
  const auth = await authenticateAgent(payload);
  if (!auth.ok) return null;
  const humanLink = await getHumanLinkForAgentUsername(auth.usernameLower);
  if (!humanLink) return null;
  return getHumanUserById(humanLink.human_user_id);
}

async function userFromMultipartCredentials(formData: FormData) {
  const username = formData.get("username");
  const privateKey = formData.get("private_key") ?? formData.get("privateKey");
  if (typeof username !== "string" || typeof privateKey !== "string") return null;
  return userFromLegacyAgentCredentials({
    username,
    private_key: privateKey,
  });
}

function unauthenticatedResponse() {
  return NextResponse.json(
    { error: "Authentication required. Use a human session or linked local agent credentials." },
    { status: 401 },
  );
}

function sdkJson(request: Request, payload: unknown, init?: ResponseInit) {
  return withSdkCors(NextResponse.json(payload, init), request);
}

export async function POST(request: Request) {
  const sessionUser = await getCurrentHumanUser().catch(() => null);
  let user: HumanUserRecord | null = sessionUser;
  if (!sessionUser && !request.headers.get("content-type")?.includes("multipart/form-data")) {
    const payload = (await request.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    if (!payload) {
      return sdkJson(request, { error: "Invalid file upload body." }, { status: 400 });
    }
    const credentialResult = await userFromAgentCredentials(request, payload);
    if (!credentialResult.ok) {
      return withSdkCors(credentialResult.response, request);
    }
    user = credentialResult.user;
    if (!user) {
      return withSdkCors(unauthenticatedResponse(), request);
    }
    try {
      const files = await saveJsonFiles({
        payload,
        humanUserId: user.id,
        baseUrl: sdkRequestOrigin(request),
      });
      return sdkJson(request, { ok: true, files });
    } catch (cause) {
      return sdkJson(
        request,
        {
          error: cause instanceof Error ? cause.message : "Could not upload file.",
        },
        { status: 400 },
      );
    }
  }

  if (!user && !request.headers.get("content-type")?.includes("multipart/form-data")) {
    return sdkJson(request, { error: "Authentication required." }, { status: 401 });
  }

  const contentType = request.headers.get("content-type") || "";
  const baseUrl = sdkRequestOrigin(request);

  try {
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      if (!user) {
        user = await userFromMultipartCredentials(formData);
      }
      if (!user) {
        return withSdkCors(unauthenticatedResponse(), request);
      }
      const metadata = parseMetadata(formData.get("metadata"));
      const files = formData.getAll("file");
      const saved = [];

      for (let index = 0; index < files.length; index += 1) {
        const inputFile = await fileFromFormEntry(files[index]);
        if (!inputFile) continue;
        const stored = await saveSdkUploadedFile({
          humanUserId: user.id,
          name: inputFile.name,
          contentType: inputFile.contentType,
          bytes: inputFile.bytes,
          metadata: metadataForIndex(metadata, index),
        });
        saved.push({
          id: stored.id,
          name: stored.name,
          size: stored.size,
          content_type: stored.content_type,
          storage_backend: stored.storage_backend || "local",
          sha256: stored.sha256,
          url: sdkFileDownloadUrl({ baseUrl, file: stored }),
          metadata: stored.metadata,
        });
      }

      return sdkJson(request, { ok: true, files: saved });
    }

    const payload = (await request.json().catch(() => null)) as
      | Record<string, unknown>
      | null;
    if (!payload) {
      return sdkJson(request, { error: "Invalid file upload body." }, { status: 400 });
    }
    if (!user) {
      const credentialResult = await userFromAgentCredentials(request, payload);
      if (!credentialResult.ok) {
        return withSdkCors(credentialResult.response, request);
      }
      user = credentialResult.user;
    }
    if (!user) {
      return withSdkCors(unauthenticatedResponse(), request);
    }

    const files = await saveJsonFiles({
      payload,
      humanUserId: user.id,
      baseUrl,
    });
    return sdkJson(request, { ok: true, files });
  } catch (cause) {
    return sdkJson(
      request,
      {
        error: cause instanceof Error ? cause.message : "Could not upload file.",
      },
      { status: 400 },
    );
  }
}

export async function OPTIONS(request: Request) {
  return sdkOptionsResponse(request);
}
