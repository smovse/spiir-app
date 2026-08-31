# Overblik — iPad app

A personal finance dashboard, packaged as an installable web app (PWA) for iPad.
No backend, no hardcoded data — everything comes from CSV files you import
yourself, and it's all stored locally in Safari on your iPad.

## How data works now

- The app starts **empty**. Go to the **Konti** tab and tap **Tilføj konto**
  to add an account (give it a name, the account number as it appears in your
  bank's CSV export, and today's balance).
- Tap **Importer CSV** on that account to load a transaction export into it.
- **Importing is safe to repeat.** Every row has a bank reference number, and
  that's used to skip anything you've already imported — so when you download
  a fresh export next month, just import the whole file again; only the new
  rows get added.
- Whenever you import newer transactions, **update the "Saldo nu" field** on
  that account to your real current balance. The app can't know your balance
  from the transaction list alone (there's no balance column in these
  exports) — it reconstructs each row's running balance by working backward
  from whatever you enter there.
- The **Regninger** tab works the same way: import your own annual budget CSV
  (one line per expense category, one column per month) via the button at the
  top of that tab, and it'll match your real transactions against it.

## Where your data actually lives

Everything — accounts, imported transactions, category corrections, your
budget plan — is stored in **Safari's local storage on this one device**.
Nothing is sent anywhere, and none of it lives in this code or this repo.

That also means:
- **The app's source code itself has no personal data in it anymore**, so
  unlike the very first version of this, it's fine to put this repo on public
  GitHub Pages — the published site is just the empty app shell.
- **There's no sync and no backup.** If you clear Safari's site data on this
  iPad, or open the app in a different browser, you're starting from zero —
  your bank exports are the backup. Re-importing them is quick since nothing
  gets duplicated.
- If you ever want cross-device sync or automatic backup, that needs a real
  backend — a separate, bigger piece of work.

## What's in here

- `index.html` — the app shell (loads Tailwind for styling, then the app)
- `dist/bundle.js` — your app, plus React, bundled into one file (no CDN
  dependency for this part, so it keeps working offline)
- `manifest.json` + `icons/` — makes "Add to Home Screen" behave like a real app
- `service-worker.js` — caches everything after first load, so it works offline
- `src/` — the source code, if you want to edit it later (needs Node +
  esbuild to rebuild `dist/bundle.js` after changes)

## Deploy via GitHub Pages

1. Create a repository on GitHub (public is fine now — see above).
2. Upload everything in this folder, preserving the folder structure
   (`dist/`, `icons/`, `src/` must stay as folders).
3. In the repo, go to **Settings → Pages**, set Source to the branch you
   pushed (usually `main`) and folder `/ (root)`.
4. GitHub gives you a URL like `https://<you>.github.io/<repo>/`. Open it in
   Safari on your iPad.
5. Tap the Share icon → **Add to Home Screen**. It now behaves like an app:
   own icon, no browser bar, works offline after the first open.
6. Add your accounts and import your first CSVs (see "How data works now").

## Run without any hosting

Service workers (needed for offline support) require a real `http(s)://`
origin — they won't register on a plain `file://` page. If you'd rather not
publish anywhere at all:

- On a Mac: `cd` into this folder and run `python3 -m http.server 8080`, then
  open `http://<your-mac's-local-IP>:8080` from Safari on the iPad (same wifi
  network). Add to Home Screen from there. Nothing leaves your home network,
  and you don't need a GitHub account at all for this option.

## Rebuilding after editing `src/`

```
npm install --no-save react react-dom
npx esbuild src/index.jsx --bundle --outfile=dist/bundle.js --format=iife --jsx=automatic --minify --target=es2020
```

## CSV format expected

Danish bank exports, semicolon-delimited, no header row:

```
note;description;from-account;to-account;amount;counterpart-name;;transaction-date;posting-date;value-date;reference;...
```

Dates as `DD-MM-YYYY`, amounts as `1.234,56` (Danish decimal comma). This
matches Danske Bank's "Posteringsdetaljer" export format. If your bank uses a
different column order, the parsing logic is in `parseTransactions()` in
`src/App.jsx`.

The budget CSV (Regninger tab) expects:

```
<year>;Januar;Februar;...;December;I alt
<Category name>;<jan amount>;<feb amount>;...;<dec amount>;<total>
```
