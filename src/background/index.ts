import type { InjectResponse } from '../shared/types';

async function ensureInjected(tabId: number): Promise<InjectResponse> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// The popup opens automatically on action click (manifest default_popup), so the
// background only needs to serve on-demand content-script injection.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'ensureInject') {
    const tabId = msg.tabId as number | undefined;
    if (tabId == null) {
      sendResponse({ ok: false, error: 'no tabId' });
      return false;
    }
    ensureInjected(tabId).then(sendResponse);
    return true;
  }
  void sender;
  return false;
});
