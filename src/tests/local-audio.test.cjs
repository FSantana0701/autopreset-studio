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
assert.deepEqual(Array.from(local.executionProviders(false)), ['wasm']);
assert.deepEqual(Array.from(local.executionProviders(true)), ['webgpu', 'wasm']);
assert.deepEqual(Array.from(local.candidateProviders(true, true)), ['webgpu', 'webgl', 'wasm']);
assert.deepEqual(Array.from(local.candidateProviders(false, true)), ['webgl', 'wasm']);
assert.deepEqual(Array.from(local.candidateProviders(false, false)), ['wasm']);
assert.equal(local.ESTIMATED_PEAK_RAM_MB, 1100);
assert.match(local.describeError({}), /sem detalhes/);
assert.equal(local.describeError({ message: 'aborted' }), 'aborted');

function namedBlob(bytes, name) {
  const file = new Blob([bytes]);
  Object.defineProperty(file, 'name', { value: name });
  return file;
}

(async () => {
  assert.equal(await local.hasWebGPU(), false, 'sem GPU web, usa o modo WASM compatível');
  context.navigator = { gpu: { requestAdapter: async () => ({}) } };
  assert.equal(await local.hasWebGPU(), true, 'detecta WebGPU antes de escolher o runtime');
  context.document = { createElement: () => ({ getContext: kind => kind === 'webgl2' ? {} : null }) };
  assert.equal(local.hasWebGL(), true, 'detecta WebGL como alternativa gráfica');
  context.document = { createElement: () => ({ getContext: () => null }) };
  assert.equal(local.hasWebGL(), false, 'não anuncia WebGL quando indisponível');
  const wavHeader = new Uint8Array(12);
  wavHeader.set([82, 73, 70, 70], 0); // RIFF
  wavHeader.set([87, 65, 86, 69], 8); // WAVE
  assert.equal((await local.validateFile(namedBlob(wavHeader, 'guitarra.wav'))).type, 'audio/wav');
  const mp3Header = new Uint8Array([73, 68, 51, 4, 0, 0]); // ID3
  assert.equal((await local.validateFile(namedBlob(mp3Header, 'referencia.mp3'))).type, 'audio/mpeg');
  await assert.rejects(local.validateFile(new Blob([])), /Escolha um arquivo/);
  await assert.rejects(local.validateFile(namedBlob(wavHeader, 'musica.m4a')), /Formato não aceito/);
  await assert.rejects(local.validateFile(namedBlob(new Uint8Array([1, 2, 3, 4]), 'falso.wav')), /não parece ser um MP3\/WAV válido/);

const samples = 512;
const tone = new Float32Array(samples);
for (let i = 0; i < samples; i++) tone[i] = Math.sin(2 * Math.PI * 440 * i / local.SAMPLE_RATE) * 0.4;
const features = local.analyzeFeatures([tone, tone]);
assert.equal(features.sample_rate, 44100);
assert.ok(features.rms_db > -14 && features.rms_db < -8, 'RMS detecta o nível do tom');
assert.ok(features.zero_crossing_rate > 0, 'mede cruzamentos por zero');
assert.equal(features.feature_version, 1);
const darkHints = local.toneHints({ spectral_centroid_hz: 800, spectral_rolloff_85_hz: 1800 });
const brightHints = local.toneHints({ spectral_centroid_hz: 4500, spectral_rolloff_85_hz: 9000 });
assert.ok(brightHints.treble > darkHints.treble, 'a sugestão local responde à mudança de brilho medida');
assert.ok(brightHints.bass < darkHints.bass, 'a sugestão reduz graves quando o espectro medido é mais brilhante');

const wav = local.toWav([new Float32Array([0, 0.5, -0.5]), new Float32Array([0, 0.5, -0.5])]);
assert.equal(wav.type, 'audio/wav');
assert.equal(wav.size, 56, 'WAV estéreo PCM inclui cabeçalho e amostras');

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
