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
    openBtn: document.querySelector("[data-open-sheet]"),
    closeBtn: document.querySelector("[data-close-sheet]"),
    payerHint: document.querySelector("[data-payer-hint]"),
    payerOptions: Array.from(document.querySelectorAll(".payer-option")),
    payerYouLabel: document.querySelector('[data-payer-label="you"]'),
    payerPersonLabel: document.querySelector('[data-payer-label="person"]'),
    balanceValue: document.querySelector("[data-balance-value]"),
    balanceCard: document.querySelector("[data-balance-card]"),
    emptyState: document.querySelector("[data-transactions-empty]"),
    list: document.querySelector("[data-transactions-list]"),
  };

  if (!person) {
    // No valid person selected (e.g. page opened directly). Keep the
    // generic structural placeholder and don't allow creating orphaned
    // transactions with nothing to attach them to.
    if (els.nameLabel) els.nameLabel.textContent = "Person";
    els.openBtn.disabled = true;
    return;
  }

  if (els.nameLabel) els.nameLabel.textContent = person.name;
  if (els.payerPersonLabel) els.payerPersonLabel.textContent = person.name;

  els.openBtn.addEventListener("click", openSheet);
  els.closeBtn.addEventListener("click", closeSheet);
  els.overlay.addEventListener("click", closeSheet);

  form.querySelectorAll('input[name="payer"]').forEach((input) => {
    input.addEventListener("change", updatePayerHint);
  });

  form.addEventListener("submit", handleSubmit);

  renderTransactions();
  renderBalance();

  // -- Sheet open/close ---------------------------------------------------

  function openSheet() {
    els.overlay.hidden = false;
    els.sheet.hidden = false;
    void els.sheet.offsetHeight; // Force reflow so the transition animates.
    els.overlay.classList.add("is-visible");
    els.sheet.classList.add("is-open");
    els.sheet.setAttribute("aria-hidden", "false");
    document.getElementById("amount")?.focus();
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

    resetForm();
  }

  // -- Payer hint -----------------------------------------------------------

  function updatePayerHint(event) {
    const value = event.target.value;

    els.payerOptions.forEach((option) => {
      const input = option.querySelector("input");
      option.classList.toggle("is-selected", input.checked);
    });

    els.payerHint.textContent =
      value === "you"
        ? `You paid for ${person.name}`
        : `${person.name} paid for you`;
  }

  // -- Submit / create transaction ------------------------------------------

  function handleSubmit(event) {
    event.preventDefault();

    const amountInput = document.getElementById("amount");
    const purposeInput = document.getElementById("purpose");
    const payerInput = form.querySelector('input[name="payer"]:checked');

    const amount = parseFloat(amountInput.value);
    const purpose = purposeInput.value.trim();
    const payer = payerInput ? payerInput.value : null;

    if (!amount || amount <= 0 || !payer || !purpose) {
      form.reportValidity();
      return;
    }

    const transaction = {
      id: generateId(),
      personId: person.id,
      amount,
      payer, // "you" | "person"
      beneficiary: payer === "you" ? "person" : "you",
      purpose,
      timestamp: new Date().toISOString(),
    };

    const transactions = loadTransactions();
    transactions.push(transaction);
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
          <div class="transaction-item">
            <div class="transaction-item__main">
              <span class="transaction-item__payer">${escapeHtml(payerLabel)}</span>
              <span class="transaction-item__purpose">${escapeHtml(tx.purpose)}</span>
            </div>
            <div class="transaction-item__meta">
              <span class="transaction-item__amount">₹${formatAmount(tx.amount)}</span>
              <span class="transaction-item__time">${formatRelativeTime(new Date(tx.timestamp))}</span>
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
