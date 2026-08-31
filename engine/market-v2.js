export const POUPAI_MARKET_VERSION = '2.0.0';

export const OFFICIAL_PROVIDER_DOMAINS = [
  'claro.com.br',
  'vivo.com.br',
  'tim.com.br',
  'internet.tim.com.br',
  'oi.com.br',
  'algartelecom.com.br',
  'brisanet.com.br',
];

export const MARKET_SEARCH_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    searchedLocation: {
      type: 'object',
      additionalProperties: false,
      properties: {
        cep: { type: ['string', 'null'] },
        city: { type: ['string', 'null'] },
        state: { type: ['string', 'null'] },
      },
      required: ['cep', 'city', 'state'],
    },
    offers: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          provider: { type: 'string' },
          planName: { type: 'string' },
          speedMbps: { type: 'number' },
          technology: { type: ['string', 'null'] },
          priceMonthly: { type: 'number' },
          promotionalMonths: { type: ['number', 'null'] },
          priceAfterPromo: { type: ['number', 'null'] },
          installationFee: { type: ['number', 'null'] },
          equipmentFeeMonthly: { type: ['number', 'null'] },
          contractMonths: { type: ['number', 'null'] },
          benefits: { type: 'array', items: { type: 'string' }, maxItems: 12 },
          sourceUrl: { type: 'string' },
          sourceTitle: { type: ['string', 'null'] },
          priceEvidence: { type: ['string', 'null'] },
          termsEvidence: { type: ['string', 'null'] },
          availabilityScope: {
            type: 'string',
            enum: ['address', 'cep', 'city_or_region', 'national_or_unknown'],
          },
          availabilityReference: { type: ['string', 'null'] },
          availabilityEvidence: { type: ['string', 'null'] },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
        required: [
          'provider', 'planName', 'speedMbps', 'technology', 'priceMonthly',
          'promotionalMonths', 'priceAfterPromo', 'installationFee',
          'equipmentFeeMonthly', 'contractMonths', 'benefits', 'sourceUrl',
          'sourceTitle', 'priceEvidence', 'termsEvidence', 'availabilityScope',
          'availabilityReference', 'availabilityEvidence', 'confidence',
        ],
      },
    },
    notes: { type: 'array', items: { type: 'string' }, maxItems: 12 },
  },
  required: ['searchedLocation', 'offers', 'notes'],
};

export const MARKET_SEARCH_INSTRUCTIONS = `
Você é o Poupai Market. Pesquise SOMENTE ofertas residenciais de internet fixa em sites oficiais das operadoras brasileiras.

Objetivo: localizar ofertas atuais relevantes para o CEP/cidade informados e devolver dados verificáveis para comparação financeira.

Regras obrigatórias:
1. Priorize Claro, Vivo, TIM, Oi, Algar e Brisanet quando houver páginas oficiais relevantes.
2. Não use comparadores, blogs de terceiros, afiliados, anúncios ou páginas de cupons como fonte principal.
3. Não invente preço pós-promoção, fidelidade, instalação, equipamento ou disponibilidade. Use null quando a fonte não informar.
4. sourceUrl deve apontar para a página oficial que sustenta preço/plano. Não use página inicial genérica quando houver uma página de oferta mais específica.
5. priceEvidence e termsEvidence devem ser paráfrases curtas do que a fonte sustenta; não copie longos trechos.
6. availabilityScope='address' SOMENTE se a fonte consultada confirmou explicitamente aquele endereço.
7. availabilityScope='cep' SOMENTE se a fonte confirmou explicitamente o CEP solicitado.
8. Páginas nacionais, estaduais, municipais ou genéricas NÃO significam disponibilidade no imóvel. Nesses casos use city_or_region ou national_or_unknown.
9. Não transforme 'a partir de R$ X' em preço exato sem registrar isso em priceEvidence.
10. Evite planos móveis, internet rural 4G/5G e combos com TV/celular quando houver alternativa de internet fixa isolada. Se um combo for incluído, deixe isso explícito em planName/benefits.
11. Procure condições promocionais e preço após promoção quando disponíveis.
12. Retorne no máximo 20 ofertas e remova duplicatas óbvias.
`;

const PROVIDER_ALIASES = [
  [/\bclaro\b|\bnet\b/i, 'Claro'],
  [/\bvivo\b|telefonica/i, 'Vivo'],
  [/\btim\b/i, 'TIM'],
  [/\boi\b/i, 'Oi'],
  [/\balgar\b/i, 'Algar'],
  [/\bbrisanet\b/i, 'Brisanet'],
];

const num = (value, fallback = null) => {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const money = (value) => {
  const n = num(value);
  return n === null ? null : Math.round(n * 100) / 100;
};
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const cleanText = (v, max = 240) => v == null ? null : String(v).replace(/\s+/g, ' ').trim().slice(0, max) || null;
const cepDigits = (v) => String(v || '').replace(/\D/g, '');
const isoDate = (d = new Date()) => new Date(d).toISOString().slice(0, 10);

function canonicalProvider(value) {
  const text = String(value || '').trim();
  for (const [pattern, name] of PROVIDER_ALIASES) if (pattern.test(text)) return name;
  return text.slice(0, 60) || null;
}

function hostnameOf(url) {
  try { return new URL(url).hostname.toLowerCase().replace(/^www\./, ''); } catch { return null; }
}

export function isOfficialProviderUrl(url) {
  const host = hostnameOf(url);
  if (!host) return false;
  return OFFICIAL_PROVIDER_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function normalizeSpeed(value) {
  const n = num(value);
  if (!(n > 0)) return null;
  return Math.round(n);
}

function inferTechnologyQuality(technology = '') {
  const t = String(technology).toLowerCase();
  if (/ftth|100%\s*fibra|fiber to the home/.test(t)) return 1;
  if (/fibra|ultrafibra/.test(t)) return 0.9;
  if (/hfc|coax|cabo/.test(t)) return 0.68;
  if (/radio|rádio/.test(t)) return 0.4;
  if (/dsl|cobre/.test(t)) return 0.3;
  return 0.65;
}

function locationMatch(scope, reference, context) {
  const requestedCep = cepDigits(context?.cep);
  const requestedCity = String(context?.city || '').trim().toLowerCase();
  const ref = String(reference || '').toLowerCase();

  if (scope === 'address') {
    if (context?.addressConfirmationTrusted === true) {
      return { level: 'address_confirmed', confidence: 1, exact: true };
    }
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

export function normalizeMarketOffer(raw, context = {}, options = {}) {
  const checkedAt = options.checkedAt || isoDate();
  const provider = canonicalProvider(raw?.provider);
  const sourceUrl = cleanText(raw?.sourceUrl, 1000);
  const speedMbps = normalizeSpeed(raw?.speedMbps);
  const priceMonthly = money(raw?.priceMonthly);
  const availabilityScope = raw?.availabilityScope || 'national_or_unknown';
  const availability = locationMatch(availabilityScope, raw?.availabilityReference, context);
  const sourceOfficial = isOfficialProviderUrl(sourceUrl);

  const promotionalMonths = num(raw?.promotionalMonths, 0);
  const priceAfterPromo = money(raw?.priceAfterPromo ?? priceMonthly);
  const installationFee = money(raw?.installationFee ?? 0);
  const equipmentFeeMonthly = money(raw?.equipmentFeeMonthly ?? 0);
  const contractMonths = num(raw?.contractMonths, null);
  const rawConfidence = clamp(num(raw?.confidence, 0.5), 0, 1);
  const evidenceScore = [raw?.priceEvidence, raw?.termsEvidence, raw?.availabilityEvidence].filter(Boolean).length / 3;
  const confidence = clamp(
    rawConfidence * 0.42 +
    (sourceOfficial ? 0.28 : 0) +
    availability.confidence * 0.18 +
    evidenceScore * 0.12,
    0,
    1,
  );

  const errors = [];
  if (!provider) errors.push('provider_missing');
  if (!raw?.planName) errors.push('plan_name_missing');
  if (!(speedMbps > 0)) errors.push('speed_missing');
  if (!(priceMonthly > 0)) errors.push('price_missing');
  if (!sourceOfficial) errors.push('non_official_source');

  return {
    id: raw?.id || `${String(provider || 'provider').toLowerCase().replace(/\W+/g, '-')}-${speedMbps || 'x'}-${priceMonthly || 'x'}`,
    provider,
    planName: cleanText(raw?.planName, 180),
    speedMbps,
    technology: cleanText(raw?.technology, 120),
    technologyQuality: inferTechnologyQuality(raw?.technology),
    priceMonthly,
    promotionalMonths: Math.max(0, Math.round(promotionalMonths || 0)),
    priceAfterPromo,
    installationFee,
    equipmentFeeMonthly,
    contractMonths: contractMonths == null ? null : Math.max(0, Math.round(contractMonths)),
    benefits: Array.isArray(raw?.benefits) ? raw.benefits.map((x) => cleanText(x, 120)).filter(Boolean).slice(0, 12) : [],
    sourceUrl,
    sourceTitle: cleanText(raw?.sourceTitle, 180),
    sourceCheckedAt: checkedAt,
    priceEvidence: cleanText(raw?.priceEvidence, 260),
    termsEvidence: cleanText(raw?.termsEvidence, 260),
    availabilityEvidence: cleanText(raw?.availabilityEvidence, 260),
    availabilityScope,
    availabilityReference: cleanText(raw?.availabilityReference, 180),
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
    .map((x) => String(x || '').toLowerCase().replace(/\s+/g, ' ').trim())
    .join('|');
}

export function normalizeMarketSearch(rawSearch, context = {}, options = {}) {
  const checkedAt = options.checkedAt || isoDate();
  const normalized = (rawSearch?.offers || [])
    .map((offer) => normalizeMarketOffer(offer, context, { checkedAt }))
    .filter((offer) => offer.valid);

  const map = new Map();
  for (const offer of normalized) {
    const key = dedupeKey(offer);
    const existing = map.get(key);
    if (!existing || offer.confidence > existing.confidence) map.set(key, offer);
  }

  const offers = [...map.values()].sort((a, b) =>
    Number(b.availabilityExact) - Number(a.availabilityExact) ||
    b.confidence - a.confidence ||
    a.priceMonthly - b.priceMonthly ||
    b.speedMbps - a.speedMbps
  );

  const exactAvailabilityCount = offers.filter((o) => o.availabilityExact).length;
  const officialSourceCount = offers.filter((o) => o.sourceOfficial).length;
  const providers = [...new Set(offers.map((o) => o.provider))];

  return {
    market: `Poupai Market V${POUPAI_MARKET_VERSION}`,
    checkedAt,
    location: {
      cep: context?.cep || rawSearch?.searchedLocation?.cep || null,
      city: context?.city || rawSearch?.searchedLocation?.city || null,
      state: context?.state || rawSearch?.searchedLocation?.state || null,
    },
    offers,
    providers,
    notes: Array.isArray(rawSearch?.notes) ? rawSearch.notes.map((x) => cleanText(x, 260)).filter(Boolean).slice(0, 12) : [],
    quality: {
      totalOffers: offers.length,
      officialSourceCount,
      exactAvailabilityCount,
      hasExactAvailability: exactAvailabilityCount > 0,
      safeForFinalDecision: exactAvailabilityCount > 0,
    },
  };
}

export function marketOffersForEngine(marketResult, options = {}) {
  const allowCandidates = options.allowCandidates === true;
  const cep = cepDigits(marketResult?.location?.cep);

  return (marketResult?.offers || [])
    .filter((offer) => offer.availabilityExact || allowCandidates)
    .map((offer) => ({
      id: offer.id,
      provider: offer.provider,
      planName: offer.planName,
      speedMbps: offer.speedMbps,
      technology: offer.technology,
      priceMonthly: offer.priceMonthly,
      promotionalMonths: offer.promotionalMonths,
      priceAfterPromo: offer.priceAfterPromo,
      installationFee: offer.installationFee,
      equipmentFeeMonthly: offer.equipmentFeeMonthly,
      contractMonths: offer.contractMonths,
      benefits: offer.benefits,
      sourceUrl: offer.sourceUrl,
      sourceCheckedAt: offer.sourceCheckedAt,
      availabilityConfirmed: offer.availabilityExact,
      availableCepPrefixes: offer.availabilityExact ? [] : (cep ? [cep.slice(0, 5)] : []),
      marketAvailabilityLevel: offer.availabilityLevel,
      marketConfidence: offer.confidence,
    }));
}

export function marketDecisionGate(marketResult) {
  const offers = marketResult?.offers || [];
  if (!offers.length) {
    return {
      status: 'NO_OFFERS_FOUND',
      canRunFinalEngine: false,
      canRunPreliminaryEngine: false,
      message: 'Nenhuma oferta oficial válida foi encontrada para comparação.',
    };
  }
  if (marketResult?.quality?.hasExactAvailability) {
    return {
      status: 'READY_FOR_FINAL_ENGINE',
      canRunFinalEngine: true,
      canRunPreliminaryEngine: true,
      message: 'Há pelo menos uma oferta com disponibilidade confirmada no endereço.',
    };
  }
  return {
    status: 'ADDRESS_CONFIRMATION_REQUIRED',
    canRunFinalEngine: false,
    canRunPreliminaryEngine: true,
    message: 'Há ofertas oficiais para análise econômica, mas a disponibilidade no imóvel ainda precisa ser confirmada.',
  };
}

export function extractStructuredMarketOutput(responsePayload) {
  const directText = responsePayload?.output_text;
  if (typeof directText === 'string' && directText.trim()) return JSON.parse(directText);

  for (const item of responsePayload?.output || []) {
    if (item?.type !== 'message') continue;
    for (const part of item?.content || []) {
      if (part?.type === 'output_text' && typeof part.text === 'string') return JSON.parse(part.text);
    }
  }
  throw new Error('Resposta estruturada do Poupai Market não encontrada.');
}
