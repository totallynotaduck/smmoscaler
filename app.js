/* Minimal SMMO Scaler app logic
 * This file replaces the broken config-like contents previously present.
 * It provides a small optimizer UI and exposes a `SMMO_APP` object.
 */

(function main(global) {
  const CONFIG = global.SMMO_SCALER_CONFIG || null;

  function qs(id) { return document.getElementById(id); }

  document.addEventListener('DOMContentLoaded', () => {
    const configStatus = qs('configStatus');
    const runButton = qs('runButton');
    const levelInput = qs('levelInput');
    const goldInput = qs('goldInput');
    const statusEl = qs('status');
    const resultsList = qs('resultsList');
    const summary = qs('summary');
    const totalCost = qs('totalCost');
    const totalPower = qs('totalPower');
    const slotsFilled = qs('slotsFilled');

    if (CONFIG) configStatus.textContent = 'Config loaded';
    else configStatus.textContent = 'Config missing — using demo data';

    function normalizeItem(raw) {
      if (!raw) return null;
      const id = raw.id || raw.item_id || raw.itemId || raw._id || String(raw.id || raw.item_id || raw.itemId || '');
      const name = raw.name || raw.item_name || raw.title || `Item ${id}`;
      const minLevel = raw.minLevel || raw.min_level || raw.level || raw.required_level || 1;
      const price = raw.price || raw.cost || raw.gold || 0;
      const slot = raw.slot || raw.type || raw.category || 'unknown';
      const power = raw.power || raw.attack || raw.value || 0;
      // market-low can be named with hyphen or underscore in logs
      const marketLow = raw['market-low'] || raw.market_low || raw.marketLow || raw.market || null;
      // strength stat
      const str = raw.str || (raw.stats && raw.stats.str) || (raw.attributes && raw.attributes.str) || null;
      return {
        id,
        name,
        minLevel: Number(minLevel),
        price: Number(price),
        slot,
        power: Number(power),
        marketLow: marketLow == null ? null : Number(marketLow),
        str: str == null ? null : Number(str),
      };
    }

    runButton.addEventListener('click', (ev) => {
      ev.preventDefault();
      statusEl.textContent = 'Computing…';
      const level = Number(levelInput.value) || 1;
      const gold = Number(goldInput.value) || 0;
      // Prefer logs if present (populated by logger.js). Logged entries may
      // include an `item` object from the API; normalize if so.
      const rawLogs = (window.SMMO_ITEM_LOGS && Array.isArray(window.SMMO_ITEM_LOGS)) ? window.SMMO_ITEM_LOGS : [];
      let items = [];
      if (rawLogs.length > 0) {
        items = rawLogs.map(l => normalizeItem(l.item) || normalizeItem({ id: l.id }));
        configStatus.textContent = `Using ${items.length} items from logs`;
      } else {
        items = (CONFIG && CONFIG.DEMO_ITEMS) ? CONFIG.DEMO_ITEMS : [];
      }

      const usable = items.filter(it => {
        const cost = (it && it.marketLow != null) ? it.marketLow : (it && it.price) ? it.price : 0;
        return (it.minLevel || 0) <= level && cost <= gold;
      });

      const bySlot = {};
      for (const it of usable) {
        const cur = bySlot[it.slot];
        if (!cur || it.power > cur.power || (it.power === cur.power && it.price < cur.price)) {
          bySlot[it.slot] = it;
        }
      }

      const chosen = Object.values(bySlot);
      // Estimated Cost: use marketLow from logs when available, fall back to price
      const estimatedCost = chosen.reduce((s, i) => s + ((i && i.marketLow != null) ? i.marketLow : (i && i.price) ? i.price : 0), 0);

      // Equipment Strength: highest `str` among chosen items
      const chosenStrs = chosen.map(it => (it && it.str) ? it.str : 0);
      const equipmentStrength = chosenStrs.length > 0 ? Math.max(...chosenStrs) : 0;

      totalCost.textContent = estimatedCost;
      totalPower.textContent = equipmentStrength;
      slotsFilled.textContent = chosen.length;

      resultsList.innerHTML = '';
      if (chosen.length === 0) {
        resultsList.hidden = true;
        summary.hidden = true;
        statusEl.textContent = 'No items match the criteria.';
      } else {
        summary.hidden = false;
        resultsList.hidden = false;
        for (const it of chosen) {
          const div = document.createElement('div');
          div.className = 'resultItem';
          const costDisplay = (it && it.marketLow != null) ? it.marketLow : (it && it.price) ? it.price : '—';
          const strDisplay = (it && it.str != null) ? `, Str ${it.str}` : '';
          div.textContent = `${it.slot}: ${it.name} (Power ${it.power}, Market-low ${costDisplay}${strDisplay})`;
          resultsList.appendChild(div);
        }
        statusEl.textContent = 'Ready.';
      }
    });
  });

  global.SMMO_APP = { CONFIG };
})(window);

