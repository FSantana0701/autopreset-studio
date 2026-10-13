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
  $: id => ({ value: id === 'apiKey' ? 'sk-ant-test' : 'claude-sonnet-5-5' }),
  fetchClaudeWithRetry: async request => { captured.request = request; return { ok: true, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{"preset_name":"Smoke test"}' }] }) }; },
  makeProviderError: (...args) => new Error(args.join(' ')),
  JSON, Object, Array, Set, Error
});
vm.runInContext(main.slice(start, end), context);
(async () => {
  const result = await vm.runInContext('fetchClaudeJson({prompt:"preset request",systemPrompt:"system"})', context);
  assert.equal(result.preset_name, 'Smoke test');
  assert.equal(captured.request.url, 'https://api.anthropic.com/v1/messages');
  const { headers } = captured.request.options;
  assert.equal(headers['x-api-key'], 'sk-ant-test');
  assert.equal(headers['anthropic-version'], '2023-06-01');
  assert.equal(headers['anthropic-dangerous-direct-browser-access'], 'true');
  const body = JSON.parse(captured.request.options.body);
  assert.equal(body.model, 'claude-sonnet-5-5');
  assert.equal(body.messages[0].content, 'preset request');
  assert.equal(body.output_config.format.type, 'json_schema');
  console.log('Claude adapter: endpoint, autenticação, schema e resposta verificados.');
})().catch(error => { console.error(error); process.exitCode = 1; });
