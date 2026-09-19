// Memento — Phase 6D
// Minimal Supabase data-access layer.
//
// This is the ONLY place in the app that should ever talk to Supabase
// directly. Pages/UI code (src/app.js) should call these functions instead
// of scattering `.from(...)` calls everywhere — but as of 6D, app.js does
// NOT call any of this yet. The app still runs entirely on localStorage.
// This file exists so 6E (authentication) and later phases have a clean,
// already-wired foundation to build the real switch-over on.
//
// IMPORTANT — no fake authentication:
// Every operation below either (a) works anonymously because RLS/grants
// allow it (none currently do — see rls.sql, anon has no privileges at
// all), or (b) requires a real signed-in Supabase user. Since 6D does not
// implement authentication, every operation that needs a user will
// correctly report `error: "not-authenticated"` until 6E exists. Nothing
// here pretends a user is logged in, and nothing bypasses RLS.
//
// Return shape: every function below resolves to
//   { ok: true,  data }              on success
//   { ok: false, error, message }    on failure
// `error` is a short machine-readable code; `message` is a plain-language
// detail for logs/dev tools. Callers decide what (if anything) to show the
// user — this layer never swallows an error silently and never shows a
// raw database error to the user itself.

const MementoData = (function initMementoData() {
  function client() {
    return window.MementoSupabase && window.MementoSupabase.client;
  }

  function unavailable() {
    return {
      ok: false,
      error: "supabase-unavailable",
      message:
        "Supabase is not configured or the client library did not load. " +
        "See src/supabase.js.",
    };
  }

  function fromSupabaseError(error) {
    // Never swallowed: always logged and always returned to the caller.
    console.error("Memento data layer: Supabase error", error);
    return {
      ok: false,
      error: (error && error.code) || "supabase-error",
      message: (error && error.message) || "Unknown Supabase error.",
    };
  }

  function notAuthenticated(operation) {
    return {
      ok: false,
      error: "not-authenticated",
      message:
        `"${operation}" requires a signed-in user, which Phase 6D does ` +
        "not implement yet. This will work once Phase 6E (authentication) " +
        "exists.",
    };
  }

  function newId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    // Same fallback shape used by src/app.js's generateId(), so ids look
    // consistent if ever compared side by side during migration work.
    return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  // Resolves the current signed-in user, if any. Never throws. Used
  // internally by writes that need to stamp created_by, and safe for
  // callers to use directly once 6E exists.
  async function getCurrentUser() {
    const supa = client();
    if (!supa) return { ok: false, ...unavailable() };
    try {
      const { data, error } = await supa.auth.getUser();
      if (error) return fromSupabaseError(error);
      if (!data || !data.user) {
        return { ok: false, error: "not-authenticated", message: "No signed-in user." };
      }
      return { ok: true, data: data.user };
    } catch (error) {
      return fromSupabaseError(error);
    }
  }

  // ----------------------------------------------------------------
  // Profiles
  // ----------------------------------------------------------------

  // Get the profile row for whoever is currently signed in. Requires a
  // session because there is no other way to know which profile to fetch.
  async function getCurrentProfile() {
    const supa = client();
    if (!supa) return unavailable();

    const userResult = await getCurrentUser();
    if (!userResult.ok) return notAuthenticated("getCurrentProfile");

    try {
      const { data, error } = await supa
        .from("profiles")
        .select("id, display_name, created_at, updated_at")
        .eq("id", userResult.data.id)
        .single();
      if (error) return fromSupabaseError(error);
      return { ok: true, data };
    } catch (error) {
      return fromSupabaseError(error);
    }
  }

  // ----------------------------------------------------------------
  // Relationships (Memento's "people": one relationship row IS the
  // relationship-centered equivalent of a "person" in the current
  // localStorage prototype — see MEMENTO V1.8 product model notes)
  // ----------------------------------------------------------------

  // Lists relationships the signed-in user participates in. With no
  // session, RLS/grants correctly return zero access rather than data.
  async function listRelationships() {
    const supa = client();
    if (!supa) return unavailable();
    try {
      const { data, error } = await supa
        .from("relationships")
        .select("id, created_by, person_name, person_phone, created_at, updated_at")
        .order("created_at", { ascending: false });
      if (error) return fromSupabaseError(error);
      return { ok: true, data };
    } catch (error) {
      return fromSupabaseError(error);
    }
  }

  async function getRelationship(relationshipId) {
    const supa = client();
    if (!supa) return unavailable();
    if (!relationshipId) {
      return { ok: false, error: "invalid-argument", message: "relationshipId is required." };
    }
    try {
      const { data, error } = await supa
        .from("relationships")
        .select("id, created_by, person_name, person_phone, created_at, updated_at")
        .eq("id", relationshipId)
        .single();
      if (error) return fromSupabaseError(error);
      return { ok: true, data };
    } catch (error) {
      return fromSupabaseError(error);
    }
  }

  // { personName, personPhone } mirrors the Add Person form fields.
  async function createRelationship({ personName, personPhone } = {}) {
    const supa = client();
    if (!supa) return unavailable();
    if (!personName || !String(personName).trim()) {
      return { ok: false, error: "invalid-argument", message: "personName is required." };
    }

    const userResult = await getCurrentUser();
    if (!userResult.ok) return notAuthenticated("createRelationship");

    try {
      const { data, error } = await supa
        .from("relationships")
        .insert({
          id: newId(),
          created_by: userResult.data.id,
          person_name: personName,
          person_phone: personPhone || null,
        })
        .select("id, created_by, person_name, person_phone, created_at, updated_at")
        .single();
      if (error) return fromSupabaseError(error);
      return { ok: true, data };
    } catch (error) {
      return fromSupabaseError(error);
    }
  }

  // Only person_name / person_phone are updatable (see rls.sql column
  // grants) — created_by, id, and timestamps are immutable after insert.
  async function updateRelationship(relationshipId, { personName, personPhone } = {}) {
    const supa = client();
    if (!supa) return unavailable();
    if (!relationshipId) {
      return { ok: false, error: "invalid-argument", message: "relationshipId is required." };
    }

    const patch = {};
    if (personName !== undefined) patch.person_name = personName;
    if (personPhone !== undefined) patch.person_phone = personPhone;
    if (Object.keys(patch).length === 0) {
      return { ok: false, error: "invalid-argument", message: "Nothing to update." };
    }

    try {
      const { data, error } = await supa
        .from("relationships")
        .update(patch)
        .eq("id", relationshipId)
        .select("id, created_by, person_name, person_phone, created_at, updated_at")
        .single();
      if (error) return fromSupabaseError(error);
      return { ok: true, data };
    } catch (error) {
      return fromSupabaseError(error);
    }
  }

  // Per rls.sql, this is only permitted for the creator, and only while no
  // other registered user has joined. Any other case is correctly blocked
  // by RLS and surfaced as a normal Supabase error, not bypassed.
  async function deleteRelationship(relationshipId) {
    const supa = client();
    if (!supa) return unavailable();
    if (!relationshipId) {
      return { ok: false, error: "invalid-argument", message: "relationshipId is required." };
    }
    try {
      const { error } = await supa.from("relationships").delete().eq("id", relationshipId);
      if (error) return fromSupabaseError(error);
      return { ok: true, data: null };
    } catch (error) {
      return fromSupabaseError(error);
    }
  }

  // ----------------------------------------------------------------
  // Transactions
  // ----------------------------------------------------------------

  async function listTransactionsForRelationship(relationshipId) {
    const supa = client();
    if (!supa) return unavailable();
    if (!relationshipId) {
      return { ok: false, error: "invalid-argument", message: "relationshipId is required." };
    }
    try {
      const { data, error } = await supa
        .from("transactions")
        .select(
          "id, relationship_id, payer_side, beneficiary_side, amount, purpose, created_by, created_at, updated_at"
        )
        .eq("relationship_id", relationshipId)
        .order("created_at", { ascending: true });
      if (error) return fromSupabaseError(error);
      return { ok: true, data };
    } catch (error) {
      return fromSupabaseError(error);
    }
  }

  // payerSide / beneficiarySide must be 'user' or 'person' (schema.sql
  // constraint) and must differ from each other.
  async function createTransaction({
    relationshipId,
    payerSide,
    beneficiarySide,
    amount,
    purpose,
  } = {}) {
    const supa = client();
    if (!supa) return unavailable();
    if (!relationshipId || !payerSide || !beneficiarySide || !Number.isFinite(amount)) {
      return {
        ok: false,
        error: "invalid-argument",
        message: "relationshipId, payerSide, beneficiarySide, and a numeric amount are required.",
      };
    }

    const userResult = await getCurrentUser();
    if (!userResult.ok) return notAuthenticated("createTransaction");

    try {
      const { data, error } = await supa
        .from("transactions")
        .insert({
          id: newId(),
          relationship_id: relationshipId,
          payer_side: payerSide,
          beneficiary_side: beneficiarySide,
          amount,
          purpose: purpose || null,
          created_by: userResult.data.id,
        })
        .select(
          "id, relationship_id, payer_side, beneficiary_side, amount, purpose, created_by, created_at, updated_at"
        )
        .single();
      if (error) return fromSupabaseError(error);
      return { ok: true, data };
    } catch (error) {
      return fromSupabaseError(error);
    }
  }

  // Only payer_side, beneficiary_side, amount, purpose are updatable.
  async function updateTransaction(
    transactionId,
    { payerSide, beneficiarySide, amount, purpose } = {}
  ) {
    const supa = client();
    if (!supa) return unavailable();
    if (!transactionId) {
      return { ok: false, error: "invalid-argument", message: "transactionId is required." };
    }

    const patch = {};
    if (payerSide !== undefined) patch.payer_side = payerSide;
    if (beneficiarySide !== undefined) patch.beneficiary_side = beneficiarySide;
    if (amount !== undefined) patch.amount = amount;
    if (purpose !== undefined) patch.purpose = purpose;
    if (Object.keys(patch).length === 0) {
      return { ok: false, error: "invalid-argument", message: "Nothing to update." };
    }

    try {
      const { data, error } = await supa
        .from("transactions")
        .update(patch)
        .eq("id", transactionId)
        .select(
          "id, relationship_id, payer_side, beneficiary_side, amount, purpose, created_by, created_at, updated_at"
        )
        .single();
      if (error) return fromSupabaseError(error);
      return { ok: true, data };
    } catch (error) {
      return fromSupabaseError(error);
    }
  }

  async function deleteTransaction(transactionId) {
    const supa = client();
    if (!supa) return unavailable();
    if (!transactionId) {
      return { ok: false, error: "invalid-argument", message: "transactionId is required." };
    }
    try {
      const { error } = await supa.from("transactions").delete().eq("id", transactionId);
      if (error) return fromSupabaseError(error);
      return { ok: true, data: null };
    } catch (error) {
      return fromSupabaseError(error);
    }
  }

  // ----------------------------------------------------------------
  // Settlements (append-only: no update/delete, matching rls.sql —
  // financial events stay auditable)
  // ----------------------------------------------------------------

  async function listSettlementsForRelationship(relationshipId) {
    const supa = client();
    if (!supa) return unavailable();
    if (!relationshipId) {
      return { ok: false, error: "invalid-argument", message: "relationshipId is required." };
    }
    try {
      const { data, error } = await supa
        .from("settlements")
        .select(
          "id, relationship_id, payer_side, beneficiary_side, amount, method, closes_period, created_by, created_at"
        )
        .eq("relationship_id", relationshipId)
        .order("created_at", { ascending: true });
      if (error) return fromSupabaseError(error);
      return { ok: true, data };
    } catch (error) {
      return fromSupabaseError(error);
    }
  }

  // method must be 'cash' or 'online' (schema.sql constraint).
  async function createSettlement({
    relationshipId,
    payerSide,
    beneficiarySide,
    amount,
    method,
    closesPeriod,
  } = {}) {
    const supa = client();
    if (!supa) return unavailable();
    if (!relationshipId || !payerSide || !beneficiarySide || !Number.isFinite(amount) || !method) {
      return {
        ok: false,
        error: "invalid-argument",
        message:
          "relationshipId, payerSide, beneficiarySide, a numeric amount, and method are required.",
      };
    }

    const userResult = await getCurrentUser();
    if (!userResult.ok) return notAuthenticated("createSettlement");

    try {
      const { data, error } = await supa
        .from("settlements")
        .insert({
          id: newId(),
          relationship_id: relationshipId,
          payer_side: payerSide,
          beneficiary_side: beneficiarySide,
          amount,
          method,
          closes_period: Boolean(closesPeriod),
          created_by: userResult.data.id,
        })
        .select(
          "id, relationship_id, payer_side, beneficiary_side, amount, method, closes_period, created_by, created_at"
        )
        .single();
      if (error) return fromSupabaseError(error);
      return { ok: true, data };
    } catch (error) {
      return fromSupabaseError(error);
    }
  }

  return {
    getCurrentUser,
    getCurrentProfile,
    listRelationships,
    getRelationship,
    createRelationship,
    updateRelationship,
    deleteRelationship,
    listTransactionsForRelationship,
    createTransaction,
    updateTransaction,
    deleteTransaction,
    listSettlementsForRelationship,
    createSettlement,
  };
})();

window.MementoData = MementoData;

// Test hook — mirrors the guard at the bottom of src/app.js, and is
// likewise a no-op in the browser.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { MementoData };
}