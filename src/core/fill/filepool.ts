import { FILE_POOL_KEY, MAX_POOL_FILES, type PoolEntry } from '../../shared/types';
import type { ImageSize } from './files';

// Content scripts can read chrome.storage.local directly. Guard for jsdom/tests
// and non-extension contexts where `chrome` is absent.
export async function loadFilePool(): Promise<PoolEntry[]> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return [];
  try {
    const stored = await chrome.storage.local.get(FILE_POOL_KEY);
    const arr = stored[FILE_POOL_KEY];
    return Array.isArray(arr) ? (arr as PoolEntry[]).slice(0, MAX_POOL_FILES) : [];
  } catch {
    return [];
  }
}

export function poolEntryToFile(entry: PoolEntry): File {
  const bin = atob(entry.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], entry.name, { type: entry.type || 'application/octet-stream' });
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i).toLowerCase() : '';
}

// accept tokens: ".ext", "type/sub", "type/*"; empty accept matches anything.
function matches(entry: PoolEntry, accept: string): boolean {
  const tokens = accept
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  if (!tokens.length) return true;
  const ext = extOf(entry.name);
  const mime = (entry.type || '').toLowerCase();
  return tokens.some((tok) => {
    if (tok.startsWith('.')) return ext === tok;
    if (tok.endsWith('/*')) return mime.startsWith(tok.slice(0, -1));
    return mime === tok;
  });
}

export function pickPoolFile(
  entries: PoolEntry[],
  kind: 'upload-image' | 'upload-file',
  accept: string,
): PoolEntry | null {
  if (!entries.length) return null;
  const matched = entries.filter((e) => matches(e, accept));
  if (!matched.length) return null;
  if (!accept && kind === 'upload-image') {
    const img = matched.find((e) => (e.type || '').startsWith('image/'));
    if (img) return img;
  }
  return matched[0];
}

async function imageDims(entry: PoolEntry): Promise<ImageSize | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bmp = await createImageBitmap(poolEntryToFile(entry));
    const dims = { width: bmp.width, height: bmp.height };
    bmp.close?.();
    return dims;
  } catch {
    return null;
  }
}

// 池文件是用户亲手挑的，但表单可能声明体积/尺寸门槛；不满足的条目跳过、回退合成文件
// （合成图按声明尺寸画且体积很小），避免把注定被 before-upload 拒收的文件注入页面。
export async function entryMeetsHints(
  entry: PoolEntry,
  need: ImageSize | null,
  maxBytes: number | null,
): Promise<boolean> {
  if (maxBytes != null && entry.size > maxBytes) return false;
  if (need && (entry.type || '').startsWith('image/')) {
    const dims = await imageDims(entry);
    if (dims && (dims.width !== need.width || dims.height !== need.height)) return false;
  }
  return true;
}
