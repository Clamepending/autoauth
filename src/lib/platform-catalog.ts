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

export function getPlatformCatalog() {
  return PLATFORM_CATALOG;
}

export function getFeaturedPlatforms(limit = 24) {
  return [...PLATFORM_CATALOG.platforms]
    .sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name))
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
