# Jod Tung Tung — Ledger PWA

Income/Expense Ledger — a dependency-free, no-build-step PWA (vanilla HTML/CSS/JS)
with a Capacitor-wrapped native Android companion app. Everything runs from static
files; there is no bundler, no npm build, no backend/server.

## Git workflow — read this before touching anything

Two branches, two purposes. Get this wrong and you ship untested design work straight
to real users.

- **`staging`** — where all design/feature work happens and gets tested first.
- **`main`** — production. Only reached via explicit merge from `staging`, and only
  when the user says so ("release", "release update", "ship it" — an explicit go-ahead,
  not implied by "looks good").

Deploy targets (three separate GitHub Pages sites, one per repo):

| Branch    | Pushes to                                            | Serves                                          |
|-----------|-------------------------------------------------------|--------------------------------------------------|
| `staging` | `origin` (this repo) **and** `jod-tung-tung-ledger-staging.git` (`staging:main`) | Staging preview: `https://natpakhantr-hue.github.io/jod-tung-tung-ledger-staging/` |
| `main`    | `origin` (this repo)                                   | Production: `https://natpakhantr-hue.github.io/jod-tung-tung-ledger/` |

Routine cycle for any change:
1. Make sure you're on `staging` (`git checkout staging`).
2. Edit, test locally (see below), sync the `mobile-app/www/` mirror.
3. Bump `version.json` **and** `window.APP_VERSION` in `index.html` together, to the
   same new value (`YYYY-MM-DD.N`, incrementing `.N` for same-day releases).
4. Commit, push to `origin staging`, then push `staging:main` to the staging preview
   repo's URL (this needs the token-bearing remote URL used earlier in the session;
   don't hardcode a token in the repo).
5. Poll the staging site's `version.json` until it matches, confirming the deploy
   landed, before telling the user it's ready.
6. Only when the user explicitly says to release: `git checkout main`, `git merge
   staging --no-edit`. If it conflicts (happens when `main` has old commits `staging`
   never had, e.g. a past revert), resolve **every conflict in favor of staging's
   side** (`git checkout --theirs <file>`) — `main` is never the source of truth for
   app code. Verify (syntax-check JS, smoke-test locally), then `git push origin
   main`, poll production's `version.json`.

Always keep `mobile-app/www/*` byte-identical to the root files you touched — the
native Android app bundles that copy (though at runtime it actually loads the live
production URL via `server.url` in `mobile-app/capacitor.config.json`, so the bundled
copy mostly matters for a future offline/local-bundle fallback). Copy root → mirror
before every commit; never edit the mirror directly.

## Testing before every push

Start a plain static server (no framework) and drive it with the Claude Browser tool
at the `mobile` viewport preset — this app is phone-only:

```bash
node -e "
const http=require('http'),fs=require('fs'),path=require('path');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'};
http.createServer((req,res)=>{
  let p=decodeURIComponent(req.url.split('?')[0]); if(p==='/')p='/index.html';
  fs.readFile(path.join(process.cwd(),p),(err,data)=>{
    if(err){res.writeHead(404);res.end('not found');return;}
    res.writeHead(200,{'Content-Type':mime[path.extname(p)]||'application/octet-stream'});
    res.end(data);
  });
}).listen(PORT);
"
```

Seed test data via `window.DB.reset()` / `DB.addPocket(...)` / `DB.addTransaction(...)`
in the browser console rather than clicking through the UI by hand. Always
`node -c js/*.js` before testing — this codebase has no build step to catch syntax
errors for you.

## Page glossary — what each screen actually is

- **Home** (`dashboard()` in `views.js`, route `#/dashboard`) — the day-band statement
  list of every logged **transaction**, across the whole app. Its "Monthly Expense" is
  the sum of all `type: "expense"` transactions this month, full stop — pocket-linked
  or not, manually entered or auto-logged.

- **Pockets** (`pocketsList()`, route `#/pockets`) — a budgeting view layered on top of
  the same transaction ledger, **not** a separate ledger. A **Pocket** is a named
  container (`DB.pockets`); each holds one or more **Pocket Items** (`DB.pocketItems`),
  which are recurring bills or savings reminders. Pockets' own stats are deliberately
  computed differently from Home's:
  - *Income* (label; internal var is still `salary`) = this month's `income`-type
    transactions (tap it to quick-add one).
  - *Monthly Expense* = sum of every pocket item's `amount` where `kind !== "saving"`
    — the **total monthly obligation**, regardless of whether it's been paid yet this
    month. Not the same number as Home's Monthly Expense.
  - *Remaining* = Income − (pocket bills + pocket savings). Not a net-of-everything
    figure — ad-hoc non-pocket transactions don't touch it.
  - *Save* = sum of pocket items where `kind === "saving"`.
  - Marking a bill/reminder paid (the ✓ toggle) **does** create a real transaction in
    the ledger (confirmed explicitly with the user — Pockets and the ledger stay
    linked, even though the page's own stats are computed independently).

- **Add Pocket** (`openPocketItemForm()`) — creates/edits one Pocket Item. If opened
  with no target pocket (the Pockets list's own "+"), saving auto-creates a new pocket
  named after the bill unless you explicitly pick an existing one via the pocket
  picker row. Fields: Bill/Reminder type, due date (toggle on/off — off means no fixed
  monthly day), amount, category, pocket, name, installments, note, auto-debit.
  "Auto debit every month" = the bill is marked paid and logged automatically once its
  due day arrives each month, no tap needed (`runAutoDebitBills()`, runs on app open).

- **Add Transaction** (`openTransactionForm()`) — the manual ledger-entry sheet.
  Types are `outcome`/`income`/`saving`/`transfers` (display labels) mapping to
  `expense`/`income`/`saving`/`transfer` internally. Has its own recurring engine
  (`runRecurringTransactions()`, weekly/biweekly/monthly, real auto-generation on app
  open) — **separate** from a pocket bill's auto-debit, even though both eventually
  create transactions.

- **History** (`stats()`, route `#/stats`) — monthly trend charts (`charts.js`).

- **Settings** (`settings()`) — currency, Bank Slip Albums (native-app-only: gated
  behind `window.Capacitor.Plugins.GalleryScan`, so it never appears in a browser/
  staging preview — that's expected, not a bug), categories, data export/import/reset.

## Data model quick reference (`db.js`)

- **Transaction**: `type` (expense/income/saving/transfer), `amount`, `categoryId`,
  `date`, `note`, `payee`, `pocketId`/`pocketItemId` (set when it came from a bill),
  `recurring` (`{freq, nextDate}` or `null`), `autoLogged` (bool), `receiptImage`.
- **Pocket**: `id`, `name`, `icon`, `color`.
- **Pocket Item**: `pocketId`, `name`, `amount`, `dueDay` (plain day-of-month,
  nullable — recurs every month, not a fixed calendar date), `categoryId`,
  `installments` (nullable), `kind` (`"bill"` | `"saving"`), `note`, `autoDebit`
  (bool), `paidRecords` (`{ [monthKey]: {paid, transactionId} }`).

`autoLogged: true` on a transaction means: don't show the 🤖-style note/clutter on
its Home statement row (see `dashboard()`'s row rendering) — it's set for recurring-
engine transactions, OCR slip-scan auto-logs, and bill/auto-debit payments alike.

## UI conventions to reuse, not reinvent

- **Delete buttons**: never `window.confirm()` — it silently no-ops in some WebViews,
  including this project's Android wrapper. Always `wireDeleteButton(btn, onConfirm,
  label)` (tap-twice-to-confirm).
- **Date picking**: never rely on native `<input type=date>` popping a picker — same
  WebView unreliability. Use the shared `calendarPanelHtml()` / `wireCalendarPanel()`
  month-grid popup.
- **Amount entry**: `calculatorHtml()` / `wireCalculator()` / `readAmountValue()` — a
  hand-rolled calculator (no `eval()`), reused by both Add Transaction and Add Pocket.
- **Dark-row sheet style** (`.tx-row`, `.tx-panel`, `.tx-icon-badge`, `.tx-sheet-head`)
  is the current design language for every "Add/Edit" sheet — match it for new forms
  rather than falling back to the older plain `.field`/`.card` styles still used by
  a few untouched screens (pocket container edit, recurring income — now removed).
- **Icons**: `icons/nav/*` (bottom nav, CSS-mask-recolored for active/inactive) and
  `icons/tx/*` (transaction/pocket form row icons, shown at native color with no
  badge background) are exported design assets — check `design/icons/` (untracked,
  gitignored-in-spirit scratch folder) for anything newer before reusing an old one.
- **Single light theme only** — no `@media (prefers-color-scheme: dark)` block. This
  is deliberate: the app matches one specific Figma design regardless of the phone's
  system theme. Don't reintroduce a dark-mode override.
- **Safe areas**: `env(safe-area-inset-bottom)` (bottom nav) and `env(safe-area-inset-
  top)` (header) must be respected on every full-bleed sticky/fixed element — a past
  bug had the Home header missing the top inset entirely, pushing the month nav up
  under the status bar.

## Known ambiguity to resolve carefully, not guess

"Pocket" concepts have been iterated on heavily and the design has come from
hand-drawn mockups with imprecise labels/numbers — when a request touches the
Pocket/Pocket-Item/transaction relationship, re-read this file's Page Glossary first,
and if a request could mean two structurally different things (e.g. "does this
touch the ledger or not"), ask rather than pick one and rebuild twice.
