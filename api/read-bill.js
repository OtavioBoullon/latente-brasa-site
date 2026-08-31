import {
  BILL_EXTRACTION_SCHEMA,
  POUPAI_READER_VERSION,
  READER_INSTRUCTIONS,
  extractStructuredOutput,
  normalizeReaderExtraction,
  validateReaderExtraction,
  validateUploadMetadata,
} from '../engine/reader-v2.js';

const OPENAI_BASE = 'https://api.openai.com/v1';
const DEFAULT_MODEL = process.env.POUPAI_READER_MODEL || 'gpt-5.6-terra';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

async function uploadTemporaryFile({ apiKey, filename, mimeType, bytes }) {
  const form = new FormData();
  form.append('purpose', 'user_data');
  form.append('file', new Blob([bytes], { type: mimeType }), filename);

  const response = await fetch(`${OPENAI_BASE}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `Falha no upload (${response.status}).`);
  return payload.id;
}

async function deleteTemporaryFile(apiKey, fileId) {
  if (!fileId) return;
  try {
    await fetch(`${OPENAI_BASE}/files/${encodeURIComponent(fileId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    // Não mascara o resultado da leitura caso a limpeza remota falhe.
  }
}

async function callReaderModel({ apiKey, fileId, mimeType, model }) {
  const isImage = mimeType.startsWith('image/');
  const content = [
    { type: 'input_text', text: 'Leia esta fatura e extraia os campos do schema. Retorne somente os dados estruturados.' },
    isImage
      ? { type: 'input_image', file_id: fileId, detail: 'high' }
      : { type: 'input_file', file_id: fileId, detail: 'auto' },
  ];

  const response = await fetch(`${OPENAI_BASE}/responses`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: 'low' },
      instructions: READER_INSTRUCTIONS,
      input: [{ role: 'user', content }],
      text: {
        verbosity: 'low',
        format: {
          type: 'json_schema',
          name: 'poupai_internet_bill',
          strict: true,
          schema: BILL_EXTRACTION_SCHEMA,
        },
      },
    }),
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `Falha na leitura (${response.status}).`);
  return payload;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return json(res, 503, { error: 'READER_NOT_CONFIGURED', message: 'OPENAI_API_KEY não configurada no servidor.' });

  const { filename, mimeType, base64 } = req.body || {};
  const upload = validateUploadMetadata({ filename, mimeType, base64 });
  if (!upload.valid) return json(res, 400, { error: 'INVALID_UPLOAD', issues: upload.errors });

  let fileId = null;
  try {
    const bytes = Buffer.from(upload.cleanBase64, 'base64');
    fileId = await uploadTemporaryFile({ apiKey, filename, mimeType, bytes });
    const aiResponse = await callReaderModel({ apiKey, fileId, mimeType, model: DEFAULT_MODEL });
    const extracted = normalizeReaderExtraction(extractStructuredOutput(aiResponse));
    const validation = validateReaderExtraction(extracted);

    return json(res, 200, {
      reader: `Poupai Reader V${POUPAI_READER_VERSION}`,
      model: DEFAULT_MODEL,
      extraction: extracted,
      validation,
      nextStep: validation.validForMarketComparison
        ? 'SEARCH_MARKET'
        : validation.needsCep && validation.validForDiagnosis
          ? 'ASK_CEP'
          : 'REVIEW_BILL',
    });
  } catch (error) {
    return json(res, 502, { error: 'READER_FAILED', message: error?.message || 'Falha ao interpretar a fatura.' });
  } finally {
    await deleteTemporaryFile(apiKey, fileId);
  }
}
