(() => {
  "use strict";

  const DATA = window.WORLD_DATA;
  const TERRAIN = window.WORLD_TERRAIN;
  // Terrain lives in its own file (hand-drawn); map data is generated from meowDB.
  DATA.islands = TERRAIN.islands;
  DATA.biomes = TERRAIN.biomes;
  DATA.rivers = TERRAIN.rivers;
  DATA.meta.width = TERRAIN.width;
  DATA.meta.height = TERRAIN.height;
  // Scenery (trees, rocks, clouds) was sized for an older, smaller world; DS scales it up.
  const DS = (TERRAIN.scale || 6) / 3.75;
  const canvas = document.getElementById("map");
  const ctx = canvas.getContext("2d");

  // ---------------------------------------------------------------------------
  // Difficulty colors, based on monster level minus player level.
  // Tune the thresholds in diffBands.
  // ---------------------------------------------------------------------------
  const DIFF = {
    red:    { color: "#e2483b", label: "Too hard",      desc: "Well above you: slow and dangerous" },
    orange: { color: "#f28c28", label: "Hard",          desc: "Around your level or a bit above" },
    yellow: { color: "#f3d23a", label: "Good farming",  desc: "Below you, still good exp" },
    green:  { color: "#4cbf4a", label: "Easy",          desc: "Fast kills, less exp" },
    grey:   { color: "#9b9b9b", label: "Trivial",       desc: "Too low to be worth it" },
  };
  const ORDER = ["red", "orange", "yellow", "green", "grey"];

  // Lowest level gap (monster level minus yours) for each color at player level L.
  // Anchors: at 29, green/blue mushrooms (14-19) are easy, Ant Tunnel (22-27) is good
  // farming, 28-30 is hard and 31+ too hard. Below 10, snails and shrooms are farming
  // while slimes, pigs and orange mushrooms (6-8) are hard. "More than 10 below is
  // trivial" starts at 20 and the gap widens a little as you level.
  function diffBands(L) {
    return {
      red: L < 10 ? 4 : L < 20 ? 3 : 2,
      orange: L < 20 ? 0 : -1,
      yellow: -(5 + Math.floor(L / 10)),
      green: L < 20 ? -10 : -Math.min(15, 10 + Math.floor((L - 19) / 2)),
    };
  }

  function diffFor(mobLv, L) {
    const d = mobLv - L, b = diffBands(L);
    if (d >= b.red) return "red";
    if (d >= b.orange) return "orange";
    if (d >= b.yellow) return "yellow";
    if (d >= b.green) return "green";
    return "grey";
  }

  // Level boundaries for each color at player level L (for the legend).
  function diffRanges(L) {
    const b = diffBands(L);
    const span = (lo, hi) => (hi < 1 || lo > hi ? "—" : lo === hi ? `${hi}` : `${Math.max(1, lo)}–${hi}`);
    return {
      red: `${L + b.red}+`,
      orange: span(L + b.orange, L + b.red - 1),
      yellow: span(L + b.yellow, L + b.orange - 1),
      green: span(L + b.green, L + b.yellow - 1),
      grey: L + b.green - 1 >= 1 ? `≤ ${L + b.green - 1}` : "—",
    };
  }

  // ---------------------------------------------------------------------------
  // Data indexes
  // ---------------------------------------------------------------------------
  const maps = DATA.maps;
  const byId = new Map(maps.map((m) => [m.id, m]));
  const mobs = DATA.mobs;

  // A map's "mobs" entries are either a monster id, or { id, count } where count is spawn points.
  function mobList(m) {
    return (m.mobs || []).map((entry) => {
      const id = typeof entry === "string" ? entry : entry.id;
      const count = typeof entry === "string" ? null : entry.count ?? null;
      const mob = mobs[id];
      if (!mob) console.warn(`Map "${m.id}" lists unknown monster "${id}"`);
      return mob ? { id, count, ...mob } : { id, count, name: id, level: 0 };
    });
  }

  // Share of a map's spawns that sets its color: the map takes the level that this
  // share of spawns is at or above. An average lets a crowd of snails hide the stumps
  // and orange mushrooms you will keep running into.
  const HARD_SHARE = 1 / 3;

  // Average and `typical` (see HARD_SHARE) are weighted by spawn count when known.
  function levelRange(m) {
    const list = mobList(m).filter((x) => x.level > 0);
    if (!list.length) return null;
    const lv = list.map((x) => x.level);
    const w = list.map((x) => x.count ?? 1);
    const total = w.reduce((a, b) => a + b, 0);
    const byLevel = list.map((x, i) => [x.level, w[i]]).sort((a, b) => b[0] - a[0]);
    let seen = 0, typical = byLevel[byLevel.length - 1][0];
    for (const [l, c] of byLevel) { seen += c; if (seen >= total * HARD_SHARE - 1e-9) { typical = l; break; } }
    return {
      min: Math.min(...lv),
      max: Math.max(...lv),
      avg: list.reduce((a, x, i) => a + x.level * w[i], 0) / total,
      typical,
    };
  }

  // Bosses are ignored for a map's color unless the map has nothing else.
  function farmRange(m) {
    const list = mobList(m);
    const normal = list.filter((x) => !x.boss);
    return levelRange({ mobs: (normal.length ? normal : list).map((x) => ({ id: x.id, count: x.count })) });
  }

  function mapDiff(m) {
    const r = farmRange(m);
    return r ? diffFor(r.typical, state.level) : null;
  }

  // Undirected edges built from each map's "links".
  const edges = [];
  const neighbors = new Map(maps.map((m) => [m.id, []]));
  {
    const seen = new Set();
    for (const m of maps) {
      for (const to of m.links || []) {
        if (!byId.has(to)) { console.warn(`Map "${m.id}" links to unknown map "${to}"`); continue; }
        const key = [m.id, to].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);
        const a = m, b = byId.get(to);
        edges.push({ a, b, key, kind: "walk" });
        neighbors.get(a.id).push({ map: b });
        neighbors.get(b.id).push({ map: a });
      }
    }
    for (const r of DATA.routes || []) {
      const a = byId.get(r.from), b = byId.get(r.to);
      if (!a || !b) { console.warn("Bad route", r); continue; }
      edges.push({ a, b, key: `${r.from}|${r.to}|route`, kind: r.kind || "boat", via: r.via, label: r.label });
      neighbors.get(a.id).push({ map: b, via: r.label });
      neighbors.get(b.id).push({ map: a, via: r.label });
    }
  }

  // Buildings (shops, halls, saunas...) are dead ends: each links to one map, its host
  // (a town, Henesys Market, Sleepywood Hotel...). They're not drawn on the map; the host's
  // panel lists them and opens each as a sub-pane.
  const hostOf = new Map();       // building -> host map
  const buildingsOf = new Map();  // host map -> [buildings]
  for (const m of maps) {
    if (m.type !== "building") continue;
    const host = (neighbors.get(m.id) || []).map((n) => n.map).find((n) => n.type !== "building");
    if (!host) continue;
    hostOf.set(m, host);
    if (!buildingsOf.has(host)) buildingsOf.set(host, []);
    buildingsOf.get(host).push(m);
  }
  for (const list of buildingsOf.values()) list.sort((a, b) => a.name.localeCompare(b.name));

  // Main roads: for every pair of towns on the island, the shortest walk between them
  // (fewest maps, then shortest distance). A map's score is how many of those walks pass
  // through it; 0 means it's on a side path. Smart labels name high scores first.
  const routeScore = new Map();
  let maxRouteScore = 1;
  {
    const onIsland = (m) => !m.section && m.type !== "building";
    const adj = new Map(maps.filter(onIsland).map((m) => [m, []]));
    for (const e of edges) {
      if (e.kind !== "walk" || !adj.has(e.a) || !adj.has(e.b)) continue;
      const w = 1 + Math.hypot(e.a.x - e.b.x, e.a.y - e.b.y) / 2000;
      adj.get(e.a).push([e.b, w]);
      adj.get(e.b).push([e.a, w]);
    }
    const towns = [...adj.keys()].filter((m) => m.type === "town");
    for (let i = 0; i < towns.length; i++) {
      // Dijkstra from towns[i] (small graph, so a linear scan for the next node is fine).
      const dist = new Map([[towns[i], 0]]), prev = new Map(), done = new Set();
      for (;;) {
        let u = null;
        for (const [m, d] of dist) if (!done.has(m) && (u === null || d < dist.get(u))) u = m;
        if (!u) break;
        done.add(u);
        for (const [v, w] of adj.get(u)) {
          const nd = dist.get(u) + w;
          if (!dist.has(v) || nd < dist.get(v)) { dist.set(v, nd); prev.set(v, u); }
        }
      }
      for (let j = i + 1; j < towns.length; j++) {
        if (!prev.has(towns[j])) continue;
        for (let m = prev.get(towns[j]); m && m !== towns[i]; m = prev.get(m)) {
          routeScore.set(m.id, (routeScore.get(m.id) || 0) + 1);
        }
      }
    }
    for (const s of routeScore.values()) maxRouteScore = Math.max(maxRouteScore, s);
  }

  // Numbered series ("East Rocky Mountain I".."VII", "Line 1 Area 1".."3"): linked runs of
  // maps sharing a base name. When zoomed out, Smart labels name the run once along its
  // length instead of labelling each map.
  const series = [];
  {
    const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10 };
    const byBase = new Map();
    for (const m of maps) {
      const mm = m.name.match(/^(.+?)\s+(I|II|III|IV|V|VI|VII|VIII|IX|X|\d+)$/);
      if (!mm) continue;
      if (!byBase.has(mm[1])) byBase.set(mm[1], []);
      byBase.get(mm[1]).push({ m, n: ROMAN[mm[2]] || +mm[2] });
    }
    for (const [base, list] of byBase) {
      const plain = maps.find((m) => m.name === base); // "Pig Park" with "Pig Park II"
      if (plain) list.push({ m: plain, n: 1 });
      const inSet = new Set(list.map((x) => x.m));
      const seen = new Set();
      for (const { m } of list) { // split into linked runs
        if (seen.has(m)) continue;
        const comp = [], stack = [m];
        seen.add(m);
        while (stack.length) {
          const u = stack.pop();
          comp.push(u);
          for (const { map: v } of neighbors.get(u.id)) if (inSet.has(v) && !seen.has(v)) { seen.add(v); stack.push(v); }
        }
        if (comp.length >= 2) series.push({ base, members: comp, key: `${base}|${comp[0].id}` });
      }
    }

    // Hand-picked areas whose maps don't share a numbered name, or single big maps that
    // deserve an area name of their own. They take their maps out of any automatic series
    // (which is dropped if fewer than 2 maps are left).
    const AREA_GROUPS = [
      { name: "Golem Temple", maps: ["the_entrance_of_golem_s_temple", "the_breathing_rock",
        "golem_s_temple_i", "golem_s_temple_ii", "golem_s_temple_iii", "golem_s_temple_iv"] },
      { name: "3-Way Road-Split", maps: ["3_way_road_split"] },
    ];
    for (const g of AREA_GROUPS) {
      const members = g.maps.map((id) => byId.get(id)).filter(Boolean);
      if (!members.length) continue;
      const taken = new Set(members);
      for (let i = series.length - 1; i >= 0; i--) {
        series[i].members = series[i].members.filter((m) => !taken.has(m));
        if (series[i].members.length < 2) series.splice(i, 1);
      }
      series.push({ base: g.name, members, key: `${g.name}|area`, single: members.length === 1 });
    }
  }

  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------
  const MAX_LEVEL = 100; // classic MapleStory's current level cap (also in index.html)
  const state = {
    level: 30,
    selected: null,
    hover: null,
    portalHover: null, // map whose minimap portal pin is under the mouse (ringed on the map)
    showHidden: true,
    labelMode: "smart", // "none" | "smart" | "all"
    showForgottenHollow: false,
    edit: false,
    mobHit: null, // { ids, maps: Set } while a monster search is highlighting maps
    npcHit: null, // { names: Set, maps: Set } while an NPC search is highlighting maps
  };
  const cam = { x: 0, y: 0, s: 1 }; // screen = world * s + (x, y)
  let W = 0, H = 0, dpr = 1;

  try {
    const saved = JSON.parse(localStorage.getItem("wm-prefs") || "{}");
    if (saved.level) state.level = clampInt(saved.level, 1, MAX_LEVEL);
    if (typeof saved.showHidden === "boolean") state.showHidden = saved.showHidden;
    if (["none", "smart", "all"].includes(saved.labelMode)) state.labelMode = saved.labelMode;
    else if (saved.showLabels === true) state.labelMode = "all"; // old "Always show labels"
    if (typeof saved.showForgottenHollow === "boolean") state.showForgottenHollow = saved.showForgottenHollow;
  } catch (_) { /* storage unavailable */ }

  function savePrefs() {
    try {
      localStorage.setItem("wm-prefs", JSON.stringify({
        level: state.level, showHidden: state.showHidden, labelMode: state.labelMode,
        showForgottenHollow: state.showForgottenHollow,
      }));
    } catch (_) { /* ignore */ }
  }

  function isVisible(m) {
    if (m.area === "forgotten_hollow" && !state.showForgottenHollow) return false;
    if (m.type === "hidden") return state.showHidden;
    if (hostOf.has(m)) return false; // buildings live in their host's panel, not on the map
    return true;
  }

  // ---------------------------------------------------------------------------
  // Geometry helpers
  // ---------------------------------------------------------------------------
  function clampInt(v, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(+v || lo))); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function hashStr(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  // Smooth closed/open curve through points (Catmull-Rom as Bezier).
  function splinePath(pts, closed = true, path = new Path2D()) {
    const n = pts.length;
    const P = (i) => closed ? pts[(i + n) % n] : pts[clamp(i, 0, n - 1)];
    path.moveTo(pts[0][0], pts[0][1]);
    const segs = closed ? n : n - 1;
    for (let i = 0; i < segs; i++) {
      const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
      path.bezierCurveTo(
        p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
        p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6,
        p2[0], p2[1]);
    }
    if (closed) path.closePath();
    return path;
  }

  function inPoly(x, y, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i], [xj, yj] = pts[j];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  function bbox(pts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { x0, y0, x1, y1 };
  }

  // Curve for an edge: a gentle bend so paths look hand-drawn.
  // Each link bends a little to one side, picked from a hash of its key. Links listed here
  // (key = the two map ids, sorted, joined by "|") bend the other way.
  const FLIP_BEND = new Set([
    "the_burnt_land_iii|the_burnt_land_iv",
    "the_burnt_land_iv|the_burnt_land_v",
  ]);

  function edgeCurve(e) {
    if (e.via && e.via.length) {
      return { pts: [[e.a.x, e.a.y], ...e.via, [e.b.x, e.b.y]], spline: true };
    }
    const a = endpoint(e.a, e.b), b = endpoint(e.b, e.a);
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const h = ((hashStr(e.key) % 1000) / 1000 - 0.5) * (FLIP_BEND.has(e.key) ? -1 : 1);
    // Section maps sit on a tidy tree, so their links stay straight.
    const off = e.a.section || e.b.section ? 0 : h * 0.3 * len;
    return {
      a, b, len,
      cx: (a.x + b.x) / 2 - (dy / len) * off,
      cy: (a.y + b.y) / 2 + (dx / len) * off,
    };
  }

  // ---------------------------------------------------------------------------
  // Sections: areas cut out of the island (e.g. everything behind Sleepywood) and drawn
  // as a tree in their own panel. Links from the section's root map start at the
  // panel's entrance marker instead of at the root itself.
  // ---------------------------------------------------------------------------
  const sections = (DATA.sections || []).map((s) => ({
    ...s, rootMap: byId.get(s.root), members: maps.filter((m) => m.section === s.id),
  }));
  const sectionById = new Map(sections.map((s) => [s.id, s]));

  function endpoint(m, other) {
    const s = other.section && sectionById.get(other.section);
    if (s && s.root === m.id) return { ...m, x: s.entry.x, y: s.entry.y, type: "stub", worldMapDot: false };
    return m;
  }

  // A section is shown when any of its maps is (Forgotten Hollow can be toggled off).
  const sectionShown = (s) => s.members.some(isVisible);
  // Sections whose root is far from the panel get a small portal marker by the root instead
  // of a stairway; clicking it jumps to the panel.
  function portalPos(s) {
    return s.portal && s.rootMap ? [s.rootMap.x + s.portal.dx, s.rootMap.y + s.portal.dy] : null;
  }

  function sectionBox(s, pad = 95) {
    let x0 = s.entry.x, y0 = s.entry.y, x1 = s.entry.x, y1 = s.entry.y;
    for (const m of s.members) {
      if (!isVisible(m)) continue;
      x0 = Math.min(x0, m.x); y0 = Math.min(y0, m.y); x1 = Math.max(x1, m.x); y1 = Math.max(y1, m.y);
    }
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  }

  function drawSections() {
    setWorldTransform();
    for (const s of sections) {
      if (!sectionShown(s)) continue;
      const b = sectionBox(s);
      const r = 60;
      const plate = new Path2D();
      plate.roundRect(b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0, r);
      ctx.save();
      ctx.shadowColor = "rgba(10,20,40,.45)";
      ctx.shadowBlur = 40 * cam.s;
      ctx.shadowOffsetY = 18 * cam.s;
      ctx.fillStyle = "#2c2638";
      ctx.fill(plate);
      ctx.restore();
      ctx.strokeStyle = "#120e18";
      ctx.lineWidth = 10;
      ctx.stroke(plate);
      ctx.strokeStyle = "rgba(184,151,255,.25)";
      ctx.lineWidth = 3;
      const inner = new Path2D();
      inner.roundRect(b.x0 + 14, b.y0 + 14, b.x1 - b.x0 - 28, b.y1 - b.y0 - 28, r - 14);
      ctx.stroke(inner);

      // Stairway from the root map on the island down to the panel's entrance.
      const root = s.rootMap;
      if (root && s.stair !== false) {
        const p = new Path2D();
        p.moveTo(root.x, root.y);
        p.bezierCurveTo(root.x, (root.y + s.entry.y) / 2, s.entry.x, (root.y + s.entry.y) / 2, s.entry.x, s.entry.y);
        // Kept faint on purpose: a hint of the way down, not a road.
        ctx.lineCap = "round";
        // Sizes in screen px (this is drawn in world units, hence / cam.s).
        ctx.setLineDash([6 / cam.s, 8 / cam.s]);
        ctx.strokeStyle = "rgba(184,151,255,.45)";
        ctx.lineWidth = 2.5 / cam.s;
        ctx.stroke(p);
        ctx.setLineDash([]);
      }
    }
  }

  // Entrance markers and titles, drawn in screen space on top of the nodes.
  function drawSectionMarkers() {
    setScreenTransform();
    const k = nodeScale();
    for (const s of sections) {
      if (!sectionShown(s)) continue;
      const pp = portalPos(s);
      if (pp) {
        const [px, py] = worldToScreen(pp[0], pp[1]);
        const pr = 11 * k;
        ctx.beginPath(); ctx.arc(px, py, pr + 3, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(184,151,255,.35)"; ctx.fill();
        ctx.beginPath(); ctx.arc(px, py, pr, 0, Math.PI * 2);
        ctx.fillStyle = "#6b5b8a"; ctx.fill();
        ctx.strokeStyle = "#120e18"; ctx.lineWidth = 2.5; ctx.stroke();
        ctx.beginPath(); // down arrow
        ctx.moveTo(px, py - pr * 0.5); ctx.lineTo(px, py + pr * 0.45);
        ctx.moveTo(px - pr * 0.4, py + pr * 0.05); ctx.lineTo(px, py + pr * 0.45); ctx.lineTo(px + pr * 0.4, py + pr * 0.05);
        ctx.strokeStyle = "#f3ead2"; ctx.lineWidth = 2; ctx.stroke();
        portalTag(`To ${s.name}`, px, py - pr - 13);
      }
      const [x, y] = worldToScreen(s.entry.x, s.entry.y);
      const r = 13 * k;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = "#6b5b8a"; ctx.fill();
      ctx.strokeStyle = "#120e18"; ctx.lineWidth = 2.5; ctx.stroke();
      // little staircase glyph
      ctx.beginPath();
      const u = r * 0.28;
      ctx.moveTo(x - 2 * u, y - 1.5 * u);
      ctx.lineTo(x - u, y - 1.5 * u); ctx.lineTo(x - u, y - 0.5 * u);
      ctx.lineTo(x, y - 0.5 * u); ctx.lineTo(x, y + 0.5 * u);
      ctx.lineTo(x + u, y + 0.5 * u); ctx.lineTo(x + u, y + 1.5 * u); ctx.lineTo(x + 2 * u, y + 1.5 * u);
      ctx.strokeStyle = "#f3ead2"; ctx.lineWidth = 2; ctx.stroke();
      if (s.rootMap) label(`↑ ${s.label || s.rootMap.name}`, x, y + r + 12, 12, "#e8e0ff", "#120e18");
      const b = sectionBox(s);
      const [bx, by] = worldToScreen((b.x0 + b.x1) / 2, b.y0);
      banner(s.name, bx, by);
    }
  }

  // Small dark-purple tag over a section portal (matches the section plates).
  const PORTAL_FONT = `700 11px Fredoka, "Segoe UI", sans-serif`;
  function portalTagSize(text) { return { w: textWidth(text, PORTAL_FONT) + 14, h: 18 }; }
  function portalTag(text, x, y) {
    const { w, h } = portalTagSize(text);
    ctx.fillStyle = "rgba(0,0,0,.25)";
    roundRect(x - w / 2 + 1, y - h / 2 + 2, w, h, h / 2); ctx.fill();
    roundRect(x - w / 2, y - h / 2, w, h, h / 2);
    ctx.fillStyle = "#2c2638"; ctx.fill();
    ctx.strokeStyle = "#b897ff"; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.font = PORTAL_FONT;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillStyle = "#e8e0ff";
    ctx.fillText(text, x, y + 0.5);
  }

  // Screen boxes (see boxesOverlap) of what drawSectionMarkers draws, so smart labels
  // stay off section banners, entry markers and portals.
  function sectionMarkerBoxes() {
    const out = [], k = nodeScale();
    const bannerBox = (text, x, y, size) => {
      const w = textWidth(text, `700 ${size}px "Alegreya SC", Georgia, serif`) + 34 * size / 15;
      return { cx: x, cy: y, hw: w / 2, hh: 16 * size / 15, ang: 0 };
    };
    for (const s of sections) {
      if (!sectionShown(s)) continue;
      const pp = portalPos(s);
      if (pp) {
        const [px, py] = worldToScreen(pp[0], pp[1]), pr = 11 * k;
        const tag = portalTagSize(`To ${s.name}`);
        out.push({ cx: px, cy: py, hw: pr + 3, hh: pr + 3, ang: 0 }, { cx: px, cy: py - pr - 13, hw: tag.w / 2, hh: tag.h / 2, ang: 0 });
      }
      const [x, y] = worldToScreen(s.entry.x, s.entry.y), r = 13 * k;
      out.push({ cx: x, cy: y, hw: r, hh: r, ang: 0 });
      if (s.rootMap) {
        const t = `↑ ${s.label || s.rootMap.name}`, w = textWidth(t, LABEL_FONT);
        out.push({ cx: x, cy: y + r + 12, hw: w / 2 + 3, hh: 8, ang: 0 });
      }
      const b = sectionBox(s);
      const [bx, by] = worldToScreen((b.x0 + b.x1) / 2, b.y0);
      out.push(bannerBox(s.name, bx, by, 15));
    }
    return out;
  }

  // Screen boxes of the HUD cards and the open side panel, so labels don't hide under them.
  function hudBoxes() {
    const canvasRect = canvas.getBoundingClientRect();
    const out = [];
    for (const el of document.querySelectorAll("#hud .card, #legend, #zoomCtl, #editBar, #panel")) {
      if (el.id === "panel" && !document.body.classList.contains("panel-open")) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height || getComputedStyle(el).display === "none") continue;
      out.push({ cx: r.left - canvasRect.left + r.width / 2, cy: r.top - canvasRect.top + r.height / 2, hw: r.width / 2, hh: r.height / 2, ang: 0 });
    }
    return out;
  }

  function hitSectionEntry(sx, sy) {
    for (const s of sections) {
      if (!sectionShown(s)) continue;
      const [x, y] = worldToScreen(s.entry.x, s.entry.y);
      if (Math.hypot(x - sx, y - sy) < 13 * nodeScale() + 7) return s.rootMap;
      const pp = portalPos(s);
      if (pp) {
        const [px, py] = worldToScreen(pp[0], pp[1]);
        // The portal stands for the section's first map past the root.
        if (Math.hypot(px - sx, py - sy) < 11 * nodeScale() + 7) return (neighbors.get(s.root) || []).map((n) => n.map).find((m) => m.section === s.id) || null;
      }
    }
    return null;
  }

  function quadAt(c, t) {
    const u = 1 - t;
    return [u * u * c.a.x + 2 * u * t * c.cx + t * t * c.b.x, u * u * c.a.y + 2 * u * t * c.cy + t * t * c.b.y];
  }

  // ---------------------------------------------------------------------------
  // Terrain (built once into Path2D batches)
  // ---------------------------------------------------------------------------
  const terrain = { islands: [], biomes: [], rivers: [], decor: [], clouds: null, waves: null };

  function buildTerrain() {
    for (const isl of DATA.islands) {
      const path = splinePath(isl.points);
      const cliff = new Path2D();
      cliff.addPath(path, new DOMMatrix().translate(0, 22 * DS));
      terrain.islands.push({ ...isl, path, cliff });
    }
    for (const b of DATA.biomes) terrain.biomes.push({ ...b, path: splinePath(b.points) });
    for (const r of DATA.rivers || []) terrain.rivers.push({ ...r, path: splinePath(r.points, false) });
    buildDecor();
    buildClouds();
  }

  // Cells near nodes/edges are kept clear of decorations.
  function blockedGrid() {
    const cell = 24;
    const set = new Set();
    const mark = (x, y, r) => {
      for (let gx = Math.floor((x - r) / cell); gx <= Math.floor((x + r) / cell); gx++)
        for (let gy = Math.floor((y - r) / cell); gy <= Math.floor((y + r) / cell); gy++) set.add(gx + "," + gy);
    };
    for (const m of maps) mark(m.x, m.y, 34);
    for (const e of edges) {
      if (e.kind !== "walk") continue;
      const c = edgeCurve(e);
      const n = Math.ceil(c.len / 12);
      for (let i = 0; i <= n; i++) { const [x, y] = quadAt(c, i / n); mark(x, y, 10); }
    }
    return (x, y) => set.has(Math.floor(x / cell) + "," + Math.floor(y / cell));
  }

  const DECOR_STYLES = {
    trees:     { canopy: "#5ea446", hi: "#6db354", dark: "#3f7a32", trunk: "#7a5434", size: [9, 14] },
    bigtrees:  { canopy: "#3f9440", hi: "#4fa44a", dark: "#2d6e30", trunk: "#6a4a2c", size: [12, 19] },
    darktrees: { canopy: "#3b5f3e", hi: "#456c46", dark: "#2a4a2d", trunk: "#4d3826", size: [10, 16] },
    palms:     { canopy: "#64bb50", hi: "#78c862", dark: "#428a36", trunk: "#8a5a2b", size: [7, 11] },
  };

  // Minimum spacing (decor units) between items, so big shapes don't overlap into clutter.
  const DECOR_GAP = { mesas: 62, buildings: 30, hills: 55 };

  function newGroup(fill, stroke, lw, mode = "fill") { return { path: new Path2D(), fill, stroke, lw, mode }; }

  function buildDecor() {
    const rng = mulberry32(1337);
    const blocked = blockedGrid();
    const items = [];

    // Which decor zone a point is in: the last biome that contains it, else its island.
    function zoneAt(x, y) {
      for (let i = DATA.biomes.length - 1; i >= 0; i--) {
        if (inPoly(x, y, DATA.biomes[i].points)) return DATA.biomes[i];
      }
      for (const isl of DATA.islands) if (inPoly(x, y, isl.points)) return isl;
      return null;
    }

    const zones = [...DATA.islands, ...DATA.biomes];
    for (const z of zones) {
      if (!z.decor || z.decor.type === "none") continue;
      const bb = bbox(z.points);
      const count = Math.round(((bb.x1 - bb.x0) * (bb.y1 - bb.y0) / 10000 / (DS * DS)) * (z.decor.density || 1));
      for (let k = 0; k < count; k++) {
        const x = bb.x0 + rng() * (bb.x1 - bb.x0);
        const y = bb.y0 + rng() * (bb.y1 - bb.y0);
        if (zoneAt(x, y) !== z) continue;
        if (!DATA.islands.some((isl) => inPoly(x, y - 16 * DS, isl.points))) continue; // keep off the cliff edge
        if (blocked(x, y)) continue;
        const gap = DECOR_GAP[z.decor.type] || 0;
        if (gap && items.some((it) => Math.hypot(it.x - x / DS, it.y - y / DS) < gap)) continue;
        // Decor shapes are built in a space shrunk by DS and drawn scaled back up.
        items.push({ type: z.decor.type, x: x / DS, y: y / DS, r: rng() });
      }
    }
    items.sort((p, q) => p.y - q.y);

    // Batch each look into a few paths. Draw "outline" groups as a thick stroke first,
    // then fill on top, so overlapping shapes merge into clumps.
    const G = {};
    const g = (key, ...args) => (G[key] ||= newGroup(...args));
    const order = [];
    const use = (key, ...args) => { if (!G[key]) order.push(key); return g(key, ...args); };

    for (const it of items) {
      const { x, y, r } = it;
      switch (it.type) {
        case "trees": case "bigtrees": case "darktrees": case "palms": {
          const st = DECOR_STYLES[it.type];
          const size = st.size[0] + r * (st.size[1] - st.size[0]);
          const shadow = use(it.type + "-shadow", "rgba(0,0,0,.12)").path;
          shadow.moveTo(x + 2 + size * 0.9, y + 3); // new sub-path, or shadows get joined into one big polygon
          shadow.ellipse(x + 2, y + 3, size * 0.9, size * 0.35, 0, 0, Math.PI * 2);
          use(it.type + "-trunk", st.trunk).path.rect(x - 1.8, y - size * 0.4, 3.6, size * 0.6);
          const cy = y - size * 0.9;
          const canopyOutline = use(it.type + "-outline", null, st.dark, 3, "stroke").path;
          const canopy = use(it.type + "-canopy", st.canopy).path;
          if (it.type === "palms") {
            for (let a = 0; a < 5; a++) {
              const ang = -Math.PI / 2 + (a - 2) * 0.62;
              const ex = x + Math.cos(ang) * size * 1.3, ey = cy + Math.sin(ang) * size * 0.9 + size * 0.4;
              for (const p of [canopyOutline, canopy]) {
                p.moveTo(x, cy);
                p.quadraticCurveTo(x + Math.cos(ang) * size * 0.8, cy + Math.sin(ang) * size - 4, ex, ey);
                p.quadraticCurveTo(x + Math.cos(ang) * size * 0.6, cy + Math.sin(ang) * size * 0.4 + 2, x, cy);
              }
            }
          } else {
            for (const p of [canopyOutline, canopy]) {
              p.moveTo(x + size, cy); p.arc(x, cy, size, 0, Math.PI * 2);
              p.moveTo(x - size * 0.45 + size * 0.6, cy + size * 0.35); p.arc(x - size * 0.45, cy + size * 0.35, size * 0.6, 0, Math.PI * 2);
              p.moveTo(x + size * 0.5 + size * 0.55, cy + size * 0.3); p.arc(x + size * 0.5, cy + size * 0.3, size * 0.55, 0, Math.PI * 2);
            }
            const hp = use(it.type + "-hi", st.hi).path;
            hp.moveTo(x - size * 0.25 + size * 0.38, cy - size * 0.35);
            hp.arc(x - size * 0.25, cy - size * 0.35, size * 0.38, 0, Math.PI * 2);
          }
          break;
        }
        case "mesas": {
          const w = 26 + r * 30, h = 10 + r * 12;
          const side = use("mesa-side", "#c08a4c", "#9a6a3a", 1.5, "both").path;
          side.moveTo(x - w / 2, y - h);
          side.lineTo(x - w / 2 + 5, y);
          side.lineTo(x + w / 2 - 5, y);
          side.lineTo(x + w / 2, y - h);
          side.closePath();
          const shade = use("mesa-shade", "#b27d44").path;
          shade.moveTo(x + w * 0.15, y - h); shade.lineTo(x + w / 2, y - h); shade.lineTo(x + w / 2 - 5, y); shade.lineTo(x + w * 0.1, y); shade.closePath();
          const top = use("mesa-top", "#e6c58a", "#9a6a3a", 1.5, "both").path;
          top.moveTo(x + w / 2, y - h); top.ellipse(x, y - h, w / 2, w / 7, 0, 0, Math.PI * 2);
          break;
        }
        case "deadtrees": {
          const s = 9 + r * 8;
          const p = use("dead", null, "#7d6a52", 2, "stroke").path;
          p.moveTo(x, y); p.lineTo(x, y - s * 1.6);
          p.moveTo(x, y - s * 0.9); p.lineTo(x - s * 0.6, y - s * 1.5);
          p.moveTo(x, y - s * 1.2); p.lineTo(x + s * 0.55, y - s * 1.8);
          p.moveTo(x - s * 0.35, y - s * 1.25); p.lineTo(x - s * 0.7, y - s * 1.2);
          break;
        }
        case "buildings": {
          const w = 16 + r * 18, h = 16 + ((r * 7.3) % 1) * 26;
          use("bld-shadow", "rgba(0,0,0,.12)").path.rect(x - w / 2 + 4, y - 2, w, 6);
          use("bld", "#9aa1a8", "#6b7279", 1.5, "both").path.rect(x - w / 2, y - h, w, h);
          use("bld-roof", "#b9c0c6", "#6b7279", 1.5, "both").path.rect(x - w / 2 - 2, y - h - 5, w + 4, 6);
          const win = use("bld-win", "#e9d48c").path;
          for (let wy = y - h + 6; wy < y - 5; wy += 7) for (let wx = x - w / 2 + 3; wx < x + w / 2 - 3; wx += 6) if (((wx * 7 + wy * 3) | 0) % 3 === 0) win.rect(wx, wy, 3, 3);
          break;
        }
        case "hills": {
          const w = 40 + r * 40, h = 30 + r * 26;
          const p = use("hill", "#7cb64e", "#5f9a3c", 1.5, "both").path;
          p.moveTo(x - w / 2, y);
          p.quadraticCurveTo(x - w * 0.12, y - h * 1.1, x, y - h);
          p.quadraticCurveTo(x + w * 0.12, y - h * 1.1, x + w / 2, y);
          p.closePath();
          const s = use("hill-shade", "#6ea845").path;
          s.moveTo(x, y - h); s.quadraticCurveTo(x + w * 0.12, y - h * 1.1, x + w / 2, y); s.lineTo(x + w * 0.05, y); s.closePath();
          break;
        }
        case "rocks": {
          const s = 5 + r * 9;
          const p = use("rock", "#5a5168", "#1d1826", 2, "both").path;
          p.moveTo(x + s, y); p.ellipse(x, y, s, s * 0.6, 0, 0, Math.PI * 2);
          const glow = use("rock-crystal", "#9b7bea").path;
          if (r > 0.82) { glow.moveTo(x, y - s * 1.8); glow.lineTo(x + 3, y - s * 0.5); glow.lineTo(x - 3, y - s * 0.5); glow.closePath(); }
          break;
        }
      }
    }
    terrain.decor = order.map((k) => G[k]);
  }

  function buildClouds() {
    const rng = mulberry32(99);
    const { width: WW, height: HH } = DATA.meta;
    const outline = new Path2D(), fill = new Path2D();
    const waves = new Path2D();
    let placed = 0, tries = 0;
    while (placed < 46 && tries < 4000) {
      tries++;
      const x = -150 * DS + rng() * (WW + 300 * DS), y = -150 * DS + rng() * (HH + 300 * DS);
      const edgeDist = Math.min(x, y, WW - x, HH - y);
      if (edgeDist > 170 * DS && rng() > 0.05) continue;
      if (DATA.islands.some((isl) => inPoly(x, y, isl.points))) continue;
      if (maps.some((m) => Math.hypot(m.x - x, m.y - y) < 150 * DS)) continue;
      if (sections.some((s) => { const b = sectionBox(s, 380); return x > b.x0 && x < b.x1 && y > b.y0 && y < b.y1; })) continue;
      const puffs = 4 + Math.floor(rng() * 4);
      const base = (26 + rng() * 26) * DS;
      for (let i = 0; i < puffs; i++) {
        const px = x + (i - puffs / 2) * base * 0.8 + rng() * 10, py = y - Math.sin((i / (puffs - 1)) * Math.PI) * base * 0.6 + rng() * 8;
        const pr = base * (0.6 + rng() * 0.5);
        for (const p of [outline, fill]) { p.moveTo(px + pr, py); p.arc(px, py, pr, 0, Math.PI * 2); }
      }
      placed++;
    }
    // little wave marks on open water
    for (let i = 0; i < 160; i++) {
      const x = rng() * WW, y = rng() * HH, w = 10 * DS;
      if (DATA.islands.some((isl) => inPoly(x, y, isl.points) || inPoly(x, y - 40 * DS, isl.points))) continue;
      waves.moveTo(x - w, y); waves.quadraticCurveTo(x - w / 2, y - w / 2, x, y); waves.quadraticCurveTo(x + w / 2, y - w / 2, x + w, y);
    }
    terrain.clouds = { outline, fill };
    terrain.waves = waves;
  }

  // ---------------------------------------------------------------------------
  // Drawing
  // ---------------------------------------------------------------------------
  function worldToScreen(x, y) { return [x * cam.s + cam.x, y * cam.s + cam.y]; }
  function screenToWorld(x, y) { return [(x - cam.x) / cam.s, (y - cam.y) / cam.s]; }

  function setWorldTransform() { ctx.setTransform(dpr * cam.s, 0, 0, dpr * cam.s, dpr * cam.x, dpr * cam.y); }
  function setScreenTransform() { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }

  function drawGroup(gr) {
    if (gr.mode === "stroke") {
      ctx.strokeStyle = gr.stroke; ctx.lineWidth = gr.lw; ctx.stroke(gr.path);
    } else if (gr.mode === "both") {
      ctx.fillStyle = gr.fill; ctx.fill(gr.path);
      ctx.strokeStyle = gr.stroke; ctx.lineWidth = gr.lw; ctx.stroke(gr.path);
    } else {
      ctx.fillStyle = gr.fill; ctx.fill(gr.path);
    }
  }

  function drawTerrain() {
    // ocean
    setScreenTransform();
    const grd = ctx.createLinearGradient(0, 0, 0, H);
    grd.addColorStop(0, "#5cb8e8");
    grd.addColorStop(1, "#3f9bd3");
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, W, H);

    setWorldTransform();
    const { width: WW, height: HH } = DATA.meta;
    // chart grid
    ctx.strokeStyle = "rgba(255,255,255,.14)";
    ctx.lineWidth = 1 / cam.s;
    ctx.beginPath();
    const step = 100 * DS, pad = 1000;
    for (let x = -pad; x <= WW + pad; x += step) { ctx.moveTo(x, -pad); ctx.lineTo(x, HH + pad); }
    for (let y = -pad; y <= HH + pad; y += step) { ctx.moveTo(-pad, y); ctx.lineTo(WW + pad, y); }
    ctx.stroke();

    ctx.strokeStyle = "rgba(255,255,255,.45)";
    ctx.lineWidth = 2 * DS;
    ctx.lineCap = "round";
    ctx.stroke(terrain.waves);

    for (const isl of terrain.islands) {
      // shallow water halo
      ctx.strokeStyle = "rgba(190,235,255,.45)";
      ctx.lineWidth = 46 * DS;
      ctx.lineJoin = "round";
      ctx.stroke(isl.cliff);
      // cliff face
      ctx.fillStyle = "#8a6036";
      ctx.fill(isl.cliff);
      ctx.strokeStyle = "#3b2716";
      ctx.lineWidth = 4 * DS;
      ctx.stroke(isl.cliff);
    }
    for (const isl of terrain.islands) {
      ctx.fillStyle = isl.fill;
      ctx.fill(isl.path);
    }

    // biomes clipped to land
    ctx.save();
    const clip = new Path2D();
    for (const isl of terrain.islands) clip.addPath(isl.path);
    ctx.clip(clip);
    for (const b of terrain.biomes) {
      ctx.fillStyle = b.fill;
      ctx.fill(b.path);
      ctx.strokeStyle = b.edge || "rgba(0,0,0,.15)";
      ctx.lineWidth = 2 * DS;
      ctx.stroke(b.path);
    }
    for (const r of terrain.rivers) {
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      ctx.strokeStyle = "#2d5b4a"; ctx.lineWidth = r.width + 6; ctx.stroke(r.path);
      ctx.strokeStyle = "#4fa58f"; ctx.lineWidth = r.width; ctx.stroke(r.path);
      ctx.strokeStyle = "rgba(255,255,255,.35)"; ctx.lineWidth = 2; ctx.setLineDash([10, 14]); ctx.stroke(r.path); ctx.setLineDash([]);
    }
    ctx.restore();

    for (const isl of terrain.islands) {
      ctx.strokeStyle = "#3b2716";
      ctx.lineWidth = 4 * DS;
      ctx.stroke(isl.path);
    }

    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.save();
    ctx.scale(DS, DS);
    for (const gr of terrain.decor) drawGroup(gr);
    ctx.restore();
  }

  // Dark cave backdrop under underground maps, built from where those maps actually are:
  // a blob around each underground map, joined along the links between them.
  function drawCaves() {
    setWorldTransform();
    const R = 58;
    // Section maps already sit on their own dark panel.
    const under = maps.filter((m) => m.layer === "underground" && isVisible(m) && !m.section);
    const links = edges.filter((e) => e.kind === "walk" && e.a.layer === "underground" && e.b.layer === "underground"
      && isVisible(e.a) && isVisible(e.b) && !e.a.section && !e.b.section);
    const shape = (extra, color) => {
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      ctx.lineCap = "round";
      ctx.lineWidth = (R + extra) * 2;
      ctx.beginPath();
      for (const e of links) {
        const c = edgeCurve(e);
        ctx.moveTo(c.a.x, c.a.y);
        ctx.quadraticCurveTo(c.cx, c.cy, c.b.x, c.b.y);
      }
      ctx.stroke();
      ctx.beginPath();
      for (const m of under) { ctx.moveTo(m.x + R + extra, m.y); ctx.arc(m.x, m.y, R + extra, 0, Math.PI * 2); }
      ctx.fill();
    };
    shape(14, "rgba(30,24,40,.35)");
    shape(6, "#1d1826");
    shape(0, "#3a3348");
  }

  // Towns that span several nodes: a light blue band around all of a town's maps, so they
  // read as one town. It covers the area between them (their convex hull, with rounded
  // edges), since a town's maps don't always link to each other (Kerning City's don't).
  // Hand-picked: only maps that are really part of the town belong here.
  const TOWN_GROUPS = [
    { town: "henesys", maps: ["henesys", "henesys_market", "henesys_park"] },
    { town: "kerning_city", maps: ["kerning_city", "niora_hospital", "subway_ticketing_booth"] },
  ].map((g) => ({ ...g, members: new Set(g.maps.map((id) => byId.get(id)).filter(Boolean)) }));
  // Convex hull of [x, y] points (monotone chain), counter-clockwise.
  function convexHull(pts) {
    const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const half = (list) => {
      const out = [];
      for (const q of list) {
        while (out.length >= 2 && cross(out[out.length - 2], out[out.length - 1], q) <= 0) out.pop();
        out.push(q);
      }
      out.pop();
      return out;
    };
    return [...half(p), ...half([...p].reverse())];
  }
  function drawTowns() {
    setWorldTransform();
    const R = 46;
    for (const g of TOWN_GROUPS) {
      const members = [...g.members].filter(isVisible);
      if (members.length < 2) continue;
      const hull = convexHull(members.map((m) => [m.x, m.y]));
      // The hull's outline drawn R wide with round joins is the hull grown by R on every side.
      const shape = (extra, color) => {
        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.lineJoin = "round";
        ctx.lineCap = "round";
        ctx.lineWidth = (R + extra) * 2;
        ctx.beginPath();
        hull.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.stroke();
        ctx.fill();
      };
      // A slightly wider darker blue first, so the fill on top gets an outline.
      shape(5, "#7fb6e6");
      shape(0, "#cfe8fb");
    }
  }

  function drawClouds() {
    setWorldTransform();
    ctx.strokeStyle = "#5a6f93";
    ctx.lineWidth = 7 * DS;
    ctx.stroke(terrain.clouds.outline);
    ctx.fillStyle = "#fbfdff";
    ctx.fill(terrain.clouds.fill);
  }

  // Solid links: `color` line `width` px wide over a darker `casing` a little wider.
  const EDGE_STYLE = {
    walk:        { color: "rgba(240,212,130,.9)",  casing: "rgba(90,60,20,.3)",  width: 3.2 },
    underground: { color: "rgba(196,170,255,.85)", casing: "rgba(30,20,60,.45)", width: 3.2 },
    hidden:      { color: "rgba(250,240,205,.85)", casing: "rgba(90,70,30,.25)", width: 2.2 },
  };

  function edgeStyleKey(e) {
    if (e.a.type === "hidden" || e.b.type === "hidden" || e.a.type === "building" || e.b.type === "building") return "hidden";
    if (e.a.layer === "underground" && e.b.layer === "underground") return "underground";
    return "walk";
  }

  function drawEdges() {
    setScreenTransform();
    const sel = state.selected;
    for (const e of edges) {
      if (!isVisible(e.a) || !isVisible(e.b)) continue;
      const hot = sel && (e.a === sel || e.b === sel);
      const c = edgeCurve(e);

      if (c.pts) { // boat / travel route
        const pts = c.pts.map(([x, y]) => worldToScreen(x, y));
        const p = splinePath(pts, false);
        ctx.setLineDash([10, 9]);
        ctx.lineCap = "round";
        ctx.strokeStyle = "rgba(30,60,100,.5)"; ctx.lineWidth = hot ? 6 : 5; ctx.stroke(p);
        ctx.strokeStyle = hot ? "#fff" : "rgba(255,255,255,.9)"; ctx.lineWidth = hot ? 3.5 : 2.5; ctx.stroke(p);
        ctx.setLineDash([]);
        if (e.label) {
          const mid = pts[Math.floor(pts.length / 2)];
          label(e.label, mid[0], mid[1] - 10, 12, "#fff", "#1e3c64");
        }
        continue;
      }

      const st = EDGE_STYLE[edgeStyleKey(e)];
      const sx = worldToScreen(c.a.x, c.a.y), ex = worldToScreen(c.b.x, c.b.y), cc = worldToScreen(c.cx, c.cy);
      const k = clamp(cam.s, 0.7, 1.25) * (hot ? 1.3 : 1);
      ctx.beginPath();
      ctx.moveTo(sx[0], sx[1]);
      ctx.quadraticCurveTo(cc[0], cc[1], ex[0], ex[1]);
      ctx.lineCap = "round";
      ctx.strokeStyle = hot ? "rgba(255,255,255,.6)" : st.casing;
      ctx.lineWidth = st.width * k + 3;
      ctx.stroke();
      ctx.strokeStyle = st.color;
      ctx.lineWidth = st.width * k;
      ctx.stroke();
    }
  }

  function nodeScale() { return clamp(cam.s, 0.6, 1.35); }
  function nodeRadius(m) {
    const k = nodeScale();
    if (m.type === "town") return 13 * k;
    if (m.type === "boss") return 13 * k;
    if (m.type === "safe") return 7 * k;
    if (m.type === "building") return 5 * k;
    // Maps the game's own world map shows as a dot are drawn a little bigger.
    return (m.worldMapDot ? 10.5 : 8.5) * k;
  }

  // Node outline: a darker, semi-transparent shade of the node's own fill, thin.
  const NODE_EDGE_W = 1.4;
  const nodeEdgeCache = new Map();
  function nodeEdge(hex) {
    if (!nodeEdgeCache.has(hex)) {
      const n = parseInt(hex.slice(1), 16);
      const k = 0.55; // share of the fill colour kept (the rest is black)
      const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(c * k));
      nodeEdgeCache.set(hex, `rgba(${r},${g},${b},.8)`);
    }
    return nodeEdgeCache.get(hex);
  }
  // Label outline thickness as a share of the font size (was 0.3).
  const LABEL_EDGE = 0.17;

  // Map text (labels, level lines, area names): Atkinson Hyperlegible, made for legibility (bold 700 only here).
  const LABEL_FAMILY = `"Atkinson Hyperlegible", "Segoe UI", system-ui, sans-serif`;
  function label(text, x, y, size, fill = "#fff", stroke = "#2b1a0e", weight = 700) {
    ctx.font = `${weight} ${size}px ${LABEL_FAMILY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.strokeStyle = stroke;
    ctx.lineWidth = Math.max(2, size * LABEL_EDGE);
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
  }

  // `size` is the font size; the scroll scales with it (towns use 15).
  function banner(text, x, y, size = 15) {
    const k = size / 15;
    ctx.font = `700 ${size}px "Alegreya SC", Georgia, serif`;
    const tw = ctx.measureText(text).width;
    const w = tw + 26 * k, h = 24 * k, rw = 8 * k;
    const x0 = x - w / 2, y0 = y - h / 2;
    ctx.fillStyle = "rgba(0,0,0,.25)";
    ctx.fillRect(x0 + 2, y0 + 4, w, h);
    ctx.fillStyle = "#f6ecd2";
    ctx.strokeStyle = "#3a2614";
    ctx.lineWidth = 2;
    ctx.fillRect(x0, y0, w, h);
    ctx.strokeRect(x0, y0, w, h);
    for (const rx of [x0 - rw / 2, x0 + w - rw / 2]) {
      const gr = ctx.createLinearGradient(rx, 0, rx + rw, 0);
      gr.addColorStop(0, "#24497f"); gr.addColorStop(0.5, "#4f82c8"); gr.addColorStop(1, "#24497f");
      ctx.fillStyle = gr;
      roundRect(rx, y0 - 4, rw, h + 8, 4);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = "#3a2614";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, x, y + 1);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function shapePath(type, x, y, r) {
    ctx.beginPath();
    if (type === "hidden") {
      ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r * 1.1, y); ctx.lineTo(x, y + r * 1.2); ctx.lineTo(x - r * 1.1, y); ctx.closePath();
    } else if (type === "dungeon") {
      roundRect(x - r, y - r, r * 2, r * 2, r * 0.35);
    } else if (type === "boss") {
      for (let i = 0; i < 12; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 6, rr = i % 2 ? r * 0.6 : r * 1.15;
        i ? ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : ctx.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath();
    } else {
      ctx.arc(x, y, r, 0, Math.PI * 2);
    }
  }

  const bossMaps = new Set(maps.filter((m) => mobList(m).some((x) => x.boss)));

  // Small skull badge; (cx, cy) is its center and s about half its width.
  function drawSkull(cx, cy, s) {
    ctx.beginPath();
    ctx.arc(cx, cy - s * 0.15, s, Math.PI * 0.8, Math.PI * 2.2);
    ctx.lineTo(cx + s * 0.6, cy + s * 0.85);
    ctx.lineTo(cx - s * 0.6, cy + s * 0.85);
    ctx.closePath();
    ctx.fillStyle = "#f5f1e6"; ctx.fill();
    ctx.strokeStyle = "#2b1a0e"; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.fillStyle = "#2b1a0e";
    for (const dx of [-0.42, 0.42]) {
      ctx.beginPath(); ctx.arc(cx + dx * s, cy - s * 0.1, s * 0.27, 0, Math.PI * 2); ctx.fill();
    }
    ctx.beginPath(); // nose
    ctx.moveTo(cx, cy + s * 0.22); ctx.lineTo(cx - s * 0.12, cy + s * 0.45); ctx.lineTo(cx + s * 0.12, cy + s * 0.45);
    ctx.closePath(); ctx.fill();
  }

  function drawNode(m, now) {
    const [x, y] = worldToScreen(m.x, m.y);
    const r = nodeRadius(m) * (state.hover === m || state.portalHover === m ? 1.15 : 1);
    if (x < -80 || y < -60 || x > W + 80 || y > H + 60) return;

    // Portal-blue ring on the target of the minimap pin under the mouse.
    if (state.portalHover === m) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(x, y, r + 7, 0, Math.PI * 2);
      ctx.strokeStyle = "#3aa0ff";
      ctx.lineWidth = 4;
      ctx.shadowColor = "rgba(80,180,255,.9)";
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.restore();
    }

    if (state.selected === m) {
      const pulse = (Math.sin(now / 260) + 1) / 2;
      ctx.beginPath();
      ctx.arc(x, y, r + 7 + pulse * 5, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${0.9 - pulse * 0.5})`;
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // Teal ring on every map with the searched monster.
    // One pulsing teal ring on every map a search selects (monsters, items or NPCs).
    const mobHit = !!state.mobHit && state.mobHit.maps.has(m);
    const npcHit = !!state.npcHit && state.npcHit.maps.has(m);
    if (mobHit || npcHit) {
      const pulse = (Math.sin(now / 300) + 1) / 2;
      ctx.beginPath();
      ctx.arc(x, y, r + 9 + pulse * 3, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(120,230,215,.3)";
      ctx.fill();
      ctx.strokeStyle = "#7fe3d6";
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    if (m.type === "town") {
      ctx.save();
      ctx.shadowColor = "rgba(120,210,255,.9)";
      ctx.shadowBlur = 18;
      const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
      g.addColorStop(0, "#ffffff"); g.addColorStop(0.35, "#8fdcff"); g.addColorStop(1, "#1c6fd1");
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      ctx.strokeStyle = nodeEdge("#1c6fd1"); ctx.lineWidth = NODE_EDGE_W + 0.4;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
      return { m, x, y: y + r + 20, priority: 0, banner: true };
    }

    const d = mapDiff(m);
    const color = d ? DIFF[d].color : m.type === "building" ? "#f3ead2" : "#a9cbe8";

    if (m.layer === "underground") {
      ctx.beginPath(); ctx.arc(x, y, r + 4.5, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(155,123,234,.55)"; ctx.fill();
    }

    ctx.fillStyle = "rgba(0,0,0,.3)";
    shapePath(m.type, x + 1.5, y + 2.5, r); ctx.fill();

    shapePath(m.type, x, y, r);
    ctx.fillStyle = color; ctx.fill();
    ctx.strokeStyle = nodeEdge(color); ctx.lineWidth = NODE_EDGE_W;
    if (m.type === "hidden") ctx.setLineDash([3, 2]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Soft highlight, round nodes only (squares, diamonds and stars stay flat).
    if (!["dungeon", "hidden", "boss"].includes(m.type)) {
      ctx.beginPath();
      ctx.arc(x - r * 0.32, y - r * 0.36, r * 0.26, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255,255,255,.28)";
      ctx.fill();
    }

    if (m.type === "safe") {
      ctx.beginPath(); ctx.arc(x, y, r * 0.35, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill();
    }

    if (bossMaps.has(m)) {
      const s = 7 * nodeScale();
      drawSkull(x + r * 0.85 + s * 0.3, y - r * 0.85 - s * 0.2, s);
    }

    const focus = state.hover === m || state.selected === m || state.portalHover === m;
    const lr = farmRange(m);
    const lvText = lr && (cam.s >= 1.1 || focus) ? (lr.min === lr.max ? `Lv ${lr.min}` : `Lv ${lr.min}–${lr.max}`) : null;
    return { m, x, y, r, color, lvText, focus, mobHit: mobHit || npcHit }; // either search hit gets a label
  }

  // ---------------------------------------------------------------------------
  // Labels. Modes (the Labels slider):
  //   none:  only the hovered/selected map and search hits
  //   smart: as many as fit, most important first, never over another label or node
  //   all:   every map, overlaps allowed
  // Smart order: hovered/selected, search hits, bosses, main roads between towns (by
  // routeScore), numbered side paths named once along their length, then the rest.
  // ---------------------------------------------------------------------------
  const LABEL_SIZE = 14, LV_SIZE = 12, SERIES_SIZE = 16;
  const LABEL_FONT = `700 ${LABEL_SIZE}px ${LABEL_FAMILY}`;
  const SERIES_FONT = `italic 700 ${SERIES_SIZE}px ${LABEL_FAMILY}`;
  // Smart zoom tiers, by camera scale (screen px per world unit). Scale is what decides
  // how much room labels have between nodes, whatever the window size; a bigger window
  // just shows more of the map at the same scale. Fitting the whole map is about 0.18
  // on a laptop-sized window and about 0.4 on a 2560-wide one.
  //   below AREA: town banners only
  //   AREA..ROAD: + area names along numbered side paths ("East Rocky Mountain")
  //   ROAD..ALL:  + names of maps on main roads between towns
  //   ALL and up: + every other map name (still never overlapping)
  const SMART_ZOOM = { AREA: 0.2, ROAD: 0.6, ALL: 0.9 };
  const LABEL_PAD = 8;          // px kept clear around each smart label (more = sparser)
  const SERIES_FIT = 0.75;      // share of neighbour pairs whose own labels must fit to skip the series label
  const textWidths = new Map();
  // Web fonts arrive after the first frames: re-measure and redraw once they're in.
  if (document.fonts) document.fonts.ready.then(() => { textWidths.clear(); needsDraw = true; });
  function textWidth(text, font) {
    const k = font + "|" + text;
    if (!textWidths.has(k)) { ctx.font = font; textWidths.set(k, ctx.measureText(text).width); }
    return textWidths.get(k);
  }

  function labelPriority(j) {
    const m = j.m;
    if (j.focus) return -1;
    if (j.mobHit) return 0.5;
    if (m.type === "boss") return 1;
    const sc = routeScore.get(m.id) || 0;
    if (sc > 0) return 2 - sc / maxRouteScore; // 1..2, busiest roads first
    if (m.worldMapDot) return 2.5;
    if (m.type === "hidden") return 4;
    if (m.type === "building") return 5;
    return 3;
  }

  // Boxes are {cx, cy, hw, hh, ang}: centre, half sizes and rotation (radians).
  function boxesOverlap(a, b) {
    if (!a.ang && !b.ang) return Math.abs(a.cx - b.cx) < a.hw + b.hw && Math.abs(a.cy - b.cy) < a.hh + b.hh;
    for (const ang of [a.ang, a.ang + Math.PI / 2, b.ang, b.ang + Math.PI / 2]) {
      const ux = Math.cos(ang), uy = Math.sin(ang);
      const span = (o) => {
        const c = o.cx * ux + o.cy * uy;
        const ext = o.hw * Math.abs(Math.cos(o.ang - ang)) + o.hh * Math.abs(Math.sin(o.ang - ang));
        return [c - ext, c + ext];
      };
      const [a0, a1] = span(a), [b0, b1] = span(b);
      if (a1 <= b0 || b1 <= a0) return false;
    }
    return true;
  }

  function drawLabels(jobs) {
    const mode = state.labelMode;
    const placed = mode === "smart" ? [...sectionMarkerBoxes(), ...hudBoxes()] : [];
    const nodeJobs = jobs.filter((j) => !j.banner);
    const jobOf = new Map(nodeJobs.map((j) => [j.m, j]));
    const nodeBoxes = mode === "smart" ? nodeJobs.map((j) => ({ m: j.m, cx: j.x, cy: j.y, hw: j.r + 1, hh: j.r + 1, ang: 0 })) : [];
    const fits = (b, own) => {
      const padded = { ...b, hw: b.hw + LABEL_PAD, hh: b.hh + LABEL_PAD };
      return !placed.some((p) => boxesOverlap(padded, p)) && !nodeBoxes.some((n) => !own.has(n.m) && boxesOverlap(b, n));
    };

    // Town banners always show and are placed first.
    for (const j of jobs) {
      if (!j.banner) continue;
      const w = textWidth(j.m.name, `700 15px "Alegreya SC", Georgia, serif`) + 34;
      placed.push({ cx: j.x, cy: j.y, hw: w / 2, hh: 16, ang: 0 });
      banner(j.m.name, j.x, j.y);
    }

    const cands = [];
    const grouped = new Set();
    const z = mode === "smart" ? cam.s : Infinity;
    const tier = z >= SMART_ZOOM.ALL ? 3 : z >= SMART_ZOOM.ROAD ? 2 : z >= SMART_ZOOM.AREA ? 1 : 0;
    if (mode === "smart" && tier >= 1) {
      for (const s of series) {
        // Once main-road names show, maps on a main road keep their own labels.
        const run = s.members.filter((m) => jobOf.has(m) && (tier < 2 || !(routeScore.get(m.id) > 0)));
        if (run.length < (s.single ? 1 : 2)) continue;
        if (tier === 3 && s.single) continue; // the map's own label takes over
        if (tier === 3) { // fully zoomed in: split into map names where they fit
          const inRun = new Set(run);
          let pairs = 0, ok = 0;
          for (const m of run) {
            for (const { map: v } of neighbors.get(m.id)) {
              if (!inRun.has(v) || v.id < m.id) continue;
              const a = jobOf.get(m), b = jobOf.get(v);
              const w = (textWidth(shortName(m.name), LABEL_FONT) + textWidth(shortName(v.name), LABEL_FONT)) / 2 + 8;
              pairs++;
              if (Math.abs(a.x - b.x) >= w || Math.abs(a.y - b.y) >= LABEL_SIZE + 8) ok++;
            }
          }
          if (pairs && ok / pairs >= SERIES_FIT) continue;
        }
        for (const m of run) grouped.add(m);
        cands.push({ kind: "series", s, run, pri: 2.3, key: s.key });
      }
    }
    for (const j of nodeJobs) {
      const special = j.focus || j.mobHit;
      if (!special) {
        if (mode === "none" || grouped.has(j.m)) continue;
        if (tier < 2) continue;                                    // towns and areas only
        if (tier === 2 && !(routeScore.get(j.m.id) > 0)) continue; // main roads only
      }
      cands.push({ kind: "map", j, pri: labelPriority(j), key: j.m.id, forced: j.focus || mode === "all" });
    }
    cands.sort((a, b) => a.pri - b.pri || (a.key < b.key ? -1 : 1));

    for (const c of cands) {
      if (c.kind === "series") { placeSeries(c, fits, placed); continue; }
      const { j } = c;
      const text = shortName(j.m.name);
      const w = textWidth(text, LABEL_FONT) + 6, h = LABEL_SIZE + 4 + (j.lvText ? LV_SIZE + 2 : 0);
      const own = new Set([j.m]);
      // Box centres to try: below the node, above, right, left.
      const spots = [
        [j.x, j.y + j.r + 3 + h / 2],
        [j.x, j.y - j.r - 3 - h / 2],
        [j.x + j.r + 4 + w / 2, j.y],
        [j.x - j.r - 4 - w / 2, j.y],
      ];
      let at = null;
      for (const [cx, cy] of c.forced ? spots.slice(0, 1) : spots) {
        const box = { cx, cy, hw: w / 2, hh: h / 2, ang: 0 };
        if (c.forced || fits(box, own)) { at = box; placed.push(box); break; }
      }
      if (!at) continue;
      const top = at.cy - h / 2;
      label(text, at.cx, top + LABEL_SIZE / 2 + 2, LABEL_SIZE);
      if (j.lvText) label(j.lvText, at.cx, top + LABEL_SIZE + 4 + LV_SIZE / 2, LV_SIZE, j.color, "#2b1a0e", 700);
    }

    // One italic name laid along an area, e.g. "East Rocky Mountain". Spots tried in order:
    // the middle of the run along its main direction, the middle of each link inside the
    // run along that link, then on each map; each also flat. A single-map area sits just
    // under its node. The first spot clear of other labels and other maps' nodes wins.
    function placeSeries(c, fits, placed) {
      const pts = c.run.map((m) => jobOf.get(m));
      const w = textWidth(c.s.base, SERIES_FONT) + 8, hh = SERIES_SIZE / 2 + 2;
      const readable = (a) => {
        if (a > Math.PI / 2) a -= Math.PI; else if (a < -Math.PI / 2) a += Math.PI;
        return Math.abs(a) > Math.PI / 3 ? 0 : a; // too steep to read comfortably
      };
      const spots = [];
      if (c.s.single) {
        const p = pts[0];
        spots.push([p.x, p.y + p.r + hh + 3, 0], [p.x, p.y - p.r - hh - 3, 0]);
      } else {
        const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
        // Main direction of the run; flat text if the run isn't clearly stretched one way.
        let sxx = 0, syy = 0, sxy = 0;
        for (const p of pts) { const dx = p.x - cx, dy = p.y - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
        const tr = sxx + syy, det = sxx * syy - sxy * sxy, disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
        const main = tr / 2 + disc > 3 * Math.max(tr / 2 - disc, 1) ? readable(0.5 * Math.atan2(2 * sxy, sxx - syy)) : 0;
        spots.push([cx, cy, main]);
        const inRun = new Set(c.run);
        for (const m of c.run) {
          for (const { map: v } of neighbors.get(m.id)) {
            if (!inRun.has(v) || v.id < m.id) continue;
            const a = jobOf.get(m), b = jobOf.get(v);
            spots.push([(a.x + b.x) / 2, (a.y + b.y) / 2, readable(Math.atan2(b.y - a.y, b.x - a.x))]);
          }
        }
        for (const p of pts) spots.push([p.x, p.y, main]);
        for (const s of spots.slice()) if (s[2]) spots.push([s[0], s[1], 0]);
      }
      const own = new Set(c.run);
      let box = null;
      for (const [x, y, ang] of spots) {
        const b = { cx: x, cy: y, hw: w / 2, hh, ang };
        if (fits(b, own)) { box = b; break; }
      }
      if (!box) return;
      placed.push(box);
      const { cx, cy, ang } = box;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.font = SERIES_FONT;
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
      ctx.strokeStyle = "rgba(43,26,14,.85)"; ctx.lineWidth = Math.max(2, SERIES_SIZE * LABEL_EDGE);
      ctx.strokeText(c.s.base, 0, 0);
      ctx.fillStyle = "#fff3c4";
      ctx.fillText(c.s.base, 0, 0);
      ctx.restore();
    }
  }

  function shortName(n) { return n.replace(/^Hidden Street:\s*/, ""); }

  function drawVignette() {
    setScreenTransform();
    const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.45, W / 2, H / 2, Math.max(W, H) * 0.8);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(10,30,60,.35)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  let needsDraw = true;
  let anim = null; // camera animation

  function render(now) {
    if (anim) {
      const t = clamp((now - anim.t0) / anim.dur, 0, 1);
      const e = 1 - Math.pow(1 - t, 3);
      cam.s = anim.from.s + (anim.to.s - anim.from.s) * e;
      cam.x = anim.from.x + (anim.to.x - anim.from.x) * e;
      cam.y = anim.from.y + (anim.to.y - anim.from.y) * e;
      if (t >= 1) anim = null;
      needsDraw = true;
    }
    if (needsDraw || state.selected || state.mobHit || state.npcHit) {
      needsDraw = false;
      drawTerrain();
      drawSections();
      drawCaves();
      drawTowns();
      drawEdges();
      setScreenTransform();
      const list = maps.filter(isVisible).sort((p, q) => (p.type === "town") - (q.type === "town") || p.y - q.y);
      const jobs = [];
      for (const m of list) { const j = drawNode(m, now); if (j) jobs.push(j); }
      drawLabels(jobs);
      drawSectionMarkers();
      drawClouds();
      drawVignette();
    }
    requestAnimationFrame(render);
  }

  // ---------------------------------------------------------------------------
  // Camera
  // ---------------------------------------------------------------------------
  const MIN_S = 0.1, MAX_S = 4;

  function panelWidth() { return document.body.classList.contains("panel-open") && W > 720 ? document.getElementById("panel").offsetWidth : 0; }

  function fitTarget() {
    let pts = [];
    for (const isl of DATA.islands) pts = pts.concat(isl.points);
    for (const s of sections) { if (!sectionShown(s)) continue; const b = sectionBox(s); pts.push([b.x0, b.y0], [b.x1, b.y1]); }
    return fitPoints(pts);
  }

  // Camera that fits `pts` (world [x, y]) beside the HUD and panel, zoomed in no further than maxS.
  function fitPoints(pts, pad = 40, maxS = MAX_S) {
    const bb = bbox(pts);
    const left = W > 720 ? 270 : 0; // keep clear of the HUD
    const availW = W - left - panelWidth() - pad * 2, availH = H - pad * 2;
    const s = clamp(Math.min(availW / Math.max(1, bb.x1 - bb.x0), availH / Math.max(1, bb.y1 - bb.y0 + 30)), MIN_S, maxS);
    return {
      s,
      x: left + pad + (availW - (bb.x1 - bb.x0) * s) / 2 - bb.x0 * s,
      y: pad + (availH - (bb.y1 - bb.y0) * s) / 2 - bb.y0 * s,
    };
  }

  function animateTo(to, dur = 450) {
    anim = { from: { ...cam }, to, t0: performance.now(), dur };
  }

  function zoomAt(sx, sy, factor) {
    const s = clamp(cam.s * factor, MIN_S, MAX_S);
    const [wx, wy] = screenToWorld(sx, sy);
    cam.s = s;
    cam.x = sx - wx * s;
    cam.y = sy - wy * s;
    needsDraw = true;
  }

  function flyTo(m) {
    const s = Math.max(cam.s, 1.25);
    const cx = (W - panelWidth()) / 2, cy = H / 2;
    animateTo({ s, x: cx - m.x * s, y: cy - m.y * s });
  }

  // ---------------------------------------------------------------------------
  // Hit testing & input
  // ---------------------------------------------------------------------------
  // `nodesOnly` skips the section entry/portal markers, which stand in for a map inside
  // the section: dragging one in Edit mode would pull that map out onto the island.
  function hitNode(sx, sy, nodesOnly = false) {
    let best = null, bestD = Infinity;
    for (const m of maps) {
      if (!isVisible(m)) continue;
      const [x, y] = worldToScreen(m.x, m.y);
      const d = Math.hypot(x - sx, y - sy);
      if (d < nodeRadius(m) + 7 && d < bestD) { best = m; bestD = d; }
    }
    return best || (nodesOnly ? null : hitSectionEntry(sx, sy));
  }

  const pointers = new Map();
  let drag = null; // { mode: 'pan'|'node'|'pinch', ... }

  let userMovedCam = false;
  canvas.addEventListener("pointerdown", (ev) => {
    userMovedCam = true;
    canvas.setPointerCapture(ev.pointerId);
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    anim = null;
    if (pointers.size === 2) {
      const [p, q] = [...pointers.values()];
      drag = { mode: "pinch", dist: Math.hypot(p.x - q.x, p.y - q.y), moved: true };
      return;
    }
    const hit = hitNode(ev.clientX, ev.clientY, state.edit);
    if (state.edit && hit) {
      drag = { mode: "node", node: hit, sx: ev.clientX, sy: ev.clientY, moved: false };
    } else {
      drag = { mode: "pan", sx: ev.clientX, sy: ev.clientY, cx: cam.x, cy: cam.y, moved: false };
      canvas.classList.add("dragging");
    }
  });

  canvas.addEventListener("pointermove", (ev) => {
    const prev = pointers.get(ev.pointerId);
    if (prev) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });

    if (state.edit) {
      const [wx, wy] = screenToWorld(ev.clientX, ev.clientY);
      document.getElementById("coords").textContent = `x ${Math.round(wx)}, y ${Math.round(wy)}`;
    }

    if (drag && drag.mode === "pinch" && pointers.size === 2) {
      const [p, q] = [...pointers.values()];
      const dist = Math.hypot(p.x - q.x, p.y - q.y);
      zoomAt((p.x + q.x) / 2, (p.y + q.y) / 2, dist / drag.dist);
      drag.dist = dist;
      return;
    }
    if (drag && drag.mode === "pan") {
      const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
      cam.x = drag.cx + dx; cam.y = drag.cy + dy;
      needsDraw = true;
      hideTooltip();
      return;
    }
    if (drag && drag.mode === "node") {
      const [wx, wy] = screenToWorld(ev.clientX, ev.clientY);
      if (Math.abs(ev.clientX - drag.sx) + Math.abs(ev.clientY - drag.sy) > 3) drag.moved = true;
      if (drag.moved) { drag.node.x = Math.round(wx); drag.node.y = Math.round(wy); drag.node.pinned = true; needsDraw = true; }
      return;
    }

    const hit = hitNode(ev.clientX, ev.clientY);
    if (hit !== state.hover) {
      state.hover = hit; needsDraw = true;
      lightKey(hit && hit !== state.selected ? hit.mapId : null); // its portal pins on the open minimap
    }
    canvas.classList.toggle("pointing", !!hit);
    if (hit) showTooltip(hit, ev.clientX, ev.clientY); else hideTooltip();
  });

  function endPointer(ev) {
    pointers.delete(ev.pointerId);
    canvas.classList.remove("dragging");
    if (!drag) return;
    const d = drag;
    if (d.mode === "pinch") { if (pointers.size === 0) drag = null; return; }
    drag = null;
    if (d.moved) {
      if (d.mode === "node") { select(d.node, false); toast(`Moved ${d.node.name} to ${d.node.x}, ${d.node.y}`); }
      return;
    }
    const hit = hitNode(ev.clientX, ev.clientY);
    if (hit) select(hit, true);
    else if (state.edit) {
      const [wx, wy] = screenToWorld(ev.clientX, ev.clientY);
      copyText(`"x": ${Math.round(wx)}, "y": ${Math.round(wy)}`, "Coordinates copied");
    } else select(null);
  }
  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("pointerleave", () => { if (!drag) { state.hover = null; lightKey(null); hideTooltip(); needsDraw = true; } });

  canvas.addEventListener("wheel", (ev) => {
    ev.preventDefault();
    anim = null;
    userMovedCam = true;
    const delta = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
    zoomAt(ev.clientX, ev.clientY, Math.exp(-delta * 0.0015));
  }, { passive: false });

  window.addEventListener("keydown", (ev) => {
    if (ev.target.matches?.("input")) { if (ev.key === "Escape") ev.target.blur(); return; }
    // Letters, digits and space start a search in the HUD box (the first key replaces any
    // old query); while the picker dialog is open they go to its filter instead.
    if (/^[A-Za-z0-9 ]$/.test(ev.key) && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      ev.preventDefault();
      if (!mobDialog.hidden) {
        mobFilter.focus();
        mobFilter.value += ev.key;
        onFilterChange();
        return;
      }
      search.focus();
      search.value = ev.key === " " ? "" : ev.key;
      search.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }
    if (!mobDialog.hidden) return; // map shortcuts are off while the picker is open
    if (ev.key === "Escape") {
      select(null);
      if (search.value) clearSearch(); else if (picked.size) clearPicked();
    } else if (ev.key === "+" || ev.key === "=") zoomAt(W / 2, H / 2, 1.25);
    else if (ev.key === "-" || ev.key === "_") zoomAt(W / 2, H / 2, 0.8);
    else if (ev.key === "Home") animateTo(fitTarget());
    else if (ev.key === "`") setEdit(!state.edit);
  });

  // ---------------------------------------------------------------------------
  // Tooltip, panel, HUD
  // ---------------------------------------------------------------------------
  const tooltip = document.getElementById("tooltip");
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  function showTooltip(m, x, y) {
    const lr = levelRange(m);
    const d = mapDiff(m);
    let html = `<b>${esc(m.name)}</b>`;
    if (lr) {
      html += `<div class="tt-lv"><span class="chip" style="background:${DIFF[d].color}"></span>Lv ${lr.min}${lr.max !== lr.min ? "–" + lr.max : ""} · ${DIFF[d].label}</div>`;
    } else if (m.type === "town") html += `<div>Town</div>`;
    html += selectedHereHtml(m);
    tooltip.innerHTML = html;
    tooltip.style.display = "block";
    const tw = tooltip.offsetWidth, th = tooltip.offsetHeight;
    tooltip.style.left = Math.min(x + 14, W - tw - 8) + "px";
    tooltip.style.top = Math.min(y + 14, H - th - 8) + "px";
  }
  function hideTooltip() { tooltip.style.display = "none"; }

  // Light blue tooltip section: which selected monsters, items and NPCs are on map m (or
  // in its buildings). Each selected item is listed under the monster here that drops it.
  function selectedHereHtml(m) {
    const sel = state.sel;
    if (!sel || (!sel.mobs.size && !sel.items.length && !sel.npcs.size)) return "";
    const here = [m, ...(buildingsOf.get(m) || [])];
    const mobNames = [...new Set(here.flatMap((x) => mobList(x).map((mob) => mob.name)))];
    const rows = [];
    for (const name of mobNames) {
      const items = sel.items.filter((it) => it.mobs.has(name)).map((it) => it.name);
      if (sel.mobs.has(name) || items.length) rows.push({ name, items });
    }
    const npcs = here.flatMap((x) => (window.MINIMAP_INFO?.[x.mapId]?.npcs || []).map(([, , name]) => name))
      .filter((name, i, a) => sel.npcs.has(name) && a.indexOf(name) === i);
    if (!rows.length && !npcs.length) return "";
    let h = `<div class="tt-hits">`;
    for (const r of rows) {
      h += `<div class="tt-hit">${esc(r.name)}</div>`;
      if (r.items.length) h += `<ul>${r.items.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>`;
    }
    for (const name of npcs) h += `<div class="tt-hit">${esc(npcLabel(name))} <span class="tt-kind">NPC</span></div>`;
    return h + `</div>`;
  }

  const TYPE_LABEL = { town: "Town", field: "Field", hidden: "Hidden Street", dungeon: "Dungeon", boss: "Boss", safe: "Safe zone", building: "Building" };
  const panelBody = document.getElementById("panelBody");

  // A building can't be selected on the map: selecting one selects its host and opens the
  // building as a sub-pane of the host's panel (panelSub), with a Back button.
  let panelSub = null;
  function select(m, fly = true) {
    const sub = m && hostOf.has(m) ? m : null;
    if (sub) m = hostOf.get(sub);
    panelSub = sub;
    state.selected = m;
    needsDraw = true;
    document.body.classList.toggle("panel-open", !!m);
    document.getElementById("panel").setAttribute("aria-hidden", m ? "false" : "true");
    const shown = sub || m;
    try { history.replaceState(null, "", shown ? `#map=${encodeURIComponent(shown.id)}` : location.pathname + location.search); } catch (_) { /* file:// may refuse */ }
    if (!m) return;
    renderPanel(m);
    if (fly) flyTo(m);
  }

  // Open (or close, with null) a building sub-pane inside the current host's panel.
  function openSub(b) {
    if (!state.selected) return;
    panelSub = b;
    const shown = b || state.selected;
    try { history.replaceState(null, "", `#map=${encodeURIComponent(shown.id)}`); } catch (_) { /* ignore */ }
    renderPanel(state.selected);
    document.getElementById("panel").scrollTop = 0;
  }

  function renderPanel(host) {
    const m = panelSub && hostOf.get(panelSub) === host ? panelSub : host;
    const inSub = m !== host;
    const region = DATA.regions[m.region]?.name || m.region;
    const lr = levelRange(m);
    const d = mapDiff(m);
    let h = inSub ? `<button class="p-back" data-back>← Back to ${esc(host.name)}</button>` : "";
    h += `<div class="p-badges"><span class="badge ${m.type}">${TYPE_LABEL[m.type] || m.type}</span>`;
    if (m.layer === "underground") h += `<span class="badge underground">Underground</span>`;
    h += m.verified
      ? `<span class="badge verified" title="Checked against meowDB">✓ meowDB</span>`
      : `<span class="badge draft" title="Written from memory; not checked yet">Unverified</span>`;
    const idHtml = m.mapId
      ? ` · <a href="https://meowdb.com/msclassic/maps/${encodeURIComponent(m.mapId)}" target="_blank" rel="noopener">Map ${esc(m.mapId)} ↗</a>`
      : "";
    const street = m.street && m.street !== region ? `${esc(m.street)} · ` : "";
    h += `</div><h2>${esc(m.name)}</h2><div class="p-sub">${street}${esc(region)}${idHtml}</div>`;

    if (lr) {
      const c = DIFF[d];
      h += `<div class="p-level" style="background:${c.color}33;border-color:${c.color}">
        <span class="chip" style="background:${c.color}"></span>
        <span class="big">Lv ${lr.min}${lr.max !== lr.min ? "–" + lr.max : ""}</span>
        <span class="verdict">${c.label}<br><span class="muted">at level ${state.level}</span></span></div>`;
    } else if (!inSub) {
      h += `<p class="muted" style="margin-top:14px">${m.type === "town" ? "Town — no monsters." : "No monsters here."}</p>`;
    }

    h += minimapHtml(m);

    // A host lists its buildings; each opens as a sub-pane.
    const blds = !inSub ? buildingsOf.get(m) || [] : [];
    if (blds.length) {
      h += `<section><h3>Buildings (${blds.length})</h3><div class="links">`;
      for (const b of blds) {
        const blr = levelRange(b);
        h += `<button class="link-btn" data-building="${esc(b.id)}"><span class="chip building-chip"></span>
          <span>${esc(b.name)}</span><span class="lv">${blr ? `Lv ${blr.min}${blr.max !== blr.min ? "–" + blr.max : ""}` : "›"}</span></button>`;
      }
      h += `</div></section>`;
    }

    const ml = mobList(m);
    if (ml.length) {
      h += `<section><h3>Monsters</h3><ul class="mob-list">`;
      for (const mob of ml.sort((p, q) => p.level - q.level)) {
        const md = diffFor(mob.level, state.level);
        const stats = [mob.hp ? `${mob.hp.toLocaleString()} HP` : "", mob.exp ? `${mob.exp} EXP` : "", mob.count ? `×${mob.count}` : ""]
          .filter(Boolean).join(" · ");
        const name = mob.meowdbId
          ? `<a href="https://meowdb.com/msclassic/monsters/${mob.meowdbId}" target="_blank" rel="noopener">${esc(mob.name)}</a>`
          : esc(mob.name);
        h += `<li data-mob-name="${esc(mob.name)}"><span class="chip" style="background:${DIFF[md].color}"></span>
          <span class="mob-name">${name}${mob.boss ? '<span class="boss-tag">BOSS</span>' : ""}${stats ? `<br><span class="stats">${stats}</span>` : ""}<span class="sel-drops" hidden></span></span>
          <span class="lv">Lv ${mob.level}</span><span class="why">${DIFF[md].label}</span></li>`;
      }
      h += `</ul></section>`;
    }

    // Buildings are listed above, not here.
    const nb = (neighbors.get(m.id) || []).filter(({ map: n }) => !hostOf.has(n));
    h += `<section><h3>Connected maps (${nb.length})</h3>`;
    if (nb.length) {
      h += `<div class="links">`;
      for (const { map: n, via } of nb) {
        const nlr = levelRange(n), nd = mapDiff(n);
        const col = nd ? DIFF[nd].color : n.type === "town" ? "#3aa0ff" : "#a9cbe8";
        const nb2 = (buildingsOf.get(n) || []).length;
        const sub = [via, nb2 ? `${nb2} building${nb2 === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
        h += `<button class="link-btn" data-goto="${esc(n.id)}"><span class="chip" style="background:${col}"></span>
          <span>${esc(n.name)}${sub ? `<br><span class="via">${esc(sub)}</span>` : ""}</span>
          <span class="lv">${nlr ? `Lv ${nlr.min}${nlr.max !== nlr.min ? "–" + nlr.max : ""}` : TYPE_LABEL[n.type] || ""}</span></button>`;
      }
      h += `</div>`;
    } else h += `<p class="muted">None recorded yet.</p>`;
    h += `</section>`;
    h += npcHtml(m, inSub);

    if (m.exits && m.exits.length) {
      h += `<section><h3>Leads off this map</h3><div class="links">`;
      for (const x of m.exits) {
        h += `<a class="link-btn" href="https://meowdb.com/msclassic/maps/${encodeURIComponent(x.mapId)}" target="_blank" rel="noopener">
          <span>${esc(x.name)}<br><span class="via">${esc(x.region)}</span></span><span class="lv">meowDB ↗</span></a>`;
      }
      h += `</div></section>`;
    }

    if (m.notes) h += `<section><h3>Notes</h3><div class="p-notes">${esc(m.notes)}</div></section>`;
    h += `<div class="p-meta">id: ${esc(m.id)} · x ${m.x}, y ${m.y}</div>`;
    panelBody.innerHTML = h;
    paintNpcs();
    paintMobs();
  }

  // Marks monster rows that the search selects ("found"): typed or picked monsters, and
  // monsters that drop a typed item, with a "Drops <item>" line under their stats.
  function paintMobs() {
    const sel = state.sel;
    for (const row of panelBody.querySelectorAll("li[data-mob-name]")) {
      const name = row.dataset.mobName;
      const items = sel ? sel.items.filter((it) => it.mobs.has(name)).map((it) => it.name) : [];
      row.classList.toggle("found", !!sel && (sel.mobs.has(name) || items.length > 0));
      const note = row.querySelector(".sel-drops");
      note.textContent = items.length ? `Drops ${items.join(", ")}` : "";
      note.hidden = !items.length;
    }
  }

  // meowDB minimap (data/minimap_info.js, from tools/scrape_minimaps.py) with a pin on each
  // portal. Pins to maps we have are buttons that open that map's panel; others link to
  // meowDB. The data script loads deferred and the image lazily, so read them at render time.
  let byMapId = null;
  function minimapHtml(m) {
    const info = window.MINIMAP_INFO && window.MINIMAP_INFO[m.mapId];
    const v = info && info.minimap;
    if (!v || !v.img || !v.w || !v.h) return "";
    if (!byMapId) byMapId = new Map(maps.map((x) => [x.mapId, x]));
    // Game (x, y) -> percent of the image; the minimap spans w x h game units from (-cx, -cy).
    const pct = (val, c, size) => Math.max(0, Math.min(100, ((val + c) / size) * 100)).toFixed(2);
    let pins = "";
    for (const [x, y, to, toName] of info.portals) {
      if (!to || to === "999999999" || to === m.mapId) continue;
      // Some building portals use a different map id than ours (Henesys's Yellow Mushroom
      // House is 088000000 on meowDB, 010001008 here), so fall back to a building's name.
      const t = byMapId.get(to) || (buildingsOf.get(m) || []).find((b) => b.name === toName);
      const name = t ? t.name : toName || to;
      const left = pct(x, v.cx, v.w);
      const pos = `left:${left}%;top:${pct(y, v.cy, v.h)}%`;
      // The hover label (CSS, from data-name) lines up with the minimap's nearer side for
      // pins in its outer thirds, so long names stay inside the panel.
      const edge = left < 34 ? " edge-l" : left > 66 ? " edge-r" : "";
      if (t) {
        const kind = hostOf.has(t) ? " to-building" : "";
        pins += `<button class="mm-portal${kind}${edge}" style="${pos}" data-portal="${esc(t.id)}" data-key="${esc(t.mapId)}" data-name="${esc(name)}" aria-label="Go to ${esc(name)}"></button>`;
      } else {
        pins += `<a class="mm-portal off${edge}" style="${pos}" href="https://meowdb.com/msclassic/maps/${encodeURIComponent(to)}" target="_blank" rel="noopener" data-key="${esc(to)}" data-name="${esc(name)} ↗" aria-label="${esc(name)} on meowDB"></a>`;
      }
    }
    // NPC dots, keyed like the NPC list's rows; put before the portal pins so pins stay on top.
    info.npcs.forEach(([x, y, name], i) => {
      const left = pct(x, v.cx, v.w);
      const edge = left < 34 ? " edge-l" : left > 66 ? " edge-r" : "";
      pins = `<span class="mm-npc${edge}" style="left:${left}%;top:${pct(y, v.cy, v.h)}%" data-npc="${esc(m.mapId)}:${i}" data-npc-name="${esc(name)}" data-name="${esc(name)}"></span>` + pins;
    });
    const ar = v.imgW && v.imgH ? ` style="aspect-ratio:${v.imgW}/${v.imgH}"` : "";
    return `<section><h3>Minimap</h3><div class="minimap"${ar}>
      <img src="${esc(v.img)}" alt="Minimap of ${esc(m.name)}" loading="lazy" decoding="async">${pins}</div></section>`;
  }

  // NPCs on this map, plus (for a host) those inside its buildings. Each row is keyed
  // "<mapId>:<index in that map's npcs>", the same key as its minimap dot; a building's NPC
  // has no dot on the host's minimap, so it stands for the building's portal pin instead.
  let npcHover = null;    // NPC key under the mouse (row or dot)
  let npcBldHover = null; // building map id whose portal pin is under the mouse
  let npcPicked = null;   // NPC key clicked in the list (stays lit until clicked again)
  let mapPicked = null;   // building / connected map (our id) clicked in the list; one pick at a time
  let npcPanelMap = null; // map the NPC list was last drawn for
  function npcHtml(m, inSub) {
    if (npcPanelMap !== m) { npcPanelMap = m; npcPicked = mapPicked = null; npcHover = null; }
    const info = window.MINIMAP_INFO;
    if (!info) return "";
    const rows = [];
    const add = (map, bld) => (info[map.mapId]?.npcs || []).forEach(([, , name], i) => rows.push({ key: `${map.mapId}:${i}`, name, bld }));
    add(m, null);
    if (!inSub) for (const b of buildingsOf.get(m) || []) add(b, b);
    if (!rows.length) return "";
    let h = `<section><h3>NPCs (${rows.length})</h3><div class="links">`;
    for (const r of rows) {
      h += `<button class="link-btn npc-row" data-npc="${esc(r.key)}" data-npc-name="${esc(r.name)}"${r.bld ? ` data-bld="${esc(r.bld.mapId)}"` : ""}>
        <span class="chip npc-chip"></span><span>${esc(r.name)}${STATIONS[r.name] ? `<br><span class="via">${STATIONS[r.name]} station</span>` : ""}${r.bld ? `<br><span class="via">in ${esc(r.bld.name)}</span>` : ""}</span></button>`;
    }
    return h + `</div></section>`;
  }

  // Marks NPC rows, dots and building pins from the hover, the clicked row and the search:
  // "hl" for hover/click, "found" for an NPC the search box matches. A building NPC marks
  // its building's pin.
  function paintNpcs() {
    const found = state.npcHit ? state.npcHit.names : null;
    const hlBld = new Set(), foundBld = new Set();
    for (const row of panelBody.querySelectorAll(".npc-row")) {
      const k = row.dataset.npc, b = row.dataset.bld;
      const hl = k === npcHover || k === npcPicked || (!!b && b === npcBldHover);
      const fd = !!found && found.has(row.dataset.npcName);
      row.classList.toggle("hl", hl);
      row.classList.toggle("found", fd);
      row.classList.toggle("picked", k === npcPicked);
      if (b && (k === npcHover || k === npcPicked)) hlBld.add(b);
      if (b && fd) foundBld.add(b);
    }
    for (const dot of panelBody.querySelectorAll(".mm-npc")) {
      dot.classList.toggle("hl", dot.dataset.npc === npcHover || dot.dataset.npc === npcPicked);
      dot.classList.toggle("found", !!found && found.has(dot.dataset.npcName));
    }
    // The clicked building / connected-map row and the pins leading there.
    const pickedKey = mapPicked ? byId.get(mapPicked)?.mapId : null;
    for (const row of panelBody.querySelectorAll("[data-building], [data-goto]")) {
      row.classList.toggle("picked", (row.dataset.building || row.dataset.goto) === mapPicked);
    }
    for (const pin of panelBody.querySelectorAll(".mm-portal")) {
      pin.classList.toggle("npc-hl", hlBld.has(pin.dataset.key));
      pin.classList.toggle("npc-found", foundBld.has(pin.dataset.key));
      pin.classList.toggle("picked", !!pickedKey && pin.dataset.key === pickedKey);
    }
  }
  panelBody.addEventListener("mouseover", (ev) => {
    const n = ev.target.closest("[data-npc]");
    const pin = ev.target.closest(".mm-portal");
    const k = n ? n.dataset.npc : null, b = pin ? pin.dataset.key : null;
    if (k !== npcHover || b !== npcBldHover) { npcHover = k; npcBldHover = b; paintNpcs(); }
  });
  panelBody.addEventListener("mouseleave", () => { npcHover = npcBldHover = null; paintNpcs(); });

  // Deferred scripts run just before DOMContentLoaded, after a panel opened from the URL.
  if (!window.MINIMAP_INFO) document.addEventListener("DOMContentLoaded", () => { if (state.selected) renderPanel(state.selected); });

  // Open map `t` in the panel: a building of the current host opens as its sub-pane, the
  // host itself from one of its buildings is "Back", anything else is selected.
  function goToMap(t) {
    if (!t) return;
    if (state.selected && hostOf.get(t) === state.selected) { openSub(t); return; }
    if (panelSub && t === state.selected) { openSub(null); return; }
    reveal(t); select(t);
  }

  // Hovering a pin lights every pin on this minimap that leads to the same map (they show
  // their labels together) and rings that map on the world map (a building's host, since
  // buildings aren't drawn).
  // The reverse works too: hovering a node on the world map lights the pins leading to it.
  function lightKey(key) { // key: the target's meowDB map id
    for (const p of panelBody.querySelectorAll(".mm-portal")) p.classList.toggle("lit", !!key && p.dataset.key === key);
  }
  function lightPins(pin) {
    lightKey(pin ? pin.dataset.key : null);
    const t = pin && pin.dataset.portal ? byId.get(pin.dataset.portal) : null;
    const node = t ? hostOf.get(t) || t : null;
    if (node !== state.portalHover) { state.portalHover = node; needsDraw = true; }
  }
  // A pin lights itself and its twins; a building or connected-map row lights the pins
  // that lead there (a connected-map row also lights its node on the world map).
  function lightFrom(el) {
    const pin = el.closest(".mm-portal");
    if (pin) { lightPins(pin); return; }
    lightPins(null);
    const row = el.closest("[data-building], [data-goto]");
    const t = row ? byId.get(row.dataset.building || row.dataset.goto) : null;
    if (!t) return;
    lightKey(t.mapId);
    if (row.dataset.goto) { state.portalHover = t; needsDraw = true; }
  }
  panelBody.addEventListener("mouseover", (ev) => lightFrom(ev.target));
  panelBody.addEventListener("mouseleave", () => lightPins(null));
  panelBody.addEventListener("focusin", (ev) => lightFrom(ev.target));
  panelBody.addEventListener("focusout", () => lightPins(null));

  function showMinimap() {
    const mm = panelBody.querySelector(".minimap");
    (mm?.closest("section") || mm)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // Clicks in the panel:
  // - a minimap pin opens its map;
  // - a list row (NPC, building, connected map) is picked: it and its spot on the minimap
  //   stay lit and the minimap scrolls into view. Clicking a picked NPC unpicks it; clicking
  //   a picked building / map opens it. A map with no pin on the minimap opens at once.
  panelBody.addEventListener("click", (ev) => {
    const npc = ev.target.closest("[data-npc]");
    if (npc) {
      npcPicked = npcPicked === npc.dataset.npc ? null : npc.dataset.npc;
      mapPicked = null;
      paintNpcs();
      if (npcPicked && npc.classList.contains("npc-row")) showMinimap();
      return;
    }
    const pt = ev.target.closest("[data-portal]");
    const row = pt ? null : ev.target.closest("[data-building], [data-goto]");
    if (row) {
      const id = row.dataset.building || row.dataset.goto, t = byId.get(id);
      const hasPin = !!t && [...panelBody.querySelectorAll(".mm-portal")].some((p) => p.dataset.key === t.mapId);
      if (hasPin && mapPicked !== id) {
        mapPicked = id; npcPicked = null;
        paintNpcs();
        showMinimap();
        return;
      }
    }
    lightPins(null); // the panel is about to be redrawn
    if (ev.target.closest("[data-back]")) { openSub(null); return; }
    if (pt) { goToMap(byId.get(pt.dataset.portal)); return; }
    const bld = ev.target.closest("[data-building]");
    if (bld) { openSub(byId.get(bld.dataset.building)); return; }
    const b = ev.target.closest("[data-goto]");
    if (b) goToMap(byId.get(b.dataset.goto));
  });
  document.getElementById("panelClose").addEventListener("click", () => select(null));

  // Level controls
  const lvlNum = document.getElementById("lvlNum"), lvlRange = document.getElementById("lvlRange");
  function setLevel(v) {
    state.level = clampInt(v, 1, MAX_LEVEL);
    lvlNum.value = lvlRange.value = state.level;
    renderLegend();
    if (state.selected) renderPanel(state.selected);
    if (!document.getElementById("mobDialog").hidden) renderPicker(); // name colours follow level
    needsDraw = true;
    savePrefs();
  }
  lvlNum.addEventListener("change", () => setLevel(lvlNum.value));
  lvlRange.addEventListener("input", () => setLevel(lvlRange.value));

  const showHidden = document.getElementById("showHidden"), labelModeInput = document.getElementById("labelMode");
  const LABEL_MODES = ["none", "smart", "all"];
  showHidden.checked = state.showHidden;
  const syncLabelTicks = () => {
    document.querySelectorAll("#labelTicks span").forEach((s, i) => s.classList.toggle("on", LABEL_MODES[i] === state.labelMode));
  };
  labelModeInput.value = LABEL_MODES.indexOf(state.labelMode);
  syncLabelTicks();
  labelModeInput.addEventListener("input", () => {
    state.labelMode = LABEL_MODES[+labelModeInput.value] || "smart";
    syncLabelTicks();
    needsDraw = true; savePrefs();
  });
  document.querySelectorAll("#labelTicks span").forEach((s, i) => s.addEventListener("click", () => {
    labelModeInput.value = i;
    labelModeInput.dispatchEvent(new Event("input"));
  }));
  showHidden.addEventListener("change", () => {
    state.showHidden = showHidden.checked;
    if (state.selected && !isVisible(state.selected)) select(null);
    needsDraw = true; savePrefs();
  });
  const showForgottenHollow = document.getElementById("showForgottenHollow");
  showForgottenHollow.checked = state.showForgottenHollow;
  showForgottenHollow.addEventListener("change", () => {
    state.showForgottenHollow = showForgottenHollow.checked;
    if (state.selected && !isVisible(state.selected)) select(null);
    needsDraw = true; savePrefs();
  });

  // Turn on whatever toggles a map needs to be shown (used when jumping to it).
  function reveal(m) {
    if (m && hostOf.has(m)) m = hostOf.get(m); // a building shows through its host
    if (!m || isVisible(m)) return;
    if (m.area === "forgotten_hollow") state.showForgottenHollow = showForgottenHollow.checked = true;
    if (m.type === "hidden") state.showHidden = showHidden.checked = true;
    needsDraw = true; savePrefs();
  }

  // ---------------------------------------------------------------------------
  // Search and monster picker.
  // - The HUD search box takes typing (also from anywhere on the map): from
  //   SEARCH_MIN_CHARS characters, monsters, items and NPCs whose name starts with the text
  //   get their maps ringed when SEARCH_MAX_MOBS or fewer match; Enter jumps to a map or
  //   zooms to the rings.
  // - The icon at the right of the box opens "Find anything": monster cards (sprite,
  //   name coloured by difficulty, level) sorted by level. Pick any number; every map with
  //   a picked monster gets a ring. Its filter also offers map-name chips.
  // Rings come from the typing and the picks together (see updateHighlight).
  // ---------------------------------------------------------------------------
  const search = document.getElementById("search");
  const searchHint = document.getElementById("searchHint");
  const hintTyped = document.getElementById("hintTyped"), hintTypedText = document.getElementById("hintTypedText");
  const hintPicked = document.getElementById("hintPicked"), hintPickedText = document.getElementById("hintPickedText");
  const pickedChips = document.getElementById("pickedChips"), pickerTabs = document.getElementById("pickerTabs");
  const mobDialog = document.getElementById("mobDialog"), mobFilter = document.getElementById("mobFilter");
  const mobGrid = document.getElementById("mobGrid"), mapChips = document.getElementById("mapChips");
  const mobSelInfo = document.getElementById("mobSelInfo"), pickerBtn = document.getElementById("pickerBtn");
  const MOB_IMAGES = window.MOB_IMAGES || {};

  const mapsByMob = new Map(); // monster id -> maps it spawns on
  for (const m of maps) {
    for (const x of mobList(m)) {
      if (!mobs[x.id]) continue;
      if (!mapsByMob.has(x.id)) mapsByMob.set(x.id, []);
      if (!mapsByMob.get(x.id).includes(m)) mapsByMob.get(x.id).push(m);
    }
  }

  // One entry per monster name (same-name variants, like the two Zombie Mushroom levels,
  // are merged), only monsters that spawn somewhere, sorted by level then name.
  const mobGroups = (() => {
    const byName = new Map();
    for (const id of mapsByMob.keys()) {
      const name = mobs[id].name;
      if (!byName.has(name)) byName.set(name, { name, ids: [] });
      byName.get(name).ids.push(id);
    }
    return [...byName.values()].map((g) => {
      const levels = [...new Set(g.ids.map((id) => mobs[id].level))].sort((a, b) => a - b);
      const onMaps = new Set(g.ids.flatMap((id) => mapsByMob.get(id)));
      return { ...g, levels, level: levels[0], maps: onMaps, img: g.ids.map((id) => MOB_IMAGES[id]).find(Boolean) || null, boss: g.ids.some((id) => mobs[id].boss) };
    }).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  })();
  const groupByName = new Map(mobGroups.map((g) => [g.name, g]));

  // Common drops (data/drops.js, from tools/scrape_drops.py): ETC items with a meowDB
  // community vote score of 3 or more. A monster group's drops merge its variants'.
  const DROPS = window.WORLD_DROPS || { items: {}, mobs: {} };
  function dropsOf(ids) {
    const byName = new Map();
    for (const id of ids) {
      for (const [itemId, score, osm] of DROPS.mobs[id] || []) {
        const it = DROPS.items[itemId];
        if (!it) continue;
        const old = byName.get(it.name);
        if (!old || score > old.score) byName.set(it.name, { ...it, id: itemId, score, osm: osm ?? old?.osm ?? null });
      }
    }
    return [...byName.values()].sort((a, b) => b.score - a.score);
  }
  for (const g of mobGroups) g.drops = dropsOf(g.ids);

  // One entry per item name: the monster groups that drop it and the maps they spawn on.
  const itemGroups = (() => {
    const byName = new Map();
    for (const g of mobGroups) {
      for (const d of g.drops) {
        if (!byName.has(d.name)) byName.set(d.name, { name: d.name, icon: d.icon, mobs: [] });
        byName.get(d.name).mobs.push(g.name);
      }
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  })();
  const itemByName = new Map(itemGroups.map((it) => [it.name, it]));

  // Crafting stations are NPCs on the minimaps; these also match their craft's name
  // (and "crafting station"), so "smithing" finds the Anvil.
  const STATIONS = {
    "Anvil": "Smithing", "Weaponcrafting Station": "Weaponcrafting", "Sewing Machine": "Tailoring",
    "Woodcrafting Station": "Woodcrafting", "Leatherworking Station": "Leatherworking", "Arcane Station": "Arcforge",
  };
  const npcLabel = (name) => (STATIONS[name] ? `${name} (${STATIONS[name]})` : name);

  // Picks in the dialog, one set per tab. Picked NPCs ring their maps; picked items ring
  // the maps of every monster that drops them.
  const picked = new Set();      // monster names
  const pickedNpcs = new Set();  // NPC names
  const pickedItems = new Set(); // item names
  const PICK_TABS = [["mobs", "Monsters"], ["npcs", "NPCs"], ["items", "Items"]];
  const pickSets = { mobs: picked, npcs: pickedNpcs, items: pickedItems };
  const pickCount = () => picked.size + pickedNpcs.size + pickedItems.size;
  let pickerTab = "mobs";
  let previewNames = [];    // dialog-filter monster matches shown while nothing is picked
  let typed = { q: "", mobs: [], npcs: [], items: [], maps: [] }; // what the HUD search box currently matches

  const SEARCH_MIN_CHARS = 2, SEARCH_MAX_MOBS = 3; // NPC names follow the same rules

  // One entry per NPC name, with the maps to ring (an NPC in a building rings its host).
  // NPCs come from data/minimap_info.js, which loads deferred, so this is built on first use.
  let npcGroups = null;
  function getNpcGroups() {
    if (npcGroups) return npcGroups;
    if (!window.MINIMAP_INFO) return [];
    const byName = new Map();
    for (const m of maps) {
      for (const [, , name] of window.MINIMAP_INFO[m.mapId]?.npcs || []) {
        if (!byName.has(name)) {
          const craft = STATIONS[name];
          const keys = [name, ...(craft ? [craft, `${craft} station`, "crafting station"] : [])].map((k) => k.toLowerCase());
          byName.set(name, { name, keys, station: !!craft, maps: new Set() });
        }
        byName.get(name).maps.add(hostOf.get(m) || m);
      }
    }
    return (npcGroups = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)));
  }

  // Monster, item and NPC names and maps whose names start with q (maps also ignoring a
  // leading "The"; crafting stations also by craft name).
  function prefixMatches(raw) {
    const q = raw.trim().toLowerCase();
    if (q.length < SEARCH_MIN_CHARS) return { q, mobs: [], npcs: [], items: [], maps: [] };
    const starts = (g) => g.name.toLowerCase().startsWith(q);
    return {
      q,
      mobs: mobGroups.filter(starts).map((g) => g.name),
      npcs: getNpcGroups().filter((g) => g.keys.some((k) => k.startsWith(q))).map((g) => g.name),
      items: itemGroups.filter(starts).map((it) => it.name),
      maps: mapMatches(q),
    };
  }

  function filterText() { return mobFilter.value.trim().toLowerCase(); }
  function mobMatchesFilter(g, q) {
    if (!q) return true;
    const n = g.name.toLowerCase();
    return n.includes(q) || g.drops.some((d) => d.name.toLowerCase().includes(q)); // "branch" finds Stumps
  }
  // NPCs match by name or, for crafting stations, by craft ("smith" finds the Anvil).
  const npcMatchesFilter = (g, q) => !q || g.keys.some((k) => k.includes(q));
  const itemMatchesFilter = (it, q) => !q || it.name.toLowerCase().includes(q);
  // The picker's cards on one tab that match the filter text q.
  function tabEntries(tab, q) {
    if (tab === "npcs") return getNpcGroups().filter((g) => npcMatchesFilter(g, q));
    if (tab === "items") return itemGroups.filter((it) => itemMatchesFilter(it, q));
    return mobGroups.filter((g) => mobMatchesFilter(g, q));
  }
  const npcGroupByName = (name) => getNpcGroups().find((g) => g.name === name);
  function mapMatches(q) {
    if (q.length < SEARCH_MIN_CHARS) return [];
    return maps.filter((x) => { const n = x.name.toLowerCase(); return n.startsWith(q) || n.replace(/^the /, "").startsWith(q); })
      .sort((a, b) => a.name.length - b.name.length);
  }

  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const typedRings = () => (typed.mobs.length && typed.mobs.length <= SEARCH_MAX_MOBS ? typed.mobs : []);

  // Maps that a list of monster groups rings. A monster inside a building rings the
  // building's host (buildings aren't drawn).
  const ringMaps = (groups) => new Set(groups.flatMap((g) => [...g.maps].map((m) => hostOf.get(m) || m)));

  // Rings come from the typing and the picks together (plus the dialog filter's preview
  // while nothing is picked). The box under the search bar lists each in its own row.
  function updateHighlight() {
    // A typed item rings the maps of every monster that drops it.
    const mobTyped = typedRings();
    const itemGs = (typed.items.length <= SEARCH_MAX_MOBS ? typed.items : []).map((n) => itemByName.get(n)).filter(Boolean);
    const fromTyping = [...new Set([...mobTyped, ...itemGs.flatMap((it) => it.mobs)])];
    // Picks: monsters, plus the monsters that drop picked items (or the dialog preview).
    const pickedItemGs = [...pickedItems].map((n) => itemByName.get(n)).filter(Boolean);
    const pickedNpcGs = [...pickedNpcs].map(npcGroupByName).filter(Boolean);
    const fromPicks = pickCount() ? [...picked, ...pickedItemGs.flatMap((it) => it.mobs)] : previewNames;
    const groups = [...new Set([...fromTyping, ...fromPicks])].map((n) => groupByName.get(n)).filter(Boolean);
    state.mobHit = groups.length ? { ids: groups.flatMap((g) => g.ids), maps: ringMaps(groups) } : null;
    const typedMaps = ringMaps(fromTyping.map((n) => groupByName.get(n)).filter(Boolean)).size;
    const pickedMobGroups = [...new Set([...picked, ...pickedItemGs.flatMap((it) => it.mobs)])].map((n) => groupByName.get(n)).filter(Boolean);
    const pickedMaps = new Set([...ringMaps(pickedMobGroups), ...pickedNpcGs.flatMap((g) => [...g.maps])]).size;

    // NPCs: typed (crafting stations ring together however many match: "crafting station"
    // finds all six) and picked.
    const isStation = (name) => !!STATIONS[name];
    const npcRings = typed.npcs.length <= SEARCH_MAX_MOBS || typed.npcs.every(isStation) ? typed.npcs : [];
    const npcGs = npcRings.map(npcGroupByName).filter(Boolean);
    const allNpcGs = [...new Set([...npcGs, ...pickedNpcGs])];
    state.npcHit = allNpcGs.length ? { names: new Set(allNpcGs.map((g) => g.name)), maps: new Set(allNpcGs.flatMap((g) => [...g.maps])) } : null;
    paintNpcs(); // the open panel marks the found NPCs too
    // What's selected, for the map tooltip's "on this map" section.
    const selItems = [...new Map([...itemGs, ...pickedItemGs].map((it) => [it.name, it])).values()];
    state.sel = {
      mobs: new Set([...mobTyped, ...picked]),
      items: selItems.map((it) => ({ name: it.name, mobs: new Set(it.mobs) })),
      npcs: new Set(allNpcGs.map((g) => g.name)),
    };
    paintMobs(); // and the open panel's monster rows

    const n = pickCount();
    mobSelInfo.textContent = n ? `${n} picked · ${plural(pickedMaps, "map")}` : "Pick monsters, NPCs or items to see where they are";

    // Typed row: what the typing matches.
    const parts = [];
    if (typed.q.length >= SEARCH_MIN_CHARS) {
      const typedNpcMaps = new Set(npcGs.flatMap((g) => [...g.maps])).size;
      const hitParts = [];
      if (mobTyped.length) hitParts.push(mobTyped.map((name) => { const g = groupByName.get(name); return `${g.name} (Lv ${g.levels.join("/")})`; }).join(", "));
      else if (typed.mobs.length) parts.push(`${typed.mobs.length} monsters match, keep typing`);
      if (itemGs.length) hitParts.push(itemGs.map((it) => `${it.name} (from ${it.mobs.join(", ")})`).join(", "));
      else if (typed.items.length) parts.push(`${typed.items.length} items match, keep typing`);
      if (hitParts.length) parts.unshift(`${hitParts.join(", ")} · ${plural(typedMaps, "map")}`);
      if (npcGs.length) parts.push(`NPC ${npcGs.map((g) => npcLabel(g.name)).join(", ")} · ${plural(typedNpcMaps, "map")}`);
      else if (typed.npcs.length) parts.push(`${typed.npcs.length} NPCs match, keep typing`);
      if (typed.maps.length) parts.push(`${plural(typed.maps.length, "map name")} match`);
      if (!parts.length) parts.push("No matches");
    }
    hintTypedText.textContent = parts.join(" · ");
    hintTyped.hidden = !parts.length;
    // Picked row: the picker's selection, every tab.
    const pickedNames = [...picked, ...pickedNpcs, ...pickedItems].map(npcLabel);
    hintPickedText.textContent = n ? `${pickedNames.join(", ")} · ${plural(pickedMaps, "map")}` : "";
    hintPicked.hidden = !n;
    searchHint.hidden = hintTyped.hidden && hintPicked.hidden;

    renderPickedChips();
    pickerBtn.classList.toggle("on", n > 0);
    pickerBtn.title = n ? `${n} picked. Click to change` : "Pick monsters, NPCs or items";
    needsDraw = true;
  }

  // "Selected" chips at the top of the picker (every tab); × on a chip unpicks it.
  function renderPickedChips() {
    const chip = (kind, name, img) => `<button type="button" data-unpick="${kind}" data-name="${esc(name)}" title="Remove ${esc(name)}">${img}<span>${esc(npcLabel(name))}</span><b aria-hidden="true">×</b></button>`;
    const chips = [
      ...[...picked].map((name) => { const g = groupByName.get(name); return chip("mobs", name, g && g.img ? `<img src="${esc(g.img)}" alt="">` : ""); }),
      ...[...pickedNpcs].map((name) => chip("npcs", name, `<span class="chip npc-chip"></span>`)),
      ...[...pickedItems].map((name) => { const it = itemByName.get(name); return chip("items", name, it && it.icon ? `<img src="${esc(it.icon)}" alt="">` : ""); }),
    ];
    pickedChips.hidden = !chips.length;
    pickedChips.innerHTML = chips.length ? `<span class="chip-label">Selected:</span>` + chips.join("") : "";
  }

  // One card per entry on the current tab. Monster cards show a sprite, difficulty colour and
  // level; NPC cards where they are; item cards their icon and which monsters drop them.
  function cardHtml(tab, e) {
    const sel = pickSets[tab].has(e.name) ? " sel" : "";
    const attrs = `type="button" data-kind="${tab}" data-name="${esc(e.name)}"`;
    if (tab === "npcs") {
      const where = [...e.maps].map((m) => m.name);
      const sub = STATIONS[e.name] ? `${STATIONS[e.name]} station · ${plural(where.length, "map")}` : where.slice(0, 2).join(", ") + (where.length > 2 ? ` +${where.length - 2}` : "");
      return `<button ${attrs} class="mob-card npc-card${sel}" title="${esc(`${e.name}: ${where.join(", ")}`)}">
        <div class="sprite small"><span class="chip npc-chip"></span></div>
        <div class="mob-name">${esc(e.name)}</div><div class="mob-lv">${esc(sub)}</div></button>`;
    }
    if (tab === "items") {
      const mapsN = ringMaps(e.mobs.map((n) => groupByName.get(n)).filter(Boolean)).size;
      return `<button ${attrs} class="mob-card item-card${sel}" title="${esc(`${e.name}: dropped by ${e.mobs.join(", ")}`)}">
        <div class="sprite small">${e.icon ? `<img src="${esc(e.icon)}" alt="" loading="lazy">` : ""}</div>
        <div class="mob-name">${esc(e.name)}</div>
        <div class="mob-lv">${esc(e.mobs.length === 1 ? e.mobs[0] : plural(e.mobs.length, "monster"))} · ${plural(mapsN, "map")}</div></button>`;
    }
    const d = diffFor(e.level, state.level);
    const lv = `Lv ${e.levels.join("/")}${e.boss ? " · Boss" : ""}`;
    return `<button ${attrs} class="mob-card${sel}" aria-label="${esc(`${e.name}: ${DIFF[d].label}, on ${plural(e.maps.size, "map")}`)}">
      <div class="sprite">${e.img ? `<img src="${esc(e.img)}" alt="" loading="lazy">` : ""}</div>
      <div class="mob-name" style="color:${DIFF[d].color}">${esc(e.name)}</div>
      <div class="mob-lv">${lv} · ${plural(e.maps.size, "map")}</div></button>`;
  }

  // Tabs (Monsters, NPCs, Items) with their match counts; a tab with no match for the
  // filter text is greyed out but can still be opened.
  function renderPicker() {
    const q = filterText();
    pickerTabs.innerHTML = PICK_TABS.map(([t, label]) => {
      const n = tabEntries(t, q).length, picks = pickSets[t].size;
      const cls = [t === pickerTab ? "on" : "", q && !n ? "empty" : ""].filter(Boolean).join(" ");
      return `<button type="button" role="tab" data-tab="${t}" aria-selected="${t === pickerTab}" class="${cls}">${label}<span class="n">${n}</span>${picks ? `<span class="picks" title="${picks} picked">✓${picks}</span>` : ""}</button>`;
    }).join("");
    const shown = tabEntries(pickerTab, q);
    const label = PICK_TABS.find(([t]) => t === pickerTab)[1];
    mobGrid.className = `mob-grid tab-${pickerTab}`;
    mobGrid.innerHTML = shown.length ? shown.map((e) => cardHtml(pickerTab, e)).join("")
      : `<div class="mob-empty">No matching ${label === "NPCs" ? "NPCs" : label.toLowerCase()}</div>`;

    const mm = mapMatches(q);
    mapChips.hidden = !mm.length;
    mapChips.innerHTML = mm.length ? `<span class="chip-label">Maps:</span>` + mm.slice(0, 8).map((m) => `<button type="button" data-map="${esc(m.id)}">${esc(m.name)}</button>`).join("") : "";

    // Preview on the map while nothing is picked.
    const pre = q.length >= SEARCH_MIN_CHARS ? mobGroups.filter((g) => g.name.toLowerCase().startsWith(q)) : [];
    previewNames = pre.length && pre.length <= SEARCH_MAX_MOBS ? pre.map((g) => g.name) : [];
    updateHighlight();
  }

  // After the filter text changes: if the open tab has nothing matching but another tab
  // does, switch to the first such tab (in tab order).
  function onFilterChange() {
    const q = filterText();
    if (q && !tabEntries(pickerTab, q).length) {
      const other = PICK_TABS.find(([t]) => tabEntries(t, q).length);
      if (other) pickerTab = other[0];
    }
    renderPicker();
  }

  function openMobDialog(initial = "") {
    mobFilter.value = initial;
    mobDialog.hidden = false;
    onFilterChange(); // opens on a tab that matches the typed text
    mobFilter.focus();
    mobFilter.setSelectionRange(mobFilter.value.length, mobFilter.value.length);
  }
  // Popup listing a monster group's common drops, beside the hovered card or panel row.
  const dropTip = document.getElementById("dropTip");
  function showDrops(g, anchor) {
    const d = DIFF[diffFor(g.level, state.level)];
    let h = `<div class="dt-head">${esc(g.name)}</div><div class="dt-sub">Lv ${g.levels.join("/")} · ${d.label} · ${plural(g.maps.size, "map")}</div>`;
    if (g.drops.length) {
      h += `<ul>${g.drops.map((x) => `<li>${x.icon ? `<img src="${esc(x.icon)}" alt="">` : `<span class="dt-noicon"></span>`}
        <span class="dt-name">${esc(x.name)}${x.sub ? `<small>${esc(x.sub)}</small>` : ""}</span>
        ${x.osm != null ? `<span class="dt-rate" title="OSMLib reference rate">${x.osm}%</span>` : ""}</li>`).join("")}</ul>`;
    } else h += `<div class="dt-none">No common ETC drops recorded</div>`;
    dropTip.innerHTML = h;
    dropTip.hidden = false;
    // Right of the anchor if it fits, else left; kept inside the window.
    const r = anchor.getBoundingClientRect(), tw = dropTip.offsetWidth, th = dropTip.offsetHeight;
    const x = r.right + 8 + tw <= innerWidth - 8 ? r.right + 8 : Math.max(8, r.left - 8 - tw);
    dropTip.style.left = x + "px";
    dropTip.style.top = Math.max(8, Math.min(r.top, innerHeight - th - 8)) + "px";
  }
  function hideDrops() { dropTip.hidden = true; }

  function closeMobDialog() {
    hideDrops();
    mobDialog.hidden = true;
    previewNames = [];
    updateHighlight();
    if (pickerFromKeyboard) { pickerFromKeyboard = false; pickerBtn.focus(); }
  }
  function showPickedOnMap() {
    if (!pickCount()) previewNames.forEach((n) => picked.add(n));
    closeMobDialog();
    const hits = [...new Set([...(state.mobHit?.maps || []), ...(state.npcHit?.maps || [])])];
    if (!hits.length) return;
    for (const m of hits) reveal(m);
    select(null);
    animateTo(fitPoints(hits.map((m) => [m.x, m.y]), 90, 1.4));
  }
  function clearPicked() {
    for (const set of Object.values(pickSets)) set.clear();
    previewNames = [];
    if (!mobDialog.hidden) renderPicker(); else updateHighlight();
  }
  // × under the search box: clear the typing if any, else the picks.
  function clearSearch() {
    if (search.value) { search.value = ""; typed = prefixMatches(""); updateHighlight(); }
    else clearPicked();
  }

  // Search box: live rings while typing.
  search.addEventListener("input", () => { typed = prefixMatches(search.value); updateHighlight(); });
  // Enter leaves the box and moves the map: an exact map name opens that map; else it
  // deselects and zooms to the ringed monster/NPC maps; else it opens the first matching map.
  // The rings stay. (Tab then Enter opens the picker instead.)
  search.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter") return;
    ev.preventDefault();
    search.blur();
    typed = prefixMatches(search.value);
    updateHighlight();
    const exact = maps.find((x) => x.name.toLowerCase() === typed.q);
    if (exact) { reveal(exact); select(exact); return; }
    const hits = new Set([...(state.mobHit?.maps || []), ...(state.npcHit?.maps || [])]);
    if (hits.size) {
      for (const m of hits) reveal(m);
      select(null);
      animateTo(fitPoints([...hits].map((m) => [m.x, m.y]), 90, 1.4));
      return;
    }
    if (typed.maps[0]) { reveal(typed.maps[0]); select(typed.maps[0]); }
  });

  // Picker icon: next in tab order after the box. Opens with the typed text as its filter;
  // when opened from the keyboard, focus comes back to the icon on close.
  let pickerFromKeyboard = false;
  pickerBtn.addEventListener("click", (ev) => {
    pickerFromKeyboard = ev.detail === 0; // keyboard "clicks" have no click count
    openMobDialog(search.value.trim());
  });
  pickerBtn.addEventListener("mousedown", (ev) => ev.preventDefault()); // a mouse click doesn't move focus
  document.getElementById("hintTypedClear").addEventListener("click", () => { search.value = ""; typed = prefixMatches(""); updateHighlight(); });
  document.getElementById("hintPickedClear").addEventListener("click", clearPicked);
  pickedChips.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-unpick]");
    if (!b) return;
    pickSets[b.dataset.unpick].delete(b.dataset.name);
    renderPicker(); // unmarks the card and updates the rings
  });
  pickerTabs.addEventListener("click", (ev) => {
    const t = ev.target.closest("button[data-tab]")?.dataset.tab;
    if (!t || t === pickerTab) return;
    pickerTab = t;
    hideDrops();
    renderPicker();
    mobGrid.scrollTop = 0;
  });
  document.getElementById("mobDialogClose").addEventListener("click", closeMobDialog);
  document.getElementById("mobClear").addEventListener("click", clearPicked);
  document.getElementById("mobShow").addEventListener("click", showPickedOnMap);
  mobDialog.addEventListener("click", (ev) => { if (ev.target === mobDialog) closeMobDialog(); });
  mobFilter.addEventListener("input", onFilterChange);
  mobGrid.addEventListener("click", (ev) => {
    const card = ev.target.closest(".mob-card");
    if (!card) return;
    const set = pickSets[card.dataset.kind], name = card.dataset.name;
    if (set.has(name)) set.delete(name); else set.add(name);
    renderPicker(); // card mark, tab pick counts and rings
  });
  mobGrid.addEventListener("mouseover", (ev) => {
    const card = ev.target.closest(".mob-card[data-kind=mobs]");
    const g = card && groupByName.get(card.dataset.name);
    if (g) showDrops(g, card); else hideDrops();
  });
  mobGrid.addEventListener("mouseleave", hideDrops);
  panelBody.addEventListener("mouseover", (ev) => {
    const row = ev.target.closest("li[data-mob-name]");
    const g = row && groupByName.get(row.dataset.mobName);
    if (g) showDrops(g, row); else hideDrops();
  });
  panelBody.addEventListener("mouseleave", hideDrops);
  panelBody.addEventListener("scroll", hideDrops);
  mapChips.addEventListener("click", (ev) => {
    const m = byId.get(ev.target.closest("button[data-map]")?.dataset.map);
    if (!m) return;
    closeMobDialog();
    reveal(m); select(m);
  });
  // Enter: an exact map name jumps there; else show picked (or the previewed) monsters;
  // else jump to the first matching map.
  mobFilter.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); closeMobDialog(); return; }
    if (ev.key !== "Enter") return;
    const q = filterText();
    const exact = maps.find((x) => x.name.toLowerCase() === q);
    if (exact) { closeMobDialog(); reveal(exact); select(exact); return; }
    if (pickCount() || previewNames.length) { showPickedOnMap(); return; }
    const m = mapMatches(q)[0];
    if (m) { closeMobDialog(); reveal(m); select(m); }
    else toast("Pick something, or keep typing");
  });
  mobDialog.addEventListener("keydown", (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); closeMobDialog(); } });
  updateHighlight();

  document.getElementById("zoomCtl").addEventListener("click", (ev) => {
    const z = ev.target.closest("button")?.dataset.zoom;
    const cx = (W - panelWidth()) / 2;
    if (z === "in") animateTo(zoomTarget(cx, H / 2, 1.4), 220);
    else if (z === "out") animateTo(zoomTarget(cx, H / 2, 1 / 1.4), 220);
    else if (z === "fit") animateTo(fitTarget());
  });
  function zoomTarget(sx, sy, f) {
    const s = clamp(cam.s * f, MIN_S, MAX_S);
    const [wx, wy] = screenToWorld(sx, sy);
    return { s, x: sx - wx * s, y: sy - wy * s };
  }

  function renderLegend() {
    const ranges = diffRanges(state.level);
    let h = `<h4>Monster level vs. you (Lv ${state.level})</h4>`;
    for (const k of ORDER) {
      h += `<div class="lg-row" title="${esc(DIFF[k].desc)}"><span class="chip" style="background:${DIFF[k].color}"></span>${DIFF[k].label}<span class="range">${ranges[k]}</span></div>`;
    }
    h += `<div class="shapes">
      <span><svg width="14" height="14"><circle cx="7" cy="7" r="6" fill="#62b7ff" stroke="#0f3a6e" stroke-width="1.5"/></svg>Town</span>
      <span><svg width="14" height="14"><circle cx="7" cy="7" r="5.5" fill="#ddd" stroke="#2b1a0e" stroke-width="1.5"/></svg>Field</span>
      <span><svg width="14" height="14"><path d="M7 1 L13 7 L7 13 L1 7Z" fill="#ddd" stroke="#2b1a0e" stroke-width="1.5" stroke-dasharray="2 1.5"/></svg>Hidden</span>
      <span><svg width="14" height="14"><rect x="1.5" y="1.5" width="11" height="11" rx="3" fill="#ddd" stroke="#2b1a0e" stroke-width="1.5"/></svg>Dungeon</span>
      <span><svg width="14" height="14"><circle cx="7" cy="7" r="6.5" fill="rgba(155,123,234,.6)"/><circle cx="7" cy="7" r="4" fill="#ddd" stroke="#2b1a0e" stroke-width="1.2"/></svg>Underground</span>
    </div>`;
    if (DATA.meta.status === "draft") h += `<div class="note">Draft data: names and levels are approximate.</div>`;
    else if (DATA.meta.crawledAt) h += `<div class="note">Data from meowDB, ${esc(DATA.meta.crawledAt.slice(0, 10))} · ${maps.length} maps</div>`;
    document.getElementById("legend").innerHTML = h;
  }

  // ---------------------------------------------------------------------------
  // Edit mode
  // ---------------------------------------------------------------------------
  const editToggle = document.getElementById("editToggle");
  function setEdit(on) {
    state.edit = on;
    document.body.classList.toggle("editing", on);
    editToggle.classList.toggle("on", on);
    editToggle.textContent = on ? "Done editing" : "Edit layout";
  }
  editToggle.addEventListener("click", () => setEdit(!state.edit));

  // Export map data only; terrain lives in data/terrain.js.
  function dataJSON() {
    const { islands, biomes, rivers, ...rest } = DATA;
    const meta = { ...rest.meta };
    delete meta.width; delete meta.height;
    return JSON.stringify({ ...rest, meta }, null, 1);
  }
  document.getElementById("copyData").addEventListener("click", () => copyText(dataJSON(), "Map data copied"));
  document.getElementById("downloadData").addEventListener("click", () => {
    const text = "// Victoria Island map data (exported from Edit mode).\nwindow.WORLD_DATA = " + dataJSON() + ";\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/javascript" }));
    a.download = "victoria.js";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  function copyText(text, msg) {
    (navigator.clipboard?.writeText(text) || Promise.reject())
      .then(() => toast(msg))
      .catch(() => { console.log(text); toast("Copy failed — printed to console"); });
  }

  let toastTimer = 0;
  function toast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
  }

  // ---------------------------------------------------------------------------
  // Boot
  // ---------------------------------------------------------------------------
  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    if (!userMovedCam && terrain.islands.length) Object.assign(cam, fitTarget());
    needsDraw = true;
  }
  window.addEventListener("resize", resize);

  resize();
  buildTerrain();
  setLevel(state.level);
  Object.assign(cam, fitTarget());

  const hashId = decodeURIComponent((location.hash.match(/map=([^&]+)/) || [])[1] || "");
  if (hashId && byId.has(hashId)) { reveal(byId.get(hashId)); select(byId.get(hashId)); }

  // Redraw once web fonts arrive so canvas text uses them.
  document.fonts?.ready.then(() => { needsDraw = true; });

  requestAnimationFrame(render);

  // Handy for debugging in the console.
  window.worldMap = { DATA, state, cam, routeScore, series, select: (id) => select(byId.get(id)) };
})();
