export const POUPAI_BILLING_BASELINE_VERSION = '2.5.0';

const money = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) / 100 : null;
const sum = (values) => money(values.reduce((a, b) => a + b, 0)) ?? 0;

const PORTABLE_PATTERNS = /netflix|disney|globoplay|prime video|amazon prime|paramount|hbo|max\b|deezer|spotify|apple tv|youtube premium/i;
const PROVIDER_TIED_PATTERNS = /\bsva\b|loca[cç][aã]o|aluguel|equipamento|modem|roteador|servi[cç]o digital|outros servi[cç]os|taxa de infraestrutura|comodato|livro digital|refor[cç]a|books?\b|bancah|aya\b|exa seguran[cç]a/i;
const FINANCIAL_CHARGE_PATTERNS = /multa|juros|mora|encargo financeiro|fatura anterior|d[eé]bito anterior|parcelamento/i;

function classifyExtra(extra = {}) {
  const name = String(extra.name || '').trim();
  const category = String(extra.category || 'other');
  const price = money(extra.price);
  if (!(price >= 0)) return { ...extra, price: null, relationship: 'unknown' };

  if (FINANCIAL_CHARGE_PATTERNS.test(name)) {
    return { ...extra, price, relationship: 'financial_charge' };
  }
  if (PORTABLE_PATTERNS.test(name) || category === 'streaming') {
    return { ...extra, price, relationship: 'portable' };
  }
  if (PROVIDER_TIED_PATTERNS.test(name) || ['equipment', 'digital_service'].includes(category)) {
    return { ...extra, price, relationship: 'provider_tied' };
  }
  if (['phone', 'tv'].includes(category)) {
    return { ...extra, price, relationship: 'bundle_service' };
  }
  return { ...extra, price, relationship: 'unknown' };
}

function closeEnough(a, b, tolerance) {
  return a != null && b != null && Math.abs(a - b) <= tolerance;
}

export function resolveComparisonBaseline(extraction = {}, options = {}) {
  const rawInternetLinePrice = money(extraction.internetMonthlyPrice);
  const invoiceTotal = money(extraction.invoiceTotal);
  const promotion = extraction.promotion || {};
  const promoPrice = money(promotion.promotionalPrice);
  const regularPrice = money(promotion.regularPrice);
  const discountAmount = money(promotion.discountAmount);
  const derivedPromoPrice = promoPrice ?? (
    regularPrice != null && discountAmount != null && discountAmount > 0
      ? money(regularPrice - discountAmount)
      : null
  );

  const extras = Array.isArray(extraction.extras) ? extraction.extras.map(classifyExtra) : [];
  const pricedExtras = extras.filter((x) => x.price != null);
  const providerTied = pricedExtras.filter((x) => x.relationship === 'provider_tied');
  const portable = pricedExtras.filter((x) => x.relationship === 'portable');
  const bundleServices = pricedExtras.filter((x) => x.relationship === 'bundle_service');
  const financialCharges = pricedExtras.filter((x) => x.relationship === 'financial_charge');
  const unknown = pricedExtras.filter((x) => x.relationship === 'unknown');

  const providerTiedTotal = sum(providerTied.map((x) => x.price));
  const portableTotal = sum(portable.map((x) => x.price));
  const bundleServicesTotal = sum(bundleServices.map((x) => x.price));
  const financialChargesTotal = sum(financialCharges.map((x) => x.price));
  const unknownTotal = sum(unknown.map((x) => x.price));
  const recurringExtrasTotal = providerTiedTotal + portableTotal + bundleServicesTotal + unknownTotal;

  const tolerance = Math.max(
    Number(options.componentToleranceReais ?? 2),
    (invoiceTotal || 0) * Number(options.componentToleranceRate ?? 0.03),
  );
  const promoTolerance = Math.max(
    Number(options.promoToleranceReais ?? 5),
    (invoiceTotal || 0) * Number(options.promoToleranceRate ?? 0.05),
  );

  let internetLinePrice = rawInternetLinePrice;
  let discountedPlanDetected = false;
  let discountEvidence = null;

  if (
    derivedPromoPrice > 0
    && rawInternetLinePrice > 0
    && derivedPromoPrice < rawInternetLinePrice
    && invoiceTotal > 0
  ) {
    const promoExpectedInvoice = money(derivedPromoPrice + recurringExtrasTotal + financialChargesTotal);
    const promoMatchesInvoice = closeEnough(invoiceTotal, promoExpectedInvoice, promoTolerance);
    if (promoMatchesInvoice) {
      internetLinePrice = derivedPromoPrice;
      discountedPlanDetected = true;
      discountEvidence = {
        rawInternetLinePrice,
        regularPrice,
        promotionalPrice: derivedPromoPrice,
        discountAmount,
        promoExpectedInvoice,
      };
    }
  }

  const componentsTotal = internetLinePrice != null
    ? money(internetLinePrice + recurringExtrasTotal + financialChargesTotal)
    : null;
  const componentsMatchInvoice = invoiceTotal != null && componentsTotal != null
    ? Math.abs(invoiceTotal - componentsTotal) <= Math.max(tolerance, financialChargesTotal ? 5 : tolerance)
    : false;

  const ratio = internetLinePrice && invoiceTotal ? invoiceTotal / internetLinePrice : null;
  const accountingSplitDetected = Boolean(
    internetLinePrice > 0
    && invoiceTotal > 0
    && providerTiedTotal > 0
    && closeEnough(invoiceTotal, componentsTotal, Math.max(tolerance, 2))
    && ratio >= Number(options.minAccountingSplitRatio ?? 1.2)
  );

  const issues = [];
  let baselineMonthlyCost = internetLinePrice;
  let baselineType = discountedPlanDetected ? 'discounted_internet_line' : 'internet_line_only';
  let safeForComparison = Boolean(internetLinePrice > 0);
  let confidence = internetLinePrice > 0 ? (discountedPlanDetected ? 0.95 : 0.9) : 0;

  if (discountedPlanDetected) {
    issues.push({
      code: 'CURRENT_DISCOUNT_APPLIED',
      severity: 'info',
      message: 'A fatura mostra preço cheio e desconto recorrente; a comparação usa o valor líquido atualmente cobrado.',
    });
  }

  if (accountingSplitDetected) {
    baselineMonthlyCost = money(invoiceTotal - portableTotal - bundleServicesTotal - unknownTotal - financialChargesTotal);
    baselineType = 'provider_package_effective';
    confidence = unknownTotal > 0 || bundleServicesTotal > 0 ? 0.72 : 0.94;
    safeForComparison = unknownTotal === 0 && bundleServicesTotal === 0 && baselineMonthlyCost > 0;
    issues.push({
      code: 'ACCOUNTING_SPLIT_DETECTED',
      severity: 'info',
      message: 'A fatura divide o pacote recorrente entre SCM e componentes ligados à operadora; a comparação usa o custo efetivo do pacote.',
    });
  }

  if (bundleServicesTotal > 0) {
    safeForComparison = false;
    baselineType = 'needs_bundle_confirmation';
    issues.push({
      code: 'BUNDLE_SERVICE_CONFIRMATION_REQUIRED',
      severity: 'warning',
      message: 'Há TV/telefone/móvel no pacote e não é seguro assumir o preço da internet de forma independente sem validar a regra do combo.',
    });
  }

  if (portableTotal > 0 && !bundleServicesTotal && !accountingSplitDetected) {
    issues.push({
      code: 'PORTABLE_SERVICES_EXCLUDED',
      severity: 'info',
      message: 'Serviços portáveis foram excluídos da base de comparação porque podem continuar existindo após a troca da internet.',
    });
  }

  if (financialChargesTotal > 0) {
    issues.push({
      code: 'FINANCIAL_CHARGES_EXCLUDED',
      severity: 'info',
      message: 'Multa, juros ou débitos anteriores foram excluídos do custo mensal recorrente usado na comparação.',
    });
  }

  if (unknownTotal > 0 && invoiceTotal != null && unknownTotal >= Math.max(10, invoiceTotal * 0.1)) {
    safeForComparison = false;
    baselineType = 'needs_component_confirmation';
    issues.push({
      code: 'UNKNOWN_RECURRING_COMPONENTS',
      severity: 'warning',
      message: 'Há componentes relevantes da fatura cuja relação com o serviço de internet não foi confirmada.',
    });
  }

  if (!(internetLinePrice > 0)) {
    safeForComparison = false;
    baselineMonthlyCost = null;
    baselineType = 'unresolved';
    issues.push({ code: 'INTERNET_LINE_PRICE_MISSING', severity: 'error', message: 'A linha de preço da internet não foi identificada.' });
  }

  if (
    rawInternetLinePrice > 0
    && invoiceTotal > 0
    && rawInternetLinePrice > invoiceTotal + promoTolerance
    && !discountedPlanDetected
  ) {
    safeForComparison = false;
    baselineType = 'needs_discount_confirmation';
    issues.push({
      code: 'INVOICE_BELOW_PLAN_PRICE_UNEXPLAINED',
      severity: 'warning',
      message: 'O total da fatura está abaixo do preço do plano identificado e nenhum desconto suficiente foi confirmado.',
    });
  }

  if (
    internetLinePrice > 0
    && invoiceTotal > 0
    && ratio >= 1.35
    && !accountingSplitDetected
    && providerTiedTotal === 0
    && bundleServicesTotal === 0
    && portableTotal === 0
  ) {
    issues.push({
      code: 'LARGE_GAP_WITHOUT_CLASSIFICATION',
      severity: 'warning',
      message: 'O total da fatura é muito maior que a linha de internet e a composição não foi classificada com segurança.',
    });
    safeForComparison = false;
    baselineType = 'needs_component_confirmation';
  }

  return {
    version: POUPAI_BILLING_BASELINE_VERSION,
    rawInternetLinePrice,
    internetLinePrice,
    invoiceTotal,
    baselineMonthlyCost,
    baselineType,
    safeForComparison,
    confidence,
    discountedPlanDetected,
    discountEvidence,
    accountingSplitDetected,
    componentsMatchInvoice,
    componentsTotal,
    providerTiedTotal,
    portableTotal,
    bundleServicesTotal,
    financialChargesTotal,
    unknownTotal,
    extras,
    issues,
  };
}

export function applyComparisonBaseline(extraction = {}, options = {}) {
  const billingBaseline = resolveComparisonBaseline(extraction, options);
  return {
    ...extraction,
    comparisonMonthlyCost: billingBaseline.safeForComparison ? billingBaseline.baselineMonthlyCost : null,
    billingBaseline,
  };
}
