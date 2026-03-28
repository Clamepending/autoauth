export function extractPageText(maxChars: number = 50000): string {
  const contentSelectors = [
    'article',
    'main',
    '[class*="articleBody"]',
    '[class*="article-body"]',
    '[class*="post-content"]',
    '[class*="entry-content"]',
    '[class*="content-body"]',
    '[role="main"]',
    '.content',
    '#content',
  ];

  let bestElement: Element | null = null;
  let bestLength = 0;

  for (const selector of contentSelectors) {
    try {
      const elements = document.querySelectorAll(selector);
      for (const el of Array.from(elements)) {
        const len = (el.textContent || '').length;
        if (len > bestLength) {
          bestLength = len;
          bestElement = el;
        }
      }
    } catch {
      // invalid selector, skip
    }
  }

  if (!bestElement) {
    bestElement = document.body;
  }

  const rawText = bestElement.textContent || '';
  const cleaned = rawText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');

  const tag = bestElement.tagName.toLowerCase();
  const header = `Title: ${document.title}\nURL: ${window.location.href}\nSource element: <${tag}>\n---\n`;
  const text = header + cleaned;

  if (text.length > maxChars) {
    return text.slice(0, maxChars) + '\n\n[TEXT TRUNCATED at ' + maxChars + ' characters]';
  }

  return text;
}
