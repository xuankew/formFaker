import { useEffect, useMemo, useRef, useState } from 'react';
import { generate } from '../core/generators';
import { BUILTIN_POOLS, buildCatalog } from '../core/rules/catalog';
import { DSL_GROUPS, validateTemplate } from '../core/rules/dsl';
import { exportRules, importRules, summarizeImport, type ImportMode } from '../core/rules/porting';
import { emptyStored, loadRules, parseKeywords, parseLines, saveRules } from '../core/rules/store';
import {
  BUILTIN_FN_LABELS,
  GEN_TYPE_LABELS,
  GROUP_LABELS,
  GROUP_ORDER,
  newRuleId,
  summarizeGen,
  type BuiltinFn,
  type DateDirection,
  type FieldRule,
  type GenSpec,
  type RuleGroup,
  type StoredRules,
} from '../core/rules/types';
import './settings.css';

const GEN_TYPES = Object.keys(GEN_TYPE_LABELS) as GenSpec['type'][];
const BUILTIN_FNS = Object.keys(BUILTIN_FN_LABELS) as BuiltinFn[];
const DIRECTIONS: { value: DateDirection; label: string }[] = [
  { value: 'future', label: '今天及以后' },
  { value: 'past', label: '今天以前' },
  { value: 'any', label: '不限方向' },
];

function blankRule(): FieldRule {
  return { id: newRuleId(), name: '', keywords: [], group: 'text', gen: { type: 'template', template: '' }, builtin: false };
}

// 逐项比编辑区里能改的字段；直接比整个对象不行，键顺序会随展开写法变化。
function sameRule(a: FieldRule, b: FieldRule): boolean {
  return (
    a.name === b.name &&
    a.group === b.group &&
    a.keywords.join('\u0001') === b.keywords.join('\u0001') &&
    JSON.stringify(a.gen) === JSON.stringify(b.gen) &&
    !!a.mark === !!b.mark &&
    !!a.disabled === !!b.disabled
  );
}

function defaultGen(type: GenSpec['type']): GenSpec {
  switch (type) {
    case 'template':
      return { type: 'template', template: '' };
    case 'pool':
      return { type: 'pool', pool: BUILTIN_POOLS[0].id };
    case 'range':
      return { type: 'range', min: 1, max: 100, decimals: 0 };
    case 'date':
      return {
        type: 'date',
        dateFormat: 'YYYY-MM-DD',
        timeFormat: 'YYYY-MM-DD HH:mm:ss',
        direction: 'future',
        spanMinDays: 30,
        spanMaxDays: 1000,
      };
    case 'builtin':
      return { type: 'builtin', fn: 'integer' };
    case 'option':
      return { type: 'option' };
  }
}

// 生成方式的参数区。判别后 gen 已收窄，逐支展开比写一个泛型 patch 好读也好改。
function GenParams({
  gen,
  pools,
  onChange,
}: {
  gen: GenSpec;
  pools: Record<string, string[]>;
  onChange: (g: GenSpec) => void;
}) {
  const poolIds = Object.keys(pools);
  switch (gen.type) {
    case 'template':
      return (
        <>
          <label className="field">
            <span>模板</span>
            <textarea
              rows={2}
              value={gen.template}
              placeholder="如 {n:12}，或 DD{now:YYYYMMDD}{d:4}"
              onChange={(e) => onChange({ ...gen, template: e.target.value })}
            />
          </label>
          <div className="dsl">
            {DSL_GROUPS.map((g) => (
              <div className="drow" key={g.label}>
                <span className="dlabel">{g.label}</span>
                <span className="dtokens">
                  {g.items.map((it) => (
                    <span className="ditem" key={it.token}>
                      <code>{it.token}</code>
                      {it.desc}
                    </span>
                  ))}
                </span>
              </div>
            ))}
          </div>
          <label className="field">
            <span>
              自定义字符集<span className="hint">只有 {'{s}'} 会用到</span>
            </span>
            <input
              type="text"
              value={gen.charset ?? ''}
              placeholder="如 ABC123"
              onChange={(e) => onChange({ ...gen, charset: e.target.value })}
            />
          </label>
        </>
      );
    case 'pool':
      return (
        <label className="field">
          <span>候选池</span>
          <select value={gen.pool} onChange={(e) => onChange({ ...gen, pool: e.target.value })}>
            {!poolIds.includes(gen.pool) && <option value={gen.pool}>{gen.pool}（词库不存在）</option>}
            {poolIds.map((id) => (
              <option key={id} value={id}>
                {BUILTIN_POOLS.find((p) => p.id === id)?.name ?? id} · {id}
              </option>
            ))}
          </select>
        </label>
      );
    case 'range':
      return (
        <div className="grid3">
          <label className="field">
            <span>最小值</span>
            <input type="number" value={gen.min} onChange={(e) => onChange({ ...gen, min: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>最大值</span>
            <input type="number" value={gen.max} onChange={(e) => onChange({ ...gen, max: Number(e.target.value) })} />
          </label>
          <label className="field">
            <span>小数位</span>
            <input
              type="number"
              min={0}
              max={6}
              value={gen.decimals}
              onChange={(e) => onChange({ ...gen, decimals: Number(e.target.value) })}
            />
          </label>
        </div>
      );
    case 'date':
      return (
        <>
          <div className="grid2">
            <label className="field">
              <span>日期格式</span>
              <input type="text" value={gen.dateFormat} onChange={(e) => onChange({ ...gen, dateFormat: e.target.value })} />
            </label>
            <label className="field">
              <span>日期时间格式</span>
              <input type="text" value={gen.timeFormat} onChange={(e) => onChange({ ...gen, timeFormat: e.target.value })} />
            </label>
          </div>
          <label className="field">
            <span>方向</span>
            <select value={gen.direction} onChange={(e) => onChange({ ...gen, direction: e.target.value as DateDirection })}>
              {DIRECTIONS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <div className="grid2">
            <label className="field">
              <span>跨度下限（天）</span>
              <input type="number" value={gen.spanMinDays} onChange={(e) => onChange({ ...gen, spanMinDays: Number(e.target.value) })} />
            </label>
            <label className="field">
              <span>跨度上限（天）</span>
              <input type="number" value={gen.spanMaxDays} onChange={(e) => onChange({ ...gen, spanMaxDays: Number(e.target.value) })} />
            </label>
          </div>
        </>
      );
    case 'builtin':
      return (
        <label className="field">
          <span>内置算法</span>
          <select value={gen.fn} onChange={(e) => onChange({ ...gen, fn: e.target.value as BuiltinFn })}>
            {BUILTIN_FNS.map((fn) => (
              <option key={fn} value={fn}>
                {fn} — {BUILTIN_FN_LABELS[fn]}
              </option>
            ))}
          </select>
        </label>
      );
    case 'option':
      return <p className="lead">从页面已有候选项里随机挑，无需参数。</p>;
  }
}

export default function RulesPanel() {
  const [stored, setStored] = useState<StoredRules>(emptyStored);
  const [tab, setTab] = useState<'rules' | 'pools'>('rules');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [folded, setFolded] = useState<RuleGroup[]>([...GROUP_ORDER]);
  const [newPoolId, setNewPoolId] = useState('');
  const [notice, setNotice] = useState('');
  const [skipped, setSkipped] = useState<string[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  // 合并与替换共用一个文件选择框，选中文件时才知道该按哪种模式导。
  const importModeRef = useRef<ImportMode>('merge');

  // 失焦自动保存读的是事件回调里的闭包，而输入引发的重渲染可能还没发生；
  // 用 ref 兜住最新草稿，否则会把改之前的值又存一遍。
  const [draft, setDraftState] = useState<FieldRule | null>(null);
  const draftRef = useRef<FieldRule | null>(null);
  const setDraft = (d: FieldRule | null) => {
    draftRef.current = d;
    setDraftState(d);
  };
  // 词库编辑：新建的词库还没有落盘记录，只能挂在这张卡片里编辑，故用 isNew 区分渲染位置。
  const [poolEdit, setPoolEditState] = useState<{ id: string; text: string; isNew: boolean } | null>(null);
  const poolEditRef = useRef<{ id: string; text: string; isNew: boolean } | null>(null);
  const setPoolEdit = (p: { id: string; text: string; isNew: boolean } | null) => {
    poolEditRef.current = p;
    setPoolEditState(p);
  };

  useEffect(() => {
    loadRules().then(setStored);
  }, []);

  const catalog = useMemo(() => buildCatalog(stored), [stored]);
  const overridden = useMemo(() => new Set(stored.rules.map((r) => r.id)), [stored]);

  const commit = (next: StoredRules) => {
    setStored(next);
    void saveRules(next);
  };

  // 内置规则的出厂态就是「没有覆盖记录」，所以恢复默认与删除自定义规则是同一步。
  const dropRule = (id: string) => {
    commit({ ...stored, rules: stored.rules.filter((r) => r.id !== id) });
    if (draftRef.current?.id === id) setDraft(null);
  };

  const toggleDisabled = (rule: FieldRule) => {
    commit({ ...stored, rules: [...stored.rules.filter((r) => r.id !== rule.id), { ...rule, disabled: !rule.disabled }] });
  };

  const check = (rule: FieldRule): string => {
    if (!rule.name.trim()) return '规则名称不能为空';
    const gen = rule.gen;
    if (gen.type === 'template') {
      if (!gen.template.trim()) return '模板不能为空';
      return validateTemplate(gen.template, { pools: catalog.pools, charset: gen.charset }) ?? '';
    }
    if (gen.type === 'pool' && !catalog.pools[gen.pool]?.length) return `词库「${gen.pool}」不存在或为空`;
    if (gen.type === 'range' && gen.min > gen.max) return '最小值不能大于最大值';
    return '';
  };

  const writeDraft = (): boolean => {
    const cur = draftRef.current;
    if (!cur) return false;
    const e = check(cur);
    setError(e);
    if (e) return false;
    // 只是点开看一眼、什么都没改就失焦，不该给内置规则留下一条「已改」覆盖记录。
    const orig = catalog.rules.find((r) => r.id === cur.id);
    if (orig && sameRule(orig, cur)) {
      setError('');
      return true;
    }
    commit({ ...stored, rules: [...stored.rules.filter((r) => r.id !== cur.id), cur] });
    return true;
  };

  // 失焦即落盘；语法不合法时留在草稿态并把原因写出来，避免存进一条只会输出模板原文的规则。
  const onBlurEditor = () => {
    if (draftRef.current) writeDraft();
  };

  const applyAndClose = () => {
    if (writeDraft()) {
      setDraft(null);
      setError('');
    }
  };

  const samples = (rule: FieldRule): string[] => {
    const cat = buildCatalog({ ...stored, rules: [...stored.rules.filter((r) => r.id !== rule.id), rule] });
    return [0, 1, 2].map(() => generate({ kind: 'text', ruleId: rule.id, label: rule.name, catalog: cat }));
  };

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hit = (r: FieldRule) =>
      !q ||
      r.name.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q) ||
      r.keywords.some((k) => k.toLowerCase().includes(q));
    const out = new Map<RuleGroup, FieldRule[]>(GROUP_ORDER.map((g) => [g, []]));
    for (const r of catalog.rules.filter(hit)) (out.get(r.group) ?? out.get('text')!).push(r);
    return out;
  }, [catalog, query]);

  const shown = GROUP_ORDER.reduce((n, g) => n + (groups.get(g)?.length ?? 0), 0);
  // 搜索时强制展开，否则命中的规则会被折叠在标题下面，看起来像没搜到。
  const searching = query.trim().length > 0;

  const poolRows = useMemo(() => {
    const customs = Object.keys(stored.pools)
      .filter((id) => stored.pools[id]?.length && !BUILTIN_POOLS.some((p) => p.id === id))
      .map((id) => ({ id, name: id, builtin: false, values: stored.pools[id], changed: true }));
    const builtins = BUILTIN_POOLS.map((p) => {
      const over = stored.pools[p.id];
      return { id: p.id, name: p.name, builtin: true, values: over?.length ? over : p.values, changed: !!over?.length };
    });
    return [...customs, ...builtins];
  }, [stored]);

  const commitPool = (id: string, values: string[]) => {
    const pools = { ...stored.pools };
    // 空词库会让 {pool:x} 渲染成令牌原文，等同于撤销覆盖 / 删掉自定义词库。
    if (values.length) pools[id] = values;
    else delete pools[id];
    commit({ ...stored, pools });
    setPoolEdit(null);
  };

  // 同 draftRef：失焦回调里读 ref 才拿得到刚输入的内容。
  const flushPoolEdit = (id: string) => {
    const cur = poolEditRef.current;
    if (cur && cur.id === id) commitPool(id, parseLines(cur.text));
  };

  const doExport = () => {
    const url = URL.createObjectURL(new Blob([exportRules(stored)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `formfaker-rules-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    // 立刻 revoke 会让部分浏览器来不及取走 blob，留一秒。
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice('已导出 JSON 文件');
    setSkipped([]);
  };

  const pickImport = (mode: ImportMode) => {
    if (
      mode === 'replace' &&
      !window.confirm('替换导入会先清空本地所有规则与词库改动，再写入文件内容。确定继续？')
    ) {
      return;
    }
    importModeRef.current = mode;
    fileRef.current?.click();
  };

  const onPickFile = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    try {
      const report = importRules(await file.text(), stored, importModeRef.current);
      commit(report.stored);
      setDraft(null);
      setNotice(`已导入：${summarizeImport(report)}`);
      setSkipped(report.skipped);
    } catch (e) {
      setNotice(`导入失败：${e instanceof Error ? e.message : String(e)}`);
      setSkipped([]);
    }
  };

  const editor = draft && (
    <section className="card editor" onBlur={onBlurEditor}>
      <h3>
        {draft.builtin ? '编辑内置规则' : '编辑自定义规则'}
        <span className="sub">{draft.id}</span>
      </h3>
      <label className="field">
        <span>规则名称</span>
        <input type="text" value={draft.name} placeholder="如 订单号" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
      </label>
      <label className="field">
        <span>
          匹配关键词<span className="hint">逗号 / 顿号分隔；写成 /…/ 按正则匹配</span>
        </span>
        <input
          type="text"
          value={draft.keywords.join('、')}
          placeholder="如 订单号、orderNo"
          onChange={(e) => setDraft({ ...draft, keywords: parseKeywords(e.target.value) })}
        />
      </label>
      <div className="grid2">
        <label className="field">
          <span>分组</span>
          <select value={draft.group} onChange={(e) => setDraft({ ...draft, group: e.target.value as RuleGroup })}>
            {GROUP_ORDER.map((g) => (
              <option key={g} value={g}>
                {GROUP_LABELS[g]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>生成方式</span>
          <select
            value={draft.gen.type}
            onChange={(e) => setDraft({ ...draft, gen: defaultGen(e.target.value as GenSpec['type']) })}
          >
            {GEN_TYPES.map((t) => (
              <option key={t} value={t}>
                {GEN_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <GenParams gen={draft.gen} pools={catalog.pools} onChange={(g) => setDraft({ ...draft, gen: g })} />
      {draft.gen.type !== 'option' && (
        <label className="rowline">
          <input type="checkbox" checked={!!draft.mark} onChange={(e) => setDraft({ ...draft, mark: e.target.checked })} />
          贴数据标记
          <span className="hint">
            {catalog.marks.prefix.trim() || catalog.marks.suffix.trim()
              ? '把设置页「数据标记」的前后缀加到值两端'
              : '设置页还没填前后缀，勾了也不会变'}
          </span>
        </label>
      )}
      <div className="preview">
        <span className="k">示例</span>
        {samples(draft).map((s, i) => (
          <code key={i}>{s || '(空)'}</code>
        ))}
      </div>
      {error && <div className="bad">{error}</div>}
      <div className="rowline">
        <button className="primary" onClick={applyAndClose}>
          完成
        </button>
        <button
          className="ghost"
          onClick={() => {
            setDraft(null);
            setError('');
          }}
        >
          放弃改动
        </button>
      </div>
    </section>
  );

  return (
    <div className="ff-settings ff-rules">
      <div className="tabs">
        <button className={tab === 'rules' ? 'on' : ''} onClick={() => setTab('rules')}>
          字段规则
        </button>
        <button className={tab === 'pools' ? 'on' : ''} onClick={() => setTab('pools')}>
          词库
        </button>
      </div>

      <section className="card">
        <div className="rowline">
          <span className="portlabel">规则文件</span>
          <span className="spacer" />
          <button className="ghost" onClick={doExport} title="把规则改动、词库与数据标记导出成一个 JSON 文件">
            导出
          </button>
          <button className="ghost" onClick={() => pickImport('merge')} title="保留本地规则，文件里同 id 的覆盖过来">
            导入合并
          </button>
          <button className="ghost danger" onClick={() => pickImport('replace')} title="先清空本地规则与词库改动，再写入文件内容">
            导入替换
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              void onPickFile(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
        {notice && <div className={notice.startsWith('导入失败') ? 'bad' : 'ok'}>{notice}</div>}
        {skipped.length > 0 && (
          <ul className="skipped">
            {skipped.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        )}
      </section>

      {tab === 'rules' && (
        <>
          <section className="card">
            <div className="rowline">
              <input
                type="text"
                className="search"
                value={query}
                placeholder="搜规则名 / 关键词"
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                className="primary"
                onClick={() => {
                  setDraft(blankRule());
                  setError('');
                }}
              >
                新建规则
              </button>
            </div>
            <p className="lead">自定义规则整体优先于内置；同层里关键词越长越先匹配，命中的规则名会显示在弹窗标签上。点分组标题展开，搜索时自动展开命中分组。</p>
          </section>

          {editor}

          {GROUP_ORDER.map((g) => {
            const list = groups.get(g) ?? [];
            if (!list.length) return null;
            const isFolded = !searching && folded.includes(g);
            return (
              <section className="card" key={g}>
                <h3
                  className="grouphead"
                  aria-expanded={!isFolded}
                  onClick={() => {
                    if (searching) return;
                    setFolded(isFolded ? folded.filter((x) => x !== g) : [...folded, g]);
                  }}
                >
                  <span className="caret">{isFolded ? '▸' : '▾'}</span>
                  {GROUP_LABELS[g]}
                  <span className="sub">{list.length}</span>
                </h3>
                {!isFolded && (
                  <ul className="rules">
                    {list.map((r) => (
                      <li key={r.id} className={r.disabled ? 'off' : ''}>
                        <div className="rline">
                          <input
                            type="checkbox"
                            checked={!r.disabled}
                            title={r.disabled ? '已停用：匹配时跳过这条规则' : '启用中'}
                            onChange={() => toggleDisabled(r)}
                          />
                          <span className="rname">{r.name || '(未命名)'}</span>
                          {r.builtin ? (
                            overridden.has(r.id) ? (
                              <span className="tag changed">已改</span>
                            ) : (
                              <span className="tag">内置</span>
                            )
                          ) : (
                            <span className="tag custom">自定义</span>
                          )}
                          {r.mark && (
                            <span className="tag marked" title="生成的值两端会加数据标记">
                              带标记
                            </span>
                          )}
                          <span className="spacer" />
                          <button
                            className="ghost"
                            onClick={() => {
                              setDraft({ ...r });
                              setError('');
                            }}
                          >
                            编辑
                          </button>
                          {overridden.has(r.id) && (
                            <button
                              className="danger-ghost"
                              title={r.builtin ? '丢弃改动，恢复成出厂规则' : '删除这条自定义规则'}
                              onClick={() => dropRule(r.id)}
                            >
                              {r.builtin ? '恢复默认' : '删除'}
                            </button>
                          )}
                        </div>
                        <div className="rmeta">
                          <span className="kw">{r.keywords.length ? r.keywords.join('、') : '（无关键词，只作为控件类型兜底）'}</span>
                          <span className="gen">→ {summarizeGen(r.gen, catalog.pools)}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}

          {!shown && <p className="foot">没有符合搜索条件的规则。</p>}
        </>
      )}

      {tab === 'pools' && (
        <>
          <section className="card">
            <h3>
              新建词库<span className="sub">供模板里的 {'{pool:词库id}'} 引用</span>
            </h3>
            <div className="rowline">
              <input
                type="text"
                className="search"
                placeholder="词库 id，用英文，如 cityTier1"
                value={newPoolId}
                onChange={(e) => setNewPoolId(e.target.value.trim())}
              />
              <button
                className="primary"
                disabled={!newPoolId}
                onClick={() => setPoolEdit({ id: newPoolId, text: '', isNew: true })}
              >
                创建
              </button>
            </div>
            {poolEdit?.isNew && (
              <div className="pooledit" onBlur={() => flushPoolEdit(poolEdit.id)}>
                <textarea
                  rows={5}
                  autoFocus
                  placeholder={'一行一项，如：\n北京\n上海\n广州'}
                  value={poolEdit.text}
                  onChange={(e) => setPoolEdit({ ...poolEdit, text: e.target.value })}
                />
                <p className="lead">点外面即保存；留空则不创建。</p>
              </div>
            )}
          </section>

          {poolRows.map((p) => (
            <section className="card" key={p.id}>
              <h3>
                {p.name}
                <span className="sub">
                  {p.id} · {p.values.length} 项
                </span>
                {p.changed && <span className="tag changed">{p.builtin ? '已改' : '自定义'}</span>}
                <span className="spacer" />
                <button className="ghost" onClick={() => setPoolEdit({ id: p.id, text: p.values.join('\n'), isNew: false })}>
                  编辑
                </button>
                {p.changed && (
                  <button
                    className="danger-ghost"
                    title={p.builtin ? '丢弃改动，恢复成出厂词库' : '删除这个自定义词库'}
                    onClick={() => commitPool(p.id, [])}
                  >
                    {p.builtin ? '恢复默认' : '删除'}
                  </button>
                )}
              </h3>
              <p className="sample">
                {p.values.slice(0, 8).join(' / ')}
                {p.values.length > 8 ? ' …' : ''}
              </p>
              {poolEdit && !poolEdit.isNew && poolEdit.id === p.id && (
                <div className="pooledit" onBlur={() => flushPoolEdit(p.id)}>
                  <textarea rows={6} autoFocus value={poolEdit.text} onChange={(e) => setPoolEdit({ ...poolEdit, text: e.target.value })} />
                  <p className="lead">一行一项。全部清空即{p.builtin ? '恢复出厂词库' : '删除这个词库'}。</p>
                </div>
              )}
            </section>
          ))}
        </>
      )}

      <p className="foot">改动立即生效，只保存在本机。内置规则与词库都能改写，随时可恢复默认。</p>
    </div>
  );
}
