export function generateAccessibilityTree(
  filterOrOptions = 'interactive',
  maxDepth = 12,
  maxChars = 15000,
  scopeRefId = null,
) {
  const options =
    filterOrOptions && typeof filterOrOptions === 'object'
      ? filterOrOptions
      : {
          filter: filterOrOptions,
          maxDepth,
          maxChars,
          scopeRefId,
        };
  const filter = options.filter === 'all' ? 'all' : 'interactive';
  maxDepth = Number(options.maxDepth) || 12;
  maxChars = Number(options.maxChars) || 15000;
  scopeRefId = options.scopeRefId ? String(options.scopeRefId) : null;

  const ROLE_MAP = {
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

  const INPUT_TYPE_ROLES = {
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

  const w = window;
  if (!w.__claudeElementMap) w.__claudeElementMap = {};
  if (!w.__claudeRefCounter) w.__claudeRefCounter = 0;

  function getRef(el) {
    for (const [id, wr] of Object.entries(w.__claudeElementMap)) {
      if (wr.deref() === el) return id;
    }
    w.__claudeRefCounter += 1;
    const id = `ref_${w.__claudeRefCounter}`;
    w.__claudeElementMap[id] = new WeakRef(el);
    return id;
  }

  function getRole(el) {
    const ariaRole = el.getAttribute('role');
    if (ariaRole) return ariaRole;
    const tag = el.tagName;
    if (tag === 'INPUT') {
      const inputType = el.type || 'text';
      return INPUT_TYPE_ROLES[inputType] || 'textbox';
    }
    return ROLE_MAP[tag] || '';
  }

  function getName(el) {
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel) return ariaLabel;

    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) return labelEl.textContent?.trim() || '';
    }

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') {
      if (
        el.tagName === 'INPUT' &&
        ['submit', 'button', 'reset'].includes(el.type || '') &&
        el.value
      ) {
        return el.value.trim();
      }
      if (el.id) {
        const label = document.querySelector(`label[for="${el.id}"]`);
        if (label) return label.textContent?.trim() || '';
      }
      if (el.placeholder) return el.placeholder;
      if (el.title) return el.title;
    }

    if (el.tagName === 'IMG') return el.alt || '';
    if (el.tagName === 'A') return el.textContent?.trim().slice(0, 80) || '';

    const title = el.getAttribute('title');
    if (title) return title;

    if (['BUTTON', 'SUMMARY', 'LEGEND', 'LABEL', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'TH', 'OPTION'].includes(el.tagName)) {
      return el.textContent?.trim().slice(0, 120) || '';
    }

    return '';
  }

  function buildAttrs(el, role) {
    const parts = [];
    if (el.tagName === 'A') {
      const href = el.getAttribute('href');
      if (href) parts.push(`href="${href}"`);
    }
    if (el.tagName === 'INPUT') {
      if (el.type) parts.push(`type="${el.type}"`);
      if (el.placeholder) parts.push(`placeholder="${el.placeholder}"`);
      if (el.value) parts.push(`value="${el.value}"`);
      if (el.checked) parts.push('checked');
      if (el.disabled) parts.push('disabled');
      if (el.readOnly) parts.push('readonly');
    }
    if (el.tagName === 'TEXTAREA' && el.placeholder) {
      parts.push(`placeholder="${el.placeholder}"`);
    }
    if (role === 'heading') {
      parts.push(`level="${el.tagName.replace('H', '')}"`);
    }
    if (el.contentEditable === 'true') parts.push('editable');
    return parts.join(' ');
  }

  let output = '';
  let charCount = 0;
  let truncated = false;

  function walk(node, depth, indent, skipNav) {
    if (truncated || depth > maxDepth) return;
    if (charCount >= maxChars) {
      truncated = true;
      return;
    }

    const style = window.getComputedStyle(node);
    const hidden = style.display === 'none'
      || style.visibility === 'hidden'
      || node.getAttribute('aria-hidden') === 'true';
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
      const attrStr = attrs ? ` ${attrs}` : '';
      const line = `${prefix}${role}${nameStr} [${ref}]${attrStr}\n`;
      if (charCount + line.length > maxChars) {
        truncated = true;
        return;
      }
      output += line;
      charCount += line.length;

      if (node.tagName === 'SELECT') {
        const options = Array.from(node.options || []);
        const selectedIdx = node.selectedIndex ?? -1;
        const toShow = [];
        if (selectedIdx >= 0 && options[selectedIdx]) toShow.push(options[selectedIdx]);
        for (const opt of options) {
          if (toShow.length >= MAX_SELECT_OPTIONS) break;
          if (!toShow.includes(opt)) toShow.push(opt);
        }
        for (const opt of toShow) {
          const optRef = getRef(opt);
          const selected = opt.selected ? ' (selected)' : '';
          const optLine = `${prefix}  option "${opt.textContent?.trim() || ''}"${selected} value="${opt.value}" [${optRef}]\n`;
          if (charCount + optLine.length > maxChars) {
            truncated = true;
            return;
          }
          output += optLine;
          charCount += optLine.length;
        }
        if (options.length > MAX_SELECT_OPTIONS) {
          const moreLine = `${prefix}  ... ${options.length - MAX_SELECT_OPTIONS} more options\n`;
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

  let root = document.body;
  if (scopeRefId && w.__claudeElementMap?.[scopeRefId]) {
    const scoped = w.__claudeElementMap[scopeRefId].deref();
    if (scoped) root = scoped;
  }

  const hasExplicitScope = Boolean(scopeRefId);
  if (filter === 'interactive' && !hasExplicitScope) {
    const mainContent = document.querySelector('main, [role="main"], #main-content, #content, #search, .main-content, [id*="results"], [id*="content"]');
    if (mainContent) {
      const mainRef = getRef(mainContent);
      const headerLine = `[main content area] [${mainRef}]\n`;
      output += headerLine;
      charCount += headerLine.length;
      walk(mainContent, 0, 1, false);
      if (!truncated) {
        output += '\n[page navigation/chrome]\n';
        charCount += '\n[page navigation/chrome]\n'.length;
        walk(root, 0, 0, true);
      }
    } else {
      walk(root, 0, 0, false);
    }
  } else {
    walk(root, 0, 0, false);
  }

  if (truncated) {
    output += `\n[TRUNCATED at ${maxChars} chars]`;
  }
  return output;
}

export function setFormValue(refOrOptions, value) {
  const options =
    refOrOptions && typeof refOrOptions === 'object'
      ? refOrOptions
      : { refId: refOrOptions, value };
  const refId = String(options.refId || '');
  value = options.value;
  const w = window;
  if (!w.__claudeElementMap || !w.__claudeElementMap[refId]) {
    return `Error: Element ${refId} not found. Run read_page first to get element references.`;
  }
  const el = w.__claudeElementMap[refId].deref();
  if (!el) {
    return `Error: Element ${refId} has been garbage collected. Run read_page again.`;
  }

  el.scrollIntoView({ behavior: 'instant', block: 'center' });
  if (typeof el.focus === 'function') {
    el.focus();
  }

  const dispatch = (target) => {
    target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  };

  if (el.tagName === 'SELECT') {
    const strVal = String(value);
    let found = false;
    for (const opt of Array.from(el.options)) {
      if (opt.value === strVal || opt.textContent?.trim() === strVal) {
        el.value = opt.value;
        found = true;
        break;
      }
    }
    if (!found) return `Error: Option "${strVal}" not found in select element.`;
    dispatch(el);
    return `Set select to "${strVal}"`;
  }

  if (el.tagName === 'INPUT') {
    if (el.type === 'checkbox') {
      const checked = typeof value === 'boolean' ? value : String(value) === 'true';
      if (el.checked !== checked) el.click();
      return `Set checkbox to ${checked}`;
    }
    if (el.type === 'radio') {
      if (!el.checked) el.click();
      return 'Selected radio button';
    }
    if (el.type === 'file') {
      return 'Error: File inputs are not supported by this worker yet.';
    }
    if (el.type === 'range' || el.type === 'number') {
      el.value = String(value);
      dispatch(el);
      return `Set ${el.type} to ${value}`;
    }
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(el, String(value));
    } else {
      el.value = String(value);
    }
    dispatch(el);
    return `Set input value to "${value}"`;
  }

  if (el.tagName === 'TEXTAREA') {
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(el, String(value));
    } else {
      el.value = String(value);
    }
    dispatch(el);
    return `Set textarea value to "${value}"`;
  }

  if (el.contentEditable === 'true') {
    el.textContent = String(value);
    dispatch(el);
    return 'Set contentEditable value';
  }

  return `Error: Element ${refId} (${el.tagName}) is not an editable form element.`;
}

export function extractPageText(maxChars = 50000) {
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

  let bestElement = null;
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
      // ignore invalid selectors
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
    return `${text.slice(0, maxChars)}\n\n[TEXT TRUNCATED at ${maxChars} characters]`;
  }
  return text;
}
