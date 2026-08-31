import assert from 'node:assert/strict';
import { PUBLIC_BILLS_CORPUS } from '../data/public-bills-corpus-v25.js';
import { runPoupaiV25 } from '../pipeline-v25.js';

const timFixture = PUBLIC_BILLS_CORPUS.find((x) => x.id === 'tim-fibra-500-jul-2026');
assert.ok(timFixture);
const extraction = { ...timFixture.extraction, cep: '20000-000', confidence: { ...timFixture.extraction.confidence, cep: 0.98 }, evidence: { ...timFixture.extraction.evidence, cep: 'CEP 20000-000' } };

const preflight = runPoupaiV25({ extraction, marketResult: {}, engineConfig: { asOfDate: '2026-08-31' } });
assert.equal(preflight.decisionReason, 'INSUFFICIENT_MARKET_DATA');
assert.equal(preflight.billingBaseline.baselineType, 'discounted_internet_line');
assert.equal(preflight.billingBaseline.baselineMonthlyCost, 99.99);
assert.equal(preflight.readerAudit.safeToUse, true);
assert.equal(preflight.readerAudit.reconciledWithBillingBaseline, true);

const marketResult = {
  checkedAt: '2026-08-31',
  location: { cep: '20000-000', city: 'Rio de Janeiro', state: 'RJ' },
  offers: [{
    id: 'claro-live-test', provider: 'Claro', planName: 'Fibra 600 Mega', speedMbps: 600, technology: 'FTTH Fibra',
    priceMonthly: 79.99, promotionalMonths: 12, priceAfterPromo: 79.99, installationFee: 0, equipmentFeeMonthly: 0,
    contractMonths: 12, benefits: [], sourceUrl: 'https://claro.com.br/oferta-teste', sourceOfficial: true,
    sourceCheckedAt: '2026-08-31', priceEvidence: '600 Mega por R$ 79,99', termsEvidence: 'Oferta de teste',
    availabilityExact: true, availabilityConfirmed: true, availabilityLevel: 'address_confirmed', confidence: 0.96,
  }],
  providers: ['Claro'],
  quality: { totalOffers: 1, officialSourceCount: 1, exactAvailabilityCount: 1, hasExactAvailability: true, safeForFinalDecision: true },
};

const final = runPoupaiV25({ extraction, marketResult, engineConfig: { asOfDate: '2026-08-31' } });
assert.equal(final.status, 'FINAL_ANALYSIS_READY');
assert.equal(final.finalDecision, 'TROQUE');
assert.equal(final.analysis.bill.currentMonthlyCost, 99.99);
assert.equal(final.analysis.comparisons[0].offer.provider, 'Claro');
assert.ok(final.analysis.comparisons[0].estimatedSavings12Months > 200);

console.log(JSON.stringify({ status: 'PASS', version: final.pipeline, preflight: preflight.decisionReason, finalDecision: final.finalDecision, baseline: final.billingBaseline.baselineMonthlyCost }, null, 2));
