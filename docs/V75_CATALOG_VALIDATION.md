# Catálogo V75 e capturas personalizadas

## Fonte e alcance

`src/data/mk300-v75-confirmed.json` contém os nomes fornecidos pelo proprietário e, separadamente, os índices confirmados nos arquivos exportados do M-EFECT V75. Não é apresentado como um catálogo oficial universal de modelos instalados. Os nomes sem índice confirmado não são convertidos em índices pela posição na lista nem pelo prefixo numérico.

O catálogo V73 original permanece intacto para importar projetos, códigos e presets antigos. O backend e o frontend aplicam a mesma camada V75, gerada a partir do JSON. O build regenera `src/data/v75.js` e os dois HTMLs autônomos.

## Mapeamentos confirmados

| Bloco | Nome exibido no equipamento | Índice binário |
| --- | --- | --- |
| DS | MW-808 | 40 |
| DS | MW-GOLD | 41 |
| AMP | Fender Super | 0 |
| AMP | 6DS-MarsFD100 | 5 |
| AMP | 53DS-Pey5150 | 52 |
| CAB | 44MarVal4 | 43 |

As sugestões automáticas locais, por texto e do backend usam apenas esses mapeamentos para AMP, DS e CAB. Clean/MPB usam Fender Super sem DS; Crunch/Blues usam Fender Super com MW-GOLD; alto ganho usa um dos dois amps confirmados com MW-808. São pontos de partida heurísticos, não correspondências sonoras medidas do equipamento.

## NAM

`Jcm800` e `Boss DS-2 Mod` são nomes de capturas instaladas, não modelos internos com índice fixo universal. Os arquivos novos contêm índices AMP 115, 117 e 118. O `.dzh` não contém o nome nem os pesos do NAM; os nomes desses três índices não são adivinhados.

Nos arquivos `variação teste 4.dzh` e `teste 5.dzh`, o bloco AMP/NAM está ligado e o DS desligado. O site desliga e bloqueia o DS quando o usuário seleciona o modo NAM. Os parâmetros do DS ficam guardados. O CAB é desligado apenas quando o usuário identifica uma captura com gabinete integrado.

A seleção NAM aceita as 120 posições do catálogo carregado, incluindo as posições 116, 118 e 119 observadas. Isso não afirma que existam 120 slots NAM livres. A posição deve corresponder ao modelo realmente instalado no equipamento.

## Compatibilidade

As seis exportações originais estão em `src/tests/fixtures/v75/`, com nome original, SHA-256, índices e estados em `manifest.json`.

Os testes comparam todos os 448 bytes entre a entrada e a saída dos encoders JavaScript e Python, verificam importação e compartilhamento na interface real, e testam o percurso áudio sintético → DSP → modelos confirmados → `.dzh`. Os quatro presets John Petrucci e os formatos v1 continuam cobertos pelas suítes existentes.

`MK300PresetHandler` e `services/dzh_encoder.py` não foram modificados. Os valores de corte CAB continuam sendo int16 brutos; esta atualização não cria uma conversão não comprovada para Hz.

### Execução local

- `npm run build`: concluído; os dois HTMLs foram regenerados.
- `npm test`: 46 testes aprovados, nenhum com falha, dois testes opcionais de fixtures legadas ausentes ignorados.
- `CHROMIUM_PATH=<headless_shell> python -m pytest -q tests/backend src/tests tests/test_v75_sources.py`: 68 testes aprovados, nenhum com falha; uma comparação opcional com librosa ignorada porque essa dependência de referência não estava instalada.
- Chromium 140 via Playwright 1.55: importação/exportação, compartilhamento, projetos legados, NAM/DS, operação offline, abas, áudio sintético e larguras mobile/tablet/desktop.
- `git diff --check`: aprovado. Núcleo JS, encoder Python, dados V73 originais e Dockerfile sem alterações.

Os testes HTTP do YouTube simulam o transporte; não comprovam que o YouTube aceitará downloads a partir do IP de produção. O timbre final ainda depende da comparação auditiva na MK-300.

## Publicação

O service worker usa `shell-v19`. GitHub Pages publica o frontend após o push para `main`; o serviço Railway deve reconstruir o backend pelo vínculo existente com essa branch. A PWA e um APK que carrega essa URL recebem a atualização pelo site. Capturas NAM, IRs e firmware não são transferidos pelo `.dzh`.
