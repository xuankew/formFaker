export type RuleGroup = 'contact' | 'company' | 'geo' | 'number' | 'date' | 'text' | 'option';

export const GROUP_LABELS: Record<RuleGroup, string> = {
  contact: '联系人与身份',
  company: '企业与证照',
  geo: '地址与地理',
  number: '数字',
  date: '日期',
  text: '文本',
  option: '选项',
};

export const GROUP_ORDER: RuleGroup[] = ['contact', 'company', 'geo', 'number', 'date', 'text', 'option'];

// 校验位、行政区划推导、按标签分档这类逻辑无法用模板表达，保留为内置算法。
// 用户仍能改它们的匹配关键词、分组、启用状态，也能整条换成模板 / 词库 / 区间生成。
export type BuiltinFn =
  | 'cnName'
  | 'company'
  | 'region'
  | 'address'
  | 'lnglat'
  | 'idNumber'
  | 'creditCode'
  | 'bankCard'
  | 'paragraph'
  | 'amount'
  | 'integer';

export const BUILTIN_FN_LABELS: Record<BuiltinFn, string> = {
  cnName: '姓氏词库 + 名字用字词库',
  company: '城市 + 字号 / 行业 / 形式词库',
  region: '行政区划随机路径',
  address: '行政区划 + 街道词库 + 号幢室',
  lnglat: '由地址推导省级中心坐标',
  idNumber: '地区码 + 出生日期 + GB 11643 校验位',
  creditCode: '登记码 + 地区码 + GB 32100 校验位',
  bankCard: '发卡行前缀 + Luhn 校验位',
  paragraph: '句子词库随机抽 2~4 句',
  amount: '按标签分档（资本 / 营收类走万元档）',
  integer: '按标签分档（年限类 1~30）',
};

export type DateDirection = 'future' | 'past' | 'any';

export type GenSpec =
  | { type: 'template'; template: string; charset?: string }
  | { type: 'pool'; pool: string }
  | { type: 'range'; min: number; max: number; decimals: number }
  | {
      type: 'date';
      dateFormat: string;
      timeFormat: string;
      direction: DateDirection;
      spanMinDays: number;
      spanMaxDays: number;
    }
  | { type: 'builtin'; fn: BuiltinFn }
  | { type: 'option' };

export const GEN_TYPE_LABELS: Record<GenSpec['type'], string> = {
  template: '文本模板',
  pool: '候选池',
  range: '数值区间',
  date: '日期',
  builtin: '内置算法',
  option: '页面选项随机',
};

export interface FieldRule {
  id: string;
  name: string;
  // 子串按不区分大小写匹配；写成 /…/ 时按正则解析（保留 \blng\b、[（(]元[）)] 这类能力）。
  keywords: string[];
  group: RuleGroup;
  gen: GenSpec;
  builtin: boolean;
  // 名称类标记：把 marks.prefix / marks.suffix 贴在值的两端，便于事后检索自己造的数据。
  mark?: boolean;
  disabled?: boolean;
}

export interface PoolSpec {
  id: string;
  name: string;
  values: string[];
  builtin: boolean;
}

export const RULES_VERSION = 1;
export const RULES_KEY = 'ff.rules';

// 只存用户改动过的部分：新建规则、对内置规则的覆盖（同 id 替换）、被覆盖的词库。
export interface StoredRules {
  version: number;
  rules: FieldRule[];
  pools: Record<string, string[]>;
  marks: { prefix: string; suffix: string };
}

// 匹配阶段用到的派生数据。Catalog 只在内容脚本 / 面板内部构建，不进消息载荷。
export interface Catalog {
  rules: FieldRule[];
  matchOrder: FieldRule[];
  byId: Map<string, FieldRule>;
  matchers: Map<string, RegExp>;
  pools: Record<string, string[]>;
  marks: { prefix: string; suffix: string };
}

export const ENUM_RULE_ID = 'enum';
export const GENERIC_RULE_ID = 'generic';
export const PARAGRAPH_RULE_ID = 'paragraph';

export function newRuleId(): string {
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function summarizeGen(gen: GenSpec, pools: Record<string, string[]>): string {
  switch (gen.type) {
    case 'template':
      return gen.template || '(空模板)';
    case 'pool':
      return `从「${pools[gen.pool]?.length ?? 0} 项」候选池随机：${(pools[gen.pool] ?? []).slice(0, 4).join(' / ')}`;
    case 'range':
      return `${gen.min} ~ ${gen.max}${gen.decimals ? `，保留 ${gen.decimals} 位小数` : ''}`;
    case 'date':
      return `${gen.dateFormat}${gen.direction === 'future' ? '，今天及以后' : gen.direction === 'past' ? '，今天以前' : '，不限方向'}`;
    case 'builtin':
      return BUILTIN_FN_LABELS[gen.fn];
    case 'option':
      return '从页面候选项随机';
  }
}
