import { FILE_POOL_KEY, MAX_POOL_FILES, type PoolEntry } from '../../shared/types';

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
