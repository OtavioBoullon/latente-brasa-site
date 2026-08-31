import assert from 'node:assert/strict';
import { resolveComparisonBaseline, applyComparisonBaseline } from '../billing-baseline-v24.js';
import { structuredBillFromReader } from '../real-bill-v23.js';
import { runPoupaiV24 } from '../pipeline-v2.js';

const powernetSplit = {
  documentType: 'internet_bill',
  provider: 'Powernet Solutions',
  planName: 'Internet residencial',
  internetMonthlyPrice: 30.20,
  invoiceTotal: 94.90,
  speedMbps: null,
  technology: null,
  cep: '27900-000',
  city: 'Macaé',
  state: 'RJ',
  dueDate: '10/09/2023',
  billingPeriod: '10/08/2023 a 09/09/2023',
  bundleDetected: false,
  internetPriceIsolated: true,
  contractMonths: null,
  loyaltyEndDate: null,
  promotion: { detected: false },
  reajustment: { detected: false },
  extras: [
    { name: 'LOCAÇÃO - SVA', price: 34.80, category: 'digital_service' },
    { name: 'OUTROS SERVIÇOS - SVA', price: 29.90, category: 'digital_service' },
  ],
  confidence: { provider: .98, internetMonthlyPrice: .99, invoiceTotal: .99, speedMbps: 0, cep: .99, overall: .95 },
  evidence: {
    provider: 'POWERNET SOLUTIONS',
    internetMonthlyPrice: 'SERVIÇO DE INTERNET - SCM R$ 30,20',
    invoiceTotal: 'Total R$ 94,90',
    speedMbps: null,
    cep: '27900-000 MACAÉ-RJ',
  },
  warnings: [],
};

const baseline = resolveComparisonBaseline(powernetSplit);
assert.equal(baseline.accountingSplitDetected, true);
assert.equal(baseline.componentsMatchInvoice, true);
assert.equal(baseline.internetLinePrice, 30.2);
assert.equal(baseline.providerTiedTotal, 64.7);
assert.equal(baseline.baselineMonthlyCost, 94.9);
assert.equal(baseline.baselineType, 'provider_package_effective');
assert.equal(baseline.safeForComparison, true);

const prepared = applyComparisonBaseline(powernetSplit);
const structured = structuredBillFromReader(prepared);
assert.equal(structured.internetLinePrice, 30.2);
assert.equal(structured.currentMonthlyCost, 94.9);
assert.equal(structured.comparisonBaselineType, 'provider_package_effective');

const oldResult = runPoupaiV24({
  extraction: powernetSplit,
  marketResult: {},
  engineConfig: { asOfDate: '2026-08-31' },
});
assert.equal(oldResult.finalDecision, 'ANALISE_INCONCLUSIVA');
assert.equal(oldResult.decisionReason, 'MULTIPLE_BLOCKERS');
assert.equal(oldResult.blockingReasons.some((x) => x.code === 'MISSING_SPEED'), true);
assert.equal(oldResult.blockingReasons.some((x) => x.code === 'STALE_BILL'), true);
assert.equal(oldResult.billingBaseline.baselineMonthlyCost, 94.9);

const currentSplit = {
  ...powernetSplit,
  speedMbps: 200,
  dueDate: '20/08/2026',
  billingPeriod: '20/07/2026 a 19/08/2026',
  confidence: { ...powernetSplit.confidence, speedMbps: .98, overall: .98 },
  evidence: { ...powernetSplit.evidence, speedMbps: 'Plano 200 Mega' },
};

const exactOffer = {
  id: 'tim-current-test',
  provider: 'TIM',
  planName: 'Fibra 300 Mega',
  speedMbps: 300,
  technology: 'FTTH Fibra',
  priceMonthly: 69.90,
  priceAfterPromo: 69.90,
  promotionalMonths: 12,
  installationFee: 0,
  equipmentFeeMonthly: 0,
  contractMonths: 12,
  benefits: [],
  sourceUrl: 'https://tim.com.br/oferta-teste',
  sourceOfficial: true,
  sourceCheckedAt: '2026-08-31',
  priceEvidence: '300 Mega por R$ 69,90',
  termsEvidence: 'Oferta teste',
  availabilityExact: true,
  availabilityConfirmed: true,
  availabilityLevel: 'address_confirmed',
  confidence: .95,
};

const currentResult = runPoupaiV24({
  extraction: currentSplit,
  marketResult: {
    checkedAt: '2026-08-31',
    location: { cep: '27900-000', city: 'Macaé', state: 'RJ' },
    offers: [exactOffer],
    quality: { hasExactAvailability: true },
  },
  engineConfig: { asOfDate: '2026-08-31' },
});
assert.equal(currentResult.billingBaseline.baselineMonthlyCost, 94.9);
assert.equal(currentResult.analysis.bill.currentMonthlyCost, 94.9);
assert.equal(currentResult.analysis.bill.internetLinePrice, 30.2);
assert.equal(currentResult.analysis.comparisons[0].estimatedSavings12Months, 300);
assert.equal(currentResult.finalDecision, 'TROQUE');

const portableOnly = resolveComparisonBaseline({
  internetMonthlyPrice: 100,
  invoiceTotal: 120,
  extras: [{ name: 'Netflix', price: 20, category: 'streaming' }],
});
assert.equal(portableOnly.accountingSplitDetected, false);
assert.equal(portableOnly.baselineMonthlyCost, 100);
assert.equal(portableOnly.safeForComparison, true);

console.log(JSON.stringify({
  status: 'PASS',
  scenarios: 15,
  powernet: {
    internetLinePrice: baseline.internetLinePrice,
    effectiveBaseline: baseline.baselineMonthlyCost,
    oldBillDecision: oldResult.finalDecision,
    oldBillBlockers: oldResult.blockingReasons.map((x) => x.code),
  },
}, null, 2));
