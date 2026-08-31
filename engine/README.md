# Poupai Engine — V2.2

Motor independente do HTML da Poupai V4. O Poupai analisa uma fatura de internet residencial, pesquisa alternativas oficiais, valida disponibilidade quando possível e só então decide entre **TROQUE**, **NEGOCIE**, **MANTENHA** ou **ANALISE_INCONCLUSIVA**.

## Fluxo atual

```text
Fatura PDF/foto
  -> Poupai Reader V2
  -> Poupai Market V2
  -> Provider Checkers V2.1
  -> Hardening V2.2
  -> Poupai Engine V1.1
  -> TROQUE / NEGOCIE / MANTENHA / ANALISE_INCONCLUSIVA
```

## Engine

- Identifica operadora, plano, velocidade e preço.
- Calcula custo efetivo em 12 e 24 meses.
- Considera promoção, preço pós-promoção, instalação, equipamento e fidelidade.
- Compara preço, velocidade e tecnologia.
- Calcula Poupai Score.
- Gera diagnóstico e relatório.

## Reader V2 + hardening V2.2

`engine/reader-v2.js`, `engine/hardening-v22.js` e `api/read-bill.js`

- Aceita PDF, JPG, PNG e WEBP.
- Extrai a fatura para JSON estruturado.
- Isola o preço da internet quando possível.
- Detecta combo, extras, promoção, reajuste e fidelidade.
- Usa confiança por campo e evidência curta.
- Trata todo conteúdo do documento como dado não confiável e ignora instruções/prompt injection presentes na própria fatura.
- Valida deterministicamente evidência de operadora, preço, velocidade e CEP.
- Checa consistência matemática entre preço da internet, adicionais e total da fatura.
- Evita devolver dados pessoais desnecessários.
- Usa timeout e retry controlado.
- Retorna métricas de latência e uso de tokens.

## Market V2 + hardening V2.2

`engine/market-v2.js`, `engine/hardening-v22.js` e `api/find-offers.js`

- Pesquisa ofertas atuais em fontes oficiais.
- Normaliza preço, velocidade, tecnologia e condições.
- Guarda fonte, evidência e data de consulta.
- Distingue oferta regional de disponibilidade confirmada no imóvel.
- Rejeita oferta sem preço, velocidade, fonte oficial, evidência de preço, data de consulta ou confiança mínima.
- Penaliza/oficialmente rejeita oferta antiga conforme os limites configurados.
- Trata conteúdo das páginas como dado não confiável.
- Usa timeout e retry controlado.
- Retorna métricas de latência, tokens e quantidade de ofertas aceitas/rejeitadas.

## Provider Checkers V2.1 + hardening V2.2

`engine/provider-checkers-v21.js` e `api/check-availability.js`

- Consulta o fluxo oficial de cobertura usando navegador server-side.
- Claro: tenta CEP + número.
- TIM: tenta CEP + número e retorna `CONTACT_DATA_REQUIRED` se o fluxo exigir telefone.
- Vivo: não envia nome/telefone sem consentimento explícito; quando autorizado, os dados são usados apenas durante a consulta e não são devolvidos na resposta.
- Detecta CAPTCHA, mudança de formulário, exigência de contato e resultados indeterminados.
- Só promove uma oferta para `address_confirmed` quando há fonte oficial, endereço submetido, evidência inequívoca e confiança mínima.
- Uma confirmação oficial de indisponibilidade remove as ofertas daquela operadora da comparação.
- Falhas e respostas indeterminadas recebem uma segunda tentativa controlada.
- Registra tempo e número de tentativas por operadora.

### Status possíveis dos checkers

- `AVAILABLE`
- `UNAVAILABLE`
- `INDETERMINATE`
- `CAPTCHA_REQUIRED`
- `CONTACT_DATA_REQUIRED`
- `CONSENT_REQUIRED`
- `CHECK_FAILED`

## Pipeline V2.2

`engine/pipeline-v2.js`

O pipeline aplica o Hardening V2.2 antes de emitir uma recomendação final. Ele gera um **audit trace** técnico, sem dados pessoais desnecessários, mostrando quais campos foram usados, quais regras bloquearam algo, quantas ofertas foram aceitas/rejeitadas e qual regra levou à decisão.

### Regra de segurança principal

Ausência de oferta encontrada **não significa** que o plano atual seja bom.

`MANTENHA` só pode ser emitido quando a fatura está validada, há disponibilidade exata e a cobertura de mercado atinge o mínimo definido pelo hardening. Caso contrário, o resultado é `ANALISE_INCONCLUSIVA`.

## Dependências do browser server-side

- `playwright-core`
- `@sparticuz/chromium`

Essas dependências são usadas apenas no backend; não entram no HTML da V4.

## Testes

```bash
node engine/test/run-v1.mjs
node engine/test/run-v11.mjs
node engine/test/run-reader-v2.mjs
node engine/test/run-market-v2.mjs
node engine/test/run-provider-checkers-v21.mjs
node engine/test/run-hardening-v22.mjs
```

A suíte de hardening V2.2 contém **20 cenários de regressão**, incluindo evidência divergente, preço maior que a fatura, componentes acima do total, baixa confiança, prompt injection, CEP conflitante, oferta falsa, oferta antiga, oferta sem evidência, retry e bloqueio de `MANTENHA` com cobertura de mercado insuficiente.

## O que deliberadamente não existe nesta etapa

- Histórico de relatórios.
- Poupai Monitor.
- Conta/login do usuário.
- Alteração ou contratação automática do plano.
- Armazenamento permanente de faturas.

## Limite operacional importante

Sites de operadoras podem mudar formulário, exigir CAPTCHA ou solicitar dados adicionais. Nesses casos o Poupai não infere cobertura. O checker retorna um status de revisão/consentimento e a oferta continua apenas como candidata até existir confirmação confiável.

## Próxima validação

O próximo passo não é adicionar mais lógica ao core. É rodar o fluxo com faturas reais e endereços reais, medir erros, latência/custo e ajustar regras com base nos casos que aparecerem no mundo real.
