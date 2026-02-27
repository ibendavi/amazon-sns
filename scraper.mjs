#!/usr/bin/env node
/**
 * Amazon S&S Price Scraper
 *
 * Scrapes current prices and alternatives for each S&S item,
 * then writes results to Firebase priceData/ node.
 *
 * Usage:
 *   node scraper.mjs              # scrape all items
 *   node scraper.mjs --dry-run    # scrape but don't write to Firebase
 *   node scraper.mjs --item 13    # scrape a single item by ID
 */

import { chromium } from 'playwright';
import { initializeApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ========== Configuration ==========

const FIREBASE_DB_URL = 'https://amazon-sns-ibendavi-default-rtdb.firebaseio.com';
const SERVICE_ACCOUNT_PATH = resolve(__dirname, 'firebase-service-account.json');
const BROWSER_PROFILE_DIR = resolve(__dirname, '.browser-profile');

// Item catalog — same IDs as index.html
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

// ========== Helpers ==========

function randomDelay(minMs, maxMs) {
  const ms = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  return new Promise(r => setTimeout(r, ms));
}

function parsePrice(text) {
  if (!text) return null;
  const match = text.replace(/,/g, '').match(/\$?([\d]+\.[\d]{2})/);
  return match ? parseFloat(match[1]) : null;
}

function log(msg) {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  console.log(`[${ts}] ${msg}`);
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

async function loadAsins(db) {
  if (!db) return {};
  const snap = await db.ref('itemConfig').once('value');
  const data = snap.val() || {};
  const asins = {};
  for (const [id, config] of Object.entries(data)) {
    if (config.asin) asins[id] = config.asin;
  }
  return asins;
}

async function saveAsin(db, itemId, asin) {
  if (!db) return;
  await db.ref(`itemConfig/${itemId}/asin`).set(asin);
}

async function savePriceData(db, itemId, data) {
  if (!db) return;
  await db.ref(`priceData/${itemId}`).set(data);
}

// ========== Scraping ==========

async function extractAsinFromSearch(page, itemName) {
  log(`  Searching Amazon for: ${itemName}`);
  const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(itemName)}`;
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await randomDelay(2000, 4000);

  // Use data-asin attribute on search result divs (most reliable)
  const asin = await page.evaluate(() => {
    const results = document.querySelectorAll('[data-component-type="s-search-result"]');
    for (const r of results) {
      // Skip sponsored
      if (r.querySelector('.s-label-popover-default')) continue;
      const asin = r.getAttribute('data-asin');
      if (asin && asin.length === 10) return asin;
    }
    // Fallback: any result with data-asin
    for (const r of results) {
      const asin = r.getAttribute('data-asin');
      if (asin && asin.length === 10) return asin;
    }
    return null;
  });
  return asin;
}

async function scrapeProductPage(page, asin) {
  const url = `https://www.amazon.com/dp/${asin}`;
  log(`  Loading product page: ${url}`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await randomDelay(2000, 5000);

  const result = { snsPrice: null, oneTimePrice: null, savingsPct: null, coupons: [] };

  // Use page.evaluate to extract prices in-page where we can inspect context
  const prices = await page.evaluate(() => {
    const out = { sns: null, oneTime: null };

    // Helper: extract dollar amount >= $1 from text (skip unit prices like $0.75/count)
    function extractPrice(text) {
      if (!text) return null;
      const m = text.replace(/,/g, '').match(/\$(\d+\.?\d*)/);
      if (!m) return null;
      const v = parseFloat(m[1]);
      return v >= 1 ? v : null;
    }

    // --- S&S price ---
    // Method 1: The S&S accordion row price (most reliable)
    const snsAccordion = document.querySelector('#snsAccordionRowMiddle .a-price .a-offscreen, #newAccordionRow_1 .a-price .a-offscreen');
    if (snsAccordion) out.sns = extractPrice(snsAccordion.textContent);

    // Method 2: S&S base price element
    if (!out.sns) {
      const snsBase = document.querySelector('#sns-base-price');
      if (snsBase) out.sns = extractPrice(snsBase.textContent);
    }

    // Method 3: Look for text containing "Subscribe" near a price
    if (!out.sns) {
      const snsSections = document.querySelectorAll('#subscriptionPrice .a-offscreen, .sns-price-text .a-offscreen');
      for (const el of snsSections) {
        const p = extractPrice(el.textContent);
        if (p) { out.sns = p; break; }
      }
    }

    // --- One-time price ---
    // Method 1: Core price display (the main buy box price)
    const corePrice = document.querySelector('#corePriceDisplay_desktop_feature_div .a-price .a-offscreen, #corePrice_feature_div .a-price .a-offscreen');
    if (corePrice) out.oneTime = extractPrice(corePrice.textContent);

    // Method 2: One-time buy price element
    if (!out.oneTime) {
      const otb = document.querySelector('#oneTimeBuyPrice .a-offscreen, #price_inside_buybox');
      if (otb) out.oneTime = extractPrice(otb.textContent);
    }

    // Method 3: The one-time purchase accordion row
    if (!out.oneTime) {
      const otAccordion = document.querySelector('#newAccordionRow_0 .a-price .a-offscreen, #buyNew .a-price .a-offscreen');
      if (otAccordion) out.oneTime = extractPrice(otAccordion.textContent);
    }

    // Method 4: Fallback — first .a-price that's not crossed out and >= $1
    if (!out.oneTime) {
      const allPrices = document.querySelectorAll('.a-price:not(.a-text-price) .a-offscreen');
      for (const el of allPrices) {
        const p = extractPrice(el.textContent);
        if (p) { out.oneTime = p; break; }
      }
    }

    // If we got a one-time price but no S&S, and the page has S&S info,
    // the one-time price might actually be the S&S price shown in buy box
    if (!out.sns && out.oneTime) {
      const hasSns = document.querySelector('#sns-base-price, #snsAccordionRowMiddle, #subscriptionPrice, [data-feature-name="snsAccordion"]');
      if (hasSns) {
        // The displayed price is likely S&S; look for the list price as one-time
        const listPrice = document.querySelector('.a-text-price .a-offscreen, #listPrice, .basisPrice .a-offscreen');
        if (listPrice) {
          const lp = extractPrice(listPrice.textContent);
          if (lp && lp > out.oneTime) {
            out.sns = out.oneTime;
            out.oneTime = lp;
          }
        }
      }
    }

    return out;
  });

  result.snsPrice = prices.sns;
  result.oneTimePrice = prices.oneTime;

  // Calculate savings
  if (result.snsPrice && result.oneTimePrice && result.oneTimePrice > result.snsPrice) {
    result.savingsPct = Math.round((1 - result.snsPrice / result.oneTimePrice) * 100);
  }

  // Check for coupons
  const couponEl = await page.$('#couponBadgeRegularVpc, .couponBadge, #vpcButton');
  if (couponEl) {
    const couponText = await couponEl.textContent();
    if (couponText.trim()) result.coupons.push(couponText.trim());
  }

  return result;
}

async function scrapeAlternatives(page, itemName, currentAsin, maxAlts = 3) {
  // Strategy 1: Check Amazon's "Compare with similar items" on the product page
  // (we're still on the product page from scrapeProductPage)
  let alternatives = await page.evaluate(({ currentAsin, maxAlts }) => {
    const alts = [];

    // Look for comparison table / similar items widget
    const compRows = document.querySelectorAll('#HLCXComparisonTable .a-cardui, [data-component-type="s-impression-counter"] .a-carousel-card, .similarities-widget .a-carousel-card');
    for (const row of compRows) {
      if (alts.length >= maxAlts) break;
      const nameEl = row.querySelector('.a-link-normal .a-truncate-full, .a-link-normal .a-text-normal, a[title]');
      const priceEl = row.querySelector('.a-price .a-offscreen');
      const linkEl = row.querySelector('a[href*="/dp/"]');
      if (!nameEl || !priceEl || !linkEl) continue;

      const href = linkEl.getAttribute('href') || '';
      const asinMatch = href.match(/\/dp\/([A-Z0-9]{10})/);
      if (!asinMatch || asinMatch[1] === currentAsin) continue;

      const priceMatch = (priceEl.textContent || '').replace(/,/g, '').match(/\$([\d]+\.[\d]{2})/);
      if (!priceMatch) continue;

      alts.push({
        name: (nameEl.getAttribute('title') || nameEl.textContent || '').trim().slice(0, 120),
        price: '$' + priceMatch[1],
        unitPrice: '',
        asin: asinMatch[1],
      });
    }
    return alts;
  }, { currentAsin, maxAlts });

  if (alternatives.length >= maxAlts) return alternatives;

  // Strategy 2: Search Amazon for similar products
  const searchQuery = itemName
    .replace(/\(.*?\)/g, '')  // remove parentheticals like (24 rolls)
    .replace(/[!™®]/g, '')
    .trim();

  if (!searchQuery || searchQuery.length < 3) return alternatives;

  const searchUrl = `https://www.amazon.com/s?k=${encodeURIComponent(searchQuery)}`;
  log(`  Searching alternatives: ${searchQuery}`);
  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await randomDelay(2000, 4000);

  const existingCount = alternatives.length;
  const searchAlts = await page.evaluate(({ currentAsin, maxAlts, existingCount }) => {
    const alts = [];
    const results = document.querySelectorAll('[data-component-type="s-search-result"]');

    for (const result of results) {
      if (alts.length + existingCount >= maxAlts) break;

      // Skip sponsored results
      if (result.querySelector('.s-label-popover-default, [data-component-type="sp-sponsored-result"]')) continue;

      // Use data-asin attribute (most reliable)
      const asin = result.getAttribute('data-asin');
      if (!asin || asin === currentAsin) continue;

      // Product name from h2 span
      const nameEl = result.querySelector('h2 span');
      if (!nameEl) continue;

      // Get the whole-item price
      const priceWhole = result.querySelector('.a-price:not(.a-text-price) .a-price-whole');
      const priceFraction = result.querySelector('.a-price:not(.a-text-price) .a-price-fraction');
      if (!priceWhole) continue;

      const whole = (priceWhole.textContent || '').replace(/[^0-9]/g, '');
      const frac = (priceFraction ? priceFraction.textContent : '00').replace(/[^0-9]/g, '');
      const price = parseFloat(whole + '.' + frac);
      if (!price || price < 1) continue;

      // Unit price text
      const unitPriceEl = result.querySelector('.a-size-base.a-color-secondary');
      let unitPrice = '';
      if (unitPriceEl) {
        const upt = unitPriceEl.textContent || '';
        const upm = upt.match(/\(\$[\d.]+\/[^)]+\)/);
        if (upm) unitPrice = upm[0];
      }

      alts.push({
        name: (nameEl.textContent || '').trim().slice(0, 120),
        price: '$' + price.toFixed(2),
        unitPrice,
        asin,
      });
    }
    return alts;
  }, { currentAsin, maxAlts, existingCount });

  alternatives = alternatives.concat(searchAlts);
  return alternatives.slice(0, maxAlts);
}

// ========== Main ==========

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const singleItemArg = args.indexOf('--item');
  const singleItemId = singleItemArg >= 0 ? parseInt(args[singleItemArg + 1]) : null;

  log('=== Amazon S&S Price Scraper ===');
  if (dryRun) log('DRY RUN — will not write to Firebase');

  // Init Firebase
  const db = dryRun ? null : initFirebaseAdmin();
  const asins = await loadAsins(db);
  log(`Loaded ${Object.keys(asins).length} stored ASINs`);

  // Filter items if --item specified
  const itemsToScrape = singleItemId
    ? ITEMS.filter(i => i.id === singleItemId)
    : ITEMS;

  if (itemsToScrape.length === 0) {
    log('No items to scrape.');
    return;
  }

  log(`Scraping ${itemsToScrape.length} items...`);

  // Launch browser with persistent profile
  const browser = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
    headless: true,
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-US',
  });

  const page = await browser.newPage();

  let successCount = 0;
  let errorCount = 0;

  for (const item of itemsToScrape) {
    try {
      log(`\n--- Item ${item.id}: ${item.name} ---`);

      // Get or discover ASIN
      let asin = asins[item.id];
      if (!asin) {
        asin = await extractAsinFromSearch(page, item.name);
        if (asin) {
          log(`  Discovered ASIN: ${asin}`);
          asins[item.id] = asin;
          await saveAsin(db, item.id, asin);
        } else {
          log(`  ERROR: Could not find ASIN for ${item.name}`);
          errorCount++;
          await randomDelay(5000, 10000);
          continue;
        }
      } else {
        log(`  Using stored ASIN: ${asin}`);
      }

      // Scrape product page
      const priceResult = await scrapeProductPage(page, asin);
      log(`  S&S: $${priceResult.snsPrice || '?'} | One-time: $${priceResult.oneTimePrice || '?'} | Saves: ${priceResult.savingsPct || 0}%`);
      if (priceResult.coupons.length) log(`  Coupons: ${priceResult.coupons.join(', ')}`);

      // Scrape alternatives
      await randomDelay(3000, 8000);
      const alternatives = await scrapeAlternatives(page, item.name, asin);
      log(`  Found ${alternatives.length} alternatives`);

      // Build data object
      const data = {
        snsPrice: priceResult.snsPrice,
        oneTimePrice: priceResult.oneTimePrice,
        savingsPct: priceResult.savingsPct,
        coupons: priceResult.coupons,
        alternatives,
        lastChecked: new Date().toISOString(),
      };

      // Save to Firebase
      if (!dryRun) {
        await savePriceData(db, item.id, data);
        log(`  Saved to Firebase`);
      } else {
        log(`  [dry-run] Would save: ${JSON.stringify(data).slice(0, 200)}...`);
      }

      successCount++;

      // Random delay between items (10-30s)
      if (item !== itemsToScrape[itemsToScrape.length - 1]) {
        const delay = Math.floor(Math.random() * 20000) + 10000;
        log(`  Waiting ${(delay / 1000).toFixed(0)}s before next item...`);
        await new Promise(r => setTimeout(r, delay));
      }

    } catch (err) {
      log(`  ERROR scraping item ${item.id}: ${err.message}`);
      errorCount++;
      await randomDelay(10000, 20000);
    }
  }

  await browser.close();

  log(`\n=== Done: ${successCount} succeeded, ${errorCount} failed ===`);
  process.exit(errorCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
