import assert from 'node:assert/strict';
import { auditBillFreshness, structuredBillFromReader } from '../real-bill-v23.js';
import { analyzeStructuredInternetBill } from '../structured-engine-v23.js';
import { runPoupaiV23 } from '../pipeline-v2.js';

const oldOleBill = {
  documentType: 'internet_bill',
  provider: 'Olé Telecom',
  planName: 'Olé Banda Larga 5Mbps + Wi-Fi',
  internetMonthlyPrice: 79.90,
  invoiceTotal: 79.90,
  speedMbps: 5,
  technology: null,
  cep: '88312-825',
  city: 'Palhoça',
  state: 'SC',
  dueDate: '20/06/2021',
  billingPeriod: '01/06/2021 a 30/06/2021',
  bundleDetected: false,
  internetPriceIsolated: true,
  contractMonths: null,
  loyaltyEndDate: null,
  promotion: { detected: false, description: null, discountAmount: null, promotionalPrice: null, regularPrice: null, remainingMonths: null, endDate: null },
  reajustment: { detected: false, description: null, previousPrice: null, newPrice: null, percentage: null },
  extras: [],
  confidence: { provider: 0.98, internetMonthlyPrice: 0.99, invoiceTotal: 0.99, speedMbps: 0.98, cep: 0.99, overall: 0.98 },
  evidence: {
    provider: 'Empresa Catarinense de Tecnologia em Telecomunicações Ltda. / Olé',
    internetMonthlyPrice: 'Olé Banda Larga 5Mbps + Wi-Fi 79,90',
    invoiceTotal: 'Total 79,90',
    speedMbps: 'Olé Banda Larga 5Mbps + Wi-Fi',
    cep: '88312-825 - PALHOÇA - SC',
    promotion: null,
    reajustment: null,
  },
  warnings: [],
};

const freshness = auditBillFreshness(oldOleBill, { asOfDate: '2026-08-31' });
assert.equal(freshness.status, 'STALE');
assert.equal(freshness.safeForCurrentComparison, false);
assert.equal(freshness.code, 'STALE_BILL');

const structured = structuredBillFromReader(oldOleBill);
assert.equal(structured.provider.name, 'Olé Telecom');
assert.equal(structured.currentMonthlyCost, 79.9);
assert.equal(structured.speedMbps, 5);
assert.equal(structured.cep, '88312-825');

const oldPipeline = runPoupaiV23({
  extraction: oldOleBill,
  marketResult: {},
  engineConfig: { asOfDate: '2026-08-31' },
});
assert.equal(oldPipeline.finalDecision, 'ANALISE_INCONCLUSIVA');
assert.equal(oldPipeline.decisionReason, 'STALE_BILL');
assert.equal(oldPipeline.analysis, null);

const currentRegionalBill = {
  ...oldOleBill,
  provider: 'ISP Regional XYZ',
  planName: 'Fibra 300 Mega',
  internetMonthlyPrice: 149.90,
  invoiceTotal: 149.90,
  speedMbps: 300,
  dueDate: '20/08/2026',
  billingPeriod: '01/08/2026 a 31/08/2026',
  evidence: {
    ...oldOleBill.evidence,
    provider: 'ISP Regional XYZ',
    internetMonthlyPrice: 'Fibra 300 Mega R$ 149,90',
    invoiceTotal: 'Total R$ 149,90',
    speedMbps: 'Fibra 300 Mega',
  },
};

assert.equal(auditBillFreshness(currentRegionalBill, { asOfDate: '2026-08-31' }).safeForCurrentComparison, true);

const offers = [{
  id: 'tim-test',
  provider: 'TIM',
  planName: 'Ultrafibra 600 Mega',
  speedMbps: 600,
  technology: 'FTTH Fibra',
  priceMonthly: 99.90,
  priceAfterPromo: 99.90,
  promotionalMonths: 12,
  installationFee: 0,
  equipmentFeeMonthly: 0,
  contractMonths: 12,
  availabilityConfirmed: true,
  availableCepPrefixes: [],
  sourceUrl: 'https://tim.com.br/oferta-teste',
  sourceCheckedAt: '2026-08-31',
}];
const genericAnalysis = analyzeStructuredInternetBill({
  extraction: currentRegionalBill,
  offers,
  config: { asOfDate: '2026-08-31' },
});
assert.equal(genericAnalysis.bill.provider.name, 'ISP Regional XYZ');
assert.equal(genericAnalysis.validation.validForComparison, true);
assert.equal(genericAnalysis.freeDiagnosis.decision, 'TROQUE');
assert.ok(genericAnalysis.comparisons[0].estimatedSavings12Months > 0);

console.log(JSON.stringify({
  status: 'PASS',
  scenarios: 8,
  realBill: { provider: structured.provider.name, freshness: freshness.status, safeDecision: oldPipeline.finalDecision },
  genericProviderSupported: genericAnalysis.bill.provider.name,
}, null, 2));
