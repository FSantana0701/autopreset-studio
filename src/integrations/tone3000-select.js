/* TONE3000 Select OAuth flow for user-requested NAM A2 downloads.
 * Catalog data and model files are never mirrored or saved by AutoPreset. */
(function (root) {
  'use strict';

  const API = 'https://www.tone3000.com/api/v1';
  const CLIENT_KEY = 'autopreset-tone3000-publishable-key';
  const FLOW_KEY = 'autopreset-tone3000-oauth-flow';
  const utf8 = new TextEncoder();
  let accessToken = '';
  let selectedTone = null;
  let selectedModels = [];

  function cleanRedirectUrl(locationLike) {
    const url = new URL(locationLike.href);
    url.search = '';
    url.hash = '';
    return url.href;
  }

  function unwrap(value, key) {
    let current = value;
    if (current && typeof current === 'object' && current[key]) current = current[key];
    if (current && typeof current === 'object' && current.data && !Array.isArray(current.data)) current = current.data;
    if (current && typeof current === 'object' && current[key]) current = current[key];
    return current;
  }

  function rows(value) {
    if (Array.isArray(value)) return value;
    for (const key of ['data', 'results', 'models', 'tones']) {
      if (value?.[key] !== undefined && value[key] !== value) {
        const result = rows(value[key]);
        if (result.length) return result;
      }
    }
    return [];
  }

  function safeName(value) {
    const name = String(value || 'TONE3000_NAM_A2')
      .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^[_\.]+|[_\.]+$/g, '').slice(0, 100);
    return (name || 'TONE3000_NAM_A2').replace(/\.nam$/i, '') + '.nam';
  }

  function modelArchitecture(model) {
    return model?.architecture_version ?? model?.architecture ?? model?.model_architecture;
  }

  function modelIsA2(model) {
    const architecture = modelArchitecture(model);
    return architecture === 2 || architecture === '2' || String(architecture || '').toUpperCase() === 'A2';
  }

  function modelIsA2Lite(model) {
    return modelIsA2(model) && String(model?.size || '').toLowerCase() === 'lite';
  }

  function compatibleModels(models) {
    return models.filter(model => model && model.id !== undefined && modelIsA2Lite(model) && (model.model_url || model.download_url));
  }

  function gearType(tone) {
    const value = tone?.gear ?? tone?.gear_type;
    return typeof value === 'string' ? value.toLowerCase() : '';
  }

  function creatorName(tone) {
    return tone?.user?.username || tone?.creator?.username || tone?.creator_name || tone?.username || '';
  }

  function licenseName(tone) {
    const value = tone?.license;
    if (typeof value === 'string') return value;
    return value?.name || value?.slug || tone?.license_name || '';
  }

  function authorizationUrl(id, redirectUri, state, challenge) {
    const params = new URLSearchParams({
      client_id: id, redirect_uri: redirectUri, response_type: 'code',
      code_challenge: challenge, code_challenge_method: 'S256', state,
      prompt: 'select_tone', format: 'nam', architecture: '2', gears: 'amp_amp-cab',
      preview: 'true', menubar: 'true'
    });
    return 'https://www.tone3000.com/api/v1/oauth/authorize?' + params.toString();
  }

  function summarizeTone(tone) {
    const creator = creatorName(tone) || 'não informado';
    const license = licenseName(tone) || 'não informada';
    return `${tone?.title || tone?.name || 'Captura selecionada'} · @${creator} · Licença: ${license}`;
  }

  function toBase64Url(bytes) {
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return root.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  async function pkcePair() {
    const bytes = new Uint8Array(32);
    root.crypto.getRandomValues(bytes);
    const verifier = toBase64Url(bytes);
    const digest = await root.crypto.subtle.digest('SHA-256', utf8.encode(verifier));
    return { verifier, challenge: toBase64Url(new Uint8Array(digest)) };
  }

  function status(message, kind) {
    const node = root.document.getElementById('tone3000Status');
    if (!node) return;
    if (typeof root.setStatus === 'function') {
      root.setStatus(node, message, kind);
      return;
    }
    node.textContent = message;
    node.className = 'status' + (kind ? ' ' + kind : '');
  }

  function renderToneDetails(tone, modelCount) {
    const node = root.document.getElementById('tone3000Details');
    if (!node) return;
    const gear = gearType(tone);
    const gearLabel = gear === 'amp-cab' ? 'Amp + gabinete' : gear === 'amp' ? 'Cabeçote/amplificador' : (gear || 'tipo não informado');
    const creator = creatorName(tone);
    const license = licenseName(tone);
    const rows = [
      ['Captura', tone?.title || tone?.name || 'Título não informado'],
      ['Equipamento', gearLabel],
      ['Criador', creator ? '@' + creator : 'não informado'],
      ['Licença', license || 'consulte o perfil no TONE3000'],
      ['Modelos A2-Lite', String(modelCount)]
    ];
    node.replaceChildren();
    const list = root.document.createElement('dl');
    for (const [label, value] of rows) {
      const term = root.document.createElement('dt');
      const detail = root.document.createElement('dd');
      term.textContent = label;
      detail.textContent = String(value);
      list.append(term, detail);
    }
    node.append(list);
    if (gear === 'amp-cab') {
      const warning = root.document.createElement('p');
      warning.className = 'status warn';
      warning.textContent = 'Esta captura inclui amplificador + gabinete. Ao selecionar esse tipo, o AutoPreset desligará o bloco CAB para evitar duplicar a caixa.';
      node.append(warning);
    }
    const toneUrl = tone?.url || (tone?.id ? 'https://www.tone3000.com/tones/' + encodeURIComponent(tone.id) : '');
    if (toneUrl) {
      try {
        const url = new URL(toneUrl, 'https://www.tone3000.com');
        if (url.origin === 'https://www.tone3000.com') {
          const link = root.document.createElement('a');
          link.href = url.href;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = 'Abrir perfil, modelos e licença no TONE3000 ↗';
          node.append(link);
        }
      } catch {}
    }
    node.hidden = false;
  }

  function clientId() {
    const input = root.document.getElementById('tone3000ClientId');
    const value = String(input?.value || '').trim();
    if (!value || value.length > 200 || /\s/.test(value)) throw new Error('Informe a publishable key do TONE3000. Não use a secret key.');
    try { root.localStorage.setItem(CLIENT_KEY, value); } catch {}
    return value;
  }

  async function requestJson(url, token, options = {}) {
    const response = await root.fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), Authorization: 'Bearer ' + token, Accept: 'application/json' }
    });
    if (!response.ok) {
      let detail = '';
      try { const payload = await response.json(); detail = payload.error_description || payload.message || ''; } catch {}
      throw new Error('TONE3000 respondeu HTTP ' + response.status + (detail ? ': ' + detail : '.'));
    }
    return response.json();
  }

  function renderModels(tone, models) {
    const select = root.document.getElementById('tone3000Model');
    const button = root.document.getElementById('tone3000Download');
    select.replaceChildren(new root.Option('Selecione um modelo A2', ''));
    const a2Models = models.filter(model => model && model.id !== undefined && modelIsA2(model));
    selectedModels = compatibleModels(models);
    for (const model of selectedModels) {
      const label = [model.name || model.title || ('Modelo ' + model.id), 'A2-Lite'].join(' · ');
      select.add(new root.Option(label, String(model.id)));
    }
    select.disabled = selectedModels.length === 0;
    button.disabled = selectedModels.length === 0;
    selectedTone = tone;
    renderToneDetails(tone, selectedModels.length);
    if (!selectedModels.length) {
      status(a2Models.length
        ? 'O pacote tem ' + a2Models.length + ' modelo(s) A2, mas nenhum foi identificado pela API como tamanho Lite. Para MK-300 v73, não ofereço o download de variantes Full/sem tamanho confirmado.'
        : 'O pacote foi selecionado, mas não retornou modelos A2 identificados pela API. Abra o pacote no TONE3000 e confira os modelos.', 'warn');
      return;
    }
    status(summarizeTone(tone) + ' · ' + selectedModels.length + ' variante(s) NAM A2-Lite disponível(is) para o AMP da MK-300 v73. Escolha uma para baixar.', 'good');
  }

  async function loadSelectedTone(toneId) {
    if (!/^\d+$/.test(String(toneId || ''))) throw new Error('O retorno do TONE3000 não trouxe um ID de captura válido.');
    const [toneResponse, modelResponse] = await Promise.all([
      requestJson(API + '/tones/' + encodeURIComponent(toneId), accessToken),
      requestJson(API + '/models?tone_id=' + encodeURIComponent(toneId) + '&page=1&page_size=300&architecture=2', accessToken)
    ]);
    const tone = unwrap(toneResponse, 'tone');
    if (String(tone?.format || '').toLowerCase() !== 'nam') throw new Error('A API não confirmou o formato NAM deste perfil.');
    if (!['amp', 'amp-cab'].includes(gearType(tone))) throw new Error('A API não confirmou que este perfil é amp ou amp + gabinete para o slot AMP.');
    const models = rows(modelResponse);
    renderModels(tone, models);
  }

  async function finishOAuth() {
    const url = new URL(root.location.href);
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    const toneId = url.searchParams.get('tone_id');
    const error = url.searchParams.get('error_description') || url.searchParams.get('error');
    const canceled = url.searchParams.get('canceled') === 'true';
    if (!code && !returnedState && !error && !canceled) return;
    const savedRaw = root.sessionStorage.getItem(FLOW_KEY);
    root.history.replaceState(null, '', cleanRedirectUrl(root.location));
    if (canceled) {
      root.sessionStorage.removeItem(FLOW_KEY);
      throw new Error('Seleção TONE3000 cancelada. Você pode tentar novamente quando quiser.');
    }
    if (error) throw new Error('Seleção TONE3000 cancelada ou recusada: ' + error);
    if (!savedRaw) throw new Error('Sessão OAuth não encontrada. Reabra o seletor TONE3000.');
    const saved = JSON.parse(savedRaw);
    root.sessionStorage.removeItem(FLOW_KEY);
    if (!code || !returnedState || returnedState !== saved.state) throw new Error('Retorno OAuth inválido; estado de segurança não confere.');
    if (!toneId) throw new Error('Nenhuma captura foi selecionada no TONE3000.');
    const recover = root.document.getElementById('recoverProject');
    if (recover && !recover.hidden) recover.click();
    const body = new URLSearchParams({
      grant_type: 'authorization_code', code,
      code_verifier: saved.verifier,
      redirect_uri: saved.redirectUri,
      client_id: saved.clientId
    });
    const tokenResponse = await root.fetch(API + '/oauth/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body
    });
    const tokenData = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenData.access_token) throw new Error(tokenData.error_description || tokenData.message || 'Não foi possível autenticar no TONE3000.');
    accessToken = tokenData.access_token;
    await loadSelectedTone(toneId);
  }

  async function beginSelect() {
    const id = clientId();
    if (typeof root.autosaveProject === 'function') root.autosaveProject();
    const redirectUri = cleanRedirectUrl(root.location);
    const { verifier, challenge } = await pkcePair();
    const stateBytes = new Uint8Array(24);
    root.crypto.getRandomValues(stateBytes);
    const state = toBase64Url(stateBytes);
    root.sessionStorage.setItem(FLOW_KEY, JSON.stringify({ verifier, state, clientId: id, redirectUri }));
    root.location.assign(authorizationUrl(id, redirectUri, state, challenge));
  }

  async function downloadSelectedModel() {
    if (!accessToken) throw new Error('A sessão TONE3000 expirou. Escolha a captura novamente.');
    const id = root.document.getElementById('tone3000Model').value;
    const model = selectedModels.find(item => String(item.id) === id);
    if (!model) throw new Error('Selecione um modelo A2 da lista.');
    if (!modelIsA2Lite(model)) throw new Error('A variante selecionada não está identificada como NAM A2-Lite para a MK-300 v73.');
    const detail = model.model_url ? model : await requestJson(API + '/models/' + encodeURIComponent(id), accessToken);
    if (!modelIsA2Lite(detail)) throw new Error('A API não confirmou arquitetura A2 e tamanho Lite para este arquivo. Download cancelado.');
    const modelUrl = detail.model_url || detail.download_url;
    if (!modelUrl) throw new Error('O TONE3000 não forneceu um endereço para este modelo.');
    const response = await root.fetch(modelUrl, { headers: { Authorization: 'Bearer ' + accessToken } });
    if (!response.ok) throw new Error('Falha ao baixar o modelo NAM (HTTP ' + response.status + ').');
    const blob = await response.blob();
    const url = root.URL.createObjectURL(blob);
    const anchor = root.document.createElement('a');
    anchor.href = url;
    anchor.download = safeName(detail.name || detail.title || model.name || selectedTone?.title);
    anchor.textContent = 'Baixar novamente ' + anchor.download;
    anchor.className = 'downloadFallback';
    status('Download iniciado: ' + anchor.download + '. Se não começar automaticamente, use o link abaixo.', 'good');
    anchor.click();
    root.setTimeout(() => root.URL.revokeObjectURL(url), 60000);

    const selection = root.document.getElementById('namMode');
    const slot = root.document.getElementById('namSlot');
    const name = root.document.getElementById('namLabel');
    const kind = root.document.getElementById('namKind');
    selection.checked = true;
    selection.dispatchEvent(new root.Event('change', { bubbles: true }));
    name.value = String(detail.name || detail.title || model.name || selectedTone?.title || 'NAM A2').slice(0, 120);
    const gear = gearType(selectedTone);
    kind.value = gear === 'amp-cab' ? 'amp_cab' : gear === 'amp' ? 'amp_only' : 'unknown';
    root.document.getElementById('namInstalled').checked = false;
    root.document.getElementById('namSuggested').checked = false;
    slot.dispatchEvent(new root.Event('change', { bubbles: true }));
    root.document.getElementById('namKind').dispatchEvent(new root.Event('change', { bubbles: true }));
    root.document.getElementById('namLabel').dispatchEvent(new root.Event('input', { bubbles: true }));
    const toneUrl = selectedTone?.url || ('https://www.tone3000.com/tones/' + selectedTone?.id);
    status('Arquivo baixado para este dispositivo: ' + anchor.download + '. ' + summarizeTone(selectedTone) + '. Abra a página da captura: ' + toneUrl + '. Importe no M‑EFCS no slot AMP ' + slot.value + ' e confirme abaixo.', 'good');
    const statusNode = root.document.getElementById('tone3000Status');
    if (statusNode) statusNode.append(root.document.createTextNode(' '), anchor);
  }

  function init() {
    const clientInput = root.document.getElementById('tone3000ClientId');
    const button = root.document.getElementById('tone3000Select');
    const download = root.document.getElementById('tone3000Download');
    if (!clientInput || !button || !download) return;
    try { clientInput.value = root.localStorage.getItem(CLIENT_KEY) || ''; } catch {}
    clientInput.addEventListener('change', () => {
      try { if (clientInput.value.trim()) root.localStorage.setItem(CLIENT_KEY, clientInput.value.trim()); }
      catch { status('Não foi possível guardar a publishable key neste navegador.', 'warn'); }
    });
    button.addEventListener('click', async () => {
      button.disabled = true;
      try { status('Abrindo o seletor oficial TONE3000…'); await beginSelect(); }
      catch (error) { status(error.message || 'Não foi possível abrir o TONE3000.', 'bad'); button.disabled = false; }
    });
    download.addEventListener('click', async () => {
      download.disabled = true;
      try { status('Baixando o modelo escolhido…'); await downloadSelectedModel(); }
      catch (error) { status(error.message || 'Não foi possível baixar o modelo.', 'bad'); }
      finally { download.disabled = false; }
    });
    finishOAuth().catch(error => status(error.message || 'Falha ao concluir a seleção TONE3000.', 'bad'));
  }

  root.Tone3000Select = Object.freeze({ init, cleanRedirectUrl, rows, safeName, modelIsA2, modelIsA2Lite, compatibleModels, gearType, summarizeTone, authorizationUrl });
})(typeof window === 'undefined' ? globalThis : window);
