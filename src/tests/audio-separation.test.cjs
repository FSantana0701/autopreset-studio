const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'integrations/audio-separation.js'), 'utf8');
const requests = [];
const context = vm.createContext({
  URL,
  Blob,
  FormData,
  Number,
  String,
  Error,
  Object,
  Promise,
  window: {
    fetch: async (url, options) => {
      requests.push({ url, options });
      return new Response(new Blob(['wav'], { type: 'audio/wav' }), {
        headers: { 'Content-Type': 'audio/wav', 'X-Audio-Separator': 'htdemucs_6s' }
      });
    }
  }
});
context.globalThis = context;
vm.runInContext(source, context, { filename: 'audio-separation.js' });

(async () => {
  const file = new Blob(['audio'], { type: 'audio/mpeg' });
  Object.defineProperty(file, 'name', { value: 'clip.mp3' });
  const result = await context.window.AutoPresetAudio.separate({
    serviceUrl: 'https://audio.example.test', apiKey: 'secret-for-test', file, startSeconds: 208, endSeconds: 238
  });
  assert.equal(result.model, 'htdemucs_6s');
  assert.equal(result.blob.size, 3);
  assert.equal(requests[0].url, 'https://audio.example.test/v1/separate');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer secret-for-test');
  assert.equal(requests[0].options.body.get('start_seconds'), '208');
  assert.equal(requests[0].options.body.get('end_seconds'), '238');

  assert.throws(
    () => context.window.AutoPresetAudio.endpointFor('http://audio.example.test'),
    /HTTPS/
  );
  assert.equal(context.window.AutoPresetAudio.endpointFor('http://localhost:8000'), 'http://localhost:8000/v1/separate');
  await assert.rejects(
    context.window.AutoPresetAudio.separate({ serviceUrl: 'https://audio.example.test', apiKey: 'secret-for-test', file, startSeconds: 0, endSeconds: 46 }),
    /45 segundos/
  );
  await assert.rejects(
    context.window.AutoPresetAudio.separate({ serviceUrl: 'https://audio.example.test', file, startSeconds: 0, endSeconds: 5 }),
    /chave de acesso/
  );
  console.log('Separação no navegador: HTTPS, intervalo e requisição multipart verificados.');
})().catch(error => { console.error(error); process.exitCode = 1; });
