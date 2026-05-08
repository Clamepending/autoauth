import { createHash, createHmac, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

export type SdkStoredFileMetadata = {
  id: string;
  token: string;
  human_user_id: number;
  name: string;
  safe_name: string;
  content_type: string;
  size: number;
  sha256: string;
  metadata: unknown;
  created_at: string;
  storage_backend?: string;
};

const MAX_FILE_BYTES = 50 * 1024 * 1024;
const S3_SERVICE = "s3";
const AWS4_REQUEST = "aws4_request";

function storageRoot() {
  return path.resolve(
    process.env.OTTOAUTH_SDK_FILE_DIR || path.join(process.cwd(), "output", "ottoauth-sdk-files"),
  );
}

function safeFileName(value: string) {
  const baseName = path.basename(String(value || "file").replace(/\\/g, "/"));
  const normalized = baseName
    .replace(/[^a-zA-Z0-9._ -]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return normalized || "file";
}

function safeFileId(value: string) {
  const normalized = String(value || "").trim();
  if (!/^file_[a-f0-9]{32}$/.test(normalized)) {
    return "";
  }
  return normalized;
}

function fileDir(fileId: string) {
  return path.join(storageRoot(), fileId);
}

function storageBackend() {
  const backend = String(process.env.OTTOAUTH_SDK_FILE_STORAGE || "").trim().toLowerCase();
  return backend === "s3" ? "s3" : "local";
}

function normalizeS3Prefix(value: string | undefined) {
  const trimmed = String(value || "").trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `${trimmed}/` : "";
}

function s3Config() {
  const region = String(process.env.OTTOAUTH_S3_REGION || "us-east-1").trim();
  const endpoint =
    String(process.env.OTTOAUTH_S3_ENDPOINT || "").trim() ||
    `https://s3.${region}.amazonaws.com`;
  const bucket = String(process.env.OTTOAUTH_S3_BUCKET || "").trim();
  const accessKeyId = String(process.env.OTTOAUTH_S3_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = String(process.env.OTTOAUTH_S3_SECRET_ACCESS_KEY || "").trim();
  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "OTTOAUTH_SDK_FILE_STORAGE=s3 requires OTTOAUTH_S3_BUCKET, OTTOAUTH_S3_ACCESS_KEY_ID, and OTTOAUTH_S3_SECRET_ACCESS_KEY.",
    );
  }
  return {
    endpoint: endpoint.replace(/\/+$/, ""),
    region,
    bucket,
    accessKeyId,
    secretAccessKey,
    prefix: normalizeS3Prefix(process.env.OTTOAUTH_S3_PREFIX),
  };
}

function s3ObjectKey(fileId: string, name: "blob" | "metadata.json") {
  const config = s3Config();
  return `${config.prefix}${fileId}/${name}`;
}

function encodeS3Path(pathname: string) {
  return pathname
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")
    .replace(/%2F/g, "/");
}

function s3ObjectUrl(key: string) {
  const config = s3Config();
  const url = new URL(config.endpoint);
  const pathPrefix = url.pathname.replace(/\/+$/, "");
  url.pathname = `${pathPrefix}/${config.bucket}/${key}`
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  url.search = "";
  url.hash = "";
  return url;
}

function amzTimestamp(date = new Date()) {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, "");
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

function sha256Hex(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest("hex");
}

function signingKey(params: {
  secretAccessKey: string;
  dateStamp: string;
  region: string;
}) {
  const dateKey = hmac(`AWS4${params.secretAccessKey}`, params.dateStamp);
  const dateRegionKey = hmac(dateKey, params.region);
  const dateRegionServiceKey = hmac(dateRegionKey, S3_SERVICE);
  return hmac(dateRegionServiceKey, AWS4_REQUEST);
}

async function s3Fetch(params: {
  method: "DELETE" | "GET" | "PUT";
  key: string;
  body?: Buffer;
  contentType?: string;
}) {
  const config = s3Config();
  const url = s3ObjectUrl(params.key);
  const body = params.body ?? Buffer.alloc(0);
  const payloadHash = sha256Hex(body);
  const { amzDate, dateStamp } = amzTimestamp();
  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
  if (params.method === "PUT") {
    headers["content-type"] = params.contentType || "application/octet-stream";
  }

  const sortedHeaderEntries = Object.entries(headers).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const canonicalHeaders = sortedHeaderEntries
    .map(([key, value]) => `${key}:${value.trim()}\n`)
    .join("");
  const signedHeaders = sortedHeaderEntries.map(([key]) => key).join(";");
  const canonicalRequest = [
    params.method,
    encodeS3Path(url.pathname),
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = [dateStamp, config.region, S3_SERVICE, AWS4_REQUEST].join("/");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signature = hmacHex(
    signingKey({
      secretAccessKey: config.secretAccessKey,
      dateStamp,
      region: config.region,
    }),
    stringToSign,
  );
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  const response = await fetch(url, {
    method: params.method,
    headers: {
      ...headers,
      authorization,
    },
    body: params.method === "PUT" ? new Uint8Array(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `S3 file storage request failed with status ${response.status}${text ? `: ${text.slice(0, 500)}` : ""}`,
    );
  }

  return response;
}

async function saveLocalFile(params: {
  metadata: SdkStoredFileMetadata;
  bytes: Buffer;
}) {
  const dir = fileDir(params.metadata.id);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "blob"), params.bytes, { mode: 0o600 });
  await fs.writeFile(
    path.join(dir, "metadata.json"),
    `${JSON.stringify(params.metadata, null, 2)}\n`,
    { mode: 0o600 },
  );
}

async function saveS3File(params: {
  metadata: SdkStoredFileMetadata;
  bytes: Buffer;
}) {
  await s3Fetch({
    method: "PUT",
    key: s3ObjectKey(params.metadata.id, "blob"),
    body: params.bytes,
    contentType: params.metadata.content_type,
  });
  await s3Fetch({
    method: "PUT",
    key: s3ObjectKey(params.metadata.id, "metadata.json"),
    body: Buffer.from(`${JSON.stringify(params.metadata, null, 2)}\n`, "utf8"),
    contentType: "application/json; charset=utf-8",
  });
}

async function loadLocalMetadata(fileId: string) {
  try {
    return JSON.parse(
      await fs.readFile(path.join(fileDir(fileId), "metadata.json"), "utf8"),
    ) as SdkStoredFileMetadata;
  } catch {
    return null;
  }
}

async function loadS3Metadata(fileId: string) {
  try {
    const metadataResponse = await s3Fetch({
      method: "GET",
      key: s3ObjectKey(fileId, "metadata.json"),
    });
    return JSON.parse(await metadataResponse.text()) as SdkStoredFileMetadata;
  } catch {
    return null;
  }
}

export async function saveSdkUploadedFile(params: {
  humanUserId: number;
  name: string;
  contentType?: string | null;
  bytes: Buffer;
  metadata?: unknown;
}) {
  if (!params.bytes.length) {
    throw new Error("Uploaded file is empty.");
  }
  if (params.bytes.length > MAX_FILE_BYTES) {
    throw new Error("Uploaded file is too large. The current limit is 50 MB.");
  }

  const id = `file_${randomBytes(16).toString("hex")}`;
  const token = randomBytes(24).toString("hex");
  const safeName = safeFileName(params.name);
  const metadata: SdkStoredFileMetadata = {
    id,
    token,
    human_user_id: params.humanUserId,
    name: String(params.name || safeName).slice(0, 240),
    safe_name: safeName,
    content_type: String(params.contentType || "application/octet-stream").slice(0, 120),
    size: params.bytes.length,
    sha256: createHash("sha256").update(params.bytes).digest("hex"),
    metadata: params.metadata ?? null,
    created_at: new Date().toISOString(),
    storage_backend: storageBackend(),
  };

  if (storageBackend() === "s3") {
    await saveS3File({ metadata, bytes: params.bytes });
  } else {
    await saveLocalFile({ metadata, bytes: params.bytes });
  }

  return metadata;
}

async function loadLocalFile(fileId: string) {
  const dir = fileDir(fileId);
  const metadata = await loadLocalMetadata(fileId);
  if (!metadata) return null;

  const bytes = await fs.readFile(path.join(dir, "blob")).catch(() => null);
  if (!bytes) return null;
  return { metadata, bytes };
}

async function loadS3File(fileId: string) {
  const metadata = await loadS3Metadata(fileId);
  if (!metadata) return null;

  const blobResponse = await s3Fetch({
    method: "GET",
    key: s3ObjectKey(fileId, "blob"),
  }).catch(() => null);
  if (!blobResponse) return null;
  const bytes = Buffer.from(await blobResponse.arrayBuffer());
  return { metadata, bytes };
}

export async function deleteSdkStoredFile(params: {
  fileId: string;
  humanUserId?: number | null;
}) {
  const fileId = safeFileId(params.fileId);
  if (!fileId) {
    return { deleted: false, reason: "invalid_file_id" as const };
  }

  const backend = storageBackend();
  const metadata =
    backend === "s3" ? await loadS3Metadata(fileId) : await loadLocalMetadata(fileId);
  if (!metadata) {
    return { deleted: false, reason: "not_found" as const };
  }
  if (params.humanUserId != null && metadata.human_user_id !== params.humanUserId) {
    return { deleted: false, reason: "wrong_owner" as const };
  }

  if (backend === "s3") {
    await Promise.all([
      s3Fetch({ method: "DELETE", key: s3ObjectKey(fileId, "blob") }),
      s3Fetch({ method: "DELETE", key: s3ObjectKey(fileId, "metadata.json") }),
    ]);
  } else {
    await fs.rm(fileDir(fileId), { recursive: true, force: true });
  }

  return {
    deleted: true,
    reason: "deleted" as const,
    file: {
      id: metadata.id,
      name: metadata.name,
      size: metadata.size,
      sha256: metadata.sha256,
      storage_backend: metadata.storage_backend || backend,
    },
  };
}

export async function loadSdkStoredFile(params: {
  fileId: string;
  token?: string | null;
}) {
  const fileId = safeFileId(params.fileId);
  if (!fileId) return null;

  const stored =
    storageBackend() === "s3" ? await loadS3File(fileId) : await loadLocalFile(fileId);
  if (!stored) return null;

  if (!params.token || params.token !== stored.metadata.token) {
    return null;
  }
  return stored;
}

export function sdkFileDownloadUrl(params: {
  baseUrl: string;
  file: SdkStoredFileMetadata;
}) {
  const url = new URL(`/api/sdk/files/${params.file.id}`, params.baseUrl);
  url.searchParams.set("token", params.file.token);
  return url.href;
}
