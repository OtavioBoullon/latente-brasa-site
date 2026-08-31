# Poupai Engine — V2.5

Motor independente do HTML da Poupai V4. O Poupai analisa uma fatura de internet residencial, determina o **custo mensal efetivo** do serviço, pesquisa alternativas oficiais, valida disponibilidade quando possível e só então decide entre **TROQUE**, **NEGOCIE**, **MANTENHA** ou **ANALISE_INCONCLUSIVA**.

## Fluxo atual

```text
Fatura PDF/foto
  -> Poupai Reader V2 + regras de cobrança V2.5
  -> Real Bill Guard V2.4
  -> Billing Baseline V2.5
  -> Poupai Market V2/V2.3
  -> Provider Checkers V2.1
  -> Hardening V2.2
  -> Structured Engine
  -> TROQUE / NEGOCIE / MANTENHA / ANALISE_INCONCLUSIVA
```

## O que mudou com faturas reais

Os testes com faturas públicas reais revelaram estruturas que fixtures artificiais não cobriam bem:

- preço cheio do plano + descontos recorrentes separados;
- desconto por meio de pagamento;
- SCM dividido contabilmente de SVA/locação/serviços digitais;
- serviços portáveis como streaming;
- combo com TV, telefone ou móvel;
- multa, juros e débitos anteriores;
- fatura que informa internet/fibra, mas não informa a velocidade;
- operadoras regionais e nomes comerciais fora das grandes operadoras nacionais;
- faturas antigas que não podem representar o plano atual.

O Billing Baseline V2.5 resolve a base econômica antes de qualquer comparação. Assim, o motor não compara, por exemplo, um preço cheio antes dos descontos nem uma linha SCM artificialmente baixa quando a própria fatura mostra que o pacote recorrente é composto por SCM + SVA.

## Engine

- Aceita operadoras nacionais e regionais vindas do Reader estruturado.
- Calcula custo efetivo em 12 e 24 meses.
- Considera promoção, preço pós-promoção, instalação, equipamento e fidelidade.
- Compara preço, velocidade e tecnologia.
- Calcula Poupai Score.
- Gera diagnóstico e relatório.

## Reader V2 + regras V2.5

`engine/reader-v2.js`, `engine/hardening-v22.js` e `api/read-bill.js`

- Aceita PDF, JPG, PNG e WEBP.
- Extrai a fatura para JSON estruturado.
- Detecta combo, extras, promoção, reajuste e fidelidade.
- Trata todo conteúdo do documento como dado não confiável e ignora prompt injection.
- Se houver preço cheio + desconto recorrente, orienta a extração do preço líquido atual e preserva o preço cheio na promoção.
- Não incorpora multa, juros ou faturas anteriores ao custo recorrente.
- Em divisões SCM/SVA, preserva os componentes para o Billing Baseline decidir.
- Não inventa velocidade quando ela não aparece na fatura.
- Usa confiança por campo, evidência curta, timeout e retry.

## Real Bill Guard V2.4

`engine/real-bill-v23.js`

- Aceita o JSON estruturado do Reader sem depender de uma lista fixa de operadoras.
- Verifica a idade da fatura.
- Faturas antigas ou com data desconhecida não podem gerar comparação atual sem revisão.
- O custo usado pelo Engine vem do Billing Baseline, não necessariamente da linha SCM impressa.

## Billing Baseline V2.5

`engine/billing-baseline-v25.js`

- `discounted_internet_line`: usa o preço líquido atual quando a fatura demonstra preço cheio + desconto.
- `provider_package_effective`: soma economicamente componentes recorrentes ligados ao provedor quando a fatura é uma divisão contábil SCM/SVA.
- Exclui serviços portáveis da base quando eles podem continuar após a troca.
- Exclui multa, juros, mora e débitos anteriores do custo recorrente.
- Bloqueia combos de TV/telefone/móvel quando não é seguro assumir que os preços são independentes.
- Bloqueia diferenças relevantes não classificadas.

O caminho histórico `engine/billing-baseline-v24.js` aponta para a implementação V2.5 para manter compatibilidade com o pipeline existente.

## Market

`engine/market-v2.js`, `engine/market-v23.js`, `engine/hardening-v22.js` e `api/find-offers.js`

- Pesquisa ofertas atuais em fontes oficiais.
- Inclui grandes operadoras e provedores regionais oficiais já cadastrados.
- Normaliza preço, velocidade, tecnologia e condições.
- Guarda fonte, evidência e data de consulta.
- Distingue oferta regional de disponibilidade confirmada no imóvel.
- Rejeita oferta sem preço, velocidade, fonte oficial, evidência de preço, data ou confiança mínima.

## Provider Checkers V2.1

`engine/provider-checkers-v21.js` e `api/check-availability.js`

- Consulta fluxos oficiais de cobertura usando navegador server-side.
- Detecta CAPTCHA, mudança de formulário e exigência de contato.
- Só promove oferta para `address_confirmed` com evidência inequívoca.
- Falhas/indeterminações recebem retry controlado.

## Corpus de faturas públicas reais V2.5

`engine/data/public-bills-corpus-v25.js`

O corpus contém somente **estrutura de cobrança necessária aos testes**. Nomes, CPF/CNPJ de clientes, endereço completo, boleto, código de cliente e demais dados pessoais foram removidos.

Casos cobertos atualmente incluem:

- TIM Fibra 500M com preço cheio e dois descontos;
- TIM Fibra 1 Giga com promoção;
- Unifique 350 Mega com Wi-Fi Mesh + serviço digital compondo a fatura;
- Brisanet SCM + serviços digitais com velocidade ausente;
- Vivo Total com Fibra + móvel/streaming;
- Nio Fibra sem velocidade explícita;
- Vivo Total histórico com múltiplos produtos.

## Testes

```bash
node engine/test/run-v1.mjs
node engine/test/run-v11.mjs
node engine/test/run-reader-v2.mjs
node engine/test/run-market-v2.mjs
node engine/test/run-provider-checkers-v21.mjs
node engine/test/run-hardening-v22.mjs
node engine/test/run-real-bill-v23.mjs
node engine/test/run-billing-baseline-v24.mjs
node engine/test/run-public-bills-v25.mjs
```

A suíte roda automaticamente no GitHub Actions. O corpus V2.5 é executado junto com todos os testes anteriores para impedir regressões.

## O que deliberadamente não existe nesta etapa

- Histórico de relatórios.
- Poupai Monitor.
- Conta/login do usuário.
- Alteração ou contratação automática do plano.
- Armazenamento permanente de faturas.

## Limite operacional importante

Os fixtures de faturas públicas validam **regras de negócio e regressão**. Eles não substituem a execução real do `api/read-bill.js` contra cada PDF original, porque essa etapa depende da API de IA configurada no backend. Sites de operadoras também podem mudar formulários ou exigir CAPTCHA; nesses casos o Poupai não infere cobertura.
