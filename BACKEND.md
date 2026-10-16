# Backend Railway — HPSS/DSP

O Dockerfile da **raiz** inicia `main:app`, porta `${PORT:-7860}`, um worker.
Configure no Railway: diretório raiz `/`, builder Dockerfile, healthcheck `/health`.
Remova eventuais comandos/paths antigos que iniciem `audio-service/` ou Demucs.
A PWA em `src/` permanece intacta. Seu texto atual de progresso ainda menciona
Demucs; esta API retorna `separation.method=HPSS` e `guitar_isolated=false`.

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
`CORS_ORIGINS` é uma lista de origens separadas por vírgula, sem barra final;
padrão: GitHub Pages do projeto e localhost:8000. Nenhuma chave de IA é usada.

## Limites e interpretação

HPSS usa blocos de 4 s com contexto, 16 kHz, float32. Separa sons harmônicos dos
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
novo. Librosa instala dependências transitivas como Numba e scikit-learn.
Desativar JIT quebrou a importação de librosa/Numba neste ambiente e não é usado.

**A meta de 150 MB não foi cumprida:** medição em processo novo, com FastAPI,
HPSS e DSP de 45 s sintéticos: pico RSS de **256,15 MiB** (aprox. 269 MB),
5,07 s com caches de compilação já disponíveis. O primeiro uso pode consumir
mais. Na imagem Docker nova, com cache frio, o mesmo diagnóstico consumiu
**435,15 MiB** de pico RSS e levou 18,14 s. `/health` foi validado também com
`PORT=7861`. A medição não inclui processos yt-dlp/FFmpeg nem overhead do container;
não representa limite garantido de produção. Comece com 1 GiB e monitore
no Railway. Um teto rígido de 150 MB exige substituir/reduzir a stack solicitada
ou validar outras versões, não apenas retirar PyTorch. Não configure 150 MB
esperando funcionamento comprovado.

O user-agent padrão atualizado do yt-dlp é usado; ele **não garante** contornar
bloqueios de IP/bot do YouTube. Erros de bloqueio retornam 422 `youtube_blocked`
com orientação para upload direto na análise local da PWA. A PWA atual pode
mostrar uma mensagem genérica para 422; sua lógica não foi alterada a pedido.
Não há endpoint de upload de backend nesta versão. Nenhum áudio é enviado a
serviços de IA; a única origem externa é o YouTube solicitado pelo usuário.

## Validação reproduzível

```sh
python -m unittest discover -s tests/backend -v
python tests/backend/memory_probe.py 45
node src/build-standalone.cjs
node mk300-binary.test.cjs
for test in src/tests/*.test.cjs; do node "$test"; done
CHROMIUM_PATH=/usr/bin/chromium python -m unittest discover -s src/tests -p '*test.py' -v
```

Os testes novos executam HPSS/DSP de verdade em sinais sintéticos. Somente a
extração de rede é simulada no teste HTTP; nenhum teste comprova download real
do YouTube ou separação de guitarra em música. Os testes antigos de API usam
mocks de separação. A conectividade de produção Railway é bloqueada pela política
de saída deste ambiente; push Git não confirma deploy saudável. Verifique
os logs de deploy e `/health` no Railway após a atualização.
