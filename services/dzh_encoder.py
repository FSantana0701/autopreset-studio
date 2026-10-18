"""Byte-compatible subset of MK300PresetHandler; reserved bytes stay untouched."""
import base64
import hashlib
import json
from pathlib import Path
import re
import struct

ROOT = Path(__file__).resolve().parents[1]


def model_index(block_name, model_name):
    """Resolve an exact V75 label to a verified binary zero-based index.

    AMP, DS and CAB names are accepted only when an owner export anchors their
    index. Other model families use their exact name in the parameter catalog.
    NAM labels intentionally have no direct AMP index: the physical slot must
    be provided by the user.
    """
    from services.catalog import V75, load_catalog

    block_name = str(block_name).strip().upper()
    model_name = str(model_name).strip()
    name_groups = V75.get('ui_models', V75['models'])
    allowed = name_groups.get(block_name, [])
    if block_name == 'AMP' and isinstance(allowed, dict):
        allowed = [name for group in allowed.values() for name in group]
    if not allowed and block_name == 'AMP' and isinstance(V75['models'].get('AMP'), dict):
        allowed = [name for group in V75['models']['AMP'].values() for name in group]
    if model_name not in allowed:
        raise ValueError(f'Modelo V75 não listado em {block_name}: {model_name}')

    ids = {'WAH':0, 'FX':1, 'GATE':2, 'DS':3, 'AMP':4, 'CAB':5,
           'EQ':6, 'MOD':7, 'DLY':8, 'REV':9}
    if block_name not in ids:
        raise ValueError(f'Bloco sem índice binário direto: {block_name}')
    index = ids[block_name]
    catalog = load_catalog()
    block = next(item for item in catalog['blocks'] if item['id'] == index)

    if block_name in {'AMP', 'DS', 'CAB'}:
        anchors = [item for item in V75['confirmed_models']
                   if item['block'] == index and item['name'] == model_name]
        if len(anchors) != 1:
            raise ValueError(f'Índice binário V75 não confirmado para {block_name}: {model_name}')
        return anchors[0]['index']

    models = [item for item in block['models']
              if item['name'].casefold() == model_name.casefold()]
    if len(models) != 1:
        raise ValueError(f'Índice binário V75 não confirmado para {block_name}: {model_name}')
    return models[0]['index']


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
        model_index_value = block['model_index']
        model_name = block.get('model_name')
        if model_name is not None:
            block_name = {0:'WAH', 1:'FX', 2:'GATE', 3:'DS', 4:'AMP', 5:'CAB',
                          6:'EQ', 7:'MOD', 8:'DLY', 9:'REV', 10:'VOL'}.get(block['id'])
            resolved = model_index(block_name, model_name)
            if 'model_index' in block and model_index_value != resolved:
                raise ValueError(f'Índice V75 divergente para {block_name}: {model_name}')
            model_index_value = resolved
        encoder.model(block['id'], model_index_value)
        encoder.state(block['id'], True)
        for index, value in enumerate(block['values']):
            encoder.knob(block['id'], index, value)
    return encoder.compile()
