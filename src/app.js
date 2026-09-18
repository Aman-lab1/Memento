// Memento — Phase 2C
// Connects Home, Add Person, Person, and History into one local prototype
// using a single shared source of truth in localStorage.
//
// This is temporary prototype storage only — not the final Memento
// persistence architecture. No backend, no Supabase, no auth.

const STORAGE_KEYS = {
  people: "memento:people",
  transactions: "memento:transactions",
};

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

function findPersonById(id) {
  return loadPeople().find((person) => person.id === id) || null;
}

function getTransactionsForPerson(personId) {
  return loadTransactions().filter((tx) => tx.personId === personId);
}

// ========================================================================
// Balance calculation — always derived, never stored directly.
// Positive net  -> the other person owes you.
// Negative net  -> you owe the other person.
// Zero          -> settled.
// ========================================================================

function calculateBalance(transactions) {
  return transactions.reduce((net, tx) => {
    return tx.payer === "you" ? net + tx.amount : net - tx.amount;
  }, 0);
}

function balanceLabel(net) {
  if (net === 0) return "Settled";
  if (net > 0) return `Owes you ₹${formatAmount(net)}`;
  return `You owe ₹${formatAmount(Math.abs(net))}`;
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

    if (!name || !phone) {
      form.reportValidity ? form.reportValidity() : null;
      nameInput.focus();
      return;
    }

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
      const net = calculateBalance(personTransactions);
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
  };

  if (!person) {
    // No valid person selected (e.g. page opened directly, or a stale link
    // to a person who has since been deleted). Keep the generic structural
    // placeholder and don't allow creating orphaned transactions or
    // editing/deleting a relationship that no longer exists.
    if (els.nameLabel) els.nameLabel.textContent = "Person";
    els.openBtn.disabled = true;
    if (els.menuBtn) els.menuBtn.disabled = true;
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

    const isValid = name.length > 0 && phone.length > 0;
    if (!isValid) {
      if (els.editPersonForm.reportValidity) els.editPersonForm.reportValidity();
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

      // ...and only this person's transactions. Every other person's
      // transactions are left completely untouched.
      const transactions = loadTransactions();
      const remaining = transactions.filter((tx) => tx.personId !== person.id);
      saveTransactions(remaining);
    }

    // Whether or not the person was already gone (e.g. deleted in another
    // tab), this relationship no longer exists locally — navigate back to
    // Home rather than leaving a stale Person page on screen.
    window.location.href = "../index.html";
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

    const isValid =
      Number.isFinite(amount) && amount > 0 && !!payer && purpose.length > 0;

    if (!isValid) {
      form.reportValidity();
      return;
    }

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
        timestamp: new Date().toISOString(),
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
    const transactions = getTransactionsForPerson(person.id);

    if (transactions.length === 0) {
      els.emptyState.hidden = false;
      els.list.hidden = true;
      els.list.innerHTML = "";
      return;
    }

    els.emptyState.hidden = true;
    els.list.hidden = false;

    // Newest first.
    const ordered = [...transactions].sort(
      (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
    );

    els.list.innerHTML = ordered
      .map((tx) => {
        const payerLabel = tx.payer === "you" ? "You paid" : `${person.name} paid`;
        return `
          <div class="transaction-item" data-tx-id="${tx.id}">
            <div class="transaction-item__main">
              <span class="transaction-item__payer">${escapeHtml(payerLabel)}</span>
              <span class="transaction-item__purpose">${escapeHtml(tx.purpose)}</span>
            </div>
            <div class="transaction-item__meta">
              <span class="transaction-item__amount">₹${formatAmount(tx.amount)}</span>
              <span class="transaction-item__time">${formatRelativeTime(new Date(tx.timestamp))}</span>
            </div>
            <div class="transaction-item__actions">
              <button
                type="button"
                class="transaction-item__edit"
                data-edit-tx="${tx.id}"
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
                data-delete-tx="${tx.id}"
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
    const net = calculateBalance(transactions);

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

  if (transactions.length === 0) {
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
  const ordered = [...transactions].sort(
    (a, b) => new Date(b.timestamp) - new Date(a.timestamp)
  );

  const groups = groupByMonth(ordered);

  list.innerHTML = Object.keys(groups)
    .map((monthKey) => {
      const items = groups[monthKey]
        .map((tx) => {
          const name = personName(tx.personId);
          const payerLabel = tx.payer === "you" ? "You paid" : `${name} paid`;
          return `
            <div class="transaction-item">
              <div class="transaction-item__main">
                <span class="transaction-item__payer">${escapeHtml(payerLabel)}</span>
                <span class="transaction-item__purpose">${escapeHtml(name)} · ${escapeHtml(tx.purpose)}</span>
              </div>
              <div class="transaction-item__meta">
                <span class="transaction-item__amount">₹${formatAmount(tx.amount)}</span>
                <span class="transaction-item__time">${formatRelativeTime(new Date(tx.timestamp))}</span>
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

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}