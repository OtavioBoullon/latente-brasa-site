# Poupai Engine

Motor independente do HTML da Poupai V4. A arquitetura atual evoluiu da V1 para o pipeline V2.1, mantendo o site separado das regras de negócio e das integrações externas.

## Fluxo atual

```text
Fatura PDF/foto
  -> Poupai Reader V2
  -> Poupai Market V2
  -> Provider Checkers V2.1
  -> Poupai Engine V1.1
  -> TROQUE / NEGOCIE / MANTENHA
```

## Engine

- Identifica operadora, plano, velocidade e preço.
- Calcula custo efetivo em 12 e 24 meses.
- Considera promoção, preço pós-promoção, instalação, equipamento e fidelidade.
- Compara preço, velocidade e tecnologia.
- Calcula Poupai Score.
- Gera diagnóstico e relatório.

## Reader V2

`engine/reader-v2.js` e `api/read-bill.js`

- Aceita PDF, JPG, PNG e WEBP.
- Extrai a fatura para JSON estruturado.
- Isola o preço da internet quando possível.
- Detecta combo, extras, promoção, reajuste e fidelidade.
- Usa confiança por campo e bloqueia comparações inseguras.
- Evita devolver dados pessoais desnecessários.

## Market V2

`engine/market-v2.js` e `api/find-offers.js`

- Pesquisa ofertas atuais em fontes oficiais.
- Normaliza preço, velocidade, tecnologia e condições.
- Guarda fonte, evidência e data de consulta.
- Distingue oferta regional de disponibilidade confirmada no imóvel.

## Provider Checkers V2.1

`engine/provider-checkers-v21.js` e `api/check-availability.js`

- Consulta o fluxo oficial de cobertura usando navegador server-side.
- Claro: tenta CEP + número.
- TIM: tenta CEP + número e retorna `CONTACT_DATA_REQUIRED` se o fluxo exigir telefone.
- Vivo: não envia nome/telefone sem consentimento explícito; quando autorizado, os dados são usados apenas durante a consulta e não são devolvidos na resposta.
- Detecta CAPTCHA, mudança de formulário, exigência de contato e resultados indeterminados.
- Só promove uma oferta para `address_confirmed` quando há fonte oficial, endereço submetido, evidência inequívoca e confiança mínima.
- Uma confirmação oficial de indisponibilidade remove as ofertas daquela operadora da comparação.

### Status possíveis

- `AVAILABLE`
- `UNAVAILABLE`
- `INDETERMINATE`
- `CAPTCHA_REQUIRED`
- `CONTACT_DATA_REQUIRED`
- `CONSENT_REQUIRED`
- `CHECK_FAILED`

## Pipeline V2.1

`engine/pipeline-v2.js`

O pipeline aceita os resultados dos checkers. Se houver ao menos uma oferta realmente confirmada no endereço, pode emitir a decisão final. Caso contrário, mantém a análise como preliminar e retorna `CONFIRME_DISPONIBILIDADE`.

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
```

## O que deliberadamente não existe nesta etapa

- Histórico de relatórios.
- Poupai Monitor.
- Conta/login do usuário.
- Alteração ou contratação automática do plano.

## Limite operacional importante

Sites de operadoras podem mudar formulário, exigir CAPTCHA ou solicitar dados adicionais. Nesses casos o Poupai não deve inferir cobertura. O checker retorna um status de revisão/consentimento e a oferta continua apenas como candidata até existir confirmação confiável.
