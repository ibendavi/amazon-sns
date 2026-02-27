# Amazon Subscribe & Save Optimizer

A tool for managing and optimizing Amazon S&S subscriptions using an interactive website, Claude Code, and browser automation.

**Live site:** [ibendavi.github.io/amazon-sns](https://ibendavi.github.io/amazon-sns/)

**Savings so far:** $4,818 since January 2016 (per Amazon), plus ~$59/year from the optimizations below.

---

## How It Works

### 1. Review Pre-selected Items

Open the site. Items are sorted by delivery frequency:

- **Monthly items** (toilet paper, cat food, coffee, snacks) — pre-checked, almost always ordered
- **Every 2 months** (tahini, water filters, soap, dryer sheets) — pre-checked
- **Every 3 months** (deodorant, supplements, chocolate) — pre-checked
- **Every 4–5 months** (tape, soft-picks, contact solution) — unchecked, actively confirm
- **Every 6 months** (batteries, cologne, cleanser, litter) — unchecked, review each time
- **Special** (vet-required, unavailable) — unchecked

Within each group, items are sorted by total cost (highest first) so the most expensive items get your attention first.

### 2. Check Alternatives

Items with known alternatives show an expandable "Alternatives" section with pricing, unit prices, and savings. Click "Switch" to mark a preferred alternative — this gets included in the Send payload. Alternatives are populated weekly by the automated price scraper (see below).

### 2b. Cancel Subscriptions

Each item has a red "x" button to mark it for cancellation. Clicking confirms via dialog, then shows the item with strikethrough and "Pending cancellation" label. Cancellations are included in the Send payload for Claude Code to execute.

### 3. Send to Claude Code

Click **Send** to submit your selections:
- If Firebase is connected, writes to `sendQueue` node — Claude Code reads it directly
- If offline, copies JSON to clipboard — paste into Claude Code

Claude Code then:
1. Skips unchecked items on Amazon
2. Switches to selected alternatives
3. Optimizes delivery frequencies

### 4. Real-time Sync (Firebase)

Both you and your wife can review the list simultaneously in separate browsers. Changes sync in real-time via Firebase Realtime Database. A green dot next to the title means sync is active; gray means offline (changes still save to localStorage).

---

## Firebase Setup

The site works offline using localStorage. To enable real-time multi-browser sync:

### 1. Create Firebase Project

```bash
# In a regular terminal (not Claude Code):
firebase login
firebase projects:create amazon-sns --display-name "Amazon S&S"
```

Or create via [Firebase Console](https://console.firebase.google.com):
- Click "Add project" → name it `amazon-sns`

### 2. Enable Anonymous Authentication

Firebase Console → Build → Authentication → Sign-in method → Anonymous → Enable

### 3. Create Realtime Database

Firebase Console → Build → Realtime Database → Create Database → Start in test mode

Set security rules:
```json
{
  "rules": {
    "selections": { ".read": "auth != null", ".write": "auth != null" },
    "sendQueue": { ".read": "auth != null", ".write": "auth != null" },
    "cancelQueue": { ".read": "auth != null", ".write": "auth != null" },
    "priceData": { ".read": "auth != null", ".write": "auth != null" },
    "itemConfig": { ".read": "auth != null", ".write": "auth != null" }
  }
}
```

### 4. Get Config and Update index.html

Firebase Console → Project settings → General → Your apps → Web app → Register app

Copy the `firebaseConfig` object and paste it into the `firebaseConfig` const in `index.html`:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "amazon-sns.firebaseapp.com",
  databaseURL: "https://amazon-sns-default-rtdb.firebaseio.com",
  projectId: "amazon-sns",
  storageBucket: "amazon-sns.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};
```

---

## Weekly Price Scraper

An automated Playwright scraper (`scraper.mjs`) runs weekly to check current prices and find alternatives for every S&S item.

### What it does

1. Visits each item's Amazon product page (by ASIN)
2. Extracts S&S price, one-time price, savings %, and active coupons
3. Searches for up to 3 alternative products in the same category
4. Writes all data to Firebase `priceData/` node
5. The website reads `priceData/` on load to display price badges and alternatives

### Setup

```bash
cd "E:/Dropbox/Personal Files/Home/amazon-sns"
npm install
npx playwright install chromium
```

Create a Firebase service account:
1. Firebase Console → Project settings → Service accounts → Generate new private key
2. Save as `firebase-service-account.json` in the project root (gitignored)

### Manual run

```bash
node scraper.mjs              # scrape all items
node scraper.mjs --dry-run    # test without writing to Firebase
node scraper.mjs --item 13    # scrape a single item
```

### Automated weekly run

`schedule-scraper.bat` is registered in Windows Task Scheduler:
- **Trigger:** Weekly, Sunday at 1:00 AM
- **Effective window:** 1:00–4:00 AM (random 0–3 hour delay built in)
- **Logs:** `scraper.log` in the project directory

Register the task:
```cmd
schtasks /create /tn "AmazonSNS-PriceScraper" /tr "E:\Dropbox\Personal Files\Home\amazon-sns\schedule-scraper.bat" /sc weekly /d SUN /st 01:00 /rl HIGHEST /f
```

### Firebase data structure

```
priceData/{itemId}: {
  snsPrice: 24.64,
  oneTimePrice: 28.99,
  savingsPct: 15,
  coupons: [],
  alternatives: [
    { name: "Brand X", price: "$18.99", unitPrice: "$0.50/ea", asin: "B0..." }
  ],
  lastChecked: "2026-02-28T03:42:00Z"
}
```

---

## Frequency Optimization (Future)

Planned workflow:
1. Scrape Amazon order history via Playwright
2. Calculate actual consumption interval for each S&S item
3. Compare actual vs. current frequency
4. Generate recommendations report
5. Execute frequency changes on Amazon after approval

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
| 8 | Nescafe Taster's Choice (2x7 oz) | $22.92 | 1 | 6 mo | $22.92 |
| 9 | Hill's Rx t/d Cat Food (8.5 lb) | — | 1 | 2 mo | — |
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

## Optimizations Made (2026-02-26)

### Lavazza Espresso Consolidation — saves $58.68/year

Had three overlapping Lavazza subscriptions delivering 4 bags/month at $73.27. Consolidated to a single 2-pack subscription at qty 2, delivering the same 4 bags/month at $68.38.

### Duplicate Febreze Cancelled

Removed an unavailable duplicate Febreze AIR subscription.

### Fish Oil Price Drop Detected

Management console showed $48.81 but the product page lists $45.01 for S&S. Saves $3.80/order = ~$15.20/year at quarterly frequency.

---

## Tech Stack

- **Frontend:** Single HTML file, vanilla JS, no build step
- **Hosting:** GitHub Pages
- **Sync:** Firebase Realtime Database + Anonymous Auth (optional, falls back to localStorage)
- **Automation:** Claude Code with Playwright MCP server (headless Chromium)
- **Price scraper:** Node.js + Playwright, runs weekly via Task Scheduler, writes to Firebase
- **Data:** localStorage + URL hash for UI state; Firebase for multi-browser sync + price data
