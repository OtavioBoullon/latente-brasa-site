export const POUPAI_BILLING_BASELINE_VERSION = '2.4.0';

const money = (value) => Number.isFinite(Number(value)) ? Math.round(Number(value) * 100) / 100 : null;
const sum = (values) => money(values.reduce((a, b) => a + b, 0)) ?? 0;

const PORTABLE_PATTERNS = /netflix|disney|globoplay|prime video|amazon prime|paramount|hbo|max\b|deezer|spotify|apple tv|youtube premium/i;
const PROVIDER_TIED_PATTERNS = /\bsva\b|loca[cç][aã]o|aluguel|equipamento|modem|roteador|servi[cç]o digital|outros servi[cç]os|taxa de infraestrutura|comodato/i;

function classifyExtra(extra = {}) {
  const name = String(extra.name || '').trim();
  const category = String(extra.category || 'other');
  const price = money(extra.price);
  if (!(price >= 0)) return { ...extra, price: null, relationship: 'unknown' };

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

export function resolveComparisonBaseline(extraction = {}, options = {}) {
  const internetLinePrice = money(extraction.internetMonthlyPrice);
  const invoiceTotal = money(extraction.invoiceTotal);
  const extras = Array.isArray(extraction.extras) ? extraction.extras.map(classifyExtra) : [];
  const pricedExtras = extras.filter((x) => x.price != null);
  const providerTied = pricedExtras.filter((x) => x.relationship === 'provider_tied');
  const portable = pricedExtras.filter((x) => x.relationship === 'portable');
  const bundleServices = pricedExtras.filter((x) => x.relationship === 'bundle_service');
  const unknown = pricedExtras.filter((x) => x.relationship === 'unknown');

  const providerTiedTotal = sum(providerTied.map((x) => x.price));
  const portableTotal = sum(portable.map((x) => x.price));
  const bundleServicesTotal = sum(bundleServices.map((x) => x.price));
  const unknownTotal = sum(unknown.map((x) => x.price));
  const componentsTotal = internetLinePrice != null
    ? money(internetLinePrice + sum(pricedExtras.map((x) => x.price)))
    : null;
  const tolerance = Math.max(Number(options.componentToleranceReais ?? 2), (invoiceTotal || 0) * Number(options.componentToleranceRate ?? 0.03));
  const componentsMatchInvoice = invoiceTotal != null && componentsTotal != null
    ? Math.abs(invoiceTotal - componentsTotal) <= tolerance
    : false;

  const ratio = internetLinePrice && invoiceTotal ? invoiceTotal / internetLinePrice : null;
  const accountingSplitDetected = Boolean(
    internetLinePrice > 0
    && invoiceTotal > 0
    && providerTiedTotal > 0
    && componentsMatchInvoice
    && ratio >= Number(options.minAccountingSplitRatio ?? 1.2)
  );

  const issues = [];
  let baselineMonthlyCost = internetLinePrice;
  let baselineType = 'internet_line_only';
  let safeForComparison = Boolean(internetLinePrice > 0);
  let confidence = internetLinePrice > 0 ? 0.9 : 0;

  if (accountingSplitDetected) {
    baselineMonthlyCost = money(invoiceTotal - portableTotal);
    baselineType = 'provider_package_effective';
    confidence = unknownTotal > 0 || bundleServicesTotal > 0 ? 0.72 : 0.94;
    safeForComparison = unknownTotal === 0 && bundleServicesTotal === 0 && baselineMonthlyCost > 0;
    issues.push({
      code: 'ACCOUNTING_SPLIT_DETECTED',
      severity: 'info',
      message: 'A fatura parece dividir o pacote recorrente entre SCM e componentes SVA/locação; a comparação deve usar o custo efetivo do pacote, não apenas a linha SCM.',
    });
  }

  if (bundleServicesTotal > 0) {
    safeForComparison = false;
    baselineType = 'needs_bundle_confirmation';
    issues.push({
      code: 'BUNDLE_SERVICE_CONFIRMATION_REQUIRED',
      severity: 'warning',
      message: 'Há TV/telefone no pacote e não é seguro assumir que esses valores desaparecem ao trocar apenas a internet.',
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

  if (internetLinePrice > 0 && invoiceTotal > 0 && ratio >= 1.35 && !accountingSplitDetected && providerTiedTotal === 0) {
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
    internetLinePrice,
    invoiceTotal,
    baselineMonthlyCost,
    baselineType,
    safeForComparison,
    confidence,
    accountingSplitDetected,
    componentsMatchInvoice,
    componentsTotal,
    providerTiedTotal,
    portableTotal,
    bundleServicesTotal,
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
