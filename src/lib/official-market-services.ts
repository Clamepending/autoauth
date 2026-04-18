import { getBaseUrl } from "@/lib/base-url";
import {
  createMarketService,
  ensureMarketServiceSchema,
  updateMarketService,
} from "@/lib/market-services";
import { getTursoClient } from "@/lib/turso";

const OTTOAUTH_PROVIDER_HUMAN_USER_ID = 0;
const OTTOAUTH_PROVIDER_AGENT = "ottoauth";

type OfficialMarketServiceDefinition = {
  name: string;
  capability: string;
  description: string;
  endpointPath: string;
  priceCents: number;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  examples: Array<Record<string, unknown>>;
  tags: string[];
  refundPolicy: string;
};

function envPriceCents(name: string, fallback: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function officialServiceDefinitions(): OfficialMarketServiceDefinition[] {
  return [
    {
      name: "Generate an image",
      capability: "generate_image_openai",
      description:
        "OttoAuth renders a prompt into an image using the OpenAI image generation API. Useful for agents or humans that need quick visual assets, mockups, thumbnails, or illustrations.",
      endpointPath: "/api/market/official-media/image",
      priceCents: envPriceCents("OTTOAUTH_IMAGE_SERVICE_PRICE_CENTS", 0),
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Image prompt. You can also use request for simple human submissions.",
          },
          size: {
            type: "string",
            enum: ["1024x1024", "1024x1536", "1536x1024"],
            description: "Output image size.",
          },
          quality: {
            type: "string",
            enum: ["low", "medium", "high", "auto"],
            description: "Rendering quality.",
          },
          background: {
            type: "string",
            enum: ["auto", "opaque", "transparent"],
            description: "Background preference when supported by the model.",
          },
          output_format: {
            type: "string",
            enum: ["png", "jpeg", "webp"],
            description: "Preferred output format when supported.",
          },
        },
        required: ["prompt"],
      },
      outputSchema: {
        type: "object",
        properties: {
          status: { type: "string" },
          provider: { type: "string" },
          model: { type: "string" },
          image_data_url: { type: "string" },
          image_url: { type: "string" },
          revised_prompt: { type: "string" },
          usage: { type: "object" },
        },
        required: ["status", "provider", "model"],
      },
      examples: [
        {
          input: {
            prompt:
              "A cozy brutalist dashboard mascot, black ink on warm paper, editorial illustration style.",
            size: "1024x1024",
            quality: "medium",
          },
          output: {
            status: "completed",
            provider: "openai",
            model: "gpt-image-1",
            image_data_url: "data:image/png;base64,...",
          },
        },
      ],
      tags: ["ottoauth-official", "image", "generation", "openai", "media"],
      refundPolicy:
        "If the rendering provider fails before producing an asset, OttoAuth marks the service call failed/refunded. API usage costs are not yet itemized separately from the service fee in this v1 prototype.",
    },
    {
      name: "Generate a video",
      capability: "generate_video_api",
      description:
        "OttoAuth submits a video prompt to a configured rendering provider such as Seedance, Kling, Runway, or another API-backed video model. V1 is provider-pluggable and returns the provider job/result payload.",
      endpointPath: "/api/market/official-media/video",
      priceCents: envPriceCents("OTTOAUTH_VIDEO_SERVICE_PRICE_CENTS", 0),
      inputSchema: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "Video prompt. You can also use request for simple human submissions.",
          },
          provider: {
            type: "string",
            description:
              "Optional provider hint, such as seedance, kling, runway, or hyperbolic.",
          },
          duration_seconds: {
            type: "integer",
            description: "Requested video duration in seconds.",
          },
          aspect_ratio: {
            type: "string",
            description: "Requested aspect ratio, for example 16:9, 9:16, or 1:1.",
          },
          resolution: {
            type: "string",
            description: "Requested resolution or quality tier.",
          },
          reference_image_url: {
            type: "string",
            description: "Optional URL for an image-to-video reference.",
          },
        },
        required: ["prompt"],
      },
      outputSchema: {
        type: "object",
        properties: {
          status: { type: "string" },
          provider: { type: "string" },
          job_id: { type: "string" },
          video_url: { type: "string" },
          result_url: { type: "string" },
          provider_response: { type: "object" },
        },
        required: ["status", "provider"],
      },
      examples: [
        {
          input: {
            prompt:
              "A 5 second product hero shot of a tiny robot delivering noodles across a clean white table.",
            provider: "seedance",
            duration_seconds: 5,
            aspect_ratio: "16:9",
          },
          output: {
            status: "submitted",
            provider: "seedance",
            job_id: "provider-job-id",
          },
        },
      ],
      tags: ["ottoauth-official", "video", "generation", "media", "api"],
      refundPolicy:
        "If the configured video provider rejects or fails the job request, OttoAuth marks the service call failed/refunded. Long-running render polling and provider-specific cost pass-through are planned follow-ups.",
    },
  ];
}

export async function ensureOfficialMarketServices() {
  await ensureMarketServiceSchema();
  const client = getTursoClient();
  const baseUrl = getBaseUrl();

  return Promise.all(
    officialServiceDefinitions().map(async (definition) => {
      const endpointUrl = `${baseUrl}${definition.endpointPath}`;
      const existing = await client.execute({
        sql: `SELECT id
              FROM market_services
              WHERE owner_human_user_id = ?
                AND capability = ?
              LIMIT 1`,
        args: [OTTOAUTH_PROVIDER_HUMAN_USER_ID, definition.capability],
      });
      const existingId = Number(
        (existing.rows?.[0] as { id?: number | bigint | string } | undefined)?.id ?? 0,
      );

      const patch = {
        name: definition.name,
        capability: definition.capability,
        description: definition.description,
        endpoint_url: endpointUrl,
        price_cents: definition.priceCents,
        input_schema: definition.inputSchema,
        output_schema: definition.outputSchema,
        examples: definition.examples,
        tags: definition.tags,
        visibility: "public",
        status: "enabled",
        supported_rails: ["ottoauth_ledger"],
        refund_policy: definition.refundPolicy,
      };

      if (existingId > 0) {
        await client.execute({
          sql: `UPDATE market_services
                SET owner_agent_id = NULL, owner_agent_username_lower = ?, updated_at = ?
                WHERE id = ?`,
          args: [OTTOAUTH_PROVIDER_AGENT, new Date().toISOString(), existingId],
        });
        return updateMarketService({
          serviceId: existingId,
          ownerHumanUserId: OTTOAUTH_PROVIDER_HUMAN_USER_ID,
          patch,
        });
      }

      return createMarketService({
        ownerHumanUserId: OTTOAUTH_PROVIDER_HUMAN_USER_ID,
        ownerAgentId: null,
        ownerAgentUsernameLower: OTTOAUTH_PROVIDER_AGENT,
        ...patch,
        endpointUrl,
        priceCents: definition.priceCents,
        inputSchema: definition.inputSchema,
        outputSchema: definition.outputSchema,
        supportedRails: ["ottoauth_ledger"],
        refundPolicy: definition.refundPolicy,
      });
    }),
  );
}
