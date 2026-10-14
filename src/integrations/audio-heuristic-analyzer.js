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
  // Only the bounded recording is decoded; the source file stays in the HTML player.
  async function analyzeRecording({ blob, signal, onProgress }) {
    checkAbort(signal);
    if (!(blob instanceof Blob) || !blob.size || blob.size > MAX_AUDIO_BYTES) throw new Error('Gravação vazia ou grande demais.');
    const Context = root.AudioContext || root.webkitAudioContext;
    if (!Context) throw new Error('Este navegador não oferece Web Audio.');
    const decoder = new Context();
    try {
      onProgress?.('Decodificando somente o trecho gravado…');
      const buffer = await abortable(decoder.decodeAudioData(await blob.arrayBuffer()), signal);
      checkAbort(signal);
      if (buffer.duration > MAX_CLIP_SECONDS + 0.5) throw new Error('A gravação ultrapassou 45 segundos.');
      return { features: measure(buffer), blob: clipWav(buffer, 0, buffer.duration), method: 'MediaRecorder · trecho gravado em tempo real' };
    } finally { try { await decoder.close(); } catch {} }
  }

  function recordRange({ audio, startTime, endTime, signal }) {
    checkAbort(signal);
    const capture = audio.captureStream || audio.mozCaptureStream;
    if (!capture || !root.MediaRecorder) throw new Error('Este navegador não suporta captura nativa do player. Tente um navegador compatível.');
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || startTime < 0 || endTime <= startTime || endTime > audio.duration || endTime - startTime > MAX_CLIP_SECONDS) throw new Error('Selecione um intervalo válido de até 45 segundos.');
    return new Promise((resolve, reject) => {
      let stream, recorder, timer, watchdog, failure, stopping = false;
      const chunks = [];
      let bytes = 0;
      const finish = error => {
        if (stopping) return;
        stopping = true; failure = error;
        clearInterval(timer); clearTimeout(watchdog);
        if (recorder && recorder.state !== 'inactive') recorder.stop();
        else complete();
      };
      const complete = () => {
        clearInterval(timer); clearTimeout(watchdog);
        audio.removeEventListener('seeked', begin);
        audio.removeEventListener('seeking', interrupted);
        audio.removeEventListener('pause', interrupted);
        audio.removeEventListener('ratechange', interrupted);
        audio.removeEventListener('error', interrupted);
        audio.removeEventListener('ended', ended);
        signal?.removeEventListener('abort', abort);
        root.document?.removeEventListener('visibilitychange', visibility);
        audio.pause();
        stream?.getTracks().forEach(track => track.stop());
        const blob = new Blob(chunks, { type: recorder?.mimeType || chunks[0]?.type || '' });
        chunks.length = 0;
        if (failure) reject(failure);
        else if (!blob.size) reject(new Error('O player não produziu áudio para gravar.'));
        else resolve(blob);
      };
      const abort = () => finish(new DOMException('Gravação cancelada.', 'AbortError'));
      const interrupted = () => finish(new Error('Gravação interrompida. Mantenha o player tocando sem alterar a posição ou velocidade.'));
      const visibility = () => { if (root.document.hidden) interrupted(); };
      const ended = () => audio.currentTime >= endTime - 0.02 ? finish() : interrupted();
      const begin = () => {
        if (stopping) return;
        try {
          stream = capture.call(audio);
          if (!stream.getAudioTracks().length) throw new Error('A captura do player não oferece uma faixa de áudio.');
          const mimeType = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find(type => root.MediaRecorder.isTypeSupported(type));
          recorder = new root.MediaRecorder(stream, mimeType ? { mimeType } : undefined);
          recorder.ondataavailable = event => {
            if (!event.data.size) return;
            bytes += event.data.size;
            if (bytes > MAX_AUDIO_BYTES) { failure = new Error('A gravação excedeu o limite de memória.'); finish(failure); return; }
            chunks.push(event.data);
          };
          recorder.onstop = complete;
          recorder.onerror = event => finish(event.error || new Error('Falha ao gravar áudio.'));
          audio.addEventListener('seeking', interrupted);
          audio.addEventListener('pause', interrupted);
          audio.addEventListener('ratechange', interrupted);
          audio.addEventListener('error', interrupted);
          audio.addEventListener('ended', ended);
          recorder.start(250);
          timer = setInterval(() => { if (audio.currentTime >= endTime) finish(); }, 10);
          audio.play().catch(finish);
        } catch (error) { finish(error); }
      };
      audio.pause(); audio.playbackRate = 1;
      signal?.addEventListener('abort', abort, { once: true });
      root.document?.addEventListener('visibilitychange', visibility);
      watchdog = setTimeout(() => finish(new Error('A reprodução travou ou demorou demais. Tente novamente.')), (endTime - startTime + 15) * 1000);
      if (Math.abs(audio.currentTime - startTime) < 0.001 && !audio.seeking) begin();
      else { audio.addEventListener('seeked', begin, { once: true }); audio.currentTime = startTime; }
    });
  }
  root.AutoPresetAudioHeuristics = Object.freeze({ analyze, analyzeRecording, recordRange, measure, toneHints, validateFile, describeError, clipWav, MAX_AUDIO_BYTES, MAX_CLIP_SECONDS, MAX_DECODE_SECONDS });
})(typeof window !== 'undefined' ? window : globalThis);
