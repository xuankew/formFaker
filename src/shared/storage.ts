import { DEFAULT_SETTINGS, type Settings } from './types';

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get('ff.settings');
  const s = stored['ff.settings'] as Partial<Settings> | undefined;
  // image 是后加的一组，老配置里没有；逐字段合并，别让缺字段的旧配置把默认值整个冲掉。
  return { ...DEFAULT_SETTINGS, ...s, image: { ...DEFAULT_SETTINGS.image, ...s?.image } };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ 'ff.settings': settings });
}
