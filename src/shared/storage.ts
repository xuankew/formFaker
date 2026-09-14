import { DEFAULT_GEN_RULES, DEFAULT_SETTINGS, type Settings } from './types';

export async function loadSettings(): Promise<Settings> {
  const stored = await chrome.storage.sync.get('ff.settings');
  const s = stored['ff.settings'] as Partial<Settings> | undefined;
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    rules: { ...DEFAULT_GEN_RULES, ...(s?.rules ?? {}) },
  };
}

export async function saveSettings(settings: Settings): Promise<void> {
  await chrome.storage.sync.set({ 'ff.settings': settings });
}
