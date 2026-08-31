export const POUPAI_OFFICIAL_MARKET_PARSER_VERSION = '2.6.4';

function compactText(value, max = 280) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : null;
}

function moneyFromParts(integerPart, centsPart) {
  const integer = String(integerPart || '').replace(/\./g, '');
  const raw = centsPart == null ? integer : `${integer}.${String(centsPart).replace(/\s/g, '')}`;
  const n = Number(raw);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

function speedToMbps(value, unit) {
  const n = Number(String(value || '').replace(',', '.'));
  if (!(n > 0)) return null;
  const mbps = /giga|gbps/i.test(String(unit || '')) ? n * 1000 : n;
  if (mbps < 50 || mbps > 10000) return null;
  return Math.round(mbps);
}

function fixedInternetContext(text) {
  const t = String(text || '').toLowerCase();
  const fixed = /fibra|ftth|internet\s+(?:residencial|para\s+casa|banda\s+larga)|wi-?fi|roteador|download|upload|mega/.test(t);
  const mobile = /\bcelular\b|\bm[oó]vel\b|\bchip\b|franquia\s+de\s+dados|linha\s+m[oó]vel|p[oó]s-pago|controle/.test(t);
  return fixed || !mobile;
}

function isBonusComponent(fullText, globalIndex) {
  const start = Math.max(0, globalIndex - 120);
  const end = Math.min(fullText.length, globalIndex + 160);
  const local = fullText.slice(start, end);
  if (!/b[oô]nus/i.test(local) || !/\+/.test(local)) return false;
  const currentLocalIndex = globalIndex - start;
  const matches = [...local.matchAll(/\b\d+(?:[.,]\d+)?\s*(?:mega|mbps|giga|gbps)\b/gi)];
  if (matches.length < 2) return false;
  const firstIndex = matches[0]?.index ?? currentLocalIndex;
  return currentLocalIndex > firstIndex + 8;
}

function collectNearbyPrices(context, speedLocalIndex) {
  const out = [];
  const regex = /R\$\s*(\d{1,4}(?:\.\d{3})?)\s*(?:[.,]\s*(\d{2}))?/gi;
  let match;
  while ((match = regex.exec(context))) {
    const value = moneyFromParts(match[1], match[2]);
    if (!(value >= 20 && value <= 1000)) continue;
    const distance = Math.abs(match.index - speedLocalIndex);
    if (distance > 420) continue;
    const left = context.slice(Math.max(0, match.index - 80), match.index).toLowerCase();
    const right = context.slice(match.index, Math.min(context.length, match.index + 110)).toLowerCase();
    let score = 500 - distance;
    if (/\bpor\s*(?:apenas\s*)?$/.test(left.trim())) score += 250;
    if (/mensal|m[eê]s|\/m[eê]s|por\s+m[eê]s|mensalidade/.test(left + right)) score += 110;
    if (/\bde\s*$/.test(left.trim())) score -= 180;
    if (/no\s+cart[aã]o|cart[aã]o\s+de\s+cr[eé]dito|pix/.test(right)) score -= 45;
    if (/instala[cç][aã]o|taxa|ades[aã]o|equipamento|modem|roteador/.test(left)) score -= 220;
    if (/economize|desconto\s+de|cashback/.test(left)) score -= 160;
    out.push({ value, index: match.index, score, raw: match[0] });
  }
  return out.sort((a, b) => b.score - a.score || a.value - b.value);
}

function explicitPromo(context, currentPriceIndex, currentPrice) {
  const tail = context.slice(Math.max(0, currentPriceIndex - 20), Math.min(context.length, currentPriceIndex + 330));
  const patterns = [
    /no\s+(\d{1,2})[ºo]?\s*m[eê]s[^R$]{0,120}R\$\s*(\d{1,4}(?:\.\d{3})?)\s*(?:[.,]\s*(\d{2}))?/i,
    /a\s+partir\s+do\s+(\d{1,2})[ºo]?\s*m[eê]s[^R$]{0,120}R\$\s*(\d{1,4}(?:\.\d{3})?)\s*(?:[.,]\s*(\d{2}))?/i,
    /ap[oó]s\s+(?:o\s+)?(\d{1,2})[ºo]?\s*m[eê]s[^R$]{0,120}R\$\s*(\d{1,4}(?:\.\d{3})?)\s*(?:[.,]\s*(\d{2}))?/i,
  ];
  for (const pattern of patterns) {
    const match = tail.match(pattern);
    if (!match) continue;
    const month = Number(match[1]);
    const after = moneyFromParts(match[2], match[3]);
    if (month > 1 && after >= 20 && after <= 1000) {
      return {
        promotionalMonths: month - 1,
        priceAfterPromo: after,
        termsEvidence: compactText(match[0], 220),
      };
    }
  }
  return { promotionalMonths: 0, priceAfterPromo: currentPrice, termsEvidence: null };
}

function contractMonths(context) {
  const match = String(context || '').match(/(?:fidelidade|perman[eê]ncia)[^\d]{0,45}(\d{1,2})\s*meses/i);
  return match ? Number(match[1]) : null;
}

function benefits(context) {
  const result = [];
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
  for (const [pattern, label] of checks) if (pattern.test(context)) result.push(label);
  return result.slice(0, 8);
}

function evidence(context, speedLocalIndex, priceIndex) {
  const left = Math.max(0, Math.min(speedLocalIndex, priceIndex) - 90);
  const right = Math.min(context.length, Math.max(speedLocalIndex, priceIndex) + 150);
  return compactText(context.slice(left, right), 300);
}

function extractFromPage(page) {
  const text = String(page?.text || '');
  const offers = [];
  const speedRegex = /\b(\d+(?:[.,]\d+)?)\s*(mega|mbps|giga|gbps)\b/gi;
  let match;

  while ((match = speedRegex.exec(text))) {
    const speedMbps = speedToMbps(match[1], match[2]);
    if (!speedMbps || isBonusComponent(text, match.index)) continue;

    const start = Math.max(0, match.index - 430);
    const end = Math.min(text.length, match.index + 620);
    const context = text.slice(start, end);
    const speedLocalIndex = match.index - start;
    if (!fixedInternetContext(context)) continue;

    const candidates = collectNearbyPrices(context, speedLocalIndex);
    if (!candidates.length) continue;
    const price = candidates[0];
    const priceEvidence = evidence(context, speedLocalIndex, price.index);
    if (!priceEvidence || !/R\$/.test(priceEvidence)) continue;

    const promo = explicitPromo(context, price.index, price.value);
    const technology = /ftth/i.test(context) ? 'FTTH Fibra' : /fibra/i.test(context) ? 'Fibra' : null;
    const speedLabel = speedMbps >= 1000 && speedMbps % 1000 === 0 ? `${speedMbps / 1000} Giga` : `${speedMbps} Mega`;

    offers.push({
      provider: page.provider,
      planName: `${page.provider} ${speedLabel}`,
      speedMbps,
      technology,
      priceMonthly: price.value,
      promotionalMonths: promo.promotionalMonths,
      priceAfterPromo: promo.priceAfterPromo,
      installationFee: null,
      equipmentFeeMonthly: null,
      contractMonths: contractMonths(context),
      benefits: benefits(context),
      sourceUrl: page.sourceUrl,
      sourceTitle: `${page.provider} — página oficial de internet residencial`,
      priceEvidence,
      termsEvidence: promo.termsEvidence,
      availabilityScope: 'national_or_unknown',
      availabilityReference: null,
      availabilityEvidence: null,
      confidence: technology ? 0.98 : 0.94,
    });
  }

  const bySpeed = new Map();
  for (const offer of offers) {
    const key = `${offer.provider}|${offer.speedMbps}`;
    const existing = bySpeed.get(key);
    if (!existing || offer.priceMonthly < existing.priceMonthly || (offer.priceMonthly === existing.priceMonthly && offer.confidence > existing.confidence)) {
      bySpeed.set(key, offer);
    }
  }
  return [...bySpeed.values()].slice(0, 8);
}

export function extractRawOffersFromOfficialPagesV264(fetchResult, location = {}) {
  const offers = [];
  const notes = [];
  for (const page of fetchResult?.pages || []) {
    const extracted = extractFromPage(page);
    offers.push(...extracted);
    notes.push(`${page.provider}: ${extracted.length} oferta(s) com velocidade e preço próximos na fonte oficial.`);
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
