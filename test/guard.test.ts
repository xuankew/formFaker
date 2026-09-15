import { describe, expect, it } from 'vitest';
import { claimBootstrap, type StampHost } from '../src/content/guard';

const live = () => true;

describe('claimBootstrap', () => {
  it('bootstraps on a fresh page', () => {
    const host: StampHost = {};
    expect(claimBootstrap(host, live)).toBe(true);
    expect(typeof host.__ffLoaded?.alive).toBe('function');
  });

  it('skips bootstrap while the previous instance is still alive', () => {
    const host: StampHost = {};
    claimBootstrap(host, live);
    expect(claimBootstrap(host, live)).toBe(false);
  });

  it('re-bootstraps when the previous extension context died (extension reloaded, page kept)', () => {
    const host: StampHost = {};
    claimBootstrap(host, () => false);
    expect(claimBootstrap(host, live)).toBe(true);
  });

  it('treats a throwing probe as stale', () => {
    const host: StampHost = {
      __ffLoaded: {
        alive: () => {
          throw new Error('Extension context invalidated.');
        },
      },
    };
    expect(claimBootstrap(host, live)).toBe(true);
  });

  it('replaces a legacy boolean flag left by an older build', () => {
    const host = { __ffLoaded: true } as unknown as StampHost;
    expect(claimBootstrap(host, live)).toBe(true);
  });
});
