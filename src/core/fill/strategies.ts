import { PLACEHOLDER_OPTION_RE, type FieldCandidate } from '../scan';
import { FILL_SELECTORS } from '../scan/selectors';
import { RANDOM_OPTION_PLACEHOLDER, type PoolEntry } from '../../shared/types';
import { blur, ensureInView, isVisibleEl, pressEnter, realClick, restoreSnapshot, setNativeValue, sleep, takeSnapshot, visibleAll, waitUntil, type Snapshot } from './dom';
import { fillLookup } from './lookup';
import { makeTestFile, requiredImageSize, requiredMaxBytes } from './files';
import { entryMeetsHints, loadFilePool, pickPoolFile, poolEntryToFile } from './filepool';

const rand = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)];

function itemText(el: Element): string {
  if (el instanceof HTMLInputElement) {
    return (el.closest('label')?.textContent ?? el.parentElement?.textContent ?? '').trim();
  }
  return (el.textContent ?? '').trim();
}

function isChecked(el: Element): boolean {
  if (el instanceof HTMLInputElement) return el.checked;
  return el.matches('.is-checked, .ant-switch-checked, .ant-checkbox-wrapper-checked, .ant-radio-wrapper-checked, [aria-checked="true"]');
}

function toggleIf(el: Element, desired: boolean): void {
  if (isChecked(el) !== desired) realClick(el);
}

async function fillSelectWidget(cand: FieldCandidate, value: string): Promise<void> {
  const root = cand.root;
  const trigger = root.querySelector(FILL_SELECTORS.trigger) ?? root;
  const before = new Set(visibleAll('.el-select-dropdown, .ant-select-dropdown'));
  realClick(trigger);
  const panel = await waitUntil(() => {
    const fresh = visibleAll('.el-select-dropdown, .ant-select-dropdown').find((d) => !before.has(d));
    return fresh ?? null;
  });
  const multi =
    cand.kind === 'multiselect' ||
    panel.classList.contains('is-multiple') ||
    panel.classList.contains('ant-select-dropdown-multiple');
  const options = Array.from(panel.querySelectorAll<HTMLElement>(FILL_SELECTORS.option)).filter(isVisibleEl);
  if (!options.length) throw new Error('下拉面板无可见选项');
  const liveOptions = () => Array.from(panel.querySelectorAll<HTMLElement>(FILL_SELECTORS.option)).filter(isVisibleEl);
  const wanted = value && value !== RANDOM_OPTION_PLACEHOLDER ? value : null;
  const wantedTexts = wanted ? wanted.split('、') : [];
  const matched = wantedTexts.length
    ? options.filter((o) => wantedTexts.includes((o.textContent ?? '').trim()))
    : [];
  const first = matched[0] ?? rand(options);
  realClick(first);
  if (multi) {
    await sleep(80);
    const live = liveOptions();
    const second = wantedTexts[1]
      ? live.find((o) => (o.textContent ?? '').trim() === wantedTexts[1])
      : live.find((o) => o !== first);
    if (second) realClick(second);
    const input = root.querySelector('input');
    (input ?? trigger).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    await sleep(80);
    if (liveOptions().length) realClick(trigger);
  }
}

function cascaderNodeText(node: Element): string {
  return (node.querySelector('.el-cascader-node__label')?.textContent ?? node.textContent ?? '').trim();
}

async function fillCascader(cand: FieldCandidate, value: string): Promise<void> {
  const root = cand.root;
  const trigger = root.querySelector(FILL_SELECTORS.trigger) ?? root;
  realClick(trigger);
  const parts = value && value !== RANDOM_OPTION_PLACEHOLDER ? value.split('/') : [];
  const levels = parts.length || 3;
  for (let i = 0; i < levels; i++) {
    let menus: HTMLElement[];
    try {
      menus = await waitUntil(
        () => {
          const m = visibleAll(FILL_SELECTORS.cascaderMenu);
          return m.length > i ? m : null;
        },
        1500,
      );
    } catch {
      break;
    }
    const nodes = Array.from(menus[i].querySelectorAll(FILL_SELECTORS.cascaderNode));
    if (!nodes.length) break;
    const wanted = parts[i];
    const match = wanted
      ? nodes.find((n) => {
          const t = cascaderNodeText(n);
          return t === wanted || t.startsWith(wanted);
        })
      : null;
    realClick(match ?? rand(nodes));
    await sleep(60);
  }
  const displayValue = () => (root.querySelector('input')?.value ?? '').trim();
  let guard = 0;
  while (!displayValue() && guard++ < 3) {
    const menus = visibleAll(FILL_SELECTORS.cascaderMenu);
    if (!menus.length) break;
    const nodes = Array.from(menus[menus.length - 1].querySelectorAll(FILL_SELECTORS.cascaderNode));
    if (!nodes.length) break;
    realClick(rand(nodes));
    await sleep(60);
  }
}

const REFUSE_RE = /格式|尺寸|大小|失败|不正确|不支持|超过|仅支持/;
const MESSAGE_SELECTOR = '.el-message, .el-message-box, .el-notification, .ant-message-notice, .ant-notification';

function refuseMessages(): string[] {
  return Array.from(document.querySelectorAll(MESSAGE_SELECTOR))
    .map((m) => (m.textContent ?? '').trim())
    .filter((t) => REFUSE_RE.test(t));
}

// 页面在 before-upload 或服务端回调里拒收时，我们这边不会有任何异常：唯一可见的痕迹是
// 列表项变成失败态、或框架弹出「图片格式不正确」。把这些痕迹收进报错文案，用户截图面板
// 红字即可回传证据（与 lookup 的 diagnose 同一思路）。
async function rejectIfPageRefused(root: Element, beforeMsgs: Set<string>): Promise<void> {
  // EP 的 .el-upload-list 是 .el-upload 的兄弟节点而非后代，故从共同宿主（表单项/单元格，
  // 或上传根的父级）收集列表；同一表单项内并排多个上传时一并观察。
  const host = root.closest('.el-form-item, .ant-form-item, td, .cell, .el-upload, .ant-upload') ?? root;
  const LIST_SEL = '.el-upload-list, .ant-upload-list';
  const collectLists = () => {
    const own = Array.from(host.querySelectorAll(LIST_SEL));
    return own.length
      ? own
      : Array.from((host.parentElement ?? host).children).filter((c) => c.matches(LIST_SEL));
  };
  // EP 的列表 ul 在首个文件加入后才挂载，故滚动收集；始终没列表（原生 input / 被拒后移除）
  // 且没有提示时，用短窗退出，不为无从观察的控件白等。
  let lists: Element[] = collectLists();
  const deadline = Date.now() + 2500;
  const softDeadline = Date.now() + 1200;
  while (Date.now() < deadline) {
    await sleep(200);
    if (!lists.length) lists = collectLists();
    const msgs = refuseMessages().filter((t) => !beforeMsgs.has(t));
    const items = lists.flatMap((l) => Array.from(l.querySelectorAll('.el-upload-list__item, .ant-upload-list-item')));
    const failed = items.filter((i) => /is-fail|is-error|-error/.test(i.className));
    if (failed.length || msgs.length) {
      const img = lists.map((l) => l.querySelector('img')).find(Boolean);
      const src = img?.getAttribute('src') ?? '';
      const inventory = [
        `items=${items.length}/fail=${failed.length}`,
        img ? `img=${src.slice(0, 4) || 'none'}:${img.complete ? `${img.naturalWidth}x${img.naturalHeight}` : 'loading'}` : 'img=none',
        msgs.length ? `msg=${msgs[0]}` : '',
      ]
        .filter(Boolean)
        .join(' ')
        .slice(0, 240);
      throw new Error(`上传被页面拒绝 ${inventory}`);
    }
    // 上传成功、或页面把上传推迟到提交时（ready/done 态），此刻没有可验的失败痕迹。
    // items 为空不能走这条：被拒收时列表项会被移除，空数组的 every 恒真会吞掉证据。
    if (items.length && (items.some((i) => /is-success/.test(i.className)) || items.every((i) => /is-ready|-done/.test(i.className)))) return;
    if (!lists.length && Date.now() > softDeadline) return;
  }
}

async function fillUpload(cand: FieldCandidate): Promise<void> {
  const input = cand.targets[0] as HTMLInputElement;
  const kind = cand.kind as 'upload-image' | 'upload-file';
  const accept = cand.accept ?? '';
  const need = kind === 'upload-image' ? requiredImageSize(cand.root) : null;
  const maxBytes = requiredMaxBytes(cand.root);
  // 文件池优先，但只挑满足字段声明门槛（体积/尺寸）的条目；都不满足就回退合成文件，
  // 避免把注定被 before-upload 拒收的池文件注入页面。
  const pool = await loadFilePool();
  const eligible: PoolEntry[] = [];
  for (const e of pool) if (await entryMeetsHints(e, need, maxBytes)) eligible.push(e);
  const entry = pickPoolFile(eligible, kind, accept);
  const file = entry ? poolEntryToFile(entry) : await makeTestFile(kind, accept, need);
  const beforeMsgs = new Set(refuseMessages());
  const dt = new DataTransfer();
  dt.items.add(file);
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await rejectIfPageRefused(cand.root, beforeMsgs);
}

export async function fillCandidate(cand: FieldCandidate, value: string): Promise<void> {
  const [primary] = cand.targets;
  ensureInView(cand.root);
  switch (cand.kind) {
    case 'lookup':
      await fillLookup(cand);
      return;
    case 'text':
    case 'textarea':
    case 'number':
    case 'password':
    case 'email':
    case 'url':
    case 'tel':
      setNativeValue(primary, value);
      return;
    case 'select': {
      const select = primary as HTMLSelectElement;
      // 回退不能落到 options[0]：那通常是「请选择」占位项，等于没填。
      const real = Array.from(select.options).filter((o) => o.value !== '' && !PLACEHOLDER_OPTION_RE.test(o.text.trim()));
      const option = real.find((o) => o.text.trim() === value || o.value === value) ?? real[0];
      if (option) {
        select.value = option.value;
        select.dispatchEvent(new Event('input', { bubbles: true }));
        select.dispatchEvent(new Event('change', { bubbles: true }));
      }
      return;
    }
    case 'multiselect': {
      if (!(primary instanceof HTMLSelectElement)) {
        await fillSelectWidget(cand, value);
        return;
      }
      const select = primary;
      const wanted = value !== RANDOM_OPTION_PLACEHOLDER ? value.split('、') : [];
      const pool = Array.from(select.options).filter((o) => o.value !== '' && !PLACEHOLDER_OPTION_RE.test(o.text.trim()));
      const chosen = wanted.length
        ? pool.filter((o) => wanted.includes(o.text.trim()))
        : [...pool].sort(() => Math.random() - 0.5).slice(0, 2);
      for (const o of Array.from(select.options)) o.selected = chosen.includes(o);
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    case 'select-widget':
      await fillSelectWidget(cand, value);
      return;
    case 'cascader':
      await fillCascader(cand, value);
      return;
    case 'date':
    case 'datetime':
      setNativeValue(primary, value);
      pressEnter(primary);
      blur(primary);
      return;
    case 'daterange': {
      const [start, end] = value.split('~').map((s) => s.trim());
      const [a, b] = cand.targets;
      setNativeValue(a, start);
      pressEnter(a);
      if (b) {
        setNativeValue(b, end);
        pressEnter(b);
        blur(b);
      }
      return;
    }
    case 'radio-group': {
      const match = cand.targets.find((t) => itemText(t) === value);
      realClick(match ?? rand(cand.targets));
      return;
    }
    case 'checkbox':
      toggleIf(primary, value === 'true');
      return;
    case 'switch':
      toggleIf(primary, value === 'true');
      return;
    case 'checkbox-group': {
      const wanted = value !== RANDOM_OPTION_PLACEHOLDER ? value.split('、') : [];
      const pool = cand.targets;
      const chosen = wanted.length
        ? pool.filter((t) => wanted.includes(itemText(t)))
        : [...pool].sort(() => Math.random() - 0.5).slice(0, Math.min(pool.length, 2));
      for (const t of pool) toggleIf(t, chosen.includes(t));
      return;
    }
    case 'upload-image':
    case 'upload-file':
      await fillUpload(cand);
      return;
    case 'richtext':
      primary.innerHTML = `<p>${value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`;
      primary.dispatchEvent(new InputEvent('input', { bubbles: true }));
      return;
    default:
      return;
  }
}

export function hasExistingValue(cand: FieldCandidate): boolean {
  if (!cand.targets.length) return false;
  const [primary] = cand.targets;
  switch (cand.kind) {
    case 'select':
      return (primary as HTMLSelectElement).value !== '';
    case 'select-widget':
    case 'multiselect':
    case 'cascader': {
      if (cand.kind === 'multiselect' && primary instanceof HTMLSelectElement) {
        return primary.value !== '';
      }
      const item = cand.root.querySelector('.ant-select-selection-item');
      if (item?.textContent?.trim()) return true;
      if (cand.root.querySelector('.el-tag')) return true;
      const ep = cand.root.querySelector('.el-select__placeholder');
      if (ep && !ep.classList.contains('is-transparent') && ep.textContent?.trim()) return true;
      const input = cand.root.querySelector('input');
      return !!input?.value?.trim();
    }
    case 'checkbox':
    case 'radio-group':
    case 'checkbox-group':
    case 'switch':
      return cand.targets.some(isChecked);
    case 'upload-image':
    case 'upload-file':
      return !!((primary as HTMLInputElement).files?.length);
    case 'richtext':
      return primary.textContent?.trim().length ? true : false;
    default:
      return (primary as HTMLInputElement).value?.trim().length > 0;
  }
}

const CLEAR_ICON_SELECTOR =
  '.el-select__clear, .el-input__clear, .el-range__close-icon, .icon-circle-close, ' +
  '.ant-select-clear, .ant-picker-clear, .ant-cascader-clear, .ant-input-clear-icon';

const WIDGET_HOVER_SELECTOR =
  '.el-select__wrapper, .el-select, .el-cascader, .el-input__wrapper, ' +
  '.ant-select-selector, .ant-select';

// Framework widgets only render their clear (×) affordance when clearable,
// non-empty, and hovered/focused (EP: showClearBtn / clearBtnVisible). Reveal it,
// then click. Returns false when the widget exposes no clear affordance.
async function clearWidget(cand: FieldCandidate): Promise<boolean> {
  const root = cand.root;
  const input = root.querySelector('input');
  for (const t of [root, ...Array.from(root.querySelectorAll(WIDGET_HOVER_SELECTOR))]) {
    t.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
  }
  if (input instanceof HTMLElement) {
    input.dispatchEvent(new FocusEvent('focus', { bubbles: false }));
    input.focus?.();
  }
  let icon: Element | null;
  try {
    icon = await waitUntil(() => root.querySelector(CLEAR_ICON_SELECTOR), 400);
  } catch {
    icon = root.querySelector(CLEAR_ICON_SELECTOR);
  }
  if (icon) {
    realClick(icon);
    await sleep(60);
    if (input instanceof HTMLElement) blur(input);
    return true;
  }
  if (input) {
    setNativeValue(input, '');
    blur(input);
  }
  return false;
}

export async function clearCandidate(cand: FieldCandidate): Promise<boolean> {
  const [primary] = cand.targets;
  if (!primary) return false;
  switch (cand.kind) {
    case 'text':
    case 'textarea':
    case 'number':
    case 'password':
    case 'email':
    case 'url':
    case 'tel':
      setNativeValue(primary, '');
      return true;
    case 'date':
    case 'datetime':
      setNativeValue(primary, '');
      pressEnter(primary);
      blur(primary);
      return true;
    case 'daterange': {
      const [a, b] = cand.targets;
      if (a) {
        setNativeValue(a, '');
        pressEnter(a);
      }
      if (b) {
        setNativeValue(b, '');
        pressEnter(b);
        blur(b);
      }
      return true;
    }
    case 'select': {
      const select = primary as HTMLSelectElement;
      select.value = '';
      if (select.value !== '') select.selectedIndex = -1;
      select.dispatchEvent(new Event('input', { bubbles: true }));
      select.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    case 'multiselect': {
      if (primary instanceof HTMLSelectElement) {
        for (const o of Array.from(primary.options)) o.selected = false;
        primary.dispatchEvent(new Event('input', { bubbles: true }));
        primary.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      }
      return clearWidget(cand);
    }
    case 'lookup': {
      // Readonly input: only the widget's own clear affordance resets the bound model.
      const wrap = cand.root.closest('.el-input, .ant-input-affix-wrapper, .ant-input-group-wrapper');
      return clearWidget({ ...cand, root: wrap ?? cand.root });
    }
    case 'select-widget':
    case 'cascader':
      return clearWidget(cand);
    case 'checkbox':
    case 'switch':
      toggleIf(primary, false);
      return true;
    case 'radio-group': {
      // Framework radio groups (EP/AntD) drive selection from their model; a
      // programmatic uncheck doesn't reset it and radios can't be clicked off.
      const widget = cand.targets.some((t) => t.closest('.el-radio-group, .el-radio, .ant-radio-group, .ant-radio-wrapper'));
      if (widget) return false;
      for (const t of cand.targets) {
        if (t instanceof HTMLInputElement) {
          if (t.checked) {
            t.checked = false;
            t.dispatchEvent(new Event('change', { bubbles: true }));
          }
        } else {
          toggleIf(t, false);
        }
      }
      return true;
    }
    case 'checkbox-group':
      for (const t of cand.targets) toggleIf(t, false);
      return true;
    case 'upload-image':
    case 'upload-file': {
      const input = primary as HTMLInputElement;
      input.value = '';
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }
    case 'richtext':
      primary.innerHTML = '';
      primary.dispatchEvent(new InputEvent('input', { bubbles: true }));
      return true;
    default:
      return false;
  }
}

export { takeSnapshot, restoreSnapshot, type Snapshot };
