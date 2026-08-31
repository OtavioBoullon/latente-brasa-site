export const POUPAI_CHECKERS_VERSION = '2.1.0';

export const PROVIDER_CHECKER_SPECS = {
  claro: {
    id: 'claro',
    provider: 'Claro',
    officialDomain: 'claro.com.br',
    coverageUrl: 'https://www.claro.com.br/produtosclaro/ofertas_bandalarga/',
    requiredAddressFields: ['cep', 'number'],
    mayRequireContactData: false,
    automationLevel: 'browser_supported',
  },
  tim: {
    id: 'tim',
    provider: 'TIM',
    officialDomain: 'tim.com.br',
    coverageUrl: 'https://internet.tim.com.br/internet-residencial/consultar-cobertura/planos',
    requiredAddressFields: ['cep', 'number'],
    mayRequireContactData: true,
    automationLevel: 'browser_supported_with_fallback',
  },
  vivo: {
    id: 'vivo',
    provider: 'Vivo',
    officialDomain: 'vivo.com.br',
    coverageUrl: 'https://vivo.com.br/para-voce/produtos-e-servicos/para-casa/internet',
    requiredAddressFields: ['cep', 'number'],
    mayRequireContactData: true,
    automationLevel: 'consent_required',
  },
};

const PROVIDER_ALIASES = {
  claro: 'claro', net: 'claro',
  tim: 'tim', 'tim ultrafibra': 'tim',
  vivo: 'vivo', telefonica: 'vivo', telefônica: 'vivo',
};

function cleanText(value, max = 300) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

export function normalizeCep(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : null;
}

export function normalizeHouseNumber(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  if (/^(s\/?n|sem numero|sem número)$/i.test(text)) return 'S/N';
  return text.replace(/[^0-9A-Za-zÀ-ÿ\-\/ ]/g, '').slice(0, 24) || null;
}

export function normalizeProviderId(value) {
  const key = String(value || '').trim().toLowerCase();
  return PROVIDER_ALIASES[key] || null;
}

export function validateAvailabilityRequest(input = {}) {
  const cep = normalizeCep(input.cep);
  const number = normalizeHouseNumber(input.number);
  const rawProviders = Array.isArray(input.providers) && input.providers.length
    ? input.providers
    : Object.keys(PROVIDER_CHECKER_SPECS);
  const providers = [...new Set(rawProviders.map(normalizeProviderId).filter(Boolean))];
  const issues = [];
  if (!cep) issues.push({ field: 'cep', code: 'INVALID_CEP', message: 'Informe um CEP válido com 8 dígitos.' });
  if (!number) issues.push({ field: 'number', code: 'MISSING_NUMBER', message: 'Informe o número do imóvel ou S/N.' });
  if (!providers.length) issues.push({ field: 'providers', code: 'NO_SUPPORTED_PROVIDER', message: 'Nenhuma operadora suportada foi informada.' });
  return { valid: issues.length === 0, address: { cep, number }, providers, issues };
}

export function providerPublicRequirements(providerId, { consentToContactData = false, contact = null } = {}) {
  const id = normalizeProviderId(providerId);
  const spec = id ? PROVIDER_CHECKER_SPECS[id] : null;
  if (!spec) return { supported: false, status: 'UNSUPPORTED_PROVIDER' };

  if (id === 'vivo' && !consentToContactData) {
    return {
      supported: true,
      provider: spec.provider,
      status: 'CONSENT_REQUIRED',
      canAutomateNow: false,
      message: 'A consulta oficial da Vivo pode exigir nome e telefone; o Poupai não envia esses dados sem consentimento explícito.',
    };
  }

  if (id === 'vivo' && consentToContactData) {
    const firstName = cleanText(contact?.firstName, 60);
    const phone = String(contact?.phone || '').replace(/\D/g, '');
    if (!firstName || phone.length < 10 || phone.length > 11) {
      return {
        supported: true,
        provider: spec.provider,
        status: 'CONTACT_DATA_REQUIRED',
        canAutomateNow: false,
        message: 'Nome e telefone válidos são necessários para o fluxo oficial da Vivo.',
      };
    }
  }

  return { supported: true, provider: spec.provider, status: 'READY', canAutomateNow: true, message: 'Consulta pode ser tentada no site oficial.' };
}

export function normalizeRawCheckerResult(raw = {}, context = {}) {
  const providerId = normalizeProviderId(raw.provider || context.provider);
  const spec = providerId ? PROVIDER_CHECKER_SPECS[providerId] : null;
  const sourceUrl = cleanText(raw.sourceUrl, 500) || spec?.coverageUrl || null;
  let sourceOfficial = false;
  try {
    const host = new URL(sourceUrl).hostname.replace(/^www\./, '');
    sourceOfficial = Boolean(spec && (host === spec.officialDomain || host.endsWith(`.${spec.officialDomain}`)));
  } catch { sourceOfficial = false; }

  const statusAllowed = new Set(['AVAILABLE', 'UNAVAILABLE', 'INDETERMINATE', 'CAPTCHA_REQUIRED', 'CONTACT_DATA_REQUIRED', 'CONSENT_REQUIRED', 'CHECK_FAILED', 'UNSUPPORTED_PROVIDER']);
  const status = statusAllowed.has(raw.status) ? raw.status : 'INDETERMINATE';
  const confidence = Math.max(0, Math.min(1, Number(raw.confidence || 0)));

  return {
    checkerVersion: POUPAI_CHECKERS_VERSION,
    providerId,
    provider: spec?.provider || cleanText(raw.provider, 80),
    status,
    sourceUrl,
    sourceOfficial,
    checkedAt: cleanText(raw.checkedAt, 40) || new Date().toISOString(),
    exactAddressSubmitted: Boolean(raw.exactAddressSubmitted),
    exactAddressMatched: Boolean(raw.exactAddressMatched),
    availabilityConfirmed: Boolean(raw.availabilityConfirmed),
    evidence: cleanText(raw.evidence, 500),
    pageSignal: cleanText(raw.pageSignal, 120),
    confidence: Math.round(confidence * 100) / 100,
    plansVisible: Array.isArray(raw.plansVisible) ? raw.plansVisible.slice(0, 12).map((x) => ({
      planName: cleanText(x?.planName, 120),
      speedMbps: Number.isFinite(Number(x?.speedMbps)) ? Number(x.speedMbps) : null,
      priceMonthly: Number.isFinite(Number(x?.priceMonthly)) ? Number(x.priceMonthly) : null,
    })) : [],
    diagnostic: cleanText(raw.diagnostic, 300),
  };
}

export function strictAvailabilityGate(raw, context = {}) {
  const result = normalizeRawCheckerResult(raw, context);
  const hardConfirmed = result.status === 'AVAILABLE'
    && result.sourceOfficial
    && result.exactAddressSubmitted
    && result.availabilityConfirmed
    && result.confidence >= 0.9
    && Boolean(result.evidence);

  const hardUnavailable = result.status === 'UNAVAILABLE'
    && result.sourceOfficial
    && result.exactAddressSubmitted
    && result.confidence >= 0.85
    && Boolean(result.evidence);

  return {
    ...result,
    finalAvailability: hardConfirmed ? 'AVAILABLE' : hardUnavailable ? 'UNAVAILABLE' : 'NOT_CONFIRMED',
    canUpgradeMarketOffer: hardConfirmed,
    safeToExcludeProvider: hardUnavailable,
  };
}

export function applyAvailabilityChecksToMarket(marketResult = {}, rawChecks = []) {
  const checks = rawChecks.map((x) => strictAvailabilityGate(x));
  const byProvider = new Map(checks.filter((x) => x.providerId).map((x) => [x.providerId, x]));
  const offers = Array.isArray(marketResult.offers) ? marketResult.offers : [];

  const upgradedOffers = offers
    .filter((offer) => !byProvider.get(normalizeProviderId(offer.provider))?.safeToExcludeProvider)
    .map((offer) => {
      const check = byProvider.get(normalizeProviderId(offer.provider));
      if (!check?.canUpgradeMarketOffer) return offer;
      return {
        ...offer,
        availabilityScope: 'address',
        availabilityLevel: 'address_confirmed',
        availabilityExact: true,
        availabilityConfirmed: true,
        availabilityReference: 'Endereço confirmado pelo checker oficial do Poupai',
        availabilityEvidence: check.evidence,
        availabilityCheckedAt: check.checkedAt,
        availabilityCheckerVersion: POUPAI_CHECKERS_VERSION,
        availabilitySourceUrl: check.sourceUrl,
      };
    });

  const confirmedProviders = checks.filter((x) => x.canUpgradeMarketOffer).map((x) => x.provider);
  const unavailableProviders = checks.filter((x) => x.safeToExcludeProvider).map((x) => x.provider);
  const exactAvailabilityCount = upgradedOffers.filter((x) => x.availabilityExact === true || x.availabilityConfirmed === true).length;
  const officialSourceCount = upgradedOffers.filter((x) => x.sourceOfficial !== false).length;

  return {
    ...marketResult,
    offers: upgradedOffers,
    quality: {
      ...(marketResult.quality || {}),
      totalOffers: upgradedOffers.length,
      officialSourceCount,
      exactAvailabilityCount,
      hasExactAvailability: exactAvailabilityCount > 0,
      safeForFinalDecision: exactAvailabilityCount > 0,
    },
    availabilityChecks: checks,
    availabilitySummary: {
      confirmedProviders,
      unavailableProviders,
      pendingProviders: checks.filter((x) => !x.canUpgradeMarketOffer && !x.safeToExcludeProvider).map((x) => x.provider),
      hasExactAvailability: confirmedProviders.length > 0,
    },
  };
}

export function checkerBatchGate(rawChecks = []) {
  const checks = rawChecks.map((x) => strictAvailabilityGate(x));
  return {
    canRunFinalEngine: checks.some((x) => x.canUpgradeMarketOffer),
    confirmedProviders: checks.filter((x) => x.canUpgradeMarketOffer).map((x) => x.provider),
    unavailableProviders: checks.filter((x) => x.safeToExcludeProvider).map((x) => x.provider),
    requiresManualOrConsent: checks.some((x) => ['CAPTCHA_REQUIRED', 'CONTACT_DATA_REQUIRED', 'CONSENT_REQUIRED', 'INDETERMINATE'].includes(x.status)),
    checks,
  };
}
