import type { Kind } from '../../shared/types';
import type { Catalog, FieldRule } from '../rules/types';
import { defaultCatalog } from '../rules/catalog';
import { fallbackRuleId, matchRule, OPTION_KINDS } from '../rules/match';

export { fallbackRuleId, OPTION_KINDS };

// Cross-field linkage: a credential-number field's format depends on the selected
// option of a sibling credential-type field (e.g. 统一社会信用代码 vs 居民身份证 vs 护照).
export const CREDENTIAL_TYPE_RE = /证照类型|证件类型|证书类型|证照类别|证件类别/;
export const CREDENTIAL_NO_RE = /证照号码|证件号码|证书编号|证件号|证照编号|证书号/;

// 返回的是规则 id；「其他证照」这类没有对应格式的就落到兜底文本规则。
export function credentialSemantic(typeText: string): string {
  if (/居民身份|身份证/.test(typeText)) return 'idNumber';
  if (/护照|passport/i.test(typeText)) return 'passport';
  if (/其他|其它|军官|士兵|港澳|台湾|往来/.test(typeText)) return 'generic';
  return 'creditCode';
}

export function inferRule(haystack: string, kind: Kind, catalog: Catalog = defaultCatalog()): FieldRule {
  return matchRule(haystack, kind, catalog);
}

export function inferSemantic(haystack: string, kind: Kind, catalog: Catalog = defaultCatalog()): string {
  return matchRule(haystack, kind, catalog).id;
}
