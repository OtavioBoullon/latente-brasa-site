import { validateReaderExtraction } from './reader-v2.js';
import { marketDecisionGate, marketOffersForEngine } from './market-v2.js';
import { applyAvailabilityChecksToMarket } from './provider-checkers-v21.js';
import { analyzeStructuredInternetBill } from './structured-engine-v23.js';
import { auditBillFreshness, POUPAI_REAL_BILL_VERSION } from './real-bill-v23.js';
import { POUPAI_BILLING_BASELINE_VERSION, applyComparisonBaseline } from './billing-baseline-v25.js';
import {
  POUPAI_HARDENING_VERSION,
  buildAuditTrace,
  deterministicReaderAudit,
  hardenMarketResult,
  resolveSafeDecision,
  scorePipelineHealth,
} from './hardening-v22.js';

export const POUPAI_PIPELINE_V25_VERSION = '2.5.0';
const blocker = (code, message, stage) => ({ code, message, stage });

function reconcileReaderAuditWithBaseline(audit, baseline) {
  if (!baseline?.discountedPlanDetected) return audit;
  const explainedByDiscount = new Set(['INTERNET_PRICE_ABOVE_INVOICE', 'COMPONENTS_EXCEED_INVOICE']);
  const issues = (audit?.issues || []).filter((x) => !explainedByDiscount.has(x.code));
  const blocking = issues.some((x) => x.severity === 'error');
  const needsConfirmation = issues.some((x) => x.severity === 'warning' && ['CRITICAL_FIELD_LOW_CONFIDENCE', 'OVERALL_LOW_CONFIDENCE', 'CEP_EVIDENCE_MISMATCH', 'DOCUMENT_INSTRUCTION_DETECTED'].includes(x.code));
  return { ...audit, issues, blocking, needsConfirmation, safeToUse: !blocking && !needsConfirmation, reconciledWithBillingBaseline: true };
}

function billAudit(auditTrace, freshness, baseline) {
  auditTrace.splice(1, 0,
    { stage: 'bill', action: 'freshness', details: freshness },
    { stage: 'bill', action: 'comparison_baseline', details: {
      version: baseline.version,
      baselineType: baseline.baselineType,
      baselineMonthlyCost: baseline.baselineMonthlyCost,
      rawInternetLinePrice: baseline.rawInternetLinePrice,
      internetLinePrice: baseline.internetLinePrice,
      invoiceTotal: baseline.invoiceTotal,
      discountedPlanDetected: baseline.discountedPlanDetected,
      accountingSplitDetected: baseline.accountingSplitDetected,
      financialChargesTotal: baseline.financialChargesTotal,
      safeForComparison: baseline.safeForComparison,
      issueCodes: baseline.issues.map((x) => x.code),
    } },
  );
  return auditTrace;
}

function baseMeta() {
  return {
    pipeline: `Poupai Pipeline V${POUPAI_PIPELINE_V25_VERSION}`,
    hardening: `Poupai Hardening V${POUPAI_HARDENING_VERSION}`,
    realBillGuard: `Poupai Real Bill V${POUPAI_REAL_BILL_VERSION}`,
    billingBaselineGuard: `Poupai Billing Baseline V${POUPAI_BILLING_BASELINE_VERSION}`,
  };
}

export function runPoupaiV25({ extraction, marketResult, availabilityChecks = [], engineConfig = {}, metrics = {} } = {}) {
  const preparedExtraction = applyComparisonBaseline(extraction || {}, engineConfig.billingBaseline || {});
  const billingBaseline = preparedExtraction.billingBaseline;
  const readerValidation = validateReaderExtraction(extraction || {}, {
    minFieldConfidence: engineConfig.minReaderFieldConfidence ?? 0.78,
    minOverallConfidence: engineConfig.minReaderOverallConfidence ?? 0.78,
  });
  const rawReaderAudit = deterministicReaderAudit(extraction || {}, {
    minCriticalConfidence: engineConfig.minReaderFieldConfidence ?? 0.78,
    minOverallConfidence: engineConfig.minReaderOverallConfidence ?? 0.78,
  });
  const readerAudit = reconcileReaderAuditWithBaseline(rawReaderAudit, billingBaseline);
  const billFreshness = auditBillFreshness(extraction || {}, {
    asOfDate: engineConfig.asOfDate || new Date().toISOString().slice(0, 10),
    maxBillAgeDays: engineConfig.maxBillAgeDays ?? 120,
    warningAfterDays: engineConfig.billWarningAfterDays ?? 60,
  });

  const blockingReasons = [];
  const validationErrors = readerValidation.issues.filter((x) => x.severity === 'error');
  for (const issue of validationErrors) blockingReasons.push(blocker(issue.code || 'READER_VALIDATION_ERROR', issue.message, 'reader'));
  if (!readerAudit.safeToUse && !validationErrors.length) {
    blockingReasons.push(blocker(readerAudit.needsConfirmation ? 'READER_CONFIRMATION_REQUIRED' : 'READER_NOT_TRUSTED', 'A leitura da fatura não atingiu a confiança mínima para uma decisão segura.', 'reader'));
  }
  if (!billFreshness.safeForCurrentComparison) blockingReasons.push(blocker(billFreshness.code, billFreshness.message, 'bill_freshness'));
  if (!billingBaseline.safeForComparison) {
    const issue = billingBaseline.issues.find((x) => x.severity !== 'info');
    blockingReasons.push(blocker(issue?.code || 'BILLING_BASELINE_UNRESOLVED', issue?.message || 'Não foi possível determinar o custo mensal correto para comparação.', 'billing_baseline'));
  }

  if (blockingReasons.length) {
    const finalDecision = 'ANALISE_INCONCLUSIVA';
    const auditTrace = billAudit(buildAuditTrace({ extraction: preparedExtraction, readerAudit, marketResult: null, engineAnalysis: null, finalDecision }), billFreshness, billingBaseline);
    return {
      ...baseMeta(), status: blockingReasons.some((x) => ['reader', 'billing_baseline'].includes(x.stage)) ? 'REVIEW_BILL' : 'ANALYSIS_INCONCLUSIVE',
      readerValidation, readerAudit, billFreshness, billingBaseline, blockingReasons, marketGate: null, marketResult: null, analysis: null,
      finalDecision, decisionReason: blockingReasons.length > 1 ? 'MULTIPLE_BLOCKERS' : blockingReasons[0].code, decisionConfidence: 'insufficient', requiresAddressConfirmation: false,
      auditTrace, pipelineHealthScore: Math.min(55, scorePipelineHealth({ readerAudit, marketResult: null, metrics })), metrics,
      message: blockingReasons.map((x) => x.message).filter(Boolean).join(' '),
    };
  }

  const enrichedMarket = availabilityChecks.length ? applyAvailabilityChecksToMarket(marketResult || {}, availabilityChecks) : (marketResult || {});
  const hardenedMarket = hardenMarketResult(enrichedMarket, {
    asOfDate: engineConfig.asOfDate || enrichedMarket?.checkedAt || null,
    minOfferConfidence: engineConfig.minOfferConfidence ?? 0.75,
    staleAfterDays: engineConfig.staleAfterDays ?? 21,
    maxOfferAgeDays: engineConfig.maxOfferAgeDays ?? 60,
  });
  const marketGate = marketDecisionGate(hardenedMarket);

  if (!marketGate.canRunPreliminaryEngine) {
    const finalDecision = 'ANALISE_INCONCLUSIVA';
    const auditTrace = billAudit(buildAuditTrace({ extraction: preparedExtraction, readerAudit, marketResult: hardenedMarket, engineAnalysis: null, finalDecision }), billFreshness, billingBaseline);
    return {
      ...baseMeta(), status: 'ANALYSIS_INCONCLUSIVE', readerValidation, readerAudit, billFreshness, billingBaseline,
      blockingReasons: [blocker('INSUFFICIENT_MARKET_DATA', marketGate.message, 'market')], marketGate, marketResult: hardenedMarket, analysis: null,
      finalDecision, decisionReason: 'INSUFFICIENT_MARKET_DATA', decisionConfidence: 'insufficient', requiresAddressConfirmation: false,
      auditTrace, pipelineHealthScore: scorePipelineHealth({ readerAudit, marketResult: hardenedMarket, metrics }), metrics,
      message: `${marketGate.message} A ausência de ofertas verificadas não significa que o plano atual seja competitivo.`,
    };
  }

  const exactOffers = marketOffersForEngine(hardenedMarket, { allowCandidates: false });
  const engineOffers = exactOffers.length ? exactOffers : marketOffersForEngine(hardenedMarket, { allowCandidates: true });
  const analysis = analyzeStructuredInternetBill({ extraction: preparedExtraction, offers: engineOffers, config: { ...engineConfig, asOfDate: engineConfig.asOfDate || hardenedMarket?.checkedAt || null } });
  const engineDecision = analysis?.freeDiagnosis?.decision || null;
  const safe = resolveSafeDecision({ requestedDecision: engineDecision, marketResult: hardenedMarket, readerAudit, engineAnalysis: analysis });
  const isExact = exactOffers.length > 0 && marketGate.canRunFinalEngine;
  const finalDecision = isExact ? safe.decision : 'ANALISE_INCONCLUSIVA';
  const status = finalDecision === 'ANALISE_INCONCLUSIVA' ? (isExact ? 'ANALYSIS_INCONCLUSIVE' : 'PRELIMINARY_ANALYSIS_READY') : 'FINAL_ANALYSIS_READY';
  const auditTrace = billAudit(buildAuditTrace({ extraction: preparedExtraction, readerAudit, marketResult: hardenedMarket, engineAnalysis: analysis, finalDecision }), billFreshness, billingBaseline);

  return {
    ...baseMeta(), status, readerValidation, readerAudit, billFreshness, billingBaseline, blockingReasons: [], marketGate, marketResult: hardenedMarket, analysis,
    finalDecision, provisionalDecision: isExact ? null : engineDecision, decisionReason: isExact ? safe.reason : 'ADDRESS_AVAILABILITY_NOT_CONFIRMED',
    decisionConfidence: finalDecision === 'ANALISE_INCONCLUSIVA' ? 'preliminary' : 'final', requiresAddressConfirmation: !isExact,
    auditTrace, pipelineHealthScore: scorePipelineHealth({ readerAudit, marketResult: hardenedMarket, metrics }), metrics,
    message: finalDecision === 'ANALISE_INCONCLUSIVA'
      ? `Análise econômica preliminar${engineDecision ? `: ${engineDecision}` : ''}. Confirme a disponibilidade no endereço para uma recomendação final.`
      : 'Recomendação final baseada em fatura validada, custo efetivo, ofertas filtradas e disponibilidade confirmada.',
  };
}
