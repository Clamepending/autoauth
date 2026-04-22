export const DEFAULT_QUICK_ACCESS_LINKS = [
  {
    id: 'noodle-dynasty-berkeley',
    label: 'Noodle Dynasty Berkeley',
    url: 'https://order.snackpass.co/634dc06c193ab700be08aff0',
  },
  {
    id: 'tp-tea-berkeley',
    label: 'TP Tea Berkeley',
    url: 'https://order.snackpass.co/TP-TEA-(Berkeley-2383-Telegraph-Ave)-5deaa0f39bb37200f43f7768',
  },
  {
    id: 'xpression-berkeley',
    label: 'Xpression Berkeley',
    url: 'https://order.snackpass.co/xpression',
  },
  {
    id: 'boba-ninja-berkeley',
    label: 'Boba Ninja Berkeley',
    url: 'https://order.snackpass.co/bobaninja',
  },
  {
    id: 'scoop-n-chill-berkeley',
    label: 'Scoop n Chill Berkeley',
    url: 'https://order.snackpass.co/scoopnchill',
  },
  {
    id: 'v-a-cafe-berkeley',
    label: 'V&A Cafe Berkeley',
    url: 'https://order.snackpass.co/vandacafe',
  },
];

export const DEFAULT_SUPPORTED_PLATFORM_LINKS = [
  {
    id: 'platform-duckduckgo',
    label: 'DuckDuckGo',
    url: 'https://duckduckgo.com/',
  },
  {
    id: 'platform-bing',
    label: 'Bing',
    url: 'https://www.bing.com/',
  },
  {
    id: 'platform-fantuan',
    label: 'Fantuan',
    url: 'https://www.fantuanorder.com/',
  },
  {
    id: 'platform-grubhub',
    label: 'Grubhub',
    url: 'https://www.grubhub.com/',
  },
  {
    id: 'platform-doordash',
    label: 'DoorDash',
    url: 'https://www.doordash.com/',
  },
  {
    id: 'platform-uber-eats',
    label: 'Uber Eats',
    url: 'https://www.ubereats.com/',
  },
  {
    id: 'platform-uber-central',
    label: 'Uber Central',
    url: 'https://central.uber.com/',
  },
  {
    id: 'platform-instacart',
    label: 'Instacart',
    url: 'https://www.instacart.com/',
  },
];

export function buildQuickAccessPrompt(links = DEFAULT_QUICK_ACCESS_LINKS) {
  const sections = [];
  const supportedPlatformRows = DEFAULT_SUPPORTED_PLATFORM_LINKS
    .map((link) => `- ${link.label} | ${link.url}`)
    .join('\n');
  sections.push(`Supported platforms table:
- If a task needs a generic web search and does not require a specific search engine, prefer DuckDuckGo first, then Bing, before Google.
- If Google shows an unusual-traffic page, a "sorry" page, or any CAPTCHA/robot check, stop retrying Google and switch to DuckDuckGo or Bing immediately.
- If the task does not specify a platform for food ordering, prefer Fantuan first, then Grubhub before generic search.
- For food orders that name a restaurant but do not name a website, search for that restaurant inside Fantuan first, then Grubhub if Fantuan clearly cannot serve it, then DoorDash or Uber Eats if both supported food platforms fail.
- Do not use open-web search results, maps, or merchant-owned websites for a food order unless the requester explicitly asks for that site or the supported food platforms clearly fail.
- If the task is about grocery delivery and does not specify a platform, prefer Instacart before generic web search or merchant-owned grocery sites.
- If the task does not specify a platform for ride booking, prefer Uber rides through Uber Central at central.uber.com.
- If the task explicitly names a platform, follow the task instead of these defaults.

${supportedPlatformRows}`);

  if (!Array.isArray(links) || links.length === 0) {
    return sections.join('\n\n');
  }
  const rows = links.map((link) => `- ${link.label} | ${link.url}`).join('\n');
  sections.push(`Quick access table:
- Use this locally maintained site table for businesses that often do not show up reliably in search.
- If the task mentions one of these businesses or a close variant of its name, navigate directly to the mapped URL instead of using a homepage or general search first.

${rows}`);
  return sections.join('\n\n');
}
