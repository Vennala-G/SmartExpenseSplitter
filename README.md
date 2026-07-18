# Smart Expense Splitter with Debt Simplification

A polished, fully client-side web app for splitting group expenses fairly and
settling balances in the **minimum possible number of transactions**, using
a greedy Minimum Cash Flow algorithm. No backend, no build step, no
frameworks — open `index.html` and it works.

![Tech](https://img.shields.io/badge/HTML5-CSS3-Vanilla%20JS-8b5cf6)
![Storage](https://img.shields.io/badge/Storage-LocalStorage-06b6d4)
![Charts](https://img.shields.io/badge/Charts-Chart.js-f43f5e)

---

## ✨ Overview

Splitting costs across a trip, a shared flat, or a project is easy — the
painful part is figuring out who actually needs to pay whom once everyone
has covered a few different bills. Smart Expense Splitter tracks every
expense, calculates each member's net balance, and then collapses the whole
tangle of IOUs into the smallest possible set of payments.

**Example:** A owes ₹700, B owes ₹300, C is owed ₹1000 in total.
Instead of 3+ scattered IOUs, the app tells you exactly:
- A pays C ₹700
- B pays C ₹300

Two transactions instead of three (or more) — and it scales the same way
for groups of any size.

---

## 🚀 Features

### Core Ledger
- Beautiful, responsive **glassmorphism landing page** with an animated,
  live settlement-flow diagram as the hero visual
- Full **dashboard** with summary stat cards, charts, recent activity, and
  live net balances
- **Add / Edit / Delete Members**, each with a name, optional email, and a
  chosen avatar color
- **Add / Edit / Delete Expenses** with title, amount, category, date,
  payer, split-between selection, and optional notes
- **8 built-in expense categories** (Food, Travel, Rent, Utilities,
  Entertainment, Shopping, Health, Other), each with its own icon and color
- **Split equally** among any subset of selected members, with a live
  "₹X split between Y = ₹Z each" preview as you type

### Debt Simplification
- **Minimum Cash Flow algorithm**: greedily matches the largest creditor
  with the largest debtor on every pass, minimizing the number of
  transactions needed to settle the whole group
- **Settle Up** screen showing exactly who should pay whom and how much
- **Mark as Settled** — recorded settlements adjust every balance
  calculation going forward
- **Transaction History** — a permanent, timestamped log of every
  settlement that's been marked paid

### Insights
- **Member statistics**: total spent, total share owed, total received,
  total paid out, net balance, and % share of group spend per member, with
  a progress bar
- **Charts** (Chart.js): spending-by-category doughnut chart and
  spend-per-member bar chart, both theme-aware
- **Search** expenses by title or notes
- **Filter** by category and by member
- **Sort** by date or amount, ascending or descending

### Quality of Life
- **Dark mode / light mode** toggle with a saved preference and a system
  preference fallback
- **LocalStorage persistence** — members, expenses, and settlement history
  all survive a page refresh
- **JSON Export** — download your entire ledger as a single backup file
- **JSON Import** — restore a ledger from a previously exported file
  (with a confirmation step, since it replaces current data)
- **Demo data loader** — one click on the landing page populates a
  realistic sample group so you can explore every screen immediately
- **Toast notifications** for every create/update/delete/settle/export/
  import action
- **Form validation** with inline field errors (required fields, valid
  email format, positive amounts, duplicate name checks, etc.)
- **Empty states** everywhere data could be missing, each with a clear
  next action
- Smooth **hover animations**, soft shadows, and transitions throughout
- Fully **responsive** down to small mobile screens, including a
  collapsible mobile navigation menu
- Clean, heavily **commented code** organized into clearly labeled
  sections

---

## 🗂️ Folder Structure

```
SmartExpenseSplitter/
│
├── index.html          # Markup for the landing page + every app view + all modals
├── style.css            # Design tokens, layout, components, dark/light themes, responsive rules
├── script.js             # All application logic (state, storage, algorithm, rendering, events)
├── README.md             # This file
└── assets/                # Reserved for any additional images/icons you add
```

Everything is a single page. Navigation between "Dashboard", "Members",
"Expenses", "Settle Up", "History", and "Statistics" is handled entirely in
JavaScript by toggling which `<main class="view">` section is visible — there
is no routing library and no page reloads.

---

## 🛠️ Tech Stack

| Layer      | Choice                                   |
|------------|-------------------------------------------|
| Structure  | HTML5                                      |
| Styling    | CSS3 (custom properties, Grid, Flexbox)    |
| Behavior   | Vanilla JavaScript (ES6+, no frameworks)   |
| Storage    | Browser `localStorage`                     |
| Charts     | Chart.js (via CDN)                          |
| Icons      | Font Awesome 6 (via CDN)                    |
| Fonts      | Space Grotesk, Inter, JetBrains Mono (Google Fonts) |

No React, Vue, or Angular. No Node.js, Firebase, Supabase, or any backend.
No AI APIs. Everything runs entirely in the browser.

---

## 📦 Installation

There is no build step and no dependencies to install.

1. Download or clone this folder.
2. Open `index.html` directly in any modern browser (Chrome, Edge, Firefox,
   Safari) — by double-clicking it, or via `File > Open`.
3. That's it. The app loads its fonts, icons, and chart library from CDNs,
   so an internet connection is needed the first time; all your actual
   data stays local in your browser's `localStorage` and never leaves your
   device.

> Tip: click **"Load Demo Data"** on the landing page hero to instantly see
> a populated dashboard, a filled expense table, and a live settlement
> suggestion, without manually adding anything.

---

## 🖼️ Screenshots

_Add screenshots of your running app here once you've opened it in a
browser — for example:_

- `assets/screenshot-landing.png` — Landing page hero and feature grid
- `assets/screenshot-dashboard.png` — Dashboard with stat cards and charts
- `assets/screenshot-expenses.png` — Expense table with filters
- `assets/screenshot-settle-up.png` — Simplified settlement suggestions
- `assets/screenshot-dark-mode.png` — Dark mode view

```markdown
![Dashboard](assets/screenshot-dashboard.png)
![Settle Up](assets/screenshot-settle-up.png)
```

---

## 🧮 How the Debt Simplification Algorithm Works

1. For every expense, the payer's balance increases by the full amount,
   and every member included in the split has their balance reduced by
   their equal share (`amount / number of people splitting`).
2. Once every expense has been applied, each member ends up with a single
   **net balance**: positive means the group owes them money, negative
   means they owe the group money.
3. Any settlements already marked "paid" are applied on top, shifting the
   relevant balances toward zero so they aren't suggested again.
4. The **Minimum Cash Flow** step repeatedly finds the member owed the
   most and the member who owes the most, and settles the smaller of the
   two amounts directly between them — repeating until every balance is
   zero (within a small rounding tolerance).

This greedy "largest vs. largest" pairing is the standard technique for
minimizing the number of transactions required to settle a group, and it
runs in `O(n²)` in the worst case for `n` members, producing at most
`n − 1` transactions.

---

## 🔭 Future Enhancements

- Unequal / percentage-based / share-based splitting (not just equal splits)
- Multi-currency support with live conversion
- Recurring expenses (e.g. monthly rent auto-logged)
- Receipt photo attachments per expense (stored as base64 in LocalStorage)
- Multiple separate groups/ledgers within one app instance
- CSV export alongside JSON
- Drag-and-drop reordering and bulk actions on the expense table
- Optional cloud sync backend for cross-device access
- Push/email reminders for pending settlements
- Printable settlement summary (PDF export)

---

## 📄 License

This is a portfolio project — feel free to fork it, learn from it, and
adapt it for your own use.
