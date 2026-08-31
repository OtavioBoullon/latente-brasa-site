import { parseBillText as parseV1 } from './index.js';

const DEFAULTS = {
  minMonthlySavings: 15,
  minSavingsRate: 0.08,
  minSpeedRatio: 0.8,
  preferredSpeedRatio: 0.95,
  staleAfterDays: 21,
  maxOfferAgeDays: 60,
  maxResults: 5,
  allowStaleOffers: false,
  asOfDate: null,
};

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const money = (n) => Math.round(Number(n || 0) * 100) / 100;
const cepDigits = (v) => String(v || '').replace(/\D/g, '');

function normalizeSpeedNotation(text = '') {
  return String(text)
    .replace(/\b0[,.]5\s*(?:giga(?:s)?|gb|gbps)\b/ig, '500 Mega')
    .replace(/\b1\s*(?:giga(?:s)?|gb|gbps)\b/ig, '1000 Mega')
    .replace(/\b(\d{2,4})\s*M\b/g, '$1 Mbps');
}

function technologyFromText(text = '') {
  const candidates = [
    ['FTTH Fibra', 1, 0.95, /\bftth\b|100%\s*fibra|fibra\s+(?:at[eé]|direto).*casa/i],
    ['Fibra', 0.9, 0.82, /\bfibra\b|ultrafibra/i],
    ['HFC/Cabo', 0.68, 0.88, /\bhfc\b|coaxial|cabo\s+coaxial/i],
    ['Rádio', 0.4, 0.85, /internet\s+(?:via\s+)?r[aá]dio|wireless\s+fixa/i],
    ['DSL/Cobre', 0.3, 0.86, /adsl|vdsl|cobre/i],
  ];
  for (const [name, quality, confidence, pattern] of candidates) {
    const match = text.match(pattern);
    if (match) return { name, quality, confidence, evidence: match[0] };
  }
  return { name: null, quality: 0.55, confidence: 0, evidence: null };
}

function bundleDetected(text, bill) {
  return /combo|internet\s*\+\s*(?:tv|telefone)|tv\s*\+\s*internet|pacote.*(?:tv|telefone)/i.test(text)
    || (bill.extras || []).some((x) => /tv|telefone|fixo/.test(String(x.type)));
}

export function parseBillTextV11(rawText, location = {}) {
  const normalizedText = normalizeSpeedNotation(rawText);
  const bill = parseV1(normalizedText, location);
  const tech = technologyFromText(normalizedText);
  const bundle = bundleDetected(normalizedText, bill);
  const confidenceByField = {
    provider: { value: bill.provider?.name ?? null, confidence: bill.provider ? 0.97 : 0 },
    invoiceTotal: { value: bill.invoiceTotal, confidence: bill.invoiceTotal > 0 ? 0.95 : 0 },
    currentMonthlyCost: { value: bill.currentMonthlyCost, confidence: bill.monthlyCostEstimated ? 0.5 : bill.currentMonthlyCost > 0 ? 0.87 : 0 },
    speedMbps: { value: bill.speedMbps, confidence: bill.speedMbps > 0 ? 0.9 : 0 },
    cep: { value: bill.cep, confidence: bill.cep ? 0.93 : 0 },
    technology: { value: tech.name, confidence: tech.confidence },
    planName: { value: bill.planName, confidence: bill.planName ? 0.78 : 0 },
  };
  const critical = ['provider', 'currentMonthlyCost', 'speedMbps'].map((k) => confidenceByField[k].confidence);
  return {
    ...bill,
    technology: tech.name,
    technologyQuality: tech.quality,
    bundleDetected: bundle,
    pricePerMbps: bill.currentMonthlyCost > 0 && bill.speedMbps > 0 ? money(bill.currentMonthlyCost / bill.speedMbps) : null,
    confidenceByField,
    confidence: money(critical.reduce((a, b) => a + b, 0) / critical.length),
    evidence: { ...(bill.evidence || {}), technology: tech.evidence },
  };
}

export function validateBillV11(bill) {
  const issues = [];
  if (!bill?.provider) issues.push({ field: 'provider', severity: 'error', message: 'Operadora não identificada.' });
  if (!(bill?.currentMonthlyCost > 0)) issues.push({ field: 'currentMonthlyCost', severity: 'error', message: 'Valor mensal não identificado.' });
  if (!(bill?.speedMbps > 0)) issues.push({ field: 'speedMbps', severity: 'error', message: 'Velocidade não identificada.' });
  if (bill?.monthlyCostEstimated) issues.push({ field: 'currentMonthlyCost', severity: 'warning', message: 'O valor da internet não foi isolado do total da fatura.' });
  if (bill?.bundleDetected && bill?.monthlyCostEstimated) issues.push({ field: 'bundle', severity: 'warning', message: 'Combo detectado; comparação bloqueada até isolar o preço da internet.' });
  if (!bill?.cep) issues.push({ field: 'cep', severity: 'warning', message: 'CEP ausente; disponibilidade regional não pode ser validada.' });
  if ((bill?.confidenceByField?.currentMonthlyCost?.confidence ?? 0) < 0.7) issues.push({ field: 'currentMonthlyCost', severity: 'warning', message: 'Baixa confiança no preço identificado.' });
  const hasError = issues.some((x) => x.severity === 'error');
  return {
    validForDiagnosis: !hasError,
    validForComparison: !hasError && !bill?.monthlyCostEstimated && Boolean(bill?.cep) && bill?.confidence >= 0.62,
    issues,
  };
}

function techQuality(value = '') {
  const t = String(value).toLowerCase();
  if (/ftth|100%\s*fibra|fibra.*casa/.test(t)) return 1;
  if (/fibra/.test(t)) return 0.9;
  if (/hfc|coax|cabo/.test(t)) return 0.68;
  if (/r[aá]dio|wireless/.test(t)) return 0.4;
  if (/dsl|cobre/.test(t)) return 0.3;
  return 0.55;
}

function normalizeOffer(raw) {
  const offer = {
    ...raw,
    priceMonthly: Number(raw.priceMonthly),
    priceAfterPromo: Number(raw.priceAfterPromo ?? raw.priceMonthly),
    speedMbps: Number(raw.speedMbps),
    promotionalMonths: clamp(Number(raw.promotionalMonths || 0), 0, 60),
    installationFee: Number(raw.installationFee || 0),
    activationFee: Number(raw.activationFee || 0),
    equipmentFeeMonthly: Number(raw.equipmentFeeMonthly || 0),
    otherOneTimeFees: Number(raw.otherOneTimeFees || 0),
    contractMonths: Number(raw.contractMonths || 0),
  };
  offer.technologyQuality = techQuality(offer.technology);
  offer.valid = Boolean(offer.provider && offer.planName && offer.priceMonthly > 0 && offer.speedMbps > 0);
  return offer;
}

function matchesCep(offer, cep) {
  if (offer.availabilityConfirmed === true) return true;
  const value = cepDigits(cep);
  if (!value) return false;
  return (offer.availableCepPrefixes || []).some((prefix) => value.startsWith(cepDigits(prefix)));
}

function isoDate(v) {
  if (!v) return null;
  const d = new Date(`${String(v).slice(0, 10)}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function freshness(offer, cfg) {
  const checked = isoDate(offer.sourceCheckedAt);
  const asOf = isoDate(cfg.asOfDate) || new Date();
  if (!checked) return { status: 'unverified', ageDays: null, score: 0.35, usable: false };
  const ageDays = Math.max(0, Math.floor((asOf - checked) / 86400000));
  if (ageDays <= cfg.staleAfterDays) return { status: 'fresh', ageDays, score: 1, usable: true };
  if (ageDays <= cfg.maxOfferAgeDays) return { status: 'aging', ageDays, score: 0.72, usable: true };
  return { status: 'stale', ageDays, score: 0.3, usable: Boolean(cfg.allowStaleOffers) };
}

export function offerCostForMonthsV11(rawOffer, months = 12) {
  const o = normalizeOffer(rawOffer);
  if (!o.valid || !(months > 0)) return null;
  const promo = Math.min(months, o.promotionalMonths);
  const regular = Math.max(0, months - promo);
  return money(
    promo * o.priceMonthly
    + regular * o.priceAfterPromo
    + o.installationFee
    + o.activationFee
    + o.otherOneTimeFees
    + o.equipmentFeeMonthly * months
  );
}

function scoreComparison({ savingsRate, speedRatio, techDelta, fresh, sameProvider, contractMonths }) {
  const savings = clamp(savingsRate / 0.35, -0.5, 1) * 45;
  const speed = clamp(speedRatio / 1.25, 0, 1) * 22;
  const technology = clamp((techDelta + 0.5) / 1.5, 0, 1) * 10;
  const evidence = fresh.score * 15;
  const friction = sameProvider ? 6 : 2;
  const fidelityPenalty = contractMonths > 12 ? 6 : contractMonths > 0 ? 2 : 0;
  return Math.round(clamp(10 + savings + speed + technology + evidence + friction - fidelityPenalty, 0, 100));
}

export function compareOffersV11(bill, offers = [], config = {}) {
  const cfg = { ...DEFAULTS, ...config };
  if (!(bill?.currentMonthlyCost > 0) || !(bill?.speedMbps > 0) || !bill?.cep) return [];
  const current12 = bill.currentMonthlyCost * 12;
  const current24 = bill.currentMonthlyCost * 24;

  return offers.map(normalizeOffer)
    .filter((o) => o.valid && matchesCep(o, bill.cep))
    .map((offer) => {
      const fresh = freshness(offer, cfg);
      const cost12 = offerCostForMonthsV11(offer, 12);
      const cost24 = offerCostForMonthsV11(offer, 24);
      const savings12 = money(current12 - cost12);
      const savings24 = money(current24 - cost24);
      const monthlySavings = money(savings12 / 12);
      const savingsRate = current12 > 0 ? savings12 / current12 : 0;
      const speedRatio = offer.speedMbps / bill.speedMbps;
      const speedDeltaPct = ((offer.speedMbps - bill.speedMbps) / bill.speedMbps) * 100;
      const techDelta = offer.technologyQuality - (bill.technologyQuality ?? 0.55);
      const sameProvider = String(offer.provider).toLowerCase() === String(bill.provider?.name || '').toLowerCase();
      const sourceVerified = Boolean(offer.sourceUrl && offer.sourceCheckedAt && fresh.usable);
      const worthIt = monthlySavings >= cfg.minMonthlySavings
        && savingsRate >= cfg.minSavingsRate
        && speedRatio >= cfg.minSpeedRatio
        && sourceVerified;
      const highQualityOpportunity = worthIt && (speedRatio >= cfg.preferredSpeedRatio || techDelta >= 0.2);
      const recommendationScore = scoreComparison({ savingsRate, speedRatio, techDelta, fresh, sameProvider, contractMonths: offer.contractMonths });
      const caveats = [];
      if (speedRatio < 1) caveats.push('Velocidade nominal menor que a atual.');
      if (offer.contractMonths) caveats.push(`Fidelidade informada: ${offer.contractMonths} meses.`);
      if (fresh.status !== 'fresh') caveats.push('Oferta deve ser reconfirmada antes da contratação.');
      if (!offer.availabilityConfirmed) caveats.push('Disponibilidade por CEP; confirmar no endereço exato.');
      return {
        offer,
        sameProvider,
        availability: offer.availabilityConfirmed ? 'confirmed' : 'matched_by_cep_prefix',
        freshness: fresh,
        sourceVerified,
        cost12Months: cost12,
        cost24Months: cost24,
        effectiveMonthlyCost12: money(cost12 / 12),
        effectiveMonthlyCost24: money(cost24 / 24),
        estimatedSavings12Months: savings12,
        estimatedSavings24Months: savings24,
        monthlyEquivalentSavings: monthlySavings,
        savingsRate: money(savingsRate),
        speedRatio: money(speedRatio),
        speedDeltaPct: money(speedDeltaPct),
        pricePerMbps: money(cost12 / 12 / offer.speedMbps),
        currentPricePerMbps: bill.pricePerMbps,
        technologyDelta: money(techDelta),
        worthIt,
        highQualityOpportunity,
        recommendationScore,
        caveats,
      };
    })
    .filter((x) => x.freshness.usable)
    .sort((a, b) => Number(b.highQualityOpportunity) - Number(a.highQualityOpportunity)
      || Number(b.worthIt) - Number(a.worthIt)
      || b.recommendationScore - a.recommendationScore
      || b.estimatedSavings12Months - a.estimatedSavings12Months)
    .slice(0, cfg.maxResults);
}

function poupaiScore(bill, comparisons) {
  if (!comparisons.length) return 100;
  const best = comparisons[0];
  const rate = Math.max(0, best.estimatedSavings12Months / (bill.currentMonthlyCost * 12));
  const ppm = comparisons.map((x) => x.pricePerMbps).filter(Boolean).sort((a, b) => a - b);
  const median = ppm.length ? ppm[Math.floor(ppm.length / 2)] : bill.pricePerMbps;
  const premium = median > 0 ? Math.max(0, ((bill.pricePerMbps || median) - median) / median) : 0;
  return Math.round(clamp(100 - clamp(rate / 0.35, 0, 1) * 55 - clamp(premium / 0.6, 0, 1) * 30 - (best.highQualityOpportunity ? 10 : 0), 0, 100));
}

function decide(comparisons) {
  if (!comparisons.length) return { code: 'MANTENHA', confidence: 0.72, message: 'Nenhuma alternativa verificável claramente melhor foi encontrada.', action: 'Mantenha o plano por enquanto.' };
  const best = comparisons[0];
  const own = comparisons.find((x) => x.sameProvider && x.worthIt);
  if (best.worthIt && !best.sameProvider && best.recommendationScore >= 60) {
    return {
      code: 'TROQUE',
      confidence: money(clamp(0.65 + best.recommendationScore / 300, 0.65, 0.95)),
      message: 'Existe alternativa com economia relevante sem perda excessiva de qualidade.',
      action: own ? 'Tente negociar com sua operadora usando a oferta interna; se não igualarem, considere a melhor alternativa externa.' : 'Confirme a disponibilidade no endereço e as condições finais antes de trocar.',
    };
  }
  if (best.worthIt && best.sameProvider) {
    return { code: 'NEGOCIE', confidence: 0.88, message: 'A própria operadora parece ter condição melhor que a sua.', action: 'Peça migração/retensão para a oferta atual.' };
  }
  if (comparisons.some((x) => x.sourceVerified && x.monthlyEquivalentSavings >= 10)) {
    return { code: 'NEGOCIE', confidence: 0.74, message: 'Seu plano parece acima de referências de mercado, mas a troca ainda não é claramente superior.', action: 'Use as referências para negociar antes de trocar.' };
  }
  return { code: 'MANTENHA', confidence: 0.84, message: 'Seu plano está competitivo frente às alternativas verificadas.', action: 'Mantenha o plano atual.' };
}

export function analyzeInternetBillV11({ billText, location = {}, offers = [], config = {} } = {}) {
  const bill = parseBillTextV11(billText || '', location);
  const validation = validateBillV11(bill);
  const comparisons = validation.validForComparison ? compareOffersV11(bill, offers, config) : [];

  if (!validation.validForDiagnosis) {
    return { engine: 'Poupai Engine V1.1', version: '1.1.0', bill, validation, comparisons: [], freeDiagnosis: { status: 'needs_review', decision: null, opportunityFound: false, poupaiScore: null, message: 'Não foi possível entender a fatura com segurança.' }, fullReport: null };
  }
  if (!validation.validForComparison) {
    return { engine: 'Poupai Engine V1.1', version: '1.1.0', bill, validation, comparisons: [], freeDiagnosis: { status: bill.cep ? 'needs_review' : 'needs_location', decision: null, opportunityFound: false, poupaiScore: null, message: bill.cep ? 'Um dado crítico precisa ser confirmado antes da comparação.' : 'Precisamos do CEP para comparar ofertas da região.' }, fullReport: null };
  }

  const decision = decide(comparisons);
  const ownProvider = comparisons.filter((x) => x.sameProvider && x.monthlyEquivalentSavings > 0);
  const positive = comparisons.filter((x) => x.worthIt && x.estimatedSavings12Months > 0).map((x) => x.estimatedSavings12Months).sort((a, b) => a - b);
  const savingsPotential12Months = positive.length ? { min: positive[0], max: positive.at(-1), periodMonths: 12 } : null;

  return {
    engine: 'Poupai Engine V1.1',
    version: '1.1.0',
    bill,
    validation,
    comparisons,
    freeDiagnosis: {
      status: 'complete',
      decision: decision.code,
      decisionConfidence: decision.confidence,
      opportunityFound: comparisons.some((x) => x.worthIt),
      poupaiScore: poupaiScore(bill, comparisons),
      savingsPotential12Months,
      message: decision.message,
    },
    fullReport: {
      decision,
      currentPlan: { provider: bill.provider?.name, planName: bill.planName, monthlyCost: bill.currentMonthlyCost, speedMbps: bill.speedMbps, technology: bill.technology, pricePerMbps: bill.pricePerMbps },
      bestAlternative: comparisons[0] || null,
      alternatives: comparisons,
      negotiationOptions: ownProvider,
      methodology: {
        horizons: [12, 24],
        currentPlanBaseline: 'Preço mensal atual da fatura, sem assumir reajustes futuros.',
        requiresAddressConfirmation: comparisons.some((x) => x.availability !== 'confirmed'),
        staleOfferPolicy: `Ofertas com mais de ${DEFAULTS.maxOfferAgeDays} dias são excluídas por padrão.`,
      },
    },
  };
}

export const POUPAI_ENGINE_V11_DEFAULTS = Object.freeze({ ...DEFAULTS });
