import { describe, expect, it } from 'vitest';
import { scanDocument } from '../src/core/scan';
import { inferSemantic } from '../src/core/semantics/infer';
import { resolveGeoLink, type LinkEntry } from '../src/core/semantics/link';
import { coordForText, parseRegionNames } from '../src/core/generators/geo';
import { generate } from '../src/core/generators';
import { DEFAULT_GEN_RULES, type FieldDTO } from '../src/shared/types';

const COORD_RE = /^-?\d+\.\d{6},-?\d+\.\d{6}$/;

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

describe('lnglat semantic + disabled whitelist', () => {
  it('infers lnglat for coordinate labels', () => {
    expect(inferSemantic('经纬度', 'text')).toBe('lnglat');
    expect(inferSemantic('坐标', 'text')).toBe('lnglat');
  });

  it('keeps a disabled coordinate field fillable but still skips other disabled fields', () => {
    document.body.innerHTML = `
      <form>
        <div><label for="ll">经纬度</label><input id="ll" type="text" disabled /></div>
        <div><label for="org">受理组织</label><input id="org" disabled value="企业级账号" /></div>
      </form>`;
    const cands = scanDocument(document);
    const ll = cands.find((c) => c.label === '经纬度');
    const org = cands.find((c) => c.label === '受理组织');
    expect(ll?.skipped).toBeFalsy();
    expect(ll?.targets).toHaveLength(1);
    expect(org?.skipped).toBe(true);
    expect(org?.reason).toBe('禁用/只读');
  });
});

describe('geo coordinate derivation', () => {
  it('parses province and city from an address string', () => {
    expect(parseRegionNames('陕西省榆林市清涧县XX路1号')).toEqual({ province: '陕西省', city: '榆林市' });
  });

  it('ignores the placeholder city rows instead of matching a bare 县', () => {
    expect(parseRegionNames('重庆市潼南县XX路1号')).toEqual({ province: '重庆市', city: '' });
    expect(parseRegionNames('北京市市辖区东城区XX路1号')).toEqual({ province: '北京市', city: '' });
  });

  it('returns null when no known province appears', () => {
    expect(coordForText('some unrelated text')).toBeNull();
  });

  it('is deterministic and stays inside the named province', () => {
    const a = coordForText('陕西省榆林市清涧县XX路1号');
    const b = coordForText('陕西省榆林市清涧县XX路1号');
    expect(a).toBe(b);
    expect(a).toMatch(COORD_RE);
    const [lng, lat] = a!.split(',').map(Number);
    expect(lng).toBeGreaterThan(105);
    expect(lng).toBeLessThan(112);
    expect(lat).toBeGreaterThan(31);
    expect(lat).toBeLessThan(40);
  });
});

describe('address -> lnglat linkage', () => {
  it('ties the coordinate to the generated address', () => {
    const list = entries(`
      <form>
        <div><label for="addr">注册地址</label><input id="addr" type="text" /></div>
        <div><label for="ll">经纬度</label><input id="ll" type="text" disabled /></div>
      </form>`);
    const links = resolveGeoLink(list, DEFAULT_GEN_RULES);
    const addr = list.find((e) => e.dto.label === '注册地址')!;
    const ll = list.find((e) => e.dto.label === '经纬度')!;
    expect(ll.dto.semantic).toBe('lnglat');
    expect(links.get(ll.dto.id)).toBe(addr.dto.id);
    expect(ll.dto.value).toBe(coordForText(addr.dto.value));
    expect(ll.dto.value).toMatch(COORD_RE);
  });

  it('links to the address in the same form, not the first address-like field on the page', () => {
    const list = entries(`
      <form id="f-ep">
        <div><label for="region">注册地区</label><input id="region" type="text" /></div>
      </form>
      <form id="f-native">
        <div><label for="addr">注册地址</label><input id="addr" type="text" /></div>
        <div><label for="ll">经纬度</label><input id="ll" type="text" disabled /></div>
      </form>`);
    const region = list.find((e) => e.dto.label === '注册地区')!;
    const addr = list.find((e) => e.dto.label === '注册地址')!;
    const ll = list.find((e) => e.dto.label === '经纬度')!;
    region.dto.value = '贵州省贵阳市南明区';
    addr.dto.value = '江西省宜春市宜丰县人民路1号';
    const links = resolveGeoLink(list, DEFAULT_GEN_RULES);
    expect(links.get(ll.dto.id)).toBe(addr.dto.id);
    expect(ll.dto.value).toBe(coordForText(addr.dto.value));
    expect(ll.dto.value).not.toBe(coordForText(region.dto.value));
  });

  it('returns no links without a coordinate field or without an address source', () => {
    expect(resolveGeoLink(entries(`<form><div><label for="a">注册地址</label><input id="a" /></div></form>`), DEFAULT_GEN_RULES).size).toBe(0);
    expect(resolveGeoLink(entries(`<form><div><label for="l">经纬度</label><input id="l" disabled /></div></form>`), DEFAULT_GEN_RULES).size).toBe(0);
  });
});
