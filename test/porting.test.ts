import { describe, expect, it } from 'vitest';
import { exportRules, importRules, parseRulesFile, summarizeImport } from '../src/core/rules/porting';
import { buildCatalog } from '../src/core/rules/catalog';
import { matchRule } from '../src/core/rules/match';
import { emptyStored } from '../src/core/rules/store';
import { generate } from '../src/core/generators';
import { RULES_VERSION, type FieldRule, type StoredRules } from '../src/core/rules/types';

const stored = (over: Partial<StoredRules> = {}): StoredRules => ({ ...emptyStored(), ...over });

const orderRule: FieldRule = {
  id: 'c-order',
  name: '订单号',
  keywords: ['订单号', 'orderNo'],
  group: 'text',
  gen: { type: 'template', template: '{n:12}' },
  builtin: false,
};

describe('导出', () => {
  it('导出的是带信封的完整快照', () => {
    const file = JSON.parse(exportRules(stored({ rules: [orderRule], marks: { prefix: 'qa-', suffix: '' } })));
    expect(file.app).toBe('FormFaker');
    expect(file.kind).toBe('rules');
    expect(file.version).toBe(RULES_VERSION);
    expect(typeof file.exportedAt).toBe('string');
    expect(file.rules).toEqual([orderRule]);
    expect(file.marks).toEqual({ prefix: 'qa-', suffix: '' });
  });

  it('没有改动时导出空快照而不是报错', () => {
    const file = JSON.parse(exportRules(emptyStored()));
    expect(file.rules).toEqual([]);
    expect(file.pools).toEqual({});
  });
});

describe('导入：文件级拒绝', () => {
  it.each<[string, string, RegExp]>([
    ['不是 JSON', '{ 坏掉的', /不是合法的 JSON/],
    ['顶层是数组', '[]', /顶层应该是一个对象/],
    ['顶层是字符串', '"x"', /顶层应该是一个对象/],
    ['别的扩展的文件', '{"app":"Other","rules":[]}', /不是 FormFaker 规则/],
    ['别的类型的文件', '{"app":"FormFaker","kind":"settings"}', /不是规则/],
    ['空壳文件', '{"app":"FormFaker","kind":"rules"}', /没有 rules \/ pools \/ marks/],
    ['更高版本', `{"version":${RULES_VERSION + 1},"rules":[]}`, /请先升级/],
  ])('%s', (_name, raw, re) => {
    expect(() => parseRulesFile(raw)).toThrow(re);
  });

  it('裸 StoredRules（没有信封）也能导', () => {
    const out = importRules(JSON.stringify({ rules: [orderRule] }), emptyStored());
    expect(out.rulesAdded).toBe(1);
  });
});

describe('导入：逐条规则的收敛', () => {
  it('坏掉的条目被跳过并带上原因，好条目照常导入', () => {
    const raw = JSON.stringify({
      rules: [
        orderRule,
        { name: '没有 id', gen: { type: 'option' } },
        { id: 'x1', gen: { type: 'option' } },
        { id: 'x2', name: '未知生成方式', gen: { type: 'magic' } },
        { id: 'x3', name: '空模板', gen: { type: 'template', template: '   ' } },
        { id: 'x4', name: '没有池', gen: { type: 'pool' } },
        { id: 'x5', name: '区间颠倒', gen: { type: 'range', min: 9, max: 1 } },
        { id: 'x6', name: '未知算法', gen: { type: 'builtin', fn: 'teleport' } },
        'not-an-object',
      ],
    });
    const out = importRules(raw, emptyStored());
    expect(out.rulesAdded).toBe(1);
    expect(out.skipped).toEqual([
      '规则「没有 id」：缺少规则 id',
      '规则「x1」：缺少规则名称',
      '规则「未知生成方式」：未知生成方式「magic」',
      '规则「空模板」：模板为空',
      '规则「没有池」：没有指定候选池',
      '规则「区间颠倒」：数值区间颠倒（9 > 1）',
      '规则「未知算法」：未知内置算法「teleport」',
      '规则「?」：不是对象',
    ]);
  });

  it('未知分组落到「文本」，mark / disabled 只在为 true 时保留', () => {
    const out = importRules(
      JSON.stringify({ rules: [{ ...orderRule, group: 'nowhere', mark: 'yes', disabled: 1 }] }),
      emptyStored(),
    );
    expect(out.stored.rules[0].group).toBe('text');
    expect(out.stored.rules[0]).not.toHaveProperty('mark');
    expect(out.stored.rules[0]).not.toHaveProperty('disabled');
    const kept = importRules(JSON.stringify({ rules: [{ ...orderRule, mark: true, disabled: true }] }), emptyStored());
    expect(kept.stored.rules[0]).toMatchObject({ mark: true, disabled: true });
  });

  it('关键词里的非字符串被剔掉，缺关键词则补空数组', () => {
    const out = importRules(JSON.stringify({ rules: [{ ...orderRule, keywords: ['a', 7, null, 'b'] }] }), emptyStored());
    expect(out.stored.rules[0].keywords).toEqual(['a', 'b']);
    const none = importRules(JSON.stringify({ rules: [orderRule] }), emptyStored());
    expect(Array.isArray(none.stored.rules[0].keywords)).toBe(true);
  });

  it('文件里自称内置也不算：同 id 走覆盖，是否内置由本地目录判定', () => {
    const out = importRules(JSON.stringify({ rules: [{ ...orderRule, id: 'phone', builtin: true }] }), emptyStored());
    expect(out.stored.rules[0].builtin).toBe(false);
    const cat = buildCatalog(out.stored);
    // id 撞上内置规则 → buildCatalog 把它当覆盖，仍占内置的位置与 builtin 标记
    expect(cat.byId.get('phone')).toMatchObject({ builtin: true, name: '订单号' });
  });

  it('数值区间的小数位被夹到 0~6，日期方向不认识就退回 future', () => {
    const out = importRules(
      JSON.stringify({
        rules: [
          { id: 'r1', name: 'r1', gen: { type: 'range', min: 0, max: 1, decimals: 99 } },
          { id: 'r2', name: 'r2', gen: { type: 'date', direction: 'sideways' } },
        ],
      }),
      emptyStored(),
    );
    expect(out.stored.rules[0].gen).toMatchObject({ decimals: 6 });
    expect(out.stored.rules[1].gen).toMatchObject({ direction: 'future', dateFormat: 'YYYY-MM-DD' });
  });
});

describe('导入：词库与数据标记', () => {
  it('空池与非数组值被丢掉，正常池留下', () => {
    const out = importRules(
      JSON.stringify({ pools: { cityTier1: ['北京', '  ', '上海'], empty: [], bad: 'nope', nums: [1, 2] } }),
      emptyStored(),
    );
    expect(out.stored.pools).toEqual({ cityTier1: ['北京', '上海'] });
    expect(out.poolsAdded).toBe(1);
  });

  it('合并模式下已有词库算覆盖', () => {
    const cur = stored({ pools: { cityTier1: ['广州'] } });
    const out = importRules(JSON.stringify({ pools: { cityTier1: ['北京'] } }), cur);
    expect(out.poolsReplaced).toBe(1);
    expect(out.poolsAdded).toBe(0);
    expect(out.stored.pools.cityTier1).toEqual(['北京']);
  });

  it('文件没写标记就不动本地标记，写了才覆盖', () => {
    const cur = stored({ marks: { prefix: 'qa-', suffix: '-x' } });
    expect(importRules(JSON.stringify({ pools: { a: ['1'] } }), cur).stored.marks).toEqual({ prefix: 'qa-', suffix: '-x' });
    expect(importRules(JSON.stringify({ marks: { prefix: 't-', suffix: '' } }), cur).stored.marks).toEqual({
      prefix: 't-',
      suffix: '',
    });
  });
});

describe('导入：合并与替换', () => {
  const cur = stored({ rules: [{ ...orderRule, id: 'keep' }], pools: { a: ['1'] } });

  it('合并保留本地已有内容，同 id 覆盖', () => {
    const out = importRules(JSON.stringify({ rules: [{ ...orderRule, id: 'keep', name: '改过' }, orderRule] }), cur);
    expect(out.rulesReplaced).toBe(1);
    expect(out.rulesAdded).toBe(1);
    expect(out.stored.rules.map((r) => r.id).sort()).toEqual(['c-order', 'keep']);
    expect(out.stored.rules.find((r) => r.id === 'keep')?.name).toBe('改过');
    expect(out.stored.pools).toEqual({ a: ['1'] });
  });

  it('替换模式清空本地内容', () => {
    const out = importRules(JSON.stringify({ rules: [orderRule] }), cur, 'replace');
    expect(out.stored.rules.map((r) => r.id)).toEqual(['c-order']);
    expect(out.stored.pools).toEqual({});
  });

  it('不改动传入的当前配置', () => {
    const before = JSON.stringify(cur);
    importRules(JSON.stringify({ rules: [orderRule], pools: { b: ['2'] } }), cur);
    expect(JSON.stringify(cur)).toBe(before);
  });
});

describe('导入后真的能用', () => {
  it('导出的文件导回来，匹配与生成结果一致', () => {
    const file = exportRules(stored({ rules: [orderRule as never], pools: { cityTier1: ['北京', '上海'] } }));
    const out = importRules(file, emptyStored());
    const cat = buildCatalog(out.stored);
    const rule = matchRule('订单号 orderNo', 'text', cat);
    expect(rule.name).toBe('订单号');
    for (let i = 0; i < 20; i++) {
      expect(generate({ kind: 'text', ruleId: rule.id, label: '订单号', catalog: cat })).toMatch(/^[A-Z0-9]{12}$/);
    }
  });

  it('导入的词库能被模板引用', () => {
    const out = importRules(
      JSON.stringify({
        rules: [{ id: 'w', name: '仓库', keywords: ['仓库'], group: 'text', gen: { type: 'template', template: '{pool:cityTier1}-A{d:3}' } }],
        pools: { cityTier1: ['北京', '上海'] },
      }),
      emptyStored(),
    );
    const cat = buildCatalog(out.stored);
    expect(generate({ kind: 'text', ruleId: 'w', label: '仓库编号', catalog: cat })).toMatch(/^(北京|上海)-A\d{3}$/);
  });

  it('停用的规则导进来仍然是停用的', () => {
    const out = importRules(JSON.stringify({ rules: [{ ...orderRule, disabled: true }] }), emptyStored());
    const cat = buildCatalog(out.stored);
    expect(matchRule('订单号', 'text', cat).id).not.toBe('c-order');
  });
});

describe('summarizeImport', () => {
  it('把各类计数拼成一句人话', () => {
    expect(summarizeImport(importRules(JSON.stringify({ rules: [orderRule] }), emptyStored()))).toBe('新增 1 条规则');
    expect(summarizeImport(importRules('{"rules":[]}', emptyStored()))).toBe('文件里没有可导入的改动');
    const mixed = importRules(JSON.stringify({ rules: [orderRule, { id: 'z' }] }), emptyStored());
    expect(summarizeImport(mixed)).toBe('新增 1 条规则，跳过 1 项');
  });
});
