import type { FieldCandidate } from '../scan';
import { ensureInView, isVisibleEl, realClick, setNativeValue, sleep, visibleAll, waitUntil } from './dom';

const DIALOG_SELECTOR = '.el-dialog, .el-drawer, .ant-modal-content, .ant-drawer-content, [role="dialog"]';
// Tree pickers (组织/部门/分类) render records as nested divs with role="treeitem", not as
// table rows, so they need their own selectors to be seen at all.
const ROW_SELECTOR =
  '.el-table__body tbody tr, .ant-table-tbody tr, table tbody tr, [role="row"], [role="treeitem"], .ant-tree-treenode, .el-dialog__body li';
const CLOSE_SELECTOR = '.el-dialog__headerbtn, .el-drawer__close-btn, .ant-modal-close, .ant-drawer-close';
const FOOTER_SELECTOR = '.el-dialog__footer, .el-drawer__footer, .ant-modal-footer, .ant-drawer-footer';
const BUTTON_SELECTOR = 'button, .el-button, .ant-btn, [role="button"]';
const EXPAND_SELECTOR = 'button, .el-button, .el-link, a, [role="button"], span';
// The node's own line, without its descendants: a tree parent's textContent would
// otherwise swallow every child's text.
const NODE_LINE_SELECTOR = '.el-tree-node__content, .ant-tree-node-content-wrapper';
// Row-level commit controls are usually links (「选择」 in an 操作 column), not buttons.
const ROW_ACTION_SELECTOR = 'button, a, .el-button, .el-link, [role="button"], [class*="link"], [class*="btn"], span, label';
const CELL_SELECTOR = 'td, [role="gridcell"], [role="cell"]';
const COMMIT_RE = /(选择|选定|选中|确定|确认|保存|提交|^ok$|^confirm$)/i;
const QUERY_RE = /(查询|搜索|检索|查找|^search$|^query$)/i;
const EXPAND_RE = /^展开|^expand/i;
const NEGATIVE_RE = /(取消|关闭|返回|清除|重置|删除|移除|编辑|修改|新增|添加|cancel|close|reset|delete|remove|edit)/i;
const DISABLED_RE = /(^|\s)(is-disabled|is-hidden)(\s|$)/;

// Labels render as 「确 定」 and icon buttons add stray spacing, so an exact
// comparison against the raw textContent misses real controls.
function text(el: HTMLElement): string {
  return (el.textContent ?? '').replace(/\s+/g, '');
}

// Value written back to the field: whitespace collapsed but kept, since 「HW050001 雪王环球
// 有限公司」 loses its meaning when the parts are glued together.
function readable(el: HTMLElement): string {
  return (el.textContent ?? '').replace(/\s+/g, ' ').trim();
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

// 「展开1级」 is usually a text link rather than a button, so it needs a wider net than
// dialogButtons; the short-text rule keeps a heading like 「展开明细说明」 out.
function findExpand(dialog: HTMLElement): HTMLElement | null {
  const scope = dialog.querySelector<HTMLElement>('.el-dialog__body, .ant-modal-body') ?? dialog;
  return (
    Array.from(scope.querySelectorAll<HTMLElement>(EXPAND_SELECTOR)).find(
      (el) => usable(el) && text(el).length <= 8 && EXPAND_RE.test(text(el)) && !el.closest(ROW_SELECTOR),
    ) ?? null
  );
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
function rowCommitCandidates(rec: PickRecord, dialog: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  const push = (el: HTMLElement | null) => {
    if (el && !out.includes(el)) out.push(el);
  };
  // Only this record's own line: a tree parent wraps its children's row actions too.
  push(commitIn(rec.line));
  const table = rec.node.closest('table');
  const idx = table ? Array.from(table.querySelectorAll<HTMLElement>(ROW_SELECTOR)).indexOf(rec.node) : -1;
  if (idx >= 0) {
    for (const other of Array.from(dialog.querySelectorAll('table'))) {
      if (other !== table) push(commitIn(Array.from(other.querySelectorAll<HTMLElement>(ROW_SELECTOR))[idx]));
    }
  }
  return out;
}

// One selectable record. `line` is the part that holds this record's own text and controls:
// for a tree node that is `.el-tree-node__content`, because the node itself wraps its whole
// subtree and would report every descendant's text as its own.
export interface PickRecord {
  node: HTMLElement;
  line: HTMLElement;
  leaf: boolean;
}

function lineOf(node: HTMLElement): HTMLElement {
  const line = Array.from(node.children).find((c) => c.matches(NODE_LINE_SELECTOR));
  return (line as HTMLElement | undefined) ?? node;
}

function isLeaf(node: HTMLElement, line: HTMLElement, all: HTMLElement[]): boolean {
  const caret = line.querySelector('.el-tree-node__expand-icon');
  if (caret) return caret.classList.contains('is-leaf');
  const switcher = line.querySelector('.ant-tree-switcher');
  if (switcher) return switcher.classList.contains('ant-tree-switcher-noop');
  if (line.querySelector('.el-table__expand-icon, .ant-table-row-expand-icon')) return false;
  return !all.some((other) => other !== node && node.contains(other));
}

function pickables(dialog: HTMLElement): PickRecord[] {
  const found = Array.from(dialog.querySelectorAll<HTMLElement>(ROW_SELECTOR)).filter(
    (node) =>
      isVisibleEl(node) &&
      readable(node).length > 0 &&
      !node.closest('thead') &&
      !node.querySelector('th, [role="columnheader"]') &&
      node.getAttribute('aria-disabled') !== 'true' &&
      !DISABLED_RE.test(typeof node.className === 'string' ? node.className : ''),
  );
  const raw = found.map((node) => ({ node, line: lineOf(node) }));
  // AntD puts role="treeitem" on the content wrapper, so one record matches twice: drop the
  // inner hit when it lives inside the outer record's own line (a real child node sits in the
  // sibling children container instead, and stays).
  const kept = raw.filter((it) => !raw.some((o) => o !== it && it.node.contains(o.node) && it.line.contains(o.node)));
  const nodes = kept.map((k) => k.node);
  return kept.map((it) => ({ ...it, leaf: isLeaf(it.node, it.line, nodes) }));
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
// Tree nodes have no cells at all — their own line is the value.
function readRecord(dialog: HTMLElement, rec: PickRecord, label: string): string {
  const cells = Array.from(rec.line.querySelectorAll<HTMLElement>(CELL_SELECTOR));
  if (!cells.length) return readable(rec.line);
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
async function waitForRecords(dialog: HTMLElement, timeout: number, want?: (rec: PickRecord) => boolean): Promise<PickRecord[]> {
  try {
    return await waitUntil(() => {
      const items = pickables(dialog);
      const hit = want ? items.filter(want) : items;
      return hit.length ? hit : null;
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
function diagnose(dialog: HTMLElement, input: HTMLInputElement, rec: PickRecord | null, tried: HTMLElement[], record: string): string {
  const desc = (el: HTMLElement | null): string => {
    if (!el) return 'none';
    const cls = (typeof el.className === 'string' ? el.className : '').trim().split(/\s+/).slice(0, 3).join('.');
    return `${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}:${text(el).slice(0, 10)}`;
  };
  const scope = rec?.line ?? dialog;
  const items = pickables(dialog);
  const actions = Array.from(scope.querySelectorAll<HTMLElement>(ROW_ACTION_SELECTOR))
    .filter((el) => usable(el) && text(el).length <= 8)
    .slice(0, 6)
    .map(desc)
    .join('|');
  const info =
    `rows=${items.length} leaves=${items.filter((r) => r.leaf).length} tables=${dialog.querySelectorAll('table').length} ` +
    `closed=${!isVisibleEl(dialog)} ` +
    `dialog=${(dialog.getAttribute('class') ?? dialog.tagName).slice(0, 40)} ` +
    `clicked=${tried.map(desc).join(',').slice(0, 90) || 'none'} ` +
    `input=${input.isConnected ? 'live' : 'detached'}:"${(input.value ?? '').slice(0, 12)}" ` +
    `record=${record.slice(0, 14) || '-'} actions=${actions || 'none'}`;
  return `[${info.slice(0, 340)}]`;
}

// Lookup fields (readonly input + magnifier) take their value from a picker dialog
// instead of the keyboard: open it, pick a record at random (tree pickers: a leaf),
// commit it, verify the write-back.
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
    let recs = await waitForRecords(dialog, 1500);
    if (!recs.length) {
      const query = findButton(dialog, QUERY_RE);
      if (query) {
        realClick(query);
        recs = await waitForRecords(dialog, 3000);
      }
    }
    if (!recs.length) throw new Error(`弹窗内没有可选记录（可能需要先填查询条件） ${diagnose(dialog, input, null, [], '')}`);

    // 树形弹窗（组织/部门/分类）的父节点是分组，选中它通常提交不了，所以只在叶子里随机；
    // 叶子一个都没有时点一次「展开」再枚举（懒渲染的子节点在展开前根本不在 DOM 里）。
    let leaves = recs.filter((r) => r.leaf);
    if (!leaves.length) {
      const expand = findExpand(dialog);
      if (expand) {
        realClick(expand);
        await waitForRecords(dialog, 1500, (r) => r.leaf);
        recs = pickables(dialog);
        leaves = recs.filter((r) => r.leaf);
      }
    }
    const pool = leaves.length ? leaves : recs;
    const rec = pool[Math.floor(Math.random() * pool.length)];

    // Read the record while it is still in the DOM: committing usually destroys it.
    const record = readRecord(dialog, rec, cand.label);
    const box = rec.line.querySelector<HTMLInputElement>('input[type="radio"], input[type="checkbox"]');
    if (box) {
      realClick(rec.line.querySelector<HTMLElement>('.el-radio, .ant-radio-wrapper, .el-checkbox, .ant-checkbox-wrapper') ?? box);
      await sleep(80);
      // A click on the framework's wrapper does not always reach the native input; the
      // row itself is what a user would click next.
      if (!box.checked) {
        realClick(rec.line);
        await sleep(80);
      }
    }

    const inRow = rowCommitCandidates(rec, dialog);
    const inFooter = findButton(dialog, COMMIT_RE);
    // 既没有单选框也没有行内「选择」的树形选择器，靠高亮当前节点 + 页脚确定提交：
    // 点确定之前必须先把这一行点亮，否则提交的是空选择。
    if (!box && !inRow.length && inFooter) {
      realClick(rec.line);
      await sleep(80);
    }
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
      tried.push(rec.line);
      realClick(rec.line);
      rec.line.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
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
    if (!wroteBack() && input.isConnected) throw new Error(`选择后未回填到输入框 ${diagnose(dialog, input, rec, tried, record)}`);
  } finally {
    await dismiss(dialog);
  }
}
