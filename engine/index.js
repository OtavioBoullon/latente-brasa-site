const DEFAULT_CONFIG = {
  minMonthlySavings: 10,
  minSavingsRate: 0.05,
  minSpeedRatio: 0.8,
  comparisonMonths: 12,
  maxResults: 3,
};

const PROVIDERS = [
  { id: 'claro', name: 'Claro', patterns: [/\bclaro\b/i, /net\s+virtua/i] },
  { id: 'vivo', name: 'Vivo', patterns: [/\bvivo\b/i, /telefonica/i] },
  { id: 'tim', name: 'TIM', patterns: [/\btim\b/i, /tim\s+ultrafibra/i] },
  { id: 'oi', name: 'Oi', patterns: [/\boi\b/i, /oi\s+fibra/i] },
  { id: 'algar', name: 'Algar', patterns: [/\balgar\b/i] },
  { id: 'brisanet', name: 'Brisanet', patterns: [/\bbrisanet\b/i] },
];

const EXTRA_KEYWORDS = [
  'netflix', 'max', 'hbo', 'globoplay', 'disney', 'prime', 'paramount',
  'telefone', 'fixo', 'ponto adicional', 'equipamento', 'modem', 'roteador',
  'serviço digital', 'servico digital', 'antivírus', 'antivirus', 'skeelo',
];

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeWhitespace(text = '') {
  return String(text)
    .replace(/\r/g, '\n')
    .replace(/[\t ]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function parseMoney(value) {
  if (value == null) return null;
  const raw = String(value).replace(/R\$\s?/gi, '').trim();
  if (!raw) return null;
  const normalized = raw.includes(',')
    ? raw.replace(/\./g, '').replace(',', '.')
    : raw;
  const number = Number(normalized.replace(/[^\d.-]/g, ''));
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

function moneyCandidates(text, labels) {
  const candidates = [];
  for (const label of labels) {
    const regex = new RegExp(`${label}[^\\n]{0,70}?(?:R\\$\\s*)?([0-9]{1,4}(?:\\.[0-9]{3})*,[0-9]{2}|[0-9]{1,4}\\.[0-9]{2})`, 'ig');
    let match;
    while ((match = regex.exec(text))) {
      const amount = parseMoney(match[1]);
      if (amount != null) candidates.push({ amount, label, index: match.index, raw: match[0] });
    }
  }
  return candidates;
}

function detectProvider(text) {
  for (const provider of PROVIDERS) {
    if (provider.patterns.some((pattern) => pattern.test(text))) return provider;
  }
  return null;
}

function extractCep(text) {
  const match = text.match(/\b(\d{5})[-\s]?(\d{3})\b/);
  return match ? `${match[1]}-${match[2]}` : null;
}

function extractDueDate(text) {
  const labels = ['vencimento', 'data de vencimento', 'vence em'];
  for (const label of labels) {
    const regex = new RegExp(`${label}[^\\d]{0,20}(\\d{2}[/.-]\\d{2}[/.-]\\d{2,4})`, 'i');
    const match = text.match(regex);
    if (match) return match[1];
  }
  return null;
}

function extractSpeed(text) {
  const matches = [];
  const regex = /\b(\d{2,4}(?:[.,]\d+)?)\s*(gbps|giga(?:s)?|gb|mbps|mega(?:s)?|mb)\b/ig;
  let match;
  while ((match = regex.exec(text))) {
    let speed = Number(match[1].replace(',', '.'));
    const unit = match[2].toLowerCase();
    if (unit.startsWith('g')) speed *= 1000;
    const contextStart = Math.max(0, match.index - 70);
    const contextEnd = Math.min(text.length, regex.lastIndex + 70);
    const context = text.slice(contextStart, contextEnd);
    let confidence = 0.65;
    if (/internet|fibra|banda larga|wifi|wi-fi/i.test(context)) confidence += 0.25;
    if (/upload/i.test(context) && !/download|internet|fibra/i.test(context)) confidence -= 0.2;
    matches.push({ speedMbps: Math.round(speed), confidence: clamp(confidence, 0.2, 0.95), context });
  }
  if (!matches.length) return null;
  matches.sort((a, b) => b.confidence - a.confidence || b.speedMbps - a.speedMbps);
  return matches[0];
}

function extractInternetPrice(text, invoiceTotal) {
  const direct = moneyCandidates(text, [
    'internet', 'banda\\s*larga', 'fibra', 'plano', 'mensalidade', 'serviços de internet', 'servicos de internet'
  ]).filter((x) => x.amount > 10);

  if (direct.length) {
    const plausible = direct
      .filter((x) => !invoiceTotal || x.amount <= invoiceTotal * 1.15)
      .sort((a, b) => b.amount - a.amount);
    if (plausible.length) return { value: plausible[0].amount, confidence: 0.82, evidence: plausible[0].raw, source: 'direct' };
  }

  if (invoiceTotal != null) {
    return { value: invoiceTotal, confidence: 0.55, evidence: 'Usando o total da fatura como aproximação do custo mensal de internet.', source: 'invoice_total_estimate' };
  }

  return null;
}

function extractInvoiceTotal(text) {
  const priorityLabels = [
    'total\\s+a\\s+pagar', 'valor\\s+total', 'total\\s+da\\s+fatura', 'total\\s+desta\\s+fatura', 'valor\\s+da\\s+fatura'
  ];
  const found = moneyCandidates(text, priorityLabels).filter((x) => x.amount > 10);
  if (!found.length) return null;
  return { value: found[0].amount, confidence: 0.94, evidence: found[0].raw };
}

function extractDiscounts(text) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const items = [];
  for (const line of lines) {
    if (!/desconto|promo[cç][aã]o|benef[ií]cio|bonifica/i.test(line)) continue;
    const money = line.match(/-?\s*(?:R\$\s*)?([0-9]{1,4}(?:\.[0-9]{3})*,[0-9]{2}|[0-9]{1,4}\.[0-9]{2})/i);
    items.push({ description: line.slice(0, 180), amount: money ? Math.abs(parseMoney(money[1])) : null });
  }
  return items.slice(0, 10);
}

function extractExtras(text) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const extras = [];
  for (const line of lines) {
    const keyword = EXTRA_KEYWORDS.find((k) => line.toLowerCase().includes(k));
    if (!keyword) continue;
    const money = line.match(/(?:R\$\s*)?([0-9]{1,4}(?:\.[0-9]{3})*,[0-9]{2}|[0-9]{1,4}\.[0-9]{2})/i);
    extras.push({ type: keyword, description: line.slice(0, 180), amount: money ? parseMoney(money[1]) : null });
  }
  return extras.slice(0, 15);
}

function extractPlanName(text, provider, speed) {
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  const scored = lines.map((line) => {
    let score = 0;
    if (/internet|fibra|banda larga|wifi|wi-fi/i.test(line)) score += 2;
    if (provider && line.toLowerCase().includes(provider.name.toLowerCase())) score += 1;
    if (speed && line.includes(String(speed.speedMbps))) score += 1;
    if (line.length > 100) score -= 1;
    return { line, score };
  }).sort((a, b) => b.score - a.score);
  return scored[0]?.score > 0 ? scored[0].line.slice(0, 120) : null;
}

export function parseBillText(rawText, location = {}) {
  const text = normalizeWhitespace(rawText);
  const provider = detectProvider(text);
  const invoiceTotal = extractInvoiceTotal(text);
  const speed = extractSpeed(text);
  const internetPrice = extractInternetPrice(text, invoiceTotal?.value ?? null);
  const cep = location.cep || extractCep(text);

  const confidences = [
    provider ? 0.95 : 0,
    invoiceTotal?.confidence ?? 0,
    speed?.confidence ?? 0,
    internetPrice?.confidence ?? 0,
  ].filter((x) => x > 0);

  return {
    provider: provider ? { id: provider.id, name: provider.name } : null,
    planName: extractPlanName(text, provider, speed),
    invoiceTotal: invoiceTotal?.value ?? null,
    currentMonthlyCost: internetPrice?.value ?? null,
    monthlyCostEstimated: internetPrice?.source === 'invoice_total_estimate',
    speedMbps: speed?.speedMbps ?? null,
    cep: cep || null,
    dueDate: extractDueDate(text),
    discounts: extractDiscounts(text),
    extras: extractExtras(text),
    confidence: confidences.length ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100) / 100 : 0,
    evidence: {
      invoiceTotal: invoiceTotal?.evidence ?? null,
      internetPrice: internetPrice?.evidence ?? null,
      speed: speed?.context ?? null,
    },
  };
}

export function validateBill(bill) {
  const issues = [];
  if (!bill?.provider) issues.push({ field: 'provider', severity: 'error', message: 'Operadora não identificada.' });
  if (!(bill?.currentMonthlyCost > 0)) issues.push({ field: 'currentMonthlyCost', severity: 'error', message: 'Valor mensal do plano não identificado.' });
  if (!(bill?.speedMbps > 0)) issues.push({ field: 'speedMbps', severity: 'error', message: 'Velocidade do plano não identificada.' });
  if (bill?.monthlyCostEstimated) issues.push({ field: 'currentMonthlyCost', severity: 'warning', message: 'O valor do plano não foi isolado; o total da fatura foi usado apenas como estimativa e deve ser confirmado antes de comparar.' });
  if (!bill?.cep) issues.push({ field: 'cep', severity: 'warning', message: 'CEP não encontrado; só ofertas com disponibilidade já confirmada podem ser comparadas.' });
  if (bill?.confidence < 0.65) issues.push({ field: 'confidence', severity: 'warning', message: 'Leitura com baixa confiança; revisar os dados extraídos antes de comparar.' });
  return {
    validForDiagnosis: !issues.some((i) => i.severity === 'error'),
    validForComparison: !issues.some((i) => i.severity === 'error') && !bill?.monthlyCostEstimated && Boolean(bill?.cep),
    issues,
  };
}

function normalizeCep(cep) {
  return String(cep || '').replace(/\D/g, '');
}

function matchesCep(offer, cep) {
  if (offer.availabilityConfirmed === true) return true;
  const normalized = normalizeCep(cep);
  if (!normalized) return false;
  const prefixes = offer.availableCepPrefixes || [];
  return prefixes.some((prefix) => normalized.startsWith(String(prefix).replace(/\D/g, '')));
}

function normalizeOffer(offer) {
  const priceMonthly = Number(offer.priceMonthly);
  const speedMbps = Number(offer.speedMbps);
  const promoMonths = clamp(Number(offer.promotionalMonths || 0), 0, 12);
  const priceAfterPromo = Number(offer.priceAfterPromo ?? priceMonthly);
  const installationFee = Number(offer.installationFee || 0);
  const equipmentFeeMonthly = Number(offer.equipmentFeeMonthly || 0);
  const valid = Boolean(offer.provider && offer.planName && priceMonthly > 0 && speedMbps > 0);
  return {
    ...offer,
    priceMonthly,
    speedMbps,
    promotionalMonths: promoMonths,
    priceAfterPromo,
    installationFee,
    equipmentFeeMonthly,
    valid,
  };
}

export function offerCostForMonths(rawOffer, months = 12) {
  const offer = normalizeOffer(rawOffer);
  if (!offer.valid) return null;
  const promoMonths = Math.min(months, offer.promotionalMonths);
  const regularMonths = Math.max(0, months - promoMonths);
  const serviceCost = promoMonths * offer.priceMonthly + regularMonths * offer.priceAfterPromo;
  return Math.round((serviceCost + offer.installationFee + offer.equipmentFeeMonthly * months) * 100) / 100;
}

function rankReason(comparison) {
  const reasons = [];
  if (comparison.monthlyEquivalentSavings > 0) reasons.push(`economiza cerca de R$ ${comparison.monthlyEquivalentSavings.toFixed(2).replace('.', ',')}/mês em média`);
  if (comparison.speedDeltaPct >= 25) reasons.push(`aumenta a velocidade em ${Math.round(comparison.speedDeltaPct)}%`);
  if (comparison.offer.technology && /fibra|ftth/i.test(comparison.offer.technology)) reasons.push('usa fibra/FTTH');
  if (!comparison.offer.contractMonths) reasons.push('sem fidelidade informada');
  return reasons.join('; ') || 'melhor relação entre preço e velocidade entre as ofertas comparadas';
}

export function compareOffers(bill, rawOffers = [], config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  if (!(bill?.currentMonthlyCost > 0) || !(bill?.speedMbps > 0)) return [];
  const months = cfg.comparisonMonths;
  const currentPeriodCost = bill.currentMonthlyCost * months;

  const comparisons = rawOffers
    .map(normalizeOffer)
    .filter((offer) => offer.valid)
    .filter((offer) => bill.cep ? matchesCep(offer, bill.cep) : offer.availabilityConfirmed === true)
    .map((offer) => {
      const offerPeriodCost = offerCostForMonths(offer, months);
      const savingsPeriod = Math.round((currentPeriodCost - offerPeriodCost) * 100) / 100;
      const monthlyEquivalentSavings = Math.round((savingsPeriod / months) * 100) / 100;
      const savingsRate = currentPeriodCost > 0 ? savingsPeriod / currentPeriodCost : 0;
      const speedRatio = offer.speedMbps / bill.speedMbps;
      const speedDeltaPct = ((offer.speedMbps - bill.speedMbps) / bill.speedMbps) * 100;
      const sourceConfidence = offer.sourceUrl && offer.sourceCheckedAt ? 1 : 0.55;
      const worthIt = monthlyEquivalentSavings >= cfg.minMonthlySavings
        && savingsRate >= cfg.minSavingsRate
        && speedRatio >= cfg.minSpeedRatio;

      const rankingScore = clamp(
        (clamp(savingsRate, -0.5, 0.6) + 0.5) * 50
        + clamp(speedRatio / 2, 0, 1) * 20
        + sourceConfidence * 20
        + (offer.technology && /fibra|ftth/i.test(offer.technology) ? 7 : 0)
        + (!offer.contractMonths ? 3 : 0),
        0,
        100,
      );

      return {
        offer,
        currentPeriodCost: Math.round(currentPeriodCost * 100) / 100,
        offerPeriodCost,
        savingsPeriod,
        monthlyEquivalentSavings,
        savingsRate: Math.round(savingsRate * 10000) / 10000,
        speedDeltaPct: Math.round(speedDeltaPct * 10) / 10,
        speedRatio: Math.round(speedRatio * 100) / 100,
        worthIt,
        rankingScore: Math.round(rankingScore * 10) / 10,
        reason: null,
      };
    })
    .map((comparison) => ({ ...comparison, reason: rankReason(comparison) }))
    .sort((a, b) => {
      if (a.worthIt !== b.worthIt) return a.worthIt ? -1 : 1;
      if (b.savingsPeriod !== a.savingsPeriod) return b.savingsPeriod - a.savingsPeriod;
      return b.rankingScore - a.rankingScore;
    });

  return comparisons;
}

export function calculatePoupaiScore(bill, comparisons = []) {
  if (!(bill?.currentMonthlyCost > 0) || !(bill?.speedMbps > 0) || !comparisons.length) return null;
  const alternatives = comparisons.filter((x) => x.savingsPeriod > 0);
  if (!alternatives.length) return 92;
  const best = alternatives[0];
  const annualSavingsRate = best.savingsRate;
  const speedAdvantage = Math.max(0, best.speedDeltaPct / 100);
  const penalty = annualSavingsRate * 190 + Math.min(20, speedAdvantage * 20);
  return Math.round(clamp(100 - penalty, 10, 98));
}

export function buildDiagnosis(bill, validation, comparisons) {
  const score = calculatePoupaiScore(bill, comparisons);
  const worthwhile = comparisons.filter((x) => x.worthIt && x.savingsPeriod > 0);
  const best = worthwhile[0] || null;
  const allPositive = comparisons.filter((x) => x.savingsPeriod > 0);
  const maxPotential = allPositive.length ? Math.max(...allPositive.map((x) => x.savingsPeriod)) : 0;

  const status = !validation.validForDiagnosis
    ? 'needs_review'
    : comparisons.length === 0
      ? (bill.cep ? 'insufficient_market_data' : 'needs_location')
      : best
        ? 'opportunity_found'
        : 'no_clear_opportunity';

  return {
    status,
    currentPlan: {
      provider: bill.provider?.name ?? null,
      planName: bill.planName,
      monthlyCost: bill.currentMonthlyCost,
      speedMbps: bill.speedMbps,
    },
    poupaiScore: score,
    opportunityFound: Boolean(best),
    potentialSavingsAnnual: Math.round(maxPotential * 100) / 100,
    headline: !validation.validForDiagnosis
      ? 'Precisamos revisar alguns dados da sua fatura.'
      : comparisons.length === 0
        ? (bill.cep
          ? 'Ainda não há ofertas verificadas suficientes para comparar este CEP.'
          : 'Precisamos do CEP ou de uma oferta com disponibilidade confirmada para comparar.')
        : best
          ? `Encontramos potencial de economia de até R$ ${maxPotential.toFixed(2).replace('.', ',')} em 12 meses.`
          : 'Não encontramos uma troca claramente melhor com os dados disponíveis.',
    issues: validation.issues,
  };
}

export function buildFullReport(bill, validation, comparisons, config = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const top = comparisons.filter((x) => x.worthIt).slice(0, cfg.maxResults);
  return {
    generatedAt: new Date().toISOString(),
    bill,
    validation,
    diagnosis: buildDiagnosis(bill, validation, comparisons),
    alternatives: top.map((item, index) => ({
      rank: index + 1,
      provider: item.offer.provider,
      planName: item.offer.planName,
      technology: item.offer.technology || null,
      speedMbps: item.offer.speedMbps,
      advertisedPriceMonthly: item.offer.priceMonthly,
      priceAfterPromo: item.offer.priceAfterPromo,
      promotionalMonths: item.offer.promotionalMonths,
      estimatedCost12Months: item.offerPeriodCost,
      estimatedSavings12Months: item.savingsPeriod,
      averageMonthlySavings: item.monthlyEquivalentSavings,
      speedDeltaPct: item.speedDeltaPct,
      contractMonths: item.offer.contractMonths || 0,
      benefits: item.offer.benefits || [],
      sourceUrl: item.offer.sourceUrl || null,
      sourceCheckedAt: item.offer.sourceCheckedAt || null,
      availabilityConfirmed: Boolean(item.offer.availabilityConfirmed),
      why: item.reason,
    })),
    methodology: {
      comparisonMonths: cfg.comparisonMonths,
      rule: `Uma oferta só é classificada como oportunidade quando economiza pelo menos R$ ${cfg.minMonthlySavings}/mês em média, reduz ao menos ${Math.round(cfg.minSavingsRate * 100)}% do custo e entrega no mínimo ${Math.round(cfg.minSpeedRatio * 100)}% da velocidade atual.`,
      disclaimer: 'Preços, disponibilidade, instalação, fidelidade e benefícios devem ser confirmados no site ou canal oficial da operadora antes da contratação.',
    },
  };
}

export function analyzeInternetBill({ billText, location = {}, offers = [], config = {} }) {
  if (!billText || typeof billText !== 'string') throw new Error('billText precisa conter o texto extraído da fatura.');
  const bill = parseBillText(billText, location);
  const validation = validateBill(bill);
  const comparisons = validation.validForDiagnosis ? compareOffers(bill, offers, config) : [];
  return {
    engine: 'Poupai Engine V1',
    version: '1.0.0',
    bill,
    validation,
    comparisons,
    freeDiagnosis: buildDiagnosis(bill, validation, comparisons),
    fullReport: buildFullReport(bill, validation, comparisons, config),
  };
}
