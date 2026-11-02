import { DEFAULT_SETTINGS, type Settings } from './types';

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get('ff.settings');
  const s = stored['ff.settings'] as Partial<Settings> | undefined;
  return { ...DEFAULT_SETTINGS, ...s };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ 'ff.settings': settings });
}
