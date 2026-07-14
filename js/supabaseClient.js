/* ============================================================
   MitaCatalogue — js/supabaseClient.js
   Supabase client init for the Sign Wall (guestbook).

   WHY THIS IS SAFE TO COMMIT:
   The Supabase anon PUBLIC key is *designed* to ship in client JS — it
   is not a secret. The real security boundary is Row Level Security
   (RLS) on the `signs` table, defined in sql/signs_schema.sql. As long
   as RLS is enabled with the policies in that file, a stranger with this
   key can only: read approved rows, and insert rows that pass the CHECK
   constraint. They cannot update, delete, or read unapproved rows.

   DEGRADATION:
   If Fred hasn't filled in the URL/key yet (still placeholders), or the
   Supabase JS SDK failed to load from the CDN, `window.sb` stays null.
   signWall.js checks for null and renders a friendly "not configured yet"
   empty state instead of throwing — so the rest of the site keeps working
   and there are no console errors on a fresh load.
   ============================================================ */

window.SUPABASE_CONFIG = {
  // TODO(Fred): paste your Supabase project values here, then commit.
  //   url     = Settings > API > Project URL
  //   anonKey = Settings > API > Project API keys > "anon public"
  url: "yoeivsrqsjlknjmgyajq",
  anonKey: "sb_publishable_sHg5G2KowZwviHm6oWiu6A_rz1lTP9G"
};

// The initialized client, or null if not configured / SDK missing.
// signWall.js is the only consumer and null-checks before use.
window.sb = null;

(function () {
  "use strict";

  var cfg = window.SUPABASE_CONFIG || {};
  var sdk = window.supabase; // global exposed by the UMD CDN bundle

  if (!sdk || typeof sdk.createClient !== "function") {
    console.log("[signWall] Supabase SDK not loaded — guestbook disabled.");
    return;
  }
  if (!cfg.url || !cfg.anonKey) {
    console.log("[signWall] Supabase URL/key not configured — guestbook disabled.");
    return;
  }

  try {
    window.sb = sdk.createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: false } // guestbook is anonymous; no session needed
    });
  } catch (err) {
    console.log("[signWall] Supabase client init failed:", err);
  }
})();