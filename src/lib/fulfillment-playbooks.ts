export type FulfillmentPlaybook = {
  id: string;
  label: string;
  aliases: string[];
  domains: string[];
  instructions: string[];
};

export type FulfillmentPlaybookContext = {
  rawTask: string;
  taskPrompt?: string | null;
  websiteUrl?: string | null;
  merchantName?: string | null;
  platformHint?: string | null;
  fulfillment?: string | null;
  pickupLocation?: string | null;
  shippingAddress?: string | null;
  requestJson?: Record<string, unknown> | null;
};

export type SelectedFulfillmentPlaybook = FulfillmentPlaybook & {
  score: number;
  reasons: string[];
  contextualInstructions: string[];
};

export type FulfillmentPlaybookSummary = {
  id: string;
  label: string;
  score: number;
  reasons: string[];
};

const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

const FULFILLMENT_PLAYBOOKS: FulfillmentPlaybook[] = [
  {
    id: "snackpass",
    label: "Snackpass",
    aliases: ["snackpass", "snack pass", "order snackpass"],
    domains: ["snackpass.co", "order.snackpass.co"],
    instructions: [
      "Do not start from the Snackpass public homepage. It often does not expose a usable global store search.",
      "Find the store-specific menu by searching the browser address/search bar for the store name plus Snackpass, then prefer order.snackpass.co or another official Snackpass ordering URL.",
      "Use a known direct store URL when available; this avoids search-engine CAPTCHA and generic Snackpass homepage dead ends.",
      "Ignore articles, guides, campus newspaper pages, maps, and social results unless they link directly to the official store-specific Snackpass ordering page.",
      "Before adding items, verify the store name, city or campus context, pickup versus delivery mode, and visible menu belong to the requested merchant.",
      "After checkout, switch to the active order/status view if the receipt page omits the order number, pickup code, ready time, or pickup instructions.",
    ],
  },
  {
    id: "amazon",
    label: "Amazon",
    aliases: ["amazon", "amazon.com", "amazon prime"],
    domains: ["amazon.com"],
    instructions: [
      "Set or verify the delivery ZIP/address early because search ranking, inventory, shipping speed, and total price depend on it.",
      "Prefer the exact requested product, brand, size, color, quantity, and condition. Do not substitute a sponsored or similar item unless the request allows alternatives.",
      "Check seller, shipping date, delivery date, returnability, and total price before purchase.",
      "Skip add-ons, warranties, subscriptions, bundles, and trial prompts unless explicitly requested.",
    ],
  },
  {
    id: "instacart",
    label: "Instacart",
    aliases: ["instacart", "insta cart"],
    domains: ["instacart.com"],
    instructions: [
      "Set the delivery address or pickup ZIP/store before searching so store availability and prices are local to the requester.",
      "Choose the requested store if provided; otherwise use the closest supported store only after the location is known.",
      "Follow the requester substitution policy. If none is provided, allow only close size/brand equivalents for minor grocery gaps and report substitutions clearly.",
      "Review delivery or pickup window, service fees, bag fees, taxes, tip, and unavailable items before checkout.",
      "Instacart may show visual verification in fresh automation sessions; attempt safe visible verification once, but fail clearly instead of looping if the challenge cannot be solved.",
    ],
  },
  {
    id: "grubhub",
    label: "Grubhub",
    aliases: ["grubhub", "grub hub"],
    domains: ["grubhub.com"],
    instructions: [
      "Set the delivery address or pickup/search location before restaurant search; do not rely on device geolocation.",
      "If Grubhub opens an address-first modal, enter the requester-provided address or search location before searching restaurants or dishes.",
      "Verify the restaurant name, city, delivery versus pickup mode, estimated timing, and menu match the request before adding items.",
      "Use sensible defaults only for minor modifiers. If a required modifier changes the core item, request clarification.",
      "Set tip to 0 unless explicitly requested or the site requires a non-zero amount; then choose the lowest available amount and report it.",
    ],
  },
  {
    id: "uber",
    label: "Uber / Uber Eats",
    aliases: ["uber", "uber eats", "ubereats", "uber one", "uber central"],
    domains: ["uber.com", "ubereats.com"],
    instructions: [
      "First classify the request as food delivery, package delivery, or ride/travel; the required addresses and checkout checks differ.",
      "For Uber Eats, set the delivery address before searching, verify restaurant identity and delivery radius, and review fees, taxes, ETA, and tip.",
      "For rides, confirm pickup, dropoff, rider, timing, and ride type before booking. Do not assume the browser device location is the pickup point.",
      "Uber may show automated security checks or access-denied pages in fresh automation sessions; wait for an automatic check once, then fail clearly if the site remains blocked.",
      "Decline subscriptions, upgrades, promos that change the payment commitment, and optional extras unless explicitly requested.",
    ],
  },
  {
    id: "mcmaster",
    label: "McMaster-Carr",
    aliases: ["mcmaster", "mcmaster carr", "mcmaster-carr", "mcmaster.com"],
    domains: ["mcmaster.com"],
    instructions: [
      "Prefer exact part numbers. If a part number is provided, search that first and do not substitute a nearby spec without explicit permission.",
      "Verify material, dimensions, pack size, quantity, compliance notes, and shipping availability before checkout.",
      "Use the provided shipping address or saved business address exactly; do not invent missing business, phone, or recipient fields.",
      "McMaster often shows shipping after order placement; if final shipping is not visible before purchase, report that uncertainty in the final result.",
    ],
  },
  {
    id: "ebay",
    label: "eBay",
    aliases: ["ebay", "e bay", "ebay.com"],
    domains: ["ebay.com"],
    instructions: [
      "Start at ebay.com and use the site's own search box when possible; direct search-result URLs may return access-denied pages in automation sessions.",
      "Prefer Buy It Now listings unless the requester explicitly asks for an auction or bid.",
      "Verify item condition, seller rating, shipping location, delivery date, returns, authenticity notes, and total price.",
      "Avoid listings with unclear photos, parts-only wording, missing accessories, or incompatible variants when the request expects a standard working item.",
      "Do not bid, make offers, or accept recurring/store promotions unless explicitly requested.",
    ],
  },
  {
    id: "airbnb",
    label: "Airbnb",
    aliases: ["airbnb", "air bnb", "airbnb.com"],
    domains: ["airbnb.com"],
    instructions: [
      "Set destination, dates, guests, bedrooms, and other hard filters before comparing listings.",
      "Review all-in price, cleaning/service fees, cancellation policy, house rules, check-in logistics, location, and host/listing ratings before booking.",
      "Do not book nonrefundable stays, shared rooms, unusual house rules, or listings outside the requested area unless explicitly allowed.",
      "If required traveler details, dates, or guest count are missing, request clarification instead of guessing.",
    ],
  },
  {
    id: "google-flights",
    label: "Google Flights",
    aliases: ["google flights", "flights.google.com", "google flight"],
    domains: ["flights.google.com"],
    instructions: [
      "Use Google Flights for flight search and comparison, then expect final purchase to happen on the airline or travel partner checkout.",
      "Set origin, destination, dates, travelers, cabin, bags, and timing constraints before evaluating options.",
      "Compare total fare, airline, layovers, airports, baggage rules, cancellation/change policy, and booking partner before selecting.",
      "Do not complete a flight purchase unless the requester supplied all required traveler details and explicitly authorized the checkout flow within the spend cap.",
    ],
  },
  {
    id: "booking",
    label: "Booking.com",
    aliases: ["booking.com", "booking com"],
    domains: ["booking.com"],
    instructions: [
      "Set destination, dates, guests, rooms, and any hard filters before comparing properties.",
      "Prefer Booking.com's own search UI or canonical city/property pages when raw query URLs drop parameters or land on a generic search shell.",
      "Review final price with taxes/fees, cancellation policy, prepayment requirements, property rating, room type, bed setup, and check-in rules before booking.",
      "Avoid nonrefundable rooms, surprise deposits, offsite payment instructions, or properties outside the requested area unless explicitly allowed.",
      "If dates, guest count, or required traveler details are missing, request clarification instead of guessing.",
    ],
  },
];

function normalizeText(value: unknown) {
  return typeof value === "string"
    ? value
        .toLowerCase()
        .replace(/&/g, " and ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : "";
}

function textContainsAlias(text: string, alias: string) {
  const normalizedAlias = normalizeText(alias);
  if (!text || !normalizedAlias) return false;
  return ` ${text} `.includes(` ${normalizedAlias} `);
}

function hostnameFromUrl(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  const candidate = URL_SCHEME_PATTERN.test(raw) ? raw : `https://${raw}`;
  try {
    return new URL(candidate).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function hostMatchesDomain(hostname: string | null, domain: string) {
  if (!hostname) return false;
  const normalizedDomain = domain.toLowerCase().replace(/^www\./, "");
  return hostname === normalizedDomain || hostname.endsWith(`.${normalizedDomain}`);
}

function stringField(record: Record<string, unknown> | null | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = record?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function requestJsonUrl(requestJson: Record<string, unknown> | null | undefined) {
  return stringField(requestJson, "url", "website_url", "websiteUrl", "merchant_url", "merchantUrl");
}

function makeContextText(context: FulfillmentPlaybookContext) {
  const requestJson = context.requestJson;
  return normalizeText(
    [
      context.rawTask,
      context.taskPrompt,
      context.merchantName,
      context.platformHint,
      context.fulfillment,
      context.pickupLocation,
      stringField(requestJson, "task", "merchant_name", "platform_hint", "platform", "service"),
    ]
      .filter(Boolean)
      .join(" "),
  );
}

function formatSnackpassSearchQuery(context: FulfillmentPlaybookContext) {
  const merchantName =
    context.merchantName ||
    stringField(context.requestJson, "merchant_name", "store_name", "storeName");
  const location =
    context.pickupLocation ||
    stringField(context.requestJson, "pickup_location", "pickupLocation", "location");
  if (!merchantName) return "the requested store name plus Snackpass";
  return `"${merchantName}" Snackpass${location ? ` ${location}` : ""}`;
}

function contextualInstructionsFor(
  playbook: FulfillmentPlaybook,
  context: FulfillmentPlaybookContext,
) {
  const shippingInstruction = context.shippingAddress
    ? "A requester-provided address is available; use it exactly if this site asks for delivery or shipping details."
    : null;

  switch (playbook.id) {
    case "snackpass":
      return [
        `For this request, search the browser address/search bar for ${formatSnackpassSearchQuery(context)} before opening any generic Snackpass page.`,
        "Stay on the official store-specific Snackpass menu once found.",
      ];
    case "amazon":
    case "instacart":
    case "grubhub":
    case "uber":
    case "mcmaster":
    case "ebay":
      return shippingInstruction ? [shippingInstruction] : [];
    default:
      return [];
  }
}

export function selectFulfillmentPlaybooks(
  context: FulfillmentPlaybookContext,
): SelectedFulfillmentPlaybook[] {
  const contextText = makeContextText(context);
  const platformText = normalizeText(
    context.platformHint || stringField(context.requestJson, "platform_hint", "platform", "service"),
  );
  const merchantText = normalizeText(
    context.merchantName ||
      stringField(context.requestJson, "merchant_name", "store_name", "storeName"),
  );
  const urlHostname =
    hostnameFromUrl(context.websiteUrl) || hostnameFromUrl(requestJsonUrl(context.requestJson));

  const selected = FULFILLMENT_PLAYBOOKS.map((playbook) => {
    let score = 0;
    const reasons: string[] = [];

    const matchedDomain = playbook.domains.find((domain) => hostMatchesDomain(urlHostname, domain));
    if (matchedDomain) {
      score += 100;
      reasons.push(`matched domain ${matchedDomain}`);
    }

    if (platformText) {
      const matchedPlatformAlias =
        textContainsAlias(platformText, playbook.id) ||
        playbook.aliases.some((alias) => textContainsAlias(platformText, alias));
      if (matchedPlatformAlias) {
        score += 80;
        reasons.push("matched platform hint");
      }
    }

    if (merchantText) {
      const matchedMerchantAlias = playbook.aliases.some((alias) =>
        textContainsAlias(merchantText, alias),
      );
      if (matchedMerchantAlias) {
        score += 50;
        reasons.push("matched merchant hint");
      }
    }

    const matchedAlias = playbook.aliases.find((alias) => textContainsAlias(contextText, alias));
    if (matchedAlias) {
      score += 40;
      reasons.push(`matched request text "${matchedAlias}"`);
    }

    return {
      ...playbook,
      score,
      reasons,
      contextualInstructions: contextualInstructionsFor(playbook, context),
    };
  })
    .filter((playbook) => playbook.score > 0)
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));

  return selected.slice(0, 3);
}

export function formatFulfillmentPlaybooksForPrompt(
  playbooks: SelectedFulfillmentPlaybook[] | null | undefined,
) {
  if (!playbooks?.length) return "";
  const playbookSections = playbooks
    .map((playbook) => {
      const instructions = [
        ...playbook.contextualInstructions,
        ...playbook.instructions,
      ];
      return `${playbook.label} playbook:
${instructions.map((instruction) => `- ${instruction}`).join("\n")}`;
    })
    .join("\n\n");

  return `
Retrieved fulfillment playbooks:
- Use only the relevant site playbook(s) below for routing and checkout tactics.
- These playbooks do not override the spend cap, requester constraints, safety rules, or required-site policy.

${playbookSections}`;
}

export function summarizeSelectedFulfillmentPlaybooks(
  playbooks: SelectedFulfillmentPlaybook[] | null | undefined,
): FulfillmentPlaybookSummary[] {
  return (playbooks ?? []).map((playbook) => ({
    id: playbook.id,
    label: playbook.label,
    score: playbook.score,
    reasons: playbook.reasons,
  }));
}
