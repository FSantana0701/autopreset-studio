"""Byte-compatible subset of MK300PresetHandler; reserved bytes stay untouched."""
import base64
import hashlib
import json
from pathlib import Path
import re
import struct

ROOT = Path(__file__).resolve().parents[1]


def reference_presets():
    text = (ROOT/'src/data/john-petrucci-pack.js').read_text(encoding='utf-8')
    entries = json.loads(re.search(r'const presets = (\[.*\]);', text)[1])
    for entry in entries:
        raw = base64.b64decode(entry['base64'], validate=True)
        if len(raw) != 448 or hashlib.sha256(raw).hexdigest() != entry['sha256']:
            raise ValueError('Base de preset corrompida.')
    return entries


class Encoder:
    def __init__(self, base):
        if len(base) != 448:
            raise ValueError('Esperados 448 bytes.')
        self.original = bytes(base)
        self.data = bytearray(base)

    @staticmethod
    def integer(value, low, high):
        if type(value) is not int or not low <= value <= high:
            raise ValueError('Inteiro fora do intervalo.')
        return value

    def name(self, value):
        encoded = value.strip().encode('utf-8')
        if not 1 <= len(encoded) <= 19:
            raise ValueError('Nome deve conter 1–19 bytes UTF-8.')
        self.data[:20] = encoded.ljust(20, b'\0')

    def model(self, block, index):
        self.integer(block, 0, 10)
        self.data[0x36+block] = self.integer(index, 0, 255)

    def state(self, block, enabled):
        self.integer(block, 0, 10)
        if type(enabled) is not bool:
            raise ValueError('Estado deve ser booleano.')
        self.data[0x2b+block] = int(enabled)

    def knob(self, block, knob, value):
        self.integer(block, 0, 10)
        self.integer(knob, 0, 11)
        struct.pack_into('<h', self.data, 0x42+24*block+2*knob, self.integer(value, -32768, 32767))

    def compile(self):
        if self.data[330:] != self.original[330:]:
            raise ValueError('Região reservada alterada.')
        return bytes(self.data)


def encode(preset):
    base = base64.b64decode(reference_presets()[0]['base64'], validate=True)
    encoder = Encoder(base)
    encoder.name(preset['name'])
    # Explicitly disable unused effects; preserve their original parameters.
    for block in range(11):
        encoder.state(block, False)
    struct.pack_into('<H', encoder.data, 0x18, 70)
    for block in preset['blocks']:
        encoder.model(block['id'], block['model_index'])
        encoder.state(block['id'], True)
        for index, value in enumerate(block['values']):
            encoder.knob(block['id'], index, value)
    return encoder.compile()
