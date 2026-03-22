/* Minimal logger helper
 * - Start logging: adds up to 40 new (simulated) log entries from CONFIG.ITEM_IDS,
 *   avoiding duplicates.
 * - Download logs: exports `SMMO_ITEM_LOGS` as JSON.
 */
(function attachLogger(global) {
  function qs(id) { return document.getElementById(id); }
  const IMPORTED_IDS_STORAGE_KEY = 'smmoscaler_imported_ids_v1';

  function loadImportedIds() {
    try {
      const raw = localStorage.getItem(IMPORTED_IDS_STORAGE_KEY);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed.map(x => String(x)).filter(Boolean));
    } catch (e) {
      return new Set();
    }
  }

  function saveImportedIds(idSet) {
    try {
      const arr = Array.from(idSet || []).map(x => String(x)).filter(Boolean);
      localStorage.setItem(IMPORTED_IDS_STORAGE_KEY, JSON.stringify(arr));
    } catch (e) {
      // ignore storage failures
    }
  }

  function parseJsonFlexible(text) {
    const source = String(text || '').trim();
    if (!source) throw new Error('JSON is empty.');

    // 1) Strict JSON first.
    try {
      return JSON.parse(source);
    } catch (firstErr) {
      // continue with fallbacks
    }

    // 2) Allow trailing commas before } or ].
    try {
      const withoutTrailingCommas = source.replace(/,\s*([}\]])/g, '$1');
      return JSON.parse(withoutTrailingCommas);
    } catch (secondErr) {
      // continue with fallbacks
    }

    // 3) NDJSON / JSON lines support (one JSON value per line).
    const lines = source
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean);
    if (lines.length > 1) {
      try {
        return lines.map(line => JSON.parse(line));
      } catch (thirdErr) {
        // continue with fallbacks
      }
    }

    // 4) Concatenated top-level objects/arrays without commas.
    try {
      const merged = source
        .replace(/}\s*{/g, '},{')
        .replace(/\]\s*\[/g, '],[');
      return JSON.parse(`[${merged}]`);
    } catch (finalErr) {
      throw new Error(`Unsupported JSON format: ${finalErr && finalErr.message ? finalErr.message : finalErr}`);
    }
  }

  function extractId(obj) {
    if (obj == null) return null;
    if (typeof obj === 'string' || typeof obj === 'number') return String(obj);
    if (obj.id) return String(obj.id);
    if (obj.item && (obj.item.id || obj.item.item_id)) return String(obj.item.id || obj.item.item_id);
    if (obj.item_id) return String(obj.item_id);
    if (obj.data && (obj.data.id || obj.data.item_id)) return String(obj.data.id || obj.data.item_id);
    return null;
  }

  function toPositiveInt(value) {
    const n = Number.parseInt(String(value), 10);
    return Number.isInteger(n) && n > 0 ? n : 0;
  }

  function getLatestLoggedItemId(entries) {
    let maxId = 0;
    for (const entry of (entries || [])) {
      const directId = toPositiveInt(extractId(entry));
      if (directId > maxId) maxId = directId;

      if (entry && typeof entry === 'object') {
        const nestedItemId = toPositiveInt(extractId(entry.item));
        if (nestedItemId > maxId) maxId = nestedItemId;

        const nestedDataId = toPositiveInt(extractId(entry.data));
        if (nestedDataId > maxId) maxId = nestedDataId;
      }
    }
    return maxId;
  }

  function unwrapArrayPayload(payload) {
    let parsed = payload;
    if (!Array.isArray(parsed)) {
      if (parsed && Array.isArray(parsed.logs)) parsed = parsed.logs;
      else if (parsed && Array.isArray(parsed.items)) parsed = parsed.items;
      else if (parsed && Array.isArray(parsed.data)) parsed = parsed.data;
    }
    return Array.isArray(parsed) ? parsed : null;
  }

  function mergeLogEntries(existing, incomingEntries) {
    const seen = new Set(existing.map(e => extractId(e)).filter(Boolean));
    let imported = 0;
    const merged = existing.slice();
    const now = new Date().toISOString();

    for (const entry of incomingEntries) {
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

    return { merged, imported };
  }

  async function fetchJsonIfPresent(filePath) {
    // For file:// protocol, use XMLHttpRequest instead of fetch to avoid CORS issues
    const isLocalFile = typeof window !== 'undefined' && window.location.protocol === 'file:';
    
    if (isLocalFile) {
      return new Promise((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.onload = () => {
          if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) {
            try {
              const data = JSON.parse(xhr.responseText);
              console.debug('logger: successfully fetched (xhr)', filePath, { entriesLoaded: Array.isArray(data) ? data.length : (data?.files ? '(index)' : 'unknown') });
              resolve(data);
            } catch (e) {
              console.debug('logger: JSON parse failed', filePath, e.message);
              resolve(null);
            }
          } else {
            console.debug('logger: xhr returned non-ok status', filePath, xhr.status);
            resolve(null);
          }
        };
        xhr.onerror = () => {
          console.debug('logger: xhr request failed', filePath);
          resolve(null);
        };
        xhr.ontimeout = () => {
          console.debug('logger: xhr request timed out', filePath);
          resolve(null);
        };
        xhr.open('GET', filePath, true);
        xhr.timeout = 5000;
        xhr.send();
      });
    }
    
    // For HTTP(S), use fetch
    try {
      const response = await fetch(filePath);
      if (!response.ok) {
        console.debug('logger: fetch returned non-ok status', filePath, response.status);
        return null;
      }
      const data = await response.json();
      console.debug('logger: successfully fetched', filePath, { entriesLoaded: Array.isArray(data) ? data.length : (data?.files ? '(index)' : 'unknown') });
      return data;
    } catch (e) {
      console.debug('logger: fetch failed', filePath, e.message);
      return null;
    }
  }

  async function getSplitFileListFromIndex() {
    const indexPayload = await fetchJsonIfPresent('smmoscaler-logs.index.json');
    if (!indexPayload || !Array.isArray(indexPayload.files)) {
      if (indexPayload) console.debug('logger: index file found but missing .files array', indexPayload);
      return null;
    }
    const files = indexPayload.files
      .map(x => (typeof x === 'string' ? x.trim() : ''))
      .filter(Boolean);
    console.debug('logger: index file found with files', { 
      count: files.length, 
      type: files[0]?.startsWith('http') ? 'absolute-urls' : 'relative-paths',
      files: files.slice(0, 3) 
    });
    return files.length > 0 ? files : null;
  }

  async function probeSequentialLogFiles() {
    console.debug('logger: probing for sequential log files');
    const discovered = [];

    const base = await fetchJsonIfPresent('smmoscaler-logs.json');
    if (base) {
      console.debug('logger: found smmoscaler-logs.json');
      discovered.push({ path: 'smmoscaler-logs.json', payload: base });
    }

    const templates = [
      i => `smmoscaler-logs.part${i}.json`,
      i => `smmoscaler-logs-part${i}.json`,
      i => `smmoscaler-logs-${i}.json`,
      i => `smmoscaler-logs.${i}.json`,
    ];

    for (const buildName of templates) {
      const firstName = buildName(1);
      const firstPayload = await fetchJsonIfPresent(firstName);
      if (!firstPayload) continue;

      discovered.push({ path: firstName, payload: firstPayload });
      for (let i = 2; i <= 500; i++) {
        const name = buildName(i);
        const payload = await fetchJsonIfPresent(name);
        if (!payload) break;
        discovered.push({ path: name, payload });
      }
    }

    // Deduplicate by file path in case multiple patterns resolve the same files.
    const seenPaths = new Set();
    const unique = [];
    for (const item of discovered) {
      if (seenPaths.has(item.path)) continue;
      seenPaths.add(item.path);
      unique.push(item);
    }

    console.debug('logger: probe complete', { filesFound: unique.map(u => u.path) });
    return unique;
  }

  // Auto-load smmoscaler-logs.json if it exists
  async function autoLoadLogs() {
    try {
      console.debug('logger: autoLoadLogs starting', { 
        location: typeof window !== 'undefined' ? window.location.href : 'unknown',
        existingLogs: (global.SMMO_ITEM_LOGS || []).length 
      });
      
      const existing = (global.SMMO_LOGS && typeof global.SMMO_LOGS.get === 'function') 
        ? global.SMMO_LOGS.get() 
        : (global.SMMO_ITEM_LOGS || []);

      const indexedFiles = await getSplitFileListFromIndex();
      const sources = [];

      if (indexedFiles) {
        console.debug('logger: using indexed files from smmoscaler-logs.index.json');
        for (const filePath of indexedFiles) {
          const payload = await fetchJsonIfPresent(filePath);
          if (payload) sources.push({ path: filePath, payload });
          else console.warn('logger: listed log file missing/unreadable', filePath);
        }
      } else {
        console.debug('logger: no index file found, probing for log files');
        const discovered = await probeSequentialLogFiles();
        sources.push(...discovered);
      }

      if (sources.length === 0) {
        console.debug('logger: no log files discovered, skipping auto-load');
        return;
      }

      let merged = existing.slice();
      let imported = 0;
      for (const source of sources) {
        const parsed = unwrapArrayPayload(source.payload);
        if (!parsed) {
          console.warn('logger: invalid log source format, skipping', source.path);
          continue;
        }
        const result = mergeLogEntries(merged, parsed);
        merged = result.merged;
        imported += result.imported;
      }

      if (global.SMMO_LOGS && typeof global.SMMO_LOGS.set === 'function') {
        global.SMMO_LOGS.set(merged);
      } else {
        global.SMMO_ITEM_LOGS = merged;
        console.debug('logger: set SMMO_ITEM_LOGS', { count: merged.length });
      }
      
      // Calculate and store the maximum item ID for resume logging
      const maxId = getLatestLoggedItemId(merged);
      global.LATEST_LOG_ITEM_ID = maxId;
      
      console.debug('logger: auto-loaded', {
        imported,
        total: merged.length,
        existing: existing.length,
        filesLoaded: sources.length,
        latestItemId: maxId,
        validIdCount: merged.length,
      });
      
      // Update status if available
      const status = qs('loggerStatus');
      if (status) {
        status.textContent = `Auto-loaded ${imported} items from ${sources.length} log file(s). Latest ID: ${maxId}`;
      }
    } catch (e) {
      console.error('logger: auto-load failed', e);
      console.debug('logger: SMMO_ITEM_LOGS state', {
        isArray: Array.isArray(global.SMMO_ITEM_LOGS),
        count: (global.SMMO_ITEM_LOGS || []).length,
        firstId: (global.SMMO_ITEM_LOGS?.[0]?.id),
      });
      // Don't show error in status for auto-load failures, as the file may simply not exist
    }
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const startBtn = qs('loggerStartButton');
    const exportBtn = qs('loggerExportButton');
    const apiInput = qs('loggerApiKeyInput');
    const status = qs('loggerStatus');

    // Auto-load smmoscaler-logs.json if it exists
    await autoLoadLogs();

    let running = false;
    let abortController = null;
    let importedIdsForUpdate = loadImportedIds();

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

    startBtn.addEventListener('click', async (ev) => {
      ev.preventDefault();
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
      const logs = global.SMMO_ITEM_LOGS || [];
      const existing = new Set(logs.map(l => String(l.id)));

      // Determine latest known item ID from both cached value and current logs.
      const latestLoggedId = Math.max(global.LATEST_LOG_ITEM_ID || 0, getLatestLoggedItemId(logs));
      global.LATEST_LOG_ITEM_ID = latestLoggedId;

      // Build candidate ID list
      let ids = [];
      if (Array.isArray(config.ITEM_IDS) && config.ITEM_IDS.length > 0) {
        const configuredIds = config.ITEM_IDS
          .map(id => toPositiveInt(id))
          .filter(id => id > 0);

        ids = configuredIds.filter(id => id > latestLoggedId);

        // If configured IDs are exhausted, continue probing from latest+1.
        if (ids.length === 0) {
          const maxConfiguredId = configuredIds.length > 0 ? Math.max(...configuredIds) : 0;
          if (latestLoggedId >= maxConfiguredId) {
            const startId = latestLoggedId + 1;
            for (let i = startId; i <= 999000; i++) ids.push(i);
          }
        }
      }
      else {
        // Start from latest logged ID + 1 to resume logging
        const startId = latestLoggedId > 0 ? latestLoggedId + 1 : 1;
        for (let i = startId; i <= 999000; i++) ids.push(i);
      }

      // Filter to unlogged IDs
      const pending = ids.filter(id => !existing.has(String(id)));
      if (pending.length === 0) { status.textContent = 'No unlogged item IDs found.'; return; }
      
      const resumeFrom = latestLoggedId;
      const statusMsg = resumeFrom > 0 ? ` (resuming from ID ${resumeFrom})` : '';
      
      console.debug('logger: starting session', {
        latestLoggedId: resumeFrom,
        totalLogsLoaded: logs.length,
        candidateIds: ids.length,
        unloggedIds: pending.length,
        firstPending: pending[0],
        lastPending: pending[pending.length - 1],
      });

      running = true;
      abortController = new AbortController();
      startBtn.textContent = 'Stop logging';
      status.textContent = `Starting logging — ${pending.length} items available${statusMsg}.`;

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
          // Update max logged ID for resume capability
          const numId = parseInt(idStr) || 0;
          if (numId > (global.LATEST_LOG_ITEM_ID || 0)) {
            global.LATEST_LOG_ITEM_ID = numId;
          }
          added++;
          status.textContent = `Added ${added} items — last ${idStr} (auth: ${attemptResult.used || 'unknown'})`;
        } else {
          // If the only failure was a 404 Not Found, treat it as "nonexistent" and
          // record it so we don't keep retrying the same ID.  This satisfies the
          // requirement of skipping missing items without spamming the console or
          // aborting the whole run.
          const msg = attemptResult.error && attemptResult.error.message ? attemptResult.error.message : String(attemptResult.error);
          if (msg.includes('HTTP 404')) {
            // push an entry with no item (could also mark with special flag) so that
            // the ID counts as existing and won't be requested again.
            const entry = { id: id, fetchedAt: new Date().toISOString(), item: null };
            if (global.SMMO_LOGS && typeof global.SMMO_LOGS.push === 'function') {
              global.SMMO_LOGS.push(entry);
            } else {
              logs.push(entry);
              global.SMMO_ITEM_LOGS = logs;
            }
            // Update max logged ID for resume capability even for 404s
            const numId = parseInt(idStr) || 0;
            if (numId > (global.LATEST_LOG_ITEM_ID || 0)) {
              global.LATEST_LOG_ITEM_ID = numId;
            }
            status.textContent = `Item ${idStr} not found – skipping`;
          } else {
            console.warn('Fetch failed for', idStr, attemptResult.error);
            status.textContent = `Fetch error for ${idStr}: ${msg}`;
          }
        }

        try { await sleep(2000); } catch (e) { /* ignore */ }
      }

      running = false;
      abortController = null;
      startBtn.textContent = 'Start logging';
      status.textContent = `Logging completed — added ${added} items.`;
    });

    exportBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
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
      importBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        importInput.click();
      });
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

            let parsed = parseJsonFlexible(text);
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
            const importedIdsThisRun = new Set();
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
              importedIdsThisRun.add(String(id));
              imported++;
            }

            if (global.SMMO_LOGS && typeof global.SMMO_LOGS.set === 'function') {
              global.SMMO_LOGS.set(merged);
            } else {
              global.SMMO_ITEM_LOGS = merged;
            }
            global.LATEST_LOG_ITEM_ID = getLatestLoggedItemId(merged);
            importedIdsForUpdate = importedIdsThisRun;
            saveImportedIds(importedIdsForUpdate);
            console.debug('logger: import merged', { imported, total: merged.length, existing: existing.length, parsed: parsed.length });
            status.textContent = `Imported ${imported} items (existing ${existing.length}, parsed ${parsed.length}). Latest ID: ${global.LATEST_LOG_ITEM_ID}`;
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

    // Update database functionality
    const updateDbStartBtn = qs('updateDbStartButton');
    const updateDbStartIdInput = qs('updateDbStartIdInput');
    const updateDbStatus = qs('updateDbStatus');
    const updateImportedStartBtn = qs('updateImportedStartButton');
    const updateImportedUploadBtn = qs('updateImportedUploadButton');
    const updateImportedUploadInput = qs('updateImportedUploadInput');
    const updateImportedStatus = qs('updateImportedStatus');

    let updateDbRunning = false;
    let updateDbAbortController = null;
    let updateImportedRunning = false;
    let updateImportedAbortController = null;

    window.addEventListener('beforeunload', (ev) => {
      if (!running && !updateDbRunning && !updateImportedRunning) return;
      ev.preventDefault();
      ev.returnValue = '';
    });

    updateDbStartBtn.addEventListener('click', async (ev) => {
      ev.preventDefault();
      if (updateDbRunning) {
        // Stop requested
        updateDbRunning = false;
        if (updateDbAbortController) updateDbAbortController.abort();
        updateDbStartBtn.textContent = 'Update database';
        updateDbStatus.textContent = 'Stopping…';
        return;
      }

      const apiKey = (apiInput && apiInput.value || '').trim();
      if (!apiKey) { updateDbStatus.textContent = 'Provide a public API key to start updating database.'; return; }

      const startId = parseInt(updateDbStartIdInput.value, 10);
      if (!Number.isInteger(startId) || startId < 1) { updateDbStatus.textContent = 'Please enter a valid start item ID (>= 1).'; return; }

      const config = global.SMMO_SCALER_CONFIG || {};
      const base = (config.API_BASE_URL || 'https://api.simple-mmo.com/v1').replace(/\/$/, '');
      const endpointTemplate = (config.ITEM_BY_ID_ENDPOINT || '/item/info/{id}');
      const method = (config.ITEM_BY_ID_METHOD || 'POST').toUpperCase();
      const apiKeyMode = (config.API_KEY_MODE || 'header');
      const apiKeyHeader = config.API_KEY_HEADER_NAME || 'api_key';

      updateDbRunning = true;
      updateDbAbortController = new AbortController();
      updateDbStartBtn.textContent = 'Stop updating';
      updateDbStatus.textContent = `Starting database update from ID ${startId}…`;

      let updated = 0;
      let skipped = 0;
      let errors = 0;

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

      // Build candidate ID list
      let ids = [];
      if (Array.isArray(config.ITEM_IDS) && config.ITEM_IDS.length > 0) ids = config.ITEM_IDS.slice();
      else {
        for (let i = startId; i <= 999000; i++) ids.push(i);
      }

      // Filter to IDs starting from startId
      const pending = ids.filter(id => id >= startId);
      if (pending.length === 0) { updateDbStatus.textContent = 'No item IDs found from the start ID.'; return; }

      for (const id of pending) {
        if (!updateDbRunning) break;

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

        const options = { method, headers, signal: updateDbAbortController.signal };
        if (method === 'POST' && !endpointTemplate.includes('{id}')) {
          options.headers['Content-Type'] = 'application/json';
          options.body = JSON.stringify({ id });
        }

        updateDbStatus.textContent = `Fetching ${idStr}…`;
        const ctx = { apiKeyMode, apiKeyHeader, apiKey, config, method };
        const attemptResult = await attemptFetchWithFallback(url, options, ctx);
        if (attemptResult.ok) {
          const entry = { id: id, fetchedAt: new Date().toISOString(), item: attemptResult.data };
          
          // Replace existing entry with same ID or add new
          const logs = global.SMMO_ITEM_LOGS || [];
          const existingIndex = logs.findIndex(e => String(e.id) === String(id));
          if (existingIndex !== -1) {
            logs[existingIndex] = entry;
            updated++;
          } else {
            logs.push(entry);
            updated++;
          }
          
          if (global.SMMO_LOGS && typeof global.SMMO_LOGS.set === 'function') {
            global.SMMO_LOGS.set(logs);
          } else {
            global.SMMO_ITEM_LOGS = logs;
          }
          
          updateDbStatus.textContent = `Updated ${updated} items — last ${idStr} (auth: ${attemptResult.used || 'unknown'})`;
        } else {
          // If the only failure was a 404 Not Found, treat it as "nonexistent" and
          // record it so we don't keep retrying the same ID.  This satisfies the
          // requirement of skipping missing items without spamming the console or
          // aborting the whole run.
          const msg = attemptResult.error && attemptResult.error.message ? attemptResult.error.message : String(attemptResult.error);
          if (msg.includes('HTTP 404')) {
            // push an entry with no item (could also mark with special flag) so that
            // the ID counts as existing and won't be requested again.
            const entry = { id: id, fetchedAt: new Date().toISOString(), item: null };
            const logs = global.SMMO_ITEM_LOGS || [];
            const existingIndex = logs.findIndex(e => String(e.id) === String(id));
            if (existingIndex !== -1) {
              logs[existingIndex] = entry;
              skipped++;
            } else {
              logs.push(entry);
              skipped++;
            }
            
            if (global.SMMO_LOGS && typeof global.SMMO_LOGS.set === 'function') {
              global.SMMO_LOGS.set(logs);
            } else {
              global.SMMO_ITEM_LOGS = logs;
            }
            
            updateDbStatus.textContent = `Item ${idStr} not found – skipping`;
          } else {
            console.warn('Fetch failed for', idStr, attemptResult.error);
            updateDbStatus.textContent = `Fetch error for ${idStr}: ${msg}`;
            errors++;
          }
        }

        try { await sleep(2000); } catch (e) { /* ignore */ }
      }

      updateDbRunning = false;
      updateDbAbortController = null;
      updateDbStartBtn.textContent = 'Update database';
      updateDbStatus.textContent = `Database update completed — updated ${updated}, skipped ${skipped}, errors ${errors}.`;
    });

    if (updateImportedStartBtn && updateImportedStatus) {
      updateImportedStartBtn.addEventListener('click', async (ev) => {
        ev.preventDefault();
        if (updateImportedRunning) {
          updateImportedRunning = false;
          if (updateImportedAbortController) updateImportedAbortController.abort();
          updateImportedStartBtn.textContent = 'Update imported IDs';
          updateImportedStatus.textContent = 'Stopping…';
          return;
        }

        const apiKey = (apiInput && apiInput.value || '').trim();
        if (!apiKey) {
          updateImportedStatus.textContent = 'Provide a public API key to start updating imported IDs.';
          return;
        }

        const idsToUpdate = Array.from(importedIdsForUpdate)
          .map(id => toPositiveInt(id))
          .filter(id => id > 0)
          .sort((a, b) => a - b);

        if (idsToUpdate.length === 0) {
          updateImportedStatus.textContent = 'No imported IDs tracked yet. Import a JSON file first.';
          return;
        }

        const config = global.SMMO_SCALER_CONFIG || {};
        const base = (config.API_BASE_URL || 'https://api.simple-mmo.com/v1').replace(/\/$/, '');
        const endpointTemplate = (config.ITEM_BY_ID_ENDPOINT || '/item/info/{id}');
        const method = (config.ITEM_BY_ID_METHOD || 'POST').toUpperCase();
        const apiKeyMode = (config.API_KEY_MODE || 'header');
        const apiKeyHeader = config.API_KEY_HEADER_NAME || 'api_key';

        updateImportedRunning = true;
        updateImportedAbortController = new AbortController();
        updateImportedStartBtn.textContent = 'Stop imported update';
        updateImportedStatus.textContent = `Starting imported ID update (${idsToUpdate.length} IDs)…`;

        let updated = 0;
        let skipped = 0;
        let errors = 0;

        async function attemptFetchWithFallback(initialUrl, initialOptions, ctx) {
          const attempts = [];
          attempts.push({ url: initialUrl, options: initialOptions, label: 'initial' });

          if (ctx.apiKeyMode === 'header' && String(ctx.apiKeyHeader).toLowerCase() !== 'authorization') {
            const h = Object.assign({}, initialOptions.headers || {});
            h['Authorization'] = ctx.apiKey.startsWith('Bearer ') ? ctx.apiKey : `Bearer ${ctx.apiKey}`;
            attempts.push({ url: initialUrl, options: Object.assign({}, initialOptions, { headers: h }), label: 'bearer' });
          }

          const paramName = (ctx.config && ctx.config.API_KEY_QUERY_PARAM) || 'apiKey';
          const sep = initialUrl.includes('?') ? '&' : '?';
          const urlWithQuery = `${initialUrl}${sep}${encodeURIComponent(paramName)}=${encodeURIComponent(ctx.apiKey)}`;
          attempts.push({ url: urlWithQuery, options: initialOptions, label: 'query' });

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
            const res = await fetchItem(a.url, a.options);
            if (res.ok) return { ok: true, data: res.data, used: a.label };
            if (res.error && res.error.message && res.error.message.includes('HTTP 401')) {
              await sleep(300);
              continue;
            }
            return { ok: false, error: res.error };
          }

          return { ok: false, error: new Error('All auth attempts failed (401)') };
        }

        for (const id of idsToUpdate) {
          if (!updateImportedRunning) break;

          const idStr = String(id);
          const urlPath = endpointTemplate.includes('{id}')
            ? endpointTemplate.replace('{id}', encodeURIComponent(idStr))
            : `${endpointTemplate}/${encodeURIComponent(idStr)}`;
          const url = `${base}${urlPath.startsWith('/') ? '' : '/'}${urlPath}`;

          const headers = { 'Accept': 'application/json' };
          let requestUrl = url;
          if (apiKeyMode === 'header') {
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

          const options = { method, headers, signal: updateImportedAbortController.signal };
          if (method === 'POST' && !endpointTemplate.includes('{id}')) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify({ id });
          }

          updateImportedStatus.textContent = `Refreshing imported ID ${idStr}…`;
          const ctx = { apiKeyMode, apiKeyHeader, apiKey, config, method };
          const attemptResult = await attemptFetchWithFallback(requestUrl, options, ctx);
          if (attemptResult.ok) {
            const entry = { id: id, fetchedAt: new Date().toISOString(), item: attemptResult.data };
            const logs = (global.SMMO_LOGS && typeof global.SMMO_LOGS.get === 'function')
              ? global.SMMO_LOGS.get()
              : (global.SMMO_ITEM_LOGS || []);

            const existingIndex = logs.findIndex(e => String(e.id) === String(id));
            if (existingIndex !== -1) {
              logs[existingIndex] = entry;
              updated++;
            } else {
              skipped++;
            }

            if (global.SMMO_LOGS && typeof global.SMMO_LOGS.set === 'function') {
              global.SMMO_LOGS.set(logs);
            } else {
              global.SMMO_ITEM_LOGS = logs;
            }

            updateImportedStatus.textContent = `Updated ${updated}/${idsToUpdate.length} imported IDs — last ${idStr} (auth: ${attemptResult.used || 'unknown'})`;
          } else {
            const msg = attemptResult.error && attemptResult.error.message ? attemptResult.error.message : String(attemptResult.error);
            if (msg.includes('HTTP 404')) {
              skipped++;
              updateImportedStatus.textContent = `Imported ID ${idStr} not found - skipping`;
            } else {
              errors++;
              updateImportedStatus.textContent = `Fetch error for imported ID ${idStr}: ${msg}`;
            }
          }

          try { await sleep(2000); } catch (e) { /* ignore */ }
        }

        updateImportedRunning = false;
        updateImportedAbortController = null;
        updateImportedStartBtn.textContent = 'Update imported IDs';
        updateImportedStatus.textContent = `Imported ID update completed — updated ${updated}, skipped ${skipped}, errors ${errors}.`;
      });
    }

    if (updateImportedUploadBtn && updateImportedUploadInput && updateImportedStatus) {
      updateImportedUploadBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        updateImportedUploadInput.click();
      });

      updateImportedUploadInput.addEventListener('change', (ev) => {
        const f = ev.target.files && ev.target.files[0];
        if (!f) return;

        const reader = new FileReader();
        reader.onload = () => {
          try {
            let text = reader.result;
            if (typeof text !== 'string') text = String(text || '');
            if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

            const parsed = parseJsonFlexible(text);
            const foundIds = new Set();

            function pushIdFrom(value) {
              const n = toPositiveInt(value);
              if (n > 0) foundIds.add(String(n));
            }

            function walk(node) {
              if (node == null) return;

              if (Array.isArray(node)) {
                for (const item of node) walk(item);
                return;
              }

              if (typeof node === 'object') {
                const id = extractId(node);
                if (id) pushIdFrom(id);

                if (Array.isArray(node.ids)) {
                  for (const idValue of node.ids) pushIdFrom(idValue);
                }
                if (Array.isArray(node.item_ids)) {
                  for (const idValue of node.item_ids) pushIdFrom(idValue);
                }

                if (node.logs) walk(node.logs);
                if (node.items) walk(node.items);
                if (node.data) walk(node.data);
                return;
              }

              pushIdFrom(node);
            }

            walk(parsed);

            if (foundIds.size === 0) {
              updateImportedStatus.textContent = 'Upload failed: no valid item IDs found in JSON.';
              return;
            }

            importedIdsForUpdate = foundIds;
            saveImportedIds(importedIdsForUpdate);
            updateImportedStatus.textContent = `Loaded ${foundIds.size} custom IDs for imported-ID updates.`;
          } catch (e) {
            updateImportedStatus.textContent = `Upload failed: ${e && e.message ? e.message : e}`;
          }
        };

        reader.onerror = () => {
          updateImportedStatus.textContent = 'Upload failed: file read error.';
        };

        reader.readAsText(f);
        updateImportedUploadInput.value = '';
      });
    }
  });
})(window);
