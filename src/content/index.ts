import type { ContentRequest, ContentResponse, FieldDTO, FillResult, GenRules, ScanResult } from '../shared/types';
import { DEFAULT_GEN_RULES } from '../shared/types';
import { scanDocument, scanRevealed, type FieldCandidate } from '../core/scan';
import { walkScroll } from '../core/scan/scroll';
import { inferSemantic, credentialSemantic } from '../core/semantics/infer';
import { currentOptionText, resolveCredentialLink, resolveGeoLink } from '../core/semantics/link';
import { coordForText } from '../core/generators/geo';
import { generate } from '../core/generators';
import { clearCandidate, fillCandidate, hasExistingValue, restoreSnapshot, takeSnapshot, type Snapshot } from '../core/fill/strategies';
import { claimBootstrap, type StampHost } from './guard';

interface RuntimeField {
  cand: FieldCandidate;
  dto: FieldDTO;
}

function bootstrap(): void {
  const fields = new Map<string, RuntimeField>();
  let credLinks = new Map<string, string>();
  let geoLinks = new Map<string, string>();
  let snapshots: Snapshot[] = [];
  let seq = 0;
  let lastRules: GenRules = DEFAULT_GEN_RULES;

  const makeValue = (cand: FieldCandidate, semantic: FieldDTO['semantic'], rules: GenRules) =>
    generate({ kind: cand.kind, semantic, label: cand.label, optionTexts: cand.optionTexts, rules });

  const register = (cand: FieldCandidate, rules: GenRules): FieldDTO => {
    const id = `f${seq++}`;
    const semantic = inferSemantic(
      `${cand.label} ${cand.root.getAttribute('name') ?? ''} ${cand.root.id}`,
      cand.kind,
    );
    const value = cand.skipped ? '' : makeValue(cand, semantic, rules);
    const dto: FieldDTO = { id, label: cand.label, kind: cand.kind, semantic, value, optionTexts: cand.optionTexts, skipped: cand.skipped, reason: cand.reason };
    fields.set(id, { cand, dto });
    return dto;
  };

  const knownTargets = (): Element[] => {
    const out: Element[] = [];
    for (const rt of fields.values()) {
      out.push(rt.cand.root, ...rt.cand.targets);
    }
    return out;
  };

  // Fields absorbed while scrolling are appended out of order; sort by document
  // position so the popup list matches what the user sees on the page.
  const byDocumentOrder = (a: FieldDTO, b: FieldDTO): number => {
    const ra = fields.get(a.id)?.cand.root;
    const rb = fields.get(b.id)?.cand.root;
    if (!ra || !rb || ra === rb) return 0;
    return ra.compareDocumentPosition(rb) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  };

  const handleScan = async (rules: GenRules): Promise<ScanResult> => {
    lastRules = rules;
    fields.clear();
    credLinks.clear();
    geoLinks.clear();
    snapshots = [];
    const result: ScanResult = { fields: [], skipped: [] };
    const collect = (cand: FieldCandidate) => {
      const dto = register(cand, rules);
      (dto.skipped ? result.skipped : result.fields).push(dto);
    };
    for (const cand of scanDocument(document)) collect(cand);
    // Sections further down may not be mounted yet (lazy render / content-visibility),
    // so walk the page once and absorb whatever appears along the way.
    await walkScroll(async () => {
      const revealed = scanRevealed(knownTargets());
      for (const cand of revealed) collect(cand);
      return revealed.length;
    });
    result.fields.sort(byDocumentOrder);
    const active = result.fields.map((dto) => fields.get(dto.id)!);
    credLinks = resolveCredentialLink(active, rules);
    geoLinks = resolveGeoLink(active, rules);
    return result;
  };

  const handleRegen = (id: string, rules: GenRules): string => {
    lastRules = rules;
    const rt = fields.get(id);
    if (!rt) throw new Error(`unknown field ${id}`);
    // lnglat is derived from its address/region source; follow the source rather than
    // regenerating independently so the coordinate keeps matching the address.
    const geoSrcId = geoLinks.get(id);
    if (geoSrcId) {
      const src = fields.get(geoSrcId);
      const coord = src ? coordForText(src.dto.value) : null;
      if (coord) {
        rt.dto.value = coord;
        return coord;
      }
    }
    let semantic = rt.dto.semantic;
    const linkedTypeId = credLinks.get(id);
    if (linkedTypeId) {
      const typeRt = fields.get(linkedTypeId);
      if (typeRt) {
        semantic = credentialSemantic(currentOptionText(typeRt.cand) || typeRt.dto.value);
        rt.dto.semantic = semantic;
      }
    }
    const value = makeValue(rt.cand, semantic, rules);
    rt.dto.value = value;
    for (const [geoId, srcId] of geoLinks) {
      if (srcId !== id) continue;
      const geoRt = fields.get(geoId);
      const coord = coordForText(value);
      if (geoRt && coord) geoRt.dto.value = coord;
    }
    return value;
  };

  // Values written by a fill can mount controls that did not exist at scan time
  // (conditional sections, or blocks that only render once scrolled into view).
  // Register and fill whatever newly appeared; returns how many were found.
  const fillRevealed = async (overwrite: boolean, results: FillResult[]): Promise<number> => {
    const revealed = scanRevealed(knownTargets());
    for (const cand of revealed) {
      const dto = register(cand, lastRules);
      if (!overwrite && hasExistingValue(cand)) {
        results.push({ id: dto.id, ok: true });
        continue;
      }
      snapshots.push(...takeSnapshot(cand.targets));
      try {
        await fillCandidate(cand, dto.value);
        results.push({ id: dto.id, ok: true });
      } catch (err) {
        results.push({ id: dto.id, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return revealed.length;
  };

  const handleFill = async (cmds: { id: string; value: string }[], overwrite: boolean): Promise<FillResult[]> => {
    snapshots = [];
    const results: FillResult[] = [];
    let sinceYield = 0;
    for (const cmd of cmds) {
      const rt = fields.get(cmd.id);
      if (!rt) {
        results.push({ id: cmd.id, ok: false, error: '字段已失效，请重新识别' });
        continue;
      }
      if (!overwrite && hasExistingValue(rt.cand)) {
        results.push({ id: rt.dto.id, ok: true });
        continue;
      }
      snapshots.push(...takeSnapshot(rt.cand.targets));
      try {
        await fillCandidate(rt.cand, cmd.value);
        results.push({ id: rt.dto.id, ok: true });
      } catch (err) {
        results.push({ id: rt.dto.id, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      if (++sinceYield >= 50) {
        sinceYield = 0;
        await new Promise((r) => requestAnimationFrame(r));
      }
    }
    // Bounded rounds keep a reveal cascade from looping forever; the scroll walk then
    // picks up blocks that only mount once they come into view.
    for (let round = 0; round < 2; round++) {
      await new Promise((r) => requestAnimationFrame(r));
      if (!(await fillRevealed(overwrite, results))) break;
    }
    await walkScroll(() => fillRevealed(overwrite, results), { maxSteps: 15 });
    return results;
  };

  const handleClear = async (): Promise<{ cleared: number; failed: number }> => {
    let cleared = 0;
    let failed = 0;
    let sinceYield = 0;
    for (const rt of fields.values()) {
      if (rt.cand.skipped) continue;
      try {
        if (await clearCandidate(rt.cand)) cleared++;
        else failed++;
      } catch {
        failed++;
      }
      if (++sinceYield >= 50) {
        sinceYield = 0;
        await new Promise((r) => requestAnimationFrame(r));
      }
    }
    return { cleared, failed };
  };

  chrome.runtime.onMessage.addListener((msg: ContentRequest, _sender, sendResponse: (r: ContentResponse<unknown>) => void) => {
    const reply = (data: unknown) => sendResponse({ ok: true, data });
    const fail = (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    try {
      switch (msg.type) {
        case 'ping':
          reply({ pong: true });
          break;
        case 'scan':
          handleScan(msg.rules).then(reply, fail);
          return true;
        case 'regen':
          reply({ value: handleRegen(msg.id, msg.rules) });
          break;
        case 'fill':
          handleFill(msg.cmds, msg.overwrite).then(reply, fail);
          return true;
        case 'clear':
          handleClear().then(reply, fail);
          return true;
        case 'undo':
          restoreSnapshot(snapshots);
          snapshots = [];
          reply({ undone: true });
          break;
        default:
          fail('unknown message');
      }
    } catch (err) {
      fail(err);
    }
    return false;
  });
}

const host = globalThis as StampHost;
if (
  claimBootstrap(host, () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  })
) {
  bootstrap();
}
