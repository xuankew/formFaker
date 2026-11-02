import { normalizeEmailDomain } from '../../shared/rules';
import { pristineRule } from './catalog';
import type { StoredRules } from './types';
import { RULES_KEY, RULES_VERSION } from './types';

// 0.1.x 的设置形状：7 个文本项加一个日期开关，存在 chrome.storage.sync 的 ff.settings.rules。
// 规则中心上线后这些项分别落到词库、日期规则与名称标记里，读一次就迁走。
export interface LegacyGenRules {
  dateFormat?: string;
  datetimeFormat?: string;
  dateFromToday?: boolean;
  emailDomain?: string;
  phonePrefixes?: string;
  companySuffixes?: string;
  namePrefix?: string;
  nameSuffix?: string;
}

export function parseList(raw: string): string[] {
  return (raw ?? '').split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean);
}

// 关键词按 parseList 切会被空白拆碎，而 /[（(]元[）)]/ 这类正则写法允许带空格，
// 故只认显式分隔符。
export function parseKeywords(raw: string): string[] {
  return (raw ?? '').split(/[,，、;\n]+/).map((x) => x.trim()).filter(Boolean);
}

// 词库条目本身可能是整句（段落句子池），只能按行切。
export function parseLines(raw: string): string[] {
  return (raw ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
}

export function migrateLegacy(legacy: LegacyGenRules | null | undefined): StoredRules {
  const out: StoredRules = { version: RULES_VERSION, rules: [], pools: {}, marks: { prefix: '', suffix: '' } };
  if (!legacy) return out;

  out.marks = { prefix: legacy.namePrefix ?? '', suffix: legacy.nameSuffix ?? '' };

  // 旧设置里邮箱域名是单值，且用户常把完整邮箱填进去，规整不成域名就丢弃回退内置池。
  const domain = normalizeEmailDomain(legacy.emailDomain ?? '');
  if (domain) out.pools.emailDomain = [domain];
  const prefixes = parseList(legacy.phonePrefixes ?? '');
  if (prefixes.length) out.pools.phonePrefix = prefixes;
  const forms = parseList(legacy.companySuffixes ?? '');
  if (forms.length) out.pools.companyForm = forms;

  const pristine = pristineRule('date');
  const pristineGen = pristine?.gen;
  if (pristine && pristineGen?.type === 'date') {
    const gen = { ...pristineGen };
    let changed = false;
    if (legacy.dateFormat && legacy.dateFormat !== gen.dateFormat) {
      gen.dateFormat = legacy.dateFormat;
      changed = true;
    }
    if (legacy.datetimeFormat && legacy.datetimeFormat !== gen.timeFormat) {
      gen.timeFormat = legacy.datetimeFormat;
      changed = true;
    }
    if (legacy.dateFromToday === false && gen.direction !== 'any') {
      gen.direction = 'any';
      changed = true;
    }
    if (changed) out.rules.push({ ...pristine, gen });
  }
  return out;
}

export function emptyStored(): StoredRules {
  return { version: RULES_VERSION, rules: [], pools: {}, marks: { prefix: '', suffix: '' } };
}

// 持久化数据可能被手改过或用旧版本写过，读出来先过一遍形状，缺字段补默认而不是让渲染崩掉。
export function sanitizeStored(raw: unknown): StoredRules {
  if (!raw || typeof raw !== 'object') return emptyStored();
  const s = raw as Partial<StoredRules>;
  return {
    version: typeof s.version === 'number' ? s.version : RULES_VERSION,
    rules: Array.isArray(s.rules)
      ? s.rules.filter((r): r is StoredRules['rules'][number] => !!r && typeof r.id === 'string' && !!r.gen && Array.isArray(r.keywords))
      : [],
    pools: s.pools && typeof s.pools === 'object' ? (s.pools as Record<string, string[]>) : {},
    marks: { prefix: s.marks?.prefix ?? '', suffix: s.marks?.suffix ?? '' },
  };
}

async function readLegacy(): Promise<LegacyGenRules | null> {
  const stored = await chrome.storage.sync.get('ff.settings');
  const settings = stored['ff.settings'] as { rules?: LegacyGenRules } | undefined;
  return settings?.rules ?? null;
}

export async function loadRules(): Promise<StoredRules> {
  const local = await chrome.storage.local.get(RULES_KEY);
  if (local[RULES_KEY]) return sanitizeStored(local[RULES_KEY]);
  const legacy = await readLegacy();
  const migrated = migrateLegacy(legacy);
  if (legacy) {
    await chrome.storage.local.set({ [RULES_KEY]: migrated });
    // 旧字段留着只会让人以为它还在生效，迁完就从 sync 里摘掉。
    const stored = await chrome.storage.sync.get('ff.settings');
    const rest = { ...(stored['ff.settings'] as Record<string, unknown> | undefined) };
    delete rest.rules;
    await chrome.storage.sync.set({ 'ff.settings': rest });
  }
  return migrated;
}

export async function saveRules(rules: StoredRules): Promise<void> {
  await chrome.storage.local.set({ [RULES_KEY]: sanitizeStored(rules) });
}
