import { describe, expect, it } from 'vitest';
import { generate, idCheckDigit, luhnCheckDigit, usccCheckDigit, type GeneratorCtx } from '../src/core/generators';
import { AREAS } from '../src/core/generators/region-data';
import { buildCatalog, defaultCatalog, pristineRule } from '../src/core/rules/catalog';
import { emptyStored } from '../src/core/rules/store';
import type { Catalog, GenSpec, StoredRules } from '../src/core/rules/types';
import { normalizeEmailDomain } from '../src/shared/rules';

const CAT = defaultCatalog();

// 规则覆盖都走「存储形状 → 目录」这条路，与生产一致，避免测试专用旁路。
const cat = (over: Partial<StoredRules> = {}): Catalog => buildCatalog({ ...emptyStored(), ...over });

const ctx = (ruleId: string, over: Partial<GeneratorCtx> = {}): GeneratorCtx => ({
  kind: 'text',
  ruleId,
  label: '',
  catalog: CAT,
  ...over,
});

const dateCat = (over: Partial<Extract<GenSpec, { type: 'date' }>>): Catalog => {
  const rule = pristineRule('date')!;
  if (rule.gen.type !== 'date') throw new Error('出厂 date 规则不是日期生成器');
  return cat({ rules: [{ ...rule, gen: { ...rule.gen, ...over } }] });
};

// 生成器默认输出 ISO，日期区间断言直接按字典序比较字符串即可。
const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

describe('builtin generators', () => {
  it('phone matches mainland mobile segments', () => {
    for (let i = 0; i < 50; i++) expect(generate(ctx('phone'))).toMatch(/^1[3-9]\d{9}$/);
  });

  it('landline is an area code plus 7-8 digits', () => {
    for (let i = 0; i < 50; i++) expect(generate(ctx('landline'))).toMatch(/^0\d{2,3}-\d{7,8}$/);
  });

  it('idNumber passes GB 11643 checksum and uses real area codes', () => {
    const codes = new Set(AREAS.map((a) => a[0]));
    for (let i = 0; i < 50; i++) {
      const v = generate(ctx('idNumber'));
      expect(v).toMatch(/^\d{17}[\dX]$/);
      expect(codes.has(v.slice(0, 6))).toBe(true);
      expect(idCheckDigit(v.slice(0, 17))).toBe(v[17]);
    }
  });

  it('creditCode passes GB 32100 checksum', () => {
    for (let i = 0; i < 50; i++) {
      const v = generate(ctx('creditCode'));
      expect(v).toMatch(/^[0-9A-HJ-NP-RTUW-Y]{18}$/);
      expect(usccCheckDigit(v.slice(0, 17))).toBe(v[17]);
    }
  });

  it('bankCard passes Luhn', () => {
    for (let i = 0; i < 50; i++) {
      const v = generate(ctx('bankCard'));
      expect(v).toMatch(/^\d{16,19}$/);
      expect(luhnCheckDigit(v.slice(0, -1))).toBe(v[v.length - 1]);
    }
  });

  it('passport matches letter prefix + 8 digits', () => {
    for (let i = 0; i < 50; i++) {
      expect(generate(ctx('passport'))).toMatch(/^(E|G|P|EA)\d{8}$/);
    }
  });

  it('zipcode is six digits', () => {
    for (let i = 0; i < 50; i++) expect(generate(ctx('zipcode'))).toMatch(/^\d{6}$/);
  });

  it('amount for capital/fund labels is whole yuan', () => {
    for (const label of ['注册资本（单位:元）', '实缴资金（单位:元）', '上年度营业额（元）']) {
      const v = generate(ctx('amount', { label }));
      expect(v).toMatch(/^\d+$/);
      expect(Number(v) % 10000).toBe(0);
    }
  });

  it('integer year-counts stay plausible while plain counts use the wide range', () => {
    for (const label of ['行业年限（年）', '实际运营时间（年）', '生产及品控管理年限（年）']) {
      for (let i = 0; i < 30; i++) {
        const v = Number(generate(ctx('integer', { label })));
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(30);
      }
    }
    for (const label of ['可供应产线（条）', '专职研发人员']) {
      const v = Number(generate(ctx('integer', { label })));
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(999);
    }
  });

  it('region path has two or three levels', () => {
    for (let i = 0; i < 30; i++) {
      const parts = generate(ctx('region')).split('/');
      expect([2, 3]).toContain(parts.length);
    }
  });

  // 直辖市与省直辖县级区划在国标数据里的市级行叫「市辖区 / 县 / 省直辖县级行政区划」，
  // 直接拿来拼名字会得到「市辖区星辰电子有限责任公司」「北京市市辖区东城区…」这种。
  it('never leaks the placeholder city level into names', () => {
    for (let i = 0; i < 300; i++) {
      const company = generate(ctx('company'));
      expect(company).not.toMatch(/市辖区|直辖县级行政区划/);
      expect(company).not.toMatch(/^县/);
      expect(generate(ctx('address'))).not.toMatch(/市辖区|直辖县级行政区划/);
      expect(generate(ctx('region'))).not.toMatch(/市辖区|直辖县级行政区划/);
    }
  });

  it('drops the placeholder level for municipalities instead of repeating the province', () => {
    const MUNICIPALITIES = ['北京市', '天津市', '上海市', '重庆市'];
    let seen = 0;
    for (let i = 0; i < 800; i++) {
      const parts = generate(ctx('region')).split('/');
      if (!MUNICIPALITIES.includes(parts[0])) continue;
      seen++;
      expect(parts).toHaveLength(2);
      expect(parts[1].length).toBeGreaterThan(0);
      expect(generate(ctx('address'))).not.toMatch(/^(北京市|天津市|上海市|重庆市)\1/);
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('paragraph stitches whole sentences from the pool', () => {
    for (let i = 0; i < 20; i++) {
      const v = generate(ctx('paragraph'));
      expect(v.length).toBeGreaterThan(10);
      expect(v).toMatch(/。$/);
    }
  });
});

describe('option-bearing kinds', () => {
  it('daterange start < end', () => {
    for (let i = 0; i < 20; i++) {
      const [a, b] = generate(ctx('date', { kind: 'daterange' })).split('~').map((s) => s.trim());
      expect(new Date(a).getTime()).toBeLessThan(new Date(b).getTime());
    }
  });

  it('enum without options returns placeholder', () => {
    expect(generate(ctx('enum', { kind: 'select-widget' }))).toBe('(填充时随机选择)');
  });

  it('checkbox and switch render a boolean string', () => {
    for (const kind of ['checkbox', 'switch'] as const) {
      for (let i = 0; i < 20; i++) expect(['true', 'false']).toContain(generate(ctx('enum', { kind })));
    }
  });

  it('checkbox-group picks one or two of the page options', () => {
    const options = ['甲', '乙', '丙'];
    for (let i = 0; i < 30; i++) {
      const parts = generate(ctx('enum', { kind: 'checkbox-group', optionTexts: options })).split('、');
      expect(parts.length).toBeGreaterThanOrEqual(1);
      expect(parts.length).toBeLessThanOrEqual(2);
      for (const p of parts) expect(options).toContain(p);
    }
  });

  it('a pool rule keeps drawing from its pool on an option control', () => {
    // 页面文案可能是「男性」而池里是「男」；对齐由填充层的模糊匹配负责，生成层不猜。
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) seen.add(generate(ctx('gender', { kind: 'radio-group', optionTexts: ['男性', '女'] })));
    expect(seen).toEqual(new Set(['男', '女']));
  });

  it('an option rule draws from the page candidates, not always the first', () => {
    const options = ['甲', '乙', '丙'];
    const seen = new Set<string>();
    for (let i = 0; i < 60; i++) seen.add(generate(ctx('enum', { kind: 'select', optionTexts: options })));
    for (const v of seen) expect(options).toContain(v);
    expect(seen.size).toBeGreaterThan(1);
  });

  it('lookup defers to the dialog record', () => {
    expect(generate(ctx('company', { kind: 'lookup', optionTexts: ['甲公司'] }))).toBe('(填充时随机选择)');
  });

  it('upload kinds describe the synthetic file rather than injecting text', () => {
    expect(generate(ctx('generic', { kind: 'upload-image' }))).toMatch(/^\[图片 test-\d{4}\.png\]$/);
    expect(generate(ctx('generic', { kind: 'upload-file' }))).toMatch(/^\[文件 test-\d{4}\.pdf\]$/);
  });
});

describe('rule overrides', () => {
  it('honors a custom dateFormat', () => {
    for (let i = 0; i < 20; i++) {
      const v = generate(ctx('date', { kind: 'date', catalog: dateCat({ dateFormat: 'YYYY/MM/DD' }) }));
      expect(v).toMatch(/^\d{4}\/\d{2}\/\d{2}$/);
    }
  });

  it('honors a custom timeFormat for datetime controls', () => {
    for (let i = 0; i < 20; i++) {
      const v = generate(ctx('date', { kind: 'datetime', catalog: dateCat({ timeFormat: 'DD-MM-YYYY HH:mm' }) }));
      expect(v).toMatch(/^\d{2}-\d{2}-\d{4} \d{2}:\d{2}$/);
    }
  });

  it('formats both daterange ends with the custom dateFormat', () => {
    for (let i = 0; i < 20; i++) {
      const [a, b] = generate(ctx('date', { kind: 'daterange', catalog: dateCat({ dateFormat: 'YYYY/MM/DD' }) }))
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

  it('allows past dates once direction is any', () => {
    const today = iso(new Date());
    let past = 0;
    for (let i = 0; i < 80; i++) {
      const v = generate(ctx('date', { kind: 'date', catalog: dateCat({ direction: 'any' }) })).slice(0, 10);
      if (v < today) past++;
    }
    expect(past).toBeGreaterThan(0);
  });

  it('ignores the direction setting for historical labels', () => {
    const today = iso(new Date());
    for (const label of ['出生日期', '注册时间']) {
      for (let i = 0; i < 30; i++) {
        const v = generate(ctx('date', { kind: 'date', label })).slice(0, 10);
        expect(v < today).toBe(true);
      }
    }
  });

  it('forces the email domain when the pool is overridden', () => {
    const c = cat({ pools: { emailDomain: ['test.example.com'] } });
    for (let i = 0; i < 20; i++) {
      expect(generate(ctx('email', { catalog: c }))).toMatch(/@test\.example\.com$/);
    }
  });

  it('forces the phone segment when the pool is overridden', () => {
    const c = cat({ pools: { phonePrefix: ['199'] } });
    for (let i = 0; i < 20; i++) expect(generate(ctx('phone', { catalog: c }))).toMatch(/^199\d{8}$/);
  });

  it('forces the company suffix when the pool is overridden', () => {
    const c = cat({ pools: { companyForm: ['股份公司'] } });
    for (let i = 0; i < 20; i++) expect(generate(ctx('company', { catalog: c }))).toMatch(/股份公司$/);
  });

  it('falls back to the builtin pool when an override is emptied', () => {
    const c = cat({ pools: { emailDomain: [] } });
    for (let i = 0; i < 20; i++) {
      expect(generate(ctx('email', { catalog: c }))).toMatch(/^[^@\s]+@[a-z0-9.-]+\.[a-z]{2,}$/);
    }
  });

  describe('normalizeEmailDomain', () => {
    it.each([
      ['qa@example.com', 'example.com'],
      [' EXAMPLE.COM ', 'example.com'],
      ['@example.com', 'example.com'],
      ['mailto:qa@example.com', 'example.com'],
      ['example.com/', 'example.com'],
      ['example.com', 'example.com'],
    ])('normalizes %j to %j', (raw, want) => {
      expect(normalizeEmailDomain(raw)).toBe(want);
    });

    it.each(['', '   ', 'example', 'qa@example', '不是域名'])('rejects %j', (raw) => {
      expect(normalizeEmailDomain(raw)).toBe('');
    });
  });
});

describe('name marks', () => {
  it('leaves name-like values unmarked when no marker is set', () => {
    for (let i = 0; i < 20; i++) {
      expect(generate(ctx('generic'))).toMatch(/^test-[0-9a-z]{5}$/);
      expect(generate(ctx('company'))).not.toMatch(/^qa|qa$/);
    }
  });

  it('puts the marker around marked rules only', () => {
    for (let i = 0; i < 20; i++) {
      expect(generate(ctx('generic', { catalog: cat({ marks: { prefix: 'qa', suffix: '' } }) }))).toMatch(
        /^qatest-[0-9a-z]{5}$/,
      );
      expect(generate(ctx('generic', { catalog: cat({ marks: { prefix: '', suffix: 'qa' } }) }))).toMatch(
        /^test-[0-9a-z]{5}qa$/,
      );
      expect(
        generate(ctx('generic', { catalog: cat({ marks: { prefix: 'qa-', suffix: '-x' } }) })),
      ).toMatch(/^qa-test-[0-9a-z]{5}-x$/);
      const company = generate(ctx('company', { catalog: cat({ marks: { prefix: 'qa', suffix: '' } }) }));
      expect(company.startsWith('qa')).toBe(true);
      // 审计期望「企业名含 公司/厂/集团…」，标记不能把它挤掉。
      expect(company).toMatch(/公司|厂|集团|有限|企业|中心|合作社|事务所/);
    }
  });

  it('trims the marker but never inserts a separator of its own', () => {
    const c = cat({ marks: { prefix: ' qa ', suffix: ' x ' } });
    for (let i = 0; i < 20; i++) expect(generate(ctx('generic', { catalog: c }))).toMatch(/^qatest-[0-9a-z]{5}x$/);
  });

  it('keeps the marker off unmarked rules', () => {
    const c = cat({ marks: { prefix: 'qa', suffix: 'qa' } });
    for (let i = 0; i < 20; i++) {
      expect(generate(ctx('cnName', { catalog: c }))).toMatch(/^[\u4e00-\u9fa5]{2,4}$/);
      expect(generate(ctx('phone', { catalog: c }))).toMatch(/^1[3-9]\d{9}$/);
      expect(generate(ctx('address', { catalog: c }))).not.toMatch(/^qa|qa$/);
    }
  });

  it('marks the fallback text through generate() for text-ish kinds', () => {
    const c = cat({ marks: { prefix: '', suffix: '-qa' } });
    for (const kind of ['text', 'textarea', 'richtext'] as const) {
      expect(generate(ctx('generic', { kind, catalog: c }))).toMatch(/^test-[0-9a-z]{5}-qa$/);
    }
  });

  it('falls back to the default date format when no rules are given', () => {
    for (let i = 0; i < 20; i++) {
      expect(generate(ctx('date', { kind: 'date' }))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
