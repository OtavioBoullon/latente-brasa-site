import assert from 'node:assert/strict';
import { analyzeInternetBill } from '../index.js';
import { exampleOffers } from '../data/offers.example.js';

const claroBill = `
CLARO
FATURA DE SERVIÇOS
CEP 05001-000
Vencimento 10/09/2026
Internet Fibra 500 Mega R$ 149,90
Netflix R$ 20,90
Desconto promocional R$ 10,00
Total a pagar R$ 160,80
`;

const result = analyzeInternetBill({ billText: claroBill, offers: exampleOffers });

assert.equal(result.engine, 'Poupai Engine V1');
assert.equal(result.bill.provider.name, 'Claro');
assert.equal(result.bill.speedMbps, 500);
assert.equal(result.bill.currentMonthlyCost, 149.9);
assert.equal(result.bill.invoiceTotal, 160.8);
assert.equal(result.bill.cep, '05001-000');
assert.equal(result.validation.validForDiagnosis, true);
assert.equal(result.validation.validForComparison, true);
assert.equal(result.freeDiagnosis.opportunityFound, true);
assert.ok(result.fullReport.alternatives.length >= 1);
assert.ok(result.fullReport.alternatives[0].estimatedSavings12Months > 0);

const incompleteBill = analyzeInternetBill({ billText: 'Fatura sem dados suficientes', offers: exampleOffers });
assert.equal(incompleteBill.validation.validForDiagnosis, false);
assert.equal(incompleteBill.freeDiagnosis.status, 'needs_review');

const noCepBill = `
VIVO
Internet Fibra 300 Mega R$ 129,90
Total a pagar R$ 129,90
`;
const noCepResult = analyzeInternetBill({ billText: noCepBill, offers: exampleOffers });
assert.equal(noCepResult.validation.validForDiagnosis, true);
assert.equal(noCepResult.validation.validForComparison, false);
assert.equal(noCepResult.comparisons.length, 0);
assert.equal(noCepResult.freeDiagnosis.status, 'needs_location');
assert.equal(noCepResult.freeDiagnosis.poupaiScore, null);

const bundledBill = `
TIM
CEP 05001-000
Internet Ultrafibra 500 Mega
Telefone fixo e serviços digitais
Total a pagar R$ 199,90
`;
const bundledResult = analyzeInternetBill({ billText: bundledBill, offers: exampleOffers });
assert.equal(bundledResult.bill.monthlyCostEstimated, true);
assert.equal(bundledResult.validation.validForComparison, false);

console.log(JSON.stringify({
  status: 'PASS',
  parsedBill: result.bill,
  diagnosis: result.freeDiagnosis,
  bestAlternative: result.fullReport.alternatives[0],
}, null, 2));
