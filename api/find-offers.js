import {
  OFFICIAL_PROVIDER_DOMAINS_V23,
  POUPAI_MARKET_V23_VERSION,
  normalizeMarketSearchV23,
} from '../engine/market-v23.js';
import { marketDecisionGate } from '../engine/market-v2.js';
import { hardenMarketResult } from '../engine/hardening-v22.js';
import {
  extractRawOffersFromOfficialPagesV26,
  fetchOfficialMarketPagesV26,
  POUPAI_OFFICIAL_MARKET_FETCH_VERSION,
} from '../engine/official-market-fetch-v26.js';

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

export default async function handler(req, res) {
  const startedAt = Date.now();
  if (req.method !== 'POST') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });

  const cep = normalizeCep(req.body?.cep);
  if (!cep) return json(res, 400, { error: 'INVALID_CEP', message: 'Informe um CEP válido com 8 dígitos.' });

  const location = {
    cep,
    city: req.body?.city ? String(req.body.city).trim().slice(0, 100) : null,
    state: req.body?.state ? String(req.body.state).trim().slice(0, 40) : null,
  };

  try {
    const checkedAt = todayIso();
    const sourceFetch = await fetchOfficialMarketPagesV26();
    if (!sourceFetch.pages.length) {
      return json(res, 502, {
        error: 'MARKET_OFFICIAL_SOURCES_UNAVAILABLE',
        message: 'As páginas oficiais das operadoras não puderam ser consultadas agora. Tente novamente em alguns minutos.',
        sourceFetch: {
          version: sourceFetch.version,
          attempted: sourceFetch.attempted,
          fetched: sourceFetch.fetched,
          failures: sourceFetch.failures,
        },
        metrics: { latencyMs: Date.now() - startedAt },
      });
    }

    const raw = extractRawOffersFromOfficialPagesV26(sourceFetch, location);
    const normalized = normalizeMarketSearchV23(raw, location, { checkedAt });
    const market = hardenMarketResult(normalized, {
      asOfDate: checkedAt,
      minOfferConfidence: 0.75,
      staleAfterDays: 21,
      maxOfferAgeDays: 60,
    });
    const gate = marketDecisionGate(market);
    const sourcesConsulted = sourceFetch.pages.map((page) => page.sourceUrl);

    return json(res, 200, {
      market: `Poupai Market V${POUPAI_MARKET_V23_VERSION}`,
      hardeningVersion: market.hardening?.version || '2.2.0',
      marketRulesVersion: '2.6.2-deterministic',
      marketFetchVersion: POUPAI_OFFICIAL_MARKET_FETCH_VERSION,
      aiTransport: 'none-deterministic-market',
      providerModel: null,
      searchTool: 'official_page_fetch',
      result: market,
      gate,
      sourcesConsulted,
      sourceFetch: {
        attempted: sourceFetch.attempted,
        fetched: sourceFetch.fetched,
        failed: sourceFetch.failures.length,
        failures: sourceFetch.failures,
      },
      metrics: {
        latencyMs: Date.now() - startedAt,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        acceptedOffers: market.offers.length,
        rejectedOffers: market.hardening?.rejectedOffers?.length || 0,
        rawOffers: raw.offers.length,
        officialDomainsAllowed: OFFICIAL_PROVIDER_DOMAINS_V23.length,
        officialPagesFetched: sourceFetch.fetched,
      },
      nextStep: gate.canRunFinalEngine
        ? 'RUN_FINAL_ENGINE'
        : gate.canRunPreliminaryEngine
          ? 'RUN_PRELIMINARY_ENGINE_AND_CONFIRM_ADDRESS'
          : 'ANALYSIS_INCONCLUSIVE',
    });
  } catch (error) {
    return json(res, 502, {
      error: error?.name === 'AbortError' ? 'MARKET_TIMEOUT' : 'MARKET_FAILED',
      message: String(error?.message || 'Falha ao pesquisar ofertas de internet.').slice(0, 300),
      metrics: { latencyMs: Date.now() - startedAt },
    });
  }
}
