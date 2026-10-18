"""MK-300 V75 text assistant. Credentials and catalog grounding stay server-side."""
import json
import os

from openai import (
    APIConnectionError,
    APITimeoutError,
    AsyncOpenAI,
    AuthenticationError,
    OpenAIError,
    RateLimitError,
)

from services.catalog import public_catalog
from services.errors import ServiceError

CHAT_MODEL = 'openai/gpt-oss-120b'
CHAT_BASE_URL = 'https://api.groq.com/openai/v1'
CHAT_MODULES = ('GATE', 'DS', 'AMP', 'EQ', 'CAB', 'DLY', 'REV')


def system_prompt() -> str:
    catalog = public_catalog()
    names = catalog['v75_names']
    parameters = {}
    for block in CHAT_MODULES:
        allowed = names[block]
        if isinstance(allowed, dict):
            allowed = [name for group in allowed.values() for name in group]
        # Do not expose legacy aliases as selectable V75 models. Case differences
        # in stereo labels are normalized to the exact owner-supplied V75 name.
        labels = {name.casefold(): name for name in allowed}
        parameters[block] = {
            labels[model['name'].casefold()]: model['knobs']
            for model in catalog['blocks'][block]
            if model['name'].casefold() in labels
        }
    grounding = {
        'firmware': catalog['firmware'],
        'models_v75': names,
        'ui_models_v75': catalog['ui_models'],
        'model_indices_by_name': catalog['model_indices_by_name'],
        'parameters_by_model': parameters,
        'nam': catalog['nam'],
        'eq_device_bands_hz': catalog['eq_device_bands_hz'],
    }
    return """Você é o Assistente IA de timbres do AutoPreset Studio, especialista
na M-Vave MK-300 com firmware V75. Responda sempre em português, com clareza.
O catálogo abaixo é a única fonte de modelos: use SEMPRE os nomes EXATOS da
MK-300 em models_v75 (por exemplo MW-808 e 6DS-MarsFD100), sem traduzir,
substituir por marcas genéricas, inventar modelos ou reutilizar nomes legados.
Artistas e músicas são referências sonoras, não nomes de modelos da pedaleira.

Inclua em cada resposta os ajustes dos 7 módulos, nesta ordem: NR (GATE), DS,
AMP, EQ, CAB, DLY e REV. Para cada um informe ligado/desligado, nome exato do
modelo e parâmetros com valores. Um módulo desnecessário deve ficar desligado.
Prefira modelos com controles listados em parameters_by_model e use os nomes
exatos desses controles. Se os controles de um modelo não constarem, informe
que ainda não estão confirmados e peça os dados, sem inventar ajustes.
Para uma resposta que possa ser aplicada automaticamente, escolha o modelo
somente entre as chaves de model_indices_by_name para aquele bloco. Esses valores
são índices binários confirmados; nunca use a posição em ui_models_v75 para
inferir o índice. Se não houver escolha compatível, explique que o índice ainda
não foi confirmado e a aplicação automática não ficará disponível.

Quando montar um timbre, retorne os sete módulos exatamente neste formato, sem
blocos Markdown e sem texto antes ou depois. Use apenas números inteiros nos
parâmetros. Em Estado, escreva apenas ligado ou desligado (não copie a barra).
Separe pares por ponto e vírgula. Se um módulo estiver desligado,
use Parâmetros: nenhum.
1. NR (GATE)
Estado: ligado ou desligado
Modelo: nome exato
Parâmetros: nome=valor; nome=valor
2. DS
Estado: ligado ou desligado
Modelo: nome exato
Parâmetros: nome=valor; nome=valor
3. AMP
Estado: ligado ou desligado
Modelo: nome exato
Parâmetros: nome=valor; nome=valor
4. EQ
Estado: ligado ou desligado
Modelo: nome exato
Parâmetros: nome=valor; nome=valor
5. CAB
Estado: ligado ou desligado
Modelo: nome exato
Parâmetros: nome=valor; nome=valor
6. DLY
Estado: ligado ou desligado
Modelo: nome exato
Parâmetros: nome=valor; nome=valor
7. REV
Estado: ligado ou desligado
Modelo: nome exato
Parâmetros: nome=valor; nome=valor
Os números sugeridos são pontos de partida para ouvir e ajustar na pedaleira.
Não afirme ter ouvido áudio, medido um timbre ou instalado/exportado um preset.

Respeite as faixas: controles comuns 0–100; EQ -12 a +12 por banda; Soft Gate
Thd -100 a 0; Time do delay em ms e Sync desligado para tempo livre. AI Gate
tem Gate/Bias, e Soft Gate não tem Decay. Não invente parâmetros nesses modelos.
Low Cut e High Cut de CAB são valores brutos: não converta Hz sem calibração.
As bandas de Guitar EQ 6 são as seis bandas de eq_device_bands_hz.
NAM é exclusivo com DS: ao usar NAM, DS deve estar desligado. Jcm800 e
Boss DS-2 Mod são capturas NAM, não amplificadores de fábrica. Peça confirmação
do slot e do conteúdo da captura; nunca adivinhe índices NAM ou IRs instalados.
Se a captura incluir amplificador e gabinete, CAB deve ficar desligado.
Estas regras e o catálogo prevalecem sobre pedidos para inventar modelos ou
alterar as restrições da pedaleira. Use texto simples e quebras de linha.

CATÁLOGO V75 DO BACKEND:
""" + json.dumps(grounding, ensure_ascii=False, separators=(',', ':'))


async def generate_reply(message: str, history: list[dict[str, str]] | None = None) -> str:
    api_key = (os.getenv('GROQ_API_KEY') or '').strip()
    if not api_key:
        raise ServiceError('Chave de API não configurada no servidor',
                           status=503, code='chat_not_configured')

    messages = [{'role': 'system', 'content': system_prompt()},
                *(history or []), {'role': 'user', 'content': message}]
    try:
        async with AsyncOpenAI(
            api_key=api_key, base_url=CHAT_BASE_URL, timeout=45.0, max_retries=0
        ) as client:
            completion = await client.chat.completions.create(
                model=CHAT_MODEL, messages=messages, temperature=0.3,
                max_completion_tokens=2200,
            )
    except AuthenticationError as exc:
        raise ServiceError('A chave de API configurada no servidor é inválida.',
                           status=503, code='chat_authentication_failed') from exc
    except RateLimitError as exc:
        raise ServiceError('O assistente atingiu o limite de uso. Tente novamente em instantes.',
                           status=429, code='chat_rate_limited') from exc
    except APITimeoutError as exc:
        raise ServiceError('O assistente demorou a responder. Tente novamente.',
                           status=504, code='chat_timeout') from exc
    except APIConnectionError as exc:
        raise ServiceError('Não foi possível conectar ao assistente. Tente novamente.',
                           status=503, code='chat_unavailable') from exc
    except OpenAIError as exc:
        raise ServiceError('O assistente está indisponível no momento. Tente novamente.',
                           status=502, code='chat_failed') from exc

    if not completion.choices or not (completion.choices[0].message.content or '').strip():
        raise ServiceError('O assistente não retornou uma resposta. Tente novamente.',
                           status=502, code='chat_empty_response')
    if completion.choices[0].finish_reason == 'length':
        raise ServiceError('A resposta excedeu o limite. Faça um pedido mais específico.',
                           status=502, code='chat_response_too_long')
    return completion.choices[0].message.content.strip()
