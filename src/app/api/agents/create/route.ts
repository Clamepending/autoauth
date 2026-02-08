import { NextResponse } from "next/server";
import { createAgent, getAgentByUsername } from "@/lib/db";
import {
  generatePrivateKey,
  hashPrivateKey,
  normalizeUsername,
  validateUsername,
} from "@/lib/agent-auth";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const rawUsername = typeof payload.username === "string" ? payload.username.trim() : "";
  const rawDescription = typeof payload.description === "string" ? payload.description.trim() : "";
  const description = rawDescription.length > 0 ? rawDescription.slice(0, 100) : null;

  const validation = validateUsername(rawUsername);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  const usernameDisplay = rawUsername;
  const usernameLower = normalizeUsername(rawUsername);

  if (usernameLower === "human" || usernameLower === "anonymous") {
    return NextResponse.json({ error: `Username '${usernameLower}' is reserved.` }, { status: 400 });
  }

  const existing = await getAgentByUsername(usernameLower);
  if (existing) {
    return NextResponse.json({ error: "Username is already taken." }, { status: 400 });
  }

  const privateKey = generatePrivateKey();
  const privateKeyHash = hashPrivateKey(privateKey);

  const agent = await createAgent({
    usernameLower,
    usernameDisplay,
    privateKeyHash,
    description,
  });

  return NextResponse.json({
    username: agent.username_display,
    privateKey,
    privateKeyHash,
    message:
      "Account created. Save your private key securely — it cannot be recovered. Use it as your password for future updates.",
  });
}
