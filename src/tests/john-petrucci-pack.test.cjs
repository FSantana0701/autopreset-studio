const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const context = vm.createContext({ Object, globalThis: null });
context.globalThis = context;
vm.runInContext(fs.readFileSync(path.join(root, 'data/john-petrucci-pack.js'), 'utf8'), context);
const presets = context.AutoPresetReferencePacks.johnPetrucci.presets;
const expected = [
  ['JP CLEAN', 'JP CLEAN.dzh', 'Preset 1 · Clean', '4d68da4928466e84ce362bb58e3a40d1557c2dfc62a55d6e6994481d24d5717e'],
  ['JP OVERDRIVE', 'JP OVERDRIVE.dzh', 'Preset 2 · Overdrive', 'f614982f80673c0e8fb51bd103e014363b8e6d62a07fcea007a22153f5eeec93'],
  ['JP HEAVY RHYTHM', 'JP HEAVY RHYTHM.dzh', 'Preset 4 · Heavy Rhythm', 'a6a498fbc058786314e03c98872e3bfd6ced92d57d2c351d5e287554ed06d4ea'],
  ['JP EPIC SOLO', 'JP EPIC SOLO.dzh', 'Preset 6 · Epic Solo', 'fbc78a1da37fcda331e624b4159f4e799a91bf4d83f78a398df45e93e1d80d7f'],
];
assert.equal(presets.length, expected.length, 'somente os quatro .dzh fornecidos entram na biblioteca');
for (const [index, [name, file, role, hash]] of expected.entries()) {
  const preset = presets[index];
  assert.equal(preset.name, name);
  assert.equal(preset.file, file);
  assert.equal(preset.role, role);
  const bytes = Buffer.from(preset.base64, 'base64');
  assert.equal(bytes.length, 448, `${file}: 448 bytes`);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), hash, `${file}: bytes originais preservados`);
  assert.deepEqual([...bytes.subarray(32, 43)].sort((a, b) => a - b), [0,1,2,3,4,5,6,7,8,9,10], `${file}: ordem contém os 11 blocos`);
  assert.ok(bytes.subarray(330).some(byte => byte !== 0), `${file}: região reservada real preservada`);
}
console.log('Pack John Petrucci: quatro presets originais íntegros (448 bytes cada).');
