# Backend Railway — HPSS/DSP

O Dockerfile da **raiz** inicia `main:app`, porta `${PORT:-7860}`, um worker.
Configure no Railway: diretório raiz `/`, builder Dockerfile, healthcheck `/health`.
Remova eventuais comandos/paths antigos que iniciem `audio-service/` ou Demucs.
A PWA usa `shell-v16`, informa análise harmônica e mostra fallback local para
`DOWNLOAD_BLOCKED`. A API retorna `separation.method=HPSS` e `guitar_isolated=false`.

## Desenvolvimento

```sh
python -m venv .venv-backend
. .venv-backend/bin/activate
python -m pip install -r requirements.txt
# Instale FFmpeg pelo gerenciador do sistema antes de extrair links.
uvicorn main:app --host 0.0.0.0 --port 7860 --workers 1
```

`GET /health` informa também a disponibilidade do FFmpeg.
`POST /api/v1/extract-youtube` devolve WAV PCM estéreo 16 kHz.
`POST /api/v1/analyze-link` devolve JSON com `dzh_base64`, `size_bytes=448`,
`features`, `preset`, `source` e `separation`. Ambos recebem:

```json
{"url":"https://youtu.be/z3JhXn_onsw?si=exemplo","start_seconds":224,"end_seconds":234,"firmware":"v75"}
```

Intervalo positivo, até 45 s. URLs são normalizadas e restritas ao YouTube.
Extração tem limites de tempo/tamanho; o servidor aceita apenas um processamento
simultâneo (503 `busy` permite nova tentativa). WAVs temporários são removidos.
O cliente desconectar não interrompe imediatamente o processamento síncrono;
a extração tem timeout e o DSP opera apenas no trecho limitado.
CORS está aberto para diagnóstico: `allow_origins=["*"]`,
`allow_credentials=False`, métodos e headers `[*]`. A PWA usa `credentials:'omit'`.
O middleware responde preflight; OPTIONS explícito sem headers também retorna 200.
`CORS_ORIGINS` e `AUTOPRESET_ALLOWED_ORIGINS` **não são lidas** nesta configuração;
variáveis Railway não substituem código Python automaticamente. Não é necessário
alterar essas variáveis para este teste. O navegador envia origem sem caminho.
O Service Worker já está em `shell-v16`. Após o deploy deste commit, teste em
guia anônima no telefone e confira `/health`; não é possível executar esse teste
no telefone do usuário a partir deste ambiente. Uma falha `Failed to fetch` não
prova CORS: indisponibilidade, DNS/TLS e erros do proxy também podem causá-la.
Nenhuma chave de IA é usada.

`GET /api/v1/catalog` expõe os nomes e índices embarcados no editor. `GET
/api/v1/offline-catalog` gera cinco presets de referência (Rock, Metal, MPB,
Blues e Clean), todos pelo mesmo encoder de 448 bytes. `POST
/api/v1/analyze-file` recebe multipart `.mp3`, `.wav` ou `.m4a` até 15 MiB e
recorta um trecho de no máximo 45 s usando FFmpeg. `start_seconds` e
`end_seconds` aceitam segundos ou `mm:ss`. Os arquivos temporários são removidos
ao fim do processamento.

## Limites e interpretação

HPSS usa blocos de 2 s com contexto, 16 kHz, float32. Separa sons harmônicos dos
percussivos, **não uma guitarra exclusiva**. Voz, baixo e teclados permanecem.
MFCC13, centroide, rolloff85, flatness/SFM, ZCR, RMS e crest são calculados do
WAV harmônico. O mapeador usa distância por cosseno contra três vetores
**heurísticos**, não perfis acústicos medidos dos amplificadores. A similaridade
não é probabilidade de reconhecimento. Ganho e efeitos são sugestões manuais
editáveis com baixa confiança; esta análise não identifica perfeitamente timbre.

O encoder mantém o layout existente e os bytes 330–447 da base JP CLEAN validada
por SHA-256. O catálogo V73 existente é o mesmo usado pela PWA para V75;
a disponibilidade dos modelos/IR deve ser conferida no aparelho. O `.dzh` não
embute IR. Os testes verificam equivalência binária; não substituem importar na
MK-300 física.

Não há torch, torchaudio ou Demucs nas dependências deste backend. O diretório
`audio-service/` é legado independente e não é copiado/instalado pelo Dockerfile
novo. A pipeline de produção executa STFT, máscara HPSS (medianas 17, margem 2),
mel Slaney e DCT-II/MFCC13 diretamente em NumPy. Não importa librosa, SciPy ou
Numba. Librosa/SciPy permanecem nas dependências para compatibilidade e comparação
numérica dos testes; seu custo de instalação não implica carga no processo.

A leitura continua via SoundFile em blocos, sem `librosa.load()` nem buffer da
música inteira. O separador converte estéreo para um canal dominante por bloco
(evita cancelamento de fase); o analisador recebe WAV **mono, 16 kHz**. O buffer
STFT rejeita mais de 30 s; os blocos de separação têm apenas cerca de 2,5 s com
contexto. Portanto o intervalo solicitado de até 45 s é preservado, sem truncar
a análise aos primeiros 30 s. Arrays temporários são liberados e `gc.collect()`
é chamado após HPSS e MFCC e ao fim dos blocos.

Medição em processo novo com imports de FastAPI/Uvicorn e análise HPSS/DSP real
de **45 s sintéticos**, até geração dos 448 bytes:

| Ambiente | Pico RSS | Tempo |
| --- | ---: | ---: |
| Cloud, venv local | 51,95 MiB (54,47 MB) | 2,50 s |
| Imagem Docker, processo novo | 69,43 MiB (72,80 MB) | 2,25 s |
| Docker anterior com librosa/Numba | 435,15 MiB | 18,14 s |

O teste de regressão exige pico do processo abaixo de **100.000.000 bytes**.
As medições incluem o runtime e as bibliotecas do processo DSP, mas **não**
processos yt-dlp/FFmpeg, cache de arquivos do container nem toda a carga do Railway.
Logo não são garantia de teto de 100 MB para o serviço inteiro. Mantenha um worker
e monitore a memória real do container; não reduza o limite Railway a 100 MB
apenas com base no pico DSP. Nenhuma música real foi usada para estes números.

O user-agent padrão atualizado do yt-dlp é usado; ele **não garante** contornar
bloqueios de IP/bot do YouTube. `noplaylist`, `bestaudio/best` e extração de áudio
são configurados. O yt-dlp só extrai metadados, e FFmpeg decodifica o trecho
limitado; não há download/transcodificação da música inteira via pós-processador.
Bloqueios 403/429/bot retornam HTTP 422 com:

```json
{"detail":"DOWNLOAD_BLOCKED","code":"DOWNLOAD_BLOCKED"}
```

A PWA exibe: "O YouTube bloqueou o download automático na nuvem. Use o Cortador
Local abaixo para enviar o arquivo diretamente." O cortador/analisador local
continua disponível, e baixar/aplicar preset permanece desabilitado após erro.
Outros erros 422 e respostas não JSON conservam tratamento genérico.
Não há endpoint de upload de backend nesta versão; o fallback é a ferramenta
local existente. Nenhum áudio é enviado a serviços de IA; a única origem externa
é o YouTube solicitado pelo usuário.

## Validação reproduzível

```sh
python -m pip install -r src/tests/requirements.txt
CHROMIUM_PATH=/usr/bin/chromium python -m pytest -q
npm test
npm run build
# Checks individuais e diagnóstico de memória:
python -m unittest discover -s tests/backend -v
python tests/backend/memory_probe.py 45
node src/build-standalone.cjs
node mk300-binary.test.cjs
for test in src/tests/*.test.cjs; do node "$test"; done
CHROMIUM_PATH=/usr/bin/chromium python -m unittest discover -s src/tests -p '*test.py' -v
```

Os testes novos executam HPSS/DSP de verdade em sinais sintéticos, comparam
HPSS/MFCC numericamente com librosa em subprocesso e verificam o consumo em
processo novo. Bloqueios yt-dlp e o contrato de erro são simulados; o navegador
valida o aviso e a limpeza de estados a 390 px. Somente a
extração de rede é simulada no teste HTTP; nenhum teste comprova download real
do YouTube ou separação de guitarra em música. Os testes antigos de API usam
mocks de separação. A conectividade de produção Railway é bloqueada pela política
de saída deste ambiente; push Git não confirma deploy saudável. Verifique
os logs de deploy e `/health` no Railway após a atualização.


### Links no modo leve da PWA

O modo padrão de YouTube usa `POST /api/v1/extract-youtube`: o servidor resolve
os metadados em subprocesso e extrai somente o intervalo de até 45 s com FFmpeg.
A resposta WAV PCM de 16 kHz tem no máximo 2.888.192 bytes. A PWA limita o corpo
recebido antes de decodificar, mede a mixagem com o DSP local e gera os 448 bytes
no aparelho. Esse caminho não chama HPSS, MFCC, NumPy nem o encoder Python;
não carrega a faixa inteira no celular. O pico de RAM da extração ainda inclui
FastAPI, o subprocesso yt-dlp ou FFmpeg e depende do vídeo e do ambiente.

Desmarcar “Modo leve” mantém o endpoint anterior `/api/v1/analyze-link` e sua
análise harmônica no servidor. Não há fallback automático para esse caminho
mais pesado. Erros 403/429 ou bloqueios anti-bot do YouTube continuam possíveis
em ambos os modos; nesse caso, use o botão para carregar um arquivo já baixado
no Cortador Local. O modo leve usa uma rota já existente no backend; se a versão
implantada não a tiver, ela precisa ser atualizada antes de funcionar em produção.
