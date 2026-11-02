import type { StoredRules } from '../core/rules/types';

export type { StoredRules };

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

export interface FieldDTO {
  id: string;
  label: string;
  kind: Kind;
  // 命中的规则 id。字段名沿用 semantic 时代的叫法。
  semantic: string;
  // 面板上显示的是规则名（中文），命中自定义规则时另加标记，一眼能看出这条值是按谁的规则造的。
  ruleName: string;
  ruleCustom: boolean;
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
  | { type: 'scan'; overwrite: boolean; rules: StoredRules }
  | { type: 'regen'; id: string; rules: StoredRules }
  | { type: 'fill'; cmds: FillCmd[]; overwrite: boolean }
  | { type: 'clear' }
  | { type: 'undo' };

export type ContentResponse<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

// popup → background 的按需注入契约；失败原因要带回面板，否则用户只看到 Chrome 的 lastError 原文。
export type InjectRequest = { type: 'ensureInject'; tabId: number };
export type InjectResponse = { ok: boolean; error?: string };

export const RANDOM_OPTION_PLACEHOLDER = '(填充时随机选择)';

export interface Settings {
  overwrite: boolean;
}

export const DEFAULT_SETTINGS: Settings = { overwrite: false };

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
