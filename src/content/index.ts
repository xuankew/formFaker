import type { ContentRequest, ContentResponse, FieldDTO, FillResult, GenRules, ScanResult } from '../shared/types';
import { DEFAULT_GEN_RULES } from '../shared/types';
import { scanDocument, scanRevealed, type FieldCandidate } from '../core/scan';
import { inferSemantic, credentialSemantic } from '../core/semantics/infer';
import { currentOptionText, resolveCredentialLink, resolveGeoLink } from '../core/semantics/link';
import { coordForText } from '../core/generators/geo';
import { generate } from '../core/generators';
import { clearCandidate, fillCandidate, hasExistingValue, restoreSnapshot, takeSnapshot, type Snapshot } from '../core/fill/strategies';

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

  const handleScan = (rules: GenRules): ScanResult => {
    lastRules = rules;
    fields.clear();
    credLinks.clear();
    geoLinks.clear();
    snapshots = [];
    const candidates = scanDocument(document);
    const result: ScanResult = { fields: [], skipped: [] };
    for (const cand of candidates) {
      const id = `f${seq++}`;
      const semantic = inferSemantic(
        `${cand.label} ${cand.root.getAttribute('name') ?? ''} ${cand.root.id}`,
        cand.kind,
      );
      const value = cand.skipped ? '' : makeValue(cand, semantic, rules);
      const dto: FieldDTO = { id, label: cand.label, kind: cand.kind, semantic, value, optionTexts: cand.optionTexts, skipped: cand.skipped, reason: cand.reason };
      fields.set(id, { cand, dto });
      if (cand.skipped) result.skipped.push(dto);
      else result.fields.push(dto);
    }
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
        results.push({ id: cmd.id, ok: true });
        continue;
      }
      snapshots.push(...takeSnapshot(rt.cand.targets));
      try {
        await fillCandidate(rt.cand, cmd.value);
        results.push({ id: cmd.id, ok: true });
      } catch (err) {
        results.push({ id: cmd.id, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      if (++sinceYield >= 50) {
        sinceYield = 0;
        await new Promise((r) => requestAnimationFrame(r));
      }
    }
    // Values written above can render conditionally-shown controls (e.g. choosing
    // 生产性企业 reveals the 产线 count inputs) that were absent at scan time and so
    // missing from `fields`. Re-scan and fill whatever newly appeared; bounded rounds
    // keep a reveal cascade from looping forever.
    for (let round = 0; round < 2; round++) {
      await new Promise((r) => requestAnimationFrame(r));
      const known: Element[] = [];
      for (const rt of fields.values()) known.push(...rt.cand.targets);
      const revealed = scanRevealed(known);
      if (!revealed.length) break;
      for (const cand of revealed) {
        const id = `f${seq++}`;
        const semantic = inferSemantic(
          `${cand.label} ${cand.root.getAttribute('name') ?? ''} ${cand.root.id}`,
          cand.kind,
        );
        const value = makeValue(cand, semantic, lastRules);
        const dto: FieldDTO = { id, label: cand.label, kind: cand.kind, semantic, value, optionTexts: cand.optionTexts };
        fields.set(id, { cand, dto });
        if (!overwrite && hasExistingValue(cand)) {
          results.push({ id, ok: true });
          continue;
        }
        snapshots.push(...takeSnapshot(cand.targets));
        try {
          await fillCandidate(cand, value);
          results.push({ id, ok: true });
        } catch (err) {
          results.push({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
        }
      }
    }
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
          reply(handleScan(msg.rules));
          break;
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

if (!(globalThis as { __ffLoaded?: boolean }).__ffLoaded) {
  (globalThis as { __ffLoaded?: boolean }).__ffLoaded = true;
  bootstrap();
}
