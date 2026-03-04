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
    const sortButton = qs('sortButton');
    const levelInput = qs('levelInput');
    const goldInput = qs('goldInput');
    const statusEl = qs('status');
    const resultsList = qs('resultsList');
    const summary = qs('summary');
    const totalCost = qs('totalCost');
    const totalPower = qs('totalPower');
    const bestValue = qs('bestValue');
    const slotsFilled = qs('slotsFilled');

    let sortBy = 'power'; // 'power' or 'value'

    if (CONFIG) configStatus.textContent = 'Config loaded';
    else configStatus.textContent = 'Config missing — using demo data';

    function normalizeItem(raw) {
      if (!raw) return null;
      const id = raw.id || raw.item_id || raw.itemId || raw._id || String(raw.id || raw.item_id || raw.itemId || '');
      const name = raw.name || raw.item_name || raw.title || `Item ${id}`;
      const minLevel = raw.minLevel || raw.min_level || raw.level || raw.required_level || 1;
      const price = raw.price || raw.cost || raw.gold || 0;
      const slot = raw.slot || raw.type || raw.category || 'unknown';
      
      // market-low can be named with hyphen or underscore in logs, or nested under market.low
      const marketLow = raw['market-low'] || raw.market_low || raw.marketLow || (raw.market && raw.market.low) || null;
      
      // Calculate power based on stats: str = 1 point, def = 0.3 points
      let power = 0;
      const statPairs = [
        { statName: raw.stat1, statValue: raw.stat1modifier },
        { statName: raw.stat2, statValue: raw.stat2modifier },
        { statName: raw.stat3, statValue: raw.stat3modifier }
      ];
      for (const { statName, statValue } of statPairs) {
        if (!statName || statValue == null) continue;
        const modifier = Number(statValue) || 0;
        if (statName === 'str') power += modifier * 1;
        else if (statName === 'def') power += modifier * 0.3;
      }
      
      return {
        id,
        name,
        minLevel: Number(minLevel),
        price: Number(price),
        slot,
        power: power,
        marketLow: marketLow == null ? null : Number(marketLow),
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
        // Normalize items from logs, filtering out nulls (which are 404 entries)
        items = rawLogs
          .map(l => l.item ? normalizeItem(l.item) : null)
          .filter(it => it !== null);
        configStatus.textContent = `Using ${items.length} items from logs (${rawLogs.length} total entries)`;
      } else {
        items = (CONFIG && CONFIG.DEMO_ITEMS) ? CONFIG.DEMO_ITEMS : [];
      }

      // Filter items: must have level requirement met AND must have a cost
      // (marketLow preferred, falls back to price). Blank/404 items are skipped.
      const usable = items.filter(it => {
        if (!it || !it.id) return false;
        // Use marketLow if available, fallback to price
        const cost = it.marketLow != null ? it.marketLow : (it.price != null ? it.price : null);
        if (cost == null) return false;
        return (it.minLevel || 0) <= level && cost <= gold;
      });

      // Calculate cost and bestValue for each usable item
      usable.forEach(it => {
        const cost = it.marketLow != null ? it.marketLow : it.price;
        it.cost = cost;
        it.bestValue = cost > 0 ? it.power / cost : 0;
      });

      // For the new behaviour we simply list every usable item instead of
      // picking the single best per slot.  The summary is simplified to show
      // the count and a couple of aggregate values.
      const totalItems = usable.length;
      const estimatedCost = usable.reduce((s, i) => s + (i.cost || 0), 0);
      const maxPower = usable.reduce((m, i) => Math.max(m, i.power || 0), 0);
      const maxValue = usable.reduce((m, i) => Math.max(m, i.bestValue || 0), 0);

      totalCost.textContent = estimatedCost;
      totalPower.textContent = maxPower.toFixed(1);
      bestValue.textContent = maxValue.toFixed(4);
      slotsFilled.textContent = totalItems;

      sortButton.disabled = false;
      renderResults(usable);
    });

    function renderResults(usable) {
      resultsList.innerHTML = '';
      if (usable.length === 0) {
        resultsList.hidden = true;
        summary.hidden = true;
        statusEl.textContent = 'No items match the criteria.';
      } else {
        summary.hidden = false;
        resultsList.hidden = false;
        // Sort by current sortBy mode
        if (sortBy === 'power') {
          usable.sort((a, b) => b.power - a.power);
        } else {
          // Sort by bestValue descending
          usable.sort((a, b) => b.bestValue - a.bestValue);
        }
        for (const it of usable) {
          const div = document.createElement('div');
          div.className = 'resultItem';
          const valueDisplay = (it.bestValue != null) ? it.bestValue.toFixed(4) : '—';
          div.textContent = `${it.slot}: ${it.name} (Power ${it.power.toFixed(1)}, Estimated cost ${it.cost}, Value ${valueDisplay})`;
          resultsList.appendChild(div);
        }
        statusEl.textContent = 'Ready.';
      }
    }

    sortButton.addEventListener('click', () => {
      // Toggle between power and value sort
      sortBy = sortBy === 'power' ? 'value' : 'power';
      const label = sortBy === 'power' ? 'Sort by: Power' : 'Sort by: Value';
      sortButton.textContent = label;
      // Re-render with new sort
      const level = Number(levelInput.value) || 1;
      const gold = Number(goldInput.value) || 0;
      const rawLogs = (window.SMMO_ITEM_LOGS && Array.isArray(window.SMMO_ITEM_LOGS)) ? window.SMMO_ITEM_LOGS : [];
      let items = [];
      if (rawLogs.length > 0) {
        items = rawLogs
          .map(l => l.item ? normalizeItem(l.item) : null)
          .filter(it => it !== null);
      } else {
        items = (CONFIG && CONFIG.DEMO_ITEMS) ? CONFIG.DEMO_ITEMS : [];
      }
      const usable = items.filter(it => {
        if (!it || !it.id) return false;
        const cost = it.marketLow != null ? it.marketLow : (it.price != null ? it.price : null);
        if (cost == null) return false;
        return (it.minLevel || 0) <= level && cost <= gold;
      });
      usable.forEach(it => {
        const cost = it.marketLow != null ? it.marketLow : it.price;
        it.cost = cost;
        it.bestValue = cost > 0 ? it.power / cost : 0;
      });
      renderResults(usable);
    });
  });

  global.SMMO_APP = { CONFIG };
})(window);

