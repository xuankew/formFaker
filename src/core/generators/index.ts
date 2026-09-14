import type { GenRules, Kind, Semantic } from '../../shared/types';
import { DEFAULT_GEN_RULES, RANDOM_OPTION_PLACEHOLDER } from '../../shared/types';
import {
  COMPANY_FORMS, COMPANY_INDUSTRIES, COMPANY_WORDS, EDUCATIONS, EMAIL_DOMAINS, EMAIL_NAMES,
  GIVEN_CHARS, GENDERS, LANDLINE_AREACODES, PARAGRAPH_SENTENCES, PHONE_PREFIXES, STREET_NAMES,
  SURNAMES, digits, intBetween, pick,
} from './pools';
import { randomAreaCode, randomCityName, randomRegionPath } from './region';
import { cityCenter, formatLngLat } from './geo';

export interface GeneratorCtx {
  kind: Kind;
  semantic: Semantic;
  label: string;
  optionTexts?: string[];
  rules?: GenRules;
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

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// Fixed internal format, used where a stable machine format is required
// (e.g. the compact date embedded in an ID number body).
function fmtDate(d: Date, withTime: boolean): string {
  const base = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  return withTime ? `${base} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` : base;
}

// Token-based formatter honoring user rules: YYYY MM DD HH mm ss.
function applyFormat(d: Date, fmt: string): string {
  const map: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
    ss: pad(d.getSeconds()),
  };
  return fmt.replace(/YYYY|MM|DD|HH|mm|ss/g, (t) => map[t]);
}

function parseList(s: string): string[] {
  return s.split(/[,，\s]+/).map((x) => x.trim()).filter(Boolean);
}

function randomDate(from: Date, to: Date, withTime: boolean): string {
  const t = from.getTime() + Math.random() * (to.getTime() - from.getTime());
  return fmtDate(new Date(t), withTime);
}

function randomDateIn(from: Date, to: Date): Date {
  return new Date(from.getTime() + Math.random() * (to.getTime() - from.getTime()));
}

function dateBounds(label: string): { from: Date; to: Date } {
  const now = Date.now();
  const historical = /成立|出生|毕业|入职|注册/.test(label);
  return historical
    ? { from: new Date('1960-01-01'), to: new Date('2015-12-31') }
    : { from: new Date(now - 1500 * 86400000), to: new Date(now + 365 * 86400000) };
}

function dateFor(ctx: GeneratorCtx, withTime: boolean): string {
  const rules = ctx.rules ?? DEFAULT_GEN_RULES;
  const { from, to } = dateBounds(ctx.label);
  return applyFormat(randomDateIn(from, to), withTime ? rules.datetimeFormat : rules.dateFormat);
}

function enumValue(ctx: GeneratorCtx): string {
  const options = ctx.optionTexts ?? [];
  if (!options.length) return RANDOM_OPTION_PLACEHOLDER;
  if (ctx.semantic === 'gender') {
    const hit = options.find((o) => GENDERS.includes(o));
    if (hit) return hit;
  }
  if (ctx.semantic === 'education') {
    const hit = options.find((o) => EDUCATIONS.includes(o));
    if (hit) return hit;
  }
  return pick(options);
}

export const GENERATORS: Record<Semantic, (ctx: GeneratorCtx) => string> = {
  phone: (ctx) => {
    const custom = parseList((ctx.rules ?? DEFAULT_GEN_RULES).phonePrefixes);
    return (custom.length ? pick(custom) : pick(PHONE_PREFIXES)) + digits(8);
  },
  landline: () => `${pick(LANDLINE_AREACODES)}-${digits(Math.random() < 0.5 ? 7 : 8)}`,
  email: (ctx) => {
    const domain = (ctx.rules ?? DEFAULT_GEN_RULES).emailDomain.trim() || pick(EMAIL_DOMAINS);
    return `${pick(EMAIL_NAMES)}${digits(3)}@${domain}`;
  },
  idNumber: () => {
    const body = randomAreaCode() + randomDate(new Date('1960-01-01'), new Date('2005-12-31'), false).replaceAll('-', '') + digits(3);
    return body + idCheckDigit(body);
  },
  creditCode: () => {
    let body = pick(['91', '92', '11']) + randomAreaCode();
    for (let i = 0; i < 9; i++) body += USCC_CHARS[Math.floor(Math.random() * USCC_CHARS.length)];
    return body + usccCheckDigit(body);
  },
  passport: () => pick(['E', 'G', 'P', 'EA']) + digits(8),
  bankCard: () => {
    const body = '62' + digits(intBetween(13, 16));
    return body + luhnCheckDigit(body);
  },
  cnName: () => pick([...SURNAMES]) + Array.from({ length: intBetween(1, 2) }, () => pick([...GIVEN_CHARS])).join(''),
  company: (ctx) => {
    const custom = parseList((ctx.rules ?? DEFAULT_GEN_RULES).companySuffixes);
    const suffix = custom.length ? pick(custom) : pick(COMPANY_FORMS);
    return randomCityName().replace(/市$/, '') + pick(COMPANY_WORDS) + pick(COMPANY_INDUSTRIES) + suffix;
  },
  region: () => {
    const r = randomRegionPath();
    return r.hasArea ? `${r.province}/${r.city}/${r.area}` : `${r.province}/${r.city}`;
  },
  address: () => {
    const r = randomRegionPath();
    const base = r.hasArea ? `${r.province}${r.city}${r.area}` : `${r.province}${r.city}`;
    return `${base}${pick(STREET_NAMES)}${intBetween(1, 999)}号${intBetween(1, 30)}幢${intBetween(101, 2505)}室`;
  },
  lnglat: () => {
    const r = randomRegionPath();
    return formatLngLat(cityCenter(r.province, r.city));
  },
  date: (ctx) => dateFor(ctx, ctx.kind === 'datetime'),
  amount: (ctx) => {
    if (/资本|资金|人数|数量/.test(ctx.label)) return String(intBetween(100, 50000) * 10000);
    return (intBetween(100, 50000000) / 100).toFixed(2);
  },
  integer: () => String(intBetween(1, 999)),
  paragraph: () => {
    const n = intBetween(2, 4);
    const shuffled = [...PARAGRAPH_SENTENCES].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, n).join('');
  },
  url: () => `https://www.${pick(EMAIL_NAMES)}${digits(2)}.com`,
  zipcode: () => String(intBetween(1, 6)) + digits(5),
  gender: (ctx) => enumValue(ctx) === RANDOM_OPTION_PLACEHOLDER ? pick(GENDERS) : enumValue(ctx),
  education: (ctx) => enumValue(ctx) === RANDOM_OPTION_PLACEHOLDER ? pick(EDUCATIONS) : enumValue(ctx),
  enum: (ctx) => enumValue(ctx),
  generic: () => `autotest-${Math.random().toString(36).slice(2, 7)}`,
};

export function generate(ctx: GeneratorCtx): string {
  if (ctx.kind === 'daterange') {
    const rules = ctx.rules ?? DEFAULT_GEN_RULES;
    const { from, to } = dateBounds(ctx.label);
    const startD = randomDateIn(from, to);
    const endD = new Date(startD.getTime() + (30 + Math.random() * 970) * 86400000);
    return `${applyFormat(startD, rules.dateFormat)} ~ ${applyFormat(endD, rules.dateFormat)}`;
  }
  if (ctx.kind === 'checkbox' || ctx.kind === 'switch') return Math.random() < 0.5 ? 'true' : 'false';
  if (ctx.kind === 'checkbox-group') {
    const options = ctx.optionTexts ?? [];
    if (!options.length) return RANDOM_OPTION_PLACEHOLDER;
    const n = Math.min(options.length, intBetween(1, 2));
    return [...options].sort(() => Math.random() - 0.5).slice(0, n).join('、');
  }
  if (ctx.kind === 'upload-image') return `[图片 test-${digits(4)}.png]`;
  if (ctx.kind === 'upload-file') return `[文件 test-${digits(4)}.pdf]`;
  return GENERATORS[ctx.semantic](ctx);
}
