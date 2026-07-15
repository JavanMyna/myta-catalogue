/* ============================================================
   MitaCatalogue — js/supabaseClient.js
   Supabase client init for the Sign Wall (guestbook).

   Loaded as <script type="module"> so it can import the SDK from an
   ESM CDN. It assigns the initialized client to window.sb; the classic
   script js/signWall.js reads window.sb (only inside fetchSigns(), which
   runs on the user's first panel-open — long after this deferred module
   has finished).

   WHY THIS IS SAFE TO COMMIT:
   The Supabase anon/PUBLISHABLE key is *designed* to ship in client JS
   — it is not a secret. The real security boundary is Row Level Security
   (RLS) on the `signs` table, defined in sql/signs_schema.sql. As long
   as RLS is enabled with the policies in that file, a stranger with this
   key can only: read approved rows, and insert rows that pass the CHECK
   constraint. They cannot update, delete, or read unapproved rows.

   DEGRADATION:
   If the ESM import fails (network blocked) or the URL/key are still
   placeholders, `window.sb` stays null. signWall.js null-checks before
   use and renders a "not configured yet" empty state instead of throwing
   — so the rest of the site keeps working and there are no console errors
   on a fresh load.
   ============================================================ */

window.SUPABASE_CONFIG = {
  // TODO(Fred): paste your Supabase project values here, then commit.
  //   url     = Settings > API > Project URL
  //   anonKey = Settings > API > Project API keys > "anon public"
  //             (newer projects use the "sb_publishable_..." format — that's fine)
  url: "https://yoeivsrqsjlknjmgyajq.supabase.co",
  anonKey: "sb_publishable_sHg5G2KowZwviHm6oWiu6A_rz1lTP9G"
};

window.sb = null;

try {
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm");
  const cfg = window.SUPABASE_CONFIG || {};
  if (!cfg.url || !cfg.anonKey) {
    console.log("[signWall] Supabase URL/key not configured — guestbook disabled.");
  } else {
    window.sb = createClient(cfg.url, cfg.anonKey, {
      auth: { persistSession: false } // guestbook is anonymous; no session needed
    });
  }
} catch (err) {
  console.log("[signWall] Supabase SDK import failed — guestbook disabled:", err);
}