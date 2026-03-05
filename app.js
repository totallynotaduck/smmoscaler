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
    const minPowerInput = qs('minPowerInput');
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

    // Debug: log config and initial state
    console.log('SMMO Scaler initialized', { 
      CONFIG: CONFIG ? 'loaded' : 'missing',
      logsAvailable: !!window.SMMO_ITEM_LOGS,
      logsCount: (window.SMMO_ITEM_LOGS || []).length
    });

    function normalizeItem(raw, includeCritBonus = false, playerLevel = 1) {
      if (!raw) return null;
      const id = raw.id || raw.item_id || raw.itemId || raw._id || String(raw.id || raw.item_id || raw.itemId || '');
      const name = raw.name || raw.item_name || raw.title || `Item ${id}`;
      const minLevel = raw.minLevel || raw.min_level || raw.level || raw.required_level || 1;
      const price = raw.price || raw.cost || raw.gold || 0;
      const slot = raw.slot || raw.type || raw.category || 'unknown';
      const rarity = raw.rarity || raw.rarity_name || raw.rarityName || raw.item_rarity || raw.itemRarity || null;
      const custom_item = raw.custom_item || raw.customItem || raw.is_custom || raw.isCustom || null;
      
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
        else if (statName === 'crit' && includeCritBonus) {
          // Formula: Player Level x 2 x Crit Value/1000
          power += playerLevel * 2 * (modifier / 1000);
        }
      }
      
      return {
        id,
        name,
        minLevel: Number(minLevel),
        price: Number(price),
        slot,
        rarity,
        custom_item,
        power: power,
        marketLow: marketLow == null ? null : Number(marketLow),
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
        const includeCritBonus = qs('specialAttacksCheckbox').checked;
        if (rawLogs.length > 0) {
          // Normalize items from logs, filtering out nulls (which are 404 entries)
          items = rawLogs
            .map(l => l.item ? normalizeItem(l.item, includeCritBonus, level) : null)
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
        const totalItems = availableItems.length;
        
        // Calculate estimated cost by only counting the first item's cost for each item type
        const itemTypes = {};
        let estimatedCost = 0;
        for (const item of availableItems) {
          if (!itemTypes[item.slot]) {
            itemTypes[item.slot] = true;
            estimatedCost += (item.cost || 0);
          }
        }
        
        // Calculate equipment strength by summing the highest item power for each item type
        const equipmentStrength = {};
        let totalEquipmentStrength = 0;
        for (const item of availableItems) {
          if (!equipmentStrength[item.slot] || item.power > equipmentStrength[item.slot]) {
            // Update to the highest power found for this slot
            if (equipmentStrength[item.slot]) {
              // Subtract the previous power value since we're replacing it
              totalEquipmentStrength -= equipmentStrength[item.slot];
            }
            equipmentStrength[item.slot] = item.power;
            totalEquipmentStrength += item.power;
          }
        }
        
        // Calculate max values based on current sort mode
        let maxPower = 0;
        let maxValue = 0;
        
        if (sortBy === 'power') {
          // When sorting by power, show max power and max value
          maxPower = availableItems.reduce((m, i) => Math.max(m, i.power || 0), 0);
          maxValue = availableItems.reduce((m, i) => Math.max(m, i.bestValue || 0), 0);
        } else {
          // When sorting by value, show max value and max power
          maxValue = availableItems.reduce((m, i) => Math.max(m, i.bestValue || 0), 0);
          maxPower = availableItems.reduce((m, i) => Math.max(m, i.power || 0), 0);
        }

        totalCost.textContent = estimatedCost;
        totalPower.textContent = totalEquipmentStrength.toFixed(1);
        bestValue.textContent = maxValue.toFixed(4);
        slotsFilled.textContent = totalItems;

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
          const interestingTypes = ['Collectable', 'Tome', 'Avatar', 'Item Sprite', 'Grenade', 'Food'];
          const mainAvailableItems = availableItems.filter(it => !interestingTypes.includes(it.slot) && !it.custom_item);
          const mainUnavailableItems = unavailableItems.filter(it => !interestingTypes.includes(it.slot) && !it.custom_item);
          
          // Calculate equipment strength based on current sort mode using mainAvailableItems
          const equipmentStrength = {};
          let totalEquipmentStrength = 0;
          for (const item of mainAvailableItems) {
            if (!equipmentStrength[item.slot] || item.power > equipmentStrength[item.slot]) {
              // Update to the highest power found for this slot
              if (equipmentStrength[item.slot]) {
                // Subtract the previous power value since we're replacing it
                totalEquipmentStrength -= equipmentStrength[item.slot];
              }
              equipmentStrength[item.slot] = item.power;
              totalEquipmentStrength += item.power;
            }
          }
          
          // Update the display with the calculated equipment strength
          totalPower.textContent = totalEquipmentStrength.toFixed(1);
          
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
              if (sortBy === 'power') {
                slotItems.sort((a, b) => b.power - a.power);
              } else {
                // Sort by bestValue descending
                slotItems.sort((a, b) => b.bestValue - a.bestValue);
              }
              
              // Take top 5 items for this slot
              const top5 = slotItems.slice(0, 5);
              totalItems += top5.length;
              
              // Add slot header
              const slotHeader = document.createElement('div');
              slotHeader.className = 'slotHeader';
              slotHeader.textContent = `${slotName} (${top5.length} items)`;
              resultsList.appendChild(slotHeader);
              
              // Add items for this slot
              for (const it of top5) {
                const div = document.createElement('div');
                div.className = 'resultItem';
                
                // Create icon container
                const iconContainer = document.createElement('div');
                iconContainer.className = 'itemIcon';
                const iconImg = document.createElement('img');
                // Use image_url from logs if available, otherwise construct from item ID
                // Always prefix with https://web.simple-mmo.com for complete URLs
                let imageUrl = '/img/icons/default.png';
                if (it.image_url) {
                  // Add prefix to existing image_url from logs
                  imageUrl = `https://web.simple-mmo.com${it.image_url}`;
                } else if (it.id) {
                  // Construct URL using item ID
                  imageUrl = `https://web.simple-mmo.com/item/inspect/${it.id}`;
                }
                iconImg.src = imageUrl;
                iconImg.alt = '';
                iconImg.title = it.name;
                iconContainer.appendChild(iconImg);
                
                // Create text container
                const textContainer = document.createElement('div');
                textContainer.className = 'itemText';
                const valueDisplay = (it.bestValue != null) ? it.bestValue.toFixed(4) : '—';
                const link = document.createElement('a');
                link.href = `https://web.simple-mmo.com/item/inspect/${it.id}`;
                link.textContent = it.name;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                
                // Add rarity color styling
                const rarityColor = getRarityColor(it.rarity);
                if (rarityColor) {
                  link.style.color = rarityColor;
                  link.style.fontWeight = 'bold';
                  // Also style the hyperlink color (visited links)
                  link.style.textDecoration = 'none';
                  link.style.textDecorationColor = rarityColor;
                }
                
                textContainer.appendChild(link);
                textContainer.appendChild(document.createTextNode(` (Power ${it.power.toFixed(1)}, Estimated cost ${it.cost}, Value ${valueDisplay})`));
                
                div.appendChild(iconContainer);
                div.appendChild(textContainer);
                resultsList.appendChild(div);
              }
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
              if (sortBy === 'power') {
                slotItems.sort((a, b) => b.power - a.power);
              } else {
                // Sort by bestValue descending
                slotItems.sort((a, b) => b.bestValue - a.bestValue);
              }
              
              // Take top 5 items for this slot
              const top5 = slotItems.slice(0, 5);
              
              // Add slot header
              const slotHeader = document.createElement('div');
              slotHeader.className = 'slotHeader';
              slotHeader.textContent = `${slotName} (${top5.length} items)`;
              unavailableContent.appendChild(slotHeader);
              
              // Add items for this slot
              for (const it of top5) {
                const div = document.createElement('div');
                div.className = 'resultItem';
                
                // Create icon container
                const iconContainer = document.createElement('div');
                iconContainer.className = 'itemIcon';
                const iconImg = document.createElement('img');
                // Use image_url from logs if available, otherwise construct from item ID
                // Always prefix with https://web.simple-mmo.com for complete URLs
                let imageUrl = '/img/icons/default.png';
                if (it.image_url) {
                  // Add prefix to existing image_url from logs
                  imageUrl = `https://web.simple-mmo.com${it.image_url}`;
                } else if (it.id) {
                  // Construct URL using item ID
                  imageUrl = `https://web.simple-mmo.com/item/inspect/${it.id}`;
                }
                iconImg.src = imageUrl;
                iconImg.alt = '';
                iconImg.title = it.name;
                iconContainer.appendChild(iconImg);
                
                // Create text container
                const textContainer = document.createElement('div');
                textContainer.className = 'itemText';
                const valueDisplay = (it.bestValue != null) ? it.bestValue.toFixed(4) : '—';
                const link = document.createElement('a');
                link.href = `https://web.simple-mmo.com/item/inspect/${it.id}`;
                link.textContent = it.name;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                
                // Add rarity color styling
                const rarityColor = getRarityColor(it.rarity);
                if (rarityColor) {
                  link.style.color = rarityColor;
                  link.style.fontWeight = 'bold';
                  // Also style the hyperlink color (visited links)
                  link.style.textDecoration = 'none';
                  link.style.textDecorationColor = rarityColor;
                }
                
                textContainer.appendChild(link);
                textContainer.appendChild(document.createTextNode(` (Power ${it.power.toFixed(1)}, Estimated cost ${it.cost}, Value ${valueDisplay})`));
                
                div.appendChild(iconContainer);
                div.appendChild(textContainer);
                unavailableContent.appendChild(div);
              }
            }
          }
          
          // Render interesting items section
          const interestingAvailableItems = availableItems.filter(it => interestingTypes.includes(it.slot) || it.custom_item);
          const interestingUnavailableItems = unavailableItems.filter(it => interestingTypes.includes(it.slot) || it.custom_item);
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
          if (sortBy === 'power') {
            slotItems.sort((a, b) => b.power - a.power);
          } else {
            // Sort by bestValue descending
            slotItems.sort((a, b) => b.bestValue - a.bestValue);
          }
          
          // Take top 5 items for this slot
          const top5 = slotItems.slice(0, 5);
          
          // Add slot header
          const slotHeader = document.createElement('div');
          slotHeader.className = 'slotHeader';
          slotHeader.textContent = `${slotName} (${top5.length} items)`;
          interestingItemsList.appendChild(slotHeader);
          
          // Add items for this slot
          for (const it of top5) {
            const div = document.createElement('div');
            div.className = 'resultItem';
            
            // Create icon container
            const iconContainer = document.createElement('div');
            iconContainer.className = 'itemIcon';
            const iconImg = document.createElement('img');
            // Use image_url from logs if available, otherwise construct from item ID
            // Always prefix with https://web.simple-mmo.com for complete URLs
            let imageUrl = '/img/icons/default.png';
            if (it.image_url) {
              // Add prefix to existing image_url from logs
              imageUrl = `https://web.simple-mmo.com${it.image_url}`;
            } else if (it.id) {
              // Construct URL using item ID
              imageUrl = `https://web.simple-mmo.com/item/inspect/${it.id}`;
            }
            iconImg.src = imageUrl;
            iconImg.alt = '';
            iconImg.title = it.name;
            iconContainer.appendChild(iconImg);
            
            // Create text container
            const textContainer = document.createElement('div');
            textContainer.className = 'itemText';
            const valueDisplay = (it.bestValue != null) ? it.bestValue.toFixed(4) : '—';
            const link = document.createElement('a');
            link.href = `https://web.simple-mmo.com/item/inspect/${it.id}`;
            link.textContent = it.name;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            
            // Add rarity color styling
            const rarityColor = getRarityColor(it.rarity);
            if (rarityColor) {
              link.style.color = rarityColor;
              link.style.fontWeight = 'bold';
              // Also style the hyperlink color (visited links)
              link.style.textDecoration = 'none';
              link.style.textDecorationColor = rarityColor;
            }
            
            textContainer.appendChild(link);
            textContainer.appendChild(document.createTextNode(` (Power ${it.power.toFixed(1)}, Estimated cost ${it.cost}, Value ${valueDisplay})`));
            
            div.appendChild(iconContainer);
            div.appendChild(textContainer);
            interestingItemsList.appendChild(div);
          }
        }
      } catch (e) {
        console.error('Error rendering interesting items:', e);
      }
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
        const includeCritBonus = qs('specialAttacksCheckbox').checked;
        if (rawLogs.length > 0) {
          items = rawLogs
            .map(l => l.item ? normalizeItem(l.item, includeCritBonus, level) : null)
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
        
        // Calculate estimated cost by only counting the first item's cost for each item type
        const itemTypes = {};
        let estimatedCost = 0;
        for (const item of availableItems) {
          if (!itemTypes[item.slot]) {
            itemTypes[item.slot] = true;
            estimatedCost += (item.cost || 0);
          }
        }
        
        // Calculate equipment strength by summing the highest item power for each item type
        const equipmentStrength = {};
        let totalEquipmentStrength = 0;
        for (const item of availableItems) {
          if (!equipmentStrength[item.slot] || item.power > equipmentStrength[item.slot]) {
            // Update to the highest power found for this slot
            if (equipmentStrength[item.slot]) {
              // Subtract the previous power value since we're replacing it
              totalEquipmentStrength -= equipmentStrength[item.slot];
            }
            equipmentStrength[item.slot] = item.power;
            totalEquipmentStrength += item.power;
          }
        }
        
        // Calculate max values based on current sort mode
        let maxPower = 0;
        let maxValue = 0;
        
        if (sortBy === 'power') {
          // When sorting by power, show max power and max value
          maxPower = availableItems.reduce((m, i) => Math.max(m, i.power || 0), 0);
          maxValue = availableItems.reduce((m, i) => Math.max(m, i.bestValue || 0), 0);
        } else {
          // When sorting by value, show max value and max power
          maxValue = availableItems.reduce((m, i) => Math.max(m, i.bestValue || 0), 0);
          maxPower = availableItems.reduce((m, i) => Math.max(m, i.power || 0), 0);
        }

        totalCost.textContent = estimatedCost;
        totalPower.textContent = totalEquipmentStrength.toFixed(1);
        bestValue.textContent = maxValue.toFixed(4);
        
        renderResults(availableItems, unavailableItems);
      } catch (e) {
        console.error('Error in sort button:', e);
        statusEl.textContent = `Sort error: ${e.message || e}`;
      }
    });
  });

  global.SMMO_APP = { CONFIG };
})(window);

