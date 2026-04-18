import { getTursoClient } from "@/lib/turso";
import {
  createMarketService,
  ensureMarketServiceSchema,
  getMarketServiceById,
  updateMarketService,
  type MarketServiceRecord,
} from "@/lib/market-services";

export async function listMarketServicesForOwner(params: {
  ownerHumanUserId: number;
  limit?: number;
}): Promise<MarketServiceRecord[]> {
  await ensureMarketServiceSchema();
  const client = getTursoClient();
  const limit = Math.max(1, Math.min(params.limit ?? 100, 200));
  const result = await client.execute({
    sql: `SELECT id
          FROM market_services
          WHERE owner_human_user_id = ?
          ORDER BY status ASC, updated_at DESC
          LIMIT ?`,
    args: [params.ownerHumanUserId, limit],
  });
  const ids = ((result.rows ?? []) as Array<{ id?: number | bigint | string }>).map(
    (row) => Number(row.id),
  );
  const services = await Promise.all(ids.map((id) => getMarketServiceById(id)));
  return services.filter((service): service is MarketServiceRecord => service != null);
}

export async function upsertMarketServiceForOwner(params: {
  ownerHumanUserId: number;
  ownerAgentId: number;
  ownerAgentUsernameLower: string;
  name: string;
  capability: string;
  description: string;
  endpointUrl: string;
  priceCents: number;
  inputSchema?: unknown;
  outputSchema?: unknown;
  examples?: unknown;
  tags?: string[];
  visibility?: "public" | "unlisted";
  refundPolicy?: string | null;
}) {
  await ensureMarketServiceSchema();
  const client = getTursoClient();
  const existingResult = await client.execute({
    sql: `SELECT id
          FROM market_services
          WHERE owner_human_user_id = ?
            AND capability = ?
            AND endpoint_url = ?
          LIMIT 1`,
    args: [params.ownerHumanUserId, params.capability, params.endpointUrl],
  });
  const existingId = Number(
    (existingResult.rows?.[0] as { id?: number | bigint | string } | undefined)?.id ??
      0,
  );

  if (existingId > 0) {
    await client.execute({
      sql: `UPDATE market_services
            SET owner_agent_id = ?, owner_agent_username_lower = ?, updated_at = ?
            WHERE id = ?`,
      args: [
        params.ownerAgentId,
        params.ownerAgentUsernameLower.trim().toLowerCase(),
        new Date().toISOString(),
        existingId,
      ],
    });
    return updateMarketService({
      serviceId: existingId,
      ownerHumanUserId: params.ownerHumanUserId,
      patch: {
        name: params.name,
        capability: params.capability,
        description: params.description,
        endpoint_url: params.endpointUrl,
        price_cents: params.priceCents,
        input_schema: params.inputSchema,
        output_schema: params.outputSchema,
        examples: params.examples,
        tags: params.tags ?? [],
        visibility: params.visibility ?? "public",
        status: "enabled",
        supported_rails: ["ottoauth_ledger"],
        refund_policy: params.refundPolicy ?? null,
      },
    });
  }

  return createMarketService({
    ownerHumanUserId: params.ownerHumanUserId,
    ownerAgentId: params.ownerAgentId,
    ownerAgentUsernameLower: params.ownerAgentUsernameLower,
    name: params.name,
    capability: params.capability,
    description: params.description,
    endpointUrl: params.endpointUrl,
    priceCents: params.priceCents,
    inputSchema: params.inputSchema,
    outputSchema: params.outputSchema,
    examples: params.examples,
    tags: params.tags ?? [],
    visibility: params.visibility ?? "public",
    supportedRails: ["ottoauth_ledger"],
    refundPolicy: params.refundPolicy ?? null,
  });
}
