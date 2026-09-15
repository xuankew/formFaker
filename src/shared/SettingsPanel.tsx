import { useEffect, useState } from 'react';
import { loadSettings, saveSettings } from './storage';
import {
  DEFAULT_GEN_RULES,
  DEFAULT_SETTINGS,
  FILE_POOL_KEY,
  MAX_FILE_BYTES,
  MAX_POOL_FILES,
  type GenRules,
  type PoolEntry,
  type Settings,
} from './types';
import './settings.css';

const RULE_FIELDS: { key: keyof GenRules; label: string; placeholder: string; hint?: string }[] = [
  { key: 'dateFormat', label: '日期格式', placeholder: 'YYYY-MM-DD', hint: '令牌 YYYY MM DD' },
  { key: 'datetimeFormat', label: '日期时间格式', placeholder: 'YYYY-MM-DD HH:mm:ss', hint: '令牌 YYYY MM DD HH mm ss' },
  { key: 'emailDomain', label: '邮箱域名', placeholder: '留空用内置域名池，如 test.com' },
  { key: 'phonePrefixes', label: '手机号段', placeholder: '留空用内置号段，空格/逗号分隔，如 138 199' },
  { key: 'companySuffixes', label: '企业后缀', placeholder: '留空用内置，空格/逗号分隔，如 有限公司 股份公司' },
];

// Shared settings UI rendered both inside the action popup and in the standalone
// options tab. Fluid width; the host controls outer layout, title, and scrolling.
export default function SettingsPanel() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [pool, setPool] = useState<PoolEntry[]>([]);
  const [poolMsg, setPoolMsg] = useState('');

  useEffect(() => {
    loadSettings().then(setSettings);
    chrome.storage.local
      .get(FILE_POOL_KEY)
      .then((s) => {
        const arr = s[FILE_POOL_KEY];
        if (Array.isArray(arr)) setPool(arr as PoolEntry[]);
      })
      .catch(() => {});
  }, []);

  const setRule = (key: keyof GenRules, value: string) => {
    setSaved(false);
    setSettings((s) => ({ ...s, rules: { ...s.rules, [key]: value } }));
  };

  const persistPool = (next: PoolEntry[], msg = '已保存') => {
    setPool(next);
    chrome.storage.local
      .set({ [FILE_POOL_KEY]: next })
      .then(() => setPoolMsg(msg))
      .catch((e) => setPoolMsg('保存失败：' + String(e)));
  };

  const readFile = (f: File): Promise<PoolEntry> =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const url = String(r.result ?? '');
        resolve({ name: f.name, type: f.type, size: f.size, data: url.slice(url.indexOf(',') + 1) });
      };
      r.onerror = () => reject(r.error);
      r.readAsDataURL(f);
    });

  const onPickFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const next = [...pool];
    const ignored: string[] = [];
    for (const f of Array.from(files)) {
      if (f.size > MAX_FILE_BYTES) {
        ignored.push(`${f.name}（>2MB）`);
        continue;
      }
      if (next.length >= MAX_POOL_FILES) {
        ignored.push(`${f.name}（超出${MAX_POOL_FILES}个上限）`);
        continue;
      }
      next.push(await readFile(f));
    }
    persistPool(next, ignored.length ? `已保存，忽略：${ignored.join('、')}` : '已保存');
  };

  return (
    <div className="ff-settings">
      <section className="card">
        <h3>填充行为</h3>
        <label className="rowline">
          <input
            type="checkbox"
            checked={settings.overwrite}
            onChange={(e) => {
              setSaved(false);
              setSettings((s) => ({ ...s, overwrite: e.target.checked }));
            }}
          />
          默认覆盖已有值<span className="hint">关闭时仅填充空白字段</span>
        </label>
      </section>

      <section className="card">
        <h3>
          随机数据规则<span className="sub">自定义优先，留空回退内置</span>
        </h3>
        {RULE_FIELDS.map((f) => (
          <label key={f.key} className="field">
            <span>
              {f.label}
              {f.hint && <span className="hint">{f.hint}</span>}
            </span>
            <input
              type="text"
              value={settings.rules[f.key]}
              placeholder={f.placeholder}
              onChange={(e) => setRule(f.key, e.target.value)}
            />
          </label>
        ))}
        <div className="rowline">
          <button
            className="primary"
            onClick={() => {
              void saveSettings(settings).then(() => setSaved(true));
            }}
          >
            保存
          </button>
          <button
            className="ghost"
            onClick={() => {
              setSaved(false);
              setSettings((s) => ({ ...s, rules: DEFAULT_GEN_RULES }));
            }}
          >
            恢复默认规则
          </button>
          {saved && <span className="ok">已保存</span>}
        </div>
      </section>

      <section className="card">
        <h3>
          上传文件池<span className="sub">{pool.length}/{MAX_POOL_FILES}</span>
        </h3>
        <p className="lead">
          填充「上传」控件时优先按 <code>accept</code> 从文件池匹配真实文件；池为空或无匹配时回退内置合成文件（PNG/PDF）。
          单个文件 ≤ 2MB，仅保存在本机。
        </p>
        <label className="drop">
          + 添加文件（可多选）
          <input
            type="file"
            multiple
            onChange={(e) => {
              void onPickFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        {pool.length > 0 && (
          <ul className="pool">
            {pool.map((p, i) => (
              <li key={i}>
                <span className="name">{p.name}</span>
                <span className="meta">
                  {p.type || '未知类型'} · {(p.size / 1024).toFixed(0)}KB
                </span>
                <button className="danger-ghost" onClick={() => persistPool(pool.filter((_, j) => j !== i))}>
                  删除
                </button>
              </li>
            ))}
          </ul>
        )}
        {poolMsg && <span className={poolMsg.startsWith('保存失败') ? 'bad' : 'ok'}>{poolMsg}</span>}
      </section>

      <p className="foot">
        日期令牌示例：<code>YYYY/MM/DD</code>、<code>DD-MM-YYYY</code>、<code>YYYY年MM月DD日</code>。
        号段 / 后缀 / 域名留空即使用内置池。
      </p>
    </div>
  );
}
