function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export default function handler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });

  const geminiConfigured = Boolean(process.env.GEMINI_API_KEY);

  return json(res, geminiConfigured ? 200 : 503, {
    ok: geminiConfigured,
    service: 'Poupai',
    release: '2.6.2-gemini-cardless',
    environment: process.env.VERCEL_ENV || 'unknown',
    ai: {
      provider: 'Google Gemini API',
      authAvailable: geminiConfigured,
      authMode: geminiConfigured ? 'api_key' : 'missing',
      readerModel: process.env.POUPAI_GEMINI_READER_MODEL || 'gemini-3.6-flash',
      marketModel: process.env.POUPAI_GEMINI_MARKET_MODEL || 'gemini-3.6-flash',
      marketSearch: 'direct_official_page_fetch',
      billingRequiredByPoupai: false,
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
