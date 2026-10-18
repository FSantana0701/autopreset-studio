const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../integrations/audio-heuristic-analyzer.js'), 'utf8');
const context = vm.createContext({ Blob, Uint8Array, DataView, ArrayBuffer, Float32Array, DOMException, Math, Number, String, Object, Promise, Error });
context.window = context;
vm.runInContext(source, context);
const analyzer = context.AutoPresetAudioHeuristics;
function buffer(channels, rate=44100) {
 return {sampleRate:rate,numberOfChannels:channels.length,length:channels[0].length,duration:channels[0].length/rate,getChannelData:c=>channels[c]};
}
const rate=44100, sine=Float32Array.from({length:rate},(_,i)=>0.4*Math.sin(2*Math.PI*440*i/rate));
const features=analyzer.measure(buffer([sine,Float32Array.from(sine,n=>-n)]));
assert.ok(Math.abs(features.rms-0.4/Math.sqrt(2))<1e-5,'RMS includes opposite-phase stereo energy');
assert.ok(Math.abs(features.zero_crossing_rate-880/rate)<0.0001,'ZCR of known tone');
assert.ok(Math.abs(features.crest_factor-Math.sqrt(2))<0.001,'crest factor of known tone');
assert.equal(features.audio_source,'full_mix');
const mixed=new Float32Array(rate*2);mixed.fill(0.2,rate);
assert.ok(Math.abs(analyzer.measure(buffer([mixed]),1,2).rms-0.2)<1e-8,'only selected interval contributes');
assert.equal(analyzer.measure(buffer([mixed]),0,1).rms,0);
assert.throws(()=>analyzer.toneHints(analyzer.measure(buffer([new Float32Array(rate)]))),/silencioso/);
assert.throws(()=>analyzer.measure(buffer([sine]),-1,1),/inválido/);
(async()=>{
 const wav=analyzer.clipWav(buffer([sine]),0,0.5);
 assert.equal(wav.size,44+rate);
 const header=new DataView(await wav.arrayBuffer());
 assert.equal(header.getUint32(24,true),rate);
 assert.equal(header.getUint16(22,true),1);
 const file=new Blob([wav],{type:'audio/wav'});Object.defineProperty(file,'name',{value:'mix.wav'});
 await analyzer.validateFile(file);
 // A real MP4 container header is accepted; decoding still verifies the codec.
 const m4aHeader=Uint8Array.from([0,0,0,28,102,116,121,112,77,52,65,32,0,0,0,0,77,52,65,32]);
 const m4a=new Blob([m4aHeader],{type:'audio/mp4'});Object.defineProperty(m4a,'name',{value:'usb.m4a'});
 await analyzer.validateFile(m4a);
 const fake=new Blob(['invalid m4a content']);Object.defineProperty(fake,'name',{value:'fake.m4a'});
 await assert.rejects(analyzer.validateFile(fake),/não parece/);
 await assert.rejects(analyzer.analyze({file,startSeconds:0,endSeconds:1,durationSeconds:301}),/5 minutos/);
 await assert.rejects(analyzer.analyze({file,startSeconds:0,endSeconds:1,durationSeconds:1,signal:{aborted:true}}),{name:'AbortError'});
 let closed=0;
 context.AudioContext=class {
   decodeAudioData(){return Promise.reject(Object.assign(new Error('unsupported codec'),{name:'EncodingError'}));}
   async close(){closed++;}
 };
 await assert.rejects(analyzer.analyze({file,startSeconds:0,endSeconds:0.5,durationSeconds:1}),/WAV\/MP3.*servidor/);
 assert.equal(closed,1,'failed decoder releases its AudioContext');
 console.log('Mixagem: RMS, ZCR, crest, intervalo, WAV, silêncio e limites verificados com sinais diagnósticos.');
})().catch(error=>{console.error(error);process.exitCode=1;});
