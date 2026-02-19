import { NextResponse } from "next/server";
import { getAgentByUsername, getAmazonOrdersByUsername } from "@/lib/db";
import { normalizeUsername, validateUsername, verifyPrivateKey } from "@/lib/agent-auth";

/**
 * POST /api/services/amazon/history
 * Body: username, private_key
 * Returns: orders — list of { id, item_url, shipping_location, status, created_at }.
 * Status is a short description (placeholder "Submitted"; can be updated manually with tracking).
 */
export async function POST(request: Request) {
  const payload = await request.json().catch(() => null);
  if (!payload) {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const rawUsername = typeof payload.username === "string" ? payload.username.trim() : "";
  const privateKey = typeof payload.private_key === "string" ? payload.private_key.trim() : "";

  const validation = validateUsername(rawUsername);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  if (!privateKey) {
    return NextResponse.json({ error: "private_key is required." }, { status: 400 });
  }

  const usernameLower = normalizeUsername(rawUsername);
  const agent = await getAgentByUsername(usernameLower);
  if (!agent) {
    return NextResponse.json({ error: "Agent not found." }, { status: 404 });
  }
  if (!verifyPrivateKey(privateKey, agent.private_key)) {
    return NextResponse.json({ error: "Invalid credentials." }, { status: 401 });
  }

  const orders = await getAmazonOrdersByUsername(usernameLower);

  return NextResponse.json({
    orders: orders.map((o) => ({
      id: o.id,
      item_url: o.item_url,
      shipping_location: o.shipping_location,
      status: o.status,
      created_at: o.created_at,
    })),
  });
}
