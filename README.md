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

## Where the data lives

Everything is saved in the browser (no server, no login). Use
**Settings → Download backup** regularly, and **Restore backup** to move data to
another computer. This app is a static site, so it runs entirely on the visitor's
device.

## Running locally

```bash
python3 -m http.server 4173
# open http://localhost:4173
```

No build step — plain HTML/CSS/JavaScript modules.
