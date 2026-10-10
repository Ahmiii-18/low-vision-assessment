(function () {
  'use strict';

  const TASK     = window.__TASK__;
  const PID      = window.__PID__;
  const TASK_NUM = window.__NUM__;
  const TOTAL    = window.__TOTAL__;

  let START = Date.now();
  let submitAllowed = true;

  const stage    = document.getElementById('stage');
  const controls = document.getElementById('controls');

  /* ---------- deterministic RNG seeded by participant + task ---------- */
  function makeRng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }
  const rng = makeRng(PID * 1000 + TASK_NUM);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  function el(html) {
    const d = document.createElement('div');
    d.innerHTML = html.trim();
    return d.firstChild;
  }
  function clearStage()    { stage.innerHTML = ''; }
  function clearControls() { controls.innerHTML = ''; }
  function setStageClass(c){ stage.className = c || ''; }

  /* ---------- submit ---------- */
  function submitTask(response, data, opts, resolvedConfig) {
    if (!submitAllowed) return;
    submitAllowed = false;

    const payload = {
      participant_id: PID,
      task_number: TASK_NUM,
      response: response,
      data: data || {},
      duration_ms: Date.now() - START,
      skipped: !!(opts && opts.skipped),
      resolved_config: resolvedConfig || null,   // lets server score correctly
    };

    fetch('/api/submit_task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(async (r) => {
        const txt = await r.text();
        if (!r.ok) throw new Error(`HTTP ${r.status} — ${txt.slice(0, 300)}`);
        try { return JSON.parse(txt); }
        catch { throw new Error('Bad JSON: ' + txt.slice(0, 300)); }
      })
      .then((d) => {
        if (d.ok && d.next) window.location.href = d.next;
        else throw new Error(d.error || 'unknown error');
      })
      .catch((err) => {
        console.error('[submit]', err);
        submitAllowed = true;
        if (confirm('Connection issue. Retry now?\n\n' + err.message)) {
          submitTask(response, data, opts, resolvedConfig);
        }
      });
  }

  function skipTask() {
    if (!confirm('Skip this task? It will be recorded as "Skipped".')) return;
    submitTask('SKIPPED', { skipped: true }, { skipped: true });
  }

  /* ---------- helper: choice buttons that auto-advance ---------- */
  function choiceButtons(options, onPick, opts) {
    const wrap = el(`<div class="options ${options.length === 2 ? 'two' : ''}"></div>`);
    options.forEach((opt) => {
      const b = el(`<button type="button" class="choice-btn">${opt}</button>`);
      b.onclick = () => {
        wrap.querySelectorAll('.choice-btn').forEach(x => x.classList.remove('selected'));
        b.classList.add('selected');
        onPick(opt);
      };
      wrap.appendChild(b);
    });
    return wrap;
  }

  /* ================================================================
     RENDERERS
     ================================================================ */
  const RENDERERS = {

    /* 1. Snellen Acuity — auto-advance on tap */
    snellen() {
      const cfg = TASK.config;
      let round = 0;
      const results = [];

      function showRound() {
        clearStage(); clearControls();
        const dir   = ['up','right','down','left'][Math.floor(rng() * 4)];
        const angle = { up:270, right:0, down:90, left:180 }[dir];
        const size  = cfg.sizes[Math.min(round, cfg.sizes.length - 1)];

        stage.appendChild(el(
          `<div class="snellen-e" style="font-size:${size}px; transform:rotate(${angle}deg);">E</div>`
        ));

        const grid = el(`
          <div class="arrow-grid">
            <button class="center" disabled></button>
            <button data-dir="up">↑</button>
            <button class="center" disabled></button>
            <button data-dir="left">←</button>
            <button class="center" disabled>◉</button>
            <button data-dir="right">→</button>
            <button class="center" disabled></button>
            <button data-dir="down">↓</button>
            <button class="center" disabled></button>
          </div>
        `);

        grid.querySelectorAll('button[data-dir]').forEach((b) => {
          b.onclick = () => {
            const picked = b.dataset.dir;
            results.push({ direction: dir, picked, correct: picked === dir });
            round++;
            if (round >= cfg.rounds) {
              const hits = results.filter((r) => r.correct).length;
              submitTask(`${hits}/${cfg.rounds}`, { rounds: results });
            } else {
              showRound();
            }
          };
        });
        controls.appendChild(grid);
      }
      showRound();
    },

    /* 2. Contrast Sensitivity — proper Michelson, auto-advance on YES/NO */
    contrast() {
      const cfg = TASK.config;
      let idx = 0;
      const results = [];

      function showLevel() {
        clearStage(); clearControls();
        const pct = cfg.levels[idx];               // 100 = black, 2 = nearly white
        const gray = Math.round(255 * (1 - pct / 100));

        stage.appendChild(el(
          `<div class="contrast-letter" style="font-size:180px; color:rgb(${gray},${gray},${gray});">${cfg.letter}</div>`
        ));

        const opts = choiceButtons(['YES', 'NO'], (picked) => {
          results.push({ contrast_pct: pct, answer: picked });
          idx++;
          if (idx >= cfg.levels.length) {
            const yesCount = results.filter(r => r.answer === 'YES').length;
            const lastYes  = results.filter(r => r.answer === 'YES').pop();
            submitTask(`${yesCount}/${results.length}`, {
              results,
              lowest_visible_contrast_pct: lastYes ? lastYes.contrast_pct : 0,
            });
          } else {
            setTimeout(showLevel, 200);
          }
        });
        controls.appendChild(opts);
      }
      showLevel();
    },

    /* 3. Ishihara — randomized number per participant */
    ishihara() {
      clearStage(); clearControls();
      const number = pick(TASK.config.pool);

      const size = 300;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.style.borderRadius = '50%';
      stage.appendChild(canvas);
      const ctx = canvas.getContext('2d');

      const bg = ['#c0392b','#e67e22','#d35400','#a93226','#cb4335'];
      for (let i = 0; i < 700; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        const r = 4 + Math.random() * 6;
        if ((x - size/2) ** 2 + (y - size/2) ** 2 > (size/2 - 4) ** 2) continue;
        ctx.fillStyle = bg[Math.floor(Math.random() * bg.length)];
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      }

      const off = document.createElement('canvas');
      off.width = off.height = size;
      const octx = off.getContext('2d');
      octx.fillStyle = '#000';
      octx.font = 'bold 180px Arial';
      octx.textAlign = 'center';
      octx.textBaseline = 'middle';
      octx.fillText(number, size/2, size/2 + 10);
      const imgData = octx.getImageData(0, 0, size, size).data;

      const fg = ['#27ae60','#2ecc71','#16a085','#1abc9c'];
      for (let i = 0; i < 2500; i++) {
        const x = Math.random() * size;
        const y = Math.random() * size;
        if ((x - size/2) ** 2 + (y - size/2) ** 2 > (size/2 - 4) ** 2) continue;
        const px = (Math.floor(y) * size + Math.floor(x)) * 4;
        if (imgData[px + 3] > 128) {
          ctx.fillStyle = fg[Math.floor(Math.random() * fg.length)];
          ctx.beginPath(); ctx.arc(x, y, 4 + Math.random() * 4, 0, Math.PI * 2); ctx.fill();
        }
      }

      const input = el(`<input type="text" placeholder="Type the number you see" autofocus>`);
      const btn   = el(`<button class="btn primary">Submit</button>`);
      btn.onclick = () => submitTask(input.value.trim(),
                                     { expected: number },
                                     null,
                                     { number });
      controls.appendChild(input);
      controls.appendChild(btn);
      input.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
    },

    /* 4. Amsler Grid — unchanged */
    amsler() {
      clearStage(); clearControls();
      const N = 12;
      const wrap = el(`<div style="position:relative;"></div>`);
      const grid = el(`<div class="amsler-grid" style="grid-template-columns:repeat(${N},1fr); grid-template-rows:repeat(${N},1fr);"></div>`);
      const marked = [];

      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          const cell = el(`<div class="amsler-cell"></div>`);
          cell.onclick = () => {
            cell.classList.toggle('marked');
            const key = `${r},${c}`;
            const i = marked.indexOf(key);
            if (i >= 0) marked.splice(i, 1); else marked.push(key);
          };
          grid.appendChild(cell);
        }
      }
      wrap.appendChild(grid);
      wrap.appendChild(el(`<div class="amsler-center" style="left:calc(50% - 4px); top:calc(50% - 4px);"></div>`));
      stage.appendChild(wrap);

      const btn = el(`<button class="btn primary">Submit Amsler Result</button>`);
      btn.onclick = () => submitTask(
        marked.length === 0 ? 'No distortion' : `${marked.length} areas marked`,
        { marked_cells: marked }
      );
      controls.appendChild(btn);
    },

    /* 5. Visual Field — unchanged */
    visual_field() {
      const cfg = TASK.config;
      let round = 0;
      const results = [];
      const positions = [];
      for (let i = 0; i < cfg.rounds; i++) {
        positions.push({
          angle: Math.random() * Math.PI * 2,
          radius: 60 + Math.random() * 130,
        });
      }

      function nextRound() {
        clearStage(); clearControls();
        setStageClass('dark');

        stage.appendChild(el(
          `<div style="position:absolute; font-size:28px; color:#00c9a7;">+</div>`
        ));

        const { angle, radius } = positions[round];
        const cx = stage.clientWidth / 2  + Math.cos(angle) * radius;
        const cy = stage.clientHeight / 2 + Math.sin(angle) * radius;
        const dot = el(
          `<div style="position:absolute; left:${cx - 8}px; top:${cy - 8}px;
                       width:16px; height:16px; background:#fff; border-radius:50%;
                       opacity:0; transition:opacity .15s;"></div>`
        );
        stage.appendChild(dot);

        setTimeout(() => {
          dot.style.opacity = '1';
          setTimeout(() => { dot.style.opacity = '0'; }, 400);
        }, 500 + Math.random() * 800);

        const tapHandler = (e) => {
          const rect = stage.getBoundingClientRect();
          const tx = e.touches ? e.touches[0].clientX : e.clientX;
          const ty = e.touches ? e.touches[0].clientY : e.clientY;
          const x = tx - rect.left;
          const y = ty - rect.top;
          const dx = x - stage.clientWidth / 2;
          const dy = y - stage.clientHeight / 2;
          const tappedAngle  = Math.atan2(dy, dx);
          const tappedRadius = Math.sqrt(dx * dx + dy * dy);
          const angleDiff = Math.abs(Math.atan2(
            Math.sin(tappedAngle - angle),
            Math.cos(tappedAngle - angle)
          ));
          const hit = angleDiff < 0.5 && Math.abs(tappedRadius - radius) < 60;
          results.push({ angle, radius, hit });
          round++;
          stage.removeEventListener('click', tapHandler);

          if (round >= cfg.rounds) {
            const hits = results.filter((r) => r.hit).length;
            submitTask(`${hits}/${cfg.rounds}`, { results });
          } else {
            setTimeout(nextRound, 300);
          }
        };
        stage.addEventListener('click', tapHandler);
      }
      nextRound();
    },

    /* 6. Motion Detection — auto-advance on tap */
    motion() {
      const cfg = TASK.config;
      let round = 0;
      const results = [];
      const dirs = ['left', 'right', 'up', 'down'];

      function showRound() {
        clearStage(); clearControls();
        const dir = dirs[Math.floor(rng() * 4)];
        const dot = el(
          `<div style="position:absolute; width:22px; height:22px; background:#00c9a7;
                       border-radius:50%; left:50%; top:50%;
                       transform:translate(-50%,-50%);
                       transition:transform .6s ease-out;"></div>`
        );
        stage.appendChild(dot);

        setTimeout(() => {
          const d = 100;
          const dx = dir === 'left' ? -d : dir === 'right' ? d : 0;
          const dy = dir === 'up'   ? -d : dir === 'down'  ? d : 0;
          dot.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
        }, 300);

        const opts = choiceButtons(
          ['LEFT', 'RIGHT', 'UP', 'DOWN'],
          (picked) => {
            const p = picked.toLowerCase();
            results.push({ direction: dir, picked: p, correct: p === dir });
            round++;
            if (round >= cfg.rounds) {
              const hits = results.filter((r) => r.correct).length;
              submitTask(`${hits}/${cfg.rounds}`, { results });
            } else {
              setTimeout(showRound, 200);
            }
          }
        );
        opts.classList.add('two');
        controls.appendChild(opts);
      }
      showRound();
    },

    /* 7. Reading Speed — randomized sentence */
    reading() {
      clearStage(); clearControls();
      const text = pick(TASK.config.pool);

      stage.appendChild(el(
        `<div style="font-size:26px; line-height:1.5; padding:16px; text-align:center;">${text}</div>`
      ));

      const timer = el(`<div class="timer-badge">0.0s</div>`);
      stage.appendChild(timer);
      const t0 = Date.now();
      const tick = setInterval(() => {
        timer.textContent = ((Date.now() - t0) / 1000).toFixed(1) + 's';
      }, 100);

      const input = el(`<input type="text" placeholder="Type the sentence exactly" autofocus>`);
      const btn   = el(`<button class="btn primary">Submit</button>`);
      btn.onclick = () => {
        clearInterval(tick);
        submitTask(input.value,
                   { expected: text, read_time_ms: Date.now() - t0 },
                   null,
                   { text });
      };
      input.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
      controls.appendChild(input);
      controls.appendChild(btn);
    },

    /* 8. Glare Sensitivity — unchanged */
    glare() {
      clearStage(); clearControls();
      setStageClass('dark');
      stage.appendChild(el(`<div class="glare-light"></div>`));

      const slider = el(`<input type="range" min="0" max="10" value="5" style="width:100%;">`);
      const val    = el(`<div style="text-align:center; font-size:32px; font-weight:700; color:#00c9a7;">5</div>`);
      slider.oninput = () => { val.textContent = slider.value; };

      const btn = el(`<button class="btn primary">Submit Rating</button>`);
      btn.onclick = () => submitTask(slider.value, { discomfort: parseInt(slider.value) });

      controls.appendChild(slider);
      controls.appendChild(val);
      controls.appendChild(btn);
    },

    /* 9. Face Recognition — randomized emotion */
    face() {
      clearStage(); clearControls();
      const emotion = pick(TASK.config.pool);

      const faces = {
        happy:    `<circle cx="100" cy="100" r="70" fill="#ffe0b2"/><circle cx="75" cy="85" r="7" fill="#000"/><circle cx="125" cy="85" r="7" fill="#000"/><path d="M60 120 Q100 165 140 120" stroke="#000" stroke-width="6" fill="none" stroke-linecap="round"/>`,
        sad:      `<circle cx="100" cy="100" r="70" fill="#ffe0b2"/><circle cx="75" cy="85" r="7" fill="#000"/><circle cx="125" cy="85" r="7" fill="#000"/><path d="M60 145 Q100 110 140 145" stroke="#000" stroke-width="6" fill="none" stroke-linecap="round"/>`,
        angry:    `<circle cx="100" cy="100" r="70" fill="#ffd0a0"/><circle cx="75" cy="90" r="7" fill="#000"/><circle cx="125" cy="90" r="7" fill="#000"/><path d="M60 75 L90 85" stroke="#000" stroke-width="6" stroke-linecap="round"/><path d="M140 75 L110 85" stroke="#000" stroke-width="6" stroke-linecap="round"/><path d="M70 140 Q100 120 130 140" stroke="#000" stroke-width="6" fill="none"/>`,
        surprised:`<circle cx="100" cy="100" r="70" fill="#ffe0b2"/><circle cx="75" cy="85" r="8" fill="#000"/><circle cx="125" cy="85" r="8" fill="#000"/><ellipse cx="100" cy="135" rx="14" ry="18" fill="#000"/>`,
        neutral:  `<circle cx="100" cy="100" r="70" fill="#ffe0b2"/><circle cx="75" cy="85" r="7" fill="#000"/><circle cx="125" cy="85" r="7" fill="#000"/><line x1="75" y1="135" x2="125" y2="135" stroke="#000" stroke-width="6" stroke-linecap="round"/>`,
      };
      stage.innerHTML = `<svg width="200" height="200" viewBox="0 0 200 200">${faces[emotion] || faces.neutral}</svg>`;

      const opts = el(`<div class="options">${
        TASK.config.options.map((o) =>
          `<label><input type="radio" name="emo" value="${o}">${o}</label>`).join('')
      }</div>`);
      const btn = el(`<button class="btn primary">Submit</button>`);
      btn.onclick = () => {
        const p = opts.querySelector('input:checked');
        if (!p) return;
        submitTask(p.value, { expected: emotion }, null, { emotion });
      };
      controls.appendChild(opts);
      controls.appendChild(btn);
    },

    /* 10. Object Recognition — randomized shape */
    object() {
      clearStage(); clearControls();
      const shape = pick(TASK.config.pool);

      const shapes = {
        house: `<rect x="30" y="80" width="140" height="90" fill="#c0865b"/><polygon points="20,80 100,20 180,80" fill="#a04a4a"/><rect x="85" y="120" width="30" height="50" fill="#7a5a3a"/>`,
        tree:  `<rect x="90" y="120" width="20" height="60" fill="#7a5a3a"/><circle cx="100" cy="90" r="50" fill="#3a8a4a"/><circle cx="70" cy="110" r="30" fill="#4aa05a"/><circle cx="130" cy="110" r="30" fill="#4aa05a"/>`,
        car:   `<rect x="20" y="100" width="160" height="50" rx="10" fill="#3a6ea5"/><path d="M50 100 L80 60 L120 60 L150 100 Z" fill="#5a8ec5"/><circle cx="60" cy="155" r="14" fill="#000"/><circle cx="140" cy="155" r="14" fill="#000"/>`,
        boat:  `<polygon points="40,120 160,120 140,160 60,160" fill="#a06a3a"/><rect x="95" y="40" width="6" height="80" fill="#333"/><polygon points="100,45 100,115 155,115" fill="#fff"/>`,
        star:  `<polygon points="100,20 120,80 185,80 130,120 150,180 100,145 50,180 70,120 15,80 80,80" fill="#f5c542"/>`,
      };
      stage.innerHTML = `<svg width="200" height="200" viewBox="0 0 200 200">${shapes[shape] || shapes.star}</svg>`;

      const opts = el(`<div class="options">${
        TASK.config.options.map((o) =>
          `<label><input type="radio" name="obj" value="${o}">${o}</label>`).join('')
      }</div>`);
      const btn = el(`<button class="btn primary">Submit</button>`);
      btn.onclick = () => {
        const p = opts.querySelector('input:checked');
        if (!p) return;
        submitTask(p.value, { expected: shape }, null, { shape });
      };
      controls.appendChild(opts);
      controls.appendChild(btn);
    },

    /* 11. Depth Perception — randomized closer side */
    depth() {
      clearStage(); clearControls();
      const closer = rng() < 0.5 ? 'Left' : 'Right';
      const lBehind = closer === 'Left';

      stage.innerHTML = `
        <div class="depth-visual">
          <div class="depth-circle" style="left:40px; background:${lBehind ? '#7eb8e0' : '#1e5a8a'};
               box-shadow:0 8px 20px rgba(0,0,0,${lBehind ? 0.15 : 0.4});"></div>
          <div class="depth-circle" style="right:40px; background:${lBehind ? '#1e5a8a' : '#7eb8e0'};
               box-shadow:0 8px 20px rgba(0,0,0,${lBehind ? 0.4 : 0.15});"></div>
        </div>`;

      const opts = el(`<div class="options two">${
        TASK.config.options.map((o) =>
          `<label><input type="radio" name="d" value="${o}">${o}</label>`).join('')
      }</div>`);
      const btn = el(`<button class="btn primary">Submit</button>`);
      btn.onclick = () => {
        const p = opts.querySelector('input:checked');
        if (!p) return;
        submitTask(p.value, { expected: closer }, null, { closer });
      };
      controls.appendChild(opts);
      controls.appendChild(btn);
    },

    /* 12. Text Tracking — unchanged (already randomized) */
    tracking() {
      clearStage(); clearControls();
      const words = ['vision','acuity','contrast','peripheral','macular','retina','optic','focus','retinal','glaucoma'];
      const target = words[Math.floor(rng() * words.length)];
      const seq = Array(9).fill(null).map(() => words[Math.floor(rng() * words.length)]);
      const targetIdx = 2 + Math.floor(rng() * 5);
      seq[targetIdx] = target;

      const display = el(
        `<div style="font-size:32px; font-weight:700; padding:20px; text-align:center;">Waiting...</div>`
      );
      stage.appendChild(display);

      let i = 0;
      const interval = setInterval(() => {
        display.textContent = seq[i];
        display.style.color = i === targetIdx ? '#00c9a7' : '';
        i++;
        if (i > targetIdx + 1) {
          clearInterval(interval);
          display.textContent = 'Done — type the highlighted word';
          display.style.fontSize = '18px';

          const input = el(`<input type="text" placeholder="Type the highlighted word" autofocus>`);
          const btn   = el(`<button class="btn primary">Submit</button>`);
          btn.onclick = () => submitTask(input.value.trim().toLowerCase(),
                                         { expected: target },
                                         null,
                                         { text: target });
          input.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
          controls.appendChild(input);
          controls.appendChild(btn);
        }
      }, 900);
    },

    /* 13. Sign Reading — randomized sign */
    sign() {
      clearStage(); clearControls();
      const text = pick(TASK.config.pool);
      stage.innerHTML = `<div class="sign-visual">${text}</div>`;

      const input = el(`<input type="text" placeholder="Type the text on the sign" autofocus>`);
      const btn   = el(`<button class="btn primary">Submit</button>`);
      btn.onclick = () => submitTask(input.value.trim(),
                                     { expected: text },
                                     null,
                                     { text });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
      controls.appendChild(input);
      controls.appendChild(btn);
    },

    /* 14. Medication Label — randomized drug and dosage */
    label() {
      clearStage(); clearControls();
      const item = pick(TASK.config.pool);

      stage.innerHTML = `
        <div class="label-visual">
          <div class="name">${item.drug}</div>
          <div class="dose">Each tablet contains ${item.dose} of active ingredient.</div>
          <div class="dose">Directions: ${item.directions}</div>
        </div>`;

      const input = el(`<input type="text" placeholder="What dosage is on the label?" autofocus>`);
      const btn   = el(`<button class="btn primary">Submit</button>`);
      btn.onclick = () => submitTask(input.value.trim(),
                                     { expected: item.dose },
                                     null,
                                     { dose: item.dose });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
      controls.appendChild(input);
      controls.appendChild(btn);
    },

    /* 15. Obstacle Detection — randomized presence */
    obstacle() {
      clearStage(); clearControls();
      const hasObs = rng() < 0.5;
      const obs = hasObs ? `<rect x="120" y="140" width="60" height="40" fill="#7a3a1a"/>` : '';

      stage.innerHTML = `
        <svg width="300" height="220" viewBox="0 0 300 220">
          <rect width="300" height="220" fill="#e8f0e8"/>
          <path d="M0 180 L300 180 L300 220 L0 220 Z" fill="#a0a0a0"/>
          <path d="M0 140 L300 140" stroke="#888" stroke-dasharray="8 6" stroke-width="2"/>
          ${obs}
          <circle cx="40" cy="170" r="12" fill="#333"/>
        </svg>`;

      const opts = el(`<div class="options two">${
        TASK.config.options.map((o) =>
          `<label><input type="radio" name="o" value="${o}">${o}</label>`).join('')
      }</div>`);
      const btn = el(`<button class="btn primary">Submit</button>`);
      btn.onclick = () => {
        const p = opts.querySelector('input:checked');
        if (!p) return;
        submitTask(p.value,
                   { expected: hasObs ? 'Yes' : 'No' },
                   null,
                   { has_obstacle: hasObs });
      };
      controls.appendChild(opts);
      controls.appendChild(btn);
    },

    /* 16. Scene Description — unchanged */
    scene() {
      clearStage(); clearControls();
      stage.innerHTML = `
        <svg width="320" height="220" viewBox="0 0 320 220">
          <rect width="320" height="140" fill="#a8d8f0"/>
          <rect y="140" width="320" height="80" fill="#6ab06a"/>
          <circle cx="260" cy="50" r="28" fill="#ffe066"/>
          <rect x="30" y="90" width="70" height="60" fill="#c0865b"/>
          <polygon points="20,90 65,55 110,90" fill="#a04a4a"/>
          <rect x="150" y="110" width="50" height="40" fill="#7a5a3a"/>
          <circle cx="175" cy="100" r="22" fill="#3a8a4a"/>
        </svg>`;

      const input = el(`<input type="text" placeholder="Describe what you see" autofocus>`);
      const btn   = el(`<button class="btn primary">Submit</button>`);
      btn.onclick = () => submitTask(input.value.trim(), { scene: 'house_tree_sun' });
      input.addEventListener('keydown', e => { if (e.key === 'Enter') btn.click(); });
      controls.appendChild(input);
      controls.appendChild(btn);
    },

    /* 17. Peripheral — auto-advance on tap */
    peripheral() {
      const cfg = TASK.config;
      let round = 0;
      const results = [];

      function next() {
        clearStage(); clearControls();
        setStageClass('dark');
        stage.appendChild(el(
          `<div style="position:absolute; font-size:36px; color:#00c9a7;">+</div>`
        ));

        const dir = rng() < 0.5 ? 'left' : 'right';
        const y   = 60 + rng() * (stage.clientHeight - 120);
        const x   = dir === 'left' ? 30 : stage.clientWidth - 60;
        const shape = el(
          `<div style="position:absolute; left:${x}px; top:${y}px; width:28px; height:28px;
                       background:#fff; opacity:0; transition:opacity .12s;"></div>`
        );
        stage.appendChild(shape);

        setTimeout(() => {
          shape.style.opacity = '1';
          setTimeout(() => { shape.style.opacity = '0'; }, 250);
        }, 500);

        const opts = choiceButtons(['LEFT', 'RIGHT'], (picked) => {
          const p = picked.toLowerCase();
          results.push({ side: dir, picked: p, correct: p === dir });
          round++;
          if (round >= cfg.rounds) {
            const hits = results.filter((r) => r.correct).length;
            submitTask(`${hits}/${cfg.rounds}`, { results });
          } else {
            setTimeout(next, 200);
          }
        });
        opts.classList.add('two');
        controls.appendChild(opts);
      }
      next();
    },

    /* 18. Daily Task — unchanged */
    daily() {
      clearStage(); clearControls();
      const bottles = [
        { name: 'Aspirin',     dose: '100 mg' },
        { name: 'Ibuprofen',   dose: '200 mg' },
        { name: 'Paracetamol', dose: '500 mg' },
        { name: 'Aspirin',     dose: '75 mg'  },
        { name: 'Aspirin',     dose: '100 mg' },
        { name: 'Amoxicillin', dose: '250 mg' },
      ].sort(() => rng() - 0.5);

      const wrap = el(
        `<div style="display:grid; grid-template-columns:repeat(3,1fr); gap:12px; padding:12px;"></div>`
      );
      bottles.forEach((b) => {
        const bEl = el(`
          <div class="bottle">
            <div class="label-name">${b.name}</div>
            <div>${b.dose}</div>
          </div>`);
        bEl.onclick = () => {
          const correct = b.name === 'Aspirin' && b.dose === '100 mg';
          bEl.classList.toggle('correct', correct);
          submitTask(
            correct ? 'Correct' : `Picked ${b.name} ${b.dose}`,
            { expected: 'Aspirin 100 mg', picked: b }
          );
        };
        wrap.appendChild(bEl);
      });
      stage.appendChild(wrap);
      controls.appendChild(el(
        `<div style="font-size:12px; color:var(--muted); text-align:center;">Tap the correct bottle to submit.</div>`
      ));
    },
  };

  const renderer = RENDERERS[TASK.type];
  if (renderer) {
    renderer();
  } else {
    const input = el(`<input type="text" placeholder="Your response" autofocus>`);
    const btn   = el(`<button class="btn primary">Submit</button>`);
    btn.onclick = () => submitTask(input.value);
    controls.appendChild(input);
    controls.appendChild(btn);
  }

  const skipBtn = el(`<button class="btn ghost" style="margin-top:10px;">Skip this task →</button>`);
  skipBtn.onclick = skipTask;
  controls.appendChild(skipBtn);
})();