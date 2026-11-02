import type { FieldCandidate } from '../scan';
import type { FieldDTO } from '../../shared/types';
import type { Catalog } from '../rules/types';
import { generate } from '../generators';
import { coordForText } from '../generators/geo';
import { CREDENTIAL_NO_RE, CREDENTIAL_TYPE_RE, credentialSemantic, OPTION_KINDS } from './infer';

export interface LinkEntry {
  cand: FieldCandidate;
  dto: FieldDTO;
}

// Reads the option text currently selected on a type-like control, so a linked
// number field can be generated to match what the page already shows.
export function currentOptionText(cand: FieldCandidate): string {
  const root = cand.root;
  if (cand.kind === 'select') {
    const opt = (root as HTMLSelectElement).selectedOptions?.[0];
    return opt && opt.value !== '' ? opt.text.trim() : '';
  }
  if (cand.kind === 'radio-group') {
    const checked = cand.targets.find((t) => (t as HTMLInputElement).checked);
    if (!checked) return '';
    return (checked.closest('label')?.textContent ?? checked.parentElement?.textContent ?? '').trim();
  }
  const item = root.querySelector('.el-select__selected-item, .ant-select-selection-item');
  if (item?.textContent?.trim()) return item.textContent.trim();
  return root.querySelector('input')?.value.trim() ?? '';
}

// Cross-field dependency: a credential-number field's format follows the selected
// option of a sibling credential-type field. Returns numberId -> typeId so callers
// can re-resolve on regen. Uses the type's current DOM value when present, else the
// type's planned generated value (fill order keeps them consistent).
export function resolveCredentialLink(entries: LinkEntry[], catalog: Catalog): Map<string, string> {
  const links = new Map<string, string>();
  const active = entries.filter((e) => !e.cand.skipped);
  const type = active.find((e) => CREDENTIAL_TYPE_RE.test(e.cand.label) && OPTION_KINDS.has(e.cand.kind));
  const no = active.find((e) => CREDENTIAL_NO_RE.test(e.cand.label) && !OPTION_KINDS.has(e.cand.kind));
  if (!type || !no) return links;
  links.set(no.dto.id, type.dto.id);
  const typeText = currentOptionText(type.cand) || type.dto.value;
  const ruleId = credentialSemantic(typeText);
  applyRule(no.dto, ruleId, catalog);
  return links;
}

// 证照联动改的是号码字段实际用哪条规则，DTO 上的规则名与自定义标记要跟着换，
// 否则弹窗里仍显示扫描时命中的那条。
export function applyRule(dto: FieldDTO, ruleId: string, catalog: Catalog): void {
  const rule = catalog.byId.get(ruleId);
  dto.semantic = ruleId;
  dto.ruleName = rule?.name ?? ruleId;
  dto.ruleCustom = !!rule && !rule.builtin;
  dto.value = generate({
    kind: dto.kind,
    ruleId,
    label: dto.label,
    optionTexts: dto.optionTexts,
    catalog,
  });
}

// Form containers used to scope cross-field linkage so a derived field binds to a
// source in its OWN form, not the first matching field anywhere on a multi-form page.
const FORM_SCOPE = 'form, .el-form, .ant-form, [role="form"]';

// Cross-field dependency: a longitude/latitude field is a derived output of the
// address/region chosen elsewhere on the form (normally via a map picker). Tie it to
// the sibling address/region field in the same form so the coordinate matches the
// generated address. Returns lnglatId -> sourceId so callers can re-resolve on regen.
export function resolveGeoLink(entries: LinkEntry[]): Map<string, string> {
  const links = new Map<string, string>();
  const active = entries.filter((e) => !e.cand.skipped);
  const geos = active.filter((e) => e.dto.semantic === 'lnglat');
  if (!geos.length) return links;
  const sources = active.filter((e) => e.dto.semantic === 'address' || e.dto.semantic === 'region');
  if (!sources.length) return links;
  const scopeOf = (e: LinkEntry): Element | null => e.cand.root.closest?.(FORM_SCOPE) ?? null;
  for (const g of geos) {
    const gScope = scopeOf(g);
    const source = (gScope ? sources.find((s) => scopeOf(s) === gScope) : undefined) ?? sources[0];
    links.set(g.dto.id, source.dto.id);
    const coord = coordForText(source.dto.value);
    if (coord) g.dto.value = coord;
  }
  return links;
}
