'use strict';

const ExcelJS = require('exceljs');
const { TASKS } = require('./tasks');

function wideHeader() {
  const h = ['Participant ID', 'Age', 'Device', 'Vision Group', 'Date',
             'Tasks Done', 'Skipped', 'Score', 'Scored Total'];
  for (const t of TASKS) {
    h.push(`T${t.n}_Response`, `T${t.n}_Correct`, `T${t.n}_Skipped`, `T${t.n}_ms`);
  }
  return h;
}

function wideRow(p, responses) {
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
    if (!r) row.push('', '', '', '');
    else row.push(
      r.response || '',
      r.correct === null ? '' : Number(r.correct),
      Number(Boolean(r.skipped)),
      r.duration_ms ?? ''
    );
  }
  return row;
}

function styleHeader(ws) {
  const row = ws.getRow(1);
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0A0A0A' } };
  row.alignment = { horizontal: 'center', vertical: 'middle' };
  row.height = 22;
  ws.views = [{ state: 'frozen', ySplit: 1 }];
}

function autoWidth(ws, max = 40) {
  ws.columns.forEach((col) => {
    let w = 10;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? '').length;
      if (len + 2 > w && len + 2 < max) w = len + 2;
    });
    col.width = w;
  });
}

async function buildExcel(rows) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Low Vision Functional Assessment';
  wb.created = new Date();

  // Sheet 1: Summary
  const ws1 = wb.addWorksheet('Summary');
  ws1.addRow(['Participant ID', 'Age', 'Device', 'Vision Group',
              'Date', 'Tasks Done', 'Skipped', 'Score', 'Scored Total']);
  for (const { participant, responses } of rows) {
    ws1.addRow(wideRow(participant, responses).slice(0, 9));
  }
  styleHeader(ws1);
  autoWidth(ws1);

  // Sheet 2: Wide Format
  const ws2 = wb.addWorksheet('Wide Format');
  ws2.addRow(wideHeader());
  for (const { participant, responses } of rows) {
    ws2.addRow(wideRow(participant, responses));
  }
  styleHeader(ws2);
  autoWidth(ws2, 18);

  // Sheet 3: Long Format
  const ws3 = wb.addWorksheet('Long Format');
  ws3.addRow(['Participant ID', 'Age', 'Device', 'Vision Group',
              'Task #', 'Task Name', 'Response', 'Correct', 'Skipped',
              'Duration (ms)', 'Details', 'Timestamp']);
  for (const { participant, responses } of rows) {
    const sorted = [...responses].sort((a, b) => a.task_number - b.task_number);
    for (const r of sorted) {
      ws3.addRow([
        participant.participant_id, participant.age,
        participant.device, participant.vision_group,
        r.task_number, r.task_name, r.response || '',
        r.correct === null ? '' : (r.correct ? 'Yes' : 'No'),
        r.skipped ? 'Yes' : 'No',
        r.duration_ms ?? '',
        r.data || '',
        r.completed_at
          ? new Date(r.completed_at).toISOString().slice(0, 19).replace('T', ' ')
          : '',
      ]);
    }
  }
  styleHeader(ws3);
  [14, 6, 10, 12, 7, 24, 30, 8, 8, 12, 40, 20].forEach((w, i) => {
    ws3.getColumn(i + 1).width = w;
  });

  // Per-participant sheets (only if ≤20 participants)
  if (rows.length <= 20) {
    for (const { participant, responses } of rows) {
      const safe = String(participant.participant_id)
        .replace(/[\\/?*[\]:]/g, '_').slice(0, 28);
      const ws = wb.addWorksheet(`P_${safe}`);
      ws.addRow(['#', 'Task', 'Response', 'Result', 'Duration (ms)', 'Timestamp']);
      const sorted = [...responses].sort((a, b) => a.task_number - b.task_number);
      for (const r of sorted) {
        const result = r.skipped ? 'Skipped'
                     : r.correct === null ? '—'
                     : r.correct ? 'Correct' : 'Incorrect';
        ws.addRow([
          r.task_number, r.task_name, r.response || '', result,
          r.duration_ms ?? '',
          r.completed_at
            ? new Date(r.completed_at).toISOString().slice(0, 19).replace('T', ' ')
            : '',
        ]);
      }
      styleHeader(ws);
      [5, 24, 30, 12, 14, 20].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    }
  }

  return wb.xlsx.writeBuffer();
}

module.exports = { buildExcel };