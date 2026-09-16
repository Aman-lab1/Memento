# Memento — Product Definition

## 1. Product

Memento is a simple, private shared-money ledger for people.

It helps people remember money exchanged between them:
who paid, who owes, what the payment was for, and whether it has been settled.

### Core idea

> Memento remembers the money between people.

Memento is not a bank, wallet, UPI app, or traditional expense tracker.

It is a memory and record of financial interactions between people.

---

## 2. The Problem

People frequently pay for each other.

Examples:

- Aman pays ₹500 for dinner.
- Jai pays ₹200 for a cab.
- A friend buys movie tickets for everyone.
- A roommate pays the electricity bill.
- Someone says "I'll pay you back later."

The problem is rarely the payment itself.

The problem is remembering what happened afterward.

People forget:

- who paid
- how much they paid
- what it was for
- whether they already repaid someone
- whether a previous payment was included in the calculation

This creates unnecessary mental effort and awkward conversations.

Memento should remove that mental burden.

---

## 3. Target Users

Initially:

- Friends
- Classmates
- Roommates
- Couples
- Small groups of people who frequently pay for each other

Later:

- Small businesses
- Customers
- Vendors
- Informal credit/outstanding tracking

V1 should focus on person-to-person relationships.

---

## 4. Product Philosophy

Memento should feel:

- Simple
- Calm
- Human
- Cozy
- Trustworthy
- Private
- Lightweight
- Unintrusive

The user should not feel like they are using accounting software.

The interface should make money tracking feel as simple as remembering a conversation.

---

## 5. Core Concept: Relationship

The fundamental object in Memento is not an expense.

It is a relationship between two people.

Example:

Aman ↔ Jai

Inside that relationship exists a history of financial interactions.

Example:

Aman paid ₹500 for Jai
Jai paid ₹200 for Aman
Aman paid ₹100 for Jai

The current balance is calculated from this history.

---

## 6. Balance

Memento must calculate balances from transaction history.

It should NOT rely on a manually editable balance.

Example:

Aman pays for Jai: +₹500

Jai pays for Aman: -₹200

Aman pays for Jai: +₹100

Current result:

Jai owes Aman ₹400.

The transaction history remains the source of truth.

---

## 7. Transactions

A transaction records a real financial interaction.

A transaction should contain, at minimum:

- Unique transaction ID
- Relationship ID
- Creator
- Payer
- Person it was for
- Amount
- Note
- Payment method
- Date/time
- Creation timestamp

Additional fields can be introduced later.

---

## 8. Settlement

Settlement does not erase history.

Example:

Jai owes Aman ₹400.

Jai pays Aman ₹400.

Memento records this as a settlement transaction.

The previous ₹500, ₹200 and ₹100 transactions remain visible.

The current balance becomes ₹0.

History should always remain understandable.

---

## 9. People vs Connected Users

A user can add someone who does not have a Memento account.

Example:

Aman adds:

Jai
+91 XXXXX XXXXX

Aman can immediately record transactions with Jai.

Jai does not need an account for this.

Later, Aman can invite Jai.

If Jai registers and accepts the invitation:

Aman and Jai become connected.

Their existing relationship should be preserved and become a shared relationship.

Jai should NOT need to manually add Aman again.

---

## 10. Connected Relationships

Once two users are connected:

Both users can:

- View the shared transaction history
- View the current balance
- Add transactions
- Add settlements
- Receive relevant updates
- Share the relationship summary

Both users should see the same underlying financial history.

The database should remain the source of truth.

---

## 11. Trust

Money-related data must never change silently.

If a transaction is edited:

Example:

₹500 → ₹450

Memento should preserve:

- Original value
- New value
- Who changed it
- When it was changed
- Transaction ID

The other person may also be notified.

The exact notification mechanism can be decided later.

---

## 12. Privacy

Financial relationships are private.

A user should only be able to access data they are authorized to access.

Security must not depend on hiding UI elements.

Database-level authorization must enforce access.

---

## 13. V1

V1 should include:

- Account creation
- Phone authentication
- User identity
- Add person
- Person/relationship list
- Add transaction
- Transaction history
- Automatic balance calculation
- Settlement
- Invite
- Accept connection
- Shared relationship
- Basic sharing
- PWA installation
- Supabase backend
- Database security

---

## 14. Not V1

Do not build these unless they become necessary:

- Direct UPI payments
- Banking integration
- Automated WhatsApp messaging
- Business accounts
- Invoices
- Groups
- Advanced analytics
- Complex categories
- AI features
- Subscription system

These can be considered later.

---

## 15. Success Criteria

Memento succeeds if a user can answer these questions immediately:

> Who owes me money?

> Whom do I owe?

> Why?

> How much?

> What happened previously?

> Is everything settled?

The product should make those answers obvious without making the user think about accounting.