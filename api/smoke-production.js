import readBillHandler from './read-bill.js';
import findOffersHandler from './find-offers.js';

const SYNTHETIC_BILL_PNG = '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';

function captureResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: '',
    setHeader(name, value) { this.headers[name] = value; },
    end(value = '') { this.body = String(value); },
  };
}

async function invoke(handler, outerReq, body) {
  const req = {
    method: 'POST',
    headers: outerReq.headers || {},
    body,
  };
  const res = captureResponse();
  await handler(req, res);
  let parsed = null;
  try { parsed = JSON.parse(res.body || '{}'); } catch { parsed = { raw: res.body }; }
  return { status: res.statusCode, body: parsed };
}

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  const mode = String(req.query?.mode || 'reader').toLowerCase();

  if (mode === 'reader') {
    const result = await invoke(readBillHandler, req, {
      filename: 'fatura-teste-poupai.png',
      mimeType: 'image/png',
      base64: SYNTHETIC_BILL_PNG,
    });
    const x = result.body?.extraction || {};
    return send(res, result.status === 200 ? 200 : 502, {
      ok: result.status === 200,
      mode: 'reader',
      upstreamStatus: result.status,
      reader: result.body?.reader || null,
      aiTransport: result.body?.aiTransport || null,
      providerModel: result.body?.providerModel || null,
      extracted: {
        provider: x.provider || null,
        speedMbps: x.speedMbps || null,
        internetMonthlyPrice: x.internetMonthlyPrice || null,
        invoiceTotal: x.invoiceTotal || null,
        cep: x.cep || null,
      },
      nextStep: result.body?.nextStep || null,
      error: result.status === 200 ? null : result.body?.message || result.body?.error || 'reader_failed',
    });
  }

  if (mode === 'market') {
    const result = await invoke(findOffersHandler, req, {
      cep: '01001-000',
      city: 'São Paulo',
      state: 'SP',
    });
    return send(res, result.status === 200 ? 200 : 502, {
      ok: result.status === 200,
      mode: 'market',
      upstreamStatus: result.status,
      market: result.body?.market || null,
      aiTransport: result.body?.aiTransport || null,
      providerModel: result.body?.providerModel || null,
      searchTool: result.body?.searchTool || null,
      acceptedOffers: result.body?.metrics?.acceptedOffers ?? null,
      rejectedOffers: result.body?.metrics?.rejectedOffers ?? null,
      nextStep: result.body?.nextStep || null,
      error: result.status === 200 ? null : result.body?.message || result.body?.error || 'market_failed',
    });
  }

  return send(res, 400, { ok: false, error: 'INVALID_MODE' });
}
