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
      promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
    });
  }
  async function validateFile(file) {
    if (!(file instanceof Blob) || !file.size) throw new Error('Escolha um arquivo de áudio no celular.');
    if (file.size > MAX_AUDIO_BYTES) throw new Error('O limite do áudio é 25 MiB.');
    const name = String(file.name || '').toLowerCase();
    if (!/\.(mp3|wav|m4a)$/.test(name)) throw new Error('Formato não aceito. Selecione um arquivo .mp3, .wav ou .m4a salvo no aparelho.');
    const header = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    const ascii = (a, b) => String.fromCharCode(...header.subarray(a, b));
    const wav = header.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE';
    const mp3 = header.length >= 3 && (ascii(0, 3) === 'ID3' || header[0] === 255 && (header[1] & 224) === 224);
    const m4a = header.length >= 16 && ascii(4, 8) === 'ftyp';
    if (!(name.endsWith('.wav') && wav) && !(name.endsWith('.mp3') && mp3) && !(name.endsWith('.m4a') && m4a)) throw new Error('O conteúdo do arquivo não parece ser um MP3/WAV/M4A válido.');
    return { name: file.name, size: file.size, type: wav ? 'audio/wav' : mp3 ? 'audio/mpeg' : 'audio/mp4' };
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
    if (features.feature_version === 3) return spectralHints(features);
    const brightness = Math.max(0, Math.min(1, features.zero_crossing_rate * 10));
    return { bass: Math.round(58 - brightness * 14), middle: 55, treble: Math.round(38 + brightness * 24), brightness };
  }

  const FFT_SIZE = 2048;
  const ENVELOPE_HZ = 200;
  const DSP_MAX_SECONDS = MAX_CLIP_SECONDS + 0.5;
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  // In-place radix-2 FFT. Reuse the same scratch arrays for every frame/channel.
  function fft(real, imag) {
    const n = real.length;
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { const r = real[i], v = imag[i]; real[i] = real[j]; imag[i] = imag[j]; real[j] = r; imag[j] = v; }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const angle = -2 * Math.PI / size, wr = Math.cos(angle), wi = Math.sin(angle);
      for (let start = 0; start < n; start += size) {
        let tr = 1, ti = 0;
        for (let j = 0; j < size / 2; j++) {
          const a = start + j, b = a + size / 2;
          const br = real[b] * tr - imag[b] * ti, bi = real[b] * ti + imag[b] * tr;
          real[b] = real[a] - br; imag[b] = imag[a] - bi;
          real[a] += br; imag[a] += bi;
          const next = tr * wr - ti * wi;
          ti = tr * wi + ti * wr; tr = next;
        }
      }
    }
  }

  // Generator allows the production async runner to yield between bounded chunks.
  function* spectralFrames(buffer, startSeconds, endSeconds, signal) {
    const rate = buffer.sampleRate, start = Math.floor(startSeconds * rate), end = Math.min(buffer.length, Math.ceil(endSeconds * rate));
    if (!Number.isFinite(rate) || rate <= 0 || !Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end <= start || endSeconds > buffer.duration + 0.02 || endSeconds - startSeconds > DSP_MAX_SECONDS || !Number.isInteger(buffer.numberOfChannels) || buffer.numberOfChannels < 1) throw new Error('Trecho espectral inválido; selecione até 45 segundos.');
    checkAbort(signal);
    const length = end - start, channels = buffer.numberOfChannels;
    const envelopeStep = Math.max(1, Math.round(rate / ENVELOPE_HZ));
    const envelope = new Float64Array(Math.ceil(length / envelopeStep));
    let squares = 0, peak = 0, crossings = 0;
    for (let c = 0; c < channels; c++) {
      const samples = buffer.getChannelData(c);
      for (let block = start; block < end; block += 32768) {
        checkAbort(signal);
        for (let i = block; i < Math.min(end, block + 32768); i++) {
          const value = samples[i];
          if (!Number.isFinite(value)) throw new Error('O áudio contém amostras inválidas.');
          const power = value * value;
          squares += power; peak = Math.max(peak, Math.abs(value));
          envelope[Math.floor((i - start) / envelopeStep)] += power;
          if (i > start && (value >= 0) !== (samples[i - 1] >= 0)) crossings++;
        }
        yield;
      }
    }
    for (let i = 0; i < envelope.length; i++) envelope[i] = Math.sqrt(envelope[i] / (channels * Math.min(envelopeStep, length - i * envelopeStep)));
    const real = new Float64Array(FFT_SIZE), imag = new Float64Array(FFT_SIZE);
    const window = new Float64Array(FFT_SIZE), power = new Float64Array(FFT_SIZE / 2 + 1), previous = new Float64Array(power.length);
    for (let i = 0; i < FFT_SIZE; i++) window[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FFT_SIZE - 1));
    const hop = Math.max(FFT_SIZE / 2, Math.round(rate / 50));
    const bandCenters = [100, 200, 400, 800, 1600, 3200], bandEnergy = new Float64Array(6);
    const firstBin = Math.max(1, Math.ceil(40 * FFT_SIZE / rate)), lastBin = Math.min(power.length - 1, Math.floor(16000 * FFT_SIZE / rate));
    let frames = 0, active = 0, weightedCentroid = 0, weightedRolloff = 0, weightedFlatness = 0, weightedHarmonics = 0, energyWeight = 0, fluxSum = 0, fluxPeak = 0, fluxCount = 0, wasActive = false;
    for (let offset = 0; offset < length; offset += hop) {
      if (length >= FFT_SIZE && offset + FFT_SIZE > length) break;
      checkAbort(signal); power.fill(0);
      const available = Math.min(FFT_SIZE, length - offset);
      // Incoherent channel powers preserve anti-phase stereo without a mono copy.
      for (let c = 0; c < channels; c++) {
        const samples = buffer.getChannelData(c);
        let mean = 0;
        for (let i = 0; i < available; i++) mean += samples[start + offset + i];
        mean /= available; real.fill(0); imag.fill(0);
        for (let i = 0; i < available; i++) real[i] = (samples[start + offset + i] - mean) * window[i];
        fft(real, imag);
        for (let k = firstBin; k <= lastBin; k++) power[k] += (real[k] ** 2 + imag[k] ** 2) / channels;
      }
      let total = 0, weighted = 0, logs = 0, peakBin = firstBin;
      for (let k = firstBin; k <= lastBin; k++) { total += power[k]; weighted += power[k] * k * rate / FFT_SIZE; if (power[k] > power[peakBin]) peakBin = k; }
      if (total > 1e-10 && lastBin >= firstBin) {
        const bins = lastBin - firstBin + 1, floor = total / bins * 1e-12;
        let accumulated = 0, rolloff = 0, norm = 0, harmonics = 0;
        for (let k = firstBin; k <= lastBin; k++) {
          logs += Math.log(Math.max(floor, power[k])); accumulated += power[k];
          if (!rolloff && accumulated >= total * 0.85) rolloff = k * rate / FFT_SIZE;
          norm += power[k]; if (k > peakBin * 1.5) harmonics += power[k];
          const hz = k * rate / FFT_SIZE;
          for (let b = 0; b < 6; b++) if (hz >= bandCenters[b] / Math.SQRT2 && hz < bandCenters[b] * Math.SQRT2) bandEnergy[b] += power[k];
        }
        // Flux of L2-normalized magnitudes is insensitive to file loudness.
        let flux = 0;
        for (let k = firstBin; k <= lastBin; k++) {
          const magnitude = Math.sqrt(power[k] / norm), difference = Math.max(0, magnitude - previous[k]);
          flux += difference * difference; previous[k] = magnitude;
        }
        if (wasActive || frames > 0) { flux = Math.sqrt(flux); fluxSum += flux; fluxPeak = Math.max(fluxPeak, flux); fluxCount++; }
        wasActive = true;
        weightedCentroid += weighted; weightedHarmonics += harmonics;
        weightedRolloff += total * rolloff;
        weightedFlatness += total * clamp(Math.exp(logs / bins) / (total / bins), 0, 1);
        energyWeight += total; active++;
      } else { previous.fill(0); wasActive = false; }
      frames++; yield;
    }
    const temporal = yield* temporalMetrics(envelope, rate / envelopeStep, signal);
    const rms = Math.sqrt(squares / (length * channels)), crest = rms ? peak / rms : 0;
    const bandTotal = bandEnergy.reduce((a, b) => a + b, 0);
    return {
      sample_rate: rate, duration_seconds: length / rate, rms, rms_db: 20 * Math.log10(Math.max(rms, 1e-8)), peak,
      zero_crossing_rate: crossings / Math.max(1, (length - 1) * channels), crest_factor: crest, crest_factor_db: crest ? 20 * Math.log10(crest) : 0,
      harmonic_energy_ratio: energyWeight ? weightedHarmonics / energyWeight : 0,
      spectral_flatness: energyWeight ? weightedFlatness / energyWeight : 0,
      spectral_centroid_hz: energyWeight ? weightedCentroid / energyWeight : 0,
      spectral_rolloff_85_hz: energyWeight ? weightedRolloff / energyWeight : 0,
      spectral_flux: fluxCount ? fluxSum / fluxCount : 0, spectral_flux_peak: fluxPeak,
      band_energy_ratios: Array.from(bandEnergy, value => bandTotal ? value / bandTotal : 0),
      spectral_frames: frames, active_spectral_frames: active, fft_size: FFT_SIZE,
      // Typed-array working storage, excluding the decoded input, WAV output and JS overhead.
      dsp_workspace_bytes: envelope.byteLength + real.byteLength + imag.byteLength + window.byteLength + power.byteLength + previous.byteLength + bandEnergy.byteLength + temporal.workspace_bytes,
      ...temporal.features, audio_source: 'full_mix', feature_version: 3
    };
  }

  function* temporalMetrics(envelope, rate, signal) {
    const n = envelope.length, novelty = new Float64Array(n), sorted = new Float64Array(envelope);
    sorted.sort();
    const quantile = p => n ? sorted[Math.floor((n - 1) * p)] : 0;
    const noiseDb = 20 * Math.log10(Math.max(quantile(0.1), 1e-8));
    let mean = 0, maximum = 0;
    for (let i = 1; i < n; i++) { novelty[i] = Math.max(0, envelope[i] - envelope[i - 1]); mean += novelty[i]; maximum = Math.max(maximum, envelope[i]); }
    mean /= Math.max(1, n - 1);
    let best = 0, bestLag = 0;
    const correlations = new Float64Array(Math.min(n >> 1, Math.floor(rate * 1.2)) + 1);
    const minLag = Math.max(1, Math.ceil(rate * 0.08));
    for (let lag = minLag; lag < correlations.length; lag++) {
      checkAbort(signal);
      let dot = 0, left = 0, right = 0;
      for (let i = lag; i < n; i++) { const a = novelty[i] - mean, b = novelty[i - lag] - mean; dot += a * b; left += a * a; right += b * b; }
      const correlation = left * right > 1e-16 ? dot / Math.sqrt(left * right) : 0;
      correlations[lag] = correlation; best = Math.max(best, correlation);
      if (lag % 16 === 0) yield;
    }
    for (let lag = minLag + 1; lag < correlations.length - 1; lag++) {
      if (correlations[lag] >= Math.max(0.4, best * 0.9) && correlations[lag] > correlations[lag - 1] && correlations[lag] >= correlations[lag + 1]) { bestLag = lag; break; }
    }
    // Fit a log-envelope decay after an attack. Sustain/compression can mimic a tail.
    let decay = 0, decayConfidence = 0, attacks = 0;
    for (let i = 1; i < n - 1; i++) {
      if (novelty[i] < Math.max(mean * 4, maximum * 0.08) || novelty[i] < novelty[i - 1] || novelty[i] < novelty[i + 1]) continue;
      attacks++;
      let count = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0, first = 0, last = 0;
      for (let j = i + Math.ceil(rate * 0.03); j < Math.min(n, i + rate * 0.8); j++) {
        if (novelty[j] > Math.max(mean * 4, maximum * 0.08)) break;
        if (envelope[j] <= maximum * 1e-4) break;
        const x = (j - i) / rate, y = Math.log(envelope[j]);
        if (!count) first = y; last = y;
        count++; sx += x; sy += y; sxx += x * x; sxy += x * y; syy += y * y;
      }
      const variance = count * sxx - sx * sx, covariance = count * sxy - sx * sy;
      if (count >= Math.ceil(rate * 0.08) && variance > 0 && first - last > Math.log(2)) {
        const slope = covariance / variance, r2 = covariance ** 2 / Math.max(1e-20, variance * (count * syy - sy * sy));
        const estimate = -Math.log(1000) / slope;
        if (slope < -1 && r2 > 0.7 && estimate > 0.05 && estimate < 5 && r2 > decayConfidence) { decay = estimate; decayConfidence = r2; }
      }
      if (i % 32 === 0) { checkAbort(signal); yield; }
    }
    const dynamicRange = 20 * Math.log10(Math.max(maximum, 1e-8) / Math.max(quantile(0.1), 1e-8));
    if (dynamicRange < 3 || attacks < 2) bestLag = 0;
    return { workspace_bytes: novelty.byteLength + sorted.byteLength + correlations.byteLength, features: {
      noise_floor_db: noiseDb, envelope_dynamic_range_db: dynamicRange,
      transient_rate_hz: attacks / Math.max(1 / rate, n / rate),
      delay_time_ms: bestLag ? Math.round(bestLag / rate * 1000) : null,
      delay_confidence: bestLag ? clamp(correlations[bestLag], 0, 1) : 0,
      decay_proxy_seconds: decay || null, decay_confidence: decayConfidence
    }};
  }

  async function extractFeatures(buffer, { startSeconds = 0, endSeconds = buffer.duration, signal, onProgress } = {}) {
    const iterator = spectralFrames(buffer, startSeconds, endSeconds, signal);
    let item, iterations = 0;
    onProgress?.('Extraindo espectro, transientes e autocorrelação do trecho…');
    do {
      checkAbort(signal); item = iterator.next();
      if (++iterations % 16 === 0 && !item.done) await new Promise(resolve => setTimeout(resolve, 0));
    } while (!item.done);
    checkAbort(signal); return item.value;
  }

  function spectralHints(f) {
    const required = ['sample_rate', 'spectral_flatness', 'spectral_centroid_hz', 'spectral_rolloff_85_hz', 'spectral_flux', 'spectral_flux_peak', 'harmonic_energy_ratio', 'noise_floor_db', 'delay_confidence', 'decay_confidence'];
    if (required.some(key => !Number.isFinite(f[key])) || !Array.isArray(f.band_energy_ratios) || f.band_energy_ratios.length !== 6 || f.band_energy_ratios.some(x => !Number.isFinite(x) || x < 0)) throw new Error('Medições espectrais inválidas.');
    if (f.sample_rate <= 0 || f.spectral_flatness < 0 || f.spectral_flatness > 1 || f.spectral_centroid_hz < 0 || f.spectral_rolloff_85_hz < 0 || (f.delay_time_ms !== null && (!Number.isInteger(f.delay_time_ms) || f.delay_time_ms < 80 || f.delay_time_ms > 1200)) || (f.decay_proxy_seconds !== null && (!Number.isFinite(f.decay_proxy_seconds) || f.decay_proxy_seconds <= 0))) throw new Error('Medições espectrais fora da faixa.');
    const c = root.AutoPresetToneConfig?.classification || {
      crest_reference_db:13, crest_span_db:11, harmonic_scale:3, crossing_scale_hz:12000,
      weights:{compression:.35,noise:.3,harmonics:.25,crossings:.1},
      crunch_threshold:.36,high_gain_threshold:.5,fuzz_noise_threshold:.55,
      fuzz_compression_threshold:.65,fuzz_crossings_threshold:.25
    };
    const brightness = clamp((f.spectral_centroid_hz / 5000 + f.spectral_rolloff_85_hz / 9000) / 2, 0, 1);
    const compression = clamp((c.crest_reference_db - f.crest_factor_db) / c.crest_span_db, 0, 1);
    const noise = clamp(Math.sqrt(Math.max(0, f.spectral_flatness)), 0, 1);
    const crossings = clamp(f.zero_crossing_rate * f.sample_rate / c.crossing_scale_hz, 0, 1);
    const distortion = clamp(c.weights.compression * compression + c.weights.noise * noise + c.weights.harmonics * clamp(f.harmonic_energy_ratio * c.harmonic_scale, 0, 1) + c.weights.crossings * crossings, 0, 1);
    const fuzz = noise > c.fuzz_noise_threshold && compression > c.fuzz_compression_threshold && crossings > c.fuzz_crossings_threshold;
    const kind = fuzz ? 'Fuzz' : distortion > c.high_gain_threshold ? 'Hi-Gain' : distortion > c.crunch_threshold ? 'Crunch' : 'Clean';
    const bands = f.band_energy_ratios, bassEnergy = bands[0] + bands[1], middleEnergy = bands[2] + bands[3];
    return {
      classification: kind, distortion, brightness, confidence: 'baixa · mixagem completa',
      method:root.AutoPresetToneConfig?.version || 'usb-spectral-v1', gain_is_starting_point:true,
      ampGain: Math.round(clamp(15 + 75 * distortion, 0, 100)),
      bass: Math.round(clamp(42 + 25 * bassEnergy, 0, 100)), middle: Math.round(clamp(43 + 24 * middleEnergy, 0, 100)),
      treble: Math.round(35 + 35 * brightness), presence: Math.round(25 + 40 * brightness),
      cab_low_cut_hz: Math.round(clamp(60 + 100 * bassEnergy, 60, 160)),
      cab_high_cut_hz: Math.round(clamp(f.spectral_rolloff_85_hz * 1.2, 3500, 10000)),
      gate_threshold_db: Math.round(clamp(f.noise_floor_db + 6, -80, -30)),
      gate_release_percent: Math.round(clamp(70 - f.spectral_flux_peak * 50, 15, 80)),
      delay_time_ms: f.delay_confidence >= 0.4 ? f.delay_time_ms : null,
      delay_mix: Math.round(clamp(f.delay_confidence * 24, 0, 24)),
      reverb_decay: null, reverb_mix: 0,
      reverb_candidate: f.decay_proxy_seconds ? {decay:Math.round(clamp(f.decay_proxy_seconds / 4 * 100, 0, 100)),mix:Math.round(clamp(f.decay_confidence * 22, 0, 22)),reason:'Decaimento também pode ser sustain; confirme no editor.'} : null,
      eq_gains_db: bands.map(value => Math.round(clamp(0.8 * Math.log2(Math.max(value, 1e-5) * 6), -3, 3)))
    };
  }

  // Exact IDs from the repository catalog; alternate marketing names are not aliases.
  function matchPreset(features, catalog = root.MK300V75 || root.MK300V73, parameters = root.MK300V75Parameters || root.MK300V73Parameters) {
    const hints = toneHints(features);
    if (features.feature_version !== 3 || !features.active_spectral_frames || !catalog || !parameters) throw new Error('Catálogo ou análise espectral indisponível.');
    const matrix = {
      Clean: { amp: '1J120_CL', ds: '2TS8', cab: '69FenDeluX', driveGain: 12 },
      Crunch: { amp: '34OR_CRUNCH', ds: '2TS8', cab: '10MAR1960_412', driveGain: 32 },
      'Hi-Gain': { amp: '67EHV5150_DS', ds: '11RAT', cab: '63EAGLProV30s', driveGain: 48 },
      Fuzz: { amp: '34OR_CRUNCH', ds: '39BIG-MUFF', cab: '36Recto_112', driveGain: 68 }
    };
    const v75 = catalog.firmware === 'v75';
    const verified = {
      Clean: {amp:'Fender Super', ds:'MW-GOLD', cab:'44MarVal4', driveGain:12},
      Crunch: {amp:'Fender Super', ds:'MW-GOLD', cab:'44MarVal4', driveGain:32},
      'Hi-Gain': {amp:'6DS-MarsFD100', ds:'MW-808', cab:'44MarVal4', driveGain:18},
      Fuzz: {amp:'53DS-Pey5150', ds:'MW-808', cab:'44MarVal4', driveGain:24}
    };
    const row = {...(v75 ? verified : matrix)[hints.classification]};
    if (!v75 && hints.brightness > 0.6) row.cab = '63EAGLProV30s';
    else if (!v75 && hints.classification === 'Clean' && hints.brightness > 0.35) row.cab = '77J120Rolnd';
    const exact = (list, name) => { const index = list.indexOf(name); if (index < 0) throw new Error('Modelo ausente do catálogo: ' + name); return index; };
    const amp = exact(catalog.AMP_CATALOG, row.amp), drive = exact(catalog.DS_CATALOG, row.ds);
    const cabSlot = Number(Object.keys(catalog.CAB_SLOT_NAMES).find(key => catalog.CAB_SLOT_NAMES[key] === row.cab));
    if (!Number.isInteger(cabSlot) || cabSlot < 1 || cabSlot > 100 || amp > 99) throw new Error('Slot/modelo fora da faixa MK-300.');
    const gateName = features.spectral_flux_peak > 0.3 && features.crest_factor_db > 8 ? 'Pro Gate' : 'Soft Gate';
    const gate = exact(catalog.GATE_CATALOG, gateName), eq = exact(catalog.EQ_CATALOG, 'Guitar EQ 6');
    const parameter = (block, model, name, value) => {
      const spec = parameters.blocks[block]?.models[model];
      const knob = spec?.knobs.indexOf(name);
      if (!Number.isInteger(knob) || knob < 0 || !Number.isInteger(value)) throw new Error('Parâmetro sem mapeamento: ' + name);
      return { block, model, knob, name, value };
    };
    const settings = [parameter(4, amp, 'Pres', hints.presence), parameter(4, amp, 'Reso', 0), parameter(4, amp, 'Bright', 50), ...['Bass', 'Middle', 'Treble', 'Reso', 'Pres', 'Bright'].map((name, i) => parameter(3, drive, name, i === 3 ? 0 : 50)), parameter(2, gate, 'Thd', hints.gate_threshold_db)];
    if (gateName === 'Pro Gate') settings.push(parameter(2, gate, 'Rel', hints.gate_release_percent));
    parameters.blocks[6].models[eq].knobs.forEach((name, i) => settings.push(parameter(6, eq, name, hints.eq_gains_db[i])));
    return { ...hints, amp, drive, cabSlot, gate, eq, driveGain: row.driveGain, settings,
      dsOn: hints.classification !== 'Clean', ampOn: true,
      delay: exact(catalog.DLY_CATALOG, 'Clean'), reverb: exact(catalog.REV_CATALOG, 'Room'),
      models: { amp: row.amp, ds: row.ds, cab: row.cab, gate: gateName, eq: 'Guitar EQ 6' },
      limitations: v75 ? 'AMP/DS/CAB confirmados nos presets V75 enviados. Os slots dependem dos modelos instalados; o .dzh não inclui capturas ou IRs. Fuzz é uma hipótese espectral, não uma identificação de pedal. Cortes CAB em unidades brutas; repetições podem ser ritmo.' : 'Catálogo legado V73. Confirme os mesmos modelos e slots no equipamento; capturas e IRs não são incluídos.'
    };
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
      let buffer;
      try { buffer = await abortable(decoder.decodeAudioData(await file.arrayBuffer()), signal); }
      catch (error) {
        if (error.name === 'AbortError') throw error;
        throw new Error('Este navegador não decodificou o áudio. Use WAV/MP3 ou a opção Analisar arquivo no servidor.');
      }
      checkAbort(signal);
      if (buffer.duration > MAX_DECODE_SECONDS) throw new Error('Recorte arquivos maiores que 5 minutos antes de importar.');
      onProgress?.('Medindo RMS, ZCR e fator de crista da mixagem…');
      const features = await (root.AutoPresetDSPLocal?.extractFeatures || extractFeatures)(buffer, { startSeconds, endSeconds, signal, onProgress });
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
      return { features: await (root.AutoPresetDSPLocal?.extractFeatures || extractFeatures)(buffer, { signal, onProgress }), blob: clipWav(buffer, 0, buffer.duration), method: 'MediaRecorder · trecho gravado em tempo real' };
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
  root.AutoPresetAudioHeuristics = Object.freeze({ analyze, analyzeRecording, recordRange, measure, extractFeatures, matchPreset, toneHints, validateFile, describeError, clipWav, MAX_AUDIO_BYTES, MAX_CLIP_SECONDS, MAX_DECODE_SECONDS });
})(typeof window !== 'undefined' ? window : globalThis);
