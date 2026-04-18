import { getBaseUrl } from "@/lib/base-url";
import { upsertMarketServiceForOwner } from "@/lib/market-service-owner";

export type StandardFulfillmentServiceKey =
  | "snackpass"
  | "instacart"
  | "amazon"
  | "grubhub"
  | "email"
  | "ebay";

export type StandardFulfillmentServiceDefinition = {
  key: StandardFulfillmentServiceKey;
  name: string;
  capability: string;
  description: string;
  websiteUrl: string;
  promptPrefix: string;
  tags: string[];
  refundPolicy?: string;
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
  {
    key: "email",
    name: "Send an email",
    capability: "send_email_via_browser",
    description:
      "Use an OttoAuth browser fulfiller with a logged-in webmail account to draft or send an email. Service fee is $0; the requester pays inference costs after completion.",
    websiteUrl: "https://mail.google.com/",
    promptPrefix:
      "Use the logged-in webmail account in the browser to create the requested email. Default to creating a draft unless send_mode is 'send' or the requester explicitly asks to send now. Do not send spam, bulk outreach, threats, harassment, or illegal content; fail with a brief explanation instead.",
    tags: ["ottoauth-standard-fulfillment", "email", "gmail", "communication", "draft"],
    refundPolicy:
      "The OttoAuth service fee is $0. Failed browser fulfillment tasks are not charged. There is no checkout cost for normal email tasks; inference costs settle through the linked order after completion.",
  },
  {
    key: "ebay",
    name: "Buy on eBay",
    capability: "buy_on_ebay",
    description:
      "Use an OttoAuth browser fulfiller to find and buy products on eBay. Service fee is $0; the requester pays actual checkout and inference costs after completion.",
    websiteUrl: "https://www.ebay.com/",
    promptPrefix:
      "Use eBay for this shopping request. Prefer Buy It Now listings when the requester wants an immediate purchase. Do not bid, make offers, buy warranties, or purchase add-ons unless explicitly requested.",
    tags: ["ottoauth-standard-fulfillment", "shopping", "ebay", "auction", "delivery"],
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
  if (definition.key === "email") {
    return {
      type: "object",
      properties: {
        to: {
          type: "string",
          description: "Recipient email address.",
        },
        cc: {
          type: "string",
          description: "Optional CC recipients, comma-separated.",
        },
        subject: {
          type: "string",
          description: "Email subject line.",
        },
        body: {
          type: "string",
          description: "Email body to draft or send.",
        },
        send_mode: {
          type: "string",
          enum: ["draft", "send"],
          description:
            "Use draft by default. Set to send only when the requester explicitly wants the email sent.",
        },
        request: {
          type: "string",
          description:
            "Optional natural-language instructions for the email task.",
        },
        max_charge_cents: {
          type: "integer",
          description:
            "Optional spend cap for inference costs. Defaults to the requester's available OttoAuth credit balance.",
        },
      },
      required: ["to", "subject", "body"],
    };
  }

  if (definition.key === "ebay") {
    return {
      type: "object",
      properties: {
        request: {
          type: "string",
          description: "Natural-language eBay shopping request.",
        },
        item_url: {
          type: "string",
          description:
            "Optional exact eBay listing URL. Strongly recommended when the requester wants a purchase without search ambiguity.",
        },
        search_query: {
          type: "string",
          description: "Optional eBay search query.",
        },
        max_item_price_cents: {
          type: "integer",
          description: "Optional maximum item price before tax/shipping.",
        },
        max_charge_cents: {
          type: "integer",
          description:
            "Optional spend cap for actual checkout + inference costs. Defaults to the requester's available OttoAuth credit balance.",
        },
        shipping_address: {
          type: "string",
          description:
            "Optional shipping address. Required when no saved address should be used.",
        },
        condition: {
          type: "string",
          description: "Optional requested item condition, such as new, used, refurbished, or any.",
        },
        buy_now_only: {
          type: "boolean",
          description: "Whether to restrict to Buy It Now listings.",
        },
      },
      required: ["request"],
    };
  }

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
        ...(definition.key === "email"
          ? {
              to: "friend@example.com",
              subject: "Lunch tomorrow",
              body: "Hey, want to grab lunch tomorrow around noon?",
              send_mode: "draft",
            }
          : definition.key === "ebay"
            ? {
                request:
                  "Buy a used TI-84 Plus calculator under $45 with Buy It Now and seller rating above 98%.",
                buy_now_only: true,
                max_item_price_cents: 4500,
                max_charge_cents: 6500,
                fulfillment_method: "shipping",
              }
            : {
                request:
                  definition.key === "amazon"
                    ? "Buy the cheapest 24-pack of AA batteries with good reviews."
                    : definition.key === "instacart"
                      ? "Buy bananas, oat milk, and a dozen eggs."
                      : definition.key === "snackpass"
                        ? "Order pad see ew from Little Plearn for pickup."
                        : "Order a chicken bowl from the nearest available restaurant for pickup.",
                max_charge_cents: 2500,
              }),
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
          definition.refundPolicy ??
          "The OttoAuth service fee is $0. Failed browser fulfillment tasks are not charged. Actual checkout and inference costs settle through the linked order after completion.",
      }),
    ),
  );
}
