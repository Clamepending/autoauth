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

export function buildQuickAccessPrompt(links = DEFAULT_QUICK_ACCESS_LINKS) {
  if (!Array.isArray(links) || links.length === 0) return '';
  const rows = links.map((link) => `- ${link.label} | ${link.url}`).join('\n');
  return `Quick access table:
- Use this locally maintained site table for businesses that often do not show up reliably in search.
- If the task mentions one of these businesses or a close variant of its name, navigate directly to the mapped URL instead of using a homepage or general search first.

${rows}`;
}
