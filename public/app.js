// ── global state ────────────────────────────────────────────────────────────
let rawData = { items: [], levelProgressions: [], jlptTotals: {}, currentLevel: 0 };
const charts = {};
let itemsPage = 1, sortCol = "level", sortDir = "asc";
const PAGE_SIZE = 100;

// ── MultiSelect component ────────────────────────────────────────────────────
class MultiSelect {
  constructor({ container, label, options, onChange }) {
    this.selected = new Set();
    this.options  = options; // [{value, label, count?}]
    this.onChange = onChange;
    this.label    = label;
    this.el       = this._build(container);
    this._wire();
  }

  _build(container) {
    const wrap = document.createElement("div");
    wrap.className  = "ms-wrap";
    wrap.dataset.open = "false";
    wrap.innerHTML = `
      <button class="ms-btn" type="button">
        <span class="ms-btn-label">${this.label}</span>
        <span class="ms-badge">All</span>
        <span class="ms-arrow">▾</span>
      </button>
      <div class="ms-panel">
        <div class="ms-actions">
          <button class="ms-action" data-a="all">All</button>
          <button class="ms-action" data-a="none">None</button>
        </div>
        <div class="ms-list">
          ${this.options.map((o) => `
            <label class="ms-item">
              <input type="checkbox" value="${o.value}">
              <span class="ms-item-label">${o.label}</span>
              ${o.count !== undefined ? `<span class="ms-item-count">${o.count}</span>` : ""}
            </label>`).join("")}
        </div>
      </div>`;
    container.appendChild(wrap);
    return wrap;
  }

  _wire() {
    this.el.querySelector(".ms-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      const opening = this.el.dataset.open !== "true";
      document.querySelectorAll(".ms-wrap[data-open='true']").forEach((w) => (w.dataset.open = "false"));
      this.el.dataset.open = opening ? "true" : "false";
    });

    this.el.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.addEventListener("change", () => {
        cb.checked ? this.selected.add(cb.value) : this.selected.delete(cb.value);
        this._badge();
        this.onChange(this.values());
      });
    });

    this.el.querySelectorAll("[data-a]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (btn.dataset.a === "all") {
          this.selected.clear();
          this.el.querySelectorAll("input").forEach((cb) => (cb.checked = false));
        } else {
          this.options.forEach((o) => this.selected.add(o.value));
          this.el.querySelectorAll("input").forEach((cb) => (cb.checked = true));
        }
        this._badge();
        this.onChange(this.values());
      });
    });
  }

  _badge() {
    const badge = this.el.querySelector(".ms-badge");
    const n = this.selected.size;
    badge.textContent = n === 0 ? "All" : `${n} selected`;
    badge.classList.toggle("has-filter", n > 0);
  }

  // null = no filter (show all); array = filter to these values
  values() {
    return this.selected.size === 0 ? null : [...this.selected];
  }

  // Pre-select specific values (call after construction)
  setValues(arr) {
    this.selected = new Set(arr);
    this.el.querySelectorAll("input[type=checkbox]").forEach((cb) => {
      cb.checked = this.selected.has(cb.value);
    });
    this._badge();
  }

  updateCounts(map) {
    this.el.querySelectorAll(".ms-item").forEach((item) => {
      const v = item.querySelector("input").value;
      const el = item.querySelector(".ms-item-count");
      if (el && map[v] !== undefined) el.textContent = map[v];
    });
  }
}

// close dropdowns on outside click
document.addEventListener("click", () => {
  document.querySelectorAll(".ms-wrap[data-open='true']").forEach((w) => (w.dataset.open = "false"));
});

// ── helpers ──────────────────────────────────────────────────────────────────
function countBy(arr, fn) {
  const out = {};
  for (const item of arr) { const k = fn(item); out[k] = (out[k] ?? 0) + 1; }
  return out;
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function srsGroup(stage) {
  if (stage < 0)   return "locked";
  if (stage <= 4)  return "apprentice";
  if (stage <= 6)  return "guru";
  if (stage === 7) return "master";
  if (stage === 8) return "enlightened";
  if (stage === 9) return "burned";
  return "locked";
}
function srsLabel(stage) {
  if (stage < 0)   return "Locked";
  if (stage === 0) return "Initiation";
  if (stage <= 4)  return `Apprentice ${stage}`;
  if (stage <= 6)  return `Guru ${stage - 4}`;
  if (stage === 7) return "Master";
  if (stage === 8) return "Enlightened";
  if (stage === 9) return "Burned";
  return "Locked";
}
const SRS_COLORS = {
  locked:      "#353535",
  apprentice:  "#EA9800",
  guru:        "#882D9E",
  master:      "#294DDB",
  enlightened: "#00AAFF",
  burned:      "#555555",
};
const SRS_ORDER = ["locked","apprentice","guru","master","enlightened","burned"];

function destroyChart(key) {
  if (charts[key]) { charts[key].destroy(); delete charts[key]; }
}

// Diagonal-hatch canvas pattern so "not taught by WK" bar segments read as
// "unavailable" rather than just another progress color in the SRS stack.
const hatchCache = {};
function makeHatchPattern(color) {
  if (hatchCache[color]) return hatchCache[color];
  const c = document.createElement("canvas");
  c.width = 8; c.height = 8;
  const ctx = c.getContext("2d");
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 8, 8);
  ctx.strokeStyle = "#7a80a0";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 8); ctx.lineTo(8, 0);
  ctx.moveTo(-2, 2); ctx.lineTo(2, -2);
  ctx.moveTo(6, 10); ctx.lineTo(10, 6);
  ctx.stroke();
  const pattern = ctx.createPattern(c, "repeat");
  hatchCache[color] = pattern;
  return pattern;
}

const BASE_SCALES = {
  x: { ticks: { color: "#7a80a0", font: { size: 11 } }, grid: { color: "#2d3146" } },
  y: { ticks: { color: "#7a80a0", font: { size: 11 } }, grid: { color: "#2d3146" } },
};
const BASE_LEGEND = { labels: { color: "#7a80a0", boxWidth: 12, font: { size: 11 } } };

const PALETTE = [
  "#e86228","#e8a228","#c8e828","#28e86e","#28c4e8",
  "#285de8","#a228e8","#e82882","#28e8c4","#8ae828",
  "#e85228","#60e828","#e82856",
];

// ── filter instances per tab ──────────────────────────────────────────────────
const ms = {}; // keyed as "tab-field"

function buildFilterOptions() {
  const items = rawData.items;
  const typeCounts  = countBy(items, (i) => i.type);
  const levelCounts = countBy(items, (i) => i.level);
  const jlptCounts  = countBy(items, (i) => i.jlpt ?? "none");
  const srsCounts   = countBy(items, (i) => srsGroup(i.srs_stage));

  return {
    type:  ["radical","kanji","vocabulary"].map((v) => ({ value: v, label: cap(v), count: typeCounts[v] ?? 0 })),
    level: [...new Set(items.map((i) => i.level))].sort((a,b)=>a-b).map((v) => ({ value: String(v), label: `Level ${v}`, count: levelCounts[v] ?? 0 })),
    jlpt:  ["N5","N4","N3","N2","N1"].map((v) => ({ value: v, label: v, count: jlptCounts[v] ?? 0 })).concat([{ value: "none", label: "Not listed", count: jlptCounts.none ?? 0 }]),
    srs:   SRS_ORDER.map((v) => ({ value: v, label: cap(v), count: srsCounts[v] ?? 0 })),
  };
}

function makeFilters(tabKey, container, fields, onChange) {
  const opts = buildFilterOptions();
  const labels = { type: "Type", level: "WK Level", jlpt: "JLPT", srs: "SRS Stage" };
  for (const f of fields) {
    ms[`${tabKey}-${f}`] = new MultiSelect({ container, label: labels[f], options: opts[f], onChange });
    // Default all tabs to kanji-only
    if (f === "type") ms[`${tabKey}-${f}`].setValues(["kanji"]);
  }
}

function getFiltered(tabKey) {
  return rawData.items.filter((item) => {
    const tv = ms[`${tabKey}-type`]?.values();
    const lv = ms[`${tabKey}-level`]?.values();
    const jv = ms[`${tabKey}-jlpt`]?.values();
    const sv = ms[`${tabKey}-srs`]?.values();

    if (tv && !tv.includes(item.type))              return false;
    if (lv && !lv.includes(String(item.level)))     return false;
    if (jv && !jv.includes(item.jlpt ?? "none"))    return false;
    if (sv && !sv.includes(srsGroup(item.srs_stage))) return false;

    if (tabKey === "items") {
      const q = document.getElementById("items-search").value.trim().toLowerCase();
      if (q) {
        const c = (item.characters ?? "").toLowerCase();
        const m = item.meanings.join(" ").toLowerCase();
        const r = item.readings.join(" ").toLowerCase();
        if (!c.includes(q) && !m.includes(q) && !r.includes(q)) return false;
      }
    }
    return true;
  });
}

// ── init ─────────────────────────────────────────────────────────────────────
async function init() {
  showLoading("Loading data…");
  try {
    const res = await fetch("/api/data");
    if (!res.ok) throw new Error(await res.text());
    rawData = await res.json();
  } catch (e) {
    document.getElementById("loadingMsg").textContent = "Error: " + e.message;
    return;
  }

  if (rawData.currentLevel) {
    const lvlBadge = document.createElement("span");
    lvlBadge.className = "wk-level-badge";
    lvlBadge.textContent = `WK Level ${rawData.currentLevel}`;
    document.querySelector(".header-inner h1").after(lvlBadge);
  }

  if (rawData.syncedAt) {
    const syncEl = document.createElement("span");
    syncEl.className = "sync-timestamp";
    const d = new Date(rawData.syncedAt);
    syncEl.title = `Data source: ${rawData.fromBlob ? "live sync" : "deploy snapshot"}`;
    syncEl.textContent = `Updated ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
    document.querySelector(".header-inner").appendChild(syncEl);
  }

  setupTabs();
  setupSettings();
  setupSyncNowButton();
  setupReviewsTab();
  setupAnalyticsTab();
  setupItemsTab();
  setupTextTab();
  hideLoading();
}

// ── SETTINGS (API key) ──────────────────────────────────────────────────────
const WK_API_KEY_STORAGE = "wk_api_key";

function setupSettings() {
  const btn      = document.getElementById("settings-btn");
  const modal    = document.getElementById("settings-modal");
  const closeBtn = document.getElementById("settings-close-btn");
  const input    = document.getElementById("wk-api-key-input");
  const showBox  = document.getElementById("wk-api-key-show");
  const saveBtn  = document.getElementById("settings-save-btn");
  const syncBtn  = document.getElementById("settings-sync-btn");
  const status   = document.getElementById("settings-status");

  const stored = localStorage.getItem(WK_API_KEY_STORAGE);
  if (stored) input.value = stored;

  const setStatus = (msg, kind) => {
    status.textContent = msg;
    status.className = "settings-status" + (kind ? ` ${kind}` : "");
  };

  const open = () => { modal.classList.remove("hidden"); setStatus("", null); };
  const close = () => modal.classList.add("hidden");

  btn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  modal.addEventListener("click", (e) => { if (e.target === modal) close(); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) close();
  });

  showBox.addEventListener("change", () => {
    input.type = showBox.checked ? "text" : "password";
  });

  saveBtn.addEventListener("click", () => {
    const key = input.value.trim();
    if (!key) { setStatus("Enter an API key first.", "err"); return; }
    localStorage.setItem(WK_API_KEY_STORAGE, key);
    setStatus("Saved to this browser.", "ok");
  });

  syncBtn.addEventListener("click", async () => {
    const key = input.value.trim();
    if (!key) { setStatus("Enter an API key first.", "err"); return; }
    localStorage.setItem(WK_API_KEY_STORAGE, key);

    syncBtn.disabled = true;
    saveBtn.disabled = true;
    const origText = syncBtn.textContent;
    syncBtn.textContent = "Syncing…";
    setStatus("Syncing with WaniKani…", null);

    try {
      const res = await fetch("/api/sync", { method: "POST", headers: { "X-Wk-Api-Key": key } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || res.statusText);
      setStatus(
        `Synced! ${body.assignments} assignments, ${body.reviewStats} review stats, ${body.levelProgressions} level progressions (${body.elapsed}). Reloading…`,
        "ok"
      );
      setTimeout(() => location.reload(), 1200);
    } catch (e) {
      setStatus("Error: " + e.message, "err");
      syncBtn.disabled = false;
      saveBtn.disabled = false;
      syncBtn.textContent = origText;
    }
  });
}

// One-click re-sync for when a key is already saved — no need to open the
// settings modal just to sync again.
function setupSyncNowButton() {
  const btn    = document.getElementById("sync-now-btn");
  const status = document.getElementById("sync-now-status");
  if (!btn) return;

  btn.addEventListener("click", async () => {
    const key = localStorage.getItem(WK_API_KEY_STORAGE);
    if (!key) { document.getElementById("settings-btn").click(); return; }

    btn.disabled = true;
    const origText = btn.innerHTML;
    btn.innerHTML = `<span class="settings-icon">↻</span> Syncing…`;
    status.textContent = "";
    status.className = "sync-now-status";

    try {
      const res = await fetch("/api/sync", { method: "POST", headers: { "X-Wk-Api-Key": key } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || res.statusText);
      status.textContent = "Synced! Reloading…";
      status.className = "sync-now-status ok";
      setTimeout(() => location.reload(), 900);
    } catch (e) {
      status.textContent = "Error: " + e.message;
      status.className = "sync-now-status err";
      btn.disabled = false;
      btn.innerHTML = origText;
    }
  });
}

function setupTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((s) => s.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(btn.dataset.tab + "-tab").classList.add("active");
      setTimeout(() => Object.values(charts).forEach((c) => c?.resize?.()), 50);
    });
  });
}

// ── REVIEWS TAB ──────────────────────────────────────────────────────────────
function setupReviewsTab() {
  const container = document.getElementById("reviews-filters");
  makeFilters("reviews", container, ["type", "level", "jlpt"], () => buildGuruChart());

  ["reviews-groupBy","reviews-levelGrouping","reviews-metric","reviews-showTrend"].forEach((id) => {
    document.getElementById(id).addEventListener("change", buildGuruChart);
  });

  buildGuruChart();
  buildLevelDurationChart();
  buildPaceEta();
}

// ── PACE / ETA ───────────────────────────────────────────────────────────────
// WaniKani's SRS review intervals are fixed (not user-configurable), so they set
// a hard floor on how fast anyone can level up: Apprentice1→Guru1 takes
// 4h+8h+1d+2d on levels 3+, halved on levels 1-2. Leveling also requires
// Guru-ing ~90% of the current level's kanji. See:
// https://knowledge.wanikani.com/wanikani/srs-stages/
// https://knowledge.wanikani.com/wanikani/getting-started/level-up/
const SRS_FLOOR_DAYS_STANDARD = (4 + 8 + 24 + 48) / 24;
const SRS_FLOOR_DAYS_FAST     = (2 + 4 + 8 + 24) / 24;
function levelFloorDays(level) {
  return level <= 2 ? SRS_FLOOR_DAYS_FAST : SRS_FLOOR_DAYS_STANDARD;
}
function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function buildPaceEta() {
  const el = document.getElementById("pace-banner");
  if (!el) return;

  const lps = rawData.levelProgressions ?? [];
  if (!lps.length) { el.innerHTML = `<span class="pace-note">Not enough level history yet to estimate pace.</span>`; return; }

  const completedDays = lps
    .filter((lp) => lp.started_at && lp.passed_at)
    .sort((a, b) => new Date(a.passed_at) - new Date(b.passed_at))
    .map((lp) => (new Date(lp.passed_at) - new Date(lp.started_at)) / 86400000);

  const RECENT_N = 8;
  const recent = completedDays.slice(-RECENT_N);
  const med = median(recent);

  const current = lps.find((lp) => lp.started_at && !lp.passed_at);
  const currentLevel = rawData.currentLevel || current?.level || lps.at(-1)?.level || 1;
  const floor = levelFloorDays(currentLevel);
  const pace = med !== null ? Math.max(med, floor) : floor;

  const stats = [];

  if (current) {
    const elapsed = (Date.now() - new Date(current.started_at)) / 86400000;
    const remaining = Math.max(0, pace - elapsed);
    stats.push({ val: remaining < 1 ? "<1" : `~${Math.round(remaining)}`, label: `days to Lv ${currentLevel + 1}` });
  }

  stats.push({ val: med !== null ? med.toFixed(1) : "—", label: med !== null ? `median days/level (last ${recent.length})` : "median days/level" });
  stats.push({ val: floor.toFixed(1), label: "fastest possible (SRS floor)" });

  const levelsLeft = 60 - currentLevel;
  if (levelsLeft > 0 && med !== null) {
    const eta = new Date(Date.now() + levelsLeft * pace * 86400000);
    stats.push({ val: eta.toLocaleDateString(undefined, { year: "numeric", month: "short" }), label: "Lv 60 at this pace" });
  }

  el.innerHTML = stats.map((s) => `<div class="pace-stat"><span class="pace-val">${s.val}</span><span class="pace-label">${s.label}</span></div>`).join("");
  el.title = "\"Fastest possible\" reflects WaniKani's fixed SRS review intervals and the ~90%-of-kanji-to-Guru leveling rule — nobody can level up faster than this, regardless of settings. \"Median\" is your own recent pace, which is what actually drives the ETA.";
}

function periodKey(dateStr, groupBy) {
  const d = new Date(dateStr);
  if (groupBy === "day") return d.toISOString().slice(0, 10);
  if (groupBy === "week") {
    const mon = new Date(d);
    mon.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return mon.toISOString().slice(0, 10);
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function movAvg(vals, w = 4) {
  return vals.map((_, i) => {
    const sl = vals.slice(Math.max(0, i - w + 1), i + 1);
    return Math.round(sl.reduce((a, b) => a + b, 0) / sl.length);
  });
}

function levelGroup(level, mode) {
  if (mode === "individual") return `Lv ${level}`;
  if (mode === "all")        return "All";
  const n = +mode, lo = Math.floor((level - 1) / n) * n + 1;
  return `Lv ${lo}–${lo + n - 1}`;
}
function lgSort(a, b) { return parseInt(a.replace(/\D/g, "")) - parseInt(b.replace(/\D/g, "")); }

function buildGuruChart() {
  const groupBy   = document.getElementById("reviews-groupBy").value;
  const lgMode    = document.getElementById("reviews-levelGrouping").value;
  const metric    = document.getElementById("reviews-metric").value;
  const showTrend = document.getElementById("reviews-showTrend").checked;

  const dateField = { guru: "passed_at", burned: "burned_at", unlocked: "unlocked_at" }[metric];
  const yLabel    = { guru: "Items → Guru", burned: "Items burned", unlocked: "Items unlocked" }[metric];

  let items = getFiltered("reviews").filter((i) => i[dateField]);

  const buckets = {}, groups = new Set();
  for (const item of items) {
    const p = periodKey(item[dateField], groupBy);
    const g = levelGroup(item.level, lgMode);
    groups.add(g);
    if (!buckets[p]) buckets[p] = {};
    buckets[p][g] = (buckets[p][g] ?? 0) + 1;
  }

  const periods = Object.keys(buckets).sort();
  const grps    = [...groups].sort(lgSort);
  const totals  = periods.map((p) => grps.reduce((s, g) => s + (buckets[p][g] ?? 0), 0));

  const datasets = grps.map((g, i) => ({
    label: g, stack: "s", type: "bar",
    data: periods.map((p) => buckets[p][g] ?? 0),
    backgroundColor: PALETTE[i % PALETTE.length] + "cc",
    borderColor:     PALETTE[i % PALETTE.length],
    borderWidth: 1,
  }));

  if (showTrend && totals.length) {
    datasets.push({
      label: "4-period trend", type: "line",
      data: movAvg(totals),
      borderColor: "#fff", borderWidth: 2.5,
      pointRadius: 0, tension: 0.35, fill: false, stack: null, order: -1,
    });
  }

  document.getElementById("reviews-count").textContent = `${items.length} events`;

  destroyChart("guru");
  charts.guru = new Chart(document.getElementById("guruChart").getContext("2d"), {
    type: "bar",
    data: { labels: periods, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index" },
      plugins: { legend: BASE_LEGEND, tooltip: { mode: "index" } },
      scales: {
        x: { ...BASE_SCALES.x, stacked: true, ticks: { ...BASE_SCALES.x.ticks, maxRotation: 45 } },
        y: { ...BASE_SCALES.y, stacked: true, title: { display: true, text: yLabel, color: "#7a80a0" } },
      },
    },
  });
}

function buildLevelDurationChart() {
  const lps = rawData.levelProgressions.sort((a, b) => a.level - b.level);
  if (!lps.length) return;

  const durFixed = lps.map((lp) => {
    if (!lp.started_at) return null;
    const end = lp.passed_at ? new Date(lp.passed_at) : new Date();
    return Math.round((end - new Date(lp.started_at)) / 86400000 * 10) / 10;
  });

  destroyChart("levelDuration");
  charts.levelDuration = new Chart(document.getElementById("levelDurationChart").getContext("2d"), {
    type: "bar",
    data: {
      labels: lps.map((lp) => `Lv ${lp.level}`),
      datasets: [{
        label: "Days",
        data: durFixed,
        backgroundColor: durFixed.map((d, i) =>
          !lps[i].passed_at ? "#2d3146" : d <= 7 ? "#28e86e88" : d <= 14 ? "#e8a22888" : "#e8282888"),
        borderColor: durFixed.map((d, i) =>
          !lps[i].passed_at ? "#4a5180" : d <= 7 ? "#28e86e" : d <= 14 ? "#e8a228" : "#e82828"),
        borderWidth: 1,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => `${ctx.raw ?? "—"} days${!lps[ctx.dataIndex].passed_at ? " (in progress)" : ""}` } },
      },
      scales: {
        x: { ...BASE_SCALES.x },
        y: { ...BASE_SCALES.y, title: { display: true, text: "Days", color: "#7a80a0" } },
      },
    },
  });
}

// ── ANALYTICS TAB ────────────────────────────────────────────────────────────
function setupAnalyticsTab() {
  const container = document.getElementById("analytics-filters");
  makeFilters("analytics", container, ["type", "level", "jlpt", "srs"], () => buildAnalyticsCharts());
  buildAnalyticsCharts();
  buildJlptGap(); // independent of the type/level/jlpt/srs filters above — always shows the full picture
  buildOverallStats(); // ditto — whole-collection totals, not JLPT-reference-relative
}

// ── WHOLE-COLLECTION STATS ───────────────────────────────────────────────────
// "Axis 1": plain % of everything WaniKani itself teaches, with no JLPT
// reference list involved at all — so words/kanji the reference list doesn't
// cover can't drag this number down. Always uses the unfiltered item set.
function buildOverallStats() {
  const summarize = (arr) => {
    const guruPlus = arr.filter((i) => i.srs_stage >= 5).length;
    const burned   = arr.filter((i) => i.srs_stage === 9).length;
    return { total: arr.length, guruPlus, burned, pct: arr.length ? Math.round(guruPlus / arr.length * 100) : 0 };
  };
  const k = summarize(rawData.items.filter((i) => i.type === "kanji"));
  const v = summarize(rawData.items.filter((i) => i.type === "vocabulary"));

  document.getElementById("overallStatsRow").innerHTML = `
    <div class="overall-stat">
      <span class="overall-stat-label">All WaniKani kanji <span class="overall-stat-hint" title="No JLPT reference list involved — every kanji WaniKani teaches, period. This is the only 100%-is-actually-100% number on this page.">(?)</span></span>
      <span class="overall-stat-val">${k.pct}%</span>
      <span class="overall-stat-sub">${k.guruPlus}/${k.total} Guru+ · ${k.burned} Burned</span>
    </div>
    <div class="overall-stat">
      <span class="overall-stat-label">All WaniKani vocab <span class="overall-stat-hint" title="No JLPT reference list involved — every vocab word WaniKani teaches, period. This is the only 100%-is-actually-100% number on this page.">(?)</span></span>
      <span class="overall-stat-val">${v.pct}%</span>
      <span class="overall-stat-sub">${v.guruPlus}/${v.total} Guru+ · ${v.burned} Burned</span>
    </div>
  `;
}

function buildAnalyticsCharts() {
  const items = getFiltered("analytics");
  document.getElementById("analytics-count").textContent = `${items.length} items`;
  buildJlptProficiency(items);
  buildVocabProficiency(items);
  buildSrsDonut(items);
  buildItemsByLevel(items);
  buildAccuracyByLevel(items);
  buildAccuracyByType(items);
}

// Renders the trailing "Other" card for items WK teaches that never matched
// any JLPT reference-list entry — so nothing learned is invisible, it just
// has no JLPT level to sort under. Uses the same WK-only-denominator % as
// buildOverallStats, since there's no reference-list total to divide by here.
function renderUntaggedCard(kind, untaggedItems) {
  const byStage  = Object.fromEntries(SRS_ORDER.map((sg) => [sg, untaggedItems.filter((i) => srsGroup(i.srs_stage) === sg).length]));
  const guruPlus = untaggedItems.filter((i) => i.srs_stage >= 5).length;
  const burned   = byStage.burned ?? 0;
  const total    = untaggedItems.length;
  const pct      = total ? Math.round(guruPlus / total * 100) : 0;
  const barColor = (p) => p >= 85 ? "#28e86e" : p >= 50 ? "#e8a228" : p >= 20 ? "#e86228" : "#e82828";
  const stageDetails = SRS_ORDER.filter((sg) => byStage[sg] > 0)
    .map((sg) => `<span class="prof-card-srs" style="color:${SRS_COLORS[sg]}">${cap(sg)} ${byStage[sg]}</span>`)
    .join("");
  return `
    <div class="prof-card prof-card--untagged">
      <div class="prof-card-top">
        <span class="prof-card-level badge prof-card-other" title="${kind} WaniKani teaches that aren't on the unofficial JLPT reference list at all — no JLPT level applies to them.">Other</span>
        <span class="prof-card-pct" style="color:${barColor(pct)}">${pct}%</span>
      </div>
      <div class="prof-card-bar-wrap">
        <div class="prof-card-bar-fill" style="width:${pct}%;background:${barColor(pct)}"></div>
      </div>
      <div class="prof-card-stats">
        <span class="prof-card-guru">${guruPlus}/${total} Guru+</span>
        <span>${burned} Burned</span>
        <div class="prof-card-detail">${stageDetails || '<span style="color:var(--muted);font-size:10px">No data</span>'}</div>
      </div>
      <div class="prof-card-coverage-row"><span class="prof-card-coverage">Not on any JLPT reference list — ${total} ${kind}, learned but untracked by level</span></div>
    </div>`;
}

function buildJlptProficiency(items) {
  const JLPT_LEVELS = ["N5", "N4", "N3", "N2", "N1"];
  const JLPT_COLORS = { N5: "#4caf50", N4: "#8bc34a", N3: "#ffc107", N2: "#ff9800", N1: "#f44336" };

  const stats = JLPT_LEVELS.map((lvl) => {
    const lvlItems  = items.filter((i) => i.jlpt === lvl);
    const total     = rawData.jlptTotals[lvl] ?? lvlItems.length; // full reference-list count
    const wkTeaches = rawData.items.filter((i) => i.type === "kanji" && i.jlpt === lvl).length;
    const byStage   = Object.fromEntries(SRS_ORDER.map((sg) => [sg, lvlItems.filter((i) => srsGroup(i.srs_stage) === sg).length]));
    const guruPlus  = lvlItems.filter((i) => i.srs_stage >= 5).length;
    const burned    = byStage.burned ?? 0;
    const pct       = total ? Math.round(guruPlus / total * 100) : 0;
    const pctOfWk   = wkTeaches ? Math.round(guruPlus / wkTeaches * 100) : 0;
    return { lvl, total, wkTeaches, byStage, guruPlus, burned, pct, pctOfWk };
  });

  // Proficiency estimate: highest level with ≥85% Guru+ of all kanji at that level
  let estimateText = "Beginner", estimateSub = "Keep studying!", estimateColor = "#7a80a0";
  for (let i = JLPT_LEVELS.length - 1; i >= 0; i--) {
    const s = stats[i];
    if (!s.total) continue;
    if (s.pct >= 85) {
      estimateText  = JLPT_LEVELS[i];
      estimateSub   = `${s.guruPlus}/${s.total} ${JLPT_LEVELS[i]} kanji at Guru+`;
      estimateColor = JLPT_COLORS[JLPT_LEVELS[i]];
      break;
    }
  }
  if (estimateText === "Beginner") {
    for (let i = 0; i < JLPT_LEVELS.length; i++) {
      const s = stats[i];
      if (s.pct > 0) {
        estimateText  = `~${JLPT_LEVELS[i]}`;
        estimateSub   = `working toward ${JLPT_LEVELS[i]} (${s.pct}% of all ${JLPT_LEVELS[i]} kanji at Guru+)`;
        estimateColor = JLPT_COLORS[JLPT_LEVELS[i]];
        break;
      }
    }
  }

  const estEl = document.getElementById("jlpt-estimate");
  estEl.textContent = estimateText;
  estEl.style.color = estimateColor;
  document.getElementById("jlpt-estimate-sub").textContent = estimateSub;
  setCefrBadge("jlpt-estimate-cefr", estimateText);

  // Summary cards
  const barColor = (pct) => pct >= 85 ? "#28e86e" : pct >= 50 ? "#e8a228" : pct >= 20 ? "#e86228" : "#e82828";

  document.getElementById("jlpt-cards").innerHTML = stats.map((s) => {
    const jc = `jlpt-${s.lvl}`;
    const stageDetails = SRS_ORDER.filter((sg) => s.byStage[sg] > 0)
      .map((sg) => `<span class="prof-card-srs" style="color:${SRS_COLORS[sg]}">${cap(sg)} ${s.byStage[sg]}</span>`)
      .join("");
    const gap = s.total - s.wkTeaches;
    const coverageNote = gap > 0
      ? `<span class="prof-card-coverage" title="${gap} kanji in the reference list are not taught by WaniKani — max achievable via WK is ${Math.round(s.wkTeaches/s.total*100)}%">WK covers ${s.wkTeaches}/${s.total} ⚠</span>
         <button class="gap-toggle" type="button" data-target="kanji-gap-${s.lvl}" data-kind="kanji" data-lvl="${s.lvl}" data-show-label="show missing (${gap})" data-hide-label="hide">show missing (${gap})</button>
         <div class="gap-list" id="kanji-gap-${s.lvl}"></div>`
      : `<span class="prof-card-coverage">WK covers all ${s.total}</span>`;
    const cefr = CEFR_REF[s.lvl];
    return `
      <div class="prof-card">
        <div class="prof-card-top">
          <span class="prof-card-level badge ${jc}">${s.lvl}</span>
          ${cefr ? `<span class="prof-card-cefr" title="${cefr.title}">${cefr.label}</span>` : ""}
          <span class="prof-card-pct" style="color:${barColor(s.pct)}">${s.pct}%</span>
        </div>
        <div class="prof-card-bar-wrap">
          <div class="prof-card-bar-fill" style="width:${s.pct}%;background:${barColor(s.pct)}"></div>
        </div>
        <div class="prof-card-stats">
          <span class="prof-card-guru">${s.guruPlus}/${s.total} Guru+</span>
          <span>${s.burned} Burned</span>
          ${s.wkTeaches ? `<span class="prof-card-pctwk" title="Of the ${s.wkTeaches} reference-list kanji WK actually teaches at ${s.lvl}, ${s.pctOfWk}% are Guru+ or higher — this ignores kanji WK doesn't teach, unlike the headline %.">${s.pctOfWk}% of WK-taught</span>` : ""}
          <div class="prof-card-detail">${stageDetails || '<span style="color:var(--muted);font-size:10px">No data</span>'}</div>
        </div>
        <div class="prof-card-coverage-row">${coverageNote}</div>
      </div>`;
  }).join("") + renderUntaggedCard("kanji", rawData.items.filter((i) => i.type === "kanji" && !i.jlpt));

  // Horizontal stacked bar chart — includes a "Not taught by WK" segment so
  // the reference-list ceiling is visible in the chart itself, not just in
  // the "show missing" toggle text.
  const datasets = [
    ...SRS_ORDER.map((sg) => ({
      label: cap(sg), stack: "s",
      data: stats.map((s) => s.byStage[sg] ?? 0),
      backgroundColor: SRS_COLORS[sg] + "dd",
      borderColor:     SRS_COLORS[sg],
      borderWidth: 1,
    })),
    {
      label: "Not taught by WK", stack: "s",
      data: stats.map((s) => Math.max(0, s.total - s.wkTeaches)),
      backgroundColor: makeHatchPattern("#3a3f55"),
      borderColor: "#5a5f78", borderWidth: 1,
    },
  ];

  destroyChart("jlptProf");
  charts.jlptProf = new Chart(document.getElementById("jlptProfChart").getContext("2d"), {
    type: "bar",
    data: { labels: JLPT_LEVELS, datasets },
    options: {
      indexAxis: "y",
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index" },
      plugins: {
        legend: BASE_LEGEND,
        tooltip: {
          mode: "index",
          callbacks: {
            afterBody: (ctxItems) => {
              const idx = ctxItems[0]?.dataIndex;
              if (idx === undefined) return [];
              const s = stats[idx];
              const coverageLine = s.wkTeaches < s.total
                ? `WK covers ${s.wkTeaches}/${s.total} (max ${Math.round(s.wkTeaches/s.total*100)}% via WK)`
                : `WK covers all ${s.total}`;
              return [``, `Guru+: ${s.guruPlus}/${s.total} (${s.pct}%)`, `Burned: ${s.burned}/${s.total}`, coverageLine];
            },
          },
        },
      },
      scales: {
        x: { ...BASE_SCALES.x, stacked: true, title: { display: true, text: "Kanji count", color: "#7a80a0" } },
        y: { ...BASE_SCALES.y, stacked: true, ticks: { color: "#e0e4f0", font: { size: 13, weight: "600" } } },
      },
    },
  });
}

function buildVocabProficiency(items) {
  // Uses an external JLPT vocabulary reference list (data/jlpt_vocab.json,
  // see data/SOURCES.md) so this metric has the same shape as the kanji one:
  // total = the full reference list for that level, not just what WK teaches.
  // Only words WK actually has as a subject AND that match the list exactly
  // (item.jlptExact) count toward wkTeaches/guruPlus — unmatched WK vocab is
  // excluded rather than guessed at (see the coverage note below).
  const vocab = rawData.items.filter((i) => i.type === "vocabulary" && i.jlptExact);
  const JLPT_LEVELS  = ["N5", "N4", "N3", "N2", "N1"];
  const JLPT_COLORS  = { N5: "#4caf50", N4: "#8bc34a", N3: "#ffc107", N2: "#ff9800", N1: "#f44336" };

  const stats = JLPT_LEVELS.map((lvl) => {
    const lvlItems  = vocab.filter((i) => i.jlptExact === lvl);
    const total     = rawData.vocabTotals?.[lvl] ?? lvlItems.length; // full reference-list count
    const wkTeaches = lvlItems.length; // of that list, how many WK has as a matching subject
    const byStage   = Object.fromEntries(SRS_ORDER.map((sg) => [sg, lvlItems.filter((i) => srsGroup(i.srs_stage) === sg).length]));
    const guruPlus  = lvlItems.filter((i) => i.srs_stage >= 5).length;
    const burned    = byStage.burned ?? 0;
    const pct       = total ? Math.round(guruPlus / total * 100) : 0;
    const pctOfWk   = wkTeaches ? Math.round(guruPlus / wkTeaches * 100) : 0;
    return { lvl, total, wkTeaches, byStage, guruPlus, burned, pct, pctOfWk };
  });

  let estimateText = "Beginner", estimateSub = "Keep studying!", estimateColor = "#7a80a0";
  for (let i = JLPT_LEVELS.length - 1; i >= 0; i--) {
    const s = stats[i];
    if (!s.total) continue;
    if (s.pct >= 85) {
      estimateText  = JLPT_LEVELS[i];
      estimateSub   = `${s.guruPlus}/${s.total} ${JLPT_LEVELS[i]} vocab at Guru+`;
      estimateColor = JLPT_COLORS[JLPT_LEVELS[i]];
      break;
    }
  }
  if (estimateText === "Beginner") {
    for (let i = 0; i < JLPT_LEVELS.length; i++) {
      const s = stats[i];
      if (s.pct > 0) {
        estimateText  = `~${JLPT_LEVELS[i]}`;
        estimateSub   = `working toward ${JLPT_LEVELS[i]} (${s.pct}% of ${JLPT_LEVELS[i]} vocab at Guru+)`;
        estimateColor = JLPT_COLORS[JLPT_LEVELS[i]];
        break;
      }
    }
  }

  document.getElementById("vocab-estimate").textContent  = estimateText;
  document.getElementById("vocab-estimate").style.color  = estimateColor;
  document.getElementById("vocab-estimate-sub").textContent = estimateSub;
  setCefrBadge("vocab-estimate-cefr", estimateText);

  const barColor = (pct) => pct >= 85 ? "#28e86e" : pct >= 50 ? "#e8a228" : pct >= 20 ? "#e86228" : "#e82828";

  document.getElementById("vocab-cards").innerHTML = stats.map((s) => {
    const jc = `jlpt-${s.lvl}`;
    const stageDetails = SRS_ORDER.filter((sg) => s.byStage[sg] > 0)
      .map((sg) => `<span class="prof-card-srs" style="color:${SRS_COLORS[sg]}">${cap(sg)} ${s.byStage[sg]}</span>`)
      .join("");
    const gap = s.total - s.wkTeaches;
    const coverageNote = gap > 0
      ? `<span class="prof-card-coverage" title="${gap} words on the reference list aren't taught by WaniKani (or didn't match exactly due to kana/kanji spelling differences) — max achievable via WK is ${Math.round(s.wkTeaches/s.total*100)}%">WK covers ${s.wkTeaches}/${s.total} ⚠</span>
         <button class="gap-toggle" type="button" data-target="vocab-gap-${s.lvl}" data-kind="vocab" data-lvl="${s.lvl}" data-show-label="show missing (${gap})" data-hide-label="hide">show missing (${gap})</button>
         <div class="gap-list" id="vocab-gap-${s.lvl}"></div>`
      : `<span class="prof-card-coverage">WK covers all ${s.total}</span>`;
    const cefr = CEFR_REF[s.lvl];
    return `
      <div class="prof-card">
        <div class="prof-card-top">
          <span class="prof-card-level badge ${jc}">${s.lvl}</span>
          ${cefr ? `<span class="prof-card-cefr" title="${cefr.title}">${cefr.label}</span>` : ""}
          <span class="prof-card-pct" style="color:${barColor(s.pct)}">${s.pct}%</span>
        </div>
        <div class="prof-card-bar-wrap">
          <div class="prof-card-bar-fill" style="width:${s.pct}%;background:${barColor(s.pct)}"></div>
        </div>
        <div class="prof-card-stats">
          <span class="prof-card-guru">${s.guruPlus}/${s.total} Guru+</span>
          <span>${s.burned} Burned</span>
          ${s.wkTeaches ? `<span class="prof-card-pctwk" title="Of the ${s.wkTeaches} reference-list words WK actually teaches (and matches exactly) at ${s.lvl}, ${s.pctOfWk}% are Guru+ or higher — this ignores words WK doesn't teach, unlike the headline %.">${s.pctOfWk}% of WK-taught</span>` : ""}
          <div class="prof-card-detail">${stageDetails || '<span style="color:var(--muted);font-size:10px">No data</span>'}</div>
        </div>
        <div class="prof-card-coverage-row">${coverageNote}</div>
      </div>`;
  }).join("") + renderUntaggedCard("vocab", rawData.items.filter((i) => i.type === "vocabulary" && !i.jlptExact));

  const datasets = [
    ...SRS_ORDER.map((sg) => ({
      label: cap(sg), stack: "s",
      data: stats.map((s) => s.byStage[sg] ?? 0),
      backgroundColor: SRS_COLORS[sg] + "dd",
      borderColor:     SRS_COLORS[sg],
      borderWidth: 1,
    })),
    {
      label: "Not taught by WK", stack: "s",
      data: stats.map((s) => Math.max(0, s.total - s.wkTeaches)),
      backgroundColor: makeHatchPattern("#3a3f55"),
      borderColor: "#5a5f78", borderWidth: 1,
    },
  ];

  destroyChart("vocabProf");
  charts.vocabProf = new Chart(document.getElementById("vocabProfChart").getContext("2d"), {
    type: "bar",
    data: { labels: JLPT_LEVELS, datasets },
    options: {
      indexAxis: "y",
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index" },
      plugins: {
        legend: BASE_LEGEND,
        tooltip: {
          mode: "index",
          callbacks: {
            afterBody: (ctxItems) => {
              const idx = ctxItems[0]?.dataIndex;
              if (idx === undefined) return [];
              const s = stats[idx];
              const coverageLine = s.wkTeaches < s.total
                ? `WK covers ${s.wkTeaches}/${s.total} (max ${Math.round(s.wkTeaches/s.total*100)}% via WK)`
                : `WK covers all ${s.total}`;
              return [``, `Guru+: ${s.guruPlus}/${s.total} (${s.pct}%)`, `Burned: ${s.burned}/${s.total}`, coverageLine];
            },
          },
        },
      },
      scales: {
        x: { ...BASE_SCALES.x, stacked: true, title: { display: true, text: "Vocabulary count", color: "#7a80a0" } },
        y: { ...BASE_SCALES.y, stacked: true, ticks: { color: "#e0e4f0", font: { size: 13, weight: "600" } } },
      },
    },
  });
}

// ── PATH TO JLPT (gap widget) ───────────────────────────────────────────────
// Official JLPT→CEFR reference mapping (reading/listening only, requires
// passing that JLPT level, score-dependent within N3/N2/N1):
// https://www.jlpt.jp/e/about/cefr_reference.html
const CEFR_REF = {
  N5: { label: "A1",     title: "JLPT's official reference: N5 passers scoring 80+ map to CEFR A1." },
  N4: { label: "A2",     title: "JLPT's official reference: N4 passers scoring 90+ map to CEFR A2." },
  N3: { label: "A2 / B1", title: "JLPT's official reference: N3 passers score 95–103 → A2, 104+ → B1." },
  N2: { label: "B1 / B2", title: "JLPT's official reference: N2 passers score 90–111 → B1, 112+ → B2." },
  N1: { label: "B2 / C1", title: "JLPT's official reference: N1 passers score 100–141 → B2, 142+ → C1. JLPT tops out at C1 (no C2)." },
};

function setCefrBadge(elId, levelText) {
  const el = document.getElementById(elId);
  if (!el) return;
  const cefr = CEFR_REF[levelText.replace(/^~/, "")];
  if (cefr) {
    el.textContent = `≈ CEFR ${cefr.label}`;
    el.title = cefr.title;
    el.style.display = "";
  } else {
    el.textContent = "";
    el.style.display = "none";
  }
}

// Lazily populate + toggle the "show missing" chip lists in the kanji/vocab
// proficiency cards (rendering thousands of chips upfront for N1 vocab isn't
// worth it if nobody clicks to see them).
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".gap-toggle");
  if (!btn) return;
  const list = document.getElementById(btn.dataset.target);
  if (!list) return;
  const showing = list.style.display === "flex";
  if (!showing && !list.dataset.rendered) {
    const source = btn.dataset.kind === "vocab" ? rawData.jlptGapVocab : rawData.jlptGapKanji;
    const arr = source?.[btn.dataset.lvl] ?? [];
    list.innerHTML = arr.map((c) => `<span class="gap-chip">${escHtml(c)}</span>`).join("");
    list.dataset.rendered = "1";
  }
  list.style.display = showing ? "none" : "flex";
  btn.textContent = showing ? btn.dataset.showLabel : btn.dataset.hideLabel;
});

function computeItemWeeklyRate(days = 90) {
  const cutoff = Date.now() - days * 86400000;
  const recentPasses = rawData.items.filter((i) => i.passed_at && new Date(i.passed_at).getTime() >= cutoff).length;
  return recentPasses / (days / 7);
}

function buildJlptGap() {
  const tbody = document.getElementById("jlptGapBody");
  if (!tbody) return;

  const JLPT_LEVELS = ["N5", "N4", "N3", "N2", "N1"];
  const weeklyRate = computeItemWeeklyRate();

  const kanjiAll = rawData.items.filter((i) => i.type === "kanji" && i.jlpt);
  const vocabAll = rawData.items.filter((i) => i.type === "vocabulary" && i.jlptExact);

  const bucket = (arr) => ({
    guru:       arr.filter((i) => i.srs_stage >= 5).length,
    locked:     arr.filter((i) => i.srs_stage === -1).length,
    inProgress: arr.filter((i) => i.srs_stage >= 0 && i.srs_stage <= 4).length,
  });

  const remainingCell = (total, wkTeaches, b) => {
    const remaining = total - b.guru;
    if (remaining <= 0) return { html: `<span style="color:#28e86e">All ${total} at Guru+ ✓</span>`, remainingWk: 0 };
    const notTaught = total - wkTeaches;
    const detail = [`${b.locked} locked`, `${b.inProgress} in progress`, notTaught > 0 ? `${notTaught} not taught by WK` : null]
      .filter(Boolean).join(" · ");
    return { html: `<strong>${remaining}</strong> left <span style="color:var(--muted);font-size:11px">(${detail})</span>`, remainingWk: b.locked + b.inProgress };
  };

  tbody.innerHTML = JLPT_LEVELS.map((lvl) => {
    const kanjiTotal = rawData.jlptTotals?.[lvl] ?? 0;
    const kanjiItems = kanjiAll.filter((i) => i.jlpt === lvl);
    const kanjiB = bucket(kanjiItems);
    const kanjiCell = remainingCell(kanjiTotal, kanjiItems.length, kanjiB);

    const vocabTotal = rawData.vocabTotals?.[lvl] ?? 0;
    const vocabItems = vocabAll.filter((i) => i.jlptExact === lvl);
    const vocabB = bucket(vocabItems);
    const vocabCell = remainingCell(vocabTotal, vocabItems.length, vocabB);

    const wkTeachableRemaining = kanjiCell.remainingWk + vocabCell.remainingWk;
    let etaText = "—";
    if (wkTeachableRemaining > 0) {
      etaText = weeklyRate > 0
        ? (wkTeachableRemaining / weeklyRate < 1 ? "<1 week" : `~${Math.round(wkTeachableRemaining / weeklyRate)} weeks`)
        : "not enough recent pace data";
    }

    const cefr = CEFR_REF[lvl];
    return `<tr>
      <td><span class="badge jlpt-${lvl}">${lvl}</span></td>
      <td><span title="${escHtml(cefr.title)}" style="cursor:help;text-decoration:underline dotted">${cefr.label}</span></td>
      <td>${kanjiCell.html}</td>
      <td>${vocabCell.html}</td>
      <td>${etaText}</td>
    </tr>`;
  }).join("");
}

function buildSrsDonut(items) {
  const counts = SRS_ORDER.map((g) => items.filter((i) => srsGroup(i.srs_stage) === g).length);

  destroyChart("srsDonut");
  charts.srsDonut = new Chart(document.getElementById("srsDonut").getContext("2d"), {
    type: "doughnut",
    data: {
      labels: SRS_ORDER.map(cap),
      datasets: [{
        data: counts,
        backgroundColor: SRS_ORDER.map((g) => SRS_COLORS[g]),
        borderColor: "#1a1d27", borderWidth: 3,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: "62%",
      plugins: {
        legend: { position: "right", labels: { color: "#7a80a0", boxWidth: 12, font: { size: 11 }, padding: 14 } },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.label}: ${ctx.raw}  (${items.length ? Math.round(ctx.raw / items.length * 100) : 0}%)`,
          },
        },
      },
    },
  });
}


function buildItemsByLevel(items) {
  const levels = [...new Set(items.map((i) => i.level))].sort((a, b) => a - b);
  const datasets = SRS_ORDER.map((sg) => ({
    label: cap(sg), stack: "s",
    data: levels.map((lv) => items.filter((i) => i.level === lv && srsGroup(i.srs_stage) === sg).length),
    backgroundColor: SRS_COLORS[sg] + "cc",
    borderColor:     SRS_COLORS[sg],
    borderWidth: 1,
  }));

  destroyChart("itemsByLevel");
  charts.itemsByLevel = new Chart(document.getElementById("itemsByLevel").getContext("2d"), {
    type: "bar",
    data: { labels: levels.map((l) => `Lv ${l}`), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index" },
      plugins: { legend: BASE_LEGEND, tooltip: { mode: "index" } },
      scales: {
        x: { ...BASE_SCALES.x, stacked: true, ticks: { ...BASE_SCALES.x.ticks, maxRotation: 0 } },
        y: { ...BASE_SCALES.y, stacked: true, title: { display: true, text: "Items", color: "#7a80a0" } },
      },
    },
  });
}

function buildAccuracyByLevel(items) {
  // Only items with at least one review
  const reviewed = items.filter((i) => (i.meaning_correct + i.meaning_incorrect + i.reading_correct + i.reading_incorrect) > 0);
  const byLevel = {};
  for (const item of reviewed) {
    if (!byLevel[item.level]) byLevel[item.level] = { mc: 0, mi: 0, rc: 0, ri: 0 };
    byLevel[item.level].mc += item.meaning_correct;
    byLevel[item.level].mi += item.meaning_incorrect;
    byLevel[item.level].rc += item.reading_correct;
    byLevel[item.level].ri += item.reading_incorrect;
  }

  const levels = Object.keys(byLevel).map(Number).sort((a, b) => a - b);
  const mAcc = levels.map((l) => { const d = byLevel[l]; const t = d.mc + d.mi; return t ? Math.round(d.mc / t * 100) : null; });
  const rAcc = levels.map((l) => { const d = byLevel[l]; const t = d.rc + d.ri; return t ? Math.round(d.rc / t * 100) : null; });

  destroyChart("accuracyByLevel");
  charts.accuracyByLevel = new Chart(document.getElementById("accuracyByLevel").getContext("2d"), {
    type: "line",
    data: {
      labels: levels.map((l) => `Lv ${l}`),
      datasets: [
        { label: "Meaning %", data: mAcc, borderColor: "#28c4e8", backgroundColor: "#28c4e822", fill: true, tension: 0.35, pointRadius: 3, spanGaps: true },
        { label: "Reading %", data: rAcc, borderColor: "#e8a228", backgroundColor: "#e8a22822", fill: true, tension: 0.35, pointRadius: 3, spanGaps: true },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: BASE_LEGEND },
      scales: {
        x: { ...BASE_SCALES.x, ticks: { ...BASE_SCALES.x.ticks, maxRotation: 45 } },
        y: { ...BASE_SCALES.y, min: 50, max: 100, title: { display: true, text: "Accuracy %", color: "#7a80a0" }, ticks: { ...BASE_SCALES.y.ticks, callback: (v) => v + "%" } },
      },
    },
  });
}

function buildAccuracyByType(items) {
  const types = ["radical","kanji","vocabulary"];
  const stats = {};
  for (const t of types) {
    const ti = items.filter((i) => i.type === t);
    const mc = ti.reduce((s, i) => s + i.meaning_correct, 0);
    const mi = ti.reduce((s, i) => s + i.meaning_incorrect, 0);
    const rc = ti.reduce((s, i) => s + i.reading_correct, 0);
    const ri = ti.reduce((s, i) => s + i.reading_incorrect, 0);
    stats[t] = {
      mAcc: mc + mi ? Math.round(mc / (mc + mi) * 100) : 0,
      rAcc: rc + ri ? Math.round(rc / (rc + ri) * 100) : 0,
      mTotal: mc + mi, rTotal: rc + ri,
    };
  }

  destroyChart("accuracyByType");
  charts.accuracyByType = new Chart(document.getElementById("accuracyByType").getContext("2d"), {
    type: "bar",
    data: {
      labels: types.map(cap),
      datasets: [
        { label: "Meaning %", data: types.map((t) => stats[t].mAcc), backgroundColor: "#28c4e8aa", borderColor: "#28c4e8", borderWidth: 1 },
        { label: "Reading %", data: types.map((t) => stats[t].rAcc), backgroundColor: "#e8a228aa", borderColor: "#e8a228", borderWidth: 1 },
      ],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: BASE_LEGEND,
        tooltip: {
          callbacks: {
            afterLabel: (ctx) => {
              const t = types[ctx.dataIndex];
              const k = ctx.datasetIndex === 0 ? "mTotal" : "rTotal";
              return `  ${stats[t][k].toLocaleString()} total reviews`;
            },
          },
        },
      },
      scales: {
        x: { ...BASE_SCALES.x, ticks: { color: "#7a80a0", font: { size: 12 } } },
        y: { ...BASE_SCALES.y, min: 0, max: 100, title: { display: true, text: "Accuracy %", color: "#7a80a0" }, ticks: { ...BASE_SCALES.y.ticks, callback: (v) => v + "%" } },
      },
    },
  });
}

// ── ITEMS TAB ────────────────────────────────────────────────────────────────
function setupItemsTab() {
  const container = document.getElementById("items-filters");
  makeFilters("items", container, ["type", "level", "jlpt", "srs"], () => { itemsPage = 1; applyItemsFilters(); });

  document.getElementById("items-search").addEventListener("input", () => { itemsPage = 1; applyItemsFilters(); });

  document.querySelectorAll("th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      sortDir = sortCol === th.dataset.col ? (sortDir === "asc" ? "desc" : "asc") : "asc";
      sortCol = th.dataset.col;
      document.querySelectorAll("th.sortable").forEach((h) => h.classList.remove("sort-asc","sort-desc"));
      th.classList.add(sortDir === "asc" ? "sort-asc" : "sort-desc");
      itemsPage = 1; applyItemsFilters();
    });
  });

  applyItemsFilters();
}

function applyItemsFilters() {
  const items = getFiltered("items");
  document.getElementById("items-count").textContent = `${items.length} items`;
  renderTable(items);
}

function itemSortKey(item) {
  if (sortCol === "characters") return item.characters ?? "";
  if (sortCol === "type")       return item.type;
  if (sortCol === "level")      return item.level;
  if (sortCol === "jlpt")       return { N5:1, N4:2, N3:3, N2:4, N1:5 }[item.jlpt] ?? 99;
  if (sortCol === "srs_stage")  return item.srs_stage;
  if (sortCol === "accuracy")   return item.pct_correct ?? -1;
  return "";
}

function renderTable(items) {
  const sorted = [...items].sort((a, b) => {
    const ka = itemSortKey(a), kb = itemSortKey(b);
    if (ka < kb) return sortDir === "asc" ? -1 : 1;
    if (ka > kb) return sortDir === "asc" ? 1 : -1;
    return 0;
  });

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  if (itemsPage > totalPages) itemsPage = totalPages;
  const slice = sorted.slice((itemsPage - 1) * PAGE_SIZE, itemsPage * PAGE_SIZE);

  document.getElementById("itemsBody").innerHTML = slice.map((item) => {
    const jc  = item.jlpt ? `jlpt-${item.jlpt}` : "jlpt-none";
    const sg  = srsGroup(item.srs_stage);
    const acc = item.pct_correct !== null ? `${item.pct_correct}%` : "—";
    return `<tr>
      <td><span class="char">${item.characters ?? "—"}</span></td>
      <td><span class="badge type-${item.type}">${item.type.slice(0,3).toUpperCase()}</span></td>
      <td>${item.level}</td>
      <td><span class="badge ${jc}">${item.jlpt ?? "—"}</span></td>
      <td>${item.meanings.slice(0, 3).join(", ")}</td>
      <td>${item.readings.slice(0, 3).join("、")}</td>
      <td class="srs-${sg}">${srsLabel(item.srs_stage)}</td>
      <td>${acc}</td>
    </tr>`;
  }).join("");

  renderPagination(totalPages);
}

function renderPagination(total) {
  const el = document.getElementById("pagination");
  if (total <= 1) { el.innerHTML = ""; return; }

  const pages = [];
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || Math.abs(i - itemsPage) <= 2) pages.push(i);
    else if (pages.at(-1) !== "…") pages.push("…");
  }

  el.innerHTML = pages.map((p) =>
    p === "…"
      ? `<span class="page-btn" style="cursor:default">…</span>`
      : `<button class="page-btn ${p === itemsPage ? "active" : ""}" data-p="${p}">${p}</button>`
  ).join("");

  el.querySelectorAll("[data-p]").forEach((btn) => {
    btn.addEventListener("click", () => {
      itemsPage = +btn.dataset.p;
      renderTable(getFiltered("items"));
      document.querySelector(".table-wrap")?.scrollIntoView({ behavior: "smooth" });
    });
  });
}

// ── TEXT TAB ─────────────────────────────────────────────────────────────────
function setupTextTab() {
  const btn      = document.getElementById("text-analyze-btn");
  const textarea = document.getElementById("text-input");
  const tooltip  = document.getElementById("text-tooltip");
  const annotated = document.getElementById("text-annotated");

  btn.addEventListener("click", () => {
    const text = textarea.value;
    if (text.trim()) runTextAnalysis(text);
  });

  textarea.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      const text = textarea.value;
      if (text.trim()) runTextAnalysis(text);
    }
  });

  // Single delegated tooltip for the annotated container
  const idMap = () => new Map(rawData.items.map((i) => [i.id, i]));
  let _idMap = null;

  annotated.addEventListener("mouseover", (e) => {
    const span = e.target.closest(".wk-token[data-id]");
    if (!span) { tooltip.style.display = "none"; return; }
    if (!_idMap) _idMap = idMap();
    const item = _idMap.get(+span.dataset.id);
    if (!item) return;
    const sg = srsGroup(item.srs_stage);
    const via = span.dataset.via;
    tooltip.innerHTML = `
      <div class="tt-char">${item.characters}</div>
      ${via ? `<div style="font-size:10px;color:var(--muted);margin-bottom:4px">matched via ${escHtml(via)}</div>` : ""}
      <div class="tt-row">
        <strong>WK Level ${item.level}</strong>
        <span class="badge type-${item.type}">${item.type.slice(0,3).toUpperCase()}</span>
        ${item.jlpt ? `<span class="badge jlpt-${item.jlpt}">${item.jlpt}</span>` : ""}
      </div>
      <div class="tt-row">SRS: <strong style="color:${SRS_COLORS[sg]}">${srsLabel(item.srs_stage)}</strong></div>
      <div class="tt-meanings">${item.meanings.slice(0, 4).join(", ")}</div>
      ${item.readings.length ? `<div class="tt-readings">${item.readings.slice(0, 3).join("、")}</div>` : ""}
    `;
    tooltip.style.display = "block";
  });

  annotated.addEventListener("mousemove", (e) => {
    const span = e.target.closest(".wk-token[data-id]");
    if (!span) { tooltip.style.display = "none"; return; }
    const r = tooltip.getBoundingClientRect();
    const x = e.clientX + 16;
    const y = e.clientY + 16;
    tooltip.style.left = (x + r.width > window.innerWidth ? e.clientX - r.width - 8 : x) + "px";
    tooltip.style.top  = (y + r.height > window.innerHeight ? e.clientY - r.height - 8 : y) + "px";
  });

  annotated.addEventListener("mouseleave", () => { tooltip.style.display = "none"; });
}

function isKanjiChar(ch) {
  const c = ch.codePointAt(0);
  return (c >= 0x4E00 && c <= 0x9FFF)  ||
         (c >= 0x3400 && c <= 0x4DBF)  ||
         (c >= 0x20000 && c <= 0x2A6DF);
}
function isKanaChar(ch) {
  const c = ch.charCodeAt(0);
  return (c >= 0x3040 && c <= 0x309F) || // hiragana
         (c >= 0x30A0 && c <= 0x30FF) || // katakana
         (c >= 0xFF65 && c <= 0xFF9F);   // half-width katakana
}
function isLatinChar(ch) {
  const c = ch.charCodeAt(0);
  return (c >= 0x41 && c <= 0x5A) || (c >= 0x61 && c <= 0x7A) || // A-Z a-z
         (c >= 0xC0 && c <= 0x024F);                              // Latin extended
}

function escHtml(s) {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function buildTextLookup() {
  const vocabMap = new Map();
  const kanjiMap = new Map();
  for (const item of rawData.items) {
    if (!item.characters) continue;
    if (item.type === "vocabulary") {
      // Prefer lower-level (earlier-taught) item on collision
      if (!vocabMap.has(item.characters) || item.level < vocabMap.get(item.characters).level)
        vocabMap.set(item.characters, item);
    } else if (item.type === "kanji") {
      kanjiMap.set(item.characters, item);
    }
  }
  return { vocabMap, kanjiMap };
}

function processKuromojiTokens(kuroTokens, vocabMap, kanjiMap) {
  const tokens = [];
  for (const tok of kuroTokens) {
    const { surface, basic, reading, pos, pos_detail } = tok;
    if (!surface) continue;

    // WK vocab: try surface form, then dictionary form (handles conjugations)
    const basicNorm = basic && basic !== "*" && basic !== surface ? basic : null;
    const wkVocab = vocabMap.get(surface) || (basicNorm ? vocabMap.get(basicNorm) : null);
    if (wkVocab) {
      tokens.push({ chars: surface, item: wkVocab, matchType: "vocab",
                    via: wkVocab.characters !== surface ? wkVocab.characters : null, reading, pos });
      continue;
    }

    // Single kanji
    const chs = [...surface];
    if (chs.length === 1 && isKanjiChar(chs[0])) {
      const wkKanji = kanjiMap.get(surface);
      tokens.push({ chars: surface, item: wkKanji ?? null,
                    matchType: wkKanji ? "kanji" : "unknown-kanji", reading, pos });
      continue;
    }

    // Symbols / punctuation / whitespace / numbers
    if (pos === "記号" || pos === "補助記号" || pos === "BOS/EOS" ||
        /^[\s\d]+$/.test(surface)) {
      tokens.push({ chars: surface, item: null, matchType: "other", pos });
      continue;
    }

    // Latin/English
    if (chs.every((c) => isLatinChar(c) || c === "'" || c === "-")) {
      tokens.push({ chars: surface, item: null, matchType: "latin", reading, pos });
      continue;
    }

    // Distinguish unknown Japanese: kanji-containing vs pure kana (grammar/particles)
    const hasKanji = [...surface].some((c) => isKanjiChar(c));
    tokens.push({ chars: surface, item: null,
                  matchType: hasKanji ? "unknown-word" : "grammar",
                  reading, pos, pos_detail });
  }
  return tokens;
}

async function runTextAnalysis(text) {
  const btn = document.getElementById("text-analyze-btn");
  btn.disabled = true;
  btn.textContent = "Analyzing…";
  try {
    const res = await fetch("/api/tokenize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      alert("Tokenizer error: " + err.error);
      return;
    }
    const { tokens: kuroTokens } = await res.json();
    const { vocabMap, kanjiMap } = buildTextLookup();
    const tokens = processKuromojiTokens(kuroTokens, vocabMap, kanjiMap);
    document.getElementById("text-results").style.display = "block";
    renderAnnotatedText(tokens);
    renderTextBreakdown(tokens);
    renderTextItemList(tokens);
    document.getElementById("text-results").scrollIntoView({ behavior: "smooth", block: "start" });
  } finally {
    btn.disabled = false;
    btn.textContent = "Analyze";
  }
}

function renderAnnotatedText(tokens) {
  let html = "";
  for (const tok of tokens) {
    if (tok.matchType === "other") {
      html += escHtml(tok.chars).replace(/\r?\n/g, "<br>");
      continue;
    }
    if (tok.matchType === "unknown-kanji" || tok.matchType === "unknown-word") {
      const title = tok.pos ? `${tok.pos}${tok.pos_detail ? " — " + tok.pos_detail : ""} (not in WaniKani)` : "Not in WaniKani";
      html += `<span class="wk-token-unknown" title="${escHtml(title)}">${escHtml(tok.chars)}</span>`;
      continue;
    }
    if (tok.matchType === "grammar") {
      const title = tok.pos ? `${tok.pos}${tok.pos_detail ? " — " + tok.pos_detail : ""}` : "Grammar/Kana";
      html += `<span class="wk-token-grammar" title="${escHtml(title)}">${escHtml(tok.chars)}</span>`;
      continue;
    }
    if (tok.matchType === "latin") {
      html += `<span class="wk-token-latin">${escHtml(tok.chars)}<span class="wk-lv wk-lv--en">EN</span></span>`;
      continue;
    }
    // vocab or kanji
    const item = tok.item;
    const sg   = srsGroup(item.srs_stage);
    const viaAttr = tok.via ? ` data-via="${escHtml(tok.via)}"` : "";
    html += `<span class="wk-token" data-srs="${sg}" data-id="${item.id}"${viaAttr}>${escHtml(tok.chars)}<span class="wk-lv">${item.level}</span></span>`;
  }
  document.getElementById("text-annotated").innerHTML = html;
}

function renderTextBreakdown(tokens) {
  const seen        = new Map();  // WK item id → item
  const unknownJP   = new Set();  // kanji/vocab not in WK
  const grammarKana = new Set();  // pure kana grammar/particles not in WK
  const latinWords  = new Set();  // unique Latin words
  for (const tok of tokens) {
    if (tok.item && !seen.has(tok.item.id)) seen.set(tok.item.id, tok.item);
    else if (tok.matchType === "unknown-kanji" || tok.matchType === "unknown-word") unknownJP.add(tok.chars);
    else if (tok.matchType === "grammar") grammarKana.add(tok.chars);
    else if (tok.matchType === "latin") latinWords.add(tok.chars.toLowerCase());
  }

  const items      = [...seen.values()];
  const guruPlus   = items.filter((i) => i.srs_stage >= 5).length;
  const apprentice = items.filter((i) => i.srs_stage >= 0 && i.srs_stage <= 4).length;
  const locked     = items.filter((i) => i.srs_stage === -1).length;
  const unknown    = unknownJP.size;
  const grammar    = grammarKana.size;
  const english    = latinWords.size;
  const total      = guruPlus + apprentice + locked + unknown + grammar + english;

  const slices = [
    { label: "Guru+ (Known)",      value: guruPlus,   color: "#28e86e" },
    { label: "Apprentice",         value: apprentice, color: "#EA9800" },
    { label: "Locked (In WK)",    value: locked,     color: "#555"    },
    { label: "Unknown Kanji/Vocab",value: unknown,    color: "#c0392b" },
    { label: "Grammar / Kana",     value: grammar,    color: "#7b8ab8" },
    { label: "English",            value: english,    color: "#4a90e2" },
  ];

  destroyChart("textKnowledge");
  if (total > 0) {
    charts.textKnowledge = new Chart(document.getElementById("textKnowledgeChart").getContext("2d"), {
      type: "doughnut",
      data: {
        labels: slices.map((s) => s.label),
        datasets: [{
          data: slices.map((s) => s.value),
          backgroundColor: slices.map((s) => s.color),
          borderColor: "#1a1d27", borderWidth: 3,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: "62%",
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.label}: ${ctx.raw} (${Math.round(ctx.raw / total * 100)}%)`,
            },
          },
        },
      },
    });
  }

  document.getElementById("text-stats-summary").innerHTML =
    slices.map((s) => {
      const pct = total ? Math.round(s.value / total * 100) : 0;
      return `
        <div class="text-stat-row">
          <span class="text-stat-dot" style="background:${s.color}"></span>
          <span class="text-stat-name">${s.label}</span>
          <span class="text-stat-val" style="color:${s.color}">${s.value}</span>
          <span class="text-stat-pct">${pct}%</span>
        </div>`;
    }).join("") +
    `<div class="text-stat-total">Total unique: <strong>${total}</strong></div>`;
}

function renderTextItemList(tokens) {
  const seen       = new Map(); // id → { item, via }
  const notInWK    = new Map(); // chars → { chars, reading, pos }
  const latinWords = new Map(); // lowercase → original casing

  for (const tok of tokens) {
    if (tok.item && !seen.has(tok.item.id))
      seen.set(tok.item.id, { item: tok.item, via: tok.via ?? null });
    else if (tok.matchType === "unknown-kanji" || tok.matchType === "unknown-word" || tok.matchType === "grammar") {
      if (!notInWK.has(tok.chars))
        notInWK.set(tok.chars, { chars: tok.chars, reading: tok.reading, pos: tok.pos, pos_detail: tok.pos_detail, isGrammar: tok.matchType === "grammar" });
    } else if (tok.matchType === "latin") {
      const key = tok.chars.toLowerCase();
      if (!latinWords.has(key)) latinWords.set(key, tok.chars);
    }
  }

  const wkEntries = [...seen.values()].sort((a, b) =>
    b.item.level - a.item.level || a.item.srs_stage - b.item.srs_stage);
  const total = wkEntries.length + notInWK.size + latinWords.size;
  document.getElementById("text-items-count").textContent = `${total} unique`;

  const rows = wkEntries.map(({ item, via }) => {
    const sg = srsGroup(item.srs_stage);
    const jc = item.jlpt ? `jlpt-${item.jlpt}` : "jlpt-none";
    const charCell = via
      ? `<span class="char">${escHtml(item.characters)}</span><span class="text-via-form"> via ${escHtml(via)}</span>`
      : `<span class="char">${escHtml(item.characters)}</span>`;
    return `<tr>
      <td>${charCell}</td>
      <td><span class="badge type-${item.type}">${item.type.slice(0,3).toUpperCase()}</span></td>
      <td>${item.level}</td>
      <td><span class="badge ${jc}">${item.jlpt ?? "—"}</span></td>
      <td class="srs-${sg}">${srsLabel(item.srs_stage)}</td>
      <td>${item.meanings.slice(0, 3).join(", ")}</td>
      <td>${item.readings.slice(0, 3).join("、")}</td>
    </tr>`;
  });

  const posLabel = (pos, det) => {
    const map = { 助詞:"particle", 助動詞:"aux.verb", 名詞:"noun", 動詞:"verb",
                  形容詞:"adjective", 副詞:"adverb", 接続詞:"conjunction", 感動詞:"interjection",
                  接頭詞:"prefix", 接尾辞:"suffix" };
    return map[pos] ?? pos ?? "?";
  };

  for (const { chars, reading, pos, pos_detail, isGrammar } of [...notInWK.values()].sort((a, b) => a.chars.localeCompare(b.chars))) {
    const readingKana = reading && reading !== "*" ? reading : "";
    const stageCell   = isGrammar
      ? `<td style="color:#7b8ab8">Grammar / Kana</td>`
      : `<td style="color:#c0392b">Unknown Kanji/Vocab</td>`;
    rows.push(`<tr>
      <td><span class="char">${escHtml(chars)}</span></td>
      <td><span class="badge" style="background:var(--border);color:var(--muted)">${escHtml(posLabel(pos, pos_detail))}</span></td>
      <td style="color:var(--muted)">—</td>
      <td><span class="badge jlpt-none">—</span></td>
      ${stageCell}
      <td style="color:var(--muted)">—</td>
      <td>${readingKana}</td>
    </tr>`);
  }

  for (const word of [...latinWords.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))) {
    rows.push(`<tr>
      <td><span style="font-size:16px">${escHtml(word)}</span></td>
      <td><span class="badge" style="background:#1a2a3a;color:#4a90e2;border:1px solid #4a90e2">EN</span></td>
      <td style="color:var(--muted)">—</td>
      <td style="color:var(--muted)">—</td>
      <td style="color:#4a90e2">English</td>
      <td style="color:var(--muted)">—</td>
      <td></td>
    </tr>`);
  }

  document.getElementById("textItemsBody").innerHTML = rows.join("");
}

// ── loading ───────────────────────────────────────────────────────────────────
function showLoading(msg) {
  document.getElementById("loadingMsg").textContent = msg;
  document.getElementById("loading").classList.remove("hidden");
}
function hideLoading() {
  document.getElementById("loading").classList.add("hidden");
}

init();
