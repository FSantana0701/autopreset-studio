const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
const output = process.argv[2]
  ? path.resolve(root, process.argv[2])
  : path.resolve(root, '..', 'index.html');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const asset of ['data/v73.js', 'data/v73-parameters.js', 'core/mk300-preset-handler.js', 'integrations/tone3000-select.js', 'integrations/audio-separation.js', 'config.js']) {
  const tag = `<script src="${asset}"></script>`;
  if (!html.includes(tag)) throw new Error(`Tag ausente: ${tag}`);
  const source = fs.readFileSync(path.join(root, asset), 'utf8');
  html = html.replace(tag, `<script>\n${source}\n</script>`);
}
if (/<script\s+src=/i.test(html)) throw new Error('O HTML autônomo não pode carregar JavaScript externo.');
fs.writeFileSync(output, html);
// Mantém o endereço de upload já existente e seu uso autônomo/offline.
if (output === path.resolve(root, '..', 'index.html')) {
  fs.writeFileSync(path.resolve(root, '..', 'index (1).html'), html);
}
console.log(output);
