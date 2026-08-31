import readBillHandler from './read-bill.js';
import findOffersHandler from './find-offers.js';

const TINY_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z2XcAAAAASUVORK5CYII=';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function invoke(handler, req) {
  return new Promise((resolve) => {
    const res = {
      statusCode: 200,
      headers: {},
      setHeader(key, value) { this.headers[key] = value; },
      end(body) {
        let parsed = null;
        try { parsed = body ? JSON.parse(body) : null; } catch { parsed = { raw: String(body || '') }; }
        resolve({ status: this.statusCode, body: parsed });
      },
    };
    Promise.resolve(handler(req, res)).catch((error) => resolve({
      status: 500,
      body: { error: 'SMOKE_HANDLER_FAILED', message: error?.message || String(error) },
    }));
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  const mode = String(req.query?.mode || 'reader').toLowerCase();

  if (mode === 'reader') {
    const result = await invoke(readBillHandler, {
      method: 'POST',
      headers: req.headers || {},
      body: { filename: 'synthetic.png', mimeType: 'image/png', base64: TINY_PNG },
    });
    return json(res, result.status, {
      ok: result.status === 200,
      mode,
      upstreamStatus: result.status,
      reader: result.body?.reader || null,
      aiTransport: result.body?.aiTransport || null,
      providerModel: result.body?.providerModel || null,
      nextStep: result.body?.nextStep || null,
      error: result.body?.message || result.body?.error || null,
    });
  }

  if (mode === 'market') {
    const result = await invoke(findOffersHandler, {
      method: 'POST',
      headers: req.headers || {},
      body: { cep: '01310-100', city: 'São Paulo', state: 'SP' },
    });
    return json(res, result.status, {
      ok: result.status === 200,
      mode,
      upstreamStatus: result.status,
      market: result.body?.market || null,
      aiTransport: result.body?.aiTransport || null,
      providerModel: result.body?.providerModel || null,
      searchTool: result.body?.searchTool || null,
      acceptedOffers: result.body?.metrics?.acceptedOffers ?? null,
      rejectedOffers: result.body?.metrics?.rejectedOffers ?? null,
      nextStep: result.body?.nextStep || null,
      error: result.body?.message || result.body?.error || null,
    });
  }

  return json(res, 400, { ok: false, error: 'INVALID_MODE' });
}
