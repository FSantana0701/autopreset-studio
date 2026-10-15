const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const start = html.indexOf('function youtubeTimeToSeconds(');
const end = html.indexOf('async function requestYoutubePreset(', start);
assert.ok(start > 0 && end > start);
const context = vm.createContext({ URL, Number });
vm.runInContext(html.slice(start, end), context);
const parse = context.youtubeTimeToSeconds;
for (const [text, value] of [['02:16',136],['1:30',90],['00:00',0],[' 00:45 ',45],['120:01',7201]]) {
 assert.equal(parse(text), value);
}
for (const value of ['', ' ', '90', '1:60', '1:99', '1:2', '-1:00', '00:01.5', '1: 30', '1:30:00', null, undefined]) {
 assert.throws(() => parse(value), /mm:ss/);
}
assert.throws(() => parse('99999999999999999999:00'), /grande demais/);
const payload = context.youtubePayload('https://youtu.be/example', '02:16', '02:56');
assert.equal(payload.start_seconds, 136);
assert.equal(payload.end_seconds, 176);
assert.equal(payload.firmware, 'v75');
assert.equal(context.youtubePayload('https://youtu.be/example', '00:59', '01:44').end_seconds, 104);
assert.throws(() => context.youtubePayload('https://youtu.be/example', '00:59', '01:45'), /ultrapassa 45/);
assert.throws(() => context.youtubePayload('https://youtu.be/example', '00:30', '00:30'), /posterior/);
assert.throws(() => context.youtubePayload('https://youtu.be/example', '01:00', '00:59'), /posterior/);
console.log('YouTube mm:ss: conversão numérica, formatos inválidos, virada de minuto, intervalos de 0/45/46 s e limites verificados.');
