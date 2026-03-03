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
})(window);
