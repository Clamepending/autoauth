export function generateAccessibilityTree(
  filter: 'interactive' | 'all' = 'interactive',
  maxDepth: number = 12,
  maxChars: number = 15000,
  scopeRefId?: string | null,
): string {
  const ROLE_MAP: Record<string, string> = {
    A: 'link',
    BUTTON: 'button',
    INPUT: 'textbox',
    TEXTAREA: 'textarea',
    SELECT: 'combobox',
    OPTION: 'option',
    IMG: 'image',
    H1: 'heading',
    H2: 'heading',
    H3: 'heading',
    H4: 'heading',
    H5: 'heading',
    H6: 'heading',
    NAV: 'navigation',
    MAIN: 'main',
    HEADER: 'banner',
    FOOTER: 'contentinfo',
    ASIDE: 'complementary',
    FORM: 'form',
    TABLE: 'table',
    TH: 'columnheader',
    TD: 'cell',
    TR: 'row',
    UL: 'list',
    OL: 'list',
    LI: 'listitem',
    DIALOG: 'dialog',
    DETAILS: 'group',
    SUMMARY: 'button',
    LABEL: 'label',
    FIELDSET: 'group',
    LEGEND: 'legend',
    SECTION: 'region',
    ARTICLE: 'article',
    VIDEO: 'video',
    AUDIO: 'audio',
    IFRAME: 'iframe',
  };

  const INPUT_TYPE_ROLES: Record<string, string> = {
    checkbox: 'checkbox',
    radio: 'radio',
    range: 'slider',
    number: 'spinbutton',
    search: 'searchbox',
    email: 'textbox',
    tel: 'textbox',
    url: 'textbox',
    password: 'textbox',
    text: 'textbox',
    date: 'textbox',
    time: 'textbox',
    'datetime-local': 'textbox',
    submit: 'button',
    reset: 'button',
    button: 'button',
    file: 'file',
  };

  const INTERACTIVE_ROLES = new Set([
    'link', 'button', 'textbox', 'textarea', 'combobox', 'checkbox',
    'radio', 'slider', 'spinbutton', 'searchbox', 'file',
  ]);

  const NAV_SKIP_TAGS = new Set(['NAV', 'HEADER', 'FOOTER']);
  const MAX_SELECT_OPTIONS = 5;

  const w = window as unknown as {
    __claudeRefCounter?: number;
    __claudeElementMap?: Record<string, WeakRef<Element>>;
  };

  if (!w.__claudeElementMap) w.__claudeElementMap = {};
  if (!w.__claudeRefCounter) w.__claudeRefCounter = 0;

  function getRef(el: Element): string {
    for (const [id, wr] of Object.entries(w.__claudeElementMap!)) {
      if (wr.deref() === el) return id;
    }
    w.__claudeRefCounter! += 1;
    const id = `ref_${w.__claudeRefCounter}`;
    w.__claudeElementMap![id] = new WeakRef(el);
    return id;
  }

  function getRole(el: Element): string {
    const ariaRole = el.getAttribute('role');
    if (ariaRole) return ariaRole;
    const tag = el.tagName;
    if (tag === 'INPUT') {
      const inputType = (el as HTMLInputElement).type || 'text';
      return INPUT_TYPE_ROLES[inputType] || 'textbox';
    }
    return ROLE_MAP[tag] || '';
  }

  function getName(el: Element): string {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) return labelEl.textContent?.trim() || '';
    }

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      const inputEl = el as HTMLInputElement;
      if (
        el.tagName === 'INPUT' &&
        (inputEl.type === 'submit' || inputEl.type === 'button' || inputEl.type === 'reset') &&
        inputEl.value
      ) {
        return inputEl.value.trim();
      }
      if (inputEl.id) {
        const label = document.querySelector(`label[for="${inputEl.id}"]`);
        if (label) return label.textContent?.trim() || '';
      }
      if (inputEl.placeholder) return inputEl.placeholder;
      if (inputEl.title) return inputEl.title;
    }

    if (el.tagName === 'IMG') return (el as HTMLImageElement).alt || '';
    if (el.tagName === 'A') return el.textContent?.trim().slice(0, 80) || '';

    const title = el.getAttribute('title');
    if (title) return title;

    if (['BUTTON', 'SUMMARY', 'LEGEND', 'LABEL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TH', 'OPTION'].includes(el.tagName)) {
      return el.textContent?.trim().slice(0, 120) || '';
    }

    return '';
  }

  function buildAttrs(el: Element, role: string): string {
    const parts: string[] = [];
    if (el.tagName === 'A') {
      const href = el.getAttribute('href');
      if (href) parts.push(`href="${href}"`);
    }
    if (el.tagName === 'INPUT') {
      const input = el as HTMLInputElement;
      if (input.type) parts.push(`type="${input.type}"`);
      if (input.placeholder) parts.push(`placeholder="${input.placeholder}"`);
      if (input.value) parts.push(`value="${input.value}"`);
      if (input.checked) parts.push('checked');
      if (input.disabled) parts.push('disabled');
      if (input.readOnly) parts.push('readonly');
    }
    if (el.tagName === 'TEXTAREA') {
      const ta = el as HTMLTextAreaElement;
      if (ta.placeholder) parts.push(`placeholder="${ta.placeholder}"`);
    }
    if (role === 'heading') {
      const level = el.tagName.replace('H', '');
      parts.push(`level="${level}"`);
    }
    if ((el as HTMLElement).contentEditable === 'true') parts.push('editable');
    return parts.join(' ');
  }

  let output = '';
  let charCount = 0;
  let truncated = false;

  function walk(node: Element, depth: number, indent: number, skipNav: boolean): void {
    if (truncated || depth > maxDepth) return;
    if (charCount >= maxChars) { truncated = true; return; }

    const style = window.getComputedStyle(node);
    const hidden = style.display === 'none' || style.visibility === 'hidden' ||
      node.getAttribute('aria-hidden') === 'true';
    if (hidden && filter === 'interactive') return;

    if (skipNav && NAV_SKIP_TAGS.has(node.tagName)) return;

    const role = getRole(node);
    const isInteractive = INTERACTIVE_ROLES.has(role);

    if (role && (filter === 'all' || isInteractive)) {
      const name = getName(node);
      const ref = getRef(node);
      const attrs = buildAttrs(node, role);
      const prefix = '  '.repeat(indent);
      const nameStr = name ? ` "${name}"` : '';
      const attrStr = attrs ? ' ' + attrs : '';
      const line = `${prefix}${role}${nameStr} [${ref}]${attrStr}\n`;

      if (charCount + line.length > maxChars) { truncated = true; return; }
      output += line;
      charCount += line.length;

      if (node.tagName === 'SELECT') {
        const select = node as HTMLSelectElement;
        const opts = Array.from(select.options);
        const selectedIdx = select.selectedIndex;
        const toShow: HTMLOptionElement[] = [];

        if (selectedIdx >= 0 && opts[selectedIdx]) toShow.push(opts[selectedIdx]);
        for (const opt of opts) {
          if (toShow.length >= MAX_SELECT_OPTIONS) break;
          if (!toShow.includes(opt)) toShow.push(opt);
        }

        for (const opt of toShow) {
          const optRef = getRef(opt);
          const sel = opt.selected ? ' (selected)' : '';
          const optLine = `${prefix}  option "${opt.textContent?.trim()}"${sel} value="${opt.value}" [${optRef}]\n`;
          if (charCount + optLine.length > maxChars) { truncated = true; return; }
          output += optLine;
          charCount += optLine.length;
        }
        if (opts.length > MAX_SELECT_OPTIONS) {
          const moreLine = `${prefix}  ... ${opts.length - MAX_SELECT_OPTIONS} more options\n`;
          output += moreLine;
          charCount += moreLine.length;
        }
        return;
      }
    }

    for (const child of Array.from(node.children)) {
      walk(child, depth + 1, role ? indent + 1 : indent, skipNav);
    }
  }

  let root: Element = document.body;
  if (scopeRefId && w.__claudeElementMap![scopeRefId]) {
    const el = w.__claudeElementMap![scopeRefId].deref();
    if (el) root = el;
  }

  const hasExplicitScope = !!scopeRefId;

  if (filter === 'interactive' && !hasExplicitScope) {
    const mainContent = document.querySelector('main, [role="main"], #main-content, #content, #search, .main-content, [id*="results"], [id*="content"]');
    if (mainContent) {
      const mainRef = getRef(mainContent);
      const headerLine = `[main content area] [${mainRef}]\n`;
      output += headerLine;
      charCount += headerLine.length;
      walk(mainContent, 0, 1, false);

      if (!truncated) {
        const sepLine = '\n[page navigation/chrome]\n';
        output += sepLine;
        charCount += sepLine.length;
        walk(root, 0, 0, true);
      }
    } else {
      walk(root, 0, 0, false);
    }
  } else {
    walk(root, 0, 0, false);
  }

  if (truncated) {
    output += '\n[OUTPUT TRUNCATED - use ref_id to narrow scope]\n';
  }

  return output || '(empty page)';
}
