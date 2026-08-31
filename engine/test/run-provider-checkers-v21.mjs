import assert from 'node:assert/strict';
import {
  applyAvailabilityChecksToMarket,
  checkerBatchGate,
  normalizeCep,
  providerPublicRequirements,
  strictAvailabilityGate,
  validateAvailabilityRequest,
} from '../provider-checkers-v21.js';

assert.equal(normalizeCep('05001000'), '05001-000');
assert.equal(validateAvailabilityRequest({ cep: '05001-000', number: '123', providers: ['Claro', 'TIM'] }).valid, true);
assert.equal(providerPublicRequirements('Vivo').status, 'CONSENT_REQUIRED');
assert.equal(providerPublicRequirements('Vivo', {
  consentToContactData: true,
  contact: { firstName: 'Ana', phone: '11999999999' },
}).status, 'READY');

const confirmed = strictAvailabilityGate({
  provider: 'Claro',
  status: 'AVAILABLE',
  sourceUrl: 'https://www.claro.com.br/produtosclaro/ofertas_bandalarga/',
  exactAddressSubmitted: true,
  exactAddressMatched: true,
  availabilityConfirmed: true,
  evidence: 'Cobertura disponível para o endereço informado.',
  confidence: 0.96,
});
assert.equal(confirmed.canUpgradeMarketOffer, true);

const weak = strictAvailabilityGate({
  provider: 'TIM',
  status: 'AVAILABLE',
  sourceUrl: 'https://internet.tim.com.br/internet-residencial/consultar-cobertura/planos',
  exactAddressSubmitted: false,
  availabilityConfirmed: true,
  evidence: 'Oferta para São Paulo',
  confidence: 0.99,
});
assert.equal(weak.canUpgradeMarketOffer, false);

const market = {
  quality: { hasExactAvailability: false },
  offers: [
    { provider: 'Claro', planName: '600 Mega', availabilityScope: 'city_or_region', availabilityExact: false, availabilityConfirmed: false, sourceOfficial: true },
    { provider: 'TIM', planName: '700 Mega', availabilityScope: 'city_or_region', availabilityExact: false, availabilityConfirmed: false, sourceOfficial: true },
  ],
};

const merged = applyAvailabilityChecksToMarket(market, [confirmed, {
  provider: 'TIM',
  status: 'UNAVAILABLE',
  sourceUrl: 'https://internet.tim.com.br/internet-residencial/consultar-cobertura/planos',
  exactAddressSubmitted: true,
  availabilityConfirmed: false,
  evidence: 'Ainda não atendemos este endereço.',
  confidence: 0.92,
}]);

assert.equal(merged.offers.length, 1);
assert.equal(merged.offers[0].availabilityExact, true);
assert.equal(merged.quality.hasExactAvailability, true);
assert.equal(checkerBatchGate([confirmed]).canRunFinalEngine, true);

console.log(JSON.stringify({
  status: 'PASS',
  confirmed: merged.availabilitySummary.confirmedProviders,
  unavailable: merged.availabilitySummary.unavailableProviders,
  exact: merged.quality.hasExactAvailability,
}, null, 2));
