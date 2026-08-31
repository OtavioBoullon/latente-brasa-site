import { runPoupaiV25 } from '../engine/pipeline-v25.js';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  try {
    const body = req.body || {};
    const size = Buffer.byteLength(JSON.stringify(body), 'utf8');
    if (size > 1024 * 1024) return json(res, 413, { error: 'PAYLOAD_TOO_LARGE' });

    const result = runPoupaiV25({
      extraction: body.extraction || {},
      marketResult: body.marketResult || {},
      availabilityChecks: Array.isArray(body.availabilityChecks) ? body.availabilityChecks : [],
      engineConfig: body.engineConfig || {},
      metrics: body.metrics || {},
    });
    return json(res, 200, result);
  } catch (error) {
    return json(res, 500, {
      error: 'PIPELINE_FAILED',
      message: String(error?.message || 'Falha ao executar o pipeline.').slice(0, 300),
    });
  }
}
