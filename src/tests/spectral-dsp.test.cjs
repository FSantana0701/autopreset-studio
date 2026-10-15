'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ctx = vm.createContext({ Blob, DOMException, setTimeout });
ctx.window = ctx;
for (const file of ['data/v73.js','data/v73-parameters.js','integrations/audio-heuristic-analyzer.js']) vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),ctx);
const api=ctx.AutoPresetAudioHeuristics, rate=16000;
function buffer(samples, channels=[samples], sampleRate=rate) {
 return {sampleRate,numberOfChannels:channels.length,length:samples.length,duration:samples.length/sampleRate,getChannelData:c=>channels[c]};
}
function signal(fn, seconds=2) { return Float32Array.from({length:rate*seconds},(_,i)=>fn(i/rate,i)); }
let seed=123;
function noise() { seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296*2-1; }
(async()=>{
 const sine=signal(t=>0.4*Math.sin(2*Math.PI*440*t));
 const clean=await api.extractFeatures(buffer(sine));
 assert.ok(Math.abs(clean.spectral_centroid_hz-440)<rate/2048,'centroid agrees with a known frequency within one bin');
 assert.ok(Math.abs(clean.spectral_rolloff_85_hz-440)<rate/2048*2);
 assert.ok(clean.spectral_flatness<0.001);
 assert.equal(clean.delay_time_ms,null,'steady tone is not an echo');
 assert.equal(clean.decay_proxy_seconds,null,'steady tone is not a reverb tail');
 const inverse=Float32Array.from(sine,v=>-v);
 const stereo=await api.extractFeatures(buffer(sine,[sine,inverse]));
 assert.ok(Math.abs(stereo.rms-clean.rms)<1e-8);
 assert.ok(Math.abs(stereo.spectral_centroid_hz-clean.spectral_centroid_hz)<1e-6,'anti-phase stereo retains spectral energy');
 const quiet=await api.extractFeatures(buffer(Float32Array.from(sine,v=>v/10)));
 assert.ok(Math.abs(quiet.spectral_flatness-clean.spectral_flatness)<1e-6);
 assert.ok(Math.abs(quiet.spectral_centroid_hz-clean.spectral_centroid_hz)<0.01);
 assert.ok(Math.abs(quiet.spectral_flux-clean.spectral_flux)<0.001);
 const broadband=await api.extractFeatures(buffer(signal(()=>0.4*noise())));
 assert.ok(broadband.spectral_flatness>0.4&&broadband.spectral_flatness<0.75,'white-noise power SFM is broadband');
 assert.ok(Math.abs(broadband.spectral_rolloff_85_hz-rate/2*0.85)<500);
 const crunch=await api.extractFeatures(buffer(signal(t=>0.4*Math.tanh(2*Math.sin(2*Math.PI*220*t)))));
 const high=await api.extractFeatures(buffer(signal(t=>0.4*Math.sign(Math.sin(2*Math.PI*220*t)))));
 const fuzz=await api.extractFeatures(buffer(signal(()=>0.4*Math.tanh(noise()*8))));
 assert.deepEqual([clean,crunch,high,fuzz].map(f=>api.toneHints(f).classification),['Clean','Crunch','Hi-Gain','Fuzz'],'diagnostic signals, not a claim of real-guitar recognition');
 const plans=[clean,crunch,high,fuzz].map(f=>api.matchPreset(f));
 assert.ok(plans[0].ampGain<plans[1].ampGain&&plans[1].ampGain<plans[2].ampGain);
 for(const plan of plans){
  assert.equal(ctx.MK300V73.AMP_CATALOG[plan.amp],plan.models.amp);
  assert.equal(ctx.MK300V73.DS_CATALOG[plan.drive],plan.models.ds);
  assert.equal(ctx.MK300V73.CAB_SLOT_NAMES[plan.cabSlot],plan.models.cab);
  for(const p of plan.settings)assert.equal(ctx.MK300V73Parameters.blocks[p.block].models[p.model].knobs[p.knob],p.name);
  assert.ok(plan.eq_gains_db.every(value=>value>=-12&&value<=12));
 }
 assert.throws(()=>api.matchPreset(clean,{...ctx.MK300V73,AMP_CATALOG:[]}),/ausente/,'unverified aliases never turn into guessed indices');
 const pulses=await api.extractFeatures(buffer(signal(t=>t%0.25<0.02?0.4*Math.sin(2*Math.PI*440*t):0)));
 assert.ok(Math.abs(pulses.delay_time_ms-250)<=5,'envelope autocorrelation finds a 250 ms repetition');
 assert.ok(pulses.delay_confidence>0.8);
 assert.ok(pulses.spectral_flux>clean.spectral_flux+0.1,'onsets have more flux than a stationary sinusoid');
 assert.equal(api.matchPreset(pulses).models.gate,'Pro Gate');
 const tail=await api.extractFeatures(buffer(signal(t=>t<0.05?0:0.4*Math.exp(-(t-0.05)*6)*Math.sin(2*Math.PI*440*t))));
 assert.ok(Math.abs(tail.decay_proxy_seconds-Math.log(1000)/6)<0.1,'known exponential tail fits expected 60 dB decay');
 assert.equal(tail.delay_time_ms,null,'one attack is not a repeated echo');
 const longer=Float32Array.from({length:rate*4},(_,i)=>i<rate*2?sine[i]:0.4*Math.sin(2*Math.PI*2000*i/rate));
 const selected=await api.extractFeatures(buffer(longer),{startSeconds:2,endSeconds:4});
 assert.ok(Math.abs(selected.spectral_centroid_hz-2000)<10,'only selected interval contributes');
 const silent=await api.extractFeatures(buffer(new Float32Array(rate)));
 assert.throws(()=>api.toneHints(silent),/silencioso/);
 const broken=new Float32Array(rate);broken[100]=NaN;
 await assert.rejects(api.extractFeatures(buffer(broken)),/inválidas/);
 await assert.rejects(api.extractFeatures(buffer(sine),{signal:{aborted:true}}),{name:'AbortError'});
 const full=signal(t=>0.4*Math.sin(2*Math.PI*440*t),45);
 const controller=new AbortController();
 const pending=api.extractFeatures(buffer(full),{signal:controller.signal});setTimeout(()=>controller.abort(),0);
 await assert.rejects(pending,{name:'AbortError'},'long analysis yields to cancellation');
 const bounded=await api.extractFeatures(buffer(full));
 assert.ok(bounded.dsp_workspace_bytes<320*1024,'45 s DSP typed-array scratch stays below 320 KiB');
 const tooLong=signal(()=>0.2,46);
 await assert.rejects(api.extractFeatures(buffer(tooLong)),/45 segundos/);
 console.log('DSP: tone/noise/clip signals, stereo, gain invariance, transients, repetitions, decay, catalog IDs, selection, cancellation and <320 KiB scratch verified.');
})().catch(error=>{console.error(error);process.exitCode=1;});
