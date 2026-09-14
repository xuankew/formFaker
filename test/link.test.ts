import { describe, expect, it } from 'vitest';
import { scanDocument } from '../src/core/scan';
import { inferSemantic } from '../src/core/semantics/infer';
import { resolveCredentialLink, type LinkEntry } from '../src/core/semantics/link';
import { generate } from '../src/core/generators';
import { DEFAULT_GEN_RULES, type FieldDTO } from '../src/shared/types';

function entries(html: string): LinkEntry[] {
  document.body.innerHTML = html;
  return scanDocument(document)
    .filter((c) => !c.skipped)
    .map((cand, i) => {
      const semantic = inferSemantic(cand.label, cand.kind);
      const dto: FieldDTO = {
        id: `f${i}`,
        label: cand.label,
        kind: cand.kind,
        semantic,
        value: generate({ kind: cand.kind, semantic, label: cand.label, optionTexts: cand.optionTexts, rules: DEFAULT_GEN_RULES }),
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
    const links = resolveCredentialLink(list, DEFAULT_GEN_RULES);
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
    resolveCredentialLink(list, DEFAULT_GEN_RULES);
    expect(no.dto.semantic).toBe('idNumber');
    expect(no.dto.value).toMatch(/^\d{17}[\dX]$/);
  });

  it('leaves unrelated forms untouched', () => {
    const list = entries(`
      <form>
        <div><label for="a">供应商名称</label><input id="a" type="text" /></div>
        <div><label for="b">证照号码</label><input id="b" type="text" /></div>
      </form>`);
    const links = resolveCredentialLink(list, DEFAULT_GEN_RULES);
    expect(links.size).toBe(0);
  });
});
