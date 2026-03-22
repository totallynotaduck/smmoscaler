(function main(global) {
  const CONFIG = global.SMMO_SCALER_CONFIG || null;

  function qs(id) { return document.getElementById(id); }

  document.addEventListener('DOMContentLoaded', () => {
    const configStatus = qs('configStatus');
    const optimizerForm = qs('optimizerForm');
    const runButton = qs('runButton');
    const resetButton = qs('resetButton');
    const sortButton = qs('sortButton');
    const budgetSortButton = qs('budgetSortButton');
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
    const toolItemsList = qs('toolItemsList');
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

    const TOOL_SLOT_KEYS = new Set(['tools', 'wood axe', 'pickaxe', 'fishing rod', 'shovel']);
    const SLOT_ORDER = [
      'Helmet', 'Amulet', 'Armour', 'Weapon', 'Shield',
      'Greaves', 'Gauntlet', 'Boots', 'Pet', 'Special'
    ];
    const SLOT_ORDER_MAP = new Map(SLOT_ORDER.map((s, i) => [s.toLowerCase(), i]));
    const RARITY_ORDER = {
      'Celestial': 7, 'Legendary': 6, 'Epic': 5, 'Elite': 4,
      'Rare': 3, 'Uncommon': 2, 'Common': 1
    };
    const RARITY_COLORS = {
      'Common': '#FFFFFF', 'Uncommon': '#00BFFF', 'Rare': '#FFA500',
      'Elite': '#FF0000', 'Epic': '#800080', 'Legendary': '#FFD700',
      'Celestial': '#ADD8E6', 'Exotic': '#00FF00'
    };
    const STAT_LABELS = { str: 'Strength', def: 'Defence', crit: 'Crit', hp: 'HP' };

    let sortBy = 'power';
    let budgetCapEnabled = false;

    let cachedNormalizedItems = null;
    let cachedLogsRef = null;
    let cachedIncludeCrit = null;
    let cachedDefWeight = null;
    let cachedLevel = null;

    function getNormalizedItems(rawLogs, includeCritBonus, level, defWeight) {
      if (
        cachedNormalizedItems &&
        cachedLogsRef === rawLogs &&
        cachedIncludeCrit === includeCritBonus &&
        cachedDefWeight === defWeight &&
        cachedLevel === level
      ) {
        return cachedNormalizedItems;
      }
      cachedNormalizedItems = [];
      for (let i = 0; i < rawLogs.length; i++) {
        const l = rawLogs[i];
        if (l.item) {
          const normalized = normalizeItem(l.item, includeCritBonus, level, defWeight, l.id);
          if (normalized) cachedNormalizedItems.push(normalized);
        }
      }
      cachedLogsRef = rawLogs;
      cachedIncludeCrit = includeCritBonus;
      cachedDefWeight = defWeight;
      cachedLevel = level;
      return cachedNormalizedItems;
    }

    if (CONFIG) configStatus.textContent = 'Config loaded';
    else configStatus.textContent = 'Config missing - using demo data';

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

    function toFiniteNumber(value, fallback = 0) {
      const parsed = parseNumber(value);
      if (parsed == null || !Number.isFinite(parsed)) return fallback;
      return parsed;
    }

    function updateDefWeightLabel() {
      if (!defWeightValue) return;
      defWeightValue.textContent = getDefWeight().toFixed(2);
    }

    function getSlotKey(slot) {
      return String(slot || '').trim().toLowerCase();
    }

    function isMainOutputItem(item) {
      const slotKey = getSlotKey(item.slot);
      return !INTERESTING_TYPE_KEYS.has(slotKey) && !item.custom_item && !TOOL_SLOT_KEYS.has(slotKey);
    }

    function getOrderedSlotNames(slotsObj) {
      return Object.keys(slotsObj).sort((a, b) => {
        const idxA = SLOT_ORDER_MAP.has(a.toLowerCase()) ? SLOT_ORDER_MAP.get(a.toLowerCase()) : 999;
        const idxB = SLOT_ORDER_MAP.has(b.toLowerCase()) ? SLOT_ORDER_MAP.get(b.toLowerCase()) : 999;
        return idxA - idxB;
      });
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
          const currentCost = toFiniteNumber(current.cost, 0);
          const nextCost = toFiniteNumber(item.cost, 0);
          if (nextCost < currentCost) {
            bestBySlot.set(item.slot, item);
          }
        }
      }
      return Array.from(bestBySlot.values());
    }

    function chooseBestBudgetCappedItemsBySlot(items, sortMode, goldLimit) {
      if (!Number.isFinite(goldLimit) || goldLimit <= 0) return [];

      const bySlot = new Map();
      for (const item of items) {
        const cost = toFiniteNumber(item.cost, 0);
        if (cost <= 0) continue;
        if (!bySlot.has(item.slot)) bySlot.set(item.slot, []);
        bySlot.get(item.slot).push(item);
      }

      const slots = Array.from(bySlot.keys());
      if (slots.length === 0) return [];

      function getMetric(it) {
        return sortMode === 'power' ? toFiniteNumber(it.power, 0) : toFiniteNumber(it.bestValue, 0);
      }

      const slotOptions = slots.map(slot => {
        const opts = bySlot.get(slot)
          .filter(it => toFiniteNumber(it.cost, 0) <= goldLimit)
          .sort((a, b) => {
            const cA = toFiniteNumber(a.cost, 0);
            const cB = toFiniteNumber(b.cost, 0);
            if (cA !== cB) return cA - cB;
            const mA = getMetric(a);
            const mB = getMetric(b);
            if (mB !== mA) return mB - mA;
            return Number(a.id || 0) - Number(b.id || 0);
          });

        const compact = [];
        let bestMetricSeen = -Infinity;
        for (const it of opts) {
          const metric = getMetric(it);
          if (metric > bestMetricSeen) {
            compact.push(it);
            bestMetricSeen = metric;
          }
        }
        return compact;
      });

      let states = [{ cost: 0, score: 0, picks: [] }];

      for (let i = 0; i < slots.length; i++) {
        const nextStates = [];

        for (const state of states) {
          nextStates.push(state);

          for (const it of slotOptions[i]) {
            const cost = toFiniteNumber(it.cost, 0);
            const score = getMetric(it);
            const nextCost = state.cost + cost;
            if (nextCost > goldLimit) continue;
            nextStates.push({
              cost: nextCost,
              score: state.score + score,
              picks: state.picks.concat(it)
            });
          }
        }

        nextStates.sort((a, b) => {
          if (a.cost !== b.cost) return a.cost - b.cost;
          if (b.score !== a.score) return b.score - a.score;
          return b.picks.length - a.picks.length;
        });

        const pruned = [];
        let bestScoreAtCost = -Infinity;
        for (const st of nextStates) {
          if (st.score > bestScoreAtCost) {
            pruned.push(st);
            bestScoreAtCost = st.score;
          }
        }

        states = pruned.length > 5000 ? pruned.slice(-5000) : pruned;
      }

      if (states.length === 0) return [];

      states.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.picks.length !== a.picks.length) return b.picks.length - a.picks.length;
        return a.cost - b.cost;
      });

      return states[0].picks;
    }

    function updateSummary(availableItems, selectedMainItems = null) {
      const mainAvailableItems = Array.isArray(selectedMainItems)
        ? selectedMainItems
        : availableItems.filter(isMainOutputItem);
      const bestPerSlot = budgetCapEnabled
        ? mainAvailableItems
        : pickBestItemsBySlot(mainAvailableItems, sortBy);

      const estimatedCost = bestPerSlot.reduce((sum, item) => sum + toFiniteNumber(item.cost, 0), 0);
      const totalEquipmentStrength = bestPerSlot.reduce((sum, item) => sum + (item.power || 0), 0);

      totalCost.textContent = Math.round(estimatedCost).toLocaleString();
      totalPower.textContent = totalEquipmentStrength.toFixed(1);
      slotsFilled.textContent = bestPerSlot.length;
    }

    function updateBudgetButtonLabel() {
      if (!budgetSortButton) return;
      budgetSortButton.textContent = budgetCapEnabled ? 'Budget Cap: On' : 'Budget Cap: Off';
    }

    function recomputeAndRender() {
      const level = toFiniteNumber(levelInput.value, 1);
      const gold = toFiniteNumber(goldInput.value, 0);
      const rawLogs = (window.SMMO_ITEM_LOGS && Array.isArray(window.SMMO_ITEM_LOGS)) ? window.SMMO_ITEM_LOGS : [];
      let items = [];
      const includeCritBonus = specialAttacksCheckbox.checked;
      const defWeight = getDefWeight();

      if (rawLogs.length > 0) {
        items = getNormalizedItems(rawLogs, includeCritBonus, level, defWeight);
        configStatus.textContent = `Using ${items.length} items from logs (${rawLogs.length} total entries)`;
      } else {
        items = (CONFIG && CONFIG.DEMO_ITEMS) ? CONFIG.DEMO_ITEMS : [];
      }

      const minPower = Number(minPowerInput.value) || 0;
      const usable = [];
      const toolItems = [];
      for (const it of items) {
        if (!it || !it.id) continue;
        const cost = it.marketLow != null ? toFiniteNumber(it.marketLow, null) : (it.price != null ? toFiniteNumber(it.price, null) : null);
        if (cost == null) continue;
        if (it.slot === 'Food' || it.slot === 'Other') continue;
        if ((it.minLevel || 0) > level || cost > gold || it.power < minPower) continue;
        it.cost = cost;
        it.bestValue = cost > 0 ? it.power / cost : 0;
        if (TOOL_SLOT_KEYS.has(getSlotKey(it.slot))) {
          toolItems.push(it);
        } else {
          usable.push(it);
        }
      }

      const unavailableItems = usable.filter(it => (it.cost || 0) === 0);
      const availableItems = usable.filter(it => (it.cost || 0) > 0);
      const interestingAvailableItems = availableItems.filter(it => !isMainOutputItem(it));

      let renderAvailableItems = availableItems;
      let selectedMainItems = null;
      if (budgetCapEnabled) {
        const mainAvailableItems = availableItems.filter(isMainOutputItem);
        selectedMainItems = chooseBestBudgetCappedItemsBySlot(mainAvailableItems, sortBy, gold);
        renderAvailableItems = selectedMainItems.concat(interestingAvailableItems);
      }

      updateSummary(renderAvailableItems, selectedMainItems);

      sortButton.disabled = false;
      if (budgetSortButton) budgetSortButton.disabled = false;
      if (copyButton) {
        copyButton.disabled = renderAvailableItems.length === 0 && unavailableItems.length === 0;
      }
      renderResults(renderAvailableItems, unavailableItems, toolItems);
    }

    function resetUiState() {
      sortBy = 'power';
      budgetCapEnabled = false;
      sortButton.textContent = 'Sort by: Power';
      sortButton.disabled = true;
      updateBudgetButtonLabel();
      if (budgetSortButton) {
        budgetSortButton.disabled = true;
      }
      if (copyButton) {
        copyButton.disabled = true;
        copyButton.textContent = 'Copy Summary';
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
      totalCost.textContent = '-';
      totalPower.textContent = '-';
      slotsFilled.textContent = '-';
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
      return STAT_LABELS[statKey] || String(statKey || '').toUpperCase();
    }

    function formatStatValue(value) {
      if (!Number.isFinite(value)) return '0';
      return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, '');
    }

    function formatItemStats(item) {
      if (!item || !Array.isArray(item.stats) || item.stats.length === 0) return 'Stats: -';
      const parts = item.stats.map(stat => `${getStatDisplayName(stat.key)} ${formatStatValue(stat.value)}`);
      return `Stats: ${parts.join(' • ')}`;
    }

    function normalizeCustomTag(value) {
      if (value == null) return '';
      return String(value).trim().toLowerCase();
    }

    function sortSlotItems(slotItems, slotName) {
      const isAvatarSlot = slotName === 'Avatar' || slotName === 'Item Sprite';
      const isToolSlot = TOOL_SLOT_KEYS.has(slotName.toLowerCase());
      const isCollectable = slotName === 'Collectable';
      const sortByPower = sortBy === 'power';

      if (isCollectable) {
        for (const it of slotItems) {
          it._sortTag = normalizeCustomTag(it.customItemTag ?? it.custom_item);
        }
      }

      slotItems.sort((a, b) => {
        if (isAvatarSlot) {
          return Number(b.loggedItemId ?? b.id ?? 0) - Number(a.loggedItemId ?? a.id ?? 0);
        }

        if (isToolSlot) {
          const rarityDiff = (RARITY_ORDER[b.rarity] || 0) - (RARITY_ORDER[a.rarity] || 0);
          if (rarityDiff !== 0) return rarityDiff;
          const powerDiff = (b.power || 0) - (a.power || 0);
          if (powerDiff !== 0) return powerDiff;
          const costDiff = (a.cost || 0) - (b.cost || 0);
          if (costDiff !== 0) return costDiff;
          return Number(a.id || 0) - Number(b.id || 0);
        }

        const primaryA = sortByPower ? (a.power || 0) : (a.bestValue || 0);
        const primaryB = sortByPower ? (b.power || 0) : (b.bestValue || 0);
        if (primaryB !== primaryA) return primaryB - primaryA;

        const secondaryA = sortByPower ? (a.bestValue || 0) : (a.power || 0);
        const secondaryB = sortByPower ? (b.bestValue || 0) : (b.power || 0);
        if (secondaryB !== secondaryA) return secondaryB - secondaryA;

        if (isCollectable) {
          const tagCompare = a._sortTag.localeCompare(b._sortTag, undefined, { numeric: true, sensitivity: 'base' });
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
      
      const marketLowRaw = raw['market-low'] ?? raw.market_low ?? raw.marketLow ?? (raw.market && raw.market.low);
      const marketLow = parseNumber(marketLowRaw);
      
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
        recomputeAndRender();
      } catch (e) {
        console.error('Error in calculator:', e);
        statusEl.textContent = `Error: ${e.message || e}`;
      }
    });

    function renderResults(availableItems, unavailableItems = [], toolItems = []) {
      try {
        resultsList.innerHTML = '';
        if (availableItems.length === 0 && unavailableItems.length === 0) {
          resultsList.hidden = true;
          summary.hidden = true;
          statusEl.textContent = 'No items match the criteria.';
        } else {
          summary.hidden = false;
          resultsList.hidden = false;
          
          const mainAvailableItems = availableItems.filter(isMainOutputItem);
          const mainUnavailableItems = unavailableItems.filter(isMainOutputItem);
          
          if (mainAvailableItems.length > 0) {
            const slots = {};
            for (const it of mainAvailableItems) {
              if (!slots[it.slot]) slots[it.slot] = [];
              slots[it.slot].push(it);
            }
            
            let totalItems = 0;
            for (const slotName of getOrderedSlotNames(slots)) {
              const slotItems = slots[slotName];

              sortSlotItems(slotItems, slotName);

              totalItems += renderSlotGroup(resultsList, slotName, slotItems);
            }
            
            slotsFilled.textContent = totalItems;
          } else {
            const noAvailableMsg = document.createElement('div');
            noAvailableMsg.className = 'noItemsMsg';
            noAvailableMsg.textContent = 'No items with estimated cost available.';
            resultsList.appendChild(noAvailableMsg);
            slotsFilled.textContent = 0;
          }
          
          if (mainUnavailableItems.length > 0) {
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
            
            const unavailableSlots = {};
            for (const it of mainUnavailableItems) {
              if (!unavailableSlots[it.slot]) unavailableSlots[it.slot] = [];
              unavailableSlots[it.slot].push(it);
            }
            
            for (const slotName of getOrderedSlotNames(unavailableSlots)) {
              const slotItems = unavailableSlots[slotName];

              sortSlotItems(slotItems, slotName);

              renderSlotGroup(unavailableContent, slotName, slotItems);
            }
          }
          
          const interestingAvailableItems = availableItems.filter(it => !isMainOutputItem(it));
          const interestingUnavailableItems = unavailableItems.filter(it => !isMainOutputItem(it));
          renderInterestingItems(interestingAvailableItems, interestingUnavailableItems);
          renderToolItems(toolItems);

          statusEl.textContent = 'Ready.';
        }
      } catch (e) {
        console.error('Error rendering results:', e);
        statusEl.textContent = `Render error: ${e.message || e}`;
      }
    }

    function renderInterestingItems(availableItems, unavailableItems = []) {
      try {
        interestingItemsList.innerHTML = '';
        
        const allInterestingItems = [...availableItems, ...unavailableItems];
        
        if (allInterestingItems.length === 0) {
          interestingItemsList.innerHTML = '<div class="noItemsMsg">No interesting items found.</div>';
          return;
        }
        
        const slots = {};
        for (const it of allInterestingItems) {
          if (!slots[it.slot]) slots[it.slot] = [];
          slots[it.slot].push(it);
        }
        
        for (const slotName of getOrderedSlotNames(slots)) {
          const slotItems = slots[slotName];
          
          sortSlotItems(slotItems, slotName);

          renderSlotGroup(interestingItemsList, slotName, slotItems);
        }
      } catch (e) {
        console.error('Error rendering interesting items:', e);
      }
    }

    function renderToolItems(items) {
      if (!toolItemsList) return;
      try {
        toolItemsList.innerHTML = '';

        if (items.length === 0) {
          toolItemsList.innerHTML = '<div class="noItemsMsg">No tools found.</div>';
          return;
        }

        const slots = {};
        for (const it of items) {
          if (!slots[it.slot]) slots[it.slot] = [];
          slots[it.slot].push(it);
        }

        for (const slotName of getOrderedSlotNames(slots)) {
          const slotItems = slots[slotName];
          sortSlotItems(slotItems, slotName);
          renderSlotGroup(toolItemsList, slotName, slotItems);
        }
      } catch (e) {
        console.error('Error rendering tool items:', e);
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
      const valueDisplay = (it.bestValue != null) ? it.bestValue.toFixed(4) : '-';
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
      return RARITY_COLORS[rarity] || null;
    }

    sortButton.addEventListener('click', () => {
      try {
        sortBy = sortBy === 'power' ? 'value' : 'power';
        const label = sortBy === 'power' ? 'Sort by: Power' : 'Sort by: Value';
        sortButton.textContent = label;
        recomputeAndRender();
      } catch (e) {
        console.error('Error in sort button:', e);
        statusEl.textContent = `Sort error: ${e.message || e}`;
      }
    });

    if (budgetSortButton) {
      budgetSortButton.addEventListener('click', () => {
        try {
          budgetCapEnabled = !budgetCapEnabled;
          updateBudgetButtonLabel();
          recomputeAndRender();
        } catch (e) {
          console.error('Error in budget sort button:', e);
          statusEl.textContent = `Budget sort error: ${e.message || e}`;
        }
      });
    }

    if (copyButton) {
      copyButton.addEventListener('click', async () => {
        try {
          const summaryText = buildSummaryText();
          await writeTextToClipboard(summaryText);
          copyButton.textContent = 'Copied!';
          statusEl.textContent = 'Summary copied to clipboard.';
          window.setTimeout(() => {
            copyButton.textContent = 'Copy Summary';
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