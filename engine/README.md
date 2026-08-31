# Poupai Engine V1

Motor independente do HTML da Poupai V4. Esta V1 recebe o **texto extraído de uma fatura de internet** e um catálogo de ofertas já coletadas/verificadas, interpreta o plano atual, valida os dados, compara alternativas e gera dois níveis de saída: diagnóstico gratuito e relatório completo.

## O que já faz

- Identifica operadora (Claro, Vivo, TIM, Oi, Algar e Brisanet).
- Extrai valor total da fatura.
- Tenta isolar o valor mensal do plano de internet.
- Extrai velocidade contratada em Mega/Giga.
- Extrai CEP e vencimento.
- Detecta descontos/promos e serviços adicionais.
- Calcula confiança da leitura e impede comparação quando faltam dados críticos.
- Calcula custo efetivo de cada oferta em 12 meses, incluindo promoção, preço pós-promo, instalação e equipamento.
- Filtra disponibilidade por CEP quando o catálogo fornece prefixos ou confirmação explícita.
- Só chama algo de “oportunidade” quando há economia mínima e a velocidade não cai demais.
- Calcula o Poupai Score (quanto maior, mais competitivo parece o plano atual).
- Entrega `freeDiagnosis` e `fullReport` em JSON, prontos para integração futura com o site.

## O que deliberadamente NÃO está nesta V1

- Histórico de relatórios.
- Poupai Monitor.
- Conta/login do usuário.
- Alteração automática do plano.
- Preços hardcoded como se fossem reais: `data/offers.example.js` é apenas fixture de teste.

## Entrada

```js
import { analyzeInternetBill } from './engine/index.js';

const result = analyzeInternetBill({
  billText: 'texto extraído do PDF/foto...',
  location: { cep: '05001-000' }, // opcional se o CEP existir na fatura
  offers: [], // catálogo atual/verificado
});
```

## Formato mínimo de oferta

```js
{
  provider: 'Operadora',
  planName: 'Fibra 500 Mega',
  speedMbps: 500,
  priceMonthly: 99.90,
  promotionalMonths: 6,
  priceAfterPromo: 119.90,
  installationFee: 0,
  equipmentFeeMonthly: 0,
  contractMonths: 12,
  technology: 'FTTH Fibra',
  availableCepPrefixes: ['050'],
  availabilityConfirmed: false,
  sourceUrl: 'https://site-oficial/...',
  sourceCheckedAt: '2026-08-31'
}
```

## Teste

Na raiz do repositório:

```bash
node engine/test/run-v1.mjs
```

## Limite importante desta etapa

O núcleo já está separado da interface, mas PDF/imagem ainda precisam ser convertidos para texto por uma camada de **ingestão**. Isso deve ficar fora do HTML estático, porque OCR/IA e coleta de ofertas exigem backend/API e chaves protegidas. A próxima integração deve implementar:

1. `PDF/foto -> texto/JSON estruturado`;
2. `CEP -> ofertas atuais verificadas`;
3. passar ambos para `analyzeInternetBill()`.

Essa separação é intencional: evita misturar OCR, scraping/API e regras de negócio no mesmo código e torna o motor testável.
