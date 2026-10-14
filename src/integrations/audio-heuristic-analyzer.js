/* Native Web Audio measurements of the full mix. No separation, models or network. */
(function (root) {
  'use strict';
  const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
  const MAX_CLIP_SECONDS = 45;
  const MAX_DECODE_SECONDS = 300;

  function describeError(error) {
    return typeof error === 'string' ? error : error?.message || 'Erro de áudio sem detalhes.';
  }
  function checkAbort(signal) {
    if (signal?.aborted) throw new DOMException('Análise cancelada.', 'AbortError');
  }
  function abortable(promise, signal) {
    checkAbort(signal);
    if (!signal) return promise;
    return new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException('Análise cancelada.', 'AbortError'));
      signal.addEventListener('abort', abort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }
  async function validateFile(file) {
    if (!(file instanceof Blob) || !file.size) throw new Error('Escolha um arquivo de áudio no celular.');
    if (file.size > MAX_AUDIO_BYTES) throw new Error('O limite do áudio é 25 MiB.');
    const name = String(file.name || '').toLowerCase();
    if (!/\.(mp3|wav)$/.test(name)) throw new Error('Formato não aceito. Selecione um arquivo .mp3 ou .wav salvo no aparelho.');
    const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
    const ascii = (a, b) => String.fromCharCode(...header.subarray(a, b));
    const wav = header.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE';
    const mp3 = header.length >= 3 && (ascii(0, 3) === 'ID3' || header[0] === 255 && (header[1] & 224) === 224);
    if (!(name.endsWith('.wav') && wav) && !(name.endsWith('.mp3') && mp3)) throw new Error('O conteúdo do arquivo não parece ser um MP3/WAV válido.');
    return { name: file.name, size: file.size, type: wav ? 'audio/wav' : 'audio/mpeg' };
  }

  function measure(buffer, startSeconds = 0, endSeconds = buffer.duration) {
    const rate = buffer.sampleRate;
    const start = Math.floor(startSeconds * rate);
    const end = Math.min(buffer.length, Math.ceil(endSeconds * rate));
    if (!Number.isFinite(rate) || rate <= 0 || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || endSeconds > buffer.duration + 0.02) throw new Error('Trecho de áudio inválido.');
    let squares = 0, peak = 0, crossings = 0;
    // Scan existing channel views; do not copy/average the mix into another AudioBuffer.
    // Opposite-phase stereo channels must not cancel the measurements.
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const samples = buffer.getChannelData(c);
      for (let i = start; i < end; i++) {
        const value = samples[i];
        if (!Number.isFinite(value)) throw new Error('O áudio contém amostras inválidas.');
        squares += value * value; peak = Math.max(peak, Math.abs(value));
        if (i > start && (value >= 0) !== (samples[i - 1] >= 0)) crossings++;
      }
    }
    const count = (end - start) * buffer.numberOfChannels;
    const rms = Math.sqrt(squares / count);
    const crest = rms ? peak / rms : 0;
    return {
      sample_rate: rate, duration_seconds: (end - start) / rate,
      rms, rms_db: 20 * Math.log10(Math.max(rms, 1e-8)), peak,
      zero_crossing_rate: crossings / Math.max(1, (end - start - 1) * buffer.numberOfChannels),
      crest_factor: crest, crest_factor_db: crest ? 20 * Math.log10(crest) : 0,
      audio_source: 'full_mix', feature_version: 2
    };
  }

  function toneHints(features) {
    if (!Number.isFinite(features?.zero_crossing_rate) || !Number.isFinite(features?.rms) || !Number.isFinite(features?.crest_factor_db)) throw new Error('Medições de áudio inválidas.');
    if (features.rms < 1e-5) throw new Error('O trecho está silencioso; escolha outro intervalo.');
    const brightness = Math.max(0, Math.min(1, features.zero_crossing_rate * 10));
    return { bass: Math.round(58 - brightness * 14), middle: 55, treble: Math.round(38 + brightness * 24), brightness };
  }

  function clipWav(buffer, startSeconds, endSeconds) {
    const start = Math.floor(startSeconds * buffer.sampleRate);
    const length = Math.min(buffer.length, Math.ceil(endSeconds * buffer.sampleRate)) - start;
    const channels = Math.min(2, buffer.numberOfChannels), stride = channels * 2;
    const bytes = new ArrayBuffer(44 + length * stride), view = new DataView(bytes);
    const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
    text(0, 'RIFF');view.setUint32(4, bytes.byteLength - 8, true);text(8, 'WAVE');text(12, 'fmt ');
    view.setUint32(16, 16, true);view.setUint16(20, 1, true);view.setUint16(22, channels, true);
    view.setUint32(24, buffer.sampleRate, true);view.setUint32(28, buffer.sampleRate * stride, true);
    view.setUint16(32, stride, true);view.setUint16(34, 16, true);text(36, 'data');view.setUint32(40, length * stride, true);
    for (let c = 0; c < channels; c++) {
      const samples = buffer.getChannelData(c);
      for (let i = 0; i < length; i++) {
        const value = Math.max(-1, Math.min(1, samples[start + i]));
        view.setInt16(44 + i * stride + c * 2, Math.round(value * (value < 0 ? 32768 : 32767)), true);
      }
    }
    return new Blob([bytes], { type: 'audio/wav' });
  }

  async function analyze({ file, startSeconds, endSeconds, durationSeconds, signal, onProgress }) {
    checkAbort(signal);
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds || endSeconds - startSeconds > MAX_CLIP_SECONDS) throw new Error('Escolha um trecho de até 45 segundos.');
    // Web Audio decodes compressed input as a whole; refuse long sources before allocating PCM.
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error('Aguarde a leitura da duração do arquivo.');
    if (durationSeconds > MAX_DECODE_SECONDS) throw new Error('Para manter a análise leve no celular, recorte arquivos maiores que 5 minutos antes de importar.');
    await validateFile(file);checkAbort(signal);
    const Context = root.AudioContext || root.webkitAudioContext;
    if (!Context) throw new Error('Este navegador não oferece Web Audio.');
    const decoder = new Context();
    try {
      onProgress?.('Decodificando o áudio com Web Audio…');
      const buffer = await abortable(decoder.decodeAudioData(await file.arrayBuffer()), signal);
      checkAbort(signal);
      if (buffer.duration > MAX_DECODE_SECONDS) throw new Error('Recorte arquivos maiores que 5 minutos antes de importar.');
      onProgress?.('Medindo RMS, ZCR e fator de crista da mixagem…');
      const features = measure(buffer, startSeconds, endSeconds);
      checkAbort(signal);
      return { features, blob: clipWav(buffer, startSeconds, endSeconds), method: 'Web Audio nativa · mixagem completa' };
    } finally { try { await decoder.close(); } catch {} }
  }
  root.AutoPresetAudioHeuristics = Object.freeze({ analyze, measure, toneHints, validateFile, describeError, clipWav, MAX_AUDIO_BYTES, MAX_CLIP_SECONDS, MAX_DECODE_SECONDS });
})(typeof window !== 'undefined' ? window : globalThis);
