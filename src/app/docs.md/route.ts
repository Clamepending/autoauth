import { getBaseUrl } from "@/lib/base-url";
import { getDocsMarkdown } from "@/lib/llm-docs";
import { getAllManifests } from "@/services/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  const body = getDocsMarkdown(getBaseUrl(), getAllManifests());

  return new Response(body, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}
