import { analyzeInternetBillV11 } from './v11.js';
import { buildEngineText, validateReaderExtraction } from './reader-v2.js';
import { marketDecisionGate, marketOffersForEngine } from './market-v2.js';
import { applyAvailabilityChecksToMarket } from './provider-checkers-v21.js';

export const POUPAI_PIPELINE_VERSION = '2.1.0';

export function runPoupaiV21({ extraction, marketResult, availabilityChecks = [], engineConfig = {} } = {}) {
  const readerValidation = validateReaderExtraction(extraction || {});
  if (!readerValidation.validForDiagnosis) {
    return {
      pipeline: `Poupai Pipeline V${POUPAI_PIPELINE_VERSION}`,
      status: 'REVIEW_BILL',
      readerValidation,
      marketGate: null,
      analysis: null,
      finalDecision: null,
      message: 'A fatura precisa ser revisada antes da comparação de mercado.',
    };
  }

  const enrichedMarket = availabilityChecks.length
    ? applyAvailabilityChecksToMarket(marketResult || {}, availabilityChecks)
    : (marketResult || {});

  const gate = marketDecisionGate(enrichedMarket);
  if (!gate.canRunPreliminaryEngine) {
    return {
      pipeline: `Poupai Pipeline V${POUPAI_PIPELINE_VERSION}`,
      status: 'NO_MARKET_COMPARISON',
      readerValidation,
      marketGate: gate,
      marketResult: enrichedMarket,
      analysis: null,
      finalDecision: null,
      message: `${gate.message} Não há base suficiente para recomendar manter, trocar ou negociar.`,
    };
  }

  const exactOffers = marketOffersForEngine(enrichedMarket, { allowCandidates: false });
  const engineOffers = exactOffers.length
    ? exactOffers
    : marketOffersForEngine(enrichedMarket, { allowCandidates: true });

  const engineText = buildEngineText(extraction);
  const analysis = analyzeInternetBillV11({
    billText: engineText,
    location: { cep: extraction?.cep || enrichedMarket?.location?.cep || null },
    offers: engineOffers,
    config: {
      ...engineConfig,
      asOfDate: engineConfig.asOfDate || enrichedMarket?.checkedAt || null,
    },
  });

  const isFinal = exactOffers.length > 0 && gate.canRunFinalEngine;
  const engineDecision = analysis?.freeDiagnosis?.decision || 'MANTENHA';

  return {
    pipeline: `Poupai Pipeline V${POUPAI_PIPELINE_VERSION}`,
    status: isFinal ? 'FINAL_ANALYSIS_READY' : 'PRELIMINARY_ANALYSIS_READY',
    readerValidation,
    marketGate: gate,
    marketResult: enrichedMarket,
    analysis,
    finalDecision: isFinal ? engineDecision : 'CONFIRME_DISPONIBILIDADE',
    provisionalDecision: isFinal ? null : engineDecision,
    decisionConfidence: isFinal ? 'final' : 'preliminary',
    requiresAddressConfirmation: !isFinal,
    message: isFinal
      ? 'A análise usa ofertas confirmadas no endereço por uma fonte oficial e pode emitir a decisão final.'
      : `A análise econômica encontrou candidatos (${engineDecision}), mas a disponibilidade no imóvel ainda precisa ser confirmada antes de recomendar troca.`,
  };
}

// Compatibilidade com integrações que ainda importam runPoupaiV2.
export const runPoupaiV2 = runPoupaiV21;
