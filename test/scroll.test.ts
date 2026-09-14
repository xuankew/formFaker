import { describe, expect, it } from 'vitest';
import { walkScroll } from '../src/core/scan/scroll';
import { scanRevealed } from '../src/core/scan';

const WRAP = '<div class="el-scrollbar__wrap" style="overflow-y:auto"><label for="a">姓名</label><input id="a" /></div>';

// jsdom has no layout, so scroll metrics must be faked to exercise the walk.
function scrollable(scrollHeight: number, clientHeight: number, scrollTop = 0): HTMLElement {
  document.body.innerHTML = WRAP;
  const el = document.querySelector<HTMLElement>('.el-scrollbar__wrap')!;
  Object.defineProperty(el, 'scrollHeight', { value: scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: clientHeight, configurable: true });
  el.scrollTop = scrollTop;
  return el;
}

describe('walkScroll', () => {
  it('steps a scroll container to the bottom, then restores where the user was', async () => {
    const el = scrollable(1000, 200, 50);
    const tops: number[] = [];
    await walkScroll(() => {
      tops.push(el.scrollTop);
      return 1;
    });
    expect(tops.length).toBeGreaterThan(2);
    expect(Math.max(...tops)).toBe(800);
    expect(el.scrollTop).toBe(50);
  });

  it('stops early once steps stop revealing anything new', async () => {
    scrollable(100000, 200);
    let steps = 0;
    await walkScroll(() => {
      steps++;
      return 0;
    });
    expect(steps).toBe(4);
  });

  it('gives up at maxSteps on an endless container', async () => {
    scrollable(100000, 200);
    let steps = 0;
    await walkScroll(() => {
      steps++;
      return 1;
    }, { maxSteps: 6 });
    expect(steps).toBe(6);
  });

  it('collects controls that only mount after their container scrolls', async () => {
    const el = scrollable(1000, 200);
    const seen: string[] = [];
    const known: Element[] = [document.getElementById('a')!];
    await walkScroll(() => {
      if (!document.getElementById('late')) {
        el.insertAdjacentHTML('beforeend', '<label for="late">供应商产能</label><input id="late" />');
      }
      const revealed = scanRevealed(known);
      for (const cand of revealed) {
        seen.push(cand.label);
        known.push(cand.root, ...cand.targets);
      }
      return revealed.length;
    });
    expect(seen).toEqual(['供应商产能']);
  });

  it('is a no-op on a page with nothing to scroll', async () => {
    document.body.innerHTML = WRAP;
    let steps = 0;
    await walkScroll(() => {
      steps++;
      return 0;
    });
    expect(steps).toBe(1);
  });
});
