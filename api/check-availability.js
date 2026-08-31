import {
  POUPAI_CHECKERS_VERSION,
  PROVIDER_CHECKER_SPECS,
  applyAvailabilityChecksToMarket,
  providerPublicRequirements,
  strictAvailabilityGate,
  validateAvailabilityRequest,
} from '../engine/provider-checkers-v21.js';

export const config = { maxDuration: 45 };

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function safeMessage(error) {
  return String(error?.message || error || 'Falha no checker').replace(/\s+/g, ' ').slice(0, 240);
}

async function launchBrowser() {
  const [{ chromium: playwrightChromium }, chromiumPackage] = await Promise.all([
    import('playwright-core'),
    import('@sparticuz/chromium'),
  ]);
  const serverlessChromium = chromiumPackage.default || chromiumPackage;
  const executablePath = process.env.POUPAI_CHROMIUM_PATH || await serverlessChromium.executablePath();
  return playwrightChromium.launch({ args: serverlessChromium.args, executablePath, headless: true });
}

async function clickIfVisible(page, names) {
  for (const name of names) {
    try {
      const locator = page.getByRole('button', { name, exact: false }).first();
      if (await locator.isVisible({ timeout: 700 })) {
        await locator.click({ timeout: 1500 });
        return true;
      }
    } catch { /* tenta o próximo */ }
  }
  return false;
}

async function fillFirst(page, candidates, value) {
  for (const candidate of candidates) {
    for (const make of [
      () => page.getByLabel(candidate, { exact: false }).first(),
      () => page.getByPlaceholder(candidate, { exact: false }).first(),
    ]) {
      try {
        const locator = make();
        if (await locator.isVisible({ timeout: 500 })) {
          await locator.fill(String(value), { timeout: 2000 });
          return true;
        }
      } catch { /* tenta o próximo */ }
    }
  }
  return false;
}

async function pageText(page) {
  try {
    return (await page.locator('body').innerText({ timeout: 4000 })).replace(/\s+/g, ' ').slice(0, 50000);
  } catch { return ''; }
}

function excerpt(text, pattern, radius = 140) {
  const match = text.match(pattern);
  if (!match || match.index == null) return null;
  return text.slice(Math.max(0, match.index - radius), Math.min(text.length, match.index + match[0].length + radius));
}

function detectAvailabilitySignal(text, previousText = '') {
  const captchaPattern = /captcha|não sou um robô|nao sou um robo|recaptcha|verifique que você é humano/i;
  const contactPattern = /(?:telefone|celular).{0,60}(?:obrigat[oó]rio|necess[aá]rio)|informe seu telefone|digite seu telefone/i;
  const unavailablePattern = /n[aã]o (?:temos|possui|há|ha) cobertura|ainda n[aã]o atendemos|indispon[ií]vel (?:neste|para este|no) endere[cç]o|n[aã]o encontramos cobertura|servi[cç]o n[aã]o dispon[ií]vel/i;
  const availablePattern = /cobertura dispon[ií]vel|temos cobertura|dispon[ií]vel (?:neste|para este|no) endere[cç]o|ofertas? dispon[ií]ve(?:l|is) (?:para|em) (?:seu|este) endere[cç]o|selecione um plano dispon[ií]vel/i;

  if (captchaPattern.test(text)) return { status: 'CAPTCHA_REQUIRED', pattern: captchaPattern };
  if (unavailablePattern.test(text)) return { status: 'UNAVAILABLE', pattern: unavailablePattern };
  if (availablePattern.test(text)) {
    const wasAlreadyVisible = availablePattern.test(previousText);
    return { status: wasAlreadyVisible ? 'INDETERMINATE' : 'AVAILABLE', pattern: availablePattern, evidence: excerpt(text, availablePattern) };
  }
  if (contactPattern.test(text)) return { status: 'CONTACT_DATA_REQUIRED', pattern: contactPattern };
  return { status: 'INDETERMINATE', pattern: null };
}

async function preparePage(browser) {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    locale: 'pt-BR',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/149.0.0.0 Safari/537.36',
  });
  page.setDefaultTimeout(5000);
  return page;
}

async function checkClaro(browser, address) {
  const spec = PROVIDER_CHECKER_SPECS.claro;
  const page = await preparePage(browser);
  try {
    await page.goto(spec.coverageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await clickIfVisible(page, [/aceitar/i, /entendi/i, /continuar/i]);
    const before = await pageText(page);
    const cepOk = await fillFirst(page, [/cep/i, /00000-000/i], address.cep);
    const numberOk = await fillFirst(page, [/n[uú]mero/i, /resid[eê]ncia/i, /im[oó]vel/i], address.number);
    if (!cepOk || !numberOk) return { provider: 'Claro', status: 'CHECK_FAILED', sourceUrl: page.url(), exactAddressSubmitted: false, confidence: 0.2, diagnostic: 'Campos de CEP/número não foram localizados no fluxo atual da Claro.' };
    const clicked = await clickIfVisible(page, [/consultar cobertura/i, /ver cobertura/i, /continuar/i]);
    if (!clicked) return { provider: 'Claro', status: 'CHECK_FAILED', sourceUrl: page.url(), exactAddressSubmitted: false, confidence: 0.25, diagnostic: 'Botão de consulta não foi localizado.' };
    await page.waitForTimeout(3500);
    const after = await pageText(page);
    const signal = detectAvailabilitySignal(after, before);
    return {
      provider: 'Claro', status: signal.status, sourceUrl: page.url(), exactAddressSubmitted: true,
      exactAddressMatched: signal.status === 'AVAILABLE', availabilityConfirmed: signal.status === 'AVAILABLE',
      evidence: signal.evidence || (signal.pattern ? excerpt(after, signal.pattern) : null), pageSignal: signal.status,
      confidence: signal.status === 'AVAILABLE' ? 0.94 : signal.status === 'UNAVAILABLE' ? 0.92 : 0.55,
      diagnostic: signal.status === 'INDETERMINATE' ? 'A página oficial não exibiu um sinal inequívoco de cobertura após o envio.' : null,
    };
  } finally { await page.close(); }
}

async function checkTim(browser, address) {
  const spec = PROVIDER_CHECKER_SPECS.tim;
  const page = await preparePage(browser);
  try {
    await page.goto(spec.coverageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await clickIfVisible(page, [/aceitar/i, /entendi/i]);
    const before = await pageText(page);
    const cepOk = await fillFirst(page, [/cep/i, /00000-000/i], address.cep);
    const numberOk = await fillFirst(page, [/n[uú]mero/i, /rua\/im[oó]vel/i, /im[oó]vel/i], address.number);
    if (!cepOk) return { provider: 'TIM', status: 'CHECK_FAILED', sourceUrl: page.url(), exactAddressSubmitted: false, confidence: 0.2, diagnostic: 'Campo de CEP não localizado.' };
    if (!numberOk) {
      const current = await pageText(page);
      if (/telefone|celular/i.test(current)) return { provider: 'TIM', status: 'CONTACT_DATA_REQUIRED', sourceUrl: page.url(), exactAddressSubmitted: false, confidence: 0.8, diagnostic: 'O fluxo oficial atual exige telefone antes de concluir a consulta.' };
      return { provider: 'TIM', status: 'CHECK_FAILED', sourceUrl: page.url(), exactAddressSubmitted: false, confidence: 0.25, diagnostic: 'Campo de número não localizado.' };
    }
    const clicked = await clickIfVisible(page, [/enviar/i, /consultar/i, /ver cobertura/i, /continuar/i]);
    if (!clicked) return { provider: 'TIM', status: 'CHECK_FAILED', sourceUrl: page.url(), exactAddressSubmitted: false, confidence: 0.25, diagnostic: 'Botão de consulta não localizado.' };
    await page.waitForTimeout(3500);
    const after = await pageText(page);
    const signal = detectAvailabilitySignal(after, before);
    return {
      provider: 'TIM', status: signal.status, sourceUrl: page.url(), exactAddressSubmitted: true,
      exactAddressMatched: signal.status === 'AVAILABLE', availabilityConfirmed: signal.status === 'AVAILABLE',
      evidence: signal.evidence || (signal.pattern ? excerpt(after, signal.pattern) : null), pageSignal: signal.status,
      confidence: signal.status === 'AVAILABLE' ? 0.94 : signal.status === 'UNAVAILABLE' ? 0.92 : signal.status === 'CONTACT_DATA_REQUIRED' ? 0.85 : 0.55,
      diagnostic: signal.status === 'INDETERMINATE' ? 'A página oficial não exibiu um sinal inequívoco de cobertura após o envio.' : null,
    };
  } finally { await page.close(); }
}

async function checkVivo(browser, address, options) {
  const requirements = providerPublicRequirements('vivo', options);
  if (!requirements.canAutomateNow) return { provider: 'Vivo', status: requirements.status, sourceUrl: PROVIDER_CHECKER_SPECS.vivo.coverageUrl, exactAddressSubmitted: false, confidence: 0.95, diagnostic: requirements.message };

  const page = await preparePage(browser);
  try {
    await page.goto(PROVIDER_CHECKER_SPECS.vivo.coverageUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await clickIfVisible(page, [/aceitar/i, /entendi/i]);
    await clickIfVisible(page, [/consultar/i, /ver disponibilidade/i, /ver cobertura/i]);
    await page.waitForTimeout(1500);
    const before = await pageText(page);
    const firstName = options.contact?.firstName;
    const phone = String(options.contact?.phone || '').replace(/\D/g, '');
    const fields = {
      name: await fillFirst(page, [/nome/i], firstName),
      phone: await fillFirst(page, [/telefone/i, /celular/i], phone),
      cep: await fillFirst(page, [/cep/i, /00000-000/i], address.cep),
      number: await fillFirst(page, [/n[uú]mero/i, /resid[eê]ncia/i], address.number),
    };
    if (!Object.values(fields).every(Boolean)) return { provider: 'Vivo', status: 'CHECK_FAILED', sourceUrl: page.url(), exactAddressSubmitted: false, confidence: 0.25, diagnostic: 'O formulário atual da Vivo mudou ou não pôde ser preenchido com segurança.' };
    const clicked = await clickIfVisible(page, [/continuar/i, /consultar/i, /ver disponibilidade/i]);
    if (!clicked) return { provider: 'Vivo', status: 'CHECK_FAILED', sourceUrl: page.url(), exactAddressSubmitted: false, confidence: 0.25, diagnostic: 'Botão de continuidade não localizado.' };
    await page.waitForTimeout(3500);
    const after = await pageText(page);
    const signal = detectAvailabilitySignal(after, before);
    return {
      provider: 'Vivo', status: signal.status, sourceUrl: page.url(), exactAddressSubmitted: true,
      exactAddressMatched: signal.status === 'AVAILABLE', availabilityConfirmed: signal.status === 'AVAILABLE',
      evidence: signal.evidence || (signal.pattern ? excerpt(after, signal.pattern) : null), pageSignal: signal.status,
      confidence: signal.status === 'AVAILABLE' ? 0.94 : signal.status === 'UNAVAILABLE' ? 0.92 : 0.55,
      diagnostic: signal.status === 'INDETERMINATE' ? 'A página oficial não exibiu um sinal inequívoco de cobertura após o envio.' : null,
    };
  } finally { await page.close(); }
}

async function runProvider(browser, providerId, address, options) {
  try {
    if (providerId === 'claro') return strictAvailabilityGate(await checkClaro(browser, address));
    if (providerId === 'tim') return strictAvailabilityGate(await checkTim(browser, address));
    if (providerId === 'vivo') return strictAvailabilityGate(await checkVivo(browser, address, options));
    return strictAvailabilityGate({ provider: providerId, status: 'UNSUPPORTED_PROVIDER', confidence: 1 });
  } catch (error) {
    return strictAvailabilityGate({ provider: providerId, status: 'CHECK_FAILED', sourceUrl: PROVIDER_CHECKER_SPECS[providerId]?.coverageUrl, exactAddressSubmitted: false, confidence: 0.1, diagnostic: safeMessage(error) });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' });
  const validation = validateAvailabilityRequest(req.body || {});
  if (!validation.valid) return json(res, 400, { error: 'INVALID_ADDRESS', issues: validation.issues });

  const options = { consentToContactData: req.body?.consentToContactData === true, contact: req.body?.contact || null };
  const immediatelyBlocked = validation.providers
    .map((providerId) => ({ providerId, requirement: providerPublicRequirements(providerId, options) }))
    .filter((x) => !x.requirement.canAutomateNow && x.providerId === 'vivo');

  let browser = null;
  try {
    const providersToRun = validation.providers.filter((id) => !immediatelyBlocked.some((x) => x.providerId === id));
    const results = immediatelyBlocked.map((x) => strictAvailabilityGate({
      provider: PROVIDER_CHECKER_SPECS[x.providerId].provider,
      status: x.requirement.status,
      sourceUrl: PROVIDER_CHECKER_SPECS[x.providerId].coverageUrl,
      exactAddressSubmitted: false,
      confidence: 0.95,
      diagnostic: x.requirement.message,
    }));

    if (providersToRun.length) {
      browser = await launchBrowser();
      for (const providerId of providersToRun) results.push(await runProvider(browser, providerId, validation.address, options));
    }

    const updatedMarket = req.body?.marketResult ? applyAvailabilityChecksToMarket(req.body.marketResult, results) : null;
    return json(res, 200, {
      checker: `Poupai Provider Checkers V${POUPAI_CHECKERS_VERSION}`,
      address: { cep: validation.address.cep, numberProvided: true },
      results,
      updatedMarket,
      privacy: {
        persisted: false,
        contactDataReturned: false,
        note: 'Nome/telefone, quando explicitamente autorizados para um fluxo que exija esses dados, são usados apenas durante a consulta e não são devolvidos na resposta.',
      },
    });
  } catch (error) {
    return json(res, 502, { error: 'CHECKER_RUNTIME_FAILED', message: safeMessage(error) });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}
