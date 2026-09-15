import type { FieldCandidate } from '../scan';
import { ensureInView, isVisibleEl, realClick, setNativeValue, sleep, visibleAll, waitUntil } from './dom';

const DIALOG_SELECTOR = '.el-dialog, .el-drawer, .ant-modal-content, .ant-drawer-content, [role="dialog"]';
const ROW_SELECTOR = '.el-table__body tbody tr, .ant-table-tbody tr, table tbody tr, [role="row"], .el-dialog__body li';
const CLOSE_SELECTOR = '.el-dialog__headerbtn, .el-drawer__close-btn, .ant-modal-close, .ant-drawer-close';
const FOOTER_SELECTOR = '.el-dialog__footer, .el-drawer__footer, .ant-modal-footer, .ant-drawer-footer';
const BUTTON_SELECTOR = 'button, .el-button, .ant-btn, [role="button"]';
// Row-level commit controls are usually links (「选择」 in an 操作 column), not buttons.
const ROW_ACTION_SELECTOR = 'button, a, .el-button, .el-link, [role="button"], [class*="link"], [class*="btn"], span, label';
const CELL_SELECTOR = 'td, [role="gridcell"], [role="cell"]';
const COMMIT_RE = /(选择|选定|选中|确定|确认|保存|提交|^ok$|^confirm$)/i;
const QUERY_RE = /(查询|搜索|检索|查找|^search$|^query$)/i;
const NEGATIVE_RE = /(取消|关闭|返回|清除|重置|删除|移除|编辑|修改|新增|添加|cancel|close|reset|delete|remove|edit)/i;

// Labels render as 「确 定」 and icon buttons add stray spacing, so an exact
// comparison against the raw textContent misses real controls.
function text(el: HTMLElement): string {
  return (el.textContent ?? '').replace(/\s+/g, '');
}

function usable(el: HTMLElement): boolean {
  return isVisibleEl(el) && !NEGATIVE_RE.test(text(el));
}

// Narrow on purpose: a dialog-wide search must not mistake a heading such as
// 「选择供应商」 for a control, and it must not reach into data rows.
function dialogButtons(dialog: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const scope of [...Array.from(dialog.querySelectorAll<HTMLElement>(FOOTER_SELECTOR)), dialog]) {
    for (const btn of Array.from(scope.querySelectorAll<HTMLElement>(BUTTON_SELECTOR))) {
      if (usable(btn) && !btn.closest(ROW_SELECTOR) && !out.includes(btn)) out.push(btn);
    }
  }
  return out;
}

function findButton(dialog: HTMLElement, re: RegExp): HTMLElement | null {
  return dialogButtons(dialog).find((btn) => re.test(text(btn))) ?? null;
}

const EXACT_COMMIT_RE = /^(选择|选定|选中|确定|确认)$/;

// Wide because the control may be an <a>, an .el-link, or a bare <span>; short text
// keeps a whole cell from matching. Custom libs go further and render the action as an
// unstyled leaf node of any tag, hence the exact-text leaf pass.
function commitIn(row: HTMLElement | null | undefined): HTMLElement | null {
  if (!row) return null;
  const viaSelector = Array.from(row.querySelectorAll<HTMLElement>(ROW_ACTION_SELECTOR)).find(
    (el) => usable(el) && text(el).length <= 8 && COMMIT_RE.test(text(el)),
  );
  return (
    viaSelector ??
    Array.from(row.querySelectorAll<HTMLElement>('*')).find(
      (el) => el.children.length === 0 && usable(el) && EXACT_COMMIT_RE.test(text(el)),
    ) ??
    null
  );
}

// Which node carries the click handler differs by library: Element Plus binds it to the
// <a> root, others to the inner span. A synthetic click on the outer node never reaches a
// listener bound to the inner one, so both are worth a try.
function leafOf(control: HTMLElement): HTMLElement | null {
  return (
    Array.from(control.querySelectorAll<HTMLElement>('*')).find(
      (el) => el.children.length === 0 && usable(el) && EXACT_COMMIT_RE.test(text(el)),
    ) ?? null
  );
}

// Element UI 2.x and AntD v3 render a fixed action column as a second, cloned table, so
// the copy of 「选择」 that carries the handler is not inside the row we hold. (Element
// Plus 2.x and AntD v4 use sticky cells instead — verified in a real browser.)
function rowCommitCandidates(row: HTMLElement, dialog: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const push = (el: HTMLElement | null) => {
    if (el && !out.includes(el)) out.push(el);
  };
  push(commitIn(row));
  const table = row.closest('table');
  const idx = table ? Array.from(table.querySelectorAll<HTMLElement>(ROW_SELECTOR)).indexOf(row) : -1;
  if (idx >= 0) {
    for (const other of Array.from(dialog.querySelectorAll('table'))) {
      if (other !== table) push(commitIn(Array.from(other.querySelectorAll<HTMLElement>(ROW_SELECTOR))[idx]));
    }
  }
  return out;
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

// Element Plus splits header and body into separate tables, so the header cells have
// to be read from the dialog rather than from the row's own table.
function headerTexts(dialog: HTMLElement): string[] {
  return Array.from(
    dialog.querySelectorAll<HTMLElement>('thead th, thead td, [role="columnheader"], .el-table__header th'),
  ).map((h) => text(h));
}

// Value of the record the row stands for: the column whose header matches the field
// label, otherwise the first data cell (selection and 操作 columns carry no value).
function readRecord(dialog: HTMLElement, row: HTMLElement, label: string): string {
  const cells = Array.from(row.querySelectorAll<HTMLElement>(CELL_SELECTOR));
  const want = label.replace(/\s+/g, '');
  const headers = headerTexts(dialog);
  const idx = want ? headers.findIndex((h) => h && (h === want || h.includes(want) || want.includes(h))) : -1;
  const named = (cells[idx]?.textContent ?? '').trim();
  if (named) return named;
  for (const cell of cells) {
    if (cell.querySelector('input[type="radio"], input[type="checkbox"]')) continue;
    const value = (cell.textContent ?? '').trim();
    if (value && !NEGATIVE_RE.test(value.replace(/\s+/g, ''))) return value;
  }
  return '';
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

// The real page's console is out of reach for us, and the only thing the user can
// screenshot is the Popup's red error text — so failures carry their own DOM inventory.
function diagnose(dialog: HTMLElement, input: HTMLInputElement, row: HTMLElement | null, tried: HTMLElement[], record: string): string {
  const desc = (el: HTMLElement | null): string => {
    if (!el) return 'none';
    const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).slice(0, 3).join('.');
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}:${text(el).slice(0, 10)}`;
  };
  const scope = row ?? dialog;
  const actions = Array.from(scope.querySelectorAll<HTMLElement>(ROW_ACTION_SELECTOR))
    .filter((el) => usable(el) && text(el).length <= 8)
    .slice(0, 6)
    .map(desc)
    .join('|');
  const info =
    `rows=${selectableRows(dialog).length} tables=${dialog.querySelectorAll('table').length} ` +
    `closed=${!isVisibleEl(dialog)} ` +
    `dialog=${(dialog.getAttribute('class') ?? dialog.tagName).slice(0, 40)} ` +
    `clicked=${tried.map(desc).join(',').slice(0, 90) || 'none'} ` +
    `input=${input.isConnected ? 'live' : 'detached'}:"${(input.value ?? '').slice(0, 12)}" ` +
    `record=${record.slice(0, 14) || '-'} actions=${actions || 'none'}`;
  return `[${info.slice(0, 340)}]`;
}

// Lookup fields (readonly input + magnifier) take their value from a picker dialog
// instead of the keyboard: open it, take the first record, commit it, verify the write-back.
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
    if (!rows.length) throw new Error(`弹窗内没有可选记录（可能需要先填查询条件） ${diagnose(dialog, input, null, [], '')}`);

    const row = rows[0];
    // Read the record while it is still in the DOM: committing usually destroys it.
    const record = readRecord(dialog, row, cand.label);
    const box = row.querySelector<HTMLInputElement>('input[type="radio"], input[type="checkbox"]');
    if (box) {
      realClick(row.querySelector<HTMLElement>('.el-radio, .ant-radio-wrapper, .el-checkbox, .ant-checkbox-wrapper') ?? box);
      await sleep(80);
      // A click on the framework's wrapper does not always reach the native input; the
      // row itself is what a user would click next.
      if (!box.checked) {
        realClick(row);
        await sleep(80);
      }
    }

    const inRow = rowCommitCandidates(row, dialog);
    const inFooter = findButton(dialog, COMMIT_RE);
    // A selection column means the footer owns the commit; without one the row's own
    // 「选择」 link does, and clicking a footer first would commit nothing.
    const ranked = box ? [...(inFooter ? [inFooter] : []), ...inRow] : [...inRow, ...(inFooter ? [inFooter] : [])];
    const ordered = ranked
      .flatMap((el) => {
        const leaf = leafOf(el);
        return leaf ? [el, leaf] : [el];
      })
      .filter((el, i, all) => all.indexOf(el) === i);

    // A picker that closed itself has committed. The framework may also have
    // re-rendered the input, leaving our reference detached and forever empty.
    const wroteBack = () => !!(input.value ?? '').trim();
    const tried: HTMLElement[] = [];
    let settled = false;
    // Several candidates because only one copy of the action carries the handler: a
    // fixed-column clone re-renders it in another table, and a library may bind it to the
    // inner node instead of the one we matched.
    for (const control of ordered.slice(0, 4)) {
      tried.push(control);
      realClick(control);
      await sleep(150);
      if (wroteBack() || !isVisibleEl(dialog)) {
        settled = true;
        break;
      }
      await sleep(450);
      if (wroteBack() || !isVisibleEl(dialog)) {
        settled = true;
        break;
      }
    }
    if (!ordered.length) {
      // No control at all: pickers like this usually commit on row activation.
      tried.push(row);
      realClick(row);
      row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    }
    if (!settled) {
      try {
        await waitUntil(() => (wroteBack() || !isVisibleEl(dialog) ? true : null), 2500);
        settled = true;
      } catch {
        // Neither a value nor a self-closed dialog: the read-back below is the last resort.
      }
    }

    if (!wroteBack() && input.isConnected && record) {
      // The dialog closed without writing the model (custom pickers do this); put the
      // record's own text in so the field is not left blank. Fires input/change.
      // A framework re-render can revert the first write, so try once more.
      for (let attempt = 0; attempt < 2; attempt++) {
        setNativeValue(input, record);
        await sleep(250);
        if (wroteBack()) break;
      }
    }
    // A dialog that closed itself is not proof the model changed: custom pickers close
    // without writing, and a framework that owns the value reverts our read-back. If the
    // field is still empty on a node that is still attached, report it rather than pass.
    if (!wroteBack() && input.isConnected) throw new Error(`选择后未回填到输入框 ${diagnose(dialog, input, row, tried, record)}`);
  } finally {
    await dismiss(dialog);
  }
}
