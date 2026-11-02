import { describe, expect, it } from 'vitest';
import { clearCandidate, fillCandidate, hasExistingValue, restoreSnapshot, takeSnapshot } from '../src/core/fill/strategies';
import type { FieldCandidate } from '../src/core/scan';
import { RANDOM_OPTION_PLACEHOLDER } from '../src/shared/types';

const cand = (kind: FieldCandidate['kind'], targets: HTMLElement[], extra: Partial<FieldCandidate> = {}): FieldCandidate => ({
  label: 'x',
  kind,
  root: targets[0],
  targets,
  ...extra,
});

describe('fill native paths', () => {
  it('sets input value and fires input/change events', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    const seen: string[] = [];
    input.addEventListener('input', () => seen.push('input'));
    input.addEventListener('change', () => seen.push('change'));
    await fillCandidate(cand('text', [input]), 'hello');
    expect(input.value).toBe('hello');
    expect(seen).toEqual(['input', 'change']);
  });

  it('selects native option by text', async () => {
    const select = document.createElement('select');
    select.innerHTML = '<option value="">请选择</option><option value="a">甲</option><option value="b">乙</option>';
    document.body.appendChild(select);
    await fillCandidate(cand('select', [select]), '乙');
    expect(select.value).toBe('b');
  });

  it('never falls back to the placeholder option', async () => {
    const select = document.createElement('select');
    select.innerHTML = '<option value="">请选择</option><option value="a">甲</option><option value="b">乙</option>';
    document.body.appendChild(select);
    await fillCandidate(cand('select', [select]), RANDOM_OPTION_PLACEHOLDER);
    expect(['a', 'b']).toContain(select.value);
    await fillCandidate(cand('select', [select]), '不存在的选项');
    expect(['a', 'b']).toContain(select.value);
  });

  it('对不上文案时随机挑一项，而不是恒定第一个', async () => {
    const select = document.createElement('select');
    select.innerHTML =
      '<option value="">请选择</option><option value="a">甲</option><option value="b">乙</option><option value="c">丙</option>';
    document.body.appendChild(select);
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      await fillCandidate(cand('select', [select]), RANDOM_OPTION_PLACEHOLDER);
      seen.add(select.value);
    }
    expect(seen.size).toBeGreaterThan(1);
    for (const v of seen) expect(['a', 'b', 'c']).toContain(v);
  });

  it('文案对得上时仍精确选中，随机只用于兜底', async () => {
    const select = document.createElement('select');
    select.innerHTML = '<option value="">请选择</option><option value="a">甲</option><option value="b">乙</option>';
    document.body.appendChild(select);
    for (let i = 0; i < 20; i++) {
      await fillCandidate(cand('select', [select]), '乙');
      expect(select.value).toBe('b');
    }
  });

  it('toggles checkbox to desired state only', async () => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    document.body.appendChild(input);
    await fillCandidate(cand('checkbox', [input]), 'true');
    expect(input.checked).toBe(true);
    await fillCandidate(cand('checkbox', [input]), 'true');
    expect(input.checked).toBe(true);
    await fillCandidate(cand('checkbox', [input]), 'false');
    expect(input.checked).toBe(false);
  });

  it('picks radio by label text', async () => {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<label><input type="radio" name="g" />男</label><label><input type="radio" name="g" />女</label>';
    document.body.appendChild(wrap);
    const radios = Array.from(wrap.querySelectorAll<HTMLInputElement>('input'));
    await fillCandidate(cand('radio-group', radios, { optionTexts: ['男', '女'] }), '女');
    expect(radios[1].checked).toBe(true);
    expect(radios[0].checked).toBe(false);
  });

  it('reports existing values for overwrite mode', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    expect(hasExistingValue(cand('text', [input]))).toBe(false);
    await fillCandidate(cand('text', [input]), 'v');
    expect(hasExistingValue(cand('text', [input]))).toBe(true);
  });

  it('undo restores previous values', async () => {
    const input = document.createElement('input');
    input.value = 'original';
    document.body.appendChild(input);
    const snaps = takeSnapshot([input]);
    await fillCandidate(cand('text', [input]), 'filled');
    expect(input.value).toBe('filled');
    restoreSnapshot(snaps);
    expect(input.value).toBe('original');
  });
});

describe('clear native paths', () => {
  it('clears a filled text input and fires events', async () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    await fillCandidate(cand('text', [input]), 'hello');
    const seen: string[] = [];
    input.addEventListener('input', () => seen.push('input'));
    input.addEventListener('change', () => seen.push('change'));
    const ok = await clearCandidate(cand('text', [input]));
    expect(ok).toBe(true);
    expect(input.value).toBe('');
    expect(seen).toEqual(['input', 'change']);
  });

  it('unchecks a checked checkbox', async () => {
    const input = document.createElement('input');
    input.type = 'checkbox';
    document.body.appendChild(input);
    await fillCandidate(cand('checkbox', [input]), 'true');
    expect(input.checked).toBe(true);
    await clearCandidate(cand('checkbox', [input]));
    expect(input.checked).toBe(false);
  });

  it('resets a native select to the empty option', async () => {
    const select = document.createElement('select');
    select.innerHTML = '<option value="">请选择</option><option value="a">甲</option><option value="b">乙</option>';
    document.body.appendChild(select);
    await fillCandidate(cand('select', [select]), '乙');
    expect(select.value).toBe('b');
    await clearCandidate(cand('select', [select]));
    expect(select.value).toBe('');
  });

  it('unchecks every radio in a radio group', async () => {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<label><input type="radio" name="g" />男</label><label><input type="radio" name="g" />女</label>';
    document.body.appendChild(wrap);
    const radios = Array.from(wrap.querySelectorAll<HTMLInputElement>('input'));
    await fillCandidate(cand('radio-group', radios, { optionTexts: ['男', '女'] }), '女');
    expect(radios[1].checked).toBe(true);
    await clearCandidate(cand('radio-group', radios, { optionTexts: ['男', '女'] }));
    expect(radios[0].checked).toBe(false);
    expect(radios[1].checked).toBe(false);
  });

  it('empties a textarea', async () => {
    const ta = document.createElement('textarea');
    document.body.appendChild(ta);
    await fillCandidate(cand('textarea', [ta]), 'multi\nline');
    expect(ta.value).toBe('multi\nline');
    await clearCandidate(cand('textarea', [ta]));
    expect(ta.value).toBe('');
  });

  it('empties a contenteditable richtext node', async () => {
    const div = document.createElement('div');
    div.contentEditable = 'true';
    document.body.appendChild(div);
    await fillCandidate(cand('richtext', [div]), 'rich text');
    expect(div.innerHTML).toContain('rich text');
    await clearCandidate(cand('richtext', [div]));
    expect(div.innerHTML).toBe('');
  });
});
