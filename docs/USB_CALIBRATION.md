# Validação das três referências USB — shell-v20

## Evidência recebida

O proprietário confirmou gravação por USB nos três casos. Os presets usam Fender Super (índice AMP 0), CAB 1EAGLProV30s (índice 0), DS e REV desligados. Comparando os três arquivos de 448 bytes, somente o byte 162 muda: Gain 25, 50 ou 75. Os demais parâmetros permanecem iguais.

| Gain conhecido no preset | RMS do áudio a 16 kHz | Fator de crista | Resultado do servidor corrigido |
| --- | --- | --- | --- |
| 25 | -26,20 dBFS | 15,78 dB | Clean; DS/REV desligados |
| 50 | -13,77 dBFS | 13,78 dB | Clean; DS/REV desligados |
| 75 | -27,06 dBFS | 16,41 dB | Clean; DS/REV desligados |

Os níveis não seguem a ordem do Gain. Gravação USB não torna idênticas a execução, a dinâmica ou o processamento da gravação. Estes exemplos não permitem recuperar o knob Gain nem identificar um amplificador ou IR pelo áudio.

## Correções

- Servidor e navegador usam os mesmos pesos e limiares espectrais (`src/data/audio-analysis.json`). O fator de crista sozinho não escolhe drive; RMS absoluto não participa dessa classificação.
- O servidor mede o áudio original. HPSS continua disponível como componente harmônica aproximada; não é apresentado como guitarra isolada.
- Decaimento pode ser sustain de uma nota. Não ativa REV automaticamente. No editor, configurações manuais de REV são preservadas; novos presets de análise saem sem REV.
- O CAB do novo preset tem o nome confirmado 1EAGLProV30s no índice 0. Essa identificação veio do preset e da captura do editor, não de reconhecimento de IR. Os templates automáticos de CAB permanecem referências editáveis.
- M4A passa pela validação local. Reprodução e análise local dependem do codec do navegador. Quando o codec não está disponível, o arquivo permanece selecionado para envio explícito ao servidor, ou o usuário pode usar WAV/MP3. Não há upload automático nesse fallback.
- O Docker copia a pasta de dados usada em execução, incluindo a configuração compartilhada. O cache PWA passa a shell-v20.

## Validação executada

- `npm run build`: HTMLs gerados novamente.
- `npm test`: 47 aprovados, 2 ignorados pelas suítes antigas por falta de fixtures opcionais.
- `pytest -q tests/backend tests/test_v75_sources.py`: 34 aprovados, incluindo comparação opcional com librosa e teste de pico de memória abaixo de 100 MB com sinal sintético de 45 s.
- `pytest -q src/tests`: 44 aprovados no Chromium/Playwright, incluindo PWA offline, importação de formatos antigos e presets reais V75.
- FFT NumPy e FFT JavaScript comparadas com o mesmo PCM: RMS, espectro, bandas, fluxo e decisão consistentes dentro das tolerâncias numéricas.
- Seno e acorde saturado sintéticos: multiplicar a amplitude por 10 e por 100 mantém a classe e o escore de drive.
- Os três M4A originais passaram por `/api/v1/analyze-file` via TestClient com FFmpeg e DSP reais. Todos retornaram Clean e .dzh de 448 bytes sem DS/REV.
- Os três áudios, convertidos para WAV PCM, passaram pelo carregamento, análise, revisão e compilação no Chromium em larguras de 360/393 px. Todos permaneceram Clean, sem DS/REV. Importação/exportação dos três presets originais preservou todos os 448 bytes.
- Os arquivos de compilação binária e o catálogo V73 original não foram modificados.

O Chromium de laboratório não decodifica o AAC destes M4A; validou-se o fallback explícito. Decodificação M4A no Android físico e qualidade perceptual dos novos presets continuam dependendo de teste no aparelho.

As gravações não são incorporadas ao repositório público. A fixture contém apenas métricas derivadas e estados conhecidos. Os três exemplos são regressões da família clean, não treinamento de uma rede neural nem comprovação de precisão universal. Exemplos reais com drive, mesmo riff e mesma captação são o próximo conjunto de validação.
