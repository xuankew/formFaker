// Dev-only harness: exposes core APIs on window for manual browser verification of
// widget fill paths (not referenced by the extension manifest).
import { scanDocument, scanRevealed, type FieldCandidate } from '../core/scan';
import { walkScroll } from '../core/scan/scroll';
import { inferSemantic } from '../core/semantics/infer';
import { resolveCredentialLink, resolveGeoLink } from '../core/semantics/link';
import { coordForText } from '../core/generators/geo';
import { generate } from '../core/generators';
import { fillCandidate, clearCandidate, hasExistingValue } from '../core/fill/strategies';
import { auditEntries, liveValue, type AuditEntry, type AuditReport } from './audit';
import { DEFAULT_GEN_RULES, type GenRules } from '../shared/types';

export interface SelfCheckReport extends AuditReport {
  scanned: number;
  fillable: number;
  skipped: { label: string; kind: string; reason: string }[];
  filled: { label: string; kind: string; semantic: string; value: string; live: string }[];
}

// 浏览器端一键自检：扫描（含滚动累积）→ 逐个填充 → 用独立期望表审计落地结果。
// demo 与真实页面都可用（真实页需先注入本 harness），返回可直接贴出来的 JSON。
async function selfCheck(opts?: { overwrite?: boolean; rules?: GenRules; maxSteps?: number }): Promise<SelfCheckReport> {
  const rules = opts?.rules ?? DEFAULT_GEN_RULES;
  const overwrite = opts?.overwrite ?? true;
  const known = new Set<Element>();
  const cands: FieldCandidate[] = [];

  const absorb = (cand: FieldCandidate) => {
    known.add(cand.root);
    for (const t of cand.targets) known.add(t);
    cands.push(cand);
  };
  for (const cand of scanDocument(document)) absorb(cand);
  await walkScroll(
    async () => {
      const revealed = scanRevealed(known);
      for (const cand of revealed) absorb(cand);
      return revealed.length;
    },
    { maxSteps: opts?.maxSteps },
  );

  const entries: AuditEntry[] = [];
  const filled: SelfCheckReport['filled'] = [];
  const skipped: SelfCheckReport['skipped'] = [];

  const fillOne = async (cand: FieldCandidate) => {
    const semantic = inferSemantic(
      `${cand.label} ${cand.root.getAttribute('name') ?? ''} ${cand.root.id}`,
      cand.kind,
    );
    const value = generate({ kind: cand.kind, semantic, label: cand.label, optionTexts: cand.optionTexts, rules });
    let error: string | undefined;
    if (overwrite || !hasExistingValue(cand)) {
      try {
        await fillCandidate(cand, value);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    }
    entries.push({ cand, value, error });
    filled.push({ label: cand.label, kind: cand.kind, semantic, value, live: liveValue(cand).slice(0, 60) });
  };

  for (const cand of [...cands]) {
    if (cand.skipped || !cand.targets.length) {
      skipped.push({ label: cand.label, kind: cand.kind, reason: cand.reason ?? '无填充目标' });
      continue;
    }
    await fillOne(cand);
  }

  // 与生产一致：填充本身会揭示条件渲染字段，补两轮再走一遍滚动，否则联动区块漏审。
  const fillRevealed = async (): Promise<number> => {
    const revealed = scanRevealed(known);
    for (const cand of revealed) {
      absorb(cand);
      await fillOne(cand);
    }
    return revealed.length;
  };
  for (let round = 0; round < 2; round++) {
    if (!(await fillRevealed())) break;
  }
  await walkScroll(() => fillRevealed(), { maxSteps: 15 });

  const report = await auditEntries(entries);
  return { scanned: cands.length, fillable: entries.length, skipped, filled, ...report };
}

(globalThis as Record<string, unknown>).__ff = { scanDocument, scanRevealed, walkScroll, inferSemantic, generate, fillCandidate, clearCandidate, hasExistingValue, resolveCredentialLink, resolveGeoLink, coordForText, auditEntries, liveValue, selfCheck };
