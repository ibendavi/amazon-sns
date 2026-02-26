# Amazon Subscribe & Save Optimizer

A tool for managing and optimizing Amazon S&S subscriptions using an interactive website, Claude Code, and browser automation.

**Live site:** [ibendavi.github.io/amazon-sns](https://ibendavi.github.io/amazon-sns/)

**Savings so far:** $4,818 since January 2016 (per Amazon), plus ~$59/year from the optimizations below.

---

## How It Works

### 1. Interactive Website (GitHub Pages)

A single-page checklist for reviewing your next S&S delivery. Features:

- **Check/uncheck items** to mark what to keep vs. skip
- **Share Link** — encodes your selections into a URL you can paste anywhere
- **Optimize Prices** — shows a price comparison report (S&S vs. one-time) for checked items
- **Copy unchecked items** — generates a list for batch price-checking
- **Persistent state** via `localStorage` and URL hash parameters
- Deadline alert, item search/filter, summary of kept/skipped/total cost

### 2. Claude Code + Playwright (Browser Automation)

Claude Code drives a headless Chromium browser to:

- **Scrape S&S prices** from product pages and the management console
- **Compare S&S vs. one-time prices** to verify discounts are genuine
- **Check for coupons** on product pages
- **Execute changes** — skip items, cancel subscriptions, adjust quantities

Workflow: open the website → check/uncheck items → click Share Link → paste the URL into Claude Code → tell it what to do.

### 3. Session Notes (`session-notes.md`)

A persistent record of every finding and change, including price comparisons, subscription IDs, and optimization results.

---

## Current Subscription Summary

**44 active items** as of 2026-02-26. Next delivery: March 10, 2026.

| # | Item | S&S Price | Qty | Frequency | Total |
|---|------|-----------|-----|-----------|-------|
| 1 | Mucinex 12hr Max 1200mg (48 tab) | $27.79 | 1 | 2 mo | $27.79 |
| 2 | CeraVe Foaming Cleanser (19 oz) | $15.27 | 1 | 6 mo | $15.27 |
| 3 | Lavazza Super Crema (2.2 lb) | $31.43 | 1 | 2 mo | $31.43 |
| 4 | Energizer 2032 (2 ct) | $3.82 | 1 | 6 mo | $3.82 |
| 5 | Presto Paper Towels (12 Huge) | $25.49 | 1 | 1 mo | $25.49 |
| 6 | Febreze AIR Linen & Sky (6 pk) | $18.94 | 1 | 6 mo | $18.94 |
| 7 | Gillette ProGlide Refills (8 ct) | $19.76 | 1 | 6 mo | $19.76 |
| 8 | Nescafe Taster's Choice (2×7 oz) | $22.92 | 1 | 6 mo | $22.92 |
| 9 | Hill's Rx t/d Cat Food (8.5 lb) | Vet auth | 1 | — | — |
| 10 | Purina Cat Chow Naturals (13 lb) | $16.13 | 1 | 1 mo | $16.13 |
| 11 | Energizer 123 Lithium (6 pk) | $11.05 | 1 | 6 mo | $11.05 |
| 12 | Sensodyne Pronamel Whitening (4 pk) | $21.24 | 1 | 6 mo | $21.24 |
| 13 | Presto Toilet Paper (24 Fam Mega) | $24.64 | 3 | 1 mo | $73.92 |
| 14 | Gillette Clinical Cool Wave (3 pk) | $43.32 | 2 | 3 mo | $86.64 |
| 15 | Lysol Wipes (4 pk) | $19.65 | 1 | 6 mo | $19.65 |
| 16 | O'Keeffe's Working Hands (3.4 oz) | $9.13 | 1 | 6 mo | $9.13 |
| 17 | Reynolds Quick Cut Plastic Wrap | $3.39 | 1 | 6 mo | $3.39 |
| 18 | Purina Friskies Shreds (24 cans) | $19.15 | 2 | 1 mo | $38.30 |
| 19 | Nautica Voyage EDT (6.7 oz) | $25.37 | 1 | 6 mo | $25.37 |
| 20 | Terrasoul Sunflower Seeds (2 lb) | $13.49 | 1 | 1 mo | $13.49 |
| 21 | Energizer 9V Lithium (2 pk) | $26.50 | 1 | 3 mo | $26.50 |
| 22 | Blue Diamond Wasabi Almonds (16 oz) | $6.79 | 1 | 1 mo | $6.79 |
| 23 | Carlyle Melatonin 12mg (180 tab) | $8.54 | 1 | 6 mo | $8.54 |
| 25 | Scotch Magic Tape (6 rolls) | $13.33 | 1 | 4 mo | $13.33 |
| 26 | Triple Strength Fish Oil (180 ct) | $45.01 | 1 | 3 mo | $45.01 |
| 27 | Vicks VapoShower Plus (12 ct) | $21.79 | 1 | 3 mo | $21.79 |
| 28 | PUREPLUS Water Filter (4 pk) | $27.38 | 1 | 2 mo | $27.38 |
| 29 | Har Bracha Tahini (12 pk) | $94.97 | 1 | 2 mo | $94.97 |
| 30 | Purina ONE Dog Food (27.5 lb) | — | 1 | 1 mo | — |
| 31 | Happy Belly Roasted Almonds (24 oz) | $7.56 | 1 | 1 mo | $7.56 |
| 32 | Purina Friskies Variety (40 cans) | $31.12 | 2 | 1 mo | $62.24 |
| 33 | Downy CALM Dryer Sheets (130 ct) | $7.35 | 1 | 2 mo | $7.35 |
| 34 | Dove Peach Body Scrub (15 oz) | $6.77 | 1 | 6 mo | $6.77 |
| 35 | Blue Diamond Dark Choc Almonds (25 oz) | $9.76 | 2 | 1 mo | $19.52 |
| 36 | Dr. Elsey's Ultra Cat Litter (40 lb) | $20.69 | 4 | 6 mo | $82.76 |
| 38 | Oral-B Glide Floss (3 pk) | $9.47 | 1 | 6 mo | $9.47 |
| 39 | GUM Soft-Picks Advanced (90 ct, 3 pk) | $19.79 | 1 | 5 mo | $19.79 |
| 40 | Endangered Species Dark Choc 88% (12 bars) | $47.49 | 1 | 3 mo | $47.49 |
| 41 | Amazon Basics Hand Soap Refill (2 pk) | $8.02 | 1 | 2 mo | $8.02 |
| 43 | Lavazza Espresso (2-pack) | $34.19 | 2 | 1 mo | $68.38 |
| 45 | Gillette Clinical Arctic Ice (2.6 oz) | $11.02 | 8 | 6 mo | $88.16 |
| 46 | Biotrue Contact Solution (10 oz, 2 pk) | $14.44 | 1 | 5 mo | $14.44 |
| 47 | Brawny Paper Towels (12 XL) | $26.77 | 1 | 3 mo | $26.77 |

---

## Price Comparison Results

Checked on 2026-02-26. **All S&S discounts are genuine (5–15%).** No items where one-time purchase beats S&S. No active coupons found on any product page.

| Item | S&S Price | One-Time | Savings |
|------|-----------|----------|---------|
| Har Bracha Tahini (12 pk) | $94.97 | $99.97 | $5.00 (5%) |
| Gillette Clinical Cool Wave (3 pk) | $43.32 | $50.97 | $7.65 (15%) |
| Gillette Clinical Arctic Ice (3 pk) | $30.57 | $35.97 | $5.40 (15%) |
| Dr. Elsey's Ultra Cat Litter (40 lb) | $20.69 | $22.99 | $2.30 (10%) |
| Triple Strength Fish Oil (180 ct) | $45.01 | $52.95 | $7.94 (15%) |
| Presto Toilet Paper (24 Fam Mega) | $24.64 | $28.99 | $4.35 (15%) |
| Lavazza Espresso (2-pack) | $34.19 | $37.99 | $3.80 (10%) |
| Mucinex 12hr Max 1200mg (48 tab) | $27.79 | $32.69 | $4.90 (15%) |
| Sensodyne Pronamel Whitening (4 pk) | $21.24 | $24.99 | $3.75 (15%) |

**9 of 44 items checked.** Total S&S savings across checked items: ~$45/delivery.

---

## Optimizations Made (2026-02-26)

### Lavazza Espresso Consolidation — saves $58.68/year

Had three overlapping Lavazza subscriptions delivering 4 bags/month at $73.27. Consolidated to a single 2-pack subscription at qty 2, delivering the same 4 bags/month at $68.38.

- Cancelled two single-bag subscriptions (IDs: `SNSD0_TVSEWJRVDKKRTFT0R3RD`, `SNST0_094312D496FA486A8355`)
- Increased 2-pack subscription to qty 2

### Duplicate Febreze Cancelled

Removed an unavailable duplicate Febreze AIR subscription (ID: `SNSA0_XGZGQKXRZGAKPHPHVR96`) that was an accidental creation. Kept the active one (`SNSA0_06QM1FCESTM2EEGFDZC0`).

### Fish Oil Price Drop Detected

Management console showed $48.81 but the product page lists $45.01 for S&S. Saves $3.80/order = ~$15.20/year at quarterly frequency.

### Gillette Arctic Ice 3-Pack — not yet available

Investigated switching 8 individual units ($88.16) to 3-packs ($30.57 each = $10.19/unit). The 3-pack option is only available in Clear Gel, not Clinical Soft Solid. **On hold** until the right formulation appears.

---

## How to Use

### Review and edit your next delivery

1. Open the [live site](https://ibendavi.github.io/amazon-sns/)
2. Check items to keep, uncheck items to skip
3. Click **Share Link** to copy a URL with your selections
4. Paste the URL into Claude Code and say "skip all unchecked items on Amazon"

### Run a price check on unchecked items

1. On the site, click **Optimize Prices** → **Copy unchecked items for price check**
2. Paste into Claude Code and say "compare S&S vs one-time prices for these items"
3. Claude will use Playwright to scrape each product page and report back

### Skip or cancel a subscription

Tell Claude Code:
- *"Skip item 29 (Har Bracha Tahini) from the March delivery"*
- *"Cancel the subscription for item 4 (Energizer 2032)"*

Claude navigates to `amazon.com/auto-deliveries`, finds the item, and executes the action.

---

## Remaining Opportunities

- **35 items** have not been price-checked yet (only 9 of 44 done)
- Use the "Copy unchecked items for price check" button to generate a batch list
- High-value unchecked items to prioritize:
  - Gillette Clinical Arctic Ice ×8 ($88.16)
  - Dr. Elsey's Cat Litter ×4 ($82.76) — unit price checked, but multi-pack alternatives not explored
  - Presto Toilet Paper ×3 ($73.92) — unit price checked, but competitor brands not compared
  - Lavazza Espresso 2-pack ×2 ($68.38)
  - Purina Friskies Variety ×2 ($62.24)

---

## Tech Stack

- **Frontend:** Single HTML file, vanilla JS, no dependencies
- **Hosting:** GitHub Pages
- **Automation:** Claude Code with Playwright MCP server (headless Chromium)
- **Data:** `session-notes.md` for persistent findings; `localStorage` + URL hash for UI state
