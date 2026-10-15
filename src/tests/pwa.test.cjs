const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '../..');
const html = fs.readFileSync(path.join(appRoot, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(appRoot, 'manifest.webmanifest'), 'utf8'));
const serviceWorker = fs.readFileSync(path.join(appRoot, 'sw.js'), 'utf8');

assert.equal(manifest.display, 'standalone');
assert.equal(manifest.start_url, './');
assert.match(html, /rel=["']manifest["'][^>]*href=["']\.\/manifest\.webmanifest["']/i);
assert.match(html, /navigator\.serviceWorker\.register\(['"]\.\/sw\.js['"]\)/);
assert.match(serviceWorker, /addEventListener\(['"]install['"]/);
assert.match(serviceWorker, /addEventListener\(['"]fetch['"]/);
assert.match(serviceWorker, /key\.startsWith\(['"]autopreset-studio-shell-['"]\)/, 'atualizações invalidam o HTML antigo');
assert.match(serviceWorker, /CACHE_NAME\s*=\s*['"]shell-v10['"]/, 'a atualização usa o HTML sem separador');

for (const [filename, expectedSize] of [['autopreset-192.png', 192], ['autopreset-512.png', 512]]) {
  const image = fs.readFileSync(path.join(appRoot, 'icons', filename));
  assert.equal(image.toString('hex', 0, 8), '89504e470d0a1a0a', filename + ': assinatura PNG');
  assert.equal(image.readUInt32BE(16), expectedSize, filename + ': largura');
  assert.equal(image.readUInt32BE(20), expectedSize, filename + ': altura');
}

console.log('PWA: manifesto, registro do service worker e ícones instaláveis verificados.');

const vm = require('node:vm');
const deleted = [], handlers = {}, entries = new Map();
let offline = false, networkBody = 'updated V75', networkCalls = 0, claimed = false, installed;
const keyOf = value => typeof value === 'string' ? new URL(value, 'https://example.test/autopreset-studio/').href : value.url;
const cache = {
 addAll: async requests => { installed = requests; },
 match: async request => entries.get(keyOf(request)),
 put: async (request, response) => entries.set(keyOf(request), response)
};
vm.runInNewContext(serviceWorker, {
 URL, Request, Set,
 self:{registration:{scope:'https://example.test/autopreset-studio/'},addEventListener:(event,handler)=>handlers[event]=handler,skipWaiting:async()=>{},clients:{claim:async()=>{claimed=true;}}},
 caches:{open:async()=>cache,keys:async()=>['shell-v10','shell-v9','shell-v8','shell-v7','shell-v6','autopreset-studio-shell-v6','autopreset-local-model-v1','other-app-cache'],delete:async key=>deleted.push(key)},
 fetch:async()=>{networkCalls++;if(offline)throw new Error('offline');return new Response(networkBody);}
});
async function lifecycle(name) { let pending;handlers[name]({waitUntil:promise=>pending=promise});await pending; }
async function fetchEvent(path, {navigate=false, authorization=false, method='GET'}={}) {
 const url=new URL(path,'https://example.test/autopreset-studio/').href;
 const request={url,method,mode:navigate?'navigate':'cors',headers:new Headers(authorization?{Authorization:'Bearer diagnostic'}:{})};
 let pending;handlers.fetch({request,respondWith:promise=>pending=promise});
 return pending;
}
(async()=>{
 await lifecycle('install');
 assert.ok(installed.every(request=>request.url.startsWith('https://example.test/autopreset-studio/')&&request.cache==='reload'));
 assert.ok(installed.some(request=>request.url.endsWith('/icons/autopreset-192.png')));
 await lifecycle('activate');
 assert.deepEqual(deleted.sort(),['autopreset-local-model-v1','autopreset-studio-shell-v6','shell-v6','shell-v7','shell-v8','shell-v9']);
 assert.ok(claimed,'new worker claims clients');
 let response=await fetchEvent('./index.html',{navigate:true});
 assert.equal(await response.text(),'updated V75');
 networkBody='newer V75';
 response=await fetchEvent('./index.html?version=75',{navigate:true});
 assert.equal(await response.text(),'newer V75','navigation refreshes cached HTML');
 offline=true;
 response=await fetchEvent('./index.html',{navigate:true});
 assert.equal(await response.text(),'newer V75','offline navigation uses refreshed shell');
 const before=networkCalls;
 for(const path of ['../other-app/index.html','./api/presets','./user.wav','https://external.test/api']) {
  assert.equal(await fetchEvent(path),undefined,'non-shell requests pass through');
 }
 assert.equal(await fetchEvent('./index.html',{navigate:true,authorization:true}),undefined);
 assert.equal(await fetchEvent('./index.html',{method:'POST'}),undefined);
 assert.equal(networkCalls,before);
 console.log('PWA: shell-v10, instalação, atualização, offline, escopo, autenticação e preservação de outros caches verificados.');
})().catch(error=>{console.error(error);process.exitCode=1;});
