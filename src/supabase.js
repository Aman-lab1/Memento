// Memento — Phase 6D
// Supabase client bootstrap.
//
// This file ONLY creates a Supabase client for the browser. It does not
// implement authentication, does not assume a logged-in user, and does not
// change any existing localStorage behaviour. See src/data.js for the
// data-access layer that actually reads/writes through this client.
//
// Loaded via the Supabase UMD bundle (see the <script> tag in each HTML
// page, before this file):
//   https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js
// That bundle exposes a global `supabase` object with `.createClient()`.
// We immediately capture what we need from it and do not rely on that
// global name anywhere else, to avoid colliding with our own client below.

// ------------------------------------------------------------------------
// CONFIGURATION — fill these in with your Supabase project's values.
// ------------------------------------------------------------------------
// Only the PROJECT URL and the PUBLISHABLE ("anon") key belong here. Both
// are safe to ship in browser code — they are meant to be public and are
// useless without Row Level Security, which this project already has
// (see rls.sql). Row Level Security is what actually protects the data,
// not secrecy of these two values.
//
// NEVER put any of the following here, or anywhere in frontend code:
//   - the service_role key
//   - the database password
//   - the JWT secret
//   - any other server-only credential
//
// Find these values in the Supabase dashboard under
// Project Settings -> API -> "Project URL" and "anon public" key.
const SUPABASE_URL = "https://esoyyvppslicsxrxwhzc.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_MTGC-MJfQO1xwRYbRnTEGg_-GcW8S6r";

// ------------------------------------------------------------------------
// Client creation
// ------------------------------------------------------------------------
// Everything below is defensive on purpose: this file runs on every page
// load, including in environments where the CDN script failed to load
// (offline, ad-blocker, restrictive network) or where the two constants
// above haven't been filled in yet. In neither case should the rest of
// the app (which still runs entirely on localStorage in 6D) be affected.

const MementoSupabase = (function initMementoSupabase() {
  const isPlaceholder =
    !SUPABASE_URL ||
    !SUPABASE_ANON_KEY ||
    SUPABASE_URL.indexOf("YOUR_SUPABASE") === 0 ||
    SUPABASE_ANON_KEY.indexOf("YOUR_SUPABASE") === 0;

  if (isPlaceholder) {
    console.warn(
      "Memento: Supabase is not configured yet. Fill in SUPABASE_URL and " +
        "SUPABASE_ANON_KEY in src/supabase.js. The app continues to run " +
        "normally on localStorage until then."
    );
    return { client: null, isConfigured: false, isLoaded: false };
  }

  if (typeof window === "undefined" || typeof window.supabase === "undefined") {
    console.warn(
      "Memento: the Supabase library did not load (offline, blocked, or " +
        "the <script> tag is missing/out of order). Supabase-backed " +
        "features are unavailable this page load; localStorage is unaffected."
    );
    return { client: null, isConfigured: true, isLoaded: false };
  }

  try {
    const client = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    return { client, isConfigured: true, isLoaded: true };
  } catch (error) {
    console.warn("Memento: failed to create the Supabase client.", error);
    return { client: null, isConfigured: true, isLoaded: false };
  }
})();

// Exposed as a single namespaced global so src/data.js (and later phases)
// can use it without polluting the page with a bare `supabase` name, which
// would collide with the UMD library's own global.
window.MementoSupabase = MementoSupabase;