import type { ContentRequest, ContentResponse } from './types';

export function sendToContent<T>(tabId: number, msg: ContentRequest): Promise<ContentResponse<T>> {
  return new Promise((resolve) => {
    chrome.tabs.sendMessage(tabId, msg, (resp: ContentResponse<T> | undefined) => {
      if (chrome.runtime.lastError || !resp) {
        resolve({ ok: false, error: chrome.runtime.lastError?.message ?? 'no response' });
      } else {
        resolve(resp);
      }
    });
  });
}

export async function activeTabId(): Promise<number> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('no active tab');
  return tab.id;
}
