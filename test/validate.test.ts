import { describe, expect, it } from 'vitest';
import { readFieldError } from '../src/core/fill/validate';

const root = (selector = 'input') => document.querySelector(selector) as Element;

describe('readFieldError', () => {
  it('reads the Element Plus error slot', () => {
    document.body.innerHTML = `
      <div class="el-form-item is-error">
        <label class="el-form-item__label">企业名称</label>
        <input />
        <div class="el-form-item__error">请输入企业名称</div>
      </div>`;
    expect(readFieldError(root())).toBe('请输入企业名称');
  });

  it('reads the Ant Design explain slot', () => {
    document.body.innerHTML = `
      <div class="ant-form-item ant-form-item-has-error">
        <input />
        <div class="ant-form-item-explain-error">请填写正确的手机号</div>
      </div>`;
    expect(readFieldError(root())).toBe('请填写正确的手机号');
  });

  it('falls back to a generic message when only the error class is present', () => {
    document.body.innerHTML = `
      <div class="el-form-item is-error"><input /></div>`;
    expect(readFieldError(root())).toBe('未通过（页面未给出提示文字）');
  });

  it('treats aria-invalid on the control itself as a failed check', () => {
    document.body.innerHTML = `<input aria-invalid="true" />`;
    expect(readFieldError(root())).toBe('未通过（页面未给出提示文字）');
  });

  it('returns null for a healthy field', () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <label>企业名称</label>
        <input />
        <div class="el-form-item__error"></div>
      </div>`;
    expect(readFieldError(root())).toBeNull();
  });

  it('ignores hidden error nodes', () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <input />
        <div class="el-form-item__error" style="display:none">请输入企业名称</div>
        <div class="invalid-feedback" style="visibility:hidden">请填写</div>
      </div>`;
    expect(readFieldError(root())).toBeNull();
  });

  it('does not treat static help text as an error', () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <input />
        <div class="help-block">请填写营业执照上的完整名称</div>
        <div class="el-form-item__error"></div>
      </div>`;
    expect(readFieldError(root())).toBeNull();
  });

  it('does not attribute a sibling field error to this field', () => {
    document.body.innerHTML = `
      <div class="el-form-item"><input id="a" /></div>
      <div class="el-form-item is-error">
        <input id="b" />
        <div class="el-form-item__error">请输入手机号</div>
      </div>`;
    expect(readFieldError(root('#a'))).toBeNull();
    expect(readFieldError(root('#b'))).toBe('请输入手机号');
  });

  it('does not take a nested field error from the outer field', () => {
    document.body.innerHTML = `
      <div class="el-form-item" id="outer">
        <input id="outer-input" />
        <div class="el-form-item is-error" id="inner">
          <input id="inner-input" />
          <div class="el-form-item__error">请输入联系人</div>
        </div>
      </div>`;
    expect(readFieldError(root('#outer-input'))).toBeNull();
    expect(readFieldError(root('#inner-input'))).toBe('请输入联系人');
  });

  it('reads a visible Bootstrap invalid-feedback', () => {
    document.body.innerHTML = `
      <div class="form-group">
        <input class="is-invalid" />
        <div class="invalid-feedback">请输入有效邮箱</div>
      </div>`;
    expect(readFieldError(root())).toBe('请输入有效邮箱');
  });

  it('truncates a long message', () => {
    const long = '这是一条很长的页面校验提示'.repeat(20);
    document.body.innerHTML = `
      <div class="el-form-item">
        <input />
        <div class="el-form-item__error">${long}</div>
      </div>`;
    const msg = readFieldError(root())!;
    expect(msg).toHaveLength(121);
    expect(msg.endsWith('…')).toBe(true);
  });

  it('collapses whitespace in the message', () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <input />
        <div class="el-form-item__error">请输入
          企业名称</div>
      </div>`;
    expect(readFieldError(root())).toBe('请输入 企业名称');
  });

  it('returns null for a detached control', () => {
    expect(readFieldError(document.createElement('input'))).toBeNull();
  });
});
