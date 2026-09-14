export function cleanLabel(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/[*＊]/g, '')
    .replace(/[:：]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function beautifyAttr(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim();
}

export function buildLabelIndex(doc: Document): Map<string, string> {
  const index = new Map<string, string>();
  doc.querySelectorAll('label[for]').forEach((label) => {
    const forId = label.getAttribute('for');
    if (!forId || index.has(forId)) return;
    const text = cleanLabel(label.textContent);
    if (text) index.set(forId, text);
  });
  return index;
}

export function labelTextFor(el: Element, index: Map<string, string>): string {
  if (el.id && index.has(el.id)) return index.get(el.id)!;
  const wrapped = el.closest('label');
  if (wrapped) {
    const text = cleanLabel(wrapped.textContent);
    if (text) return text;
  }
  const item =
    el.closest('.el-form-item, .ant-form-item, fieldset') ??
    el.closest('[class*="form-item"], [class*="FormItem"]');
  if (item) {
    const label = item.querySelector('.el-form-item__label, .ant-form-item-label, label');
    const text = cleanLabel(label?.textContent);
    if (text) return text;
  }
  const aria = el.getAttribute('aria-label') || el.getAttribute('title');
  if (aria) return cleanLabel(aria);
  const placeholder = el.getAttribute('placeholder');
  if (placeholder) return cleanLabel(placeholder);
  const name = el.getAttribute('name') || el.id;
  if (name) return beautifyAttr(name);
  return '';
}
