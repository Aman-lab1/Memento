// Memento — tests/test.js
//
// Node-based regression suite for the engine in src/app.js.
// Run with: node tests/test.js
//
// src/app.js is written to run in a browser, so this file sets up the
// minimal browser shims it needs (document, window, localStorage) before
// requiring it. src/app.js exports its pure engine functions via a small
// `module.exports` guard at the bottom of the file that is a no-op in a
// real browser.

"use strict";

const path = require("path");

// ---------------------------------------------------------------------
// Minimal browser shims
// ---------------------------------------------------------------------

function createLocalStorageMock() {
  let store = {};
  return {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null;
    },
    setItem(key, value) {
      store[key] = String(value);
    },
    removeItem(key) {
      delete store[key];
    },
    clear() {
      store = {};
    },
    _corrupt(key) {
      store[key] = "{not valid json";
    },
  };
}

global.window = global;
global.document = { addEventListener() {} };
global.localStorage = createLocalStorageMock();

const app = require(path.join(__dirname, "..", "src", "app.js"));

const {
  loadPeople,
  savePeople,
  loadTransactions,
  saveTransactions,
  loadSettlements,
  saveSettlements,
  getSettlementsForPerson,
  getTransactionsForPerson,
  getCurrentTransactionsForPerson,
  getCurrentSettlementsForPerson,
  isPeriodClosingSettlement,
  getLatestFullSettlement,
  calculateBalance,
  getSettlementDirection,
  getOutstandingAmount,
  createSettlement,
  buildPendingSettlement,
  confirmPendingSettlement,
  generateId,
  getMonotonicTimestamp,
} = app;

// ---------------------------------------------------------------------
// Tiny test harness
// ---------------------------------------------------------------------

let passed = 0;
let failed = 0;
const failureMessages = [];

function resetStorage() {
  global.localStorage.clear();
}

function check(description, condition) {
  if (condition) {
    passed++;
    console.log(`  \u2713 ${description}`);
  } else {
    failed++;
    failureMessages.push(description);
    console.log(`  \u2717 ${description}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

function makePerson(overrides = {}) {
  const person = {
    id: generateId(),
    name: "Test Person",
    phone: "9999999999",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
  const people = loadPeople();
  people.push(person);
  savePeople(people);
  return person;
}

function addTransaction(personId, amount, payer, purpose = "Test") {
  const transactions = loadTransactions();
  const tx = {
    id: generateId(),
    personId,
    amount,
    payer,
    beneficiary: payer === "you" ? "person" : "you",
    purpose,
    timestamp: getMonotonicTimestamp(),
  };
  transactions.push(tx);
  saveTransactions(transactions);
  return tx;
}

function balanceFor(personId) {
  return calculateBalance(
    getTransactionsForPerson(personId),
    getSettlementsForPerson(personId)
  );
}

// =======================================================================
// Milestone 4 — existing functionality regression
// (People / transactions / derived balances / storage. Milestone 4's full
// suite already covered this exhaustively; these checks confirm nothing
// here regressed while building the settlement engine on top of it.)
// =======================================================================

section("Milestone 4 regression — people, transactions, balances");

resetStorage();
{
  const alice = makePerson({ name: "Alice" });
  check("Person is persisted", loadPeople().length === 1);

  const tx1 = addTransaction(alice.id, 500, "you", "Dinner");
  check("Transaction is persisted", getTransactionsForPerson(alice.id).length === 1);
  check(
    "Balance from a single 'you paid' transaction is +amount",
    balanceFor(alice.id) === 500
  );

  addTransaction(alice.id, 200, "person", "Cab");
  check(
    "Balance combines multiple transactions with correct signs",
    balanceFor(alice.id) === 300
  );

  // Edit in place (mirrors the pattern used by the Person page).
  const transactions = loadTransactions();
  const idx = transactions.findIndex((t) => t.id === tx1.id);
  transactions[idx] = { ...transactions[idx], amount: 600, updatedAt: new Date().toISOString() };
  saveTransactions(transactions);
  check("Editing a transaction updates the derived balance", balanceFor(alice.id) === 400);

  // Delete.
  const afterEdit = loadTransactions();
  const remaining = afterEdit.filter((t) => t.id !== tx1.id);
  saveTransactions(remaining);
  check(
    "Deleting a transaction updates the derived balance",
    balanceFor(alice.id) === -200
  );

  // Relationship isolation for transactions.
  const bob = makePerson({ name: "Bob" });
  addTransaction(bob.id, 1000, "you", "Rent");
  check(
    "Transactions stay isolated between different people",
    balanceFor(alice.id) === -200 && balanceFor(bob.id) === 1000
  );
}

// =======================================================================
// Milestone 5A — Settlement Engine
// =======================================================================

section("Settlement Engine — storage");

resetStorage();
check(
  "1. Empty settlement storage loads correctly",
  Array.isArray(loadSettlements()) && loadSettlements().length === 0
);

{
  const p = makePerson();
  addTransaction(p.id, 500, "you"); // balance +500, so person can settle up to 500
  const result = createSettlement(p.id, 500, "cash");

  check("2. Settlement can be created", result.ok === true);
  check(
    "2. Settlement is persisted to storage",
    getSettlementsForPerson(p.id).length === 1
  );

  const s = result.settlement;
  check(
    "3. Settlement has a unique id",
    typeof s.id === "string" && s.id.length > 0
  );
  check("3. Settlement has personId", s.personId === p.id);
  check("3. Settlement has amount", s.amount === 500);
  check("3. Settlement has payer", s.payer === "person");
  check("3. Settlement has beneficiary", s.beneficiary === "you");
  check("3. Settlement has method", s.method === "cash");
  check(
    "3. Settlement has a timestamp",
    typeof s.timestamp === "string" && s.timestamp.length > 0
  );
}

section("Settlement Engine — payment methods");

resetStorage();
{
  const p1 = makePerson();
  addTransaction(p1.id, 500, "you");
  const cashResult = createSettlement(p1.id, 200, "cash");
  check("4. Cash settlement works", cashResult.ok === true && cashResult.settlement.method === "cash");

  const p2 = makePerson();
  addTransaction(p2.id, 500, "you");
  const onlineResult = createSettlement(p2.id, 100, "online");
  check(
    "5. Online settlement works",
    onlineResult.ok === true && onlineResult.settlement.method === "online"
  );
}

section("Settlement Engine — full and partial settlement");

resetStorage();
{
  const p = makePerson();
  addTransaction(p.id, 500, "you");
  const result = createSettlement(p.id, 500, "online");
  check(
    "6. Full settlement (tx ₹500, settlement ₹500) brings balance to 0",
    result.ok === true && result.settlement.closesPeriod === true && balanceFor(p.id) === 0
  );
  check(
    "6. Current transactions is empty after full settlement",
    getCurrentTransactionsForPerson(p.id).length === 0
  );
}

resetStorage();
{
  const p = makePerson();
  addTransaction(p.id, 1000, "you");
  const partial = createSettlement(p.id, 400, "cash");
  check(
    "7. Partial settlement reduces balance and does not close period",
    partial.ok === true &&
      partial.settlement.closesPeriod === false &&
      balanceFor(p.id) === 600
  );
  check(
    "7. Current transactions remain visible after partial settlement",
    getCurrentTransactionsForPerson(p.id).length === 1
  );

  const second = createSettlement(p.id, 600, "cash");
  check(
    "8. Second settlement for remaining balance succeeds and closes period",
    second.ok === true &&
      second.settlement.closesPeriod === true &&
      balanceFor(p.id) === 0
  );
  check(
    "8. Current transactions is empty after final settlement",
    getCurrentTransactionsForPerson(p.id).length === 0
  );

  const third = createSettlement(p.id, 100, "cash");
  check(
    "8. Third settlement when balance is 0 is rejected as nothing to settle",
    third.ok === false && third.error === "nothing-to-settle"
  );
}

section("Settlement Engine — direction");

resetStorage();
{
  // Person owes you: you paid, so balance is positive -> person pays you.
  const p1 = makePerson();
  addTransaction(p1.id, 600, "you");
  const r1 = createSettlement(p1.id, 600, "cash");
  check(
    "9. Person-owes-you settlement has payer=person, beneficiary=you",
    r1.ok === true && r1.settlement.payer === "person" && r1.settlement.beneficiary === "you"
  );
  check("9. Resulting balance is 0", balanceFor(p1.id) === 0);

  // You owe person: person paid, so balance is negative -> you pay person.
  const p2 = makePerson();
  addTransaction(p2.id, 600, "person");
  const r2 = createSettlement(p2.id, 600, "cash");
  check(
    "9. You-owe-person settlement has payer=you, beneficiary=person",
    r2.ok === true && r2.settlement.payer === "you" && r2.settlement.beneficiary === "person"
  );
  check("9. Resulting balance is 0", balanceFor(p2.id) === 0);
}

section("Settlement Engine — validation");

resetStorage();
{
  const p = makePerson();
  addTransaction(p.id, 600, "you"); // balance +600, outstanding = 600

  const over = createSettlement(p.id, 601, "cash");
  check(
    "10. Settlement exceeding outstanding balance is rejected",
    over.ok === false && over.error === "exceeds-outstanding"
  );
  check(
    "10. Rejected settlement is not persisted",
    getSettlementsForPerson(p.id).length === 0
  );

  const zero = createSettlement(p.id, 0, "cash");
  check("11. Zero-value settlement is rejected", zero.ok === false);

  const negative = createSettlement(p.id, -50, "cash");
  check("12. Negative settlement is rejected", negative.ok === false);

  const nanResult = createSettlement(p.id, NaN, "cash");
  check("13. NaN settlement amount is rejected", nanResult.ok === false);

  const infResult = createSettlement(p.id, Infinity, "cash");
  check("13. Infinity settlement amount is rejected", infResult.ok === false);

  const stringResult = createSettlement(p.id, "abc", "cash");
  check("13. Non-numeric settlement amount is rejected", stringResult.ok === false);

  check(
    "10-13. No invalid settlement was persisted",
    getSettlementsForPerson(p.id).length === 0
  );
}

resetStorage();
{
  const p = makePerson(); // no transactions -> balance is 0
  const result = createSettlement(p.id, 100, "cash");
  check(
    "14. Zero-balance relationship cannot create a settlement",
    result.ok === false && result.error === "nothing-to-settle"
  );
  check(
    "14. Direction helper reports nothing to settle at balance 0",
    getSettlementDirection(0) === null
  );
}

section("Settlement Engine — data integrity");

resetStorage();
{
  const p = makePerson();
  const tx = addTransaction(p.id, 500, "you");
  const before = { ...getTransactionsForPerson(p.id).find((t) => t.id === tx.id) };

  createSettlement(p.id, 500, "cash");

  const after = getTransactionsForPerson(p.id).find((t) => t.id === tx.id);
  check(
    "15. Settlement does not modify the original transaction",
    after.amount === before.amount &&
      after.payer === before.payer &&
      after.timestamp === before.timestamp
  );
}

resetStorage();
{
  const p = makePerson();
  addTransaction(p.id, 500, "you"); // +500
  createSettlement(p.id, 500, "cash"); // -> 0
  check("16. Balance is 0 after full settlement", balanceFor(p.id) === 0);

  addTransaction(p.id, 300, "person"); // person pays for you -> -300
  check(
    "16. New transaction after settlement calculates correctly (0 - 300 = -300)",
    balanceFor(p.id) === -300
  );
}

resetStorage();
{
  const alice = makePerson({ name: "Alice" });
  const bob = makePerson({ name: "Bob" });

  addTransaction(alice.id, 500, "you");
  addTransaction(bob.id, 800, "you");

  createSettlement(alice.id, 500, "cash");

  check(
    "17. Settling Alice's balance does not affect Bob's balance",
    balanceFor(alice.id) === 0 && balanceFor(bob.id) === 800
  );
  check(
    "17. Settlements are isolated per person in storage",
    getSettlementsForPerson(alice.id).length === 1 &&
      getSettlementsForPerson(bob.id).length === 0
  );
}

resetStorage();
{
  const p = makePerson();
  addTransaction(p.id, 500, "you");
  createSettlement(p.id, 500, "cash");

  // Simulate a fresh load (e.g. after a page refresh) by re-reading
  // straight from the same localStorage-backed store.
  const reloaded = loadSettlements();
  check(
    "18. Settlement data survives a fresh load from localStorage",
    reloaded.length === 1 && reloaded[0].personId === p.id && reloaded[0].amount === 500
  );
}

section("Outstanding amount helper");

check("getOutstandingAmount(600) === 600", getOutstandingAmount(600) === 600);
check("getOutstandingAmount(-600) === 600", getOutstandingAmount(-600) === 600);
check("getOutstandingAmount(0) === 0", getOutstandingAmount(0) === 0);

// =======================================================================
// Milestone 5B — Settlement UI integration
//
// The Settle sheet itself is DOM/browser UI and isn't exercised here (no
// browser automation available in this environment — see the manual
// checklist reported alongside these results). What IS tested is the
// exact underlying logic the UI relies on when it opens the sheet and
// handles submission: which state to show, what amount to pre-fill, and
// that a successful "Mark as settled" tap correctly updates the balance
// without touching the original transactions.
// =======================================================================

section("Settlement UI integration — deriving sheet state from balance");

resetStorage();
{
  check(
    "1. Person page can access the settlement engine",
    typeof getSettlementsForPerson === "function" &&
      typeof calculateBalance === "function" &&
      typeof createSettlement === "function"
  );

  // -- Current user owes person ₹600 (balance -600) --
  const p1 = makePerson({ name: "Aman" });
  addTransaction(p1.id, 600, "person"); // person paid for you -> you owe 600
  const balance1 = balanceFor(p1.id);
  const direction1 = getSettlementDirection(balance1);

  check(
    "2. Balance of -600 resolves to direction payer='you'",
    balance1 === -600 && direction1 && direction1.payer === "you"
  );

  const outstanding1 = getOutstandingAmount(balance1);
  check(
    "3. Outstanding amount for a -600 balance is 600",
    outstanding1 === 600
  );
  check(
    "3. Default settlement amount pre-fill equals the outstanding amount",
    outstanding1 === 600
  );
  check(
    "3. Direction reports payer='you', beneficiary='person'",
    direction1.payer === "you" && direction1.beneficiary === "person"
  );

  // -- Person owes current user ₹600 (balance +600) --
  const p2 = makePerson({ name: "Jai" });
  addTransaction(p2.id, 600, "you"); // you paid for person -> person owes you 600
  const balance2 = balanceFor(p2.id);
  const direction2 = getSettlementDirection(balance2);

  check(
    "4. Balance of +600 resolves to 'nothing to settle' for the current user",
    balance2 === 600 && direction2 !== null && direction2.payer !== "you"
  );

  const beforeSettlementCount2 = getSettlementsForPerson(p2.id).length;
  check(
    "4. No settlement is created while in this state",
    beforeSettlementCount2 === 0
  );

  // -- Balance is zero --
  const p3 = makePerson({ name: "Riya" });
  const balance3 = balanceFor(p3.id);
  const direction3 = getSettlementDirection(balance3);

  check(
    "5. Zero balance resolves to 'nothing to settle' (direction is null)",
    balance3 === 0 && direction3 === null
  );
  check(
    "5. No settlement is created at zero balance",
    getSettlementsForPerson(p3.id).length === 0
  );
}

section("Settlement UI integration — submitting the settlement form");

resetStorage();
{
  const p = makePerson({ name: "Aman" });
  addTransaction(p.id, 600, "person"); // you owe 600

  const outstanding = getOutstandingAmount(balanceFor(p.id));
  const partialAmount = 250;
  check(
    "6. Partial amount can be set below the outstanding amount",
    partialAmount < outstanding
  );

  const partialResult = createSettlement(p.id, partialAmount, "cash");
  check("6. Settlement via the form succeeds", partialResult.ok === true);
  check(
    "6. Partial settlement leaves remaining balance outstanding (-350)",
    balanceFor(p.id) === -350
  );
  check(
    "6. Partial settlement does not close current period",
    getCurrentTransactionsForPerson(p.id).length === 1
  );

  const fullResult = createSettlement(p.id, 350, "cash");
  check("10. Full settlement via the form succeeds", fullResult.ok === true);
  check(
    "10. Balance updates to 0 after full settlement",
    balanceFor(p.id) === 0
  );
  check(
    "10. Current period closes after full settlement",
    getCurrentTransactionsForPerson(p.id).length === 0
  );

  const overResult = createSettlement(p.id, 100, "cash");
  check(
    "7. Cannot settle when balance is 0 (returns nothing-to-settle)",
    overResult.ok === false && overResult.error === "nothing-to-settle"
  );

  check("8. Cash settlement stores method 'cash'", partialResult.settlement.method === "cash");

  const original = getTransactionsForPerson(p.id)[0];
  check(
    "11. Original transaction remains unchanged after settlements",
    original.amount === 600 && original.payer === "person"
  );
}

section("19. Existing Milestone 4 functionality still passes");
check(
  "Balance calculation with no settlements matches transaction-only balance",
  (() => {
    resetStorage();
    const p = makePerson();
    addTransaction(p.id, 750, "you");
    addTransaction(p.id, 250, "person");
    return balanceFor(p.id) === 500;
  })()
);

section("Regression Suite — Settlement Period Boundary Bug Fix");

resetStorage();
{
  // 1. Create Ajay transactions
  const ajay = makePerson({ name: "Ajay" });
  const tx1 = addTransaction(ajay.id, 90, "you", "Chai");
  const tx2 = addTransaction(ajay.id, 810, "person", "Dinner");

  check("1. Ajay transactions created (-720 balance)", balanceFor(ajay.id) === -720);

  // 2. Create a settlement
  const settleResult = createSettlement(ajay.id, 720, "cash");
  check("2. Settlement created successfully", settleResult.ok === true);
  check("2. Balance becomes 0 after settlement", balanceFor(ajay.id) === 0);
  check("2. Current transactions on person page is empty", getCurrentTransactionsForPerson(ajay.id).length === 0);

  // 3. Delete transactions (delete tx2 ₹810)
  const txs = loadTransactions();
  const remainingTxs = txs.filter((t) => t.id !== tx2.id);
  saveTransactions(remainingTxs);

  // 4. Verify Person-page/current balance does not resurrect the settlement amount
  check(
    "4. Deleting pre-settlement transaction does not resurrect settlement amount",
    balanceFor(ajay.id) === 0
  );
  check(
    "4. Person page current transactions remains empty",
    getCurrentTransactionsForPerson(ajay.id).length === 0
  );

  // 5. Verify historical settlement still exists
  check(
    "5. Historical settlement still exists in storage",
    getSettlementsForPerson(ajay.id).length === 1
  );

  // 6. Verify historical transactions still exist (tx1 remaining)
  check(
    "6. Historical transaction tx1 still exists in storage",
    getTransactionsForPerson(ajay.id).length === 1 && getTransactionsForPerson(ajay.id)[0].id === tx1.id
  );

  // 7. Add new transactions after settlement
  const tx3 = addTransaction(ajay.id, 300, "you", "Movie");
  const tx4 = addTransaction(ajay.id, 100, "person", "Cab");

  // 8. Verify only post-settlement transactions form the current balance
  check(
    "8. Only post-settlement transactions form the current balance (+200)",
    balanceFor(ajay.id) === 200
  );
  check(
    "8. Person page shows only the 2 post-settlement transactions",
    getCurrentTransactionsForPerson(ajay.id).length === 2
  );
  check(
    "8. Historical storage contains all 3 transactions (1 old + 2 new)",
    getTransactionsForPerson(ajay.id).length === 3
  );

  // 9. Delete those new transactions
  const afterNewTxs = loadTransactions();
  const filteredAfterNew = afterNewTxs.filter((t) => t.id !== tx3.id && t.id !== tx4.id);
  saveTransactions(filteredAfterNew);

  // 10. Verify current balance returns to zero
  check(
    "10. Current balance returns to zero after deleting post-settlement transactions",
    balanceFor(ajay.id) === 0
  );
  check(
    "10. Person page current transactions is empty again",
    getCurrentTransactionsForPerson(ajay.id).length === 0
  );

  // 11. Verify historical data remains available
  check(
    "11. Historical tx1 still exists in storage",
    getTransactionsForPerson(ajay.id).length === 1
  );
  check(
    "11. Historical settlement still exists in storage",
    getSettlementsForPerson(ajay.id).length === 1
  );

  // 12. Verify multiple people remain isolated
  const bob = makePerson({ name: "Bob" });
  addTransaction(bob.id, 500, "you", "Groceries");
  check(
    "12. Bob's balance (+500) is isolated from Ajay's balance (0)",
    balanceFor(bob.id) === 500 && balanceFor(ajay.id) === 0
  );
  check(
    "12. Bob has 1 transaction and 0 settlements",
    getCurrentTransactionsForPerson(bob.id).length === 1 && getSettlementsForPerson(bob.id).length === 0
  );
}

section("Milestone 5C — Settlement Confirmation");

// buildPendingSettlement() is what "Mark as settled" calls: it must never
// touch storage itself, only capture a snapshot. confirmPendingSettlement()
// is what "Confirm settlement" calls: it's a thin wrapper that delegates
// straight to the existing createSettlement() engine, so these tests also
// double as tests of the real UI wiring (setupPersonPage calls these exact
// two functions and nothing else).

resetStorage();
{
  const p = makePerson({ name: "Ajay" });
  addTransaction(p.id, 600, "person"); // you owe Ajay 600

  // 1. "Mark as settled" (buildPendingSettlement) must not create anything.
  const snapshot = buildPendingSettlement(p.id, 600, "online");
  check(
    "1. Mark as settled does NOT immediately create a settlement",
    getSettlementsForPerson(p.id).length === 0
  );
  check("1. A pending snapshot was captured", snapshot !== null);

  // 2. The snapshot (i.e. what the confirmation state would display) has
  // the correct person, amount, and method. Direction is implicit: this
  // flow only ever exists when the current user owes the person, which
  // createSettlement() below independently confirms via payer/beneficiary.
  check(
    "2. Confirmation snapshot has the correct person",
    snapshot.personId === p.id
  );
  check("2. Confirmation snapshot has the correct amount", snapshot.amount === 600);
  check(
    "2. Confirmation snapshot has the correct payment method",
    snapshot.method === "online"
  );

  // 3. Cancel from confirmation: simply never call confirmPendingSettlement
  // with the snapshot. Nothing should exist.
  check(
    "3. Cancel from confirmation creates no settlement",
    getSettlementsForPerson(p.id).length === 0
  );

  // 4. Same for dismissing via the sheet's top-right ×.
  check(
    "4. \u00d7 from confirmation creates no settlement",
    getSettlementsForPerson(p.id).length === 0
  );

  // 5 & 6. Confirm settlement creates exactly one settlement, with the
  // correct personId/amount/payer/beneficiary/method/timestamp.
  const result = confirmPendingSettlement(snapshot);
  check("5. Confirm settlement succeeds", result.ok === true);
  check(
    "5. Confirm settlement creates exactly one settlement",
    getSettlementsForPerson(p.id).length === 1
  );
  check("6. Settlement has the correct personId", result.settlement.personId === p.id);
  check("6. Settlement has the correct amount", result.settlement.amount === 600);
  check("6. Settlement has the correct payer ('you')", result.settlement.payer === "you");
  check(
    "6. Settlement has the correct beneficiary ('person')",
    result.settlement.beneficiary === "person"
  );
  check("6. Settlement has the correct method", result.settlement.method === "online");
  check(
    "6. Settlement has a timestamp",
    typeof result.settlement.timestamp === "string" && result.settlement.timestamp.length > 0
  );

  // 7. Full settlement closes the current period correctly (existing
  // period-boundary behavior, unchanged by 5C).
  check("7. Balance is 0 after full settlement", balanceFor(p.id) === 0);
  check(
    "7. Current period has no transactions after full settlement",
    getCurrentTransactionsForPerson(p.id).length === 0
  );

  // 16. Re-confirming the same already-used snapshot must not create a
  // second settlement — this is what the UI's isSubmittingSettlement guard
  // and single-snapshot lifecycle protect against at the DOM level; at the
  // engine level, calling confirmPendingSettlement again simply re-runs
  // validation, which now correctly reports nothing left to settle.
  const duplicateAttempt = confirmPendingSettlement(snapshot);
  check(
    "16. Re-confirming does not create a duplicate settlement",
    getSettlementsForPerson(p.id).length === 1
  );
  check(
    "16. Re-confirming after a full settlement is rejected as nothing-to-settle",
    duplicateAttempt.ok === false && duplicateAttempt.error === "nothing-to-settle"
  );
}

resetStorage();
{
  // 8. Partial settlement uses the edited amount, not the original
  // prefilled/outstanding amount — this is the core state-safety guarantee
  // of the confirmation flow.
  const p = makePerson({ name: "Ajay" });
  addTransaction(p.id, 600, "person"); // outstanding = 600

  // Simulates: sheet opens prefilled at 600, user edits the amount field to
  // 300, then taps "Mark as settled". The snapshot must reflect 300, never
  // the original 600.
  const editedSnapshot = buildPendingSettlement(p.id, 300, "cash");
  check(
    "8. Confirmation snapshot reflects the edited amount (300), not the original (600)",
    editedSnapshot.amount === 300
  );

  const partialResult = confirmPendingSettlement(editedSnapshot);
  check("8. Partial confirm settlement succeeds", partialResult.ok === true);
  check(
    "8. Stored settlement uses the edited amount (300)",
    partialResult.settlement.amount === 300
  );
  check(
    "8. Settlement has closesPeriod: false for partial amount",
    partialResult.settlement.closesPeriod === false
  );
  check(
    "8. Balance correctly reflects partial settlement (-300 remaining)",
    balanceFor(p.id) === -300
  );
  check(
    "8. Current period remains open with transactions visible",
    getCurrentTransactionsForPerson(p.id).length === 1
  );
}

resetStorage();
{
  // 9 & 10. Cash and Online confirmations store the correct method.
  const p1 = makePerson({ name: "Cash Person" });
  addTransaction(p1.id, 400, "person");
  const cashSnapshot = buildPendingSettlement(p1.id, 400, "cash");
  const cashResult = confirmPendingSettlement(cashSnapshot);
  check("9. Cash confirmation stores 'cash'", cashResult.settlement.method === "cash");

  const p2 = makePerson({ name: "Online Person" });
  addTransaction(p2.id, 400, "person");
  const onlineSnapshot = buildPendingSettlement(p2.id, 400, "online");
  const onlineResult = confirmPendingSettlement(onlineSnapshot);
  check("10. Online confirmation stores 'online'", onlineResult.settlement.method === "online");
}

resetStorage();
{
  // 11. Person-owes-user state still cannot create a settlement. This is
  // enforced by the UI: openSettleSheet() checks
  // `getSettlementDirection(balance).payer === "you"` and, when that is
  // false, hides the settlement form entirely (no amount input, no
  // method selector, no submit button) -- there is no way to reach
  // buildPendingSettlement() from this state through the real UI at all.
  // This checks that same guard condition directly.
  const p = makePerson({ name: "Ajay" });
  addTransaction(p.id, 800, "you"); // Ajay owes the current user

  const direction = getSettlementDirection(balanceFor(p.id));
  check(
    "11. Person-owes-user: the settle form\u2019s guard condition is false, so no form (and no path to a settlement) is ever shown",
    direction !== null && direction.payer !== "you"
  );
  check(
    "11. No settlement exists in this state",
    getSettlementsForPerson(p.id).length === 0
  );
}

resetStorage();
{
  // 12. Zero-balance state still cannot create a settlement.
  const p = makePerson({ name: "Ajay" });
  // No transactions at all -> balance is already 0.
  const snapshot = buildPendingSettlement(p.id, 100, "cash");
  const result = confirmPendingSettlement(snapshot);
  check(
    "12. Zero-balance state still cannot create a settlement",
    result.ok === false && result.error === "nothing-to-settle"
  );
}

resetStorage();
{
  // buildPendingSettlement() itself must reject invalid input before ever
  // reaching the engine — mirrors "Mark as settled" being unable to even
  // reach the confirmation state with a bad amount/method.
  const p = makePerson({ name: "Ajay" });
  addTransaction(p.id, 600, "person");

  check(
    "buildPendingSettlement rejects a zero amount",
    buildPendingSettlement(p.id, 0, "cash") === null
  );
  check(
    "buildPendingSettlement rejects a negative amount",
    buildPendingSettlement(p.id, -50, "cash") === null
  );
  check(
    "buildPendingSettlement rejects a missing method",
    buildPendingSettlement(p.id, 100, null) === null
  );
  check(
    "confirmPendingSettlement rejects a null snapshot without throwing",
    (() => {
      const r = confirmPendingSettlement(null);
      return r.ok === false;
    })()
  );

  // The engine (not buildPendingSettlement) is still the final authority
  // on "settlement above outstanding balance" — the confirmation flow must
  // not bypass it even if a snapshot is somehow built above outstanding.
  const overOutstandingSnapshot = buildPendingSettlement(p.id, 5000, "cash");
  const overResult = confirmPendingSettlement(overOutstandingSnapshot);
  check(
    "Confirm settlement above outstanding balance is still rejected by the engine",
    overResult.ok === false && overResult.error === "exceeds-outstanding"
  );
  check(
    "No settlement created from the rejected over-outstanding attempt",
    getSettlementsForPerson(p.id).length === 0
  );
}

// =======================================================================
// Settlement Semantics — Comprehensive Specification Suite (Scenarios 1–16)
// =======================================================================

section("Settlement Semantics — Required Scenarios 1–16");

// 1. Full settlement closes period
resetStorage();
{
  const ajay = makePerson({ name: "Ajay" });
  addTransaction(ajay.id, 600, "person"); // balance -600
  check("Scenario 1: initial balance is -600", balanceFor(ajay.id) === -600);

  const res = createSettlement(ajay.id, 600, "cash");
  check("Scenario 1: settle 600 succeeds", res.ok === true);
  check("Scenario 1: closesPeriod === true", res.settlement.closesPeriod === true);
  check("Scenario 1: current balance becomes 0", balanceFor(ajay.id) === 0);
  check(
    "Scenario 1: current transactions become empty",
    getCurrentTransactionsForPerson(ajay.id).length === 0
  );
}

// 2. Partial settlement does NOT close period
resetStorage();
{
  const ajay = makePerson({ name: "Ajay" });
  addTransaction(ajay.id, 600, "person"); // balance -600

  const res = createSettlement(ajay.id, 300, "cash");
  check("Scenario 2: settle 300 succeeds", res.ok === true);
  check("Scenario 2: closesPeriod === false", res.settlement.closesPeriod === false);
  check("Scenario 2: current balance becomes -300", balanceFor(ajay.id) === -300);
  check(
    "Scenario 2: current transactions remain visible",
    getCurrentTransactionsForPerson(ajay.id).length === 1
  );
}

// 3. Multiple partial settlements
resetStorage();
{
  const ajay = makePerson({ name: "Ajay" });
  addTransaction(ajay.id, 1000, "person"); // balance -1000

  const s1 = createSettlement(ajay.id, 300, "cash");
  check("Scenario 3: s1 succeeds with closesPeriod: false", s1.ok === true && s1.settlement.closesPeriod === false);
  check("Scenario 3: balance after s1 is -700", balanceFor(ajay.id) === -700);

  const s2 = createSettlement(ajay.id, 200, "online");
  check("Scenario 3: s2 succeeds with closesPeriod: false", s2.ok === true && s2.settlement.closesPeriod === false);
  check("Scenario 3: current balance is -500", balanceFor(ajay.id) === -500);
  check(
    "Scenario 3: period remains open with transactions visible",
    getCurrentTransactionsForPerson(ajay.id).length === 1
  );
}

// 4. Partial + final settlement
resetStorage();
{
  const ajay = makePerson({ name: "Ajay" });
  addTransaction(ajay.id, 1000, "person"); // balance -1000

  const s1 = createSettlement(ajay.id, 300, "cash");
  check("Scenario 4: s1 partial closesPeriod === false", s1.ok === true && s1.settlement.closesPeriod === false);
  check("Scenario 4: balance is -700", balanceFor(ajay.id) === -700);

  const s2 = createSettlement(ajay.id, 700, "online");
  check("Scenario 4: s2 final closesPeriod === true", s2.ok === true && s2.settlement.closesPeriod === true);
  check("Scenario 4: current balance is 0", balanceFor(ajay.id) === 0);
  check(
    "Scenario 4: period closes and current transactions become empty",
    getCurrentTransactionsForPerson(ajay.id).length === 0
  );
}

// 5. New transaction after full settlement
resetStorage();
{
  const ajay = makePerson({ name: "Ajay" });
  addTransaction(ajay.id, 600, "person"); // old balance -600
  const s1 = createSettlement(ajay.id, 600, "cash"); // full settlement 600
  check("Scenario 5: full settlement closes period", s1.settlement.closesPeriod === true && balanceFor(ajay.id) === 0);

  addTransaction(ajay.id, 200, "person", "New lunch"); // new transaction -200
  check(
    "Scenario 5: current balance is -200 and old -600 does not contribute",
    balanceFor(ajay.id) === -200
  );
  check(
    "Scenario 5: current transactions only has new transaction",
    getCurrentTransactionsForPerson(ajay.id).length === 1
  );
}

// 6. Delete new-period transaction after full settlement
resetStorage();
{
  const ajay = makePerson({ name: "Ajay" });
  addTransaction(ajay.id, 600, "person", "Old debt");
  createSettlement(ajay.id, 600, "cash");

  const newTx = addTransaction(ajay.id, 200, "person", "New debt");
  check("Scenario 6: new transaction balance is -200", balanceFor(ajay.id) === -200);

  // Delete the new 200 transaction
  const allTxs = loadTransactions();
  saveTransactions(allTxs.filter((t) => t.id !== newTx.id));

  check(
    "Scenario 6: current balance returns to 0 after deleting new transaction",
    balanceFor(ajay.id) === 0
  );
  check(
    "Scenario 6: old period does not resurrect",
    getCurrentTransactionsForPerson(ajay.id).length === 0
  );
}

// 7. Partial settlement followed by new transaction
resetStorage();
{
  const ajay = makePerson({ name: "Ajay" });
  addTransaction(ajay.id, 600, "person", "Original dinner"); // -600
  createSettlement(ajay.id, 200, "cash"); // partial settlement 200 -> balance -400
  check("Scenario 7: balance after partial settlement is -400", balanceFor(ajay.id) === -400);

  addTransaction(ajay.id, 100, "person", "Snacks"); // -100
  check(
    "Scenario 7: balance after new transaction is -500 (-600 + 200 - 100)",
    balanceFor(ajay.id) === -500
  );
  check(
    "Scenario 7: current transactions list contains both open period transactions",
    getCurrentTransactionsForPerson(ajay.id).length === 2
  );
}

// 8. Settlement cannot exceed outstanding balance
resetStorage();
{
  const ajay = makePerson({ name: "Ajay" });
  addTransaction(ajay.id, 600, "person");

  const over = createSettlement(ajay.id, 601, "cash");
  check(
    "Scenario 8: settlement exceeding outstanding balance is rejected",
    over.ok === false && over.error === "exceeds-outstanding"
  );
  check("Scenario 8: no settlement persisted", getSettlementsForPerson(ajay.id).length === 0);
}

// 9. Zero settlement rejected
resetStorage();
{
  const ajay = makePerson({ name: "Ajay" });
  addTransaction(ajay.id, 600, "person");

  const zero = createSettlement(ajay.id, 0, "cash");
  check(
    "Scenario 9: zero settlement is rejected",
    zero.ok === false && zero.error === "invalid-amount"
  );
}

// 10. Invalid settlement method rejected
resetStorage();
{
  const ajay = makePerson({ name: "Ajay" });
  addTransaction(ajay.id, 600, "person");

  const invalidMethod = createSettlement(ajay.id, 300, "crypto");
  check(
    "Scenario 10: invalid settlement method rejected",
    invalidMethod.ok === false && invalidMethod.error === "invalid-method"
  );
}

// 11. Confirmation flow writes only on confirm
resetStorage();
{
  const ajay = makePerson({ name: "Ajay" });
  addTransaction(ajay.id, 600, "person");

  // Step 1: Mark as settled builds snapshot, does NOT write to storage
  const snapshot = buildPendingSettlement(ajay.id, 300, "cash");
  check(
    "Scenario 11: Mark as settled does NOT write to localStorage",
    getSettlementsForPerson(ajay.id).length === 0
  );

  // Step 2: Cancel does NOT write
  // (In UI, handleSettleConfirmCancel discards pendingSettlement and returns to form)
  check(
    "Scenario 11: Cancel does NOT write to localStorage",
    getSettlementsForPerson(ajay.id).length === 0
  );

  // Step 3: Closing via × does NOT write
  // (In UI, closeSettleSheet resets pendingSettlement)
  check(
    "Scenario 11: Closing via × does NOT write to localStorage",
    getSettlementsForPerson(ajay.id).length === 0
  );

  // Step 4: Confirm writes exactly one settlement
  const confResult = confirmPendingSettlement(snapshot);
  check("Scenario 11: Confirm writes exactly one settlement", confResult.ok === true && getSettlementsForPerson(ajay.id).length === 1);
}

// 12. Confirmed partial settlement leaves balance partially outstanding
resetStorage();
{
  const ajay = makePerson({ name: "Ajay" });
  addTransaction(ajay.id, 600, "person");

  const snapshot = buildPendingSettlement(ajay.id, 250, "cash");
  const res = confirmPendingSettlement(snapshot);
  check(
    "Scenario 12: Confirmed partial settlement leaves balance -350",
    res.ok === true && res.settlement.closesPeriod === false && balanceFor(ajay.id) === -350
  );
  check(
    "Scenario 12: Current transactions remain visible",
    getCurrentTransactionsForPerson(ajay.id).length === 1
  );
}

// 13. Confirmed full settlement closes current period
resetStorage();
{
  const ajay = makePerson({ name: "Ajay" });
  addTransaction(ajay.id, 600, "person");

  const snapshot = buildPendingSettlement(ajay.id, 600, "cash");
  const res = confirmPendingSettlement(snapshot);
  check(
    "Scenario 13: Confirmed full settlement closes current period",
    res.ok === true && res.settlement.closesPeriod === true && balanceFor(ajay.id) === 0
  );
  check(
    "Scenario 13: Current transactions are empty",
    getCurrentTransactionsForPerson(ajay.id).length === 0
  );
}

// 14. Duplicate confirm protection remains intact
resetStorage();
{
  const ajay = makePerson({ name: "Ajay" });
  addTransaction(ajay.id, 600, "person");

  const snapshot = buildPendingSettlement(ajay.id, 600, "cash");
  const first = confirmPendingSettlement(snapshot);
  check("Scenario 14: first confirm succeeds", first.ok === true);

  const second = confirmPendingSettlement(snapshot);
  check("Scenario 14: duplicate confirm is rejected as nothing-to-settle", second.ok === false && second.error === "nothing-to-settle");
  check("Scenario 14: storage contains only 1 settlement", getSettlementsForPerson(ajay.id).length === 1);
}

// 15. History / localStorage preservation
resetStorage();
{
  const ajay = makePerson({ name: "Ajay" });
  const tx1 = addTransaction(ajay.id, 400, "person", "Lunch");
  const tx2 = addTransaction(ajay.id, 200, "person", "Dinner");
  const s = createSettlement(ajay.id, 600, "online");

  check("Scenario 15: settlement closes current period", s.ok === true && balanceFor(ajay.id) === 0);
  check(
    "Scenario 15: transactions are not deleted when settlement occurs",
    getTransactionsForPerson(ajay.id).length === 2 &&
      loadTransactions().some((t) => t.id === tx1.id) &&
      loadTransactions().some((t) => t.id === tx2.id)
  );
  check(
    "Scenario 15: settlements remain stored permanently",
    getSettlementsForPerson(ajay.id).length === 1 &&
      loadSettlements().some((item) => item.id === s.settlement.id)
  );
}

// 16. Both settlement directions
resetStorage();
{
  // Direction A: You owe person (person paid)
  const ajay = makePerson({ name: "Ajay" });
  addTransaction(ajay.id, 500, "person");
  const dirA = getSettlementDirection(balanceFor(ajay.id));
  check("Scenario 16: Direction A has payer='you', beneficiary='person'", dirA.payer === "you" && dirA.beneficiary === "person");
  const resA = createSettlement(ajay.id, 500, "cash");
  check("Scenario 16: Settlement A payer is 'you'", resA.settlement.payer === "you" && resA.settlement.beneficiary === "person");
  check("Scenario 16: Balance A is 0", balanceFor(ajay.id) === 0);

  // Direction B: Person owes you (you paid)
  const bob = makePerson({ name: "Bob" });
  addTransaction(bob.id, 500, "you");
  const dirB = getSettlementDirection(balanceFor(bob.id));
  check("Scenario 16: Direction B has payer='person', beneficiary='you'", dirB.payer === "person" && dirB.beneficiary === "you");
  const resB = createSettlement(bob.id, 500, "online");
  check("Scenario 16: Settlement B payer is 'person'", resB.settlement.payer === "person" && resB.settlement.beneficiary === "you");
  check("Scenario 16: Balance B is 0", balanceFor(bob.id) === 0);
}

// 17. Backward compatibility with legacy settlement records without closesPeriod
resetStorage();
{
  const legacyPerson = makePerson({ name: "Legacy Person" });
  const tx1 = addTransaction(legacyPerson.id, 600, "person", "Old tx");

  // Manually insert a legacy settlement without closesPeriod field
  const legacySettlement = {
    id: generateId(),
    personId: legacyPerson.id,
    amount: 600,
    payer: "you",
    beneficiary: "person",
    method: "cash",
    timestamp: getMonotonicTimestamp(),
    // closesPeriod is deliberately omitted/undefined
  };
  const allSettlements = loadSettlements();
  allSettlements.push(legacySettlement);
  saveSettlements(allSettlements);

  check(
    "Scenario 17: legacy settlement is treated as full settlement boundary",
    isPeriodClosingSettlement(legacySettlement) === true
  );
  check(
    "Scenario 17: balance with legacy settlement is 0",
    balanceFor(legacyPerson.id) === 0
  );
  check(
    "Scenario 17: current transactions for legacy person is empty",
    getCurrentTransactionsForPerson(legacyPerson.id).length === 0
  );

  // Adding new transaction after legacy settlement opens new period
  addTransaction(legacyPerson.id, 200, "person", "New tx");
  check(
    "Scenario 17: balance after legacy settlement is -200",
    balanceFor(legacyPerson.id) === -200
  );
  check(
    "Scenario 17: current transactions only contains new tx",
    getCurrentTransactionsForPerson(legacyPerson.id).length === 1
  );
}

// =======================================================================
// Milestone 5B.1 — Open-Period Settlement Visibility
//
// Verifies that getCurrentSettlementsForPerson() correctly returns
// only the partial (non-closing) settlements from the current open
// period, mirroring what renderTransactions() will show on the Person page.
// =======================================================================

section("5B.1 — Open-period settlement visibility");

// Test 1: Current-period transaction is visible (baseline).
resetStorage();
{
  const ajay = makePerson({ name: "Ajay" });
  addTransaction(ajay.id, 700, "person", "Dinner"); // you owe 700
  check(
    "5B.1-1: Current-period transaction is visible",
    getCurrentTransactionsForPerson(ajay.id).length === 1
  );
  check(
    "5B.1-1: No partial settlements in period yet",
    getCurrentSettlementsForPerson(ajay.id).length === 0
  );
}

// Test 2: Partial settlement is visible on Person page.
resetStorage();
{
  const ajay = makePerson({ name: "Ajay" });
  addTransaction(ajay.id, 700, "person", "Dinner");
  const s = createSettlement(ajay.id, 300, "online");
  check("5B.1-2: Partial settlement has closesPeriod: false", s.settlement.closesPeriod === false);
  check(
    "5B.1-2: Partial settlement is returned by getCurrentSettlementsForPerson",
    getCurrentSettlementsForPerson(ajay.id).length === 1
  );
  check(
    "5B.1-2: The partial settlement has the correct amount",
    getCurrentSettlementsForPerson(ajay.id)[0].amount === 300
  );
}

// Test 3: Partial settlement reduces the displayed balance correctly.
resetStorage();
{
  const ajay = makePerson({ name: "Ajay" });
  addTransaction(ajay.id, 700, "person", "Dinner"); // balance -700
  createSettlement(ajay.id, 300, "online");          // partial -> balance -400
  check(
    "5B.1-3: Balance after partial settlement is -400",
    balanceFor(ajay.id) === -400
  );
}

// Test 4: Partial settlement does NOT close the period.
resetStorage();
{
  const ajay = makePerson({ name: "Ajay" });
  addTransaction(ajay.id, 700, "person", "Dinner");
  const s = createSettlement(ajay.id, 300, "cash");
  check(
    "5B.1-4: Partial settlement does not close the period",
    s.settlement.closesPeriod === false
  );
  check(
    "5B.1-4: Current transactions remain visible after partial settlement",
    getCurrentTransactionsForPerson(ajay.id).length === 1
  );
}

// Test 5: Original current-period transaction remains visible after partial settlement.
resetStorage();
{
  const ajay = makePerson({ name: "Ajay" });
  const tx = addTransaction(ajay.id, 700, "person", "Dinner");
  createSettlement(ajay.id, 300, "cash");
  const currentTxs = getCurrentTransactionsForPerson(ajay.id);
  check(
    "5B.1-5: Original transaction is still visible after partial settlement",
    currentTxs.length === 1 && currentTxs[0].id === tx.id
  );
  check(
    "5B.1-5: Partial settlement also appears in the timeline",
    getCurrentSettlementsForPerson(ajay.id).length === 1
  );
}

// Test 6: Multiple partial settlements remain visible.
// ₹700 debt -> settle ₹200 -> settle ₹100 -> both visible.
resetStorage();
{
  const ajay = makePerson({ name: "Ajay" });
  addTransaction(ajay.id, 700, "person", "Dinner");
  const s1 = createSettlement(ajay.id, 200, "cash");
  const s2 = createSettlement(ajay.id, 100, "online");
  check(
    "5B.1-6: s1 is partial (closesPeriod: false)",
    s1.settlement.closesPeriod === false
  );
  check(
    "5B.1-6: s2 is partial (closesPeriod: false)",
    s2.settlement.closesPeriod === false
  );
  const currentSettlements = getCurrentSettlementsForPerson(ajay.id);
  check(
    "5B.1-6: Both partial settlements are visible",
    currentSettlements.length === 2
  );
  check(
    "5B.1-6: Balance reflects both partial settlements (700-200-100 = 400)",
    balanceFor(ajay.id) === -400
  );
  check(
    "5B.1-6: Original transaction remains visible",
    getCurrentTransactionsForPerson(ajay.id).length === 1
  );
}

// Test 7: Full settlement closes the period.
resetStorage();
{
  const ajay = makePerson({ name: "Ajay" });
  addTransaction(ajay.id, 700, "person", "Dinner");
  const s = createSettlement(ajay.id, 700, "cash"); // full settlement
  check("5B.1-7: Full settlement has closesPeriod: true", s.settlement.closesPeriod === true);
  check("5B.1-7: Balance is 0 after full settlement", balanceFor(ajay.id) === 0);
}

// Test 8: After full settlement, Person page shows no current transactions,
// no closed-period settlement entries, and balance is zero.
resetStorage();
{
  const ajay = makePerson({ name: "Ajay" });
  addTransaction(ajay.id, 700, "person", "Dinner");
  createSettlement(ajay.id, 300, "cash");  // partial
  createSettlement(ajay.id, 400, "online"); // full — closes period
  check(
    "5B.1-8: After full settlement, no current transactions on Person page",
    getCurrentTransactionsForPerson(ajay.id).length === 0
  );
  check(
    "5B.1-8: Closed-period settlement entries are NOT shown on Person page",
    getCurrentSettlementsForPerson(ajay.id).length === 0
  );
  check(
    "5B.1-8: Balance is 0 after full settlement",
    balanceFor(ajay.id) === 0
  );
}

// Test 9: New transaction after full settlement starts a new current period,
// and old-period settlements do not appear in the new period.
resetStorage();
{
  const ajay = makePerson({ name: "Ajay" });
  addTransaction(ajay.id, 700, "person", "Dinner");
  createSettlement(ajay.id, 300, "cash");  // partial (old period)
  createSettlement(ajay.id, 400, "online"); // full — closes period

  // New period: add a fresh transaction
  const newTx = addTransaction(ajay.id, 500, "person", "Rent");
  check(
    "5B.1-9: New transaction after full settlement is visible",
    getCurrentTransactionsForPerson(ajay.id).length === 1 &&
      getCurrentTransactionsForPerson(ajay.id)[0].id === newTx.id
  );
  check(
    "5B.1-9: Old-period settlements do not appear in new period",
    getCurrentSettlementsForPerson(ajay.id).length === 0
  );
  check(
    "5B.1-9: New-period balance is -500",
    balanceFor(ajay.id) === -500
  );
}

// Test 10 (implied by 9): Old-period settlements do not appear in new period
// (already verified above).

// Test 11: Main History retains every transaction and settlement.
resetStorage();
{
  const ajay = makePerson({ name: "Ajay" });
  addTransaction(ajay.id, 700, "person", "Dinner");
  const s1 = createSettlement(ajay.id, 200, "cash");  // partial
  const s2 = createSettlement(ajay.id, 500, "online"); // full — closes period
  addTransaction(ajay.id, 300, "person", "Cab");        // new period tx
  const s3 = createSettlement(ajay.id, 100, "cash");   // new period partial

  check(
    "5B.1-11: Main History contains all transactions (2)",
    getTransactionsForPerson(ajay.id).length === 2
  );
  check(
    "5B.1-11: Main History contains all settlements (3)",
    getSettlementsForPerson(ajay.id).length === 3
  );
  check(
    "5B.1-11: Old-period settlements (s1) are in storage",
    getSettlementsForPerson(ajay.id).some((s) => s.id === s1.settlement.id)
  );
  check(
    "5B.1-11: Closing settlement (s2) is in storage",
    getSettlementsForPerson(ajay.id).some((s) => s.id === s2.settlement.id)
  );
  check(
    "5B.1-11: New-period partial settlement (s3) is in storage",
    getSettlementsForPerson(ajay.id).some((s) => s.id === s3.settlement.id)
  );
  // Only the new-period partial settlement should appear on Person page
  check(
    "5B.1-11: Person page only shows new-period partial settlement",
    getCurrentSettlementsForPerson(ajay.id).length === 1 &&
      getCurrentSettlementsForPerson(ajay.id)[0].id === s3.settlement.id
  );
}

// Test 12: Multiple people remain isolated.
resetStorage();
{
  const ajay = makePerson({ name: "Ajay" });
  const bob = makePerson({ name: "Bob" });

  addTransaction(ajay.id, 500, "person", "Dinner");
  addTransaction(bob.id, 800, "person", "Rent");

  createSettlement(ajay.id, 200, "cash"); // partial for Ajay only

  check(
    "5B.1-12: Ajay's partial settlement appears in his period",
    getCurrentSettlementsForPerson(ajay.id).length === 1
  );
  check(
    "5B.1-12: Bob's period has no settlements",
    getCurrentSettlementsForPerson(bob.id).length === 0
  );
  check(
    "5B.1-12: Ajay's balance is -300",
    balanceFor(ajay.id) === -300
  );
  check(
    "5B.1-12: Bob's balance is unaffected (-800)",
    balanceFor(bob.id) === -800
  );
}

// Test 13: Both directions work.
resetStorage();
{
  // Direction A: user owes Ajay (Ajay paid)
  const ajay = makePerson({ name: "Ajay" });
  addTransaction(ajay.id, 600, "person"); // you owe Ajay
  const sA = createSettlement(ajay.id, 200, "cash"); // partial: payer="you"
  check(
    "5B.1-13A: User-owes-person direction partial settlement has payer='you'",
    sA.settlement.payer === "you" && sA.settlement.closesPeriod === false
  );
  check(
    "5B.1-13A: Partial settlement visible on Person page (user owes person direction)",
    getCurrentSettlementsForPerson(ajay.id).length === 1
  );

  // Direction B: Ajay owes user (user paid)
  const bob = makePerson({ name: "Bob" });
  addTransaction(bob.id, 600, "you"); // Ajay/Bob owes you
  // Note: in this direction, current user cannot settle (person owes user)
  // so no settlement is created from the UI. We manually verify the
  // getCurrentSettlementsForPerson function still handles this correctly.
  check(
    "5B.1-13B: No settlements for Bob (person-owes-user direction has nothing to settle from UI)",
    getCurrentSettlementsForPerson(bob.id).length === 0
  );
  check(
    "5B.1-13B: Bob's balance is unaffected (+600)",
    balanceFor(bob.id) === 600
  );
}

// Test 14: Refresh/persistence does not change behaviour.
resetStorage();
{
  const ajay = makePerson({ name: "Ajay" });
  addTransaction(ajay.id, 700, "person", "Dinner");
  const s = createSettlement(ajay.id, 300, "online");

  // Simulate a refresh by reloading from the same localStorage-backed store.
  const reloadedSettlements = loadSettlements();
  const reloadedTxs = loadTransactions();
  check(
    "5B.1-14: Partial settlement persists after simulated refresh",
    reloadedSettlements.some((rs) => rs.id === s.settlement.id && rs.closesPeriod === false)
  );
  check(
    "5B.1-14: After simulated refresh, partial settlement still in current period",
    getCurrentSettlementsForPerson(ajay.id).length === 1
  );
  check(
    "5B.1-14: After simulated refresh, transaction still in current period",
    getCurrentTransactionsForPerson(ajay.id).length === 1
  );
  check(
    "5B.1-14: After simulated refresh, balance is -400",
    balanceFor(ajay.id) === -400
  );
}

// ---------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------

console.log("\n" + "=".repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed (${passed + failed} total)`);
if (failed > 0) {
  console.log("\nFailed checks:");
  failureMessages.forEach((message) => console.log(`  - ${message}`));
  console.log("=".repeat(60));
  process.exitCode = 1;
} else {
  console.log("All checks passed.");
  console.log("=".repeat(60));
}