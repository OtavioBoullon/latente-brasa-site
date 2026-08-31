import { validateReaderExtraction } from './reader-v2.js';
import { marketDecisionGate, marketOffersForEngine } from './market-v2.js';
import { applyAvailabilityChecksToMarket } from './provider-checkers-v21.js';
import { analyzeStructuredInternetBill } from './structured-engine-v23.js';
import { auditBillFreshness, POUPAI_REAL_BILL_VERSION } from './real-bill-v23.js';
import {
  POUPAI_BILLING_BASELINE_VERSION,
  applyComparisonBaseline,
} from './billing-baseline-v24.js';
import {
  POUPAI_HARDENING_VERSION,
  buildAuditTrace,
  deterministicReaderAudit,
  hardenMarketResult,
  resolveSafeDecision,
  scorePipelineHealth,
} from './hardening-v22.js';

export const POUPAI_PIPELINE_VERSION = '2.4.0';

function blocker(code, message, stage) {
  return { code, message, stage };
}

function addBillAuditEntries(auditTrace, billFreshness, billingBaseline) {
  auditTrace.splice(1, 0,
    { stage: 'bill', action: 'freshness', details: billFreshness },
    { stage: 'bill', action: 'comparison_baseline', details: {
      version: billingBaseline.version,
      baselineType: billingBaseline.baselineType,
      baselineMonthlyCost: billingBaseline.baselineMonthlyCost,
      internetLinePrice: billingBaseline.internetLinePrice,
      invoiceTotal: billingBaseline.invoiceTotal,
      accountingSplitDetected: billingBaseline.accountingSplitDetected,
      safeForComparison: billingBaseline.safeForComparison,
      issueCodes: billingBaseline.issues.map((x) => x.code),
    } },
  );
  return auditTrace;
}

export function runPoupaiV24({ extraction, marketResult, availabilityChecks = [], engineConfig = {}, metrics = {} } = {}) {
  const preparedExtraction = applyComparisonBaseline(extraction || {}, engineConfig.billingBaseline || {});
  const billingBaseline = preparedExtraction.billingBaseline;
  const readerValidation = validateReaderExtraction(extraction || {}, {
    minFieldConfidence: engineConfig.minReaderFieldConfidence ?? 0.78,
    minOverallConfidence: engineConfig.minReaderOverallConfidence ?? 0.78,
  });
  const readerAudit = deterministicReaderAudit(extraction || {}, {
    minCriticalConfidence: engineConfig.minReaderFieldConfidence ?? 0.78,
    minOverallConfidence: engineConfig.minReaderOverallConfidence ?? 0.78,
  });
  const billFreshness = auditBillFreshness(extraction || {}, {
    asOfDate: engineConfig.asOfDate || new Date().toISOString().slice(0, 10),
    maxBillAgeDays: engineConfig.maxBillAgeDays ?? 120,
    warningAfterDays: engineConfig.billWarningAfterDays ?? 60,
  });

  const blockingReasons = [];
  const validationErrors = readerValidation.issues.filter((x) => x.severity === 'error');
  for (const issue of validationErrors) {
    blockingReasons.push(blocker(issue.code || 'READER_VALIDATION_ERROR', issue.message, 'reader'));
  }
  if (!readerAudit.safeToUse && !validationErrors.length) {
    blockingReasons.push(blocker(
      readerAudit.needsConfirmation ? 'READER_CONFIRMATION_REQUIRED' : 'READER_NOT_TRUSTED',
      'A leitura da fatura não atingiu o nível de confiança necessário para uma decisão financeira segura.',
      'reader',
    ));
  }
  if (!billFreshness.safeForCurrentComparison) {
    blockingReasons.push(blocker(billFreshness.code, billFreshness.message, 'bill_freshness'));
  }
  if (!billingBaseline.safeForComparison) {
    const baselineIssue = billingBaseline.issues.find((x) => x.severity !== 'info');
    blockingReasons.push(blocker(
      baselineIssue?.code || 'BILLING_BASELINE_UNRESOLVED',
      baselineIssue?.message || 'Não foi possível determinar com segurança o custo mensal que deve ser usado na comparação.',
      'billing_baseline',
    ));
  }

  if (blockingReasons.length) {
    const finalDecision = 'ANALISE_INCONCLUSIVA';
    const auditTrace = addBillAuditEntries(
      buildAuditTrace({ extraction: preparedExtraction, readerAudit, marketResult: null, engineAnalysis: null, finalDecision }),
      billFreshness,
      billingBaseline,
    );
    const decisionReason = blockingReasons.length > 1 ? 'MULTIPLE_BLOCKERS' : blockingReasons[0].code;
    const needsReview = blockingReasons.some((x) => x.stage === 'reader' || x.stage === 'billing_baseline');
    return {
      pipeline: `Poupai Pipeline V${POUPAI_PIPELINE_VERSION}`,
      hardening: `Poupai Hardening V${POUPAI_HARDENING_VERSION}`,
      realBillGuard: `Poupai Real Bill V${POUPAI_REAL_BILL_VERSION}`,
      billingBaselineGuard: `Poupai Billing Baseline V${POUPAI_BILLING_BASELINE_VERSION}`,
      status: needsReview ? 'REVIEW_BILL' : 'ANALYSIS_INCONCLUSIVE',
      readerValidation,
      readerAudit,
      billFreshness,
      billingBaseline,
      blockingReasons,
      marketGate: null,
      marketResult: null,
      analysis: null,
      finalDecision,
      decisionReason,
      auditTrace,
      pipelineHealthScore: Math.min(55, scorePipelineHealth({ readerAudit, marketResult: null, metrics })),
      metrics,
      message: blockingReasons.map((x) => x.message).filter(Boolean).join(' '),
    };
  }

  const enrichedMarket = availabilityChecks.length
    ? applyAvailabilityChecksToMarket(marketResult || {}, availabilityChecks)
    : (marketResult || {});
  const hardenedMarket = hardenMarketResult(enrichedMarket, {
    asOfDate: engineConfig.asOfDate || enrichedMarket?.checkedAt || null,
    minOfferConfidence: engineConfig.minOfferConfidence ?? 0.75,
    staleAfterDays: engineConfig.staleAfterDays ?? 21,
    maxOfferAgeDays: engineConfig.maxOfferAgeDays ?? 60,
  });
  const gate = marketDecisionGate(hardenedMarket);

  if (!gate.canRunPreliminaryEngine) {
    const finalDecision = 'ANALISE_INCONCLUSIVA';
    const auditTrace = addBillAuditEntries(
      buildAuditTrace({ extraction: preparedExtraction, readerAudit, marketResult: hardenedMarket, engineAnalysis: null, finalDecision }),
      billFreshness,
      billingBaseline,
    );
    return {
      pipeline: `Poupai Pipeline V${POUPAI_PIPELINE_VERSION}`,
      hardening: `Poupai Hardening V${POUPAI_HARDENING_VERSION}`,
      realBillGuard: `Poupai Real Bill V${POUPAI_REAL_BILL_VERSION}`,
      billingBaselineGuard: `Poupai Billing Baseline V${POUPAI_BILLING_BASELINE_VERSION}`,
      status: 'ANALYSIS_INCONCLUSIVE',
      readerValidation,
      readerAudit,
      billFreshness,
      billingBaseline,
      blockingReasons: [blocker('INSUFFICIENT_MARKET_DATA', gate.message, 'market')],
      marketGate: gate,
      marketResult: hardenedMarket,
      analysis: null,
      finalDecision,
      decisionReason: 'INSUFFICIENT_MARKET_DATA',
      auditTrace,
      pipelineHealthScore: scorePipelineHealth({ readerAudit, marketResult: hardenedMarket, metrics }),
      metrics,
      message: `${gate.message} A ausência de ofertas verificadas não significa que o plano atual seja competitivo.`,
    };
  }

  const exactOffers = marketOffersForEngine(hardenedMarket, { allowCandidates: false });
  const engineOffers = exactOffers.length
    ? exactOffers
    : marketOffersForEngine(hardenedMarket, { allowCandidates: true });

  const analysis = analyzeStructuredInternetBill({
    extraction: preparedExtraction,
    offers: engineOffers,
    config: {
      ...engineConfig,
      asOfDate: engineConfig.asOfDate || hardenedMarket?.checkedAt || null,
    },
  });

  const engineDecision = analysis?.freeDiagnosis?.decision || null;
  const safe = resolveSafeDecision({
    requestedDecision: engineDecision,
    marketResult: hardenedMarket,
    readerAudit,
    engineAnalysis: analysis,
  });
  const isExact = exactOffers.length > 0 && gate.canRunFinalEngine;
  const finalDecision = isExact ? safe.decision : 'ANALISE_INCONCLUSIVA';
  const status = finalDecision === 'ANALISE_INCONCLUSIVA'
    ? (isExact ? 'ANALYSIS_INCONCLUSIVE' : 'PRELIMINARY_ANALYSIS_READY')
    : 'FINAL_ANALYSIS_READY';
  const auditTrace = addBillAuditEntries(
    buildAuditTrace({ extraction: preparedExtraction, readerAudit, marketResult: hardenedMarket, engineAnalysis: analysis, finalDecision }),
    billFreshness,
    billingBaseline,
  );

  return {
    pipeline: `Poupai Pipeline V${POUPAI_PIPELINE_VERSION}`,
    hardening: `Poupai Hardening V${POUPAI_HARDENING_VERSION}`,
    realBillGuard: `Poupai Real Bill V${POUPAI_REAL_BILL_VERSION}`,
    billingBaselineGuard: `Poupai Billing Baseline V${POUPAI_BILLING_BASELINE_VERSION}`,
    status,
    readerValidation,
    readerAudit,
    billFreshness,
    billingBaseline,
    blockingReasons: [],
    marketGate: gate,
    marketResult: hardenedMarket,
    analysis,
    finalDecision,
    provisionalDecision: isExact ? null : engineDecision,
    decisionReason: isExact ? safe.reason : 'ADDRESS_AVAILABILITY_NOT_CONFIRMED',
    decisionConfidence: finalDecision === 'ANALISE_INCONCLUSIVA' ? 'insufficient' : 'final',
    requiresAddressConfirmation: !isExact,
    auditTrace,
    pipelineHealthScore: scorePipelineHealth({ readerAudit, marketResult: hardenedMarket, metrics }),
    metrics,
    message: finalDecision === 'ANALISE_INCONCLUSIVA'
      ? (isExact
          ? 'Os dados disponíveis ainda não sustentam uma recomendação final segura.'
          : `Há uma análise econômica preliminar (${engineDecision || 'sem decisão'}), mas a disponibilidade precisa ser confirmada antes de qualquer recomendação.`)
      : 'A recomendação final usa leitura validada, fatura recente, custo efetivo da fatura, ofertas filtradas e disponibilidade confirmada.',
  };
}

export const runPoupaiV23 = runPoupaiV24;
export const runPoupaiV22 = runPoupaiV24;
export const runPoupaiV21 = runPoupaiV24;
export const runPoupaiV2 = runPoupaiV24;
