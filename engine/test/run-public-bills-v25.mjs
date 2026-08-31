import assert from 'node:assert/strict';
import { PUBLIC_BILLS_CORPUS } from '../data/public-bills-corpus-v25.js';
import { resolveComparisonBaseline, applyComparisonBaseline } from '../billing-baseline-v25.js';
import { auditBillFreshness, structuredBillFromReader } from '../real-bill-v23.js';
import { validateReaderExtraction } from '../reader-v2.js';

const AS_OF = '2026-08-31';
const results = [];

for (const fixture of PUBLIC_BILLS_CORPUS) {
  const baseline = resolveComparisonBaseline(fixture.extraction);
  const freshness = auditBillFreshness(fixture.extraction, { asOfDate: AS_OF });
  const validation = validateReaderExtraction(fixture.extraction, {
    minFieldConfidence: 0.78,
    minOverallConfidence: 0.78,
  });

  assert.equal(
    baseline.baselineType,
    fixture.expected.baselineType,
    `${fixture.id}: baselineType`,
  );
  assert.equal(
    baseline.safeForComparison,
    fixture.expected.safeForComparison,
    `${fixture.id}: safeForComparison`,
  );
  if (fixture.expected.baselineMonthlyCost != null) {
    assert.equal(
      baseline.baselineMonthlyCost,
      fixture.expected.baselineMonthlyCost,
      `${fixture.id}: baselineMonthlyCost`,
    );
  }
  assert.equal(
    freshness.status,
    fixture.expected.freshness,
    `${fixture.id}: freshness`,
  );

  if (fixture.expected.readerBlockingCode) {
    assert.ok(
      validation.issues.some((x) => x.code === fixture.expected.readerBlockingCode),
      `${fixture.id}: expected reader blocker ${fixture.expected.readerBlockingCode}`,
    );
  }

  const prepared = applyComparisonBaseline(fixture.extraction);
  const structured = structuredBillFromReader(prepared);
  if (baseline.safeForComparison && fixture.expected.baselineMonthlyCost != null) {
    assert.equal(
      structured.currentMonthlyCost,
      fixture.expected.baselineMonthlyCost,
      `${fixture.id}: structured currentMonthlyCost`,
    );
  }

  results.push({
    id: fixture.id,
    freshness: freshness.status,
    baselineType: baseline.baselineType,
    baselineMonthlyCost: baseline.baselineMonthlyCost,
    safeForComparison: baseline.safeForComparison,
    readerErrors: validation.issues.filter((x) => x.severity === 'error').map((x) => x.code),
  });
}

const timCurrent = results.find((x) => x.id === 'tim-fibra-500-jul-2026');
assert.equal(timCurrent.baselineMonthlyCost, 99.99);

const unifiqueCurrent = results.find((x) => x.id === 'unifique-fibra-350-jul-2026');
assert.equal(unifiqueCurrent.baselineMonthlyCost, 99.91);

const brisanetCurrent = results.find((x) => x.id === 'brisanet-scm-sva-jul-2026');
assert.equal(brisanetCurrent.baselineMonthlyCost, 99.90);
assert.ok(brisanetCurrent.readerErrors.includes('MISSING_SPEED'));

const vivoBundle = results.find((x) => x.id === 'vivo-total-fibra-500-mar-2026');
assert.equal(vivoBundle.safeForComparison, false);
assert.equal(vivoBundle.baselineType, 'needs_bundle_confirmation');

console.log(JSON.stringify({
  status: 'PASS',
  corpusSize: PUBLIC_BILLS_CORPUS.length,
  asOf: AS_OF,
  results,
}, null, 2));
