// Dev-only harness: exposes core APIs on window for manual browser verification of
// widget fill paths (not referenced by the extension manifest).
import { scanDocument, scanRevealed, type FieldCandidate } from '../core/scan';
import { walkScroll } from '../core/scan/scroll';
import { inferRule, inferSemantic } from '../core/semantics/infer';
import { resolveCredentialLink, resolveGeoLink } from '../core/semantics/link';
import { coordForText } from '../core/generators/geo';
import { generate } from '../core/generators';
import { buildCatalog, defaultCatalog, pristineRule } from '../core/rules/catalog';
import { parseTemplate, templatePreview, validateTemplate, DSL_HINT } from '../core/rules/dsl';
import { emptyStored, loadRules } from '../core/rules/store';
import type { StoredRules } from '../core/rules/types';
import { fillCandidate, clearCandidate, hasExistingValue } from '../core/fill/strategies';
import { auditEntries, liveValue, type AuditEntry, type AuditReport } from './audit';

export interface SelfCheckReport extends AuditReport {
  scanned: number;
  fillable: number;
  skipped: { label: string; kind: string; reason: string }[];
  filled: { label: string; kind: string; ruleId: string; ruleName: string; value: string; live: string }[];
}

// harness 是手动注入的独立包，真实页里没有 chrome.storage；读不到就按出厂规则跑。
async function storedRules(): Promise<StoredRules> {
  try {
    return await loadRules();
  } catch {
    return emptyStored();
  }
}

// 浏览器端一键自检：扫描（含滚动累积）→ 逐个填充 → 用独立期望表审计落地结果。
// demo 与真实页面都可用（真实页需先注入本 harness），返回可直接贴出来的 JSON。
// 不传 rules 时用当前存储里的规则，保证自检跑的就是用户实际生效的那一套。
async function selfCheck(opts?: { overwrite?: boolean; rules?: StoredRules; maxSteps?: number }): Promise<SelfCheckReport> {
  const catalog = buildCatalog(opts?.rules ?? (await storedRules()));
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
    const rule = inferRule(
      `${cand.label} ${cand.root.getAttribute('name') ?? ''} ${cand.root.id} ${cand.root.getAttribute('placeholder') ?? ''}`,
      cand.kind,
      catalog,
    );
    const value = generate({ kind: cand.kind, ruleId: rule.id, label: cand.label, optionTexts: cand.optionTexts, catalog });
    let error: string | undefined;
    if (overwrite || !hasExistingValue(cand)) {
      try {
        await fillCandidate(cand, value);
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    }
    entries.push({ cand, value, error });
    filled.push({ label: cand.label, kind: cand.kind, ruleId: rule.id, ruleName: rule.name, value, live: liveValue(cand).slice(0, 60) });
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

  const report = await auditEntries(entries, catalog);
  return { scanned: cands.length, fillable: entries.length, skipped, filled, ...report };
}

// 控制台里试写模板用：绑到出厂词库，不用手工拼 env。
const previewTemplate = (src: string, count = 3): string[] =>
  templatePreview(src, { pools: defaultCatalog().pools }, count);
const checkTemplate = (src: string): string | null => validateTemplate(src, { pools: defaultCatalog().pools });

(globalThis as Record<string, unknown>).__ff = {
  scanDocument, scanRevealed, walkScroll,
  inferRule, inferSemantic, generate,
  fillCandidate, clearCandidate, hasExistingValue,
  resolveCredentialLink, resolveGeoLink, coordForText,
  auditEntries, liveValue,
  buildCatalog, loadRules, pristineRule,
  parseTemplate, previewTemplate, checkTemplate, DSL_HINT,
  selfCheck,
};
