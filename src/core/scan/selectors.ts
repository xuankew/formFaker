import type { Kind } from '../../shared/types';

// Widget roots, ordered so that more specific components win in classifyWidget.
export const WIDGET_SELECTOR = [
  '.el-cascader',
  '.ant-cascader',
  '.el-date-editor',
  '.ant-picker',
  '.el-switch',
  '.ant-switch',
  '.el-radio-group',
  '.ant-radio-group',
  '.el-checkbox-group',
  '.ant-checkbox-group',
  '.el-input-number',
  '.ant-input-number',
  '.el-upload',
  '.ant-upload',
  '.el-select',
  '.ant-select',
  '[role="combobox"]',
].join(',');

export function classifyWidget(root: Element): Kind | null {
  if (root.matches('.el-cascader, .ant-cascader')) return 'cascader';
  if (root.matches('.el-date-editor--daterange, .el-date-editor--datetimerange, .ant-picker-range')) return 'daterange';
  if (root.matches('.el-date-editor, .ant-picker')) {
    return root.matches('.el-date-editor--datetime, .ant-picker-show-time') ? 'datetime' : 'date';
  }
  if (root.matches('.el-switch, .ant-switch')) return 'switch';
  if (root.matches('.el-radio-group, .ant-radio-group')) return 'radio-group';
  if (root.matches('.el-checkbox-group, .ant-checkbox-group')) return 'checkbox-group';
  if (root.matches('.el-input-number, .ant-input-number')) return 'number';
  if (root.matches('.el-upload, .ant-upload')) return isImageUpload(root) ? 'upload-image' : 'upload-file';
  if (root.matches('.el-select, .ant-select, [role="combobox"]')) {
    // EP renders no empty-state multiple marker in the trigger; fill time refines
    // via the opened dropdown's is-multiple class.
    const multi =
      root.matches('.ant-select-multiple') ||
      !!root.querySelector('.el-select__tags, .el-tag, .ant-select-selection-overflow');
    return multi ? 'multiselect' : 'select-widget';
  }
  return null;
}

function isImageUpload(root: Element): boolean {
  const accept = root.querySelector('input[type="file"]')?.getAttribute('accept') ?? '';
  if (accept.includes('image')) return true;
  return !!root.closest('.el-upload--picture-card, .el-upload--picture, .ant-upload-select-picture-card, .ant-upload-picture-card-wrapper');
}

const LOOKUP_HINT_RE = /search|lookup|zoom|magnif|picker|sousuo/i;
const LOOKUP_TEXT_RE = /^(选择|选取|查询|搜索|检索|浏览|…|\.\.\.)$/;

// Suffix/append slots EP and AntD use for a picker affordance; the icon inside them
// may be a custom font with no searchable class name.
const LOOKUP_SLOT_SELECTOR = [
  '.el-input-group__append button',
  '.el-input-group__append .el-button',
  '.el-input__suffix .el-icon',
  '.el-input__suffix-inner .el-icon',
  '.ant-input-group-addon button',
  '.ant-input-suffix .anticon',
  '.ant-input-search-button',
].join(',');

const TRIGGER_NODE_SELECTOR = 'button, .el-button, .el-icon, i, .anticon, [class*="icon"], [role="button"]';

function isLookupHint(node: HTMLElement): boolean {
  const attrs = `${node.className ?? ''} ${node.getAttribute('aria-label') ?? ''} ${node.title ?? ''}`;
  return LOOKUP_HINT_RE.test(attrs) || LOOKUP_TEXT_RE.test((node.textContent ?? '').trim());
}

function pickTrigger(scope: Element, input: HTMLElement): HTMLElement | null {
  const nodes = Array.from(scope.querySelectorAll<HTMLElement>(TRIGGER_NODE_SELECTOR));
  const hinted = nodes.find((n) => n !== input && !n.contains(input) && isLookupHint(n));
  return hinted ?? scope.querySelector<HTMLElement>(LOOKUP_SLOT_SELECTOR);
}

// A readonly input next to a picker affordance is a lookup field: its value comes from
// a dialog instead of the keyboard. Returns the element to click, or null.
export function findLookupTrigger(input: HTMLElement): HTMLElement | null {
  const scopes = [
    input.closest('.el-input, .ant-input-affix-wrapper, .ant-input-group-wrapper, .ant-input-group'),
    input.closest('td, th, .cell, .el-form-item, .ant-form-item'),
    input.parentElement,
  ];
  for (const scope of scopes) {
    if (!scope) continue;
    const trigger = pickTrigger(scope, input);
    if (trigger) return trigger;
  }
  return null;
}

// Selectors used by the fill engine.
export const FILL_SELECTORS = {
  trigger: '.el-select__wrapper, .el-input__inner, .ant-select-selector, .ant-picker, .el-cascader .el-input, [role="combobox"]',
  option: '.el-select-dropdown__item:not(.is-disabled), .ant-select-item-option, [role="option"]',
  cascaderMenu: '.el-cascader-menu, .ant-cascader-menu',
  cascaderNode: '.el-cascader-node, .ant-cascader-menu-item',
  dateInput: 'input',
  uploadInput: 'input[type="file"]',
  radioItem: '.el-radio, .ant-radio-wrapper, label',
  checkboxItem: '.el-checkbox, .ant-checkbox-wrapper, label',
  selectedText: '.el-select__selected-item, .ant-select-selection-item, .el-select__placeholder, .ant-select-selection-placeholder',
} as const;
