(function (root) {
  'use strict';

  const SAMPLE_RATE = 44100;
  const SEGMENT = Math.round(7.8 * SAMPLE_RATE);
  const OVERLAP = Math.floor(SEGMENT / 4);
  const STRIDE = SEGMENT - OVERLAP;
  const STEM_GUITAR = 4;
  // Fixar o commit evita que o mesmo cache URL passe a entregar outro modelo.
  const MODEL_URL = 'https://huggingface.co/StemSplitio/htdemucs-6s-onnx/resolve/49df9b6989cf2150840ea65b0bef77a2e471b678/htdemucs_6s_fp16weights.onnx';
  const ORT_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.min.mjs';
  const ORT_WEBGPU_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.webgpu.min.mjs';
  const ORT_WEBGL_URL = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.webgl.min.mjs';
  const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
  const ESTIMATED_PEAK_RAM_MB = 1100;
  const MODEL_CACHE = 'autopreset-local-model-v2';
  let runtimePromise = null;
  let sessionPromise = null;

  function checkAbort(signal) {
    if (signal?.aborted) throw new DOMException('Análise cancelada.', 'AbortError');
  }

  async function hasWebGPU() {
    try { return !!(root.navigator?.gpu && await root.navigator.gpu.requestAdapter()); }
    catch { return false; }
  }

  function hasWebGL() {
    try {
      const canvas = root.document?.createElement('canvas');
      return !!(canvas && (canvas.getContext('webgl2') || canvas.getContext('webgl')));
    } catch { return false; }
  }

  async function loadOrt(provider) {
    const url = provider === 'webgpu' ? ORT_WEBGPU_URL : provider === 'webgl' ? ORT_WEBGL_URL : ORT_URL;
    const ort = await import(url);
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
    // GitHub Pages não envia COOP/COEP. Um worker WASM multithread pode falhar
    // em alguns WebViews Android, portanto o fallback permanece single-thread.
    ort.env.wasm.numThreads = 1;
    return ort;
  }

  function executionProviders(useWebGPU) {
    return useWebGPU ? ['webgpu', 'wasm'] : ['wasm'];
  }

  function describeError(error) {
    if (typeof error === 'string' && error.trim()) return error;
    if (error && typeof error.message === 'string' && error.message.trim()) return error.message;
    if (error && typeof error.toString === 'function') {
      const rendered = String(error);
      if (rendered && rendered !== '[object Object]') return rendered;
    }
    try {
      const json = JSON.stringify(error);
      if (json && json !== '{}' && json !== 'null') return json;
    } catch { /* error may contain circular references */ }
    return 'erro interno do runtime de áudio sem detalhes';
  }

  function candidateProviders(hasGpu, hasGl) {
    const candidates = [];
    if (hasGpu) candidates.push('webgpu');
    if (hasGl) candidates.push('webgl');
    candidates.push('wasm');
    return [...new Set(candidates)];
  }

  async function getSession(onProgress) {
    if (!runtimePromise) runtimePromise = (async () => {
      const webgpu = await hasWebGPU();
      const webgl = hasWebGL();
      const failures = [];
      const providers = candidateProviders(webgpu, webgl);
      for (const provider of providers) {
        try {
          const ort = await loadOrt(provider);
          return { ort, provider, providers };
        } catch (error) {
          failures.push(provider + ': ' + describeError(error));
        }
      }
      throw new Error('Não foi possível carregar o runtime de áudio. Confira a conexão e tente novamente. ' + failures.join(' | '));
    })().catch(error => { runtimePromise = null; throw error; });
    const runtime = await runtimePromise;
    if (!sessionPromise) {
      onProgress?.('Baixando o modelo de guitarra (aprox. 136 MB, somente na primeira utilização)…');
      sessionPromise = loadModelBytes().then(async modelBytes => {
        const failures = [];
        const available = runtime.providers;
        for (const provider of available) {
          try {
            onProgress?.(provider === 'wasm'
              ? 'Preparando inferência por CPU; o modelo pode usar cerca de 1,1 GB de RAM…'
              : 'Preparando aceleração ' + provider.toUpperCase() + '…');
            const ort = provider === runtime.provider ? runtime.ort : await loadOrt(provider);
            const session = await ort.InferenceSession.create(modelBytes, {
              executionProviders: provider === 'webgpu' ? ['webgpu', 'wasm'] : provider === 'webgl' ? ['webgl', 'wasm'] : ['wasm'],
              graphOptimizationLevel: 'basic'
            });
            return { ort, session, provider: provider.toUpperCase() + (provider === 'wasm' ? '' : ' + WASM') };
          } catch (error) {
            failures.push(provider + ': ' + describeError(error));
          }
        }
        throw new Error('Não foi possível preparar o modelo no aparelho (pico estimado de RAM: ' + ESTIMATED_PEAK_RAM_MB + ' MB). ' + failures.join(' | '));
      }).catch(error => { sessionPromise = null; throw error; });
    }
    return await sessionPromise;
  }

  async function loadModelBytes() {
    let cache=null;
    try { if(root.caches) { cache=await root.caches.open(MODEL_CACHE); const saved=await cache.match(MODEL_URL); if(saved)return await saved.arrayBuffer(); } } catch { cache=null; }
    const response=await root.fetch(MODEL_URL,{mode:'cors'});
    if(!response.ok)throw new Error('Não foi possível baixar o modelo local de guitarra (HTTP '+response.status+'). Verifique a conexão e tente novamente.');
    const copy=response.clone();
    if(cache)cache.put(MODEL_URL,copy).catch(()=>{});
    return response.arrayBuffer();
  }

  async function decodeClip(file, startSeconds, endSeconds) {
    const AudioContextClass = root.AudioContext || root.webkitAudioContext;
    if (!AudioContextClass || !root.OfflineAudioContext) throw new Error('Este navegador não oferece os recursos de áudio necessários. Abra o AutoPreset no Chrome atualizado.');
    const decoder = new AudioContextClass();
    try {
      const decoded = await decoder.decodeAudioData(await file.arrayBuffer());
      if (endSeconds > decoded.duration + 0.02) throw new Error('O fim do trecho ultrapassa a duração do áudio.');
      const length = Math.max(1, Math.ceil((endSeconds - startSeconds) * SAMPLE_RATE));
      const offline = new root.OfflineAudioContext(2, length, SAMPLE_RATE);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start(0, startSeconds, endSeconds - startSeconds);
      const rendered = await offline.startRendering();
      return [new Float32Array(rendered.getChannelData(0)), new Float32Array(rendered.getChannelData(1))];
    } finally {
      try { await decoder.close(); } catch { /* alguns WebViews já fecham o contexto */ }
    }
  }

  async function validateFile(file) {
    if (!(file instanceof Blob) || file.size === 0) throw new Error('Escolha um arquivo de áudio no celular.');
    if (file.size > MAX_AUDIO_BYTES) throw new Error('O áudio tem ' + (file.size / 1024 / 1024).toFixed(1) + ' MiB; o limite é 25 MiB.');
    const name = String(file.name || '').toLowerCase();
    if (!name.endsWith('.mp3') && !name.endsWith('.wav')) throw new Error('Formato não aceito. Selecione um arquivo .mp3 ou .wav salvo no aparelho.');
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const ascii = (start, end) => String.fromCharCode(...header.subarray(start, end));
    const isWav = header.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE';
    const isMp3 = header.length >= 3 && (ascii(0, 3) === 'ID3' || (header[0] === 255 && (header[1] & 224) === 224));
    if (!(name.endsWith('.wav') && isWav) && !(name.endsWith('.mp3') && isMp3)) throw new Error('O conteúdo do arquivo não parece ser um MP3/WAV válido. Tente baixar o áudio novamente.');
    return { name: file.name || 'audio', size: file.size, type: isWav ? 'audio/wav' : 'audio/mpeg' };
  }

  function transitionWindow() {
    const values = new Float32Array(SEGMENT).fill(1);
    for (let i = 0; i < OVERLAP; i++) {
      const fade = i / OVERLAP;
      values[i] = fade;
      values[SEGMENT - 1 - i] = fade;
    }
    return values;
  }

  async function separateGuitar(mix, ort, session, { signal, onProgress } = {}) {
    const total = mix[0].length;
    const chunks = Math.ceil(total / STRIDE);
    const output = [new Float32Array(total), new Float32Array(total)];
    const weights = new Float32Array(total);
    const window = transitionWindow();
    const chunkBuffer = new Float32Array(2 * SEGMENT);

    for (let chunk = 0; chunk < chunks; chunk++) {
      checkAbort(signal);
      const start = chunk * STRIDE;
      const end = Math.min(start + SEGMENT, total);
      const count = end - start;
      chunkBuffer.fill(0);
      chunkBuffer.subarray(0, count).set(mix[0].subarray(start, end));
      chunkBuffer.subarray(SEGMENT, SEGMENT + count).set(mix[1].subarray(start, end));
      let result;
      try { result = await session.run({ mix: new ort.Tensor('float32', chunkBuffer, [1, 2, SEGMENT]) }); }
      catch (error) {
        throw new Error('Falha na inferência local, trecho ' + (chunk + 1) + '/' + chunks + ': ' + describeError(error));
      }
      const stems = result.stems?.data;
      if (!(stems instanceof Float32Array) || stems.length < 6 * 2 * SEGMENT) throw new Error('O modelo local retornou uma estrutura de faixas inesperada.');
      const rowOffset = STEM_GUITAR * 2 * SEGMENT;
      for (let channel = 0; channel < 2; channel++) {
        const offset = rowOffset + channel * SEGMENT;
        for (let sample = 0; sample < count; sample++) output[channel][start + sample] += stems[offset + sample] * window[sample];
      }
      for (let sample = 0; sample < count; sample++) weights[start + sample] += window[sample];
      onProgress?.(`Separando guitarra no aparelho: trecho ${chunk + 1} de ${chunks}…`);
    }
    for (let channel = 0; channel < 2; channel++) for (let i = 0; i < total; i++) output[channel][i] /= Math.max(weights[i], 1e-8);
    checkAbort(signal);
    return output;
  }

  function fftMagnitudes(frame) {
    const n = frame.length;
    const real = Float64Array.from(frame);
    const imag = new Float64Array(n);
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { [real[i], real[j]] = [real[j], real[i]]; [imag[i], imag[j]] = [imag[j], imag[i]]; }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const angle = -2 * Math.PI / size;
      const stepReal = Math.cos(angle), stepImag = Math.sin(angle);
      for (let start = 0; start < n; start += size) {
        let wr = 1, wi = 0;
        for (let offset = 0; offset < size / 2; offset++) {
          const even = start + offset, odd = even + size / 2;
          const tr = wr * real[odd] - wi * imag[odd], ti = wr * imag[odd] + wi * real[odd];
          real[odd] = real[even] - tr; imag[odd] = imag[even] - ti;
          real[even] += tr; imag[even] += ti;
          const nextWr = wr * stepReal - wi * stepImag;
          wi = wr * stepImag + wi * stepReal; wr = nextWr;
        }
      }
    }
    return { real, imag };
  }

  function analyzeFeatures(channels) {
    const length = Math.min(channels[0].length, channels[1].length);
    const frameSize = 2048;
    const hop = 11025;
    let sumSquares = 0, crossings = 0, centroidSum = 0, rolloffSum = 0, frames = 0;
    const mono = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      mono[i] = (channels[0][i] + channels[1][i]) * 0.5;
      sumSquares += mono[i] * mono[i];
      if (i && (mono[i] >= 0) !== (mono[i - 1] >= 0)) crossings++;
    }
    for (let start = 0; start + frameSize <= length; start += hop) {
      const frame = new Float32Array(frameSize);
      for (let i = 0; i < frameSize; i++) frame[i] = mono[start + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (frameSize - 1)));
      const { real, imag } = fftMagnitudes(frame);
      let totalEnergy = 0, weighted = 0;
      const mags = new Float64Array(frameSize / 2);
      for (let bin = 1; bin < mags.length; bin++) {
        const magnitude = Math.hypot(real[bin], imag[bin]);
        mags[bin] = magnitude; totalEnergy += magnitude; weighted += magnitude * bin * SAMPLE_RATE / frameSize;
      }
      if (totalEnergy > 0) {
        let accumulated = 0, cutoff = 0;
        for (let bin = 1; bin < mags.length; bin++) { accumulated += mags[bin]; if (accumulated >= totalEnergy * 0.85) { cutoff = bin * SAMPLE_RATE / frameSize; break; } }
        centroidSum += weighted / totalEnergy; rolloffSum += cutoff; frames++;
      }
    }
    const rms = Math.sqrt(sumSquares / Math.max(1, length));
    return {
      sample_rate: SAMPLE_RATE,
      duration_seconds: length / SAMPLE_RATE,
      rms: Number(rms.toFixed(6)),
      rms_db: Number((20 * Math.log10(Math.max(rms, 1e-8))).toFixed(2)),
      zero_crossing_rate: Number((crossings / Math.max(1, length - 1)).toFixed(5)),
      spectral_centroid_hz: Number((centroidSum / Math.max(1, frames)).toFixed(1)),
      spectral_rolloff_85_hz: Number((rolloffSum / Math.max(1, frames)).toFixed(1)),
      feature_version: 1
    };
  }

  // Uma primeira aproximação tonal, não reconhecimento de artista ou de equipamento.
  function toneHints(features) {
    const centroid = Number(features?.spectral_centroid_hz);
    const rolloff = Number(features?.spectral_rolloff_85_hz);
    if (!Number.isFinite(centroid) || !Number.isFinite(rolloff)) throw new Error('O áudio não gerou medições suficientes para sugerir controles.');
    const brightness = Math.max(0, Math.min(1, (centroid * 0.7 + rolloff * 0.3) / 8000));
    return {
      bass: Math.round(58 - brightness * 14),
      middle: 55,
      treble: Math.round(38 + brightness * 24),
      brightness: Number(brightness.toFixed(2))
    };
  }

  function toWav(channels) {
    const length = Math.min(channels[0].length, channels[1].length), bytes = new ArrayBuffer(44 + length * 4), view = new DataView(bytes);
    const write = (offset, text) => { for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); };
    write(0, 'RIFF'); view.setUint32(4, 36 + length * 4, true); write(8, 'WAVE'); write(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
    view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 4, true); view.setUint16(32, 4, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, length * 4, true);
    let offset = 44;
    for (let i = 0; i < length; i++) for (let channel = 0; channel < 2; channel++) {
      const sample = Math.max(-1, Math.min(1, channels[channel][i]));
      view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true); offset += 2;
    }
    return new Blob([bytes], { type: 'audio/wav' });
  }

  async function separate({ file, startSeconds, endSeconds, signal, onProgress }) {
    await validateFile(file);
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds || endSeconds - startSeconds > 45) throw new Error('Escolha um trecho de até 45 segundos.');
    checkAbort(signal);
    onProgress?.('Lendo o áudio neste aparelho…');
    const mix = await decodeClip(file, startSeconds, endSeconds);
    checkAbort(signal);
    const { ort, session, provider } = await getSession(onProgress);
    let guitar;
    try { guitar = await separateGuitar(mix, ort, session, { signal, onProgress }); }
    catch (error) {
      const detail = describeError(error);
      if (/Aborted\(|out of memory|memory access out of bounds|allocation failed|sem detalhes do runtime/i.test(detail)) {
        throw new Error('O navegador não conseguiu reservar memória para a separação local (o modelo pode exigir cerca de 1,1 GB de RAM). Feche outros apps, use Chrome atualizado com aceleração gráfica ou tente em um aparelho com mais memória. ' + detail);
      }
      throw error;
    }
    const features = analyzeFeatures(guitar);
    if (features.rms_db < -70) throw new Error('A faixa de guitarra saiu quase silenciosa. Confira o arquivo e tente outro trecho com a guitarra mais presente.');
    return { blob: toWav(guitar), features, model: 'HT-Demucs 6-stem · execução local (' + provider + ')' };
  }

  root.AutoPresetLocalAudio = Object.freeze({ separate, separateGuitar, analyzeFeatures, toneHints, toWav, transitionWindow, loadModelBytes, validateFile, hasWebGPU, hasWebGL, candidateProviders, describeError, executionProviders, MODEL_URL, ORT_URL, ORT_WEBGPU_URL, ORT_WEBGL_URL, MAX_AUDIO_BYTES, ESTIMATED_PEAK_RAM_MB, SAMPLE_RATE, SEGMENT, OVERLAP, STRIDE, STEM_GUITAR });
})(typeof window !== 'undefined' ? window : globalThis);
