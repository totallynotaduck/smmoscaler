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
    // Supported strategies in app.js: "itemsEndpoint" or "none"
    FETCH_STRATEGY: "itemsEndpoint",

    // If FETCH_STRATEGY === "itemsEndpoint", app.js will call:
    //   GET `${API_BASE_URL}${ITEMS_ENDPOINT}?level=<level>`
    // and expect either:
    //   - an array of fully-detailed items, or
    //   - an array of item IDs / lightweight records that can be resolved
    //     via ITEM_BY_ID_ENDPOINT (e.g. SimpleMMO's item/info/{id}).
    ITEMS_ENDPOINT: "/items",

    // When resolving items by ID, app.js will construct the URL from
    // ITEM_BY_ID_ENDPOINT. For SimpleMMO this matches the documented endpoint:
    //   https://api.simple-mmo.com/v1/item/info/[item_id]
    // where [item_id] is replaced with the numeric or string ID.
    //
    // The "{id}" token here is replaced with the URL-encoded item ID.
    ITEM_BY_ID_ENDPOINT: "/item/info/{id}",

    // Where/how to send the API key:
    // - "header": sends `<API_KEY_HEADER_NAME>: <key>`
    // - "query": appends `?apiKey=<key>` (or `&apiKey=` if query already exists)
    //
    // Adjust these three values to match the SimpleMMO docs for your key:
    //   - Some APIs use a custom header (e.g. "X-API-Key")
    //   - Others might expect "Authorization: Bearer <token>"
    API_KEY_MODE: "header",
    API_KEY_HEADER_NAME: "X-API-Key",
    API_KEY_QUERY_PARAM: "apiKey",

    // Optional: define slot order for nicer rendering
    SLOT_ORDER: ["weapon", "armor", "helmet", "ring", "amulet", "boots", "gloves"],

    // If true, run a small built-in test suite for the optimizer in demo mode.
    // This only logs to the console and does not affect the UI.
    RUN_DEMO_TESTS: true,

    // Demo dataset uses the internal item shape:
    // { id, name, minLevel, price, slot, power }
   
  };

  globalThisObj.SMMO_SCALER_CONFIG = CONFIG;
})(window);

