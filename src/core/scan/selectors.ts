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
