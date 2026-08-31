# Poupai Engine V1.1

A V1.1 é a camada de decisão aprimorada do Poupai. Ela usa a V1 como base de leitura e adiciona regras de qualidade, custo efetivo, validade de oferta e decisão final.

## Principais melhorias

- Decisão final em três estados: `TROQUE`, `NEGOCIE` ou `MANTENHA`.
- Comparação de custo efetivo em 12 e 24 meses.
- Considera preço promocional e preço pós-promo.
- Considera instalação, ativação, equipamento e outras taxas de entrada.
- Normaliza velocidades como `500 Mega`, `500 Mbps`, `500M` e `0,5 Giga`.
- Detecta tecnologia de acesso: FTTH/fibra, HFC/cabo, rádio e DSL/cobre.
- Compara qualidade, e não apenas preço.
- Penaliza queda relevante de velocidade.
- Dá preferência a alternativas que preservam ou melhoram qualidade.
- Identifica oportunidade dentro da própria operadora para sugerir negociação.
- Mantém confiança por campo crítico da fatura.
- Detecta combos e bloqueia comparação quando o preço isolado da internet não é confiável.
- Verifica data da fonte da oferta e exclui ofertas antigas por padrão.
- Exige fonte e data de verificação para tratar uma alternativa como verificável.
- Calcula preço por Mbps e Poupai Score aprimorado.
- Expõe ressalvas, fidelidade e necessidade de confirmar disponibilidade no endereço.

## Uso

```js
import { analyzeInternetBillV11 } from './engine/v11.js';

const result = analyzeInternetBillV11({
  billText: 'texto extraído da fatura...',
  location: { cep: '05001-000' },
  offers: [],
  config: {
    asOfDate: '2026-08-31'
  }
});
```

## Saída de decisão

### TROQUE
Existe alternativa externa verificável, com economia mínima relevante e sem perda excessiva de qualidade.

### NEGOCIE
A própria operadora possui condição melhor, ou o plano atual parece caro frente ao mercado mas a troca ainda não é claramente superior.

### MANTENHA
Não há alternativa verificável que ultrapasse os critérios mínimos do motor.

## Critérios padrão

- economia média mínima: R$ 15/mês;
- economia mínima: 8% no horizonte de 12 meses;
- velocidade mínima da alternativa: 80% da velocidade atual;
- preferência por alternativas com pelo menos 95% da velocidade atual ou tecnologia claramente superior;
- oferta começa a envelhecer após 21 dias;
- oferta com mais de 60 dias é excluída por padrão.

Todos os limites são configuráveis.

## Testes

```bash
node engine/test/run-v11.mjs
```

A suíte cobre leitura, normalização de velocidade, custo de 12/24 meses, combo, falta de CEP, oferta vencida, negociação com a própria operadora e cenário em que o plano atual deve ser mantido.

## Limites que continuam fora desta etapa

A V1.1 ainda não busca ofertas reais sozinha e ainda não lê PDF/imagem diretamente. Essas duas camadas devem ser conectadas depois:

1. `PDF/foto -> extração estruturada da fatura`;
2. `CEP/endereço -> ofertas atuais e verificadas`;
3. `Poupai Engine V1.1 -> decisão e relatório`.

Histórico, Poupai Monitor e conta de usuário continuam fora do escopo atual.
