// 填充后回读页面自身的校验提示。只认「明确是错误」的节点：错误态类名，或
// 组件库专用的错误文案容器。不扫裸 .help-block / .invalid-feedback 这类平时
// 也常驻的说明文字——把固定提示当成校验失败比漏报更伤信任。
const FIELD_SCOPE_SEL = [
  '.el-form-item',
  '.ant-form-item',
  '.ivu-form-item',
  '.arco-form-item',
  '[class*="form-item"]',
  '.form-item',
  '.form-group',
  'fieldset',
  'td',
  '.cell',
].join(',');

const ERROR_TEXT_SEL = [
  '.el-form-item__error',
  '.ant-form-item-explain-error',
  '.ivu-form-item-error-tip',
  '.arco-form-message-error',
  '.field-error',
  '.error-tip',
  '.error-msg',
  '.invalid-feedback',
].join(',');

const ERROR_STATE_SEL = [
  '.is-error',
  '.has-error',
  '.ant-form-item-has-error',
  '.ivu-form-item-error',
  '.arco-form-item-error',
  '.is-invalid',
  '[aria-invalid="true"]',
].join(',');

const FALLBACK = '未通过（页面未给出提示文字）';
const MAX_LEN = 120;

function scopeOf(root: Element): Element {
  return root.closest(FIELD_SCOPE_SEL) ?? root.parentElement ?? root;
}

// 同一作用域里可能嵌套着另一个字段的 form-item；错误节点属于离它最近的那个，
// 因此只接受「最近作用域就是本字段作用域」的节点，避免把邻居的红字算到本字段头上。
function owns(scope: Element, node: Element): boolean {
  // 从父级开始找：错误容器自己的类名（如 el-form-item__error）也含 form-item，
  // 用 closest 会把节点本身当作用域。
  const owner = node.parentElement?.closest(FIELD_SCOPE_SEL) ?? null;
  return owner === null || owner === scope;
}

function shown(el: Element): boolean {
  if ((el as HTMLElement).hidden) return false;
  const style = getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function clean(text: string | null | undefined): string {
  return (text ?? '').replace(/\s+/g, ' ').trim();
}

export function readFieldError(root: Element): string | null {
  if (!root.isConnected) return null;
  const scope = scopeOf(root);

  for (const node of scope.querySelectorAll(ERROR_TEXT_SEL)) {
    if (!shown(node) || !owns(scope, node)) continue;
    const text = clean(node.textContent);
    if (!text) continue;
    return text.length > MAX_LEN ? `${text.slice(0, MAX_LEN)}…` : text;
  }

  const flagged = [scope, root].some((el) => el.matches(ERROR_STATE_SEL));
  return flagged ? FALLBACK : null;
}
