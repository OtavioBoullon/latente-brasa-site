import { fetchWithTimeout } from './hardening-v22.js';

export const POUPAI_OFFICIAL_MARKET_FETCH_VERSION = '2.6.0';

export const OFFICIAL_MARKET_PAGES_V26 = [
  { provider: 'Claro', url: 'https://www.claro.com.br/internet/banda-larga' },
  { provider: 'Vivo', url: 'https://vivo.com.br/para-voce/produtos-e-servicos/para-casa/internet' },
  { provider: 'TIM', url: 'https://internet.tim.com.br/internet-residencial' },
  { provider: 'Nio', url: 'https://www.niointernet.com.br/pra-voce/fibra/planos-de-internet/' },
  { provider: 'Desktop', url: 'https://www.desktop.com.br/internet/' },
  { provider: 'Unifique', url: 'https://unifique.com.br/para-voce/internet-fibra' },
  { provider: 'Brisanet', url: 'https://www.brisanet.com.br/ofertas-especiais/combo-televendas-cidadessolo-26/' },
];

function decodeEntities(text) {
  return String(text || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) && code > 0 && code < 65536 ? String.fromCharCode(code) : ' ';
    });
}

function htmlToText(html) {
  const withoutNoise = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li|section|article|h1|h2|h3|h4|h5|h6)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(withoutNoise)
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function priceFocusedExcerpt(text, maxChars = 12000) {
  const clean = String(text || '').trim();
  if (clean.length <= maxChars) return clean;

  const chunks = [clean.slice(0, 1800)];
  const patterns = [/R\$\s*\d/gi, /\b\d+(?:[.,]\d+)?\s*(?:mega|giga|gbps|mbps)\b/gi];
  const seen = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(clean)) && seen.length < 18) {
      if (!seen.some((x) => Math.abs(x - match.index) < 450)) seen.push(match.index);
    }
  }
  for (const index of seen.sort((a, b) => a - b)) {
    chunks.push(clean.slice(Math.max(0, index - 650), Math.min(clean.length, index + 950)));
  }

  return chunks.join('\n---\n').slice(0, maxChars);
}

async function fetchOne(source) {
  const response = await fetchWithTimeout(source.url, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; PoupaiMarket/2.6; +https://latente-brasa-site.vercel.app/)',
      'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
      'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.5',
      'Cache-Control': 'no-cache',
    },
  }, 9000);

  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType && !contentType.includes('text/') && !contentType.includes('html')) {
    throw new Error(`UNSUPPORTED_CONTENT_TYPE_${contentType.slice(0, 60)}`);
  }

  const html = await response.text();
  const text = priceFocusedExcerpt(htmlToText(html));
  if (text.length < 120) throw new Error('PAGE_TEXT_TOO_SHORT');

  return {
    provider: source.provider,
    sourceUrl: source.url,
    finalUrl: response.url || source.url,
    text,
    textChars: text.length,
  };
}

export async function fetchOfficialMarketPagesV26() {
  const settled = await Promise.allSettled(OFFICIAL_MARKET_PAGES_V26.map(fetchOne));
  const pages = [];
  const failures = [];

  settled.forEach((item, index) => {
    const source = OFFICIAL_MARKET_PAGES_V26[index];
    if (item.status === 'fulfilled') pages.push(item.value);
    else failures.push({
      provider: source.provider,
      sourceUrl: source.url,
      reason: String(item.reason?.message || item.reason || 'FETCH_FAILED').slice(0, 180),
    });
  });

  return {
    version: POUPAI_OFFICIAL_MARKET_FETCH_VERSION,
    pages,
    failures,
    attempted: OFFICIAL_MARKET_PAGES_V26.length,
    fetched: pages.length,
  };
}

export function buildOfficialMarketContextV26(fetchResult) {
  return (fetchResult?.pages || []).map((page, index) => [
    `### FONTE OFICIAL ${index + 1}`,
    `OPERADORA: ${page.provider}`,
    `SOURCE_URL: ${page.sourceUrl}`,
    'CONTEUDO_EXTRAIDO:',
    page.text,
  ].join('\n')).join('\n\n==============================\n\n');
}
