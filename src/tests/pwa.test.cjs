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
assert.match(serviceWorker, /CACHE_NAME\s*=\s*['"]autopreset-studio-shell-v5['"]/, 'a atualização usa o HTML sem separador');

for (const [filename, expectedSize] of [['autopreset-192.png', 192], ['autopreset-512.png', 512]]) {
  const image = fs.readFileSync(path.join(appRoot, 'icons', filename));
  assert.equal(image.toString('hex', 0, 8), '89504e470d0a1a0a', filename + ': assinatura PNG');
  assert.equal(image.readUInt32BE(16), expectedSize, filename + ': largura');
  assert.equal(image.readUInt32BE(20), expectedSize, filename + ': altura');
}

console.log('PWA: manifesto, registro do service worker e ícones instaláveis verificados.');

const vm = require('node:vm');
const deleted = [], handlers = {};
vm.runInNewContext(serviceWorker, {
 self:{addEventListener:(event,handler)=>handlers[event]=handler,clients:{claim:async()=>{}}},
 caches:{keys:async()=>['autopreset-studio-shell-v4','autopreset-studio-shell-v5','autopreset-local-model-v1','other-app-cache'],delete:async key=>deleted.push(key)}
});
let activation;
handlers.activate({waitUntil:promise=>activation=promise});
activation.then(()=>{
 assert.deepEqual(deleted.sort(),['autopreset-local-model-v1','autopreset-studio-shell-v4']);
 console.log('PWA: remove cache antigo do modelo sem apagar caches de outros apps.');
}).catch(error=>{console.error(error);process.exitCode=1;});
