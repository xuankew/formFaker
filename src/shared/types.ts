export type Kind =
  | 'text'
  | 'textarea'
  | 'number'
  | 'password'
  | 'email'
  | 'url'
  | 'tel'
  | 'select'
  | 'select-widget'
  | 'multiselect'
  | 'cascader'
  | 'date'
  | 'datetime'
  | 'daterange'
  | 'checkbox'
  | 'checkbox-group'
  | 'radio-group'
  | 'switch'
  | 'upload-image'
  | 'upload-file'
  | 'richtext'
  | 'lookup';

export type Semantic =
  | 'phone'
  | 'landline'
  | 'email'
  | 'idNumber'
  | 'creditCode'
  | 'passport'
  | 'bankCard'
  | 'cnName'
  | 'company'
  | 'region'
  | 'address'
  | 'lnglat'
  | 'date'
  | 'amount'
  | 'integer'
  | 'paragraph'
  | 'url'
  | 'zipcode'
  | 'gender'
  | 'education'
  | 'enum'
  | 'generic';

export interface FieldDTO {
  id: string;
  label: string;
  kind: Kind;
  semantic: Semantic;
  value: string;
  optionTexts?: string[];
  skipped?: boolean;
  reason?: string;
}

export interface ScanResult {
  fields: FieldDTO[];
  skipped: FieldDTO[];
}

export interface FillCmd {
  id: string;
  value: string;
}

export interface FillResult {
  id: string;
  ok: boolean;
  error?: string;
}

export type ContentRequest =
  | { type: 'ping' }
  | { type: 'scan'; overwrite: boolean; rules: GenRules }
  | { type: 'regen'; id: string; rules: GenRules }
  | { type: 'fill'; cmds: FillCmd[]; overwrite: boolean }
  | { type: 'clear' }
  | { type: 'undo' };

export type ContentResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

// popup → background 的按需注入契约；失败原因要带回面板，否则用户只看到 Chrome 的 lastError 原文。
export type InjectRequest = { type: 'ensureInject'; tabId: number };
export type InjectResponse = { ok: boolean; error?: string };

export const RANDOM_OPTION_PLACEHOLDER = '(填充时随机选择)';

// User-overridable generation rules. Empty string on pool-based fields means
// "fall back to the built-in pool". Format fields use YYYY/MM/DD/HH/mm/ss tokens.
export interface GenRules {
  dateFormat: string;
  datetimeFormat: string;
  // 开启时普通日期只落在今天及以后（业务表单多为有效期/到期日，过去的日期常被判非法）。
  // 历史语义字段（成立/出生/毕业/入职/注册）不受影响，否则会生成未来的出生日期。
  dateFromToday: boolean;
  emailDomain: string;
  phonePrefixes: string;
  companySuffixes: string;
  // 造数标记：原样贴在名称类文本（词典未命中的 generic）与企业名两端，便于事后在业务
  // 系统里检索出某个人造的数据。留空即不加；分隔符由用户自己写（如 `czy-`）。
  namePrefix: string;
  nameSuffix: string;
}

export const DEFAULT_GEN_RULES: GenRules = {
  dateFormat: 'YYYY-MM-DD',
  datetimeFormat: 'YYYY-MM-DD HH:mm:ss',
  dateFromToday: true,
  emailDomain: '',
  phonePrefixes: '',
  companySuffixes: '',
  namePrefix: '',
  nameSuffix: '',
};

export interface Settings {
  overwrite: boolean;
  rules: GenRules;
}

export const DEFAULT_SETTINGS: Settings = { overwrite: false, rules: DEFAULT_GEN_RULES };

// User-supplied upload files, persisted in chrome.storage.local. `data` is raw
// base64 (no data-URL prefix); the fill path matches an entry against the input's
// `accept` and decodes it to a File, falling back to synthetic files when empty.
export interface PoolEntry {
  name: string;
  type: string;
  size: number;
  data: string;
}

export const FILE_POOL_KEY = 'ff.filepool';
export const MAX_POOL_FILES = 10;
export const MAX_FILE_BYTES = 2 * 1024 * 1024;
