'use strict';

require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const { Server } = require('socket.io');

const db = require('./db');
const sheets = require('./sheets');
const keepAlive = require('./keepAlive');
const { buildExcel } = require('./excel');
const { TASKS, TOTAL_TASKS, scoreTask } = require('./tasks');

const PORT = process.env.PORT || 3000;
const DATA_PIN = process.env.DATA_PIN || '';
const IS_PROD = process.env.NODE_ENV === 'production';

/* -------------------------------------------------------------------- */
/* Express + Socket.io                                                  */
/* -------------------------------------------------------------------- */
const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.set('trust proxy', 1);

app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(morgan(IS_PROD ? 'combined' : 'dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

app.use(session({
  store: new PgSession({ pool: db.pool, createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
  },
}));

/* -------------------------------------------------------------------- */
/* Helpers                                                              */
/* -------------------------------------------------------------------- */
const ah = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

const broadcast = (event, data) => io.emit(event, data);

const submitLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});

function requirePin(req, res, next) {
  if (!DATA_PIN) return next();
  if (req.session && req.session.pinOk) return next();
  return res.redirect('/login');
}

async function fetchParticipant(id) {
  const { rows: p } = await db.query(
    'SELECT * FROM participants WHERE id = $1 AND deleted_at IS NULL',
    [id]
  );
  if (!p[0]) return null;
  const { rows: r } = await db.query(
    'SELECT * FROM task_responses WHERE participant_id = $1 ORDER BY task_number',
    [id]
  );
  return { participant: p[0], responses: r };
}

async function fetchAllWithResponses() {
  const { rows: participants } = await db.query(
    'SELECT * FROM participants WHERE deleted_at IS NULL ORDER BY created_at'
  );
  const ids = participants.map((p) => p.id);
  const { rows: responses } = ids.length
    ? await db.query(
        'SELECT * FROM task_responses WHERE participant_id = ANY($1::int[]) ORDER BY task_number',
        [ids]
      )
    : { rows: [] };

  const byPid = {};
  for (const r of responses) (byPid[r.participant_id] ||= []).push(r);
  return participants.map((p) => ({
    participant: p,
    responses: byPid[p.id] || [],
  }));
}

/* -------------------------------------------------------------------- */
/* Socket.io                                                            */
/* -------------------------------------------------------------------- */
io.on('connection', (socket) => {
  console.log('[ws] client connected:', socket.id);
  socket.emit('hello', { tasks: TOTAL_TASKS });
  socket.on('watch:global', () => socket.join('global'));
  socket.on('watch:participant', (id) => socket.join(`p:${id}`));
  socket.on('disconnect', () => console.log('[ws] client left:', socket.id));
});

/* -------------------------------------------------------------------- */
/* Pages                                                                */
/* -------------------------------------------------------------------- */
app.get('/', (req, res) => {
  res.render('index', {
    totalTasks: TOTAL_TASKS,
    flashed: req.query.flash || null,
  });
});

app.get('/login', (req, res) => {
  if (!DATA_PIN) return res.redirect('/data');
  res.render('login', { error: null });
});

app.post('/login', (req, res) => {
  if (String(req.body.pin || '').trim() === DATA_PIN) {
    req.session.pinOk = true;
    return res.redirect('/data');
  }
  res.render('login', { error: 'Incorrect PIN.' });
});

app.get('/logout', (req, res) => {
  req.session.pinOk = false;
  res.redirect('/');
});

/* -------------------------------------------------------------------- */
/* Participants                                                         */
/* -------------------------------------------------------------------- */
app.post(
  '/participants',
  body('participantId').trim().notEmpty().withMessage('Participant ID required'),
  body('age').isInt({ min: 1, max: 130 }).withMessage('Age must be 1-130'),
  body('device').isIn(['Tablet', 'Phone', 'Desktop']),
  body('visionGroup').isIn(['Low vision', 'Normal vision', 'Blind']),
  ah(async (req, res) => {
    const errs = validationResult(req);
    if (!errs.isEmpty()) {
      return res.redirect('/?flash=' + encodeURIComponent(errs.array()[0].msg));
    }
    const { participantId, age, device, visionGroup } = req.body;
    const { rows } = await db.query(
      `INSERT INTO participants (participant_id, age, device, vision_group)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [participantId, parseInt(age, 10), device, visionGroup]
    );
    const p = rows[0];
    await db.audit('create', 'participant', p.id, req.ip, { participantId });
    broadcast('participant:created', { id: p.id, participantId });
    res.redirect(`/assessment/${p.id}/task/1`);
  })
);

/* -------------------------------------------------------------------- */
/* Assessment                                                           */
/* -------------------------------------------------------------------- */
app.get(
  '/assessment/:id/task/:num',
  ah(async (req, res) => {
    const pid = parseInt(req.params.id, 10);
    const num = parseInt(req.params.num, 10);
    const { rows: p } = await db.query(
      'SELECT * FROM participants WHERE id = $1 AND deleted_at IS NULL',
      [pid]
    );
    if (!p[0]) return res.status(404).send('Participant not found');

    if (num > TOTAL_TASKS) return res.redirect(`/assessment/${pid}/complete`);
    if (num < 1) return res.redirect(`/assessment/${pid}/task/1`);

    const task = TASKS[num - 1];
    const progress = Math.round(((num - 1) / TOTAL_TASKS) * 100);

    res.render('task', {
      participant: p[0],
      task,
      taskNum: num,
      total: TOTAL_TASKS,
      progress,
      taskJson: JSON.stringify(task),
    });
  })
);

app.post(
  '/api/submit_task',
  submitLimiter,
  ah(async (req, res) => {
    const { participant_id, task_number, response, data, duration_ms, skipped } = req.body;
    const pid = parseInt(participant_id, 10);
    const tn = parseInt(task_number, 10);

    if (!pid || !tn) {
      return res.status(400).json({ ok: false, error: 'missing participant_id or task_number' });
    }

    const { rows: p } = await db.query(
      'SELECT * FROM participants WHERE id = $1 AND deleted_at IS NULL',
      [pid]
    );
    if (!p[0]) {
      return res.status(404).json({ ok: false, error: `participant ${pid} not found` });
    }

    const task = TASKS.find((t) => t.n === tn);
    if (!task) {
      return res.status(400).json({ ok: false, error: `unknown task ${tn}` });
    }

    const isSkipped = Boolean(skipped);
    const correct = scoreTask(task, response, isSkipped);
    const respStr = String(response ?? '').slice(0, 2000);
    const dataStr = data ? JSON.stringify(data).slice(0, 10000) : null;

    const { rows } = await db.query(
      `INSERT INTO task_responses
         (participant_id, task_number, task_name, response, data, correct, skipped, duration_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        pid,
        tn,
        task.name,
        respStr,
        dataStr,
        correct,
        isSkipped,
        Number.isInteger(duration_ms) ? duration_ms : null,
      ]
    );

    await db.audit('create', 'task_response', rows[0].id, req.ip, { pid, tn });

    // Google Sheets — fire and forget
    sheets.appendRow('Responses', [
      new Date().toISOString(),
      p[0].participant_id,
      p[0].age,
      p[0].vision_group,
      p[0].device,
      tn,
      task.name,
      respStr || '(skipped)',
      correct === null ? '' : (correct ? 'Yes' : 'No'),
      isSkipped ? 'Yes' : 'No',
      duration_ms ?? '',
    ]);

    // Broadcast to dashboards
    broadcast('task:new', {
      participant_id: pid,
      participant_code: p[0].participant_id,
      task_number: tn,
      task_name: task.name,
      response: respStr,
      correct,
      skipped: isSkipped,
      duration_ms: duration_ms || null,
      ts: Date.now(),
    });

    const next = tn + 1;
    const nextUrl = next > TOTAL_TASKS
      ? `/assessment/${pid}/complete`
      : `/assessment/${pid}/task/${next}`;

    res.json({ ok: true, next: nextUrl });
  })
);

app.get(
  '/assessment/:id/complete',
  ah(async (req, res) => {
    const data = await fetchParticipant(parseInt(req.params.id, 10));
    if (!data) return res.status(404).send('Not found');
    const scored = data.responses.filter((r) => r.correct !== null && !r.skipped);
    res.render('complete', {
      participant: data.participant,
      responses: data.responses,
      score: scored.filter((r) => r.correct).length,
      scoredTotal: scored.length,
    });
  })
);

/* -------------------------------------------------------------------- */
/* Data viewer                                                          */
/* -------------------------------------------------------------------- */
app.get(
  '/data',
  requirePin,
  ah(async (req, res) => {
    const { rows: participants } = await db.query(
      'SELECT * FROM participants WHERE deleted_at IS NULL ORDER BY created_at DESC'
    );
    const ids = participants.map((p) => p.id);
    const { rows: responses } = ids.length
      ? await db.query(
          'SELECT * FROM task_responses WHERE participant_id = ANY($1::int[])',
          [ids]
        )
      : { rows: [] };

    const byPid = {};
    for (const r of responses) (byPid[r.participant_id] ||= []).push(r);

    const rows = participants.map((p) => {
      const rs = byPid[p.id] || [];
      const byNum = Object.fromEntries(rs.map((r) => [r.task_number, r]));
      const scored = rs.filter((r) => r.correct !== null && !r.skipped);
      const cells = {};
      for (const t of TASKS) {
        const r = byNum[t.n];
        cells[t.n] = r
          ? { response: r.response || '', correct: r.correct, skipped: Boolean(r.skipped) }
          : { response: '—', correct: null, skipped: false };
      }
      return {
        id: p.id,
        participant_id: p.participant_id,
        age: p.age,
        device: p.device,
        vision_group: p.vision_group,
        created_at: new Date(p.created_at).toISOString().slice(0, 16).replace('T', ' '),
        tasks_done: rs.length,
        skipped: rs.filter((r) => r.skipped).length,
        score: scored.filter((r) => r.correct).length,
        scored_total: scored.length,
        tasks: cells,
      };
    });

    res.render('data', {
      rows,
      tasks: TASKS,
      totalParticipants: participants.length,
      liveEnabled: true,
    });
  })
);

app.get(
  '/data/participant/:id',
  requirePin,
  ah(async (req, res) => {
    const data = await fetchParticipant(parseInt(req.params.id, 10));
    if (!data) return res.status(404).send('Not found');
    res.render('participant', data);
  })
);

app.post(
  '/api/delete_participant/:id',
  requirePin,
  ah(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    await db.query('UPDATE participants SET deleted_at = NOW() WHERE id = $1', [id]);
    await db.audit('soft_delete', 'participant', id, req.ip);
    broadcast('participant:deleted', { id });
    res.json({ ok: true });
  })
);

app.post(
  '/api/restore_participant/:id',
  requirePin,
  ah(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    await db.query('UPDATE participants SET deleted_at = NULL WHERE id = $1', [id]);
    await db.audit('restore', 'participant', id, req.ip);
    res.json({ ok: true });
  })
);

/* -------------------------------------------------------------------- */
/* Exports                                                              */
/* -------------------------------------------------------------------- */
app.get(
  '/export/excel',
  requirePin,
  ah(async (req, res) => {
    const data = await fetchAllWithResponses();
    const buf = await buildExcel(data);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', 'attachment; filename="low_vision_all.xlsx"');
    res.send(Buffer.from(buf));
  })
);

app.get(
  '/export/excel/participant/:id',
  requirePin,
  ah(async (req, res) => {
    const data = await fetchParticipant(parseInt(req.params.id, 10));
    if (!data) return res.status(404).send('Not found');
    const buf = await buildExcel([data]);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="participant_${data.participant.participant_id}.xlsx"`
    );
    res.send(Buffer.from(buf));
  })
);

function csvEsc(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

app.get(
  '/export',
  requirePin,
  ah(async (req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="all_participants.csv"');
    res.write('\uFEFF');
    res.write(
      'Participant ID,Age,Device,Vision Group,Task #,Task Name,Response,Correct,Skipped,Duration (ms),Timestamp\n'
    );
    const data = await fetchAllWithResponses();
    for (const { participant: p, responses } of data) {
      const sorted = [...responses].sort((a, b) => a.task_number - b.task_number);
      for (const r of sorted) {
        res.write(
          [
            p.participant_id, p.age, p.device, p.vision_group,
            r.task_number, r.task_name, csvEsc(r.response || ''),
            r.correct === null ? '' : (r.correct ? '1' : '0'),
            r.skipped ? '1' : '0',
            r.duration_ms ?? '',
            r.completed_at ? new Date(r.completed_at).toISOString() : '',
          ].join(',') + '\n'
        );
      }
    }
    res.end();
  })
);

app.get(
  '/export/participant/:id',
  requirePin,
  ah(async (req, res) => {
    const data = await fetchParticipant(parseInt(req.params.id, 10));
    if (!data) return res.status(404).send('Not found');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="participant_${data.participant.participant_id}.csv"`
    );
    res.write('\uFEFF');
    res.write('Task #,Task Name,Response,Correct,Skipped,Duration (ms),Timestamp\n');
    for (const r of data.responses) {
      res.write(
        [
          r.task_number, r.task_name, csvEsc(r.response || ''),
          r.correct === null ? '' : (r.correct ? '1' : '0'),
          r.skipped ? '1' : '0',
          r.duration_ms ?? '',
          r.completed_at ? new Date(r.completed_at).toISOString() : '',
        ].join(',') + '\n'
      );
    }
    res.end();
  })
);

app.get(
  '/export/wide',
  requirePin,
  ah(async (req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="wide_format.csv"');
    res.write('\uFEFF');

    const header = ['Participant ID', 'Age', 'Device', 'Vision Group', 'Date',
                    'Tasks Done', 'Skipped', 'Score', 'Scored Total'];
    for (const t of TASKS) {
      header.push(`T${t.n}_Response`, `T${t.n}_Correct`, `T${t.n}_Skipped`, `T${t.n}_ms`);
    }
    res.write(header.join(',') + '\n');

    const data = await fetchAllWithResponses();
    for (const { participant: p, responses } of data) {
      const byNum = Object.fromEntries(responses.map((r) => [r.task_number, r]));
      const scored = responses.filter((r) => r.correct !== null && !r.skipped);
      const row = [
        p.participant_id, p.age, p.device, p.vision_group,
        new Date(p.created_at).toISOString().slice(0, 16).replace('T', ' '),
        responses.length,
        responses.filter((r) => r.skipped).length,
        scored.filter((r) => r.correct).length,
        scored.length,
      ];
      for (const t of TASKS) {
        const r = byNum[t.n];
        if (r) row.push(
          csvEsc(r.response || ''),
          r.correct === null ? '' : Number(r.correct),
          Number(Boolean(r.skipped)),
          r.duration_ms ?? ''
        );
        else row.push('', '', '', '');
      }
      res.write(row.join(',') + '\n');
    }
    res.end();
  })
);

/* -------------------------------------------------------------------- */
/* Health                                                               */
/* -------------------------------------------------------------------- */
app.get(
  '/health',
  ah(async (req, res) => {
    const { rows } = await db.query(
      'SELECT COUNT(*)::int AS n FROM participants WHERE deleted_at IS NULL'
    );
    res.json({
      status: 'ok',
      tasks: TOTAL_TASKS,
      participants: rows[0].n,
      uptime: Math.round(process.uptime()),
      ts: Date.now(),
    });
  })
);

/* -------------------------------------------------------------------- */
/* Errors                                                               */
/* -------------------------------------------------------------------- */
app.use((err, req, res, next) => {
  console.error('[error]', err.stack || err);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({
      ok: false,
      error: `${err.name || 'Error'}: ${err.message || 'unknown'}`,
    });
  }
  res.status(500).send('Internal Server Error');
});

app.use((req, res) => res.status(404).send('Not found'));

/* -------------------------------------------------------------------- */
/* Boot                                                                 */
/* -------------------------------------------------------------------- */
(async () => {
  try {
    await db.migrate();
    await sheets.init();
    await sheets.ensureHeader('Responses', [
      'Timestamp', 'Participant ID', 'Age', 'Vision Group', 'Device',
      'Task #', 'Task Name', 'Response', 'Correct', 'Skipped', 'Duration (ms)',
    ]);

    server.listen(PORT, () => {
      console.log(`[boot] listening on :${PORT} (${process.env.NODE_ENV || 'dev'})`);
      console.log(`[boot] tasks: ${TOTAL_TASKS} | PIN: ${DATA_PIN ? 'ON' : 'OFF'}`);
      const selfUrl = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;
      keepAlive.start(selfUrl);
    });
  } catch (e) {
    console.error('[boot] failed:', e);
    process.exit(1);
  }
})();

['SIGTERM', 'SIGINT'].forEach((sig) => {
  process.on(sig, () => {
    console.log(`[shutdown] ${sig}`);
    server.close(() => db.pool.end(() => process.exit(0)));
    setTimeout(() => process.exit(1), 10000);
  });
});