import { fetchWithTimeout } from './hardening-v22.js';

export const POUPAI_OFFICIAL_MARKET_FETCH_VERSION = '2.6.1';

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

function priceFocusedExcerpt(text, maxChars = 14000) {
  const clean = String(text || '').trim();
  if (clean.length <= maxChars) return clean;

  const chunks = [clean.slice(0, 1800)];
  const patterns = [/R\$\s*\d/gi, /\b\d+(?:[.,]\d+)?\s*(?:mega|giga|gbps|mbps)\b/gi];
  const seen = [];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(clean)) && seen.length < 22) {
      if (!seen.some((x) => Math.abs(x - match.index) < 420)) seen.push(match.index);
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
  }, 8500);

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

function compactText(value, max = 280) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

function parseDecimal(raw) {
  const cleaned = String(raw || '').replace(/\./g, '').replace(',', '.').replace(/[^\d.]/g, '');
  const number = Number(cleaned);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : null;
}

function speedToMbps(value, unit) {
  const n = Number(String(value || '').replace(',', '.'));
  if (!(n > 0)) return null;
  const u = String(unit || '').toLowerCase();
  const mbps = /giga|gbps/.test(u) ? n * 1000 : n;
  if (mbps < 50 || mbps > 10000) return null;
  return Math.round(mbps);
}

function isLikelyFixedInternet(context) {
  const t = String(context || '').toLowerCase();
  const fixed = /fibra|ftth|internet\s+(?:residencial|para\s+casa|banda\s+larga)|wi-?fi|roteador|download|upload/.test(t);
  const mobile = /\bcelular\b|\bm[oó]vel\b|\bchip\b|franquia\s+de\s+dados|linha\s+m[oó]vel|p[oó]s-pago|controle/.test(t);
  return fixed || !mobile;
}

function collectPrices(context, speedLocalIndex) {
  const prices = [];
  const regex = /R\$\s*(\d{1,4}(?:\.\d{3})?)(?:[.,](\d{2}))?/gi;
  let match;
  while ((match = regex.exec(context))) {
    const whole = match[2] ? `${match[1]},${match[2]}` : match[1];
    const value = parseDecimal(whole);
    if (!(value >= 20 && value <= 1000)) continue;
    const left = context.slice(Math.max(0, match.index - 70), match.index).toLowerCase();
    const right = context.slice(match.index, Math.min(context.length, match.index + 100)).toLowerCase();
    let score = 300 - Math.min(300, Math.abs(match.index - speedLocalIndex));
    if (/\bpor\s*(?:apenas\s*)?$/.test(left.trim())) score += 180;
    if (/mensal|m[eê]s|\/m[eê]s|por\s+m[eê]s|mensalidade/.test(left + right)) score += 80;
    if (/instala[cç][aã]o|taxa|ades[aã]o|equipamento|modem|roteador/.test(left)) score -= 180;
    if (/economize|desconto\s+de|cashback/.test(left)) score -= 130;
    prices.push({ value, index: match.index, score, raw: match[0] });
  }
  return prices.sort((a, b) => b.score - a.score);
}

function findPromoTerms(context, currentPrice) {
  const text = String(context || '');
  const lower = text.toLowerCase();
  let promotionalMonths = 0;
  const explicitMonths = lower.match(/por\s+(\d{1,2})\s+meses/);
  if (explicitMonths) promotionalMonths = Number(explicitMonths[1]);
  const fromMonth = lower.match(/(?:a\s+partir\s+do|ap[oó]s\s+o?)\s*(\d{1,2})[ºo]?\s*m[eê]s/);
  if (!promotionalMonths && fromMonth) promotionalMonths = Math.max(0, Number(fromMonth[1]) - 1);
  const onMonth = lower.match(/(?:no|a\s+partir\s+do)\s*(\d{1,2})[ºo]?\s*m[eê]s/);
  if (!promotionalMonths && onMonth) promotionalMonths = Math.max(0, Number(onMonth[1]) - 1);

  const prices = collectPrices(text, Math.floor(text.length / 2))
    .map((p) => p.value)
    .filter((p) => p !== currentPrice);
  let priceAfterPromo = currentPrice;
  if (promotionalMonths > 0 && prices.length) {
    const higher = prices.filter((p) => p >= currentPrice).sort((a, b) => a - b);
    if (higher.length) priceAfterPromo = higher[0];
  }

  const contract = lower.match(/(?:fidelidade|perman[eê]ncia)[^\d]{0,40}(\d{1,2})\s*meses/);
  const contractMonths = contract ? Number(contract[1]) : null;

  const termsEvidence = promotionalMonths > 0 || contractMonths
    ? compactText(text, 260)
    : null;

  return { promotionalMonths, priceAfterPromo, contractMonths, termsEvidence };
}

function detectBenefits(context) {
  const benefits = [];
  const checks = [
    [/netflix/i, 'Netflix'],
    [/globoplay/i, 'Globoplay'],
    [/disney\+|disney plus/i, 'Disney+'],
    [/paramount\+/i, 'Paramount+'],
    [/youtube\s+premium/i, 'YouTube Premium'],
    [/hbo\s*max|\bmax\b/i, 'Max'],
    [/wi-?fi\s*6/i, 'Wi-Fi 6'],
    [/deezer/i, 'Deezer'],
  ];
  for (const [pattern, label] of checks) if (pattern.test(context)) benefits.push(label);
  return benefits.slice(0, 8);
}

function offerEvidence(context, speedLocalIndex, priceIndex) {
  const center = Math.round((speedLocalIndex + priceIndex) / 2);
  return compactText(context.slice(Math.max(0, center - 150), Math.min(context.length, center + 170)), 280);
}

function extractPageOffers(page) {
  const text = String(page?.text || '');
  const offers = [];
  const speedRegex = /\b(\d+(?:[.,]\d+)?)\s*(mega|mbps|giga|gbps)\b/gi;
  let speedMatch;

  while ((speedMatch = speedRegex.exec(text))) {
    const speedMbps = speedToMbps(speedMatch[1], speedMatch[2]);
    if (!speedMbps) continue;

    const start = Math.max(0, speedMatch.index - 650);
    const end = Math.min(text.length, speedMatch.index + 1050);
    const context = text.slice(start, end);
    const speedLocalIndex = speedMatch.index - start;
    if (!isLikelyFixedInternet(context)) continue;

    const prices = collectPrices(context, speedLocalIndex);
    if (!prices.length) continue;
    const chosen = prices[0];

    const terms = findPromoTerms(context, chosen.value);
    const technology = /ftth/i.test(context) ? 'FTTH Fibra' : /fibra/i.test(context) ? 'Fibra' : null;
    const benefits = detectBenefits(context);
    const confidence = technology ? 0.98 : 0.94;
    const speedLabel = speedMbps >= 1000 && speedMbps % 1000 === 0
      ? `${speedMbps / 1000} Giga`
      : `${speedMbps} Mega`;

    offers.push({
      provider: page.provider,
      planName: `${page.provider} ${speedLabel}`,
      speedMbps,
      technology,
      priceMonthly: chosen.value,
      promotionalMonths: terms.promotionalMonths,
      priceAfterPromo: terms.priceAfterPromo,
      installationFee: null,
      equipmentFeeMonthly: null,
      contractMonths: terms.contractMonths,
      benefits,
      sourceUrl: page.sourceUrl,
      sourceTitle: `${page.provider} — página oficial de internet residencial`,
      priceEvidence: offerEvidence(context, speedLocalIndex, chosen.index),
      termsEvidence: terms.termsEvidence,
      availabilityScope: 'national_or_unknown',
      availabilityReference: null,
      availabilityEvidence: null,
      confidence,
    });
  }

  const dedupe = new Map();
  for (const offer of offers) {
    const key = `${offer.provider}|${offer.speedMbps}|${offer.priceMonthly}|${offer.priceAfterPromo}`;
    const existing = dedupe.get(key);
    if (!existing || offer.confidence > existing.confidence) dedupe.set(key, offer);
  }
  return [...dedupe.values()].slice(0, 8);
}

export function extractRawOffersFromOfficialPagesV26(fetchResult, location = {}) {
  const offers = [];
  const notes = [];
  for (const page of fetchResult?.pages || []) {
    const pageOffers = extractPageOffers(page);
    offers.push(...pageOffers);
    notes.push(`${page.provider}: ${pageOffers.length} oferta(s) extraída(s) deterministicamente da página oficial.`);
  }

  return {
    searchedLocation: {
      cep: location.cep || null,
      city: location.city || null,
      state: location.state || null,
    },
    offers: offers.slice(0, 20),
    notes: notes.slice(0, 12),
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
