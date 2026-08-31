import { fetchWithTimeout, withRetry } from './hardening-v22.js';

export const POUPAI_GEMINI_CLIENT_VERSION = '2.6.0';
export const DEFAULT_GEMINI_READER_MODEL = process.env.POUPAI_READER_MODEL || 'gemini-2.5-flash';
export const DEFAULT_GEMINI_MARKET_MODEL = process.env.POUPAI_MARKET_MODEL || 'gemini-2.5-flash';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export function geminiApiKey() {
  return process.env.GEMINI_API_KEY || null;
}

function cleanSchema(value) {
  if (Array.isArray(value)) return value.map(cleanSchema);
  if (!value || typeof value !== 'object') return value;

  const out = {};
  for (const [key, raw] of Object.entries(value)) {
    if (key === 'additionalProperties' && raw === false) continue;
    if (key === 'type' && Array.isArray(raw)) {
      const nonNull = raw.filter((x) => x !== 'null');
      if (nonNull.length === 1) out.type = nonNull[0];
      if (raw.includes('null')) out.nullable = true;
      continue;
    }
    out[key] = cleanSchema(raw);
  }
  return out;
}

function extractText(payload) {
  const candidates = Array.isArray(payload?.candidates) ? payload.candidates : [];
  for (const candidate of candidates) {
    const parts = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
    const text = parts.map((part) => typeof part?.text === 'string' ? part.text : '').filter(Boolean).join('\n').trim();
    if (text) return text;
  }
  throw new Error('O Gemini não retornou conteúdo utilizável.');
}

export function parseGeminiJson(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('O Gemini não retornou JSON.');
  const unfenced = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try { return JSON.parse(unfenced); } catch { /* tenta recorte */ }
  const start = unfenced.indexOf('{');
  const end = unfenced.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(unfenced.slice(start, end + 1)); } catch { /* cai abaixo */ }
  }
  throw new Error('O Gemini não produziu JSON válido.');
}

export async function callGemini({
  apiKey,
  model,
  contents,
  systemInstruction,
  responseSchema,
  tools,
  temperature = 0.1,
  maxOutputTokens = 8192,
  timeoutMs = 50000,
  attempts = 2,
} = {}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY ausente.');
  if (!model) throw new Error('Modelo Gemini ausente.');

  return withRetry(async () => {
    const response = await fetchWithTimeout(
      `${GEMINI_API_BASE}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'x-goog-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          contents,
          ...(systemInstruction ? { systemInstruction: { parts: [{ text: systemInstruction }] } } : {}),
          ...(Array.isArray(tools) && tools.length ? { tools } : {}),
          generationConfig: {
            temperature,
            maxOutputTokens,
            responseMimeType: 'application/json',
            ...(responseSchema ? { responseSchema: cleanSchema(responseSchema) } : {}),
          },
        }),
      },
      timeoutMs,
    );

    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok) {
      const message = payload?.error?.message || `Falha no Gemini (${response.status}).`;
      const error = new Error(message);
      error.status = response.status;
      throw error;
    }

    const text = extractText(payload);
    return {
      payload,
      text,
      json: parseGeminiJson(text),
      usage: payload?.usageMetadata || {},
      groundingMetadata: payload?.candidates?.[0]?.groundingMetadata || null,
    };
  }, { attempts, baseDelayMs: 500 });
}
