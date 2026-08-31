export const POUPAI_REAL_BILL_VERSION = '2.3.0';

function parseBrDate(value) {
  if (!value) return null;
  const text = String(value).trim();
  let match = text.match(/\b(\d{2})[\/.\-](\d{2})[\/.\-](\d{4})\b/);
  if (match) {
    const [, dd, mm, yyyy] = match;
    const date = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  match = text.match(/\b(\d{2})[\/.\-](\d{4})\b/);
  if (match) {
    const [, mm, yyyy] = match;
    const date = new Date(`${yyyy}-${mm}-15T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    const date = new Date(`${iso[1]}-${iso[2]}-${iso[3]}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

function dateFromBillingPeriod(value) {
  if (!value) return null;
  const dates = String(value).match(/\d{2}[\/.\-]\d{2}[\/.\-]\d{4}/g) || [];
  if (dates.length) return parseBrDate(dates.at(-1));
  return parseBrDate(value);
}

export function auditBillFreshness(extraction = {}, options = {}) {
  const maxBillAgeDays = Number(options.maxBillAgeDays ?? 120);
  const warningAfterDays = Number(options.warningAfterDays ?? 60);
  const asOf = new Date(`${String(options.asOfDate || new Date().toISOString().slice(0, 10)).slice(0, 10)}T00:00:00Z`);
  const billDate = parseBrDate(extraction.dueDate)
    || dateFromBillingPeriod(extraction.billingPeriod)
    || parseBrDate(extraction.competence);

  if (!billDate) {
    return {
      version: POUPAI_REAL_BILL_VERSION,
      status: 'UNKNOWN',
      safeForCurrentComparison: false,
      billDate: null,
      ageDays: null,
      code: 'BILL_DATE_UNKNOWN',
      message: 'Não foi possível confirmar a data da fatura; confirme que ela representa o plano atual.',
    };
  }

  const ageDays = Math.floor((asOf - billDate) / 86400000);
  if (ageDays < -31) {
    return {
      version: POUPAI_REAL_BILL_VERSION,
      status: 'INVALID_FUTURE_DATE',
      safeForCurrentComparison: false,
      billDate: billDate.toISOString().slice(0, 10),
      ageDays,
      code: 'BILL_DATE_IN_FUTURE',
      message: 'A data da fatura parece estar no futuro e precisa ser revisada.',
    };
  }
  if (ageDays > maxBillAgeDays) {
    return {
      version: POUPAI_REAL_BILL_VERSION,
      status: 'STALE',
      safeForCurrentComparison: false,
      billDate: billDate.toISOString().slice(0, 10),
      ageDays,
      code: 'STALE_BILL',
      message: `A fatura tem aproximadamente ${ageDays} dias e não pode representar com segurança o plano atual. Envie uma conta recente.`,
    };
  }
  return {
    version: POUPAI_REAL_BILL_VERSION,
    status: ageDays > warningAfterDays ? 'AGING' : 'FRESH',
    safeForCurrentComparison: true,
    billDate: billDate.toISOString().slice(0, 10),
    ageDays,
    code: ageDays > warningAfterDays ? 'AGING_BILL' : 'FRESH_BILL',
    message: ageDays > warningAfterDays
      ? 'A fatura ainda pode ser usada, mas é recomendável confirmar se o plano não mudou desde então.'
      : 'A fatura é recente o suficiente para servir como base da comparação.',
  };
}

export function structuredBillFromReader(extraction = {}) {
  const providerName = String(extraction.provider || '').trim() || null;
  const speedMbps = Number(extraction.speedMbps || 0) || null;
  const currentMonthlyCost = Number(extraction.internetMonthlyPrice || 0) || null;
  const technology = extraction.technology || null;
  const techText = String(technology || '').toLowerCase();
  const technologyQuality = /ftth|100%.*fibra|fibra.*casa/.test(techText) ? 1
    : /fibra/.test(techText) ? 0.9
      : /hfc|coax|cabo/.test(techText) ? 0.68
        : /r[aá]dio|wireless/.test(techText) ? 0.4
          : /dsl|cobre/.test(techText) ? 0.3 : 0.55;

  const conf = extraction.confidence || {};
  const confidenceByField = {
    provider: { value: providerName, confidence: Number(conf.provider || 0) },
    invoiceTotal: { value: extraction.invoiceTotal ?? null, confidence: Number(conf.invoiceTotal || 0) },
    currentMonthlyCost: { value: currentMonthlyCost, confidence: Number(conf.internetMonthlyPrice || 0) },
    speedMbps: { value: speedMbps, confidence: Number(conf.speedMbps || 0) },
    cep: { value: extraction.cep || null, confidence: Number(conf.cep || 0) },
    technology: { value: technology, confidence: technology ? Math.max(0.7, Number(conf.overall || 0)) : 0 },
    planName: { value: extraction.planName || null, confidence: extraction.planName ? Math.max(0.7, Number(conf.overall || 0)) : 0 },
  };
  const critical = ['provider', 'currentMonthlyCost', 'speedMbps'].map((key) => confidenceByField[key].confidence || 0);

  return {
    provider: providerName ? { id: providerName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''), name: providerName } : null,
    planName: extraction.planName || null,
    invoiceTotal: Number(extraction.invoiceTotal || 0) || null,
    currentMonthlyCost,
    monthlyCostEstimated: extraction.internetPriceIsolated === false,
    speedMbps,
    cep: extraction.cep || null,
    dueDate: extraction.dueDate || null,
    technology,
    technologyQuality,
    bundleDetected: Boolean(extraction.bundleDetected),
    pricePerMbps: currentMonthlyCost && speedMbps ? Math.round((currentMonthlyCost / speedMbps) * 100) / 100 : null,
    confidenceByField,
    confidence: Math.round((critical.reduce((a, b) => a + b, 0) / critical.length) * 100) / 100,
    discounts: extraction.promotion?.detected ? [extraction.promotion] : [],
    extras: Array.isArray(extraction.extras) ? extraction.extras : [],
    evidence: extraction.evidence || {},
    source: 'reader_structured_json',
  };
}
