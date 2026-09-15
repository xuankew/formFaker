import { describe, expect, it, beforeEach } from 'vitest';
import { auditEntries, liveValue, type AuditEntry } from '../src/dev/audit';
import type { FieldCandidate } from '../src/core/scan';
import type { Kind } from '../src/shared/types';

function mount(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

function inputItem(label: string, value: string, kind: Kind = 'text'): AuditEntry {
  mount(
    `<div class="el-form-item"><label class="el-form-item__label">${label}</label>` +
      `<div class="el-input"><input class="el-input__inner" value=""></div></div>`,
  );
  const input = document.querySelector('input')!;
  input.value = value;
  const cand: FieldCandidate = { label, kind, root: document.querySelector('.el-input')!, targets: [input] };
  return { cand, value };
}

function uploadItem(label: string, kind: 'upload-image' | 'upload-file', file: { name: string; type: string }, hint = ''): AuditEntry {
  mount(
    `<div class="el-form-item"><label class="el-form-item__label">${label}</label>` +
      `<span class="hint">${hint}</span><div class="el-upload"><input type="file"></div></div>`,
  );
  const input = document.querySelector('input')!;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  const cand: FieldCandidate = { label, kind, root: document.querySelector('.el-upload')!, targets: [input], accept: '' };
  return { cand, value: kind === 'upload-image' ? '[图片 a.png]' : '[文件 a.pdf]' };
}

describe('audit 不变量', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('合规字段不产生违规', async () => {
    const entries = [
      inputItem('联系人手机号', '13800138000'),
      inputItem('电子邮箱', 'zhang@example.com'),
      inputItem('实际运营时间（年）', '8'),
      inputItem('注册地址', '浙江省杭州市西湖区文一路100号'),
    ];
    const report = await auditEntries(entries);
    expect(report.checked).toBe(4);
    expect(report.violations).toEqual([]);
  });

  it('语义错位：纳税人识别号落到 generic', async () => {
    const report = await auditEntries([inputItem('纳税人识别号', 'autotest-k3j2h')]);
    expect(report.violations).toEqual([
      expect.objectContaining({ label: '纳税人识别号', rule: 'semantic-miss', semantic: 'generic' }),
    ]);
    expect(report.violations[0].got).toContain('creditCode');
  });

  it('值形态：手机号语义却填了非号段值', async () => {
    const report = await auditEntries([inputItem('手机号', '12345678901')]);
    expect(report.violations.map((v) => v.rule)).toEqual(['value-shape']);
  });

  it('开户行名被填成银行卡号', async () => {
    const report = await auditEntries([inputItem('开户银行', '6222021234567890123')]);
    expect(report.violations.map((v) => v.rule)).toEqual(['value-shape']);
  });

  it('填充后仍为空 → empty', async () => {
    const report = await auditEntries([inputItem('联系人', '')]);
    expect(report.violations.map((v) => [v.rule, v.got])).toEqual([['empty', '填充后字段仍为空']]);
  });

  it('填充抛错 → fill-error 且带原文', async () => {
    const entry = inputItem('联系人', '张三');
    entry.error = '上传被页面拒绝 items=0/fail=0 msg=图片格式不正确';
    const report = await auditEntries([entry]);
    expect(report.violations.map((v) => v.rule)).toEqual(['fill-error']);
    expect(report.violations[0].got).toContain('图片格式不正确');
  });

  it('占位标记泄漏到页面 → placeholder-leak', async () => {
    const report = await auditEntries([inputItem('备注', '(填充时随机选择)')]);
    expect(report.violations.map((v) => v.rule)).toContain('placeholder-leak');
  });

  it('图片字段被注入 PDF → image-field-non-image', async () => {
    const report = await auditEntries([uploadItem('商品图片', 'upload-image', { name: 'test-0552.pdf', type: 'application/pdf' })]);
    expect(report.violations.map((v) => [v.rule, v.got])).toEqual([['image-field-non-image', 'application/pdf']]);
  });

  it('标签写着图片却判成上传文件 → image-label-as-file', async () => {
    const report = await auditEntries([uploadItem('商品详情图片', 'upload-file', { name: 'a.pdf', type: 'application/pdf' })]);
    expect(report.violations.map((v) => v.rule)).toContain('image-label-as-file');
  });

  it('预览像素与页面要求的尺寸不符 → upload-size-mismatch', async () => {
    const entry = uploadItem('商品主图', 'upload-image', { name: 'a.png', type: 'image/png' }, '尺寸大小为：480*480px');
    const list = document.createElement('div');
    list.className = 'el-upload-list';
    const img = document.createElement('img');
    img.className = 'el-upload-list__item-thumbnail';
    Object.defineProperty(img, 'complete', { value: true, configurable: true });
    Object.defineProperty(img, 'naturalWidth', { value: 240, configurable: true });
    Object.defineProperty(img, 'naturalHeight', { value: 160, configurable: true });
    list.append(img);
    document.querySelector('.el-form-item')!.append(list);
    const report = await auditEntries([entry]);
    expect(report.violations.map((v) => [v.rule, v.got])).toEqual([['upload-size-mismatch', '240x160，页面要求 480x480']]);
  });

  it('原生候选的 root 就是控件本身时仍读到值', async () => {
    mount('<input class="native">');
    const input = document.querySelector('input')!;
    input.value = '13900139000';
    const cand: FieldCandidate = { label: '手机号', kind: 'text', root: input, targets: [input] };
    const report = await auditEntries([{ cand, value: '13900139000' }]);
    expect(report.violations).toEqual([]);
    input.value = '';
    expect((await auditEntries([{ cand, value: '13900139000' }])).violations.map((v) => v.rule)).toEqual(['empty']);
  });

  it('开关未选中是合法结果，只有请求态不符才报 state-mismatch', async () => {
    mount('<div class="el-switch"></div>');
    const sw = document.querySelector('.el-switch') as HTMLElement;
    const cand: FieldCandidate = { label: '启用', kind: 'switch', root: sw, targets: [sw] };
    expect((await auditEntries([{ cand, value: 'false' }])).violations).toEqual([]);
    expect((await auditEntries([{ cand, value: 'true' }])).violations.map((v) => [v.rule, v.got])).toEqual([
      ['state-mismatch', '期望 选中，实际 未选中'],
    ]);
  });

  it('上传成功后 input.files 被框架清空时按列表项判定落地', async () => {
    mount(
      '<div class="el-form-item"><label class="el-form-item__label">商品图片</label>' +
        '<div class="el-upload"><input type="file"></div>' +
        '<ul class="el-upload-list"><li class="el-upload-list__item is-success">' +
        '<span class="el-upload-list__item-name">test-0552.pdf</span></li></ul></div>',
    );
    const input = document.querySelector('input')!;
    Object.defineProperty(input, 'files', { value: [], configurable: true });
    const cand: FieldCandidate = { label: '商品图片', kind: 'upload-image', root: document.querySelector('.el-upload')!, targets: [input], accept: '' };
    const report = await auditEntries([{ cand, value: '[图片 test-0552.png]' }]);
    expect(report.violations.map((v) => [v.rule, v.got])).toEqual([['image-field-non-image', 'test-0552.pdf']]);
  });

  it('日期范围按两段分别校验', async () => {
    mount('<div class="el-form-item"><label class="el-form-item__label">生效日期</label><div class="el-date-editor"><input><input></div></div>');
    const inputs = Array.from(document.querySelectorAll('input'));
    inputs.forEach((i) => (i.value = '2024-01-01'));
    const cand: FieldCandidate = { label: '生效日期', kind: 'daterange', root: document.querySelector('.el-date-editor')!, targets: inputs };
    const ok = await auditEntries([{ cand, value: '2024-01-01 ~ 2024-06-30' }]);
    expect(ok.violations).toEqual([]);
    const bad = await auditEntries([{ cand, value: '2024-01-01 ~ autotest-x1' }]);
    expect(bad.violations.map((v) => v.rule)).toEqual(['value-shape']);
  });

  it('选项类控件不套用值形态正则，跳过的字段不计入 checked', async () => {
    mount('<div class="el-form-item"><label class="el-form-item__label">联系人手机是否公开</label><div class="el-switch is-checked"></div></div>');
    const sw = document.querySelector('.el-switch')!;
    const cand: FieldCandidate = { label: '联系人手机是否公开', kind: 'switch', root: sw, targets: [sw as HTMLElement] };
    const skippedCand: FieldCandidate = { label: '营业执照号', kind: 'text', root: sw, targets: [], skipped: true, reason: '禁用/只读' };
    const report = await auditEntries([{ cand, value: 'true' }, { cand: skippedCand, value: '' }]);
    expect(report.checked).toBe(1);
    expect(report.violations).toEqual([]);
  });
});

describe('liveValue', () => {
  it('读 EP 选中项的展示文本而非只读 input', () => {
    // 真实 EP 2.9 结构：is-hidden 的 input 包裹层同样带 .el-select__selected-item，
    // 且在文档序里排在展示节点之前。
    mount(
      '<div class="el-select"><div class="el-select__wrapper"><div class="el-select__selection">' +
        '<div class="el-select__selected-item el-select__input-wrapper is-hidden"><input readonly value=""></div>' +
        '<div class="el-select__selected-item el-select__placeholder"><span>民营企业</span></div>' +
        '</div></div></div>',
    );
    const cand: FieldCandidate = {
      label: '企业性质',
      kind: 'select-widget',
      root: document.querySelector('.el-select')!,
      targets: [document.querySelector('.el-select') as HTMLElement],
    };
    expect(liveValue(cand)).toBe('民营企业');
  });

  it('占位态（is-transparent）算空', () => {
    mount(
      '<div class="el-select"><div class="el-select__selection">' +
        '<div class="el-select__selected-item el-select__input-wrapper is-hidden"><input readonly value=""></div>' +
        '<div class="el-select__selected-item el-select__placeholder is-transparent"><span>请选择</span></div>' +
        '</div></div>',
    );
    const cand: FieldCandidate = {
      label: '企业性质',
      kind: 'select-widget',
      root: document.querySelector('.el-select')!,
      targets: [document.querySelector('.el-select') as HTMLElement],
    };
    expect(liveValue(cand)).toBe('');
  });

  it('原生下拉停在占位项算未填', async () => {
    mount('<select><option value="">请选择</option><option value="a">生产性企业</option></select>');
    const select = document.querySelector('select')!;
    select.value = '';
    const cand: FieldCandidate = { label: '企业生产类型', kind: 'select', root: select, targets: [select], optionTexts: ['生产性企业'] };
    expect(liveValue(cand)).toBe('');
    const report = await auditEntries([{ cand, value: '生产性企业' }]);
    expect(report.violations.map((v) => v.rule)).toEqual(['empty']);
    select.value = 'a';
    expect(liveValue(cand)).toBe('生产性企业');
    expect((await auditEntries([{ cand, value: '生产性企业' }])).violations).toEqual([]);
  });

  it('上传字段回传文件名与 MIME，供格式不变量判定', () => {
    mount('<input type="file">');
    const input = document.querySelector('input')!;
    Object.defineProperty(input, 'files', { value: [{ name: 'a.png', type: 'image/png' }], configurable: true });
    const cand: FieldCandidate = { label: 'logo', kind: 'upload-image', root: input, targets: [input] };
    expect(liveValue(cand)).toBe('a.png|image/png');
  });
});
