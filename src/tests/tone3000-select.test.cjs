const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '../integrations/tone3000-select.js'), 'utf8');
const context = vm.createContext({
  URL, URLSearchParams, TextEncoder, Uint8Array, Array, String, Object,
  encodeURIComponent, setTimeout, console
});
vm.runInContext(source, context);

const helpers = context.Tone3000Select;
const redirect = helpers.cleanRedirectUrl({ href: 'https://example.test/app/?code=secret#section' });
assert.equal(redirect, 'https://example.test/app/');

const auth = new URL(helpers.authorizationUrl('t3k_pub_demo', redirect, 'state', 'challenge'));
assert.equal(auth.origin, 'https://www.tone3000.com');
assert.equal(auth.searchParams.get('prompt'), 'select_tone');
assert.equal(auth.searchParams.get('format'), 'nam');
assert.equal(auth.searchParams.get('architecture'), '2');
assert.equal(auth.searchParams.get('gears'), 'amp_amp-cab');
assert.equal(auth.searchParams.get('preview'), 'true');
assert.equal(auth.searchParams.get('menubar'), 'true');
assert.equal(auth.searchParams.has('locale'), false, 'não anuncia idioma que a API não documenta');
assert.equal(auth.searchParams.get('response_type'), 'code');
assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
assert.equal(auth.searchParams.get('redirect_uri'), redirect);

assert.equal(helpers.modelIsA2({ architecture: 2 }), true);
assert.equal(helpers.modelIsA2({ architecture: 'A2' }), true);
assert.equal(helpers.modelIsA2({ architecture: 'A1' }), false);
assert.equal(helpers.modelIsA2({}), false, 'metadata ausente não pode ser presumida como A2');
assert.equal(helpers.modelIsA2({ architecture_version: '2' }), true, 'usa o campo oficial da API');
assert.equal(helpers.modelIsA2Lite({ architecture_version: '2', size: 'lite' }), true);
assert.equal(helpers.modelIsA2Lite({ architecture_version: 2, size: 'standard' }), false);
assert.equal(helpers.modelIsA2Lite({ architecture_version: 1, size: 'lite' }), false);
assert.equal(helpers.modelIsA2Lite({ architecture_version: 2 }), false, 'tamanho não confirmado não é compatível');
const usableModels = helpers.compatibleModels([
  { id: 1, architecture_version: '2', size: 'lite', model_url: 'https://example.test/1.nam' },
  { id: 2, architecture_version: '2', size: 'standard', model_url: 'https://example.test/2.nam' },
  { id: 3, architecture_version: '1', size: 'lite', model_url: 'https://example.test/3.nam' },
  { id: 4, architecture_version: '2', size: 'lite' },
  { id: 5, size: 'lite', model_url: 'https://example.test/5.nam' }
]);
assert.deepEqual(Array.from(usableModels, model => model.id), [1], 'apenas A2-Lite confirmado e baixável aparece');
assert.equal(helpers.gearType({ gear: 'amp-cab' }), 'amp-cab');
assert.equal(helpers.safeName('Mesa/Boogie: Clean A2.nam'), 'Mesa_Boogie_Clean_A2.nam');
assert.deepEqual(Array.from(helpers.rows({ data: [{ id: 1 }, { id: 2 }] }), x => x.id), [1, 2]);
assert.deepEqual(Array.from(helpers.rows({ data: { models: [{ id: 9 }] } }), x => x.id), [9]);
assert.match(helpers.summarizeTone({ title: 'Twin', user: { username: 'creator' }, license: 'CC BY' }), /Twin · @creator · Licença: CC BY/);
assert.match(helpers.summarizeTone({ title: 'Twin', user: { username: 'creator' }, license: { slug: 'cc-by' } }), /Licença: cc-by/);

console.log('TONE3000: OAuth oficial, filtros A2, créditos e download individual verificados.');
