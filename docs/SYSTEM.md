# Memento — System Architecture

## 1. Architecture

Memento V1 is a mobile-first Progressive Web App.

Frontend:

- HTML
- CSS
- Vanilla JavaScript

Backend/platform:

- Supabase
- Supabase Auth
- PostgreSQL
- Row Level Security (RLS)

PWA:

- Web App Manifest
- Service Worker
- Web Push in a later implementation stage

No frontend framework is required for V1.

---

## 2. Core Architecture Principle

The system follows:

Frontend
→ Supabase
→ PostgreSQL

The frontend is not trusted.

The database and authorization rules determine what data a user is allowed to access.

The UI displays the state of the system.

The UI must never be the authority for financial data.

---

## 3. Authentication

Memento V1 uses:

Phone number + password

Supabase Auth manages authentication.

There is no OTP authentication in V1.

There is no Twilio dependency.

There is no email authentication in V1.

Authentication provides a unique:

auth.uid()

for each user.

This ID is the foundation for authorization.

---

## 4. User Identity

A user's identity has two layers:

### Authentication identity

Managed by Supabase Auth.

Contains the authenticated user's unique UUID and authentication credentials.

### Memento profile

Stored in the application's database.

Conceptually:

profiles

- id
- display_name
- created_at

The profile ID corresponds to auth.users.id.

The display name is not guaranteed to be unique.

Example:

User A:
display_name = Aman

User B:
display_name = Aman

They remain different users because their authentication IDs are different.

---

## 5. Phone Number

The phone number is used as the authentication identifier in V1.

The application should not expose a user's phone number to other users by default.

Phone number storage and visibility must follow Supabase Auth and application privacy rules.

---

## 6. Session Management

Supabase manages authenticated sessions.

On application startup:

1. Check for an existing session.
2. If no session exists, show authentication.
3. If a session exists, obtain the authenticated user.
4. Load the user's Memento profile.
5. Show the authenticated application.

Authentication state changes should be handled through Supabase's authentication state listener.

Users should remain logged in across normal page refreshes and browser restarts according to Supabase session behavior.

---

## 7. Database Objects

The system will eventually contain objects such as:

### profiles

Stores Memento user profile information.

### people / relationships

Represents a connection or ledger between users.

### transactions

Stores individual financial events.

### settlements

Stores settlement events separately from original transactions.

### invitations

Stores invitation tokens and their lifecycle.

### notifications

Stores in-app notification records.

### audit records

Stores changes to financial records where required.

The exact schema should be introduced incrementally as each feature is implemented.

Do not create unnecessary tables before they are required.

---

## 8. Relationships

The core business relationship is:

User A ↔ User B

Transactions belong to a relationship.

A relationship may initially contain an unregistered person.

When the invited person creates/uses a Memento account and accepts the invitation, the relationship can be associated with the authenticated user.

The system must prevent unauthorized users from accessing a relationship.

---

## 9. Transactions

A transaction represents:

Person A paid money for Person B.

Conceptually:

transaction

- id
- relationship_id
- payer_id/person reference
- beneficiary_id/person reference
- amount
- description
- created_at
- created_by

Transaction IDs must be unique.

Transactions represent historical events.

They must not be used as mutable balance records.

---

## 10. Balance Calculation

Balance must be derived from transactions and settlements.

Never store a manually editable current balance as the source of truth.

Conceptually:

Balance =
money owed through transactions
minus
applicable settlements

The exact calculation must be implemented centrally and consistently.

The same transaction history must produce the same balance regardless of frontend device.

---

## 11. Settlements

Settlements are separate records.

A settlement does not delete or overwrite the transactions that caused the balance.

Example:

Transaction:
Aman paid ₹500 for Jai.

Settlement:
Jai settled ₹500 with Aman.

Both events remain in history.

---

## 12. Editing and Auditability

Financial records must not be silently modified.

When transaction editing is introduced, the system should preserve:

- transaction ID
- original value
- updated value
- editor
- edit timestamp

Depending on implementation, this may be stored in an audit table or equivalent immutable history structure.

The system must be able to explain how a displayed balance was produced.

---

## 13. Authorization and RLS

Row Level Security is mandatory.

Every private database table must have appropriate RLS policies.

Authorization must be based on authenticated identity and relationship membership.

Example:

Aman:

Can access:
- Aman's own profile
- relationships Aman belongs to
- transactions belonging to authorized relationships

Cannot access:
- unrelated users' private profiles
- unrelated relationships
- unrelated transactions

The frontend must never be responsible for enforcing these boundaries.

---

## 14. Invitations

Invitations use unique tokens.

Conceptually:

invitation

- id
- relationship_id
- token
- created_by
- status
- expires_at
- created_at

The invitation link contains a token.

The token must not itself grant unrestricted database access.

Opening an invitation and accepting an invitation are separate concepts.

Authorization must be checked when the invitation is accepted.

---

## 15. Notification Architecture

Memento has two notification layers.

### In-app notifications

Stored in the database.

Examples:

- new transaction
- transaction edit
- settlement
- balance-related event

### PWA push notifications

May notify the user when the PWA is not currently open.

Possible architecture:

Database event
→ backend/Edge Function
→ Web Push service
→ user's browser/device

Push notification delivery is separate from transaction truth.

Failure to deliver a push notification must never change or invalidate the underlying transaction.

---

## 16. PWA Architecture

Memento includes:

manifest.json
sw.js

The service worker is responsible for the PWA shell and future push functionality.

Initial service worker functionality may include:

- app shell caching
- controlled cache updates
- basic offline loading of static application resources

Offline financial writes are not initially supported.

Supabase remains the source of truth.

---

## 17. Offline Strategy

Offline support is deliberately limited in early versions.

The initial PWA may cache static resources so the application shell can load.

Do not treat cached data as authoritative financial state.

If offline transaction creation is introduced later, it must use an explicit pending/synchronization model, likely backed by IndexedDB.

localStorage must not be treated as a financial database.

---

## 18. External Services

V1 should minimize external dependencies.

Required:

- Supabase

Not required:

- Twilio
- email provider
- WhatsApp API
- payment provider
- UPI API

Native device sharing can be used for invitation links.

Future notification infrastructure may introduce Web Push-related services as necessary.

---

## 19. Frontend Configuration

Public Supabase client configuration may be exposed to the browser as intended by Supabase's client architecture.

Never expose:

- service-role keys
- database passwords
- private server secrets

The application deployment/configuration system must keep secrets out of the frontend and out of Git.

---

## 20. Development Strategy

Memento is developed using vertical slices.

For each feature:

1. Define user experience
2. Define user flow
3. Define database requirements
4. Define authorization rules
5. Implement backend/database
6. Implement frontend
7. Test the complete flow
8. Polish

Frontend and backend should evolve together.

Do not build the entire frontend first and postpone backend/security.

---

## 21. Reliability Principle

The system must prioritize correctness over convenience.

Especially for financial records:

- do not silently mutate history
- do not manually manipulate balances
- do not trust client-provided authorization
- do not rely on hidden UI controls for security
- do not use local storage as the source of truth
- do not claim a transaction succeeded unless the backend confirms it

---

## 22. Core System Principle

The database stores what happened.

The business logic derives what is owed.

The frontend displays the result.

The user decides what action to take.

Memento records and remembers the relationship.