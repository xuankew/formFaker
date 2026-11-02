import { BUILTIN_FN_LABELS, GROUP_ORDER, RULES_VERSION, type BuiltinFn, type DateDirection, type FieldRule, type GenSpec, type RuleGroup, type StoredRules } from './types';

export const EXPORT_APP = 'FormFaker';
export const EXPORT_KIND = 'rules';

export interface RulesFile {
  app: string;
  kind: string;
  version: number;
  exportedAt: string;
  rules: FieldRule[];
  pools: Record<string, string[]>;
  marks: { prefix: string; suffix: string };
}

export type ImportMode = 'merge' | 'replace';

// parseRulesFile 只拆信封，rules 还没过校验，故留 unknown[]；形状由 normalizeRule 逐条判。
export interface ParsedRulesFile {
  version: number;
  rules: unknown[];
  pools: Record<string, string[]>;
  marks: { prefix: string; suffix: string };
}

export interface ImportReport {
  stored: StoredRules;
  rulesAdded: number;
  rulesReplaced: number;
  poolsAdded: number;
  poolsReplaced: number;
  skipped: string[];
}

const GEN_TYPES = new Set(['template', 'pool', 'range', 'date', 'builtin', 'option']);
const BUILTIN_FNS = new Set(Object.keys(BUILTIN_FN_LABELS));
const DIRECTIONS = new Set<DateDirection>(['future', 'past', 'any']);
const GROUPS = new Set<string>(GROUP_ORDER);

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function num(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

// 导入的文件来自外部，形状全靠不住：坏掉的 gen 会让生成器输出空串或直接抛，
// 所以逐字段收敛到合法值，收不了的整条拒掉并把原因带回去。
function normalizeGen(raw: unknown): { gen: GenSpec } | { why: string } {
  if (!raw || typeof raw !== 'object') return { why: '缺少生成方式' };
  const g = raw as Record<string, unknown>;
  const type = str(g.type);
  if (!GEN_TYPES.has(type)) return { why: `未知生成方式「${type || '空'}」` };

  switch (type) {
    case 'template': {
      const template = str(g.template);
      if (!template.trim()) return { why: '模板为空' };
      return typeof g.charset === 'string'
        ? { gen: { type: 'template', template, charset: g.charset } }
        : { gen: { type: 'template', template } };
    }
    case 'pool': {
      const pool = str(g.pool);
      return pool ? { gen: { type: 'pool', pool } } : { why: '没有指定候选池' };
    }
    case 'range': {
      const min = num(g.min, 0);
      const max = num(g.max, 100);
      if (min > max) return { why: `数值区间颠倒（${min} > ${max}）` };
      return { gen: { type: 'range', min, max, decimals: Math.min(6, Math.max(0, Math.round(num(g.decimals, 0)))) } };
    }
    case 'date': {
      const direction = str(g.direction) as DateDirection;
      return {
        gen: {
          type: 'date',
          dateFormat: str(g.dateFormat, 'YYYY-MM-DD'),
          timeFormat: str(g.timeFormat, 'YYYY-MM-DD HH:mm:ss'),
          direction: DIRECTIONS.has(direction) ? direction : 'future',
          spanMinDays: Math.max(0, num(g.spanMinDays, 0)),
          spanMaxDays: Math.max(0, num(g.spanMaxDays, 365)),
        },
      };
    }
    case 'builtin': {
      const fn = str(g.fn) as BuiltinFn;
      return BUILTIN_FNS.has(fn) ? { gen: { type: 'builtin', fn } } : { why: `未知内置算法「${fn || '空'}」` };
    }
    default:
      return { gen: { type: 'option' } };
  }
}

function normalizeRule(raw: unknown): { rule: FieldRule } | { why: string } {
  if (!raw || typeof raw !== 'object') return { why: '不是对象' };
  const r = raw as Record<string, unknown>;
  const id = str(r.id).trim();
  if (!id) return { why: '缺少规则 id' };
  const name = str(r.name).trim();
  if (!name) return { why: '缺少规则名称' };
  const gen = normalizeGen(r.gen);
  if ('why' in gen) return gen;
  const group = str(r.group) as RuleGroup;
  return {
    rule: {
      id,
      name,
      keywords: Array.isArray(r.keywords) ? r.keywords.filter((k): k is string => typeof k === 'string') : [],
      group: GROUPS.has(group) ? group : 'text',
      gen: gen.gen,
      // 是不是内置由本地目录决定，文件里写了也不算：同 id 就是覆盖，不同 id 就是自定义。
      builtin: false,
      ...(r.mark === true ? { mark: true } : {}),
      ...(r.disabled === true ? { disabled: true } : {}),
    },
  };
}

function normalizePools(raw: unknown): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [id, values] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(values)) continue;
    const list = values.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
    // 空池会让 {pool:x} 渲染成令牌原文，导进来也只是把词库搞坏，直接丢掉。
    if (list.length) out[id] = list;
  }
  return out;
}

export function exportRules(stored: StoredRules): string {
  const file: RulesFile = {
    app: EXPORT_APP,
    kind: EXPORT_KIND,
    version: RULES_VERSION,
    exportedAt: new Date().toISOString(),
    rules: stored.rules ?? [],
    pools: stored.pools ?? {},
    marks: stored.marks ?? { prefix: '', suffix: '' },
  };
  return JSON.stringify(file, null, 2);
}

// 允许直接导入 exportRules 的产物，也允许导入裸的 StoredRules（手写或从别处拷来的）。
export function parseRulesFile(raw: string): ParsedRulesFile {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error('不是合法的 JSON');
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('顶层应该是一个对象');
  const o = data as Record<string, unknown>;
  if (o.app !== undefined && o.app !== EXPORT_APP) throw new Error(`这是「${String(o.app)}」的文件，不是 FormFaker 规则`);
  if (o.kind !== undefined && o.kind !== EXPORT_KIND) throw new Error(`文件类型是「${String(o.kind)}」，不是规则`);
  if (!Array.isArray(o.rules) && o.pools === undefined && o.marks === undefined) {
    throw new Error('文件里没有 rules / pools / marks 任何一项');
  }
  const version = num(o.version, RULES_VERSION);
  // 版本更高的文件可能带着这一版读不懂的字段，硬导进来只会静默丢配置。
  if (version > RULES_VERSION) throw new Error(`规则文件是 v${version}，当前扩展只认到 v${RULES_VERSION}，请先升级`);
  return {
    version,
    rules: Array.isArray(o.rules) ? o.rules : [],
    pools: normalizePools(o.pools),
    marks: { prefix: str((o.marks as Record<string, unknown>)?.prefix), suffix: str((o.marks as Record<string, unknown>)?.suffix) },
  };
}

export function importRules(raw: string, current: StoredRules, mode: ImportMode = 'merge'): ImportReport {
  const file = parseRulesFile(raw);
  const base: StoredRules =
    mode === 'replace'
      ? { version: RULES_VERSION, rules: [], pools: {}, marks: { prefix: '', suffix: '' } }
      : { version: RULES_VERSION, rules: [...current.rules], pools: { ...current.pools }, marks: { ...current.marks } };

  const report: ImportReport = { stored: base, rulesAdded: 0, rulesReplaced: 0, poolsAdded: 0, poolsReplaced: 0, skipped: [] };
  const known = new Set(base.rules.map((r) => r.id));

  for (const item of file.rules) {
    const got = normalizeRule(item);
    if ('why' in got) {
      const label = (item as Record<string, unknown>)?.name ?? (item as Record<string, unknown>)?.id ?? '?';
      report.skipped.push(`规则「${String(label)}」：${got.why}`);
      continue;
    }
    if (known.has(got.rule.id)) report.rulesReplaced++;
    else report.rulesAdded++;
    known.add(got.rule.id);
    base.rules = [...base.rules.filter((r) => r.id !== got.rule.id), got.rule];
  }

  for (const [id, values] of Object.entries(file.pools)) {
    if (base.pools[id]?.length) report.poolsReplaced++;
    else report.poolsAdded++;
    base.pools[id] = values;
  }

  // 标记只在文件真的写了内容时才覆盖，否则导入别人的规则会顺手把自己的前缀清掉。
  if (file.marks.prefix || file.marks.suffix) base.marks = file.marks;

  return report;
}

export function summarizeImport(r: ImportReport): string {
  const parts: string[] = [];
  if (r.rulesAdded) parts.push(`新增 ${r.rulesAdded} 条规则`);
  if (r.rulesReplaced) parts.push(`覆盖 ${r.rulesReplaced} 条规则`);
  if (r.poolsAdded) parts.push(`新增 ${r.poolsAdded} 个词库`);
  if (r.poolsReplaced) parts.push(`覆盖 ${r.poolsReplaced} 个词库`);
  if (r.skipped.length) parts.push(`跳过 ${r.skipped.length} 项`);
  return parts.length ? parts.join('，') : '文件里没有可导入的改动';
}
