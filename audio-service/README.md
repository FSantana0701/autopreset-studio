---
title: AutoPreset Audio and Preset API
emoji: 🎸
colorFrom: yellow
colorTo: gray
sdk: docker
app_port: 7860
---

# Serviço de áudio e sugestões do AutoPreset

> **Legado:** a interface Android/PWA atual usa `src/integrations/local-audio.js` e não chama este serviço. Esta API ainda requer chave Claude no servidor e pode gerar custos; não publique nem configure para usar o fluxo local.

O serviço recebe um MP3/WAV e um intervalo de até 45 segundos, recorta o trecho, separa a guitarra com Demucs e calcula métricas acústicas com librosa. O navegador envia essas métricas e o contexto ao endpoint Claude do próprio serviço. O provedor recebe texto/métricas, não o arquivo de áudio. Os arquivos temporários são removidos no fim da requisição.

## Execução local

Requer Python 3.12 e FFmpeg. Em Linux CPU:

```sh
python -m venv .venv
. .venv/bin/activate
pip install --extra-index-url https://download.pytorch.org/whl/cpu torch==2.11.0+cpu torchaudio==2.11.0+cpu
pip install -r requirements.txt
ANTHROPIC_API_KEY='chave-configurada-somente-no-servidor' AUTOPRESET_ALLOWED_ORIGINS='https://fsantana0701.github.io,http://localhost:8000' uvicorn app:app --host 0.0.0.0 --port 8000
```

O primeiro processamento baixa pesos do modelo. `ANTHROPIC_MODEL`, `DEMUCS_MODEL`, `DEMUCS_DEVICE` e `PORT` podem ser ajustados no ambiente.

## API

- `GET /health` informa se IA e separador estão ativos.
- `POST /v1/suggest` recebe `{prompt, system_prompt, schema}` e chama Claude no servidor.
- `POST /v1/separate` recebe multipart (`file`, `start_seconds`, `end_seconds`) e retorna WAV estéreo. A resposta inclui `X-Audio-Features` codificado em Base64 e `X-Audio-Separator`.

Não há chave de acesso no navegador. Proteja o `ANTHROPIC_API_KEY` com Secrets do host, configure limites de gasto na conta Anthropic e HTTPS. O serviço impõe limite de 8 requisições por minuto por IP em cada processo. O host também deve ter controles contra abuso e custos inesperados.

## Publicação no Hugging Face Spaces

Crie um Docker Space e configure:

- Secret `ANTHROPIC_API_KEY`: chave privada da API Anthropic.
- Variable `AUTOPRESET_ALLOWED_ORIGINS`: `https://fsantana0701.github.io`.

No GitHub, configure o Secret `HF_TOKEN` com acesso de escrita ao Space e a variável `HF_SPACE_REPO` (`usuario/nome-do-space`). O workflow `.github/workflows/deploy-audio-space.yml` sincroniza esta pasta.

No arquivo `src/config.js`, informe `window.AUTO_PRESET_API = 'https://SEU-SUBDOMINIO.hf.space';` e gere/publice o HTML autônomo. Esta URL é pública; não inclua nela segredo algum.

O Space precisa de compute compatível com Docker e Demucs. Pode dormir quando ocioso e demorar para iniciar. A chave Claude não é incluída no plano Claude.ai; o administrador precisa contratar e pagar o uso da API.
