// Compatibilidade: o pipeline histórico importa este caminho.
// A implementação ativa foi promovida para V2.5 após testes com faturas públicas reais.
export {
  POUPAI_BILLING_BASELINE_VERSION,
  applyComparisonBaseline,
  resolveComparisonBaseline,
} from './billing-baseline-v25.js';
