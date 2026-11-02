import { formatDate, shiftDate, type DateUnit } from './datefmt';
import { FALLBACK_CHARSET, intBetween, pick, randomChars } from './random';

// 模板 DSL：字面量原样输出，`{}` 里是令牌。
//   字符类  {d} 数字  {u} 大写  {l} 小写  {a} 字母  {n} 大写字母+数字
//           {m} 小写字母+数字  {x} 十六进制  {c} 汉字  {s} 规则里配的自定义字符集
//   数量    {d} 一位  {d:8} 八位  {d:3-6} 三到六位
//   取值    {pool:词库id}  {num:1-999}  {num:1-500:2}（两位小数）
//   日期    {now}  {now:YYYYMM}  {now-30d:YYYYMMDD}  偏移单位 d/m/y
//   转义    {{ 与 }} 输出字面大括号
const DIGITS = '0123456789';
const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWER = 'abcdefghijklmnopqrstuvwxyz';

const CHAR_SETS: Record<string, string> = {
  d: DIGITS,
  u: UPPER,
  l: LOWER,
  a: UPPER + LOWER,
  n: UPPER + DIGITS,
  m: LOWER + DIGITS,
  x: '0123456789abcdef',
};

const HANZI_POOL = 'hanzi';
const MAX_REPEAT = 500;

export type TemplateNode =
  | { t: 'lit'; v: string; src: string }
  | { t: 'chars'; set: string; min: number; max: number; src: string }
  | { t: 'pool'; id: string; src: string }
  | { t: 'num'; min: number; max: number; places: number; src: string }
  | { t: 'now'; offset: number; unit: DateUnit; fmt: string; src: string };

export type TemplateParse = { ok: true; nodes: TemplateNode[] } | { ok: false; error: string };

export interface DslEnv {
  pools: Record<string, string[]>;
  charset?: string;
  now?: Date;
}

// 偏移写成 `[+-]\d+[a-z]*` 而不是 `[+-]\d+[dmy]`：单位写错时要能落到 parseNow 里给出
// 「偏移要写成 -30d」这类具体提示，否则整条模板只会报「有大括号没写成令牌」。
const TOKEN_RE = /\{\{|\}\}|\{([a-z]+)([+-]\d+[a-z]*)?(?::([^{}]*))?\}/g;

function parseCount(arg: string | undefined, src: string): { min: number; max: number } | string {
  if (arg === undefined) return { min: 1, max: 1 };
  const one = /^(\d+)$/.exec(arg);
  const span = /^(\d+)-(\d+)$/.exec(arg);
  if (!one && !span) return `${src} 的数量要写成 8 或 3-6`;
  const min = Number(one ? one[1] : span![1]);
  const max = Number(one ? one[1] : span![2]);
  if (min > max) return `${src} 的数量区间起点大于终点`;
  if (max > MAX_REPEAT) return `${src} 的数量不能超过 ${MAX_REPEAT}`;
  if (min === 0 && max === 0) return `${src} 的数量不能为 0`;
  return { min, max };
}

function parseNow(src: string, offset: string, arg: string | undefined): TemplateNode | string {
  let amount = 0;
  let unit: DateUnit = 'd';
  if (offset) {
    const m = /^([+-])(\d+)([dmy])$/.exec(offset);
    if (!m) return `${src} 的偏移要写成 -30d、+1y 这样`;
    amount = Number(m[2]) * (m[1] === '-' ? -1 : 1);
    unit = m[3] as DateUnit;
  }
  return { t: 'now', offset: amount, unit, fmt: arg?.trim() || 'YYYYMMDD', src };
}

function parseNum(src: string, arg: string | undefined): TemplateNode | string {
  const m = /^(-?\d+)-(-?\d+)(?::([0-6]))?$/.exec(arg ?? '');
  if (!m) return `${src} 要写成 {num:1-999} 或 {num:1-500:2}`;
  const min = Number(m[1]);
  const max = Number(m[2]);
  if (min > max) return `${src} 的区间起点大于终点`;
  return { t: 'num', min, max, places: m[3] ? Number(m[3]) : 0, src };
}

export function parseTemplate(src: string): TemplateParse {
  const nodes: TemplateNode[] = [];
  let last = 0;
  let lit = '';
  let strayBrace = false;
  // 只有「没被任何令牌吃掉」的原文区间里出现大括号才算漏写；{{ }} 转义出来的大括号是合法的。
  const takeRaw = (raw: string): void => {
    if (!raw) return;
    if (/[{}]/.test(raw)) strayBrace = true;
    lit += raw;
  };
  TOKEN_RE.lastIndex = 0;
  for (;;) {
    const m = TOKEN_RE.exec(src);
    if (!m) break;
    takeRaw(src.slice(last, m.index));
    last = m.index + m[0].length;
    const token = m[0];
    if (token === '{{') {
      lit += '{';
      continue;
    }
    if (token === '}}') {
      lit += '}';
      continue;
    }
    if (lit) {
      nodes.push({ t: 'lit', v: lit, src: lit });
      lit = '';
    }
    const [, name, offset, arg] = m;
    if (name === 'now') {
      const node = parseNow(token, offset, arg);
      if (typeof node === 'string') return { ok: false, error: node };
      nodes.push(node);
      continue;
    }
    if (name === 'num') {
      const node = parseNum(token, arg);
      if (typeof node === 'string') return { ok: false, error: node };
      nodes.push(node);
      continue;
    }
    if (name === 'pool') {
      const id = (arg ?? '').trim();
      if (!id) return { ok: false, error: `${token} 缺少词库名，要写成 {pool:emailDomain}` };
      nodes.push({ t: 'pool', id, src: token });
      continue;
    }
    if (!offset && (name === 'c' || name === 's' || CHAR_SETS[name])) {
      if (arg !== undefined && arg === '') return { ok: false, error: `${token} 的数量不能为空` };
      const count = parseCount(arg, token);
      if (typeof count === 'string') return { ok: false, error: count };
      nodes.push({ t: 'chars', set: name, min: count.min, max: count.max, src: token });
      continue;
    }
    return { ok: false, error: `无法解析的标记 ${token}` };
  }
  takeRaw(src.slice(last));
  if (strayBrace) {
    return { ok: false, error: '有大括号没写成令牌，要原样输出请写 {{ 或 }}' };
  }
  if (lit) nodes.push({ t: 'lit', v: lit, src: lit });
  return { ok: true, nodes };
}

function charsetOf(name: string, env: DslEnv): string {
  if (name === 'c') return env.pools[HANZI_POOL]?.join('') ?? '';
  if (name === 's') return (env.charset ?? '').trim() || FALLBACK_CHARSET;
  return CHAR_SETS[name] ?? '';
}

function renderNode(node: TemplateNode, env: DslEnv): string {
  switch (node.t) {
    case 'lit':
      return node.v;
    case 'chars': {
      const set = charsetOf(node.set, env);
      // 词库被清空时把令牌原文吐出来：值里出现 {c:2} 比生成一串空格更容易被发现。
      if (!set) return node.src;
      return randomChars(set, intBetween(node.min, node.max));
    }
    case 'pool': {
      const values = env.pools[node.id];
      if (!values?.length) return node.src;
      return pick(values);
    }
    case 'num': {
      const raw = node.min + Math.random() * (node.max - node.min);
      return node.places ? raw.toFixed(node.places) : String(Math.round(raw));
    }
    case 'now':
      return formatDate(shiftDate(env.now ?? new Date(), node.offset, node.unit), node.fmt);
  }
}

// 渲染永不抛异常：解析不了就原样返回，让问题在字段值里可见而不是让整轮识别失败。
export function renderTemplate(src: string, env: DslEnv): string {
  const parsed = parseTemplate(src);
  if (!parsed.ok) return src;
  return parsed.nodes.map((n) => renderNode(n, env)).join('');
}

export function templatePreview(src: string, env: DslEnv, count = 3): string[] {
  return Array.from({ length: count }, () => renderTemplate(src, env));
}

// 模板引用到的词库 id，供 UI 校验「词库不存在」。
export function templatePoolRefs(src: string): string[] {
  const parsed = parseTemplate(src);
  if (!parsed.ok) return [];
  return parsed.nodes.filter((n): n is Extract<TemplateNode, { t: 'pool' }> => n.t === 'pool').map((n) => n.id);
}

// 语法之外的可用性检查：词库存在、{s} 有字符集。返回 null 表示可用。
// 纯字面量模板是合法的「固定值」规则，不在这里拦。
export function validateTemplate(src: string, env: DslEnv): string | null {
  const parsed = parseTemplate(src);
  if (!parsed.ok) return parsed.error;
  for (const node of parsed.nodes) {
    if (node.t === 'pool' && !env.pools[node.id]?.length) return `词库「${node.id}」不存在或为空`;
    if (node.t === 'chars' && node.set === 'c' && !env.pools[HANZI_POOL]?.length) return '汉字词库为空';
    if (node.t === 'chars' && node.set === 's' && !(env.charset ?? '').trim()) return '用了 {s} 但没填自定义字符集';
  }
  return null;
}

// DSL 速查表。编辑器按分组渲染成对照表；DSL_HINT 保留同一份内容的纯文本版给自检工具打印。
export const DSL_GROUPS: { label: string; items: { token: string; desc: string }[] }[] = [
  {
    label: '字符',
    items: [
      { token: '{d}', desc: '数字' },
      { token: '{u}', desc: '大写字母' },
      { token: '{l}', desc: '小写字母' },
      { token: '{a}', desc: '字母' },
      { token: '{n}', desc: '大写+数字' },
      { token: '{m}', desc: '小写+数字' },
      { token: '{x}', desc: '十六进制' },
      { token: '{c}', desc: '汉字' },
      { token: '{s}', desc: '自定义字符集' },
    ],
  },
  {
    label: '数量',
    items: [
      { token: '{d:8}', desc: '固定 8 位' },
      { token: '{d:3-6}', desc: '3~6 位' },
    ],
  },
  {
    label: '取值',
    items: [
      { token: '{pool:词库id}', desc: '引用词库' },
      { token: '{num:1-999}', desc: '整数' },
      { token: '{num:1-500:2}', desc: '保留 2 位小数' },
    ],
  },
  {
    label: '日期',
    items: [
      { token: '{now}', desc: '今天' },
      { token: '{now:YYYYMM}', desc: '按格式串输出' },
      { token: '{now-30d:YYYYMMDD}', desc: '相对今天' },
    ],
  },
  {
    label: '转义',
    items: [{ token: '{{ }}', desc: '输出字面大括号' }],
  },
];

export const DSL_HINT = DSL_GROUPS.map(
  (g) => `${g.label}：${g.items.map((i) => `${i.token} ${i.desc}`).join('，')}`,
).join('\n');
