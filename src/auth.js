// Memento — Phase 6E
// Authentication: Supabase Auth is the single source of truth for "is
// someone logged in". This file never invents a parallel session system,
// and localStorage is never treated as proof of authentication (it stays
// exactly what it was in 6D: local prototype data, unrelated to identity).
//
// Loaded on every page (after src/supabase.js and src/data.js, before
// src/app.js where app.js is present at all — see the <script> tags in
// each HTML file). On load it:
//   1. Wires the login/signup forms if this page has them (auth.html).
//   2. Runs the gate: redirects signed-out visitors to auth.html, and
//      redirects already-signed-in visitors away from auth.html.

const MementoAuth = (function initMementoAuth() {
  const AUTH_PAGE = "auth.html";
  const HOME_PAGE = "index.html";

  function client() {
    return window.MementoSupabase && window.MementoSupabase.client;
  }

  // Mirrors the base-path detection already used by registerServiceWorker()
  // in src/app.js, so both agree on where the app is actually hosted:
  // "/" for local dev, "/<repo>/" on GitHub Pages. Kept independent (not
  // imported from app.js) since app.js isn't loaded on auth.html.
  function appBasePath() {
    const segments = window.location.pathname.split("/").filter(Boolean);
    return window.location.hostname.endsWith(".github.io") && segments.length > 0
      ? `/${segments[0]}/`
      : "/";
  }

  function authPageUrl() {
    return `${window.location.origin}${appBasePath()}${AUTH_PAGE}`;
  }

  function homePageUrl() {
    return `${window.location.origin}${appBasePath()}${HOME_PAGE}`;
  }

  function isAuthPage() {
    return window.location.pathname.endsWith(AUTH_PAGE);
  }

  // ----------------------------------------------------------------
  // Session
  // ----------------------------------------------------------------

  async function getSession() {
    const supa = client();
    if (!supa) return null;
    try {
      const { data, error } = await supa.auth.getSession();
      if (error) {
        console.error("Memento auth: failed to read session", error);
        return null;
      }
      return (data && data.session) || null;
    } catch (error) {
      console.error("Memento auth: failed to read session", error);
      return null;
    }
  }

  // ----------------------------------------------------------------
  // Error messages — never expose raw Supabase/Postgres internals to the
  // person using the app; log the original for debugging instead.
  // ----------------------------------------------------------------

  function mapAuthError(error) {
    if (!error) return "Something went wrong. Please try again.";
    const msg = (error.message || "").toLowerCase();
    if (msg.includes("invalid login credentials")) {
      return "Incorrect email or password.";
    }
    if (msg.includes("already registered") || msg.includes("already exists")) {
      return "An account with this email already exists. Try logging in instead.";
    }
    if (msg.includes("password") && (msg.includes("6 characters") || msg.includes("at least"))) {
      return "Password is too short — use at least 6 characters.";
    }
    if (msg.includes("email not confirmed")) {
      return "Please confirm your email before logging in.";
    }
    if (msg.includes("rate limit")) {
      return "Too many attempts. Please wait a moment and try again.";
    }
    if (msg.includes("failed to fetch") || msg.includes("network")) {
      return "Network error. Check your connection and try again.";
    }
    // Fall back to Supabase's own message rather than a generic one — auth
    // errors are already written for end users, unlike raw Postgres errors.
    return error.message || "Something went wrong. Please try again.";
  }

  // ----------------------------------------------------------------
  // Sign up
  // ----------------------------------------------------------------
  // Whether email confirmation is required is NOT assumed here — it is
  // read from the real signUp() response for this project, every time
  // (data.session present => confirmation is off and we're already signed
  // in; data.session absent => confirmation is required). This adapts
  // automatically to whatever the Supabase Dashboard is actually
  // configured to do, rather than hardcoding a guess.
  async function signUp({ displayName, email, password }) {
    const supa = client();
    if (!supa) {
      return { ok: false, error: "supabase-unavailable", message: "Supabase is not configured." };
    }

    const name = (displayName || "").trim();
    const mail = (email || "").trim();
    if (!name) return { ok: false, error: "invalid-argument", message: "Enter a display name." };
    if (!mail) return { ok: false, error: "invalid-argument", message: "Enter an email address." };
    if (!password) return { ok: false, error: "invalid-argument", message: "Enter a password." };

    try {
      const { data, error } = await supa.auth.signUp({
        email: mail,
        password,
        options: {
          // Stored on auth.users regardless of confirmation status, so it
          // survives even when we can't create the profiles row yet (see
          // ensureProfile() below) — read back later without needing any
          // extra staging storage.
          data: { display_name: name },
          emailRedirectTo: authPageUrl(),
        },
      });

      if (error) {
        console.error("Memento auth: sign up failed", error);
        return { ok: false, error: error.code || "auth-error", message: mapAuthError(error) };
      }

      const confirmationRequired = !data.session;

      if (!confirmationRequired) {
        // We already have a session — create the profile row now rather
        // than waiting, since profiles_insert_own requires auth.uid(),
        // which we have.
        await ensureProfile();
      }

      return { ok: true, data: { confirmationRequired, user: data.user } };
    } catch (error) {
      console.error("Memento auth: sign up threw", error);
      return { ok: false, error: "auth-error", message: mapAuthError(error) };
    }
  }

  // ----------------------------------------------------------------
  // Log in
  // ----------------------------------------------------------------
  async function logIn({ email, password }) {
    const supa = client();
    if (!supa) {
      return { ok: false, error: "supabase-unavailable", message: "Supabase is not configured." };
    }

    const mail = (email || "").trim();
    if (!mail || !password) {
      return { ok: false, error: "invalid-argument", message: "Enter your email and password." };
    }

    try {
      const { data, error } = await supa.auth.signInWithPassword({ email: mail, password });
      if (error) {
        console.error("Memento auth: login failed", error);
        return { ok: false, error: error.code || "auth-error", message: mapAuthError(error) };
      }

      // Covers the case where this is the first login after confirming an
      // email — signUp() could not create the profile back then because no
      // session existed at that moment.
      await ensureProfile();

      return { ok: true, data: { user: data.user } };
    } catch (error) {
      console.error("Memento auth: login threw", error);
      return { ok: false, error: "auth-error", message: mapAuthError(error) };
    }
  }

  // ----------------------------------------------------------------
  // Log out
  // ----------------------------------------------------------------
  async function logOut() {
    const supa = client();
    if (!supa) return { ok: false, error: "supabase-unavailable" };
    try {
      const { error } = await supa.auth.signOut();
      if (error) {
        console.error("Memento auth: logout failed", error);
        return { ok: false, error: error.code || "auth-error", message: mapAuthError(error) };
      }
      return { ok: true };
    } catch (error) {
      console.error("Memento auth: logout threw", error);
      return { ok: false, error: "auth-error", message: mapAuthError(error) };
    }
  }

  // ----------------------------------------------------------------
  // Profile bootstrap — idempotent. Never overwrites an existing profile,
  // never creates one for anyone but auth.uid() (createProfile() in
  // src/data.js only ever inserts { id: auth.uid(), ... } and RLS enforces
  // the same thing server-side regardless).
  // ----------------------------------------------------------------
  async function ensureProfile() {
    if (!window.MementoData) return { ok: false, error: "data-layer-unavailable" };

    const existing = await window.MementoData.getCurrentProfile();
    if (existing.ok) return existing;

    const userResult = await window.MementoData.getCurrentUser();
    if (!userResult.ok) return userResult;

    const metadataName = userResult.data.user_metadata && userResult.data.user_metadata.display_name;
    const fallbackName = metadataName || (userResult.data.email ? userResult.data.email.split("@")[0] : "Memento user");

    return window.MementoData.createProfile({ displayName: fallbackName });
  }

  // ----------------------------------------------------------------
  // Page gate — decides whether the current page may be shown at all.
  // Run once per page load, before anything else touches the page.
  // ----------------------------------------------------------------
  async function gate() {
    const session = await getSession();

    if (!session) {
      if (!isAuthPage()) {
        window.location.href = authPageUrl();
        return { authenticated: false, redirecting: true };
      }
      return { authenticated: false };
    }

    if (isAuthPage()) {
      window.location.href = homePageUrl();
      return { authenticated: true, redirecting: true };
    }

    await ensureProfile();
    wireLogoutButton();
    applyGreeting();
    return { authenticated: true, session };
  }

  // ----------------------------------------------------------------
  // Minimal DOM wiring — every function below is a no-op on pages that
  // don't have the markup it looks for, same pattern as src/app.js's
  // setupXxxPage() functions.
  // ----------------------------------------------------------------

  function wireLogoutButton() {
    const button = document.querySelector("[data-logout-button]");
    if (!button || button.dataset.wired === "true") return;
    button.dataset.wired = "true";
    button.addEventListener("click", async () => {
      button.disabled = true;
      await logOut();
      window.location.href = authPageUrl();
    });
  }

  // Home-page-only, and only touches the greeting's text content — no
  // markup, layout, or styling changes. Requires the exact
  // [data-greeting-title] hook (added only to index.html) so this can
  // never accidentally rewrite a different page's heading.
  async function applyGreeting() {
    const titleEl = document.querySelector("[data-greeting-title]");
    if (!titleEl) return;

    const profileResult = await window.MementoData.getCurrentProfile();
    if (!profileResult.ok || !profileResult.data || !profileResult.data.display_name) return;

    titleEl.textContent = `Welcome back, ${profileResult.data.display_name}`;
  }

  function setupAuthPage() {
    const loginForm = document.querySelector("[data-login-form]");
    const signupForm = document.querySelector("[data-signup-form]");
    if (!loginForm && !signupForm) return; // Not auth.html.

    const errorEl = document.querySelector("[data-auth-error]");
    const infoEl = document.querySelector("[data-auth-info]");
    const titleEl = document.querySelector("[data-auth-title]");

    function clearMessages() {
      if (errorEl) errorEl.hidden = true;
      if (infoEl) infoEl.hidden = true;
    }
    function showError(message) {
      if (infoEl) infoEl.hidden = true;
      if (!errorEl) return;
      errorEl.textContent = message;
      errorEl.hidden = false;
    }
    function showInfo(message) {
      if (errorEl) errorEl.hidden = true;
      if (!infoEl) return;
      infoEl.textContent = message;
      infoEl.hidden = false;
    }
    function showLogin() {
      clearMessages();
      if (loginForm) loginForm.hidden = false;
      if (signupForm) signupForm.hidden = true;
      if (titleEl) titleEl.textContent = "Log in to Memento";
    }
    function showSignup() {
      clearMessages();
      if (loginForm) loginForm.hidden = true;
      if (signupForm) signupForm.hidden = false;
      if (titleEl) titleEl.textContent = "Create your Memento account";
    }

    const showSignupBtn = document.querySelector("[data-show-signup]");
    const showLoginBtn = document.querySelector("[data-show-login]");
    if (showSignupBtn) showSignupBtn.addEventListener("click", showSignup);
    if (showLoginBtn) showLoginBtn.addEventListener("click", showLogin);

    if (loginForm) {
      loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        clearMessages();
        const email = loginForm.querySelector("#login-email").value;
        const password = loginForm.querySelector("#login-password").value;
        const submitBtn = loginForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        const result = await logIn({ email, password });
        submitBtn.disabled = false;
        if (!result.ok) {
          showError(result.message);
          return;
        }
        window.location.href = homePageUrl();
      });
    }

    if (signupForm) {
      signupForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        clearMessages();
        const name = signupForm.querySelector("#signup-name").value.trim();
        const email = signupForm.querySelector("#signup-email").value.trim();
        const password = signupForm.querySelector("#signup-password").value;
        const confirmPassword = signupForm.querySelector("#signup-confirm-password").value;

        if (!name) return showError("Enter a display name.");
        if (!email) return showError("Enter an email address.");
        if (!password) return showError("Enter a password.");
        if (password !== confirmPassword) return showError("Passwords do not match.");

        const submitBtn = signupForm.querySelector('button[type="submit"]');
        submitBtn.disabled = true;
        const result = await signUp({ displayName: name, email, password });
        submitBtn.disabled = false;

        if (!result.ok) {
          showError(result.message);
          return;
        }

        if (result.data.confirmationRequired) {
          signupForm.reset();
          showLogin();
          showInfo("Check your email to confirm your account, then log in.");
        } else {
          window.location.href = homePageUrl();
        }
      });
    }
  }

  return {
    getSession,
    signUp,
    logIn,
    logOut,
    ensureProfile,
    gate,
    setupAuthPage,
    authPageUrl,
    homePageUrl,
    mapAuthError,
  };
})();

window.MementoAuth = MementoAuth;

document.addEventListener("DOMContentLoaded", () => {
  // Wiring the auth forms never depends on session state, so it runs
  // unconditionally and immediately; the gate (which may redirect) runs
  // right after.
  MementoAuth.setupAuthPage();
  MementoAuth.gate();
});

// Test hook — mirrors the guard at the bottom of src/app.js and src/data.js.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { MementoAuth };
}