'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({Object});
context.globalThis = context;
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/chat-preset.js'), 'utf8'), context);
const reply = `1. NR (GATE)
Estado: ligado
Modelo: Soft Gate
Parâmetros: Thd=-48; Rel=35
2. DS
Estado: ligado
Modelo: MW-808
Parâmetros: Gain=22; Level=48
3. AMP
Estado: ligado
Modelo: 6DS-MarsFD100
Parâmetros: Gain=46; Bass=43; Middle=58; Treble=52
4. EQ
Estado: desligado
Modelo: Guitar EQ 6
Parâmetros: nenhum
5. CAB
Estado: ligado
Modelo: 44MarVal4
Parâmetros: Level=80; Low Cut=90; High Cut=9000
6. DLY
Estado: ligado
Modelo: Analog Stereo
Parâmetros: Time=460; Fb=28; Mix=20
7. REV
Estado: ligado
Modelo: Hall
Parâmetros: Decay=35; Mix=24; High Pass=60; Low Pass=75; Mod Depth=30`;
const parsed = context.AutoPresetChatPreset.parse(reply);
assert.equal(parsed.modules.AMP.model, '6DS-MarsFD100');
assert.equal(parsed.modules.AMP.parameters.Gain, 46);
assert.equal(parsed.modules.CAB.parameters['Low Cut'], 90);
assert.equal(parsed.modules.EQ.enabled, false);
assert.equal(context.AutoPresetChatPreset.parse(reply.replace('Estado: ligado', 'Estado: on')), null);
assert.equal(context.AutoPresetChatPreset.parse(reply.replace('Modelo: MW-808', 'Modelo: 0 · MW-808')), null);
assert.equal(context.AutoPresetChatPreset.parse(reply.replace('7. REV', '6. REV')), null);
console.log('Chat preset: strict seven-module parsing and malformed-response rejection verified.');
