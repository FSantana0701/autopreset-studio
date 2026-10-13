"use strict";

// Testa o núcleo binário (MK300PresetHandler) extraído do index.html publicado,
// sem duplicar a classe. Execute com:  node tests/mk300-binary.test.cjs
//
// Os offsets abaixo são LITERAIS e vêm do mapa do preset v73 (jpfaria/mvave,
// docs/protocol.md), não do código do site. Assim, se o site mudar um offset
// por engano, o teste falha em vez de concordar com o erro.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const nodeTest = require("node:test");
const vm = require("node:vm");
const cases = [];
const test = (...args) => cases.push(args);

// Arquivo a testar: por padrão o index.html publicado; HTML_PATH permite testar outro.
const htmlPath = process.env.HTML_PATH
  ? path.resolve(process.env.HTML_PATH)
  : path.join(__dirname, "index.html");
const html = fs.readFileSync(htmlPath, "utf8");
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map(match => match[1]);
const core = scripts.find(source => source.includes('// Núcleo binário extraído'));
assert.ok(core, "Núcleo binário deve estar incorporado no HTML publicado");
const sandbox = { ArrayBuffer, DataView, Error, TextEncoder, Uint8Array, Array, Set, Object, Number };
vm.runInNewContext(core, sandbox);
const MK300PresetHandler = sandbox.MK300Core.MK300PresetHandler;
sandbox.__consts = Object.fromEntries(['KNOBS_START', 'BLOCK_STRIDE'].map(name => {
  const match = core.match(new RegExp(`const ${name}\\s*=\\s*(0x[0-9a-f]+|[0-9]+)`, 'i'));
  assert.ok(match, `${name} deve existir no núcleo publicado`);
  return [name, Number(match[1])];
}));

const BLOCK = { WAH: 0, FX: 1, GATE: 2, DS: 3, AMP: 4, CAB: 5, EQ: 6, MOD: 7, DLY: 8, REV: 9, VOL: 10 };
const FIXTURES_DIR = path.join(__dirname, "fixtures");
const fixtures = fs.existsSync(FIXTURES_DIR)
  ? fs.readdirSync(FIXTURES_DIR).filter(name => name.toLowerCase().endsWith(".dzh"))
  : [];

// Base sintética com bytes distintos em todas as posições (detecta escrita fora do lugar).
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

// Lista os offsets que mudaram entre dois buffers.
function changedOffsets(before, after) {
  const out = [];
  for (let i = 0; i < before.length; i++) if (before[i] !== after[i]) out.push(i);
  return out;
}

// Só os offsets esperados podem mudar (e, se `exact`, todos devem ter mudado).
function assertOnlyChanged(before, after, allowed, label) {
  const allowedSet = new Set(allowed);
  const stray = changedOffsets(before, after).filter(i => !allowedSet.has(i));
  assert.deepEqual(stray, [], `${label}: bytes inesperados alterados nos offsets ${stray.map(i => "0x" + i.toString(16)).join(", ")}`);
}

// ---------------------------------------------------------------------------
// Constantes e mapa de offsets
// ---------------------------------------------------------------------------

test("o HTML usa os offsets do mapa v73 (KNOBS_START 0x42, bloco de 24 bytes)", () => {
  assert.equal(sandbox.__consts.KNOBS_START, 0x42);
  assert.equal(sandbox.__consts.BLOCK_STRIDE, 24);
});

test("knobs ficam nos offsets literais do mapa (0x42 + 24*bloco + 2*knob)", () => {
  // Valores calculados à mão: AMP = bloco 4 -> 0x42 + 96 = 0xA2; DS = bloco 3 -> 0x8A;
  // DLY = bloco 8 -> 0x42 + 192 = 0x102; VOL = bloco 10 -> 0x42 + 240 = 0x132.
  const cases2 = [
    [BLOCK.AMP, 0, 0xa2], [BLOCK.AMP, 4, 0xaa], [BLOCK.DS, 0, 0x8a],
    [BLOCK.DLY, 0, 0x102], [BLOCK.DLY, 6, 0x10e], [BLOCK.VOL, 0, 0x132], [BLOCK.VOL, 11, 0x148]
  ];
  for (const [block, knob, offset] of cases2) {
    const base = freshBase();
    const handler = new MK300PresetHandler(base);
    handler.setKnobValue(block, knob, 0x1234);
    const out = handler.compile();
    assert.equal(out[offset], 0x34, `bloco ${block} knob ${knob} byte baixo`);
    assert.equal(out[offset + 1], 0x12, `bloco ${block} knob ${knob} byte alto`);
    assertOnlyChanged(base, out, [offset, offset + 1], `bloco ${block} knob ${knob}`);
  }
});

// ---------------------------------------------------------------------------
// Validação de entrada
// ---------------------------------------------------------------------------

test("aceita somente bases com exatamente 448 bytes", () => {
  assert.doesNotThrow(() => new MK300PresetHandler(new Uint8Array(448)));
  for (const size of [0, 447, 449]) {
    assert.throws(() => new MK300PresetHandler(new Uint8Array(size)), /448 bytes/);
  }
  assert.throws(() => new MK300PresetHandler("448 bytes"), /Uint8Array ou ArrayBuffer/);
});

test("aceita ArrayBuffer de 448 bytes", () => {
  const base = freshBase();
  const handler = new MK300PresetHandler(base.buffer.slice(0));
  assert.deepEqual(handler.compile(), base);
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

// ---------------------------------------------------------------------------
// Cabeçalho: nome, volume, BPM
// ---------------------------------------------------------------------------

test("escreve nome UTF-8 e respeita o limite de 19 bytes", () => {
  const handler = new MK300PresetHandler(freshBase());
  const name = "Á".repeat(9) + "A"; // 19 bytes UTF-8.
  handler.setName(name);
  assert.equal(new TextEncoder().encode(name).length, 19);
  assert.equal(decodeStoredName(handler.compile()), name);
  assert.throws(() => handler.setName("Á".repeat(10)), /19 bytes UTF-8/);
  assert.throws(() => handler.setName("   "), /Informe o nome/);
  assert.throws(() => handler.setName(42), /texto/);
});

test("nome mais curto zera o restante do campo (0x00–0x13) e não toca 0x14", () => {
  const base = freshBase();
  const handler = new MK300PresetHandler(base);
  handler.setName("AB");
  const out = handler.compile();
  assert.deepEqual(Array.from(out.slice(0, 4)), [0x41, 0x42, 0, 0]);
  assert.ok(out.slice(2, 0x14).every(b => b === 0), "restante do campo de nome deve ser 0");
  assertOnlyChanged(base, out, Array.from({ length: 0x14 }, (_, i) => i), "nome");
});

test("volume do preset em 0x18 (u16 little-endian, 1–100)", () => {
  const base = freshBase();
  const handler = new MK300PresetHandler(base);
  handler.setPresetVolume(77);
  const out = handler.compile();
  assert.equal(out[0x18], 77);
  assert.equal(out[0x19], 0);
  assertOnlyChanged(base, out, [0x18, 0x19], "volume");
  for (const bad of [0, 101, 1.5, -1]) {
    assert.throws(() => new MK300PresetHandler(freshBase()).setPresetVolume(bad), /Volume geral/);
  }
});

test("escreve BPM uint16 little-endian em 0x1A nas extremidades válidas", () => {
  for (const bpm of [1, 140, 255, 256, 65535]) {
    const base = freshBase();
    const output = new MK300PresetHandler(base);
    output.setBpm(bpm);
    const bytes = output.compile();
    assert.equal(bytes[0x1a], bpm & 0xff);
    assert.equal(bytes[0x1b], bpm >> 8);
    assertOnlyChanged(base, bytes, [0x1a, 0x1b], `BPM ${bpm}`);
  }
  assert.throws(() => new MK300PresetHandler(freshBase()).setBpm(0), /BPM/);
  assert.throws(() => new MK300PresetHandler(freshBase()).setBpm(65536), /BPM/);
  assert.throws(() => new MK300PresetHandler(freshBase()).setBpm(1.5), /BPM/);
});

test("campos de cabeçalho desconhecidos (0x14–0x17, Pan 0x1C–0x1F) são preservados", () => {
  const base = freshBase();
  const handler = new MK300PresetHandler(base);
  handler.setName("X");
  handler.setBpm(99);
  handler.setPresetVolume(50);
  handler.setChainOrder([10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0]);
  const out = handler.compile();
  assert.deepEqual(out.slice(0x14, 0x18), base.slice(0x14, 0x18));
  assert.deepEqual(out.slice(0x1c, 0x20), base.slice(0x1c, 0x20));
});

// ---------------------------------------------------------------------------
// Blocos: estados, modelos, knobs, cadeia
// ---------------------------------------------------------------------------

test("escreve os 11 estados on/off em 0x2B + bloco, sem tocar nos vizinhos", () => {
  const base = freshBase();
  const handler = new MK300PresetHandler(base);
  for (let block = 0; block <= 10; block++) handler.setBlockState(block, block % 2 === 0);
  const bytes = handler.compile();
  for (let block = 0; block <= 10; block++) assert.equal(bytes[0x2b + block], block % 2 === 0 ? 1 : 0);
  assertOnlyChanged(base, bytes, Array.from({ length: 11 }, (_, i) => 0x2b + i), "estados on/off");
  assert.throws(() => handler.setBlockState(11, true), /ID do bloco/);
  assert.throws(() => handler.setBlockState(-1, true), /ID do bloco/);
  assert.throws(() => handler.setBlockState(BLOCK.AMP, 1), /booleano/);
});

test("escreve índices de modelo em 0x36 + bloco e preserva o byte 0x41", () => {
  const base = freshBase();
  const handler = new MK300PresetHandler(base);
  for (let block = 0; block <= 10; block++) {
    const model = block * 17;
    handler.setBlockModel(block, model);
    assert.equal(handler.getBlockModel(block), model);
  }
  const bytes = handler.compile();
  for (let block = 0; block <= 10; block++) assert.equal(bytes[0x36 + block], block * 17);
  assert.equal(bytes[0x41], base[0x41], "byte de preenchimento 0x41 deve ser preservado");
  assertOnlyChanged(base, bytes, Array.from({ length: 11 }, (_, i) => 0x36 + i), "modelos");
  assert.throws(() => handler.setBlockModel(11, 0), /ID do bloco/);
  assert.throws(() => handler.setBlockModel(BLOCK.AMP, 256), /Índice do modelo/);
  assert.throws(() => handler.setBlockModel(BLOCK.AMP, -1), /Índice do modelo/);
});

test("escreve e lê knobs int16 little-endian, com sinal e limites", () => {
  const handler = new MK300PresetHandler(freshBase());
  const values = [[-32768, 4, 0], [-1, 3, 1], [0, 4, 2], [32767, 10, 11], [-60, 2, 0]];
  for (const [value, block, knob] of values) handler.setKnobValue(block, knob, value);
  const bytes = handler.compile();
  const view = new DataView(bytes.buffer);
  for (const [value, block, knob] of values) {
    const offset = 0x42 + 24 * block + 2 * knob;
    assert.equal(handler.getKnobValue(block, knob), value);
    assert.equal(view.getInt16(offset, true), value);
  }
  // Gate Thd -60 = C4 FF (documentado no mapa v73).
  assert.deepEqual(Array.from(bytes.slice(0x42 + 48, 0x42 + 50)), [0xc4, 0xff]);
  assert.throws(() => handler.setKnobValue(BLOCK.AMP, 0, -32769), /Int16/);
  assert.throws(() => handler.setKnobValue(BLOCK.AMP, 0, 32768), /Int16/);
  assert.throws(() => handler.setKnobValue(BLOCK.AMP, 0, 1.5), /Int16/);
  assert.throws(() => handler.setKnobValue(BLOCK.AMP, 12, 0), /Índice do knob/);
  assert.throws(() => handler.setKnobValue(11, 0, 0), /ID do bloco/);
});

test("AMP/DS têm 8 knobs (Gain, Level, Bass, Middle, Treble, Reso, Pres, Bright) graváveis", () => {
  // Reso/Pres/Bright são os knobs 5, 6 e 7 no mapa v73 (catálogo mvave).
  const base = freshBase();
  const handler = new MK300PresetHandler(base);
  for (const block of [BLOCK.DS, BLOCK.AMP]) {
    for (const knob of [5, 6, 7]) handler.setKnobValue(block, knob, 10 * knob);
  }
  const out = handler.compile();
  for (const block of [BLOCK.DS, BLOCK.AMP]) {
    for (const knob of [5, 6, 7]) {
      assert.equal(out[0x42 + 24 * block + 2 * knob], 10 * knob);
    }
  }
});

test("valida a cadeia como permutação exata dos blocos 0 a 10 em 0x20", () => {
  const base = freshBase();
  const handler = new MK300PresetHandler(base);
  const expected = [4, 3, 5, 0, 1, 2, 6, 7, 8, 9, 10];
  handler.setChainOrder(expected);
  const out = handler.compile();
  assert.deepEqual(Array.from(out.slice(0x20, 0x2b)), expected);
  assertOnlyChanged(base, out, Array.from({ length: 11 }, (_, i) => 0x20 + i), "cadeia");
  for (const invalid of [
    expected.slice(0, 10),
    [...expected, 0],
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9],
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 11],
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, "10"],
    "0123456789A"
  ]) assert.throws(() => handler.setChainOrder(invalid), /cadeia|blocos/i);
});

// ---------------------------------------------------------------------------
// Região reservada e round-trip
// ---------------------------------------------------------------------------

test("mantém a região reservada 330–447 (0x14A em diante) igual à base", () => {
  const base = freshBase();
  const before = base.slice(330);
  const handler = new MK300PresetHandler(base);
  handler.setName("Tail preservada");
  handler.setBpm(120);
  handler.setKnobValue(BLOCK.VOL, 11, -1234); // Último knob termina no byte 329.
  const output = handler.compile();
  assert.deepEqual(output.slice(330), before);
  assert.deepEqual(base.slice(330), before);
});

test("o último knob do VOL termina exatamente antes da região reservada", () => {
  const base = freshBase();
  const handler = new MK300PresetHandler(base);
  handler.setKnobValue(BLOCK.VOL, 11, 0x7fff);
  const out = handler.compile();
  assert.equal(out[328], 0xff);
  assert.equal(out[329], 0x7f);
  assert.equal(out[330], base[330]);
});

test("round-trip binário sem edição retorna os mesmos 448 bytes", () => {
  const imported = freshBase();
  assert.deepEqual(new MK300PresetHandler(imported).compile(), imported);
});

test("escrever os mesmos valores já presentes não altera o arquivo", () => {
  const imported = freshBase();
  const handler = new MK300PresetHandler(imported);
  const view = new DataView(imported.buffer);
  handler.setBpm(view.getUint16(0x1a, true));
  handler.setBlockModel(BLOCK.AMP, imported[0x36 + BLOCK.AMP]);
  handler.setKnobValue(BLOCK.AMP, 0, view.getInt16(0x42 + 24 * BLOCK.AMP, true));
  assert.deepEqual(handler.compile(), imported);
});

// ---------------------------------------------------------------------------
// Catálogo: índice do Sync por modelo de delay
// ---------------------------------------------------------------------------

test("DLY_SYNC do site coincide com o catálogo v73 (mvave) para os 27 modelos de delay", () => {
  // Fonte: jpfaria/mvave docs/catalog.md (firmware V73). Índice do knob "Sync" por modelo:
  // Clean 3, Modern 5, Echo 3, Analog 3, Duck..Pattern 6, Ice 5, Reverse 5, e os stereo.
  const expected = [3, 5, 3, 3, 6, 6, 6, 6, 6, 6, 6, 5, 5, 3, 3, 3, 3, 6, 6, 6, 6, 6, 6, 6, 5, 5, 5];
  const match = html.match(/const DLY_SYNC\s*=\s*(\[[^\]]+\])/);
  assert.ok(match, "DLY_SYNC não encontrado no HTML");
  assert.deepEqual(JSON.parse(match[1]), expected);
});

// ---------------------------------------------------------------------------
// Fixtures reais (.dzh exportados do M-EFCS) em tests/fixtures/
// ---------------------------------------------------------------------------

if (fixtures.length === 0) {
  test("round-trip sem edição de fixtures reais .dzh", { skip: "Adicione arquivos .dzh reais em tests/fixtures/ para habilitar." }, () => {});
} else {
  for (const fixture of fixtures) {
    test(`fixture ${fixture}: 448 bytes, round-trip sem edição e cadeia válida`, () => {
      const imported = new Uint8Array(fs.readFileSync(path.join(FIXTURES_DIR, fixture)));
      assert.equal(imported.length, 448, `${fixture} deve ter 448 bytes`);
      assert.deepEqual(new MK300PresetHandler(imported).compile(), imported);
      const order = Array.from(imported.slice(0x20, 0x2b));
      assert.deepEqual([...order].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "cadeia deve ser permutação de 0–10");
      assert.ok(Array.from(imported.slice(0x2b, 0x36)).every(b => b === 0 || b === 1), "estados devem ser 0 ou 1");
    });

    // Verificação de sanidade: nos presets de fábrica estes bytes são constantes (pode não valer em presets de usuário).
    test(`fixture ${fixture}: marcadores dos presets de fábrica (informativo)`, t => {
      const imported = new Uint8Array(fs.readFileSync(path.join(FIXTURES_DIR, fixture)));
      const header = Array.from(imported.slice(0x14, 0x18)).map(b => b.toString(16).padStart(2, "0")).join(" ");
      const tail = imported[0x1bf].toString(16).padStart(2, "0");
      t.diagnostic(`0x14–0x17 = ${header} (fábrica: ff 90 1e 00); 0x1BF = ${tail} (fábrica: 45)`);
    });
  }
}

// Registra os casos dentro de uma suíte para manter saída consistente em `node --test`.
nodeTest("MK-300 · núcleo binário", async suite => {
  for (const args of cases) await suite.test(...args);
});
