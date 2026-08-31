import { analyzeInternetBillV11 } from './v11.js';
import { buildEngineText, validateReaderExtraction } from './reader-v2.js';
import { marketDecisionGate, marketOffersForEngine } from './market-v2.js';

export const POUPAI_PIPELINE_VERSION = '2.0.0';

export function runPoupaiV2({ extraction, marketResult, engineConfig = {} } = {}) {
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

  const gate = marketDecisionGate(marketResult || {});
  if (!gate.canRunPreliminaryEngine) {
    return {
      pipeline: `Poupai Pipeline V${POUPAI_PIPELINE_VERSION}`,
      status: 'NO_MARKET_COMPARISON',
      readerValidation,
      marketGate: gate,
      analysis: null,
      finalDecision: 'MANTENHA',
      message: gate.message,
    };
  }

  const exactOffers = marketOffersForEngine(marketResult, { allowCandidates: false });
  const engineOffers = exactOffers.length
    ? exactOffers
    : marketOffersForEngine(marketResult, { allowCandidates: true });

  const engineText = buildEngineText(extraction);
  const analysis = analyzeInternetBillV11({
    billText: engineText,
    location: { cep: extraction?.cep || marketResult?.location?.cep || null },
    offers: engineOffers,
    config: {
      ...engineConfig,
      asOfDate: engineConfig.asOfDate || marketResult?.checkedAt || null,
    },
  });

  const isFinal = exactOffers.length > 0;
  const engineDecision = analysis?.freeDiagnosis?.decision || 'MANTENHA';

  return {
    pipeline: `Poupai Pipeline V${POUPAI_PIPELINE_VERSION}`,
    status: isFinal ? 'FINAL_ANALYSIS_READY' : 'PRELIMINARY_ANALYSIS_READY',
    readerValidation,
    marketGate: gate,
    analysis,
    finalDecision: isFinal ? engineDecision : 'CONFIRME_DISPONIBILIDADE',
    provisionalDecision: isFinal ? null : engineDecision,
    decisionConfidence: isFinal ? 'final' : 'preliminary',
    requiresAddressConfirmation: !isFinal,
    message: isFinal
      ? 'A análise usa ofertas com disponibilidade confirmada e pode emitir a decisão final.'
      : `A análise econômica encontrou candidatos (${engineDecision}), mas a disponibilidade no imóvel ainda precisa ser confirmada antes de recomendar troca.`,
  };
}
