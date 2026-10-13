const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.resolve(__dirname, '../index.html'), 'utf8');
const main = [...html.matchAll(/<script(?![^>]*\bsrc=)(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]).join('\n');
const start = main.indexOf('function makeClaudeStrictSchema(');
const end = main.indexOf('\nfunction validateAITone(', start);
assert.ok(start >= 0 && end > start, 'adapter Claude encontrado');
const captured = {};
const toneSchema = { type: 'object', additionalProperties: false, properties: { preset_name: { type: 'string' }, nam_query: { type: 'string' } }, required: ['preset_name'] };
const context = vm.createContext({
  AI_OPTIONAL_BLOCKS: {}, AI_OPTIONAL_FIELDS: [],
  makeToneSchema: () => toneSchema,
  makeMultiSchema: () => ({ type: 'array', items: toneSchema }),
  window: { AUTO_PRESET_API: 'https://service.example.test' },
  getAutoPresetApi: () => 'https://service.example.test',
  fetchClaudeWithRetry: async request => { captured.request = request; return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"preset_name":"Smoke test"}' }] }) }; },
  makeProviderError: (...args) => new Error(args.join(' ')),
  JSON, Object, Array, Set, Error
});
vm.runInContext(main.slice(start, end), context);
(async () => {
  const result = await vm.runInContext('fetchClaudeJson({prompt:"preset request",systemPrompt:"system"})', context);
  assert.equal(result.preset_name, 'Smoke test');
  assert.equal(captured.request.url, 'https://service.example.test/v1/suggest');
  const { headers } = captured.request.options;
  assert.equal(headers['Content-Type'], 'application/json');
  assert.equal(Object.keys(headers).some(key => /key|authorization/i.test(key)), false);
  const body = JSON.parse(captured.request.options.body);
  assert.equal(body.prompt, 'preset request');
  assert.equal(body.system_prompt, 'system');
  assert.equal(body.schema.type, 'object');
  console.log('Assistente: proxy seguro, schema e resposta verificados sem credencial no navegador.');
})().catch(error => { console.error(error); process.exitCode = 1; });
