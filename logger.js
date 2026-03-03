/* Minimal logger helper
 * - Start logging: adds up to 40 new (simulated) log entries from CONFIG.ITEM_IDS,
 *   avoiding duplicates.
 * - Download logs: exports `SMMO_ITEM_LOGS` as JSON.
 */
(function attachLogger(global) {
  function qs(id) { return document.getElementById(id); }

  document.addEventListener('DOMContentLoaded', () => {
    const startBtn = qs('loggerStartButton');
    const exportBtn = qs('loggerExportButton');
    const apiInput = qs('loggerApiKeyInput');
    const status = qs('loggerStatus');

    let running = false;
    let abortController = null;

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    async function fetchItem(url, options) {
      try {
        const resp = await fetch(url, options);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        return { ok: true, data };
      } catch (err) {
        return { ok: false, error: err };
      }
    }

    startBtn.addEventListener('click', async () => {
      if (running) {
        // Stop requested
        running = false;
        if (abortController) abortController.abort();
        startBtn.textContent = 'Start logging';
        status.textContent = 'Stopping…';
        return;
      }

      const apiKey = (apiInput && apiInput.value || '').trim();
      if (!apiKey) { status.textContent = 'Provide a public API key to start logging.'; return; }

      const config = global.SMMO_SCALER_CONFIG || {};
      const base = (config.API_BASE_URL || 'https://api.simple-mmo.com/v1').replace(/\/$/, '');
      const endpointTemplate = (config.ITEM_BY_ID_ENDPOINT || '/item/info/{id}');
      const method = (config.ITEM_BY_ID_METHOD || 'POST').toUpperCase();
      const apiKeyMode = (config.API_KEY_MODE || 'header');
      const apiKeyHeader = config.API_KEY_HEADER_NAME || 'api_key';

      // Build candidate ID list
      let ids = [];
      if (Array.isArray(config.ITEM_IDS) && config.ITEM_IDS.length > 0) ids = config.ITEM_IDS.slice();
      else {
        for (let i = 1; i <= 175142; i++) ids.push(i);
      }

      const logs = global.SMMO_ITEM_LOGS || [];
      const existing = new Set(logs.map(l => String(l.id)));

      // Filter to unlogged IDs
      const pending = ids.filter(id => !existing.has(String(id)));
      if (pending.length === 0) { status.textContent = 'No unlogged item IDs found.'; return; }

      running = true;
      abortController = new AbortController();
      startBtn.textContent = 'Stop logging';
      status.textContent = `Starting logging — ${pending.length} items available.`;

      let added = 0;
      async function attemptFetchWithFallback(initialUrl, initialOptions, ctx) {
        // Try initial request first, then fall back if 401.
        const attempts = [];
        attempts.push({ url: initialUrl, options: initialOptions, label: 'initial' });

        // If initial used header mode, try Authorization: Bearer next
        if (ctx.apiKeyMode === 'header' && String(ctx.apiKeyHeader).toLowerCase() !== 'authorization') {
          const h = Object.assign({}, initialOptions.headers || {});
          h['Authorization'] = ctx.apiKey.startsWith('Bearer ') ? ctx.apiKey : `Bearer ${ctx.apiKey}`;
          attempts.push({ url: initialUrl, options: Object.assign({}, initialOptions, { headers: h }), label: 'bearer' });
        }

        // Try query param
        const paramName = (ctx.config && ctx.config.API_KEY_QUERY_PARAM) || 'apiKey';
        const sep = initialUrl.includes('?') ? '&' : '?';
        const urlWithQuery = `${initialUrl}${sep}${encodeURIComponent(paramName)}=${encodeURIComponent(ctx.apiKey)}`;
        attempts.push({ url: urlWithQuery, options: initialOptions, label: 'query' });

        // If POST, try including api_key in JSON body as last resort
        if ((ctx.method || 'POST').toUpperCase() === 'POST') {
          const opts = Object.assign({}, initialOptions);
          const h = Object.assign({}, opts.headers || {});
          h['Content-Type'] = 'application/json';
          const body = Object.assign({}, opts.body ? JSON.parse(opts.body) : {}, { api_key: ctx.apiKey });
          opts.headers = h;
          opts.body = JSON.stringify(body);
          attempts.push({ url: initialUrl, options: opts, label: 'body' });
        }

        for (const a of attempts) {
          console.debug('logger: requesting', a.label, a.url, a.options);
          const res = await fetchItem(a.url, a.options);
          if (res.ok) return { ok: true, data: res.data, used: a.label };
          // If fetch failed with 401, continue to next attempt; otherwise return error
          if (res.error && res.error.message && res.error.message.includes('HTTP 401')) {
            console.debug('logger: 401 received for', a.label);
            // small delay before next attempt
            await sleep(300);
            continue;
          }
          return { ok: false, error: res.error };
        }

        return { ok: false, error: new Error('All auth attempts failed (401)') };
      }

      for (const id of pending) {
        if (!running) break;

        const idStr = String(id);
        const urlPath = endpointTemplate.includes('{id}')
          ? endpointTemplate.replace('{id}', encodeURIComponent(idStr))
          : `${endpointTemplate}/${encodeURIComponent(idStr)}`;
        const url = `${base}${urlPath.startsWith('/') ? '' : '/'}${urlPath}`;

        const headers = { 'Accept': 'application/json' };

        // Support header mode (including Authorization: Bearer) and query mode
        let requestUrl = url;
        if (apiKeyMode === 'header') {
          // If header name is Authorization, send as Bearer token
          if (typeof apiKeyHeader === 'string' && apiKeyHeader.toLowerCase() === 'authorization') {
            headers['Authorization'] = apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`;
          } else {
            headers[apiKeyHeader] = apiKey;
          }
        } else if (apiKeyMode === 'query') {
          const paramName = config.API_KEY_QUERY_PARAM || 'apiKey';
          const sep = requestUrl.includes('?') ? '&' : '?';
          requestUrl = `${requestUrl}${sep}${encodeURIComponent(paramName)}=${encodeURIComponent(apiKey)}`;
        }

        const options = { method, headers, signal: abortController.signal };
        if (method === 'POST' && !endpointTemplate.includes('{id}')) {
          options.headers['Content-Type'] = 'application/json';
          options.body = JSON.stringify({ id });
        }

        status.textContent = `Fetching ${idStr}…`;
        const ctx = { apiKeyMode, apiKeyHeader, apiKey, config, method };
        const attemptResult = await attemptFetchWithFallback(url, options, ctx);
        if (attemptResult.ok) {
          const entry = { id: id, fetchedAt: new Date().toISOString(), item: attemptResult.data };
          if (global.SMMO_LOGS && typeof global.SMMO_LOGS.push === 'function') {
            global.SMMO_LOGS.push(entry);
          } else {
            logs.push(entry);
            global.SMMO_ITEM_LOGS = logs;
          }
          added++;
          status.textContent = `Added ${added} items — last ${idStr} (auth: ${attemptResult.used || 'unknown'})`;
        } else {
          console.warn('Fetch failed for', idStr, attemptResult.error);
          status.textContent = `Fetch error for ${idStr}: ${attemptResult.error && attemptResult.error.message ? attemptResult.error.message : attemptResult.error}`;
        }

        try { await sleep(1500); } catch (e) { /* ignore */ }
      }

      running = false;
      abortController = null;
      startBtn.textContent = 'Start logging';
      status.textContent = `Logging completed — added ${added} items.`;
    });

    exportBtn.addEventListener('click', () => {
      const data = JSON.stringify((global.SMMO_LOGS && typeof global.SMMO_LOGS.get === 'function') ? global.SMMO_LOGS.get() : (global.SMMO_ITEM_LOGS || []), null, 2);
      const blob = new Blob([data], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'smmoscaler-logs.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    // Import logs via hidden file input
    const importBtn = qs('loggerImportButton');
    const importInput = qs('loggerImportInput');
    if (importBtn && importInput) {
      importBtn.addEventListener('click', () => importInput.click());
      importInput.addEventListener('change', (ev) => {
        const f = ev.target.files && ev.target.files[0];
        if (!f) return;
        console.debug('logger: import file selected', f.name, f.size);
        const reader = new FileReader();
        reader.onload = () => {
          try {
            let text = reader.result;
            if (typeof text !== 'string') text = String(text || '');
            // strip BOM if present
            if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

            let parsed = JSON.parse(text);
            // Accept common wrappers
            if (!Array.isArray(parsed)) {
              if (parsed && Array.isArray(parsed.logs)) parsed = parsed.logs;
              else if (parsed && Array.isArray(parsed.items)) parsed = parsed.items;
              else if (parsed && Array.isArray(parsed.data)) parsed = parsed.data;
            }

            if (!Array.isArray(parsed)) throw new Error('JSON must be an array or contain an array under "logs"/"items"/"data"');

            const existing = (global.SMMO_LOGS && typeof global.SMMO_LOGS.get === 'function') ? global.SMMO_LOGS.get() : (global.SMMO_ITEM_LOGS || []);

            function extractId(obj) {
              if (obj == null) return null;
              if (typeof obj === 'string' || typeof obj === 'number') return String(obj);
              if (obj.id) return String(obj.id);
              if (obj.item && (obj.item.id || obj.item.item_id)) return String(obj.item.id || obj.item.item_id);
              if (obj.item_id) return String(obj.item_id);
              if (obj.data && (obj.data.id || obj.data.item_id)) return String(obj.data.id || obj.data.item_id);
              return null;
            }

            const seen = new Set(existing.map(e => extractId(e)).filter(Boolean));
            let imported = 0;
            const merged = existing.slice();
            const now = new Date().toISOString();
            for (const entry of parsed) {
              let id = extractId(entry);
              // If parsed entry is a plain item object (no outer id), try its nested id
              if (!id && entry && typeof entry === 'object' && (entry.name || entry.item_name || entry.minLevel)) {
                id = extractId(entry);
              }
              if (!id && entry && entry.item && typeof entry.item === 'object') id = extractId(entry.item);
              if (!id) continue;
              if (seen.has(String(id))) continue;

              // Normalize: if entry already looks like {id, fetchedAt, item}, keep it.
              let toPush = entry;
              if (!(entry && entry.id) && entry && entry.item) {
                // maybe entry.item is the real item
                toPush = { id: id, fetchedAt: now, item: entry.item };
              } else if (!(entry && entry.id) && (entry && (entry.name || entry.item_name))) {
                // entry is a plain item
                toPush = { id: id, fetchedAt: now, item: entry };
              } else if (typeof entry === 'string' || typeof entry === 'number') {
                toPush = { id: id, fetchedAt: now };
              }

              merged.push(toPush);
              seen.add(String(id));
              imported++;
            }

            if (global.SMMO_LOGS && typeof global.SMMO_LOGS.set === 'function') {
              global.SMMO_LOGS.set(merged);
            } else {
              global.SMMO_ITEM_LOGS = merged;
            }
            console.debug('logger: import merged', { imported, total: merged.length, existing: existing.length, parsed: parsed.length });
            status.textContent = `Imported ${imported} items (existing ${existing.length}, parsed ${parsed.length}).`;
          } catch (e) {
            console.error('logger: import error', e);
            status.textContent = `Import failed: ${e && e.message ? e.message : e}`;
          }
        };
        reader.onerror = (err) => {
          console.error('logger: file read error', err);
          status.textContent = 'Import failed: file read error.';
        };
        reader.readAsText(f);
        // reset input
        importInput.value = '';
      });
    }
  });
})(window);
