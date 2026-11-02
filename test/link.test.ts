import { describe, expect, it } from 'vitest';
import { scanDocument } from '../src/core/scan';
import { inferRule } from '../src/core/semantics/infer';
import { resolveCredentialLink, type LinkEntry } from '../src/core/semantics/link';
import { generate } from '../src/core/generators';
import { defaultCatalog } from '../src/core/rules/catalog';
import type { FieldDTO } from '../src/shared/types';

const CAT = defaultCatalog();

function entries(html: string): LinkEntry[] {
  document.body.innerHTML = html;
  return scanDocument(document)
    .filter((c) => !c.skipped)
    .map((cand, i) => {
      const rule = inferRule(cand.label, cand.kind, CAT);
      const dto: FieldDTO = {
        id: `f${i}`,
        label: cand.label,
        kind: cand.kind,
        semantic: rule.id,
        ruleName: rule.name,
        ruleCustom: !rule.builtin,
        value: generate({ kind: cand.kind, ruleId: rule.id, label: cand.label, optionTexts: cand.optionTexts, catalog: CAT }),
        optionTexts: cand.optionTexts,
      };
      return { cand, dto };
    });
}

describe('credential type -> number linkage', () => {
  it('follows the type already selected on the page', () => {
    const list = entries(`
      <form>
        <div><label for="t">证照类型</label>
          <select id="t"><option value="">请选择</option><option selected>统一社会信用代码</option><option>居民身份证</option><option>护照</option></select>
        </div>
        <div><label for="n">证照号码</label><input id="n" type="text" /></div>
      </form>`);
    const links = resolveCredentialLink(list, CAT);
    const no = list.find((e) => e.dto.label === '证照号码')!;
    const type = list.find((e) => e.dto.label === '证照类型')!;
    expect(links.get(no.dto.id)).toBe(type.dto.id);
    expect(no.dto.semantic).toBe('creditCode');
    expect(no.dto.value).toMatch(/^[0-9A-HJ-NP-RTUW-Y]{18}$/);
  });

  it('falls back to the planned type value when the page has none', () => {
    const list = entries(`
      <form>
        <div><label for="t">证照类型</label>
          <select id="t"><option value="">请选择</option><option>统一社会信用代码</option><option>居民身份证</option><option>护照</option></select>
        </div>
        <div><label for="n">证照号码</label><input id="n" type="text" /></div>
      </form>`);
    const type = list.find((e) => e.dto.label === '证照类型')!;
    type.dto.value = '居民身份证';
    const no = list.find((e) => e.dto.label === '证照号码')!;
    resolveCredentialLink(list, CAT);
    expect(no.dto.semantic).toBe('idNumber');
    expect(no.dto.value).toMatch(/^\d{17}[\dX]$/);
  });

  it('leaves unrelated forms untouched', () => {
    const list = entries(`
      <form>
        <div><label for="a">供应商名称</label><input id="a" type="text" /></div>
        <div><label for="b">证照号码</label><input id="b" type="text" /></div>
      </form>`);
    const links = resolveCredentialLink(list, CAT);
    expect(links.size).toBe(0);
  });
});
