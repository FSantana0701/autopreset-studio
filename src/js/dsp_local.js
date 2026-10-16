/* Local MK-300 V75 pipeline. Catalog V73 indices are preserved by V75. */
(function (root) {
  'use strict';
  function encode(features, base) {
    const plan = root.AutoPresetAudioHeuristics.matchPreset(features);
    const handler = new root.MK300Core.MK300PresetHandler(base);
    const parameters = root.MK300V73Parameters;
    const blocks = [[2, plan.gate, true], [3, plan.drive, plan.dsOn], [4, plan.amp, true], [5, plan.cabSlot - 1, true], [6, plan.eq, true]];
    for (const [block, model, enabled] of blocks) {
      handler.setBlockModel(block, model); handler.setBlockState(block, enabled);
      parameters.blocks[block].models[model]?.defaults?.forEach((value, knob) => handler.setKnobValue(block, knob, value));
    }
    function set(block, model, name, value) {
      const knob = parameters.blocks[block].models[model].knobs.indexOf(name);
      if (knob < 0) throw new Error('Parâmetro não mapeado: ' + name);
      handler.setKnobValue(block, knob, value);
    }
    for (const [name, value] of Object.entries({Gain:plan.ampGain, Level:50, Bass:plan.bass, Middle:plan.middle, Treble:plan.treble})) set(4, plan.amp, name, value);
    set(3, plan.drive, 'Gain', plan.driveGain); set(3, plan.drive, 'Level', 50);
    for (const setting of plan.settings) handler.setKnobValue(setting.block, setting.knob, setting.value);
    // Disable time effects when the signal provides no reliable estimate.
    handler.setBlockState(8, plan.delay_time_ms !== null);
    handler.setBlockState(9, plan.reverb_decay !== null);
    for (const [block, model, values] of [
      [8, plan.delay, plan.delay_time_ms === null ? null : {Time:plan.delay_time_ms, Feedback:20, Mix:plan.delay_mix, Sync:0}],
      [9, plan.reverb, plan.reverb_decay === null ? null : {Decay:plan.reverb_decay, Mix:plan.reverb_mix}]
    ]) {
      if (!values) continue;
      handler.setBlockModel(block, model);
      const spec = parameters.blocks[block].models[model];
      spec.defaults?.forEach((value, knob) => handler.setKnobValue(block, knob, value));
      for (const [name, value] of Object.entries(values)) set(block, model, name === 'Feedback' ? 'Fb' : name, value);
    }
    return handler.compile();
  }
  async function extractFeatures(buffer, options = {}) {
    const features = await root.AutoPresetAudioHeuristics.extractFeatures(buffer, options);
    const Context = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!Context) throw new Error('Este navegador não oferece OfflineAudioContext.');
    const start = Math.floor((options.startSeconds || 0) * buffer.sampleRate);
    const end = Math.min(buffer.length, Math.ceil((options.endSeconds ?? buffer.duration) * buffer.sampleRate));
    // Sample bounded windows across the selection. Independent channel powers avoid phase cancellation.
    const size = 2048, powers = new Float64Array(size / 2);
    const windows = Math.min(16, Math.max(1, Math.ceil((end - start) / size)));
    for (let frame = 0; frame < windows; frame++) {
      if (options.signal?.aborted) throw new DOMException('Análise cancelada.', 'AbortError');
      const offset = start + Math.floor(frame / Math.max(1, windows - 1) * Math.max(0, end - start - size));
      for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const context = new Context(1, size, buffer.sampleRate);
        const clip = context.createBuffer(1, size, buffer.sampleRate);
        clip.getChannelData(0).set(buffer.getChannelData(channel).subarray(offset, Math.min(end, offset + size)));
        const source = context.createBufferSource(), analyser = context.createAnalyser();
        analyser.fftSize = size; analyser.smoothingTimeConstant = 0;
        source.buffer = clip; source.connect(analyser); analyser.connect(context.destination); source.start();
        await context.startRendering();
        const db = new Float32Array(analyser.frequencyBinCount); analyser.getFloatFrequencyData(db);
        for (let bin = 1; bin < db.length; bin++) powers[bin] += Number.isFinite(db[bin]) ? 10 ** (db[bin] / 10) : 0;
        source.disconnect(); analyser.disconnect();
      }
    }
    const peaks = [];
    for (let bin = 1; bin < powers.length - 1; bin++) if (powers[bin] > 0 && powers[bin] > powers[bin - 1] && powers[bin] >= powers[bin + 1]) peaks.push({frequency_hz:bin * buffer.sampleRate / size, power:powers[bin]});
    features.frequency_peaks = peaks.sort((a,b) => b.power - a.power).slice(0, 8);
    if (options.signal?.aborted) throw new DOMException('Análise cancelada.', 'AbortError');
    return features;
  }
  root.AutoPresetDSPLocal = Object.freeze({extractFeatures, encode});
})(globalThis);
