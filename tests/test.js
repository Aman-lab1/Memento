#!/usr/bin/env node
"use strict";

/**
 * Memento — Milestone 4D reusable regression test
 * =================================================
 *
 * What this does
 * --------------
 * Loads the REAL src/app.js into an isolated sandbox (Node's built-in `vm`
 * module) with a minimal in-memory localStorage/document/window stub, then
 * calls the app's own global engine functions directly:
 *
 *   loadPeople / savePeople, loadTransactions / saveTransactions,
 *   generateId, findPersonById, getTransactionsForPerson,
 *   calculateBalance, balanceLabel, formatAmount, groupByMonth,
 *   readJson (via the loaders), escapeHtml
 *
 * No business logic from app.js is re-implemented here — this file only
 * builds plain data fixtures (the same shape the UI writes) and asserts on
 * the *real* functions' output.
 *
 * Limitation (please read)
 * -------------------------
 * app.js's form-submit handlers (add/edit/delete transaction, edit/delete
 * person, native HTML5 field validation) live as closures inside
 * `setupPersonPage()` and are wired to real DOM elements/events — they are
 * not exposed as standalone functions, so they cannot be called directly
 * without a browser or a DOM library (e.g. jsdom / Playwright). Adding one
 * of those was intentionally avoided to keep this test dependency-free, per
 * the "no external dependencies unless absolutely necessary" requirement.
 * Instead, this suite exercises the underlying storage/read/write/
 * calculation functions those handlers are built on — the actual "engine" —
 * using fixtures that mirror the exact object shape those handlers produce
 * (verified by reading src/app.js). What is NOT covered: clicking through
 * bottom sheets, native `required`/`min` field validation blocking a
 * submit, and the transitions/animations. If you want that layer covered
 * too, it would need a browser-automation dependency added on purpose.
 *
 * Run:
 *   node tests/local-app-test.js
 *
 * Exit code is 0 if everything passes, 1 if anything fails.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const APP_JS_PATH = path.join(__dirname, "..", "src", "app.js");

// ---------------------------------------------------------------------------
// Minimal in-memory localStorage stub
// ---------------------------------------------------------------------------

function createLocalStorageStub() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    // Test-only escape hatch to inject malformed data directly.
    _raw: store,
  };
}

// ---------------------------------------------------------------------------
// Load the real app.js into a fresh sandbox. Called once per test group so
// every group starts from clean local state, as required.
// ---------------------------------------------------------------------------

function loadApp() {
  const src = fs.readFileSync(APP_JS_PATH, "utf8");
  const localStorage = createLocalStorageStub();

  const document = {
    addEventListener() {
      // The real file wires up DOMContentLoaded here; we never fire it, so
      // none of the page-setup functions (which need real DOM elements)
      // run. We only use the plain helper functions defined alongside them.
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    createElement() {
      // Just enough of an Element for escapeHtml()'s textContent/innerHTML
      // round-trip to work without a real DOM.
      let text = "";
      return {
        set textContent(v) {
          text = String(v);
        },
        get textContent() {
          return text;
        },
        get innerHTML() {
          return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
        },
      };
    },
  };

  const sandbox = { console, localStorage, document };
  sandbox.window = { crypto: global.crypto, localStorage };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox, { filename: "src/app.js" });
  return sandbox;
}

// ---------------------------------------------------------------------------
// Tiny assertion / reporting harness (no framework, no dependency)
// ---------------------------------------------------------------------------

let passCount = 0;
let failCount = 0;
const failures = [];
let currentSection = "";

function section(name) {
  currentSection = name;
  console.log(`\n${name}`);
}

function check(label, condition) {
  if (condition) {
    passCount++;
    console.log(`  \u2713 ${label}`);
  } else {
    failCount++;
    failures.push(`${currentSection} — ${label}`);
    console.log(`  \u2717 ${label}`);
  }
}

function eq(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---------------------------------------------------------------------------
// Fixture builders — mirror the exact object shape app.js's own handlers
// write to storage (see setupAddPersonForm / handleSubmit in src/app.js).
// These assemble plain data only; every value they produce is then run
// through the app's real functions below.
// ---------------------------------------------------------------------------

function makePerson(app, name, phone) {
  return { id: app.generateId(), name, phone, createdAt: new Date().toISOString() };
}

function makeTransaction(app, personId, { amount, payer, purpose }) {
  return {
    id: app.generateId(),
    personId,
    amount,
    payer,
    beneficiary: payer === "you" ? "person" : "you",
    purpose,
    timestamp: new Date().toISOString(),
  };
}

// ===========================================================================
// 1. PEOPLE
// ===========================================================================
function testPeople() {
  section("1. People");
  const app = loadApp();

  const asha = makePerson(app, "Asha", "111-111");
  const rahul = makePerson(app, "Rahul", "222-222");
  app.savePeople([asha, rahul]);

  const stored = app.loadPeople();
  check("both people are stored", stored.length === 2);
  check("person IDs are unique", new Set(stored.map((p) => p.id)).size === 2);
  check(
    "Asha's data is stored correctly",
    stored[0].name === "Asha" && stored[0].phone === "111-111" && !!stored[0].createdAt
  );
  check(
    "Rahul's data is stored correctly",
    stored[1].name === "Rahul" && stored[1].phone === "222-222" && !!stored[1].createdAt
  );

  return { app, asha, rahul };
}

// ===========================================================================
// 2. TRANSACTIONS
// ===========================================================================
function testTransactions(app, asha, rahul) {
  section("2. Transactions");

  const t1 = makeTransaction(app, asha.id, { amount: 500, payer: "you", purpose: "Dinner" });
  const t2 = makeTransaction(app, asha.id, { amount: 200, payer: "person", purpose: "Snacks" });
  const t3 = makeTransaction(app, rahul.id, { amount: 100, payer: "you", purpose: "Cab" });
  app.saveTransactions([t1, t2, t3]);

  const stored = app.loadTransactions();
  check("all transactions are stored", stored.length === 3);
  check(
    "transaction IDs are unique",
    new Set(stored.map((t) => t.id)).size === 3
  );

  const ashaTx = app.getTransactionsForPerson(asha.id);
  const rahulTx = app.getTransactionsForPerson(rahul.id);
  check("each transaction belongs to the correct person", ashaTx.length === 2 && rahulTx.length === 1);
  check(
    "payer/beneficiary/purpose/amount stored correctly (t1)",
    ashaTx[0].payer === "you" &&
      ashaTx[0].beneficiary === "person" &&
      ashaTx[0].purpose === "Dinner" &&
      ashaTx[0].amount === 500
  );
  check(
    "payer/beneficiary/purpose/amount stored correctly (t2)",
    ashaTx[1].payer === "person" &&
      ashaTx[1].beneficiary === "you" &&
      ashaTx[1].purpose === "Snacks" &&
      ashaTx[1].amount === 200
  );

  return { t1, t2, t3 };
}

// ===========================================================================
// 3. BALANCE
// ===========================================================================
function testBalance(app, asha, rahul) {
  section("3. Balance");

  const ashaNet = app.calculateBalance(app.getTransactionsForPerson(asha.id));
  check("balance derived correctly (you paid + person paid)", ashaNet === 300); // 500 - 200
  check("balance label reflects positive net", app.balanceLabel(ashaNet) === `Owes you \u20b9${app.formatAmount(300)}`);

  const rahulNet = app.calculateBalance(app.getTransactionsForPerson(rahul.id));
  check("balance derived correctly (single you-paid transaction)", rahulNet === 100);

  check("balance label for zero net is 'Settled'", app.balanceLabel(0) === "Settled");
  check(
    "balance label for negative net reads 'You owe'",
    app.balanceLabel(-150) === `You owe \u20b9${app.formatAmount(150)}`
  );

  // Multiple transactions returning to zero.
  const roundTrip = [
    { payer: "you", amount: 300 },
    { payer: "person", amount: 300 },
  ];
  check("balance returns to zero after equal opposite transactions", app.calculateBalance(roundTrip) === 0);
}

// ===========================================================================
// 4. MULTI-PERSON ISOLATION
// ===========================================================================
function testIsolation(app, asha, rahul) {
  section("4. Multi-person isolation");

  const before = app.getTransactionsForPerson(rahul.id).length;

  // Editing/deleting Asha's transactions must not touch Rahul's.
  const all = app.loadTransactions();
  const ashaTxId = all.find((t) => t.personId === asha.id).id;
  const edited = all.map((t) =>
    t.id === ashaTxId ? { ...t, amount: 999, updatedAt: new Date().toISOString() } : t
  );
  app.saveTransactions(edited);

  check(
    "editing a transaction for Asha leaves Rahul's transactions untouched",
    app.getTransactionsForPerson(rahul.id).length === before &&
      app.getTransactionsForPerson(rahul.id).every((t) => t.amount === 100)
  );

  const afterDelete = app.loadTransactions().filter((t) => t.id !== ashaTxId);
  app.saveTransactions(afterDelete);

  check(
    "deleting a transaction for Asha leaves Rahul's transactions untouched",
    app.getTransactionsForPerson(rahul.id).length === before
  );

  // Restore Asha to a single known transaction for the sections that follow
  // (replace, not append — Asha should have exactly one transaction here).
  const withoutAsha = app.loadTransactions().filter((t) => t.personId !== asha.id);
  app.saveTransactions([
    ...withoutAsha,
    makeTransaction(app, asha.id, { amount: 500, payer: "you", purpose: "Dinner" }),
  ]);
}

// ===========================================================================
// 5. EDIT TRANSACTION
// ===========================================================================
function testEditTransaction(app, asha) {
  section("5. Edit transaction");

  const target = app.getTransactionsForPerson(asha.id)[0];
  const originalId = target.id;
  const originalTimestamp = target.timestamp;

  // Mirrors the merge app.js's handleSubmit performs when editingTransactionId
  // is set: id/personId/timestamp preserved, edited fields replaced, updatedAt
  // stamped (see src/app.js "Update the existing transaction in place").
  const all = app.loadTransactions();
  const index = all.findIndex((t) => t.id === originalId);
  const beforeCount = all.length;
  all[index] = {
    ...all[index],
    amount: 700,
    payer: "you",
    beneficiary: "person",
    purpose: "Dinner (deluxe)",
    updatedAt: new Date().toISOString(),
  };
  app.saveTransactions(all);

  const updated = app.loadTransactions().find((t) => t.id === originalId);
  check("transaction ID does not change after edit", updated.id === originalId);
  check("original timestamp is not silently replaced", updated.timestamp === originalTimestamp);
  check("updatedAt is set on edit", !!updated.updatedAt);
  check("edited fields are applied (amount/purpose)", updated.amount === 700 && updated.purpose === "Dinner (deluxe)");
  check("no duplicate transaction is created by an edit", app.loadTransactions().length === beforeCount);

  const net = app.calculateBalance(app.getTransactionsForPerson(asha.id));
  check("balance recalculates correctly after edit", net === 700);
}

// ===========================================================================
// 6. DELETE TRANSACTION
// ===========================================================================
function testDeleteTransaction(app, asha, rahul) {
  section("6. Delete transaction");

  // Add a second transaction for Asha so we can delete one and keep one.
  app.saveTransactions([
    ...app.loadTransactions(),
    makeTransaction(app, asha.id, { amount: 50, payer: "person", purpose: "Coffee" }),
  ]);

  const beforeAll = app.loadTransactions();
  const beforeAshaCount = app.getTransactionsForPerson(asha.id).length;
  const toDelete = app.getTransactionsForPerson(asha.id).find((t) => t.purpose === "Coffee");

  const afterDelete = beforeAll.filter((t) => t.id !== toDelete.id);
  app.saveTransactions(afterDelete);

  check("deleted transaction is actually removed from storage", !app.loadTransactions().some((t) => t.id === toDelete.id));
  check(
    "deleting one transaction does not remove another",
    app.getTransactionsForPerson(asha.id).length === beforeAshaCount - 1
  );
  check(
    "deleting Asha's transaction does not affect Rahul's",
    app.getTransactionsForPerson(rahul.id).length === 1
  );

  const netAfter = app.calculateBalance(app.getTransactionsForPerson(asha.id));
  check("balance recalculates after delete", netAfter === 700);

  // Delete the final remaining transaction for Asha.
  const last = app.getTransactionsForPerson(asha.id)[0];
  app.saveTransactions(app.loadTransactions().filter((t) => t.id !== last.id));

  check(
    "deleting the final transaction restores the empty condition",
    app.getTransactionsForPerson(asha.id).length === 0
  );
  check("balance is 'Settled' once no transactions remain", app.balanceLabel(app.calculateBalance([])) === "Settled");
}

// ===========================================================================
// 7. EDIT PERSON
// ===========================================================================
function testEditPerson(app, asha) {
  section("7. Edit person");

  const originalId = asha.id;
  const originalCreatedAt = asha.createdAt;

  // Re-add one transaction so we can confirm it still resolves after the edit.
  app.saveTransactions([
    ...app.loadTransactions(),
    makeTransaction(app, asha.id, { amount: 40, payer: "you", purpose: "Auto" }),
  ]);

  // Mirrors handleEditPersonSubmit: id/createdAt preserved, name/phone updated.
  const people = app.loadPeople();
  const index = people.findIndex((p) => p.id === originalId);
  people[index] = { ...people[index], name: "Asha K", phone: "999-999" };
  app.savePeople(people);

  const updated = app.findPersonById(originalId);
  check("person ID remains unchanged after edit", updated.id === originalId);
  check("createdAt remains unchanged after edit", updated.createdAt === originalCreatedAt);
  check("name/phone are updated", updated.name === "Asha K" && updated.phone === "999-999");
  check(
    "transactions still belong to the edited person",
    app.getTransactionsForPerson(originalId).length === 1
  );

  // Persistence check: reload the module fresh (new sandbox), replaying the
  // same underlying stored JSON, and confirm it still resolves correctly.
  const raw = {
    people: JSON.stringify(app.loadPeople()),
    transactions: JSON.stringify(app.loadTransactions()),
  };
  const reloaded = loadApp();
  reloaded.localStorage.setItem("memento:people", raw.people);
  reloaded.localStorage.setItem("memento:transactions", raw.transactions);
  check(
    "updated person information resolves after reload",
    reloaded.findPersonById(originalId).name === "Asha K"
  );

  return updated;
}

// ===========================================================================
// 8. DELETE RELATIONSHIP
// ===========================================================================
function testDeleteRelationship(app, asha, rahul) {
  section("8. Delete relationship");

  // Mirrors performDeletePerson: remove the person, then their transactions.
  const people = app.loadPeople().filter((p) => p.id !== asha.id);
  app.savePeople(people);
  const remainingTx = app.loadTransactions().filter((t) => t.personId !== asha.id);
  app.saveTransactions(remainingTx);

  check("deleted person's transactions are removed", app.getTransactionsForPerson(asha.id).length === 0);
  check("deleted person is removed from storage", app.findPersonById(asha.id) === null);
  check("other people remain untouched", app.findPersonById(rahul.id) !== null);
  check(
    "other people's transactions remain untouched",
    app.getTransactionsForPerson(rahul.id).length === 1
  );
}

// ===========================================================================
// 9. PERSISTENCE
// ===========================================================================
function testPersistence(app) {
  section("9. Persistence");

  const savedPeople = app.loadPeople();
  const savedTx = app.loadTransactions();

  // Simulate a full reload: fresh sandbox, same underlying localStorage data.
  const reloaded = loadApp();
  reloaded.localStorage.setItem("memento:people", JSON.stringify(savedPeople));
  reloaded.localStorage.setItem("memento:transactions", JSON.stringify(savedTx));

  check("people survive a reload", eq(reloaded.loadPeople(), savedPeople));
  check("transactions survive a reload", eq(reloaded.loadTransactions(), savedTx));
}

// ===========================================================================
// 10. INVALID / EDGE DATA
// ===========================================================================
function testEdgeCases() {
  section("10. Invalid / edge data");

  const app = loadApp();

  check("findPersonById returns null for a missing/invalid ID", app.findPersonById("no-such-id") === null);
  check("findPersonById returns null when storage is empty", app.findPersonById(undefined) === null);
  check(
    "getTransactionsForPerson returns [] for a nonexistent person ID",
    Array.isArray(app.getTransactionsForPerson("no-such-id")) && app.getTransactionsForPerson("no-such-id").length === 0
  );
  check("calculateBalance handles a zero-amount transaction without error", app.calculateBalance([{ payer: "you", amount: 0 }]) === 0);
  check("calculateBalance of an empty list is 0", app.calculateBalance([]) === 0);

  // Malformed / missing localStorage state — readJson (used by loadPeople/
  // loadTransactions) must fall back to [] rather than throwing.
  app.localStorage.setItem("memento:people", "{not valid json");
  app.localStorage.setItem("memento:transactions", "");
  let threw = false;
  let peopleResult, txResult;
  try {
    peopleResult = app.loadPeople();
    txResult = app.loadTransactions();
  } catch (e) {
    threw = true;
  }
  check("loadPeople falls back to [] on malformed JSON instead of throwing", !threw && eq(peopleResult, []));
  check("loadTransactions falls back to [] on empty/missing value instead of throwing", eq(txResult, []));

  app.localStorage.removeItem("memento:people");
  check("loadPeople falls back to [] when the key is entirely missing", eq(app.loadPeople(), []));
}

// ===========================================================================
// Runner
// ===========================================================================

function main() {
  console.log("Memento — Milestone 4D regression test");
  console.log("========================================");

  const { app, asha, rahul } = testPeople();
  testTransactions(app, asha, rahul);
  testBalance(app, asha, rahul);
  testIsolation(app, asha, rahul);
  testEditTransaction(app, asha);
  testDeleteTransaction(app, asha, rahul);
  testEditPerson(app, asha);
  testDeleteRelationship(app, asha, rahul);
  testPersistence(app);
  testEdgeCases();

  console.log("\n========================================");
  console.log(`${passCount} passed, ${failCount} failed`);
  if (failCount > 0) {
    console.log("\nFailed checks:");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  } else {
    process.exitCode = 0;
  }
}

main();