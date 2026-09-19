// Memento — Phase 2C
// Connects Home, Add Person, Person, and History into one local prototype
// using a single shared source of truth in localStorage.
//
// This is temporary prototype storage only — not the final Memento
// persistence architecture. No backend, no Supabase, no auth.

const STORAGE_KEYS = {
  people: "memento:people",
  transactions: "memento:transactions",
  settlements: "memento:settlements",
};

// Payment methods a settlement may currently use. Kept as a single source
// of truth so validation and (later) UI can both reference it.
const SETTLEMENT_METHODS = ["cash", "online"];

// Register the service worker on every page. GitHub Pages hosts this app
// under /Memento/ while local development uses /. The base is detected
// automatically so both environments work without changing product logic.
registerServiceWorker();

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  const segments = window.location.pathname.split("/").filter(Boolean);
  const appBase =
    window.location.hostname.endsWith(".github.io") && segments.length > 0
      ? `/${segments[0]}/`
      : "/";

  navigator.serviceWorker.register(`${appBase}sw.js`).catch((error) => {
    console.warn("Memento service worker registration failed:", error);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  setupAddPersonForm();
  setupHomePage();
  setupPersonPage();
  setupHistoryPage();
});

// ========================================================================
// Shared storage (single source of truth for all pages)
// ========================================================================

function loadPeople() {
  return readJson(STORAGE_KEYS.people, []);
}

function savePeople(people) {
  writeJson(STORAGE_KEYS.people, people);
}

function loadTransactions() {
  return readJson(STORAGE_KEYS.transactions, []);
}

function saveTransactions(transactions) {
  writeJson(STORAGE_KEYS.transactions, transactions);
}

// Settlements are stored completely separately from transactions. A
// settlement never modifies, replaces, or removes a transaction — it is
// simply additional history that the balance is derived from, same as
// transactions are. See calculateBalance() below.
function loadSettlements() {
  return readJson(STORAGE_KEYS.settlements, []);
}

function saveSettlements(settlements) {
  writeJson(STORAGE_KEYS.settlements, settlements);
}

function getSettlementsForPerson(personId) {
  return loadSettlements().filter((settlement) => settlement.personId === personId);
}

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (error) {
    // Corrupted or unavailable storage — fall back to empty, never fake data.
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    // Storage unavailable (e.g. private mode). Prototype state just won't
    // persist across pages in that case — no crash, no fake fallback data.
  }
}

function generateId() {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return window.crypto.randomUUID();
  }
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getMonotonicTimestamp() {
  const now = Date.now();
  const txs = loadTransactions();
  const sets = loadSettlements();
  let maxTime = 0;
  for (let i = 0; i < txs.length; i++) {
    const t = new Date(txs[i].timestamp).getTime();
    if (t > maxTime) maxTime = t;
  }
  for (let i = 0; i < sets.length; i++) {
    const t = new Date(sets[i].timestamp).getTime();
    if (t > maxTime) maxTime = t;
  }
  const timestampMs = Math.max(now, maxTime + 1);
  return new Date(timestampMs).toISOString();
}

function findPersonById(id) {
  return loadPeople().find((person) => person.id === id) || null;
}

function getTransactionsForPerson(personId) {
  return loadTransactions().filter((tx) => tx.personId === personId);
}

function isPeriodClosingSettlement(settlement) {
  if (!settlement) return false;
  // Explicit closesPeriod boolean takes precedence.
  // Legacy settlements without closesPeriod default to true to preserve
  // backward compatibility with the existing prototype's full-settlement records.
  return settlement.closesPeriod !== undefined
    ? Boolean(settlement.closesPeriod)
    : true;
}

function getLatestFullSettlement(settlements) {
  if (!settlements || settlements.length === 0) {
    return null;
  }
  let latest = null;
  let maxTime = -1;
  for (let i = 0; i < settlements.length; i++) {
    const s = settlements[i];
    if (isPeriodClosingSettlement(s)) {
      const time = new Date(s.timestamp).getTime();
      if (time > maxTime) {
        maxTime = time;
        latest = s;
      }
    }
  }
  return latest;
}

function getCurrentTransactionsForPerson(personId) {
  const transactions = getTransactionsForPerson(personId);
  const settlements = getSettlementsForPerson(personId);

  const latestFullSettlement = getLatestFullSettlement(settlements);
  if (!latestFullSettlement) {
    return transactions;
  }

  const boundaryTime = new Date(latestFullSettlement.timestamp).getTime();
  return transactions.filter(
    (tx) => new Date(tx.timestamp).getTime() > boundaryTime
  );
}

// Returns the partial (non-period-closing) settlements that belong to the
// current open period for `personId`. These are shown in the Person-page
// timeline alongside the current-period transactions so the user can see
// what reduced the balance without having to visit Main History.
//
// Rule:
//   - A settlement with closesPeriod === false is current-period.
//   - A settlement with closesPeriod === true closes the period.
//     It is NOT returned here — after the period closes the Person page
//     starts fresh and the closing settlement is only visible in History.
//   - Legacy settlements (no closesPeriod field) are treated as closing
//     the period (same as isPeriodClosingSettlement) so they are excluded.
function getCurrentSettlementsForPerson(personId) {
  const settlements = getSettlementsForPerson(personId);
  const latestFullSettlement = getLatestFullSettlement(settlements);

  // Boundary: only settlements strictly after the last closing settlement.
  const boundaryTime = latestFullSettlement
    ? new Date(latestFullSettlement.timestamp).getTime()
    : -Infinity;

  return settlements.filter((s) => {
    // Must be strictly after the boundary.
    if (new Date(s.timestamp).getTime() <= boundaryTime) return false;
    // Must not itself close the period.
    return !isPeriodClosingSettlement(s);
  });
}

// ========================================================================
// Balance calculation — derived from current period (post-settlement).
// Positive net  -> the other person owes you.
// Negative net  -> you owe the other person.
// Zero          -> settled.
// ========================================================================

function calculateBalance(transactions, settlements = []) {
  const netOf = (entries) =>
    entries.reduce((net, entry) => {
      return entry.payer === "you" ? net + entry.amount : net - entry.amount;
    }, 0);

  if (!settlements || settlements.length === 0) {
    return netOf(transactions);
  }

  const latestFullSettlement = getLatestFullSettlement(settlements);
  if (!latestFullSettlement) {
    return netOf(transactions) + netOf(settlements);
  }

  const boundaryTime = new Date(latestFullSettlement.timestamp).getTime();
  const currentTransactions = transactions.filter(
    (tx) => new Date(tx.timestamp).getTime() > boundaryTime
  );
  const currentSettlements = settlements.filter(
    (s) => new Date(s.timestamp).getTime() > boundaryTime
  );

  return netOf(currentTransactions) + netOf(currentSettlements);
}

function balanceLabel(net) {
  if (net === 0) return "Settled";
  if (net > 0) return `Owes you ₹${formatAmount(net)}`;
  return `You owe ₹${formatAmount(Math.abs(net))}`;
}

// ========================================================================
// Settlement Engine (Milestone 5A)
//
// A transaction answers "why is money owed"; a settlement answers "how was
// money owed cleared". Settlements live in their own storage collection
// (memento:settlements) and never touch the transactions array. The engine
// below is the only place settlements are created or validated — the
// future settlement UI (5B) should call createSettlement() rather than
// writing to storage directly.
// ========================================================================

// Given the current relationship balance, determine who must pay whom to
// move toward zero. Returns null when there is nothing to settle.
function getSettlementDirection(balance) {
  if (balance > 0) return { payer: "person", beneficiary: "you" };
  if (balance < 0) return { payer: "you", beneficiary: "person" };
  return null;
}

// The outstanding amount is simply the unsigned size of the balance — the
// most a settlement is allowed to clear in one go.
function getOutstandingAmount(balance) {
  return Math.abs(balance);
}

// Amount validation shared by the settlement engine. Mirrors the existing
// transaction amount rule (finite, positive) and additionally enforces the
// "cannot exceed what's outstanding" rule from the settlement spec.
function isValidSettlementAmount(amount, outstanding) {
  return (
    Number.isFinite(amount) &&
    amount > 0 &&
    Number.isFinite(outstanding) &&
    amount <= outstanding
  );
}

function isValidSettlementMethod(method) {
  return SETTLEMENT_METHODS.includes(method);
}

// Creates and persists a settlement for `personId`, deriving its direction
// from the current balance (transactions + existing settlements). Returns
// `{ ok: true, settlement }` on success or `{ ok: false, error }` when the
// requested settlement is invalid — callers (the future UI) should surface
// `error` to the person rather than assuming success.
//
// Recognised error codes:
//   "nothing-to-settle"   balance is already zero
//   "invalid-amount"      amount is not a finite positive number
//   "exceeds-outstanding" amount is greater than what's currently owed
//   "invalid-method"      method is not "cash" or "online"
function createSettlement(personId, amount, method) {
  const transactions = getTransactionsForPerson(personId);
  const settlements = getSettlementsForPerson(personId);
  const balance = calculateBalance(transactions, settlements);

  const direction = getSettlementDirection(balance);
  if (!direction) {
    return { ok: false, error: "nothing-to-settle" };
  }

  const outstanding = getOutstandingAmount(balance);

  if (!isValidSettlementAmount(amount, outstanding)) {
    return {
      ok: false,
      error: amount > outstanding ? "exceeds-outstanding" : "invalid-amount",
    };
  }

  if (!isValidSettlementMethod(method)) {
    return { ok: false, error: "invalid-method" };
  }

  const closesPeriod = Math.abs(amount - outstanding) < 1e-9;

  const settlement = {
    id: generateId(),
    personId,
    amount,
    payer: direction.payer,
    beneficiary: direction.beneficiary,
    method,
    timestamp: getMonotonicTimestamp(),
    closesPeriod,
  };

  const all = loadSettlements();
  all.push(settlement);
  saveSettlements(all);

  return { ok: true, settlement };
}

// ========================================================================
// Settlement Confirmation (Milestone 5C)
// ------------------------------------------------------------------------
// "Mark as settled" no longer calls createSettlement() directly. Instead:
//   1. buildPendingSettlement() captures an immutable snapshot of exactly
//      what the user is about to settle, at the moment they tap
//      "Mark as settled" — never a value that could go stale if the form
//      is edited afterwards, because nothing reads the form again.
//   2. confirmPendingSettlement() is the ONLY place that calls the engine's
//      createSettlement(), and it's only invoked when the user taps
//      "Confirm settlement". It does no validation of its own — the
//      engine remains the single source of truth for validity.
// This keeps settlement creation itself unduplicated while making the
// two-step confirmation behavior (and its state-safety guarantee) testable
// independently of any DOM.
// ========================================================================

function buildPendingSettlement(personId, amount, method) {
  if (!personId || !Number.isFinite(amount) || amount <= 0 || !method) {
    return null;
  }
  return { personId, amount, method };
}

function confirmPendingSettlement(pendingSettlement) {
  if (!pendingSettlement) {
    return { ok: false, error: "invalid-amount" };
  }
  const { personId, amount, method } = pendingSettlement;
  return createSettlement(personId, amount, method);
}

// ========================================================================
// Add Person page — creates a real local person, then goes Home.
// ========================================================================

function setupAddPersonForm() {
  const form = document.querySelector("[data-add-person-form]");
  if (!form) return;

  const nameInput = document.getElementById("person-name");
  const phoneInput = document.getElementById("person-phone");

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const name = nameInput.value.trim();
    const phone = phoneInput.value.trim();

    if (!name) {
      reportCustomInvalid(nameInput, "Enter a name.");
      return;
    }
    if (!phone) {
      reportCustomInvalid(phoneInput, "Enter a phone number.");
      return;
    }

    // Guards against a double-tap/double-click creating two people before
    // navigation away from this page actually happens.
    if (form.dataset.submitting === "true") return;
    form.dataset.submitting = "true";

    const person = {
      id: generateId(),
      name,
      phone,
      createdAt: new Date().toISOString(),
    };

    const people = loadPeople();
    people.push(person);
    savePeople(people);

    window.location.href = "../index.html";
  });
}

// ========================================================================
// Home page — lists real local people, or the empty state.
// ========================================================================

function setupHomePage() {
  const emptyState = document.querySelector("[data-people-empty]");
  const list = document.querySelector("[data-people-list]");
  if (!emptyState || !list) return; // Not the Home page.

  const people = loadPeople();
  const transactions = loadTransactions();
  const settlements = loadSettlements();

  if (people.length === 0) {
    emptyState.hidden = false;
    list.hidden = true;
    list.innerHTML = "";
    return;
  }

  emptyState.hidden = true;
  list.hidden = false;

  // Newest person first.
  const ordered = [...people].reverse();

  list.innerHTML = ordered
    .map((person) => {
      const personTransactions = transactions.filter(
        (tx) => tx.personId === person.id
      );
      const personSettlements = settlements.filter(
        (settlement) => settlement.personId === person.id
      );
      const net = calculateBalance(personTransactions, personSettlements);
      const settled = net === 0;

      return `
        <a class="person-card" href="pages/person.html?id=${encodeURIComponent(person.id)}">
          <div class="person-card__avatar">
            <svg viewBox="0 0 24 24" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-3.5 3.5-6 8-6s8 2.5 8 6" />
            </svg>
          </div>
          <div class="person-card__main">
            <span class="person-card__name">${escapeHtml(person.name)}</span>
            <span class="person-card__balance${settled ? " person-card__balance--settled" : ""}">${balanceLabel(net)}</span>
          </div>
        </a>
      `;
    })
    .join("");
}

// ========================================================================
// Person page — real person data, filtered transactions, add-transaction
// bottom sheet (Phase 2B behaviour, now wired to shared storage).
// ========================================================================

function setupPersonPage() {
  const form = document.querySelector("[data-transaction-form]");
  if (!form) return; // Not the Person page.

  const personId = new URLSearchParams(window.location.search).get("id");
  const person = personId ? findPersonById(personId) : null;

  const els = {
    nameLabel: document.querySelector("[data-person-name]"),
    overlay: document.querySelector("[data-sheet-overlay]"),
    sheet: document.querySelector("[data-sheet]"),
    sheetTitle: document.querySelector("[data-sheet-title]"),
    submitLabel: document.querySelector("[data-submit-label]"),
    openBtn: document.querySelector("[data-open-sheet]"),
    closeBtn: document.querySelector("[data-close-sheet]"),
    payerHint: document.querySelector("[data-payer-hint]"),
    payerOptions: Array.from(document.querySelectorAll(".payer-option")),
    payerYouLabel: document.querySelector('[data-payer-label="you"]'),
    payerPersonLabel: document.querySelector('[data-payer-label="person"]'),
    amountInput: document.getElementById("amount"),
    purposeInput: document.getElementById("purpose"),
    balanceValue: document.querySelector("[data-balance-value]"),
    balanceCard: document.querySelector("[data-balance-card]"),
    emptyState: document.querySelector("[data-transactions-empty]"),
    list: document.querySelector("[data-transactions-list]"),
    confirmOverlay: document.querySelector("[data-confirm-overlay]"),
    confirmSheet: document.querySelector("[data-confirm-sheet]"),
    cancelDeleteBtn: document.querySelector("[data-cancel-delete]"),
    confirmDeleteBtn: document.querySelector("[data-confirm-delete]"),
    menuBtn: document.querySelector("[data-open-menu]"),
    menuOverlay: document.querySelector("[data-menu-overlay]"),
    menuSheet: document.querySelector("[data-menu-sheet]"),
    menuEditPersonBtn: document.querySelector("[data-menu-edit-person]"),
    menuDeletePersonBtn: document.querySelector("[data-menu-delete-person]"),
    menuCancelBtn: document.querySelector("[data-menu-cancel]"),
    editPersonOverlay: document.querySelector("[data-edit-person-overlay]"),
    editPersonSheet: document.querySelector("[data-edit-person-sheet]"),
    editPersonForm: document.querySelector("[data-edit-person-form]"),
    closeEditPersonBtn: document.querySelector("[data-close-edit-person]"),
    editPersonNameInput: document.getElementById("edit-person-name"),
    editPersonPhoneInput: document.getElementById("edit-person-phone"),
    deletePersonOverlay: document.querySelector("[data-delete-person-overlay]"),
    deletePersonSheet: document.querySelector("[data-delete-person-sheet]"),
    cancelDeletePersonBtn: document.querySelector("[data-cancel-delete-person]"),
    confirmDeletePersonBtn: document.querySelector("[data-confirm-delete-person]"),
    settleOpenBtn: document.querySelector("[data-open-settle-sheet]"),
    settleOverlay: document.querySelector("[data-settle-overlay]"),
    settleSheet: document.querySelector("[data-settle-sheet]"),
    settleTitle: document.querySelector("[data-settle-title]"),
    closeSettleBtn: document.querySelector("[data-close-settle]"),
    settleInfo: document.querySelector("[data-settle-info]"),
    settleInfoPrimary: document.querySelector("[data-settle-info-primary]"),
    settleInfoSecondary: document.querySelector("[data-settle-info-secondary]"),
    settleForm: document.querySelector("[data-settle-form]"),
    settleAmountInput: document.getElementById("settle-amount"),
    settleDirectionText: document.querySelector("[data-settle-direction-text]"),
    settleMethodOptions: Array.from(
      document.querySelectorAll("[data-settle-method-choice] .payer-option")
    ),
    settleError: document.querySelector("[data-settle-error]"),
    settleConfirm: document.querySelector("[data-settle-confirm]"),
    settleConfirmSummary: document.querySelector("[data-settle-confirm-summary]"),
    settleConfirmMethod: document.querySelector("[data-settle-confirm-method]"),
    settleConfirmCancelBtn: document.querySelector("[data-settle-confirm-cancel]"),
    settleConfirmSubmitBtn: document.querySelector("[data-settle-confirm-submit]"),
  };

  if (!person) {
    // No valid person selected (e.g. page opened directly, or a stale link
    // to a person who has since been deleted). Keep the generic structural
    // placeholder and don't allow creating orphaned transactions or
    // editing/deleting a relationship that no longer exists.
    if (els.nameLabel) els.nameLabel.textContent = "Person";
    els.openBtn.disabled = true;
    if (els.menuBtn) els.menuBtn.disabled = true;
    if (els.settleOpenBtn) els.settleOpenBtn.disabled = true;
    return;
  }

  if (els.nameLabel) els.nameLabel.textContent = person.name;
  if (els.payerPersonLabel) els.payerPersonLabel.textContent = person.name;

  // Tracks which transaction is being edited. `null` means the sheet is in
  // "add a new transaction" mode. Editing never changes a transaction's
  // `id` or `personId` — only its amount/payer/purpose (and `updatedAt`).
  let editingTransactionId = null;

  // Tracks which transaction is pending deletion while the confirmation
  // sheet is open. `null` means no deletion is in progress.
  let pendingDeleteId = null;

  // The most the current user is allowed to settle right now (the
  // outstanding amount at the moment the Settle sheet was opened). Only
  // meaningful while the sheet is showing the settlement form (state 1) —
  // recomputed fresh every time the sheet opens.
  let settleOutstanding = 0;

  // Captured snapshot of {personId, amount, method} from the moment
  // "Mark as settled" was tapped. `null` whenever the confirmation state
  // isn't showing. This — never the live form — is what
  // "Confirm settlement" creates, and it's cleared the instant the sheet
  // closes or the user cancels, so a settlement can never be created from
  // a stale or half-abandoned attempt.
  let pendingSettlement = null;

  // Guards against a settlement being created twice from rapid repeated
  // taps on "Confirm settlement" (e.g. a double click) before the sheet
  // has had a chance to close.
  let isSubmittingSettlement = false;

  els.openBtn.addEventListener("click", openAddSheet);
  els.closeBtn.addEventListener("click", closeSheet);
  els.overlay.addEventListener("click", closeSheet);

  // Event delegation: transaction items are re-rendered on every change,
  // so we listen on the container rather than on individual buttons.
  els.list.addEventListener("click", (event) => {
    const editButton = event.target.closest("[data-edit-tx]");
    if (editButton) {
      openEditSheet(editButton.getAttribute("data-edit-tx"));
      return;
    }

    const deleteButton = event.target.closest("[data-delete-tx]");
    if (deleteButton) {
      openDeleteConfirm(deleteButton.getAttribute("data-delete-tx"));
    }
  });

  els.cancelDeleteBtn.addEventListener("click", closeDeleteConfirm);
  els.confirmOverlay.addEventListener("click", closeDeleteConfirm);
  els.confirmDeleteBtn.addEventListener("click", performDelete);

  els.menuBtn.addEventListener("click", openMenuSheet);
  els.menuOverlay.addEventListener("click", closeMenuSheet);
  els.menuCancelBtn.addEventListener("click", closeMenuSheet);
  els.menuEditPersonBtn.addEventListener("click", () => {
    closeMenuSheet();
    openEditPersonSheet();
  });
  els.menuDeletePersonBtn.addEventListener("click", () => {
    closeMenuSheet();
    openDeletePersonConfirm();
  });

  els.closeEditPersonBtn.addEventListener("click", closeEditPersonSheet);
  els.editPersonOverlay.addEventListener("click", closeEditPersonSheet);
  els.editPersonForm.addEventListener("submit", handleEditPersonSubmit);

  els.cancelDeletePersonBtn.addEventListener("click", closeDeletePersonConfirm);
  els.deletePersonOverlay.addEventListener("click", closeDeletePersonConfirm);
  els.confirmDeletePersonBtn.addEventListener("click", performDeletePerson);

  els.settleOpenBtn.addEventListener("click", openSettleSheet);
  els.closeSettleBtn.addEventListener("click", closeSettleSheet);
  els.settleOverlay.addEventListener("click", closeSettleSheet);
  els.settleAmountInput.addEventListener("input", handleSettleAmountInput);
  els.settleForm.querySelectorAll('input[name="settle-method"]').forEach((input) => {
    input.addEventListener("change", syncSettleMethodUI);
  });
  els.settleForm.addEventListener("submit", handleSettleSubmit);
  els.settleConfirmCancelBtn.addEventListener("click", handleSettleConfirmCancel);
  els.settleConfirmSubmitBtn.addEventListener("click", handleSettleConfirmSubmit);

  form.querySelectorAll('input[name="payer"]').forEach((input) => {
    input.addEventListener("change", (event) => syncPayerUI(event.target.value));
  });

  form.addEventListener("submit", handleSubmit);

  renderTransactions();
  renderBalance();

  // -- Sheet open/close ---------------------------------------------------

  function openAddSheet() {
    editingTransactionId = null;
    resetForm();
    els.sheetTitle.textContent = "Add transaction";
    els.submitLabel.textContent = "Add transaction";
    openSheet();
  }

  function openEditSheet(transactionId) {
    // Look the transaction up fresh from storage and confirm it still
    // belongs to this person — fails safely (does nothing) otherwise,
    // rather than opening a sheet with no real transaction behind it.
    const transaction = loadTransactions().find(
      (tx) => tx.id === transactionId && tx.personId === person.id
    );
    if (!transaction) return;

    editingTransactionId = transaction.id;

    els.amountInput.value = transaction.amount;
    els.purposeInput.value = transaction.purpose;

    const payerInput = form.querySelector(
      `input[name="payer"][value="${transaction.payer}"]`
    );
    if (payerInput) {
      payerInput.checked = true;
      syncPayerUI(transaction.payer);
    }

    els.sheetTitle.textContent = "Edit transaction";
    els.submitLabel.textContent = "Save changes";
    openSheet();
  }

  function openSheet() {
    els.overlay.hidden = false;
    els.sheet.hidden = false;
    void els.sheet.offsetHeight; // Force reflow so the transition animates.
    els.overlay.classList.add("is-visible");
    els.sheet.classList.add("is-open");
    els.sheet.setAttribute("aria-hidden", "false");
    els.amountInput?.focus();
  }

  function closeSheet() {
    els.overlay.classList.remove("is-visible");
    els.sheet.classList.remove("is-open");
    els.sheet.setAttribute("aria-hidden", "true");

    const onTransitionEnd = () => {
      els.overlay.hidden = true;
      els.sheet.hidden = true;
      els.sheet.removeEventListener("transitionend", onTransitionEnd);
    };
    els.sheet.addEventListener("transitionend", onTransitionEnd);

    // Cancelling (closing without submitting) must never modify data —
    // this only resets the form/UI, it never touches storage.
    editingTransactionId = null;
    resetForm();
    form.dataset.submitting = "false";
  }

  // -- Delete confirmation -----------------------------------------------

  function openDeleteConfirm(transactionId) {
    // Look the transaction up fresh from storage and confirm it still
    // belongs to this person — fails safely (does nothing) otherwise, e.g.
    // if the row is stale or the id is malformed.
    const transaction = loadTransactions().find(
      (tx) => tx.id === transactionId && tx.personId === person.id
    );
    if (!transaction) return;

    pendingDeleteId = transaction.id;

    els.confirmOverlay.hidden = false;
    els.confirmSheet.hidden = false;
    void els.confirmSheet.offsetHeight; // Force reflow so the transition animates.
    els.confirmOverlay.classList.add("is-visible");
    els.confirmSheet.classList.add("is-open");
    els.confirmSheet.setAttribute("aria-hidden", "false");
  }

  function closeDeleteConfirm() {
    els.confirmOverlay.classList.remove("is-visible");
    els.confirmSheet.classList.remove("is-open");
    els.confirmSheet.setAttribute("aria-hidden", "true");

    const onTransitionEnd = () => {
      els.confirmOverlay.hidden = true;
      els.confirmSheet.hidden = true;
      els.confirmSheet.removeEventListener("transitionend", onTransitionEnd);
    };
    els.confirmSheet.addEventListener("transitionend", onTransitionEnd);

    // Cancelling (or closing via the overlay) must never modify data —
    // this only resets the pending state, it never touches storage.
    pendingDeleteId = null;
  }

  function performDelete() {
    if (!pendingDeleteId) {
      closeDeleteConfirm();
      return;
    }

    const transactions = loadTransactions();
    const index = transactions.findIndex(
      (tx) => tx.id === pendingDeleteId && tx.personId === person.id
    );

    if (index === -1) {
      // Already deleted, a nonexistent id, or (defensively) a transaction
      // belonging to another person — do nothing destructive, just close.
      closeDeleteConfirm();
      return;
    }

    // Remove only this transaction. No other transaction, person, or
    // localStorage key is touched. The balance is never stored directly —
    // it's recalculated from whatever transactions remain.
    transactions.splice(index, 1);
    saveTransactions(transactions);

    renderTransactions();
    renderBalance();
    closeDeleteConfirm();
  }

  // -- Person options menu -------------------------------------------------

  function openMenuSheet() {
    els.menuOverlay.hidden = false;
    els.menuSheet.hidden = false;
    void els.menuSheet.offsetHeight; // Force reflow so the transition animates.
    els.menuOverlay.classList.add("is-visible");
    els.menuSheet.classList.add("is-open");
    els.menuSheet.setAttribute("aria-hidden", "false");
  }

  function closeMenuSheet() {
    els.menuOverlay.classList.remove("is-visible");
    els.menuSheet.classList.remove("is-open");
    els.menuSheet.setAttribute("aria-hidden", "true");

    const onTransitionEnd = () => {
      els.menuOverlay.hidden = true;
      els.menuSheet.hidden = true;
      els.menuSheet.removeEventListener("transitionend", onTransitionEnd);
    };
    els.menuSheet.addEventListener("transitionend", onTransitionEnd);
  }

  // -- Edit person -----------------------------------------------------------

  function openEditPersonSheet() {
    // Always pull the latest values into the form when opening, so the
    // sheet reflects the current name/phone rather than stale defaults.
    els.editPersonNameInput.value = person.name;
    els.editPersonPhoneInput.value = person.phone;

    els.editPersonOverlay.hidden = false;
    els.editPersonSheet.hidden = false;
    void els.editPersonSheet.offsetHeight; // Force reflow so the transition animates.
    els.editPersonOverlay.classList.add("is-visible");
    els.editPersonSheet.classList.add("is-open");
    els.editPersonSheet.setAttribute("aria-hidden", "false");
    els.editPersonNameInput.focus();
  }

  function closeEditPersonSheet() {
    els.editPersonOverlay.classList.remove("is-visible");
    els.editPersonSheet.classList.remove("is-open");
    els.editPersonSheet.setAttribute("aria-hidden", "true");

    const onTransitionEnd = () => {
      els.editPersonOverlay.hidden = true;
      els.editPersonSheet.hidden = true;
      els.editPersonSheet.removeEventListener("transitionend", onTransitionEnd);
    };
    els.editPersonSheet.addEventListener("transitionend", onTransitionEnd);

    // Cancelling (or closing via the overlay/close button) must never
    // modify data — this only resets the form's own fields, which get
    // repopulated from `person` the next time the sheet opens.
    els.editPersonForm.reset();
  }

  function handleEditPersonSubmit(event) {
    event.preventDefault();

    // Reuse the same validation rule as Add Person: trim both fields,
    // require both to be non-empty. No stricter phone format is enforced
    // there, so none is introduced here either.
    const name = els.editPersonNameInput.value.trim();
    const phone = els.editPersonPhoneInput.value.trim();

    if (name.length === 0) {
      reportCustomInvalid(els.editPersonNameInput, "Enter a name.");
      return;
    }
    if (phone.length === 0) {
      reportCustomInvalid(els.editPersonPhoneInput, "Enter a phone number.");
      return;
    }

    const people = loadPeople();
    const index = people.findIndex((p) => p.id === person.id);

    if (index === -1) {
      // The person disappeared from storage between opening the sheet and
      // saving (e.g. deleted in another tab). Fail safely: don't write
      // anything or recreate a person, just close the sheet.
      closeEditPersonSheet();
      return;
    }

    // Only the editable fields change — id and createdAt are preserved,
    // and no transaction is touched.
    people[index] = {
      ...people[index],
      name,
      phone,
    };
    savePeople(people);

    // Keep the in-memory `person` object used throughout this page's
    // closures in sync, so the name label, transaction wording, and payer
    // radio label all reflect the change immediately without a reload.
    person.name = name;
    person.phone = phone;

    if (els.nameLabel) els.nameLabel.textContent = person.name;
    if (els.payerPersonLabel) els.payerPersonLabel.textContent = person.name;

    renderTransactions();
    closeEditPersonSheet();
  }

  // -- Delete person / relationship ------------------------------------------

  function openDeletePersonConfirm() {
    els.deletePersonOverlay.hidden = false;
    els.deletePersonSheet.hidden = false;
    void els.deletePersonSheet.offsetHeight; // Force reflow so the transition animates.
    els.deletePersonOverlay.classList.add("is-visible");
    els.deletePersonSheet.classList.add("is-open");
    els.deletePersonSheet.setAttribute("aria-hidden", "false");
  }

  function closeDeletePersonConfirm() {
    els.deletePersonOverlay.classList.remove("is-visible");
    els.deletePersonSheet.classList.remove("is-open");
    els.deletePersonSheet.setAttribute("aria-hidden", "true");

    const onTransitionEnd = () => {
      els.deletePersonOverlay.hidden = true;
      els.deletePersonSheet.hidden = true;
      els.deletePersonSheet.removeEventListener("transitionend", onTransitionEnd);
    };
    els.deletePersonSheet.addEventListener("transitionend", onTransitionEnd);
  }

  function performDeletePerson() {
    const people = loadPeople();
    const index = people.findIndex((p) => p.id === person.id);

    if (index !== -1) {
      // Remove only this person...
      people.splice(index, 1);
      savePeople(people);

      // ...and only this person's transactions and settlements. Every
      // other person's records are left completely untouched. Without
      // also clearing settlements here, a deleted relationship would leave
      // orphaned settlement records behind — permanently visible in Main
      // History as "Someone settled ..." with no way to identify who.
      const transactions = loadTransactions();
      const remainingTransactions = transactions.filter((tx) => tx.personId !== person.id);
      saveTransactions(remainingTransactions);

      const settlements = loadSettlements();
      const remainingSettlements = settlements.filter(
        (settlement) => settlement.personId !== person.id
      );
      saveSettlements(remainingSettlements);
    }

    // Whether or not the person was already gone (e.g. deleted in another
    // tab), this relationship no longer exists locally — navigate back to
    // Home rather than leaving a stale Person page on screen.
    window.location.href = "../index.html";
  }

  // -- Settle (Milestone 5B) -------------------------------------------------
  //
  // Opens the Settle sheet in one of three states, derived fresh from the
  // current balance every time the sheet is opened:
  //   1. Current user owes person -> settlement form, pre-filled.
  //   2. Person owes current user -> informative "nothing to settle" state.
  //   3. Balance is zero          -> informative "settled" state.
  // The Settle button itself is never disabled for a valid person — the
  // sheet always opens and explains the situation.

  function openSettleSheet() {
    const transactions = getTransactionsForPerson(person.id);
    const settlements = getSettlementsForPerson(person.id);
    const balance = calculateBalance(transactions, settlements);
    const direction = getSettlementDirection(balance);

    els.settleTitle.textContent = `Settle with ${person.name}`;
    els.settleError.hidden = true;
    els.settleError.textContent = "";

    // Always start fresh: no leftover confirmation from a previous visit
    // to this sheet, and no way to accidentally confirm a stale snapshot.
    pendingSettlement = null;
    isSubmittingSettlement = false;
    els.settleConfirm.hidden = true;
    els.settleConfirmSubmitBtn.disabled = false;

    // getSettlementDirection(balance) is the single source of truth for
    // which of the three states applies:
    //   null                  -> State C, balance is zero
    //   { payer: "person" }   -> State B, person owes the current user
    //   { payer: "you" }      -> State A, current user owes the person
    const currentUserOwes = direction !== null && direction.payer === "you";

    if (!currentUserOwes) {
      // States B & C — nothing for the current user to settle. The form is
      // fully hidden: no amount input, no method selector, no submit
      // button, so a settlement can never be created from here.
      els.settleForm.hidden = true;
      els.settleInfo.hidden = false;

      if (balance === 0) {
        // State C.
        els.settleInfoPrimary.textContent = `Your balance with ${person.name} is settled.`;
        els.settleInfoSecondary.hidden = true;
        els.settleInfoSecondary.textContent = "";
      } else {
        // State B.
        els.settleInfoPrimary.textContent = `${person.name} owes you ₹${formatAmount(
          getOutstandingAmount(balance)
        )}.`;
        els.settleInfoSecondary.hidden = false;
        els.settleInfoSecondary.textContent = "You have nothing to settle.";
      }
    } else {
      // State A — current user owes person; show the settlement form.
      settleOutstanding = getOutstandingAmount(balance);

      els.settleInfo.hidden = true;
      els.settleForm.hidden = false;

      els.settleForm.reset();
      els.settleMethodOptions.forEach((option) => option.classList.remove("is-selected"));

      els.settleAmountInput.max = settleOutstanding;
      els.settleAmountInput.value = settleOutstanding;
      updateSettleDirectionText();
    }

    openSettleSheetPanel();
  }

  function openSettleSheetPanel() {
    els.settleOverlay.hidden = false;
    els.settleSheet.hidden = false;
    void els.settleSheet.offsetHeight; // Force reflow so the transition animates.
    els.settleOverlay.classList.add("is-visible");
    els.settleSheet.classList.add("is-open");
    els.settleSheet.setAttribute("aria-hidden", "false");

    if (!els.settleForm.hidden) {
      els.settleAmountInput?.focus();
    }
  }

  function closeSettleSheet() {
    els.settleOverlay.classList.remove("is-visible");
    els.settleSheet.classList.remove("is-open");
    els.settleSheet.setAttribute("aria-hidden", "true");

    const onTransitionEnd = () => {
      els.settleOverlay.hidden = true;
      els.settleSheet.hidden = true;
      els.settleSheet.removeEventListener("transitionend", onTransitionEnd);
    };
    els.settleSheet.addEventListener("transitionend", onTransitionEnd);

    // Whether × was tapped from the form, the info state, or the
    // confirmation state, closing the sheet must never leave behind a
    // snapshot that some later code path could accidentally act on.
    pendingSettlement = null;
    isSubmittingSettlement = false;
  }

  function handleSettleAmountInput() {
    // Keep the field from being typed above the outstanding amount. The
    // engine remains the final authority on validity — this is just a
    // light guard so the preview text never shows an impossible overpay.
    const raw = parseFloat(els.settleAmountInput.value);
    if (Number.isFinite(raw) && raw > settleOutstanding) {
      els.settleAmountInput.value = settleOutstanding;
    }
    updateSettleDirectionText();
  }

  function updateSettleDirectionText() {
    const amount = parseFloat(els.settleAmountInput.value);
    els.settleDirectionText.textContent =
      Number.isFinite(amount) && amount > 0
        ? `You pay ${person.name} ₹${formatAmount(Math.min(amount, settleOutstanding))}`
        : "\u00a0";
  }

  function syncSettleMethodUI() {
    els.settleMethodOptions.forEach((option) => {
      const input = option.querySelector("input");
      option.classList.toggle("is-selected", input.checked);
    });
  }

  function handleSettleSubmit(event) {
    event.preventDefault();

    const amount = parseFloat(els.settleAmountInput.value);
    const methodInput = els.settleForm.querySelector(
      'input[name="settle-method"]:checked'
    );
    const method = methodInput ? methodInput.value : null;

    els.settleError.hidden = true;
    els.settleError.textContent = "";

    // Capture exactly what's in the form right now — this snapshot, not
    // the live form, is what the confirmation shows and what
    // "Confirm settlement" will eventually create. Tapping "Mark as
    // settled" never calls createSettlement() itself.
    const snapshot = buildPendingSettlement(person.id, amount, method);

    if (!snapshot) {
      els.settleForm.reportValidity();
      return;
    }

    pendingSettlement = snapshot;
    showSettleConfirmState();
  }

  function showSettleConfirmState() {
    els.settleTitle.textContent = "Confirm settlement";

    els.settleForm.hidden = true;
    els.settleInfo.hidden = true;
    els.settleConfirm.hidden = false;

    els.settleConfirmSummary.textContent = `You pay ${person.name} ₹${formatAmount(
      pendingSettlement.amount
    )}`;
    els.settleConfirmMethod.textContent =
      pendingSettlement.method === "cash" ? "Cash" : "Online";

    isSubmittingSettlement = false;
    els.settleConfirmSubmitBtn.disabled = false;
  }

  function handleSettleConfirmCancel() {
    // Back to the settlement form exactly as the engine would still see
    // it — no settlement is created, and the discarded snapshot can't be
    // acted on by anything else afterwards.
    pendingSettlement = null;
    isSubmittingSettlement = false;

    els.settleTitle.textContent = `Settle with ${person.name}`;
    els.settleConfirm.hidden = true;
    els.settleInfo.hidden = true;
    els.settleForm.hidden = false;
  }

  function handleSettleConfirmSubmit() {
    // Guards against double-tap/double-click creating two settlements:
    // once a confirmation is in flight, further taps are ignored until a
    // fresh Settle sheet is opened.
    if (isSubmittingSettlement || !pendingSettlement) return;
    isSubmittingSettlement = true;
    els.settleConfirmSubmitBtn.disabled = true;

    const snapshot = pendingSettlement;

    // The engine remains the sole source of truth for validity — this is
    // the only place a settlement is ever created.
    const result = confirmPendingSettlement(snapshot);

    if (!result.ok) {
      // Something about the underlying balance changed between "Mark as
      // settled" and "Confirm settlement" (e.g. edited/deleted elsewhere).
      // Fail safely: return to the form pre-filled with what was
      // attempted, and surface the engine's error there rather than
      // silently dropping the attempt.
      isSubmittingSettlement = false;
      els.settleConfirmSubmitBtn.disabled = false;
      pendingSettlement = null;

      els.settleTitle.textContent = `Settle with ${person.name}`;
      els.settleConfirm.hidden = true;
      els.settleForm.hidden = false;

      els.settleAmountInput.value = snapshot.amount;
      const methodInput = els.settleForm.querySelector(
        `input[name="settle-method"][value="${snapshot.method}"]`
      );
      if (methodInput) {
        methodInput.checked = true;
        syncSettleMethodUI();
      }
      updateSettleDirectionText();

      els.settleError.textContent = settleErrorMessage(result.error);
      els.settleError.hidden = false;
      return;
    }

    pendingSettlement = null;

    renderTransactions();
    renderBalance();
    closeSettleSheet();
  }

  function settleErrorMessage(error) {
    switch (error) {
      case "nothing-to-settle":
        return "There's nothing to settle right now.";
      case "exceeds-outstanding":
        return "That's more than what's outstanding.";
      case "invalid-method":
        return "Choose a payment method.";
      case "invalid-amount":
      default:
        return "Enter a valid amount.";
    }
  }

  // -- Payer hint -----------------------------------------------------------

  function syncPayerUI(value) {
    els.payerOptions.forEach((option) => {
      const input = option.querySelector("input");
      option.classList.toggle("is-selected", input.checked);
    });

    els.payerHint.textContent =
      value === "you"
        ? `You paid for ${person.name}`
        : `${person.name} paid for you`;
  }

  // -- Submit / create or update transaction --------------------------------

  function handleSubmit(event) {
    event.preventDefault();

    const amount = parseFloat(els.amountInput.value);
    const purpose = els.purposeInput.value.trim();
    const payerInput = form.querySelector('input[name="payer"]:checked');
    const payer = payerInput ? payerInput.value : null;

    // Amount and payer are already enforced by the browser's own
    // constraint validation (min="0.01" and a required radio group), so if
    // either is missing/invalid the browser blocks the submit itself and
    // this handler never runs. Purpose only has `required`, which a
    // whitespace-only value satisfies — reportValidity() would be a silent
    // no-op there, so it's checked and reported explicitly.
    if (!Number.isFinite(amount) || amount <= 0 || !payer) {
      form.reportValidity();
      return;
    }
    if (purpose.length === 0) {
      reportCustomInvalid(els.purposeInput, "Say what this is for.");
      return;
    }

    // Guards against a double-tap/double-click creating two transactions
    // (or double-applying an edit) before the sheet has closed.
    if (form.dataset.submitting === "true") return;
    form.dataset.submitting = "true";

    const transactions = loadTransactions();

    if (editingTransactionId) {
      // Update the existing transaction in place. Its id, personId and
      // original timestamp are preserved; only the edited fields change.
      const index = transactions.findIndex(
        (tx) => tx.id === editingTransactionId && tx.personId === person.id
      );

      if (index === -1) {
        // The transaction disappeared from storage between opening the
        // sheet and saving (e.g. edited in another tab). Fail safely:
        // don't write anything, just close the sheet.
        closeSheet();
        return;
      }

      const existing = transactions[index];
      transactions[index] = {
        ...existing,
        amount,
        payer,
        beneficiary: payer === "you" ? "person" : "you",
        purpose,
        updatedAt: new Date().toISOString(),
      };
    } else {
      transactions.push({
        id: generateId(),
        personId: person.id,
        amount,
        payer, // "you" | "person"
        beneficiary: payer === "you" ? "person" : "you",
        purpose,
        timestamp: getMonotonicTimestamp(),
      });
    }

    saveTransactions(transactions);

    renderTransactions();
    renderBalance();
    closeSheet();
  }

  function resetForm() {
    form.reset();
    els.payerOptions.forEach((option) => option.classList.remove("is-selected"));
    els.payerHint.textContent = "\u00a0";
  }

  // -- Rendering --------------------------------------------------------

  function renderTransactions() {
    const transactions = getCurrentTransactionsForPerson(person.id);
    // Partial (non-closing) settlements from the current open period are
    // shown in the timeline so the user understands where balance reductions
    // came from without having to visit Main History.
    const currentSettlements = getCurrentSettlementsForPerson(person.id);

    if (transactions.length === 0 && currentSettlements.length === 0) {
      els.emptyState.hidden = false;
      els.list.hidden = true;
      els.list.innerHTML = "";
      return;
    }

    els.emptyState.hidden = true;
    els.list.hidden = false;

    // Merge transactions and current-period partial settlements into one
    // ordered list. We tag each entry so the template can distinguish them.
    const txEntries = transactions.map((tx) => ({ ...tx, _isSettlement: false }));
    const settlementEntries = currentSettlements.map((s) => ({ ...s, _isSettlement: true }));

    // Newest first across both types.
    const ordered = [...txEntries, ...settlementEntries].sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );

    els.list.innerHTML = ordered
      .map((entry) => {
        if (entry._isSettlement) {
          // Perspective-aware settlement wording:
          //   payer === "you"    -> you paid the person -> "You settled"
          //   payer === "person" -> person paid you     -> "<Name> settled"
          const settledLabel =
            entry.payer === "you"
              ? `You settled with ${person.name}`
              : `${person.name} settled with you`;
          const methodLabel = entry.method === "cash" ? "Cash" : "Online";
          return `
            <div class="transaction-item transaction-item--settlement">
              <div class="transaction-item__main">
                <span class="transaction-item__payer">
                  ${escapeHtml(settledLabel)}
                  <span class="settlement-badge">Settled</span>
                </span>
                <span class="transaction-item__purpose">${escapeHtml(methodLabel)}</span>
              </div>
              <div class="transaction-item__meta">
                <span class="transaction-item__amount">₹${formatAmount(entry.amount)}</span>
                <span class="transaction-item__time">${formatRelativeTime(new Date(entry.timestamp))}</span>
              </div>
            </div>
          `;
        }

        // Regular transaction entry.
        const payerLabel = entry.payer === "you" ? "You paid" : `${person.name} paid`;
        return `
          <div class="transaction-item" data-tx-id="${entry.id}">
            <div class="transaction-item__main">
              <span class="transaction-item__payer">${escapeHtml(payerLabel)}</span>
              <span class="transaction-item__purpose">${escapeHtml(entry.purpose)}</span>
            </div>
            <div class="transaction-item__meta">
              <span class="transaction-item__amount">₹${formatAmount(entry.amount)}</span>
              <span class="transaction-item__time">${formatRelativeTime(new Date(entry.timestamp))}</span>
            </div>
            <div class="transaction-item__actions">
              <button
                type="button"
                class="transaction-item__edit"
                data-edit-tx="${entry.id}"
                aria-label="Edit transaction"
              >
                <svg viewBox="0 0 24 24" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
                </svg>
              </button>
              <button
                type="button"
                class="transaction-item__delete"
                data-delete-tx="${entry.id}"
                aria-label="Delete transaction"
              >
                <svg viewBox="0 0 24 24" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M4 7h16" />
                  <path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  <path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" />
                  <path d="M10 11v6M14 11v6" />
                </svg>
              </button>
            </div>
          </div>
        `;
      })
      .join("");
  }

  function renderBalance() {
    const transactions = getTransactionsForPerson(person.id);
    const settlements = getSettlementsForPerson(person.id);
    const net = calculateBalance(transactions, settlements);

    els.balanceCard.classList.toggle("balance-card--settled", net === 0);
    els.balanceValue.textContent = balanceLabel(net);
    els.balanceValue.classList.remove("balance-card__value-placeholder");
    els.balanceValue.classList.add("balance-card__value");
  }
}

// ========================================================================
// History page — every transaction across every person, grouped by month.
// ========================================================================

function setupHistoryPage() {
  const emptyState = document.querySelector("[data-history-empty]");
  const list = document.querySelector("[data-history-list]");
  if (!emptyState || !list) return; // Not the History page.

  const transactions = loadTransactions();
  const settlements = loadSettlements();
  const allEntries = [
    ...transactions.map((tx) => ({ ...tx, isSettlement: false })),
    ...settlements.map((s) => ({
      ...s,
      isSettlement: true,
      purpose: `Settlement (${s.method})`,
    })),
  ];

  if (allEntries.length === 0) {
    emptyState.hidden = false;
    list.hidden = true;
    list.innerHTML = "";
    return;
  }

  emptyState.hidden = true;
  list.hidden = false;

  const people = loadPeople();
  const personName = (personId) =>
    people.find((p) => p.id === personId)?.name || "Someone";

  // Newest first.
  const ordered = [...allEntries].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );

  const groups = groupByMonth(ordered);

  list.innerHTML = Object.keys(groups)
    .map((monthKey) => {
      const items = groups[monthKey]
        .map((entry) => {
          const name = personName(entry.personId);
          const payerLabel = entry.isSettlement
            ? entry.payer === "you" ? "You settled" : `${name} settled`
            : entry.payer === "you" ? "You paid" : `${name} paid`;
          const purposeText = entry.isSettlement
            ? `${name} · Settlement (${entry.method})`
            : `${name} · ${entry.purpose}`;
          return `
            <div class="transaction-item${entry.isSettlement ? " transaction-item--settlement" : ""}">
              <div class="transaction-item__main">
                <span class="transaction-item__payer">
                  ${escapeHtml(payerLabel)}
                  ${entry.isSettlement ? '<span class="settlement-badge">Settled</span>' : ""}
                </span>
                <span class="transaction-item__purpose">${escapeHtml(purposeText)}</span>
              </div>
              <div class="transaction-item__meta">
                <span class="transaction-item__amount">₹${formatAmount(entry.amount)}</span>
                <span class="transaction-item__time">${formatRelativeTime(new Date(entry.timestamp))}</span>
              </div>
            </div>
          `;
        })
        .join("");

      return `
        <div class="history-group">
          <p class="section-label history-group__label">${monthKey}</p>
          <div class="stack">${items}</div>
        </div>
      `;
    })
    .join("");
}

function groupByMonth(transactions) {
  return transactions.reduce((groups, tx) => {
    const date = new Date(tx.timestamp);
    const key = date.toLocaleDateString("en-IN", {
      month: "long",
      year: "numeric",
    });
    (groups[key] = groups[key] || []).push(tx);
    return groups;
  }, {});
}

// ========================================================================
// Small shared helpers
// ========================================================================

function formatAmount(value) {
  return Number(value).toLocaleString("en-IN", {
    minimumFractionDigits: value % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function formatRelativeTime(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 5) return "Just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

// The browser's native constraint validation (`required`, `min`, etc.) only
// catches what it knows how to check — it happily accepts a field that's
// non-empty but whitespace-only, for example. When our own, stricter check
// (post-trim()) fails in a case the browser considers valid, calling
// reportValidity() alone does nothing (no message, no focus) because the
// browser sees no violation. setCustomValidity() forces that violation so
// reportValidity() actually shows something, and the "input" listener
// clears it on the next keystroke so genuinely valid input isn't blocked.
function reportCustomInvalid(input, message) {
  if (!input || !input.setCustomValidity) return;
  input.setCustomValidity(message);
  if (input.reportValidity) input.reportValidity();
  const clear = () => {
    input.setCustomValidity("");
    input.removeEventListener("input", clear);
  };
  input.addEventListener("input", clear);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// ========================================================================
// Test hook — only active under Node (tests/test.js). No-op in the browser,
// since `module` doesn't exist there.
// ========================================================================
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    STORAGE_KEYS,
    SETTLEMENT_METHODS,
    loadPeople,
    savePeople,
    loadTransactions,
    saveTransactions,
    loadSettlements,
    saveSettlements,
    getSettlementsForPerson,
    generateId,
    getMonotonicTimestamp,
    findPersonById,
    getTransactionsForPerson,
    getCurrentTransactionsForPerson,
    getCurrentSettlementsForPerson,
    isPeriodClosingSettlement,
    getLatestFullSettlement,
    calculateBalance,
    balanceLabel,
    getSettlementDirection,
    getOutstandingAmount,
    isValidSettlementAmount,
    isValidSettlementMethod,
    createSettlement,
    buildPendingSettlement,
    confirmPendingSettlement,
  };
}