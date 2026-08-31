import { validateReaderExtraction } from './reader-v2.js';
import { marketDecisionGate, marketOffersForEngine } from './market-v2.js';
import { applyAvailabilityChecksToMarket } from './provider-checkers-v21.js';
import { analyzeStructuredInternetBill } from './structured-engine-v23.js';
import { auditBillFreshness, POUPAI_REAL_BILL_VERSION } from './real-bill-v23.js';
import {
  POUPAI_HARDENING_VERSION,
  buildAuditTrace,
  deterministicReaderAudit,
  hardenMarketResult,
  resolveSafeDecision,
  scorePipelineHealth,
} from './hardening-v22.js';

export const POUPAI_PIPELINE_VERSION = '2.3.0';

export function runPoupaiV23({ extraction, marketResult, availabilityChecks = [], engineConfig = {}, metrics = {} } = {}) {
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

  if (!readerValidation.validForDiagnosis || !readerAudit.safeToUse) {
    const finalDecision = 'ANALISE_INCONCLUSIVA';
    const auditTrace = buildAuditTrace({ extraction, readerAudit, marketResult: null, engineAnalysis: null, finalDecision });
    auditTrace.splice(1, 0, { stage: 'bill', action: 'freshness', details: billFreshness });
    return {
      pipeline: `Poupai Pipeline V${POUPAI_PIPELINE_VERSION}`,
      hardening: `Poupai Hardening V${POUPAI_HARDENING_VERSION}`,
      realBillGuard: `Poupai Real Bill V${POUPAI_REAL_BILL_VERSION}`,
      status: readerAudit.needsConfirmation ? 'REVIEW_BILL' : 'ANALYSIS_INCONCLUSIVE',
      readerValidation,
      readerAudit,
      billFreshness,
      marketGate: null,
      marketResult: null,
      analysis: null,
      finalDecision,
      decisionReason: readerAudit.needsConfirmation ? 'READER_CONFIRMATION_REQUIRED' : 'READER_NOT_TRUSTED',
      auditTrace,
      pipelineHealthScore: scorePipelineHealth({ readerAudit, marketResult: null, metrics }),
      metrics,
      message: 'A leitura da fatura não atingiu o nível de confiança necessário para uma decisão financeira segura.',
    };
  }

  if (!billFreshness.safeForCurrentComparison) {
    const finalDecision = 'ANALISE_INCONCLUSIVA';
    const auditTrace = buildAuditTrace({ extraction, readerAudit, marketResult: null, engineAnalysis: null, finalDecision });
    auditTrace.splice(1, 0, { stage: 'bill', action: 'freshness', details: billFreshness });
    return {
      pipeline: `Poupai Pipeline V${POUPAI_PIPELINE_VERSION}`,
      hardening: `Poupai Hardening V${POUPAI_HARDENING_VERSION}`,
      realBillGuard: `Poupai Real Bill V${POUPAI_REAL_BILL_VERSION}`,
      status: 'ANALYSIS_INCONCLUSIVE',
      readerValidation,
      readerAudit,
      billFreshness,
      marketGate: null,
      marketResult: null,
      analysis: null,
      finalDecision,
      decisionReason: billFreshness.code,
      auditTrace,
      pipelineHealthScore: Math.min(55, scorePipelineHealth({ readerAudit, marketResult: null, metrics })),
      metrics,
      message: billFreshness.message,
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
    const auditTrace = buildAuditTrace({ extraction, readerAudit, marketResult: hardenedMarket, engineAnalysis: null, finalDecision });
    auditTrace.splice(1, 0, { stage: 'bill', action: 'freshness', details: billFreshness });
    return {
      pipeline: `Poupai Pipeline V${POUPAI_PIPELINE_VERSION}`,
      hardening: `Poupai Hardening V${POUPAI_HARDENING_VERSION}`,
      realBillGuard: `Poupai Real Bill V${POUPAI_REAL_BILL_VERSION}`,
      status: 'ANALYSIS_INCONCLUSIVE',
      readerValidation,
      readerAudit,
      billFreshness,
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
    extraction,
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
  const auditTrace = buildAuditTrace({ extraction, readerAudit, marketResult: hardenedMarket, engineAnalysis: analysis, finalDecision });
  auditTrace.splice(1, 0, { stage: 'bill', action: 'freshness', details: billFreshness });

  return {
    pipeline: `Poupai Pipeline V${POUPAI_PIPELINE_VERSION}`,
    hardening: `Poupai Hardening V${POUPAI_HARDENING_VERSION}`,
    realBillGuard: `Poupai Real Bill V${POUPAI_REAL_BILL_VERSION}`,
    status,
    readerValidation,
    readerAudit,
    billFreshness,
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
      : 'A recomendação final usa leitura validada, fatura recente, ofertas filtradas e disponibilidade confirmada.',
  };
}

export const runPoupaiV22 = runPoupaiV23;
export const runPoupaiV21 = runPoupaiV23;
export const runPoupaiV2 = runPoupaiV23;
