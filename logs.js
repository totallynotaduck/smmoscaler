/* Minimal logs file for SMMO Scaler
 * This file is safe to publish: it only defines a client-side log array.
 */
(function attachLogs(global) {
  const STORAGE_KEY = 'smmoscaler_logs_v1';

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function save(logs) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(logs));
    } catch (e) {
      // ignore
    }
  }

  let logs = load();
  global.SMMO_ITEM_LOGS = logs;

  global.SMMO_LOGS = {
    get: () => (global.SMMO_ITEM_LOGS || []).slice(),
    set: (arr) => { global.SMMO_ITEM_LOGS = Array.isArray(arr) ? arr.slice() : []; save(global.SMMO_ITEM_LOGS); },
    push: (entry) => { const l = global.SMMO_ITEM_LOGS || []; l.push(entry); global.SMMO_ITEM_LOGS = l; save(l); },
    save,
    load,
    clear: () => { global.SMMO_ITEM_LOGS = []; save([]); }
  };

  // Import logs functionality
  function importLogs(file) {
    return new Promise((resolve, reject) => {
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
          resolve({ imported, total: merged.length, existing: existing.length, parsed: parsed.length });
        } catch (e) {
          console.error('logger: import error', e);
          reject(e);
        }
      };
      reader.onerror = (err) => {
        console.error('logger: file read error', err);
        reject(err);
      };
      reader.readAsText(file);
    });
  }

  // Expose import function globally
  global.importLogs = importLogs;
})(window);
