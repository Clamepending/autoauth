import { NextResponse } from "next/server";

import { getOrderFileByPublicId } from "@/lib/order-orchestration";

type Context = { params: Promise<{ fileId: string }> };

export async function GET(_request: Request, context: Context) {
  const { fileId } = await context.params;
  const file = await getOrderFileByPublicId(fileId);
  if (!file) {
    return NextResponse.json({ error: "File not found." }, { status: 404 });
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
