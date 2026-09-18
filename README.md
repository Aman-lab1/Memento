# Memento

Memento remembers the money between people.

A minimalist, mobile-first PWA for keeping track of money between friends, roommates, classmates, couples, and other personal relationships.

## Current Status

Memento is currently a local-first prototype.

The current version runs entirely in the browser and stores data using `localStorage`.

There is currently no authentication, cloud database, or shared-account system.

The next major phase will introduce Supabase for authentication, database storage, security, and shared relationships.

## Core Concept

Memento is built around relationships rather than traditional expense tracking.

For each person, Memento keeps track of:

- Money you paid for them
- Money they paid for you
- Settlements between you
- The resulting relationship balance
- The history of what happened

The balance is always derived from the underlying records rather than being manually edited.

## Current Features

- Add people
- Edit people
- Delete relationships
- Add transactions
- Edit transactions
- Delete transactions
- Automatic balance calculation
- Partial settlements
- Full settlements
- Current-period relationship view
- Permanent transaction history
- Settlement history
- Local browser persistence
- Mobile-first responsive interface
- PWA manifest
- Service worker
- Offline app-shell caching

## Design

Memento uses a minimal black-and-white interface inspired by the visual language of modern mobile applications.

Design principles:

- Minimal
- Calm
- Human
- Mobile-first
- No unnecessary dashboards
- No fake financial metrics
- Clear relationship-focused information

## Architecture

Current:

Browser
↓
HTML / CSS / JavaScript
↓
localStorage

Planned:

Browser
↓
Memento frontend
↓
Supabase
├── Authentication
├── PostgreSQL database
└── Row Level Security

The frontend will remain a static application while Supabase provides the backend services.

## Project Structure

```text
Memento/
├── index.html
├── manifest.json
├── README.md
├── sw.js
├── pages/
│   ├── person.html
│   ├── history.html
│   └── add-person.html
├── src/
│   ├── app.js
│   └── style.css
├── docs/
│   ├── PRODUCT.md
│   └── SYSTEM.md
└── icons/