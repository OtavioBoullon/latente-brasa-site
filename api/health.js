function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export default function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
  const oidc = Boolean(process.env.VERCEL_OIDC_TOKEN);
  const gatewayKey = Boolean(process.env.AI_GATEWAY_API_KEY);
  return json(res, oidc || gatewayKey ? 200 : 503, {
    ok: oidc || gatewayKey,
    service: 'Poupai',
    release: '2.5.1-production',
    environment: process.env.VERCEL_ENV || 'unknown',
    ai: {
      gateway: 'Vercel AI Gateway',
      authAvailable: oidc || gatewayKey,
      authMode: oidc ? 'oidc' : gatewayKey ? 'api_key' : 'missing',
      readerModel: process.env.POUPAI_READER_MODEL || 'openai/gpt-5.6-terra',
      marketModel: process.env.POUPAI_MARKET_MODEL || 'openai/gpt-5.6-sol',
    },
    endpoints: [
      '/api/read-bill',
      '/api/find-offers',
      '/api/check-availability',
      '/api/run-pipeline',
    ],
    commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
    timestamp: new Date().toISOString(),
  });
}
