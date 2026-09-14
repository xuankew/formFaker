import { describe, expect, it } from 'vitest';
import { scanDocument, scanRevealed } from '../src/core/scan';
import { fillCandidate } from '../src/core/fill/strategies';

const fixture = `
<form>
  <div class="el-form-item">
    <label class="el-form-item__label">供应商名称</label>
    <div class="el-select"><input class="el-input__inner" placeholder="请选择" /></div>
  </div>
  <div class="el-form-item">
    <label class="el-form-item__label">注册地区</label>
    <div class="el-cascader"><input /></div>
  </div>
  <div class="el-form-item">
    <label class="el-form-item__label">成立日期</label>
    <div class="el-date-editor el-input"><input /></div>
  </div>
  <div class="el-form-item">
    <label class="el-form-item__label">有效期</label>
    <div class="el-date-editor el-range-editor el-date-editor--daterange"><input /><input /></div>
  </div>
  <div class="el-form-item">
    <label class="el-form-item__label">受理组织</label>
    <input disabled value="企业级账号" />
  </div>
  <div class="el-form-item">
    <label class="el-form-item__label">启用</label>
    <div class="el-switch"></div>
  </div>
  <div class="ant-form-item">
    <div class="ant-form-item-label"><label>企业性质</label></div>
    <div class="ant-select ant-select-single"><div class="ant-select-selector"></div></div>
  </div>
  <div>
    <label for="nat">纳税类别</label>
    <select id="nat"><option value="">请选择</option><option>一般纳税人</option><option>小规模</option></select>
  </div>
  <div style="display:none"><input id="hidden-input" /></div>
  <div>
    <label for="remark">备注</label>
    <textarea id="remark"></textarea>
  </div>
  <div>
    <span>性别</span>
    <label><input type="radio" name="g" />男</label>
    <label><input type="radio" name="g" />女</label>
  </div>
  <div>
    <label><input type="checkbox" name="agree" />同意协议</label>
  </div>
  <div>
    <label for="img">营业执照</label>
    <input id="img" type="file" accept="image/*" />
  </div>
  <div><div contenteditable="true" aria-label="企业简介"></div></div>
</form>
`;

function scan() {
  document.body.innerHTML = fixture;
  const candidates = scanDocument(document);
  return {
    fields: candidates.filter((c) => !c.skipped),
    skipped: candidates.filter((c) => c.skipped),
  };
}

describe('scanDocument', () => {
  it('classifies widget and native controls', () => {
    const { fields } = scan();
    const byLabel = new Map(fields.map((f) => [f.label, f]));
    expect(byLabel.get('供应商名称')?.kind).toBe('select-widget');
    expect(byLabel.get('注册地区')?.kind).toBe('cascader');
    expect(byLabel.get('成立日期')?.kind).toBe('date');
    expect(byLabel.get('有效期')?.kind).toBe('daterange');
    expect(byLabel.get('启用')?.kind).toBe('switch');
    expect(byLabel.get('企业性质')?.kind).toBe('select-widget');
    expect(byLabel.get('纳税类别')?.kind).toBe('select');
    expect(byLabel.get('纳税类别')?.optionTexts).toEqual(['请选择', '一般纳税人', '小规模']);
    expect(byLabel.get('备注')?.kind).toBe('textarea');
    expect(byLabel.get('性别')?.kind).toBe('radio-group');
    expect(byLabel.get('性别')?.optionTexts).toEqual(['男', '女']);
    expect(byLabel.get('同意协议')?.kind).toBe('checkbox');
    expect(byLabel.get('营业执照')?.kind).toBe('upload-image');
    expect(byLabel.get('企业简介')?.kind).toBe('richtext');
  });

  it('skips disabled and hidden controls with reasons', () => {
    const { skipped } = scan();
    const reasons = new Map(skipped.map((f) => [f.label, f.reason]));
    expect(reasons.get('受理组织')).toBe('禁用/只读');
    expect(skipped.some((f) => f.reason === '不可见')).toBe(true);
  });

  it('does not double count inputs inside widgets', () => {
    const { fields } = scan();
    const selectWidget = fields.filter((f) => f.kind === 'select-widget');
    expect(selectWidget).toHaveLength(2);
    expect(fields.some((f) => f.label === '请选择')).toBe(false);
  });
});

describe('scanRevealed (conditionally rendered controls)', () => {
  it('returns only controls that appeared after the initial scan and lets them be filled', async () => {
    document.body.innerHTML = `
      <form id="f">
        <div><label for="ptype">企业生产类型</label>
          <select id="ptype"><option value="">请选择</option><option>生产性企业</option></select>
        </div>
      </form>`;
    const initial = scanDocument(document).filter((c) => !c.skipped);
    const known: Element[] = [];
    for (const c of initial) known.push(...c.targets);

    // Simulate the framework rendering dependent fields once 生产性企业 is chosen.
    const form = document.getElementById('f')!;
    form.insertAdjacentHTML('beforeend', `
      <div><label for="lines">生产现场产线总数量（条）</label><input id="lines" type="text" /></div>
      <div><label for="supply">可供应产线（条）</label><input id="supply" type="text" /></div>`);

    const revealed = scanRevealed(known);
    expect(revealed.map((c) => c.label).sort()).toEqual(['可供应产线（条）', '生产现场产线总数量（条）']);

    for (const cand of revealed) await fillCandidate(cand, '42');
    expect((document.getElementById('lines') as HTMLInputElement).value).toBe('42');
    expect((document.getElementById('supply') as HTMLInputElement).value).toBe('42');

    const knownAfter: Element[] = [...known];
    for (const c of revealed) knownAfter.push(...c.targets);
    expect(scanRevealed(knownAfter)).toHaveLength(0);
  });
});
