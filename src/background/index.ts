async function ensureInjected(tabId: number): Promise<void> {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch {
    // chrome:// pages and web store reject injection; panel will surface the error
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
    ensureInjected(tabId).then(
      () => sendResponse({ ok: true }),
      (err) => sendResponse({ ok: false, error: String(err) }),
    );
    return true;
  }
  void sender;
  return false;
});
