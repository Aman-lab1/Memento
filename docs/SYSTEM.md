# Memento — System Definition

## 1. Architecture

Initial stack:

- HTML
- CSS
- JavaScript
- Supabase
- PostgreSQL
- Supabase Auth
- PWA

The frontend should remain lightweight and modular.

Avoid introducing React/Next.js unless the complexity of the product genuinely requires it.

---

## 2. High-Level Flow

User
↓
Memento UI
↓
Application Logic
↓
Supabase Client
↓
Supabase Auth / PostgreSQL
↓
Row Level Security

The frontend is never considered trusted.

Database security must independently enforce authorization.

---

## 3. Core Data Objects

Initial conceptual objects:

User
Person
Relationship
Transaction
Invitation
Audit Log

Possible future objects:

Settlement
Notification
Business
Invoice
Group

Do not create future tables until they are required.

---

## 4. User Identity

Authentication identity and display identity are separate.

Authentication:

- Supabase Auth
- Phone number / OTP

Application identity:

- Internal user ID
- Display name
- Other profile information

Phone number should not be treated as the permanent internal identity.

---

## 5. Relationship

A relationship connects two people.

Conceptually:

User A
↕
Relationship
↕
User B

Before User B registers:

User A
↕
Relationship
↕
Unregistered Person

After User B accepts an invitation:

Existing relationship
↓
Linked to User B
↓
Shared relationship

The existing transaction history must remain intact.

---

## 6. Transaction Model

Every transaction receives a unique ID.

A transaction belongs to exactly one relationship.

Conceptually:

Transaction

- id
- relationship_id
- created_by
- payer
- beneficiary
- amount
- note
- payment_method
- occurred_at
- created_at
- updated_at

The exact database types and constraints will be finalized before implementation.

---

## 7. Balance Calculation

Balance is derived from transactions.

Never allow the frontend to simply set:

balance = ₹500

Instead:

transactions
↓
calculation
↓
current balance

Example:

Aman → Jai ₹500
Jai → Aman ₹200
Aman → Jai ₹100

Net:

Jai owes Aman ₹400.

The exact mathematical representation will be finalized before implementation.

---

## 8. Settlement

Settlement is another recorded financial event.

It does not:

- Delete transactions
- Modify historical transactions
- Reset the database balance manually

Instead:

Previous transactions
+
Settlement
↓
New calculated balance

Example:

Balance = Jai owes Aman ₹400

Settlement:

Jai pays Aman ₹400

New calculated balance = ₹0

---

## 9. Editing

Transactions should not be silently overwritten.

When an important transaction value changes, the system should preserve an audit record.

Example:

Transaction T123

Original:
₹500

Edited:
₹450

Audit:

- Transaction: T123
- Changed by: User A
- Old value: ₹500
- New value: ₹450
- Changed at: timestamp

The exact audit implementation will be designed before coding.

---

## 10. Invitations

Invitation flow:

User A
↓
Selects Person
↓
Generate invitation
↓
Person receives link/message
↓
Person opens Memento
↓
Registers
↓
Accepts invitation
↓
System identifies intended relationship
↓
Existing relationship becomes connected
↓
Both users can access the shared ledger

Important:

The invited user must not accidentally create a duplicate relationship.

The connection process must be idempotent.

---

## 11. Authorization

Every database operation must respect authorization.

A user may access:

- Their own account
- Relationships they are part of
- Transactions belonging to authorized relationships
- Invitations relevant to them

A user must NOT be able to access another user's private relationships or transactions by changing an ID in a request.

Supabase Row Level Security will enforce this.

---

## 12. Offline Behavior

Offline support should not be treated as simple localStorage caching.

Potential model:

Online:
UI → Supabase → confirmed data

Offline:
UI → local pending operation
↓
connection restored
↓
sync
↓
server confirmation

Conflict handling must be explicitly designed before implementing offline writes.

V1 may initially prioritize reliable online behavior over complex offline synchronization.

---

## 13. Source of Truth

For connected relationships:

Supabase database = source of truth.

Local browser storage = cache / temporary offline state.

The client must not be able to permanently override server data without authorization.

---

## 14. Reliability Principles

Money-related operations must prioritize:

1. Correctness
2. Security
3. Consistency
4. Auditability
5. Recoverability
6. User experience

A visually impressive feature should never be implemented at the cost of financial correctness.

---

## 15. Development Rule

Do not code a feature until its behavior is defined.

For every important feature:

Requirement
↓
User flow
↓
Business rule
↓
Data model
↓
Security rule
↓
Implementation
↓
Testing

AI-generated code must follow the documented system rather than define the system itself.