'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
for(const file of ['data/v73.js','data/v73-parameters.js','data/v75.js','core/mk300-preset-handler.js','integrations/audio-heuristic-analyzer.js','js/dsp_local.js']) require(path.join(root,file));
const fixture=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures/usb-calibration.json'),'utf8'));
const base=new Uint8Array(fs.readFileSync(path.join(__dirname,'fixtures/v75/export-1.dzh')));
for(const test of fixture.cases){
  // Temporal fields are not supplied by this fixture: no ambience is inferred.
  const features={...test.features,noise_floor_db:-80,delay_time_ms:null,delay_confidence:0,decay_proxy_seconds:null,decay_confidence:0};
  const plan=AutoPresetAudioHeuristics.matchPreset(features);
  assert.equal(plan.classification,test.expected.classification,test.id);
  assert.equal(plan.dsOn,false,test.id);
  assert.equal(plan.reverb_decay,null,test.id);
  assert.equal(plan.gain_is_starting_point,true);
  const bytes=AutoPresetDSPLocal.encode(features,base);
  assert.equal(bytes.length,448);assert.equal(bytes[58],0);
  assert.equal(bytes[43+3],0);assert.equal(bytes[43+9],0);
}
assert.equal(MK300V75Parameters.blocks[5].models[0].name,'1EAGLProV30s','CAB confirmado no novo teste');
console.log('USB: três referências clean, DS/REV desligados e CAB confirmado, sem presumir o Gain físico.');
