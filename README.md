# Memento

Memento remembers the money between people.

A small, mobile-first PWA for tracking informal shared expenses with the
people in your life — who paid for what, who owes whom, and how it got
settled. No accounts, no bank linking, no server: everything lives on your
device.

<p>
  <img src="icons/icon-192.png" width="72" height="72" alt="Memento app icon" />
</p>

## Features

- **People** — add, edit, and remove the people you split money with.
- **Transactions** — log who paid for what, with a running balance per
  person.
- **Settlements** — record cash or online settlements. Supports both
  **partial** settlements (the debt stays open, reduced) and **full**
  settlements (the period closes cleanly).
- **Current period vs. permanent history**
  - The **Person page** always shows only the *current* open period — once
    a full settlement clears a balance to zero, old transactions from that
    period disappear from view (they're not deleted).
  - The **History page** is the permanent, chronological record of every
    transaction and settlement, across every person, forever.
- **Local-first** — all data is stored in `localStorage` on-device. Nothing
  is sent anywhere.
- **Installable PWA** — has a web app manifest and icons; can be added to
  a phone's home screen.
- **Mobile-first design** — a calm, monochrome, iOS-like interface with
  bottom sheets, safe-area-aware layout, and no build step required.

## Tech stack

Deliberately minimal — no framework, no bundler, no backend:

- Plain HTML, CSS, and JavaScript (`src/app.js`, `src/style.css`)
- Browser `localStorage` as the single source of truth
- A [Web App Manifest](manifest.json) for installability
- A placeholder [service worker](sw.js) (present but not yet registered —
  offline support is a future milestone)

## Project structure

```
.
├── index.html            # Home — list of people, entry point
├── manifest.json         # PWA manifest
├── sw.js                 # Service worker placeholder (not yet registered)
├── icons/
│   ├── icon-192.png
│   └── icon-512.png
├── pages/
│   ├── add-person.html   # Add a new person
│   ├── person.html       # Person detail: balance, transactions, settle
│   └── history.html      # Permanent history across all people
├── src/
│   ├── app.js            # All app logic: storage, balance/settlement
│   │                      # engine, and per-page UI wiring
│   └── style.css         # Design system + component styles
└── tests/
    └── test.js           # Node test suite for the data/engine layer
```

## Getting started

There's no build step — it's static HTML/CSS/JS. Serve the project root
with any static file server (opening `index.html` directly via `file://`
will mostly work, but the manifest and relative paths behave more
reliably over `http://`):

```bash
# using Node
npx serve .

# or using Python
python3 -m http.server 8000
```

Then open the printed local URL in your browser (or on your phone, on the
same network, to test the installable/PWA experience).

## Data model

Everything lives under three `localStorage` keys:

| Key | Shape |
|---|---|
| `memento:people` | `{ id, name, phone, createdAt }[]` |
| `memento:transactions` | `{ id, personId, amount, payer, beneficiary, purpose, timestamp, updatedAt? }[]` |
| `memento:settlements` | `{ id, personId, amount, payer, beneficiary, method, timestamp, closesPeriod }[]` |

- `payer` / `beneficiary` are always `"you"` or `"person"`.
- A settlement's `closesPeriod` is `true` when it fully clears the
  outstanding balance at the time it's created; a settlement missing
  `closesPeriod` entirely (legacy data) is treated as `true` for backward
  compatibility.
- Balance is always **derived** from transactions + settlements — it's
  never stored directly, so it can't drift out of sync.

## Testing

The engine layer (storage, balance calculation, settlement rules,
current-period filtering) is unit tested with a small, dependency-free
Node test suite:

```bash
node tests/test.js
```

`src/app.js` exports its pure functions via `module.exports` (guarded so
it's a no-op in the browser) specifically so this layer can be tested
without a DOM. Page-wiring functions (the `setup*Page()` functions) are
DOM-driven and are verified manually in-browser instead.

## Roadmap

Intentionally **not** in the current version — these are later
milestones, not missing features:

- Search and history filters (e.g. by person)
- Analytics / charts / spending categories
- Reminders and notifications
- UPI / payment integration
- Cloud sync (e.g. Supabase) and multi-device support
- Authentication and invitations (currently, adding a "person" is local
  only — nothing is sent to them)
- Full offline support via the service worker

