import { describe, expect, it } from 'vitest';
import {
  parseTemplate,
  renderTemplate,
  templatePoolRefs,
  templatePreview,
  validateTemplate,
  type DslEnv,
} from '../src/core/rules/dsl';
import { FALLBACK_CHARSET } from '../src/core/rules/random';
import { formatDate, shiftDate } from '../src/core/rules/datefmt';

const NOW = new Date(2026, 2, 15, 13, 45, 9);

const env = (over: Partial<DslEnv> = {}): DslEnv => ({
  pools: { emailDomain: ['example.com'], hanzi: ['甲', '乙', '丙'] },
  now: NOW,
  ...over,
});

const render = (src: string, over: Partial<DslEnv> = {}): string => renderTemplate(src, env(over));

describe('模板 DSL 渲染', () => {
  it('字面量原样输出', () => {
    expect(render('订单号')).toBe('订单号');
    expect(render('')).toBe('');
  });

  it('字符类各取自己的字符集', () => {
    const sets: [string, RegExp][] = [
      ['{d:6}', /^\d{6}$/],
      ['{u:4}', /^[A-Z]{4}$/],
      ['{l:4}', /^[a-z]{4}$/],
      ['{a:5}', /^[A-Za-z]{5}$/],
      ['{n:12}', /^[A-Z0-9]{12}$/],
      ['{m:8}', /^[a-z0-9]{8}$/],
      ['{x:10}', /^[0-9a-f]{10}$/],
      ['{c:3}', /^[甲乙丙]{3}$/],
    ];
    for (const [tpl, re] of sets) {
      for (let i = 0; i < 20; i++) expect(render(tpl)).toMatch(re);
    }
  });

  it('不带数量就是一位', () => {
    for (let i = 0; i < 20; i++) expect(render('{d}')).toMatch(/^\d$/);
  });

  it('区间数量落在闭区间内', () => {
    for (let i = 0; i < 50; i++) {
      const v = render('{d:3-6}');
      expect(v.length).toBeGreaterThanOrEqual(3);
      expect(v.length).toBeLessThanOrEqual(6);
    }
  });

  it('{s} 用规则里配的字符集，没配就用兜底集', () => {
    for (let i = 0; i < 20; i++) expect(render('{s:6}', { charset: 'AB1' })).toMatch(/^[AB1]{6}$/);
    for (let i = 0; i < 20; i++) {
      const v = render('{s:6}');
      expect(v).toHaveLength(6);
      for (const ch of v) expect(FALLBACK_CHARSET).toContain(ch);
    }
  });

  it('字面量与令牌可以混排', () => {
    for (let i = 0; i < 20; i++) expect(render('ORD-{now:YYYYMMDD}-{d:4}')).toMatch(/^ORD-20260315-\d{4}$/);
  });

  it('{pool:x} 从词库随机取值', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) seen.add(render('{pool:emailDomain}'));
    expect([...seen]).toEqual(['example.com']);
  });

  it('词库缺失或为空时把令牌原文吐出来，好让用户看见问题', () => {
    expect(render('{pool:nope}')).toBe('{pool:nope}');
    expect(render('{c:2}', { pools: {} })).toBe('{c:2}');
  });

  it('{num:min-max} 取整，带小数位就保留位数', () => {
    for (let i = 0; i < 50; i++) {
      const n = Number(render('{num:1-999}'));
      expect(Number.isInteger(n)).toBe(true);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(999);
      expect(render('{num:1-500:2}')).toMatch(/^\d+\.\d{2}$/);
    }
  });

  it('{now} 系列按偏移与格式渲染', () => {
    expect(render('{now}')).toBe('20260315');
    expect(render('{now:YYYY-MM}')).toBe('2026-03');
    expect(render('{now-30d:YYYYMMDD}')).toBe('20260213');
    expect(render('{now+1y:YYYY}')).toBe('2027');
    expect(render('{now-1m:YYYY/MM}')).toBe('2026/02');
    expect(render('{now:HH:mm:ss}')).toBe('13:45:09');
  });

  it('{{ 与 }} 输出字面大括号', () => {
    expect(render('{{d}}')).toBe('{d}');
    expect(render('a{{b}}c')).toBe('a{b}c');
  });

  it('渲染永不抛异常：解析不了就原样返回', () => {
    expect(render('{q:3}')).toBe('{q:3}');
    expect(render('残缺的 {')).toBe('残缺的 {');
  });

  it('同一条模板每次渲染都不同', () => {
    const values = templatePreview('{n:12}', env(), 20);
    expect(values).toHaveLength(20);
    expect(new Set(values).size).toBeGreaterThan(1);
  });
});

describe('模板 DSL 解析报错', () => {
  it.each([
    ['{d:abc}', '数量要写成'],
    ['{d:6-3}', '起点大于终点'],
    ['{d:600}', '不能超过 500'],
    ['{d:0}', '不能为 0'],
    ['{d:}', '数量不能为空'],
    ['{q:3}', '无法解析的标记'],
    ['{pool:}', '缺少词库名'],
    ['{now-30:YYYY}', '偏移要写成'],
    ['{num:abc}', '要写成 {num:1-999}'],
    ['{num:9-1}', '起点大于终点'],
    ['a{b', '有大括号没写成令牌'],
  ])('%s 报「%s」', (src, want) => {
    const parsed = parseTemplate(src);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(want);
  });

  it('合法模板解析出节点', () => {
    const parsed = parseTemplate('AB-{d:4}');
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.nodes.map((n) => n.t)).toEqual(['lit', 'chars']);
    }
  });
});

describe('模板 DSL 可用性校验', () => {
  it('可用模板返回 null', () => {
    expect(validateTemplate('{pool:emailDomain}{d:4}', env())).toBeNull();
    expect(validateTemplate('{c:2}', env())).toBeNull();
    expect(validateTemplate('{s:4}', env({ charset: 'ABC' }))).toBeNull();
  });

  it('纯字面量是合法的固定值规则', () => {
    expect(validateTemplate('固定值', env())).toBeNull();
  });

  it('拦下引用不到的词库与缺字符集的 {s}', () => {
    expect(validateTemplate('{pool:nope}', env())).toContain('不存在或为空');
    expect(validateTemplate('{c:2}', env({ pools: {} }))).toBe('汉字词库为空');
    expect(validateTemplate('{s:2}', env())).toContain('没填自定义字符集');
  });

  it('语法错误优先于可用性错误', () => {
    expect(validateTemplate('{q:1}', env())).toContain('无法解析');
  });

  it('列出模板引用到的词库', () => {
    expect(templatePoolRefs('{pool:emailDomain}-{d:3}-{pool:emailDomain}')).toEqual(['emailDomain', 'emailDomain']);
    expect(templatePoolRefs('{d:3}')).toEqual([]);
    expect(templatePoolRefs('{q:3}')).toEqual([]);
  });
});

describe('日期格式化', () => {
  it('支持 YYYY MM DD HH mm ss 六种令牌', () => {
    expect(formatDate(NOW, 'YYYY-MM-DD HH:mm:ss')).toBe('2026-03-15 13:45:09');
    expect(formatDate(NOW, 'YYYY年MM月DD日')).toBe('2026年03月15日');
    expect(formatDate(NOW, 'DD/MM/YYYY')).toBe('15/03/2026');
  });

  it('空格式回退 YYYY-MM-DD，避免用户清空后生成空串', () => {
    expect(formatDate(NOW, '   ')).toBe('2026-03-15');
  });

  it('格式里没有令牌就原样输出', () => {
    expect(formatDate(NOW, 'abc')).toBe('abc');
  });

  it('偏移按日历进位而不是固定天数', () => {
    expect(formatDate(shiftDate(NOW, -1, 'm'), 'YYYY-MM-DD')).toBe('2026-02-15');
    expect(formatDate(shiftDate(new Date(2026, 2, 31), -1, 'm'), 'YYYY-MM-DD')).toBe('2026-03-03');
    expect(formatDate(shiftDate(NOW, 1, 'y'), 'YYYY-MM-DD')).toBe('2027-03-15');
    expect(formatDate(shiftDate(NOW, 0, 'd'), 'YYYY-MM-DD')).toBe('2026-03-15');
  });

  it('偏移不改动传入的日期对象', () => {
    const before = NOW.getTime();
    shiftDate(NOW, 30, 'd');
    expect(NOW.getTime()).toBe(before);
  });
});
