const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({
  Uint8Array, ArrayBuffer, DataView, TextEncoder, TextDecoder, Error, Set, Object, Number,
  globalThis: null
});
context.globalThis = context;
context.window = context;
vm.runInContext(fs.readFileSync(path.join(root, 'data/v73.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'data/v73-parameters.js'), 'utf8'), context);
vm.runInContext(fs.readFileSync(path.join(root, 'core/mk300-preset-handler.js'), 'utf8'), context);
const { MK300PresetHandler, shouldClearDelaySync } = context.MK300Core;
const { DLY_SYNC, AMP_CATALOG, DS_CATALOG, DLY_CATALOG } = context.MK300V73;
const parameterBlocks = context.MK300V73Parameters.blocks;

function equal(a, b, label) { assert.deepEqual(a, b, label); }

assert.equal(AMP_CATALOG.length, 120, 'catálogo AMP v73 completo');
assert.equal(DS_CATALOG.length, 40, 'catálogo DS v73 completo');
assert.equal(DLY_CATALOG.length, 27, 'catálogo DLY v73 completo');
assert.deepEqual([DLY_SYNC[0], DLY_SYNC[1], DLY_SYNC[3], DLY_SYNC[17]], [3, 5, 3, 6], 'índice Sync por modelo');
assert.equal(parameterBlocks.length, 11, 'metadados cobrem os 11 blocos');
assert.equal(parameterBlocks[8].models.length, 27, 'metadados cobrem os 27 delays');
assert.equal(parameterBlocks[9].models.length, 18, 'metadados cobrem os 18 reverbs');
assert.deepEqual([...parameterBlocks[9].models[4].knobs], ['Decay','Mix','Tone','Pitch','Amount'], 'Shimmer apresenta labels reais do catálogo');
assert.deepEqual([...parameterBlocks[9].models[1].knobs], ['Decay','Mix','High Pass','Low Pass','Mod Depth'], 'Hall apresenta labels reais do catálogo');
assert.deepEqual([...parameterBlocks[4].models[23].knobs], ['Gain','Level','Bass','Middle','Treble','Reso','Pres','Bright'], 'AMP expõe oito knobs na ordem do slot');
assert.deepEqual([...parameterBlocks[5].models[0].knobs], ['Level','Low Cut','High Cut'], 'CAB expõe nível e cortes');
assert.ok(parameterBlocks.every(block => block.models.every(model => model.knobs.length <= 12)), 'metadados cabem nos 12 slots int16 de cada bloco');
for (const block of parameterBlocks) for (const model of block.models) {
  assert.ok(model.index>=0 && model.index<block.models.length, `${block.name}: índice de modelo válido`);
  if (model.defaults) {
    assert.ok(model.defaults.length<=model.knobs.length, `${block.name}/${model.name}: defaults não excedem knobs`);
    assert.ok(model.defaults.every(value=>Number.isInteger(value)&&value>=-32768&&value<=32767), `${block.name}/${model.name}: defaults cabem em int16`);
  }
}
for (let index=0;index<DLY_SYNC.length;index++) assert.equal(parameterBlocks[8].models[index].knobs[DLY_SYNC[index]],'Sync',`DLY ${index}: offset Sync confere com catálogo`);

const base = new Uint8Array(448);
base.fill(0x5A, 0x14, 0x18);
base[0x36 + 8] = 3; // Delay Analog
const view = new DataView(base.buffer);
view.setInt16(0x42 + 24 * 8, 450, true);
view.setInt16(0x42 + 24 * 8 + 2, 30, true);
view.setInt16(0x42 + 24 * 8 + 4, 22, true);
const syncIndex = DLY_SYNC[3];
view.setInt16(0x42 + 24 * 8 + syncIndex * 2, 1, true);

const original = new Uint8Array(base);
const handler = new MK300PresetHandler(base);
handler.setName('MK300 Lead');
handler.setBpm(140);
handler.setPresetVolume(60);
handler.setPan(32768);
handler.setChainOrder([0,1,2,3,4,5,6,7,8,9,10]);
handler.setKnobValue(4, 0, 85);
handler.setKnobValue(10, 10, 4321);
handler.setKnobValue(10, 11, 1234);
assert.deepEqual([...base], [...original], 'handler não altera a base recebida');
const output = handler.compile();
const out = new DataView(output.buffer);
assert.equal(output.length, 448, 'saída de exatamente 448 bytes');
assert.equal(out.getUint16(0x18, true), 60, 'Preset Vol em 0x18 como u16 little-endian');
assert.equal(out.getUint16(0x1C, true), 32768, 'Pan em 0x1C como u16 little-endian');
assert.equal(out.getInt16(0xA2, true), 85, 'AMP knob 0 no offset literal 0xA2');
assert.equal(out.getInt16(0x146, true), 4321, 'VOL knob 10 no offset literal 0x146');
assert.equal(out.getInt16(0x148, true), 1234, 'VOL knob 11 no offset literal 0x148');
equal([...output.slice(0x14, 0x18)], [0x5A,0x5A,0x5A,0x5A], 'preserva os bytes 0x14–0x17');
equal([...output.slice(330)], [...base.slice(330)], 'preserva a região reservada 330–447');

const synced = new Uint8Array(448);
synced[0x36 + 8] = 3;
const syncedView = new DataView(synced.buffer);
syncedView.setInt16(0x42 + 24 * 8, 500, true);
syncedView.setInt16(0x42 + 24 * 8 + 2, 30, true);
syncedView.setInt16(0x42 + 24 * 8 + 4, 22, true);
syncedView.setInt16(0x42 + 24 * 8 + 3 * 2, 1, true);
assert.equal(shouldClearDelaySync(synced, 3, {time:450,fb:30,mix:22}, DLY_SYNC), false, 'preserva Sync da base sem edição');
assert.equal(shouldClearDelaySync(synced, 3, {time:451,fb:30,mix:22}, DLY_SYNC), true, 'limpa Sync quando o tempo é editado');
assert.equal(shouldClearDelaySync(synced, 17, {time:450,fb:30,mix:22}, DLY_SYNC), true, 'limpa Sync quando o modelo muda');

assert.throws(() => new MK300PresetHandler(new Uint8Array(447)), /448 bytes/);
assert.throws(() => handler.setName('Preset 🎸🎸🎸🎸'), /19 bytes UTF-8/);
assert.throws(() => handler.setChainOrder([0,1,2,3,4,5,6,7,8,9,9]), /Cadeia/);
console.log('Core v73: verificações passaram.');
