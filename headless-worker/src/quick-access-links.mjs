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
];

export const DEFAULT_SUPPORTED_PLATFORM_LINKS = [
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
    id: 'platform-uber-central',
    label: 'Uber Central',
    url: 'https://central.uber.com/',
  },
];

export function buildQuickAccessPrompt(links = DEFAULT_QUICK_ACCESS_LINKS) {
  const sections = [];
  const supportedPlatformRows = DEFAULT_SUPPORTED_PLATFORM_LINKS
    .map((link) => `- ${link.label} | ${link.url}`)
    .join('\n');
  sections.push(`Supported platforms table:
- If the task does not specify a platform for food ordering, prefer Fantuan or Grubhub before generic search.
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
