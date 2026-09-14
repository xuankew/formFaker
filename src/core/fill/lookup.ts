import type { FieldCandidate } from '../scan';
import { ensureInView, isVisibleEl, realClick, sleep, visibleAll, waitUntil } from './dom';

const DIALOG_SELECTOR = '.el-dialog, .el-drawer, .ant-modal-content, .ant-drawer-content, [role="dialog"]';
const ROW_SELECTOR = '.el-table__body tbody tr, .ant-table-tbody tr, table tbody tr, [role="row"], .el-dialog__body li';
const CLOSE_SELECTOR = '.el-dialog__headerbtn, .el-drawer__close-btn, .ant-modal-close, .ant-drawer-close';
const FOOTER_SELECTOR = '.el-dialog__footer, .el-drawer__footer, .ant-modal-footer, .ant-drawer-footer';
const CONFIRM_RE = /(确定|确认|保存|选定|选择|提交|^ok$|^confirm$)/i;
const QUERY_RE = /(查询|搜索|检索|查找|^search$|^query$)/i;
const NEGATIVE_RE = /(取消|关闭|返回|清除|重置|cancel|close|reset)/i;

// Footers often render 「确 定」 with a gap, and icon buttons add stray spacing, so an
// exact comparison against the raw textContent misses real confirm buttons.
function buttonText(el: HTMLElement): string {
  return (el.textContent ?? '').replace(/\s+/g, '');
}

// Footer first: a picker table may carry its own row-level buttons, and the commit
// action lives in the footer.
function dialogButtons(dialog: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const scope of [...Array.from(dialog.querySelectorAll<HTMLElement>(FOOTER_SELECTOR)), dialog]) {
    for (const btn of Array.from(scope.querySelectorAll<HTMLElement>('button, .el-button, [role="button"]'))) {
      if (isVisibleEl(btn) && !NEGATIVE_RE.test(buttonText(btn)) && !out.includes(btn)) out.push(btn);
    }
  }
  return out;
}

function findButton(dialog: HTMLElement, re: RegExp): HTMLElement | null {
  return dialogButtons(dialog).find((btn) => re.test(buttonText(btn))) ?? null;
}

function selectableRows(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(ROW_SELECTOR)).filter(
    (row) =>
      isVisibleEl(row) &&
      (row.textContent ?? '').trim().length > 0 &&
      !row.closest('thead') &&
      !row.querySelector('th, [role="columnheader"]'),
  );
}

// Records are fetched after the dialog opens, so an empty body on the first frame is
// the normal case rather than a dead picker.
async function waitForRows(dialog: HTMLElement, timeout: number): Promise<HTMLElement[]> {
  try {
    return await waitUntil(() => {
      const rows = selectableRows(dialog);
      return rows.length ? rows : null;
    }, timeout);
  } catch {
    return [];
  }
}

// Some pickers stay open after the value is written; leaving one open blocks every
// later field because the overlay swallows clicks.
async function dismiss(dialog: HTMLElement): Promise<void> {
  if (!isVisibleEl(dialog)) return;
  const close = dialog.querySelector<HTMLElement>(CLOSE_SELECTOR) ?? dialog.parentElement?.querySelector<HTMLElement>(CLOSE_SELECTOR);
  if (close) {
    realClick(close);
  } else {
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }));
  }
  await sleep(120);
}

// Lookup fields (readonly input + magnifier) take their value from a picker dialog
// instead of the keyboard: open it, take the first record, confirm, verify the write-back.
export async function fillLookup(cand: FieldCandidate): Promise<void> {
  const input = cand.targets[0] as HTMLInputElement;
  const trigger = cand.trigger ?? input;
  const before = new Set(visibleAll(DIALOG_SELECTOR));
  ensureInView(trigger);
  realClick(trigger);

  let dialog: HTMLElement;
  try {
    dialog = await waitUntil(() => visibleAll(DIALOG_SELECTOR).find((d) => !before.has(d)) ?? null, 3000);
  } catch {
    throw new Error('点击后未弹出选择窗口');
  }

  try {
    let rows = await waitForRows(dialog, 1500);
    if (!rows.length) {
      const query = findButton(dialog, QUERY_RE);
      if (query) {
        realClick(query);
        rows = await waitForRows(dialog, 3000);
      }
    }
    if (!rows.length) throw new Error('弹窗内没有可选记录（可能需要先填查询条件）');

    const row = rows[0];
    const box = row.querySelector<HTMLInputElement>('input[type="radio"], input[type="checkbox"]');
    realClick(row.querySelector<HTMLElement>('.el-radio, .ant-radio-wrapper, .el-checkbox, .ant-checkbox-wrapper') ?? box ?? row);
    await sleep(80);
    // A click on the framework's wrapper does not always reach the native input; the
    // row itself is what a user would click next.
    if (box && !box.checked) {
      realClick(row);
      await sleep(80);
    }

    const confirm = findButton(dialog, CONFIRM_RE);
    if (confirm) {
      realClick(confirm);
    } else {
      // No footer button: pickers like this usually commit on row activation.
      realClick(row);
      row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    }

    // A picker that closed itself has committed. The framework may also have
    // re-rendered the input, leaving our reference detached and forever empty.
    try {
      await waitUntil(() => ((input.value ?? '').trim() || !isVisibleEl(dialog) ? true : null), 2500);
    } catch {
      throw new Error('选择后未回填到输入框');
    }
  } finally {
    await dismiss(dialog);
  }
}
