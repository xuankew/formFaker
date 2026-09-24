import { describe, expect, it } from 'vitest';
import { GENERATORS, generate, idCheckDigit, luhnCheckDigit, usccCheckDigit, type GeneratorCtx } from '../src/core/generators';
import { AREAS } from '../src/core/generators/region-data';
import { DEFAULT_GEN_RULES, type GenRules } from '../src/shared/types';
import { normalizeEmailDomain } from '../src/shared/rules';

const ctx = (semantic: GeneratorCtx['semantic'], over: Partial<GeneratorCtx> = {}): GeneratorCtx => ({
  kind: 'text',
  semantic,
  label: '',
  ...over,
});

const rules = (over: Partial<GenRules>): GenRules => ({ ...DEFAULT_GEN_RULES, ...over });

// 生成器默认输出 ISO，日期区间断言直接按字典序比较字符串即可。
const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('generators', () => {
  it('phone matches mainland mobile segments', () => {
    for (let i = 0; i < 50; i++) expect(GENERATORS.phone(ctx('phone'))).toMatch(/^1[3-9]\d{9}$/);
  });

  it('idNumber passes GB 11643 checksum and uses real area codes', () => {
    const codes = new Set(AREAS.map((a) => a[0]));
    for (let i = 0; i < 50; i++) {
      const v = GENERATORS.idNumber(ctx('idNumber'));
      expect(v).toMatch(/^\d{17}[\dX]$/);
      expect(codes.has(v.slice(0, 6))).toBe(true);
      expect(idCheckDigit(v.slice(0, 17))).toBe(v[17]);
    }
  });

  it('creditCode passes GB 32100 checksum', () => {
    for (let i = 0; i < 50; i++) {
      const v = GENERATORS.creditCode(ctx('creditCode'));
      expect(v).toMatch(/^[0-9A-HJ-NP-RTUW-Y]{18}$/);
      expect(usccCheckDigit(v.slice(0, 17))).toBe(v[17]);
    }
  });

  it('bankCard passes Luhn', () => {
    for (let i = 0; i < 50; i++) {
      const v = GENERATORS.bankCard(ctx('bankCard'));
      expect(v).toMatch(/^\d{16,19}$/);
      expect(luhnCheckDigit(v.slice(0, -1))).toBe(v[v.length - 1]);
    }
  });

  it('passport matches letter prefix + 8 digits', () => {
    for (let i = 0; i < 50; i++) {
      expect(GENERATORS.passport(ctx('passport'))).toMatch(/^(E|G|P|EA)\d{8}$/);
    }
  });

  it('amount for capital/fund labels is whole yuan', () => {
    for (const label of ['注册资本（单位:元）', '实缴资金（单位:元）', '上年度营业额（元）']) {
      const v = GENERATORS.amount(ctx('amount', { label }));
      expect(v).toMatch(/^\d+$/);
      expect(Number(v) % 10000).toBe(0);
    }
  });

  it('integer year-counts stay plausible while plain counts use the wide range', () => {
    for (const label of ['行业年限（年）', '实际运营时间（年）', '生产及品控管理年限（年）']) {
      for (let i = 0; i < 30; i++) {
        const v = GENERATORS.integer(ctx('integer', { label }));
        expect(Number(v)).toBeGreaterThanOrEqual(1);
        expect(Number(v)).toBeLessThanOrEqual(30);
      }
    }
    for (const label of ['可供应产线（条）', '专职研发人员']) {
      const v = GENERATORS.integer(ctx('integer', { label }));
      expect(Number(v)).toBeGreaterThanOrEqual(1);
      expect(Number(v)).toBeLessThanOrEqual(999);
    }
  });

  it('region path has two or three levels', () => {
    for (let i = 0; i < 30; i++) {
      const parts = GENERATORS.region(ctx('region')).split('/');
      expect([2, 3]).toContain(parts.length);
    }
  });

  // 直辖市与省直辖县级区划在国标数据里的市级行叫「市辖区 / 县 / 省直辖县级行政区划」，
  // 直接拿来拼名字会得到「市辖区星辰电子有限责任公司」「北京市市辖区东城区…」这种。
  it('never leaks the placeholder city level into names', () => {
    for (let i = 0; i < 300; i++) {
      const company = GENERATORS.company(ctx('company'));
      expect(company).not.toMatch(/市辖区|直辖县级行政区划/);
      expect(company).not.toMatch(/^县/);
      expect(GENERATORS.address(ctx('address'))).not.toMatch(/市辖区|直辖县级行政区划/);
      expect(GENERATORS.region(ctx('region'))).not.toMatch(/市辖区|直辖县级行政区划/);
    }
  });

  it('drops the placeholder level for municipalities instead of repeating the province', () => {
    const MUNICIPALITIES = ['北京市', '天津市', '上海市', '重庆市'];
    let seen = 0;
    for (let i = 0; i < 800; i++) {
      const parts = GENERATORS.region(ctx('region')).split('/');
      if (!MUNICIPALITIES.includes(parts[0])) continue;
      seen++;
      expect(parts).toHaveLength(2);
      expect(parts[1].length).toBeGreaterThan(0);
      expect(GENERATORS.address(ctx('address'))).not.toMatch(/^(北京市|天津市|上海市|重庆市)\1/);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('daterange start < end', () => {
    for (let i = 0; i < 20; i++) {
      const [a, b] = generate(ctx('date', { kind: 'daterange' })).split('~').map((s) => s.trim());
      expect(new Date(a).getTime()).toBeLessThan(new Date(b).getTime());
    }
  });

  it('enum picks from provided options', () => {
    const v = generate(ctx('enum', { kind: 'select', optionTexts: ['甲', '乙'] }));
    expect(['甲', '乙']).toContain(v);
  });

  it('enum without options returns placeholder', () => {
    expect(generate(ctx('enum', { kind: 'select-widget' }))).toBe('(填充时随机选择)');
  });
});

describe('generators with custom rules', () => {
  it('honors a custom dateFormat', () => {
    for (let i = 0; i < 20; i++) {
      const v = generate(ctx('date', { kind: 'date', rules: rules({ dateFormat: 'YYYY/MM/DD' }) }));
      expect(v).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
    }
  });

  it('honors a custom datetimeFormat', () => {
    for (let i = 0; i < 20; i++) {
      const v = generate(ctx('date', { kind: 'datetime', rules: rules({ datetimeFormat: 'DD-MM-YYYY HH:mm' }) }));
      expect(v).toMatch(/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}$/);
    }
  });

  it('formats both daterange ends with the custom dateFormat', () => {
    for (let i = 0; i < 20; i++) {
      const [a, b] = generate(ctx('date', { kind: 'daterange', rules: rules({ dateFormat: 'YYYY/MM/DD' }) }))
        .split('~')
        .map((s) => s.trim());
      expect(a).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
      expect(b).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
    }
  });

  it('keeps ordinary dates on or after today by default', () => {
    const today = iso(new Date());
    const ceiling = iso(new Date(Date.now() + 366 * 86400000));
    for (let i = 0; i < 50; i++) {
      const d = generate(ctx('date', { kind: 'date' })).slice(0, 10);
      expect(d >= today).toBe(true);
      expect(d <= ceiling).toBe(true);
      const dt = generate(ctx('date', { kind: 'datetime' })).slice(0, 10);
      expect(dt >= today).toBe(true);
    }
  });

  it('keeps both daterange ends on or after today by default', () => {
    const today = iso(new Date());
    for (let i = 0; i < 30; i++) {
      const [a, b] = generate(ctx('date', { kind: 'daterange' })).split('~').map((s) => s.trim());
      expect(a >= today).toBe(true);
      expect(b >= a).toBe(true);
    }
  });

  it('allows past dates once dateFromToday is turned off', () => {
    const today = iso(new Date());
    let past = 0;
    for (let i = 0; i < 50; i++) {
      const v = generate(ctx('date', { kind: 'date', rules: rules({ dateFromToday: false }) })).slice(0, 10);
      if (v < today) past++;
    }
    expect(past).toBeGreaterThan(0);
  });

  it('ignores dateFromToday for historical labels', () => {
    const today = iso(new Date());
    for (const label of ['出生日期', '注册时间']) {
      for (let i = 0; i < 30; i++) {
        const v = generate(ctx('date', { kind: 'date', label, rules: rules({ dateFromToday: true }) })).slice(0, 10);
        expect(v < today).toBe(true);
      }
    }
  });

  it('forces the email domain when overridden', () => {
    for (let i = 0; i < 20; i++) {
      expect(GENERATORS.email(ctx('email', { rules: rules({ emailDomain: 'test.com' }) }))).toMatch(/@test\.com$/);
    }
  });

  it('takes only the domain part when the user pastes a full address', () => {
    for (let i = 0; i < 20; i++) {
      const v = GENERATORS.email(ctx('email', { rules: rules({ emailDomain: 'test@mxbc.com' }) }));
      expect(v).toMatch(/@mxbc\.com$/);
      expect(v.split('@')).toHaveLength(2);
    }
  });

  it('falls back to the built-in pool when the override is not a domain', () => {
    for (let i = 0; i < 20; i++) {
      const v = GENERATORS.email(ctx('email', { rules: rules({ emailDomain: '不是域名' }) }));
      expect(v).toMatch(/^[^@\s]+@[a-z0-9.-]+\.[a-z]{2,}$/);
    }
  });

  describe('normalizeEmailDomain', () => {
    it.each([
      ['test@mxbc.com', 'mxbc.com'],
      [' MXBC.COM ', 'mxbc.com'],
      ['@mxbc.com', 'mxbc.com'],
      ['mailto:qa@mxbc.com', 'mxbc.com'],
      ['mxbc.com/', 'mxbc.com'],
      ['mxbc.com', 'mxbc.com'],
    ])('normalizes %j to %j', (raw, want) => {
      expect(normalizeEmailDomain(raw)).toBe(want);
    });

    it.each(['', '   ', 'mxbc', 'test@mxbc', '不是域名'])('rejects %j', (raw) => {
      expect(normalizeEmailDomain(raw)).toBe('');
    });
  });

  it('forces the phone segment when overridden', () => {
    for (let i = 0; i < 20; i++) {
      const v = GENERATORS.phone(ctx('phone', { rules: rules({ phonePrefixes: '199' }) }));
      expect(v).toMatch(/^199\d{8}$/);
    }
  });

  it('forces the company suffix when overridden', () => {
    for (let i = 0; i < 20; i++) {
      expect(GENERATORS.company(ctx('company', { rules: rules({ companySuffixes: '股份公司' }) }))).toMatch(/股份公司$/);
    }
  });

  it('leaves name-like values unmarked when no marker is set', () => {
    for (let i = 0; i < 20; i++) {
      expect(GENERATORS.generic(ctx('generic'))).toMatch(/^autotest-[0-9a-z]{5}$/);
      expect(GENERATORS.company(ctx('company'))).not.toMatch(/^czy|czy$/);
    }
  });

  it('puts the marker around fallback text and company names', () => {
    for (let i = 0; i < 20; i++) {
      expect(GENERATORS.generic(ctx('generic', { rules: rules({ namePrefix: 'czy' }) }))).toMatch(/^czyautotest-[0-9a-z]{5}$/);
      expect(GENERATORS.generic(ctx('generic', { rules: rules({ nameSuffix: 'czy' }) }))).toMatch(/^autotest-[0-9a-z]{5}czy$/);
      const both = GENERATORS.generic(ctx('generic', { rules: rules({ namePrefix: 'czy-', nameSuffix: '-qa' }) }));
      expect(both).toMatch(/^czy-autotest-[0-9a-z]{5}-qa$/);
      const company = GENERATORS.company(ctx('company', { rules: rules({ namePrefix: 'czy' }) }));
      expect(company.startsWith('czy')).toBe(true);
      // 审计期望「企业名含 公司/厂/集团…」，标记不能把它挤掉。
      expect(company).toMatch(/公司|厂|集团|有限|企业|中心|合作社|事务所/);
    }
  });

  it('trims the marker but never inserts a separator of its own', () => {
    for (let i = 0; i < 20; i++) {
      expect(GENERATORS.generic(ctx('generic', { rules: rules({ namePrefix: ' czy ', nameSuffix: ' qa ' }) }))).toMatch(
        /^czyautotest-[0-9a-z]{5}qa$/,
      );
    }
  });

  it('keeps the marker off numbers and other semantics', () => {
    const marked = rules({ namePrefix: 'czy', nameSuffix: 'czy' });
    for (let i = 0; i < 20; i++) {
      expect(GENERATORS.generic(ctx('generic', { kind: 'number', rules: marked }))).toMatch(/^\d+$/);
      expect(GENERATORS.cnName(ctx('cnName', { rules: marked }))).toMatch(/^[\u4e00-\u9fa5]{2,4}$/);
      expect(GENERATORS.phone(ctx('phone', { rules: marked }))).toMatch(/^1[3-9]\d{9}$/);
      expect(GENERATORS.address(ctx('address', { rules: marked }))).not.toMatch(/^czy|czy$/);
    }
  });

  it('marks the fallback text through generate() for text-ish kinds', () => {
    for (const kind of ['text', 'textarea', 'richtext'] as const) {
      const v = generate(ctx('generic', { kind, rules: rules({ nameSuffix: '-czy' }) }));
      expect(v).toMatch(/^autotest-[0-9a-z]{5}-czy$/);
    }
  });

  it('falls back to the default date format when no rules are given', () => {
    for (let i = 0; i < 20; i++) {
      expect(generate(ctx('date', { kind: 'date' }))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
