import type { Kind } from '../../shared/types';
import { RANDOM_OPTION_PLACEHOLDER } from '../../shared/types';
import type { Catalog, FieldRule, GenSpec } from '../rules/types';
import { GENERIC_RULE_ID } from '../rules/types';
import { renderTemplate } from '../rules/dsl';
import { formatDate } from '../rules/datefmt';
import { digits, intBetween, pick, shuffled } from '../rules/random';
import { randomAreaCode, randomCityName, randomRegionPath } from './region';
import { cityCenter, formatLngLat } from './geo';

export interface GeneratorCtx {
  kind: Kind;
  // 命中的规则 id（字段名沿用 semantic 时代的叫法，值是规则 id）。
  ruleId: string;
  label: string;
  optionTexts?: string[];
  catalog: Catalog;
}

const ID_WEIGHTS = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
const ID_CHECKS = '10X98765432';

export function idCheckDigit(body17: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += Number(body17[i]) * ID_WEIGHTS[i];
  return ID_CHECKS[sum % 11];
}

const USCC_CHARS = '0123456789ABCDEFGHJKLMNPQRTUWXY';
const USCC_WEIGHTS = [1, 3, 9, 27, 19, 26, 16, 17, 20, 29, 25, 13, 8, 24, 10, 30, 28];

export function usccCheckDigit(body17: string): string {
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += USCC_CHARS.indexOf(body17[i]) * USCC_WEIGHTS[i];
  return USCC_CHARS[(31 - (sum % 31)) % 31];
}

export function luhnCheckDigit(body: string): string {
  let sum = 0;
  let double = true; // rightmost char of body becomes 2x when check digit appended
  for (let i = body.length - 1; i >= 0; i--) {
    let d = Number(body[i]);
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return String((10 - (sum % 10)) % 10);
}

const pad = (n: number): string => String(n).padStart(2, '0');
const DAY = 86400000;

// Fixed internal format: the compact date embedded in an ID number body.
function compactDate(d: Date): string {
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
}

type DateGen = Extract<GenSpec, { type: 'date' }>;

const DEFAULT_DATE_GEN: DateGen = {
  type: 'date',
  dateFormat: 'YYYY-MM-DD',
  timeFormat: 'YYYY-MM-DD HH:mm:ss',
  direction: 'future',
  spanMinDays: 30,
  spanMaxDays: 1000,
};

function dateGenOf(rule: FieldRule): DateGen {
  return rule.gen.type === 'date' ? rule.gen : DEFAULT_DATE_GEN;
}

// 历史语义字段必须落在过去，否则会出现「出生日期 2027 年」这种数据；这条不受方向设置影响。
const HISTORY_LABEL_RE = /成立|出生|毕业|入职|注册/;

function dateBounds(label: string, gen: DateGen): { from: Date; to: Date } {
  const now = Date.now();
  if (HISTORY_LABEL_RE.test(label)) return { from: new Date('1960-01-01'), to: new Date('2015-12-31') };
  const to = new Date(now + 365 * DAY);
  if (gen.direction === 'past') return { from: new Date(now - 1500 * DAY), to: new Date(now) };
  if (gen.direction === 'any') return { from: new Date(now - 1500 * DAY), to };
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

function randomDateIn(from: Date, to: Date): Date {
  return new Date(from.getTime() + Math.random() * (to.getTime() - from.getTime()));
}

// 原样贴上用户配置的标记，不自动补分隔符（要 `-` 就写在设置里）。
function marked(value: string, catalog: Catalog): string {
  return `${catalog.marks.prefix.trim()}${value}${catalog.marks.suffix.trim()}`;
}

const BIG_AMOUNT_RE = /资本|资金|人数|数量|营业额|营收|销售额|收入|利润|产值|[（(]元[）)]/;
const YEAR_COUNT_RE = /年限|年数|工龄|司龄|[（(]年[）)]/;

const BUILTINS: Record<string, (ctx: GeneratorCtx) => string> = {
  cnName: (ctx) => {
    const surnames = ctx.catalog.pools.surname ?? [];
    const given = ctx.catalog.pools.givenChar ?? [];
    if (!surnames.length || !given.length) return '';
    let name = pick(surnames);
    for (let i = 0, n = intBetween(1, 2); i < n; i++) name += pick(given);
    return name;
  },
  company: (ctx) => {
    const p = ctx.catalog.pools;
    // 直辖市与省直辖县级区划的市级是占位名，randomCityName 已经过滤掉了。
    const city = randomCityName().replace(/市$/, '');
    return `${city}${pick(p.companyWord ?? [])}${pick(p.companyIndustry ?? [])}${pick(p.companyForm ?? [])}`;
  },
  region: () => {
    const r = randomRegionPath();
    // 直辖市的市级是占位名，randomRegionPath 已置空，这里按空值省掉该级。
    return [r.province, r.city, ...(r.hasArea ? [r.area] : [])].filter(Boolean).join('/');
  },
  address: (ctx) => {
    const r = randomRegionPath();
    const base = [r.province, r.city, ...(r.hasArea ? [r.area] : [])].filter(Boolean).join('');
    const street = pick(ctx.catalog.pools.streetName ?? ['']);
    return `${base}${street}${intBetween(1, 999)}号${intBetween(1, 30)}幢${intBetween(101, 2505)}室`;
  },
  lnglat: () => {
    const r = randomRegionPath();
    return formatLngLat(cityCenter(r.province, r.city || r.province));
  },
  idNumber: () => {
    const body = randomAreaCode() + compactDate(randomDateIn(new Date('1960-01-01'), new Date('2005-12-31'))) + digits(3);
    return body + idCheckDigit(body);
  },
  creditCode: () => {
    let body = pick(['91', '92', '11']) + randomAreaCode();
    for (let i = 0; i < 9; i++) body += USCC_CHARS[Math.floor(Math.random() * USCC_CHARS.length)];
    return body + usccCheckDigit(body);
  },
  bankCard: () => {
    const body = '62' + digits(intBetween(13, 16));
    return body + luhnCheckDigit(body);
  },
  paragraph: (ctx) => {
    const sentences = ctx.catalog.pools.sentence ?? [];
    if (!sentences.length) return '';
    return shuffled(sentences)
      .slice(0, Math.min(sentences.length, intBetween(2, 4)))
      .join('');
  },
  amount: (ctx) => {
    if (BIG_AMOUNT_RE.test(ctx.label)) return String(intBetween(100, 50000) * 10000);
    return (intBetween(100, 50000000) / 100).toFixed(2);
  },
  integer: (ctx) => (YEAR_COUNT_RE.test(ctx.label) ? String(intBetween(1, 30)) : String(intBetween(1, 999))),
};

function renderValue(ctx: GeneratorCtx, rule: FieldRule): string {
  const gen = rule.gen;
  const { catalog } = ctx;
  switch (gen.type) {
    case 'template':
      return renderTemplate(gen.template, { pools: catalog.pools, charset: gen.charset });
    case 'pool':
      return pick(catalog.pools[gen.pool] ?? ['']);
    case 'range': {
      const raw = gen.min + Math.random() * (gen.max - gen.min);
      return gen.decimals ? raw.toFixed(gen.decimals) : String(Math.round(raw));
    }
    case 'date': {
      const { from, to } = dateBounds(ctx.label, gen);
      const fmt = ctx.kind === 'datetime' ? gen.timeFormat : gen.dateFormat;
      return formatDate(randomDateIn(from, to), fmt);
    }
    // 页面候选随机。生成值与选项文案不完全一致时由填充层做模糊匹配，兜不住再随机挑一项。
    case 'option': {
      const options = ctx.optionTexts ?? [];
      return options.length ? pick(options) : RANDOM_OPTION_PLACEHOLDER;
    }
    case 'builtin':
      return BUILTINS[gen.fn]?.(ctx) ?? '';
  }
}

export function generate(ctx: GeneratorCtx): string {
  const rule = ctx.catalog.byId.get(ctx.ruleId) ?? ctx.catalog.byId.get(GENERIC_RULE_ID);
  if (!rule) return '';

  if (ctx.kind === 'daterange') {
    const gen = dateGenOf(rule);
    const { from, to } = dateBounds(ctx.label, gen);
    const start = randomDateIn(from, to);
    const end = new Date(start.getTime() + intBetween(gen.spanMinDays, gen.spanMaxDays) * DAY);
    return `${formatDate(start, gen.dateFormat)} ~ ${formatDate(end, gen.dateFormat)}`;
  }
  if (ctx.kind === 'checkbox' || ctx.kind === 'switch') return Math.random() < 0.5 ? 'true' : 'false';
  if (ctx.kind === 'checkbox-group') {
    const options = ctx.optionTexts ?? [];
    if (!options.length) return RANDOM_OPTION_PLACEHOLDER;
    return shuffled(options)
      .slice(0, Math.min(options.length, intBetween(1, 2)))
      .join('、');
  }
  if (ctx.kind === 'upload-image') return `[图片 test-${digits(4)}.png]`;
  if (ctx.kind === 'upload-file') return `[文件 test-${digits(4)}.pdf]`;
  // The value comes from a record picked inside the dialog, not from a generator.
  if (ctx.kind === 'lookup') return RANDOM_OPTION_PLACEHOLDER;

  const value = renderValue(ctx, rule);
  return rule.mark ? marked(value, ctx.catalog) : value;
}
