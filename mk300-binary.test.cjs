"use strict";

// Testa o núcleo binário do HTML publicado anteriormente sem duplicar a classe.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const nodeTest = require("node:test");
const vm = require("node:vm");
const cases = [];
const test = (...args) => cases.push(args);

const htmlPath = path.join(__dirname, "..", "AutoPreset_MK300_V27_Claude.html");
const html = fs.readFileSync(htmlPath, "utf8");

function extractBetween(startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  if (start < 0) throw new Error(`Não encontrei no HTML: ${startMarker}`);
  const end = html.indexOf(endMarker, start);
  if (end < 0) throw new Error(`Não encontrei no HTML: ${endMarker}`);
  return html.slice(start, end);
}

const helpers = [
  extractBetween("function knobOffset(", "\nclass MK300PresetHandler"),
  extractBetween("function validateChain(", "\nfunction moveBlock")
].join("\n");
const classSource = extractBetween(
  "class MK300PresetHandler {",
  "\n\n// Disponível na consola para uma verificação rápida do núcleo binário."
);
const sandbox = { ArrayBuffer, DataView, Error, TextEncoder, Uint8Array, KNOBS_START: 0x42, BLOCK_STRIDE: 24 };
vm.runInNewContext(`${helpers}\n${classSource}\nglobalThis.MK300PresetHandler = MK300PresetHandler;`, sandbox);
const MK300PresetHandler = sandbox.MK300PresetHandler;

const BLOCK = { WAH: 0, FX: 1, GATE: 2, DS: 3, AMP: 4, CAB: 5, EQ: 6, MOD: 7, DLY: 8, REV: 9, VOL: 10 };
const KNOBS_START = 0x42;
const BLOCK_STRIDE = 24;
const FIXTURES_DIR = path.join(__dirname, "fixtures");
const fixtures = fs.existsSync(FIXTURES_DIR)
  ? fs.readdirSync(FIXTURES_DIR).filter(name => name.toLowerCase().endsWith(".dzh"))
  : [];

function freshBase() {
  const bytes = Uint8Array.from({ length: 448 }, (_, i) => (i * 37 + 11) & 0xff);
  bytes.set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0x20);
  bytes.fill(0, 0x2b, 0x36);
  return bytes;
}

function decodeStoredName(bytes) {
  const field = bytes.subarray(0, 0x14);
  const end = field.indexOf(0);
  return new TextDecoder("utf-8", { fatal: true }).decode(field.subarray(0, end < 0 ? field.length : end));
}

function knobOffset(blockId, knobIndex) {
  return KNOBS_START + BLOCK_STRIDE * blockId + knobIndex * 2;
}

test("aceita somente bases com exatamente 448 bytes", () => {
  assert.doesNotThrow(() => new MK300PresetHandler(new Uint8Array(448)));
  for (const size of [0, 447, 449]) {
    assert.throws(() => new MK300PresetHandler(new Uint8Array(size)), /448 bytes/);
  }
  assert.throws(() => new MK300PresetHandler("448 bytes"), /Uint8Array ou ArrayBuffer/);
});

test("respeita byteOffset de uma view e não modifica a base recebida", () => {
  const padded = new Uint8Array(460).fill(0x5a);
  const view = padded.subarray(6, 454);
  view.set(freshBase());
  const before = new Uint8Array(view);
  const handler = new MK300PresetHandler(view);
  handler.setName("Teste");
  handler.setBpm(140);
  assert.deepEqual(view, before);
  assert.deepEqual(handler.compile().slice(330), before.slice(330));
});

test("escreve nome UTF-8 e respeita o limite de 19 bytes", () => {
  const handler = new MK300PresetHandler(freshBase());
  const name = "Á".repeat(9) + "A"; // 19 bytes UTF-8.
  handler.setName(name);
  assert.equal(new TextEncoder().encode(name).length, 19);
  assert.equal(decodeStoredName(handler.compile()), name);
  assert.throws(() => handler.setName("Á".repeat(10)), /19 bytes UTF-8/);
  assert.throws(() => handler.setName("   "), /Informe o nome/);
});

test("escreve BPM uint16 little-endian nas extremidades válidas", () => {
  for (const bpm of [1, 140, 65535]) {
    const output = new MK300PresetHandler(freshBase());
    output.setBpm(bpm);
    const bytes = output.compile();
    assert.equal(new DataView(bytes.buffer).getUint16(0x1a, true), bpm);
  }
  assert.throws(() => new MK300PresetHandler(freshBase()).setBpm(0), /BPM/);
  assert.throws(() => new MK300PresetHandler(freshBase()).setBpm(65536), /BPM/);
  assert.throws(() => new MK300PresetHandler(freshBase()).setBpm(1.5), /BPM/);
});

test("escreve os 11 estados on/off nos offsets físicos", () => {
  const handler = new MK300PresetHandler(freshBase());
  for (let block = 0; block <= 10; block++) {
    handler.setBlockState(block, block % 2 === 0);
  }
  const bytes = handler.compile();
  for (let block = 0; block <= 10; block++) {
    assert.equal(bytes[0x2b + block], block % 2 === 0 ? 1 : 0);
  }
  assert.throws(() => handler.setBlockState(11, true), /ID do bloco/);
  assert.throws(() => handler.setBlockState(BLOCK.AMP, 1), /booleano/);
});

test("escreve e lê índices de modelo de cada bloco", () => {
  const handler = new MK300PresetHandler(freshBase());
  for (let block = 0; block <= 10; block++) {
    const model = block * 17;
    handler.setBlockModel(block, model);
    assert.equal(handler.getBlockModel(block), model);
  }
  const bytes = handler.compile();
  for (let block = 0; block <= 10; block++) assert.equal(bytes[0x36 + block], block * 17);
  assert.throws(() => handler.setBlockModel(11, 0), /ID do bloco/);
  assert.throws(() => handler.setBlockModel(BLOCK.AMP, 256), /Índice do modelo/);
});

test("escreve e lê knobs int16 little-endian, com sinal e limites", () => {
  const handler = new MK300PresetHandler(freshBase());
  const values = [[-32768, 4, 0], [-1, 3, 1], [0, 4, 2], [32767, 10, 11]];
  for (const [value, block, knob] of values) handler.setKnobValue(block, knob, value);
  const bytes = handler.compile();
  const view = new DataView(bytes.buffer);
  for (const [value, block, knob] of values) {
    const offset = knobOffset(block, knob);
    assert.equal(handler.getKnobValue(block, knob), value);
    assert.equal(view.getInt16(offset, true), value);
  }
  assert.throws(() => handler.setKnobValue(BLOCK.AMP, 0, -32769), /Int16/);
  assert.throws(() => handler.setKnobValue(BLOCK.AMP, 0, 32768), /Int16/);
  assert.throws(() => handler.setKnobValue(BLOCK.AMP, 12, 0), /Índice do knob/);
  assert.throws(() => handler.setKnobValue(11, 0, 0), /ID do bloco/);
});

test("valida a cadeia como permutação exata dos blocos 0 a 10", () => {
  const handler = new MK300PresetHandler(freshBase());
  const expected = [4, 3, 5, 0, 1, 2, 6, 7, 8, 9, 10];
  handler.setChainOrder(expected);
  assert.deepEqual(Array.from(handler.compile().slice(0x20, 0x2b)), expected);
  for (const invalid of [
    expected.slice(0, 10),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9],
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11],
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, "10"]
  ]) assert.throws(() => handler.setChainOrder(invalid), /cadeia|blocos/i);
});

test("mantém a região reservada 330–447 igual à base", () => {
  const base = freshBase();
  const before = base.slice(330);
  const handler = new MK300PresetHandler(base);
  handler.setName("Tail preservada");
  handler.setBpm(120);
  handler.setKnobValue(BLOCK.VOL, 11, -1234); // Último knob permitido termina no byte 329.
  const output = handler.compile();
  assert.deepEqual(output.slice(330), before);
  assert.deepEqual(base.slice(330), before);
});

test("round-trip binário sem edição retorna os mesmos 448 bytes", () => {
  const imported = freshBase();
  assert.deepEqual(new MK300PresetHandler(imported).compile(), imported);
});

if (fixtures.length === 0) {
  test("round-trip sem edição de fixtures reais .dzh", { skip: "Adicione arquivos .dzh reais em tests/fixtures/ para habilitar." }, () => {});
} else {
  for (const fixture of fixtures) {
    test(`round-trip sem edição da fixture ${fixture}`, () => {
      const imported = new Uint8Array(fs.readFileSync(path.join(FIXTURES_DIR, fixture)));
      assert.equal(imported.length, 448, `${fixture} deve ter 448 bytes`);
      assert.deepEqual(new MK300PresetHandler(imported).compile(), imported);
    });
  }
}

// Registra os casos dentro de uma suíte para manter saída consistente em `node --test`.
nodeTest("MK-300 · núcleo binário", async suite => {
  for (const args of cases) await suite.test(...args);
});
