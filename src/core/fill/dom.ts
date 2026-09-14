export function setNativeValue(el: HTMLElement, value: string): void {
  const target = el as HTMLInputElement | HTMLTextAreaElement;
  const proto = target instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(target, value);
  else target.value = value;
  target.dispatchEvent(new InputEvent('input', { bubbles: true, data: value, inputType: 'insertText' }));
  target.dispatchEvent(new Event('change', { bubbles: true }));
}

export function realClick(el: Element): void {
  const opts = { bubbles: true, cancelable: true };
  el.dispatchEvent(new MouseEvent('mousedown', opts));
  el.dispatchEvent(new MouseEvent('mouseup', opts));
  if (el instanceof HTMLElement) el.click();
  else el.dispatchEvent(new MouseEvent('click', opts));
}

export function pressEnter(el: Element): void {
  const init = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
  el.dispatchEvent(new KeyboardEvent('keydown', init));
  el.dispatchEvent(new KeyboardEvent('keyup', init));
}

export function blur(el: HTMLElement): void {
  el.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
  el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  if (typeof el.blur === 'function') el.blur();
}

export function isVisibleEl(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

export function visibleAll(selector: string): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(selector)).filter(isVisibleEl);
}

export function waitUntil<T>(pred: () => T | null | undefined, timeout = 2500): Promise<T> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      const value = pred();
      if (value) return resolve(value);
      if (Date.now() - start > timeout) return reject(new Error('wait timeout'));
      requestAnimationFrame(tick);
    };
    tick();
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export interface Snapshot {
  el: HTMLElement;
  value?: string;
  checked?: boolean;
  html?: string;
}

export function takeSnapshot(els: HTMLElement[]): Snapshot[] {
  return els.map((el) => {
    const snap: Snapshot = { el };
    if (el instanceof HTMLInputElement) {
      if (el.type === 'checkbox' || el.type === 'radio') snap.checked = el.checked;
      else snap.value = el.value;
    } else if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
      snap.value = el.value;
    }
    if (el.isContentEditable) snap.html = el.innerHTML;
    return snap;
  });
}

export function restoreSnapshot(snaps: Snapshot[]): void {
  for (const snap of snaps.reverse()) {
    if (snap.html !== undefined) {
      snap.el.innerHTML = snap.html;
      snap.el.dispatchEvent(new InputEvent('input', { bubbles: true }));
      continue;
    }
    if (snap.checked !== undefined && snap.el instanceof HTMLInputElement) {
      if (snap.el.checked !== snap.checked) realClick(snap.el);
      continue;
    }
    if (snap.value !== undefined) setNativeValue(snap.el, snap.value);
  }
}
