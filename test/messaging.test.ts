import { describe, expect, it } from 'vitest';
import { hintForUrl } from '../src/shared/messaging';

const RAW = 'Could not establish connection. Receiving end does not exist.';

describe('hintForUrl', () => {
  it('names non-injectable pages instead of leaking the raw Chrome error', () => {
    expect(hintForUrl('chrome://extensions/', RAW)).toContain('chrome://');
    expect(hintForUrl('chrome://extensions/', RAW)).not.toContain(RAW);
    expect(hintForUrl('chrome-extension://abcdef/options.html', RAW)).toContain('扩展页面');
    expect(hintForUrl('about:blank', RAW)).toContain('空白页');
    expect(hintForUrl('https://chromewebstore.google.com/detail/x', RAW)).toContain('应用商店');
  });

  it('asks for a page refresh on normal business pages and keeps the raw error as evidence', () => {
    const hint = hintForUrl('https://erp.example.com/vendor/apply', RAW);
    expect(hint).toContain('刷新本页');
    expect(hint).toContain(RAW);
  });

  it('handles an unreadable tab url', () => {
    expect(hintForUrl(undefined, RAW)).toContain('无法读取当前标签页地址');
  });
});
