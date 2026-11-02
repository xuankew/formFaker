import type { Kind } from '../../shared/types';
import { WIDGET_SELECTOR, classifyWidget, findLookupTrigger } from './selectors';
import { buildLabelIndex, cleanLabel, labelTextFor } from './label';
import { classifyNative, isDisabled, isVisible, hintSaysImage } from './classify';
import { LNGLAT_RE } from '../rules/catalog';

export interface FieldCandidate {
  label: string;
  kind: Kind;
  root: Element;
  targets: HTMLElement[];
  optionTexts?: string[];
  accept?: string;
  // Element to click to open a picker dialog; only set for kind 'lookup'.
  trigger?: HTMLElement;
  skipped?: boolean;
  reason?: string;
}

// 占位项不是可选值：生成器随机选中它会让字段实际留空（联动区块也因此不揭示）。
export const PLACEHOLDER_OPTION_RE = /^(请选择|请设置|请挑选|请选择.*|select|-{1,2}|—+)$/i;

function optionTextsOfSelect(select: HTMLSelectElement): string[] {
  return Array.from(select.options)
    .filter((o) => o.value !== '' && !o.disabled && !PLACEHOLDER_OPTION_RE.test(o.text.trim()))
    .map((o) => o.text.trim())
    .filter(Boolean);
}

function itemTexts(root: Element, itemSelector: string): { items: HTMLElement[]; texts: string[] } {
  const items = Array.from(root.querySelectorAll<HTMLElement>(itemSelector));
  return { items, texts: items.map((i) => (i.textContent ?? '').trim()).filter(Boolean) };
}

export function scanDocument(doc: Document): FieldCandidate[] {
  const labelIndex = buildLabelIndex(doc);
  const out: FieldCandidate[] = [];
  const consumed = new Set<Element>();

  const push = (cand: FieldCandidate) => {
    cand.targets.forEach((t) => consumed.add(t));
    consumed.add(cand.root);
    out.push(cand);
  };

  // 认不出标签就留空，交给界面显示占位；编一个「未识别标签」当标签只会占宽度。
  const labelFor = (root: Element, inner?: Element | null) =>
    labelTextFor(root, labelIndex) || (inner ? labelTextFor(inner, labelIndex) : '') || '';

  // ---- widget roots ----
  const widgetRoots = Array.from(doc.querySelectorAll(WIDGET_SELECTOR)).filter(
    (w) => !w.parentElement?.closest(WIDGET_SELECTOR),
  );

  for (const root of widgetRoots) {
    if (consumed.has(root)) continue;
    let kind = classifyWidget(root);
    if (kind === 'upload-file' && hintSaysImage(root)) kind = 'upload-image';
    if (!kind) continue;

    const base = { root, kind };
    if (!isVisible(root)) {
      push({ ...base, label: labelFor(root), targets: [], skipped: true, reason: '不可见' });
      continue;
    }
    if (isDisabled(root)) {
      push({ ...base, label: labelFor(root), targets: [], skipped: true, reason: '禁用/只读' });
      continue;
    }

    switch (kind) {
      case 'number':
      case 'date':
      case 'datetime':
      case 'daterange': {
        const inputs = Array.from(root.querySelectorAll<HTMLInputElement>('input'));
        if (!inputs.length) {
          push({ ...base, label: labelFor(root), targets: [], skipped: true, reason: '无内层 input' });
          break;
        }
        push({ ...base, label: labelFor(root, inputs[0]), targets: inputs });
        break;
      }
      case 'upload-image':
      case 'upload-file': {
        const input = root.querySelector<HTMLInputElement>('input[type="file"]');
        if (!input) {
          push({ ...base, label: labelFor(root), targets: [], skipped: true, reason: '未找到 file input（自定义上传按钮？）' });
          break;
        }
        push({ ...base, label: labelFor(root, input), targets: [input], accept: input.getAttribute('accept') ?? '' });
        break;
      }
      case 'switch':
        push({ ...base, label: labelFor(root), targets: [root as HTMLElement] });
        break;
      case 'radio-group':
      case 'checkbox-group': {
        const { items, texts } = itemTexts(root, kind === 'radio-group' ? '.el-radio, .ant-radio-wrapper, label' : '.el-checkbox, .ant-checkbox-wrapper, label');
        if (!items.length) {
          push({ ...base, label: labelFor(root), targets: [], skipped: true, reason: '无选项' });
          break;
        }
        push({ ...base, label: labelFor(root), targets: items, optionTexts: texts });
        break;
      }
      case 'cascader':
      case 'select-widget':
      case 'multiselect':
        push({ ...base, label: labelFor(root, root.querySelector('input')), targets: [root as HTMLElement] });
        break;
      default:
        push({ ...base, label: labelFor(root), targets: [root as HTMLElement] });
    }
  }

  // ---- native candidates ----
  const natives = Array.from(
    doc.querySelectorAll<HTMLElement>('input, textarea, select, [contenteditable="true"]'),
  );

  const radioGroups = new Map<string, HTMLInputElement[]>();
  const checkboxGroups = new Map<string, HTMLInputElement[]>();

  for (const el of natives) {
    if (consumed.has(el) || el.closest(WIDGET_SELECTOR)) continue;
    let kind = classifyNative(el);
    if (!kind) continue;
    if (kind === 'upload-file' && hintSaysImage(el)) kind = 'upload-image';

    if (kind === 'radio-group' || kind === 'checkbox') {
      const input = el as HTMLInputElement;
      const container = input.closest('.el-form-item, .ant-form-item, form, fieldset') ?? doc.body;
      const key = input.name || `__group_${radioGroups.size}_${checkboxGroups.size}_${container.tagName}`;
      const bucket = kind === 'radio-group' ? radioGroups : checkboxGroups;
      const list = bucket.get(key) ?? [];
      list.push(input);
      bucket.set(key, list);
      continue;
    }

    // file input 天生 display:none（点自定义按钮才唤起系统选择器），按可见性跳过会漏掉整类上传字段。
    if (kind !== 'upload-image' && kind !== 'upload-file' && !isVisible(el)) {
      push({ label: labelFor(el), kind, root: el, targets: [], skipped: true, reason: '不可见' });
      continue;
    }
    if (isDisabled(el) || (el as HTMLInputElement).readOnly) {
      const label = labelFor(el);
      // Coordinate fields are disabled/readonly by design (the map picker fills them)
      // but still need a value, so keep them fillable instead of skipping.
      if (LNGLAT_RE.test(label)) {
        push({ label, kind, root: el, targets: [el] });
        continue;
      }
      // A readonly input with a picker affordance is not dead: its value comes from a
      // dialog (清算会员号 / 联行号 等), so keep it fillable as a lookup field.
      const trigger = kind === 'text' && (el as HTMLInputElement).readOnly && !el.matches(':disabled')
        ? findLookupTrigger(el)
        : null;
      if (trigger) {
        push({ label, kind: 'lookup', root: el, targets: [el], trigger });
        continue;
      }
      push({ label, kind, root: el, targets: [], skipped: true, reason: '禁用/只读' });
      continue;
    }

    if (kind === 'select' || kind === 'multiselect') {
      push({ label: labelFor(el), kind, root: el, targets: [el], optionTexts: optionTextsOfSelect(el as HTMLSelectElement) });
    } else if (kind === 'upload-image' || kind === 'upload-file') {
      push({ label: labelFor(el), kind, root: el, targets: [el], accept: el.getAttribute('accept') ?? '' });
    } else {
      push({ label: labelFor(el), kind, root: el, targets: [el] });
    }
  }

  const groupLabel = (inputs: HTMLInputElement[], texts: string[]): string => {
    const first = inputs[0];
    if (first.id && labelIndex.has(first.id)) return labelIndex.get(first.id)!;
    const item = first.closest('.el-form-item, .ant-form-item, [class*="form-item"], fieldset');
    const labelEl = item?.querySelector('.el-form-item__label, .ant-form-item-label');
    const fromItem = cleanLabel(labelEl?.textContent);
    if (fromItem) return fromItem;
    const aria = first.getAttribute('aria-label') || item?.getAttribute('aria-label');
    if (aria) return cleanLabel(aria);
    const container = item ?? first.parentElement?.parentElement ?? first.parentElement;
    let raw = cleanLabel(container?.textContent);
    for (const t of texts) raw = raw.replace(t, ' ');
    raw = cleanLabel(raw);
    return raw || labelTextFor(first, labelIndex);
  };

  const pushGroup = (bucket: Map<string, HTMLInputElement[]>, groupKind: 'radio-group' | 'checkbox-group' | 'checkbox') => {
    for (const inputs of bucket.values()) {
      const kind: Kind = inputs.length > 1 ? groupKind : groupKind === 'radio-group' ? 'radio-group' : 'checkbox';
      const first = inputs[0];
      if (!isVisible(first)) {
        push({ label: labelFor(first), kind, root: first, targets: [], skipped: true, reason: '不可见' });
        continue;
      }
      if (inputs.every((i) => i.disabled)) {
        push({ label: labelFor(first), kind, root: first, targets: [], skipped: true, reason: '禁用/只读' });
        continue;
      }
      const texts = inputs.map((i) => (i.closest('label')?.textContent ?? i.parentElement?.textContent ?? '').trim()).filter(Boolean);
      const label = inputs.length > 1 ? groupLabel(inputs, texts) : labelFor(first);
      push({ label, kind, root: first, targets: inputs, optionTexts: texts });
    }
  };
  pushGroup(radioGroups, 'radio-group');
  pushGroup(checkboxGroups, 'checkbox-group');

  return out;
}

// 弹窗/抽屉里的控件属于某个字段的临时选择 UI（lookup 弹窗由 fillLookup 自己负责）。
// 增量补扫若把它们当新字段吸收，会替用户点选记录，弹窗关闭后字段仍然为空。
const DIALOG_SCOPE = '.el-dialog, .el-overlay, .el-drawer, .ant-modal, .ant-drawer';

// Controls that only render after an earlier scan (e.g. revealed once a parent
// select/radio is filled) are absent from the scan-time field map. Re-scan and return
// just the new, fillable candidates so a fill pass can top them up.
export function scanRevealed(knownTargets: Iterable<Element>): FieldCandidate[] {
  const known = new Set(knownTargets);
  return scanDocument(document).filter(
    (c) =>
      !c.skipped &&
      c.targets.length > 0 &&
      !c.targets.some((t) => known.has(t)) &&
      !c.root.closest(DIALOG_SCOPE),
  );
}
