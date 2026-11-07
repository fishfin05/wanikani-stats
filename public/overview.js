// Overview tab: study time, progress per direction, where you're headed and
// the kanji grid. Deliberately shows NO accuracy numbers (user's request).
// Pure helpers are exported so they can be tested in Node.

export const SRS_GROUPS = ["apprentice", "guru", "master", "enlightened", "burned"];
const GROUP_LABEL = { apprentice: "Apprentice", guru: "Guru", master: "Master", enlightened: "Enlightened", burned: "Burned" };
const VOCAB_TYPES = new Set(["vocabulary", "kana_vocabulary"]);
const UNLOCK_STAGE = 5; // Custom Study opens a word once it reaches Guru in WaniKani
const JLPT_LEVELS = ["N5", "N4", "N3", "N2", "N1"];
const BLUE = "#2563eb";

export function groupOf(stage) {
  if (stage >= 9) return "burned";
  if (stage === 8) return "enlightened";
  if (stage === 7) return "master";
  if (stage >= 5) return "guru";
  if (stage >= 1) return "apprentice";
  return null;
}

// ── dates as plain YYYY-MM-DD strings (time-zone safe) ──
export function dayKey(date = new Date(), timeZone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}
export function addDays(key, n) {
  const d = new Date(Date.parse(key + "T00:00:00Z") + n * 86400000);
  return d.toISOString().slice(0, 10);
}
function weekStart(key) {
  const dow = (new Date(key + "T00:00:00Z").getUTCDay() + 6) % 7; // Monday = 0
  return addDays(key, -dow);
}

export function formatMinutes(min) {
  const m = Math.round(min);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
}

export function studyTiles(days, today) {
  const min = (k) => (days[k]?.seconds ?? 0) / 60;
  let week = 0, month = 0, studyDays = 0;
  for (let i = 0; i < 30; i++) {
    const m = min(addDays(today, -i));
    if (i < 7) week += m;
    month += m;
    if (m > 0) studyDays++;
  }
  const total = Object.values(days).reduce((s, d) => s + d.seconds / 60, 0);
  return { today: min(today), week, avgPerStudyDay: studyDays ? month / studyDays : 0, studyDays30: studyDays, total };
}

// Bars = minutes per period; line = running total (hours) of ALL time so far.
export function timeSeries(days, groupBy, today) {
  const keys = Object.keys(days).sort();
  const bucketOf = groupBy === "week" ? weekStart : groupBy === "month" ? (k) => k.slice(0, 7) : (k) => k;
  const buckets = [];
  if (groupBy === "day") for (let i = 29; i >= 0; i--) buckets.push(addDays(today, -i));
  else if (groupBy === "week") for (let i = 15; i >= 0; i--) buckets.push(weekStart(addDays(today, -7 * i)));
  else {
    const first = (keys[0] ?? today).slice(0, 7);
    let [y, m] = today.slice(0, 7).split("-").map(Number);
    const out = [];
    for (let i = 0; i < 120; i++) {
      const k = `${y}-${String(m).padStart(2, "0")}`;
      out.unshift(k);
      if (k <= first && out.length >= 6) break;
      if (--m === 0) { m = 12; y--; }
    }
    buckets.push(...out);
  }
  const minutes = new Map(buckets.map((b) => [b, 0]));
  let before = 0;
  for (const k of keys) {
    const b = bucketOf(k), m = days[k].seconds / 60;
    if (minutes.has(b)) minutes.set(b, minutes.get(b) + m);
    else if (b < buckets[0]) before += m;
  }
  let running = before;
  const cumulativeHours = buckets.map((b) => { running += minutes.get(b); return running / 60; });
  return { buckets, minutes: buckets.map((b) => minutes.get(b)), cumulativeHours };
}

// One row per study direction, each with its own honest denominator.
export function directionRows(items, summary) {
  const count = (stages) => {
    const groups = Object.fromEntries(SRS_GROUPS.map((g) => [g, 0]));
    for (const s of stages) { const g = groupOf(s); if (g) groups[g]++; }
    return groups;
  };
  const nativeStages = items.map((i) => i.srs_stage).filter((s) => s >= 1);
  const rows = [{
    id: "jp_to_en", label: "Japanese → English", note: "your WaniKani reviews",
    learned: nativeStages.length, available: items.length, groups: count(nativeStages),
    caption: `${nativeStages.length.toLocaleString()} of ${items.length.toLocaleString()} WaniKani items started`,
  }];
  const opened = items.filter((i) => VOCAB_TYPES.has(i.type) && i.srs_stage >= UNLOCK_STAGE);
  const openedIds = new Set(opened.map((i) => i.id));
  for (const id of ["en_to_jp", "audio_to_en"]) {
    const dir = summary?.directions?.[id];
    if (!dir) continue;
    const cards = dir.cards ?? [];
    const learnedOpened = cards.filter(([sid]) => openedIds.has(sid)).length;
    const behind = Math.max(0, opened.length - learnedOpened);
    rows.push({
      id, label: dir.label ?? id, note: "Custom Study",
      learned: cards.length, available: Math.max(opened.length, cards.length), groups: count(cards.map(([, s]) => s)),
      caption: behind
        ? `${cards.length.toLocaleString()} learned · ${behind.toLocaleString()} words to catch up with WaniKani`
        : `${cards.length.toLocaleString()} learned · caught up with WaniKani`,
    });
  }
  return rows;
}

export function jlptCoverage(items, totals = {}) {
  return JLPT_LEVELS.map((lvl) => {
    const known = items.filter((i) => i.type === "kanji" && i.jlpt === lvl && i.srs_stage >= 5).length;
    const total = totals[lvl] ?? 0;
    return { level: lvl, known, total, pct: total ? Math.round((known / total) * 100) : 0 };
  });
}

// ── rendering ──
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (d, opts = { month: "short", day: "numeric" }) => d.toLocaleDateString(undefined, opts);

export function setupOverview(ctx) {
  const { rawData, charts, SRS_COLORS, srsLabel, apiKey } = ctx;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const today = dayKey(new Date(), timeZone);
  const state = { summary: null, groupBy: "day", kanjiBy: "level" };

  document.getElementById("ov-eyebrow").textContent = rawData.currentLevel ? `WaniKani · Level ${rawData.currentLevel}` : "WaniKani";
  renderHeaded();
  renderKanjiGrid();
  renderDirections();
  renderLegend();

  segmented("ov-time-group", (v) => { state.groupBy = v; renderTimeChart(); });
  segmented("ov-kanji-group", (v) => { state.kanjiBy = v; renderKanjiGrid(); });

  loadSummary();

  async function loadSummary() {
    const key = apiKey();
    if (!key) return showTimeMessage("Add your WaniKani API key (API Key button, top right) to load study time from Custom Study's cloud backup.");
    showTimeMessage("Loading study time…");
    try {
      const res = await fetch(`/api/study-summary?tz=${encodeURIComponent(timeZone)}`, { headers: { "X-Wk-Api-Key": key } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      state.summary = body;
    } catch (e) {
      return showTimeMessage(`Couldn't load study time: ${e.message}`);
    }
    if (!state.summary.answerCount) showTimeMessage("No Custom Study answers saved in the cloud yet. Study time appears here after your first session.");
    else showTimeMessage("");
    renderTiles();
    renderTimeChart();
    renderDirections();
  }

  function showTimeMessage(text) {
    const el = document.getElementById("ov-time-msg");
    el.textContent = text;
    el.hidden = !text;
    document.getElementById("ov-time-chart").hidden = Boolean(text) && !state.summary?.answerCount;
  }

  function renderTiles() {
    const t = studyTiles(state.summary?.days ?? {}, today);
    const tiles = [
      ["Today", formatMinutes(t.today)],
      ["Last 7 days", formatMinutes(t.week)],
      ["Avg per study day", formatMinutes(t.avgPerStudyDay), `${t.studyDays30} study days in the last 30`],
      ["All time", formatMinutes(t.total), state.summary?.firstAnswerAt ? `since ${fmtDate(new Date(state.summary.firstAnswerAt), { month: "short", day: "numeric", year: "numeric" })}` : ""],
    ];
    document.getElementById("ov-tiles").innerHTML = tiles.map(([label, val, sub]) =>
      `<div class="ov-tile"><div class="ov-tile-label">${label}</div><div class="ov-tile-val">${val}</div>${sub ? `<div class="ov-tile-sub">${esc(sub)}</div>` : ""}</div>`).join("");
  }

  function renderTimeChart() {
    if (!state.summary?.answerCount) return;
    const s = timeSeries(state.summary.days, state.groupBy, today);
    const label = (b) => state.groupBy === "month"
      ? fmtDate(new Date(b + "-01T00:00:00Z"), { month: "short", year: "2-digit", timeZone: "UTC" })
      : fmtDate(new Date(b + "T00:00:00Z"), { month: "short", day: "numeric", timeZone: "UTC" });
    if (charts.ovTime) charts.ovTime.destroy();
    const tick = { color: "#a3a3a3", font: { size: 11 } };
    charts.ovTime = new Chart(document.getElementById("ovTimeChart"), {
      data: {
        labels: s.buckets.map(label),
        datasets: [
          { type: "bar", label: "Minutes", data: s.minutes.map((m) => Math.round(m)), backgroundColor: BLUE, borderRadius: 3, yAxisID: "y", order: 2 },
          { type: "line", label: "Running total (hours)", data: s.cumulativeHours.map((h) => +h.toFixed(2)), borderColor: "#e5e5e5", borderWidth: 2, borderDash: [5, 3], pointRadius: 0, tension: 0, yAxisID: "y2", order: 1 },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (c) => c.datasetIndex === 0 ? ` ${formatMinutes(c.raw)}` : ` ${c.raw.toFixed(1)}h total` } },
        },
        scales: {
          x: { ticks: { ...tick, maxRotation: 0, autoSkipPadding: 12 }, grid: { display: false }, border: { display: false } },
          y: { beginAtZero: true, ticks: { ...tick, callback: (v) => `${v}m` }, grid: { color: "rgba(255,255,255,0.06)" }, border: { display: false } },
          y2: { position: "right", beginAtZero: true, ticks: { ...tick, callback: (v) => `${v}h` }, grid: { display: false }, border: { display: false } },
        },
      },
    });
  }

  function renderDirections() {
    const rows = directionRows(rawData.items, state.summary);
    const html = rows.map((r) => {
      const segs = SRS_GROUPS.map((g) => r.groups[g] && r.available
        ? `<span style="width:${(r.groups[g] / r.available) * 100}%;background:${SRS_COLORS[g]}" title="${GROUP_LABEL[g]}: ${r.groups[g].toLocaleString()}"></span>` : "").join("");
      return `<div class="ov-dir">
        <div class="ov-dir-head"><span class="ov-dir-name">${esc(r.label)} <span class="ov-dir-note">${esc(r.note)}</span></span><span class="ov-dir-count">${r.learned.toLocaleString()}</span></div>
        <div class="ov-bar">${segs}</div>
        <div class="ov-dir-caption">${esc(r.caption)}</div>
      </div>`;
    }).join("");
    const pending = state.summary ? "" : `<p class="ov-desc">Custom Study directions appear once study time has loaded.</p>`;
    document.getElementById("ov-directions").innerHTML = html + pending;
  }

  function renderLegend() {
    document.getElementById("ov-srs-legend").innerHTML = SRS_GROUPS.map((g) =>
      `<span><i style="background:${SRS_COLORS[g]}"></i>${GROUP_LABEL[g]}</span>`).join("");
  }

  function renderHeaded() {
    const { lps, current, currentLevel } = ctx.getCurrentLevelInfo();
    const pace = ctx.getPace();
    const stats = [];
    if (current && currentLevel < 60) {
      const simulated = ctx.simulateCurrentLevelUpDate(currentLevel, 180 * 86400000);
      const date = simulated && simulated > Date.now() ? simulated
        : pace ? new Date(Math.max(Date.now(), Date.parse(current.started_at) + pace * 86400000)) : null;
      if (date) stats.push([`Level ${currentLevel + 1}`, fmtDate(date), simulated ? "if you keep up with reviews" : "at your usual pace"]);
    }
    if (pace && currentLevel < 60) {
      const eta = new Date(Date.now() + (60 - currentLevel) * pace * 86400000);
      stats.push(["Level 60", fmtDate(eta, { month: "short", year: "numeric" }), `at ${pace.toFixed(1)} days per level`]);
    }
    const done = lps.filter((lp) => lp.started_at && lp.passed_at)
      .sort((a, b) => Date.parse(a.passed_at) - Date.parse(b.passed_at))
      .map((lp) => (Date.parse(lp.passed_at) - Date.parse(lp.started_at)) / 86400000);
    if (done.length >= 8) {
      const recent = ctx.median(done.slice(-4)), earlier = ctx.median(done.slice(-8, -4));
      const diff = recent - earlier;
      const word = Math.abs(diff) < 0.5 ? "Steady" : diff < 0 ? "Speeding up" : "Slowing down";
      stats.push(["Pace", word, `${recent.toFixed(1)} days per level lately, ${earlier.toFixed(1)} before`]);
    }
    document.getElementById("ov-headed").innerHTML = stats.length
      ? stats.map(([label, val, sub]) => `<div class="ov-tile"><div class="ov-tile-label">${label}</div><div class="ov-tile-val">${esc(val)}</div><div class="ov-tile-sub">${esc(sub)}</div></div>`).join("")
      : `<p class="ov-desc">Not enough level history yet for a forecast.</p>`;

    document.getElementById("ov-jlpt").innerHTML = jlptCoverage(rawData.items, rawData.jlptTotals).map((c) =>
      `<div class="ov-ring-item" title="${c.known} of ${c.total} ${c.level} kanji at Guru or higher">
        <div class="ov-ring" style="--pct:${c.pct}"><span>${c.pct}%</span></div>
        <div class="ov-ring-label">${c.level}</div><div class="ov-ring-sub">${c.known}/${c.total}</div>
      </div>`).join("");
  }

  function renderKanjiGrid() {
    const kanji = rawData.items.filter((i) => i.type === "kanji");
    const groups = new Map();
    if (state.kanjiBy === "jlpt") {
      for (const lvl of [...JLPT_LEVELS, "Other"]) groups.set(lvl, []);
      for (const k of kanji) groups.get(k.jlpt && groups.has(k.jlpt) ? k.jlpt : "Other").push(k);
    } else {
      for (const k of [...kanji].sort((a, b) => a.level - b.level)) {
        if (!groups.has(k.level)) groups.set(k.level, []);
        groups.get(k.level).push(k);
      }
    }
    const known = kanji.filter((k) => k.srs_stage >= 5).length;
    document.getElementById("ov-kanji-note").textContent =
      `${known.toLocaleString()} of ${kanji.length.toLocaleString()} WaniKani kanji at Guru or higher. Hover a tile for its meaning.`;
    document.getElementById("ov-kanji").innerHTML = [...groups].filter(([, list]) => list.length).map(([name, list]) => `
      <div class="ov-kgroup"><div class="ov-kgroup-label">${typeof name === "number" ? `Lv ${name}` : name}</div>
      <div class="ov-ktiles">${list.map((k) => {
        const g = groupOf(k.srs_stage);
        const meaning = (k.meanings ?? []).map((m) => m?.meaning ?? m)[0] ?? "";
        return `<span class="ov-k${g ? "" : " locked"}"${g ? ` style="background:${SRS_COLORS[g]}"` : ""} title="${esc(`${k.characters} · ${meaning} · ${srsLabel(k.srs_stage)}`)}">${esc(k.characters)}</span>`;
      }).join("")}</div></div>`).join("");
  }

  function segmented(id, onChange) {
    const el = document.getElementById(id);
    el.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-value]");
      if (!btn) return;
      el.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
      onChange(btn.dataset.value);
    });
  }
}
