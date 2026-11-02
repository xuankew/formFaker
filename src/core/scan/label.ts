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

// Element Plus / Ant Design 在控件没有显式 id 时会自动生成 el-id-51-33、rc_select_7
// 这类 id。拿它当标签，弹窗里就只剩「el id 51 33」这种噪声，不如留空由界面处理。
const GENERATED_ID_RE = /^(el-id-|el_|rc_select_|rc_|ant-|antd-|react-select-|mui-|radix-|headlessui-)/i;

export function isGeneratedId(value: string | null | undefined): boolean {
  return !!value && GENERATED_ID_RE.test(value);
}

// 占位提示只说明「怎么操作」，不如旁边那行真标签有信息量，所以排在它后面。
const GENERIC_HINT_RE = /^(请选择|请设置|请填写|请输入|搜索|查询|筛选|select|input|enter|search)/i;

const CONTROL_SEL = 'input, select, textarea, button, [contenteditable="true"]';

function labelledBy(el: Element): string {
  const ids = (el.getAttribute('aria-labelledby') ?? '').split(/\s+/).filter(Boolean);
  for (const id of ids) {
    const text = cleanLabel(el.ownerDocument.getElementById(id)?.textContent);
    if (text) return text;
  }
  return '';
}

// 自定义卡片布局里标签往往不是 <label>，只是控件前面那个兄弟节点
// （<div class="fld"><span>状态</span><div class="el-switch"/></div>），
// 没有 label / form-item 可依时只能就近往上找。
function nearbyText(el: Element): string {
  let cur: Element | null = el;
  for (let depth = 0; depth < 3 && cur; depth++, cur = cur.parentElement) {
    for (let sib = cur.previousElementSibling; sib; sib = sib.previousElementSibling) {
      if (sib.querySelector(CONTROL_SEL)) continue; // 那是另一个字段，不是它的标签
      const text = cleanLabel(sib.textContent);
      if (!text) continue;
      if (/^[\d\s.,:：\-—/]+$/.test(text)) continue; // 序号、分隔符之类的装饰
      return text.length <= 24 ? text : '';
    }
  }
  return '';
}

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
  const labelled = labelledBy(el);
  if (labelled) return labelled;
  const header = columnHeaderFor(el);
  if (header) return header;
  const aria = el.getAttribute('aria-label') || el.getAttribute('title');
  if (aria) return cleanLabel(aria);
  const placeholder = cleanLabel(el.getAttribute('placeholder'));
  if (placeholder && !GENERIC_HINT_RE.test(placeholder)) return placeholder;
  const near = nearbyText(el);
  if (near) return near;
  if (placeholder) return placeholder;
  const name = el.getAttribute('name');
  if (name && !isGeneratedId(name)) return beautifyAttr(name);
  if (el.id && !isGeneratedId(el.id)) return beautifyAttr(el.id);
  return '';
}
