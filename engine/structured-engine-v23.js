import { compareOffersV11, validateBillV11 } from './v11.js';
import { structuredBillFromReader } from './real-bill-v23.js';

const clamp = (n, min, max) => Math.min(max, Math.max(min, n));
const money = (n) => Math.round(Number(n || 0) * 100) / 100;

function decide(comparisons) {
  if (!comparisons.length) {
    return {
      code: 'MANTENHA',
      confidence: 0.65,
      message: 'Nenhuma alternativa verificável claramente melhor foi encontrada.',
      action: 'Não altere o plano apenas com base nesta busca; confirme se o mercado foi pesquisado de forma suficiente.',
    };
  }
  const best = comparisons[0];
  const own = comparisons.find((x) => x.sameProvider && x.worthIt);
  if (best.worthIt && !best.sameProvider && best.recommendationScore >= 60) {
    return {
      code: 'TROQUE',
      confidence: money(clamp(0.65 + best.recommendationScore / 300, 0.65, 0.95)),
      message: 'Existe alternativa com economia relevante sem perda excessiva de qualidade.',
      action: own
        ? 'Tente negociar com sua operadora usando uma oferta melhor; se não igualarem, considere a melhor alternativa externa.'
        : 'Confirme disponibilidade e condições finais antes da troca.',
    };
  }
  if (best.worthIt && best.sameProvider) {
    return {
      code: 'NEGOCIE',
      confidence: 0.88,
      message: 'A própria operadora parece ter condição melhor que a atual.',
      action: 'Peça migração ou retenção para a oferta atual.',
    };
  }
  const modest = comparisons.find((x) => x.sourceVerified && x.monthlyEquivalentSavings > 0);
  if (modest) {
    return {
      code: 'NEGOCIE',
      confidence: 0.76,
      message: 'Há sinal de preço melhor no mercado, mas a vantagem ainda não atingiu o limite para recomendar troca.',
      action: 'Use as ofertas encontradas para negociar antes de trocar.',
    };
  }
  return {
    code: 'MANTENHA',
    confidence: 0.74,
    message: 'As alternativas verificadas não trouxeram economia suficiente para justificar a troca.',
    action: 'Mantenha o plano por enquanto, desde que a cobertura de mercado tenha sido suficiente.',
  };
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

export function analyzeStructuredInternetBill({ extraction = {}, offers = [], config = {} } = {}) {
  const bill = structuredBillFromReader(extraction);
  const validation = validateBillV11(bill);
  const comparisons = validation.validForComparison ? compareOffersV11(bill, offers, config) : [];

  if (!validation.validForDiagnosis) {
    return {
      engine: 'Poupai Structured Engine V2.3',
      version: '2.3.0',
      bill,
      validation,
      comparisons: [],
      freeDiagnosis: {
        status: 'needs_review',
        decision: null,
        opportunityFound: false,
        poupaiScore: null,
        message: 'Não foi possível entender a fatura com segurança.',
      },
      fullReport: null,
    };
  }
  if (!validation.validForComparison) {
    return {
      engine: 'Poupai Structured Engine V2.3',
      version: '2.3.0',
      bill,
      validation,
      comparisons: [],
      freeDiagnosis: {
        status: bill.cep ? 'needs_review' : 'needs_location',
        decision: null,
        opportunityFound: false,
        poupaiScore: null,
        message: bill.cep ? 'Um dado crítico precisa ser confirmado antes da comparação.' : 'Precisamos do CEP para comparar ofertas da região.',
      },
      fullReport: null,
    };
  }

  const decision = decide(comparisons);
  const ownProvider = comparisons.filter((x) => x.sameProvider && x.monthlyEquivalentSavings > 0);
  const positive = comparisons.filter((x) => x.worthIt && x.estimatedSavings12Months > 0)
    .map((x) => x.estimatedSavings12Months).sort((a, b) => a - b);
  const savingsPotential12Months = positive.length
    ? { min: positive[0], max: positive.at(-1), periodMonths: 12 }
    : null;

  return {
    engine: 'Poupai Structured Engine V2.3',
    version: '2.3.0',
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
      currentPlan: {
        provider: bill.provider?.name,
        planName: bill.planName,
        monthlyCost: bill.currentMonthlyCost,
        speedMbps: bill.speedMbps,
        technology: bill.technology,
        pricePerMbps: bill.pricePerMbps,
      },
      bestAlternative: comparisons[0] || null,
      alternatives: comparisons,
      negotiationOptions: ownProvider,
      methodology: {
        inputMode: 'structured_reader_json',
        horizons: [12, 24],
        currentPlanBaseline: 'Preço mensal atual extraído da fatura, sem assumir reajustes futuros.',
        requiresAddressConfirmation: comparisons.some((x) => x.availability !== 'confirmed'),
      },
    },
  };
}
