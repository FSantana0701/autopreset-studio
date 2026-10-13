const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const context = vm.createContext({ Blob, Float32Array, Float64Array, Uint8Array, ArrayBuffer, DataView, Math, Number, String, Object, Promise, Error, DOMException });
context.globalThis = context;
context.window = context;
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'integrations/local-audio.js'), 'utf8'), context);
const local = context.AutoPresetLocalAudio;

assert.equal(local.STEM_GUITAR, 4, 'faixa de guitarra é a quinta saída do modelo 6-stem');
assert.equal(local.SEGMENT, 343980, 'modelo recebe segmentos fixos de 7,8 s a 44,1 kHz');

const samples = 512;
const tone = new Float32Array(samples);
for (let i = 0; i < samples; i++) tone[i] = Math.sin(2 * Math.PI * 440 * i / local.SAMPLE_RATE) * 0.4;
const features = local.analyzeFeatures([tone, tone]);
assert.equal(features.sample_rate, 44100);
assert.ok(features.rms_db > -14 && features.rms_db < -8, 'RMS detecta o nível do tom');
assert.ok(features.zero_crossing_rate > 0, 'mede cruzamentos por zero');
assert.equal(features.feature_version, 1);

const wav = local.toWav([new Float32Array([0, 0.5, -0.5]), new Float32Array([0, 0.5, -0.5])]);
assert.equal(wav.type, 'audio/wav');
assert.equal(wav.size, 56, 'WAV estéreo PCM inclui cabeçalho e amostras');

(async () => {
  let calls = 0;
  const ort = { Tensor: function (type, data, dims) { this.type = type; this.data = data; this.dims = dims; } };
  const session = { run: async inputs => {
    calls++;
    assert.deepEqual(Array.from(inputs.mix.dims), [1, 2, local.SEGMENT]);
    const stems = new Float32Array(6 * 2 * local.SEGMENT);
    stems.fill(0.25, 4 * 2 * local.SEGMENT, 6 * 2 * local.SEGMENT);
    return { stems: { data: stems } };
  }};
  const mix = [new Float32Array(128).fill(0.1), new Float32Array(128).fill(-0.1)];
  const result = await local.separateGuitar(mix, ort, session);
  assert.equal(calls, 1);
  assert.ok(Math.abs(result[0][40] - 0.25) < 0.001, 'extrai a faixa guitar do modelo');
  assert.ok(Math.abs(result[1][40] - 0.25) < 0.001, 'mantém estéreo');
  await assert.rejects(local.separateGuitar(mix, ort, session, { signal: { aborted: true } }), { name: 'AbortError' });
  console.log('Áudio local: canal guitarra, formato de entrada do modelo, WAV, métricas e cancelamento verificados.');
})().catch(error => { console.error(error); process.exitCode = 1; });
