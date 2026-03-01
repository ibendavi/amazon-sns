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
 *   node scraper.mjs --discover   # discover ALL S&S subscriptions from management page
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

// ========== Unit Price Normalization ==========

const UNIT_MAPPINGS = {
  // Pattern: regex to match product name → { unit, extractCount: regex to extract count from name }
  // Toilet paper and paper towels: DON'T use "roll" as unit — roll sizes vary wildly
  // (Mega Roll, Huge Roll, Regular Roll, Double Roll are all different sizes).
  // Amazon's own unit price (e.g. "$0.39/100 Sheets") will display instead.
  'cat food.*cans': { unit: 'can', pattern: /(\d+)\s*cans?/i },
  'cat food.*lb': { unit: 'lb', pattern: /([\d.]+)\s*lbs?/i },
  'dog food.*lb': { unit: 'lb', pattern: /([\d.]+)\s*lbs?/i },
  'cat litter': { unit: 'lb', pattern: /(\d+)\s*lbs?/i },
  'coffee': { unit: 'oz', pattern: /([\d.]+)\s*(?:lbs?|oz|kg)/i, multiplier: (m) => {
    const val = parseFloat(m[1]);
    if (m[0].toLowerCase().includes('lb')) return val * 16;
    if (m[0].toLowerCase().includes('kg')) return val * 35.274;
    return val;
  }},
  'almonds': { unit: 'oz', pattern: /(\d+)\s*oz/i },
  'seeds': { unit: 'oz', pattern: /([\d.]+)\s*(?:lbs?|oz)/i, multiplier: (m) => m[0].toLowerCase().includes('lb') ? parseFloat(m[1]) * 16 : parseFloat(m[1]) },
  'batteries': { unit: 'battery', pattern: /(\d+)\s*(?:pack|count|ct)/i },
  'tablets': { unit: 'tablet', pattern: /(\d+)\s*tablets?/i },
  'softgels': { unit: 'softgel', pattern: /(\d+)\s*softgels?/i },
  'bars': { unit: 'bar', pattern: /(\d+)\s*bars?/i },
  'deodorant.*pack': { unit: 'stick', pattern: /(\d+)[- ]?pack/i },
  'dryer sheets': { unit: 'sheet', pattern: /(\d+)\s*(?:ct|count|sheets?)/i },
  'wipes.*pack': { unit: 'pack', pattern: /(\d+)[- ]?pack/i },
  'toothpaste.*pack': { unit: 'tube', pattern: /(\d+)[- ]?pack/i },
  'floss.*pack': { unit: 'pack', pattern: /(\d+)[- ]?pack/i },
  'razor.*refills': { unit: 'cartridge', pattern: /(\d+)\s*(?:count|ct|refills?)/i },
  'contact solution': { unit: 'oz', pattern: /([\d.]+)\s*oz/i },
  'soap.*refill': { unit: 'refill', pattern: /(\d+)[- ]?pack/i },
  'water filter': { unit: 'filter', pattern: /(\d+)\s*(?:pack|filters?)/i },
  'tape.*rolls': { unit: 'roll', pattern: /(\d+)\s*rolls?/i },
  'tahini': { unit: 'pack', pattern: /(\d+)\s*pack/i },
  'plastic wrap': { unit: 'sq ft', pattern: /(\d+)\s*sq\s*ft/i },
  'chocolate.*almonds': { unit: 'oz', pattern: /(\d+)\s*oz/i },
  'cleanser.*oz': { unit: 'oz', pattern: /([\d.]+)\s*oz/i },
  'body scrub': { unit: 'oz', pattern: /([\d.]+)\s*oz/i },
  'hand cream': { unit: 'oz', pattern: /([\d.]+)\s*oz/i },
  'cologne|edt|perfume': { unit: 'oz', pattern: /([\d.]+)\s*oz/i },
  'shower.*count': { unit: 'tablet', pattern: /(\d+)\s*(?:count|ct)/i },
  'soft.picks': { unit: 'pick', pattern: /(\d+)\s*(?:ct|count)/i },
  'melatonin': { unit: 'tablet', pattern: /(\d+)\s*tablets?/i },
};

function computeUnitPrice(itemName, totalPrice) {
  if (!totalPrice || totalPrice <= 0) return null;
  const nameLower = itemName.toLowerCase();

  for (const [keyword, mapping] of Object.entries(UNIT_MAPPINGS)) {
    const keyRe = new RegExp(keyword, 'i');
    if (!keyRe.test(nameLower)) continue;

    const match = itemName.match(mapping.pattern);
    if (!match) continue;

    let count;
    if (mapping.multiplier) {
      count = mapping.multiplier(match);
    } else {
      count = parseFloat(match[1]);
    }

    if (!count || count <= 0) continue;

    const unitPrice = totalPrice / count;
    return {
      unitPrice: Math.round(unitPrice * 100) / 100,
      unit: mapping.unit,
      count,
      formatted: `$${unitPrice.toFixed(2)}/${mapping.unit}`,
    };
  }

  return null;
}

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

async function appendPriceHistory(db, itemId, data) {
  if (!db) return;
  const dateKey = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  const historyEntry = {
    snsPrice: data.snsPrice,
    oneTimePrice: data.oneTimePrice,
    price: data.snsPrice || data.oneTimePrice,
    unitPrice: data.computedUnitPrice || null,
    date: dateKey,
  };
  await db.ref(`priceHistory/${itemId}/${dateKey}`).set(historyEntry);
}

async function checkPriceAlerts(db, itemId, itemName, data) {
  if (!db || !data.snsPrice) return;
  // Load previous price from history
  const snap = await db.ref(`priceHistory/${itemId}`).orderByKey().limitToLast(2).once('value');
  const history = snap.val();
  if (!history) return;

  const dates = Object.keys(history).sort();
  if (dates.length < 2) return;

  const previous = history[dates[dates.length - 2]];
  const prevPrice = previous?.snsPrice || previous?.price;
  if (!prevPrice) return;

  const dropPct = ((prevPrice - data.snsPrice) / prevPrice) * 100;
  if (dropPct >= 10) {
    await db.ref(`alerts/${itemId}`).set({
      type: 'price_drop',
      itemName,
      message: `Price dropped ${dropPct.toFixed(0)}%: $${prevPrice.toFixed(2)} → $${data.snsPrice.toFixed(2)}`,
      previousPrice: prevPrice,
      newPrice: data.snsPrice,
      dropPct: Math.round(dropPct),
      timestamp: new Date().toISOString(),
      dismissed: false,
    });
    log(`  ALERT: Price dropped ${dropPct.toFixed(0)}% for ${itemName}!`);
  }
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

  const result = { snsPrice: null, oneTimePrice: null, savingsPct: null, unitPrice: '', coupons: [], image: '' };

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

  // Extract unit price separately (more reliable selectors)
  result.unitPrice = await page.evaluate(() => {
    const selectors = ['.pricePerUnit', '.a-size-small.a-color-base.a-text-normal', '.a-size-mini.pricePerUnit'];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const t = el.textContent || '';
      const m = t.match(/\(\$(\d+\.?\d*)\$?\d*\.?\d*\s*\/\s*([\w\s]+)\)/);
      if (m) return '$' + m[1] + '/' + m[2].trim();
    }
    // Broader fallback: any element with "per" and "$" and "/"
    const all = document.querySelectorAll('span');
    for (const el of all) {
      const t = el.textContent.trim();
      if (t.length > 50 || !t.includes('/') || !t.includes('$')) continue;
      const m = t.match(/\$(\d+\.?\d*)\s*(?:per\s+\w+|\/)?\s*([\w\s]*)/);
      if (m && t.includes('/')) {
        const um = t.match(/\(\$(\d+\.?\d*)\$?\d*\.?\d*\s*\/\s*([\w\s]+)\)/);
        if (um) return '$' + um[1] + '/' + um[2].trim();
      }
    }
    return '';
  }) || '';

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

  // Extract product image
  result.image = await page.evaluate(() => {
    const img = document.querySelector('#landingImage, #imgBlkFront, #main-image, #ebooksImgBlkFront');
    if (img) {
      // Prefer data-old-hires (high-res) over src (which may be a placeholder)
      return img.getAttribute('data-old-hires') || img.getAttribute('src') || '';
    }
    return '';
  }) || '';

  return result;
}

async function scrapeAlternatives(page, itemName, currentAsin, currentPrice, maxAlts = 3) {
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

      // Unit price: search all spans for pattern like "($0.40/100 Sheets)"
      let unitPrice = '';
      for (const el of result.querySelectorAll('span')) {
        const t = el.textContent.trim();
        if (t.length > 60 || !t.includes('/') || !t.includes('$')) continue;
        const upm = t.match(/\(\$(\d+\.?\d*)\$?\d*\.?\d*\s*\/\s*([\w\s]+)\)/);
        if (upm) { unitPrice = '$' + upm[1] + '/' + upm[2].trim(); break; }
      }

      // Product image
      const imgEl = result.querySelector('img.s-image');
      const image = imgEl ? (imgEl.getAttribute('src') || '') : '';

      alts.push({
        name: (nameEl.textContent || '').trim().slice(0, 120),
        price: '$' + price.toFixed(2),
        priceNum: price,
        unitPrice,
        asin,
        image,
      });
    }
    return alts;
  }, { currentAsin, maxAlts, existingCount });

  alternatives = alternatives.concat(searchAlts).slice(0, maxAlts);

  // Enrich alternatives with short names or missing images — fetch product page
  for (const alt of alternatives) {
    if (alt.asin && (alt.name.length < 50 || !alt.image)) {
      try {
        log(`    Enriching "${alt.name.slice(0, 40)}..." via ${alt.asin}...`);
        await page.goto(`https://www.amazon.com/dp/${alt.asin}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await randomDelay(1500, 3000);
        const enriched = await page.evaluate(() => {
          const titleEl = document.querySelector('#productTitle');
          const imgEl = document.querySelector('#landingImage, #imgBlkFront, #main-image');
          return {
            title: titleEl ? titleEl.textContent.trim() : null,
            image: imgEl ? (imgEl.getAttribute('src') || '') : null,
          };
        });
        if (enriched.title && enriched.title.length > alt.name.length) {
          alt.name = enriched.title.slice(0, 150);
          log(`    -> "${alt.name.slice(0, 80)}..."`);
        }
        if (enriched.image && !alt.image) {
          alt.image = enriched.image;
        }
      } catch (e) {
        log(`    Could not enrich ${alt.asin}: ${e.message}`);
      }
    }
  }

  // Add savings vs current item and pick recommendation
  for (const alt of alternatives) {
    if (currentPrice && alt.priceNum) {
      const diff = currentPrice - alt.priceNum;
      if (diff > 0) {
        alt.savings = '$' + diff.toFixed(2) + ' less';
      } else if (diff < 0) {
        alt.savings = '$' + Math.abs(diff).toFixed(2) + ' more';
      }
    }
    delete alt.priceNum; // don't store in Firebase
  }

  // Recommend: cheapest alternative that saves money
  const cheapest = alternatives
    .filter(a => currentPrice && parseFloat(a.price.replace('$', '')) < currentPrice)
    .sort((a, b) => parseFloat(a.price.replace('$', '')) - parseFloat(b.price.replace('$', '')))[0];
  if (cheapest) {
    cheapest.recommended = true;
  }

  return alternatives;
}

// ========== Main ==========

// ========== Discover All Subscriptions ==========

async function discoverSubscriptions(browser, db) {
  log('=== Discovering ALL S&S Subscriptions ===');
  const page = await browser.newPage();

  // Navigate to S&S management page
  const url = 'https://www.amazon.com/gp/subscribe-and-save/manager/viewsubscriptions';
  log(`  Loading S&S management page...`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await randomDelay(3000, 5000);

  // Check if logged in (page might redirect to login)
  const currentUrl = page.url();
  if (currentUrl.includes('/ap/signin') || currentUrl.includes('/ap/mfa')) {
    log('  ERROR: Not logged in. Please log into Amazon in the browser profile first.');
    await page.close();
    return null;
  }

  // Scroll to load all subscriptions (lazy loading)
  let lastHeight = 0;
  for (let i = 0; i < 20; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await randomDelay(1500, 2500);
    const newHeight = await page.evaluate(() => document.body.scrollHeight);
    if (newHeight === lastHeight) break;
    lastHeight = newHeight;
  }

  // Extract subscription data from the management page
  const subscriptions = await page.evaluate(() => {
    const subs = [];

    // S&S management page shows subscription cards/rows
    // Each subscription has: product name, ASIN (in links), price, frequency, status
    const cards = document.querySelectorAll(
      '.subscription-card, [data-subscription-id], .subs-item, ' +
      'div[class*="subscription"], tr[class*="subscription"], ' +
      '.a-section[data-asin], [id*="subscription"]'
    );

    // Strategy 1: subscription cards with data attributes
    cards.forEach(card => {
      const asin = card.getAttribute('data-asin') ||
        card.querySelector('a[href*="/dp/"]')?.href?.match(/\/dp\/([A-Z0-9]{10})/)?.[1] || '';
      const nameEl = card.querySelector('.a-text-bold, .subscription-title, [class*="product-name"], .a-link-normal');
      const name = nameEl?.textContent?.trim() || '';
      const priceEl = card.querySelector('.a-price .a-offscreen, [class*="price"]');
      const price = priceEl?.textContent?.trim() || '';
      const freqEl = card.querySelector('[class*="frequency"], [class*="delivery"]');
      const freq = freqEl?.textContent?.trim() || '';
      const imgEl = card.querySelector('img[src*="images-amazon"]');
      const image = imgEl?.src || '';

      if (asin && name) {
        subs.push({ asin, name: name.substring(0, 120), price, freq, image });
      }
    });

    // Strategy 2: look for product links with /dp/ pattern across the page
    if (subs.length === 0) {
      const links = document.querySelectorAll('a[href*="/dp/"]');
      const seen = new Set();
      links.forEach(link => {
        const match = link.href.match(/\/dp\/([A-Z0-9]{10})/);
        if (!match || seen.has(match[1])) return;
        seen.add(match[1]);
        const name = link.textContent?.trim() ||
          link.closest('tr, .a-section, div')?.querySelector('img')?.alt || '';
        if (name && name.length > 5) {
          const row = link.closest('tr, .a-section, div[class*="subscription"]');
          const price = row?.querySelector('.a-price .a-offscreen, [class*="price"]')?.textContent?.trim() || '';
          const image = row?.querySelector('img[src*="images-amazon"]')?.src || '';
          subs.push({ asin: match[1], name: name.substring(0, 120), price, image, freq: '' });
        }
      });
    }

    return subs;
  });

  log(`  Found ${subscriptions.length} subscriptions on management page`);

  if (subscriptions.length > 0 && db) {
    // Save to Firebase subscriptions/ node
    const subsData = {};
    for (const sub of subscriptions) {
      // Use ASIN as key (stable across deliveries)
      subsData[sub.asin] = {
        name: sub.name,
        asin: sub.asin,
        price: sub.price,
        freq: sub.freq,
        image: sub.image,
        lastSeen: new Date().toISOString(),
      };
    }
    await db.ref('subscriptions').set(subsData);
    log(`  Saved ${subscriptions.length} subscriptions to Firebase`);

    // Also log what we found
    subscriptions.forEach((sub, i) => {
      log(`  ${i + 1}. ${sub.name} (${sub.asin}) ${sub.price}`);
    });
  } else if (subscriptions.length === 0) {
    log('  WARNING: No subscriptions found. The page structure may have changed.');
    log('  Taking screenshot for debugging...');
    await page.screenshot({ path: 'sns-management-debug.png', fullPage: true });
    log('  Screenshot saved to sns-management-debug.png');
  }

  await page.close();
  return subscriptions;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const discover = args.includes('--discover');
  const singleItemArg = args.indexOf('--item');
  const singleItemId = singleItemArg >= 0 ? parseInt(args[singleItemArg + 1]) : null;

  log('=== Amazon S&S Price Scraper ===');
  if (dryRun) log('DRY RUN — will not write to Firebase');

  // Init Firebase
  const db = dryRun ? null : initFirebaseAdmin();

  // --discover mode: scrape S&S management page for all subscriptions
  if (discover) {
    const browser = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
      headless: true,
      viewport: { width: 1366, height: 768 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      locale: 'en-US',
    });
    await discoverSubscriptions(browser, db);
    await browser.close();
    return;
  }

  const asins = await loadAsins(db);
  log(`Loaded ${Object.keys(asins).length} stored ASINs`);

  // Load items: merge hardcoded ITEMS with Firebase subscriptions
  let itemsToScrape;
  if (singleItemId) {
    itemsToScrape = ITEMS.filter(i => i.id === singleItemId);
  } else {
    // Start with hardcoded items
    itemsToScrape = [...ITEMS];
    // Merge in Firebase subscriptions not already in ITEMS
    if (db) {
      const snap = await db.ref('subscriptions').once('value');
      const subs = snap.val() || {};
      const existingAsins = new Set(Object.values(asins));
      const existingIds = new Set(ITEMS.map(i => i.id));
      let nextId = Math.max(...ITEMS.map(i => i.id)) + 1;
      for (const [asin, sub] of Object.entries(subs)) {
        if (!existingAsins.has(asin)) {
          const newItem = { id: nextId++, name: sub.name };
          itemsToScrape.push(newItem);
          asins[newItem.id] = asin;
          log(`  Added subscription from Firebase: ${sub.name} (${asin})`);
        }
      }
    }
  }

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

  // Incognito context for checking "new subscriber" prices
  // (not logged in = shows what a new subscriber would pay)
  const incognitoBrowser = await chromium.launch({ headless: true });
  const incognitoCtx = await incognitoBrowser.newContext({
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-US',
  });
  const incognitoPage = await incognitoCtx.newPage();

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
      const alternatives = await scrapeAlternatives(page, item.name, asin, priceResult.snsPrice || priceResult.oneTimePrice);
      log(`  Found ${alternatives.length} alternatives`);

      // Compute normalized unit price
      const effectivePrice = priceResult.snsPrice || priceResult.oneTimePrice;
      const computed = computeUnitPrice(item.name, effectivePrice);
      if (computed) {
        log(`  Computed unit price: ${computed.formatted} (${computed.count} ${computed.unit}s)`);
      }

      // Compute unit prices for alternatives too
      for (const alt of alternatives) {
        const altPrice = parseFloat((alt.price || '').replace('$', ''));
        const altComputed = computeUnitPrice(alt.name, altPrice);
        if (altComputed) {
          alt.computedUnitPrice = altComputed.formatted;
          alt.computedUnitPriceNum = altComputed.unitPrice;
          alt.computedUnit = altComputed.unit;
        }
      }

      // Re-evaluate "recommended" based on unit price if available
      const altsWithUnit = alternatives.filter(a => a.computedUnitPriceNum);
      if (altsWithUnit.length > 0 && computed) {
        // Clear old recommendations
        alternatives.forEach(a => delete a.recommended);
        // Find the cheapest by unit price (including current item)
        const cheapestAlt = altsWithUnit
          .filter(a => a.computedUnitPriceNum < computed.unitPrice)
          .sort((a, b) => a.computedUnitPriceNum - b.computedUnitPriceNum)[0];
        if (cheapestAlt) cheapestAlt.recommended = true;
      }

      // Check "new subscriber" price in incognito (not logged in)
      let resubPrice = null;
      try {
        const incognitoResult = await scrapeProductPage(incognitoPage, asin);
        resubPrice = incognitoResult.snsPrice;
        if (resubPrice && priceResult.snsPrice) {
          const diff = priceResult.snsPrice - resubPrice;
          if (diff > 0.05) {
            log(`  ** RESUB OPPORTUNITY: Current $${priceResult.snsPrice.toFixed(2)} → New sub $${resubPrice.toFixed(2)} (save $${diff.toFixed(2)})`);
          } else if (diff < -0.05) {
            log(`  Current price is BETTER: $${priceResult.snsPrice.toFixed(2)} vs new sub $${resubPrice.toFixed(2)}`);
          } else {
            log(`  Resub price: same ($${resubPrice.toFixed(2)})`);
          }
        }
      } catch (err) {
        log(`  Could not check resub price: ${err.message}`);
      }

      // Build data object
      const data = {
        snsPrice: priceResult.snsPrice,
        oneTimePrice: priceResult.oneTimePrice,
        resubPrice,
        savingsPct: priceResult.savingsPct,
        unitPrice: priceResult.unitPrice,
        computedUnitPrice: computed ? computed.formatted : null,
        computedUnitPriceNum: computed ? computed.unitPrice : null,
        computedUnit: computed ? computed.unit : null,
        computedUnitCount: computed ? computed.count : null,
        coupons: priceResult.coupons,
        image: priceResult.image || '',
        alternatives,
        lastChecked: new Date().toISOString(),
      };

      // Save to Firebase
      if (!dryRun) {
        await savePriceData(db, item.id, data);
        await appendPriceHistory(db, item.id, data);
        await checkPriceAlerts(db, item.id, item.name, data);
        log(`  Saved to Firebase (price data + history)`);
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

  await incognitoBrowser.close();
  await browser.close();

  log(`\n=== Done: ${successCount} succeeded, ${errorCount} failed ===`);
  process.exit(errorCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
