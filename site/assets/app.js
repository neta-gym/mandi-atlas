/* Mandi Atlas — static single-page app. Data lives in ./data (built by /pipeline). */
(function () {
  "use strict";

  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const TODAY = new Date();
  const NOW_M = TODAY.getMonth(); // 0-based
  const S = { manifest: null, cache: {}, charts: [], route: null };
  const app = document.getElementById("app");

  // ---------- utilities ----------
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const inr = (x, d = 0) => (x == null || isNaN(x) ? "–" : Number(x).toLocaleString("en-IN", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const pct = (x, d = 0) => (x == null ? "–" : (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(d) + "%");
  const kg = (qtl) => (qtl == null ? null : qtl / 100);
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const fmtDate = (iso) => { if (!iso) return "–"; const d = new Date(iso + (iso.length === 7 ? "-01" : "") + "T00:00:00"); return iso.length === 7 ? MON[d.getMonth()] + " " + d.getFullYear() : d.getDate() + " " + MON[d.getMonth()] + " " + d.getFullYear(); };
  const monthName = (t) => { const [y, m] = t.split("-"); return MON[+m - 1] + " " + y; };
  function alpha(color, a) {
    const c = color.replace("#", "");
    if (c.length !== 6) return color;
    const n = parseInt(c, 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  async function j(path) {
    if (S.cache[path]) return S.cache[path];
    const r = await fetch(path, { cache: "no-cache" });
    if (!r.ok) throw new Error(path + " → " + r.status);
    const d = await r.json();
    S.cache[path] = d;
    return d;
  }
  const opt = (p) => j(p).catch(() => null);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  };

  // ---------- theme ----------
  const themeBtn = document.getElementById("themebtn");
  function applyTheme(t) {
    if (t === "light" || t === "dark") document.documentElement.setAttribute("data-theme", t);
    else document.documentElement.removeAttribute("data-theme");
    themeBtn.textContent = t === "dark" ? "Dark" : t === "light" ? "Light" : "Auto";
  }
  applyTheme(store.get("ma-theme"));
  themeBtn.addEventListener("click", () => {
    const cur = store.get("ma-theme");
    const next = cur === "light" ? "dark" : cur === "dark" ? "auto" : "light";
    store.set("ma-theme", next);
    applyTheme(next);
    rerender();
  });
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", rerender);
  let rr;
  function rerender() { clearTimeout(rr); rr = setTimeout(() => render(true), 60); }

  // ---------- charts ----------
  const PALETTE = ["#3b7dd8", "#d8573b", "#3ba55c", "#c99a1a", "#9a5bc4", "#7d8a83", "#d14f9a"];
  function chartDefaults() {
    if (!window.Chart) return;
    Chart.defaults.font.family = css("--f-body") || "sans-serif";
    Chart.defaults.font.size = 12;
    Chart.defaults.color = css("--muted");
    Chart.defaults.borderColor = css("--rule");
    Chart.defaults.plugins.legend.display = false;
    Chart.defaults.plugins.tooltip.backgroundColor = css("--board");
    Chart.defaults.plugins.tooltip.titleColor = css("--board-ink");
    Chart.defaults.plugins.tooltip.bodyColor = css("--board-ink");
    Chart.defaults.plugins.tooltip.padding = 10;
    Chart.defaults.plugins.tooltip.displayColors = false;
    Chart.defaults.maintainAspectRatio = false;
    Chart.defaults.animation = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 350 };
  }
  function mk(id, cfg) {
    const el = document.getElementById(id);
    if (!el || !window.Chart) { if (el) el.parentElement.innerHTML = '<p class="note">Chart library did not load.</p>'; return; }
    S.charts.push(new Chart(el, cfg));
  }
  function killCharts() { S.charts.forEach((c) => c.destroy()); S.charts = []; }
  const gridY = () => ({ color: css("--rule"), drawTicks: false });
  const noGridX = { display: false };

  function sparkSVG(vals, w = 120, h = 30, color = "#7fd9a0") {
    const v = vals.filter((x) => x != null);
    if (v.length < 2) return "";
    const lo = Math.min(...v), hi = Math.max(...v), r = hi - lo || 1;
    const pts = vals.map((x, i) => x == null ? null : [(i / (vals.length - 1)) * (w - 4) + 2, h - 3 - ((x - lo) / r) * (h - 6)]).filter(Boolean);
    const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join("");
    const last = pts[pts.length - 1];
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path d="${d}" fill="none" stroke="${color}" stroke-width="1.6" stroke-linejoin="round"/><circle cx="${last[0]}" cy="${last[1]}" r="2.6" fill="${color}"/></svg>`;
  }

  // ---------- state tile map ----------
  const TILES = [
    ["JK", "Jammu & Kashmir", 2, 0], ["LA", "Ladakh", 3, 0],
    ["PB", "Punjab", 1, 1], ["HP", "Himachal Pradesh", 2, 1], ["UK", "Uttarakhand", 3, 1], ["AR", "Arunachal Pradesh", 7, 1],
    ["RJ", "Rajasthan", 0, 2], ["HR", "Haryana", 1, 2], ["DL", "Delhi", 2, 2], ["UP", "Uttar Pradesh", 3, 2], ["BR", "Bihar", 4, 2], ["SK", "Sikkim", 5, 2], ["AS", "Assam", 6, 2], ["NL", "Nagaland", 7, 2],
    ["GJ", "Gujarat", 0, 3], ["MP", "Madhya Pradesh", 1, 3], ["CG", "Chhattisgarh", 2, 3], ["JH", "Jharkhand", 3, 3], ["WB", "West Bengal", 4, 3], ["ML", "Meghalaya", 6, 3], ["MN", "Manipur", 7, 3],
    ["MH", "Maharashtra", 1, 4], ["TS", "Telangana", 2, 4], ["OD", "Odisha", 3, 4], ["TR", "Tripura", 6, 4], ["MZ", "Mizoram", 7, 4],
    ["GA", "Goa", 0, 5], ["KA", "Karnataka", 1, 5], ["AP", "Andhra Pradesh", 2, 5],
    ["KL", "Kerala", 1, 6], ["TN", "Tamil Nadu", 2, 6], ["PY", "Puducherry", 3, 6],
  ];
  const norm = (s) => String(s || "").toLowerCase().replace("nct of ", "").replace(/&/g, "and").replace(/[^a-z]/g, "").replace("orissa", "odisha").replace("uttaranchal", "uttarakhand").replace("pondicherry", "puducherry");
  function tileMap(values, opts = {}) {
    // values: {stateName: number}
    const byNorm = {};
    Object.entries(values || {}).forEach(([k, v]) => { if (v != null) byNorm[norm(k)] = (byNorm[norm(k)] || 0) + v; });
    const max = Math.max(1e-9, ...Object.values(byNorm));
    const sz = 52, gap = 3, W = 8 * (sz + gap), Hh = 7 * (sz + gap);
    const fmt = opts.fmt || ((v) => v.toFixed(0) + "%");
    const cells = TILES.map(([ab, name, x, y]) => {
      const v = byNorm[norm(name)];
      const has = v != null && v > 0;
      const share = has ? Math.max(8, Math.round((v / max) * 88)) : 0;
      const fill = has ? `color-mix(in srgb, var(--tarp) ${share}%, var(--card))` : "var(--paper)";
      const txt = has && share > 50 ? "#fff" : "var(--ink)";
      const lab = has ? fmt(v) : "";
      return `<g><title>${esc(name)}${has ? ": " + esc(fmt(v)) : ": no data"}</title>
        <rect x="${x * (sz + gap)}" y="${y * (sz + gap)}" width="${sz}" height="${sz}" rx="4" style="fill:${fill}"/>
        <text x="${x * (sz + gap) + sz / 2}" y="${y * (sz + gap) + (lab ? 22 : 30)}" text-anchor="middle" style="fill:${has ? txt : "var(--faint)"}">${ab}</text>
        ${lab ? `<text x="${x * (sz + gap) + sz / 2}" y="${y * (sz + gap) + 38}" text-anchor="middle" style="fill:${txt};font-family:var(--f-mono);font-weight:400;font-size:10px">${esc(lab)}</text>` : ""}</g>`;
    }).join("");
    return `<svg viewBox="-2 -2 ${W + 4} ${Hh + 4}" role="img" aria-label="${esc(opts.label || "Map of Indian states")}">${cells}</svg>`;
  }

  // ---------- shared fragments ----------
  function chipStrip(active) {
    const el = document.getElementById("cstrip");
    el.innerHTML = S.manifest.commodities.map((c) =>
      `<a class="chipc" href="#${c.slug}" ${active === c.slug ? 'aria-current="page"' : ""}><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</a>`).join("");
  }
  function navActive(r) {
    document.querySelectorAll(".nav a").forEach((a) => {
      const on = a.dataset.r === r || (r && S.manifest.commodities.some((c) => c.slug === r) && a.dataset.r === "commodities");
      if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
  }
  function priceSeasonPill(idx) {
    if (idx == null) return '<span class="pill mid">–</span>';
    const d = idx - 100;
    if (d >= 12) return `<span class="pill hot">Dear month · ${pct(d)}</span>`;
    if (d <= -12) return `<span class="pill cool">Cheap month · ${pct(d)}</span>`;
    return `<span class="pill mid">Near average · ${pct(d)}</span>`;
  }
  function arrivalsPill(idx) {
    if (idx == null) return '<span class="pill mid">–</span>';
    if (idx >= 112) return '<span class="pill cool">Peak arrivals</span>';
    if (idx <= 88) return '<span class="pill warn">Lean arrivals</span>';
    return '<span class="pill mid">Steady arrivals</span>';
  }
  function qcPrimary(items) {
    if (!items || !items.length) return null;
    return items[0];
  }
  const districtName = (r) => (r.district === "North" && /delhi/i.test(r.state) ? "North Delhi (Azadpur)" : r.district);

  async function loadAll() {
    const slugs = S.manifest.commodities.map((c) => c.slug);
    const [kbs, ans] = await Promise.all([
      Promise.all(slugs.map((s) => opt(`data/kb/${s}.json`))),
      Promise.all(slugs.map((s) => opt(`data/analytics/${s}.json`))),
    ]);
    const doca = await opt("data/doca/daily.json");
    const qc = await opt("data/retail/quick_commerce.json");
    return { slugs, kbs, ans, doca, qc };
  }
  function docaFor(doca, name) {
    if (!doca || !name) return {};
    const day = doca.days[doca.latest] || {};
    return { date: doca.latest, retail: (day.retail_rs_per_kg || {})[name], wholesale: (day.wholesale_rs_per_qtl || {})[name] };
  }
  const DOCA_NAME = { onion: "Onion", tomato: "Tomato", potato: "Potato", brinjal: "Brinjal", banana: "Banana" };

  // =====================================================================
  // RATE BOARD (home)
  // =====================================================================
  async function viewBoard() {
    const { kbs, ans, doca, qc } = await loadAll();
    const m3 = MON[(NOW_M + 3) % 12];
    const rows = S.manifest.commodities.map((c, i) => {
      const kb = kbs[i], an = ans[i] || {};
      const d = docaFor(doca, DOCA_NAME[c.slug]);
      const q = qcPrimary(qc && qc.items[c.slug]);
      const o3 = an.outlook && an.outlook.rows.find((r) => r.h === 3);
      const qcTxt = q ? (q.per_kg ? `₹${inr(q.per_kg)}<span class="dim">/kg</span>` : `₹${inr(q.price)}<span class="dim">/${esc(q.pack)}</span>`) : "–";
      const banana = c.slug === "banana" && d.retail ? '<span class="dim" title="DoCA does not state the unit for banana; likely per dozen">*</span>' : "";
      return `<tr data-href="#${c.slug}">
        <td><div class="cname"><span class="dot" style="background:${c.color}"></span><div><a href="#${c.slug}">${esc(c.name)}</a><small>${esc(c.local)}</small></div></div></td>
        <td>${arrivalsPill(an.now_arrivals_index)}</td>
        <td>${priceSeasonPill(an.now_index)}</td>
        <td class="right big">${d.retail != null ? "₹" + inr(d.retail, 1) + banana : '<span class="dim">–</span>'}</td>
        <td class="right big">${d.wholesale != null ? "₹" + inr(kg(d.wholesale), 1) : '<span class="dim">–</span>'}</td>
        <td class="right big">${qcTxt}</td>
        <td class="right">${o3 ? `<span class="big ${o3.med > 0 ? "up" : "down"}">${pct(o3.med)}</span><br><span class="dim num" style="font-size:11px">${pct(o3.p10)} to ${pct(o3.p90)}</span>` : "–"}</td>
        <td>${an.recent ? sparkSVG(an.recent.map((r) => r.modal), 110, 30, c.color === "#5b3a7a" ? "#b48ad8" : "#7fd9a0") : ""}</td>
      </tr>`;
    }).join("");

    const risksNow = [];
    S.manifest.commodities.forEach((c, i) => (kbs[i] && kbs[i].weather_risks || []).forEach((r) => { if (r.months.includes(NOW_M + 1)) risksNow.push({ c, r }); }));

    const heat = S.manifest.commodities.map((c, i) => {
      const sp = ans[i] && ans[i].seasonal_price;
      if (!sp) return "";
      return `<div class="rl"><a href="#${c.slug}" style="color:inherit;text-decoration:none"><span class="dot" style="background:${c.color};margin-right:6px"></span>${esc(c.name)}</a></div>` +
        sp.map((r, m) => `<div class="c ${m === NOW_M ? "now-col" : ""}" title="${MON[m]}: ${pct(r.med - 100)} vs yearly average" style="background:${heatColor(r.med)}">${r.med - 100 > 0 ? "+" : ""}${Math.round(r.med - 100)}</div>`).join("");
    }).join("");

    const fr = S.manifest.freshness;
    app.innerHTML = `
      <section class="section hero">
        <div>
          <p class="eyebrow">India's perishable commodities · ${S.manifest.commodities.length} tracked</p>
          <h1>Where it grows, how it moves, <em>what it costs</em>, and where the price goes next.</h1>
          <p>One place for the ten fruits and vegetables that move India's food inflation: production belts, crop calendars, weather risks, storage, supply chains, mandi and quick-commerce prices, and a tested seasonal forecast.</p>
        </div>
        <div class="stamp" aria-label="Data freshness">
          <div><span>DoCA retail &amp; wholesale</span><b class="num">${fmtDate(fr.doca)}</b></div>
          <div><span>Quick commerce snapshot</span><b class="num">${fmtDate(fr.quick_commerce)}</b></div>
          <div><span>Mandi history (CEDA / Agmarknet)</span><b class="num">to ${fmtDate(fr.ceda)}</b></div>
          <div><span>Daily mandi feed (data.gov.in)</span><b class="num">${fr.ogd ? fmtDate(fr.ogd) : "Runs from India"}</b></div>
        </div>
      </section>

      <section class="section">
        <div class="board">
          <div class="board-head">
            <h2>Rate board · ${TODAY.getDate()} ${MON[NOW_M]} ${TODAY.getFullYear()}</h2>
            <span class="note">Prices in ₹ per kg. Season columns compare ${MON[NOW_M]} with the year's average (2008–2025 mandi data).</span>
          </div>
          <div class="tablewrap">
            <table>
              <thead><tr>
                <th>Commodity</th><th>Arrivals in ${MON[NOW_M]}</th><th>Price in ${MON[NOW_M]}, typically</th>
                <th class="right">Retail<br>DoCA avg</th><th class="right">Wholesale<br>DoCA avg</th><th class="right">Blinkit<br>Delhi</th>
                <th class="right">By ${m3}<br>median · range</th><th>Mandi modal<br>36 months</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
        <p class="src">Retail and wholesale: Department of Consumer Affairs all-India averages for ${fmtDate(fr.doca)} (only items DoCA tracks). Blinkit: shelf prices in Connaught Place, New Delhi on ${fmtDate(fr.quick_commerce)}. Outlook: median and 10–90% range of price changes from ${MON[NOW_M]} to ${m3} in past years. * Banana unit not stated by DoCA (likely per dozen).</p>
      </section>

      <section class="section">
        <div class="sec-head"><div><p class="eyebrow">Seasonality</p><h2 class="h-sec">The price year at a glance</h2></div>
          <p class="note">Typical price in each month vs the yearly average, % (median 2008–2025). Green = cheaper, red = dearer.</p></div>
        <div class="tablewrap"><div class="cal heat">
          <div class="mh" style="justify-content:flex-start">Commodity</div>${MON.map((m, i) => `<div class="mh ${i === NOW_M ? "now" : ""}">${m}</div>`).join("")}
          ${heat}
        </div></div>
      </section>

      <section class="section grid g2">
        <div class="panel">
          <p class="eyebrow">Weather watch · ${MON[NOW_M]}</p>
          <h3>Risks in season right now</h3>
          ${risksNow.length ? `<ul class="list">${risksNow.map(({ c, r }) => `<li><a href="#${c.slug}">${esc(c.name)}</a>: <b>${esc(r.risk)}</b> <span class="note">(${esc(r.where)})</span> — ${esc(r.impact)}</li>`).join("")}</ul>` : '<p class="note">No major weather risks listed for this month.</p>'}
        </div>
        <div class="panel">
          <p class="eyebrow">How to read the board</p>
          <h3>Three price layers</h3>
          <ul class="list">
            <li><b>Mandi modal</b>: the most common auction price in APMC markets (Agmarknet), usually quoted per quintal (100 kg).</li>
            <li><b>DoCA wholesale and retail</b>: daily averages the government collects from 550+ centres in towns and cities.</li>
            <li><b>Quick commerce</b>: what a Delhi shopper pays for 10-minute delivery; includes sorting, packing, wastage and delivery.</li>
          </ul>
          <p class="note" style="margin-top:8px">Farmers typically receive about a third of the retail price (RBI, 2024). See <a href="#supply-chain">Supply chain</a>.</p>
        </div>
      </section>

      <section class="section">
        <div class="sec-head"><div><p class="eyebrow">Dossiers</p><h2 class="h-sec">Pick a commodity</h2></div></div>
        ${commodityCards(kbs)}
      </section>`;
    app.querySelectorAll("tr[data-href]").forEach((tr) => tr.addEventListener("click", (e) => { if (e.target.closest("a")) return; location.hash = tr.dataset.href; }));
  }
  function heatColor(idx) {
    const d = idx - 100;
    const a = Math.min(80, Math.abs(d) * 1.1);
    return d >= 0 ? `color-mix(in srgb, var(--chilli) ${a}%, var(--card))` : `color-mix(in srgb, var(--leaf) ${a}%, var(--card))`;
  }
  function commodityCards(kbs) {
    return `<div class="cards-c">${S.manifest.commodities.map((c, i) => {
      const kb = kbs[i];
      return `<a class="ccard" href="#${c.slug}"><span class="t"><span class="dot" style="background:${c.color}"></span>${esc(c.name)}</span>
        <span class="note">${esc(c.local)} · ${esc(c.group)}</span>
        <p>${esc(kb ? kb.perishability : "")}</p></a>`;
    }).join("")}</div>`;
  }

  async function viewCommodities() {
    const { kbs } = await loadAll();
    app.innerHTML = `<section class="section"><div class="sec-head"><div><p class="eyebrow">Launch set</p><h2 class="h-sec">Ten commodities</h2></div>
      <p class="note">Chosen for volume, price sensitivity and household spend. New commodities are added as one JSON file each (see Method).</p></div>
      ${commodityCards(kbs)}</section>
      <section class="section"><div class="tablewrap"><table class="dt"><thead><tr><th>Commodity</th><th>Botanical name</th><th>Perishability</th><th>Top producing state</th><th>Main markets</th></tr></thead>
      <tbody>${S.manifest.commodities.map((c, i) => { const kb = kbs[i] || {}; const top = (kb.states && kb.states.rows[0]) || {}; return `<tr><td><a href="#${c.slug}">${esc(c.name)}</a></td><td><i>${esc(kb.botanical)}</i></td><td>${esc(kb.perishability)}</td><td>${esc(top.state || "")}</td><td>${esc((kb.markets || []).slice(0, 2).map((m) => m.name).join(", "))}</td></tr>`; }).join("")}</tbody></table></div></section>`;
  }

  // =====================================================================
  // COMMODITY DOSSIER
  // =====================================================================
  const SECTIONS = [
    ["overview", "Overview"], ["prices", "Prices"], ["outlook", "Outlook & forecast"], ["seasons", "Seasons"],
    ["geography", "Where it grows"], ["climate", "Climate & weather risk"], ["pests", "Pests & diseases"],
    ["storage", "Post-harvest & storage"], ["chain", "Supply chain"], ["markets", "Markets & varieties"],
    ["trade", "Trade & policy"], ["history", "Price history"], ["signals", "Signals & opportunities"], ["sources", "Sources"],
  ];

  async function viewCommodity(slug) {
    const c = S.manifest.commodities.find((x) => x.slug === slug);
    const [kb, an, ceda, doca, qc] = await Promise.all([
      j(`data/kb/${slug}.json`), opt(`data/analytics/${slug}.json`), opt(`data/ceda/${slug}.json`),
      opt("data/doca/daily.json"), opt("data/retail/quick_commerce.json"),
    ]);
    const ogd = S.manifest.freshness.ogd ? await opt(`data/ogd/${slug}.json`) : null;
    const d = docaFor(doca, DOCA_NAME[slug]);
    const qItems = (qc && qc.items[slug]) || [];
    const last = ceda && ceda.national_monthly[ceda.national_monthly.length - 1];

    const html = [];
    // ---- overview
    html.push(`<section class="section dhead" id="overview">
      <p class="eyebrow">${esc(kb.group)}</p>
      <h1><span class="dot" style="background:${c.color};width:18px;height:18px"></span>${esc(kb.name)} <span class="local">${esc(kb.local)}</span></h1>
      <div class="meta"><span><i>${esc(kb.botanical)}</i></span><span>${esc(kb.family)}</span><span>${esc(kb.perishability)}</span></div>
      <p class="summary">${esc(kb.summary)}</p>
      <p class="aka">Also called: ${Object.entries(kb.aka || {}).map(([k, v]) => `${esc(v)} <span class="note">(${esc(k)})</span>`).join(" · ")}</p>
      <div class="tiles">${kb.key_numbers.map((k) => `<div class="tile"><div class="lab">${esc(k.label)}</div><div class="val">${esc(k.value)}</div><div class="sub">${esc(k.note)}</div><div class="sub" style="color:var(--faint)">${esc(k.src)}</div></div>`).join("")}</div>
      <p class="note">${esc(kb.global)}</p>
    </section>`);

    // ---- prices
    const qcPanel = qItems.length ? `<div class="panel"><p class="eyebrow">Quick commerce · ${esc(qc.platform)}</p><h3>On the shelf in Delhi</h3>
      <div class="qc">${qItems.map((q) => `<div class="row"><span>${esc(q.name)} <span class="note">${esc(q.pack)}</span>${q.note ? `<br><span class="note">${esc(q.note)}</span>` : ""}</span><span class="num">₹${inr(q.price)} <span class="strike">₹${inr(q.mrp)}</span></span><span class="num">${q.per_kg ? "₹" + inr(q.per_kg) + "/kg" : q.per_dozen ? "₹" + inr(q.per_dozen) + "/dozen" : ""}</span></div>`).join("")}</div>
      <p class="src">${esc(qc.location)}, ${fmtDate(qc.captured)}. ${esc(qc.note)}</p></div>` : "";
    const mk_ = an && an.markups && an.markups.length ? `<div class="panel"><p class="eyebrow">Mandi to shop</p><h3>Retail ÷ wholesale by city</h3>
      <div class="tablewrap"><table class="dt"><thead><tr><th>Centre</th><th class="num">Retail is</th><th class="num">Months</th><th class="num">Latest</th></tr></thead>
      <tbody>${an.markups.map((m) => `<tr><td>${esc(m.centre)}</td><td class="num">${m.markup.toFixed(2)}× wholesale</td><td class="num">${m.n}</td><td class="num">${monthName(m.last)}</td></tr>`).join("")}</tbody></table></div>
      <p class="src">Median ratio of monthly retail to wholesale price, 2015 onward. Source: NHB market information.</p></div>` : "";
    html.push(`<section class="section" id="prices">
      <div class="sec-head"><div><p class="eyebrow">Prices</p><h2 class="h-sec">What it costs, from mandi to doorstep</h2></div><p class="note">₹ per kg unless stated (₹ per quintal ÷ 100).</p></div>
      <div class="tiles">
        ${d.retail != null ? `<div class="tile"><div class="lab">Retail today</div><div class="val num">₹${inr(d.retail, 2)}</div><div class="sub">DoCA all-India average, ${fmtDate(d.date)}${slug === "banana" ? " (unit not stated; likely per dozen)" : ""}</div></div>` : ""}
        ${d.wholesale != null ? `<div class="tile"><div class="lab">Wholesale today</div><div class="val num">₹${inr(kg(d.wholesale), 2)}</div><div class="sub">DoCA all-India average, ₹${inr(d.wholesale)}/qtl</div></div>` : ""}
        ${ogd && ogd.national_modal ? `<div class="tile"><div class="lab">Mandi modal today</div><div class="val num">₹${inr(kg(ogd.national_modal), 2)}</div><div class="sub">${ogd.n_markets} markets, ${fmtDate(ogd.date)} (data.gov.in)</div></div>` : ""}
        ${qItems[0] ? `<div class="tile"><div class="lab">Quick commerce</div><div class="val num">${qItems[0].per_kg ? "₹" + inr(qItems[0].per_kg) : "₹" + inr(qItems[0].price)}</div><div class="sub">${esc(qItems[0].name)}, ${qItems[0].per_kg ? "per kg" : esc(qItems[0].pack)} · Blinkit Delhi</div></div>` : ""}
        ${last ? `<div class="tile"><div class="lab">Last mandi month in history</div><div class="val num">₹${inr(kg(last.modal), 2)}</div><div class="sub">All-India modal, ${monthName(last.t)} (CEDA)</div></div>` : ""}
        ${an ? `<div class="tile"><div class="lab">${MON[NOW_M]} vs year average</div><div class="val num">${pct(an.now_index - 100)}</div><div class="sub">typical, 2008–2025</div></div>` : ""}
      </div>
      ${!d.retail && !ogd ? `<p class="callout" style="margin-top:12px">DoCA does not track ${esc(kb.name.toLowerCase())}. Daily mandi prices for it come from the data.gov.in feed, which the pipeline fetches when run from India (see Method).</p>` : ""}
      ${ceda ? `<div class="panel" style="margin-top:16px"><h3>All-India mandi price since 2008</h3><div class="chart tall"><canvas id="c-hist"></canvas></div>
        <div class="legend"><span><i style="background:${css("--tarp")}"></i>Modal price, monthly</span><span><i style="background:${alpha(css("--tarp"), .25)};height:10px"></i>Min–max range</span></div>
        <p class="src">Average across reporting APMC markets. Source: CEDA Agri-Market Data (Ashoka University), from Agmarknet.</p></div>
      <div class="grid g2" style="margin-top:16px">
        <div class="panel"><h3>Last 120 days of the series</h3><div class="chart short"><canvas id="c-daily"></canvas></div><p class="src">Daily all-India modal, to ${fmtDate(ceda.national_daily.length ? ceda.national_daily[ceda.national_daily.length - 1].t : "")}. CEDA.</p></div>
        <div class="panel"><h3>Yearly average price and arrivals</h3><div class="chart short"><canvas id="c-annual"></canvas></div>
          <div class="legend"><span><i style="background:${css("--tarp")}"></i>Price ₹/kg</span><span><i style="background:${css("--turmeric")}"></i>Arrivals, lakh t</span></div><p class="src">Partial years marked by fewer months. CEDA.</p></div>
      </div>
      <div class="panel" style="margin-top:16px"><h3>Price by state</h3><div class="chart"><canvas id="c-states"></canvas></div>
        <div class="legend" id="lg-states"></div><p class="src">Monthly modal price in the six states with the most mandi arrivals. CEDA.</p></div>` : ""}
      <div class="grid g2" style="margin-top:16px">${qcPanel}${mk_}</div>
    </section>`);

    // ---- outlook
    if (an) {
      const o = an.outlook, bt = an.backtest;
      const wsale = d.wholesale ? kg(d.wholesale) : null;
      html.push(`<section class="section" id="outlook">
        <div class="sec-head"><div><p class="eyebrow">Outlook &amp; forecast</p><h2 class="h-sec">Where the price usually goes from ${o.start_month}</h2></div>
          <p class="note">Based on ${o.rows[0] ? o.rows[0].n : 0} years of all-India mandi data. Not a guarantee.</p></div>
        <div class="grid g2">
          <div class="panel"><h3>Price change from ${o.start_month}, past years</h3><div class="chart"><canvas id="c-fan"></canvas></div>
            <div class="legend"><span><i style="background:${css("--ink")}"></i>Median change</span><span><i style="background:${alpha(css("--tarp"), .3)};height:10px"></i>10th–90th percentile of years</span></div></div>
          <div class="panel"><h3>Month by month</h3>
            <div class="tablewrap"><table class="dt"><thead><tr><th>Month</th><th class="num">Median</th><th class="num">Range (10–90%)</th><th class="num">Years up</th>${wsale ? '<th class="num">Wholesale path ₹/kg</th>' : ""}</tr></thead>
            <tbody>${o.rows.map((r) => `<tr><td>${r.month}</td><td class="num">${pct(r.med, 1)}</td><td class="num">${pct(r.p10)} … ${pct(r.p90)}</td><td class="num">${r.up_share}%</td>${wsale ? `<td class="num">${inr(wsale * (1 + r.med / 100), 1)} <span class="note">(${inr(wsale * (1 + r.p10 / 100), 0)}–${inr(wsale * (1 + r.p90 / 100), 0)})</span></td>` : ""}</tr>`).join("")}</tbody></table></div>
            ${wsale ? `<p class="src">Wholesale path applies the historical changes to today's DoCA all-India wholesale price (₹${inr(wsale, 2)}/kg). Retail prices usually move later and by less.</p>` : ""}
            ${an.anchors && an.anchors.model_path ? `<p class="callout" style="margin-top:8px">Mean-reversion model from today's mandi modal (₹${inr(kg(an.anchors.mandi_modal.value), 2)}/kg): ${an.anchors.model_path.map((p) => `${p.month} ₹${inr(kg(p.value), 1)}`).join(" · ")}</p>` : `<p class="note" style="margin-top:8px">A sharper forecast that also uses today's mandi price level switches on automatically when the daily data.gov.in feed runs (see Method).</p>`}
          </div>
        </div>
        <div class="grid g3" style="margin-top:16px">
          <div class="panel"><h3>How fast shocks fade</h3><p class="val" style="font-family:var(--f-display);font-size:var(--t-2xl);font-weight:700">${an.shock_half_life_months != null ? an.shock_half_life_months + " mo" : "–"}</p>
            <p class="note">Half-life of an unusual price move once seasonality and trend are removed (AR(1) coefficient ${an.shock_phi}). Short = spikes reverse quickly.</p></div>
          <div class="panel"><h3>Volatility</h3><dl class="kv">
            <dt>Typical monthly move</dt><dd class="num">±${an.volatility.monthly_sd_pct}%</dd>
            <dt>Months moving &gt;20%</dt><dd class="num">${an.volatility.share_months_move_gt_20pct}%</dd>
            <dt>Largest monthly rise</dt><dd class="num">${pct(an.volatility.max_monthly_rise_pct)}</dd>
            <dt>Largest monthly fall</dt><dd class="num">${pct(an.volatility.max_monthly_fall_pct)}</dd>
            <dt>Trend (last 8 yrs)</dt><dd class="num">${pct(an.trend_pct_per_year, 1)} a year</dd></dl></div>
          <div class="panel"><h3>Forecast accuracy</h3><div class="chart short"><canvas id="c-bt"></canvas></div>
            <p class="src">Mean absolute % error, ${bt.origins} rolling forecasts ${monthName(bt.from)}–${monthName(bt.to)}. Lower is better.</p></div>
        </div>
        <div class="legend"><span><i style="background:${PALETTE[0]}"></i>Mean-reversion model</span><span><i style="background:${PALETTE[2]}"></i>Seasonal analog</span><span><i style="background:${PALETTE[5]}"></i>No change</span><span><i style="background:${PALETTE[3]}"></i>Same month last year</span></div>
      </section>`);
    }

    // ---- seasons
    const seasonsRows = kb.seasons.map((s) => {
      const cells = MON.map((m, i) => {
        const sow = (s.sow || []).includes(i + 1), hv = (s.harvest || []).includes(i + 1);
        return `<div class="c ${i === NOW_M ? "now-col" : ""}">${hv ? '<span class="bar harv" title="Harvest / arrivals"></span>' : sow ? '<span class="bar sow" title="Sowing / planting / flowering"></span>' : ""}</div>`;
      }).join("");
      return `<div class="rl">${esc(s.name)}<small>${esc(s.region)}${s.share ? " · " + esc(s.share) : ""}</small></div>${cells}`;
    }).join("");
    html.push(`<section class="section" id="seasons">
      <div class="sec-head"><div><p class="eyebrow">Seasons</p><h2 class="h-sec">Crop calendar</h2></div>
        <div class="legend"><span><i class="bar sow" style="width:18px;height:10px;display:inline-block"></i>Sowing / planting</span><span><i style="background:${css("--turmeric")};width:18px;height:10px"></i>Harvest</span></div></div>
      <div class="tablewrap"><div class="cal"><div class="mh" style="justify-content:flex-start">Season</div>${MON.map((m, i) => `<div class="mh ${i === NOW_M ? "now" : ""}">${m}</div>`).join("")}${seasonsRows}</div></div>
      <div class="grid g3" style="margin-top:12px">${kb.seasons.map((s) => `<div class="panel"><h4>${esc(s.name)}</h4><p class="note">${esc(s.note)}</p></div>`).join("")}</div>
      <p class="callout" style="margin-top:12px"><b>Lean season:</b> ${esc(kb.lean_season)}</p>
      ${an ? `<div class="panel" style="margin-top:16px"><h3>Seasonal price and arrivals pattern</h3>
        <p class="note">Cheapest month: <b>${an.cheapest_month}</b> · Dearest month: <b>${an.dearest_month}</b> · Typical swing between them: <b>${an.seasonal_swing_pct}%</b></p>
        <div class="chart"><canvas id="c-season"></canvas></div>
        <div class="legend"><span><i style="background:${css("--chilli")}"></i>Price index (100 = yearly average)</span><span><i style="background:${alpha(css("--chilli"), .2)};height:10px"></i>Middle half of years</span><span><i style="background:${alpha(css("--tarp"), .45)};height:10px"></i>Mandi arrivals index</span></div>
        <p class="src">Ratio to a centred 12-month moving average, median by month, 2008–2025. CEDA / Agmarknet.</p></div>` : ""}
    </section>`);

    // ---- geography
    const prodVals = {}; (kb.states.rows || []).forEach((r) => { if (r.share != null && r.state !== "Others") prodVals[r.state] = r.share; });
    const arrYears = ceda ? Object.keys(ceda.state_arrivals).sort() : [];
    const arrY = arrYears.length > 1 ? arrYears[arrYears.length - 2] : arrYears[0];
    const arrVals = {}; let arrTot = 0;
    if (ceda && arrY) { Object.entries(ceda.state_arrivals[arrY]).forEach(([s, v]) => { arrTot += v; }); Object.entries(ceda.state_arrivals[arrY]).forEach(([s, v]) => { arrVals[s] = (v / arrTot) * 100; }); }
    const priceVals = ceda ? Object.fromEntries(Object.entries(ceda.state_price_year.modal).map(([s, v]) => [s, v / 100])) : {};
    const hasProd = Object.keys(prodVals).length > 0;
    html.push(`<section class="section" id="geography">
      <div class="sec-head"><div><p class="eyebrow">Where it grows</p><h2 class="h-sec">Producing states, belts and mandi hubs</h2></div>
        <div class="seg" role="group" aria-label="Map layer">
          ${hasProd ? '<button type="button" data-layer="prod" aria-pressed="true">Production share</button>' : ""}
          <button type="button" data-layer="arr" aria-pressed="${hasProd ? "false" : "true"}">Mandi arrivals ${esc(arrY || "")}</button>
          <button type="button" data-layer="price" aria-pressed="false">Mandi price ${esc(ceda ? ceda.state_price_year.year : "")}</button>
        </div></div>
      <div class="grid g2">
        <div class="panel tmap"><div id="tmap"></div><p class="note" id="tmap-note"></p></div>
        <div class="panel"><h3>Leading states</h3><p class="note">${esc(kb.states.basis)}, ${esc(kb.states.year)}.</p>
          <div class="tablewrap"><table class="dt"><thead><tr><th>State</th><th class="num">Share</th><th>Main districts</th></tr></thead>
          <tbody>${kb.states.rows.map((r) => `<tr><td>${esc(r.state)}</td><td class="num">${r.share != null ? "~" + r.share + "%" : "—"}</td><td>${esc(r.hubs)}</td></tr>`).join("")}</tbody></table></div></div>
      </div>
      <div class="cards-c" style="margin-top:16px">${kb.belts.map((b) => `<div class="panel"><h4>${esc(b.name)}</h4><p class="note">${esc(b.where)}</p><p style="font-size:var(--t-sm);margin-top:4px">${esc(b.note)}</p></div>`).join("")}</div>
      ${ceda ? `<div class="panel" style="margin-top:16px"><h3>Top mandi districts by arrivals, ${ceda.district_arrivals.year}</h3>
        <p class="note">Where the crop is traded, which includes big consuming markets such as Delhi's Azadpur as well as producing districts.</p>
        <div class="tablewrap"><table class="dt"><thead><tr><th>#</th><th>District</th><th>State</th><th class="num">Arrivals, tonnes</th></tr></thead>
        <tbody>${ceda.district_arrivals.rows.slice(0, 12).map((r, i) => `<tr><td class="num">${i + 1}</td><td>${esc(districtName(r))}</td><td>${esc(r.state)}</td><td class="num">${inr(r.qty)}</td></tr>`).join("")}</tbody></table></div>
        <p class="src">CEDA Agri-Market Data (Agmarknet arrivals, Census 2011 districts).</p></div>` : ""}
    </section>`);

    // ---- climate
    html.push(`<section class="section" id="climate">
      <div class="sec-head"><div><p class="eyebrow">Climate &amp; weather risk</p><h2 class="h-sec">What it needs, and what hurts it</h2></div></div>
      <div class="grid g2">
        <div class="panel"><h3>Growing conditions</h3><dl class="kv">${kb.climate.map((k) => `<dt>${esc(k.k)}</dt><dd>${esc(k.v)}</dd>`).join("")}</dl></div>
        <div class="panel"><h3>Risk months</h3>${riskMatrix(kb.weather_risks)}</div>
      </div>
      <div class="tablewrap" style="margin-top:16px"><table class="dt"><thead><tr><th>Weather risk</th><th>When</th><th>Where</th><th>Impact</th><th>Example</th></tr></thead>
      <tbody>${kb.weather_risks.map((r) => `<tr><td><b>${esc(r.risk)}</b></td><td>${monthChips(r.months)}</td><td>${esc(r.where)}</td><td>${esc(r.impact)}</td><td class="note">${esc(r.example)}</td></tr>`).join("")}</tbody></table></div>
    </section>`);

    // ---- pests
    html.push(`<section class="section" id="pests">
      <div class="sec-head"><div><p class="eyebrow">Pests &amp; diseases</p><h2 class="h-sec">Biological threats</h2></div></div>
      <div class="tablewrap"><table class="dt"><thead><tr><th>Name</th><th>Cause</th><th>Type</th><th>Impact</th></tr></thead>
      <tbody>${kb.pests.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td><i>${esc(p.sci)}</i></td><td><span class="badge">${esc(p.type)}</span></td><td>${esc(p.impact)}</td></tr>`).join("")}</tbody></table></div>
    </section>`);

    // ---- storage
    const ph = kb.postharvest;
    html.push(`<section class="section" id="storage">
      <div class="sec-head"><div><p class="eyebrow">Post-harvest &amp; storage</p><h2 class="h-sec">Keeping it saleable</h2></div></div>
      <div class="grid g2">
        <div class="panel"><dl class="kv">
          <dt>Storage</dt><dd>${esc(ph.storage)}</dd><dt>Shelf life, ambient</dt><dd>${esc(ph.shelf_ambient)}</dd>
          <dt>Shelf life, cold</dt><dd>${esc(ph.shelf_cold)}</dd><dt>Ripening / ethylene</dt><dd>${esc(ph.respiration)}</dd>
          <dt>Chilling</dt><dd>${esc(ph.chilling)}</dd>
          <dt>Post-harvest loss</dt><dd><b>${ph.loss.value != null ? ph.loss.value + "%" : "n/a"}</b> <span class="note">${esc(ph.loss.detail)} (${esc(ph.loss.src)})</span></dd></dl></div>
        <div class="panel"><h3>Handling practices</h3><ul class="list">${ph.practices.map((p) => `<li>${esc(p)}</li>`).join("")}</ul></div>
      </div>
    </section>`);

    // ---- chain
    const sc = kb.supply_chain;
    const ladder = [];
    if (d.retail != null && slug !== "banana") {
      const shareTxt = (kb.key_numbers.find((k) => /Farmer/.test(k.label)) || {}).value;
      const share = shareTxt ? parseFloat(shareTxt.replace(/[^\d.]/g, "")) : null;
      if (share) ladder.push(["Farmer receives (est.)", d.retail * share / 100, `${share}% of retail, RBI estimate applied to today`]);
      if (d.wholesale) ladder.push(["Wholesale (DoCA avg)", kg(d.wholesale), "All-India average"]);
      ladder.push(["Retail (DoCA avg)", d.retail, "All-India average"]);
      if (qItems[0] && qItems[0].per_kg) ladder.push(["Quick commerce (Delhi)", qItems[0].per_kg, qItems[0].name]);
    }
    const lmax = Math.max(1, ...ladder.map((l) => l[1]));
    html.push(`<section class="section" id="chain">
      <div class="sec-head"><div><p class="eyebrow">Supply chain</p><h2 class="h-sec">From field to doorstep</h2></div><p class="note">${esc(sc.farmer_share)}</p></div>
      <div class="chain">${sc.steps.map((s, i) => `<div class="step"><span class="n">${String(i + 1).padStart(2, "0")}</span><h4>${esc(s.stage)}</h4><p>${esc(s.what)}</p></div>`).join("")}</div>
      <div class="grid g2" style="margin-top:16px">
        <div class="panel"><h3>Main routes</h3><div class="tablewrap"><table class="dt"><thead><tr><th>From</th><th>To</th><th class="num">km</th><th class="num">Days</th><th>Mode</th></tr></thead>
          <tbody>${sc.routes.map((r) => `<tr><td>${esc(r.from)}</td><td>${esc(r.to)}</td><td class="num">${r.km ? inr(r.km) : "–"}</td><td class="num">${esc(r.days)}</td><td>${esc(r.mode)}</td></tr>`).join("")}</tbody></table></div>
          <p class="note" style="margin-top:8px"><b>Packaging:</b> ${esc(sc.packaging)}</p><p class="src">Road distances and transit times are approximate.</p></div>
        <div class="panel"><h3>Price build-up today</h3>${ladder.length ? `<div class="ladder">${ladder.map((l) => `<div class="rung"><span>${esc(l[0])}<br><span class="note">${esc(l[2])}</span></span><div class="track"><div class="fill" style="width:${(l[1] / lmax * 100).toFixed(1)}%"></div></div><span class="v">₹${inr(l[1], 1)}/kg</span></div>`).join("")}</div>
          <p class="src">DoCA ${fmtDate(d.date)}; Blinkit snapshot ${fmtDate(qc && qc.captured)}. Farmer figure is an estimate, not a measured price.</p>` : `<p class="note">Live retail and wholesale averages are not published for this item. Mandi-to-retail mark-ups are typically 1.5–2.5× for vegetables and 1.4–2× for fruit; see the Prices section where NHB centre data exists.</p>`}</div>
      </div>
    </section>`);

    // ---- markets & varieties
    html.push(`<section class="section" id="markets">
      <div class="sec-head"><div><p class="eyebrow">Markets &amp; varieties</p><h2 class="h-sec">Where it trades, what is grown</h2></div></div>
      <div class="grid g2">
        <div class="panel"><h3>Key markets</h3><div class="tablewrap"><table class="dt"><tbody>${kb.markets.map((m) => `<tr><td><b>${esc(m.name)}</b><br><span class="note">${esc(m.place)}</span></td><td>${esc(m.role)}</td></tr>`).join("")}</tbody></table></div></div>
        <div class="panel"><h3>Varieties</h3><div class="tablewrap"><table class="dt"><tbody>${kb.varieties.map((v) => `<tr><td><b>${esc(v.name)}</b></td><td>${esc(v.note)}</td></tr>`).join("")}</tbody></table></div>
          ${kb.gi && kb.gi.length ? `<p class="note" style="margin-top:8px"><b>GI tags:</b> ${kb.gi.map(esc).join(", ")}</p>` : ""}</div>
      </div>
    </section>`);

    // ---- trade & policy
    html.push(`<section class="section" id="trade">
      <div class="sec-head"><div><p class="eyebrow">Trade &amp; policy</p><h2 class="h-sec">Exports, imports and government action</h2></div></div>
      <div class="grid g2">
        <div class="panel"><dl class="kv"><dt>Exports</dt><dd>${esc(kb.trade.exports)}</dd><dt>Imports</dt><dd>${esc(kb.trade.imports)}</dd><dt>HS code</dt><dd class="num">${esc(kb.trade.hs_code)}</dd></dl></div>
        <div class="panel"><h3>Policy timeline</h3><div class="tl">${kb.policy.map((p) => `<div class="ev policy"><div class="when">${esc(p.when)}</div><div>${esc(p.what)}</div></div>`).join("")}</div></div>
      </div>
    </section>`);

    // ---- history
    html.push(`<section class="section" id="history">
      <div class="sec-head"><div><p class="eyebrow">Price history</p><h2 class="h-sec">Spikes, crashes and why</h2></div>
        <div class="legend"><span><i style="background:${css("--chilli")};width:10px;height:10px;border-radius:50%"></i>Spike</span><span><i style="background:${css("--leaf")};width:10px;height:10px;border-radius:50%"></i>Crash</span><span><i style="background:${css("--turmeric")};width:10px;height:10px;border-radius:50%"></i>Shock or policy</span></div></div>
      <div class="grid g2">
        <div class="panel"><h3>Known episodes</h3><div class="tl">${kb.history.map((h) => `<div class="ev ${esc(h.type)}"><div class="when">${esc(h.when)}</div><div>${esc(h.what)}</div></div>`).join("")}</div></div>
        ${an ? `<div class="panel"><h3>Largest deviations in the data</h3><p class="note">Months furthest above or below the seasonal and trend-adjusted normal, 2008–2025.</p>
          <div class="grid g2" style="margin-top:8px">
            <div><h4 style="color:var(--chilli)">Above normal</h4><table class="dt"><tbody>${an.spikes.map((s) => `<tr><td>${monthName(s.t)}</td><td class="num">${pct(s.pct_vs_normal)}</td><td class="num">₹${inr(kg(s.price), 1)}</td></tr>`).join("")}</tbody></table></div>
            <div><h4 style="color:var(--leaf)">Below normal</h4><table class="dt"><tbody>${an.crashes.map((s) => `<tr><td>${monthName(s.t)}</td><td class="num">${pct(s.pct_vs_normal)}</td><td class="num">₹${inr(kg(s.price), 1)}</td></tr>`).join("")}</tbody></table></div>
          </div><p class="src">All-India mandi modal, ₹/kg. CEDA / Agmarknet.</p></div>` : ""}
      </div>
    </section>`);

    // ---- signals
    html.push(`<section class="section" id="signals">
      <div class="sec-head"><div><p class="eyebrow">Signals &amp; opportunities</p><h2 class="h-sec">What to watch, and where the money is</h2></div></div>
      <div class="grid g2">
        <div class="panel"><h3>Leading indicators</h3><ul class="list">${kb.signals.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>
        <div class="panel"><h3>Business notes</h3><ul class="list">${kb.business.map((s) => `<li>${esc(s)}</li>`).join("")}</ul></div>
      </div>
    </section>`);

    // ---- sources
    html.push(`<section class="section" id="sources">
      <div class="sec-head"><div><p class="eyebrow">Sources</p><h2 class="h-sec">Where this page comes from</h2></div></div>
      <div class="grid g2">
        <div class="panel"><h3>Reference documents</h3><ul class="list">${kb.sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a></li>`).join("")}</ul>
          <h4 style="margin-top:12px">Research institutes</h4><ul class="list">${kb.institutes.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)}</a> <span class="note">${esc(s.where)}</span></li>`).join("")}</ul></div>
        <div class="panel"><h3>Data on this page</h3><ul class="list">
          <li>Mandi prices and arrivals, 2008–${ceda ? ceda.last_month.slice(0, 4) : ""}: <a href="https://agmarknet.ceda.ashoka.edu.in/" target="_blank" rel="noopener">CEDA Agri-Market Data</a> (Agmarknet)</li>
          ${d.retail ? '<li>Daily retail and wholesale: <a href="https://fcainfoweb.nic.in/" target="_blank" rel="noopener">DoCA Price Monitoring System</a></li>' : ""}
          ${an && an.markups.length ? '<li>City retail vs wholesale: <a href="https://www.nhb.gov.in/OnlineClient/MonthwiseAnnualPriceandArrivalReport.aspx" target="_blank" rel="noopener">NHB market information</a></li>' : ""}
          ${qItems.length ? '<li>Quick-commerce shelf prices: Blinkit public search pages (snapshot)</li>' : ""}
          <li>Forecast and statistics: computed by this site (see <a href="#method">Method</a>)</li></ul>
          <p class="note" style="margin-top:8px">Figures marked "approx." are rounded from official estimates and research summaries; check the linked documents before relying on them.</p></div>
      </div>
    </section>`);

    app.innerHTML = `<div class="dossier"><nav class="toc" aria-label="On this page">${SECTIONS.map(([id, t]) => `<a href="#${slug}" data-sec="${id}">${t}</a>`).join("")}</nav><div>${html.join("")}</div></div>`;

    // toc: in-page scrolling without breaking the hash route
    app.querySelectorAll(".toc a").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); const t = document.getElementById(a.dataset.sec); if (t) t.scrollIntoView({ behavior: "smooth", block: "start" }); }));
    const tocLinks = [...app.querySelectorAll(".toc a")];
    const io = new IntersectionObserver((ents) => {
      ents.forEach((en) => { if (en.isIntersecting) tocLinks.forEach((l) => l.classList.toggle("on", l.dataset.sec === en.target.id)); });
    }, { rootMargin: "-30% 0px -60% 0px" });
    SECTIONS.forEach(([id]) => { const el = document.getElementById(id); if (el) io.observe(el); });
    S.observer = io;

    // map layers
    const layers = {
      prod: { vals: prodVals, fmt: (v) => "~" + v.toFixed(0) + "%", note: `${kb.states.basis}, ${kb.states.year}.` },
      arr: { vals: arrVals, fmt: (v) => v >= 1 ? v.toFixed(0) + "%" : "<1%", note: `Share of all-India mandi arrivals in ${arrY} (CEDA / Agmarknet). Shows where it is traded, including consuming hubs such as Delhi.` },
      price: { vals: priceVals, fmt: (v) => "₹" + v.toFixed(0), note: `Average mandi modal price by state, ${ceda ? ceda.state_price_year.year : ""}, ₹/kg (CEDA). Darker = dearer.` },
    };
    const setLayer = (k) => {
      const L = layers[k];
      document.getElementById("tmap").innerHTML = tileMap(L.vals, { fmt: L.fmt, label: kb.name + " by state" });
      document.getElementById("tmap-note").textContent = L.note;
      app.querySelectorAll(".seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.layer === k)));
    };
    app.querySelectorAll(".seg button").forEach((b) => b.addEventListener("click", () => setLayer(b.dataset.layer)));
    setLayer(hasProd ? "prod" : "arr");

    drawCommodityCharts(kb, an, ceda);
  }

  function monthChips(ms) { return `<span class="monthchips">${MON.map((m, i) => `<span class="${ms.includes(i + 1) ? "on" : ""}">${m[0]}</span>`).join("")}</span>`; }
  function riskMatrix(risks) {
    const counts = MON.map((_, i) => risks.filter((r) => r.months.includes(i + 1)).length);
    const mx = Math.max(1, ...counts);
    return `<div class="tablewrap"><div class="cal" style="grid-template-columns:repeat(12,minmax(26px,1fr));min-width:320px">${MON.map((m, i) => `<div class="mh ${i === NOW_M ? "now" : ""}">${m}</div>`).join("")}
      ${counts.map((n, i) => `<div class="c" title="${n} risk(s) in ${MON[i]}" style="background:${n ? `color-mix(in srgb, var(--chilli) ${Math.round(n / mx * 70)}%, var(--card))` : "transparent"};font-family:var(--f-mono)">${n || ""}</div>`).join("")}</div></div>
      <p class="note" style="margin-top:6px">Number of listed weather risks active in each month.</p>`;
  }

  function drawCommodityCharts(kb, an, ceda) {
    const tarp = css("--tarp"), chilli = css("--chilli"), ink = css("--ink"), tur = css("--turmeric");
    if (ceda) {
      const nm = ceda.national_monthly;
      const labels = nm.map((r) => r.t);
      mk("c-hist", {
        type: "line",
        data: { labels, datasets: [
          { data: nm.map((r) => kg(r.max)), borderWidth: 0, pointRadius: 0, fill: false },
          { data: nm.map((r) => kg(r.min)), borderWidth: 0, pointRadius: 0, fill: "-1", backgroundColor: alpha(tarp, .18) },
          { data: nm.map((r) => kg(r.modal)), borderColor: tarp, borderWidth: 2, pointRadius: 0, tension: .2 },
        ] },
        options: {
          interaction: { mode: "index", intersect: false },
          scales: {
            x: { grid: noGridX, ticks: { autoSkip: false, maxRotation: 0, callback: (v, i) => (labels[i].endsWith("-01") && +labels[i].slice(0, 4) % 2 === 0 ? labels[i].slice(0, 4) : null) } },
            y: { grid: gridY(), ticks: { callback: (v) => "₹" + v }, beginAtZero: true },
          },
          plugins: { tooltip: { callbacks: { title: (it) => monthName(it[0].label), label: (it) => ["Max", "Min", "Modal"][it.datasetIndex] + ": ₹" + inr(it.parsed.y, 2) + "/kg" } } },
        },
      });
      const nd = ceda.national_daily;
      mk("c-daily", {
        type: "line",
        data: { labels: nd.map((r) => r.t), datasets: [{ data: nd.map((r) => kg(r.modal)), borderColor: tarp, borderWidth: 2, pointRadius: 0, tension: .2 }] },
        options: { interaction: { mode: "index", intersect: false }, scales: { x: { grid: noGridX, ticks: { maxTicksLimit: 5, maxRotation: 0, callback: function (v) { return fmtDate(this.getLabelForValue(v)).replace(/ \d{4}$/, ""); } } }, y: { grid: gridY(), ticks: { callback: (v) => "₹" + v } } },
          plugins: { tooltip: { callbacks: { title: (it) => fmtDate(it[0].label), label: (it) => "Modal ₹" + inr(it.parsed.y, 2) + "/kg" } } } },
      });
      if (an) {
        const ann = an.annual;
        mk("c-annual", {
          type: "bar",
          data: { labels: ann.map((a) => a.year + (a.months < 12 ? "*" : "")), datasets: [
            { type: "bar", data: ann.map((a) => kg(a.modal)), backgroundColor: alpha(tarp, .75), yAxisID: "y" },
            { type: "line", data: ann.map((a) => a.qty / 1e5), borderColor: tur, borderWidth: 2, pointRadius: 2, pointBackgroundColor: tur, yAxisID: "y1" },
          ] },
          options: { interaction: { mode: "index", intersect: false }, scales: { x: { grid: noGridX, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 9 } }, y: { grid: gridY(), ticks: { callback: (v) => "₹" + v } }, y1: { position: "right", grid: { display: false }, ticks: { callback: (v) => v.toFixed(0) } } },
            plugins: { tooltip: { callbacks: { label: (it) => it.datasetIndex === 0 ? "Avg price ₹" + inr(it.parsed.y, 2) + "/kg" : "Arrivals " + inr(it.parsed.y, 1) + " lakh t" } } } },
        });
      }
      const sm = ceda.state_monthly || {};
      const states = Object.keys(sm);
      if (states.length) {
        const allT = [...new Set(states.flatMap((s) => sm[s].map((r) => r.t)))].sort().filter((t) => t >= "2018-01");
        mk("c-states", {
          type: "line",
          data: { labels: allT, datasets: states.map((s, i) => { const m = Object.fromEntries(sm[s].map((r) => [r.t, r.modal])); return { label: s, data: allT.map((t) => (m[t] != null ? kg(m[t]) : null)), borderColor: PALETTE[i % PALETTE.length], borderWidth: 1.6, pointRadius: 0, spanGaps: true, tension: .2 }; }) },
          options: { interaction: { mode: "index", intersect: false }, scales: { x: { grid: noGridX, ticks: { autoSkip: false, maxRotation: 0, callback: (v, i) => (allT[i].endsWith("-01") ? allT[i].slice(0, 4) : null) } }, y: { grid: gridY(), ticks: { callback: (v) => "₹" + v } } },
            plugins: { tooltip: { displayColors: true, callbacks: { title: (it) => monthName(it[0].label), label: (it) => it.dataset.label + ": ₹" + inr(it.parsed.y, 1) } } } },
        });
        const lg = document.getElementById("lg-states");
        if (lg) lg.innerHTML = states.map((s, i) => `<span><i style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(s)}</span>`).join("");
      }
    }
    if (an) {
      const sp = an.seasonal_price, sq = an.seasonal_arrivals || [];
      mk("c-season", {
        data: { labels: MON, datasets: [
          { type: "bar", data: sq.map((r) => r.med), backgroundColor: alpha(tarp, .35), yAxisID: "y", order: 3 },
          { type: "line", data: sp.map((r) => r.p75), borderWidth: 0, pointRadius: 0, fill: false, order: 2 },
          { type: "line", data: sp.map((r) => r.p25), borderWidth: 0, pointRadius: 0, fill: "-1", backgroundColor: alpha(chilli, .16), order: 2 },
          { type: "line", data: sp.map((r) => r.med), borderColor: chilli, borderWidth: 2.4, pointRadius: 3, pointBackgroundColor: chilli, order: 1 },
        ] },
        options: { interaction: { mode: "index", intersect: false }, scales: { x: { grid: noGridX }, y: { grid: gridY(), suggestedMin: 40 } },
          plugins: { tooltip: { callbacks: { label: (it) => ["Arrivals index", "Price, upper quartile", "Price, lower quartile", "Price index"][it.datasetIndex] + ": " + Math.round(it.parsed.y) } } } },
      });
      const o = an.outlook.rows;
      const lab = [an.outlook.start_month + " (now)"].concat(o.map((r) => r.month));
      mk("c-fan", {
        type: "line",
        data: { labels: lab, datasets: [
          { data: [0].concat(o.map((r) => r.p90)), borderWidth: 0, pointRadius: 0, fill: false },
          { data: [0].concat(o.map((r) => r.p10)), borderWidth: 0, pointRadius: 0, fill: "-1", backgroundColor: alpha(tarp, .22) },
          { data: [0].concat(o.map((r) => r.med)), borderColor: ink, borderWidth: 2.4, pointRadius: 3, pointBackgroundColor: ink },
        ] },
        options: { interaction: { mode: "index", intersect: false }, scales: { x: { grid: noGridX }, y: { grid: gridY(), ticks: { callback: (v) => (v > 0 ? "+" : "") + v + "%" } } },
          plugins: { tooltip: { callbacks: { label: (it) => ["90th percentile", "10th percentile", "Median"][it.datasetIndex] + ": " + pct(it.parsed.y, 1) } } } },
      });
      const m = an.backtest.mape;
      mk("c-bt", {
        type: "bar",
        data: { labels: ["1 mo", "2", "3", "4", "5", "6 mo"], datasets: [
          { label: "Model", data: m.model, backgroundColor: PALETTE[0] },
          { label: "Seasonal analog", data: m.analog, backgroundColor: PALETTE[2] },
          { label: "No change", data: m.persistence, backgroundColor: PALETTE[5] },
          { label: "Same month last year", data: m.seasonal_naive, backgroundColor: PALETTE[3] },
        ] },
        options: { scales: { x: { grid: noGridX }, y: { grid: gridY(), ticks: { callback: (v) => v + "%" } } },
          plugins: { tooltip: { displayColors: true, callbacks: { label: (it) => it.dataset.label + ": " + it.parsed.y + "% error" } } } },
      });
    }
  }

  // =====================================================================
  // CALENDAR
  // =====================================================================
  async function viewCalendar() {
    const { kbs, ans } = await loadAll();
    const C = S.manifest.commodities;
    const head = `<div class="mh" style="justify-content:flex-start">Commodity</div>${MON.map((m, i) => `<div class="mh ${i === NOW_M ? "now" : ""}">${m}</div>`).join("")}`;
    const rowLab = (c) => `<div class="rl"><a href="#${c.slug}" style="color:inherit;text-decoration:none"><span class="dot" style="background:${c.color};margin-right:6px"></span>${esc(c.name)}</a></div>`;
    const priceHeat = C.map((c, i) => ans[i] ? rowLab(c) + ans[i].seasonal_price.map((r, m) => `<div class="c ${m === NOW_M ? "now-col" : ""}" style="background:${heatColor(r.med)}" title="${MON[m]}: ${pct(r.med - 100)}">${r.med - 100 > 0 ? "+" : ""}${Math.round(r.med - 100)}</div>`).join("") : "").join("");
    const arrHeat = C.map((c, i) => ans[i] && ans[i].seasonal_arrivals ? rowLab(c) + ans[i].seasonal_arrivals.map((r, m) => { const d = r.med - 100; const a = Math.min(80, Math.abs(d) * 1.2); return `<div class="c" style="background:${d >= 0 ? `color-mix(in srgb, var(--tarp) ${a}%, var(--card))` : "var(--card)"}" title="${MON[m]}: ${pct(d)}">${d > 0 ? "+" : ""}${Math.round(d)}</div>`; }).join("") : "").join("");
    const harvest = C.map((c, i) => {
      const kb = kbs[i]; if (!kb) return "";
      const hv = new Set(); const sw = new Set();
      kb.seasons.forEach((s) => { (s.harvest || []).forEach((m) => hv.add(m)); (s.sow || []).forEach((m) => sw.add(m)); });
      return rowLab(c) + MON.map((_, m) => `<div class="c ${m === NOW_M ? "now-col" : ""}">${hv.has(m + 1) ? '<span class="bar harv"></span>' : sw.has(m + 1) ? '<span class="bar sow"></span>' : ""}</div>`).join("");
    }).join("");
    const risk = C.map((c, i) => {
      const kb = kbs[i]; if (!kb) return "";
      return rowLab(c) + MON.map((_, m) => { const rs = kb.weather_risks.filter((r) => r.months.includes(m + 1)); return `<div class="c" title="${esc(rs.map((r) => r.risk).join("; "))}" style="background:${rs.length ? `color-mix(in srgb, var(--chilli) ${Math.min(75, rs.length * 28)}%, var(--card))` : "transparent"};font-family:var(--f-mono)">${rs.length || ""}</div>`; }).join("");
    }).join("");
    app.innerHTML = `
      <section class="section"><div class="sec-head"><div><p class="eyebrow">Calendar</p><h2 class="h-sec">The year in prices, harvests and weather</h2></div><p class="note">All ten commodities side by side. Current month highlighted.</p></div>
        <h3 style="margin:16px 0 8px">Typical price vs yearly average, %</h3><div class="tablewrap"><div class="cal heat">${head}${priceHeat}</div></div>
        <p class="src">Median 2008–2025, all-India mandi modal (CEDA / Agmarknet).</p>
        <h3 style="margin:24px 0 8px">Mandi arrivals vs yearly average, %</h3><div class="tablewrap"><div class="cal heat">${head}${arrHeat}</div></div>
        <p class="src">Blue = more produce reaching mandis than average. Arrivals and prices usually move in opposite directions.</p>
        <h3 style="margin:24px 0 8px">Harvest and sowing windows</h3><div class="tablewrap"><div class="cal">${head}${harvest}</div></div>
        <div class="legend"><span><i class="bar sow" style="width:18px;height:10px;display:inline-block"></i>Sowing / planting / flowering</span><span><i style="background:${css("--turmeric")};width:18px;height:10px"></i>Harvest (any region)</span></div>
        <h3 style="margin:24px 0 8px">Weather risk months</h3><div class="tablewrap"><div class="cal">${head}${risk}</div></div>
        <p class="src">Number of listed weather risks per month; hover for names. Details on each commodity page.</p>
      </section>`;
  }

  // =====================================================================
  // SUPPLY CHAIN (general explainer)
  // =====================================================================
  async function viewChain() {
    const doca = await opt("data/doca/daily.json");
    const qc = await opt("data/retail/quick_commerce.json");
    const on = docaFor(doca, "Onion");
    const onQc = qc && qc.items.onion && qc.items.onion[0];
    app.innerHTML = `
      <section class="section"><div class="sec-head"><div><p class="eyebrow">Supply chain</p><h2 class="h-sec">How fresh produce moves in India</h2></div></div>
        <p class="lede">Most fruit and vegetables pass through at least four hands between the farm and a kitchen. The regulated APMC mandi is the central node: it is where prices are discovered and recorded, and where most of the public price data on this site comes from.</p>
        <div class="chain" style="margin-top:16px">
          ${[["Farm", "Harvest, sorting, sometimes field storage (onion chawls, potato heaps). Small farms sell in tractor or tempo loads."],
            ["Aggregation", "Village traders, FPOs, or the commission agent's sub-agents gather loads; agri-tech platforms (Ninjacart, DeHaat, Vegrow, WayCool) buy direct for B2B and quick commerce."],
            ["APMC mandi", "Open auction (bidding by voice, tender or e-NAM). A licensed commission agent (arhtiya / adatiya) runs the sale and pays the farmer."],
            ["Trader / wholesaler", "Grades, packs, stores (cold stores, CA, ripening chambers) and ships to distant markets."],
            ["Terminal market", "Big consuming mandis: Azadpur (Delhi), Vashi (Navi Mumbai), Koyambedu (Chennai), Bowenpally (Hyderabad), Yeshwanthpur (Bengaluru), Kolkata."],
            ["Retail", "Semi-wholesalers → street vendors, kiranas, modern retail; quick-commerce dark stores replenish daily from their own collection centres."]].map((s, i) => `<div class="step"><span class="n">${String(i + 1).padStart(2, "0")}</span><h4>${s[0]}</h4><p>${s[1]}</p></div>`).join("")}
        </div>
      </section>
      <section class="section grid g2">
        <div class="panel"><h3>Who takes what at the mandi</h3><div class="tablewrap"><table class="dt"><thead><tr><th>Charge</th><th>Typical level</th><th>Paid by</th></tr></thead><tbody>
          <tr><td>Commission (arhat)</td><td>4–8% of sale value (6% common in Delhi for F&amp;V)</td><td>Farmer or buyer, by state rule</td></tr>
          <tr><td>Market fee / cess</td><td>0.5–2% (some states exempt F&amp;V)</td><td>Buyer</td></tr>
          <tr><td>Loading, weighing (hamali, tulai)</td><td>Fixed per bag or quintal</td><td>Farmer</td></tr>
          <tr><td>Freight to mandi</td><td>Distance-based</td><td>Farmer</td></tr>
          <tr><td>Losses and rejections</td><td>5–12% of produce (NABCONS)</td><td>Whoever holds it</td></tr></tbody></table></div>
          <p class="src">Rates vary by state APMC Act; several states have delisted fruit and vegetables from APMC regulation (e.g. Maharashtra in 2016), so trade can also happen outside mandis.</p></div>
        <div class="panel"><h3>Onion today, step by step</h3>
          ${on.retail ? `<div class="ladder">${[["Farmer (est.)", on.retail * 0.36, "36% of retail, RBI"], ["Wholesale", kg(on.wholesale), "DoCA all-India"], ["Retail", on.retail, "DoCA all-India"]].concat(onQc ? [["Quick commerce", onQc.per_kg, "Blinkit, Delhi"]] : []).map((l, i, arr) => `<div class="rung"><span>${l[0]}<br><span class="note">${l[2]}</span></span><div class="track"><div class="fill" style="width:${(l[1] / Math.max(...arr.map((x) => x[1])) * 100).toFixed(1)}%"></div></div><span class="v">₹${inr(l[1], 1)}</span></div>`).join("")}</div>
          <p class="src">₹/kg on ${fmtDate(on.date)}. The farmer figure applies RBI's estimated farmer share to today's retail price; it is an estimate.</p>` : '<p class="note">Live prices unavailable.</p>'}
        </div>
      </section>
      <section class="section grid g3">
        <div class="panel"><h3>Transport</h3><ul class="list">
          <li>Road carries the vast majority of produce, mostly in open trucks under tarpaulin; refrigerated trucks are a small minority.</li>
          <li>Kisan Rail (2020–22) ran perishable parcel trains with a 50% freight subsidy; parcel vans remain for bananas, apples and mangoes.</li>
          <li>Exports leave by reefer container from JNPT and Mundra (grapes, bananas, onions) or by air (mangoes to the US).</li></ul></div>
        <div class="panel"><h3>Cold chain</h3><ul class="list">
          <li>About 8,000+ cold stores with roughly 40 million t of capacity, mostly single-commodity potato stores in UP, West Bengal, Punjab and Gujarat.</li>
          <li>The 2015 NCCD gap study found the shortfall was not in bulk storage but in pack-houses, reefer trucks and ripening chambers.</li>
          <li>Ripening chambers (ethylene) matter for banana and mango; controlled-atmosphere stores for apples.</li></ul></div>
        <div class="panel"><h3>Quick commerce</h3><ul class="list">
          <li>Blinkit, Zepto, Swiggy Instamart and others run dark stores replenished daily from city collection centres.</li>
          <li>Sourcing mixes mandi purchases, agri-tech aggregators and FPO contracts; sorting and grading drive the premium.</li>
          <li>Shelf prices change by store and hour; the site stores dated snapshots rather than a continuous scrape.</li></ul></div>
      </section>
      <section class="section"><div class="sec-head"><div><p class="eyebrow">Glossary</p><h2 class="h-sec">Units and terms</h2></div></div>
        <div class="tablewrap"><table class="dt"><tbody>
          <tr><td><b>Quintal</b></td><td>100 kg. Mandi prices are quoted in ₹/quintal; divide by 100 for ₹/kg.</td></tr>
          <tr><td><b>Lakh / crore</b></td><td>1 lakh = 100,000; 1 crore = 10 million. 1 lakh tonnes = 0.1 million tonnes.</td></tr>
          <tr><td><b>Modal price</b></td><td>The price at which most of the day's lots traded in a mandi; more robust than the average.</td></tr>
          <tr><td><b>Arrivals</b></td><td>Tonnes of produce brought to a mandi on a day; the best daily supply signal.</td></tr>
          <tr><td><b>APMC</b></td><td>Agricultural Produce Market Committee, the state-regulated market yard.</td></tr>
          <tr><td><b>Arhtiya / adatiya</b></td><td>Licensed commission agent who conducts sales and often finances farmers.</td></tr>
          <tr><td><b>Kharif / rabi / zaid</b></td><td>Monsoon season (Jun–Oct) / winter season (Oct–Mar) / summer season (Mar–Jun) crops.</td></tr>
          <tr><td><b>TOP</b></td><td>Tomato, onion, potato: the three vegetables that drive most food-inflation swings and have dedicated schemes (Operation Greens).</td></tr>
          <tr><td><b>MEP / MIP</b></td><td>Minimum export price / minimum import price set by DGFT to restrict trade.</td></tr>
          <tr><td><b>Climacteric</b></td><td>Fruit that keeps ripening after harvest and responds to ethylene (banana, mango, apple, tomato).</td></tr></tbody></table></div>
      </section>`;
  }

  // =====================================================================
  // SOURCES
  // =====================================================================
  async function viewSources() {
    const src = await j("data/sources.json");
    const badge = (u) => /^Yes/.test(u) ? `<span class="badge yes">${esc(u)}</span>` : /^Pipeline|Indirect/.test(u) ? `<span class="badge pipe">${esc(u)}</span>` : `<span class="badge">${esc(u)}</span>`;
    app.innerHTML = `
      <section class="section"><div class="sec-head"><div><p class="eyebrow">Sources</p><h2 class="h-sec">Every source on Indian perishables we found</h2></div><p class="note">Access checked ${fmtDate(src.checked)}.</p></div>
        <p class="lede">${esc(src.access_note)}</p>
        <div class="toc" style="position:static;display:flex;flex-wrap:wrap;gap:4px;border:0;margin-top:12px">${src.groups.map((g) => `<a href="#sources" data-sec="g-${g.id}" style="border:1px solid var(--rule);border-radius:999px;padding:2px 10px;margin:0">${esc(g.title)}</a>`).join("")}</div>
      </section>
      ${src.groups.map((g) => `<section class="section" id="g-${g.id}"><h3 style="font-size:var(--t-lg);margin-bottom:8px">${esc(g.title)}</h3>
        <div class="tablewrap"><table class="dt"><thead><tr><th>Source</th><th>What it has</th><th>Granularity</th><th>Updates</th><th>Access</th><th>On this site</th></tr></thead>
        <tbody>${g.items.map((s) => `<tr><td><a href="${esc(s.url)}" target="_blank" rel="noopener"><b>${esc(s.name)}</b></a><br><span class="note">${esc(s.org)}</span></td><td>${esc(s.what)}</td><td>${esc(s.granularity)}</td><td>${esc(s.freq)}</td><td>${esc(s.access)}</td><td>${badge(s.used)}</td></tr>`).join("")}</tbody></table></div></section>`).join("")}`;
    app.querySelectorAll("[data-sec]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); document.getElementById(a.dataset.sec).scrollIntoView({ behavior: "smooth" }); }));
  }

  // =====================================================================
  // METHOD
  // =====================================================================
  async function viewMethod() {
    const { ans } = await loadAll();
    const rows = S.manifest.commodities.map((c, i) => {
      const a = ans[i]; if (!a) return "";
      const m = a.backtest.mape;
      const best = (h) => Math.min(...["model", "analog", "persistence", "seasonal_naive"].map((k) => m[k][h] ?? 999));
      const cell = (k, h) => `<td class="num" style="${m[k][h] === best(h) ? "font-weight:600;color:var(--leaf)" : ""}">${m[k][h] ?? "–"}%</td>`;
      return `<tr><td><a href="#${c.slug}">${esc(c.name)}</a></td>${cell("model", 0)}${cell("persistence", 0)}${cell("model", 2)}${cell("analog", 2)}${cell("persistence", 2)}${cell("seasonal_naive", 2)}${cell("model", 5)}${cell("persistence", 5)}<td class="num">${a.backtest.direction_hit[2] ?? "–"}%</td></tr>`;
    }).join("");
    app.innerHTML = `
      <section class="section"><div class="sec-head"><div><p class="eyebrow">Method</p><h2 class="h-sec">How the data is collected and the forecast is made</h2></div></div>
        <div class="chain">${[["fetch_ceda.py", "Monthly and daily all-India, state and district mandi prices and arrivals since 2008 from CEDA (Agmarknet)."],
          ["fetch_doca.py", "Today's DoCA all-India retail and wholesale averages. Run daily; builds its own time series."],
          ["fetch_nhb.py", "NHB monthly wholesale, retail and arrivals by city since 2010; used for mark-ups."],
          ["fetch_ogd.py", "data.gov.in daily mandi prices for every market (API key, Indian network). Optional."],
          ["build_analytics.py", "Seasonality, volatility, shock half-life, outlook and backtests per commodity."],
          ["site/", "Static site (this page). Reads JSON from site/data; host anywhere, e.g. GitHub Pages."]].map((s, i) => `<div class="step"><span class="n">${String(i + 1).padStart(2, "0")}</span><h4 class="mono" style="font-size:var(--t-sm)">${s[0]}</h4><p>${s[1]}</p></div>`).join("")}</div>
      </section>
      <section class="section grid g2">
        <div class="panel"><h3>Forecast models</h3><ul class="list">
          <li><b>Seasonal index.</b> Each month's price divided by a centred 12-month moving average; the median by calendar month across 2008–2025 gives the typical seasonal shape.</li>
          <li><b>Seasonal analog outlook.</b> For the current calendar month, the spread of past price changes 1–6 months ahead (median, 10th and 90th percentiles). Needs no current price, so it works for all ten items today.</li>
          <li><b>Mean-reversion model.</b> log price = linear trend (last 8 years) + seasonal index + a shock that fades geometrically (AR(1)). Uses today's mandi price level; switches on when the data.gov.in feed is running.</li>
          <li><b>Backtest.</b> Rolling origin over the last 8 years: every month, fit on data available then and forecast 1–6 months ahead. Compared with "no change" and "same month last year".</li></ul></div>
        <div class="panel"><h3>Limits</h3><ul class="list">
          <li>The all-India modal is a simple average over reporting markets; the mix of markets changes over time.</li>
          <li>CEDA's cleaned series currently runs to October 2025. Until the daily feed runs, the outlook is unconditional on the current level.</li>
          <li>Policy shocks (export bans, buffer releases, stock limits) are not modelled; they mostly cap spikes.</li>
          <li>Weather enters only through history. Adding IMD rainfall and temperature for producing districts is the obvious next step.</li>
          <li>Production shares marked "approx." come from official estimates and summaries, rounded; check the linked sources.</li></ul></div>
      </section>
      <section class="section"><div class="sec-head"><div><p class="eyebrow">Accuracy</p><h2 class="h-sec">Backtest: mean absolute % error</h2></div><p class="note">Best method per horizon in green.</p></div>
        <div class="tablewrap"><table class="dt"><thead><tr><th>Commodity</th><th class="num">1 mo<br>model</th><th class="num">1 mo<br>no change</th><th class="num">3 mo<br>model</th><th class="num">3 mo<br>analog</th><th class="num">3 mo<br>no change</th><th class="num">3 mo<br>last year</th><th class="num">6 mo<br>model</th><th class="num">6 mo<br>no change</th><th class="num">3 mo<br>direction right</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      </section>
      <section class="section grid g2">
        <div class="panel"><h3>Run it yourself</h3>
          <pre class="mono" style="white-space:pre-wrap;font-size:var(--t-sm);background:var(--paper);padding:12px;border-radius:4px;border:1px solid var(--rule);overflow-x:auto">python3 pipeline/fetch_ceda.py
python3 pipeline/fetch_doca.py
python3 pipeline/fetch_nhb.py --from 2010
DATA_GOV_IN_API_KEY=… python3 pipeline/fetch_ogd.py
python3 pipeline/build_analytics.py
python3 -m http.server -d site 8000</pre>
          <p class="note">Python 3.9+ and numpy. A GitHub Actions workflow refreshes DoCA daily and CEDA weekly.</p></div>
        <div class="panel"><h3>Add a commodity</h3><ol class="list">
          <li>Add it to <span class="mono">COMMODITIES</span> in <span class="mono">pipeline/common.py</span> and its CEDA id in <span class="mono">fetch_ceda.py</span>.</li>
          <li>Write <span class="mono">site/data/kb/&lt;slug&gt;.json</span> using any existing file as the template.</li>
          <li>Run the fetchers and <span class="mono">build_analytics.py</span>; the site picks it up from the manifest.</li></ol></div>
      </section>`;
  }

  // =====================================================================
  // ROUTER
  // =====================================================================
  async function render(keepScroll) {
    const r = (location.hash || "#board").slice(1) || "board";
    if (S.observer) { S.observer.disconnect(); S.observer = null; }
    killCharts();
    chartDefaults();
    navActive(r);
    chipStrip(r);
    const y = window.scrollY;
    try {
      if (r === "board") await viewBoard();
      else if (r === "commodities") await viewCommodities();
      else if (r === "calendar") await viewCalendar();
      else if (r === "supply-chain") await viewChain();
      else if (r === "sources") await viewSources();
      else if (r === "method") await viewMethod();
      else if (S.manifest.commodities.some((c) => c.slug === r)) await viewCommodity(r);
      else await viewBoard();
    } catch (e) {
      console.error(e);
      app.innerHTML = `<p class="err">Could not load this page: ${esc(e.message)}. If you opened the file directly, serve the folder over http (python3 -m http.server -d site).</p>`;
    }
    if (keepScroll) window.scrollTo(0, y); else if (S.route !== r) window.scrollTo(0, 0);
    S.route = r;
    document.title = (S.manifest.commodities.find((c) => c.slug === r) || {}).name ? `${S.manifest.commodities.find((c) => c.slug === r).name} · Mandi Atlas` : "Mandi Atlas";
  }

  (async function init() {
    try {
      S.manifest = await j("data/manifest.json");
    } catch (e) {
      app.innerHTML = `<p class="err">Could not load data/manifest.json. Serve the site folder over http, e.g. <span class="mono">python3 -m http.server -d site</span>.</p>`;
      return;
    }
    const f = S.manifest.freshness;
    document.getElementById("fresh").textContent = `Data: DoCA ${fmtDate(f.doca)} · Mandi history to ${fmtDate(f.ceda)} · Built ${fmtDate(S.manifest.built)}`;
    window.addEventListener("hashchange", () => render(false));
    render(false);
  })();
})();
