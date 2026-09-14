import type { Kind } from '../../shared/types';

const DISABLED_SELECTOR = '.is-disabled, [class*="disabled"]';

export function isDisabled(el: Element): boolean {
  if (el.matches(':disabled')) return true;
  return !!el.closest(DISABLED_SELECTOR);
}

export function isVisible(el: Element): boolean {
  let node: Element | null = el;
  while (node && node.nodeType === 1) {
    const html = node as HTMLElement;
    if (html.hidden) return false;
    const style = getComputedStyle(html);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    node = node.parentElement;
  }
  return true;
}

const SKIP_INPUT_TYPES = new Set(['hidden', 'button', 'submit', 'reset', 'image']);

export function classifyNative(el: HTMLElement): Kind | null {
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea') return 'textarea';
  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') return 'richtext';
  if (tag === 'select') return (el as HTMLSelectElement).multiple ? 'multiselect' : 'select';
  if (tag !== 'input') return null;
  const type = ((el as HTMLInputElement).type || 'text').toLowerCase();
  if (SKIP_INPUT_TYPES.has(type)) return null;
  switch (type) {
    case 'file':
      return (el.getAttribute('accept') ?? '').includes('image') ? 'upload-image' : 'upload-file';
    case 'checkbox':
      return 'checkbox';
    case 'radio':
      return 'radio-group';
    case 'number':
      return 'number';
    case 'date':
    case 'month':
    case 'week':
    case 'time':
      return 'date';
    case 'datetime-local':
      return 'datetime';
    case 'email':
      return 'email';
    case 'url':
      return 'url';
    case 'password':
      return 'password';
    case 'tel':
      return 'tel';
    default:
      return 'text';
  }
}
