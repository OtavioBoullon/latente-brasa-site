import {
  MARKET_SEARCH_INSTRUCTIONS,
  MARKET_SEARCH_SCHEMA,
  OFFICIAL_PROVIDER_DOMAINS,
  POUPAI_MARKET_VERSION,
  extractStructuredMarketOutput,
  marketDecisionGate,
  normalizeMarketSearch,
} from '../engine/market-v2.js';

const OPENAI_BASE = 'https://api.openai.com/v1';
const DEFAULT_MODEL = process.env.POUPAI_MARKET_MODEL || 'gpt-5.4';

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function normalizeCep(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : null;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function collectWebSources(payload) {
  const sources = [];
  for (const item of payload?.output || []) {
    if (item?.type !== 'web_search_call') continue;
    for (const source of item?.action?.sources || []) {
      if (source?.type === 'url' && source.url) sources.push(source.url);
    }
  }
  return [...new Set(sources)].slice(0, 50);
}

async function callMarketModel({ apiKey, model, location }) {
  const checkedAt = todayIso();
  const locationText = [
    `CEP: ${location.cep}`,
    location.city ? `Cidade: ${location.city}` : null,
    location.state ? `Estado: ${location.state}` : null,
  ].filter(Boolean).join('\n');

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
      instructions: MARKET_SEARCH_INSTRUCTIONS,
      input: `Hoje é ${checkedAt}. Pesquise ofertas atuais de internet fixa residencial relevantes para:\n${locationText}\nUse web search e retorne o schema solicitado.`,
      tools: [{
        type: 'web_search',
        search_context_size: 'high',
        filters: { allowed_domains: OFFICIAL_PROVIDER_DOMAINS },
      }],
      tool_choice: 'required',
      include: ['web_search_call.action.sources'],
      text: {
        verbosity: 'low',
        format: {
          type: 'json_schema',
          name: 'poupai_market_offers',
          strict: true,
          schema: MARKET_SEARCH_SCHEMA,
        },
      },
    }),
  });

  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || `Falha na pesquisa (${response.status}).`);
  return { payload, checkedAt };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return json(res, 503, {
      error: 'MARKET_NOT_CONFIGURED',
      message: 'OPENAI_API_KEY não configurada no servidor.',
    });
  }

  const cep = normalizeCep(req.body?.cep);
  if (!cep) return json(res, 400, { error: 'INVALID_CEP', message: 'Informe um CEP válido com 8 dígitos.' });

  const location = {
    cep,
    city: req.body?.city ? String(req.body.city).trim().slice(0, 100) : null,
    state: req.body?.state ? String(req.body.state).trim().slice(0, 40) : null,
  };

  try {
    const { payload, checkedAt } = await callMarketModel({ apiKey, model: DEFAULT_MODEL, location });
    const raw = extractStructuredMarketOutput(payload);
    const market = normalizeMarketSearch(raw, location, { checkedAt });
    const gate = marketDecisionGate(market);

    return json(res, 200, {
      market: `Poupai Market V${POUPAI_MARKET_VERSION}`,
      model: DEFAULT_MODEL,
      result: market,
      gate,
      sourcesConsulted: collectWebSources(payload),
      nextStep: gate.canRunFinalEngine
        ? 'RUN_FINAL_ENGINE'
        : gate.canRunPreliminaryEngine
          ? 'RUN_PRELIMINARY_ENGINE_AND_CONFIRM_ADDRESS'
          : 'REVIEW_LOCATION_OR_SEARCH',
    });
  } catch (error) {
    return json(res, 502, {
      error: 'MARKET_FAILED',
      message: error?.message || 'Falha ao pesquisar ofertas de internet.',
    });
  }
}
