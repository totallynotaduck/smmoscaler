/* Minimal SMMO Scaler app logic
 * This file replaces the broken config-like contents previously present.
 * It provides a small optimizer UI and exposes a `SMMO_APP` object.
 */

(function main(global) {
  const CONFIG = global.SMMO_SCALER_CONFIG || null;

  function qs(id) { return document.getElementById(id); }

  document.addEventListener('DOMContentLoaded', () => {
    const configStatus = qs('configStatus');
    const optimizerForm = qs('optimizerForm');
    const runButton = qs('runButton');
    const resetButton = qs('resetButton');
    const sortButton = qs('sortButton');
    const levelInput = qs('levelInput');
    const goldInput = qs('goldInput');
    const minPowerInput = qs('minPowerInput');
    const specialAttacksCheckbox = qs('specialAttacksCheckbox');
    const statusEl = qs('status');
    const errorEl = qs('error');
    const resultsList = qs('resultsList');
    const interestingItemsList = qs('interestingItemsList');
    const summary = qs('summary');
    const totalCost = qs('totalCost');
    const totalPower = qs('totalPower');
    const bestValue = qs('bestValue');
    const slotsFilled = qs('slotsFilled');
    const INTERESTING_TYPES = ['Collectable', 'Tome', 'Avatar', 'Item Sprite', 'Grenade', 'Food'];

    let sortBy = 'power'; // 'power' or 'value'

    if (CONFIG) configStatus.textContent = 'Config loaded';
    else configStatus.textContent = 'Config missing — using demo data';

    // Debug: log config and initial state
    console.log('SMMO Scaler initialized', { 
      CONFIG: CONFIG ? 'loaded' : 'missing',
      logsAvailable: !!window.SMMO_ITEM_LOGS,
      logsCount: (window.SMMO_ITEM_LOGS || []).length
    });

    function parseNumber(value) {
      if (value == null || value === '') return null;
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      const cleaned = String(value).replace(/,/g, '').trim();
      if (!cleaned) return null;
      const parsed = Number(cleaned);
      return Number.isFinite(parsed) ? parsed : null;
    }

    function isMainOutputItem(item) {
      return !INTERESTING_TYPES.includes(item.slot) && !item.custom_item;
    }

    function pickBestItemsBySlot(items, sortMode) {
      const bestBySlot = new Map();
      for (const item of items) {
        const current = bestBySlot.get(item.slot);
        if (!current) {
          bestBySlot.set(item.slot, item);
          continue;
        }

        const currentMetric = sortMode === 'value' ? (current.bestValue || 0) : (current.power || 0);
        const nextMetric = sortMode === 'value' ? (item.bestValue || 0) : (item.power || 0);

        if (nextMetric > currentMetric) {
          bestBySlot.set(item.slot, item);
          continue;
        }

        if (nextMetric === currentMetric) {
          const currentCost = current.cost || 0;
          const nextCost = item.cost || 0;
          if (nextCost < currentCost) {
            bestBySlot.set(item.slot, item);
          }
        }
      }
      return Array.from(bestBySlot.values());
    }

    function updateSummary(availableItems) {
      const mainAvailableItems = availableItems.filter(isMainOutputItem);
      const bestPerSlot = pickBestItemsBySlot(mainAvailableItems, sortBy);

      const estimatedCost = bestPerSlot.reduce((sum, item) => sum + (item.cost || 0), 0);
      const totalEquipmentStrength = bestPerSlot.reduce((sum, item) => sum + (item.power || 0), 0);
      const maxValue = mainAvailableItems.reduce((m, i) => Math.max(m, i.bestValue || 0), 0);

      totalCost.textContent = Math.round(estimatedCost).toLocaleString();
      totalPower.textContent = totalEquipmentStrength.toFixed(1);
      bestValue.textContent = maxValue.toFixed(4);
      slotsFilled.textContent = mainAvailableItems.length;
    }

    function resetUiState() {
      sortBy = 'power';
      sortButton.textContent = 'Sort by: Power';
      sortButton.disabled = true;
      summary.hidden = true;
      resultsList.hidden = true;
      resultsList.innerHTML = '';
      if (interestingItemsList) {
        interestingItemsList.innerHTML = '';
      }
      if (errorEl) {
        errorEl.hidden = true;
        errorEl.textContent = '';
      }
      totalCost.textContent = '—';
      totalPower.textContent = '—';
      bestValue.textContent = '—';
      slotsFilled.textContent = '—';
      statusEl.textContent = 'Ready.';
    }

    function getStatDisplayName(statKey) {
      const labels = {
        str: 'Strength',
        def: 'Defence',
        crit: 'Crit',
        hp: 'HP'
      };
      return labels[statKey] || String(statKey || '').toUpperCase();
    }

    function formatStatValue(value) {
      if (!Number.isFinite(value)) return '0';
      return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
    }

    function formatItemStats(item) {
      if (!item || !Array.isArray(item.stats) || item.stats.length === 0) return 'Stats: —';
      const parts = item.stats.map(stat => `${getStatDisplayName(stat.key)} ${formatStatValue(stat.value)}`);
      return `Stats: ${parts.join(' • ')}`;
    }

    function normalizeCustomTag(value) {
      if (value == null) return '';
      return String(value).trim().toLowerCase();
    }

    function sortSlotItems(slotItems, slotName) {
      slotItems.sort((a, b) => {
        if (slotName === 'Avatar' || slotName === 'Item Sprite') {
          const loggedA = Number(a.loggedItemId ?? a.id ?? 0);
          const loggedB = Number(b.loggedItemId ?? b.id ?? 0);
          return loggedB - loggedA;
        }

        const primaryA = sortBy === 'power' ? (a.power || 0) : (a.bestValue || 0);
        const primaryB = sortBy === 'power' ? (b.power || 0) : (b.bestValue || 0);
        if (primaryB !== primaryA) return primaryB - primaryA;

        if (slotName === 'Collectable') {
          const tagA = normalizeCustomTag(a.customItemTag ?? a.custom_item);
          const tagB = normalizeCustomTag(b.customItemTag ?? b.custom_item);
          const tagCompare = tagA.localeCompare(tagB, undefined, { numeric: true, sensitivity: 'base' });
          if (tagCompare !== 0) return tagCompare;
        }

        return Number(a.id || 0) - Number(b.id || 0);
      });
    }

    function normalizeItem(raw, includeCritBonus = false, playerLevel = 1, loggedItemId = null) {
      if (!raw) return null;
      const id = raw.id || raw.item_id || raw.itemId || raw._id || String(raw.id || raw.item_id || raw.itemId || '');
      const name = raw.name || raw.item_name || raw.title || `Item ${id}`;
      const minLevel = raw.minLevel || raw.min_level || raw.level || raw.required_level || 1;
      const price = parseNumber(raw.price ?? raw.cost ?? raw.gold) ?? 0;
      const slot = raw.slot || raw.type || raw.category || 'unknown';
      const rarity = raw.rarity || raw.rarity_name || raw.rarityName || raw.item_rarity || raw.itemRarity || null;
      const custom_item = raw.custom_item || raw.customItem || raw.is_custom || raw.isCustom || null;
      const customItemTag = raw.custom_item_tag || raw.customItemTag || raw.item_tag || raw.itemTag || null;
      
      // market-low can be named with hyphen or underscore in logs, or nested under market.low
      const marketLowRaw = raw['market-low'] ?? raw.market_low ?? raw.marketLow ?? (raw.market && raw.market.low);
      const marketLow = parseNumber(marketLowRaw);
      
      // Calculate power based on stats: str = 1 point, def = 0.3 points
      let power = 0;
      const stats = [];
      const statPairs = [
        { statName: raw.stat1, statValue: raw.stat1modifier },
        { statName: raw.stat2, statValue: raw.stat2modifier },
        { statName: raw.stat3, statValue: raw.stat3modifier }
      ];
      for (const { statName, statValue } of statPairs) {
        if (!statName || statValue == null) continue;
        const statKey = String(statName).trim().toLowerCase();
        const modifier = Number(statValue);
        if (!Number.isFinite(modifier) || !statKey) continue;
        if (modifier !== 0) {
          stats.push({ key: statKey, value: modifier });
        }

        if (statKey === 'str') power += modifier * 1;
        else if (statKey === 'def') power += modifier * 0.3;
        else if (statKey === 'crit' && includeCritBonus) {
          // Formula: Player Level x 2 x Crit Value/1000
          power += playerLevel * 2 * (modifier / 1000);
        }
      }
      
      return {
        id,
        name,
        minLevel: Number(minLevel),
        price,
        slot,
        rarity,
        custom_item,
        customItemTag,
        loggedItemId: loggedItemId == null ? null : Number(loggedItemId),
        power: power,
        stats,
        marketLow,
        image_url: raw.image_url || raw.imageUrl || raw.icon || null,
      };
    }

    runButton.addEventListener('click', (ev) => {
      ev.preventDefault();
      try {
        statusEl.textContent = 'Computing…';
        const level = Number(levelInput.value) || 1;
        const gold = Number(goldInput.value) || 0;
        // Prefer logs if present (populated by logger.js). Logged entries may
        // include an `item` object from the API; normalize if so.
        const rawLogs = (window.SMMO_ITEM_LOGS && Array.isArray(window.SMMO_ITEM_LOGS)) ? window.SMMO_ITEM_LOGS : [];
        let items = [];
        const includeCritBonus = specialAttacksCheckbox.checked;
        if (rawLogs.length > 0) {
          // Normalize items from logs, filtering out nulls (which are 404 entries)
          items = rawLogs
            .map(l => l.item ? normalizeItem(l.item, includeCritBonus, level, l.id) : null)
            .filter(it => it !== null);
          configStatus.textContent = `Using ${items.length} items from logs (${rawLogs.length} total entries)`;
        } else {
          items = (CONFIG && CONFIG.DEMO_ITEMS) ? CONFIG.DEMO_ITEMS : [];
        }

        console.log('Loaded items for filtering', { rawLogsCount: rawLogs.length, normalizedCount: items.length, level, gold });

        // Filter items: must have level requirement met AND must have a cost
        // (marketLow preferred, falls back to price). Blank/404 items are skipped.
        // Exclude Food and Other item types from showing up in the UI output
        const minPower = Number(minPowerInput.value) || 0;
        const usable = items.filter(it => {
          if (!it || !it.id) return false;
          // Use marketLow if available, fallback to price
          const cost = it.marketLow != null ? it.marketLow : (it.price != null ? it.price : null);
          if (cost == null) return false;
          // Exclude Food and Other item types
          if (it.slot === 'Food' || it.slot === 'Other') return false;
          return (it.minLevel || 0) <= level && cost <= gold && it.power >= minPower;
        });

        console.log('Filtered to usable items', { usableCount: usable.length, level, gold });

        // Calculate cost and bestValue for each usable item
        usable.forEach(it => {
          const cost = it.marketLow != null ? it.marketLow : it.price;
          it.cost = cost;
          it.bestValue = cost > 0 ? it.power / cost : 0;
        });

        // Separate items with estimated cost of 0 (unavailable) from others
        const unavailableItems = usable.filter(it => (it.cost || 0) === 0);
        const availableItems = usable.filter(it => (it.cost || 0) > 0);

        // For the new behaviour we simply list every usable item instead of
        // picking the single best per slot.  The summary is simplified to show
        // the count and a couple of aggregate values.
        
        updateSummary(availableItems);

        sortButton.disabled = false;
        renderResults(availableItems, unavailableItems);
      } catch (e) {
        console.error('Error in calculator:', e);
        statusEl.textContent = `Error: ${e.message || e}`;
      }
    });

    function renderResults(availableItems, unavailableItems = []) {
      try {
        resultsList.innerHTML = '';
        if (availableItems.length === 0 && unavailableItems.length === 0) {
          resultsList.hidden = true;
          summary.hidden = true;
          statusEl.textContent = 'No items match the criteria.';
        } else {
          summary.hidden = false;
          resultsList.hidden = false;
          
          // Filter out interesting item types from main output
          const mainAvailableItems = availableItems.filter(isMainOutputItem);
          const mainUnavailableItems = unavailableItems.filter(isMainOutputItem);
          
          // Render available items (cost > 0) - excluding interesting types
          if (mainAvailableItems.length > 0) {
            // Group items by slot and get top 5 for each slot
            const slots = {};
            for (const it of mainAvailableItems) {
              if (!slots[it.slot]) slots[it.slot] = [];
              slots[it.slot].push(it);
            }
            
            // Sort each slot by current sortBy mode and take top 5
            let totalItems = 0;
            for (const slotName in slots) {
              const slotItems = slots[slotName];
              
              // Sort by current sortBy mode
              sortSlotItems(slotItems, slotName);

              totalItems += renderSlotGroup(resultsList, slotName, slotItems);
            }
            
            // Update summary with total count
            slotsFilled.textContent = totalItems;
          } else {
            // No available items, show message
            const noAvailableMsg = document.createElement('div');
            noAvailableMsg.className = 'noItemsMsg';
            noAvailableMsg.textContent = 'No items with estimated cost available.';
            resultsList.appendChild(noAvailableMsg);
            slotsFilled.textContent = 0;
          }
          
          // Render unavailable items section (cost = 0) - excluding interesting types
          if (mainUnavailableItems.length > 0) {
            // Create folding menu for unavailable items
            const unavailableSection = document.createElement('details');
            unavailableSection.className = 'unavailableSection';
            
            const unavailableSummary = document.createElement('summary');
            unavailableSummary.className = 'unavailableSummary';
            unavailableSummary.textContent = `Unavailable (${mainUnavailableItems.length} items)`;
            unavailableSection.appendChild(unavailableSummary);
            
            const unavailableContent = document.createElement('div');
            unavailableContent.className = 'unavailableContent';
            unavailableSection.appendChild(unavailableContent);
            
            resultsList.appendChild(unavailableSection);
            
            // Group unavailable items by slot and get top 5 for each slot
            const unavailableSlots = {};
            for (const it of mainUnavailableItems) {
              if (!unavailableSlots[it.slot]) unavailableSlots[it.slot] = [];
              unavailableSlots[it.slot].push(it);
            }
            
            // Sort each slot by current sortBy mode and take top 5
            for (const slotName in unavailableSlots) {
              const slotItems = unavailableSlots[slotName];
              
              // Sort by current sortBy mode
              sortSlotItems(slotItems, slotName);

              renderSlotGroup(unavailableContent, slotName, slotItems);
            }
          }
          
          // Render interesting items section
          const interestingAvailableItems = availableItems.filter(it => !isMainOutputItem(it));
          const interestingUnavailableItems = unavailableItems.filter(it => !isMainOutputItem(it));
          renderInterestingItems(interestingAvailableItems, interestingUnavailableItems);
          
          statusEl.textContent = 'Ready.';
        }
      } catch (e) {
        console.error('Error rendering results:', e);
        statusEl.textContent = `Render error: ${e.message || e}`;
      }
    }

    function renderInterestingItems(availableItems, unavailableItems = []) {
      try {
        const interestingItemsList = qs('interestingItemsList');
        interestingItemsList.innerHTML = '';
        
        // Combine available and unavailable interesting items
        const allInterestingItems = [...availableItems, ...unavailableItems];
        
        if (allInterestingItems.length === 0) {
          interestingItemsList.innerHTML = '<div class="noItemsMsg">No interesting items found.</div>';
          return;
        }
        
        // Group items by slot
        const slots = {};
        for (const it of allInterestingItems) {
          if (!slots[it.slot]) slots[it.slot] = [];
          slots[it.slot].push(it);
        }
        
        // Sort each slot by current sortBy mode and take top 5
        for (const slotName in slots) {
          const slotItems = slots[slotName];
          
          // Sort by current sortBy mode
          sortSlotItems(slotItems, slotName);

          renderSlotGroup(interestingItemsList, slotName, slotItems);
        }
      } catch (e) {
        console.error('Error rendering interesting items:', e);
      }
    }

    function createResultItemElement(it) {
      const div = document.createElement('div');
      div.className = 'resultItem';

      const iconContainer = document.createElement('div');
      iconContainer.className = 'itemIcon';
      const iconImg = document.createElement('img');
      let imageUrl = '/img/icons/default.png';
      if (it.image_url) {
        imageUrl = `https://web.simple-mmo.com${it.image_url}`;
      } else if (it.id) {
        imageUrl = `https://web.simple-mmo.com/item/inspect/${it.id}`;
      }
      iconImg.src = imageUrl;
      iconImg.alt = '';
      iconImg.title = it.name;
      iconContainer.appendChild(iconImg);

      const textContainer = document.createElement('div');
      textContainer.className = 'itemText';
      const valueDisplay = (it.bestValue != null) ? it.bestValue.toFixed(4) : '—';
      const link = document.createElement('a');
      link.href = `https://web.simple-mmo.com/item/inspect/${it.id}`;
      link.textContent = it.name;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';

      const rarityName = String(it.rarity || '').trim().toLowerCase();
      if (rarityName === 'celestial') {
        link.classList.add('rarityCelestial');
        link.style.fontWeight = 'bold';
        link.style.textDecoration = 'none';
      } else {
        const rarityColor = getRarityColor(it.rarity);
        if (rarityColor) {
          link.style.color = rarityColor;
          link.style.fontWeight = 'bold';
          link.style.textDecoration = 'none';
          link.style.textDecorationColor = rarityColor;
        }
      }

      textContainer.appendChild(link);
      const itemMeta = document.createElement('span');
      itemMeta.className = 'itemMeta';
      itemMeta.textContent = ` (Power ${it.power.toFixed(1)}, Estimated cost ${it.cost}, Value ${valueDisplay})`;
      textContainer.appendChild(itemMeta);
      const statsLine = document.createElement('div');
      statsLine.className = 'itemStatsLine';
      statsLine.textContent = formatItemStats(it);
      textContainer.appendChild(statsLine);

      div.appendChild(iconContainer);
      div.appendChild(textContainer);
      return div;
    }

    function renderSlotGroup(container, slotName, sortedSlotItems) {
      const top5 = sortedSlotItems.slice(0, 5);

      const slotGroup = document.createElement('section');
      slotGroup.className = 'slotGroup';

      const slotHeader = document.createElement('div');
      slotHeader.className = 'slotHeader';
      slotHeader.textContent = `${slotName} (${top5.length} items)`;
      slotGroup.appendChild(slotHeader);

      const slotLayout = document.createElement('div');
      slotLayout.className = 'slotLayout';

      if (top5.length > 0) {
        const topPickItem = createResultItemElement(top5[0]);
        topPickItem.classList.add('topPickItem');
        slotLayout.appendChild(topPickItem);
      }

      const secondaryItems = top5.slice(1);
      if (secondaryItems.length > 0) {
        const secondaryList = document.createElement('div');
        secondaryList.className = 'slotSecondaryList';
        for (const item of secondaryItems) {
          const secondaryItem = createResultItemElement(item);
          secondaryItem.classList.add('secondaryItem');
          secondaryList.appendChild(secondaryItem);
        }
        slotLayout.appendChild(secondaryList);
      }

      slotGroup.appendChild(slotLayout);
      container.appendChild(slotGroup);
      return top5.length;
    }

    function getRarityColor(rarity) {
      if (!rarity) return null;
      const rarityMap = {
        'Common': '#FFFFFF',      // White
        'Uncommon': '#00BFFF',    // Blue
        'Rare': '#FFA500',        // Orange
        'Elite': '#FF0000',       // Red
        'Epic': '#800080',        // Purple
        'Legendary': '#FFD700',   // Yellow
        'Celestial': '#ADD8E6',   // Light Blue
        'Exotic': '#00FF00'       // Green
      };
      return rarityMap[rarity] || null;
    }

    sortButton.addEventListener('click', () => {
      try {
        // Toggle between power and value sort
        sortBy = sortBy === 'power' ? 'value' : 'power';
        const label = sortBy === 'power' ? 'Sort by: Power' : 'Sort by: Value';
        sortButton.textContent = label;
        // Re-render with new sort
        const level = Number(levelInput.value) || 1;
        const gold = Number(goldInput.value) || 0;
        const minPower = Number(minPowerInput.value) || 0;
        const rawLogs = (window.SMMO_ITEM_LOGS && Array.isArray(window.SMMO_ITEM_LOGS)) ? window.SMMO_ITEM_LOGS : [];
        let items = [];
        const includeCritBonus = specialAttacksCheckbox.checked;
        if (rawLogs.length > 0) {
          items = rawLogs
            .map(l => l.item ? normalizeItem(l.item, includeCritBonus, level, l.id) : null)
            .filter(it => it !== null);
        } else {
          items = (CONFIG && CONFIG.DEMO_ITEMS) ? CONFIG.DEMO_ITEMS : [];
        }
        const usable = items.filter(it => {
          if (!it || !it.id) return false;
          const cost = it.marketLow != null ? it.marketLow : (it.price != null ? it.price : null);
          if (cost == null) return false;
          return (it.minLevel || 0) <= level && cost <= gold && it.power >= minPower;
        });
        usable.forEach(it => {
          const cost = it.marketLow != null ? it.marketLow : it.price;
          it.cost = cost;
          it.bestValue = cost > 0 ? it.power / cost : 0;
        });
        
        // Separate items with estimated cost of 0 (unavailable) from others
        const unavailableItems = usable.filter(it => (it.cost || 0) === 0);
        const availableItems = usable.filter(it => (it.cost || 0) > 0);
        
        updateSummary(availableItems);
        
        renderResults(availableItems, unavailableItems);
      } catch (e) {
        console.error('Error in sort button:', e);
        statusEl.textContent = `Sort error: ${e.message || e}`;
      }
    });

    resetButton.addEventListener('click', (ev) => {
      ev.preventDefault();
      if (optimizerForm) {
        optimizerForm.reset();
      } else {
        levelInput.value = '1';
        goldInput.value = '0';
        minPowerInput.value = '0';
        specialAttacksCheckbox.checked = false;
      }
      resetUiState();
    });

    resetUiState();
  });

  global.SMMO_APP = { CONFIG };
})(window);

