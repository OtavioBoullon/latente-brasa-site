import assert from 'node:assert/strict';
import { analyzeInternetBillV11, offerCostForMonthsV11, parseBillTextV11 } from '../v11.js';
import { exampleOffers } from '../data/offers.example.js';

const config = { asOfDate: '2026-08-31' };

const claroBill = `
CLARO
FATURA DE SERVIÇOS
CEP 05001-000
Vencimento 10/09/2026
Internet Fibra 500 Mega R$ 149,90
Netflix R$ 20,90
Desconto promocional R$ 10,00 por 6 meses
Total a pagar R$ 160,80
`;

const result = analyzeInternetBillV11({ billText: claroBill, offers: exampleOffers, config });
assert.equal(result.engine, 'Poupai Engine V1.1');
assert.equal(result.version, '1.1.0');
assert.equal(result.bill.provider.name, 'Claro');
assert.equal(result.bill.speedMbps, 500);
assert.equal(result.bill.currentMonthlyCost, 149.9);
assert.equal(result.bill.invoiceTotal, 160.8);
assert.equal(result.bill.cep, '05001-000');
assert.ok(result.bill.confidenceByField.currentMonthlyCost.confidence >= 0.8);
assert.equal(result.validation.validForComparison, true);
assert.equal(result.freeDiagnosis.opportunityFound, true);
assert.ok(['TROQUE', 'NEGOCIE'].includes(result.freeDiagnosis.decision));
assert.ok(result.fullReport.alternatives.length >= 2);
assert.ok(result.fullReport.alternatives[0].estimatedSavings12Months > 0);
assert.ok(result.fullReport.alternatives[0].estimatedSavings24Months > 0);
assert.ok(result.fullReport.negotiationOptions.length >= 1);

const cost12 = offerCostForMonthsV11(exampleOffers[0], 12);
const cost24 = offerCostForMonthsV11(exampleOffers[0], 24);
assert.equal(cost12, 1318.8);
assert.equal(cost24, 2757.6);

const speedVariants = [
  ['Internet 500 Mbps R$ 100,00', 500],
  ['Internet 500 Mega R$ 100,00', 500],
  ['Internet 0,5 Giga R$ 100,00', 500],
  ['Internet 500M R$ 100,00', 500],
];
for (const [line, expected] of speedVariants) {
  const parsed = parseBillTextV11(`VIVO\nCEP 05001-000\n${line}\nTotal a pagar R$ 100,00`);
  assert.equal(parsed.speedMbps, expected);
}

const bundledBill = `
TIM
CEP 05001-000
Internet Ultrafibra 500 Mega
Telefone fixo e TV
Total a pagar R$ 199,90
`;
const bundledResult = analyzeInternetBillV11({ billText: bundledBill, offers: exampleOffers, config });
assert.equal(bundledResult.bill.monthlyCostEstimated, true);
assert.equal(bundledResult.bill.bundleDetected, true);
assert.equal(bundledResult.validation.validForComparison, false);

const noCepResult = analyzeInternetBillV11({
  billText: 'VIVO\nInternet Fibra 300 Mega R$ 129,90\nTotal a pagar R$ 129,90',
  offers: exampleOffers,
  config,
});
assert.equal(noCepResult.validation.validForComparison, false);
assert.equal(noCepResult.freeDiagnosis.status, 'needs_location');

const staleOffers = exampleOffers.map((x) => ({ ...x, sourceCheckedAt: '2025-01-01' }));
const staleResult = analyzeInternetBillV11({ billText: claroBill, offers: staleOffers, config });
assert.equal(staleResult.comparisons.length, 0);
assert.equal(staleResult.freeDiagnosis.decision, 'MANTENHA');

const sameProviderOnly = exampleOffers.filter((x) => x.provider === 'Claro');
const negotiateResult = analyzeInternetBillV11({ billText: claroBill, offers: sameProviderOnly, config });
assert.equal(negotiateResult.freeDiagnosis.decision, 'NEGOCIE');

const competitiveBill = `
VIVO
CEP 05001-000
Internet Fibra 500 Mega R$ 95,00
Total a pagar R$ 95,00
`;
const keepResult = analyzeInternetBillV11({ billText: competitiveBill, offers: exampleOffers, config });
assert.equal(keepResult.freeDiagnosis.decision, 'MANTENHA');

console.log(JSON.stringify({
  status: 'PASS',
  engine: result.engine,
  decision: result.freeDiagnosis.decision,
  poupaiScore: result.freeDiagnosis.poupaiScore,
  bestAlternative: result.fullReport.bestAlternative?.offer?.planName,
  savings12: result.fullReport.bestAlternative?.estimatedSavings12Months,
  savings24: result.fullReport.bestAlternative?.estimatedSavings24Months,
  tests: 7,
}, null, 2));
