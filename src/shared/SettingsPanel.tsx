import { useEffect, useState } from 'react';
import { loadSettings, saveSettings } from './storage';
import { emptyStored, loadRules, saveRules } from '../core/rules/store';
import {
  DEFAULT_SETTINGS,
  FILE_POOL_KEY,
  MAX_FILE_BYTES,
  MAX_POOL_FILES,
  type PoolEntry,
  type Settings,
} from './types';
import type { StoredRules } from '../core/rules/types';
import './settings.css';

// Shared settings UI rendered both inside the action popup and in the standalone
// options tab. Fluid width; the host controls outer layout, title, and scrolling.
// onOpenRules 只在弹窗里传：选项页用页签直接切到规则中心，不需要这个入口。
export default function SettingsPanel({ onOpenRules }: { onOpenRules?: () => void }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [rules, setRules] = useState<StoredRules>(emptyStored);
  const [saved, setSaved] = useState(false);
  const [pool, setPool] = useState<PoolEntry[]>([]);
  const [poolMsg, setPoolMsg] = useState('');

  useEffect(() => {
    loadSettings().then(setSettings);
    loadRules().then(setRules);
    chrome.storage.local
      .get(FILE_POOL_KEY)
      .then((s) => {
        const arr = s[FILE_POOL_KEY];
        if (Array.isArray(arr)) setPool(arr as PoolEntry[]);
      })
      .catch(() => {});
  }, []);

  const setMark = (key: 'prefix' | 'suffix', value: string) => {
    setSaved(false);
    setRules((r) => ({ ...r, marks: { ...r.marks, [key]: value } }));
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
          名称标记<span className="sub">贴在人名与企业名两端，便于事后检索自己造的数据</span>
        </h3>
        <label className="field">
          <span>前缀</span>
          <input
            type="text"
            value={rules.marks.prefix}
            placeholder="留空不加，如 qa-"
            onChange={(e) => setMark('prefix', e.target.value)}
          />
        </label>
        <label className="field">
          <span>后缀</span>
          <input
            type="text"
            value={rules.marks.suffix}
            placeholder="留空不加，如 -qa"
            onChange={(e) => setMark('suffix', e.target.value)}
          />
        </label>
        <div className="rowline">
          <button
            className="primary"
            onClick={() => {
              void Promise.all([saveSettings(settings), saveRules(rules)]).then(() => setSaved(true));
            }}
          >
            保存
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
          池文件若不满足字段声明的门槛（如「50KB以内」「尺寸大小为：480*480px」）会自动改用合成文件，避免被页面拒收。
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

      {onOpenRules && (
        <section className="card">
          <h3>
            随机数据规则<span className="sub">规则中心</span>
          </h3>
          <p className="lead">
            手机号段、邮箱域名、企业地址、日期方向这些生成规则，以及「订单号 = 12 位大写字母加数字」这类自定义规则，都在这里逐条查看与改写。
          </p>
          <div className="rowline">
            <button className="primary" onClick={onOpenRules}>
              打开规则中心
            </button>
          </div>
        </section>
      )}

      <p className="foot">所有设置只保存在本机，不上传任何数据。</p>
    </div>
  );
}
