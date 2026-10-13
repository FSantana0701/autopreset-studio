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
  Uint8Array,
  TextDecoder,
  atob,
  window: {
    atob,
    fetch: async (url, options) => {
      requests.push({ url, options });
      return new Response(new Blob(['wav'], { type: 'audio/wav' }), {
        headers: { 'Content-Type': 'audio/wav', 'X-Audio-Separator': 'htdemucs_6s', 'X-Audio-Features': 'eyJwaXRjaCI6NDQwfQ==' }
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
    serviceUrl: 'https://audio.example.test', file, startSeconds: 208, endSeconds: 238
  });
  assert.equal(result.model, 'htdemucs_6s');
  assert.equal(result.blob.size, 3);
  assert.equal(requests[0].url, 'https://audio.example.test/v1/separate');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers, undefined);
  assert.equal(result.features.pitch, 440);
  assert.equal(requests[0].options.body.get('start_seconds'), '208');
  assert.equal(requests[0].options.body.get('end_seconds'), '238');

  assert.throws(
    () => context.window.AutoPresetAudio.endpointFor('http://audio.example.test'),
    /HTTPS/
  );
  assert.equal(context.window.AutoPresetAudio.endpointFor('http://localhost:8000'), 'http://localhost:8000/v1/separate');
  await assert.rejects(
    context.window.AutoPresetAudio.separate({ serviceUrl: 'https://audio.example.test', file, startSeconds: 0, endSeconds: 46 }),
    /45 segundos/
  );
  await context.window.AutoPresetAudio.separate({ serviceUrl: 'https://audio.example.test', file, startSeconds: 0, endSeconds: 5 });
  assert.equal(requests[1].options.headers, undefined);
  console.log('Separação: endpoint seguro, limite, multipart e métricas sem chave no navegador verificados.');
})().catch(error => { console.error(error); process.exitCode = 1; });
