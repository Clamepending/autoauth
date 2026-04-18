import { getBaseUrl } from "@/lib/base-url";
import { upsertMarketServiceForOwner } from "@/lib/market-service-owner";

export type StandardFulfillmentServiceKey =
  | "snackpass"
  | "instacart"
  | "amazon"
  | "grubhub";

export type StandardFulfillmentServiceDefinition = {
  key: StandardFulfillmentServiceKey;
  name: string;
  capability: string;
  description: string;
  websiteUrl: string;
  promptPrefix: string;
  tags: string[];
};

export const STANDARD_FULFILLMENT_SERVICES: StandardFulfillmentServiceDefinition[] = [
  {
    key: "snackpass",
    name: "Buy food via Snackpass",
    capability: "buy_food_snackpass",
    description:
      "Use an OttoAuth browser fulfiller to place pickup food orders on Snackpass. Service fee is $0; the requester pays actual checkout and inference costs after completion.",
    websiteUrl: "https://www.snackpass.co/",
    promptPrefix:
      "Use Snackpass for this food order. Prefer pickup unless the requester explicitly asks for delivery.",
    tags: ["ottoauth-standard-fulfillment", "food", "snackpass", "pickup"],
  },
  {
    key: "instacart",
    name: "Buy groceries via Instacart",
    capability: "buy_groceries_instacart",
    description:
      "Use an OttoAuth browser fulfiller to buy groceries through Instacart. Service fee is $0; the requester pays actual checkout and inference costs after completion.",
    websiteUrl: "https://www.instacart.com/",
    promptPrefix:
      "Use Instacart for this grocery order. Follow requester item, quantity, substitution, and delivery instructions exactly.",
    tags: ["ottoauth-standard-fulfillment", "groceries", "instacart", "delivery"],
  },
  {
    key: "amazon",
    name: "Buy on Amazon",
    capability: "buy_on_amazon",
    description:
      "Use an OttoAuth browser fulfiller to buy products on Amazon. Service fee is $0; the requester pays actual checkout and inference costs after completion.",
    websiteUrl: "https://www.amazon.com/",
    promptPrefix:
      "Use Amazon for this shopping request. Do not buy protection plans, subscriptions, or add-ons unless explicitly requested.",
    tags: ["ottoauth-standard-fulfillment", "shopping", "amazon", "delivery"],
  },
  {
    key: "grubhub",
    name: "Buy delivery and pickup on Grubhub",
    capability: "buy_food_grubhub",
    description:
      "Use an OttoAuth browser fulfiller to place delivery or pickup food orders on Grubhub. Service fee is $0; the requester pays actual checkout and inference costs after completion.",
    websiteUrl: "https://www.grubhub.com/",
    promptPrefix:
      "Use Grubhub for this food order. Support either delivery or pickup based on the requester input.",
    tags: ["ottoauth-standard-fulfillment", "food", "grubhub", "delivery", "pickup"],
  },
];

export function getStandardFulfillmentService(key: string) {
  return (
    STANDARD_FULFILLMENT_SERVICES.find((service) => service.key === key) ?? null
  );
}

export function getStandardFulfillmentEndpointUrl(key: StandardFulfillmentServiceKey) {
  return `${getBaseUrl()}/api/market/standard-fulfillment/${key}`;
}

function inputSchemaFor(definition: StandardFulfillmentServiceDefinition) {
  return {
    type: "object",
    properties: {
      request: {
        type: "string",
        description: `Natural-language order request for ${definition.name}.`,
      },
      max_charge_cents: {
        type: "integer",
        description:
          "Optional spend cap for actual checkout + inference costs. Defaults to the requester's available OttoAuth credit balance.",
      },
      delivery_address: {
        type: "string",
        description:
          "Optional delivery/shipping address. Required when the request needs delivery and no saved address should be used.",
      },
      fulfillment_method: {
        type: "string",
        enum: ["pickup", "delivery", "shipping"],
        description: "Optional preferred fulfillment method.",
      },
    },
    required: ["request"],
  };
}

function outputSchema() {
  return {
    type: "object",
    properties: {
      task_id: { type: "number" },
      order_url: { type: "string" },
      status: { type: "string" },
      summary: { type: "string" },
    },
    required: ["task_id", "order_url", "status"],
  };
}

function examplesFor(definition: StandardFulfillmentServiceDefinition) {
  return [
    {
      input: {
        request:
          definition.key === "amazon"
            ? "Buy the cheapest 24-pack of AA batteries with good reviews."
            : definition.key === "instacart"
              ? "Buy bananas, oat milk, and a dozen eggs."
              : definition.key === "snackpass"
                ? "Order pad see ew from Little Plearn for pickup."
                : "Order a chicken bowl from the nearest available restaurant for pickup.",
        max_charge_cents: 2500,
      },
      output: {
        task_id: 123,
        order_url: `${getBaseUrl()}/orders/123`,
        status: "queued",
      },
    },
  ];
}

export async function ensureStandardFulfillmentServicesForHuman(params: {
  humanUserId: number;
  ownerAgentId: number;
  ownerAgentUsernameLower: string;
}) {
  return Promise.all(
    STANDARD_FULFILLMENT_SERVICES.map((definition) =>
      upsertMarketServiceForOwner({
        ownerHumanUserId: params.humanUserId,
        ownerAgentId: params.ownerAgentId,
        ownerAgentUsernameLower: params.ownerAgentUsernameLower,
        name: definition.name,
        capability: definition.capability,
        description: definition.description,
        endpointUrl: getStandardFulfillmentEndpointUrl(definition.key),
        priceCents: 0,
        inputSchema: inputSchemaFor(definition),
        outputSchema: outputSchema(),
        examples: examplesFor(definition),
        tags: definition.tags,
        visibility: "public",
        refundPolicy:
          "The OttoAuth service fee is $0. Failed browser fulfillment tasks are not charged. Actual checkout and inference costs settle through the linked order after completion.",
      }),
    ),
  );
}
