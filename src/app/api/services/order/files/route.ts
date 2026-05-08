import { NextResponse } from "next/server";

import {
  authenticateOrderAgentFromRequest,
  readJsonObject,
  resolveHumanForOrderAgent,
  responseFromOrderError,
} from "@/lib/order-api";
import {
  createOrderFileUpload,
  parseOrderFileForApi,
} from "@/lib/order-orchestration";
import { getBaseUrl } from "@/lib/base-url";

export const dynamic = "force-dynamic";

const MAX_FILES_PER_REQUEST = 8;

function text(value: unknown, maxLength = 2000) {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, maxLength)
    : null;
}

function base64Bytes(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const cleaned = value.includes(",") ? value.slice(value.indexOf(",") + 1) : value;
  return new Uint8Array(Buffer.from(cleaned, "base64"));
}

async function uploadFiles(params: {
  request: Request;
  payload: Record<string, unknown>;
  files: Array<{
    filename: string;
    contentType?: string | null;
    bytes: Uint8Array;
    purpose?: string | null;
    metadata?: Record<string, unknown> | null;
  }>;
}) {
  const auth = await authenticateOrderAgentFromRequest(params.request, params.payload);
  if (!auth.ok) return auth.response;
  const resolvedHuman = await resolveHumanForOrderAgent(auth.auth.usernameLower);
  if (!resolvedHuman.ok) return resolvedHuman.response;

  if (params.files.length === 0) {
    return NextResponse.json({ error: "At least one file is required." }, { status: 400 });
  }
  if (params.files.length > MAX_FILES_PER_REQUEST) {
    return NextResponse.json(
      { error: `Upload at most ${MAX_FILES_PER_REQUEST} files per request.` },
      { status: 400 },
    );
  }

  try {
    const uploaded = [];
    for (const file of params.files) {
      const stored = await createOrderFileUpload({
        agentId: auth.auth.agent.id,
        agentUsernameLower: auth.auth.usernameLower,
        humanUserId: resolvedHuman.humanUser.id,
        filename: file.filename,
        contentType: file.contentType,
        bytes: file.bytes,
        purpose: file.purpose,
        metadata: file.metadata,
      });
      if (stored) uploaded.push(parseOrderFileForApi(stored, getBaseUrl()));
    }
    return NextResponse.json({
      ok: true,
      files: uploaded,
      include_in_order_as: {
        files: uploaded.map((file) => ({
          file_id: file.file_id,
          name: file.name,
          download_url: file.download_url,
          content_type: file.content_type,
          size_bytes: file.size_bytes,
          purpose: file.purpose,
        })),
      },
    });
  } catch (error) {
    return responseFromOrderError(error);
  }
}

async function fromJson(request: Request) {
  const body = await readJsonObject(request);
  if (!body.ok) return body.response;
  const rawFiles = Array.isArray(body.payload.files)
    ? body.payload.files
    : [body.payload];
  const files = rawFiles.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const record = entry as Record<string, unknown>;
    const bytes = base64Bytes(
      record.content_base64 ?? record.contentBase64 ?? record.base64 ?? record.data,
    );
    if (!bytes) return [];
    return [{
      filename:
        text(record.filename ?? record.name ?? record.file_name ?? record.fileName, 240) ||
        "attachment",
      contentType: text(record.content_type ?? record.contentType, 200),
      bytes,
      purpose: text(record.purpose ?? record.role, 120),
      metadata:
        record.metadata && typeof record.metadata === "object" && !Array.isArray(record.metadata)
          ? (record.metadata as Record<string, unknown>)
          : null,
    }];
  });
  return uploadFiles({ request, payload: body.payload, files });
}

async function fromMultipart(request: Request) {
  const form = await request.formData();
  const payload: Record<string, unknown> = {
    username: form.get("username"),
    private_key: form.get("private_key"),
  };
  const purpose = text(form.get("purpose"), 120);
  const files = [];
  for (const value of [...form.getAll("file"), ...form.getAll("files")]) {
    if (!(value instanceof File)) continue;
    files.push({
      filename: value.name || "attachment",
      contentType: value.type || "application/octet-stream",
      bytes: new Uint8Array(await value.arrayBuffer()),
      purpose,
      metadata: null,
    });
  }
  return uploadFiles({ request, payload, files });
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") || "";
  if (contentType.includes("multipart/form-data")) {
    return fromMultipart(request);
  }
  return fromJson(request);
}
