import { useCallback, useEffect, useRef, useState } from 'react';
import type { FieldDTO, FillResult, ScanResult, Settings, StoredRules } from '../shared/types';
import { DEFAULT_SETTINGS, RANDOM_OPTION_PLACEHOLDER } from '../shared/types';
import { GENERIC_RULE_ID, ENUM_RULE_ID, RULES_KEY } from '../core/rules/types';
import { emptyStored, loadRules } from '../core/rules/store';
import { loadSettings, saveSettings } from '../shared/storage';
import { activeTabId, reinject, sendToContent, unreachableHint } from '../shared/messaging';
import SettingsPanel from '../shared/SettingsPanel';
import RulesPanel from '../shared/RulesPanel';
import './styles.css';

const KIND_LABELS: Record<string, string> = {
  text: '文本', textarea: '多行文本', number: '数字', password: '密码', email: '邮箱', url: '网址', tel: '电话',
  select: '下拉', 'select-widget': '下拉', multiselect: '多选', cascader: '级联', date: '日期', datetime: '日期时间',
  daterange: '日期范围', checkbox: '复选', 'checkbox-group': '复选组', 'radio-group': '单选组', switch: '开关',
  'upload-image': '上传图片', 'upload-file': '上传文件', richtext: '富文本', lookup: '弹窗选择',
};

const KIND_CATEGORIES: Record<string, string> = {
  select: 'pick', 'select-widget': 'pick', multiselect: 'pick', cascader: 'pick',
  'radio-group': 'pick', checkbox: 'pick', 'checkbox-group': 'pick',
  date: 'date', datetime: 'date', daterange: 'date',
  'upload-image': 'upload', 'upload-file': 'upload',
  lookup: 'lookup',
  switch: 'toggle',
};

export default function App() {
  const [tabId, setTabId] = useState<number | null>(null);
  const [fields, setFields] = useState<FieldDTO[]>([]);
  const [skipped, setSkipped] = useState<FieldDTO[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [included, setIncluded] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [warns, setWarns] = useState<Record<string, string>>({});
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const rulesRef = useRef<StoredRules>(emptyStored());
  // 上次识别时用的规则与覆盖开关。从设置页回来时靠它判断要不要重扫。
  const scannedRef = useRef('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [tone, setTone] = useState<'' | 'warn' | 'err'>('');
  const [showSkipped, setShowSkipped] = useState(false);
  const skippedRef = useRef<HTMLDetailsElement>(null);
  const [view, setView] = useState<'fields' | 'settings' | 'rules'>('fields');

  // 勾选状态 = 会参与「填充全部」的字段。全选框要能表达「部分选中」，用 indeterminate。
  const includedCount = fields.filter((f) => included[f.id] !== false).length;
  const allIncluded = fields.length > 0 && includedCount === fields.length;
  const selAllRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (selAllRef.current) selAllRef.current.indeterminate = includedCount > 0 && includedCount < fields.length;
  }, [includedCount, fields.length]);

  const request = useCallback(async <T,>(msg: Parameters<typeof sendToContent>[1]): Promise<T> => {
    let id = tabId;
    if (id == null) {
      id = await activeTabId();
      setTabId(id);
    }
    let resp = await sendToContent<T>(id, msg);
    if (!resp.ok) {
      const injectError = await reinject(id);
      resp = await sendToContent<T>(id, msg);
      if (!resp.ok) throw new Error(await unreachableHint(id, injectError ?? resp.error));
    }
    return resp.data;
  }, [tabId]);

  const scan = useCallback(async (s: Settings = settings) => {
    setBusy(true);
    setStatus('识别中…');
    try {
      const result = await request<ScanResult>({ type: 'scan', overwrite: s.overwrite, rules: rulesRef.current });
      scannedRef.current = JSON.stringify({ rules: rulesRef.current, overwrite: s.overwrite });
      setFields(result.fields);
      setSkipped(result.skipped);
      setValues(Object.fromEntries(result.fields.map((f) => [f.id, f.value])));
      setIncluded(Object.fromEntries(result.fields.map((f) => [f.id, true])));
      setErrors({});
      setWarns({});
      setCanUndo(false);
      setTone('');
      setStatus(`识别到 ${result.fields.length} 个可填充字段`);
    } catch (err) {
      setTone('err');
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [request, settings]);

  useEffect(() => {
    let alive = true;
    void Promise.all([loadSettings(), loadRules()]).then(([s, r]) => {
      if (!alive) return;
      setSettings(s);
      rulesRef.current = r;
      void scan(s);
    });
    const onChanged = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName === 'sync' && changes['ff.settings']) {
        loadSettings().then((s) => { if (alive) setSettings(s); });
      }
      // 规则中心与弹窗同处一个页面实例，改完不会重新挂载，只能靠存储事件同步。
      if (areaName === 'local' && changes[RULES_KEY]) {
        loadRules().then((r) => { if (alive) rulesRef.current = r; });
      }
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      alive = false;
      chrome.storage.onChanged.removeListener(onChanged);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const regen = async (id: string) => {
    try {
      const { value } = await request<{ value: string }>({ type: 'regen', id, rules: rulesRef.current });
      setValues((v) => ({ ...v, [id]: value }));
    } catch (err) {
      setTone('err');
      setStatus(err instanceof Error ? err.message : String(err));
    }
  };

  const fill = async (cmds: { id: string; value: string }[]) => {
    setBusy(true);
    setWarns({});
    setStatus(`填充中（${cmds.length}）…`);
    try {
      const results = await request<FillResult[]>({ type: 'fill', cmds, overwrite: settings.overwrite, image: settings.image });
      const errs: Record<string, string> = {};
      const pageErrs: Record<string, string> = {};
      for (const r of results) {
        if (!r.ok && r.error) errs[r.id] = r.error;
        else if (r.ok && r.pageError) pageErrs[r.id] = r.pageError;
      }
      setErrors(errs);
      setWarns(pageErrs);
      const failed = Object.keys(errs).length;
      const warned = Object.keys(pageErrs).length;
      setCanUndo(true);
      setTone(failed ? 'err' : warned ? 'warn' : '');
      const parts: string[] = [];
      if (failed) parts.push(`${failed} 个填充失败（见标红）`);
      if (warned) parts.push(`${warned} 个页面校验未通过（见标黄）`);
      setStatus(parts.length ? `填充完成：${parts.join('，')}` : '填充完成');
    } catch (err) {
      setTone('err');
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const fillAll = () => fill(fields.filter((f) => included[f.id]).map((f) => ({ id: f.id, value: values[f.id] ?? '' })));
  const fillOne = (f: FieldDTO) => fill([{ id: f.id, value: values[f.id] ?? '' }]);

  const toggleAll = () => {
    const next = !allIncluded;
    setIncluded(Object.fromEntries(fields.map((f) => [f.id, next])));
  };

  const undo = async () => {
    try {
      await request({ type: 'undo' });
      setCanUndo(false);
      setWarns({});
      setTone('');
      setStatus('已撤销最近一次填充');
    } catch (err) {
      setTone('err');
      setStatus(err instanceof Error ? err.message : String(err));
    }
  };

  const clearAll = async () => {
    setBusy(true);
    setStatus('清除中…');
    try {
      const r = await request<{ cleared: number; failed: number }>({ type: 'clear' });
      setWarns({});
      setTone(r.failed ? 'warn' : '');
      setStatus(`已清除 ${r.cleared} 个字段${r.failed ? `，${r.failed} 个无法清空（控件不支持）` : ''}`);
    } catch (err) {
      setTone('err');
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const revealSkipped = () => {
    setShowSkipped(true);
    skippedRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  const toggleOverwrite = async (overwrite: boolean) => {
    const next = { ...settings, overwrite };
    setSettings(next);
    await saveSettings(next);
  };

  // 规则中心改过规则后，列表上的规则名与生成值都是旧的，得重新识别；
  // 没改就别扫，否则会清掉用户已经勾掉的字段。
  const backToFields = () => {
    setView('fields');
    if (JSON.stringify({ rules: rulesRef.current, overwrite: settings.overwrite }) !== scannedRef.current) void scan();
  };

  if (view === 'settings' || view === 'rules') {
    return (
      <div className="app">
        <header>
          <button className="ghost" onClick={view === 'rules' ? () => setView('settings') : backToFields}>← 返回</button>
          <strong className="brand">{view === 'rules' ? '规则中心' : '设置'}</strong>
        </header>
        <main>{view === 'rules' ? <RulesPanel /> : <SettingsPanel onOpenRules={() => setView('rules')} />}</main>
      </div>
    );
  }

  return (
    <div className="app">
      <header>
        <strong className="brand">FormFaker</strong>
        <span className="spacer" />
        <button className="ghost" onClick={() => void scan()} disabled={busy}>重新识别</button>
        <button className="primary" onClick={() => void fillAll()} disabled={busy || !fields.length}>填充全部</button>
      </header>
      <div className="toolbar">
        <label className="overwrite">
          <input type="checkbox" checked={settings.overwrite} onChange={(e) => void toggleOverwrite(e.target.checked)} />
          覆盖已有值
        </label>
        {skipped.length > 0 && (
          <button className="linklike" onClick={revealSkipped} title="查看被跳过的字段及原因">
            跳过 {skipped.length} 个
          </button>
        )}
        <span className={`status${tone ? ` ${tone}` : ''}`}>{status}</span>
      </div>
      <main>
        {fields.length > 0 && (
          <div className="listhead">
            <label className="selall">
              <input ref={selAllRef} type="checkbox" checked={allIncluded} onChange={toggleAll} />
              全选
            </label>
            <span className="spacer" />
            <span className="selsum">已选 <b>{includedCount}</b>/{fields.length}</span>
          </div>
        )}
        {fields.map((f, i) => (
          <section key={f.id} className={`row${errors[f.id] ? ' error' : warns[f.id] ? ' warn' : ''}`}>
            <div className="line1">
              <input
                type="checkbox"
                checked={included[f.id] ?? true}
                onChange={(e) => setIncluded((s) => ({ ...s, [f.id]: e.target.checked }))}
              />
              <span className="idx">{i + 1}</span>
              <span className={`label${f.label ? '' : ' unnamed'}`} title={f.label}>
                {f.label || '未命名'}
              </span>
              <span className={`chip kind-${KIND_CATEGORIES[f.kind] ?? 'input'}`}>{KIND_LABELS[f.kind] ?? f.kind}</span>
              {f.semantic !== ENUM_RULE_ID && (
                <span
                  className={`chip semantic${f.ruleCustom ? ' custom' : f.semantic === GENERIC_RULE_ID ? ' generic' : ''}`}
                  title={f.ruleCustom ? '自定义规则' : `内置规则 ${f.semantic}`}
                >
                  {f.ruleName}
                </span>
              )}
              <span className="spacer" />
              <span className="actions">
                <button className="icon" title="换一个" onClick={() => void regen(f.id)}>↻</button>
                <button className="icon" title="填充此字段" onClick={() => void fillOne(f)}>→</button>
              </span>
            </div>
            <input
              className={`value${f.kind === 'upload-image' || f.kind === 'upload-file' ? ' static' : ''}`}
              value={values[f.id] ?? ''}
              placeholder={RANDOM_OPTION_PLACEHOLDER}
              readOnly={f.kind === 'upload-image' || f.kind === 'upload-file'}
              onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))}
            />
            {errors[f.id] && <div className="err">{errors[f.id]}</div>}
            {warns[f.id] && <div className="pgerr">页面校验：{warns[f.id]}</div>}
          </section>
        ))}
        {!fields.length && !busy && <div className="empty">未识别到可填充字段。若页面刚加载或发生路由跳转，请点「重新识别」。</div>}
        {skipped.length > 0 && (
          <details ref={skippedRef} open={showSkipped} onToggle={(e) => setShowSkipped((e.target as HTMLDetailsElement).open)}>
            <summary>跳过的字段（{skipped.length}）</summary>
            {skipped.map((f) => (
              <div key={f.id} className="skipped-row">{f.label || '未命名'} — {f.reason}</div>
            ))}
          </details>
        )}
      </main>
      <footer>
        <button className="settings" onClick={() => setView('settings')} title="打开设置">
          <span className="gear" aria-hidden="true">⚙</span>设置
        </button>
        <span className="spacer" />
        <button className="ghost" onClick={() => void undo()} disabled={busy || !canUndo}>撤销</button>
        <button className="danger" onClick={() => void clearAll()} disabled={busy || !fields.length}>清除全部</button>
      </footer>
    </div>
  );
}
