const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const data = new Map();
const context = vm.createContext({
  Date, Math, Number, String, Object, Array, Promise, JSON, Error,
  localStorage: { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) }
});
context.globalThis = context;
context.window = context;
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'integrations/learning-store.js'), 'utf8'), context);
const learning = context.AutoPresetLearning;
const base = { rms_db: -16, spectral_centroid_hz: 2300, spectral_rolloff_85_hz: 5200, zero_crossing_rate: 0.08 };
const draft = { label: 'Correção do usuário', fields: { ampGain: '42' }, states: {} };

(async () => {
  await learning.save({ reference: 'Trecho teste', rating: 5, note: 'menos ganho', features: base, draft, preset_bytes: Array(448).fill(0) });
  const records = await learning.list();
  assert.equal(records.length, 1);
  assert.equal(records[0].rating, 5);
  assert.equal(records[0].preset_bytes.length, 448);
  const match = await learning.bestMatch({ ...base, spectral_centroid_hz: 2400 });
  assert.equal(match.record.reference, 'Trecho teste');
  assert.ok(match.distance < 0.1);
  assert.ok(learning.distance(base, { ...base, rms_db: -60 }) > learning.distance(base, { ...base, rms_db: -15 }));
  const mix={audio_source:'full_mix',feature_version:2,rms_db:-18,zero_crossing_rate:0.1,crest_factor_db:9};
  assert.equal(learning.distance(mix,base),Infinity,'mixagem não compara com guitarra isolada');
  await learning.save({reference:'Mixagem',features:mix,draft});
  assert.equal((await learning.bestMatch(mix)).record.reference,'Mixagem');
  const mixRecord=(await learning.list()).find(item=>item.reference==='Mixagem');
  assert.equal(mixRecord.features.audio_source,'full_mix');
  await learning.remove(mixRecord.id);
  const spectral={...mix,feature_version:3,spectral_flatness:0.1,spectral_centroid_hz:2000,spectral_rolloff_85_hz:5000,spectral_flux:0.2,harmonic_energy_ratio:0.3};
  const saved=await learning.save({reference:'DSP',features:spectral,draft});
  assert.equal(saved.features.feature_version,3);
  assert.equal(saved.features.spectral_flatness,0.1);
  assert.ok(learning.distance(spectral,{...spectral,spectral_flatness:0.8})>0);
  assert.ok(Number.isFinite(learning.distance(spectral,mix)),'old RMS/ZCR/crest examples remain comparable');
  await learning.remove(saved.id);
  const exported = JSON.parse(await learning.exportJson());
  assert.equal(exported.format, 'AutoPresetLearning');
  assert.equal(exported.examples.length, 1);
  await learning.remove(records[0].id);
  assert.equal((await learning.list()).length, 0);
  assert.throws(() => learning.normalizeRecord({ features: {}, draft: {} }), /Medições/);
  console.log('Aprendizagem local: validação, persistência sem IndexedDB, similaridade, exportação e remoção verificadas.');
})().catch(error => { console.error(error); process.exitCode = 1; });
