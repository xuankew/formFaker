import { describe, expect, it } from 'vitest';
import { scanDocument, type FieldCandidate } from '../src/core/scan';
import { inferSemantic } from '../src/core/semantics/infer';

function scan(fixture: string): FieldCandidate[] {
  document.body.innerHTML = fixture;
  return scanDocument(document);
}

const labels = (list: FieldCandidate[]) => list.filter((c) => !c.skipped).map((c) => c.label);

describe('column header labels', () => {
  it('labels cells of a plain table by their column header', () => {
    const fields = scan(`
      <table>
        <thead><tr><th>姓名</th><th>手机号</th><th>电子邮箱</th><th>银行账号</th></tr></thead>
        <tbody><tr>
          <td><input placeholder="请输入" /></td>
          <td><input placeholder="请输入" /></td>
          <td><input placeholder="请输入" /></td>
          <td><input placeholder="请输入" /></td>
        </tr></tbody>
      </table>
    `);
    expect(labels(fields)).toEqual(['姓名', '手机号', '电子邮箱', '银行账号']);
  });

  it('gives those cells the semantics the header implies', () => {
    const fields = scan(`
      <table>
        <thead><tr><th>姓名</th><th>手机号</th><th>电子邮箱</th><th>银行账号</th></tr></thead>
        <tbody><tr><td><input /></td><td><input /></td><td><input /></td><td><input /></td></tr></tbody>
      </table>
    `);
    const semantics = fields.filter((c) => !c.skipped).map((c) => inferSemantic(c.label, c.kind));
    expect(semantics).toEqual(['cnName', 'phone', 'email', 'bankCard']);
  });

  it('resolves headers when the framework splits header and body into sibling tables', () => {
    const fields = scan(`
      <div class="el-table">
        <div class="el-table__header-wrapper"><table><thead><tr>
          <th><div class="cell">姓名</div></th><th><div class="cell">角色</div></th><th><div class="cell">区号</div></th>
        </tr></thead></table></div>
        <div class="el-table__body-wrapper"><table><tbody><tr>
          <td><div class="cell"><div class="el-input"><input id="el-id-5559-1" class="el-input__inner" placeholder="请输入" /></div></div></td>
          <td><div class="cell"><div class="el-select"><input id="el-id-5559-2" /></div></div></td>
          <td><div class="cell"><div class="el-input-number"><input id="el-id-5559-3" value="86" /></div></div></td>
        </tr></tbody></table></div>
      </div>
    `);
    // scan emits widget roots before native inputs; document order is restored by the
    // content runtime, so assert on the label set here.
    expect(labels(fields).sort()).toEqual(['区号', '姓名', '角色'].sort());
  });

  it('expands colspan and walks multi-level headers up to a non-empty row', () => {
    const fields = scan(`
      <table>
        <thead>
          <tr><th colspan="2">联系方式</th><th rowspan="2">备注</th></tr>
          <tr><th>区号</th><th></th></tr>
        </thead>
        <tbody><tr><td><input /></td><td><input /></td><td><input /></td></tr></tbody>
      </table>
    `);
    expect(labels(fields)).toEqual(['区号', '联系方式', '备注']);
  });

  it('supports ARIA grids and the headers attribute', () => {
    const aria = scan(`
      <div role="grid">
        <div role="row"><div role="columnheader" aria-colindex="2">联行号</div></div>
        <div role="row"><div role="gridcell" aria-colindex="2"><input readonly placeholder="请选择" /><i class="el-icon-search"></i></div></div>
      </div>
    `);
    expect(labels(aria)).toEqual(['联行号']);

    const byHeaders = scan(`
      <table>
        <thead><tr><th id="h-cap">供应商产能</th></tr></thead>
        <tbody><tr><td headers="h-cap"><input /></td></tr></tbody>
      </table>
    `);
    expect(labels(byHeaders)).toEqual(['供应商产能']);
  });

  it('keeps more specific labels and leaves non-table fields alone', () => {
    const fields = scan(`
      <table>
        <thead><tr><th>联系人</th></tr></thead>
        <tbody>
          <tr><td><div class="el-form-item"><label class="el-form-item__label">法定代表人</label><input /></div></td></tr>
          <tr><td><label>负责人<input /></label></td></tr>
        </tbody>
      </table>
      <div><label for="outside">注册地址</label><input id="outside" /></div>
      <div><input placeholder="请输入关键词" /></div>
    `);
    expect(labels(fields)).toEqual(['法定代表人', '负责人', '注册地址', '请输入关键词']);
  });
});
