import {
  COMPANY_FORMS,
  COMPANY_INDUSTRIES,
  COMPANY_WORDS,
  EDUCATIONS,
  EMAIL_DOMAINS,
  EMAIL_NAMES,
  GENDERS,
  GIVEN_CHARS,
  HANZI,
  LANDLINE_AREACODES,
  PARAGRAPH_SENTENCES,
  PASSPORT_PREFIXES,
  PHONE_PREFIXES,
  STREET_NAMES,
  SURNAMES,
} from './pool-data';
import type { Catalog, FieldRule, PoolSpec, StoredRules } from './types';
import { ENUM_RULE_ID, GENERIC_RULE_ID } from './types';

export const LNGLAT_KEYWORDS = '经纬度|坐标|longitude|latitude|lnglat|gps|\\blng\\b|\\blat\\b';

// 坐标字段是派生输出（通常由地图填好并置灰），scan 靠这组关键词把它们从「禁用即跳过」里捞回来。
export const LNGLAT_RE = new RegExp(LNGLAT_KEYWORDS, 'i');

const chars = (s: string): string[] => Array.from(s);

export const BUILTIN_POOLS: PoolSpec[] = [
  { id: 'surname', name: '姓氏', values: chars(SURNAMES), builtin: true },
  { id: 'givenChar', name: '名字用字', values: chars(GIVEN_CHARS), builtin: true },
  { id: 'hanzi', name: '常用汉字', values: chars(HANZI), builtin: true },
  { id: 'phonePrefix', name: '手机号段', values: PHONE_PREFIXES, builtin: true },
  { id: 'areaCode', name: '座机区号', values: LANDLINE_AREACODES, builtin: true },
  { id: 'emailName', name: '邮箱账号', values: EMAIL_NAMES, builtin: true },
  { id: 'emailDomain', name: '邮箱域名', values: EMAIL_DOMAINS, builtin: true },
  { id: 'companyWord', name: '企业字号', values: COMPANY_WORDS, builtin: true },
  { id: 'companyIndustry', name: '企业行业', values: COMPANY_INDUSTRIES, builtin: true },
  { id: 'companyForm', name: '企业形式', values: COMPANY_FORMS, builtin: true },
  { id: 'streetName', name: '街道名', values: STREET_NAMES, builtin: true },
  { id: 'sentence', name: '段落句子', values: PARAGRAPH_SENTENCES, builtin: true },
  { id: 'gender', name: '性别', values: GENDERS, builtin: true },
  { id: 'education', name: '学历', values: EDUCATIONS, builtin: true },
  { id: 'passportPrefix', name: '护照前缀', values: PASSPORT_PREFIXES, builtin: true },
];

const DATE_GEN = {
  type: 'date',
  dateFormat: 'YYYY-MM-DD',
  timeFormat: 'YYYY-MM-DD HH:mm:ss',
  direction: 'future',
  spanMinDays: 30,
  spanMaxDays: 1000,
} as const;

// 顺序即优先级：首个命中者胜，所以更具体的规则必须排在更宽泛的前面
// （「联系电话（手机）」要靠 phone 排在 landline 前面才判成手机号）。
export const BUILTIN_RULES: FieldRule[] = [
  {
    id: 'phone', name: '手机号', group: 'contact', builtin: true,
    keywords: ['手机', '移动电话', 'mobile', 'cellphone'],
    gen: { type: 'template', template: '{pool:phonePrefix}{d:8}' },
  },
  {
    id: 'landline', name: '固定电话', group: 'contact', builtin: true,
    keywords: ['座机', '固定电话', '传真', '电话', 'tel', 'fax', 'phone'],
    gen: { type: 'template', template: '{pool:areaCode}-{d:7-8}' },
  },
  {
    id: 'email', name: '电子邮箱', group: 'contact', builtin: true,
    keywords: ['邮箱', 'email', 'e-mail'],
    gen: { type: 'template', template: '{pool:emailName}{d:3}@{pool:emailDomain}' },
  },
  {
    id: 'creditCode', name: '统一社会信用代码', group: 'company', builtin: true,
    keywords: ['信用代码', '工商注册号', '税号', '纳税人', 'uscc', 'credit'],
    gen: { type: 'builtin', fn: 'creditCode' },
  },
  {
    id: 'idNumber', name: '居民身份证号', group: 'company', builtin: true,
    keywords: ['身份证', 'identity', 'idcard', '/id\\s*no/'],
    gen: { type: 'builtin', fn: 'idNumber' },
  },
  {
    id: 'bankCard', name: '银行卡号', group: 'company', builtin: true,
    keywords: ['银行卡', '银行账号', '开户', '/bank\\s*card/', '/account\\s*no/', '账号'],
    gen: { type: 'builtin', fn: 'bankCard' },
  },
  {
    // 关键词留空：护照号只由「证照类型」联动选中，避免「护照有效期」这类字段被判成号码。
    id: 'passport', name: '护照号', group: 'company', builtin: true, keywords: [],
    gen: { type: 'template', template: '{pool:passportPrefix}{d:8}' },
  },
  {
    id: 'zipcode', name: '邮政编码', group: 'geo', builtin: true,
    keywords: ['邮编', '邮政编码', 'postal', 'zip'],
    gen: { type: 'template', template: '{num:1-6}{d:5}' },
  },
  {
    id: 'url', name: '网址', group: 'text', builtin: true,
    keywords: ['网址', '官网', '网站', 'website', 'url', 'link'],
    gen: { type: 'template', template: 'https://www.{pool:emailName}{d:2}.com' },
  },
  {
    id: 'company', name: '企业名称', group: 'company', builtin: true, mark: true,
    keywords: ['公司', '企业名', '单位名称', '供应商名称', '合作客户', '客户名称', '客户单位', 'company', 'vendor', 'supplier'],
    gen: { type: 'builtin', fn: 'company' },
  },
  {
    id: 'cnName', name: '中文姓名', group: 'contact', builtin: true,
    keywords: ['姓名', '联系人', '法定代表人', '负责人', '收货人', 'name'],
    gen: { type: 'builtin', fn: 'cnName' },
  },
  {
    id: 'lnglat', name: '经纬度', group: 'geo', builtin: true,
    keywords: ['/' + LNGLAT_KEYWORDS + '/'],
    gen: { type: 'builtin', fn: 'lnglat' },
  },
  {
    id: 'region', name: '省市地区', group: 'geo', builtin: true,
    keywords: ['地区', '区域', '省市', '所在地', 'region', 'area', 'province', 'city'],
    gen: { type: 'builtin', fn: 'region' },
  },
  {
    id: 'address', name: '详细地址', group: 'geo', builtin: true,
    keywords: ['地址', 'address'],
    gen: { type: 'builtin', fn: 'address' },
  },
  {
    id: 'gender', name: '性别', group: 'contact', builtin: true,
    keywords: ['性别', 'gender'],
    gen: { type: 'pool', pool: 'gender' },
  },
  {
    id: 'education', name: '学历', group: 'contact', builtin: true,
    keywords: ['学历', '学位', 'education'],
    gen: { type: 'pool', pool: 'education' },
  },
  {
    id: 'amount', name: '金额', group: 'number', builtin: true,
    keywords: [
      '金额', '资本', '资金', '价格', '费用', '单价', '总价', '营业额', '营收', '销售额',
      '收入', '利润', '产值', 'amount', 'price', 'capital', 'fee', 'fund', '/[（(]元[）)]/',
    ],
    gen: { type: 'builtin', fn: 'amount' },
  },
  {
    id: 'integer', name: '整数', group: 'number', builtin: true,
    keywords: [
      '数量', '人数', '个数', '件数', '人员', '年限', '年数', '工龄', '司龄', '区号',
      'count', 'qty', 'quantity', 'areacode', '/[（(](条|年|个|台|人|名|次|套|家|项|支)[）)]/',
    ],
    gen: { type: 'builtin', fn: 'integer' },
  },
  {
    id: 'paragraph', name: '段落备注', group: 'text', builtin: true,
    keywords: ['备注', '说明', '简介', '描述', '范围', '理由', 'remark', 'desc', 'note', 'comment'],
    gen: { type: 'builtin', fn: 'paragraph' },
  },
  {
    id: 'date', name: '日期', group: 'date', builtin: true,
    keywords: ['日期', '时间', 'date', 'time'],
    gen: { ...DATE_GEN },
  },
  {
    // 没有关键词：选项型控件的兜底，值取自页面已有候选。
    id: ENUM_RULE_ID, name: '页面选项', group: 'option', builtin: true, keywords: [],
    gen: { type: 'option' },
  },
  {
    id: GENERIC_RULE_ID, name: '兜底文本', group: 'text', builtin: true, mark: true, keywords: [],
    gen: { type: 'template', template: 'test-{m:5}' },
  },
];

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function isRegexKeyword(kw: string): boolean {
  return kw.length > 2 && kw.startsWith('/') && kw.endsWith('/');
}

export function compileKeywords(keywords: string[]): RegExp | null {
  const parts = keywords
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => (isRegexKeyword(k) ? `(?:${k.slice(1, -1)})` : escapeRe(k)));
  return parts.length ? new RegExp(parts.join('|'), 'i') : null;
}

export function keywordWeight(rule: FieldRule): number {
  return rule.keywords.reduce((max, k) => Math.max(max, k.trim().length), 0);
}

function mergePools(overrides: Record<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const p of BUILTIN_POOLS) out[p.id] = p.values;
  for (const [id, values] of Object.entries(overrides ?? {})) {
    // 空池会让 {pool:x} 渲染成令牌原文，视为「撤销覆盖」而不是「清空词库」。
    if (Array.isArray(values) && values.length) out[id] = values;
  }
  return out;
}

export function buildCatalog(stored?: Partial<StoredRules> | null): Catalog {
  const overrides = new Map<string, FieldRule>();
  const customs: FieldRule[] = [];
  for (const r of stored?.rules ?? []) {
    if (!r?.id) continue;
    if (BUILTIN_RULES.some((b) => b.id === r.id)) overrides.set(r.id, { ...r, builtin: true });
    else customs.push({ ...r, builtin: false });
  }
  const builtins = BUILTIN_RULES.map((b) => overrides.get(b.id) ?? b);
  // 自定义规则整体优先于内置；同层内关键词越长越具体，先匹配。
  const sortedCustoms = [...customs].sort((a, b) => keywordWeight(b) - keywordWeight(a));
  const rules = [...sortedCustoms, ...builtins];

  const byId = new Map(rules.map((r) => [r.id, r]));
  const matchers = new Map<string, RegExp>();
  for (const r of rules) {
    const re = compileKeywords(r.keywords);
    if (re) matchers.set(r.id, re);
  }
  return {
    rules,
    matchOrder: rules.filter((r) => !r.disabled),
    byId,
    matchers,
    pools: mergePools(stored?.pools ?? {}),
    marks: { prefix: stored?.marks?.prefix ?? '', suffix: stored?.marks?.suffix ?? '' },
  };
}

// 出厂目录会被每个字段匹配时用到，缓存一份避免重复编译关键词与合并词库。
let DEFAULT_CATALOG: Catalog | null = null;

export function defaultCatalog(): Catalog {
  return (DEFAULT_CATALOG ??= buildCatalog(null));
}

// 内置规则的出厂副本，供「恢复默认」使用。
export function pristineRule(id: string): FieldRule | undefined {
  const found = BUILTIN_RULES.find((r) => r.id === id);
  return found ? structuredClone(found) : undefined;
}

export function builtinPoolValues(id: string): string[] {
  return BUILTIN_POOLS.find((p) => p.id === id)?.values ?? [];
}
