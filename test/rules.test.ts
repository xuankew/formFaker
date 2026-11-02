import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCatalog, compileKeywords, defaultCatalog, keywordWeight, pristineRule } from '../src/core/rules/catalog';
import { matchRule, fallbackRuleId, OPTION_KINDS } from '../src/core/rules/match';
import {
  emptyStored,
  loadRules,
  migrateLegacy,
  parseKeywords,
  parseLines,
  parseList,
  sanitizeStored,
  saveRules,
} from '../src/core/rules/store';
import { newRuleId, summarizeGen, type FieldRule, type StoredRules } from '../src/core/rules/types';
import { generate } from '../src/core/generators';
import type { Kind } from '../src/shared/types';

const CAT = defaultCatalog();
const id = (haystack: string, kind: Kind = 'text'): string => matchRule(haystack, kind, CAT).id;

const custom = (over: Partial<FieldRule> = {}): FieldRule => ({
  id: newRuleId(),
  name: '自定义',
  keywords: [],
  group: 'text',
  gen: { type: 'template', template: 'x' },
  builtin: false,
  ...over,
});

describe('内置规则的匹配优先级', () => {
  it.each([
    ['联系电话（手机）', 'phone'],
    ['固定电话', 'landline'],
    ['传真', 'landline'],
    ['邮箱地址', 'email'],
    ['电子邮箱', 'email'],
    ['纳税人识别号', 'creditCode'],
    ['统一社会信用代码', 'creditCode'],
    ['身份证号', 'idNumber'],
    ['开户银行账号', 'bankCard'],
    ['邮政编码', 'zipcode'],
    ['公司网址', 'url'],
    ['供应商名称', 'company'],
    ['客户联系人', 'cnName'],
    ['法定代表人', 'cnName'],
    ['注册地址', 'address'],
    ['注册地区', 'region'],
    ['经纬度', 'lnglat'],
    ['坐标', 'lnglat'],
    ['性别', 'gender'],
    ['最高学历', 'education'],
    ['注册资本（单位:元）', 'amount'],
    ['员工人数', 'integer'],
    ['实际运营时间（年）', 'integer'],
    ['可供应产线（条）', 'integer'],
    ['经营范围', 'paragraph'],
    ['备注', 'paragraph'],
    ['成立日期', 'date'],
    ['受理组织', 'generic'],
  ])('%s → %s', (label, want) => {
    expect(id(label)).toBe(want);
  });

  it('护照号没有关键词，只能由证照联动选中', () => {
    expect(id('护照有效期', 'date')).toBe('date');
    expect(id('护照', 'text')).toBe('generic');
    expect(CAT.byId.get('passport')?.keywords).toEqual([]);
  });

  it('英文关键词不区分大小写，且按子串匹配 name / id', () => {
    expect(id('MOBILE')).toBe('phone');
    expect(id('userName', 'text')).toBe('cnName');
    expect(id('', 'text')).toBe('generic');
  });

  it('选项控件命中模板或段落规则时改走页面候选随机', () => {
    for (const kind of ['select', 'radio-group', 'checkbox-group', 'lookup'] as Kind[]) {
      expect(OPTION_KINDS.has(kind)).toBe(true);
      expect(id('备注', kind)).toBe('enum');
      expect(id('手机号', kind)).toBe('enum');
    }
    // 候选池规则保留：性别 / 学历要优先挑池里的值。
    expect(id('性别', 'radio-group')).toBe('gender');
  });

  it('选项控件命中内置算法时同样改走页面候选随机，级联除外', () => {
    // 真实场景：DOM 上 id="n-region-select" 让「纳税类别」这个下拉命中了地区规则，
    // 生成出来的「重庆市/綦江区」页面里根本没有这个选项。
    expect(id('纳税类别 n-region-select', 'select')).toBe('enum');
    expect(id('统一社会信用代码', 'select')).toBe('enum');
    expect(id('注册地区', 'cascader')).toBe('region');
  });

  it.each<[Kind, string]>([
    ['cascader', 'region'],
    ['textarea', 'paragraph'],
    ['richtext', 'paragraph'],
    ['number', 'amount'],
    ['date', 'date'],
    ['datetime', 'date'],
    ['daterange', 'date'],
    ['email', 'email'],
    ['url', 'url'],
    ['tel', 'landline'],
    ['select', 'enum'],
    ['switch', 'enum'],
    ['text', 'generic'],
    ['password', 'generic'],
  ])('控件 %s 的兜底规则是 %s', (kind, want) => {
    expect(fallbackRuleId(kind)).toBe(want);
    expect(matchRule('', kind, CAT).id).toBe(want);
  });

  it('关键词里的正则片段按正则解析，普通片段按字面转义', () => {
    expect(compileKeywords([])).toBeNull();
    expect(compileKeywords(['a.b'])).not.toBeNull();
    expect(compileKeywords(['a.b'])!.test('axb')).toBe(false);
    expect(compileKeywords(['a.b'])!.test('a.b')).toBe(true);
    expect(compileKeywords(['/\\blng\\b/'])!.test('lng lat')).toBe(true);
    expect(compileKeywords(['/\\blng\\b/'])!.test('belonging')).toBe(false);
  });

  it('权重取最长关键词，正则按原文长度算', () => {
    expect(keywordWeight(custom({ keywords: ['手机', '联系电话（手机）'] }))).toBe('联系电话（手机）'.length);
    expect(keywordWeight(custom({ keywords: [] }))).toBe(0);
  });
});

describe('用户规则与内置规则同表', () => {
  it('自定义规则整体优先于内置，同层内关键词越长越先匹配', () => {
    const stored: StoredRules = {
      ...emptyStored(),
      rules: [
        custom({ id: 'short', name: '订单', keywords: ['订单'], gen: { type: 'template', template: 'S' } }),
        custom({ id: 'long', name: '订单号', keywords: ['订单号'], gen: { type: 'template', template: 'L' } }),
      ],
    };
    const cat = buildCatalog(stored);
    expect(cat.rules[0].id).toBe('long');
    expect(matchRule('订单号', 'text', cat).id).toBe('long');
    expect(matchRule('订单日期', 'text', cat).id).toBe('short');
    expect(cat.rules.filter((r) => r.builtin).length).toBeGreaterThan(0);
  });

  it('用户举的订单号例子：12 位大写字母加数字', () => {
    const cat = buildCatalog({
      ...emptyStored(),
      rules: [custom({ id: 'orderNo', name: '订单号', keywords: ['订单号'], gen: { type: 'template', template: '{n:12}' } })],
    });
    const rule = matchRule('订单号', 'text', cat);
    expect(rule.name).toBe('订单号');
    expect(rule.builtin).toBe(false);
    for (let i = 0; i < 30; i++) {
      expect(generate({ kind: 'text', ruleId: rule.id, label: '订单号', catalog: cat })).toMatch(/^[A-Z0-9]{12}$/);
    }
  });

  it('同 id 的存储规则替换内置规则，并保持内置的优先级位置', () => {
    const before = CAT.rules.findIndex((r) => r.id === 'phone');
    const cat = buildCatalog({
      ...emptyStored(),
      rules: [{ ...pristineRule('phone')!, keywords: ['手机', '移动电话'], gen: { type: 'template', template: '199{d:8}' } }],
    });
    const after = cat.rules.findIndex((r) => r.id === 'phone');
    expect(after).toBe(before);
    expect(cat.byId.get('phone')!.builtin).toBe(true);
    expect(cat.rules.filter((r) => !r.builtin)).toHaveLength(0);
    for (let i = 0; i < 20; i++) {
      expect(generate({ kind: 'text', ruleId: 'phone', label: '手机号', catalog: cat })).toMatch(/^199\d{8}$/);
    }
  });

  it('停用的规则不参与匹配，落到下一条或控件兜底', () => {
    const cat = buildCatalog({
      ...emptyStored(),
      rules: [{ ...pristineRule('phone')!, disabled: true }],
    });
    expect(cat.byId.get('phone')!.disabled).toBe(true);
    expect(cat.matchOrder.some((r) => r.id === 'phone')).toBe(false);
    // 「手机号码」不再命中 phone；landline 的关键词里没有「手机」，于是落到控件兜底。
    expect(matchRule('手机号码', 'text', cat).id).toBe('generic');
  });

  it('停用兜底规则时仍能返回一条可用规则', () => {
    const cat = buildCatalog({
      ...emptyStored(),
      rules: [
        { ...pristineRule('generic')!, disabled: true },
        { ...pristineRule('paragraph')!, disabled: true },
      ],
    });
    expect(matchRule('无关标签', 'text', cat)).toBeTruthy();
    expect(matchRule('备注', 'textarea', cat).id).toBe('generic');
  });

  it('词库覆盖生效，清空即撤销覆盖', () => {
    expect(buildCatalog({ ...emptyStored(), pools: { emailDomain: ['a.example'] } }).pools.emailDomain).toEqual(['a.example']);
    expect(buildCatalog({ ...emptyStored(), pools: { emailDomain: [] } }).pools.emailDomain).toEqual(CAT.pools.emailDomain);
    expect(buildCatalog({ ...emptyStored(), pools: { myOwn: ['甲'] } }).pools.myOwn).toEqual(['甲']);
  });

  it('数据标记原样透传', () => {
    const cat = buildCatalog({ ...emptyStored(), marks: { prefix: 'qa-', suffix: '' } });
    expect(cat.marks).toEqual({ prefix: 'qa-', suffix: '' });
    expect(buildCatalog(null).marks).toEqual({ prefix: '', suffix: '' });
  });

  it('pristineRule 返回的是副本，改它不会污染出厂目录', () => {
    const copy = pristineRule('phone')!;
    copy.keywords.push('被改过');
    expect(CAT.byId.get('phone')!.keywords).not.toContain('被改过');
    expect(pristineRule('不存在的规则')).toBeUndefined();
  });

  it('defaultCatalog 复用同一份实例', () => {
    expect(defaultCatalog()).toBe(CAT);
  });
});

describe('规则摘要文案', () => {
  it('每种生成器都给出一句人话', () => {
    const pools = CAT.pools;
    expect(summarizeGen({ type: 'template', template: '{n:12}' }, pools)).toBe('{n:12}');
    expect(summarizeGen({ type: 'template', template: '' }, pools)).toBe('(空模板)');
    expect(summarizeGen({ type: 'pool', pool: 'gender' }, pools)).toContain('候选池随机');
    expect(summarizeGen({ type: 'pool', pool: 'gender' }, pools)).toContain('男 / 女');
    expect(summarizeGen({ type: 'pool', pool: '不存在' }, pools)).toContain('0 项');
    expect(summarizeGen({ type: 'range', min: 1, max: 9, decimals: 0 }, pools)).toBe('1 ~ 9');
    expect(summarizeGen({ type: 'range', min: 1, max: 9, decimals: 2 }, pools)).toContain('保留 2 位小数');
    expect(summarizeGen({ type: 'option' }, pools)).toBe('从页面候选项随机');
    expect(summarizeGen({ type: 'builtin', fn: 'idNumber' }, pools)).toContain('GB 11643');
    expect(
      summarizeGen({ type: 'date', dateFormat: 'YYYY-MM-DD', timeFormat: 'YYYY-MM-DD HH:mm:ss', direction: 'future', spanMinDays: 30, spanMaxDays: 1000 }, pools),
    ).toContain('今天及以后');
    expect(
      summarizeGen({ type: 'date', dateFormat: 'YYYY', timeFormat: 'YYYY', direction: 'past', spanMinDays: 1, spanMaxDays: 2 }, pools),
    ).toContain('今天以前');
    expect(
      summarizeGen({ type: 'date', dateFormat: 'YYYY', timeFormat: 'YYYY', direction: 'any', spanMinDays: 1, spanMaxDays: 2 }, pools),
    ).toContain('不限方向');
  });
});

describe('存储与旧设置迁移', () => {
  it('parseList 按逗号与空白切分', () => {
    expect(parseList('138, 199，177  155')).toEqual(['138', '199', '177', '155']);
    expect(parseList('')).toEqual([]);
    expect(parseList(undefined as unknown as string)).toEqual([]);
  });

  it('parseKeywords 不按空白切，否则正则关键词会被拆碎', () => {
    expect(parseKeywords('订单号、orderNo, 订单编号')).toEqual(['订单号', 'orderNo', '订单编号']);
    expect(parseKeywords('/bank\\s*card/、/account\\s*no/')).toEqual(['/bank\\s*card/', '/account\\s*no/']);
    expect(parseKeywords('  、、 ')).toEqual([]);
  });

  it('parseLines 只按行切，整句词库才不会被空格拆散', () => {
    expect(parseLines('已通过 ISO9001 认证\n\n  成立于二〇一〇年  \n')).toEqual([
      '已通过 ISO9001 认证',
      '成立于二〇一〇年',
    ]);
    expect(parseLines('')).toEqual([]);
  });

  it('没有旧设置时迁移出空存储', () => {
    expect(migrateLegacy(null)).toEqual(emptyStored());
    expect(migrateLegacy(undefined)).toEqual(emptyStored());
  });

  it('旧的七项设置分别落到词库、日期规则与数据标记', () => {
    const out = migrateLegacy({
      dateFormat: 'YYYY/MM/DD',
      datetimeFormat: 'YYYY/MM/DD HH:mm',
      dateFromToday: false,
      emailDomain: 'qa@example.com',
      phonePrefixes: '199',
      companySuffixes: '股份公司',
      namePrefix: 'qa-',
      nameSuffix: '-x',
    });
    expect(out.marks).toEqual({ prefix: 'qa-', suffix: '-x' });
    expect(out.pools.emailDomain).toEqual(['example.com']);
    expect(out.pools.phonePrefix).toEqual(['199']);
    expect(out.pools.companyForm).toEqual(['股份公司']);
    expect(out.rules).toHaveLength(1);
    expect(out.rules[0].id).toBe('date');
    expect(out.rules[0].builtin).toBe(true);
    const gen = out.rules[0].gen;
    expect(gen).toMatchObject({ type: 'date', dateFormat: 'YYYY/MM/DD', timeFormat: 'YYYY/MM/DD HH:mm', direction: 'any' });
    // 只覆盖改动过的部分，其余保持出厂值。
    const pristineGen = pristineRule('date')!.gen;
    if (gen.type === 'date' && pristineGen.type === 'date') {
      expect(gen.spanMinDays).toBe(pristineGen.spanMinDays);
      expect(gen.spanMaxDays).toBe(pristineGen.spanMaxDays);
    } else {
      throw new Error('date 规则不是日期生成器');
    }
  });

  it('旧设置与出厂一致时不生成 date 覆盖', () => {
    const out = migrateLegacy({ dateFormat: 'YYYY-MM-DD', datetimeFormat: 'YYYY-MM-DD HH:mm:ss', dateFromToday: true });
    expect(out.rules).toEqual([]);
  });

  it('旧邮箱域名填了整段垃圾就丢弃，回退内置池', () => {
    expect(migrateLegacy({ emailDomain: '不是域名' }).pools.emailDomain).toBeUndefined();
    expect(migrateLegacy({ emailDomain: '  ' }).pools.emailDomain).toBeUndefined();
  });

  it('sanitizeStored 把手改坏的数据补回形状', () => {
    expect(sanitizeStored(null)).toEqual(emptyStored());
    expect(sanitizeStored('字符串')).toEqual(emptyStored());
    const fixed = sanitizeStored({
      version: 'x',
      rules: [null, { id: 'a' }, { id: 'b', keywords: [], gen: { type: 'option' } }],
      pools: null,
      marks: { prefix: 'qa' },
    });
    expect(fixed.version).toBe(1);
    expect(fixed.rules).toHaveLength(1);
    expect(fixed.rules[0].id).toBe('b');
    expect(fixed.pools).toEqual({});
    expect(fixed.marks).toEqual({ prefix: 'qa', suffix: '' });
  });

  describe('loadRules / saveRules', () => {
    let areas: { local: Record<string, unknown>; sync: Record<string, unknown> };

    beforeEach(() => {
      areas = { local: {}, sync: {} };
      const area = (store: Record<string, unknown>) => ({
        get: vi.fn(async (keys: string | string[]) => {
          const list = Array.isArray(keys) ? keys : [keys];
          return Object.fromEntries(list.filter((k) => k in store).map((k) => [k, store[k]]));
        }),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          Object.assign(store, obj);
        }),
      });
      (globalThis as Record<string, unknown>).chrome = {
        storage: { local: area(areas.local), sync: area(areas.sync) },
      };
    });

    it('首次运行迁移旧设置，写入本地并摘掉 sync 里的 rules', async () => {
      areas.sync['ff.settings'] = { overwrite: true, rules: { namePrefix: 'qa', emailDomain: 'example.com' } };
      const out = await loadRules();
      expect(out.marks.prefix).toBe('qa');
      expect(out.pools.emailDomain).toEqual(['example.com']);
      expect(areas.local['ff.rules']).toBeTruthy();
      expect(areas.sync['ff.settings']).toEqual({ overwrite: true });
    });

    it('已有本地规则时直接读取，不再碰 sync', async () => {
      areas.sync['ff.settings'] = { rules: { namePrefix: '不该被读到' } };
      const stored: StoredRules = { ...emptyStored(), marks: { prefix: 'local', suffix: '' } };
      areas.local['ff.rules'] = stored;
      const out = await loadRules();
      expect(out.marks.prefix).toBe('local');
      expect(areas.sync['ff.settings']).toEqual({ rules: { namePrefix: '不该被读到' } });
    });

    it('两处都没有时返回空存储且不写盘', async () => {
      const out = await loadRules();
      expect(out).toEqual(emptyStored());
      expect(areas.local).toEqual({});
    });

    it('saveRules 落盘前先过一遍形状', async () => {
      await saveRules({ ...emptyStored(), marks: { prefix: 'qa', suffix: '' } } as StoredRules);
      expect((areas.local['ff.rules'] as StoredRules).marks.prefix).toBe('qa');
      await saveRules({ version: 1, rules: [], pools: {}, marks: undefined } as unknown as StoredRules);
      expect((areas.local['ff.rules'] as StoredRules).marks).toEqual({ prefix: '', suffix: '' });
    });
  });
});
