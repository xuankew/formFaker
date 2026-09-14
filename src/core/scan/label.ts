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

const CELL_SELECTOR = 'td, th, [role="gridcell"], [role="cell"]';

function expandedIndex(cell: Element): number {
  const row = cell.parentElement;
  if (!row) return -1;
  let index = 0;
  for (const sib of Array.from(row.children)) {
    if (sib === cell) return index;
    index += Number(sib.getAttribute('colspan')) || 1;
  }
  return -1;
}

function headerTextAt(headRows: Element[], index: number): string {
  for (let r = headRows.length - 1; r >= 0; r--) {
    let col = 0;
    for (const head of Array.from(headRows[r].children)) {
      const span = Number(head.getAttribute('colspan')) || 1;
      if (index >= col && index < col + span) {
        const text = cleanLabel(head.textContent);
        if (text) return text;
        break;
      }
      col += span;
    }
  }
  return '';
}

// Inside a data table the column header is the field's label; without it cells
// fall back to "请输入" or a framework-generated id, losing all semantics.
export function columnHeaderFor(el: Element): string {
  const cell = el.closest(CELL_SELECTOR);
  if (!cell) return '';
  const doc = cell.ownerDocument;
  for (const id of (cell.getAttribute('headers') ?? '').split(/\s+/)) {
    const text = cleanLabel(doc.getElementById(id)?.textContent);
    if (text) return text;
  }
  const index = expandedIndex(cell);
  if (index < 0) return '';
  const ariaCol = cell.getAttribute('aria-colindex');
  const grid = cell.closest('[role="grid"], [role="table"]');
  if (ariaCol && grid) {
    const head = Array.from(grid.querySelectorAll('[role="columnheader"]')).find(
      (h) => h.getAttribute('aria-colindex') === ariaCol,
    );
    const text = cleanLabel(head?.textContent);
    if (text) return text;
  }
  // EP/AntD keep header and body in sibling <table>s, so fall back to the
  // component root when the cell's own table carries no thead.
  const ownTable = cell.closest('table');
  const scope = ownTable?.querySelector('thead') ? ownTable : (cell.closest('.el-table, .ant-table') ?? ownTable);
  if (!scope) return '';
  return headerTextAt(Array.from(scope.querySelectorAll('thead tr')), index);
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
  const header = columnHeaderFor(el);
  if (header) return header;
  const aria = el.getAttribute('aria-label') || el.getAttribute('title');
  if (aria) return cleanLabel(aria);
  const placeholder = el.getAttribute('placeholder');
  if (placeholder) return cleanLabel(placeholder);
  const name = el.getAttribute('name') || el.id;
  if (name) return beautifyAttr(name);
  return '';
}
