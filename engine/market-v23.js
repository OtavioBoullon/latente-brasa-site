import {
  MARKET_SEARCH_INSTRUCTIONS,
  MARKET_SEARCH_SCHEMA,
  extractStructuredMarketOutput,
} from './market-v2.js';

export const POUPAI_MARKET_V23_VERSION = '2.3.0';

export const OFFICIAL_PROVIDER_DOMAINS_V23 = [
  'claro.com.br',
  'net.com.br',
  'vivo.com.br',
  'tim.com.br',
  'internet.tim.com.br',
  'oi.com.br',
  'niointernet.com.br',
  'algartelecom.com.br',
  'brisanet.com.br',
  'ole.net.br',
  'wiupfibra.com',
  'qerofibra.com.br',
  'unifique.com.br',
  'mhnet.com.br',
  'desktop.com.br',
  'vero.com.br',
  'alaresinternet.com.br',
];

export const MARKET_SEARCH_SCHEMA_V23 = MARKET_SEARCH_SCHEMA;
export const MARKET_SEARCH_INSTRUCTIONS_V23 = `${MARKET_SEARCH_INSTRUCTIONS}
11. Não limite a pesquisa às operadoras nacionais. Quando houver provedores regionais oficiais no local pesquisado, inclua-os se o domínio estiver na lista oficial permitida.
12. Preserve o nome comercial real do provedor regional; não tente convertê-lo para Claro/Vivo/TIM.
13. Para provedores regionais, aplique as mesmas exigências de fonte, preço, evidência e disponibilidade usadas para as grandes operadoras.`;

const cleanText = (v, max = 300) => v == null ? null : String(v).replace(/\s+/g, ' ').trim().slice(0, max) || null;
const num = (v, fallback = null) => Number.isFinite(Number(v)) ? Number(v) : fallback;
const money = (v) => Number.isFinite(Number(v)) ? Math.round(Number(v) * 100) / 100 : null;
const cepDigits = (v) => String(v || '').replace(/\D/g, '');
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

export function isOfficialProviderUrlV23(url) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    return OFFICIAL_PROVIDER_DOMAINS_V23.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

function locationMatch(scope, reference, context) {
  const requestedCep = cepDigits(context?.cep);
  const requestedCity = String(context?.city || '').trim().toLowerCase();
  const ref = String(reference || '').toLowerCase();
  if (scope === 'address') {
    if (context?.addressConfirmationTrusted === true) return { level: 'address_confirmed', confidence: 1, exact: true };
    return { level: 'address_claimed_untrusted', confidence: 0.5, exact: false };
  }
  if (scope === 'cep') {
    const refCep = cepDigits(reference);
    const exact = Boolean(requestedCep && refCep && requestedCep === refCep);
    return { level: exact ? 'cep_confirmed' : 'location_claimed', confidence: exact ? 0.92 : 0.55, exact: false };
  }
  if (scope === 'city_or_region') {
    const cityMatch = Boolean(requestedCity && ref.includes(requestedCity));
    return { level: 'regional_candidate', confidence: cityMatch ? 0.72 : 0.58, exact: false };
  }
  return { level: 'unconfirmed_candidate', confidence: 0.45, exact: false };
}

function technologyQuality(value = '') {
  const t = String(value).toLowerCase();
  if (/ftth|100%\s*fibra|fibra.*casa/.test(t)) return 1;
  if (/fibra/.test(t)) return 0.9;
  if (/hfc|coax|cabo/.test(t)) return 0.68;
  if (/r[aá]dio|wireless/.test(t)) return 0.4;
  if (/dsl|cobre/.test(t)) return 0.3;
  return 0.55;
}

export function normalizeMarketOfferV23(raw = {}, context = {}, options = {}) {
  const checkedAt = options.checkedAt || new Date().toISOString().slice(0, 10);
  const provider = cleanText(raw.provider, 100);
  const sourceUrl = cleanText(raw.sourceUrl, 1000);
  const sourceOfficial = isOfficialProviderUrlV23(sourceUrl);
  const speedMbps = num(raw.speedMbps);
  const priceMonthly = money(raw.priceMonthly);
  const availabilityScope = raw.availabilityScope || 'national_or_unknown';
  const availability = locationMatch(availabilityScope, raw.availabilityReference, context);
  const rawConfidence = clamp(num(raw.confidence, 0.5), 0, 1);
  const evidenceScore = [raw.priceEvidence, raw.termsEvidence, raw.availabilityEvidence].filter(Boolean).length / 3;
  const confidence = clamp(rawConfidence * 0.45 + (sourceOfficial ? 0.3 : 0) + availability.confidence * 0.15 + evidenceScore * 0.1, 0, 1);
  const errors = [];
  if (!provider) errors.push('provider_missing');
  if (!raw.planName) errors.push('plan_name_missing');
  if (!(speedMbps > 0)) errors.push('speed_missing');
  if (!(priceMonthly > 0)) errors.push('price_missing');
  if (!sourceOfficial) errors.push('non_official_source');
  if (!raw.priceEvidence) errors.push('price_evidence_missing');

  return {
    id: raw.id || `${String(provider || 'provider').toLowerCase().replace(/\W+/g, '-')}-${speedMbps || 'x'}-${priceMonthly || 'x'}`,
    provider,
    planName: cleanText(raw.planName, 180),
    speedMbps,
    technology: cleanText(raw.technology, 120),
    technologyQuality: technologyQuality(raw.technology),
    priceMonthly,
    promotionalMonths: Math.max(0, Math.round(num(raw.promotionalMonths, 0) || 0)),
    priceAfterPromo: money(raw.priceAfterPromo ?? priceMonthly),
    installationFee: money(raw.installationFee ?? 0),
    equipmentFeeMonthly: money(raw.equipmentFeeMonthly ?? 0),
    contractMonths: raw.contractMonths == null ? null : Math.max(0, Math.round(num(raw.contractMonths, 0))),
    benefits: Array.isArray(raw.benefits) ? raw.benefits.map((x) => cleanText(x, 120)).filter(Boolean).slice(0, 12) : [],
    sourceUrl,
    sourceTitle: cleanText(raw.sourceTitle, 180),
    sourceCheckedAt: checkedAt,
    priceEvidence: cleanText(raw.priceEvidence, 260),
    termsEvidence: cleanText(raw.termsEvidence, 260),
    availabilityEvidence: cleanText(raw.availabilityEvidence, 260),
    availabilityScope,
    availabilityReference: cleanText(raw.availabilityReference, 180),
    availabilityLevel: availability.level,
    availabilityExact: availability.exact,
    availabilityConfirmed: availability.level === 'address_confirmed',
    sourceOfficial,
    confidence: Math.round(confidence * 100) / 100,
    errors,
    valid: errors.length === 0,
  };
}

function dedupeKey(offer) {
  return [offer.provider, offer.speedMbps, offer.priceMonthly, offer.priceAfterPromo, offer.planName]
    .map((x) => String(x || '').toLowerCase().replace(/\s+/g, ' ').trim()).join('|');
}

export function normalizeMarketSearchV23(rawSearch = {}, context = {}, options = {}) {
  const checkedAt = options.checkedAt || new Date().toISOString().slice(0, 10);
  const map = new Map();
  for (const offer of (rawSearch.offers || []).map((x) => normalizeMarketOfferV23(x, context, { checkedAt })).filter((x) => x.valid)) {
    const key = dedupeKey(offer);
    const existing = map.get(key);
    if (!existing || offer.confidence > existing.confidence) map.set(key, offer);
  }
  const offers = [...map.values()].sort((a, b) => Number(b.availabilityExact) - Number(a.availabilityExact) || b.confidence - a.confidence || a.priceMonthly - b.priceMonthly || b.speedMbps - a.speedMbps);
  const exactAvailabilityCount = offers.filter((x) => x.availabilityExact).length;
  return {
    market: `Poupai Market V${POUPAI_MARKET_V23_VERSION}`,
    checkedAt,
    location: {
      cep: context.cep || rawSearch.searchedLocation?.cep || null,
      city: context.city || rawSearch.searchedLocation?.city || null,
      state: context.state || rawSearch.searchedLocation?.state || null,
    },
    offers,
    providers: [...new Set(offers.map((x) => x.provider))],
    notes: Array.isArray(rawSearch.notes) ? rawSearch.notes.map((x) => cleanText(x, 260)).filter(Boolean).slice(0, 12) : [],
    quality: {
      totalOffers: offers.length,
      officialSourceCount: offers.length,
      exactAvailabilityCount,
      hasExactAvailability: exactAvailabilityCount > 0,
      safeForFinalDecision: exactAvailabilityCount > 0,
    },
  };
}

export { extractStructuredMarketOutput };
