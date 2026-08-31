import assert from 'node:assert/strict';
import {
  isOfficialProviderUrl,
  marketDecisionGate,
  marketOffersForEngine,
  normalizeMarketSearch,
} from '../market-v2.js';

const context = { cep: '05001-000', city: 'São Paulo', state: 'SP' };
const raw = {
  searchedLocation: context,
  notes: ['Teste de normalização'],
  offers: [
    {
      provider: 'TIM', planName: 'Ultrafibra 700 Mega', speedMbps: 700, technology: 'FTTH Fibra',
      priceMonthly: 99.99, promotionalMonths: 12, priceAfterPromo: 129.99,
      installationFee: 0, equipmentFeeMonthly: 0, contractMonths: 12,
      benefits: ['Modem Wi-Fi'], sourceUrl: 'https://internet.tim.com.br/internet-residencial',
      sourceTitle: 'TIM Ultrafibra', priceEvidence: '700 Mega por R$ 99,99/mês',
      termsEvidence: 'Preço promocional', availabilityScope: 'city_or_region',
      availabilityReference: 'São Paulo, SP', availabilityEvidence: 'Página regional', confidence: 0.91,
    },
    {
      provider: 'TIM', planName: 'Ultrafibra 700 Mega', speedMbps: 700, technology: 'FTTH Fibra',
      priceMonthly: 99.99, promotionalMonths: 12, priceAfterPromo: 129.99,
      installationFee: 0, equipmentFeeMonthly: 0, contractMonths: 12,
      benefits: [], sourceUrl: 'https://internet.tim.com.br/internet-residencial',
      sourceTitle: 'duplicada', priceEvidence: 'duplicada', termsEvidence: null,
      availabilityScope: 'national_or_unknown', availabilityReference: null,
      availabilityEvidence: null, confidence: 0.6,
    },
    {
      provider: 'Vivo', planName: 'Fibra 600 Mega', speedMbps: 600, technology: 'Fibra',
      priceMonthly: 123, promotionalMonths: 0, priceAfterPromo: 123,
      installationFee: 0, equipmentFeeMonthly: 0, contractMonths: null,
      benefits: ['Globoplay'], sourceUrl: 'https://vivo.com.br/para-voce/produtos-e-servicos/para-casa/internet',
      sourceTitle: 'Vivo Fibra', priceEvidence: '600 Mega com Globoplay por R$ 123/mês',
      termsEvidence: null, availabilityScope: 'city_or_region', availabilityReference: 'São Paulo',
      availabilityEvidence: 'Oferta para a região', confidence: 0.88,
    },
    {
      provider: 'Operadora Falsa', planName: 'Plano fake', speedMbps: 1000, technology: 'Fibra',
      priceMonthly: 10, promotionalMonths: 0, priceAfterPromo: 10,
      installationFee: 0, equipmentFeeMonthly: 0, contractMonths: 0, benefits: [],
      sourceUrl: 'https://example.com/fake', sourceTitle: 'Fake', priceEvidence: 'fake', termsEvidence: null,
      availabilityScope: 'address', availabilityReference: '05001-000', availabilityEvidence: 'fake', confidence: 1,
    },
  ],
};

const market = normalizeMarketSearch(raw, context, { checkedAt: '2026-08-31' });
assert.equal(isOfficialProviderUrl('https://internet.tim.com.br/internet-residencial'), true);
assert.equal(isOfficialProviderUrl('https://example.com'), false);
assert.equal(market.offers.length, 2);
assert.deepEqual(market.providers.sort(), ['TIM', 'Vivo']);
assert.equal(market.quality.hasExactAvailability, false);
const gate = marketDecisionGate(market);
assert.equal(gate.status, 'ADDRESS_CONFIRMATION_REQUIRED');
assert.equal(gate.canRunPreliminaryEngine, true);
assert.equal(gate.canRunFinalEngine, false);
const candidates = marketOffersForEngine(market, { allowCandidates: true });
assert.equal(candidates.length, 2);
assert.equal(candidates[0].availabilityConfirmed, false);
assert.ok(candidates[0].availableCepPrefixes[0].length === 5);

const exactRaw = structuredClone(raw);
exactRaw.offers = [structuredClone(raw.offers[0])];
exactRaw.offers[0].availabilityScope = 'address';
exactRaw.offers[0].availabilityReference = 'endereço confirmado pelo checker';
exactRaw.offers[0].availabilityEvidence = 'Checker oficial confirmou disponibilidade no imóvel.';
const exact = normalizeMarketSearch(exactRaw, context, { checkedAt: '2026-08-31' });
assert.equal(exact.quality.hasExactAvailability, true);
assert.equal(marketDecisionGate(exact).status, 'READY_FOR_FINAL_ENGINE');
assert.equal(marketOffersForEngine(exact).length, 1);
assert.equal(marketOffersForEngine(exact)[0].availabilityConfirmed, true);

console.log(JSON.stringify({
  status: 'PASS',
  offers: market.offers.length,
  gate: gate.status,
  exactGate: marketDecisionGate(exact).status,
}, null, 2));
