export function setFormValue(
  refId: string,
  value: string | boolean | number,
): string {
  const w = window as unknown as {
    __claudeElementMap?: Record<string, WeakRef<Element>>;
  };

  if (!w.__claudeElementMap || !w.__claudeElementMap[refId]) {
    return `Error: Element ${refId} not found. Run read_page first to get element references.`;
  }

  const el = w.__claudeElementMap[refId].deref();
  if (!el) {
    return `Error: Element ${refId} has been garbage collected. Run read_page again.`;
  }

  el.scrollIntoView({ behavior: 'instant', block: 'center' });

  if (typeof (el as HTMLElement).focus === 'function') {
    (el as HTMLElement).focus();
  }

  const dispatch = (target: Element) => {
    target.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
    target.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const tag = el.tagName;

  if (tag === 'SELECT') {
    const select = el as HTMLSelectElement;
    const strVal = String(value);
    let found = false;
    for (const opt of Array.from(select.options)) {
      if (opt.value === strVal || opt.textContent?.trim() === strVal) {
        select.value = opt.value;
        found = true;
        break;
      }
    }
    if (!found) return `Error: Option "${strVal}" not found in select element.`;
    dispatch(select);
    return `Set select to "${strVal}"`;
  }

  if (tag === 'INPUT') {
    const input = el as HTMLInputElement;
    const inputType = input.type;

    if (inputType === 'checkbox') {
      const checked = typeof value === 'boolean' ? value : String(value) === 'true';
      if (input.checked !== checked) input.click();
      return `Set checkbox to ${checked}`;
    }

    if (inputType === 'radio') {
      if (!input.checked) input.click();
      return `Selected radio button`;
    }

    if (inputType === 'file') {
      return 'Error: Use file_upload tool for file inputs.';
    }

    if (inputType === 'range' || inputType === 'number') {
      input.value = String(value);
      dispatch(input);
      return `Set ${inputType} to ${value}`;
    }

    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(input, String(value));
    } else {
      input.value = String(value);
    }
    dispatch(input);
    return `Set input value to "${value}"`;
  }

  if (tag === 'TEXTAREA') {
    const textarea = el as HTMLTextAreaElement;
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(textarea, String(value));
    } else {
      textarea.value = String(value);
    }
    dispatch(textarea);
    return `Set textarea value to "${value}"`;
  }

  if ((el as HTMLElement).contentEditable === 'true') {
    (el as HTMLElement).textContent = String(value);
    dispatch(el);
    return `Set contentEditable value`;
  }

  return `Error: Element ${refId} (${tag}) is not an editable form element.`;
}
