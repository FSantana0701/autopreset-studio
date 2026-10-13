---
title: AutoPreset Guitar Separation API
emoji: 🎸
colorFrom: yellow
colorTo: gray
sdk: docker
app_port: 7860
---

# Serviço experimental de separação de guitarra

Este serviço recebe um MP3/WAV e um intervalo de até 45 segundos, recorta apenas esse trecho, separa as fontes localmente e devolve `guitar.wav`. O arquivo enviado e os stems temporários são apagados ao final da requisição. O áudio não é encaminhado a um provedor de IA.

## Execução local

Requer Python 3.12 e FFmpeg. Em Linux CPU:

```sh
python -m venv .venv
. .venv/bin/activate
pip install --extra-index-url https://download.pytorch.org/whl/cpu torch==2.11.0+cpu torchaudio==2.11.0+cpu
pip install -r requirements.txt
AUTOPRESET_API_KEY='gere-um-segredo-forte' uvicorn app:app --host 0.0.0.0 --port 8000
```

Ou construa a imagem Docker. O primeiro processamento baixa os pesos do modelo.

```sh
docker build -t autopreset-audio .
docker run --rm -p 8000:7860 -e PORT=7860 -e AUTOPRESET_API_KEY='gere-um-segredo-forte' -e AUTOPRESET_ALLOWED_ORIGINS=https://SEU-SITE autopreset-audio
```

Endpoint `POST /v1/separate`: multipart com `file`, `start_seconds` e `end_seconds`, além do cabeçalho `Authorization: Bearer ...`; retorna WAV estéreo. `GET /health` informa o serviço. Configure uma `AUTOPRESET_API_KEY` forte antes de iniciar. `DEMUCS_MODEL`, `DEMUCS_DEVICE` e `PORT` podem ser ajustados no ambiente.

## Estado e limites

É um protótipo de processamento. A variante Demucs `htdemucs_6s` marca guitarra como fonte experimental e pode deixar vazamento de voz, violão ou outros instrumentos. Separar a guitarra não identifica por si só AMP, CAB, pedais nem valores de knobs. A API exige chave de acesso, limita arquivos a 25 MiB e trechos a 45 segundos. Configure HTTPS e monitore o uso.

O serviço é separado do HTML estático do GitHub Pages e não altera o compilador de 448 bytes.

## Publicação no Hugging Face Spaces

Este diretório está preparado como Docker Space. Crie um Space com SDK Docker no seu perfil e configure no painel:

- Secret `AUTOPRESET_API_KEY`: segredo aleatório forte. O servidor exige esse valor no cabeçalho Bearer.
- Variable `AUTOPRESET_ALLOWED_ORIGINS`: `https://fsantana0701.github.io`.

No repositório GitHub `FSantana0701/autopreset-studio`, adicione:

- Secret `HF_TOKEN`: token Hugging Face com permissão de escrita no Space.
- Variable `HF_SPACE_REPO`: `seu-usuario/seu-space`.

Após mesclar a V27 à branch `main`, a ação `.github/workflows/deploy-audio-space.yml` sincronizará `audio-service/` com o Space. O endpoint será `https://SEU-SUBDOMINIO.hf.space`; informe esse endereço e a mesma chave `AUTOPRESET_API_KEY` na página V27. A chave digitada no site não é salva.

Confira a disponibilidade de Docker Spaces, hardware, custos e suspensão por inatividade no painel do Hugging Face antes de ativar o serviço. O primeiro processamento baixa os pesos do modelo. A publicação do site estático não depende desse serviço.
