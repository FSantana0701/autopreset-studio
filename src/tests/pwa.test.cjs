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
assert.match(serviceWorker, /key\.startsWith\(['"]autopreset-studio-shell-['"]\)/, 'atualizações não devem apagar o cache do modelo de áudio');

for (const [filename, expectedSize] of [['autopreset-192.png', 192], ['autopreset-512.png', 512]]) {
  const image = fs.readFileSync(path.join(appRoot, 'icons', filename));
  assert.equal(image.toString('hex', 0, 8), '89504e470d0a1a0a', filename + ': assinatura PNG');
  assert.equal(image.readUInt32BE(16), expectedSize, filename + ': largura');
  assert.equal(image.readUInt32BE(20), expectedSize, filename + ': altura');
}

console.log('PWA: manifesto, registro do service worker e ícones instaláveis verificados.');
