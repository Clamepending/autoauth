import { STORAGE_KEY_QUICK_ACCESS_LINKS } from '../../shared/constants';
import type { QuickAccessLink } from '../../shared/types';
import { useStore } from '../store';

const URL_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

export const DEFAULT_QUICK_ACCESS_LINKS: QuickAccessLink[] = [
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

export const DEFAULT_SUPPORTED_PLATFORM_LINKS: QuickAccessLink[] = [
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

function normalizeUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  const candidate = URL_SCHEME_PATTERN.test(trimmed) ? trimmed : `https://${trimmed}`;
  const parsed = new URL(candidate);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Quick access links must use http or https URLs.');
  }
  return parsed.toString();
}

function sanitizeQuickAccessLinks(rawValue: unknown): QuickAccessLink[] {
  if (!Array.isArray(rawValue)) {
    return DEFAULT_QUICK_ACCESS_LINKS;
  }

  const seen = new Set<string>();
  const links: QuickAccessLink[] = [];
  for (const entry of rawValue) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const label = typeof record.label === 'string' ? record.label.trim() : '';
    const rawUrl = typeof record.url === 'string' ? record.url.trim() : '';
    if (!label || !rawUrl) continue;
    try {
      const url = normalizeUrl(rawUrl);
      const id = typeof record.id === 'string' && record.id.trim()
        ? record.id.trim()
        : `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'quick-link'}-${links.length + 1}`;
      if (seen.has(id)) continue;
      seen.add(id);
      links.push({ id, label, url });
    } catch {
      continue;
    }
  }

  return links.length > 0 ? links : DEFAULT_QUICK_ACCESS_LINKS;
}

export async function loadQuickAccessLinks(): Promise<QuickAccessLink[]> {
  const result = await chrome.storage.local.get([STORAGE_KEY_QUICK_ACCESS_LINKS]);
  const links = sanitizeQuickAccessLinks(result[STORAGE_KEY_QUICK_ACCESS_LINKS]);
  useStore.getState().setQuickAccessLinks(links);
  return links;
}

export async function saveQuickAccessLinks(rawLinks: QuickAccessLink[]): Promise<QuickAccessLink[]> {
  const links = sanitizeQuickAccessLinks(rawLinks);
  await chrome.storage.local.set({
    [STORAGE_KEY_QUICK_ACCESS_LINKS]: links,
  });
  useStore.getState().setQuickAccessLinks(links);
  return links;
}

export async function resetQuickAccessLinks(): Promise<QuickAccessLink[]> {
  await chrome.storage.local.set({
    [STORAGE_KEY_QUICK_ACCESS_LINKS]: DEFAULT_QUICK_ACCESS_LINKS,
  });
  useStore.getState().setQuickAccessLinks(DEFAULT_QUICK_ACCESS_LINKS);
  return DEFAULT_QUICK_ACCESS_LINKS;
}

export function buildQuickAccessPrompt(links: QuickAccessLink[]): string {
  const quickAccessRows = links
    .map((link) => `- ${link.label} | ${link.url}`)
    .join('\n');
  const supportedPlatformRows = DEFAULT_SUPPORTED_PLATFORM_LINKS
    .map((link) => `- ${link.label} | ${link.url}`)
    .join('\n');

  const sections: string[] = [];
  sections.push(`<supported_platforms>
Use this built-in supported-platform table when the task does not specify which platform to use.
- If a food order or restaurant task does not name a platform, prefer Fantuan or Grubhub before falling back to generic search.
- If a ride task does not name a platform, prefer Uber rides through Uber Central at central.uber.com.
- If the task explicitly names a platform, follow the task instead of these defaults.

${supportedPlatformRows}
</supported_platforms>`);

  if (!links.length) {
    return sections.join('\n\n');
  }

  sections.push(`<quick_access_links>
Use this locally maintained quick-access table for websites that often do not show up reliably in search.
If a task mentions one of these businesses or a close variant of its name, navigate directly to the mapped URL instead of relying on Google/search results.

${quickAccessRows}
</quick_access_links>`);

  return sections.join('\n\n');
}
