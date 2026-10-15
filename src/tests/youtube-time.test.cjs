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
const payload = context.youtubePayload('https://youtu.be/z3JhXn_onsw', '02:16', '02:56');
assert.equal(payload.start_seconds, 136);
assert.equal(payload.end_seconds, 176);
assert.equal(payload.firmware, 'v75');
assert.equal(context.youtubePayload('https://youtu.be/z3JhXn_onsw', '00:59', '01:44').end_seconds, 104);
assert.throws(() => context.youtubePayload('https://youtu.be/z3JhXn_onsw', '00:59', '01:45'), /ultrapassa 45/);
assert.throws(() => context.youtubePayload('https://youtu.be/z3JhXn_onsw', '00:30', '00:30'), /posterior/);
assert.throws(() => context.youtubePayload('https://youtu.be/z3JhXn_onsw', '01:00', '00:59'), /posterior/);
console.log('YouTube mm:ss: conversão numérica, formatos inválidos, virada de minuto, intervalos de 0/45/46 s e limites verificados.');
const canonical='https://www.youtube.com/watch?v=z3JhXn_onsw';
for(const url of [
 'https://youtu.be/z3JhXn_onsw?is=shared&si=tracking&t=500#share',
 'https://youtu.be/z3JhXn_onsw?si=tracking',
 'https://youtu.be/z3JhXn_onsw?is=',
 'https://www.youtube.com/watch?v=z3JhXn_onsw&si=tracking&list=playlist&t=1',
 'https://m.youtube.com/watch?si=tracking&v=z3JhXn_onsw',
 'https://youtube.com/shorts/z3JhXn_onsw?feature=shared',
 'https://youtube.com/embed/z3JhXn_onsw',
 'http://music.youtube.com/live/z3JhXn_onsw'
]) {
 const clean=context.youtubePayload(url,'3:44','3:54');
 assert.equal(clean.url,canonical);
 assert.equal(clean.start_seconds,224);
 assert.equal(clean.end_seconds,234);
 assert.ok(Number.isInteger(clean.start_seconds)&&Number.isInteger(clean.end_seconds));
}
for(const url of [
 'https://youtube.com.attacker.example/watch?v=z3JhXn_onsw',
 'https://youtu.be/invalid?si=tracking',
 'https://youtube.com/redirect?v=z3JhXn_onsw',
 'https://user:password@youtube.com/watch?v=z3JhXn_onsw',
 'https://youtu.be/z3JhXn_onsw/extra',
 'https://youtube.com/channel/z3JhXn_onsw'
])assert.throws(()=>context.sanitizeYoutubeUrl(url),/link/);
console.log('Links compartilhados: rastreamento removido, ID validado, URL HTTPS canônica e payload inteiro 224–234 verificados.');
