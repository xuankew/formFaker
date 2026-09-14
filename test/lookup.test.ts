import { beforeAll, describe, expect, it } from 'vitest';
import { scanDocument } from '../src/core/scan';
import { generate } from '../src/core/generators';
import { fillCandidate } from '../src/core/fill/strategies';
import { RANDOM_OPTION_PLACEHOLDER } from '../src/shared/types';
import type { FieldCandidate } from '../src/core/scan';

// jsdom reports a zero rect for everything, which the fill engine reads as "not visible".
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function rect() {
    return { x: 0, y: 0, top: 10, left: 10, bottom: 34, right: 110, width: 100, height: 24, toJSON: () => ({}) } as DOMRect;
  };
});

const shell = (inner: string) => {
  document.body.innerHTML = `<div class="el-form-item"><label class="el-form-item__label">清算会员号</label>${inner}</div>`;
  return document.querySelector('input') as HTMLInputElement;
};

describe('lookup scan', () => {
  it('keeps a readonly input with a picker icon fillable instead of skipping it', () => {
    const input = shell('<div class="el-input"><input readonly placeholder="请选择" /><span class="el-input__suffix"><i class="el-icon-search"></i></span></div>');
    const cand = scanDocument(document).find((c) => c.root === input);
    expect(cand?.kind).toBe('lookup');
    expect(cand?.skipped).toBeUndefined();
    expect(cand?.trigger?.className).toContain('el-icon-search');
  });

  it('finds a sibling trigger button outside the input wrapper', () => {
    const input = shell('<div class="el-input"><input readonly placeholder="请选择" /></div><button type="button">选择</button>');
    const cand = scanDocument(document).find((c) => c.root === input);
    expect(cand?.kind).toBe('lookup');
    expect(cand?.trigger?.textContent).toBe('选择');
  });

  it('still skips readonly and disabled inputs with no picker affordance', () => {
    const plain = shell('<div class="el-input"><input readonly placeholder="企业级账号" /></div>');
    expect(scanDocument(document).find((c) => c.root === plain)).toMatchObject({ skipped: true, reason: '禁用/只读' });

    const disabled = shell('<div class="el-input is-disabled"><input disabled /><span class="el-input__suffix"><i class="el-icon-search"></i></span></div>');
    expect(scanDocument(document).find((c) => c.root === disabled)).toMatchObject({ skipped: true, reason: '禁用/只读' });
  });

  it('leaves an editable input alone even when a search icon sits next to it', () => {
    const input = shell('<div class="el-input"><input placeholder="请输入" /><span class="el-input__suffix"><i class="el-icon-search"></i></span></div>');
    expect(scanDocument(document).find((c) => c.root === input)?.kind).toBe('text');
  });

  it('generates the random-pick placeholder since the value comes from a record', () => {
    const value = generate({ kind: 'lookup', semantic: 'enum', label: '清算会员号' });
    expect(value).toBe(RANDOM_OPTION_PLACEHOLDER);
  });
});

const DIALOG_HTML = `
  <div class="el-overlay"><div class="el-dialog" style="display:none">
    <button class="el-dialog__headerbtn">×</button>
    <div class="el-dialog__body">
      <table><thead><tr><th>选择</th><th>会员号</th></tr></thead>
      <tbody>
        <tr><td><input type="radio" name="pick" /></td><td>A001</td></tr>
        <tr><td><input type="radio" name="pick" /></td><td>A002</td></tr>
      </tbody></table>
    </div>
    <div class="el-dialog__footer"><button class="el-button">取消</button><button class="el-button el-button--primary">确定</button></div>
  </div></div>
`;

function mountLookup(dialogHtml: string, onConfirm: (row: HTMLTableRowElement) => string) {
  const input = shell(`<div class="el-input"><input readonly placeholder="请选择" /><span class="el-input__suffix"><i class="el-icon-search"></i></span></div>${dialogHtml}`);
  const dialog = document.querySelector('.el-dialog') as HTMLElement;
  const trigger = document.querySelector('.el-icon-search') as HTMLElement;
  trigger.addEventListener('click', () => {
    dialog.style.display = '';
  });
  const footer = Array.from(dialog.querySelectorAll('button')).find((b) => /确\s*定/.test(b.textContent ?? ''))!;
  footer.addEventListener('click', () => {
    const row = dialog.querySelector('tbody tr') as HTMLTableRowElement;
    input.value = onConfirm(row);
    dialog.style.display = 'none';
  });
  const cand: FieldCandidate = { label: '清算会员号', kind: 'lookup', root: input, targets: [input], trigger };
  return { input, dialog, cand };
}

describe('lookup fill', () => {
  it('opens the dialog, picks the first record and confirms', async () => {
    const { input, dialog, cand } = mountLookup(DIALOG_HTML, (row) => row.cells[1].textContent ?? '');
    await fillCandidate(cand, RANDOM_OPTION_PLACEHOLDER);
    expect(input.value).toBe('A001');
    expect(dialog.style.display).toBe('none');
  });

  it('runs the dialog query first when the list starts empty', async () => {
    const input = shell(`
      <div class="el-input"><input readonly placeholder="请选择" /><span class="el-input__suffix"><i class="el-icon-search"></i></span></div>
      <div class="el-overlay"><div class="el-dialog" style="display:none">
        <div class="el-dialog__body">
          <input class="kw" placeholder="关键词" /><button class="query">查询</button>
          <table><thead><tr><th>联行号</th></tr></thead><tbody></tbody></table>
        </div>
        <div class="el-dialog__footer"><button class="ok">确定</button></div>
      </div></div>
    `);
    const dialog = document.querySelector('.el-dialog') as HTMLElement;
    const trigger = document.querySelector('.el-icon-search') as HTMLElement;
    trigger.addEventListener('click', () => { dialog.style.display = ''; });
    dialog.querySelector('.query')!.addEventListener('click', () => {
      dialog.querySelector('tbody')!.innerHTML = '<tr><td>B100</td></tr>';
    });
    dialog.querySelector('.ok')!.addEventListener('click', () => {
      input.value = dialog.querySelector('tbody tr td')!.textContent ?? '';
      dialog.style.display = 'none';
    });
    const cand: FieldCandidate = { label: '联行号', kind: 'lookup', root: input, targets: [input], trigger };
    await fillCandidate(cand, RANDOM_OPTION_PLACEHOLDER);
    expect(input.value).toBe('B100');
    expect(dialog.style.display).toBe('none');
  });

  it('reports a missing dialog instead of hanging', async () => {
    const input = shell('<div class="el-input"><input readonly /><span class="el-input__suffix"><i class="el-icon-search"></i></span></div>');
    const trigger = document.querySelector('.el-icon-search') as HTMLElement;
    const cand: FieldCandidate = { label: '联行号', kind: 'lookup', root: input, targets: [input], trigger };
    await expect(fillCandidate(cand, RANDOM_OPTION_PLACEHOLDER)).rejects.toThrow('点击后未弹出选择窗口');
  });

  it('closes the dialog again when it holds no selectable record', async () => {
    const empty = DIALOG_HTML.replace(/<tr><td><input type="radio" name="pick" \/><\/td><td>A00\d<\/td><\/tr>/g, '');
    const { dialog, cand } = mountLookup(empty, () => '');
    let closed = 0;
    (dialog.querySelector('.el-dialog__headerbtn') as HTMLElement).addEventListener('click', () => {
      dialog.style.display = 'none';
      closed++;
    });
    await expect(fillCandidate(cand, RANDOM_OPTION_PLACEHOLDER)).rejects.toThrow('弹窗内没有可选记录');
    expect(closed).toBe(1);
    expect(dialog.style.display).toBe('none');
  });

  it('waits for records that arrive after the dialog opens', async () => {
    const { input, cand, dialog } = mountLookup(DIALOG_HTML, (row) => row.cells[1].textContent ?? '');
    dialog.querySelector('tbody')!.innerHTML = '';
    dialog.querySelector('.el-dialog__headerbtn')!.addEventListener('click', () => { dialog.style.display = 'none'; });
    const trigger = document.querySelector('.el-icon-search') as HTMLElement;
    trigger.addEventListener('click', () => {
      setTimeout(() => {
        dialog.querySelector('tbody')!.innerHTML = '<tr><td></td><td>C777</td></tr>';
      }, 200);
    });
    await fillCandidate(cand, RANDOM_OPTION_PLACEHOLDER);
    expect(input.value).toBe('C777');
  });

  it('recognises a confirm button whose label carries whitespace', async () => {
    const spaced = DIALOG_HTML.replace('>确定</button>', '>确 定</button>');
    const { input, cand } = mountLookup(spaced, (row) => row.cells[1].textContent ?? '');
    await fillCandidate(cand, RANDOM_OPTION_PLACEHOLDER);
    expect(input.value).toBe('A001');
  });

  it('falls back to clicking the row when the radio wrapper swallows the click', async () => {
    const wrapped = DIALOG_HTML.replace(
      /<input type="radio" name="pick" \/>/g,
      '<span class="el-radio"><input type="radio" name="pick" /></span>',
    );
    const { input, cand, dialog } = mountLookup(wrapped, (row) => row.cells[1].textContent ?? '');
    const firstRow = dialog.querySelector('tbody tr') as HTMLElement;
    let directRowClicks = 0;
    // The wrapper click bubbles up to the row as well; only a click aimed at the row
    // itself proves the fallback ran.
    firstRow.addEventListener('click', (e) => { if (e.target === firstRow) directRowClicks++; });
    await fillCandidate(cand, RANDOM_OPTION_PLACEHOLDER);
    expect(directRowClicks).toBe(1);
    expect(input.value).toBe('A001');
  });
});
