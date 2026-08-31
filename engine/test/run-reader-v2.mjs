import assert from 'node:assert/strict';
import {
  POUPAI_READER_VERSION,
  buildEngineText,
  extractStructuredOutput,
  normalizeReaderExtraction,
  validateReaderExtraction,
  validateUploadMetadata,
} from '../reader-v2.js';

assert.equal(POUPAI_READER_VERSION, '2.0.0');

const raw = {
  documentType: 'internet_bill',
  provider: 'Claro',
  planName: 'Internet Fibra 500 Mega',
  internetMonthlyPrice: 149.9,
  invoiceTotal: 170.8,
  speedMbps: 500,
  technology: 'Fibra',
  cep: '05001000',
  city: 'São Paulo',
  state: 'sp',
  dueDate: '10/09/2026',
  billingPeriod: 'agosto/2026',
  bundleDetected: true,
  internetPriceIsolated: true,
  contractMonths: 12,
  loyaltyEndDate: null,
  promotion: { detected: true, description: 'desconto de R$ 10 por 6 meses', discountAmount: 10, promotionalPrice: 149.9, regularPrice: 159.9, remainingMonths: 6, endDate: null },
  reajustment: { detected: false, description: null, previousPrice: null, newPrice: null, percentage: null },
  extras: [{ name: 'Netflix', price: 20.9, category: 'streaming' }],
  confidence: { provider: 0.99, internetMonthlyPrice: 0.94, invoiceTotal: 0.98, speedMbps: 0.97, cep: 0.93, overall: 0.95 },
  evidence: { provider: 'CLARO', internetMonthlyPrice: 'Internet Fibra 500 Mega R$ 149,90', invoiceTotal: 'Total a pagar R$ 170,80', speedMbps: '500 Mega', cep: 'CEP 05001-000', promotion: 'desconto R$ 10 por 6 meses', reajustment: null },
  warnings: [],
};

const x = normalizeReaderExtraction(raw);
assert.equal(x.cep, '05001-000');
assert.equal(x.state, 'SP');
assert.equal(x.internetMonthlyPrice, 149.9);
assert.equal(x.extras[0].category, 'streaming');

const validation = validateReaderExtraction(x);
assert.equal(validation.validForDiagnosis, true);
assert.equal(validation.validForMarketComparison, true);
assert.equal(validation.needsCep, false);

const engineText = buildEngineText(x);
assert.match(engineText, /Claro/);
assert.match(engineText, /500 Mega/);
assert.match(engineText, /R\$ 149,90/);
assert.match(engineText, /CEP 05001-000/);

const combo = normalizeReaderExtraction({ ...raw, internetPriceIsolated: false, internetMonthlyPrice: 170.8 });
assert.equal(combo.internetMonthlyPrice, null);
assert.equal(validateReaderExtraction(combo).validForMarketComparison, false);

const noCep = normalizeReaderExtraction({ ...raw, cep: null });
const noCepValidation = validateReaderExtraction(noCep);
assert.equal(noCepValidation.validForDiagnosis, true);
assert.equal(noCepValidation.validForMarketComparison, false);
assert.equal(noCepValidation.needsCep, true);

const lowConfidence = normalizeReaderExtraction({ ...raw, confidence: { ...raw.confidence, internetMonthlyPrice: 0.4 } });
assert.equal(validateReaderExtraction(lowConfidence).needsUserConfirmation, true);

const upload = validateUploadMetadata({ filename: 'conta.pdf', mimeType: 'application/pdf', base64: Buffer.from('fake-pdf').toString('base64') });
assert.equal(upload.valid, true);
const badUpload = validateUploadMetadata({ filename: 'conta.exe', mimeType: 'application/x-msdownload', base64: 'AAAA' });
assert.equal(badUpload.valid, false);

const fakeResponse = {
  output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(raw) }] }],
};
assert.equal(extractStructuredOutput(fakeResponse).provider, 'Claro');

console.log(JSON.stringify({
  status: 'PASS',
  reader: `Poupai Reader V${POUPAI_READER_VERSION}`,
  extraction: x,
  validation,
  engineText,
}, null, 2));
