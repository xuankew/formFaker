import type { Kind, Semantic } from '../../shared/types';
import { SEMANTIC_RULES } from './rules';

const OPTION_KINDS = new Set<Kind>([
  'select',
  'select-widget',
  'multiselect',
  'radio-group',
  'checkbox-group',
  'checkbox',
  'switch',
  'lookup',
]);

export { OPTION_KINDS };

// Cross-field linkage: a credential-number field's format depends on the selected
// option of a sibling credential-type field (e.g. 统一社会信用代码 vs 居民身份证 vs 护照).
export const CREDENTIAL_TYPE_RE = /证照类型|证件类型|证书类型|证照类别|证件类别/;
export const CREDENTIAL_NO_RE = /证照号码|证件号码|证书编号|证件号|证照编号|证书号/;

export function credentialSemantic(typeText: string): Semantic {
  if (/居民身份|身份证/.test(typeText)) return 'idNumber';
  if (/护照|passport/i.test(typeText)) return 'passport';
  if (/其他|其它|军官|士兵|港澳|台湾|往来/.test(typeText)) return 'generic';
  return 'creditCode';
}

export function inferSemantic(haystack: string, kind: Kind): Semantic {
  const text = haystack.toLowerCase();
  for (const rule of SEMANTIC_RULES) {
    if (rule.re.test(text)) {
      if (OPTION_KINDS.has(kind) && (rule.semantic === 'paragraph' || rule.semantic === 'generic')) return 'enum';
      return rule.semantic;
    }
  }
  return fallbackSemantic(kind);
}

export function fallbackSemantic(kind: Kind): Semantic {
  switch (kind) {
    case 'cascader':
      return 'region';
    case 'textarea':
    case 'richtext':
      return 'paragraph';
    case 'number':
      return 'amount';
    case 'date':
    case 'datetime':
    case 'daterange':
      return 'date';
    case 'select':
    case 'select-widget':
    case 'multiselect':
    case 'radio-group':
    case 'checkbox-group':
    case 'checkbox':
    case 'switch':
    case 'lookup':
      return 'enum';
    case 'email':
      return 'email';
    case 'url':
      return 'url';
    case 'tel':
      return 'landline';
    default:
      return 'generic';
  }
}
