# AutoPreset Studio · MK-300 v73

O site agora também pode ser instalado no Android como PWA. O editor, o compilador `.dzh` de 448 bytes e os projetos continuam no navegador; a separação experimental de guitarra roda no próprio aparelho.

## Privacidade e custos

- Não é necessária chave de OpenAI, Anthropic ou Gemini.
- O arquivo da música não é enviado ao AutoPreset nem guardado pelo app.
- Na primeira separação, o app baixa o runtime ONNX e o modelo `htdemucs_6s` (aprox. 136 MB). O modelo é um arquivo estático público; a inferência acontece no aparelho. O navegador tenta guardá-lo no Cache Storage para reutilização. A interface e o runtime ainda podem precisar de conexão para carregar; o áudio nunca é enviado à API.
- Recomenda-se abrir por HTTPS no Chrome do Android. A página e os recursos PWA podem ser publicados gratuitamente como arquivos estáticos.
- O modelo 6-stem tem uma saída específica de guitarra, mas o resultado é experimental e pode conter vazamento. A gravação e a avaliação física na MK-300 continuam sendo a referência.

## Correções que ajudam as próximas sugestões

Depois de testar o preset na MK-300, marque a confirmação, informe a avaliação, ajuste os controles no editor e toque em **Salvar este teste como exemplo**. O app guarda localmente as medições, os parâmetros corrigidos e o `.dzh` compilado — sem armazenar o áudio. Em análises futuras, ele pode oferecer o exemplo com características acústicas mais parecidas como ponto de partida.

Isso é aprendizagem por exemplos validados, não retreinamento automático do modelo de separação ou de um LLM. Os exemplos podem ser exportados em JSON para backup ou para uma etapa futura de treinamento.

As sugestões iniciais por texto continuam sendo perfis heurísticos offline. Elas são pontos de partida e não alegam reconhecer exatamente o timbre de uma gravação. O usuário revisa e testa antes de exportar.

## Instalar no Android

1. Publique o conteúdo desta pasta em um host HTTPS estático (GitHub Pages serve).
2. Abra o endereço no Chrome do Android.
3. No menu do Chrome, escolha **Instalar app** ou **Adicionar à tela inicial**.
4. A primeira separação precisa de internet para baixar o modelo. Depois, o app tenta reutilizá-lo localmente.

O projeto não inclui APK nem publicação na Play Store nesta etapa. A PWA instala a interface no aparelho sem taxa de loja.

## Estrutura

- `src/data/`: catálogo v73.
- `src/core/`: compilador preservado do formato binário de 448 bytes.
- `src/integrations/local-audio.js`: inferência ONNX local, saída guitar do `htdemucs_6s`, medições e WAV.
- `src/integrations/learning-store.js`: exemplos de correção em IndexedDB, com fallback local.
- `manifest.webmanifest`, `sw.js`, `icons/`: instalação e cache da interface PWA.
- `audio-service/`: serviço Python da versão anterior, mantido para referência; não é necessário para a versão local e não é chamado pela interface.

## Gerar o HTML autônomo

Edite `src/` e gere a página da raiz:

```sh
node src/build-standalone.cjs ../index.html
```

O runtime ONNX é importado sob demanda de jsDelivr e o modelo é obtido do Hugging Face quando a primeira análise é iniciada. A inferência recebe os dados no navegador; nenhuma requisição envia o áudio.

## Testes

```sh
node src/tests/core.test.cjs
node src/tests/differential.test.cjs
node src/tests/startup.test.cjs
node src/tests/claude-adapter.test.cjs
node src/tests/tone3000-select.test.cjs
node src/tests/audio-separation.test.cjs
node src/tests/local-audio.test.cjs
node src/tests/learning-store.test.cjs
node src/tests/pwa.test.cjs
python -m unittest discover -s src/tests -p 'audio_service_test.py' -v
```

O diferencial continua exigindo a identidade dos 448 bytes. Separação, consumo de memória e desempenho precisam ser conferidos no aparelho Android real; os testes automatizados deste pacote não substituem essa validação.
