/* SMMO Scaler config (safe to publish)
 *
 * This file is served to everyone on GitHub Pages.
 * Only put a PUBLIC / READ-ONLY API key here.
 */

(function attachConfig(globalThisObj) {
  const CONFIG = {
    // If true, the app will NOT call any API and will use DEMO_ITEMS instead.
    // Set this to false to use the real SimpleMMO API + your own item ID source.
    // Now defaulting to false so the GitHub Pages deployment uses your configured
    // public API key and real data.
    USE_DEMO_DATA: false,

    // Base URL for your game API.
    // For SimpleMMO's public API this is typically:
    //   https://api.simple-mmo.com/v1
    API_BASE_URL: "https://api.simple-mmo.com/v1",

    // Public key (read-only). Obtain this from your SimpleMMO account.
    // IMPORTANT: This must be a read-only/public-style key; do not use a key
    // that can modify data or perform privileged actions.
    // Replace the placeholder value below with your actual SimpleMMO public API key
    // when deploying to GitHub Pages.
    PUBLIC_API_KEY: "REPLACE_WITH_YOUR_SIMPLEMMO_PUBLIC_API_KEY",

    // How to fetch items. Adjust these to match your API.
    // Supported strategies in app.js:
    //   - "itemsEndpoint": call a custom endpoint that returns items or item IDs
    //   - "idsFromConfig": fetch a fixed list of item IDs defined in ITEM_IDS
    //   - "none": disabled (will throw unless USE_DEMO_DATA is true)
    //
    // For SimpleMMO specifically, there is no built-in "items by level" endpoint;
    // instead, you typically know a set of item IDs you care about and fetch
    // their details via /v1/item/info/[item_id]. For that case, use
    // FETCH_STRATEGY "idsFromConfig" and fill in ITEM_IDS below.
    FETCH_STRATEGY: "idsFromConfig",

    // If FETCH_STRATEGY === "itemsEndpoint", app.js will call:
    //   GET `${API_BASE_URL}${ITEMS_ENDPOINT}?level=<level>`
    // and expect either:
    //   - an array of fully-detailed items, or
    //   - an array of item IDs / lightweight records that can be resolved
    //     via ITEM_BY_ID_ENDPOINT (e.g. SimpleMMO's item/info/{id}).
    ITEMS_ENDPOINT: "/items",

    // If FETCH_STRATEGY === "idsFromConfig", the app will ignore ITEMS_ENDPOINT
    // and instead fetch item details for each ID in this array using
    // ITEM_BY_ID_ENDPOINT. SimpleMMO uses numeric item IDs, so you can place
    // those numbers here. Example:
    //
    //   ITEM_IDS: [1234, 5678, 9012],
    //
    // The optimizer will then use the returned minLevel/price/power values
    // to decide which items are best for a given level and gold budget.
    // Here we generate the range 1–175142 inclusive.
    ITEM_IDS: Array.from({ length: 175142 }, (_, i) => i + 1),

    // When resolving items by ID, app.js will construct the URL from
    // ITEM_BY_ID_ENDPOINT. For SimpleMMO this matches the documented endpoint:
    //   https://api.simple-mmo.com/v1/item/info/[item_id]
    // where [item_id] is replaced with the numeric or string ID.
    //
    // The "{id}" token here is replaced with the URL-encoded item ID.
    ITEM_BY_ID_ENDPOINT: "/item/info/{id}",

    // HTTP method to use for ITEM_BY_ID_ENDPOINT. SimpleMMO expects POST for
    // /v1/item/info/[item_id], so we default this to "POST".
    ITEM_BY_ID_METHOD: "POST",

    // Where/how to send the API key:
    // - "header": sends `<API_KEY_HEADER_NAME>: <key>`
    // - "query": appends `?apiKey=<key>` (or `&apiKey=` if query already exists)
    //
    // Adjust these three values to match the SimpleMMO docs for your key:
    //   - SimpleMMO typically uses the "api_key" header
    //   - Some APIs use a custom header (e.g. "X-API-Key")
    //   - Others might expect "Authorization: Bearer <token>"
    API_KEY_MODE: "header",
    API_KEY_HEADER_NAME: "api_key",
    API_KEY_QUERY_PARAM: "apiKey",

    // Optional: define slot order for nicer rendering
    SLOT_ORDER: ["weapon", "armor", "helmet", "ring", "amulet", "boots", "gloves"],

    // If true, run a small built-in test suite for the optimizer in demo mode.
    // This only logs to the console and does not affect the UI.
    RUN_DEMO_TESTS: true,

    // Demo dataset uses the internal item shape:
    // { id, name, minLevel, price, slot, power }
    DEMO_ITEMS: [
      { id: "w_wood_sword", name: "Wood Sword", minLevel: 1, price: 0, slot: "weapon", power: 2 },
      { id: "w_iron_sword", name: "Iron Sword", minLevel: 5, price: 150, slot: "weapon", power: 12 },
      { id: "w_mythril_blade", name: "Mythril Blade", minLevel: 20, price: 1400, slot: "weapon", power: 46 },

      { id: "a_cloth", name: "Cloth Armor", minLevel: 1, price: 0, slot: "armor", power: 1 },
      { id: "a_chainmail", name: "Chainmail", minLevel: 8, price: 240, slot: "armor", power: 10 },
      { id: "a_dragonscale", name: "Dragonscale", minLevel: 25, price: 2100, slot: "armor", power: 52 },

      { id: "h_leather_cap", name: "Leather Cap", minLevel: 1, price: 25, slot: "helmet", power: 2 },
      { id: "h_steel_helm", name: "Steel Helm", minLevel: 10, price: 310, slot: "helmet", power: 11 },

      { id: "r_copper", name: "Copper Ring", minLevel: 1, price: 40, slot: "ring", power: 2 },
      { id: "r_sapphire", name: "Sapphire Ring", minLevel: 15, price: 520, slot: "ring", power: 16 },

      { id: "am_ember", name: "Ember Amulet", minLevel: 12, price: 410, slot: "amulet", power: 14 },
      { id: "b_travel", name: "Traveler Boots", minLevel: 1, price: 35, slot: "boots", power: 2 },
      { id: "g_padded", name: "Padded Gloves", minLevel: 1, price: 30, slot: "gloves", power: 2 },
    ],
  };

  globalThisObj.SMMO_SCALER_CONFIG = CONFIG;
})(window);

