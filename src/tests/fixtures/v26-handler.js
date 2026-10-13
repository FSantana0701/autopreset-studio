// Snapshot de referência do handler V26, usado somente no teste diferencial.
(function(root){
const KNOBS_START=0x42;
const BLOCK_STRIDE=24;
function validateChain(order){if(!Array.isArray(order)||order.length!==11||order.some(id=>!Number.isInteger(id)||id<0||id>10)||new Set(order).size!==11)throw new Error('Cadeia inválida.');return order;}
function knobOffset(blockId,knobIndex){return KNOBS_START+BLOCK_STRIDE*blockId+knobIndex*2;}
class MK300PresetHandler {
  static SIZE = 448;
  static RESERVED_START = 330;
  static BLOCKS = Object.freeze({ WAH: 0, FX: 1, GATE: 2, DS: 3, AMP: 4, CAB: 5, EQ: 6, MOD: 7, DLY: 8, REV: 9, VOL: 10 });
  #original;
  #bytes;
  #view;

  constructor(base) {
    if (!(base instanceof Uint8Array) && !(base instanceof ArrayBuffer)) throw new Error('A base deve ser Uint8Array ou ArrayBuffer.');
    if (base.byteLength !== MK300PresetHandler.SIZE) throw new Error(`Tamanho inválido. Esperado 448 bytes, recebido ${base.byteLength}.`);
    // Respeita byteOffset/byteLength de views e não altera a base recebida.
    this.#original = base instanceof Uint8Array ? new Uint8Array(base) : new Uint8Array(base.slice(0));
    this.#bytes = new Uint8Array(this.#original);
    this.#view = new DataView(this.#bytes.buffer);
  }

  setName(name) {
    if (typeof name !== 'string') throw new Error('Nome do preset deve ser texto.');
    const encoded = new TextEncoder().encode(name.trim());
    if (!encoded.length) throw new Error('Informe o nome do preset.');
    if (encoded.length > 19) throw new Error('O nome excede 19 bytes UTF-8.');
    this.#bytes.fill(0, 0x00, 0x14);
    this.#bytes.set(encoded, 0x00);
  }

  setBpm(value) {
    this.#assertInteger(value, 1, 65535, 'BPM');
    this.#view.setUint16(0x1A, value, true);
  }

  setPresetVolume(value) {
    this.#assertInteger(value, 1, 100, 'Volume geral');
    this.#view.setUint16(0x18, value, true);
  }

  setChainOrder(order) {
    validateChain(order);
    this.#bytes.set(order, 0x20);
  }

  setBlockState(blockId, isOn) {
    this.#assertInteger(blockId, 0, 10, 'ID do bloco');
    if (typeof isOn !== 'boolean') throw new Error('Estado do bloco deve ser booleano.');
    this.#bytes[0x2B + blockId] = isOn ? 1 : 0;
  }

  setBlockModel(blockId, modelIndex) {
    this.#assertInteger(blockId, 0, 10, 'ID do bloco');
    this.#assertInteger(modelIndex, 0, 255, 'Índice do modelo');
    this.#bytes[0x36 + blockId] = modelIndex;
  }

  getBlockModel(blockId) {
    this.#assertInteger(blockId, 0, 10, 'ID do bloco');
    return this.#bytes[0x36 + blockId];
  }

  getKnobValue(blockId, knobIndex) {
    this.#assertInteger(blockId, 0, 10, 'ID do bloco');
    this.#assertInteger(knobIndex, 0, 11, 'Índice do knob');
    return this.#view.getInt16(knobOffset(blockId, knobIndex), true);
  }

  setKnobValue(blockId, knobIndex, value) {
    this.#assertInteger(blockId, 0, 10, 'ID do bloco');
    this.#assertInteger(knobIndex, 0, 11, 'Índice do knob');
    this.#assertInteger(value, -32768, 32767, 'Valor Int16');
    const offset = knobOffset(blockId, knobIndex);
    if (offset + 1 >= MK300PresetHandler.SIZE) throw new Error('Offset do knob fora do ficheiro.');
    if (offset >= MK300PresetHandler.RESERVED_START) throw new Error('O knob invade a região reservada 330–447.');
    this.#view.setInt16(offset, value, true);
  }

  #assertInteger(value, min, max, label) {
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${label} deve ser inteiro entre ${min} e ${max}.`);
  }

  compile() {
    for (let i = MK300PresetHandler.RESERVED_START; i < MK300PresetHandler.SIZE; i++) {
      if (this.#bytes[i] !== this.#original[i]) throw new Error(`Região reservada alterada no offset ${i}.`);
    }
    return new Uint8Array(this.#bytes);
  }
}

root.MK300PresetHandler=MK300PresetHandler;
})(globalThis);
