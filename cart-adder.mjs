#!/usr/bin/env node
/**
 * Competitor Cart Adder
 *
 * Reads competitorPrices/ and priceData/ from Firebase, compares prices,
 * and adds items to Target or Walmart carts where they offer better value.
 * Does NOT checkout — just adds to cart for user review.
 *
 * Usage:
 *   node cart-adder.mjs                  # add all best-value competitor items to carts
 *   node cart-adder.mjs --dry-run        # just show what would be added (recommended first run)
 *   node cart-adder.mjs --store target   # only add Target items
 *   node cart-adder.mjs --store walmart  # only add Walmart items
 */

import { chromium } from 'playwright';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ========== Configuration ==========

const FIREBASE_DB_URL = 'https://amazon-sns-ibendavi-default-rtdb.firebaseio.com';
const SERVICE_ACCOUNT_PATH = resolve(__dirname, 'firebase-service-account.json');
const BROWSER_PROFILE_DIR = resolve(__dirname, '.browser-profile-shopping');
const SCREENSHOTS_DIR = resolve(__dirname, '.screenshots');

// Item catalog — same IDs as scraper.mjs / index.html
const ITEMS = [
  { id: 13, name: "Presto! Toilet Paper (24 Family Mega Rolls)" },
  { id: 43, name: "Lavazza Espresso Whole Bean Coffee (2-pack)" },
  { id: 32, name: "Purina Friskies Variety Pack Cat Food (40 cans)" },
  { id: 18, name: "Purina Friskies Shreds Cat Food (24 cans)" },
  { id: 5,  name: "Presto! Paper Towels (12 Huge Rolls)" },
  { id: 35, name: "Blue Diamond Dark Chocolate Almonds (25 oz)" },
  { id: 10, name: "Purina Cat Chow Naturals Indoor (13 lb)" },
  { id: 20, name: "Terrasoul Organic Sunflower Seeds (2 lbs)" },
  { id: 31, name: "Happy Belly Roasted Almonds (24 oz)" },
  { id: 22, name: "Blue Diamond Wasabi & Soy Sauce Almonds (16 oz)" },
  { id: 30, name: "Purina ONE Dog Food Beef & Salmon (27.5 lb)" },
  { id: 29, name: "Har Bracha Tahini Paste (12 pack)" },
  { id: 3,  name: "Lavazza Super Crema Whole Bean Coffee (2.2 lb)" },
  { id: 1,  name: "Mucinex 12 Hour Maximum Strength 1200mg (48 tablets)" },
  { id: 28, name: "PUREPLUS 9690 Refrigerator Water Filter (4 pack)" },
  { id: 41, name: "Amazon Basics Liquid Hand Soap Refill (2-pack)" },
  { id: 33, name: "Downy CALM Mega Dryer Sheets Lavender (130 ct)" },
  { id: 9,  name: "Hill's Prescription Diet t/d Cat Food (8.5 lb)" },
  { id: 14, name: "Gillette Clinical Deodorant Cool Wave (3-pack)" },
  { id: 40, name: "Endangered Species Dark Chocolate 88% (12 bars)" },
  { id: 26, name: "Triple Strength Fish Oil Omega 3 (180 softgels)" },
  { id: 47, name: "Brawny Tear-A-Square Paper Towels (12 XL Rolls)" },
  { id: 21, name: "Energizer Ultimate Lithium 9V (2 pack)" },
  { id: 27, name: "Vicks VapoShower Plus (12 count)" },
  { id: 39, name: "GUM Soft-Picks Advanced (90ct, 3-pack)" },
  { id: 46, name: "Biotrue Contact Solution (10oz, 2-pack)" },
  { id: 25, name: "Scotch Magic Tape (6 rolls w/ dispensers)" },
  { id: 45, name: "Gillette Clinical Deodorant Arctic Ice (2.6 oz)" },
  { id: 36, name: "Dr. Elsey's Ultra Unscented Cat Litter (40 lb)" },
  { id: 19, name: "Nautica Voyage EDT (6.7 oz)" },
  { id: 8,  name: "Nescafe Taster's Choice Instant Coffee (2x 7oz)" },
  { id: 12, name: "Sensodyne Pronamel Whitening Toothpaste (4-pack)" },
  { id: 7,  name: "Gillette ProGlide Razor Refills (8 count)" },
  { id: 15, name: "Lysol Disinfectant Wipes (4-pack)" },
  { id: 6,  name: "Febreze AIR Linen & Sky (6-pack)" },
  { id: 2,  name: "CeraVe Foaming Facial Cleanser (19 oz)" },
  { id: 11, name: "Energizer 123 Lithium Batteries (6 pack)" },
  { id: 38, name: "Oral-B Glide Floss Pro-Health Mint (3-pack)" },
  { id: 16, name: "O'Keeffe's Working Hands (3.4 oz)" },
  { id: 23, name: "Carlyle Melatonin 12mg (180 tablets)" },
  { id: 34, name: "Dove White Peach Body Scrub (15 oz)" },
  { id: 4,  name: "Energizer 2032 Batteries (2 count)" },
  { id: 17, name: "Reynolds Quick Cut Plastic Wrap (225 sq ft)" },
];

const ITEMS_BY_ID = {};
for (const item of ITEMS) ITEMS_BY_ID[item.id] = item;

// ========== Helpers ==========

function randomDelay(minMs, maxMs) {
  const ms = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  return new Promise(r => setTimeout(r, ms));
}

function log(msg) {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  console.log(`[${ts}] ${msg}`);
}

function parsePrice(text) {
  if (!text) return null;
  const match = text.replace(/,/g, '').match(/\$?([\d]+\.[\d]{2})/);
  return match ? parseFloat(match[1]) : null;
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ========== Firebase ==========

function initFirebaseAdmin() {
  if (!existsSync(SERVICE_ACCOUNT_PATH)) {
    log('WARNING: No service account file found at ' + SERVICE_ACCOUNT_PATH);
    log('Run without Firebase writes (--dry-run) or create a service account.');
    return null;
  }
  const serviceAccount = JSON.parse(readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
  const app = initializeApp({
    credential: cert(serviceAccount),
    databaseURL: FIREBASE_DB_URL,
  });
  return getDatabase(app);
}

/**
 * Load competitor prices from Firebase.
 * Expected structure: competitorPrices/{itemId}/{store} = { price, url, unitPrice, lastChecked }
 */
async function loadCompetitorPrices(db) {
  if (!db) return {};
  const snap = await db.ref('competitorPrices').once('value');
  return snap.val() || {};
}

/**
 * Load Amazon S&S prices from Firebase.
 * Expected structure: priceData/{itemId} = { snsPrice, oneTimePrice, ... }
 */
async function loadPriceData(db) {
  if (!db) return {};
  const snap = await db.ref('priceData').once('value');
  return snap.val() || {};
}

// ========== Price Comparison ==========

/**
 * Compare competitor prices against Amazon S&S prices.
 * Returns items where a competitor offers a better price, grouped by store.
 *
 * Each entry: { itemId, itemName, store, competitorPrice, competitorUrl, amazonPrice, savings }
 */
function findBetterDeals(competitorPrices, priceData, storeFilter) {
  const deals = [];

  for (const [itemId, stores] of Object.entries(competitorPrices)) {
    const item = ITEMS_BY_ID[itemId];
    if (!item) continue;

    // Get Amazon S&S price (prefer snsPrice, fall back to oneTimePrice)
    const amazonData = priceData[itemId];
    const amazonPrice = amazonData?.snsPrice || amazonData?.oneTimePrice || null;
    if (!amazonPrice) continue;

    for (const [store, data] of Object.entries(stores)) {
      // Apply store filter if specified
      if (storeFilter && store.toLowerCase() !== storeFilter.toLowerCase()) continue;

      // Only handle Target and Walmart
      const storeLower = store.toLowerCase();
      if (storeLower !== 'target' && storeLower !== 'walmart') continue;

      const competitorPrice = typeof data.price === 'number' ? data.price : parsePrice(String(data.price));
      if (!competitorPrice || !data.url) continue;

      // Only include if competitor is actually cheaper
      if (competitorPrice < amazonPrice) {
        deals.push({
          itemId: parseInt(itemId),
          itemName: item.name,
          store: storeLower,
          competitorPrice,
          competitorUrl: data.url,
          competitorUnitPrice: data.unitPrice || '',
          amazonPrice,
          savings: Math.round((amazonPrice - competitorPrice) * 100) / 100,
          savingsPct: Math.round((1 - competitorPrice / amazonPrice) * 100),
        });
      }
    }
  }

  // Sort by savings (highest first)
  deals.sort((a, b) => b.savings - a.savings);
  return deals;
}

// ========== Store: Target ==========

async function addToCartTarget(page, deal, screenshotsDir) {
  const { itemId, itemName, competitorUrl } = deal;
  log(`  [Target] Navigating to: ${competitorUrl}`);

  await page.goto(competitorUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await randomDelay(2000, 4000);

  // Take screenshot before attempting add
  const screenshotPath = resolve(screenshotsDir, `target-${itemId}-before.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  log(`  Screenshot saved: ${screenshotPath}`);

  // Look for "Add to cart" button — Target uses several variations
  const addBtn = await page.$(
    'button[data-test="addToCartButton"], ' +
    'button[data-test="shipItButton"], ' +
    'button[aria-label*="Add to cart"], ' +
    'button:has-text("Add to cart"), ' +
    'button:has-text("Ship it")'
  );

  if (!addBtn) {
    log(`  WARNING: Could not find "Add to cart" button for item ${itemId} (${itemName})`);
    const screenshotFail = resolve(screenshotsDir, `target-${itemId}-no-button.png`);
    await page.screenshot({ path: screenshotFail, fullPage: true });
    return false;
  }

  await addBtn.click();
  log(`  Clicked "Add to cart"`);
  await randomDelay(2000, 4000);

  // Verify item was added — look for cart confirmation dialog or updated cart count
  const confirmed = await page.evaluate(() => {
    // Target shows a confirmation modal or side panel
    const confirmModal = document.querySelector(
      '[data-test="addToCartModalContent"], ' +
      '[data-test="content-wrapper"] h2, ' +
      '[class*="CartConfirmation"], ' +
      'div[role="dialog"]'
    );
    if (confirmModal) {
      const text = confirmModal.textContent || '';
      if (text.toLowerCase().includes('added to cart') || text.toLowerCase().includes('choose')) {
        return true;
      }
    }
    // Also check if cart count increased (visible in header)
    const cartCount = document.querySelector('[data-test="addToCartCount"], [data-test="@web/CartLink"] span');
    if (cartCount && parseInt(cartCount.textContent) > 0) return true;
    return false;
  });

  if (confirmed) {
    log(`  Confirmed: item added to Target cart`);
  } else {
    log(`  WARNING: Could not confirm item was added to Target cart`);
    const screenshotAfter = resolve(screenshotsDir, `target-${itemId}-after.png`);
    await page.screenshot({ path: screenshotAfter, fullPage: true });
  }

  // Close any confirmation dialogs so we can continue
  const closeBtn = await page.$(
    'button[data-test="addToCartModalCloseButton"], ' +
    'button[data-test="modal-close-button"], ' +
    'button[aria-label="Close"]'
  );
  if (closeBtn) {
    await closeBtn.click();
    await randomDelay(500, 1000);
  }

  return confirmed;
}

// ========== Store: Walmart ==========

async function addToCartWalmart(page, deal, screenshotsDir) {
  const { itemId, itemName, competitorUrl } = deal;
  log(`  [Walmart] Navigating to: ${competitorUrl}`);

  await page.goto(competitorUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await randomDelay(2000, 4000);

  // Take screenshot before attempting add
  const screenshotPath = resolve(screenshotsDir, `walmart-${itemId}-before.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  log(`  Screenshot saved: ${screenshotPath}`);

  // Look for "Add to cart" button — Walmart uses several variations
  const addBtn = await page.$(
    'button[data-testid="add-to-cart-btn"], ' +
    'button[id="add-to-cart-btn"], ' +
    'button:has-text("Add to cart"), ' +
    '[data-automation-id="atc-btn"], ' +
    'button[aria-label*="Add to cart"]'
  );

  if (!addBtn) {
    log(`  WARNING: Could not find "Add to cart" button for item ${itemId} (${itemName})`);
    const screenshotFail = resolve(screenshotsDir, `walmart-${itemId}-no-button.png`);
    await page.screenshot({ path: screenshotFail, fullPage: true });
    return false;
  }

  await addBtn.click();
  log(`  Clicked "Add to cart"`);
  await randomDelay(2000, 4000);

  // Verify item was added — Walmart shows a flyout or confirmation
  const confirmed = await page.evaluate(() => {
    // Walmart shows an "Added to cart" flyout or modal
    const confirmEl = document.querySelector(
      '[data-testid="atc-confirmation"], ' +
      '[class*="atc-confirmation"], ' +
      '[data-automation-id="atc-flyout"], ' +
      'div[role="dialog"]'
    );
    if (confirmEl) {
      const text = confirmEl.textContent || '';
      if (text.toLowerCase().includes('added to cart') || text.toLowerCase().includes('in your cart')) {
        return true;
      }
    }
    // Check cart count in header
    const cartCount = document.querySelector('[data-testid="cart-count"], .cart-count, [class*="CartCount"]');
    if (cartCount && parseInt(cartCount.textContent) > 0) return true;
    return false;
  });

  if (confirmed) {
    log(`  Confirmed: item added to Walmart cart`);
  } else {
    log(`  WARNING: Could not confirm item was added to Walmart cart`);
    const screenshotAfter = resolve(screenshotsDir, `walmart-${itemId}-after.png`);
    await page.screenshot({ path: screenshotAfter, fullPage: true });
  }

  // Close any confirmation dialogs
  const closeBtn = await page.$(
    'button[data-testid="atc-close-btn"], ' +
    'button[aria-label="Close"], ' +
    'button:has-text("Close"), ' +
    'button:has-text("Continue shopping")'
  );
  if (closeBtn) {
    await closeBtn.click();
    await randomDelay(500, 1000);
  }

  return confirmed;
}

// ========== Main ==========

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const storeIdx = args.indexOf('--store');
  const storeFilter = storeIdx >= 0 ? args[storeIdx + 1] : null;

  log('=== Competitor Cart Adder ===');
  if (dryRun) log('DRY RUN — will only show what would be added');
  if (storeFilter) log(`Filtering to store: ${storeFilter}`);

  // Init Firebase (always needed to read competitor prices)
  const db = initFirebaseAdmin();
  if (!db) {
    log('ERROR: Firebase is required to read competitor prices. Ensure firebase-service-account.json exists.');
    process.exit(1);
  }

  // Load data from Firebase
  log('Loading competitor prices from Firebase...');
  const competitorPrices = await loadCompetitorPrices(db);
  const competitorCount = Object.keys(competitorPrices).length;
  log(`Loaded competitor prices for ${competitorCount} items`);

  if (competitorCount === 0) {
    log('No competitor prices found in Firebase (competitorPrices/ is empty).');
    log('Populate competitorPrices/ first, then re-run.');
    process.exit(0);
  }

  log('Loading Amazon price data from Firebase...');
  const priceData = await loadPriceData(db);
  log(`Loaded Amazon prices for ${Object.keys(priceData).length} items`);

  // Find items where competitors are cheaper
  const deals = findBetterDeals(competitorPrices, priceData, storeFilter);

  if (deals.length === 0) {
    log('No competitor items are cheaper than Amazon S&S. Nothing to add to cart.');
    process.exit(0);
  }

  // Print deal summary
  log(`\nFound ${deals.length} items cheaper at competitors:\n`);
  for (const deal of deals) {
    log(`  Item ${deal.itemId}: ${deal.itemName}`);
    log(`    ${deal.store.charAt(0).toUpperCase() + deal.store.slice(1)}: $${deal.competitorPrice.toFixed(2)} vs Amazon S&S: $${deal.amazonPrice.toFixed(2)}`);
    log(`    Savings: $${deal.savings.toFixed(2)} (${deal.savingsPct}%)`);
    log(`    URL: ${deal.competitorUrl}`);
    log('');
  }

  if (dryRun) {
    log('=== Dry run complete. Use without --dry-run to add items to carts. ===');
    process.exit(0);
  }

  // Ensure screenshots directory exists
  ensureDir(SCREENSHOTS_DIR);

  // Launch browser with persistent profile (separate from Amazon scraper)
  log('Launching browser...');
  const browser = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
    headless: false, // visible so user can log in if needed
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-US',
  });

  const page = await browser.newPage();

  let addedCount = 0;
  let failedCount = 0;

  // Group deals by store to minimize store switching
  const targetDeals = deals.filter(d => d.store === 'target');
  const walmartDeals = deals.filter(d => d.store === 'walmart');

  // Process Target items
  if (targetDeals.length > 0) {
    log(`\n--- Adding ${targetDeals.length} items to Target cart ---`);
    for (const deal of targetDeals) {
      try {
        log(`\nItem ${deal.itemId}: ${deal.itemName} ($${deal.competitorPrice.toFixed(2)}, saves $${deal.savings.toFixed(2)})`);
        const success = await addToCartTarget(page, deal, SCREENSHOTS_DIR);
        if (success) {
          addedCount++;
        } else {
          failedCount++;
        }
      } catch (err) {
        log(`  ERROR adding item ${deal.itemId} to Target cart: ${err.message}`);
        failedCount++;
      }

      // 5-second pause between items for safety
      if (deal !== targetDeals[targetDeals.length - 1]) {
        log('  Waiting 5 seconds before next item...');
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  // Process Walmart items
  if (walmartDeals.length > 0) {
    log(`\n--- Adding ${walmartDeals.length} items to Walmart cart ---`);
    for (const deal of walmartDeals) {
      try {
        log(`\nItem ${deal.itemId}: ${deal.itemName} ($${deal.competitorPrice.toFixed(2)}, saves $${deal.savings.toFixed(2)})`);
        const success = await addToCartWalmart(page, deal, SCREENSHOTS_DIR);
        if (success) {
          addedCount++;
        } else {
          failedCount++;
        }
      } catch (err) {
        log(`  ERROR adding item ${deal.itemId} to Walmart cart: ${err.message}`);
        failedCount++;
      }

      // 5-second pause between items for safety
      if (deal !== walmartDeals[walmartDeals.length - 1]) {
        log('  Waiting 5 seconds before next item...');
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  }

  log(`\n=== Done: ${addedCount} added, ${failedCount} failed ===`);
  log('Review your carts before checking out:');
  if (targetDeals.length > 0) log('  Target:  https://www.target.com/cart');
  if (walmartDeals.length > 0) log('  Walmart: https://www.walmart.com/cart');

  // Leave browser open so user can review carts
  log('\nBrowser left open for review. Close it manually when done.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
