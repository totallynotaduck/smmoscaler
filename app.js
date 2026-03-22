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
    const copyButton = qs('copyButton');
    const levelInput = qs('levelInput');
    const goldInput = qs('goldInput');
    const minPowerInput = qs('minPowerInput');
    const defWeightInput = qs('defWeightInput');
    const defWeightValue = qs('defWeightValue');
    const specialAttacksCheckbox = qs('specialAttacksCheckbox');
    const statusEl = qs('status');
    const errorEl = qs('error');
    const resultsList = qs('resultsList');
    const interestingItemsList = qs('interestingItemsList');
    const summary = qs('summary');
    const totalCost = qs('totalCost');
    const totalPower = qs('totalPower');
    const slotsFilled = qs('slotsFilled');
    const INTERESTING_TYPE_KEYS = new Set([
      'collectable',
      'tome',
      'avatar',
      'item sprite',
      'grenade',
      'food',
      'background',
      'potion',
      'bootleg weapon',
      'event collectable',
      'exclusive trading card',
      'book',
      'trading card',
      'card pack',
      'material',
      'treasure chest'
    ]);

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

    function getDefWeight() {
      const fallback = 0.3;
      if (!defWeightInput) return fallback;
      const parsed = Number(defWeightInput.value);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.min(1, Math.max(0, parsed));
    }

    function updateDefWeightLabel() {
      if (!defWeightValue) return;
      defWeightValue.textContent = getDefWeight().toFixed(2);
    }

    function getSlotKey(slot) {
      return String(slot || '').trim().toLowerCase();
    }

    function isMainOutputItem(item) {
      return !INTERESTING_TYPE_KEYS.has(getSlotKey(item.slot)) && !item.custom_item && item.slot !== 'Tools' && 
             !['Wood Axe', 'Pickaxe', 'Fishing Rod', 'Shovel', 'Rusty Axe', 'Rusty Fishing Rod', 'Rusty Shovel', 'Rusty Pickaxe'].includes(item.name);
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

      totalCost.textContent = Math.round(estimatedCost).toLocaleString();
      totalPower.textContent = totalEquipmentStrength.toFixed(1);
      slotsFilled.textContent = mainAvailableItems.length;
    }

    function resetUiState() {
      sortBy = 'power';
      sortButton.textContent = 'Sort by: Power';
      sortButton.disabled = true;
      if (copyButton) {
        copyButton.disabled = true;
        copyButton.textContent = 'Copy summary';
      }
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
      slotsFilled.textContent = '—';
      statusEl.textContent = 'Ready.';
      updateDefWeightLabel();
    }

    function buildSummaryText() {
      const lines = [
        'SMMO Scaler Summary',
        `Estimated Cost: ${totalCost.textContent}`,
        `Equipment Strength: ${totalPower.textContent}`,
        `Items available: ${slotsFilled.textContent}`
      ];

      const allTopPickLinks = resultsList.querySelectorAll('.slotGroup .topPickItem .itemText > a');
      const mainTopPickLinks = Array.from(allTopPickLinks).filter(
        link => !link.closest('.unavailableSection')
      );

      if (mainTopPickLinks.length > 0) {
        lines.push('', 'Top Picks:');
        mainTopPickLinks.forEach(link => {
          lines.push(`- ${link.textContent}`);
        });
      }

      return lines.join('\n');
    }

    async function writeTextToClipboard(text) {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return;
      }

      const fallback = document.createElement('textarea');
      fallback.value = text;
      fallback.setAttribute('readonly', '');
      fallback.style.position = 'fixed';
      fallback.style.opacity = '0';
      fallback.style.pointerEvents = 'none';
      document.body.appendChild(fallback);
      fallback.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(fallback);
      if (!ok) {
        throw new Error('Clipboard unavailable');
      }
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

        // Special sorting for tool types: Wood Axe, Fishing Rod, Pickaxe, Shovel
        const toolTypes = ['Wood Axe', 'Fishing Rod', 'Pickaxe', 'Shovel'];
        if (toolTypes.includes(slotName)) {
          // Sort by rarity first (Celestial > Legendary > Epic > Elite > Rare > Uncommon > Common)
          const rarityOrder = {
            'Celestial': 7,
            'Legendary': 6,
            'Epic': 5,
            'Elite': 4,
            'Rare': 3,
            'Uncommon': 2,
            'Common': 1
          };
          
          const rarityA = rarityOrder[a.rarity] || 0;
          const rarityB = rarityOrder[b.rarity] || 0;
          
          if (rarityB !== rarityA) return rarityB - rarityA;
          
          // If same rarity, sort by power descending
          const powerA = a.power || 0;
          const powerB = b.power || 0;
          if (powerB !== powerA) return powerB - powerA;
          
          // If same power, sort by cost ascending
          const costA = a.cost || 0;
          const costB = b.cost || 0;
          if (costA !== costB) return costA - costB;
          
          // Final tiebreaker: by ID
          return Number(a.id || 0) - Number(b.id || 0);
        }

        const primaryA = sortBy === 'power' ? (a.power || 0) : (a.bestValue || 0);
        const primaryB = sortBy === 'power' ? (b.power || 0) : (b.bestValue || 0);
        if (primaryB !== primaryA) return primaryB - primaryA;

        const secondaryA = sortBy === 'power' ? (a.bestValue || 0) : (a.power || 0);
        const secondaryB = sortBy === 'power' ? (b.bestValue || 0) : (b.power || 0);
        if (secondaryB !== secondaryA) return secondaryB - secondaryA;

        if (slotName === 'Collectable') {
          const tagA = normalizeCustomTag(a.customItemTag ?? a.custom_item);
          const tagB = normalizeCustomTag(b.customItemTag ?? b.custom_item);
          const tagCompare = tagA.localeCompare(tagB, undefined, { numeric: true, sensitivity: 'base' });
          if (tagCompare !== 0) return tagCompare;
        }

        return Number(a.id || 0) - Number(b.id || 0);
      });
    }

    function normalizeItem(raw, includeCritBonus = false, playerLevel = 1, defWeight = 0.3, loggedItemId = null) {
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
      
      // Calculate power based on stats: str = 1 point, def = configurable weight
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
        else if (statKey === 'def') power += modifier * defWeight;
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
        const defWeight = getDefWeight();
        if (rawLogs.length > 0) {
          // Normalize items from logs, filtering out nulls (which are 404 entries)
          items = rawLogs
            .map(l => l.item ? normalizeItem(l.item, includeCritBonus, level, defWeight, l.id) : null)
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
        if (copyButton) {
          copyButton.disabled = availableItems.length === 0 && unavailableItems.length === 0;
        }
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
        
        // Sort each slot by current sortBy mode and render all items (no limit)
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
        const defWeight = getDefWeight();
        if (rawLogs.length > 0) {
          items = rawLogs
            .map(l => l.item ? normalizeItem(l.item, includeCritBonus, level, defWeight, l.id) : null)
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
        if (copyButton) {
          copyButton.disabled = availableItems.length === 0 && unavailableItems.length === 0;
        }
      } catch (e) {
        console.error('Error in sort button:', e);
        statusEl.textContent = `Sort error: ${e.message || e}`;
      }
    });

    if (copyButton) {
      copyButton.addEventListener('click', async () => {
        try {
          const summaryText = buildSummaryText();
          await writeTextToClipboard(summaryText);
          copyButton.textContent = 'Copied!';
          statusEl.textContent = 'Summary copied to clipboard.';
          window.setTimeout(() => {
            copyButton.textContent = 'Copy summary';
          }, 1400);
        } catch (e) {
          console.error('Error copying summary:', e);
          statusEl.textContent = 'Could not copy summary.';
        }
      });
    }

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
      updateDefWeightLabel();
      resetUiState();
    });

    if (defWeightInput) {
      defWeightInput.addEventListener('input', updateDefWeightLabel);
      defWeightInput.addEventListener('change', updateDefWeightLabel);
    }

    resetUiState();
  });

  global.SMMO_APP = { CONFIG };
})(window);