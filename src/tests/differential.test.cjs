const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
function context() {
  const ctx = vm.createContext({ Uint8Array, ArrayBuffer, DataView, TextEncoder, Error, Set, Object, Number });
  ctx.globalThis = ctx;
  return ctx;
}
const baseline = context();
const current = context();
vm.runInContext(fs.readFileSync(path.join(__dirname, 'fixtures/v26-handler.js'), 'utf8'), baseline);
vm.runInContext(fs.readFileSync(path.join(root, 'core/mk300-preset-handler.js'), 'utf8'), current);
const scenario = `(() => {
  const base=new Uint8Array(448);
  base.fill(0xA5,330);
  base.fill(0x5A,0x14,0x18);
  const Handler=globalThis.MK300PresetHandler||globalThis.MK300Core.MK300PresetHandler;
  const h=new Handler(base);
  h.setName('Differential V26');
  h.setBpm(137);
  h.setPresetVolume(73);
  h.setChainOrder([0,1,2,3,4,5,6,7,8,9,10]);
  h.setBlockState(4,true);
  h.setBlockModel(4,23);
  h.setBlockModel(8,17);
  h.setKnobValue(4,0,81);
  h.setKnobValue(10,10,4321);
  return Array.from(h.compile());
})()`;
const oldBytes = Array.from(vm.runInContext(scenario, baseline));
const newBytes = Array.from(vm.runInContext(scenario, current));
assert.deepEqual(newBytes, oldBytes, 'extração V27 deve manter os 448 bytes do handler V26');
console.log('Diferencial do handler: 448/448 bytes idênticos.');
