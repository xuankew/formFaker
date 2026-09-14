// Long enterprise forms mount sections lazily (IntersectionObserver, v-if on scroll,
// content-visibility), so a single scan at the top of the page misses everything that
// does not exist yet. Walk every scroll container to the bottom, letting the caller
// absorb whatever mounts along the way, then restore the original scroll position.

const CONTAINER_SELECTOR = [
  '.el-scrollbar__wrap',
  '.el-main',
  '.el-table__body-wrapper',
  '.el-dialog__body',
  '.ant-layout-content',
  '.ant-table-body',
  '.ant-modal-body',
  'main',
  '[class*="scroll"]',
].join(',');

const OVERFLOW_RE = /auto|scroll|overlay/;

interface SavedScroll {
  win: number;
  els: { el: HTMLElement; top: number }[];
}

function scrollers(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(CONTAINER_SELECTOR)).filter(
    (el) => el.scrollHeight - el.clientHeight > 8 && OVERFLOW_RE.test(getComputedStyle(el).overflowY),
  );
}

function windowTop(): number {
  return window.scrollY || document.documentElement?.scrollTop || 0;
}

function capture(): SavedScroll {
  return { win: windowTop(), els: scrollers().map((el) => ({ el, top: el.scrollTop })) };
}

function restore(saved: SavedScroll): void {
  if (Math.abs(windowTop() - saved.win) > 1) window.scrollTo?.(0, saved.win);
  for (const { el, top } of saved.els) el.scrollTop = top;
}

function stepDown(): boolean {
  let moved = false;
  const doc = document.documentElement;
  const viewport = window.innerHeight || doc?.clientHeight || 0;
  const max = (doc?.scrollHeight ?? 0) - viewport;
  const next = Math.min(max, windowTop() + Math.round((viewport || 600) * 0.85));
  if (next > windowTop() + 1) {
    window.scrollTo?.(0, next);
    moved = true;
  }
  for (const el of scrollers()) {
    const elMax = el.scrollHeight - el.clientHeight;
    const elNext = Math.min(elMax, el.scrollTop + Math.round((el.clientHeight || 400) * 0.85));
    if (elNext > el.scrollTop + 1) {
      el.scrollTop = elNext;
      moved = true;
    }
  }
  return moved;
}

async function frames(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await new Promise<void>((r) => requestAnimationFrame(() => r()));
}

export interface WalkOptions {
  maxSteps?: number;
  // Stop after this many consecutive steps that yielded nothing new: on a page whose
  // content is fully rendered up front, walking to the bottom buys nothing.
  idleLimit?: number;
}

// onStep returns how many new items the caller absorbed at that step; it may be async
// (the fill path writes values as it goes).
export async function walkScroll(onStep: () => number | Promise<number>, opts: WalkOptions = {}): Promise<void> {
  const { maxSteps = 25, idleLimit = 4 } = opts;
  const saved = capture();
  let idle = 0;
  try {
    for (let step = 0; step < maxSteps; step++) {
      const moved = stepDown();
      await frames(2);
      idle = (await onStep()) > 0 ? 0 : idle + 1;
      if (!moved || idle >= idleLimit) break;
    }
  } finally {
    restore(saved);
  }
}
