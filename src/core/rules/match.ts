import type { Kind } from '../../shared/types';
import type { Catalog, FieldRule } from './types';
import { ENUM_RULE_ID, GENERIC_RULE_ID, PARAGRAPH_RULE_ID } from './types';

// 选项型控件的值只能来自页面已有候选，所以它们的语义一律收敛到「页面选项」规则，
// 由生成器在候选里随机（命中候选池规则时优先挑池里的值）。
export const OPTION_KINDS = new Set<Kind>([
  'select',
  'select-widget',
  'multiselect',
  'cascader',
  'radio-group',
  'checkbox-group',
  'checkbox',
  'switch',
  'lookup',
]);

function enabled(catalog: Catalog, id: string): FieldRule | undefined {
  const rule = catalog.byId.get(id);
  return rule && !rule.disabled ? rule : undefined;
}

// 控件形态本身就能决定该造什么值：日期控件塞不进企业名，级联控件天然是地区。
export function fallbackRuleId(kind: Kind): string {
  switch (kind) {
    case 'cascader':
      return 'region';
    case 'textarea':
    case 'richtext':
      return PARAGRAPH_RULE_ID;
    case 'number':
      return 'amount';
    case 'date':
    case 'datetime':
    case 'daterange':
      return 'date';
    case 'email':
      return 'email';
    case 'url':
      return 'url';
    case 'tel':
      return 'landline';
    case 'select':
    case 'select-widget':
    case 'multiselect':
    case 'radio-group':
    case 'checkbox-group':
    case 'checkbox':
    case 'switch':
    case 'lookup':
      return ENUM_RULE_ID;
    default:
      return GENERIC_RULE_ID;
  }
}

// 选项控件只能落到页面上真实存在的候选项。候选池 / 页面选项这两类生成器对得上，
// 其余（模板、段落、区划、校验位号码……）产出的都是自由文本，面板里根本没有这个值。
// 级联是唯一例外：地区生成器输出的「省/市/区」正是它的节点文案。
function selectableIn(rule: FieldRule, kind: Kind): boolean {
  if (rule.gen.type === 'pool' || rule.gen.type === 'option') return true;
  return kind === 'cascader' && rule.gen.type === 'builtin' && rule.gen.fn === 'region';
}

export function matchRule(haystack: string, kind: Kind, catalog: Catalog): FieldRule {
  const text = haystack ?? '';
  if (text.trim()) {
    for (const rule of catalog.matchOrder) {
      const re = catalog.matchers.get(rule.id);
      if (!re || !re.test(text)) continue;
      if (OPTION_KINDS.has(kind) && !selectableIn(rule, kind)) {
        return enabled(catalog, ENUM_RULE_ID) ?? rule;
      }
      return rule;
    }
  }
  return (
    enabled(catalog, fallbackRuleId(kind)) ??
    enabled(catalog, GENERIC_RULE_ID) ??
    catalog.rules[catalog.rules.length - 1]
  );
}
