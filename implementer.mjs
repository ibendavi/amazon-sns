#!/usr/bin/env node
/**
 * Amazon S&S Implementer
 *
 * Reads planned actions from Firebase sendQueue and executes them
 * on Amazon: skip items, switch to alternatives, cancel subscriptions.
 *
 * Usage:
 *   node implementer.mjs              # execute all pending actions
 *   node implementer.mjs --dry-run    # preview what would be done
 *   node implementer.mjs --login      # open visible browser for manual Amazon login first
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
const BROWSER_PROFILE_DIR = resolve(__dirname, '.browser-profile');
const SCREENSHOTS_DIR = resolve(__dirname, '.screenshots');
const SNS_DASHBOARD_URL = 'https://www.amazon.com/gp/subscribe-and-save/manager/viewsubscriptions';

// Pause between actions (ms)
const ACTION_DELAY_MS = 3000;

// ========== Helpers ==========

function randomDelay(minMs, maxMs) {
  const ms = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  return new Promise(r => setTimeout(r, ms));
}

function log(msg) {
  const ts = new Date().toISOString().slice(0, 19).replace('T', ' ');
  console.log(`[${ts}] ${msg}`);
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function screenshotName(action, itemId) {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  return resolve(SCREENSHOTS_DIR, `${ts}_${action}_item${itemId}.png`);
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

async function loadSendQueue(db) {
  if (!db) return null;
  const snap = await db.ref('sendQueue').once('value');
  return snap.val();
}

async function loadItemConfig(db) {
  if (!db) return {};
  const snap = await db.ref('itemConfig').once('value');
  return snap.val() || {};
}

async function updateImplementStatus(db, status) {
  if (!db) return;
  await db.ref('implementStatus').set(status);
}

async function updateActionStatus(db, index, actionStatus) {
  if (!db) return;
  await db.ref(`implementStatus/actions/${index}/status`).set(actionStatus);
}

async function clearSendQueue(db) {
  if (!db) return;
  await db.ref('sendQueue/status').set('completed');
}

// ========== Login ==========

async function ensureLoggedIn(page) {
  await page.goto('https://www.amazon.com/gp/css/homepage.html', {
    waitUntil: 'domcontentloaded', timeout: 30000
  });
  await randomDelay(2000, 3000);

  const isSignIn = await page.evaluate(() => {
    return !!document.querySelector('#ap_email, #ap_password, .a-form-label[for="ap_email"]');
  });

  if (isSignIn) {
    log('Not logged in -- need to authenticate.');
    return false;
  }

  const signedIn = await page.evaluate(() => {
    const el = document.querySelector('#nav-link-accountList-nav-line-1');
    return el ? !el.textContent.includes('Sign in') : true;
  });

  return signedIn;
}

// ========== Action Builders ==========

/**
 * Parse the sendQueue payload into a flat list of executable actions.
 * Each action: { type, itemId, itemName, altName?, asin? }
 */
function buildActions(sendQueue, itemConfig) {
  const actions = [];

  if (!sendQueue) return actions;

  const { selections, altPreferences, cancelQueue } = sendQueue;

  // Skip actions: items where selections[id] === false
  if (selections) {
    for (const [id, checked] of Object.entries(selections)) {
      if (!checked) {
        const asin = itemConfig[id]?.asin || null;
        actions.push({
          type: 'skip',
          itemId: parseInt(id),
          itemName: findItemName(sendQueue, parseInt(id)) || `Item ${id}`,
          asin,
        });
      }
    }
  }

  // Switch actions: items with altPreferences
  if (altPreferences) {
    for (const [id, altName] of Object.entries(altPreferences)) {
      const asin = itemConfig[id]?.asin || null;
      actions.push({
        type: 'switch',
        itemId: parseInt(id),
        itemName: findItemName(sendQueue, parseInt(id)) || `Item ${id}`,
        altName,
        asin,
      });
    }
  }

  // Cancel actions: items in cancelQueue
  if (cancelQueue) {
    for (const [id, data] of Object.entries(cancelQueue)) {
      const asin = itemConfig[id]?.asin || null;
      actions.push({
        type: 'cancel',
        itemId: parseInt(id),
        itemName: data.name || findItemName(sendQueue, parseInt(id)) || `Item ${id}`,
        asin,
      });
    }
  }

  return actions;
}

/**
 * Try to find item name from the actions array in sendQueue.
 */
function findItemName(sendQueue, itemId) {
  if (!sendQueue.actions) return null;
  for (const a of sendQueue.actions) {
    // Labels look like: Skip "Presto! Toilet Paper" from next delivery
    const m = a.label?.match(/"([^"]+)"/);
    if (m) {
      // Check if this action relates to our item (imperfect but workable)
      // We can't match by id from the label alone, so return null
    }
  }
  return null;
}

// ========== Amazon Actions ==========

/**
 * Navigate to S&S dashboard and find a subscription item by ASIN or name.
 * Returns the manage-link URL for the item, or null if not found.
 */
async function findSubscriptionOnDashboard(page, itemName, asin) {
  log(`  Navigating to S&S dashboard...`);
  await page.goto(SNS_DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await randomDelay(3000, 5000);

  // Amazon S&S dashboard may load items dynamically; scroll to load all
  await autoScroll(page);
  await randomDelay(1000, 2000);

  // Try to find the item by ASIN in product links first, then by name
  const result = await page.evaluate(({ asin, itemName }) => {
    // Strategy 1: Find by ASIN in any href
    if (asin) {
      const links = document.querySelectorAll(`a[href*="${asin}"]`);
      for (const link of links) {
        // Walk up to find the subscription row/card
        const row = link.closest('[data-a-name], .a-box, .subscription-card, tr, [class*="subscription"]');
        if (row) {
          // Find manage link within this row
          const manageLink = row.querySelector('a[href*="subscribe-and-save"], a[href*="auto-deliveries"]');
          if (manageLink) return { url: manageLink.href, found: true, method: 'asin-row' };
        }
      }
      // Fallback: just get the link
      if (links.length > 0) {
        const card = links[0].closest('.a-box, [class*="subscription"], tr');
        if (card) {
          const anyManage = card.querySelector('a[href*="subscribe"], a[href*="auto-deliver"]');
          if (anyManage) return { url: anyManage.href, found: true, method: 'asin-fallback' };
        }
      }
    }

    // Strategy 2: Search by item name in visible text
    const nameLower = (itemName || '').toLowerCase();
    const nameWords = nameLower.split(/\s+/).filter(w => w.length >= 3);
    if (nameWords.length === 0) return { found: false };

    // Look through all links/text that might be product names
    const candidates = document.querySelectorAll('a[href*="/dp/"], a[href*="/gp/product/"], .a-text-bold, .a-link-normal');
    for (const el of candidates) {
      const text = (el.textContent || '').toLowerCase();
      const matchCount = nameWords.filter(w => text.includes(w)).length;
      if (matchCount >= Math.ceil(nameWords.length * 0.5)) {
        const row = el.closest('.a-box, [class*="subscription"], tr, [data-a-name]');
        if (row) {
          const manageLink = row.querySelector('a[href*="subscribe"], a[href*="auto-deliver"]');
          if (manageLink) return { url: manageLink.href, found: true, method: 'name-match' };
        }
      }
    }

    return { found: false };
  }, { asin, itemName });

  if (result.found) {
    log(`  Found subscription (via ${result.method}): ${result.url}`);
    return result.url;
  }

  return null;
}

/**
 * Scroll down the page to trigger lazy-loading of subscription items.
 */
async function autoScroll(page) {
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 400;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= document.body.scrollHeight || totalHeight > 10000) {
          clearInterval(timer);
          resolve();
        }
      }, 200);
    });
  });
}

/**
 * Skip an item from the next S&S delivery.
 */
async function executeSkip(page, action, db, actionIndex, dryRun) {
  log(`  SKIP: ${action.itemName} (ASIN: ${action.asin || 'unknown'})`);

  if (dryRun) {
    log(`  [dry-run] Would skip "${action.itemName}" from next delivery`);
    return { success: true, dryRun: true };
  }

  // Navigate to S&S dashboard
  await page.goto(SNS_DASHBOARD_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await randomDelay(3000, 5000);
  await autoScroll(page);
  await randomDelay(1000, 2000);

  // Take pre-action screenshot
  ensureDir(SCREENSHOTS_DIR);
  await page.screenshot({ path: screenshotName('skip-before', action.itemId), fullPage: false });

  // Find the item on the dashboard and look for its checkbox or skip button
  const skipResult = await page.evaluate(({ asin, itemName }) => {
    const nameLower = (itemName || '').toLowerCase();
    const nameWords = nameLower.split(/\s+/).filter(w => w.length >= 3);

    // Find all subscription items on the page
    // S&S dashboard typically has checkboxes for each item
    const allCheckboxes = document.querySelectorAll('input[type="checkbox"]');

    // Strategy 1: Find by ASIN
    if (asin) {
      const asinEls = document.querySelectorAll(`a[href*="${asin}"], [data-asin="${asin}"]`);
      for (const el of asinEls) {
        const container = el.closest('.a-box, [class*="subscription"], tr, .a-section, [data-a-name]');
        if (!container) continue;

        // Look for a checkbox (to uncheck the item)
        const checkbox = container.querySelector('input[type="checkbox"]');
        if (checkbox && checkbox.checked) {
          checkbox.click();
          return { success: true, method: 'uncheck-asin' };
        }

        // Look for "Skip" button
        const skipBtn = container.querySelector('button, input[type="submit"], a');
        for (const btn of container.querySelectorAll('button, input[type="submit"], a.a-button-text, span.a-button-text')) {
          const btnText = (btn.textContent || '').toLowerCase();
          if (btnText.includes('skip')) {
            btn.click();
            return { success: true, method: 'skip-button-asin' };
          }
        }
      }
    }

    // Strategy 2: Find by name
    const candidates = document.querySelectorAll('a[href*="/dp/"], a[href*="/gp/product/"], .a-text-bold, .a-link-normal');
    for (const el of candidates) {
      const text = (el.textContent || '').toLowerCase();
      const matchCount = nameWords.filter(w => text.includes(w)).length;
      if (matchCount < Math.ceil(nameWords.length * 0.5)) continue;

      const container = el.closest('.a-box, [class*="subscription"], tr, .a-section, [data-a-name]');
      if (!container) continue;

      // Uncheck checkbox
      const checkbox = container.querySelector('input[type="checkbox"]');
      if (checkbox && checkbox.checked) {
        checkbox.click();
        return { success: true, method: 'uncheck-name' };
      }

      // Skip button
      for (const btn of container.querySelectorAll('button, input[type="submit"], a.a-button-text, span.a-button-text')) {
        const btnText = (btn.textContent || '').toLowerCase();
        if (btnText.includes('skip')) {
          btn.click();
          return { success: true, method: 'skip-button-name' };
        }
      }
    }

    return { success: false, reason: 'Item not found on dashboard' };
  }, { asin: action.asin, itemName: action.itemName });

  await randomDelay(2000, 3000);
  await page.screenshot({ path: screenshotName('skip-after', action.itemId), fullPage: false });

  if (skipResult.success) {
    log(`  Skipped via ${skipResult.method}`);
  } else {
    log(`  FAILED to skip: ${skipResult.reason}`);
  }

  return skipResult;
}

/**
 * Switch a subscription to an alternative item.
 */
async function executeSwitch(page, action, db, actionIndex, dryRun) {
  log(`  SWITCH: ${action.itemName} -> ${action.altName} (ASIN: ${action.asin || 'unknown'})`);

  if (dryRun) {
    log(`  [dry-run] Would switch "${action.itemName}" to "${action.altName}"`);
    return { success: true, dryRun: true };
  }

  // First, find the subscription management page for this item
  const manageUrl = await findSubscriptionOnDashboard(page, action.itemName, action.asin);

  if (!manageUrl) {
    log(`  FAILED: Could not find subscription for "${action.itemName}" on dashboard`);
    return { success: false, reason: 'Subscription not found on dashboard' };
  }

  // Navigate to the individual subscription management page
  log(`  Navigating to subscription management: ${manageUrl}`);
  await page.goto(manageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await randomDelay(3000, 5000);

  // Take pre-action screenshot
  ensureDir(SCREENSHOTS_DIR);
  await page.screenshot({ path: screenshotName('switch-before', action.itemId), fullPage: false });

  // Look for "Switch to similar item" or "Change item" option
  const switchLinkResult = await page.evaluate(() => {
    const buttons = document.querySelectorAll('a, button, span.a-button-text');
    for (const btn of buttons) {
      const text = (btn.textContent || '').toLowerCase();
      if (text.includes('switch to similar') || text.includes('change item') || text.includes('swap item')) {
        if (btn.tagName === 'A') {
          return { found: true, href: btn.href };
        } else {
          btn.click();
          return { found: true, clicked: true };
        }
      }
    }
    return { found: false };
  });

  if (!switchLinkResult.found) {
    log(`  FAILED: No "Switch to similar item" option found on subscription page`);
    await page.screenshot({ path: screenshotName('switch-notfound', action.itemId), fullPage: false });
    return { success: false, reason: 'No switch option available' };
  }

  // If it returned a URL, navigate to it
  if (switchLinkResult.href) {
    await page.goto(switchLinkResult.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  await randomDelay(3000, 5000);

  // Now search for the alternative item
  const altNameLower = (action.altName || '').toLowerCase();
  const altWords = altNameLower.split(/\s+/).filter(w => w.length >= 3);

  // Look for search box on the switch page, or scan the suggested alternatives
  const switchResult = await page.evaluate(({ altWords, altNameLower }) => {
    // Strategy 1: Look for the alternative in the suggested items list
    const items = document.querySelectorAll('.a-box, [class*="similar"], [class*="alternative"], .a-section');
    for (const item of items) {
      const text = (item.textContent || '').toLowerCase();
      const matchCount = altWords.filter(w => text.includes(w)).length;
      if (matchCount >= Math.ceil(altWords.length * 0.4)) {
        // Found a matching alternative, click its select/switch button
        const selectBtn = item.querySelector('button, input[type="submit"], a.a-button-text, span.a-button-text, input[type="radio"]');
        if (selectBtn) {
          selectBtn.click();
          return { success: true, method: 'select-from-list' };
        }
      }
    }

    // Strategy 2: Try using a search box if available
    const searchInput = document.querySelector('input[type="search"], input[type="text"][placeholder*="search" i]');
    if (searchInput) {
      return { success: false, hasSearch: true, reason: 'Search box found but needs interaction' };
    }

    return { success: false, reason: 'Alternative not found in suggestions' };
  }, { altWords, altNameLower });

  if (switchResult.success) {
    await randomDelay(2000, 3000);
    // Confirm the switch if a confirmation dialog appears
    await page.evaluate(() => {
      const confirmBtns = document.querySelectorAll('button, input[type="submit"], span.a-button-text');
      for (const btn of confirmBtns) {
        const text = (btn.textContent || '').toLowerCase();
        if (text.includes('confirm') || text.includes('switch') || text.includes('save')) {
          btn.click();
          return true;
        }
      }
      return false;
    });
    await randomDelay(2000, 3000);
    await page.screenshot({ path: screenshotName('switch-after', action.itemId), fullPage: false });
    log(`  Switched via ${switchResult.method}`);
    return { success: true };
  }

  // If there's a search box, type the alternative name and search
  if (switchResult.hasSearch) {
    log(`  Searching for alternative: ${action.altName}`);
    const searchInput = await page.$('input[type="search"], input[type="text"][placeholder*="search" i]');
    if (searchInput) {
      await searchInput.fill(action.altName);
      await randomDelay(500, 1000);
      // Press Enter or click search button
      await searchInput.press('Enter');
      await randomDelay(3000, 5000);

      // Try selecting the first result
      const searchSelectResult = await page.evaluate(({ altWords }) => {
        const results = document.querySelectorAll('.a-box, [class*="result"], [class*="item"], .a-section');
        for (const r of results) {
          const text = (r.textContent || '').toLowerCase();
          const matchCount = altWords.filter(w => text.includes(w)).length;
          if (matchCount >= Math.ceil(altWords.length * 0.3)) {
            const selectBtn = r.querySelector('button, input[type="submit"], a.a-button-text, span.a-button-text, input[type="radio"]');
            if (selectBtn) {
              selectBtn.click();
              return { success: true };
            }
          }
        }
        return { success: false };
      }, { altWords });

      if (searchSelectResult.success) {
        await randomDelay(2000, 3000);
        await page.screenshot({ path: screenshotName('switch-after', action.itemId), fullPage: false });
        log(`  Switched via search`);
        return { success: true };
      }
    }
  }

  log(`  FAILED: ${switchResult.reason}`);
  await page.screenshot({ path: screenshotName('switch-failed', action.itemId), fullPage: false });
  return { success: false, reason: switchResult.reason };
}

/**
 * Cancel a subscription.
 */
async function executeCancel(page, action, db, actionIndex, dryRun) {
  log(`  CANCEL: ${action.itemName} (ASIN: ${action.asin || 'unknown'})`);

  if (dryRun) {
    log(`  [dry-run] Would cancel subscription for "${action.itemName}"`);
    return { success: true, dryRun: true };
  }

  // Find the subscription management page for this item
  const manageUrl = await findSubscriptionOnDashboard(page, action.itemName, action.asin);

  if (!manageUrl) {
    log(`  FAILED: Could not find subscription for "${action.itemName}" on dashboard`);
    return { success: false, reason: 'Subscription not found on dashboard' };
  }

  // Navigate to the individual subscription management page
  log(`  Navigating to subscription management: ${manageUrl}`);
  await page.goto(manageUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await randomDelay(3000, 5000);

  // Take pre-action screenshot
  ensureDir(SCREENSHOTS_DIR);
  await page.screenshot({ path: screenshotName('cancel-before', action.itemId), fullPage: false });

  // Look for "Cancel subscription" button
  const cancelResult = await page.evaluate(() => {
    // Find cancel button
    const buttons = document.querySelectorAll('a, button, span.a-button-text, input[type="submit"]');
    for (const btn of buttons) {
      const text = (btn.textContent || '').toLowerCase();
      if (text.includes('cancel subscription') || text.includes('cancel this subscription') || text.includes('cancel auto-delivery')) {
        if (btn.tagName === 'A') {
          return { found: true, href: btn.href };
        } else {
          btn.click();
          return { found: true, clicked: true };
        }
      }
    }
    return { found: false };
  });

  if (!cancelResult.found) {
    log(`  FAILED: No "Cancel subscription" button found`);
    await page.screenshot({ path: screenshotName('cancel-notfound', action.itemId), fullPage: false });
    return { success: false, reason: 'Cancel button not found' };
  }

  // If it returned a URL, navigate to it
  if (cancelResult.href) {
    await page.goto(cancelResult.href, { waitUntil: 'domcontentloaded', timeout: 30000 });
  }
  await randomDelay(3000, 5000);

  // Handle confirmation dialog -- Amazon typically asks "Are you sure?"
  const confirmResult = await page.evaluate(() => {
    // Look for the final confirmation button
    const buttons = document.querySelectorAll('button, input[type="submit"], span.a-button-text, a');
    for (const btn of buttons) {
      const text = (btn.textContent || '').toLowerCase();
      if (
        text.includes('confirm cancel') ||
        text.includes('yes, cancel') ||
        text.includes('cancel subscription') ||
        text.includes('turn off') ||
        text.includes('confirm')
      ) {
        // Avoid clicking "cancel" meaning "go back" / "nevermind"
        const btnLower = text.trim();
        if (btnLower === 'cancel' || btnLower === 'no' || btnLower === 'go back') continue;
        btn.click();
        return { confirmed: true };
      }
    }
    return { confirmed: false };
  });

  await randomDelay(3000, 5000);
  await page.screenshot({ path: screenshotName('cancel-after', action.itemId), fullPage: false });

  if (confirmResult.confirmed) {
    log(`  Cancellation confirmed`);
    return { success: true };
  } else {
    log(`  WARNING: Cancellation initiated but confirmation dialog may not have been handled`);
    return { success: true, warning: 'Confirmation uncertain -- check screenshot' };
  }
}

// ========== Main ==========

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const loginMode = args.includes('--login');

  log('=== Amazon S&S Implementer ===');
  if (dryRun) log('DRY RUN -- will preview actions without executing');

  // Init Firebase
  const db = initFirebaseAdmin();
  if (!db) {
    log('ERROR: Firebase required. Ensure firebase-service-account.json exists.');
    process.exit(1);
  }

  // Load sendQueue
  const sendQueue = await loadSendQueue(db);
  if (!sendQueue) {
    log('No pending actions in sendQueue. Nothing to do.');
    process.exit(0);
  }

  if (sendQueue.status === 'completed') {
    log('sendQueue status is already "completed". Nothing to do.');
    log('Use the web UI to queue new actions.');
    process.exit(0);
  }

  log(`sendQueue status: ${sendQueue.status || 'unknown'}`);
  log(`sendQueue timestamp: ${sendQueue.timestamp ? new Date(sendQueue.timestamp).toISOString() : 'unknown'}`);

  // Load item config (ASINs)
  const itemConfig = await loadItemConfig(db);
  log(`Loaded ${Object.keys(itemConfig).length} item configs`);

  // Build executable action list
  const actions = buildActions(sendQueue, itemConfig);

  if (actions.length === 0) {
    log('No actions to execute. sendQueue has no skips, switches, or cancellations.');
    process.exit(0);
  }

  log(`\nPlanned actions (${actions.length}):`);
  for (const a of actions) {
    const detail = a.type === 'switch' ? ` -> "${a.altName}"` : '';
    log(`  [${a.type.toUpperCase()}] ${a.itemName}${detail} (id: ${a.itemId}, asin: ${a.asin || '?'})`);
  }

  if (dryRun) {
    log('\n=== DRY RUN COMPLETE ===');
    log('Run without --dry-run to execute these actions.');
    process.exit(0);
  }

  // Initialize implementStatus in Firebase
  const implementStatus = {
    status: 'running',
    completed: 0,
    total: actions.length,
    currentAction: 'Starting...',
    actions: actions.map(a => ({
      type: a.type,
      itemId: a.itemId,
      itemName: a.itemName,
      status: 'pending',
    })),
    startedAt: new Date().toISOString(),
    completedAt: null,
  };
  await updateImplementStatus(db, implementStatus);

  // Launch browser
  const headless = !loginMode;
  log(`\nLaunching browser (${headless ? 'headless' : 'visible'})...`);

  const browser = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, {
    headless,
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'en-US',
  });

  const page = await browser.newPage();

  try {
    // Check login status
    const loggedIn = await ensureLoggedIn(page);

    if (!loggedIn) {
      if (loginMode) {
        log('Please log in manually in the browser window...');
        log('Waiting up to 120 seconds for login...');

        await page.waitForURL(url => !url.toString().includes('/ap/signin'), { timeout: 120000 }).catch(() => {});
        await randomDelay(3000, 5000);

        const nowLoggedIn = await ensureLoggedIn(page);
        if (!nowLoggedIn) {
          log('ERROR: Still not logged in. Please complete sign-in.');
          implementStatus.status = 'error';
          implementStatus.currentAction = 'Login failed';
          await updateImplementStatus(db, implementStatus);
          await browser.close();
          process.exit(1);
        }
        log('Login successful!');
      } else {
        log('ERROR: Not logged in. Run with --login first to sign in.');
        implementStatus.status = 'error';
        implementStatus.currentAction = 'Not logged in -- run with --login';
        await updateImplementStatus(db, implementStatus);
        await browser.close();
        process.exit(1);
      }
    } else {
      log('Already logged in.');
    }

    // Execute actions
    let successCount = 0;
    let errorCount = 0;

    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];

      // Update status
      implementStatus.currentAction = `${action.type === 'skip' ? 'Skipping' : action.type === 'switch' ? 'Switching' : 'Cancelling'} ${action.itemName}...`;
      implementStatus.actions[i].status = 'running';
      await updateImplementStatus(db, implementStatus);

      log(`\n--- Action ${i + 1}/${actions.length}: ${action.type.toUpperCase()} ---`);

      try {
        let result;
        switch (action.type) {
          case 'skip':
            result = await executeSkip(page, action, db, i, false);
            break;
          case 'switch':
            result = await executeSwitch(page, action, db, i, false);
            break;
          case 'cancel':
            result = await executeCancel(page, action, db, i, false);
            break;
          default:
            log(`  Unknown action type: ${action.type}`);
            result = { success: false, reason: 'Unknown action type' };
        }

        if (result.success) {
          implementStatus.actions[i].status = 'done';
          if (result.warning) implementStatus.actions[i].warning = result.warning;
          successCount++;
        } else {
          implementStatus.actions[i].status = 'error';
          implementStatus.actions[i].error = result.reason || 'Unknown error';
          errorCount++;
        }
      } catch (err) {
        log(`  ERROR: ${err.message}`);
        implementStatus.actions[i].status = 'error';
        implementStatus.actions[i].error = err.message;
        errorCount++;

        // Take error screenshot
        ensureDir(SCREENSHOTS_DIR);
        try {
          await page.screenshot({ path: screenshotName('error', action.itemId), fullPage: false });
        } catch (_) {}
      }

      implementStatus.completed = i + 1;
      await updateImplementStatus(db, implementStatus);

      // Pause between actions
      if (i < actions.length - 1) {
        log(`  Waiting ${ACTION_DELAY_MS / 1000}s before next action...`);
        await new Promise(r => setTimeout(r, ACTION_DELAY_MS));
        await randomDelay(1000, 3000);
      }
    }

    // Final status
    implementStatus.status = errorCount === actions.length ? 'error' : 'done';
    implementStatus.currentAction = `Completed: ${successCount} succeeded, ${errorCount} failed`;
    implementStatus.completedAt = new Date().toISOString();
    await updateImplementStatus(db, implementStatus);

    // Mark sendQueue as completed
    await clearSendQueue(db);

    log(`\n=== Done: ${successCount} succeeded, ${errorCount} failed ===`);

  } catch (err) {
    log(`CRITICAL ERROR: ${err.message}`);
    console.error(err);

    implementStatus.status = 'error';
    implementStatus.currentAction = `Critical error: ${err.message}`;
    implementStatus.completedAt = new Date().toISOString();
    await updateImplementStatus(db, implementStatus);
  } finally {
    await browser.close();
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
