'use strict';

/**
 * Google Sheets live sync with per-participant visual grouping.
 * - Auto-creates the target tab
 * - Writes a header row on first use
 * - Appends one row per task submission
 * - Draws a light border under every row
 * - Draws a thick green border + pale green background when task 18 completes
 */

const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
let client = null;
let enabled = false;

const ensuredTabs = new Set();     // tabs we've confirmed exist
const tabIdCache  = new Map();     // tab title -> internal sheetId (gid)

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

async function ensureTab(tab) {
  if (!enabled) return false;
  if (ensuredTabs.has(tab)) return true;
  try {
    const meta = await client.spreadsheets.get({
      spreadsheetId: SHEET_ID,
      fields: 'sheets.properties',
    });
    const props = (meta.data.sheets || []).map((s) => s.properties);
    for (const p of props) tabIdCache.set(p.title, p.sheetId);

    if (!props.find((p) => p.title === tab)) {
      console.log(`[sheets] creating tab "${tab}"`);
      const created = await client.spreadsheets.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          requests: [{ addSheet: { properties: { title: tab } } }],
        },
      });
      const newId = created.data.replies[0].addSheet.properties.sheetId;
      tabIdCache.set(tab, newId);
      console.log(`[sheets] tab "${tab}" created`);
    }
    ensuredTabs.add(tab);
    return true;
  } catch (e) {
    console.warn(`[sheets] ensureTab("${tab}") failed:`, e.message);
    return false;
  }
}

async function getSheetId(tab) {
  if (tabIdCache.has(tab)) return tabIdCache.get(tab);
  try {
    const meta = await client.spreadsheets.get({
      spreadsheetId: SHEET_ID,
      fields: 'sheets.properties',
    });
    for (const s of (meta.data.sheets || [])) {
      tabIdCache.set(s.properties.title, s.properties.sheetId);
    }
    return tabIdCache.get(tab) ?? null;
  } catch (e) {
    console.warn('[sheets] getSheetId failed:', e.message);
    return null;
  }
}

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
 * Format a single row:
 *   - bottom border: thin gray (between rows of same participant)
 *                   OR thick green (end of participant block)
 *   - pale green fill when it's the end of a block
 */
async function formatRow(tab, rowNum, isLastRow) {
  if (!enabled) return;
  const sheetId = await getSheetId(tab);
  if (sheetId === null) return;

  const borderStyle = isLastRow
    ? { style: 'SOLID_THICK', color: { red: 0, green: 0.66, blue: 0.53 } }   // brand green
    : { style: 'SOLID',       color: { red: 0.87, green: 0.87, blue: 0.89 } }; // light gray

  const range = {
    sheetId,
    startRowIndex: rowNum - 1,
    endRowIndex: rowNum,
    startColumnIndex: 0,
    endColumnIndex: 11,   // A..K
  };

  const requests = [
    {
      updateBorders: {
        range,
        bottom: borderStyle,
        ...(isLastRow && {
          left:   { style: 'SOLID_THICK', color: { red: 0, green: 0.66, blue: 0.53 } },
          right:  { style: 'SOLID_THICK', color: { red: 0, green: 0.66, blue: 0.53 } },
        }),
      },
    },
  ];

  if (isLastRow) {
    requests.push({
      repeatCell: {
        range,
        cell: {
          userEnteredFormat: {
            backgroundColor: { red: 0.94, green: 1, blue: 0.97 },  // pale green
          },
        },
        fields: 'userEnteredFormat.backgroundColor',
      },
    });
  }

  try {
    await client.spreadsheets.batchUpdate({
      spreadsheetId: SHEET_ID,
      requestBody: { requests },
    });
  } catch (e) {
    console.warn('[sheets] formatRow failed:', e.message);
  }
}

/**
 * Append a row. `opts.isLastRow` marks the end of a participant block.
 */
async function appendRow(tab, values, opts = {}) {
  if (!enabled) return;
  const ok = await ensureTab(tab);
  if (!ok) return;

  try {
    const res = await client.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `${tab}!A:Z`,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [values] },
    });

    // Figure out which row was written so we can format it
    const updatedRange = res.data?.updates?.updatedRange || '';
    const m = updatedRange.match(/![A-Z]+(\d+)/);
    if (m) {
      const rowNum = parseInt(m[1], 10);
      await formatRow(tab, rowNum, Boolean(opts.isLastRow));
    }
  } catch (e) {
    console.warn('[sheets] append failed:', e.message);
  }
}

module.exports = { init, ensureTab, ensureHeader, appendRow };