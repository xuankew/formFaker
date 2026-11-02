// Dev-only 交叉审计：用一份**独立手写**的期望表（标签关键词 → 应有语义 → 值形态）去对撞
// scan/infer/generate/fill 的实际产物，再加「填完是否真的落地」「上传形态是否相符」两类
// 物理检查。目的是把过去只能靠用户截图发现的缺陷变成机器可判：语义词典被优先级抢掉
// （「实际运营时间（年）」判成 date）、图片字段被当文件注入 PDF、面板成功而字段为空。
// 不进 manifest，仅由 dev harness 暴露给浏览器端自检使用。
import type { Kind } from '../shared/types';
import type { Catalog } from '../core/rules/types';
import { RANDOM_OPTION_PLACEHOLDER } from '../shared/types';
import type { FieldCandidate } from '../core/scan';
import { PLACEHOLDER_OPTION_RE } from '../core/scan';
import { inferSemantic } from '../core/semantics/infer';
import { defaultCatalog } from '../core/rules/catalog';
import { requiredImageSize } from '../core/fill/files';

export interface AuditEntry {
  cand: FieldCandidate;
  value: string;
  error?: string;
}

export interface Violation {
  label: string;
  kind: Kind;
  semantic: string;
  rule: string;
  got: string;
}

export interface AuditReport {
  checked: number;
  violations: Violation[];
}

interface Expectation {
  name: string;
  labelRe: RegExp;
  // 省略时只校验值形态，不比对命中规则（如「开户行名」没有对应的规则）。
  semantic?: string;
  valueRe: RegExp;
}

// 顺序敏感（先具体后宽泛）。刻意不复用 SEMANTIC_RULES：与实现同源就只会复刻它的错位。
const EXPECTATIONS: Expectation[] = [
  { name: '手机号', labelRe: /手机|移动电话|mobile/, semantic: 'phone', valueRe: /^1[3-9]\d{9}$/ },
  { name: '邮箱', labelRe: /邮箱|电子邮件|e-?mail/i, semantic: 'email', valueRe: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/ },
  { name: '身份证', labelRe: /身份证/, semantic: 'idNumber', valueRe: /^\d{17}[\dXx]$/ },
  { name: '统一社会信用代码', labelRe: /信用代码|税号|纳税人识别号/, semantic: 'creditCode', valueRe: /^[0-9A-HJ-NPQRTUWXY]{18}$/ },
  { name: '开户行名', labelRe: /开户银行|开户行(?!账号)|开户名称|银行名称/, valueRe: /(银行|支行|分行|信用社|联社|农商)/ },
  { name: '银行账号', labelRe: /银行账号|银行卡号|开户账号/, semantic: 'bankCard', valueRe: /^\d{13,19}$/ },
  { name: '邮编', labelRe: /邮编|邮政编码/, semantic: 'zipcode', valueRe: /^\d{6}$/ },
  { name: '网址', labelRe: /网址|官网|网站/, semantic: 'url', valueRe: /^https?:\/\/\S+$/ },
  { name: '经纬度', labelRe: /经纬度|坐标/, semantic: 'lnglat', valueRe: /^-?\d{1,3}(\.\d+)?\s*[,，]\s*-?\d{1,2}(\.\d+)?$/ },
  { name: '整数计数', labelRe: /数量|人数|个数|件数|年限|年数|区号|产线|[（(](条|年|个|台|人|名|次|套|家|项|支)[）)]/, semantic: 'integer', valueRe: /^\d+$/ },
  { name: '金额', labelRe: /金额|资本|资金|价格|费用|营业额|营收|销售额|收入|利润|产值|[（(]元[）)]/, semantic: 'amount', valueRe: /^\d+(\.\d+)?$/ },
  { name: '日期', labelRe: /日期|时间/, semantic: 'date', valueRe: /^\d{4}([-/年.])\d{1,2}\1\d{1,2}/ },
  { name: '地址', labelRe: /地址/, semantic: 'address', valueRe: /(省|市|区|县|路|街|道|号)/ },
  { name: '企业名', labelRe: /公司名称|企业名称|单位名称|供应商名称|客户名称|客户单位|合作客户/, semantic: 'company', valueRe: /(公司|厂|集团|有限|企业|中心|合作社|事务所|行|部|店)/ },
  { name: '人名', labelRe: /姓名|联系人|法定代表人|负责人|收货人/, semantic: 'cnName', valueRe: /^[\u4e00-\u9fa5·]{2,4}$/ },
];

const OPTION_KINDS = new Set<Kind>([
  'select', 'select-widget', 'multiselect', 'cascader',
  'radio-group', 'checkbox-group', 'checkbox', 'switch', 'lookup',
]);

const UPLOAD_KINDS = new Set<Kind>(['upload-image', 'upload-file']);

function isCheckedEl(el: Element): boolean {
  if (el instanceof HTMLInputElement) return el.checked;
  return el.matches('.is-checked, .ant-switch-checked, .ant-checkbox-wrapper-checked, .ant-radio-wrapper-checked, [aria-checked="true"]');
}

// 上传的落地痕迹有两处：注入瞬间的 input.files，以及框架渲染的列表项。EP 自动上传成功后
// 会清空 input.files（便于重复选同一文件），故必须回落到列表项，否则成功也判成空。
function uploadLive(cand: FieldCandidate): string {
  const files = (cand.targets[0] as HTMLInputElement).files;
  if (files?.length) return `${files[0].name}|${files[0].type || '?'}`;
  const host = cand.root.closest('.el-form-item, .ant-form-item, td, .cell') ?? cand.root.parentElement ?? cand.root;
  const items = Array.from(
    host.querySelectorAll('.el-upload-list__item, .ant-upload-list-item'),
  );
  if (!items.length) return '';
  const first = items[0];
  const name = (first.querySelector('.el-upload-list__item-name, .ant-upload-list-item-name')?.textContent ?? first.textContent ?? '').trim();
  const src = first.querySelector('img')?.getAttribute('src') ?? '';
  return `items=${items.length}|${name || src.slice(0, 24)}`;
}

// 填充后的实际状态，独立于 fill 路径重新读一遍：框架控件的选中态写在展示节点上而非 input。
export function liveValue(cand: FieldCandidate): string {
  const [primary] = cand.targets;
  if (!primary) return '';
  if (UPLOAD_KINDS.has(cand.kind)) return uploadLive(cand);
  switch (cand.kind) {
    // 布尔控件的「未选中」是合法结果，回传状态而非空串，由审计比对期望态。
    case 'checkbox':
    case 'switch':
      return isCheckedEl(primary) ? 'true' : 'false';
    case 'radio-group':
    case 'checkbox-group':
      return cand.targets.some(isCheckedEl) ? 'checked' : '';
    case 'richtext':
      return (primary.textContent ?? '').trim();
    case 'select': {
      const sel = primary as HTMLSelectElement;
      const text = (sel.selectedOptions[0]?.text ?? '').trim();
      // 选中占位项等于没填：value 为空，或文案就是「请选择」这类。
      if (!sel.value || PLACEHOLDER_OPTION_RE.test(text)) return '';
      return text || sel.value;
    }
    case 'multiselect':
      if (primary instanceof HTMLSelectElement) {
        return Array.from(primary.selectedOptions)
          .filter((o) => o.value !== '' && !PLACEHOLDER_OPTION_RE.test(o.text.trim()))
          .map((o) => o.text.trim())
          .filter(Boolean)
          .join('、');
      }
      break;
    default:
      break;
  }
  // 原生候选的 root 就是控件本身，querySelector 找不到自己，先直接读它。
  if (primary instanceof HTMLInputElement || primary instanceof HTMLTextAreaElement) {
    if (primary.value.trim()) return primary.value.trim();
  }
  const input = cand.root.querySelector('input');
  if (input?.value?.trim()) return input.value.trim();
  // EP 把选中项渲染成 .el-select__selected-item.el-select__placeholder，但同类的
  // is-hidden input 包裹层在文档序里更靠前且文本为空，逗号选择器只会拿到它。
  const shown = ['.ant-select-selection-item', '.el-select__placeholder', '.el-select__selected-item']
    .flatMap((sel) => Array.from(cand.root.querySelectorAll(sel)))
    .find((el) => !el.classList.contains('is-transparent') && !el.classList.contains('is-hidden') && el.textContent?.trim());
  const text = shown?.textContent?.trim() ?? '';
  if (text && !PLACEHOLDER_OPTION_RE.test(text)) return text;
  if (cand.root.querySelector('.el-tag, .ant-select-selection-item-content')) return 'selected';
  return '';
}

function expectationFor(label: string): Expectation | null {
  for (const e of EXPECTATIONS) if (e.labelRe.test(label)) return e;
  return null;
}

async function previewSize(cand: FieldCandidate): Promise<{ width: number; height: number } | null> {
  const host = cand.root.closest('.el-form-item, .ant-form-item, td, .cell') ?? cand.root.parentElement ?? cand.root;
  const img = host.querySelector<HTMLImageElement>(
    '.el-upload-list__item-thumbnail, .ant-upload-list-item-thumbnail, .el-upload-list--picture-card img, .el-upload-list--picture img',
  );
  if (!img) return null;
  const deadline = Date.now() + 1200;
  while (!img.complete && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  if (!img.complete || !img.naturalWidth) return null;
  return { width: img.naturalWidth, height: img.naturalHeight };
}

function nonImageEvidence(live: string): string | null {
  const payload = live.split('|')[1] ?? '';
  if (!payload) return null;
  if (payload.includes('/')) return payload.startsWith('image/') ? null : payload;
  // 列表项回落时拿到的是文件名或 blob:/data: 前缀，后者无从判格式。
  const ext = /\.([a-z0-9]+)$/i.exec(payload)?.[1]?.toLowerCase();
  if (!ext) return null;
  return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext) ? null : payload;
}

export async function auditEntries(entries: AuditEntry[], catalog: Catalog = defaultCatalog()): Promise<AuditReport> {
  const violations: Violation[] = [];
  let checked = 0;

  for (const { cand, value, error } of entries) {
    if (cand.skipped || !cand.targets.length) continue;
    checked++;
    const semantic = inferSemantic(cand.label, cand.kind, catalog);
    const push = (rule: string, got: string) => violations.push({ label: cand.label, kind: cand.kind, semantic, rule, got });

    if (error) {
      push('fill-error', error.slice(0, 200));
      continue;
    }

    const live = liveValue(cand);

    if (cand.kind === 'checkbox' || cand.kind === 'switch') {
      // 「未选中」是合法结果，只在实际态与请求态不符时才算失败（点击被框架吞掉）。
      if (live !== (value === 'true' ? 'true' : 'false')) {
        push('state-mismatch', `期望 ${value === 'true' ? '选中' : '未选中'}，实际 ${live === 'true' ? '选中' : '未选中'}`);
      }
      continue;
    }

    if (!live) {
      push('empty', '填充后字段仍为空');
      continue;
    }
    if (live.includes(RANDOM_OPTION_PLACEHOLDER) || (value.includes(RANDOM_OPTION_PLACEHOLDER) && !OPTION_KINDS.has(cand.kind))) {
      push('placeholder-leak', live.slice(0, 60));
    }

    if (cand.kind === 'upload-image') {
      const bad = nonImageEvidence(live);
      if (bad) push('image-field-non-image', bad);
      const want = requiredImageSize(cand.root);
      const got = want ? await previewSize(cand) : null;
      if (want && got && (got.width !== want.width || got.height !== want.height)) {
        push('upload-size-mismatch', `${got.width}x${got.height}，页面要求 ${want.width}x${want.height}`);
      }
    }
    if (cand.kind === 'upload-file' && /图片|照片|头像/.test(cand.label)) {
      push('image-label-as-file', `标签「${cand.label}」被判成上传文件`);
    }

    const expect = expectationFor(cand.label);
    if (!expect || OPTION_KINDS.has(cand.kind) || UPLOAD_KINDS.has(cand.kind)) continue;
    if (expect.semantic && semantic !== expect.semantic) {
      push('semantic-miss', `${semantic}，期望 ${expect.semantic}（${expect.name}）`);
      continue;
    }
    const parts = cand.kind === 'daterange' ? value.split('~').map((s) => s.trim()) : [value.trim()];
    if (!parts.every((p) => expect.valueRe.test(p))) {
      push('value-shape', `${value.slice(0, 60)} 不满足 ${expect.name} 形态`);
    }
  }

  return { checked, violations };
}
