export const POUPAI_HARDENING_VERSION = '2.2.0';

const SUSPICIOUS_DOCUMENT_INSTRUCTION = /\b(ignore|ignorar|desconsidere|system prompt|developer message|assistant|chatgpt|execute|executar|siga estas instru[cç][oõ]es|override|jailbreak)\b/i;

const money = (n) => Number.isFinite(Number(n)) ? Math.round(Number(n) * 100) / 100 : null;
const cepDigits = (v) => String(v || '').replace(/\D/g, '');
const clamp = (n, min, max) => Math.min(max, Math.max(min, n));

function textHasNumber(text, value, tolerance = 0.011) {
  if (!text || !Number.isFinite(Number(value))) return false;
  const expected = Number(value);
  const matches = String(text).match(/\d+(?:[.,]\d+)?/g) || [];
  return matches.some((raw) => {
    const parsed = Number(raw.replace(',', '.'));
    return Number.isFinite(parsed) && Math.abs(parsed - expected) <= Math.max(tolerance, Math.abs(expected) * tolerance);
  });
}

function textHasCep(text, cep) {
  const target = cepDigits(cep);
  if (!target) return false;
  return cepDigits(text).includes(target);
}

function textHasProvider(text, provider) {
  if (!text || !provider) return false;
  return String(text).toLowerCase().includes(String(provider).toLowerCase());
}

export function deterministicReaderAudit(extraction = {}, options = {}) {
  const minCriticalConfidence = Number(options.minCriticalConfidence ?? 0.78);
  const minOverallConfidence = Number(options.minOverallConfidence ?? 0.78);
  const issues = [];
  const evidence = extraction.evidence || {};
  const confidence = extraction.confidence || {};

  if (extraction.provider && evidence.provider && !textHasProvider(evidence.provider, extraction.provider)) {
    issues.push({ severity: 'error', code: 'PROVIDER_EVIDENCE_MISMATCH', field: 'provider', message: 'A evidência não sustenta a operadora extraída.' });
  }
  if (extraction.internetMonthlyPrice > 0 && evidence.internetMonthlyPrice && !textHasNumber(evidence.internetMonthlyPrice, extraction.internetMonthlyPrice)) {
    issues.push({ severity: 'error', code: 'PRICE_EVIDENCE_MISMATCH', field: 'internetMonthlyPrice', message: 'A evidência não sustenta o preço isolado da internet.' });
  }
  if (extraction.speedMbps > 0 && evidence.speedMbps && !textHasNumber(evidence.speedMbps, extraction.speedMbps, 0.02)) {
    const gigaEquivalent = extraction.speedMbps >= 1000 && textHasNumber(evidence.speedMbps, extraction.speedMbps / 1000, 0.02);
    const halfGigaEquivalent = extraction.speedMbps === 500 && /0[,.]5\s*(?:giga|gb|gbps)/i.test(String(evidence.speedMbps));
    if (!gigaEquivalent && !halfGigaEquivalent) {
      issues.push({ severity: 'error', code: 'SPEED_EVIDENCE_MISMATCH', field: 'speedMbps', message: 'A evidência não sustenta a velocidade extraída.' });
    }
  }
  if (extraction.cep && evidence.cep && !textHasCep(evidence.cep, extraction.cep)) {
    issues.push({ severity: 'warning', code: 'CEP_EVIDENCE_MISMATCH', field: 'cep', message: 'A evidência do CEP não coincide com o CEP extraído.' });
  }

  for (const field of ['provider', 'internetMonthlyPrice', 'speedMbps']) {
    if (Number(confidence[field] || 0) < minCriticalConfidence) {
      issues.push({ severity: 'warning', code: 'CRITICAL_FIELD_LOW_CONFIDENCE', field, message: `Confiança conservadora insuficiente em ${field}.` });
    }
  }
  if (Number(confidence.overall || 0) < minOverallConfidence) {
    issues.push({ severity: 'warning', code: 'OVERALL_LOW_CONFIDENCE', field: 'confidence.overall', message: 'A confiança geral ficou abaixo do limite conservador.' });
  }

  const invoiceTotal = money(extraction.invoiceTotal);
  const internetPrice = money(extraction.internetMonthlyPrice);
  if (invoiceTotal != null && internetPrice != null && internetPrice > invoiceTotal * 1.03) {
    issues.push({ severity: 'error', code: 'INTERNET_PRICE_ABOVE_INVOICE', field: 'internetMonthlyPrice', message: 'O preço isolado da internet é maior que o total da fatura.' });
  }

  const knownExtras = Array.isArray(extraction.extras)
    ? extraction.extras.map((x) => money(x?.price)).filter((x) => x != null && x >= 0)
    : [];
  if (invoiceTotal != null && internetPrice != null && knownExtras.length) {
    const knownSum = money(internetPrice + knownExtras.reduce((a, b) => a + b, 0));
    if (knownSum > invoiceTotal * 1.05 + 2) {
      issues.push({ severity: 'error', code: 'COMPONENTS_EXCEED_INVOICE', field: 'invoiceTotal', message: 'Internet + adicionais conhecidos ultrapassam o total da fatura.' });
    } else {
      const gap = invoiceTotal - knownSum;
      if (gap > Math.max(30, invoiceTotal * 0.25)) {
        issues.push({ severity: 'warning', code: 'UNEXPLAINED_INVOICE_GAP', field: 'invoiceTotal', message: 'Há uma diferença relevante entre os componentes identificados e o total da fatura.' });
      }
    }
  }

  const promo = extraction.promotion || {};
  if (promo.detected && promo.promotionalPrice != null && promo.regularPrice != null && Number(promo.promotionalPrice) > Number(promo.regularPrice)) {
    issues.push({ severity: 'warning', code: 'PROMO_PRICE_INVERTED', field: 'promotion', message: 'O preço promocional ficou acima do preço regular.' });
  }

  const suspiciousEvidence = Object.values(evidence).filter(Boolean).find((value) => SUSPICIOUS_DOCUMENT_INSTRUCTION.test(String(value)));
  const suspiciousWarning = Array.isArray(extraction.warnings) && extraction.warnings.some((x) => /instruction|prompt|instru[cç][aã]o|jailbreak/i.test(String(x)));
  if (suspiciousEvidence || suspiciousWarning) {
    issues.push({ severity: 'warning', code: 'DOCUMENT_INSTRUCTION_DETECTED', field: 'document', message: 'O documento contém texto que parece instrução para IA; foi tratado apenas como dado.' });
  }

  const blocking = issues.some((x) => x.severity === 'error');
  const needsConfirmation = issues.some((x) => x.severity === 'warning' && ['CRITICAL_FIELD_LOW_CONFIDENCE', 'OVERALL_LOW_CONFIDENCE', 'CEP_EVIDENCE_MISMATCH', 'DOCUMENT_INSTRUCTION_DETECTED'].includes(x.code));

  return {
    version: POUPAI_HARDENING_VERSION,
    safeToUse: !blocking && !needsConfirmation,
    blocking,
    needsConfirmation,
    issues,
  };
}

export function hardenMarketResult(marketResult = {}, options = {}) {
  const minOfferConfidence = Number(options.minOfferConfidence ?? 0.75);
  const maxOfferAgeDays = Number(options.maxOfferAgeDays ?? 60);
  const staleAfterDays = Number(options.staleAfterDays ?? 21);
  const asOf = new Date(options.asOfDate || marketResult.checkedAt || Date.now());
  const rejectedOffers = [];
  const warnings = [];

  const offers = (marketResult.offers || []).filter((offer) => {
    const reasons = [];
    if (!offer?.provider) reasons.push('provider_missing');
    if (!(Number(offer?.priceMonthly) > 0)) reasons.push('price_missing');
    if (!(Number(offer?.speedMbps) > 0)) reasons.push('speed_missing');
    if (!offer?.sourceUrl || offer?.sourceOfficial === false) reasons.push('official_source_missing');
    if (!offer?.sourceCheckedAt) reasons.push('checked_at_missing');
    if (Number(offer?.confidence || 0) < minOfferConfidence) reasons.push('low_confidence');
    if (!offer?.priceEvidence) reasons.push('price_evidence_missing');

    if (offer?.sourceCheckedAt) {
      const checked = new Date(`${String(offer.sourceCheckedAt).slice(0, 10)}T00:00:00Z`);
      const ageDays = Math.floor((asOf - checked) / 86400000);
      if (Number.isFinite(ageDays)) {
        if (ageDays > maxOfferAgeDays) reasons.push('offer_too_old');
        else if (ageDays > staleAfterDays) warnings.push({ code: 'STALE_OFFER', offerId: offer.id || null, ageDays });
      }
    }

    if (reasons.length) {
      rejectedOffers.push({ offerId: offer?.id || null, provider: offer?.provider || null, reasons });
      return false;
    }
    return true;
  });

  const providers = [...new Set(offers.map((x) => x.provider).filter(Boolean))];
  const exactOffers = offers.filter((x) => x.availabilityExact === true || x.availabilityConfirmed === true);
  const checks = marketResult.availabilityChecks || [];
  const completedChecks = checks.filter((x) => ['AVAILABLE', 'UNAVAILABLE'].includes(x.finalAvailability) || ['AVAILABLE', 'UNAVAILABLE'].includes(x.status));
  const verifiedProviderCount = new Set(completedChecks.map((x) => x.provider).filter(Boolean)).size;

  return {
    ...marketResult,
    offers,
    providers,
    hardening: {
      version: POUPAI_HARDENING_VERSION,
      rejectedOffers,
      warnings,
      verifiedProviderCount,
      exactOfferCount: exactOffers.length,
      marketCoverageAdequate: exactOffers.length >= 2 || verifiedProviderCount >= 2,
    },
    quality: {
      ...(marketResult.quality || {}),
      totalOffers: offers.length,
      exactAvailabilityCount: exactOffers.length,
      hasExactAvailability: exactOffers.length > 0,
      safeForFinalDecision: exactOffers.length > 0,
    },
  };
}

export function buildAuditTrace({ extraction, readerAudit, marketResult, engineAnalysis, finalDecision } = {}) {
  const entries = [];
  const add = (stage, action, details = {}) => entries.push({ stage, action, details });
  add('reader', 'critical_fields', {
    provider: extraction?.provider || null,
    speedMbps: extraction?.speedMbps || null,
    internetMonthlyPrice: extraction?.internetMonthlyPrice || null,
    cepPresent: Boolean(extraction?.cep),
  });
  add('reader', 'deterministic_audit', {
    safeToUse: Boolean(readerAudit?.safeToUse),
    issueCodes: (readerAudit?.issues || []).map((x) => x.code),
  });
  add('market', 'offer_filter', {
    accepted: marketResult?.offers?.length || 0,
    rejected: marketResult?.hardening?.rejectedOffers?.length || 0,
    exactOffers: marketResult?.hardening?.exactOfferCount || 0,
    verifiedProviders: marketResult?.hardening?.verifiedProviderCount || 0,
  });
  add('engine', 'decision', {
    engineDecision: engineAnalysis?.freeDiagnosis?.decision || null,
    finalDecision: finalDecision || null,
    alternatives: engineAnalysis?.fullReport?.alternatives?.length || 0,
  });
  return entries;
}

export function resolveSafeDecision({ requestedDecision, marketResult, readerAudit, engineAnalysis } = {}) {
  if (!readerAudit?.safeToUse) return { decision: 'ANALISE_INCONCLUSIVA', reason: 'READER_NOT_TRUSTED' };
  const exactCount = marketResult?.hardening?.exactOfferCount || 0;
  const adequate = Boolean(marketResult?.hardening?.marketCoverageAdequate);
  if (!exactCount) return { decision: 'ANALISE_INCONCLUSIVA', reason: 'NO_EXACT_MARKET_AVAILABILITY' };

  const engineDecision = requestedDecision || engineAnalysis?.freeDiagnosis?.decision || null;
  if (engineDecision === 'MANTENHA' && !adequate) {
    return { decision: 'ANALISE_INCONCLUSIVA', reason: 'INSUFFICIENT_MARKET_COVERAGE_FOR_MAINTAIN' };
  }
  if (!['TROQUE', 'NEGOCIE', 'MANTENHA'].includes(engineDecision)) {
    return { decision: 'ANALISE_INCONCLUSIVA', reason: 'ENGINE_DECISION_INVALID' };
  }
  return { decision: engineDecision, reason: 'VERIFIED' };
}

export async function withRetry(task, options = {}) {
  const attempts = Math.max(1, Math.min(3, Number(options.attempts ?? 2)));
  const baseDelayMs = Math.max(0, Number(options.baseDelayMs ?? 250));
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try { return await task(attempt); }
    catch (error) {
      lastError = error;
      if (attempt >= attempts) break;
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
    }
  }
  throw lastError;
}

export async function fetchWithTimeout(url, init = {}, timeoutMs = 20000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('TIMEOUT')), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function scorePipelineHealth({ readerAudit, marketResult, metrics = {} } = {}) {
  let score = 100;
  if (!readerAudit?.safeToUse) score -= 40;
  score -= Math.min(20, (readerAudit?.issues || []).length * 4);
  if (!(marketResult?.hardening?.exactOfferCount > 0)) score -= 25;
  if (!marketResult?.hardening?.marketCoverageAdequate) score -= 10;
  if (Number(metrics.totalLatencyMs || 0) > 30000) score -= 5;
  return clamp(Math.round(score), 0, 100);
}
