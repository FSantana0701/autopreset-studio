"""Map measured DSP features to real MK-300 catalog IDs and int16 knobs."""
from __future__ import annotations

from .catalog import load_catalog

AMP_PROFILES = {"clean": 0, "crunch": 0, "high_gain": 5}
DS_MODELS = {"boost": 40, "blues": 41}
CAB_DEFAULT = 43
EQ_MODEL = 0
DLY_MODELS = {"digital": 0, "analog": 3}
REV_MODELS = {"room": 0, "hall": 1, "plate": 2, "church": 1}


def _block(block_id: int, model_index: int, values: dict[str, int], catalog: dict) -> dict:
    block = next(item for item in catalog['blocks'] if item['id'] == block_id)
    model = next(item for item in block['models'] if item['index'] == model_index)
    defaults = model.get('defaults') or [0] * len(model['knobs'])
    knobs = [int(values.get(name, defaults[index] if index < len(defaults) else 0)) for index, name in enumerate(model['knobs'])]
    return {'id': block_id, 'model_index': model_index, 'model_name': model['name'], 'knobs': model['knobs'], 'values': knobs}


def suggest(features: dict, catalog: dict | None = None) -> dict:
    """Crest-factor thresholds are deterministic heuristics, not instrument recognition."""
    catalog = catalog or load_catalog()
    crest_db = float(features.get('crest_factor_db', 0))
    if crest_db < 8:
        profile, amp_index, ds_index, ds_on = 'high_gain', AMP_PROFILES['high_gain'], DS_MODELS['boost'], True
    elif crest_db > 15:
        profile, amp_index, ds_index, ds_on = 'clean', AMP_PROFILES['clean'], DS_MODELS['boost'], False
    else:
        profile, amp_index, ds_index, ds_on = 'crunch', AMP_PROFILES['crunch'], DS_MODELS['blues'], True

    brightness = min(1.0, max(0.0, float(features.get('spectral_centroid_hz', 2000))/8000))
    amp_values = {'Gain': 34 if profile == 'clean' else 52 if profile == 'crunch' else 66,
                  'Level': 58, 'Bass': 48, 'Middle': 56, 'Treble': round(60 - 15*brightness),
                  'Reso': 0, 'Pres': 50, 'Bright': 50}
    blocks = [_block(2, 0, {'Gate': 25, 'Bias': 50}, catalog)]
    if ds_on:
        blocks.append(_block(3, ds_index, {'Gain': 38, 'Level': 55, 'Bass': 48, 'Middle': 55,
                                          'Treble': 48, 'Reso': 0, 'Pres': 50, 'Bright': 50}, catalog))
    blocks.extend([
        _block(4, amp_index, amp_values, catalog),
        _block(5, CAB_DEFAULT, {'Level': 55, 'Low Cut': 20, 'High Cut': 117}, catalog),
        _block(6, EQ_MODEL, dict(zip(next(b for b in catalog['blocks'] if b['id'] == 6)['models'][EQ_MODEL]['knobs'],
                                    features.get('eq_device_values', [0]*6)),), catalog),
    ])
    delay = features.get('delay_time_ms') if features.get('delay_detected') else None
    if delay is not None:
        blocks.append(_block(8, DLY_MODELS['analog'], {'Time': int(min(1000, max(50, delay))), 'Fb': 25, 'Mix': 20, 'Sync': 0}, catalog))
    blocks.append(_block(9, REV_MODELS['hall'], {'Decay': 30, 'Mix': 22, 'High Pass': 80, 'Low Pass': 80, 'Mod Depth': 40}, catalog))
    selected = {block['id']: {'index': block['model_index'], 'name': block['model_name']} for block in blocks}
    return {'name': 'MK300 DSP V75', 'firmware': 'v75', 'blocks': blocks,
            'classification': {'profile': profile, 'method': 'crest_factor_thresholds', 'confidence': 'low',
                               'crest_factor_db': crest_db, 'spectral_flatness': features.get('spectral_flatness')},
            'diagnosis': {'selected_models': selected, 'delay_time_ms': delay,
                          'explanation': 'Mapeamento heurístico baseado em medidas do trecho; não reconhece o instrumento nem recria exatamente o equipamento de origem.'},
            'warnings': ['O componente HPSS não isola exclusivamente guitarra; outros instrumentos podem influenciar as medidas.',
                         'AMP, DS e CAB usam os índices confirmados nas exportações V75 fornecidas. Capturas NAM e IRs não são incluídos no .dzh; confirme os mesmos modelos e slots no equipamento.']}


OFFLINE_STYLES = {
    'Rock': ('crunch', 5, 40, True, 43, 3, True, 1),
    'Metal': ('high_gain', 52, 40, True, 43, 0, False, 2),
    'MPB': ('clean', 0, 41, False, 43, 0, False, 0),
    'Blues': ('crunch', 0, 41, True, 43, 3, False, 0),
    'Clean': ('clean', 0, 40, False, 43, 0, False, 1),
}


def offline_presets(catalog: dict | None = None) -> list[dict]:
    catalog = catalog or load_catalog()
    result = []
    for label, (profile, amp, ds, ds_on, cab, dly, dly_on, rev) in OFFLINE_STYLES.items():
        amp_gain = 34 if profile == 'clean' else 52 if profile == 'crunch' else 66
        blocks = [_block(2, 0, {'Gate': 25, 'Bias': 50}, catalog)]
        if ds_on:
            blocks.append(_block(3, ds, {'Gain': 38, 'Level': 55, 'Bass': 48, 'Middle': 55,
                                         'Treble': 48, 'Reso': 0, 'Pres': 50, 'Bright': 50}, catalog))
        blocks.extend([
            _block(4, amp, {'Gain': amp_gain, 'Level': 58, 'Bass': 48, 'Middle': 55, 'Treble': 52,
                            'Reso': 0, 'Pres': 50, 'Bright': 50}, catalog),
            _block(5, cab, {'Level': 55, 'Low Cut': 20, 'High Cut': 117}, catalog),
            _block(6, EQ_MODEL, {name: 0 for name in next(b for b in catalog['blocks'] if b['id'] == 6)['models'][EQ_MODEL]['knobs']}, catalog),
        ])
        if dly_on:
            blocks.append(_block(8, dly, {'Time': 420, 'Fb': 25, 'Mix': 20, 'Sync': 0}, catalog))
        blocks.append(_block(9, rev, {'Decay': 30, 'Mix': 22, 'High Pass': 80, 'Low Pass': 80, 'Mod Depth': 40}, catalog))
        result.append({'name': f'{label} MK-300', 'firmware': 'v75', 'blocks': blocks,
                       'source_style': label, 'classification': {'profile': profile, 'confidence': 'offline reference'},
                       'diagnosis': {'explanation': 'Preset inicial editável baseado em modelos reais do catálogo embarcado.'},
                       'warnings': ['O slot CAB seleciona uma entrada; não inclui um arquivo IR. Verifique o resultado no aparelho.']})
    return result
