# ToneMatch → MK-300

Integração independente da análise DSP de borabiricik/tonematch (commit
cf258995d83682154a81ee8df5dafde3bdd975fe), com um tradutor próprio para o catálogo
e o encoder do AutoPreset Studio. O código do analisador externo é instalado
como dependência: não está copiado nem relicenciado neste repositório.

## O que esta implementação faz

- Aceita arquivo MP3/WAV/M4A ou vídeo público do YouTube.
- Recorta 8–45 segundos, em 44,1 kHz estéreo, antes da análise.
- Executa o worker em Python 3.11 separado do backend leve.
- Usa Demucs htdemucs_6s em CPU para obter uma estimativa de guitarra.
- Reutiliza a análise de grupos, saturação, espectro, ecos e caudas do ToneMatch.
- Traduz os resultados para modelos e controles reais da MK-300.
- Gera um JSON com evidências e um .dzh de 448 bytes por grupo.
- Mantém a região reservada 330–447 da base de preset do encoder existente.
- Não se conecta nem escreve na pedaleira.

A análise automática não detecta chorus/phaser. Eles só entram por escolha
explícita. Boost MW-808 e compressor de clean também são opções explícitas.
Não se usa o tamanho do sustain como certeza de que há reverb. Delay apenas
possível permanece desligado; eco acima da faixa traduzida é reportado sem
ser silenciosamente convertido para outro tempo.

## Catálogo e firmware

AMP, DS e CAB são restritos aos índices que as exportações V75 do proprietário
ancoram. As opções automáticas de AMP são Fender Super, 6DS-MarsFD100 e
53DS-Pey5150. Isto limita a biblioteca candidata; não é uma busca por todos
os amplificadores possíveis. O CAB automático inicial é 44MarVal4, presente
na interface atual e nas exportações confirmadas. Um nome listado em uma planilha não confirma
sozinho o índice físico do arquivo binário.

A compatibilidade com V076 e com os modelos atualmente instalados na unidade
do usuário ainda precisa ser verificada no M-EFCS e na pedaleira. Os presets
não incorporam capturas NAM ou IR. Não se presume o nome de uma captura a
partir de seu slot. O firmware não é atualizado por este recurso.

As sugestões de Gain/EQ são heurísticas limitadas, não a inversão calibrada
do DSP da MK-300. Os valores de CAB Low Cut/High Cut permanecem em unidades
brutas conhecidas; não há conversão inventada entre Hz e slider.
Decay do reverb também é um ponto de partida bruto, não uma calibração RT60.

## Configuração local

Pré-requisitos: uv, git, FFmpeg e o ambiente Python normal do backend.

    python tools/setup_tonematch.py
    export TONEMATCH_PYTHON=/caminho/absoluto/.tonematch-runtime/bin/python

O instalador cria um runtime Python 3.11 com PyTorch CPU. Instala somente as
dependências de DSP necessárias e depois o analisador ToneMatch fixado no
commit indicado, sem puxar os componentes de transporte BOSS, CUDA ou Claude.

Modelos de separação podem ser baixados pelo Demucs na primeira execução.
Planeje memória e tempo adequados; o runtime é opcional e não foi adicionado
ao Dockerfile leve do Railway. Para hospedar a API com ToneMatch, provisione o
worker e copie também tools/tonematch_mk300_worker.py. O status distingue a
presença do interpretador de uma verificação real das dependências.

## CLI

    python tools/tonematch_mk300.py referencia.wav --start 0 --end 30 --output resultados

Se o arquivo já for uma guitarra isolada:

    python tools/tonematch_mk300.py guitarra.wav --isolated --start 0 --end 30 --output resultados

YouTube:

    python tools/tonematch_mk300.py "https://www.youtube.com/watch?v=VIDEO_ID" --start 60 --end 90 --output resultados

Opções de criação:

    --boost
    --compress-clean
    --modulation Chorus
    --modulation Phaser

Essas opções expressam decisões do usuário; não representam efeitos que o
analisador tenha reconhecido automaticamente.

Também é possível traduzir um relatório ToneMatch que já exista, sem o worker:

    python tools/tonematch_mk300.py analysis.json --from-analysis --output resultados

## API opcional

- GET /api/v1/tonematch/status
- POST /api/v1/tonematch/analyze-link
- POST /api/v1/tonematch/analyze-file

O POST de link recebe url, start_seconds e end_seconds em segundos numéricos.
Também aceita boost, compress_clean e modulation (none, Chorus ou Phaser).
O upload multipart aceita esses campos e isolated; início/fim do upload também
aceitam mm:ss, como o restante da API.

A resposta contém engine, analysis, separation, source e presets. Cada item
em presets contém group, preset, filename, size_bytes e dzh_base64.
A fila é a mesma trava da análise existente, evitando dois processos pesados
simultâneos. Os uploads têm limite de 15 MiB. O worker tem timeout de 240 s.

Não existe ativação automática no frontend atual. As rotas HPSS e a exportação
existente continuam disponíveis. A integração ainda precisa ser implantada
com o runtime configurado para que a PWA possa utilizá-la.

## YouTube e privacidade

O extrator reutiliza a validação de URL e metadados do backend. Não usa
ToneMatch.ingest nem seu fallback de cookies dos navegadores. Não lê cookies
ou credenciais do computador. Links assinados de mídia não são retornados ao
cliente nem conservados após a leitura dos metadados.

Se YouTube responder com 403/429 ou exigir acesso que o processo não tem, a API
retorna DOWNLOAD_BLOCKED. Esse erro não é interpretado como análise concluída
e nenhum preset é criado. A presença de um extrator não garante acesso a
todos os vídeos neste ambiente.

## Testes e alcance

A suíte testa catálogo e índices, bytes reservados, hipóteses inconclusivas,
validação numérica, intervalos, falhas do worker, bloqueios do YouTube e a
liberação da trava compartilhada. Um job separado executa o analisador
externo em sinal sintético e gera arquivos binários reais.

Sinal sintético verifica o encadeamento técnico; não mede fidelidade de
timbre em uma gravação musical. Esses testes não comprovam separação musical
perfeita, acesso ao YouTube nem funcionamento físico da MK-300. A validação
sonora precisa usar a JEM JR e o sistema de reprodução do usuário. Não há
promessa de timbre idêntico nem de volumes já igualados entre clean e solo.
