const fs = require('node:fs');
const path = require('node:path');

const root = __dirname;
require('./data/build-v75.cjs');
const output = process.argv[2]
  ? path.resolve(root, process.argv[2])
  : path.resolve(root, '..', 'index.html');
const outputs = process.argv[2]
  ? [output]
  : [output, path.resolve(root, '..', 'index (1).html')];
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const stylesheet = '<link rel="stylesheet" href="css/style.css">';
if (!html.includes(stylesheet)) throw new Error('Folha de estilos ausente: css/style.css');
html = html.replace(stylesheet, `<style>\n${fs.readFileSync(path.join(root, 'css/style.css'), 'utf8')}\n</style>`);
for (const asset of ['data/v73.js', 'data/v73-parameters.js', 'data/v75.js', 'core/mk300-preset-handler.js', 'integrations/tone3000-select.js', 'integrations/audio-heuristic-analyzer.js', 'js/dsp_local.js', 'integrations/learning-store.js', 'data/john-petrucci-pack.js', 'config.js', 'js/chat-preset.js', 'js/app.js']) {
  const tag = `<script src="${asset}"></script>`;
  if (!html.includes(tag)) throw new Error(`Tag ausente: ${tag}`);
  const source = fs.readFileSync(path.join(root, asset), 'utf8');
  html = html.replace(tag, `<script>\n${source}\n</script>`);
}
if (/<script\s+src=/i.test(html)) throw new Error('O HTML autônomo não pode carregar JavaScript externo.');
for (const destination of outputs) {
  fs.writeFileSync(destination, html);
  console.log(destination);
}
