#!/usr/bin/env node
/**
 * Competitor Price Scraper for Amazon S&S Optimizer
 *
 * Scrapes prices from Target, Walmart, Costco, and Sam's Club
 * for items in the S&S catalog, then writes results to Firebase
 * competitorPrices/ node.
 *
 * Usage:
 *   node competitor-scraper.mjs                  # scrape all items, all stores
 *   node competitor-scraper.mjs --dry-run        # scrape but don't write to Firebase
 *   node competitor-scraper.mjs --store target   # only scrape Target
 *   node competitor-scraper.mjs --store walmart  # only scrape Walmart
 *   node competitor-scraper.mjs --item 13        # only scrape one item
 *   node competitor-scraper.mjs --item 13 --store target --dry-run
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
const BROWSER_PROFILE_DIR = resolve(__dirname, '.browser-profile-competitor');

const TARGET_API_KEY = '9f36aeafbe60771e321a5cc';
const TARGET_API_BASE = 'https://redsky.target.com/redsky_aggregations/v1/web/plp_search_v2';

// Item catalog — same IDs as scraper.mjs
const ITEMS = [
  { id: 13, name: "Presto! Toilet Paper (24 Family Mega Rolls)", searchTerm: "toilet paper 24 mega rolls" },
  { id: 43, name: "Lavazza Espresso Whole Bean Coffee (2-pack)", searchTerm: "Lavazza espresso whole bean coffee" },
  { id: 32, name: "Purina Friskies Variety Pack Cat Food (40 cans)", searchTerm: "Friskies variety pack cat food 40 cans" },
  { id: 18, name: "Purina Friskies Shreds Cat Food (24 cans)", searchTerm: "Friskies shreds cat food 24 cans" },
  { id: 5,  name: "Presto! Paper Towels (12 Huge Rolls)", searchTerm: "paper towels 12 rolls" },
  { id: 35, name: "Blue Diamond Dark Chocolate Almonds (25 oz)", searchTerm: "dark chocolate almonds 25 oz" },
  { id: 10, name: "Purina Cat Chow Naturals Indoor (13 lb)", searchTerm: "Purina Cat Chow indoor 13 lb" },
  { id: 20, name: "Terrasoul Organic Sunflower Seeds (2 lbs)", searchTerm: "organic sunflower seeds 2 lbs" },
  { id: 31, name: "Happy Belly Roasted Almonds (24 oz)", searchTerm: "roasted almonds 24 oz" },
  { id: 22, name: "Blue Diamond Wasabi & Soy Sauce Almonds (16 oz)", searchTerm: "wasabi soy sauce almonds" },
  { id: 30, name: "Purina ONE Dog Food Beef & Salmon (27.5 lb)", searchTerm: "Purina ONE dog food beef salmon" },
  { id: 29, name: "Har Bracha Tahini Paste (12 pack)", searchTerm: "tahini paste" },
  { id: 3,  name: "Lavazza Super Crema Whole Bean Coffee (2.2 lb)", searchTerm: "Lavazza Super Crema coffee" },
  { id: 1,  name: "Mucinex 12 Hour Maximum Strength 1200mg (48 tablets)", searchTerm: "Mucinex maximum strength 48 tablets" },
  { id: 28, name: "PUREPLUS 9690 Refrigerator Water Filter (4 pack)", searchTerm: "refrigerator water filter" },
  { id: 41, name: "Amazon Basics Liquid Hand Soap Refill (2-pack)", searchTerm: "liquid hand soap refill" },
  { id: 33, name: "Downy CALM Mega Dryer Sheets Lavender (130 ct)", searchTerm: "Downy dryer sheets lavender" },
  { id: 9,  name: "Hill's Prescription Diet t/d Cat Food (8.5 lb)", searchTerm: "Hill's Prescription Diet cat food" },
  { id: 14, name: "Gillette Clinical Deodorant Cool Wave (3-pack)", searchTerm: "Gillette Clinical deodorant" },
  { id: 40, name: "Endangered Species Dark Chocolate 88% (12 bars)", searchTerm: "dark chocolate 88% bars" },
  { id: 26, name: "Triple Strength Fish Oil Omega 3 (180 softgels)", searchTerm: "fish oil omega 3 180 softgels" },
  { id: 47, name: "Brawny Tear-A-Square Paper Towels (12 XL Rolls)", searchTerm: "Brawny paper towels 12 rolls" },
  { id: 21, name: "Energizer Ultimate Lithium 9V (2 pack)", searchTerm: "Energizer lithium 9V batteries" },
  { id: 27, name: "Vicks VapoShower Plus (12 count)", searchTerm: "Vicks VapoShower" },
  { id: 39, name: "GUM Soft-Picks Advanced (90ct, 3-pack)", searchTerm: "GUM Soft-Picks" },
  { id: 46, name: "Biotrue Contact Solution (10oz, 2-pack)", searchTerm: "Biotrue contact solution" },
  { id: 25, name: "Scotch Magic Tape (6 rolls w/ dispensers)", searchTerm: "Scotch magic tape 6 rolls" },
  { id: 45, name: "Gillette Clinical Deodorant Arctic Ice (2.6 oz)", searchTerm: "Gillette Clinical Arctic Ice deodorant" },
  { id: 36, name: "Dr. Elsey's Ultra Unscented Cat Litter (40 lb)", searchTerm: "Dr Elsey's cat litter 40 lb" },
  { id: 19, name: "Nautica Voyage EDT (6.7 oz)", searchTerm: "Nautica Voyage cologne" },
  { id: 8,  name: "Nescafe Taster's Choice Instant Coffee (2x 7oz)", searchTerm: "Nescafe Taster's Choice instant coffee" },
  { id: 12, name: "Sensodyne Pronamel Whitening Toothpaste (4-pack)", searchTerm: "Sensodyne Pronamel whitening toothpaste" },
  { id: 7,  name: "Gillette ProGlide Razor Refills (8 count)", searchTerm: "Gillette ProGlide refills 8 count" },
  { id: 15, name: "Lysol Disinfectant Wipes (4-pack)", searchTerm: "Lysol disinfectant wipes" },
  { id: 6,  name: "Febreze AIR Linen & Sky (6-pack)", searchTerm: "Febreze air freshener" },
  { id: 2,  name: "CeraVe Foaming Facial Cleanser (19 oz)", searchTerm: "CeraVe foaming facial cleanser" },
  { id: 11, name: "Energizer 123 Lithium Batteries (6 pack)", searchTerm: "Energizer 123 lithium batteries" },
  { id: 38, name: "Oral-B Glide Floss Pro-Health Mint (3-pack)", searchTerm: "Oral-B Glide floss" },
  { id: 16, name: "O'Keeffe's Working Hands (3.4 oz)", searchTerm: "O'Keeffe's Working Hands cream" },
  { id: 23, name: "Carlyle Melatonin 12mg (180 tablets)", searchTerm: "melatonin 12mg 180 tablets" },
  { id: 34, name: "Dove White Peach Body Scrub (15 oz)", searchTerm: "Dove body scrub" },
  { id: 4,  name: "Energizer 2032 Batteries (2 count)", searchTerm: "Energizer 2032 batteries" },
  { id: 17, name: "Reynolds Quick Cut Plastic Wrap (225 sq ft)", searchTerm: "Reynolds plastic wrap" },
];

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
  const match = String(text).replace(/,/g, '').match(/\$?([\d]+\.[\d]{2})/);
  return match ? parseFloat(match[1]) : null;
}

function parseUnitPrice(text) {
  if (!text) return { unitPrice: null, unit: null };
  const match = String(text).match(/\$?([\d]+\.?\d*)\s*(?:\/|per)\s*([\w\s]+)/i);
  if (match) {
    return { unitPrice: parseFloat(match[1]), unit: match[2].trim().toLowerCase() };
  }
  return { unitPrice: null, unit: null };
}

// ========== Unit Price Computation (same as scraper.mjs) ==========

const UNIT_MAPPINGS = {
  'toilet paper': { unit: 'roll', pattern: /(\d+)\s*(?:\w+\s+)*rolls?/i },
  'paper towels': { unit: 'roll', pattern: /(\d+)\s*(?:\w+\s+)*rolls?/i },
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
  'seeds': { unit: 'oz', pattern: /([\d.]+)\s*(?:lbs?|oz)/i, multiplier: (m) => m[0].includes('lb') ? parseFloat(m[1]) * 16 : parseFloat(m[1]) },
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
  }, 'competitor-scraper');
  return getDatabase(app);
}

async function saveCompetitorPrice(db, itemId, store, data) {
  if (!db) return;
  await db.ref(`competitorPrices/${itemId}/${store}`).set(data);
}

// ========== Base Scraper ==========

class BaseScraper {
  constructor(name, browserContext) {
    this.name = name;
    this.browserContext = browserContext;
    this.page = null;
  }

  async init() {
    this.page = await this.browserContext.newPage();
  }

  async close() {
    if (this.page) {
      await this.page.close();
      this.page = null;
    }
  }

  /**
   * Scrape a single item. Returns null if not found.
   * @param {object} item - { id, name, searchTerm }
   * @returns {object|null} - { name, price, unitPrice, unit, url }
   */
  async scrapeItem(/* item */) {
    throw new Error(`${this.name}: scrapeItem() not implemented`);
  }
}

// ========== Target Scraper ==========

export class TargetScraper extends BaseScraper {
  constructor(browserContext) {
    super('target', browserContext);
  }

  /**
   * Try the RedSky API first; fall back to DOM scraping if it fails.
   */
  async scrapeItem(item) {
    let result = await this._scrapeViaApi(item);
    if (!result) {
      log(`  [target] API failed for "${item.searchTerm}", falling back to DOM scrape`);
      result = await this._scrapeViaDom(item);
    }
    return result;
  }

  async _scrapeViaApi(item) {
    try {
      const params = new URLSearchParams({
        key: TARGET_API_KEY,
        keyword: item.searchTerm,
        channel: 'WEB',
        count: '10',
        default_purchasability_filter: 'true',
        page: '/s/' + encodeURIComponent(item.searchTerm),
        pricing_store_id: '3991',
        visitor_id: 'visitor_' + Date.now(),
      });

      const url = `${TARGET_API_BASE}?${params}`;
      const response = await this.page.evaluate(async (apiUrl) => {
        try {
          const res = await fetch(apiUrl, {
            headers: {
              'Accept': 'application/json',
              'Origin': 'https://www.target.com',
              'Referer': 'https://www.target.com/',
            },
          });
          if (!res.ok) return { error: res.status };
          return await res.json();
        } catch (e) {
          return { error: e.message };
        }
      }, url);

      if (response.error) {
        log(`  [target] API returned error: ${response.error}`);
        return null;
      }

      const products = response?.data?.search?.products;
      if (!products || products.length === 0) {
        log(`  [target] API returned no products for "${item.searchTerm}"`);
        return null;
      }

      // Pick the best product: prefer one whose name contains quantity info
      // that we can compute a unit price from, otherwise fall back to first
      let product = null;
      for (const p of products) {
        const title = p?.item?.product_description?.title || '';
        const pPrice = parsePrice(String(p?.price?.current_retail ?? p?.price?.formatted_current_price ?? ''));
        if (!pPrice) continue;
        const computed = computeUnitPrice(title, pPrice);
        if (computed) {
          product = p;
          log(`  [target] Picked "${title.slice(0, 60)}..." (has ${computed.count} ${computed.unit}s)`);
          break;
        }
      }
      if (!product) {
        // Fall back to first product with a price
        product = products.find(p => parsePrice(String(p?.price?.current_retail ?? p?.price?.formatted_current_price ?? '')));
      }
      if (!product) return null;

      const item_data = product?.item;
      const price_data = product?.price;

      if (!item_data || !price_data) return null;

      const productName = item_data.product_description?.title || '';
      const currentPrice = price_data.formatted_current_price
        || price_data.current_retail
        || null;
      const priceVal = parsePrice(
        String(price_data.current_retail ?? price_data.formatted_current_price ?? '')
      );
      const unitPriceStr = price_data.formatted_unit_price || '';
      const { unitPrice, unit } = parseUnitPrice(unitPriceStr);

      const tcin = product.tcin || '';
      const productUrl = tcin
        ? `https://www.target.com/p/-/A-${tcin}`
        : `https://www.target.com/s?searchTerm=${encodeURIComponent(item.searchTerm)}`;

      // Product image
      const imageUrl = item_data.enrichment?.images?.primary_image_url
        || item_data.enrichment?.images?.content_labels?.[0]?.image_url
        || '';

      if (!priceVal) {
        log(`  [target] Could not parse price from API for "${item.searchTerm}"`);
        return null;
      }

      return {
        name: cleanHtml(productName).slice(0, 200),
        price: priceVal,
        unitPrice: unitPrice,
        unit: unit,
        url: productUrl,
        image: imageUrl,
        lastChecked: new Date().toISOString(),
      };
    } catch (err) {
      log(`  [target] API error: ${err.message}`);
      return null;
    }
  }

  async _scrapeViaDom(item) {
    try {
      const searchUrl = `https://www.target.com/s?searchTerm=${encodeURIComponent(item.searchTerm)}`;
      await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await randomDelay(3000, 6000);

      // Wait for product cards to load
      try {
        await this.page.waitForSelector('[data-test="product-grid"] a, [data-test="@web/ProductCard/ProductCardVariantDefault"]', { timeout: 10000 });
      } catch {
        log(`  [target] No product cards found on page for "${item.searchTerm}"`);
        return null;
      }

      // Extract data from ALL product cards (up to 10)
      const results = await this.page.evaluate(() => {
        const cards = document.querySelectorAll(
          '[data-test="@web/ProductCard/ProductCardVariantDefault"], ' +
          '[data-test="product-grid"] > div, ' +
          'section[data-test="product-grid"] > div, ' +
          '[class*="ProductCardWrapper"], ' +
          '[class*="styles_cardOuter"]'
        );
        if (cards.length === 0) return [];

        function extractCard(card) {
          // Product name — try many approaches
          let name = '';
          const titleEl = card.querySelector('a[data-test="product-title"], [data-test="product-title"]');
          if (titleEl) name = titleEl.textContent.trim();
          if (!name) {
            const productLink = card.querySelector('a[href*="/p/"]');
            if (productLink) name = productLink.textContent.trim();
          }
          if (!name) {
            const ariaLink = card.querySelector('a[aria-label]');
            if (ariaLink) name = ariaLink.getAttribute('aria-label').trim();
          }
          if (!name) {
            const links = card.querySelectorAll('a');
            for (const link of links) {
              const text = link.textContent.trim();
              if (text.length > 5 && !text.startsWith('$')) { name = text; break; }
            }
          }
          if (!name) {
            const heading = card.querySelector('h3, h4, [class*="Title"], [class*="title"]');
            if (heading) name = heading.textContent.trim();
          }

          // Price
          const priceEl = card.querySelector('[data-test="current-price"]')
            || card.querySelector('span[class*="CurrentPrice"]')
            || card.querySelector('span[class*="styles_price"]');
          let priceText = priceEl ? priceEl.textContent.trim() : '';
          if (!priceText) {
            const match = card.textContent.match(/\$\d+\.\d{2}/);
            if (match) priceText = match[0];
          }

          // Unit price
          const unitEl = card.querySelector('[data-test="unit-price"]')
            || card.querySelector('span[class*="UnitPrice"]')
            || card.querySelector('[class*="styles_unitPrice"]');
          let unitText = unitEl ? unitEl.textContent.trim() : '';
          if (!unitText) {
            const unitMatch = card.textContent.match(/\(\$[\d.]+\/[a-z ]+\)/i);
            if (unitMatch) unitText = unitMatch[0];
          }

          // URL
          const linkEl = card.querySelector('a[href*="/p/"]')
            || card.querySelector('a[data-test="product-title"]')
            || card.querySelector('a[href*="target.com"]')
            || card.querySelector('a');
          let url = '';
          if (linkEl) {
            const href = linkEl.getAttribute('href') || '';
            url = href.startsWith('http') ? href : 'https://www.target.com' + href;
          }

          // Product image
          const imgEl = card.querySelector('img[src*="target.scene7.com"]')
            || card.querySelector('picture img')
            || card.querySelector('img[alt]');
          const image = imgEl ? (imgEl.getAttribute('src') || '') : '';

          return { name, priceText, unitText, url, image };
        }

        const out = [];
        for (let i = 0; i < Math.min(cards.length, 10); i++) {
          out.push(extractCard(cards[i]));
        }
        return out;
      });

      if (!results || results.length === 0) {
        log(`  [target] No cards extracted from DOM for "${item.searchTerm}"`);
        return null;
      }

      // Pick the best card: prefer one with a name we can compute unit price from
      let bestResult = null;
      for (const r of results) {
        const pv = parsePrice(r.priceText);
        if (!pv || !r.name) continue;
        const computed = computeUnitPrice(r.name, pv);
        if (computed) {
          bestResult = r;
          log(`  [target] Picked DOM card: "${r.name.slice(0, 60)}..." (has ${computed.count} ${computed.unit}s)`);
          break;
        }
      }
      // Fall back to first card with a price
      if (!bestResult) {
        bestResult = results.find(r => parsePrice(r.priceText) && r.name);
      }
      if (!bestResult || !bestResult.priceText) {
        log(`  [target] Could not extract price from DOM for "${item.searchTerm}"`);
        return null;
      }

      const priceVal = parsePrice(bestResult.priceText);
      if (!priceVal) return null;

      const { unitPrice, unit } = parseUnitPrice(bestResult.unitText);

      return {
        name: bestResult.name.slice(0, 200),
        price: priceVal,
        unitPrice: unitPrice,
        unit: unit,
        url: bestResult.url,
        image: bestResult.image || '',
        lastChecked: new Date().toISOString(),
      };
    } catch (err) {
      log(`  [target] DOM scrape error: ${err.message}`);
      return null;
    }
  }
}

// ========== Walmart Scraper ==========

export class WalmartScraper extends BaseScraper {
  constructor(browserContext) {
    super('walmart', browserContext);
  }

  async scrapeItem(item) {
    let result = null;
    try {
      result = await this._scrapeSearch(item);
    } catch (err) {
      log(`  [walmart] First attempt failed: ${err.message}`);
    }

    // Retry once on failure
    if (!result) {
      try {
        log(`  [walmart] Retrying "${item.searchTerm}" after delay...`);
        await randomDelay(5000, 10000);
        result = await this._scrapeSearch(item);
      } catch (err) {
        log(`  [walmart] Retry failed: ${err.message}`);
      }
    }

    return result;
  }

  async _scrapeSearch(item) {
    const searchUrl = `https://www.walmart.com/search?q=${encodeURIComponent(item.searchTerm)}`;
    await this.page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomDelay(3000, 6000);

    // Check for bot detection / CAPTCHA
    const pageContent = await this.page.content();
    if (pageContent.includes('Robot or human') || pageContent.includes('captcha')) {
      log(`  [walmart] Bot detection triggered for "${item.searchTerm}"`);
      return null;
    }

    // Strategy 1: Try JSON-LD structured data
    const jsonLdResult = await this.page.evaluate(() => {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        try {
          const data = JSON.parse(script.textContent);
          if (data['@type'] === 'ItemList' && data.itemListElement?.length > 0) {
            const first = data.itemListElement[0]?.item;
            if (first) {
              return {
                name: first.name || '',
                price: first.offers?.price || first.offers?.lowPrice || null,
                url: first.url || first['@id'] || '',
              };
            }
          }
        } catch { /* skip invalid JSON */ }
      }
      return null;
    });

    if (jsonLdResult && jsonLdResult.price) {
      const priceVal = typeof jsonLdResult.price === 'number'
        ? jsonLdResult.price
        : parsePrice(String(jsonLdResult.price));

      if (priceVal) {
        // Try to get unit price from the DOM for the first result
        const unitText = await this._extractUnitPrice();
        const { unitPrice, unit } = parseUnitPrice(unitText);

        const productUrl = jsonLdResult.url
          ? (jsonLdResult.url.startsWith('http') ? jsonLdResult.url : 'https://www.walmart.com' + jsonLdResult.url)
          : searchUrl;

        return {
          name: jsonLdResult.name.slice(0, 200),
          price: priceVal,
          unitPrice: unitPrice,
          unit: unit,
          url: productUrl,
          lastChecked: new Date().toISOString(),
        };
      }
    }

    // Strategy 2: DOM scraping
    // Wait for search results to appear
    try {
      await this.page.waitForSelector('[data-testid="list-view"] [data-item-id], [data-stack-index] [data-item-id], .search-result-gridview-item, [data-testid="search-result-listview-item"]', { timeout: 10000 });
    } catch {
      // Try a broader selector
      try {
        await this.page.waitForSelector('[role="group"] a[href*="/ip/"], .mb1 a[href*="/ip/"]', { timeout: 5000 });
      } catch {
        log(`  [walmart] No search results found for "${item.searchTerm}"`);
        return null;
      }
    }

    const domResult = await this.page.evaluate(() => {
      // Try multiple selectors for product cards
      const selectors = [
        '[data-item-id]',
        '.search-result-gridview-item',
        '[data-testid="search-result-listview-item"]',
        '[role="group"] > div',
      ];

      let card = null;
      for (const sel of selectors) {
        const cards = document.querySelectorAll(sel);
        if (cards.length > 0) {
          // Skip sponsored items (first card may be sponsored)
          for (const c of cards) {
            const sponsored = c.querySelector('[data-testid="sponsored-label"], [aria-label*="Sponsored"]');
            if (!sponsored) { card = c; break; }
          }
          if (!card) card = cards[0];
          break;
        }
      }

      if (!card) return null;

      // Product name
      const nameEl = card.querySelector('[data-automation-id="product-title"], span[data-automation-id="name"], a span[style]');
      const name = nameEl ? nameEl.textContent.trim() : '';

      // Price - look for the main current price
      const priceEl = card.querySelector('[data-automation-id="product-price"] span, [itemprop="price"], .f2, [data-testid="price-wrap"] span');
      let priceText = '';
      if (priceEl) {
        // Walmart often splits price into "current" and "cents" parts
        priceText = priceEl.closest('[data-automation-id="product-price"]')?.textContent
          || priceEl.textContent || '';
      }

      // If no structured price, look for any price pattern
      if (!priceText) {
        const allSpans = card.querySelectorAll('span');
        for (const s of allSpans) {
          const t = s.textContent.trim();
          if (/^\$\d+/.test(t) && t.length < 20) { priceText = t; break; }
        }
      }

      // Unit price
      const unitEl = card.querySelector('[data-automation-id="product-price-per-unit"], .f7.gray');
      const unitText = unitEl ? unitEl.textContent.trim() : '';

      // URL
      const linkEl = card.querySelector('a[href*="/ip/"]');
      let url = '';
      if (linkEl) {
        const href = linkEl.getAttribute('href') || '';
        url = href.startsWith('http') ? href : 'https://www.walmart.com' + href;
        // Remove tracking params
        try { url = url.split('?')[0]; } catch { /* keep as is */ }
      }

      return { name, priceText, unitText, url };
    });

    if (!domResult || !domResult.priceText) {
      log(`  [walmart] Could not extract price from DOM for "${item.searchTerm}"`);
      return null;
    }

    const priceVal = parsePrice(domResult.priceText);
    if (!priceVal) return null;

    const { unitPrice, unit } = parseUnitPrice(domResult.unitText);

    return {
      name: domResult.name.slice(0, 200),
      price: priceVal,
      unitPrice: unitPrice,
      unit: unit,
      url: domResult.url || searchUrl,
      lastChecked: new Date().toISOString(),
    };
  }

  async _extractUnitPrice() {
    try {
      return await this.page.evaluate(() => {
        const el = document.querySelector('[data-automation-id="product-price-per-unit"], .f7.gray');
        return el ? el.textContent.trim() : '';
      });
    } catch {
      return '';
    }
  }
}

// ========== Costco Scraper (Stub) ==========

export class CostcoScraper extends BaseScraper {
  constructor(browserContext) {
    super('costco', browserContext);
  }

  async init() {
    // No page needed for stub
  }

  async close() {
    // Nothing to close
  }

  async scrapeItem(/* item */) {
    log(`  [costco] Costco scraper requires membership credentials — skipping`);
    return null;
  }
}

// ========== Sam's Club Scraper (Stub) ==========

export class SamsClubScraper extends BaseScraper {
  constructor(browserContext) {
    super('samsclub', browserContext);
  }

  async init() {
    // No page needed for stub
  }

  async close() {
    // Nothing to close
  }

  async scrapeItem(/* item */) {
    log(`  [samsclub] Sam's Club scraper — membership inactive, skipping`);
    return null;
  }
}

// ========== HTML Helpers ==========

function cleanHtml(text) {
  if (!text) return '';
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ========== Store Registry ==========

const STORE_REGISTRY = {
  target:   { cls: TargetScraper,    label: 'Target' },
  walmart:  { cls: WalmartScraper,   label: 'Walmart' },
  costco:   { cls: CostcoScraper,    label: 'Costco' },
  samsclub: { cls: SamsClubScraper,  label: "Sam's Club" },
};

// ========== Main ==========

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');

  const storeArgIdx = args.indexOf('--store');
  const storeFilter = storeArgIdx >= 0 ? args[storeArgIdx + 1]?.toLowerCase() : null;

  const itemArgIdx = args.indexOf('--item');
  const singleItemId = itemArgIdx >= 0 ? parseInt(args[itemArgIdx + 1]) : null;

  log('=== Competitor Price Scraper ===');
  if (dryRun) log('DRY RUN — will not write to Firebase');

  // Validate store filter
  if (storeFilter && !STORE_REGISTRY[storeFilter]) {
    log(`ERROR: Unknown store "${storeFilter}". Valid stores: ${Object.keys(STORE_REGISTRY).join(', ')}`);
    process.exit(1);
  }

  // Determine which stores to scrape
  const storeKeys = storeFilter ? [storeFilter] : Object.keys(STORE_REGISTRY);
  log(`Stores: ${storeKeys.map(k => STORE_REGISTRY[k].label).join(', ')}`);

  // Filter items if --item specified
  const itemsToScrape = singleItemId
    ? ITEMS.filter(i => i.id === singleItemId)
    : ITEMS;

  if (itemsToScrape.length === 0) {
    log(`ERROR: No item found with ID ${singleItemId}`);
    process.exit(1);
  }

  log(`Items: ${itemsToScrape.length}`);

  // Init Firebase
  const db = dryRun ? null : initFirebaseAdmin();

  // Check if any active (non-stub) scrapers are selected
  const activeStores = storeKeys.filter(k => {
    const entry = STORE_REGISTRY[k];
    return entry.cls !== CostcoScraper && entry.cls !== SamsClubScraper;
  });
  const stubStores = storeKeys.filter(k => !activeStores.includes(k));

  // Log stubs immediately
  for (const key of stubStores) {
    const entry = STORE_REGISTRY[key];
    if (entry.cls === CostcoScraper) {
      log(`[costco] Costco scraper requires membership credentials — skipping all items`);
    } else if (entry.cls === SamsClubScraper) {
      log(`[samsclub] Sam's Club scraper — membership inactive, skipping all items`);
    }
  }

  // If only stub stores selected, exit early
  if (activeStores.length === 0) {
    log('No active scrapers to run. Done.');
    process.exit(0);
  }

  // Launch browser
  const browser = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
    headless: true,
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-US',
  });

  // Initialize scrapers
  const scrapers = {};
  for (const key of activeStores) {
    const entry = STORE_REGISTRY[key];
    scrapers[key] = new entry.cls(browser);
    await scrapers[key].init();
    log(`Initialized ${entry.label} scraper`);
  }

  let successCount = 0;
  let errorCount = 0;
  let skipCount = 0;

  for (const item of itemsToScrape) {
    log(`\n--- Item ${item.id}: ${item.name} ---`);

    for (const storeKey of activeStores) {
      const scraper = scrapers[storeKey];
      const storeLabel = STORE_REGISTRY[storeKey].label;

      try {
        log(`  Scraping ${storeLabel} for: ${item.searchTerm}`);
        const result = await scraper.scrapeItem(item);

        if (result) {
          log(`  [${storeKey}] Found: ${result.name.slice(0, 60)}... @ $${result.price.toFixed(2)}`);

          // Compute unit price from the competitor product name ONLY
          // Never fall back to Amazon item name — quantities differ between stores
          const computed = computeUnitPrice(result.name, result.price);
          if (computed) {
            result.computedUnitPrice = computed.formatted;
            result.computedUnitPriceNum = computed.unitPrice;
            result.computedUnit = computed.unit;
            result.computedUnitCount = computed.count;
            log(`  [${storeKey}] Computed unit price: ${computed.formatted} (${computed.count} ${computed.unit}s)`);
          } else if (result.unitPrice) {
            log(`  [${storeKey}] Store unit price: $${result.unitPrice}/${result.unit || '?'}`);
          }

          if (!dryRun) {
            await saveCompetitorPrice(db, item.id, storeKey, result);
            log(`  [${storeKey}] Saved to Firebase`);
          } else {
            log(`  [${storeKey}] [dry-run] Would save: ${JSON.stringify(result).slice(0, 200)}`);
          }
          successCount++;
        } else {
          log(`  [${storeKey}] No result found for "${item.searchTerm}"`);
          skipCount++;
        }
      } catch (err) {
        log(`  [${storeKey}] ERROR: ${err.message}`);
        errorCount++;
      }

      // Delay between stores for the same item (2-5 seconds)
      if (storeKey !== activeStores[activeStores.length - 1]) {
        await randomDelay(2000, 5000);
      }
    }

    // Delay between items (5-15 seconds)
    if (item !== itemsToScrape[itemsToScrape.length - 1]) {
      const delay = Math.floor(Math.random() * 10000) + 5000;
      log(`  Waiting ${(delay / 1000).toFixed(0)}s before next item...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }

  // Cleanup
  for (const storeKey of activeStores) {
    await scrapers[storeKey].close();
  }
  await browser.close();

  log(`\n=== Done: ${successCount} prices found, ${skipCount} not found, ${errorCount} errors ===`);
  process.exit(errorCount > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
