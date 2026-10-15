(function (root) {
  'use strict';
  const DB_NAME = 'autopreset-local-learning';
  const STORE = 'examples';
  const STORAGE_KEY = 'autopreset-learning-v1';
  const FEATURE_SCALES = Object.freeze({ rms_db: 30, spectral_centroid_hz: 4000, spectral_rolloff_85_hz: 6000, zero_crossing_rate: 0.2 });

  const MIX_SCALES = Object.freeze({ rms_db: 30, zero_crossing_rate: 0.2, crest_factor_db: 20 });
  const SPECTRAL_MIX_SCALES = Object.freeze({ ...MIX_SCALES, spectral_flatness: 1, spectral_centroid_hz: 4000, spectral_rolloff_85_hz: 6000, spectral_flux: 1, harmonic_energy_ratio: 1 });
  function scalesFor(features) { return features.audio_source === 'full_mix' ? (features.feature_version === 3 ? SPECTRAL_MIX_SCALES : MIX_SCALES) : FEATURE_SCALES; }
  function normalizeRecord(record) {
    if (!record || typeof record !== 'object' || !record.features || !record.draft || typeof record.draft !== 'object') throw new Error('Exemplo de aprendizagem incompleto.');
    const features = {};
    for (const key of Object.keys(scalesFor(record.features))) {
      const value = Number(record.features[key]);
      if (!Number.isFinite(value)) throw new Error('Medições de áudio inválidas.');
      features[key] = value;
    }
    if (record.features.audio_source === 'full_mix') { features.audio_source = 'full_mix'; features.feature_version = record.features.feature_version === 3 ? 3 : 2; }
    const now = new Date().toISOString();
    return {
      id: String(record.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(16).slice(2))),
      created_at: record.created_at || now,
      reference: String(record.reference || 'Trecho de áudio').slice(0, 160),
      rating: Math.max(1, Math.min(5, Number(record.rating) || 3)),
      note: String(record.note || '').slice(0, 500),
      features,
      initial_draft: record.initial_draft && typeof record.initial_draft === 'object' ? record.initial_draft : null,
      draft: record.draft,
      preset_bytes: Array.isArray(record.preset_bytes) && record.preset_bytes.length === 448 ? record.preset_bytes.map(v => Math.max(0, Math.min(255, Number(v) || 0))) : null
    };
  }

  function distance(a, b) {
    if ((a?.audio_source === 'full_mix') !== (b?.audio_source === 'full_mix')) return Infinity;
    let sum = 0, count = 0;
    for (const [key, scale] of Object.entries(a?.feature_version === 3 && b?.feature_version === 3 ? SPECTRAL_MIX_SCALES : a?.audio_source === 'full_mix' ? MIX_SCALES : FEATURE_SCALES)) {
      const left = Number(a?.[key]), right = Number(b?.[key]);
      if (Number.isFinite(left) && Number.isFinite(right)) { sum += ((left - right) / scale) ** 2; count++; }
    }
    return count ? Math.sqrt(sum / count) : Infinity;
  }

  function fallbackList() {
    try { const data = JSON.parse(root.localStorage?.getItem(STORAGE_KEY) || '[]'); return Array.isArray(data) ? data : []; }
    catch { return []; }
  }
  function persistFallback(records) {
    if (!root.localStorage) throw new Error('Armazenamento local não disponível neste navegador.');
    root.localStorage.setItem(STORAGE_KEY, JSON.stringify(records.slice(0, 250)));
  }
  function openDb() {
    return new Promise((resolve, reject) => {
      if (!root.indexedDB) return resolve(null);
      const request = root.indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('Não foi possível abrir o banco local.'));
    });
  }
  async function list() {
    const db = await openDb();
    if (!db) return fallbackList();
    try { return await new Promise((resolve, reject) => { const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll(); request.onsuccess = () => resolve(request.result || []); request.onerror = () => reject(request.error); }); }
    finally { db.close(); }
  }
  async function save(raw) {
    const record = normalizeRecord(raw), db = await openDb();
    if (!db) { const records = fallbackList().filter(item => item.id !== record.id); persistFallback([record, ...records]); return record; }
    try { await new Promise((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(record); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); return record; }
    finally { db.close(); }
  }
  async function remove(id) {
    const db = await openDb();
    if (!db) { persistFallback(fallbackList().filter(item => item.id !== id)); return; }
    try { await new Promise((resolve, reject) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).delete(String(id)); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); }); }
    finally { db.close(); }
  }
  async function bestMatch(features) {
    const records = await list();
    return records.map(record => ({ record, distance: distance(features, record.features) }))
      .filter(item => Number.isFinite(item.distance))
      .sort((a, b) => a.distance - b.distance || b.record.rating - a.record.rating)[0] || null;
  }
  async function exportJson() { return JSON.stringify({ format: 'AutoPresetLearning', version: 1, examples: await list() }, null, 2); }
  async function importJson(data) {
    if (!data || data.format !== 'AutoPresetLearning' || data.version !== 1 || !Array.isArray(data.examples) || data.examples.length > 250) throw new Error('Arquivo de exemplos AutoPreset inválido.');
    const current = await list();
    for (const item of data.examples) current.unshift(await save(item));
    return current.length;
  }

  root.AutoPresetLearning = Object.freeze({ save, list, remove, bestMatch, distance, exportJson, importJson, normalizeRecord, FEATURE_SCALES });
})(typeof window !== 'undefined' ? window : globalThis);
