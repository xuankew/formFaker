// Dev-only harness: exposes core APIs on window for manual browser verification of
// widget fill paths (not referenced by the extension manifest).
import { scanDocument } from '../core/scan';
import { inferSemantic } from '../core/semantics/infer';
import { resolveCredentialLink, resolveGeoLink } from '../core/semantics/link';
import { coordForText } from '../core/generators/geo';
import { generate } from '../core/generators';
import { fillCandidate, clearCandidate, hasExistingValue } from '../core/fill/strategies';

(globalThis as Record<string, unknown>).__ff = { scanDocument, inferSemantic, generate, fillCandidate, clearCandidate, hasExistingValue, resolveCredentialLink, resolveGeoLink, coordForText };
