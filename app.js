/* global SMMO_SCALER_CONFIG */

(() => {
  const el = {
    form: document.getElementById("optimizerForm"),
    level: document.getElementById("levelInput"),
    gold: document.getElementById("goldInput"),
    run: document.getElementById("runButton"),
    reset: document.getElementById("resetButton"),
    copy: document.getElementById("copyButton"),
    status: document.getElementById("status"),
    error: document.getElementById("error"),
    configStatus: document.getElementById("configStatus"),
    summary: document.getElementById("summary"),
    totalCost: document.getElementById("totalCost"),
    totalPower: document.getElementById("totalPower"),
    slotsFilled: document.getElementById("slotsFilled"),
    resultsList: document.getElementById("resultsList"),
  };

  const config = (window.SMMO_SCALER_CONFIG ?? {});

  function setStatus(text) {
    el.status.textContent = text;
  }

  function showError(message) {
    el.error.hidden = false;
    el.error.textContent = message;
  }

  function clearError() {
    el.error.hidden = true;
    el.error.textContent = "";
  }

  function setLoading(isLoading) {
    el.run.disabled = isLoading;
    el.reset.disabled = isLoading;
    el.level.disabled = isLoading;
    el.gold.disabled = isLoading;
    if (isLoading) {
      el.copy.disabled = true;
    }
  }

  function formatNumber(n) {
    return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(n);
  }

  function normalizeItem(raw) {
    if (!raw || typeof raw !== "object") return null;

    // Item ID / code: treat the API's item identifier as the canonical ID.
    const id =
      raw.id ??
      raw.item_id ??
      raw.key ??
      raw.code ??
      raw.apiKey ??
      raw.itemId;

    // Human-readable name.
    const name = raw.name ?? raw.title ?? raw.displayName ?? String(id ?? "Unknown item");

    // Equipment slot / category. SimpleMMO-style APIs often expose either
    // a "slot" or "type" field; both are considered here.
    const slot = raw.slot ?? raw.type ?? raw.category ?? raw.item_type ?? "unknown";

    // Level requirement.
    const minLevel =
      raw.minLevel ??
      raw.levelRequirement ??
      raw.level_required ??
      raw.requiredLevel ??
      raw.level_requirement ??
      1;

    // Purchase price / value in gold. Prefer an explicit "price" or "value",
    // then fall back to other common names.
    const price =
      raw.price ??
      raw.value ??
      raw.cost ??
      raw.gold ??
      raw.buyPrice ??
      raw.worth ??
      0;

    // Overall "power" score used by the optimizer. For APIs that expose
    // separate offensive/defensive stats, we approximate power as the sum.
    const attack = raw.attack ?? raw.attack_value ?? 0;
    const defence = raw.defence ?? raw.defense ?? raw.defence_value ?? 0;
    const combinedStats = Number(attack || 0) + Number(defence || 0);

    const power =
      raw.power ??
      raw.score ??
      raw.strength ??
      raw.statPower ??
      raw.rating ??
      combinedStats ??
      0;

    if (!id) return null;

    return {
      id: String(id),
      name: String(name),
      slot: String(slot).toLowerCase(),
      minLevel: Number(minLevel) || 0,
      price: Number(price) || 0,
      power: Number(power) || 0,
      raw,
    };
  }

  function sortSlots(a, b) {
    const order = Array.isArray(config.SLOT_ORDER) ? config.SLOT_ORDER : [];
    const ia = order.indexOf(a);
    const ib = order.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  }

  function chooseBestPerSlot({ items, level, gold }) {
    const usable = items
      .filter((it) => it && Number.isFinite(it.minLevel) && it.minLevel <= level)
      .filter((it) => Number.isFinite(it.price) && it.price <= gold);

    const bySlot = new Map();
    for (const it of usable) {
      const slot = it.slot || "unknown";
      const existing = bySlot.get(slot);
      if (!existing) {
        bySlot.set(slot, it);
        continue;
      }

      // Primary: higher power. Tiebreak: better power/price. Then: cheaper.
      const existingValue = existing.price > 0 ? existing.power / existing.price : existing.power;
      const itValue = it.price > 0 ? it.power / it.price : it.power;

      const isBetter =
        it.power > existing.power ||
        (it.power === existing.power && itValue > existingValue) ||
        (it.power === existing.power && itValue === existingValue && it.price < existing.price);

      if (isBetter) bySlot.set(slot, it);
    }

    const picked = [...bySlot.entries()]
      .sort((a, b) => sortSlots(a[0], b[0]))
      .map(([, it]) => it);

    // Ensure total cost fits budget by dropping weakest value items first (greedy).
    let totalCost = picked.reduce((sum, it) => sum + it.price, 0);
    if (totalCost > gold) {
      const withValue = picked
        .map((it) => ({
          it,
          value: it.price > 0 ? it.power / it.price : it.power,
        }))
        .sort((a, b) => a.value - b.value); // lowest value removed first

      const kept = [];
      for (const entry of withValue) {
        kept.push(entry.it);
      }
      // remove until fits
      while (totalCost > gold && kept.length > 0) {
        const remove = withValue.shift();
        if (!remove) break;
        const idx = kept.findIndex((k) => k.id === remove.it.id);
        if (idx !== -1) {
          kept.splice(idx, 1);
          totalCost -= remove.it.price;
        }
      }

      const keptBySlot = new Map(kept.map((it) => [it.slot, it]));
      const keptSorted = [...keptBySlot.entries()]
        .sort((a, b) => sortSlots(a[0], b[0]))
        .map(([, it]) => it);

      return keptSorted;
    }

    return picked;
  }

  function runDemoOptimizerTests() {
    if (!config.USE_DEMO_DATA || !config.RUN_DEMO_TESTS) return;
    const baseItems = Array.isArray(config.DEMO_ITEMS) ? config.DEMO_ITEMS : [];
    const items = baseItems.map(normalizeItem).filter(Boolean);

    function assert(condition, message) {
      if (!condition) {
        throw new Error(message || "Assertion failed");
      }
    }

    function idsOf(picked) {
      return picked.map((it) => it.id).sort();
    }

    // Case 1: level 1, zero gold → only free starter gear.
    {
      const level = 1;
      const gold = 0;
      const picked = chooseBestPerSlot({ items, level, gold });
      const ids = idsOf(picked);
      const expected = ["a_cloth", "w_wood_sword"].sort();
      assert(
        ids.length === expected.length &&
          expected.every((id) => ids.includes(id)),
        "Case 1 failed: expected only free starter gear",
      );
    }

    // Case 2: mid-level, constrained gold → drops lowest-value slot(s) to fit budget.
    {
      const level = 10;
      const gold = 500;
      const picked = chooseBestPerSlot({ items, level, gold });
      const ids = idsOf(picked);
      const expected = ["w_iron_sword", "a_chainmail", "r_copper", "b_travel", "g_padded"].sort();
      assert(
        ids.length === expected.length &&
          expected.every((id) => ids.includes(id)),
        "Case 2 failed: budget-constrained selection did not match expectation",
      );
    }

    // Case 3: high level, plenty of gold → best per slot, no need to drop any.
    {
      const level = 30;
      const gold = 10000;
      const picked = chooseBestPerSlot({ items, level, gold });
      const ids = idsOf(picked);
      const expected = [
        "w_mythril_blade",
        "a_dragonscale",
        "h_steel_helm",
        "r_sapphire",
        "am_ember",
        "b_travel",
        "g_padded",
      ].sort();
      assert(
        ids.length === expected.length &&
          expected.every((id) => ids.includes(id)),
        "Case 3 failed: unconstrained selection did not pick strongest items",
      );
    }

    // eslint-disable-next-line no-console
    console.log("SMMO Scaler: optimizer demo tests passed.");
  }

  function buildExplanation({ picked, level, gold, totalCost, totalPower }) {
    if (picked.length === 0) {
      return `No affordable items found for level ${level} within ${gold} gold.`;
    }
    return [
      `Picked best item per slot you can use (level ≤ ${level}) and afford (≤ ${gold} gold).`,
      `Total cost ${totalCost} gold, total power ${totalPower}.`,
      `Tiebreakers: higher power → better power per gold → cheaper.`,
    ].join(" ");
  }

  function renderResults({ picked, level, gold }) {
    const totalCost = picked.reduce((sum, it) => sum + it.price, 0);
    const totalPower = picked.reduce((sum, it) => sum + it.power, 0);

    el.summary.hidden = false;
    el.resultsList.hidden = false;
    el.copy.disabled = picked.length === 0;

    el.totalCost.textContent = `${formatNumber(totalCost)} gold`;
    el.totalPower.textContent = formatNumber(totalPower);
    el.slotsFilled.textContent = `${picked.length}`;

    const explanation = buildExplanation({
      picked,
      level,
      gold,
      totalCost,
      totalPower,
    });

    const cards = picked.map((it) => {
      const value = it.price > 0 ? it.power / it.price : it.power;
      const badgeText = it.price <= gold ? "Affordable" : "Over budget";
      const idText = String(it.id ?? "");
      const smmoDbUrl =
        idText && /^[0-9]+$/.test(idText)
          ? `https://smmo-db.com/items/show/${encodeURIComponent(idText)}`
          : null;
      return `
        <div class="itemCard">
          <div>
            <div class="itemTitleRow">
              <span class="slot">${escapeHtml(it.slot)}</span>
              <span class="itemName">${escapeHtml(it.name)}</span>
              <span class="badge">${badgeText}</span>
            </div>
            <div class="itemSub">
              <span class="kv"><span class="k">ID</span><span class="v">${
                smmoDbUrl
                  ? `<a href="${smmoDbUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(
                      idText,
                    )}</a>`
                  : escapeHtml(idText)
              }</span></span>
              <span class="kv"><span class="k">Min level</span><span class="v">${formatNumber(
                it.minLevel,
              )}</span></span>
              <span class="kv"><span class="k">Price</span><span class="v">${formatNumber(
                it.price,
              )}</span></span>
              <span class="kv"><span class="k">Power</span><span class="v">${formatNumber(
                it.power,
              )}</span></span>
              <span class="kv"><span class="k">Value</span><span class="v">${value.toFixed(
                3,
              )}</span></span>
            </div>
          </div>
          <div style="text-align:right;color:var(--muted);font-size:12px;">
            <div>${escapeHtml(explanation)}</div>
          </div>
        </div>
      `;
    });

    el.resultsList.innerHTML = cards.join("");
  }

  function clearResults() {
    el.summary.hidden = true;
    el.resultsList.hidden = true;
    el.resultsList.innerHTML = "";
    el.totalCost.textContent = "—";
    el.totalPower.textContent = "—";
    el.slotsFilled.textContent = "—";
    el.copy.disabled = true;
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function appendApiKey(url) {
    const key = String(config.PUBLIC_API_KEY || "");
    if (!key) return url;
    if (config.API_KEY_MODE !== "query") return url;
    const u = new URL(url, window.location.href);
    u.searchParams.set(String(config.API_KEY_QUERY_PARAM || "apiKey"), key);
    return u.toString();
  }

  function buildHeaders() {
    const headers = new Headers();
    headers.set("Accept", "application/json");
    if (config.API_KEY_MODE === "header" && config.PUBLIC_API_KEY) {
      headers.set(String(config.API_KEY_HEADER_NAME || "X-API-Key"), String(config.PUBLIC_API_KEY));
    }
    return headers;
  }

  function getApiBaseUrl() {
    const base = String(config.API_BASE_URL || "").trim();
    return base ? base.replace(/\/+$/, "") : "";
  }

  function buildApiUrl(pathOrUrl, query) {
    const base = getApiBaseUrl();
    if (!base) {
      throw new Error("API_BASE_URL is empty. Set it in config.js or enable USE_DEMO_DATA.");
    }

    const input = String(pathOrUrl || "");
    const isAbsolute = /^https?:\/\//i.test(input);
    const urlObj = isAbsolute ? new URL(input) : new URL(input.replace(/^\//, ""), `${base}/`);

    if (query && typeof query === "object") {
      for (const [k, v] of Object.entries(query)) {
        if (v === undefined || v === null) continue;
        urlObj.searchParams.set(String(k), String(v));
      }
    }

    return appendApiKey(urlObj.toString());
  }

  async function apiFetchJson(pathOrUrl, { query } = {}) {
    const url = buildApiUrl(pathOrUrl, query);

    const res = await fetch(url, { headers: buildHeaders() });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`API error ${res.status}: ${text || res.statusText}`);
    }

    // Some APIs return empty bodies on 204, etc.
    if (res.status === 204) return null;

    const contentType = res.headers.get("content-type") || "";
    if (!contentType.toLowerCase().includes("application/json")) {
      const text = await res.text().catch(() => "");
      // Try to be helpful if the API returns JSON with missing header.
      try {
        return text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`Expected JSON response but got: ${contentType || "unknown content-type"}`);
      }
    }

    return await res.json();
  }

  function coerceArrayFromApi(json) {
    if (Array.isArray(json)) return json;
    if (Array.isArray(json?.items)) return json.items;
    if (Array.isArray(json?.data)) return json.data;
    if (Array.isArray(json?.results)) return json.results;
    return [];
  }

  async function mapWithConcurrency(inputs, limit, fn) {
    const items = Array.isArray(inputs) ? inputs : [];
    const n = Math.max(1, Number(limit) || 1);
    const results = new Array(items.length);
    let nextIndex = 0;

    async function worker() {
      while (nextIndex < items.length) {
        const idx = nextIndex++;
        results[idx] = await fn(items[idx], idx);
      }
    }

    const workers = Array.from({ length: Math.min(n, items.length) }, () => worker());
    await Promise.all(workers);
    return results;
  }

  function buildItemByIdPath(id) {
    const rawId = String(id);
    const encodedId = encodeURIComponent(rawId);

    const template =
      String(config.ITEM_BY_ID_ENDPOINT || "").trim() ||
      String(config.ITEM_DETAIL_ENDPOINT || "").trim() ||
      "";

    if (template) {
      if (template.includes("{id}")) return template.replaceAll("{id}", encodedId);
      // Common patterns: "/items/:id" or "/items/<id>"
      if (template.includes(":id")) return template.replaceAll(":id", encodedId);
      return `${template.replace(/\/+$/, "")}/${encodedId}`;
    }

    // Fallback: treat ITEMS_ENDPOINT as the collection base.
    const baseEndpoint = String(config.ITEMS_ENDPOINT || "/items");
    return `${baseEndpoint.replace(/\/+$/, "")}/${encodedId}`;
  }

  async function fetchItemDetailsByIds(ids) {
    const list = Array.isArray(ids) ? ids : [];
    const unique = [...new Set(list.map((x) => String(x)).filter(Boolean))];

    if (unique.length === 0) return [];

    if (config.USE_DEMO_DATA) {
      const demo = Array.isArray(config.DEMO_ITEMS) ? config.DEMO_ITEMS : [];
      const wanted = new Set(unique);
      return demo
        .filter((it) => wanted.has(String(it?.id)))
        .map(normalizeItem)
        .filter(Boolean);
    }

    // Prefer a batch endpoint if the user configures one.
    const batchEndpoint = String(config.ITEMS_BY_IDS_ENDPOINT || "").trim();
    if (batchEndpoint) {
      const param = String(config.ITEM_IDS_QUERY_PARAM || "ids");
      const json = await apiFetchJson(batchEndpoint, { query: { [param]: unique.join(",") } });
      return coerceArrayFromApi(json).map(normalizeItem).filter(Boolean);
    }

    // Otherwise fall back to per-ID fetch.
    const concurrency = Number(config.FETCH_CONCURRENCY) || 8;
    const raw = await mapWithConcurrency(unique, concurrency, async (id) => {
      const path = buildItemByIdPath(id);
      return await apiFetchJson(path);
    });

    return raw.map(normalizeItem).filter(Boolean);
  }

  async function fetchItemsForLevel(level) {
    if (config.USE_DEMO_DATA) {
      const demo = Array.isArray(config.DEMO_ITEMS) ? config.DEMO_ITEMS : [];
      return demo.map(normalizeItem).filter(Boolean);
    }

    const strategy = String(config.FETCH_STRATEGY || "itemsEndpoint");

    if (strategy === "none") {
      throw new Error("FETCH_STRATEGY is 'none'. Configure a strategy or enable USE_DEMO_DATA.");
    }

    if (strategy === "idsFromConfig") {
      const ids = Array.isArray(config.ITEM_IDS) ? config.ITEM_IDS : [];
      if (!ids.length) {
        throw new Error("ITEM_IDS is empty. Add one or more item IDs in config.js or enable USE_DEMO_DATA.");
      }
      return await fetchItemDetailsByIds(ids);
    }

    if (strategy !== "itemsEndpoint") {
      throw new Error(`Unsupported FETCH_STRATEGY: ${String(strategy)}`);
    }

    const endpoint = String(config.ITEMS_ENDPOINT || "/items");
    const json = await apiFetchJson(endpoint, { query: { level } });
    const arr = coerceArrayFromApi(json);

    // If the endpoint returns full items, normalize them.
    const normalized = arr.map(normalizeItem).filter(Boolean);
    if (normalized.length > 0) return normalized;

    // If the endpoint returns IDs/codes, fetch details by ID.
    const ids = arr
      .filter((x) => typeof x === "string" || typeof x === "number")
      .map((x) => String(x))
      .filter(Boolean);

    if (ids.length > 0) {
      return await fetchItemDetailsByIds(ids);
    }

    return [];
  }

  async function runOptimizer({ level, gold }) {
    clearError();
    clearResults();
    setLoading(true);
    setStatus("Loading items…");

    try {
      const items = await fetchItemsForLevel(level);
      setStatus(`Loaded ${formatNumber(items.length)} items. Optimizing…`);

      const picked = chooseBestPerSlot({ items, level, gold });
      setStatus(`Done. Found ${formatNumber(picked.length)} recommended item(s).`);
      renderResults({ picked, level, gold });

      return { items, picked };
    } finally {
      setLoading(false);
    }
  }

  function parseInputs() {
    const level = Number(el.level.value);
    const gold = Number(el.gold.value);
    if (!Number.isFinite(level) || level < 1) {
      throw new Error("Level must be a positive number.");
    }
    if (!Number.isFinite(gold) || gold < 0) {
      throw new Error("Gold must be 0 or a positive number.");
    }
    return { level: Math.floor(level), gold: Math.floor(gold) };
  }

  function updateConfigStatus() {
    const demo = Boolean(config.USE_DEMO_DATA);
    const hasBase = Boolean(config.API_BASE_URL);
    const hasKey = Boolean(config.PUBLIC_API_KEY);

    if (demo) {
      el.configStatus.textContent = "Config: demo data";
      return;
    }

    if (!hasBase) {
      el.configStatus.textContent = "Config: missing API base";
      return;
    }
    if (!hasKey && config.API_KEY_MODE !== "query") {
      el.configStatus.textContent = "Config: missing API key";
      return;
    }
    el.configStatus.textContent = "Config: API enabled";
  }

  function init() {
    updateConfigStatus();
    clearResults();
    clearError();
    setStatus("Ready.");

    try {
      runDemoOptimizerTests();
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("SMMO Scaler: optimizer demo tests FAILED.", err);
    }

    el.form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const { level, gold } = parseInputs();
        await runOptimizer({ level, gold });
      } catch (err) {
        setStatus("Error.");
        showError(err?.message ? String(err.message) : "Something went wrong.");
        setLoading(false);
      }
    });

    el.reset.addEventListener("click", () => {
      el.level.value = "1";
      el.gold.value = "0";
      clearError();
      clearResults();
      setStatus("Ready.");
    });

    el.copy.addEventListener("click", async () => {
      try {
        const level = Number(el.level.value) || 0;
        const gold = Number(el.gold.value) || 0;
        const text = `SMMO Scaler — level ${level}, gold ${gold}`;
        await navigator.clipboard.writeText(text);
        setStatus("Copied summary to clipboard.");
      } catch {
        setStatus("Could not copy (clipboard blocked).");
      }
    });
  }

  init();
})();

