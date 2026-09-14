import { useEffect, useState, type CSSProperties } from 'react';
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

const RULE_FIELDS: { key: keyof GenRules; label: string; placeholder: string; hint?: string }[] = [
  { key: 'dateFormat', label: '日期格式', placeholder: 'YYYY-MM-DD', hint: '令牌 YYYY MM DD' },
  { key: 'datetimeFormat', label: '日期时间格式', placeholder: 'YYYY-MM-DD HH:mm:ss', hint: '令牌 YYYY MM DD HH mm ss' },
  { key: 'emailDomain', label: '邮箱域名', placeholder: '留空用内置域名池，如 test.com' },
  { key: 'phonePrefixes', label: '手机号段', placeholder: '留空用内置号段，空格/逗号分隔，如 138 199' },
  { key: 'companySuffixes', label: '企业后缀', placeholder: '留空用内置，空格/逗号分隔，如 有限公司 股份公司' },
];

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  boxSizing: 'border-box',
  border: '1px solid #d0d7de',
  borderRadius: 6,
  fontSize: 13,
};

const hrStyle: CSSProperties = { border: 'none', borderTop: '1px solid #e1e4e8', margin: '16px 0' };

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
    <div style={{ fontFamily: '-apple-system, "PingFang SC", sans-serif', color: '#1f2328', fontSize: 13 }}>
      <p style={{ color: '#57606a', fontSize: 13, marginTop: 0 }}>
        内置一套默认生成规则；下面填写的自定义规则优先级更高，留空则回退到内置默认。
      </p>

      <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0' }}>
        <input
          type="checkbox"
          checked={settings.overwrite}
          onChange={(e) => {
            setSaved(false);
            setSettings((s) => ({ ...s, overwrite: e.target.checked }));
          }}
        />
        默认覆盖已有值（关闭时仅填充空白字段）
      </label>

      <hr style={hrStyle} />

      <h3 style={{ fontSize: 15, marginBottom: 8 }}>随机数据规则</h3>
      <div style={{ display: 'grid', gap: 12 }}>
        {RULE_FIELDS.map((f) => (
          <label key={f.key} style={{ display: 'grid', gap: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>
              {f.label}
              {f.hint && (
                <span style={{ fontWeight: 400, color: '#8b949e', marginLeft: 8, fontSize: 12 }}>{f.hint}</span>
              )}
            </span>
            <input
              style={inputStyle}
              value={settings.rules[f.key]}
              placeholder={f.placeholder}
              onChange={(e) => setRule(f.key, e.target.value)}
            />
          </label>
        ))}
      </div>

      <p style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
        <button
          onClick={() => {
            void saveSettings(settings).then(() => setSaved(true));
          }}
          style={{ padding: '6px 16px' }}
        >
          保存
        </button>
        <button
          onClick={() => {
            setSaved(false);
            setSettings((s) => ({ ...s, rules: DEFAULT_GEN_RULES }));
          }}
          style={{ padding: '6px 16px' }}
        >
          恢复默认规则
        </button>
        {saved && <span style={{ color: '#1a7f37', fontSize: 13 }}>已保存</span>}
      </p>

      <hr style={hrStyle} />

      <h3 style={{ fontSize: 15, marginBottom: 8 }}>上传文件池</h3>
      <p style={{ color: '#57606a', fontSize: 13, marginTop: 0 }}>
        填充「上传」控件时优先按 <code>accept</code> 从文件池匹配真实文件；池为空或无匹配时回退到内置合成文件（PNG/PDF）。
        单个文件 ≤ 2MB，最多 {MAX_POOL_FILES} 个，仅保存在本机。
      </p>
      <input
        type="file"
        multiple
        onChange={(e) => {
          void onPickFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {pool.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0', display: 'grid', gap: 6 }}>
          {pool.map((p, i) => (
            <li
              key={i}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                border: '1px solid #e1e4e8',
                borderRadius: 6,
                padding: '6px 8px',
              }}
            >
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
              <span style={{ color: '#8b949e', fontSize: 12 }}>
                {p.type || '未知类型'} · {(p.size / 1024).toFixed(0)}KB
              </span>
              <button onClick={() => persistPool(pool.filter((_, j) => j !== i))} style={{ padding: '2px 8px' }}>
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
      {poolMsg && <span style={{ color: '#1a7f37', fontSize: 13 }}>{poolMsg}</span>}

      <hr style={hrStyle} />
      <p style={{ color: '#57606a', fontSize: 12 }}>
        日期令牌示例：<code>YYYY/MM/DD</code>、<code>DD-MM-YYYY</code>、<code>YYYY年MM月DD日</code>。
        号段 / 后缀 / 域名留空即使用内置池。规则结构可扩展，后续可按同一方式加入姓名用字、金额范围等维度。
      </p>
    </div>
  );
}
