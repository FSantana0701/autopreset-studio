(function (root) {
  'use strict';

  const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
  const MAX_CLIP_SECONDS = 45;

  function endpointFor(serviceUrl) {
    let base;
    try {
      base = new URL(String(serviceUrl || '').trim());
    } catch {
      throw new Error('Informe o endereço HTTPS do serviço de separação.');
    }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname);
    if (base.protocol !== 'https:' && !(local && base.protocol === 'http:')) {
      throw new Error('O serviço precisa usar HTTPS. HTTP só é aceito em localhost.');
    }
    return new URL('/v1/separate', base).href;
  }

  async function separate({ serviceUrl, apiKey, file, startSeconds, endSeconds, signal }) {
    if (!(file instanceof Blob) || file.size <= 0) throw new Error('Selecione um MP3 ou WAV.');
    if (file.size > MAX_UPLOAD_BYTES) throw new Error('O arquivo excede 25 MiB.');
    if (!Number.isFinite(startSeconds) || !Number.isFinite(endSeconds) || startSeconds < 0 || endSeconds <= startSeconds) {
      throw new Error('O intervalo de áudio é inválido.');
    }
    if (endSeconds - startSeconds > MAX_CLIP_SECONDS) {
      throw new Error('Cada trecho pode ter no máximo 45 segundos.');
    }

    const endpoint = endpointFor(serviceUrl);
    if (!String(apiKey || '').trim()) throw new Error('Informe a chave de acesso do serviço.');
    const form = new FormData();
    form.append('file', file, file.name || 'audio.wav');
    form.append('start_seconds', String(startSeconds));
    form.append('end_seconds', String(endSeconds));

    let response;
    try {
      response = await root.fetch(endpoint, { method: 'POST', body: form, signal,
        headers: { Authorization: `Bearer ${String(apiKey).trim()}` }
      });
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      throw new Error('Não foi possível conectar ao serviço de separação. Confira a URL e a conexão.');
    }
    if (!response.ok) {
      let detail = '';
      try {
        const payload = await response.json();
        detail = typeof payload.detail === 'string' ? payload.detail : '';
      } catch { /* mensagem HTTP genérica */ }
      throw new Error(detail || `O serviço de separação respondeu HTTP ${response.status}.`);
    }
    if (!/^audio\/wav(?:\s*;|$)/i.test(response.headers.get('content-type') || '')) {
      throw new Error('O serviço não retornou um arquivo WAV válido.');
    }
    const blob = await response.blob();
    if (!blob.size) throw new Error('O separador retornou uma faixa vazia.');
    return { blob, model: response.headers.get('x-audio-separator') || 'separador próprio' };
  }

  root.AutoPresetAudio = Object.freeze({ separate, endpointFor, MAX_CLIP_SECONDS, MAX_UPLOAD_BYTES });
})(typeof window !== 'undefined' ? window : globalThis);
