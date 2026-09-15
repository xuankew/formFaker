import type { ContentRequest, ContentResponse, InjectRequest, InjectResponse } from './types';

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

// 返回注入失败原因；成功时为 undefined。
export async function reinject(tabId: number): Promise<string | undefined> {
  try {
    const req: InjectRequest = { type: 'ensureInject', tabId };
    const r = await chrome.runtime.sendMessage<InjectRequest, InjectResponse>(req);
    return r?.ok ? undefined : (r?.error ?? '注入失败');
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

const NON_INJECTABLE: { re: RegExp; label: string }[] = [
  { re: /^chrome:/i, label: '浏览器内部页面（chrome://）' },
  { re: /^chrome-untrusted:/i, label: '浏览器内部页面' },
  { re: /^chrome-extension:/i, label: '扩展页面' },
  { re: /^edge:/i, label: '浏览器内部页面（edge://）' },
  { re: /^about:/i, label: '空白页' },
  { re: /^view-source:/i, label: '网页源码视图' },
  { re: /^devtools:/i, label: '开发者工具' },
  { re: /^https:\/\/(?:chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i, label: 'Chrome 应用商店页面' },
];

// 面板红字是用户唯一会截图回传的证据，所以给可操作提示而不是 Chrome 原文；
// 原因不明时把原文附在括号里，便于后续定位。
export function hintForUrl(url: string | undefined, raw: string): string {
  if (!url) return `无法读取当前标签页地址，请切到业务页面后重试。（${raw}）`;
  const hit = NON_INJECTABLE.find((n) => n.re.test(url));
  if (hit) return `无法在${hit.label}运行，请切到普通网页（http/https）后点「重新识别」。`;
  return `当前页面未能注入脚本，请刷新本页后点「重新识别」。（${raw}）`;
}

export async function unreachableHint(tabId: number, raw: string): Promise<string> {
  let url: string | undefined;
  try {
    url = (await chrome.tabs.get(tabId)).url;
  } catch {
    // 标签页已关闭或无权限读取 URL
  }
  return hintForUrl(url, raw);
}
