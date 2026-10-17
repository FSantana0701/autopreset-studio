"""Owner exports anchor indices; no capture name is inferred from its slot."""
import base64
import hashlib
import json
from pathlib import Path
import subprocess

from services.catalog import ROOT, V75, load_catalog, public_catalog
from services.dzh_encoder import Encoder, encode
from services.preset_mapper import offline_presets, suggest

FIXTURES = ROOT / 'src/tests/fixtures/v75'


def test_owner_export_roundtrips_match_javascript_for_every_byte():
    for fixture in json.loads((FIXTURES / 'manifest.json').read_text()):
        raw = (FIXTURES / fixture['file']).read_bytes()
        assert len(raw) == 448
        assert hashlib.sha256(raw).hexdigest() == fixture['sha256']
        assert Encoder(raw).compile() == raw
        script = """require('./src/core/mk300-preset-handler.js');
const h=new MK300Core.MK300PresetHandler(new Uint8Array(Buffer.from(process.argv[1],'base64')));
process.stdout.write(Buffer.from(h.compile()).toString('base64'));"""
        result = subprocess.check_output(['node', '-e', script, base64.b64encode(raw).decode()], cwd=ROOT, text=True)
        assert base64.b64decode(result) == raw
        assert list(raw[57:60]) == [fixture['ds'], fixture['amp'], fixture['cab']]
        if fixture['original_name'] in ('variação teste 4.dzh', 'teste 5.dzh'):
            assert raw[46] == 0 and raw[47] == 1


def test_exact_confirmed_labels_and_no_guessed_nam_indices():
    catalog = load_catalog()
    for item in V75['confirmed_models']:
        block = next(block for block in catalog['blocks'] if block['id'] == item['block'])
        model = next(model for model in block['models'] if model['index'] == item['index'])
        assert model['name'] == item['name']
        assert model['verification'] == 'owner_export'
    public = public_catalog()
    assert public['nam']['exclusive_with_ds'] is True
    assert public['nam']['automatic_selection'] is False
    assert not any(model['name'] in V75['models']['NAM'] for model in public['blocks']['AMP'])
    assert public['v75_names']['DS'][0:2] == ['MW-808', 'MW-GOLD']


def test_all_automatic_suggestions_use_confirmed_amp_ds_cab():
    verified = {(item['block'], item['index']): item['name'] for item in V75['confirmed_models']}
    presets = offline_presets() + [suggest({'crest_factor_db': crest}) for crest in (4, 8, 12, 16, 25)]
    for preset in presets:
        raw = encode(preset)
        assert len(raw) == 448
        for block in preset['blocks']:
            if block['id'] in (3, 4, 5):
                assert verified[block['id'], block['model_index']] == block['model_name']
                assert raw[54 + block['id']] == block['model_index']


def test_v75_overlay_does_not_modify_the_legacy_catalog():
    legacy = json.loads((ROOT / 'src/data/mk300-v73-parameters.json').read_text())
    assert len(legacy['blocks'][3]['models']) == 40
    assert legacy['blocks'][4]['models'][0]['name'] == '1J120_CL'
    assert len(load_catalog()['blocks'][3]['models']) == 42
