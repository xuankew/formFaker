import { beforeAll, describe, expect, it } from 'vitest';
import { scanDocument } from '../src/core/scan';
import { generate } from '../src/core/generators';
import { defaultCatalog } from '../src/core/rules/catalog';
import { fillCandidate } from '../src/core/fill/strategies';
import { RANDOM_OPTION_PLACEHOLDER } from '../src/shared/types';
import type { FieldCandidate } from '../src/core/scan';

// jsdom reports a zero rect for everything, which the fill engine reads as "not visible".
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function rect() {
    return { x: 0, y: 0, top: 10, left: 10, bottom: 34, right: 110, width: 100, height: 24, toJSON: () => ({}) } as DOMRect;
  };
});

const shellLabeled = (label: string, inner: string) => {
  document.body.innerHTML = `<div class="el-form-item"><label class="el-form-item__label">${label}</label>${inner}</div>`;
  return document.querySelector('input') as HTMLInputElement;
};

const shell = (inner: string) => shellLabeled('清算会员号', inner);

// 记录是随机挑的，所以断言只能落在候选集合上，不能写死第一条。
const MEMBER_NOS = ['A001', 'A002'];
const TAX_CODES = ['1010101', '1010102'];
const TAX_NAMES = ['稻谷', '小麦'];

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
    const value = generate({ kind: 'lookup', ruleId: 'enum', label: '客户编号', catalog: defaultCatalog() });
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
    // 真实弹窗的确定提交的是被勾选的那一行，不是固定第一行。
    const checked = dialog.querySelector<HTMLInputElement>('tbody input[name="pick"]:checked');
    const row = (checked?.closest('tr') ?? dialog.querySelector('tbody tr')) as HTMLTableRowElement;
    input.value = onConfirm(row);
    dialog.style.display = 'none';
  });
  const cand: FieldCandidate = { label: '清算会员号', kind: 'lookup', root: input, targets: [input], trigger };
  return { input, dialog, cand };
}

describe('lookup fill', () => {
  it('opens the dialog, picks a record at random and confirms', async () => {
    const { input, dialog, cand } = mountLookup(DIALOG_HTML, (row) => row.cells[1].textContent ?? '');
    await fillCandidate(cand, RANDOM_OPTION_PLACEHOLDER);
    expect(MEMBER_NOS).toContain(input.value);
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
    expect(MEMBER_NOS).toContain(input.value);
  });

  it('falls back to clicking the row when the radio wrapper swallows the click', async () => {
    const wrapped = DIALOG_HTML.replace(
      /<input type="radio" name="pick" \/>/g,
      '<span class="el-radio"><input type="radio" name="pick" /></span>',
    );
    const { input, cand, dialog } = mountLookup(wrapped, (row) => row.cells[1].textContent ?? '');
    let directRowClicks = 0;
    // The wrapper click bubbles up to the row as well; only a click aimed at the row
    // itself proves the fallback ran.
    for (const row of Array.from(dialog.querySelectorAll<HTMLElement>('tbody tr'))) {
      row.addEventListener('click', (e) => { if (e.target === row) directRowClicks++; });
    }
    await fillCandidate(cand, RANDOM_OPTION_PLACEHOLDER);
    expect(directRowClicks).toBe(1);
    expect(MEMBER_NOS).toContain(input.value);
  });
});

// 真实形态（企业系统「查询税收编码」）：没有 footer、没有单选列，提交靠每行 操作 列的「选择」链接。
const taxDialog = (actionHtml: string) => `
  <div class="el-overlay"><div class="el-dialog" style="display:none">
    <div class="el-dialog__header"><span class="el-dialog__title">选择税收编码</span><button class="el-dialog__headerbtn">×</button></div>
    <div class="el-dialog__body">
      <input class="kw" placeholder="请输入税收编码" />
      <button class="el-button">搜索</button><button class="el-button">重置</button><button class="el-button">新增</button>
      <div class="el-table">
        <table class="el-table__header-wrapper"><thead><tr><th>税收编码</th><th>货物和劳务名称</th><th>税率</th><th>操作</th></tr></thead></table>
        <table class="el-table__body-wrapper"><tbody>
          <tr><td>1010101</td><td>稻谷</td><td>9%</td><td>${actionHtml}</td></tr>
          <tr><td>1010102</td><td>小麦</td><td>9%</td><td>${actionHtml}</td></tr>
        </tbody></table>
      </div>
    </div>
  </div></div>
`;

const TAX_FIELD = '<div class="el-input"><input readonly placeholder="请选择" /><span class="el-input__suffix"><i class="el-icon-search"></i></span></div>';

function mountDialog(label: string, dialogHtml: string, onPick: (row: HTMLTableRowElement) => string | null) {
  const input = shellLabeled(label, `${TAX_FIELD}${dialogHtml}`);
  const dialog = document.querySelector('.el-dialog') as HTMLElement;
  const trigger = document.querySelector('.el-icon-search') as HTMLElement;
  trigger.addEventListener('click', () => { dialog.style.display = ''; });
  dialog.querySelector('.el-dialog__headerbtn')!.addEventListener('click', () => { dialog.style.display = 'none'; });
  for (const pick of Array.from(dialog.querySelectorAll<HTMLElement>('.pick'))) {
    pick.addEventListener('click', () => {
      const value = onPick(pick.closest('tr') as HTMLTableRowElement);
      if (value !== null) input.value = value;
      dialog.style.display = 'none';
    });
  }
  const cand: FieldCandidate = { label, kind: 'lookup', root: input, targets: [input], trigger };
  return { input, dialog, cand };
}

function mountTax(label: string, actionHtml: string, onPick: (row: HTMLTableRowElement) => string | null) {
  return mountDialog(label, taxDialog(actionHtml), onPick);
}

// 固定右列（AntD v3 / Element UI 克隆表）：可点的「选择」在兄弟表格的同序号行里，
// 我们自己那行里的同名链接被覆盖层挡住，点它没有任何反应。
const fixedRightDialog = `
  <div class="el-overlay"><div class="el-dialog" style="display:none">
    <div class="el-dialog__header"><button class="el-dialog__headerbtn">×</button></div>
    <div class="el-dialog__body">
      <div class="el-table">
        <table class="el-table__header-wrapper"><thead><tr><th>税收编码</th><th>货物和劳务名称</th><th>操作</th></tr></thead></table>
        <table class="el-table__body-wrapper"><tbody>
          <tr><td>1010101</td><td>稻谷</td><td><a class="el-link covered">选择</a></td></tr>
          <tr><td>1010102</td><td>小麦</td><td><a class="el-link covered">选择</a></td></tr>
        </tbody></table>
        <div class="el-table__fixed-right">
          <table class="el-table__fixed-body-wrapper"><tbody>
            <tr><td><a class="el-link pick">选择</a></td></tr>
            <tr><td><a class="el-link pick">选择</a></td></tr>
          </tbody></table>
        </div>
      </div>
    </div>
  </div></div>
`;

describe('lookup fill: 真实页加固', () => {
  it('reaches the commit control inside a fixed-column clone table', async () => {
    // 克隆行只有 操作 一格，记录要靠行序号还原——和真实组件一样。
    const { input, dialog, cand } = mountDialog('税收编码', fixedRightDialog, (row) => {
      const idx = Array.from(row.parentElement!.children).indexOf(row);
      return ['1010101', '1010102'][idx] ?? '';
    });
    await fillCandidate(cand, RANDOM_OPTION_PLACEHOLDER);
    expect(TAX_CODES).toContain(input.value);
    expect(dialog.style.display).toBe('none');
  });

  it('finds an action rendered as a leaf node no selector covers', async () => {
    const { input, cand } = mountTax('税收编码', '<div class="op edit">编辑</div><div class="op pick">选择</div>', (row) => row.cells[0].textContent ?? '');
    await fillCandidate(cand, RANDOM_OPTION_PLACEHOLDER);
    expect(TAX_CODES).toContain(input.value);
  });

  it('clicks the inner node when that is where the handler sits', async () => {
    // el-link 的 DOM 形态，但监听绑在内层 span 上：点外层 <a> 不会触发它。
    const { input, cand } = mountTax(
      '税收编码',
      '<a class="el-link"><span class="el-link__inner pick">选择</span></a>',
      (row) => row.cells[0].textContent ?? '',
    );
    await fillCandidate(cand, RANDOM_OPTION_PLACEHOLDER);
    expect(TAX_CODES).toContain(input.value);
  });

  it('writes the record back again when the framework reverts the first write', async () => {
    const { input, cand } = mountTax('货物和劳务名称', '<a class="el-link pick">选择</a>', () => null);
    let writes = 0;
    let reverts = 0;
    input.addEventListener('input', () => {
      writes++;
      if (reverts === 0) {
        reverts++;
        input.value = '';
      }
    });
    await fillCandidate(cand, RANDOM_OPTION_PLACEHOLDER);
    expect(reverts).toBe(1);
    expect(writes).toBe(2);
    expect(TAX_NAMES).toContain(input.value);
  });

  it('reports a picker that closes itself without the value sticking', async () => {
    const { input, cand } = mountTax('货物和劳务名称', '<a class="el-link pick">选择</a>', () => null);
    input.addEventListener('input', () => { input.value = ''; });
    const err = await fillCandidate(cand, RANDOM_OPTION_PLACEHOLDER).then(
      () => new Error('expected fillLookup to fail'),
      (e: Error) => e,
    );
    expect(err.message).toContain('closed=true');
    expect(err.message).toMatch(/record=(稻谷|小麦)/);
  });

  it('reports the dialog DOM inventory when nothing commits', async () => {
    const { input, cand } = mountTax('税收编码', '<span class="muted">查看</span>', () => null);
    // 框架自己持有该字段的值，脚本写入会被立刻还原——真实页最难的一种。
    input.addEventListener('input', () => { input.value = ''; });
    const err = await fillCandidate(cand, RANDOM_OPTION_PLACEHOLDER).then(
      () => new Error('expected fillLookup to fail'),
      (e: Error) => e,
    );
    expect(err.message).toContain('选择后未回填到输入框');
    expect(err.message).toContain('rows=2 leaves=2 tables=2');
    expect(err.message).toContain('input=live:""');
    expect(err.message).toContain('actions=span.muted:查看');
  });
});

describe('lookup fill: 行内提交', () => {
  it('clicks the row-level 选择 link and never 编辑', async () => {
    let edits = 0;
    const { input, dialog, cand } = mountTax('税收编码', '<a class="el-link edit">编辑</a><a class="el-link pick">选择</a>', (row) => row.cells[0].textContent ?? '');
    for (const el of Array.from(dialog.querySelectorAll('.edit'))) el.addEventListener('click', () => { edits++; });
    await fillCandidate(cand, RANDOM_OPTION_PLACEHOLDER);
    expect(TAX_CODES).toContain(input.value);
    expect(edits).toBe(0);
    expect(dialog.style.display).toBe('none');
  });

  it('finds the commit control when it is a plain span', async () => {
    const { input, cand } = mountTax('税收编码', '<span class="op edit">编辑</span><span class="op pick">选择</span>', (row) => row.cells[0].textContent ?? '');
    await fillCandidate(cand, RANDOM_OPTION_PLACEHOLDER);
    expect(TAX_CODES).toContain(input.value);
  });

  it('writes the record back itself when the dialog closes without filling the input', async () => {
    const { input, cand } = mountTax('货物和劳务名称', '<a class="el-link pick">选择</a>', () => null);
    await fillCandidate(cand, RANDOM_OPTION_PLACEHOLDER);
    expect(TAX_NAMES).toContain(input.value);
  });

  it('falls back to the first data cell when no header matches the field label', async () => {
    const { input, cand } = mountTax('商品编码', '<a class="el-link pick">选择</a>', () => null);
    await fillCandidate(cand, RANDOM_OPTION_PLACEHOLDER);
    expect(TAX_CODES).toContain(input.value);
  });
});

describe('lookup fill: 随机选择', () => {
  it('does not always take the first record', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 12; i++) {
      const { input, cand } = mountLookup(DIALOG_HTML, (row) => row.cells[1].textContent ?? '');
      await fillCandidate(cand, RANDOM_OPTION_PLACEHOLDER);
      seen.add(input.value);
    }
    // 12 次全落在同一条的概率约 0.05%，出现即说明又退回「永远第一条」。
    expect(seen.size).toBe(MEMBER_NOS.length);
    expect([...seen].every((v) => MEMBER_NOS.includes(v))).toBe(true);
  });
});

// 真实形态（企业系统「选择跟进组织」）：Element Plus el-tree，父节点是组织组、叶子才是公司。
// EP 默认 render-after-expand，折叠节点的子树根本不在 DOM 里。
const treeNode = (label: string, leaf: boolean, children = '') => `
  <div class="el-tree-node is-focusable" role="treeitem" aria-expanded="${children ? 'true' : 'false'}">
    <div class="el-tree-node__content">
      <span class="el-tree-node__expand-icon${leaf ? ' is-leaf' : ''}"><i class="el-icon"></i></span>
      <label class="el-radio"><input type="radio" name="org" /><span class="el-radio__label">${label}</span></label>
    </div>
    ${children ? `<div class="el-tree-node__children" role="group">${children}</div>` : ''}
  </div>`;

const ORG_BRANCH = 'VN01 越南大区';
const ORG_LEAVES = ['HW050001 星海环球有限公司', 'MY0201 南洋贸易有限公司', 'GYS202609190001 中原供应商'];
const ORG_TREE = `
  <div class="el-tree" role="tree">
    ${treeNode(ORG_BRANCH, false, treeNode(ORG_LEAVES[0], true) + treeNode(ORG_LEAVES[1], true))}
    ${treeNode(ORG_LEAVES[2], true)}
  </div>`;

function mountTree(treeHtml: string, opts: { toolbar?: string; commit?: boolean } = {}) {
  const { toolbar = '', commit = true } = opts;
  const input = shellLabeled('跟进组织', `${TAX_FIELD}
    <div class="el-overlay"><div class="el-dialog" style="display:none">
      <div class="el-dialog__header"><span class="el-dialog__title">选择跟进组织</span><button class="el-dialog__headerbtn">×</button></div>
      <div class="el-dialog__body">${toolbar}${treeHtml}</div>
      <div class="el-dialog__footer"><button class="el-button">取消</button><button class="el-button el-button--primary ok">确定</button></div>
    </div></div>`);
  const dialog = document.querySelector('.el-dialog') as HTMLElement;
  const trigger = document.querySelector('.el-icon-search') as HTMLElement;
  trigger.addEventListener('click', () => { dialog.style.display = ''; });
  dialog.querySelector('.el-dialog__headerbtn')!.addEventListener('click', () => { dialog.style.display = 'none'; });
  dialog.querySelector('.ok')!.addEventListener('click', () => {
    if (commit) {
      const checked = dialog.querySelector<HTMLInputElement>('input[name="org"]:checked');
      input.value = checked?.closest('label')?.querySelector('.el-radio__label')?.textContent ?? '';
    }
    dialog.style.display = 'none';
  });
  const cand: FieldCandidate = { label: '跟进组织', kind: 'lookup', root: input, targets: [input], trigger };
  return { input, dialog, cand };
}

describe('lookup fill: 树形弹窗', () => {
  it('picks a leaf at random and never the branch node', async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const { input, cand } = mountTree(ORG_TREE);
      await fillCandidate(cand, RANDOM_OPTION_PLACEHOLDER);
      expect(ORG_LEAVES).toContain(input.value);
      seen.add(input.value);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it('expands once when every rendered node is a branch', async () => {
    const { input, dialog, cand } = mountTree(
      `<div class="el-tree" role="tree">${treeNode(ORG_BRANCH, false)}</div>`,
      { toolbar: '<span class="el-link expand">展开1级</span>' },
    );
    let expands = 0;
    dialog.querySelector('.expand')!.addEventListener('click', () => {
      expands++;
      dialog.querySelector('.el-tree')!.innerHTML = treeNode(ORG_BRANCH, false, treeNode(ORG_LEAVES[0], true));
    });
    await fillCandidate(cand, RANDOM_OPTION_PLACEHOLDER);
    expect(expands).toBe(1);
    expect(input.value).toBe(ORG_LEAVES[0]);
  });

  it('falls back to a branch when the tree holds no leaf at all', async () => {
    const { input, cand } = mountTree(
      `<div class="el-tree" role="tree">${treeNode(ORG_BRANCH, false)}${treeNode('MY02 马来分部', false)}</div>`,
    );
    await fillCandidate(cand, RANDOM_OPTION_PLACEHOLDER);
    expect([ORG_BRANCH, 'MY02 马来分部']).toContain(input.value);
  });

  it('reads only the chosen node own line, not its whole subtree', async () => {
    // 自定义选择器：确定后自己关掉但不写值，回填只能靠我们读到的 record。
    const { input, cand } = mountTree(ORG_TREE, { commit: false });
    await fillCandidate(cand, RANDOM_OPTION_PLACEHOLDER);
    expect(ORG_LEAVES).toContain(input.value);
  });
});
