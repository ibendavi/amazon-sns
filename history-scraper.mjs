#!/usr/bin/env node
/**
 * Amazon Order History Scraper
 *
 * Scrapes Amazon order history, matches orders to S&S items,
 * and calculates actual consumption intervals to identify
 * deletion candidates (items ordered too often, no longer needed, etc.).
 *
 * Usage:
 *   node history-scraper.mjs              # scrape all order history (past 1 year)
 *   node history-scraper.mjs --dry-run    # scrape but don't write to Firebase
 *   node history-scraper.mjs --months 6   # only go back 6 months
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
const ORDER_HISTORY_URL = 'https://www.amazon.com/your-orders/orders';

// S&S items — must match scraper.mjs / index.html IDs
const ITEMS = [
  { id: 13, name: "Presto! Toilet Paper", freq: "1 month" },
  { id: 43, name: "Lavazza Espresso Whole Bean Coffee", freq: "1 month" },
  { id: 32, name: "Purina Friskies Variety Pack Cat Food", freq: "1 month" },
  { id: 18, name: "Purina Friskies Shreds Cat Food", freq: "1 month" },
  { id: 5,  name: "Presto! Paper Towels", freq: "1 month" },
  { id: 35, name: "Blue Diamond Dark Chocolate Almonds", freq: "1 month" },
  { id: 10, name: "Purina Cat Chow Naturals Indoor", freq: "1 month" },
  { id: 20, name: "Terrasoul Organic Sunflower Seeds", freq: "1 month" },
  { id: 31, name: "Happy Belly Roasted Almonds", freq: "1 month" },
  { id: 22, name: "Blue Diamond Wasabi & Soy Sauce Almonds", freq: "1 month" },
  { id: 30, name: "Purina ONE Dog Food Beef & Salmon", freq: "1 month" },
  { id: 29, name: "Har Bracha Tahini Paste", freq: "2 months" },
  { id: 3,  name: "Lavazza Super Crema Whole Bean Coffee", freq: "2 months" },
  { id: 1,  name: "Mucinex 12 Hour Maximum Strength", freq: "2 months" },
  { id: 28, name: "PUREPLUS 9690 Refrigerator Water Filter", freq: "2 months" },
  { id: 41, name: "Amazon Basics Liquid Hand Soap Refill", freq: "2 months" },
  { id: 33, name: "Downy CALM Mega Dryer Sheets", freq: "2 months" },
  { id: 9,  name: "Hill's Prescription Diet t/d Cat Food", freq: "2 months" },
  { id: 14, name: "Gillette Clinical Deodorant Cool Wave", freq: "3 months" },
  { id: 40, name: "Endangered Species Dark Chocolate 88%", freq: "3 months" },
  { id: 26, name: "Triple Strength Fish Oil Omega 3", freq: "3 months" },
  { id: 47, name: "Brawny Tear-A-Square Paper Towels", freq: "3 months" },
  { id: 21, name: "Energizer Ultimate Lithium 9V", freq: "3 months" },
  { id: 27, name: "Vicks VapoShower Plus", freq: "3 months" },
  { id: 39, name: "GUM Soft-Picks Advanced", freq: "5 months" },
  { id: 46, name: "Biotrue Contact Solution", freq: "5 months" },
  { id: 25, name: "Scotch Magic Tape", freq: "4 months" },
  { id: 45, name: "Gillette Clinical Deodorant Arctic Ice", freq: "6 months" },
  { id: 36, name: "Dr. Elsey's Ultra Unscented Cat Litter", freq: "6 months" },
  { id: 19, name: "Nautica Voyage EDT", freq: "6 months" },
  { id: 8,  name: "Nescafe Taster's Choice Instant Coffee", freq: "6 months" },
  { id: 12, name: "Sensodyne Pronamel Whitening Toothpaste", freq: "6 months" },
  { id: 7,  name: "Gillette ProGlide Razor Refills", freq: "6 months" },
  { id: 15, name: "Lysol Disinfectant Wipes", freq: "6 months" },
  { id: 6,  name: "Febreze AIR Linen & Sky", freq: "6 months" },
  { id: 2,  name: "CeraVe Foaming Facial Cleanser", freq: "6 months" },
  { id: 11, name: "Energizer 123 Lithium Batteries", freq: "6 months" },
  { id: 38, name: "Oral-B Glide Floss Pro-Health Mint", freq: "6 months" },
  { id: 16, name: "O'Keeffe's Working Hands", freq: "6 months" },
  { id: 23, name: "Carlyle Melatonin 12mg", freq: "6 months" },
  { id: 34, name: "Dove White Peach Body Scrub", freq: "6 months" },
  { id: 4,  name: "Energizer 2032 Batteries", freq: "6 months" },
  { id: 17, name: "Reynolds Quick Cut Plastic Wrap", freq: "6 months" },
  { id: 42, name: "Lebanon Valley Tahineh", freq: "" },
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

function parseFreqDays(freq) {
  if (!freq) return null;
  const m = freq.match(/(\d+)\s*month/);
  return m ? parseInt(m[1]) * 30 : null;
}

function daysBetween(d1, d2) {
  return Math.round(Math.abs(new Date(d1) - new Date(d2)) / (1000 * 60 * 60 * 24));
}

/**
 * Fuzzy match an order item name to our S&S item list.
 * Uses both ASIN matching (if available) and name similarity.
 */
function matchOrderToItem(orderItemName, orderAsin, knownAsins) {
  // Strategy 1: Match by ASIN
  if (orderAsin) {
    for (const item of ITEMS) {
      if (knownAsins[item.id] === orderAsin) return item;
    }
  }

  // Strategy 2: Match by name keywords
  const orderLower = orderItemName.toLowerCase();
  let bestMatch = null;
  let bestScore = 0;

  for (const item of ITEMS) {
    const itemWords = item.name.toLowerCase().split(/\s+/);
    // Count how many words from the S&S item name appear in the order item name
    let matchCount = 0;
    for (const w of itemWords) {
      if (w.length < 3) continue; // skip short words
      if (orderLower.includes(w)) matchCount++;
    }
    const score = matchCount / itemWords.filter(w => w.length >= 3).length;
    if (score > bestScore && score >= 0.5) {
      bestScore = score;
      bestMatch = item;
    }
  }

  return bestMatch;
}

// ========== Firebase ==========

function initFirebaseAdmin() {
  if (!existsSync(SERVICE_ACCOUNT_PATH)) {
    log('WARNING: No service account file found at ' + SERVICE_ACCOUNT_PATH);
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

// ========== Scraping ==========

/**
 * Handle Amazon login. If --login flag is used, opens a visible browser
 * for manual login. Otherwise, relies on cookies in the persistent profile.
 */
async function ensureLoggedIn(page) {
  await page.goto(ORDER_HISTORY_URL, {
    waitUntil: 'domcontentloaded', timeout: 30000
  });
  await randomDelay(2000, 3000);

  // If we got redirected to sign-in, we're not logged in
  const url = page.url();
  if (url.includes('/ap/signin') || url.includes('/ap/mfa')) {
    log('Not logged in — redirected to sign-in page.');
    return false;
  }

  // Also check for sign-in form elements
  const isSignIn = await page.evaluate(() => {
    return !!document.querySelector('#ap_email, #ap_password, .a-form-label[for="ap_email"]');
  });

  if (isSignIn) {
    log('Not logged in — sign-in form detected.');
    return false;
  }

  return true;
}

/**
 * Automated login using stored credentials.
 */
async function doLogin(page, email, password) {
  log('Attempting automated login...');

  await page.goto('https://www.amazon.com/ap/signin?openid.pape.max_auth_age=0&openid.return_to=https%3A%2F%2Fwww.amazon.com%2Fgp%2Fyour-account%2Forder-history&openid.identity=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.assoc_handle=usflex&openid.mode=checkid_setup&openid.claimed_id=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0%2Fidentifier_select&openid.ns=http%3A%2F%2Fspecs.openid.net%2Fauth%2F2.0', {
    waitUntil: 'domcontentloaded', timeout: 30000
  });
  await randomDelay(1000, 2000);

  // Enter email
  const emailField = await page.$('#ap_email');
  if (emailField) {
    await emailField.fill(email);
    await randomDelay(500, 1000);
    const continueBtn = await page.$('#continue');
    if (continueBtn) {
      await continueBtn.click();
      await randomDelay(2000, 3000);
    }
  }

  // Enter password
  const passField = await page.$('#ap_password');
  if (passField) {
    await passField.fill(password);
    await randomDelay(500, 1000);
    const signInBtn = await page.$('#signInSubmit');
    if (signInBtn) {
      await signInBtn.click();
      await randomDelay(3000, 5000);
    }
  }

  // Check for CAPTCHA or 2FA
  const needsVerification = await page.evaluate(() => {
    return !!(
      document.querySelector('#auth-captcha-image-container') ||
      document.querySelector('#auth-mfa-otpcode') ||
      document.querySelector('.cvf-widget-form') ||
      document.querySelector('#auth-error-message-box')
    );
  });

  if (needsVerification) {
    log('CAPTCHA or 2FA required — please complete verification manually.');
    log('Waiting 60 seconds for manual intervention...');
    await new Promise(r => setTimeout(r, 60000));
  }

  return true;
}

/**
 * Scrape a single page of order history.
 * Returns array of { orderDate, orderId, items: [{ name, asin, price, qty, link }] }
 */
async function scrapeOrderPage(page) {
  return await page.evaluate(() => {
    const orders = [];

    // Each order is in a .order-card or .order container
    const orderCards = document.querySelectorAll('.order-card, .order, [class*="order-card"]');

    for (const card of orderCards) {
      // Order date — look for date-like text in header area
      let orderDate = '';
      const dateEl = card.querySelector(
        '.order-header .a-color-secondary.value, ' +
        '[class*="order-header"] .a-color-secondary, ' +
        '.yohtmlc-order-level-connections .value, ' +
        '.a-span3 .value, .a-span4 .value'
      );
      if (dateEl) {
        const text = dateEl.textContent.trim();
        // Parse "March 10, 2026" or similar
        const d = new Date(text);
        if (!isNaN(d.getTime())) {
          orderDate = d.toISOString().split('T')[0];
        } else {
          orderDate = text;
        }
      }

      // Try other date selectors
      if (!orderDate) {
        const allTexts = card.querySelectorAll('.a-color-secondary');
        for (const el of allTexts) {
          const t = el.textContent.trim();
          const d = new Date(t);
          if (!isNaN(d.getTime()) && d.getFullYear() > 2020) {
            orderDate = d.toISOString().split('T')[0];
            break;
          }
        }
      }

      // Order ID
      let orderId = '';
      const orderIdEl = card.querySelector(
        '.yohtmlc-order-id .value, ' +
        '[class*="order-id"] .value, ' +
        'bdi'
      );
      if (orderIdEl) orderId = orderIdEl.textContent.trim();

      // Items in this order
      const itemEls = card.querySelectorAll(
        '.yohtmlc-item, ' +
        '.a-fixed-left-grid-inner, ' +
        '[class*="item-box"], ' +
        '.shipment .a-row'
      );

      const orderItems = [];
      const seenNames = new Set();

      for (const itemEl of itemEls) {
        // Item name — usually a link to the product
        const nameEl = itemEl.querySelector(
          '.yohtmlc-product-title, ' +
          'a[class*="product-title"], ' +
          '.a-link-normal[href*="/gp/product/"], ' +
          '.a-link-normal[href*="/dp/"]'
        );
        if (!nameEl) continue;

        const name = nameEl.textContent.trim();
        if (!name || name.length < 3 || seenNames.has(name)) continue;
        seenNames.add(name);

        // Extract ASIN from the product link
        const href = nameEl.getAttribute('href') || '';
        let asin = '';
        const asinMatch = href.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
        if (asinMatch) asin = asinMatch[1];

        // Price (if visible)
        let price = '';
        const priceEl = itemEl.querySelector(
          '.a-color-price, ' +
          '.yohtmlc-item .a-text-bold'
        );
        if (priceEl) {
          const pm = priceEl.textContent.match(/\$[\d,.]+/);
          if (pm) price = pm[0];
        }

        // Quantity
        let qty = 1;
        const qtyEl = itemEl.querySelector('.item-view-qty, [id*="qty"]');
        if (qtyEl) {
          const qm = qtyEl.textContent.match(/(\d+)/);
          if (qm) qty = parseInt(qm[1]);
        }

        orderItems.push({ name, asin, price, qty, link: href });
      }

      if (orderItems.length > 0 || orderDate) {
        orders.push({ orderDate, orderId, items: orderItems });
      }
    }

    return orders;
  });
}

/**
 * Alternative scraping approach: use the order details API-like pages
 * that have more structured data.
 */
async function scrapeOrdersStructured(page, monthsBack) {
  const allOrders = [];
  const cutoffDate = new Date();
  cutoffDate.setMonth(cutoffDate.getMonth() - monthsBack);

  // Amazon order history has year/filter selectors
  // We'll iterate through the pages using the "next" button
  const currentYear = new Date().getFullYear();
  const startYear = cutoffDate.getFullYear();

  for (let year = currentYear; year >= startYear; year--) {
    log(`Scraping orders from ${year}...`);

    // Navigate to order history for this year
    const url = `${ORDER_HISTORY_URL}?timeFilter=year-${year}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(3000, 5000);

    // Check if we need to log in
    const pageUrl = page.url();
    if (pageUrl.includes('/ap/signin') || pageUrl.includes('/ap/mfa')) {
      log('Session expired — login required.');
      return { orders: allOrders, needsLogin: true };
    }
    const isSignIn = await page.evaluate(() => {
      return !!document.querySelector('#ap_email, #ap_password');
    });
    if (isSignIn) {
      log('Session expired — login form detected.');
      return { orders: allOrders, needsLogin: true };
    }

    let pageNum = 1;
    let hasMore = true;

    while (hasMore) {
      log(`  Page ${pageNum}...`);

      // Scrape current page
      const pageOrders = await scrapeOrderPageNew(page);
      log(`  Found ${pageOrders.length} orders with ${pageOrders.reduce((s, o) => s + o.items.length, 0)} items`);

      // Debug: if first page has 0 orders, dump page info
      if (pageNum === 1 && pageOrders.length === 0) {
        const debugInfo = await page.evaluate(() => {
          const info = {};
          info.url = location.href;
          info.title = document.title;
          // Count elements with various selectors
          info.aBoxGroups = document.querySelectorAll('.a-box-group').length;
          info.aBoxes = document.querySelectorAll('.a-box').length;
          info.productLinks = document.querySelectorAll('a[href*="/dp/"], a[href*="/gp/product/"]').length;
          // Get all unique class names containing 'order'
          const orderClasses = new Set();
          document.querySelectorAll('*').forEach(el => {
            for (const cls of el.classList) {
              if (cls.toLowerCase().includes('order')) orderClasses.add(cls);
            }
          });
          info.orderClasses = [...orderClasses];
          info.bodySnippet = document.body?.innerText?.slice(0, 1000);
          return info;
        });
        log(`  DEBUG: URL=${debugInfo.url}`);
        log(`  DEBUG: Title=${debugInfo.title}`);
        log(`  DEBUG: .a-box-group=${debugInfo.aBoxGroups}, .a-box=${debugInfo.aBoxes}, productLinks=${debugInfo.productLinks}`);
        log(`  DEBUG: Order classes: ${debugInfo.orderClasses.join(', ')}`);
        log(`  DEBUG: Body snippet: ${debugInfo.bodySnippet?.slice(0, 500)}`);
      }

      for (const order of pageOrders) {
        // Check if order is within our time range
        if (order.orderDate) {
          const orderDt = new Date(order.orderDate);
          if (orderDt < cutoffDate) {
            log(`  Reached cutoff date (${cutoffDate.toISOString().split('T')[0]}). Stopping.`);
            hasMore = false;
            break;
          }
        }
        allOrders.push(order);
      }

      if (!hasMore) break;

      // Look for "Next" pagination button
      const nextBtn = await page.$('.a-pagination .a-last:not(.a-disabled) a, ul.a-pagination li.a-last a');
      if (nextBtn) {
        await nextBtn.click();
        await randomDelay(3000, 5000);
        pageNum++;
      } else {
        hasMore = false;
      }
    }

    await randomDelay(2000, 4000);
  }

  return { orders: allOrders, needsLogin: false };
}

/**
 * Scrape orders from the current page using Amazon's updated (2024+) DOM.
 */
async function scrapeOrderPageNew(page) {
  return await page.evaluate(() => {
    const orders = [];

    // Modern Amazon order history uses .order-card or similar containers
    // Try multiple selector strategies
    const orderContainers = document.querySelectorAll(
      '.order-card, ' +
      '.js-order-card, ' +
      '[data-component="orderCard"], ' +
      '.order'
    );

    // Fallback: if no structured containers, try finding order headers
    if (orderContainers.length === 0) {
      // Look for the overall order list
      const orderHeaders = document.querySelectorAll('.a-box-group .a-box:first-child');
      // This is a more generic approach; we'll handle it below
    }

    for (const container of orderContainers) {
      let orderDate = '';
      let orderId = '';
      const items = [];

      // --- Extract order date ---
      // Strategy 1: Look in the order info header
      const headerLabels = container.querySelectorAll('.a-column .label, .a-row .label, .yohtmlc-order-level-connections .label');
      const headerValues = container.querySelectorAll('.a-column .value, .a-row .value, .yohtmlc-order-level-connections .value');

      for (let i = 0; i < headerLabels.length; i++) {
        const label = (headerLabels[i]?.textContent || '').trim().toLowerCase();
        const value = (headerValues[i]?.textContent || '').trim();
        if (label.includes('order placed') || label.includes('date')) {
          const d = new Date(value);
          if (!isNaN(d.getTime())) {
            orderDate = d.toISOString().split('T')[0];
          }
        }
        if (label.includes('order #') || label.includes('order number')) {
          orderId = value;
        }
      }

      // Strategy 2: scan for date patterns in secondary text
      if (!orderDate) {
        const spans = container.querySelectorAll('.a-color-secondary, .a-size-mini, .a-size-small');
        for (const sp of spans) {
          const t = sp.textContent.trim();
          // Match "January 15, 2026" or "Feb 1, 2025" etc.
          const dm = t.match(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}/i);
          if (dm) {
            const d = new Date(dm[0]);
            if (!isNaN(d.getTime())) {
              orderDate = d.toISOString().split('T')[0];
              break;
            }
          }
        }
      }

      // --- Extract order ID ---
      if (!orderId) {
        const bdi = container.querySelector('bdi');
        if (bdi) orderId = bdi.textContent.trim();
      }
      if (!orderId) {
        const spans = container.querySelectorAll('.a-color-secondary, .value');
        for (const sp of spans) {
          const t = sp.textContent.trim();
          if (t.match(/^\d{3}-\d{7}-\d{7}$/)) {
            orderId = t;
            break;
          }
        }
      }

      // --- Extract items ---
      // Items are typically in links to product pages
      const productLinks = container.querySelectorAll(
        'a[href*="/gp/product/"], ' +
        'a[href*="/dp/"], ' +
        '.yohtmlc-product-title'
      );

      const seenAsins = new Set();
      for (const link of productLinks) {
        const name = link.textContent.trim();
        if (!name || name.length < 5) continue;

        // Extract ASIN from href
        const href = link.getAttribute('href') || '';
        let asin = '';
        const asinMatch = href.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/);
        if (asinMatch) asin = asinMatch[1];

        // Skip duplicates within same order
        const dedupKey = asin || name;
        if (seenAsins.has(dedupKey)) continue;
        seenAsins.add(dedupKey);

        // Try to find price near this item
        let price = '';
        const itemRow = link.closest('.a-fixed-left-grid-inner, .a-row, .yohtmlc-item, [class*="item"]');
        if (itemRow) {
          const priceEl = itemRow.querySelector('.a-color-price, .a-text-bold');
          if (priceEl) {
            const pm = priceEl.textContent.match(/\$[\d,.]+/);
            if (pm) price = pm[0];
          }
        }

        items.push({ name, asin, price, qty: 1, link: href });
      }

      if (orderDate || items.length > 0) {
        orders.push({ orderDate, orderId, items });
      }
    }

    return orders;
  });
}

// ========== Analysis ==========

/**
 * Analyze scraped orders and match them to S&S items.
 * Returns consumption data per item.
 */
function analyzeOrders(allOrders, knownAsins) {
  const itemOrders = {}; // itemId -> [{ date, price, qty, orderId, orderItemName }]

  for (const order of allOrders) {
    for (const oi of order.items) {
      const matched = matchOrderToItem(oi.name, oi.asin, knownAsins);
      if (!matched) continue;

      if (!itemOrders[matched.id]) itemOrders[matched.id] = [];
      itemOrders[matched.id].push({
        date: order.orderDate,
        price: oi.price,
        qty: oi.qty,
        orderId: order.orderId,
        orderItemName: oi.name,
      });
    }
  }

  // Calculate consumption stats per item
  const results = {};
  for (const item of ITEMS) {
    // Deduplicate orders by orderId (same order can appear on multiple year pages)
    const rawOrders = (itemOrders[item.id] || []).filter(o => o.date);
    const seen = new Set();
    const orders = [];
    for (const o of rawOrders) {
      const key = `${o.orderId}|${o.date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      orders.push(o);
    }
    orders.sort((a, b) => new Date(a.date) - new Date(b.date));

    if (orders.length === 0) continue;

    // Calculate intervals between consecutive orders
    const intervals = [];
    for (let i = 1; i < orders.length; i++) {
      const gap = daysBetween(orders[i].date, orders[i - 1].date);
      if (gap > 0) intervals.push(gap);
    }

    const avgInterval = intervals.length > 0
      ? Math.round(intervals.reduce((s, v) => s + v, 0) / intervals.length)
      : null;

    const freqDays = parseFreqDays(item.freq);

    // Total spend
    let totalSpent = 0;
    for (const o of orders) {
      const p = parseFloat((o.price || '').replace(/[$,]/g, ''));
      if (!isNaN(p)) totalSpent += p * (o.qty || 1);
    }

    // Days since last order
    const lastOrdered = orders[orders.length - 1].date;
    const daysSinceLast = daysBetween(new Date(), lastOrdered);

    // Determine if this is a deletion candidate
    let deletionReason = null;
    if (freqDays && avgInterval && avgInterval > freqDays * 1.5) {
      deletionReason = `Arrives every ${freqDays} days but actually used every ~${avgInterval} days`;
    }
    if (freqDays && daysSinceLast > freqDays * 3) {
      deletionReason = `No order in ${daysSinceLast} days (expected every ${freqDays} days)`;
    }

    // Seasonal pattern detection (needs 12+ months of data)
    let seasonalPattern = null;
    if (orders.length >= 6) {
      // Group orders by month
      const monthCounts = new Array(12).fill(0);
      for (const o of orders) {
        const d = new Date(o.date);
        if (!isNaN(d.getTime())) monthCounts[d.getMonth()]++;
      }

      // Find peak and trough seasons
      const avgPerMonth = orders.length / 12;
      const peakMonths = [];
      const troughMonths = [];
      const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

      for (let i = 0; i < 12; i++) {
        if (monthCounts[i] >= avgPerMonth * 2) peakMonths.push(monthNames[i]);
        if (monthCounts[i] === 0 && orders.length >= 12) troughMonths.push(monthNames[i]);
      }

      if (peakMonths.length > 0 && troughMonths.length > 0) {
        seasonalPattern = {
          peakMonths,
          troughMonths,
          suggestion: `Higher usage in ${peakMonths.join(', ')}. Consider pausing during ${troughMonths.join(', ')}.`,
        };
      }
    }

    results[item.id] = {
      itemName: item.name,
      subscribedFreq: item.freq,
      subscribedFreqDays: freqDays,
      orders: orders.map(o => ({
        date: o.date,
        price: o.price,
        qty: o.qty,
        orderId: o.orderId,
      })),
      orderCount: orders.length,
      avgIntervalDays: avgInterval,
      lastOrdered,
      daysSinceLast,
      totalSpent: Math.round(totalSpent * 100) / 100,
      deletionCandidate: !!deletionReason,
      deletionReason,
      seasonalPattern,
      lastChecked: new Date().toISOString(),
    };
  }

  return results;
}

// ========== Main ==========

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const monthsIdx = args.indexOf('--months');
  const monthsBack = monthsIdx >= 0 ? parseInt(args[monthsIdx + 1]) : 12;

  log('=== Amazon Order History Scraper ===');
  log(`Going back ${monthsBack} months`);
  if (dryRun) log('DRY RUN — will not write to Firebase');

  // Init Firebase
  const db = dryRun ? null : initFirebaseAdmin();
  const knownAsins = db ? await loadAsins(db) : {};
  log(`Loaded ${Object.keys(knownAsins).length} known ASINs`);

  // Launch with real Chrome to avoid bot detection on login pages
  log('Launching Chrome browser...');
  log('IMPORTANT: Close ALL Chrome windows first!');

  const browser = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
    headless: false,
    channel: 'chrome',
    viewport: null,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--start-maximized',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const page = browser.pages()[0] || await browser.newPage();

  // Suppress automation detection
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    if (window.chrome) {
      window.chrome.runtime = window.chrome.runtime || {};
    }
  });

  try {
    // Check login status by going directly to order history
    const loggedIn = await ensureLoggedIn(page);

    if (!loggedIn) {
      log('');
      log('========================================');
      log('  Please log in to Amazon in the browser window.');
      log('  After login, you should see your order history.');
      log('  Waiting up to 5 minutes...');
      log('========================================');

      // Wait for user to complete login — check for actual order content on the page
      let loginDetected = false;
      for (let i = 0; i < 100; i++) {
        await new Promise(r => setTimeout(r, 3000));
        try {
          const url = page.url();
          // Must be on order history page AND not on sign-in
          if (!url.includes('/ap/signin') && !url.includes('/ap/mfa') &&
              (url.includes('order-history') || url.includes('your-orders'))) {
            // Verify there's actual order content, not just a redirect
            const hasContent = await page.evaluate(() => {
              const body = document.body?.innerText || '';
              return body.includes('Order placed') || body.includes('order placed') ||
                     body.includes('Orders placed') || body.includes('orders placed') ||
                     body.includes('Buy it again') || body.includes('Your Orders') ||
                     body.includes('0 orders') || body.includes('past');
            });
            if (hasContent) {
              log('Login successful!');
              loginDetected = true;
              break;
            }
          }
        } catch (e) {
          // Page navigating
        }
        if (i > 0 && i % 20 === 0) {
          const remaining = Math.round((100 - i) * 3 / 60);
          log(`Still waiting for login... (~${remaining} min remaining)`);
        }
      }

      if (!loginDetected) {
        log('ERROR: Login not detected within timeout. Please try again.');
        await browser.close();
        process.exit(1);
      }
    } else {
      log('Already logged in to Amazon.');
    }

    // Scrape order history
    log('\nScraping order history...');
    const { orders, needsLogin } = await scrapeOrdersStructured(page, monthsBack);

    if (needsLogin) {
      log('ERROR: Session expired during scraping. Run with --login first.');
      await browser.close();
      process.exit(1);
    }

    // Deduplicate orders (same orders can appear across year pages)
    const seenOrderIds = new Set();
    const uniqueOrders = [];
    for (const order of orders) {
      const key = order.orderId || `${order.orderDate}-${order.items.length}`;
      if (seenOrderIds.has(key)) continue;
      seenOrderIds.add(key);
      uniqueOrders.push(order);
    }
    log(`\nScraped ${orders.length} raw orders, ${uniqueOrders.length} unique`);

    // Count total items across all orders
    const totalItems = uniqueOrders.reduce((s, o) => s + o.items.length, 0);
    log(`Total order items found: ${totalItems}`);

    // Analyze and match to S&S items
    log('\nAnalyzing orders...');
    const analysis = analyzeOrders(uniqueOrders, knownAsins);

    const matchedItems = Object.keys(analysis).length;
    const deletionCandidates = Object.values(analysis).filter(a => a.deletionCandidate).length;
    log(`Matched ${matchedItems} S&S items in order history`);
    log(`Found ${deletionCandidates} deletion candidates`);

    // Print summary
    log('\n=== Summary ===');
    for (const [id, data] of Object.entries(analysis)) {
      const flag = data.deletionCandidate ? ' *** DELETION CANDIDATE ***' : '';
      log(`  Item ${id} (${data.itemName}):`);
      log(`    Orders: ${data.orderCount} | Avg interval: ${data.avgIntervalDays || '?'} days | Subscribed: every ${data.subscribedFreqDays || '?'} days`);
      log(`    Last ordered: ${data.lastOrdered} (${data.daysSinceLast} days ago) | Total spent: $${data.totalSpent}${flag}`);
      if (data.deletionReason) log(`    Reason: ${data.deletionReason}`);
    }

    // Items NOT found in order history
    const unmatchedIds = ITEMS.filter(i => !analysis[i.id] && i.freq).map(i => `${i.id}:${i.name}`);
    if (unmatchedIds.length > 0) {
      log(`\nItems NOT found in orders (${unmatchedIds.length}):`);
      for (const name of unmatchedIds) log(`  - ${name}`);
    }

    // Save to Firebase (incremental merge — preserves existing data)
    if (!dryRun && db) {
      log('\nSaving to Firebase...');

      // Merge orderHistory — update() merges keys, preserving items not in this run
      await db.ref('orderHistory').update(analysis);
      log('Merged order history analysis into Firebase.');

      // Save raw orders indexed by orderId for incremental accumulation
      // Each run adds new orders without overwriting old ones
      const rawOrderUpdates = {};
      for (const order of uniqueOrders) {
        if (order.orderId) {
          rawOrderUpdates[order.orderId] = {
            orderDate: order.orderDate,
            items: order.items,
            scrapedAt: new Date().toISOString(),
          };
        }
      }
      await db.ref('rawOrders/orders').update(rawOrderUpdates);
      await db.ref('rawOrders/meta').set({
        lastScrapeDate: new Date().toISOString(),
        lastMonthsBack: monthsBack,
        totalOrdersThisRun: uniqueOrders.length,
      });
      log(`Saved ${Object.keys(rawOrderUpdates).length} raw orders to Firebase (incremental).`);

      // Store historical prices per item per date for price pattern analysis
      // This accumulates over time — never overwrites past entries
      const priceUpdates = {};
      for (const [itemId, data] of Object.entries(analysis)) {
        for (const order of data.orders) {
          if (order.date && order.price) {
            const dateKey = order.date.replace(/-/g, '');
            if (!priceUpdates[itemId]) priceUpdates[itemId] = {};
            priceUpdates[itemId][dateKey] = {
              price: order.price,
              orderId: order.orderId,
            };
          }
        }
      }
      if (Object.keys(priceUpdates).length > 0) {
        for (const [itemId, dates] of Object.entries(priceUpdates)) {
          await db.ref(`orderPriceHistory/${itemId}`).update(dates);
        }
        log('Saved order price history for pattern analysis.');
      } else {
        log('No prices found in orders to save (price extraction may need fixing).');
      }
    } else if (dryRun) {
      log('\n[dry-run] Would merge into Firebase: orderHistory + rawOrders + orderPriceHistory');
    }

  } catch (err) {
    log(`ERROR: ${err.message}`);
    console.error(err);
  } finally {
    await browser.close();
  }

  log('\n=== Done ===');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
