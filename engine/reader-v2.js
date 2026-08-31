export const POUPAI_READER_VERSION = '2.0.0';

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const BILL_EXTRACTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    documentType: { type: 'string', enum: ['internet_bill', 'not_internet_bill', 'uncertain'] },
    provider: { type: ['string', 'null'] },
    planName: { type: ['string', 'null'] },
    internetMonthlyPrice: { type: ['number', 'null'] },
    invoiceTotal: { type: ['number', 'null'] },
    speedMbps: { type: ['number', 'null'] },
    technology: { type: ['string', 'null'] },
    cep: { type: ['string', 'null'] },
    city: { type: ['string', 'null'] },
    state: { type: ['string', 'null'] },
    dueDate: { type: ['string', 'null'] },
    billingPeriod: { type: ['string', 'null'] },
    bundleDetected: { type: 'boolean' },
    internetPriceIsolated: { type: 'boolean' },
    contractMonths: { type: ['number', 'null'] },
    loyaltyEndDate: { type: ['string', 'null'] },
    promotion: {
      type: 'object',
      additionalProperties: false,
      properties: {
        detected: { type: 'boolean' },
        description: { type: ['string', 'null'] },
        discountAmount: { type: ['number', 'null'] },
        promotionalPrice: { type: ['number', 'null'] },
        regularPrice: { type: ['number', 'null'] },
        remainingMonths: { type: ['number', 'null'] },
        endDate: { type: ['string', 'null'] },
      },
      required: ['detected', 'description', 'discountAmount', 'promotionalPrice', 'regularPrice', 'remainingMonths', 'endDate'],
    },
    reajustment: {
      type: 'object',
      additionalProperties: false,
      properties: {
        detected: { type: 'boolean' },
        description: { type: ['string', 'null'] },
        previousPrice: { type: ['number', 'null'] },
        newPrice: { type: ['number', 'null'] },
        percentage: { type: ['number', 'null'] },
      },
      required: ['detected', 'description', 'previousPrice', 'newPrice', 'percentage'],
    },
    extras: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          price: { type: ['number', 'null'] },
          category: { type: 'string', enum: ['streaming', 'phone', 'tv', 'equipment', 'digital_service', 'other'] },
        },
        required: ['name', 'price', 'category'],
      },
    },
    confidence: {
      type: 'object',
      additionalProperties: false,
      properties: {
        provider: { type: 'number' },
        internetMonthlyPrice: { type: 'number' },
        invoiceTotal: { type: 'number' },
        speedMbps: { type: 'number' },
        cep: { type: 'number' },
        overall: { type: 'number' },
      },
      required: ['provider', 'internetMonthlyPrice', 'invoiceTotal', 'speedMbps', 'cep', 'overall'],
    },
    evidence: {
      type: 'object',
      additionalProperties: false,
      properties: {
        provider: { type: ['string', 'null'] },
        internetMonthlyPrice: { type: ['string', 'null'] },
        invoiceTotal: { type: ['string', 'null'] },
        speedMbps: { type: ['string', 'null'] },
        cep: { type: ['string', 'null'] },
        promotion: { type: ['string', 'null'] },
        reajustment: { type: ['string', 'null'] },
      },
      required: ['provider', 'internetMonthlyPrice', 'invoiceTotal', 'speedMbps', 'cep', 'promotion', 'reajustment'],
    },
    warnings: { type: 'array', items: { type: 'string' } },
  },
  required: [
    'documentType', 'provider', 'planName', 'internetMonthlyPrice', 'invoiceTotal', 'speedMbps',
    'technology', 'cep', 'city', 'state', 'dueDate', 'billingPeriod', 'bundleDetected',
    'internetPriceIsolated', 'contractMonths', 'loyaltyEndDate', 'promotion', 'reajustment',
    'extras', 'confidence', 'evidence', 'warnings'
  ],
};

export const READER_INSTRUCTIONS = `
Você é o Poupai Reader, especialista em faturas brasileiras de internet residencial.
Extraia SOMENTE informações explicitamente presentes ou claramente deriváveis do documento.
Não invente preços, velocidade, CEP, fidelidade, fim de promoção ou reajuste.

Regras obrigatórias:
1. internetMonthlyPrice deve representar somente o serviço de internet. Se a fatura for combo e não for possível separar o valor da internet, retorne null e internetPriceIsolated=false.
2. invoiceTotal é o total a pagar da fatura, mesmo que inclua outros serviços.
3. Converta velocidades para Mbps: 0,5 Giga = 500; 1 Giga = 1000.
4. Detecte TV, telefone, streaming, equipamento e serviços digitais em extras.
5. Promoção e reajuste só podem ser marcados quando houver evidência no documento.
6. Confidence deve ficar entre 0 e 1 por campo. Use confiança baixa quando o texto estiver cortado, borrado ou ambíguo.
7. evidence deve ser um trecho curto do próprio documento, sem CPF, CNPJ, número de contrato, telefone, e-mail, código de barras ou dados bancários.
8. Não extraia nem devolva nome completo, CPF, CNPJ, telefone, e-mail, número de contrato, código do cliente, código de barras, endereço completo ou qualquer dado pessoal desnecessário. Para localização, devolva apenas CEP, cidade e UF quando disponíveis.
9. Se não for uma conta de internet, documentType=not_internet_bill.
10. Se parecer uma conta de internet mas a leitura estiver muito ruim, documentType=uncertain.
`;

function numOrNull(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function confidence(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.min(1, Math.max(0, n)) * 100) / 100;
}

function cleanText(v, max = 240) {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
}

function normalizeCep(v) {
  const digits = String(v || '').replace(/\D/g, '');
  return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : null;
}

export function normalizeReaderExtraction(raw = {}) {
  const promo = raw.promotion || {};
  const reaj = raw.reajustment || {};
  const conf = raw.confidence || {};
  const evidence = raw.evidence || {};

  const normalized = {
    documentType: ['internet_bill', 'not_internet_bill', 'uncertain'].includes(raw.documentType)
      ? raw.documentType : 'uncertain',
    provider: cleanText(raw.provider, 80),
    planName: cleanText(raw.planName, 160),
    internetMonthlyPrice: numOrNull(raw.internetMonthlyPrice),
    invoiceTotal: numOrNull(raw.invoiceTotal),
    speedMbps: numOrNull(raw.speedMbps),
    technology: cleanText(raw.technology, 80),
    cep: normalizeCep(raw.cep),
    city: cleanText(raw.city, 80),
    state: cleanText(raw.state, 2)?.toUpperCase() || null,
    dueDate: cleanText(raw.dueDate, 20),
    billingPeriod: cleanText(raw.billingPeriod, 50),
    bundleDetected: Boolean(raw.bundleDetected),
    internetPriceIsolated: Boolean(raw.internetPriceIsolated),
    contractMonths: numOrNull(raw.contractMonths),
    loyaltyEndDate: cleanText(raw.loyaltyEndDate, 20),
    promotion: {
      detected: Boolean(promo.detected),
      description: cleanText(promo.description),
      discountAmount: numOrNull(promo.discountAmount),
      promotionalPrice: numOrNull(promo.promotionalPrice),
      regularPrice: numOrNull(promo.regularPrice),
      remainingMonths: numOrNull(promo.remainingMonths),
      endDate: cleanText(promo.endDate, 20),
    },
    reajustment: {
      detected: Boolean(reaj.detected),
      description: cleanText(reaj.description),
      previousPrice: numOrNull(reaj.previousPrice),
      newPrice: numOrNull(reaj.newPrice),
      percentage: numOrNull(reaj.percentage),
    },
    extras: Array.isArray(raw.extras) ? raw.extras.slice(0, 20).map((x) => ({
      name: cleanText(x?.name, 120) || 'Adicional',
      price: numOrNull(x?.price),
      category: ['streaming', 'phone', 'tv', 'equipment', 'digital_service', 'other'].includes(x?.category)
        ? x.category : 'other',
    })) : [],
    confidence: {
      provider: confidence(conf.provider),
      internetMonthlyPrice: confidence(conf.internetMonthlyPrice),
      invoiceTotal: confidence(conf.invoiceTotal),
      speedMbps: confidence(conf.speedMbps),
      cep: confidence(conf.cep),
      overall: confidence(conf.overall),
    },
    evidence: {
      provider: cleanText(evidence.provider),
      internetMonthlyPrice: cleanText(evidence.internetMonthlyPrice),
      invoiceTotal: cleanText(evidence.invoiceTotal),
      speedMbps: cleanText(evidence.speedMbps),
      cep: cleanText(evidence.cep),
      promotion: cleanText(evidence.promotion),
      reajustment: cleanText(evidence.reajustment),
    },
    warnings: Array.isArray(raw.warnings) ? raw.warnings.slice(0, 12).map((x) => cleanText(x, 240)).filter(Boolean) : [],
  };

  if (normalized.bundleDetected && !normalized.internetPriceIsolated) {
    normalized.internetMonthlyPrice = null;
    normalized.confidence.internetMonthlyPrice = Math.min(normalized.confidence.internetMonthlyPrice, 0.4);
  }

  return normalized;
}

export function validateReaderExtraction(extraction, options = {}) {
  const x = normalizeReaderExtraction(extraction);
  const minFieldConfidence = Number(options.minFieldConfidence ?? 0.7);
  const minOverallConfidence = Number(options.minOverallConfidence ?? 0.72);
  const issues = [];

  if (x.documentType !== 'internet_bill') {
    issues.push({ field: 'documentType', severity: 'error', code: 'NOT_CONFIRMED_INTERNET_BILL', message: 'O arquivo não foi confirmado como fatura de internet.' });
  }
  if (!x.provider) issues.push({ field: 'provider', severity: 'error', code: 'MISSING_PROVIDER', message: 'Operadora não identificada.' });
  if (!(x.speedMbps > 0)) issues.push({ field: 'speedMbps', severity: 'error', code: 'MISSING_SPEED', message: 'Velocidade contratada não identificada.' });
  if (!(x.internetMonthlyPrice > 0)) issues.push({ field: 'internetMonthlyPrice', severity: 'error', code: 'MISSING_INTERNET_PRICE', message: 'Preço isolado da internet não identificado.' });
  if (!x.internetPriceIsolated) issues.push({ field: 'internetMonthlyPrice', severity: 'error', code: 'PRICE_NOT_ISOLATED', message: 'A conta parece ser um combo e o preço da internet não foi isolado.' });
  if (!x.cep) issues.push({ field: 'cep', severity: 'warning', code: 'MISSING_CEP', message: 'CEP não encontrado; será necessário solicitar o CEP ao usuário para pesquisar ofertas.' });
  if (x.confidence.overall < minOverallConfidence) issues.push({ field: 'confidence.overall', severity: 'warning', code: 'LOW_OVERALL_CONFIDENCE', message: 'Leitura geral com confiança baixa.' });

  for (const field of ['provider', 'internetMonthlyPrice', 'speedMbps']) {
    if (x.confidence[field] < minFieldConfidence) {
      issues.push({ field, severity: 'warning', code: 'LOW_FIELD_CONFIDENCE', message: `Confiança baixa na leitura de ${field}.` });
    }
  }

  return {
    validForDiagnosis: !issues.some((i) => i.severity === 'error' && ['documentType', 'provider', 'speedMbps'].some((f) => i.field.includes(f))),
    validForMarketComparison: !issues.some((i) => i.severity === 'error') && Boolean(x.cep),
    needsUserConfirmation: issues.some((i) => i.severity === 'warning' && i.code === 'LOW_FIELD_CONFIDENCE'),
    needsCep: !x.cep,
    issues,
  };
}

export function buildEngineText(extraction) {
  const x = normalizeReaderExtraction(extraction);
  const lines = [];
  if (x.provider) lines.push(x.provider);
  if (x.cep) lines.push(`CEP ${x.cep}`);
  if (x.planName || x.speedMbps || x.internetMonthlyPrice) {
    const planHasSpeed = x.planName && x.speedMbps && new RegExp(`\\b${Math.round(x.speedMbps)}\\s*(?:mega|mbps|m)\\b`, 'i').test(x.planName);
    const plan = [x.planName || 'Internet', !planHasSpeed && x.speedMbps ? `${x.speedMbps} Mega` : '', x.internetMonthlyPrice ? `R$ ${x.internetMonthlyPrice.toFixed(2).replace('.', ',')}` : '']
      .filter(Boolean).join(' ');
    lines.push(plan);
  }
  if (x.technology) lines.push(`Tecnologia ${x.technology}`);
  for (const extra of x.extras) {
    lines.push(`${extra.name}${extra.price != null ? ` R$ ${extra.price.toFixed(2).replace('.', ',')}` : ''}`);
  }
  if (x.promotion.detected) lines.push(`Promoção ${x.promotion.description || ''}`.trim());
  if (x.reajustment.detected) lines.push(`Reajuste ${x.reajustment.description || ''}`.trim());
  if (x.invoiceTotal != null) lines.push(`Total a pagar R$ ${x.invoiceTotal.toFixed(2).replace('.', ',')}`);
  return lines.join('\n');
}

export function validateUploadMetadata({ filename, mimeType, base64, maxBytes = 3 * 1024 * 1024 } = {}) {
  const errors = [];
  if (!filename || typeof filename !== 'string') errors.push('filename obrigatório');
  if (!ALLOWED_MIME_TYPES.has(mimeType)) errors.push('Formato não suportado. Use PDF, JPG, PNG ou WEBP.');
  if (!base64 || typeof base64 !== 'string') errors.push('Arquivo vazio.');
  const clean = String(base64 || '').replace(/^data:[^;]+;base64,/, '');
  const estimatedBytes = Math.floor(clean.length * 0.75);
  if (estimatedBytes > maxBytes) errors.push(`Arquivo acima do limite de ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  return { valid: errors.length === 0, errors, estimatedBytes, cleanBase64: clean };
}

export function extractStructuredOutput(response) {
  if (!response || !Array.isArray(response.output)) throw new Error('Resposta inválida do provedor de IA.');
  for (const item of response.output) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content) {
      if (part?.type === 'output_text' && typeof part.text === 'string') {
        try { return JSON.parse(part.text); } catch { /* continue */ }
      }
    }
  }
  throw new Error('A IA não retornou JSON estruturado utilizável.');
}
