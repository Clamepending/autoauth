import * as cheerio from "cheerio";

const PRICE_SELECTORS = [
  "#corePrice_feature_div .a-price .a-offscreen",
  "#corePriceDisplay_desktop_feature_div .a-price .a-offscreen",
  "#price_inside_buybox",
  "#newBuyBoxPrice",
  "#priceblock_ourprice",
  "#priceblock_dealprice",
  ".a-price .a-offscreen",
];

const TITLE_SELECTOR = "#productTitle";

export type ScrapeResult = {
  priceCents: number;
  priceDisplay: string;
  productTitle: string | null;
};

/**
 * Fetch an Amazon product page and extract the price via HTML selectors.
 * Returns null if the page can't be fetched or no price is found.
 */
export async function scrapeAmazonPrice(
  url: string,
): Promise<ScrapeResult | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) return null;

    const html = await response.text();
    const $ = cheerio.load(html);

    for (const selector of PRICE_SELECTORS) {
      const el = $(selector).first();
      if (!el.length) continue;

      const text = el.text().trim();
      const match = text.match(/\$?([\d,]+\.?\d*)/);
      if (!match) continue;

      const price = parseFloat(match[1].replace(/,/g, ""));
      if (price > 0 && price < 100_000) {
        const title = $(TITLE_SELECTOR).text().trim() || null;
        return {
          priceCents: Math.round(price * 100),
          priceDisplay: `$${price.toFixed(2)}`,
          productTitle: title,
        };
      }
    }

    return null;
  } catch {
    return null;
  }
}
