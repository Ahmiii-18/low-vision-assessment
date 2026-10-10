'use strict';

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('render.com')
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (e) => console.error('[db] idle client error:', e.message));

async function query(text, params) {
  const start = Date.now();
  const res = await pool.query(text, params);
  const dur = Date.now() - start;
  if (dur > 500) console.warn(`[db] slow query (${dur}ms):`, text.slice(0, 80));
  return res;
}

async function migrate() {
  console.log('[migrate] running');

  await query(`
    CREATE TABLE IF NOT EXISTS participants (
      id             SERIAL PRIMARY KEY,
      participant_id VARCHAR(50)  NOT NULL,
      age            INTEGER      NOT NULL,
      device         VARCHAR(50)  NOT NULL,
      vision_group   VARCHAR(50)  NOT NULL,
      created_at     TIMESTAMPTZ  DEFAULT NOW(),
      deleted_at     TIMESTAMPTZ
    );
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS task_responses (
      id             SERIAL PRIMARY KEY,
      participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
      task_number    INTEGER NOT NULL,
      task_name      VARCHAR(100) NOT NULL,
      response       VARCHAR(2000),
      data           TEXT,
      correct        BOOLEAN,
      skipped        BOOLEAN DEFAULT FALSE,
      duration_ms    INTEGER,
      completed_at   TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await query(`
    CREATE INDEX IF NOT EXISTS idx_resp_pid ON task_responses(participant_id);
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id         SERIAL PRIMARY KEY,
      action     VARCHAR(50)  NOT NULL,
      entity     VARCHAR(50)  NOT NULL,
      entity_id  INTEGER,
      ip         VARCHAR(64),
      meta       TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // Idempotent column adds — safe on old databases
  const migrations = [
    ['participants',   'deleted_at',   'ALTER TABLE participants ADD COLUMN deleted_at TIMESTAMPTZ'],
    ['task_responses', 'data',         'ALTER TABLE task_responses ADD COLUMN data TEXT'],
    ['task_responses', 'skipped',      'ALTER TABLE task_responses ADD COLUMN skipped BOOLEAN DEFAULT FALSE'],
    ['task_responses', 'duration_ms',  'ALTER TABLE task_responses ADD COLUMN duration_ms INTEGER'],
    ['task_responses', 'correct',      'ALTER TABLE task_responses ADD COLUMN correct BOOLEAN'],
  ];

  for (const [table, col, sql] of migrations) {
    try {
      const { rows } = await query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_name = $1 AND column_name = $2`,
        [table, col]
      );
      if (rows.length === 0) {
        await query(sql);
        console.log(`[migrate] added ${table}.${col}`);
      }
    } catch (e) {
      console.warn(`[migrate] ${table}.${col} skipped:`, e.message);
    }
  }

  console.log('[migrate] done');
}

async function audit(action, entity, entityId, ip, meta) {
  try {
    await query(
      `INSERT INTO audit_log (action, entity, entity_id, ip, meta)
       VALUES ($1, $2, $3, $4, $5)`,
      [action, entity, entityId, ip || null, meta ? JSON.stringify(meta) : null]
    );
  } catch (e) {
    console.warn('[audit] failed:', e.message);
  }
}

module.exports = { pool, query, migrate, audit };