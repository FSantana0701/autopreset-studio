"""Heuristic cosine templates, NOT measured amplifier fingerprints or an ML model."""
import json
import math
from .dzh_encoder import ROOT

# centroid/8k, rolloff/8k, flatness, ZCR, crest/20; hand-authored priors.
PROFILES = [(16, [.10,.25,.01,.06,.50]),
            (22, [.22,.45,.04,.12,.30]),
            (84, [.35,.65,.10,.20,.20])]


def suggest(features):
    catalog = json.loads((ROOT/'src/data/mk300-v73-parameters.json').read_text())['blocks']
    vector = [features['spectral_centroid_hz']/8000, features['spectral_rolloff_85_hz']/8000,
              features['spectral_flatness'], features['zero_crossing_rate'], min(features['crest_factor']/20, 1)]
    def cosine(profile):
        return sum(a*b for a,b in zip(vector,profile))/(math.sqrt(sum(a*a for a in vector))*math.sqrt(sum(b*b for b in profile)) or 1)
    ranked = sorted(((cosine(profile),index) for index,profile in PROFILES), reverse=True)
    score, amp = ranked[0]
    brightness = min(1, max(0, features['spectral_centroid_hz']/4000))
    gain = {16:32,22:50,84:63}[amp]
    blocks = []
    def block(block_id, model_id, values):
        model = next(m for b in catalog if b['id']==block_id for m in b['models'] if m['index']==model_id)
        if len(values) != len(model['knobs']):
            raise ValueError('Parâmetros incompatíveis com catálogo.')
        blocks.append({'id':block_id,'model_index':model_id,'model_name':model['name'],
                       'knobs':model['knobs'],'values':values})
    if amp != 16:
        block(3,21,[12,82,45,55,62,50,50,50])
    block(4,amp,[gain,70,45,65,round(65-15*brightness),50,60,50])
    block(5,14,[68,20,117])
    block(8,0,[390,25,20,0])
    block(9,1,[35,22,80,80,40])
    return {'name':'HPSS SUGGESTION','firmware':'v75','blocks':blocks,
            'classification':{'method':'cosine_heuristic','similarity':score,'confidence':'low',
                              'margin':score-ranked[1][0], 'measured_reference_profiles':False},
            'explanation':'Brilho e dinâmica harmônicos orientam uma sugestão editável. Ganho, boost e ambiência são pontos de partida; não reconhecem o equipamento original.',
            'warnings':['HPSS não isola exclusivamente guitarra; voz, baixo e teclados influenciam as métricas.',
                        'Catálogo de parâmetros V73 existente, usado pela PWA para V75; confirme modelos e IR no aparelho.',
                        'O arquivo seleciona um slot CAB; não inclui uma resposta de impulso.']}
