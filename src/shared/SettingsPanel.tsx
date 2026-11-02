import { useEffect, useMemo, useRef, useState } from 'react';
import { loadSettings, saveSettings } from './storage';
import { emptyStored, loadRules, saveRules } from '../core/rules/store';
import { BUILTIN_RULES, buildCatalog } from '../core/rules/catalog';
import {
  DEFAULT_SETTINGS,
  FILE_POOL_KEY,
  MAX_FILE_BYTES,
  MAX_POOL_FILES,
  type ImageStyle,
  type PoolEntry,
  type Settings,
} from './types';
import { paintImage, resolveImageSize, type ImageTextPos } from '../core/fill/files';
import { RULES_KEY, type StoredRules } from '../core/rules/types';
import './settings.css';

// 标记作用在哪些规则上由规则中心的「贴数据标记」决定，示例值随第一条命中的规则变，
// 不要再把规则名单写死在文案里。
const SAMPLE_TEXT: Record<string, string> = {
  company: '宁波星辰科技有限公司',
  generic: 'test-k3j2h',
};

const POS_OPTIONS: { pos: ImageTextPos; label: string }[] = [
  { pos: 'top-left', label: '左上' },
  { pos: 'top', label: '上' },
  { pos: 'top-right', label: '右上' },
  { pos: 'left', label: '左' },
  { pos: 'center', label: '居中' },
  { pos: 'right', label: '右' },
  { pos: 'bottom-left', label: '左下' },
  { pos: 'bottom', label: '下' },
  { pos: 'bottom-right', label: '右下' },
];

// Shared settings UI rendered both inside the action popup and in the standalone
// options tab. Fluid width; the host controls outer layout, title, and scrolling.
// onOpenRules 只在弹窗里传：选项页用页签直接切到规则中心，不需要这个入口。
export default function SettingsPanel({ onOpenRules }: { onOpenRules?: () => void }) {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [rules, setRules] = useState<StoredRules>(emptyStored);
  // 保存提示分区域，否则在下面改标记却在上面的「填充」标题里闪一下，用户看不到。
  const [savedAt, setSavedAt] = useState<'' | 'fill' | 'mark' | 'image'>('');
  const [pool, setPool] = useState<PoolEntry[]>([]);
  const [poolMsg, setPoolMsg] = useState('');
  const savedTimer = useRef<number | undefined>(undefined);
  // onOpenRules 每次渲染都是新函数，放进订阅的依赖里会让监听反复重装，用 ref 取最新值。
  const openRulesRef = useRef(onOpenRules);
  openRulesRef.current = onOpenRules;

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
    // 选项页里设置与规则中心同屏，规则中心改了「贴数据标记」这里要跟着更新。
    // 弹窗里两个视图互斥、重新进入时会重新挂载读取，不必订阅（也避免每次敲键都回读）。
    const onChanged = (changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (openRulesRef.current || areaName !== 'local' || !changes[RULES_KEY]) return;
      loadRules().then((next) =>
        setRules((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next)),
      );
    };
    chrome.storage.onChanged.addListener(onChanged);
    return () => {
      chrome.storage.onChanged.removeListener(onChanged);
      window.clearTimeout(savedTimer.current);
    };
  }, []);

  const flashSaved = (where: 'fill' | 'mark' | 'image') => {
    setSavedAt(where);
    window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSavedAt(''), 1600);
  };

  const toggleOverwrite = (overwrite: boolean) => {
    const next = { ...settings, overwrite };
    setSettings(next);
    void saveSettings(next).then(() => flashSaved('fill'));
  };

  // 图片样式随输入即时生效，但写 sync 要节流：storage.sync 有每分钟写入次数上限，
  // 逐键落盘在长文本输入时会撞配额。失焦、点位置、关面板时都会立刻冲刷。
  const imageTimer = useRef<number | undefined>(undefined);
  const pendingImage = useRef<Settings | null>(null);
  const flushImage = () => {
    window.clearTimeout(imageTimer.current);
    const pending = pendingImage.current;
    pendingImage.current = null;
    if (pending) void saveSettings(pending);
  };
  const setImage = (patch: Partial<ImageStyle>) => {
    const next = { ...settings, image: { ...settings.image, ...patch } };
    setSettings(next);
    pendingImage.current = next;
    window.clearTimeout(imageTimer.current);
    imageTimer.current = window.setTimeout(() => {
      pendingImage.current = null;
      void saveSettings(next);
    }, 400);
  };

  // 宽高留空表示用内置默认值；填了就夹到画布能承受的范围，避免 0 或超大值。
  const commitDim = (raw: string): number | null => {
    const n = Number(raw);
    if (!raw.trim() || !Number.isFinite(n)) return null;
    return Math.min(2000, Math.max(1, Math.round(n)));
  };

  // 面板卸载（返回字段列表 / 关弹窗）时把节流中的最后一次修改补写掉。
  useEffect(
    () => () => {
      window.clearTimeout(imageTimer.current);
      if (pendingImage.current) void saveSettings(pendingImage.current);
    },
    [],
  );

  // 标记存在规则里，改一个字就落盘：关掉弹窗不会丢，也不需要额外的保存动作。
  const setMark = (key: 'prefix' | 'suffix', value: string) => {
    const next = { ...rules, marks: { ...rules.marks, [key]: value } };
    setRules(next);
    void saveRules(next);
  };

  const catalog = useMemo(() => buildCatalog(rules), [rules]);
  const markedRules = useMemo(
    () => catalog.rules.filter((r) => r.mark && !r.disabled && r.gen.type !== 'option'),
    [catalog],
  );
  const hasAffix = !!(rules.marks.prefix.trim() || rules.marks.suffix.trim());
  const markLive = hasAffix && markedRules.length > 0;
  const sampleBase = markedRules.map((r) => SAMPLE_TEXT[r.id]).find(Boolean) ?? '示例值';

  const previewRef = useRef<HTMLCanvasElement>(null);
  const imageSize = resolveImageSize(null, settings.image);
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas) return;
    canvas.width = imageSize.width;
    canvas.height = imageSize.height;
    const ctx = canvas.getContext('2d');
    if (ctx) paintImage(ctx, imageSize, settings.image, '#cfe3f3');
  }, [settings.image, imageSize.width, imageSize.height]);

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

  const changed = rules.rules.length;

  const markInput = (key: 'prefix' | 'suffix') => (
    <div className="field">
      <label htmlFor={`ff-mark-${key}`}>{key === 'prefix' ? '前缀' : '后缀'}</label>
      <div className="inputwrap">
        <input
          id={`ff-mark-${key}`}
          type="text"
          value={rules.marks[key]}
          placeholder={key === 'prefix' ? '如 qa-' : '如 -qa'}
          onChange={(e) => setMark(key, e.target.value)}
          onBlur={() => flashSaved('mark')}
        />
        {rules.marks[key] && (
          <button
            type="button"
            className="clr"
            title={key === 'prefix' ? '清空前缀' : '清空后缀'}
            aria-label={key === 'prefix' ? '清空前缀' : '清空后缀'}
            onClick={() => {
              setMark(key, '');
              flashSaved('mark');
            }}
          >
            ×
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="ff-settings">
      <section className="sgroup">
        <div className="sgh">
          <span>填充</span>
          <i />
          <span className={`sghmeta${savedAt === 'fill' ? ' ok' : ''}`}>
            {savedAt === 'fill' ? '✓ 已保存' : '改动自动保存'}
          </span>
        </div>
        <div className="scard">
          <label className="srow">
            <span className="sgrow">
              <span className="stitle">覆盖已有值</span>
              <span className="sdesc">关闭时只填空白字段，已有内容保持不动</span>
            </span>
            <span className="sswitch">
              <input
                type="checkbox"
                checked={settings.overwrite}
                onChange={(e) => toggleOverwrite(e.target.checked)}
              />
              <i className="track" />
            </span>
          </label>
        </div>
      </section>

      <section className="sgroup">
        <div className="sgh">
          <span>随机数据</span>
          <i />
          <span className="sghmeta">{changed ? `已改 ${changed} 条` : `内置 ${BUILTIN_RULES.length} 条`}</span>
        </div>
        <div className="scard">
          <div className="srow col">
            <span className="sgrow">
              <span className="stitle">
                数据标记
                <span className={`stag${markLive ? ' on' : hasAffix ? ' warn' : ''}`}>
                  {markLive ? '生效中' : hasAffix ? '无规则生效' : '未设置'}
                </span>
                {savedAt === 'mark' && <span className="savedtag">✓ 已保存</span>}
              </span>
              <span className="sdesc">
                给勾了「贴数据标记」的规则加前后缀，方便事后搜出自己造的数据；号码、证件、日期等有格式校验的规则别勾。
              </span>
            </span>
            <div className="smarks">
              <span className="slabel">作用于</span>
              {markedRules.length ? (
                markedRules.map((r) => (
                  <span key={r.id} className="schip">
                    {r.name || r.id}
                  </span>
                ))
              ) : (
                <span className="sempty">没有规则开启「贴数据标记」</span>
              )}
              {onOpenRules && (
                <button className="linkbtn" onClick={onOpenRules}>
                  {markedRules.length ? '调整' : '去勾选'} →
                </button>
              )}
            </div>
            <div className="sgrid">
              {markInput('prefix')}
              {markInput('suffix')}
            </div>
            <div className={`sdemo${markLive ? '' : ' muted'}`}>
              {markLive ? (
                <>
                  <span>示例</span>
                  <code>
                    <b>{rules.marks.prefix}</b>
                    {sampleBase}
                    <b>{rules.marks.suffix}</b>
                  </code>
                </>
              ) : (
                <span>{hasAffix ? '没有规则开启贴标记，前后缀不会生效' : '前后缀都留空时不加标记，生成值保持原样'}</span>
              )}
            </div>
          </div>
          {onOpenRules && (
            <div className="srow">
              <span className="sgrow">
                <span className="stitle">规则中心</span>
                <span className="sdesc">
                  内置规则可按组改写、换生成方式或停用，也能用模板 DSL 自定义，如订单号 <code>{'{n:12}'}</code>
                </span>
              </span>
              <button className="primary" onClick={onOpenRules}>
                打开
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="sgroup">
        <div className="sgh">
          <span>上传</span>
          <i />
          <span className="sghmeta">
            {pool.length}/{MAX_POOL_FILES}
          </span>
        </div>
        <div className="scard">
          <div className="srow col">
            <span className="sgrow">
              <span className="stitle">文件池</span>
              <span className="sdesc">
                填充上传控件时优先按 <code>accept</code> 匹配池里的真实文件；池为空，或文件不满足字段声明的体积 / 尺寸门槛时，自动改用合成 PNG、PDF
              </span>
            </span>
            <label className="drop">
              + 添加文件（可多选，单个 ≤ 2MB）
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
          </div>
          <div className="srow col">
            <span className="sgrow">
              <span className="stitle">
                合成图片
                {savedAt === 'image' && <span className="savedtag">✓ 已保存</span>}
              </span>
              <span className="sdesc">
                文件池没有可用文件、或池文件不满足字段门槛时，用它顶上。字段写了尺寸（如 480*480px）就按字段画，这里只定没写尺寸时的默认大小。
              </span>
            </span>
            <div className="simg">
              <div className="simgctl">
                <div className="field">
                  <label htmlFor="ff-img-text">文字内容</label>
                  <div className="inputwrap">
                    <input
                      id="ff-img-text"
                      type="text"
                      value={settings.image.text}
                      placeholder="如 FormFaker，留空则不写字"
                      onChange={(e) => setImage({ text: e.target.value })}
                      onBlur={() => {
                        flushImage();
                        flashSaved('image');
                      }}
                    />
                    {settings.image.text && (
                      <button
                        type="button"
                        className="clr"
                        title="清空文字"
                        aria-label="清空文字"
                        onClick={() => {
                          setImage({ text: '' });
                          flushImage();
                          flashSaved('image');
                        }}
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
                <div className="field">
                  <span>文字位置</span>
                  <div className="spos" role="group" aria-label="文字位置">
                    {POS_OPTIONS.map((o) => (
                      <button
                        key={o.pos}
                        type="button"
                        className={settings.image.pos === o.pos ? 'on' : ''}
                        aria-pressed={settings.image.pos === o.pos}
                        title={`文字放在${o.label}`}
                        onClick={() => {
                          setImage({ pos: o.pos });
                          flushImage();
                          flashSaved('image');
                        }}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="simgprev">
                <canvas ref={previewRef} aria-label="合成图片预览" />
                <span>
                  {imageSize.width} × {imageSize.height} px
                </span>
              </div>
            </div>
            <div className="sgrid">
              <div className="field">
                <label htmlFor="ff-img-w">默认宽（px）</label>
                <input
                  id="ff-img-w"
                  type="number"
                  min={1}
                  max={2000}
                  placeholder="240"
                  value={settings.image.width ?? ''}
                  onChange={(e) => setImage({ width: e.target.value === '' ? null : Number(e.target.value) })}
                  onBlur={(e) => {
                    setImage({ width: commitDim(e.target.value) });
                    flushImage();
                    flashSaved('image');
                  }}
                />
              </div>
              <div className="field">
                <label htmlFor="ff-img-h">默认高（px）</label>
                <input
                  id="ff-img-h"
                  type="number"
                  min={1}
                  max={2000}
                  placeholder="160"
                  value={settings.image.height ?? ''}
                  onChange={(e) => setImage({ height: e.target.value === '' ? null : Number(e.target.value) })}
                  onBlur={(e) => {
                    setImage({ height: commitDim(e.target.value) });
                    flushImage();
                    flashSaved('image');
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      <p className="foot">所有设置只保存在本机，不上传任何数据。</p>
    </div>
  );
}
