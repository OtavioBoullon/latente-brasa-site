# Poupai Reader V2

A V2 adiciona a primeira camada real de ingestão de faturas ao Poupai sem alterar o HTML da V4.

## Fluxo

```text
PDF / JPG / PNG / WEBP
        ↓
/api/read-bill
        ↓
Poupai Reader V2
        ↓
JSON estruturado + confiança + evidências
        ↓
Validação determinística
        ↓
SEARCH_MARKET | ASK_CEP | REVIEW_BILL
        ↓
Poupai Engine V1.1
```

## O que o Reader extrai

- operadora;
- nome do plano;
- preço isolado da internet;
- total da fatura;
- velocidade em Mbps;
- tecnologia quando informada;
- CEP, cidade e UF;
- vencimento e período da cobrança;
- combo internet/TV/telefone;
- fidelidade quando explícita;
- promoção e possível fim de promoção;
- reajuste quando explícito;
- adicionais como streaming, telefone, TV e equipamento;
- confiança por campo;
- pequenos trechos de evidência usados para justificar a extração.

## Guardrails

- Não transforma o total de um combo no preço da internet.
- Não inventa preço, velocidade, CEP, promoção, reajuste ou fidelidade.
- Se o preço da internet não estiver isolado, bloqueia a comparação de mercado.
- Se faltar CEP mas a fatura estiver legível, retorna `ASK_CEP`.
- Se a leitura estiver ambígua, retorna `REVIEW_BILL`.
- Não solicita nem devolve CPF, CNPJ, telefone, e-mail, número de contrato, código do cliente, código de barras ou endereço completo.
- O endpoint usa `Cache-Control: no-store`.
- O arquivo é enviado como arquivo temporário ao provedor de IA e o código tenta apagá-lo em `finally`, inclusive após erro de leitura.
- A resposta da Responses API é criada com `store: false`.

## Endpoint

`POST /api/read-bill`

Corpo JSON:

```json
{
  "filename": "fatura.pdf",
  "mimeType": "application/pdf",
  "base64": "JVBERi0x..."
}
```

Formatos aceitos: PDF, JPG, PNG e WEBP.

O limite do core está configurado em 3 MB por arquivo para manter a primeira integração simples. Imagens maiores devem ser comprimidas/redimensionadas no cliente quando a interface for conectada.

## Variáveis de ambiente

```text
OPENAI_API_KEY=...
POUPAI_READER_MODEL=gpt-5.6-terra   # opcional
```

A chave deve existir somente no servidor. Nunca colocar a chave no React, HTML ou JavaScript público.

## Saída resumida

```json
{
  "reader": "Poupai Reader V2.0.0",
  "extraction": {
    "provider": "Claro",
    "internetMonthlyPrice": 149.9,
    "speedMbps": 500,
    "cep": "05001-000"
  },
  "validation": {
    "validForDiagnosis": true,
    "validForMarketComparison": true
  },
  "nextStep": "SEARCH_MARKET"
}
```

## Teste local do core

```bash
node engine/test/run-reader-v2.mjs
```

O teste não chama uma API externa. Ele valida normalização, guardrails, confiança, combos, ausência de CEP, formatos de arquivo e parsing do Structured Output.

## Estado atual

O core do Reader e o endpoint server-side estão implementados. O caminho externo com uma fatura real ainda depende de configurar `OPENAI_API_KEY` em um backend/deploy e deve ser validado com um conjunto de faturas reais de operadoras diferentes antes de ser considerado pronto para produção.

O próximo módulo da V2 é o **Poupai Market**: usar o CEP/endereço validado para coletar ofertas reais, atuais e com evidência, e então entregar essas ofertas ao Engine V1.1.
