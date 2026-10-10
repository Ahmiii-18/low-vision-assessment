'use strict';

/**
 * Google Sheets live sync.
 * - Auto-creates the target tab if it doesn't exist
 * - Writes a header row on first use
 * - Appends one row per task submission
 * Disabled automatically if credentials aren't set.
 */

const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
let client = null;
let enabled = false;
const ensuredTabs = new Set();   // remember which tabs we've already verified

async function init() {
  if (!SHEET_ID || !process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    console.log('[sheets] disabled (no credentials)');
    return;
  }
  try {
    const creds = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    const auth = new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    client = google.sheets({ version: 'v4', auth });
    enabled = true;
    console.log('[sheets] enabled for sheet', SHEET_ID);
  } catch (e) {
    console.warn('[sheets] init failed:', e.message);
  }
}

/**
 * Ensure a tab (worksheet) exists inside the spreadsheet.
 * Creates it if missing. Idempotent — checks cached set first.
 */
async function ensureTab(tab) {
  if (!enabled) return false;
  if (ensuredTabs.has(tab)) return true;

  try {
    // 1. Look at existing tabs
    const meta = await client.spreadsheets.get({
      spreadsheetId: SHEET_ID,
      fields: 'sheets.properties.title',
    });
    const titles = (meta.data.sheets || []).map((s) => s.properties.title);

    // 2. Create the tab if it's not there
    if (!titles.includes(tab)) {
      console.log(`[sheets] creating tab "${tab}"`);
      await client.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          requests: [{ addSheet: { properties: { title: tab } } }],
        },
      });
      console.log(`[sheets] tab "${tab}" created`);
    }

    ensuredTabs.add(tab);
    return true;
  } catch (e) {
    console.warn(`[sheets] ensureTab("${tab}") failed:`, e.message);
    return false;
  }
}

/**
 * Write a header row if the tab is empty.
 */
async function ensureHeader(tab, header) {
  if (!enabled) return;
  const ok = await ensureTab(tab);
  if (!ok) return;

  try {
    const res = await client.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: `${tab}!A1:Z1`,
    });
    if (!res.data.values || res.data.values.length === 0) {
      await client.spreadsheets.values.update({
        spreadsheetId: SHEET_ID,
        range: `${tab}!A1`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [header] },
      });
      console.log(`[sheets] wrote header to "${tab}"`);
    }
  } catch (e) {
    console.warn('[sheets] ensureHeader failed:', e.message);
  }
}

/**
 * Append one row to a tab. Auto-creates the tab if needed.
 */
async function appendRow(tab, values) {
  if (!enabled) return;
  const ok = await ensureTab(tab);
  if (!ok) return;

  try {
    await client.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${tab}!A:Z`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [values] },
    });
  } catch (e) {
    console.warn('[sheets] append failed:', e.message);
  }
}

module.exports = { init, ensureTab, ensureHeader, appendRow };