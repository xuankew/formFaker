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

export const RANDOM_OPTION_PLACEHOLDER = '(填充时随机选择)';

// User-overridable generation rules. Empty string on pool-based fields means
// "fall back to the built-in pool". Format fields use YYYY/MM/DD/HH/mm/ss tokens.
export interface GenRules {
  dateFormat: string;
  datetimeFormat: string;
  emailDomain: string;
  phonePrefixes: string;
  companySuffixes: string;
}

export const DEFAULT_GEN_RULES: GenRules = {
  dateFormat: 'YYYY-MM-DD',
  datetimeFormat: 'YYYY-MM-DD HH:mm:ss',
  emailDomain: '',
  phonePrefixes: '',
  companySuffixes: '',
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
