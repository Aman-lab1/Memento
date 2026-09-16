# Memento — Product Definition

## 1. Product

Memento is a private person-to-person money ledger.

It helps people remember:

- who paid
- who owes whom
- what the payment was for
- when it happened
- what has been settled
- what has been edited

Memento is not:

- a bank
- a wallet
- a UPI application
- a payment processor
- a traditional expense tracker

The core idea is:

> Memento remembers the money between people.

---

## 2. Core Concept

The primary object in Memento is a relationship between two people.

Example:

Aman ↔ Jai

Transactions belong to this relationship.

If:

- Aman pays ₹500 for Jai
- Jai pays ₹200 for Aman
- Aman pays ₹100 for Jai

Then the derived balance is:

Jai owes Aman ₹400.

The balance must always be derived from transaction history.

Users must not directly edit a balance.

---

## 3. Users

Memento is initially designed for individuals such as:

- friends
- classmates
- roommates
- couples
- colleagues
- small groups of people who regularly share expenses

The initial product is India-focused.

---

## 4. Account and Authentication

Memento V1 uses:

- phone number
- password

for account authentication.

There is no OTP requirement in V1.

There is no email requirement in V1.

There is no Twilio dependency in V1.

The phone number acts as the user's login identifier.

The user's display name is separate from authentication.

Example:

Phone number:
+91 XXXXX XXXXX

Display name:
Aman

Multiple users may have the same display name.

Authentication identity is provided by Supabase Auth.

Each authenticated user receives a unique Supabase user ID.

---

## 5. Profile

Each Memento user has a profile containing information such as:

- display name
- phone number through the authenticated identity
- creation timestamp

The display name is what other connected users see.

The phone number is used for authentication and should not automatically be exposed to other users.

---

## 6. Adding People

A user can create a person/relationship in Memento.

A person does not necessarily need to already have a Memento account.

Example:

Aman adds:

Jai

Aman can begin maintaining the relationship ledger.

---

## 7. Invitations

Memento V1 does not depend on SMS or email invitations.

Instead, Memento generates a unique invitation link.

Example:

memento.app/invite/<unique-token>

The user can share the link using the device's native share functionality.

Possible destinations include:

- WhatsApp
- Messenger
- Telegram
- SMS
- Copy link
- other supported sharing applications

Memento does not need to control the external messaging application.

---

## 8. Connecting Users

If the invited person already has a Memento account, they can open the invitation and accept it.

If they do not have an account, they can create one and then accept the invitation.

Once accepted:

Aman ↔ Jai

becomes a connected Memento relationship.

The existing ledger can then become shared according to the authorization rules defined by the system.

The invited user should not need to manually search for or recreate the relationship.

---

## 9. Transactions

A transaction records money paid by one person for another person.

Example:

Aman paid ₹500 for Jai.

The transaction records:

- amount
- payer
- beneficiary/owed-by person
- description/reason
- timestamp
- unique transaction ID
- relationship

Transactions are historical records.

They should not be silently deleted or rewritten.

---

## 10. Balance

The balance is calculated from transaction history.

Example:

Aman pays ₹500 for Jai.

Balance:

Jai owes Aman ₹500.

If Jai later pays ₹200 for Aman:

Balance:

Jai owes Aman ₹300.

The balance is derived.

There is no manually editable "balance" field.

---

## 11. Settlement

A settlement is a separate recorded event.

Example:

Jai pays Aman ₹300.

Memento records the settlement.

The original transactions remain in the history.

Settlement does not delete transactions.

This preserves the history of what happened.

---

## 12. Editing

Transactions may eventually be editable.

Edits must be auditable.

An edit should preserve:

- original values
- new values
- editor
- timestamp
- transaction ID

Memento must never silently change financial history.

---

## 13. Notifications

Memento will eventually have its own notification system.

Examples:

- Aman added a transaction
- Jai added a transaction
- Aman edited a transaction
- Jai edited a transaction
- a transaction was settled
- the relationship balance changed

Notifications should exist inside Memento.

The PWA may also provide push notifications when the application is closed, subject to browser/OS support and user permission.

Twilio/SMS is not required for these notifications.

---

## 14. Privacy

Financial information is private by default.

A user must not be able to access another user's transactions simply by manipulating frontend requests or IDs.

Authorization must be enforced at the database level.

Supabase Row Level Security (RLS) is a core part of the security model.

The frontend is never considered trusted.

---

## 15. PWA

Memento is a Progressive Web App.

It should be:

- mobile-first
- installable
- responsive
- usable on desktop browsers
- capable of receiving web push notifications in supported environments

The service worker provides the PWA foundation.

Offline transaction creation and synchronization are not part of the initial implementation.

Supabase remains the source of truth.

---

## 16. V1 Priorities

V1 should focus on:

1. Account creation and login
2. Session persistence
3. User profile
4. PWA foundation
5. Adding people
6. Invitation links
7. Connected relationships
8. Adding transactions
9. Transaction history
10. Derived balances
11. Settlements
12. Privacy and RLS
13. In-app notifications
14. PWA push notifications

---

## 17. Not V1

Do not build initially:

- Twilio SMS
- OTP authentication
- email authentication
- email invitations
- WhatsApp API
- UPI payments
- payment processing
- bank integration
- business accounts
- invoices
- advanced analytics
- complex offline synchronization
- AI features

These may be considered later.

---

## 18. Product Philosophy

Memento should feel:

- simple
- calm
- trustworthy
- human
- private
- lightweight
- reliable

It should not feel like:

- a banking application
- an accounting application
- a corporate finance dashboard
- a social network

The interface should make recording and understanding money between people feel effortless.

---

## 19. Core Principle

Memento does not move money.

Memento remembers money.

The application records what happened and derives what is currently owed.