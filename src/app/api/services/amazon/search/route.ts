import { NextResponse } from "next/server";
import { getAgentByPrivateKey } from "@/lib/db";
import { normalizeUsername, validateUsername } from "@/lib/agent-auth";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const privateKey =
    typeof payload.private_key === "string"
      ? payload.private_key.trim()
      : "";
  const searchPrompt =
    typeof payload.search_prompt === "string"
      ? payload.search_prompt.trim()
      : "";
  const username =
    typeof payload.username === "string" ? payload.username.trim() : "";

  if (!privateKey) {
    return NextResponse.json(
      { error: "private_key is required." },
      { status: 400 },
    );
  }

  if (!searchPrompt) {
    return NextResponse.json(
      { error: "search_prompt is required." },
      { status: 400 },
    );
  }

  let agent = null;
  try {
    agent = await getAgentByPrivateKey(privateKey);
  } catch {
    return NextResponse.json(
      { error: "Credential lookup failed." },
      { status: 500 },
    );
  }
  if (!agent) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  if (username) {
    const validation = validateUsername(username);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    if (normalizeUsername(username) !== agent.username_lower) {
      return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
    }
  }

  return NextResponse.json(
    {
      error: "NOT_IMPLEMENTED",
      message:
        "Amazon search is not implemented yet. Please search with another method, then call POST /api/services/amazon/buy with the product page URL.",
      search_prompt: searchPrompt,
      next_step:
        "Use another search method and then call /api/services/amazon/buy.",
    },
    { status: 501 },
  );
}
