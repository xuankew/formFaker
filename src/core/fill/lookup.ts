import type { FieldCandidate } from '../scan';
import { ensureInView, isVisibleEl, realClick, sleep, visibleAll, waitUntil } from './dom';

const DIALOG_SELECTOR = '.el-dialog, .el-drawer, .ant-modal-content, .ant-drawer-content, [role="dialog"]';
const ROW_SELECTOR = '.el-table__body tbody tr, .ant-table-tbody tr, table tbody tr, [role="row"], .el-dialog__body li';
const CLOSE_SELECTOR = '.el-dialog__headerbtn, .el-drawer__close-btn, .ant-modal-close, .ant-drawer-close';
const CONFIRM_RE = /^(确定|确认|保存|选择|提交|ok|confirm)$/i;
const QUERY_RE = /^(查询|搜索|检索|查找|search|query)$/i;

function selectableRows(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(ROW_SELECTOR)).filter(
    (row) =>
      isVisibleEl(row) &&
      (row.textContent ?? '').trim().length > 0 &&
      !row.closest('thead') &&
      !row.querySelector('th, [role="columnheader"]'),
  );
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
    let rows = selectableRows(dialog);
    if (!rows.length) {
      // Record lists are often empty until a query runs; try the dialog's own search button.
      const query = Array.from(dialog.querySelectorAll<HTMLElement>('button'))
        .filter(isVisibleEl)
        .find((b) => QUERY_RE.test((b.textContent ?? '').trim()));
      if (query) {
        realClick(query);
        try {
          await waitUntil(() => selectableRows(dialog).length || null, 3000);
        } catch {
          rows = [];
        }
        rows = selectableRows(dialog);
      }
    }
    if (!rows.length) throw new Error('弹窗内没有可选记录');

    const row = rows[0];
    realClick(row.querySelector('input[type="radio"], .el-radio, .ant-radio-wrapper, input[type="checkbox"], .el-checkbox') ?? row);
    await sleep(80);

    const confirm = Array.from(dialog.querySelectorAll<HTMLElement>('button'))
      .filter(isVisibleEl)
      .find((b) => CONFIRM_RE.test((b.textContent ?? '').trim()));
    if (confirm) {
      realClick(confirm);
    } else {
      // No footer button: pickers like this usually commit on row activation.
      realClick(row);
      row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    }

    try {
      await waitUntil(() => ((input.value ?? '').trim() ? true : null), 2000);
    } catch {
      throw new Error('选择后未回填到输入框');
    }
  } finally {
    await dismiss(dialog);
  }
}
