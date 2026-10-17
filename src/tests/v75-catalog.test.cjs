'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const context = vm.createContext({Uint8Array,ArrayBuffer,DataView,TextEncoder,TextDecoder,Blob,DOMException,setTimeout});
context.window = context;
for (const file of ['data/v73.js','data/v73-parameters.js','data/v75.js','core/mk300-preset-handler.js','integrations/audio-heuristic-analyzer.js','js/dsp_local.js']) {
  vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
}
assert.equal(context.MK300V73.DS_CATALOG.length,40,'legacy data is unchanged');
assert.equal(context.MK300V73.AMP_CATALOG[0],'1J120_CL');
const definition = JSON.parse(fs.readFileSync(path.join(root,'data/mk300-v75-confirmed.json'),'utf8'));
assert.equal(JSON.stringify(context.MK300V75Catalog),JSON.stringify(definition));
for (const model of definition.confirmed_models) {
  assert.equal(context.MK300V75Parameters.blocks[model.block].models[model.index].name,model.name);
}
const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/v75/manifest.json'),'utf8'));
for (const fixture of fixtures) {
  const bytes = fs.readFileSync(path.join(__dirname,'fixtures/v75',fixture.file));
  const handler = new context.MK300Core.MK300PresetHandler(new Uint8Array(bytes));
  assert.deepEqual(Buffer.from(handler.compile()),bytes,'all 448 original bytes survive');
}
const rate = 16000;
const samples = Float32Array.from({length:rate},(_,i)=>0.4*Math.sin(2*Math.PI*440*i/rate));
(async()=>{
  const features = await context.AutoPresetAudioHeuristics.extractFeatures({sampleRate:rate,numberOfChannels:1,length:rate,duration:1,getChannelData:()=>samples});
  const plan = context.AutoPresetAudioHeuristics.matchPreset(features);
  assert.equal(plan.models.amp,'Fender Super');
  assert.equal(plan.models.ds,'MW-GOLD');
  assert.equal(plan.models.cab,'44MarVal4');
  const base = new Uint8Array(fs.readFileSync(path.join(__dirname,'fixtures/v75/export-1.dzh')));
  const bytes = context.AutoPresetDSPLocal.encode(features,base);
  assert.equal(bytes.length,448);
  assert.equal(bytes[57],41);
  assert.equal(bytes[58],0);
  assert.equal(bytes[59],43);
  assert.deepEqual(Array.from(bytes.slice(330)),Array.from(base.slice(330)));
  console.log('V75: confirmed names, immutable legacy catalog, six exact binary roundtrips, and local audio-to-preset verified.');
})().catch(error=>{console.error(error);process.exitCode=1;});
