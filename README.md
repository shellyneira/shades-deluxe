# Shades Deluxe — Quotes

A simple web app for building window-shade quotes and customer invoices.
It is a code version of the original **New Shades Deluxe** Excel workbook — same
price tables, same math, but easier to use and shareable by link.

**Live app:** _(GitHub Pages URL — see the repo's Settings → Pages)_

## What it does

- **Quotes** — pick a table (Roller #3, Roller #5, Zebra #3, Zebra #5), enter the
  window size and options, and the price is calculated automatically. Make as many
  quotes as you want.
- **Invoice** — a clean, customer-facing quote/invoice with **no dimensions shown**,
  ready to print or save as PDF.
- **Price Tables** — edit any price, add lengths (rows) or widths (columns). This is
  the database; change a price here and every new quote uses it.
- **Lists** — add fabrics, colors, locations, etc. that show up in the dropdowns.
- **Settings** — company info on the invoice, and **backup/restore** your data.

## How the price is calculated (same as the spreadsheet)

1. If a size's fraction is over ½ it rounds up one inch, otherwise it stays.
2. The **list price** is the first grid cell whose width ≥ the shade width and
   whose length ≥ the shade height.
3. Add-ons: Fascia = `width ÷ 12 × 4.5`, Side channel = `height ÷ 12 × 4.5 × 2`,
   plus Installation and Brackets.
4. **Client price** = list price + fascia + side channel + installation + brackets,
   with a per-table **minimum price** floor (300 / 400 / 550 / 600, editable).

## Where the data lives — and how it stays in sync

Everything is saved in the browser first (so the app never feels slow, and keeps
working with no signal) and mirrored to Supabase, which is the shared copy everyone
on the team reads from.

**It is live.** Every screen — Dashboard, Quotes, Price Tables, Lists, Settings —
updates by itself as soon as anyone changes anything, usually within a second:

- **You see each other.** Coloured initials in the top bar show who is in the app,
  and hovering one says which screen and which field they are on.
- **You see what they are doing.** The box someone else is typing in gets a ring in
  their colour with their name on it, quotes that someone has open are outlined in
  the list, and a small bar tells you when you are both on the same quote.
- **Nobody overwrites anybody.** Only the rows you actually changed are sent, so
  editing a quote here never rewrites a price table someone edited there. If two
  people type in the same quote at once, your keystrokes are never yanked out from
  under your caret — the app waits until you pause, and the most recent edit wins.
- **The dot next to the avatars** says `Live`, `Connecting…` or `Offline`. Offline
  edits are kept and sent as soon as the connection is back, and a device that was
  asleep catches up the moment it wakes.

**Setup (once):** run `supabase/schema.sql` in the Supabase dashboard →
SQL Editor. Without the Realtime block at the bottom of that file the app still
syncs, but only by polling — changes take up to a minute and you will not see who
else is in the app.

Use **Settings → Download backup** now and then for an offline copy.

## Running locally

```bash
python3 -m http.server 4173
# open http://localhost:4173
```

No build step — plain HTML/CSS/JavaScript modules.
