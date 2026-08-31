import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const integrationUrl = new URL('../../public/poupai-v4-full/integration-v25.txt', import.meta.url);
const loaderUrl = new URL('../../public/poupai-v4-full/index.html', import.meta.url);
const js = readFileSync(integrationUrl, 'utf8');
const loader = readFileSync(loaderUrl, 'utf8');

assert.doesNotThrow(() => new Function(js), 'integration-v25.txt precisa ser JavaScript válido');
for (const endpoint of ['/api/read-bill', '/api/find-offers', '/api/check-availability', '/api/run-pipeline']) {
  assert.ok(js.includes(endpoint), `frontend deve chamar ${endpoint}`);
}
assert.ok(loader.includes('integration-v25.txt'), 'loader da V4 deve injetar a integração V2.5');
assert.ok(js.includes('htmlpreview.github.io'), 'frontend deve bloquear análise real no HTMLPreview estático');
assert.ok(js.includes('Ver oferta oficial'), 'resultado deve exibir link oficial das ofertas');
assert.ok(js.includes('houseNumber'), 'interface deve permitir número do imóvel para confirmação de cobertura');

console.log(JSON.stringify({ status: 'PASS', scriptBytes: Buffer.byteLength(js), endpoints: 4, loaderIntegrated: true }, null, 2));
