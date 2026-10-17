const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
function inlineScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
}
function checkStartup(label, scripts) {
  assert.equal(scripts.length, 12, `${label}: deve carregar catálogos, referências, núcleo, configuração, integrações e aplicação`);
  const context = vm.createContext({ Uint8Array, ArrayBuffer, DataView, TextEncoder, TextDecoder, Set, Object, Number, URL, URLSearchParams });
  context.globalThis = context;
  context.window = context;
  vm.runInContext(scripts[0], context, { filename: `${label}/data-v73.js` });
  vm.runInContext(scripts[1], context, { filename: `${label}/parameters-v73.js` });
  vm.runInContext(scripts[2], context, { filename: `${label}/v75.js` });
  assert.ok(context.MK300V75);
  assert.ok(context.MK300V75Parameters);
  vm.runInContext(scripts[3], context, { filename: `${label}/core.js` });
  vm.runInContext(scripts[4], context, { filename: `${label}/tone3000-select.js` });
  vm.runInContext(scripts[5], context, { filename: `${label}/audio-heuristic-analyzer.js` });
  vm.runInContext(scripts[6], context);
  assert.ok(context.AutoPresetDSPLocal);
  vm.runInContext(scripts[7], context, { filename: `${label}/learning-store.js` });
  vm.runInContext(scripts[8], context, { filename: `${label}/john-petrucci-pack.js` });
  assert.ok(context.MK300V73, `${label}: catálogo disponível antes da aplicação`);
  assert.ok(context.MK300V73Parameters, `${label}: parâmetros v73 disponíveis antes da aplicação`);
  assert.ok(context.MK300Core, `${label}: núcleo disponível antes da aplicação`);
  assert.ok(context.AutoPresetAudioHeuristics, `${label}: métricas nativas disponíveis antes da aplicação`);
  assert.ok(context.AutoPresetLearning, `${label}: armazenamento de exemplos disponível antes da aplicação`);
  assert.equal(context.AutoPresetReferencePacks.johnPetrucci.presets.length, 4, `${label}: pack de referência disponível antes da aplicação`);
  vm.runInContext(scripts[9], context, { filename: `${label}/config.js` });
  new vm.Script(scripts[10], { filename: `${label}/app.js` });
  let startupError;
  try { vm.runInContext(scripts[11], context, { filename: `${label}/index-inline.js` }); } catch (error) { startupError = error; }
  assert.ok(startupError, `${label}: aplicação deve avançar até precisar de DOM real`);
  assert.notEqual(startupError.name, 'SyntaxError', `${label}: scripts não podem falhar por declaração global duplicada`);
  assert.doesNotMatch(startupError.message, /already been declared/, `${label}: catálogo não pode colidir com constantes da interface`);
}

const modularHtml = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
const modularScripts = [
  fs.readFileSync(path.join(projectRoot, 'data/v73.js'), 'utf8'),
  fs.readFileSync(path.join(projectRoot, 'data/v73-parameters.js'), 'utf8'),
  fs.readFileSync(path.join(projectRoot, 'data/v75.js'), 'utf8'),
  fs.readFileSync(path.join(projectRoot, 'core/mk300-preset-handler.js'), 'utf8'),
  fs.readFileSync(path.join(projectRoot, 'integrations/tone3000-select.js'), 'utf8'),
  fs.readFileSync(path.join(projectRoot, 'integrations/audio-heuristic-analyzer.js'), 'utf8'),
  fs.readFileSync(path.join(projectRoot, 'js/dsp_local.js'), 'utf8'),
  fs.readFileSync(path.join(projectRoot, 'integrations/learning-store.js'), 'utf8'),
  fs.readFileSync(path.join(projectRoot, 'data/john-petrucci-pack.js'), 'utf8'),
  fs.readFileSync(path.join(projectRoot, 'config.js'), 'utf8'),
  fs.readFileSync(path.join(projectRoot, 'js/app.js'), 'utf8'),
  ...inlineScripts(modularHtml)
];
checkStartup('modular', modularScripts);

const standalonePath = path.resolve(projectRoot, '..', 'index.html');
const standaloneHtml = fs.readFileSync(standalonePath, 'utf8');
assert.doesNotMatch(standaloneHtml, /<script\s+src=/i, 'Android: arquivo não pode depender de scripts externos');
checkStartup('autônomo', inlineScripts(standaloneHtml));
console.log('Inicialização JS: scripts modulares e autônomos sem colisões.');
