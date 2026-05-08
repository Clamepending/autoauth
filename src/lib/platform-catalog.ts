import rawCatalog from "@/data/platform-catalog.json";

export type PlatformCatalogKind =
  | "retail_purchase"
  | "grocery_delivery"
  | "restaurant_delivery"
  | "ride"
  | "manufacturing_3d_print"
  | "manufacturing_pcb"
  | "custom_human_task";

export type PlatformCatalogEntry = {
  id: string;
  name: string;
  category:
    | "retail_marketplace"
    | "local_delivery_travel"
    | "get_made_manufacturing"
    | "pcb_electronics"
    | "print_custom_goods";
  priority: number;
  kind: PlatformCatalogKind;
  url: string;
  aliases: string[];
  fileTypes: string[];
  examples: string[];
};

export type PlatformCatalog = {
  version: string;
  description: string;
  platforms: PlatformCatalogEntry[];
};

export const PLATFORM_CATALOG = rawCatalog as PlatformCatalog;

const FEATURED_PLATFORM_IDS = [
  "amazon",
  "walmart",
  "target",
  "ebay",
  "etsy",
  "shopify_store",
  "aliexpress",
  "temu",
  "tiktok_shop",
  "shein",
  "best_buy",
  "home_depot",
  "lowes",
  "costco",
  "wayfair",
  "chewy",
  "sephora",
  "newegg",
  "instacart",
  "doordash",
  "uber_eats",
  "grubhub",
  "snackpass",
  "gopuff",
  "shipt",
  "kroger",
  "safeway",
  "uber",
  "lyft",
  "airbnb",
  "booking",
  "xometry",
  "protolabs",
  "hubs",
  "fictiv",
  "sendcutsend",
  "craftcloud",
  "treatstock",
  "sculpteo",
  "jlcpcb",
  "pcbway",
  "oshpark",
  "seeed_fusion",
  "digikey",
  "mouser",
  "mcmaster_carr",
  "printful",
  "vistaprint",
  "custom_ink",
  "sticker_mule",
];

const FEATURED_PLATFORM_RANK = new Map(
  FEATURED_PLATFORM_IDS.map((id, index) => [id, index]),
);

export function getPlatformCatalog() {
  return PLATFORM_CATALOG;
}

export function getFeaturedPlatforms(limit = 24) {
  return [...PLATFORM_CATALOG.platforms]
    .sort((left, right) => {
      const leftRank = FEATURED_PLATFORM_RANK.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightRank = FEATURED_PLATFORM_RANK.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      return leftRank - rightRank || left.priority - right.priority || left.name.localeCompare(right.name);
    })
    .slice(0, limit);
}

export function getPlatformCategoryCounts() {
  return PLATFORM_CATALOG.platforms.reduce<Record<string, number>>((counts, platform) => {
    counts[platform.category] = (counts[platform.category] || 0) + 1;
    return counts;
  }, {});
}

export function getUploadPlatformCount() {
  return PLATFORM_CATALOG.platforms.filter((platform) => platform.fileTypes.length > 0).length;
}
