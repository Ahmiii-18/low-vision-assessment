'use strict';

/**
 * Google Sheets live sync. Every task submission gets appended as a row.
 * Disabled automatically if credentials aren't set.
 */

const { google } = require('googleapis');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
let client = null;
let enabled = false;

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

async function ensureHeader(tab, header) {
  if (!enabled) return;
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

async function appendRow(tab, values) {
  if (!enabled) return;
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

module.exports = { init, ensureHeader, appendRow };