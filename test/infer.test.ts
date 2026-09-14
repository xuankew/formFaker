import { describe, expect, it } from 'vitest';
import { credentialSemantic, inferSemantic } from '../src/core/semantics/infer';

describe('semantic inference', () => {
  const cases: [string, Parameters<typeof inferSemantic>[1], ReturnType<typeof inferSemantic>][] = [
    ['联系电话（手机）', 'text', 'phone'],
    ['手机号码', 'text', 'phone'],
    ['固定电话', 'text', 'landline'],
    ['传真', 'text', 'landline'],
    ['邮箱', 'text', 'email'],
    ['统一社会信用代码', 'text', 'creditCode'],
    ['身份证号', 'text', 'idNumber'],
    ['银行账号', 'text', 'bankCard'],
    ['供应商名称', 'text', 'company'],
    ['供应商合作客户', 'text', 'company'],
    ['客户联系人', 'text', 'cnName'],
    ['法定代表人', 'text', 'cnName'],
    ['注册地区', 'cascader', 'region'],
    ['注册地址', 'text', 'address'],
    ['注册资本（单位:元）', 'number', 'amount'],
    ['实缴资金（单位:元）', 'text', 'amount'],
    ['上年度营业额（元）', 'text', 'amount'],
    ['员工人数', 'number', 'integer'],
    ['生产现场产线总数量（条）', 'text', 'integer'],
    ['可供应产线（条）', 'text', 'integer'],
    ['专职研发人员', 'text', 'integer'],
    ['全职检测人员', 'text', 'integer'],
    ['行业年限（年）', 'text', 'integer'],
    ['生产及品控管理年限（年）', 'text', 'integer'],
    ['实际运营时间（年）', 'text', 'integer'],
    ['售后配置人员数量', 'text', 'integer'],
    ['区号', 'number', 'integer'],
    ['备注', 'textarea', 'paragraph'],
    ['纳税类别', 'select', 'enum'],
    ['性别', 'radio-group', 'gender'],
    ['成立日期', 'date', 'date'],
    ['受理组织', 'text', 'generic'],
    ['经营范围', 'checkbox-group', 'enum'],
  ];
  it.each(cases)('%s (%s) -> %s', (label, kind, expected) => {
    expect(inferSemantic(label, kind)).toBe(expected);
  });

  it('phone wins over landline', () => {
    expect(inferSemantic('手机电话均可', 'text')).toBe('phone');
  });

  it('email wins over address', () => {
    expect(inferSemantic('邮箱地址', 'text')).toBe('email');
  });
});

describe('credential type -> number semantic linkage', () => {
  it('maps license type option text to the matching number semantic', () => {
    expect(credentialSemantic('统一社会信用代码')).toBe('creditCode');
    expect(credentialSemantic('居民身份证')).toBe('idNumber');
    expect(credentialSemantic('护照')).toBe('passport');
    expect(credentialSemantic('其他证照')).toBe('generic');
  });

  it('defaults to creditCode for unknown/empty type', () => {
    expect(credentialSemantic('')).toBe('creditCode');
    expect(credentialSemantic('营业执照')).toBe('creditCode');
  });
});
