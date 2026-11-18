/* Reaktionslabor engine – ported from the original single-file HTML app. */
import APP_DATA from "./app-data.json";

/* Chemie 1. KA – Lernsystem. Alle Widgets rechnen mit den Formeln aus Band 1. */
const A: any = APP_DATA;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
};
const SVGNS = "http://www.w3.org/2000/svg";
const s = (tag, attrs = {}, ...kids) => {
  const e = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
};
// deutsche Zahlformatierung
const fmt = (x, d = 2) => {
  if (!isFinite(x)) return "–";
  return x.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
};
const sci = (x, d = 2) => {
  if (!isFinite(x)) return "–";
  if (x === 0) return "0";
  const e = Math.floor(Math.log10(Math.abs(x)));
  if (e >= -2 && e <= 4) return fmt(x, Math.max(0, d - Math.max(0, e)));
  const m = x / Math.pow(10, e);
  const sup = String(e).replace(/-/g, "⁻").replace(/\d/g, c => "⁰¹²³⁴⁵⁶⁷⁸⁹"[c]);
  return fmt(m, d) + " · 10" + sup;
};
const R = 8.314;

/* ---------- Fortschritt (localStorage + optional db) ---------- */
const STORE_KEY = "reaktionslabor-v1";
const Prog = {
  d: { quiz: {}, rate: {}, cards: {}, notes: {}, seen: {}, wrong: {}, exams: {}, written: {}, settings: { name: "", show: false }, t: 0 } as any,
  db: null, ref: null, writing: false, pending: false, timer: null,
  load() {
    try { const raw = localStorage.getItem(STORE_KEY); if (raw) Object.assign(this.d, JSON.parse(raw)); } catch (e) {}
  },
  save() {
    this.d.t = Date.now();
    try { localStorage.setItem(STORE_KEY, JSON.stringify(this.d)); } catch (e) {}
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.push(), 1500);
    updateSideRings();
  },
  async push() {
    if (!this.ref) return;
    if (this.writing) { this.pending = true; return; }
    this.writing = true;
    try { await this.ref.set({ json: JSON.stringify(this.d), t: this.d.t }); Social.st.saveOk = true; setSync("Fortschritt in deinem Konto gespeichert."); }
    catch (e) { Social.st.saveOk = false; setSync("Fortschritt nur in diesem Browser gespeichert."); }
    try { await Social.publish(); } catch (e) {}
    this.writing = false;
    if (this.pending) { this.pending = false; this.push(); }
  },
  async connect() {
    try {
      if (!window.claude || !window.claude.use) return;
      const db = await window.claude.use("db");
      const user = await window.claude.use("user");
      if (!db || !user) return;
      const id = await user.id();
      if (!id) return;
      this.ref = db.doc("data/users/" + id + "/progress");
      Social.init(db, user, id);
      const snap = await this.ref.get();
      if (snap.exists) {
        const remote = snap.data();
        if (remote && remote.json && (remote.t || 0) > (this.d.t || 0)) {
          Object.assign(this.d, JSON.parse(remote.json));
          try { localStorage.setItem(STORE_KEY, JSON.stringify(this.d)); } catch (e) {}
          render();
        }
      }
      setSync("Fortschritt wird in deinem Konto gespeichert.");
    } catch (e) { /* Browser-Speicher genügt */ }
  }
};
function setSync(t) { const el = $("#sync"); if (el) el.textContent = t; }

// Meisterschaft eines Kapitels: 60 % Wissenscheck, 40 % Selbsteinschätzung
function mastery(cid) {
  const q = Prog.d.quiz[cid];
  const rates = Object.entries(Prog.d.rate).filter(([k]) => k.startsWith(cid + ":"));
  const qs = q ? q.best : null;
  const rs = rates.length ? rates.reduce((a, [, v]) => a + v / 2, 0) / rates.length : null;
  if (qs == null && rs == null) return null;
  if (qs == null) return rs * 0.4; // nur Selbsteinschätzung: höchstens 40 %
  if (rs == null) return qs * 0.6; // nur Wissenscheck: höchstens 60 %
  return qs * 0.6 + rs * 0.4;
}
function masteryLabel(m) {
  if (m == null) return ["offen", "p0"];
  if (m < 0.4) return ["unsicher", "p1"];
  if (m < 0.8) return ["auf dem Weg", "p2"];
  return ["sicher", "p3"];
}

/* ---------- Diagramm-Helfer ---------- */
function makeChart({ w = 640, h: hh = 320, pad = [46, 18, 22, 44], x, y, xl, yl, xt = 5, yt = 5, xfmt = v => fmt(v, 0), yfmt = v => fmt(v, 2), title }) {
  const [pl, pr, pt, pb] = pad;
  const svg = s("svg", { viewBox: `0 0 ${w} ${hh}`, class: "chart", role: "img", "aria-label": title || "" });
  const X = v => pl + (v - x[0]) / (x[1] - x[0]) * (w - pl - pr);
  const Y = v => hh - pb - (v - y[0]) / (y[1] - y[0]) * (hh - pt - pb);
  const g = s("g");
  for (let i = 0; i <= yt; i++) {
    const v = y[0] + (y[1] - y[0]) * i / yt;
    g.append(s("line", { x1: pl, x2: w - pr, y1: Y(v), y2: Y(v), class: "grid" }));
    g.append(s("text", { x: pl - 6, y: Y(v) + 4, "text-anchor": "end" }, yfmt(v)));
  }
  for (let i = 0; i <= xt; i++) {
    const v = x[0] + (x[1] - x[0]) * i / xt;
    g.append(s("text", { x: X(v), y: hh - pb + 16, "text-anchor": "middle" }, xfmt(v)));
  }
  g.append(s("line", { x1: pl, x2: w - pr, y1: Y(y[0]), y2: Y(y[0]), class: "ax" }));
  g.append(s("line", { x1: pl, x2: pl, y1: pt, y2: hh - pb, class: "ax" }));
  if (xl) g.append(s("text", { x: w - pr, y: hh - 6, "text-anchor": "end" }, xl));
  if (yl) g.append(s("text", { x: pl, y: pt - 8, "text-anchor": "start" }, yl));
  svg.append(g);
  return { svg, X, Y, w, h: hh, pl, pr, pt, pb };
}
function polyline(pts, attrs) { return s("polyline", Object.assign({ points: pts.map(p => p.join(",")).join(" "), fill: "none" }, attrs)); }
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

/* ---------- Bausteine ---------- */
function lab(kind, label, title, cls, ...body) {
  return h("section", { class: "lab " + cls },
    h("div", { class: "lab-head" }, h("span", { class: "kind" }, label), h("h4", {}, title), h("span", { class: "chip tag-app", title: "Von der App ergänzt, nicht aus deinen Unterlagen" }, "Ergänzung")),
    h("div", { class: "lab-body" }, ...body));
}
function slider(id, label, min, max, step, val, unit, onInput, show = v => fmt(v, step < 1 ? (step < 0.1 ? 2 : 1) : 0)) {
  const out = h("output", { for: id }, show(+val) + (unit ? " " + unit : ""));
  const inp = h("input", { type: "range", id, min, max, step, value: val, "aria-label": label });
  const upd = () => { out.textContent = show(+inp.value) + (unit ? " " + unit : ""); onInput(+inp.value); };
  inp.addEventListener("input", upd);
  const wrap = h("div", { class: "ctl" }, h("label", { for: id }, h("span", {}, label), out), inp);
  wrap.inp = inp; wrap.upd = upd; wrap.set = v => { inp.value = v; upd(); };
  return wrap;
}
let uid = 0; const nid = p => p + "-" + (++uid);

/* ---------- Formel-Panels ---------- */
const FORMULAS = {
  n_m: { title: "Stoffmenge aus der Masse", src: "Band 1, 1.3", tokens: [{ v: "n" }, " = ", { v: "m" }, " / ", { v: "M" }],
    vars: { n: { name: "Stoffmenge", unit: "mol", role: "gesuchte Größe: Anzahl der Teilchen in Mol", infl: "wächst mit m, sinkt mit M", ex: "0,12 g Mg → 4,94 mmol" },
      m: { name: "Masse der Stoffportion", unit: "g", role: "gemessene Größe (Waage)", infl: "doppelte Masse → doppelte Stoffmenge", ex: "m = 0,12 g", val: 0.12, min: 0.01, max: 50, step: 0.01 },
      M: { name: "molare Masse", unit: "g/mol", role: "Stoffkonstante aus dem PSE", infl: "schwerere Teilchen → weniger Teilchen pro Gramm", ex: "M(Mg) = 24,31 g/mol", val: 24.31, min: 1, max: 200, step: 0.01 } },
    calc: v => ["n", sci(v.m / v.M, 3) + " mol"], cond: "Reiner Stoff; M aus dem PSE (Summe der Atommassen).", mist: "Einheiten mischen: m in mg und M in g/mol ergibt mmol, nicht mol." },
  c_nV: { title: "Stoffmengenkonzentration", src: "Band 1, 1.3", tokens: [{ v: "c" }, " = ", { v: "n" }, " / ", { v: "V" }],
    vars: { c: { name: "Stoffmengenkonzentration", unit: "mol/l", role: "gesuchte Größe", infl: "mehr Stoff oder weniger Lösung → größer", ex: "1 mmol/ml = 1 mol/l" },
      n: { name: "Stoffmenge des gelösten Stoffs", unit: "mol", role: "Teilchenzahl", infl: "proportional zu c", ex: "n = 0,010 mol", val: 0.01, min: 0.001, max: 2, step: 0.001 },
      V: { name: "Volumen der Lösung", unit: "l", role: "Volumen der gesamten Lösung, nicht des Lösungsmittels", infl: "doppeltes Volumen → halbe Konzentration", ex: "V = 0,010 l (10 ml)", val: 0.01, min: 0.001, max: 2, step: 0.001 } },
    calc: v => ["c", sci(v.n / v.V, 3) + " mol/l"], cond: "V ist das Volumen der Lösung (beim MWG: Gefäßvolumen).", mist: "Bei 2 l Gefäß die Stoffmengen nicht halbieren (c = n/V vergessen)." },
  n_V: { title: "Stoffmenge eines Gases", src: "Band 1, 1.3", tokens: [{ v: "n" }, " = ", { v: "V" }, " / ", { v: "Vₘ" }],
    vars: { n: { name: "Stoffmenge des Gases", unit: "mol", role: "gesuchte Größe", infl: "proportional zum Gasvolumen", ex: "29,0 ml / 22,4 ml/mmol = 1,30 mmol" },
      V: { name: "Gasvolumen", unit: "l", role: "Messgröße (Kolbenprober)", infl: "doppeltes Volumen → doppelte Stoffmenge", ex: "V = 0,029 l", val: 0.029, min: 0.001, max: 5, step: 0.001 },
      "Vₘ": { name: "molares Volumen", unit: "l/mol", role: "Volumen von 1 mol Gas bei gegebenem p und T", infl: "hängt von T und p ab, nicht vom Gas", ex: "22,4 (0 °C) · 24 (20 °C) · 24,46 l/mol (25 °C)", val: 22.4, choices: [22.4, 24, 24.46] } },
    calc: v => ["n", sci(v.V / v["Vₘ"], 3) + " mol"], cond: "Ideales Gas; Vₘ zur Temperatur der Messung wählen (immer den angegebenen Wert).", mist: "Vₘ für 0 °C verwenden, obwohl bei 25 °C gemessen wurde." },
  yield: { title: "Ausbeute", src: "Band 1, 1.6", tokens: [{ v: "η" }, " = ", { v: "n(tats.)" }, " / ", { v: "n(max.)" }, " · 100 %"],
    vars: { "η": { name: "Ausbeute", unit: "%", role: "gesuchte Größe", infl: "höchstens 100 %; bei Gleichgewichten immer darunter", ex: "0,08 / 0,13 = 61,5 %" },
      "n(tats.)": { name: "tatsächlich erhaltene Produktmenge", unit: "mol", role: "Messung oder GG-Rechnung", infl: "proportional", ex: "0,08 mol N₂O₄", val: 0.08, min: 0, max: 1, step: 0.005 },
      "n(max.)": { name: "maximal mögliche Produktmenge", unit: "mol", role: "aus dem limitierenden Edukt berechnet", infl: "Bezugsgröße", ex: "0,26/2 = 0,13 mol", val: 0.13, min: 0.005, max: 1, step: 0.005 } },
    calc: v => ["η", fmt(v["n(tats.)"] / v["n(max.)"] * 100, 1) + " %"], cond: "n(max.) immer über das limitierende Edukt bestimmen.", mist: "Auf das Edukt im Überschuss beziehen." },
  ea_r: { title: "Aktivierungsenergie der Rückreaktion", src: "Band 1, 2.6", tokens: [{ v: "Eₐ(rück)" }, " = ", { v: "Eₐ(hin)" }, " − ", { v: "ΔH" }],
    vars: { "Eₐ(rück)": { name: "Barriere der Rückreaktion", unit: "kJ/mol", role: "von den Produkten zum Gipfel", infl: "größer bei exothermer Hinreaktion", ex: "80 − (−50) = 130 kJ/mol" },
      "Eₐ(hin)": { name: "Aktivierungsenergie der Hinreaktion", unit: "kJ/mol", role: "von den Edukten zum Gipfel", infl: "geht 1 : 1 ein", ex: "80 kJ/mol", val: 80, min: 5, max: 300, step: 1 },
      "ΔH": { name: "Reaktionsenthalpie der Hinreaktion", unit: "kJ/mol", role: "Höhenunterschied Produkte − Edukte", infl: "negatives ΔH erhöht Eₐ(rück)", ex: "−50 kJ/mol", val: -50, min: -300, max: 250, step: 1 } },
    calc: v => ["Eₐ(rück)", fmt(v["Eₐ(hin)"] - v["ΔH"], 0) + " kJ/mol" + (v["Eₐ(hin)"] < v["ΔH"] ? " (unmöglich: Eₐ(hin) muss größer als ΔH sein)" : "")],
    cond: "Gilt für denselben Reaktionsweg (gleicher Übergangszustand).", mist: "Vorzeichen von ΔH nicht beachten: 80 − 50 statt 80 − (−50)." },
  v_dc: { title: "Reaktionsgeschwindigkeit", src: "Band 1, 3.1", tokens: [{ v: "v" }, " = ", { v: "Δc" }, " / ", { v: "Δt" }],
    vars: { v: { name: "mittlere Reaktionsgeschwindigkeit", unit: "mol/(l·s)", role: "Steigung der Sekante", infl: "größer bei größerer Änderung in kürzerer Zeit", ex: "0,10 mol/l in 20 s → 0,005 mol/(l·s)" },
      "Δc": { name: "Konzentrationsänderung (Produkt)", unit: "mol/l", role: "c(t₂) − c(t₁); bei Edukten mit Minus", infl: "proportional", ex: "0,30 − 0,20 = 0,10 mol/l", val: 0.1, min: 0.001, max: 1, step: 0.001 },
      "Δt": { name: "Zeitintervall", unit: "s", role: "t₂ − t₁", infl: "längeres Intervall → kleinerer Mittelwert", ex: "20 s", val: 20, min: 1, max: 600, step: 1 } },
    calc: v => ["v", sci(v["Δc"] / v["Δt"], 3) + " mol/(l·s)"], cond: "Angeben, auf welchen Stoff sich v bezieht (Stöchiometrie).", mist: "Bei Edukten das Minuszeichen vergessen (v wird negativ)." },
  rate: { title: "Geschwindigkeitsgesetz", src: "Band 1, 4.7", tokens: [{ v: "v" }, " = ", { v: "k" }, " · ", { v: "c(A)" }, " · ", { v: "c(B)" }],
    vars: { v: { name: "Reaktionsgeschwindigkeit", unit: "mol/(l·s)", role: "momentane Geschwindigkeit", infl: "proportional zu jedem Faktor", ex: "k = 0,5 l/(mol·s), c = 0,2 mol/l → v = 0,02" },
      k: { name: "Geschwindigkeitskonstante", unit: "l/(mol·s)", role: "Anteil wirksamer Stöße; hängt von T, Katalysator und Art der Reaktion ab", infl: "steigt mit T (RGT-Regel), mit Katalysator", ex: "k = 0,5 l/(mol·s)", val: 0.5, min: 0.01, max: 5, step: 0.01 },
      "c(A)": { name: "Konzentration von A", unit: "mol/l", role: "bestimmt mit c(B) die Stoßhäufigkeit", infl: "Verdopplung → v verdoppelt", ex: "0,20 mol/l", val: 0.2, min: 0.01, max: 2, step: 0.01 },
      "c(B)": { name: "Konzentration von B", unit: "mol/l", role: "bestimmt mit c(A) die Stoßhäufigkeit", infl: "Halbierung → v halbiert", ex: "0,20 mol/l", val: 0.2, min: 0.01, max: 2, step: 0.01 } },
    calc: v => ["v", sci(v.k * v["c(A)"] * v["c(B)"], 3) + " mol/(l·s)"], cond: "Für A + B → AB als Elementarreaktion; k unabhängig von c.", mist: "Annehmen, k ändere sich mit der Konzentration." },
  rgt: { title: "RGT-Regel", src: "Band 1, 4.6", tokens: [{ v: "v₂/v₁" }, " = ", { v: "q" }, " hoch (", { v: "ΔT" }, " / 10 K)"],
    vars: { "v₂/v₁": { name: "Geschwindigkeitsverhältnis", unit: "–", role: "Faktor, um den die Reaktion schneller wird", infl: "exponentiell in ΔT", ex: "+30 K, q = 2 → 8" },
      q: { name: "Faktor pro 10 K", unit: "–", role: "Faustregel 2 bis 4 (abhängig von Eₐ)", infl: "höheres Eₐ → größeres q", ex: "q = 2", val: 2, min: 2, max: 4, step: 0.1 },
      "ΔT": { name: "Temperaturerhöhung", unit: "K", role: "Unterschied in K (= °C-Differenz)", infl: "jede 10 K multiplizieren mit q", ex: "ΔT = 30 K", val: 30, min: -40, max: 60, step: 1 } },
    calc: v => ["v₂/v₁", sci(Math.pow(v.q, v["ΔT"] / 10), 3)], cond: "Faustregel für Reaktionen mit Eₐ in typischer Größenordnung, nahe Raumtemperatur.", mist: "Linear rechnen: +30 K ergibt bei q = 2 nicht 6, sondern 2³ = 8." },
  vhat: { title: "Wahrscheinlichste Geschwindigkeit", src: "Band 1, 4.3", tokens: [{ v: "v̂" }, " = √(2 · ", { v: "R" }, " · ", { v: "T" }, " / ", { v: "M" }, ")"],
    vars: { "v̂": { name: "wahrscheinlichste Teilchengeschwindigkeit", unit: "m/s", role: "Lage des Maximums der MB-Kurve", infl: "wächst mit √T, sinkt mit √M", ex: "O₂, 298 K: 394 m/s" },
      R: { name: "universelle Gaskonstante", unit: "J/(mol·K)", role: "Konstante, 1 J = 1 kg·m²/s²", infl: "fest", ex: "8,314", val: 8.314, fixed: true },
      T: { name: "absolute Temperatur", unit: "K", role: "T = ϑ + 273,15", infl: "4-fache Temperatur → doppeltes v̂", ex: "298 K", val: 298, min: 100, max: 1500, step: 1 },
      M: { name: "molare Masse", unit: "kg/mol", role: "in kg/mol einsetzen, damit m/s herauskommt", infl: "schwerere Teilchen sind langsamer", ex: "O₂: 0,032 kg/mol", val: 0.032, min: 0.002, max: 0.2, step: 0.001 } },
    calc: v => ["v̂", fmt(Math.sqrt(2 * R * v.T / v.M), 0) + " m/s"], cond: "Ideales Gas; T in Kelvin, M in kg/mol.", mist: "M in g/mol einsetzen (Ergebnis um √1000 ≈ 31,6 zu klein)." },
  vbar: { title: "Mittlere Geschwindigkeit", src: "Band 1, 4.3", tokens: [{ v: "v̄" }, " = √(8 · ", { v: "R" }, " · ", { v: "T" }, " / (π · ", { v: "M" }, "))"],
    vars: { "v̄": { name: "mittlere Teilchengeschwindigkeit", unit: "m/s", role: "Durchschnitt aller Teilchen", infl: "v̄ ≈ 1,128 · v̂", ex: "O₂, 298 K: 444 m/s" },
      R: { name: "universelle Gaskonstante", unit: "J/(mol·K)", role: "Konstante", infl: "fest", ex: "8,314", val: 8.314, fixed: true },
      T: { name: "absolute Temperatur", unit: "K", role: "T = ϑ + 273,15", infl: "wächst mit √T", ex: "298 K", val: 298, min: 100, max: 1500, step: 1 },
      M: { name: "molare Masse", unit: "kg/mol", role: "in kg/mol", infl: "sinkt mit √M", ex: "0,032 kg/mol", val: 0.032, min: 0.002, max: 0.2, step: 0.001 } },
    calc: v => ["v̄", fmt(Math.sqrt(8 * R * v.T / (Math.PI * v.M)), 0) + " m/s"], cond: "Ideales Gas; T in K, M in kg/mol.", mist: "π vergessen oder 8 durch 2 ersetzen (das wäre v̂)." },
  boltz: { title: "Anteil energiereicher Teilchen", src: "Band 1, 4.5 [Vertiefung]", tokens: [{ v: "Anteil" }, " ≈ exp(−", { v: "Eₐ" }, " / (", { v: "R" }, " · ", { v: "T" }, "))"],
    vars: { Anteil: { name: "Anteil der Teilchen mit E ≥ Eₐ", unit: "–", role: "Näherung (Boltzmann-Faktor)", infl: "wächst stark mit T, sinkt stark mit Eₐ", ex: "Eₐ = 50 kJ/mol, 298 K: 1,7 · 10⁻⁹" },
      "Eₐ": { name: "Aktivierungsenergie", unit: "J/mol", role: "Schwelle", infl: "größeres Eₐ → winziger Anteil, aber stärkere Temperaturabhängigkeit", ex: "50 000 J/mol", val: 50000, min: 5000, max: 150000, step: 500 },
      R: { name: "Gaskonstante", unit: "J/(mol·K)", role: "Konstante", infl: "fest", ex: "8,314", val: 8.314, fixed: true },
      T: { name: "Temperatur", unit: "K", role: "absolute Temperatur", infl: "+10 K bei 298 K → Anteil etwa ×2 (bei Eₐ ≈ 53 kJ/mol)", ex: "298 K", val: 298, min: 200, max: 1000, step: 1 } },
    calc: v => ["Anteil", sci(Math.exp(-v["Eₐ"] / (R * v.T)), 2)], cond: "Näherung; Eₐ in J/mol einsetzen.", mist: "Eₐ in kJ/mol einsetzen (Faktor 1000)." },
  arrh: { title: "Arrhenius-Gleichung", src: "Band 1, 4.7 [Vertiefung]", tokens: [{ v: "k" }, " = ", { v: "A" }, " · exp(−", { v: "Eₐ" }, " / (", { v: "R" }, " · ", { v: "T" }, "))"],
    vars: { k: { name: "Geschwindigkeitskonstante", unit: "wie A", role: "Ergebnis", infl: "steigt mit T, sinkt mit Eₐ", ex: "–" },
      A: { name: "Häufigkeitsfaktor", unit: "z. B. l/(mol·s)", role: "Stoßzahl und Orientierung", infl: "proportional", ex: "A = 1·10¹⁰", val: 1e10, min: 1e6, max: 1e12, step: 1e6, log: true },
      "Eₐ": { name: "Aktivierungsenergie", unit: "J/mol", role: "Schwelle", infl: "exponentiell", ex: "50 000 J/mol", val: 50000, min: 5000, max: 150000, step: 500 },
      R: { name: "Gaskonstante", unit: "J/(mol·K)", role: "Konstante", infl: "fest", ex: "8,314", val: 8.314, fixed: true },
      T: { name: "Temperatur", unit: "K", role: "absolute Temperatur", infl: "exponentiell", ex: "298 K", val: 298, min: 200, max: 1000, step: 1 } },
    calc: v => ["k", sci(v.A * Math.exp(-v["Eₐ"] / (R * v.T)), 3)], cond: "Vertiefung über die KA hinaus.", mist: "Temperatur in °C einsetzen." },
  K_k: { title: "Kinetik und Gleichgewicht", src: "Band 1, 7.1", tokens: [{ v: "Kc" }, " = ", { v: "k(hin)" }, " / ", { v: "k(rück)" }],
    vars: { Kc: { name: "Gleichgewichtskonstante", unit: "(mol/l) hoch Δν", role: "Lage des Gleichgewichts", infl: "K ≫ 1: Produktseite", ex: "(1/2)/(1/10) = 5" },
      "k(hin)": { name: "Konstante der Hinreaktion", unit: "", role: "Streichholzspiel: Anteil ½", infl: "größer → K größer", ex: "0,5", val: 0.5, min: 0.01, max: 1, step: 0.01 },
      "k(rück)": { name: "Konstante der Rückreaktion", unit: "", role: "Streichholzspiel: Anteil 1/10", infl: "größer → K kleiner", ex: "0,1", val: 0.1, min: 0.01, max: 1, step: 0.01 } },
    calc: v => ["Kc", sci(v["k(hin)"] / v["k(rück)"], 3)], cond: "Herleitung aus v(hin) = v(rück) im Gleichgewicht.", mist: "Glauben, ein Katalysator ändere K (er erhöht beide k gleich stark)." },
  pq: { title: "pq-Formel", src: "Band 1, 7.5", tokens: [{ v: "x" }, " = −", { v: "p" }, "/2 ± √((", { v: "p" }, "/2)² − ", { v: "q" }, ")"],
    vars: { x: { name: "Umsatz", unit: "mol/l", role: "nur die chemisch sinnvolle Lösung zählt", infl: "–", ex: "PCl₅: x₁ ≈ 0,181" },
      p: { name: "Koeffizient vor x in der Normalform", unit: "", role: "x² + p·x + q = 0", infl: "–", ex: "p = 0,04", val: 0.04, min: -5, max: 5, step: 0.01 },
      q: { name: "konstantes Glied der Normalform", unit: "", role: "x² + p·x + q = 0", infl: "–", ex: "q = −0,04", val: -0.04, min: -5, max: 5, step: 0.01 } },
    calc: v => { const D = (v.p / 2) ** 2 - v.q; if (D < 0) return ["x", "keine reelle Lösung"]; const r = Math.sqrt(D); return ["x₁ / x₂", fmt(-v.p / 2 + r, 3) + " / " + fmt(-v.p / 2 - r, 3)]; },
    cond: "Gleichung zuerst auf Normalform bringen (durch den Faktor vor x² teilen).", mist: "Negative Lösung oder eine, die zu negativen Konzentrationen führt, nicht verwerfen." },
};

function formulaPanel(key) {
  const F = FORMULAS[key]; if (!F) return h("div");
  const vals = {}; const info = h("dl", { class: "varinfo" });
  const out = h("div", { class: "tile" }, h("div", { class: "l" }, "Ergebnis"), h("div", { class: "v" }, ""));
  const showInfo = (sym, btn) => {
    $$(".var", fx).forEach(b => b.setAttribute("aria-pressed", "false"));
    if (btn) btn.setAttribute("aria-pressed", "true");
    const V = F.vars[sym];
    info.innerHTML = "";
    info.append(h("dt", {}, "Größe"), h("dd", {}, sym + " – " + V.name + (V.unit ? " in " + V.unit : "")),
      h("dt", {}, "Rolle in der Formel"), h("dd", {}, V.role),
      h("dt", {}, "Einfluss auf das Ergebnis"), h("dd", {}, V.infl),
      h("dt", {}, "Beispiel"), h("dd", {}, V.ex));
  };
  const fx = h("div", { class: "fx", role: "group", "aria-label": "Formel, Größen anklicken" });
  for (const t of F.tokens) {
    if (typeof t === "string") fx.append(h("span", { class: "op" }, t));
    else { const b = h("button", { class: "var", type: "button", "aria-pressed": "false", onclick: () => showInfo(t.v, b) }, t.v); fx.append(b); }
  }
  const ctrls = h("div", { class: "controls" });
  const recalc = () => { const [l, r] = F.calc(vals); out.firstChild.textContent = "Ergebnis: " + l; out.lastChild.textContent = r; };
  for (const [sym, V] of Object.entries(F.vars)) {
    if (V.val == null) continue;
    vals[sym] = V.val;
    if (V.fixed) continue;
    if (V.choices) {
      const id = nid("sel"); const sel = h("select", { id }, ...V.choices.map(c => h("option", { value: c }, fmt(c, c % 1 ? 2 : 0) + " " + V.unit)));
      sel.addEventListener("change", () => { vals[sym] = +sel.value; recalc(); });
      ctrls.append(h("div", { class: "ctl" }, h("label", { for: id }, sym), sel));
    } else if (V.log) {
      const id = nid("rng");
      const lo = Math.log10(V.min), hi = Math.log10(V.max);
      ctrls.append(slider(id, sym, lo, hi, 0.1, Math.log10(V.val), V.unit, x => { vals[sym] = Math.pow(10, x); recalc(); }, x => sci(Math.pow(10, x), 1)));
    } else {
      const id = nid("rng");
      ctrls.append(slider(id, sym, V.min, V.max, V.step, V.val, V.unit, x => { vals[sym] = x; recalc(); }, x => fmt(x, V.step >= 1 ? 0 : (V.step >= 0.1 ? 1 : (V.step >= 0.01 ? 2 : 3)))));
    }
  }
  recalc();
  showInfo(F.tokens.find(t => t.v).v, null);
  const el = lab("f", "Formel", F.title, "formula-lab",
    h("p", { class: "note" }, "Quelle: " + F.src + ". Klick auf eine Größe zeigt Bedeutung, Einheit und Einfluss; mit den Reglern rechnest du live."),
    fx, info, ctrls, h("div", { class: "readout" }, out),
    h("div", { class: "fx-meta" }, h("div", { class: "cond" }, h("b", {}, "Gilt, wenn"), F.cond), h("div", { class: "mist" }, h("b", {}, "Typischer Fehler"), F.mist)));
  el.querySelector(".chip").remove();
  el.querySelector(".lab-head").append(h("span", { class: "chip tag-ka" }, "Formel aus " + F.src.split(" [")[0]));
  return el;
}

/* ---------- Enthalpiediagramm ---------- */
function energyWidget(opt: any = {}) {
  const st = { ea: opt.ea ?? 80, dh: opt.dh ?? -50, cat: !!opt.cat, eak: opt.eak ?? 40 };
  const box = h("div", { class: "chartwrap" });
  const exp = h("div", { class: "explain", "aria-live": "polite" }, "Klick im Diagramm auf eine Beschriftung, um ihre Bedeutung zu sehen.");
  const readout = h("div", { class: "readout" });
  const TEXT = {
    edukte: "<b>Eduktniveau:</b> Enthalpie der Ausgangsstoffe. Von hier aus wird Eₐ(hin) gemessen.",
    produkte: "<b>Produktniveau:</b> liegt bei exothermen Reaktionen unter, bei endothermen über dem Eduktniveau.",
    ts: "<b>Übergangszustand [A–B]‡:</b> energiereichste, kurzlebige Anordnung; alte Bindungen halb gelöst, neue halb gebildet. Nicht isolierbar.",
    ea: "<b>Eₐ(hin):</b> Mindestenergie beim Zusammenstoß, damit die Reaktion abläuft. Pfeil vom Eduktniveau zum Maximum.",
    dh: "<b>ΔH = H(Produkte) − H(Edukte):</b> Pfeil vom Edukt- zum Produktniveau, mit Vorzeichen beschriften.",
    ear: "<b>Eₐ(rück) = Eₐ(hin) − ΔH:</b> Barriere von der Produktseite aus. Bei exothermer Hinreaktion größer als Eₐ(hin).",
    kat: "<b>Katalysierter Weg:</b> niedrigeres Maximum (gestrichelt), gleiche Anfangs- und Endniveaus. ΔH bleibt gleich, Eₐ(hin) und Eₐ(rück) sinken um denselben Betrag.",
  };
  const say = k => { exp.innerHTML = TEXT[k]; };
  let sEa = null, sK = null;
  const sync = (sl, v) => { if (sl && +sl.inp.value !== v) { sl.inp.value = v; sl.querySelector("output").textContent = fmt(v, 0) + " kJ/mol"; } };
  const draw = () => {
    if (st.ea < Math.max(0, st.dh) + 5) st.ea = Math.max(0, st.dh) + 5;
    if (st.eak > st.ea - 5) st.eak = Math.max(Math.max(0, st.dh) + 2, st.ea - 5);
    sync(sEa, st.ea); sync(sK, st.eak);
    const lo = Math.min(0, st.dh) - 30, hi = Math.max(st.ea, 0) + 40;
    const C = makeChart({ w: 640, h: 340, x: [0, 10], y: [lo, hi], yl: "H in kJ/mol (Edukte = 0)", xl: "Reaktionsweg", xt: 1, xfmt: () => "", yt: 5, yfmt: v => fmt(v, 0), title: "Enthalpiediagramm" });
    const { svg, X, Y } = C;
    const ink = css("--ink"), blue = css("--c-blue"), purple = css("--c-purple"), orange = css("--c-orange"), green = css("--c-green"), red = css("--c-red");
    const path = (peak, dash?) => `M ${X(0.6)} ${Y(0)} L ${X(2.2)} ${Y(0)} C ${X(3.6)} ${Y(0)} ${X(4)} ${Y(peak)} ${X(5)} ${Y(peak)} C ${X(6)} ${Y(peak)} ${X(6.4)} ${Y(st.dh)} ${X(7.8)} ${Y(st.dh)} L ${X(9.6)} ${Y(st.dh)}`;
    svg.append(s("path", { d: path(st.ea), fill: "none", stroke: ink, "stroke-width": 2.5 }));
    if (st.cat) svg.append(s("path", { d: path(st.eak), fill: "none", stroke: green, "stroke-width": 2.2, "stroke-dasharray": "7 5" }));
    const arrow = (x, y1, y2, col) => {
      const dir = y2 < y1 ? -1 : 1, a = Y(y2), b = Y(y1);
      return s("g", {}, s("line", { x1: X(x), x2: X(x), y1: b, y2: a, stroke: col, "stroke-width": 2 }),
        s("path", { d: `M ${X(x) - 5} ${a + (Y(y2) > Y(y1) ? -8 : 8)} L ${X(x)} ${a} L ${X(x) + 5} ${a + (Y(y2) > Y(y1) ? -8 : 8)}`, fill: "none", stroke: col, "stroke-width": 2 }));
    };
    svg.append(s("line", { x1: X(1.5), x2: X(5), y1: Y(st.ea), y2: Y(st.ea), stroke: css("--line"), "stroke-dasharray": "3 3" }));
    svg.append(arrow(1.6, 0, st.ea, purple));
    svg.append(s("line", { x1: X(5), x2: X(9.2), y1: Y(st.ea), y2: Y(st.ea), stroke: css("--line"), "stroke-dasharray": "3 3" }));
    svg.append(arrow(6.9, st.dh, st.ea, orange));
    svg.append(arrow(9.0, 0, st.dh, st.dh < 0 ? blue : red));
    svg.append(s("line", { x1: X(7.8), x2: X(9.3), y1: Y(0), y2: Y(0), stroke: css("--line"), "stroke-dasharray": "3 3" }));
    if (st.cat) svg.append(arrow(3.0, 0, st.eak, green));
    const label = (x, y, txt, key, col, anchor = "middle") => {
      const t = s("text", { x: X(x), y: Y(y), "text-anchor": anchor, class: "hit", tabindex: 0, role: "button", style: `fill:${col};font-size:13px;font-weight:600` }, txt);
      t.addEventListener("click", () => say(key)); t.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); say(key); } });
      svg.append(t);
    };
    label(1.4, 0, "Edukte", "edukte", ink); svg.lastChild.setAttribute("dy", "-8");
    label(8.1, st.dh, "Produkte", "produkte", ink); svg.lastChild.setAttribute("dy", "-8");
    label(5, st.ea, "[A–B]‡", "ts", ink); svg.lastChild.setAttribute("dy", "-10");
    label(1.75, st.ea / 2, "Eₐ(hin)", "ea", purple, "start");
    label(7.05, (st.ea + st.dh) / 2, "Eₐ(rück)", "ear", orange, "start");
    label(9.15, st.dh / 2, "ΔH", "dh", st.dh < 0 ? blue : red, "start");
    if (st.cat) { label(3.15, st.eak / 2, "Eₐ(Kat)", "kat", green, "start"); }
    box.innerHTML = ""; box.append(svg);
    readout.innerHTML = "";
    const tile = (l, v) => h("div", { class: "tile" }, h("div", { class: "l" }, l), h("div", { class: "v" }, v));
    readout.append(tile("Reaktionstyp", st.dh < 0 ? "exotherm (ΔH < 0)" : st.dh > 0 ? "endotherm (ΔH > 0)" : "ΔH = 0"),
      tile("Eₐ(hin)", fmt(st.ea, 0) + " kJ/mol"), tile("ΔH", (st.dh > 0 ? "+" : "") + fmt(st.dh, 0) + " kJ/mol"),
      tile("Eₐ(rück) = Eₐ(hin) − ΔH", fmt(st.ea - st.dh, 0) + " kJ/mol"));
    if (st.cat) readout.append(tile("mit Katalysator", "Eₐ(hin) " + fmt(st.eak, 0) + " · Eₐ(rück) " + fmt(st.eak - st.dh, 0) + " kJ/mol"));
  };
  sEa = slider(nid("ea"), "Eₐ(hin)", 5, 320, 1, st.ea, "kJ/mol", v => { st.ea = v; draw(); });
  const sDh = slider(nid("dh"), "ΔH", -300, 250, 1, st.dh, "kJ/mol", v => { st.dh = v; draw(); });
  sK = slider(nid("eak"), "Eₐ mit Katalysator", 2, 300, 1, st.eak, "kJ/mol", v => { st.eak = v; draw(); });
  const cbId = nid("cat");
  const cb = h("input", { type: "checkbox", id: cbId }); cb.checked = st.cat;
  cb.addEventListener("change", () => { st.cat = cb.checked; draw(); });
  const preset = (name, ea, dh, cat, eak) => h("button", { class: "btn", type: "button", onclick: () => { st.cat = cat; cb.checked = cat; st.eak = eak; sEa.set(ea); sDh.set(dh); sK.set(eak); } }, name);
  draw();
  return lab("s", "Interaktives Diagramm", opt.title || "Enthalpiediagramm erkunden", "sim",
    h("p", { class: "note" }, "Verändere Eₐ und ΔH. Die Höhen sind maßstäblich. Klick auf die Beschriftungen für Erklärungen."),
    box, exp, h("div", { class: "controls" }, sEa, sDh, h("div", { class: "ctl" }, h("label", { for: cbId }, h("span", {}, "Katalysatorweg einzeichnen"), cb), sK)),
    h("div", { class: "btnrow" }, h("span", { class: "note" }, "Beispiele:"), preset("Exotherm (allgemein)", 80, -50, false, 40), preset("Endotherm (CaCO₃-Zerfall, schematisch)", 220, 178, false, 150), preset("Kontaktverfahren (Probeklausur)", 120, -198, true, 60)),
    readout);
}

/* ---------- c-t-Diagramm mit Sekante und Tangente ---------- */
function ctWidget() {
  const data = [[1, 0.130], [2, 0.225], [3, 0.297], [4, 0.349], [5, 0.390], [10, 0.475], [15, 0.494]];
  const st = { k: 0.30, cEnd: 0.5, t1: 1, t2: 3, t0: 2, data: true };
  const c = t => st.cEnd * (1 - Math.exp(-st.k * t));
  const vAt = t => st.k * st.cEnd * Math.exp(-st.k * t);
  const box = h("div", { class: "chartwrap" }), box2 = h("div", { class: "chartwrap" }), readout = h("div", { class: "readout" });
  const draw = () => {
    if (st.t2 <= st.t1) st.t2 = st.t1 + 0.5;
    const C = makeChart({ w: 640, h: 300, x: [0, 16], y: [0, 0.6], xl: "t in min", yl: "c(Mg²⁺) in mmol/ml", xt: 8, yt: 6, xfmt: v => fmt(v, 0), yfmt: v => fmt(v, 1), title: "c-t-Diagramm" });
    const { svg, X, Y } = C; const cyan = css("--c-cyan"), purple = css("--c-purple"), orange = css("--c-orange"), ink = css("--ink");
    const pts = []; for (let t = 0; t <= 16; t += 0.1) pts.push([X(t), Y(c(t))]);
    svg.append(polyline(pts, { stroke: cyan, "stroke-width": 2.5 }));
    svg.append(s("line", { x1: X(0), x2: X(16), y1: Y(st.cEnd), y2: Y(st.cEnd), stroke: css("--muted"), "stroke-dasharray": "4 4" }));
    svg.append(s("text", { x: X(16), y: Y(st.cEnd) - 6, "text-anchor": "end" }, "Endwert bei vollständigem Umsatz"));
    if (st.data && Math.abs(st.k - 0.3) < 1e-9) for (const [t, v] of data) svg.append(s("circle", { cx: X(t), cy: Y(v), r: 4, fill: ink }));
    // Sekante
    const y1 = c(st.t1), y2 = c(st.t2), ms = (y2 - y1) / (st.t2 - st.t1);
    const sx0 = Math.max(0, st.t1 - 1.5), sx1 = Math.min(16, st.t2 + 1.5);
    svg.append(s("line", { x1: X(sx0), y1: Y(y1 + ms * (sx0 - st.t1)), x2: X(sx1), y2: Y(y1 + ms * (sx1 - st.t1)), stroke: orange, "stroke-width": 2 }));
    svg.append(s("circle", { cx: X(st.t1), cy: Y(y1), r: 4, fill: orange }), s("circle", { cx: X(st.t2), cy: Y(y2), r: 4, fill: orange }));
    // Tangente
    const yt = c(st.t0), mt = vAt(st.t0), tx0 = Math.max(0, st.t0 - 2.5), tx1 = Math.min(16, st.t0 + 2.5);
    svg.append(s("line", { x1: X(tx0), y1: Y(yt + mt * (tx0 - st.t0)), x2: X(tx1), y2: Y(yt + mt * (tx1 - st.t0)), stroke: purple, "stroke-width": 2, "stroke-dasharray": "6 4" }));
    svg.append(s("circle", { cx: X(st.t0), cy: Y(yt), r: 4.5, fill: purple }));
    box.innerHTML = ""; box.append(svg);
    const D = makeChart({ w: 640, h: 200, x: [0, 16], y: [0, Math.max(0.16, st.k * st.cEnd * 1.1)], xl: "t in min", yl: "v in mmol/(ml·min)", xt: 8, yt: 4, xfmt: v => fmt(v, 0), yfmt: v => fmt(v, 2), title: "v-t-Diagramm" });
    const p2 = []; for (let t = 0; t <= 16; t += 0.1) p2.push([D.X(t), D.Y(vAt(t))]);
    D.svg.append(polyline(p2, { stroke: cyan, "stroke-width": 2.5 }));
    D.svg.append(s("circle", { cx: D.X(st.t0), cy: D.Y(mt), r: 4.5, fill: purple }));
    box2.innerHTML = ""; box2.append(D.svg);
    readout.innerHTML = "";
    const tile = (l, v) => h("div", { class: "tile" }, h("div", { class: "l" }, l), h("div", { class: "v" }, v));
    readout.append(tile("Sekante: mittlere v (t₁ bis t₂)", fmt(ms, 3) + " mmol/(ml·min)"),
      tile("Tangente: momentane v bei t = " + fmt(st.t0, 1) + " min", fmt(mt, 3) + " mmol/(ml·min)"),
      tile("Anfangsgeschwindigkeit (t = 0)", fmt(vAt(0), 3) + " mmol/(ml·min)"));
  };
  const sk = slider(nid("k"), "Geschwindigkeit (Modellkonstante)", 0.05, 1.2, 0.01, st.k, "1/min", v => { st.k = v; draw(); });
  const s1 = slider(nid("t1"), "Sekante: t₁", 0, 14, 0.5, st.t1, "min", v => { st.t1 = v; draw(); });
  const s2 = slider(nid("t2"), "Sekante: t₂", 0.5, 16, 0.5, st.t2, "min", v => { st.t2 = v; draw(); });
  const s0 = slider(nid("t0"), "Tangente bei t", 0, 16, 0.1, st.t0, "min", v => { st.t0 = v; draw(); });
  draw();
  return lab("s", "Interaktiver Graph", "Sekante, Tangente und v-t-Diagramm (Mg + Salzsäure)", "sim",
    h("p", { class: "note" }, "Punkte: Messwerte aus Aufgabe 1 (Band 4), umgerechnet mit 22,4 ml/mmol. Linie: c = 0,5 · (1 − exp(−k·t)) mit k = 0,30/min passt sehr genau zu den Messwerten (Ergänzung in Band 4). Ändere k: Die Messpunkte verschwinden, denn sie gehören nur zu k = 0,30/min. Höheres k bedeutet schnellere Bedingungen bei gleichem Endwert."),
    box, h("div", { class: "controls" }, sk, s1, s2, s0), readout, box2,
    h("p", { class: "note" }, "Die Tangentensteigung im c-t-Diagramm ist genau der Wert der v-t-Kurve zum selben Zeitpunkt (lila Punkt)."));
}

/* ---------- Maxwell-Boltzmann ---------- */
function mbWidget(opt: any = {}) {
  const GASES = { "H₂": 0.002016, "N₂": 0.02801, "O₂": 0.032, "Cl₂": 0.0709 };
  const st = { gas: "O₂", T1: 298, T2: 373, two: true, vth: 800, cat: !!opt.cat, vthK: 600 };
  const f = (v, T, M) => 4 * Math.PI * Math.pow(M / (2 * Math.PI * R * T), 1.5) * v * v * Math.exp(-M * v * v / (2 * R * T));
  const frac = (vth, T, M) => { // Anteil schneller als vth, numerisch
    let sum = 0; const dv = 2; for (let v = vth; v < vth + 8000; v += dv) sum += f(v + dv / 2, T, M) * dv; return sum;
  };
  const box = h("div", { class: "chartwrap" }), readout = h("div", { class: "readout" });
  const exp = h("div", { class: "explain", "aria-live": "polite" }, "Klick auf v̂, v̄ oder die Schwelle, um ihre Bedeutung zu sehen.");
  const TEXT = { vhat: "<b>v̂ (Maximum):</b> die wahrscheinlichste Geschwindigkeit, die die meisten Teilchen haben. v̂ = √(2RT/M).",
    vbar: "<b>v̄:</b> Durchschnitt aller Teilchen. Immer etwas größer als v̂, weil der lange Ausläufer nach rechts den Mittelwert nach oben zieht (v̄ ≈ 1,128 · v̂).",
    thr: "<b>Schwelle (schematisch):</b> Teilchen rechts davon sind schnell genug, um beim Stoß die Aktivierungsenergie aufzubringen. Die Fläche rechts davon ist ihr Anteil. Bei höherem T wächst diese Fläche überproportional.",
    kat: "<b>Schwelle mit Katalysator:</b> Die Kurve bleibt gleich (gleiche Temperatur), die Schwelle rückt nach links. Ein größerer Anteil der Teilchen reagiert." };
  const say = k => exp.innerHTML = TEXT[k];
  const draw = () => {
    const M = GASES[st.gas];
    const raw = Math.sqrt(2 * R * Math.max(st.T1, st.two ? st.T2 : 0) / M) * 3.2;
    const stepX = [100, 200, 250, 500, 1000, 2000].find(x => raw / x <= 8) || 2000;
    const vmax = Math.ceil(raw / stepX) * stepX;
    const top = f(Math.sqrt(2 * R * Math.min(st.T1, st.two ? st.T2 : 1e9) / M), Math.min(st.T1, st.two ? st.T2 : 1e9), M) * 1.15;
    const C = makeChart({ w: 640, h: 320, x: [0, vmax], y: [0, top * 1000], xl: "v in m/s", yl: "p(v) in 10⁻³ s/m", xt: Math.round(vmax / stepX), yt: 4, xfmt: v => fmt(v, 0), yfmt: v => fmt(v, 2), title: "Maxwell-Boltzmann-Verteilung" });
    const { svg, X, Y } = C; const blue = css("--c-blue"), red = css("--c-red"), green = css("--c-green"), orange = css("--c-orange");
    const curve = (T, col, fillCol) => {
      const pts = []; for (let v = 0; v <= vmax; v += vmax / 300) pts.push([X(v), Y(f(v, T, M) * 1000)]);
      const th = st.cat ? st.vthK : st.vth;
      const area = [[X(th), Y(0)]]; for (let v = th; v <= vmax; v += vmax / 300) area.push([X(v), Y(f(v, T, M) * 1000)]); area.push([X(vmax), Y(0)]);
      svg.append(s("polygon", { points: area.map(p => p.join(",")).join(" "), fill: fillCol, opacity: 0.18 }));
      svg.append(polyline(pts, { stroke: col, "stroke-width": 2.5 }));
    };
    curve(st.T1, blue, blue); if (st.two) curve(st.T2, red, red);
    const thr = (v, col, key, txt) => { const l = s("g", { class: "hit", tabindex: 0, role: "button" }, s("line", { x1: X(v), x2: X(v), y1: Y(0), y2: Y(top * 1000 * 0.95), stroke: col, "stroke-width": 2, "stroke-dasharray": "5 4" }), s("text", { x: X(v) + 4, y: Y(top * 1000 * 0.9), style: `fill:${col};font-weight:600;font-size:12.5px` }, txt));
      l.addEventListener("click", () => say(key)); l.addEventListener("keydown", e => { if (e.key === "Enter") say(key); }); svg.append(l); };
    if (st.cat) { thr(st.vth, css("--muted"), "thr", "Schwelle ohne Kat."); thr(st.vthK, green, "kat", "Schwelle mit Kat."); }
    else thr(st.vth, orange, "thr", "Schwelle (Eₐ)");
    const mark = (T, col) => {
      const vh = Math.sqrt(2 * R * T / M), vb = Math.sqrt(8 * R * T / (Math.PI * M));
      const a = s("g", { class: "hit", tabindex: 0, role: "button" }, s("line", { x1: X(vh), x2: X(vh), y1: Y(0), y2: Y(f(vh, T, M) * 1000), stroke: col, "stroke-width": 1 }), s("text", { x: X(vh), y: Y(f(vh, T, M) * 1000) - 6, "text-anchor": "middle", style: `fill:${col};font-weight:600` }, "v̂"));
      a.addEventListener("click", () => say("vhat")); a.addEventListener("keydown", e => { if (e.key === "Enter") say("vhat"); });
      const b = s("g", { class: "hit", tabindex: 0, role: "button" }, s("circle", { cx: X(vb), cy: Y(f(vb, T, M) * 1000), r: 4, fill: col }), s("text", { x: X(vb) + 6, y: Y(f(vb, T, M) * 1000) - 4, style: `fill:${col};font-weight:600` }, "v̄"));
      b.addEventListener("click", () => say("vbar")); b.addEventListener("keydown", e => { if (e.key === "Enter") say("vbar"); });
      svg.append(a, b);
    };
    mark(st.T1, blue); if (st.two) mark(st.T2, red);
    box.innerHTML = ""; box.append(svg);
    readout.innerHTML = "";
    const tile = (l, v, col) => h("div", { class: "tile", style: col ? `border-left:4px solid ${col}` : "" }, h("div", { class: "l" }, l), h("div", { class: "v" }, v));
    const th = st.cat ? st.vthK : st.vth;
    const fr1 = frac(th, st.T1, M);
    readout.append(tile("T₁ = " + st.T1 + " K: v̂ / v̄", fmt(Math.sqrt(2 * R * st.T1 / M), 0) + " / " + fmt(Math.sqrt(8 * R * st.T1 / (Math.PI * M)), 0) + " m/s", blue),
      tile("Anteil über der Schwelle bei T₁", fmt(fr1 * 100, 1) + " %", blue));
    if (st.two) { const fr2 = frac(th, st.T2, M);
      readout.append(tile("T₂ = " + st.T2 + " K: v̂ / v̄", fmt(Math.sqrt(2 * R * st.T2 / M), 0) + " / " + fmt(Math.sqrt(8 * R * st.T2 / (Math.PI * M)), 0) + " m/s", red),
        tile("Anteil über der Schwelle bei T₂", fmt(fr2 * 100, 1) + " % (× " + fmt(fr2 / Math.max(fr1, 1e-12), 1) + ")", red)); }
  };
  const gid = nid("gas"); const sel = h("select", { id: gid }, ...Object.keys(GASES).map(g => h("option", { value: g }, g + " (" + fmt(GASES[g] * 1000, 1) + " g/mol)")));
  sel.value = st.gas; sel.addEventListener("change", () => { st.gas = sel.value; draw(); });
  const tw = nid("two"); const cb = h("input", { type: "checkbox", id: tw }); cb.checked = st.two; cb.addEventListener("change", () => { st.two = cb.checked; draw(); });
  const kid = nid("kat"); const cbk = h("input", { type: "checkbox", id: kid }); cbk.checked = st.cat; cbk.addEventListener("change", () => { st.cat = cbk.checked; draw(); });
  const ctr = h("div", { class: "controls" },
    h("div", { class: "ctl" }, h("label", { for: gid }, "Gas"), sel),
    slider(nid("T1"), "Temperatur T₁", 100, 1200, 1, st.T1, "K", v => { st.T1 = v; draw(); }),
    h("div", { class: "ctl" }, h("label", { for: tw }, h("span", {}, "Zweite Kurve T₂ zeigen"), cb), slider(nid("T2"), "Temperatur T₂", 100, 1200, 1, st.T2, "K", v => { st.T2 = v; draw(); })),
    slider(nid("vth"), "Schwelle (ohne Kat.)", 200, 3000, 10, st.vth, "m/s", v => { st.vth = v; draw(); }),
    h("div", { class: "ctl" }, h("label", { for: kid }, h("span", {}, "Katalysator (Schwelle versetzt)"), cbk), slider(nid("vthk"), "Schwelle mit Kat.", 100, 3000, 10, st.vthK, "m/s", v => { st.vthK = v; draw(); })));
  draw();
  return lab("s", "Interaktiver Graph", opt.title || "Maxwell-Boltzmann-Verteilung", "sim",
    h("p", { class: "note" }, "Die Kurven werden exakt aus der Verteilungsfunktion berechnet; die Fläche unter jeder Kurve ist 1 (100 % der Teilchen). Die Schwelle ist schematisch: Echte Aktivierungsenergien liegen viel weiter rechts, der Anteil wäre dann unsichtbar klein (siehe 4.5)."),
    box, exp, ctr, readout);
}

/* ---------- Temperatureffekt (4.5 + 4.6) ---------- */
function tempWidget() {
  const st = { ea: 50, T: 298 };
  const readout = h("div", { class: "readout" }), msg = h("p", { class: "note" });
  const draw = () => {
    const f1 = Math.exp(-st.ea * 1000 / (R * st.T)), f2 = Math.exp(-st.ea * 1000 / (R * (st.T + 10)));
    const stoss = Math.sqrt((st.T + 10) / st.T);
    readout.innerHTML = "";
    const tile = (l, v) => h("div", { class: "tile" }, h("div", { class: "l" }, l), h("div", { class: "v" }, v));
    readout.append(tile("Anteil mit E ≥ Eₐ bei " + st.T + " K", sci(f1, 2)), tile("… bei " + (st.T + 10) + " K", sci(f2, 2)),
      tile("Anteil wächst um Faktor", fmt(f2 / f1, 2)), tile("Stoßhäufigkeit wächst um (~√T)", "+" + fmt((stoss - 1) * 100, 1) + " %"));
    msg.textContent = "Für +10 K wächst der Anteil energiereicher Teilchen um den Faktor " + fmt(f2 / f1, 2) + ", die Stoßhäufigkeit nur um " + fmt((stoss - 1) * 100, 1) + " %. Das ist der Grund für die RGT-Regel (Faktor 2–4). Verdopplung bei 298 → 308 K ergibt sich für Eₐ ≈ 53 kJ/mol.";
  };
  draw();
  return lab("s", "Rechenlabor", "Wie stark wirkt die Temperatur? (Vertiefung 4.5)", "sim",
    h("p", { class: "note" }, "Näherung aus Band 1: Anteil ≈ exp(−Eₐ/(R·T)). Mit Eₐ = 50 kJ/mol und 298 K erhältst du die Werte der Tabelle in 4.5."),
    h("div", { class: "controls" }, slider(nid("ea"), "Eₐ", 10, 150, 1, st.ea, "kJ/mol", v => { st.ea = v; draw(); }), slider(nid("T"), "Temperatur", 250, 500, 1, st.T, "K", v => { st.T = v; draw(); })),
    readout, msg);
}

/* ---------- Streichholzspiel ---------- */
function matchWidget() {
  const st = { a: 50, b: 0, ka: 0.5, kb: 0.1, rows: [] };
  const tbody = h("tbody"), box = h("div", { class: "chartwrap" }), msg = h("div", { class: "explain", "aria-live": "polite" });
  const reset = (a, b) => { st.a = a; st.b = b; st.rows = [[0, a, Math.round(a * st.ka), b, Math.round(b * st.kb)]]; draw(); };
  const step = () => {
    const ga = Math.round(st.a * st.ka), gb = Math.round(st.b * st.kb);
    st.a = st.a - ga + gb; st.b = st.b + ga - gb;
    st.rows.push([st.rows.length, st.a, Math.round(st.a * st.ka), st.b, Math.round(st.b * st.kb)]); draw();
  };
  const draw = () => {
    tbody.innerHTML = "";
    for (const r of st.rows) tbody.append(h("tr", {}, ...r.map(x => h("td", {}, String(x)))));
    const n = Math.max(8, st.rows.length - 1);
    const C = makeChart({ w: 640, h: 230, x: [0, n], y: [0, 50], xl: "Spielzug", yl: "Streichhölzer", xt: Math.min(n, 10), yt: 5, xfmt: v => fmt(v, 0), yfmt: v => fmt(v, 0), title: "Bestände" });
    C.svg.append(polyline(st.rows.map(r => [C.X(r[0]), C.Y(r[1])]), { stroke: css("--c-blue"), "stroke-width": 2.5 }));
    C.svg.append(polyline(st.rows.map(r => [C.X(r[0]), C.Y(r[3])]), { stroke: css("--c-orange"), "stroke-width": 2.5 }));
    C.svg.append(s("text", { x: C.X(0.2), y: C.Y(48), style: `fill:${css("--c-blue")};font-weight:600` }, "A (≙ c(Edukt))"), s("text", { x: C.X(0.2), y: C.Y(42), style: `fill:${css("--c-orange")};font-weight:600` }, "B (≙ c(Produkt))"));
    box.innerHTML = ""; box.append(C.svg);
    const last = st.rows[st.rows.length - 1];
    const eq = last[2] === last[4];
    msg.innerHTML = eq ? `<b>Gleichgewicht:</b> A gibt ${last[2]}, B gibt ${last[4]} ab: v(hin) = v(rück). Bestände bleiben konstant (A = ${last[1]}, B = ${last[3]}), obwohl weiter getauscht wird. B/A = ${fmt(last[3] / Math.max(1, last[1]), 2)}, k(hin)/k(rück) = ${fmt(st.ka / st.kb, 2)} (Unterschied durch Rundung).`
      : `v(hin) = ${last[2]} Hölzer pro Zug, v(rück) = ${last[4]}. Noch kein Gleichgewicht: Spiele weitere Züge.`;
  };
  const selA = h("select", { id: nid("ka") }, h("option", { value: 0.5 }, "½"), h("option", { value: 1 / 3 }, "⅓"), h("option", { value: 0.25 }, "¼"));
  const selB = h("select", { id: nid("kb") }, h("option", { value: 0.1 }, "1/10"), h("option", { value: 0.2 }, "1/5"), h("option", { value: 0.25 }, "¼"));
  selA.addEventListener("change", () => { st.ka = +selA.value; reset(50, 0); });
  selB.addEventListener("change", () => { st.kb = +selB.value; reset(50, 0); });
  reset(50, 0);
  return lab("s", "Modellexperiment", "Streichholzspiel nachspielen (6.3)", "sim",
    h("p", { class: "note" }, "Regeln wie im Unterricht: In jedem Zug gibt A seinen Anteil an B, gleichzeitig B seinen Anteil an A (gerundet). Mit ½ und 1/10 entsteht genau deine Messtabelle."),
    h("div", { class: "controls" }, h("div", { class: "ctl" }, h("label", { for: selA.id }, "Abgabeanteil A (≙ k(hin))"), selA), h("div", { class: "ctl" }, h("label", { for: selB.id }, "Abgabeanteil B (≙ k(rück))"), selB)),
    h("div", { class: "btnrow" }, h("button", { class: "btn primary", type: "button", onclick: step }, "Nächster Zug"), h("button", { class: "btn", type: "button", onclick: () => reset(50, 0) }, "Neu: A = 50, B = 0"), h("button", { class: "btn", type: "button", onclick: () => reset(0, 50) }, "Neu: A = 0, B = 50 (von der anderen Seite)")),
    box, msg,
    h("div", { class: "tablewrap prose" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Zug"), h("th", {}, "A besitzt"), h("th", {}, "A gibt ab"), h("th", {}, "B besitzt"), h("th", {}, "B gibt ab"))), tbody)));
}

/* ---------- Gleichgewichtseinstellung A ⇌ B ---------- */
function eqWidget() {
  const st = { kh: 0.5, kr: 0.1, a0: 1, b0: 0 };
  const box1 = h("div", { class: "chartwrap" }), box2 = h("div", { class: "chartwrap" }), readout = h("div", { class: "readout" });
  const draw = () => {
    const tot = st.a0 + st.b0, ks = st.kh + st.kr, aeq = st.kr * tot / ks, beq = st.kh * tot / ks;
    const a = t => aeq + (st.a0 - aeq) * Math.exp(-ks * t), b = t => tot - a(t);
    const tEnd = Math.max(5, 6 / ks), teq = Math.log(100) / ks; // 99 % der Einstellung
    const C = makeChart({ w: 640, h: 240, x: [0, tEnd], y: [0, Math.max(1, tot) * 1.05], xl: "t in s", yl: "c in mol/l", xt: 6, yt: 4, xfmt: v => fmt(v, 0), yfmt: v => fmt(v, 2), title: "c-t-Diagramm" });
    const pa = [], pb = []; for (let t = 0; t <= tEnd; t += tEnd / 300) { pa.push([C.X(t), C.Y(a(t))]); pb.push([C.X(t), C.Y(b(t))]); }
    C.svg.append(s("line", { x1: C.X(teq), x2: C.X(teq), y1: C.Y(0), y2: C.pt, stroke: css("--line"), "stroke-dasharray": "4 4" }));
    C.svg.append(polyline(pa, { stroke: css("--c-blue"), "stroke-width": 2.5 }), polyline(pb, { stroke: css("--c-orange"), "stroke-width": 2.5 }));
    C.svg.append(s("text", { x: C.X(tEnd) - 4, y: C.Y(a(tEnd)) - 6, "text-anchor": "end", style: `fill:${css("--c-blue")};font-weight:600` }, "c(A)"), s("text", { x: C.X(tEnd) - 4, y: C.Y(b(tEnd)) - 6, "text-anchor": "end", style: `fill:${css("--c-orange")};font-weight:600` }, "c(B)"));
    box1.innerHTML = ""; box1.append(C.svg);
    const vmax = Math.max(st.kh * st.a0, st.kr * st.b0, st.kh * aeq) * 1.1 || 1;
    const D = makeChart({ w: 640, h: 220, x: [0, tEnd], y: [0, vmax], xl: "t in s", yl: "v in mol/(l·s)", xt: 6, yt: 4, xfmt: v => fmt(v, 0), yfmt: v => fmt(v, 2), title: "v-t-Diagramm" });
    const vh = [], vr = []; for (let t = 0; t <= tEnd; t += tEnd / 300) { vh.push([D.X(t), D.Y(st.kh * a(t))]); vr.push([D.X(t), D.Y(st.kr * b(t))]); }
    D.svg.append(s("line", { x1: D.X(teq), x2: D.X(teq), y1: D.Y(0), y2: D.pt, stroke: css("--line"), "stroke-dasharray": "4 4" }));
    D.svg.append(polyline(vh, { stroke: css("--c-blue"), "stroke-width": 2.5 }), polyline(vr, { stroke: css("--c-orange"), "stroke-width": 2.5 }));
    D.svg.append(s("text", { x: D.X(tEnd) - 4, y: D.Y(st.kh * aeq) - 8, "text-anchor": "end", style: "fill:" + css("--muted") }, "v(hin) = v(rück) ≠ 0"));
    D.svg.append(s("text", { x: D.X(tEnd * 0.02), y: D.Y(st.kh * st.a0) + 14, style: `fill:${css("--c-blue")};font-weight:600` }, "v(hin)"), s("text", { x: D.X(tEnd * 0.02), y: D.Y(st.kr * st.b0) - 6, style: `fill:${css("--c-orange")};font-weight:600` }, "v(rück)"));
    box2.innerHTML = ""; box2.append(D.svg);
    readout.innerHTML = "";
    const tile = (l, v) => h("div", { class: "tile" }, h("div", { class: "l" }, l), h("div", { class: "v" }, v));
    readout.append(tile("c(A) im GG", fmt(aeq, 3) + " mol/l"), tile("c(B) im GG", fmt(beq, 3) + " mol/l"), tile("c(B)/c(A) im GG", fmt(beq / aeq, 2)), tile("k(hin)/k(rück) = K", fmt(st.kh / st.kr, 2)));
  };
  draw();
  return lab("s", "Simulation", "Gleichgewichtseinstellung A ⇌ B", "sim",
    h("p", { class: "note" }, "Exakte Lösung für A ⇌ B mit v(hin) = k(hin)·c(A) und v(rück) = k(rück)·c(B). Die gestrichelte Linie markiert, wann 99 % der Einstellung erreicht sind: Ab dort laufen beide c-Kurven waagerecht auf verschiedenen Höhen, beide v-Kurven gemeinsam über null."),
    h("div", { class: "controls" }, slider(nid("kh"), "k(hin)", 0.01, 1, 0.01, st.kh, "1/s", v => { st.kh = v; draw(); }), slider(nid("kr"), "k(rück)", 0.01, 1, 0.01, st.kr, "1/s", v => { st.kr = v; draw(); }),
      slider(nid("a0"), "Start c(A)", 0, 2, 0.05, st.a0, "mol/l", v => { st.a0 = v; if (st.a0 + st.b0 === 0) st.a0 = 0.05; draw(); }), slider(nid("b0"), "Start c(B)", 0, 2, 0.05, st.b0, "mol/l", v => { st.b0 = v; draw(); })),
    box1, box2, readout,
    h("p", { class: "note" }, "Probier: Start nur mit B (c(A) = 0, c(B) = 1). Das Gleichgewicht ist dasselbe: von beiden Seiten erreichbar."));
}

/* ---------- MWG-Rechner und Le-Chatelier-Labor ---------- */
const REACTIONS = {
  hi: { name: "H₂ + I₂ ⇌ 2 HI", sp: [["H₂", -1, 1], ["I₂", -1, 1], ["HI", 2, 1]], K: 54.5, dH: -9.5, start: [0.5, 0.5, 0], src: "Band 1, 7.5 Typ 3", dHnote: "ΔH ≈ −9,5 kJ/mol (Modellwert, gasförmiges I₂)" },
  nh3: { name: "N₂ + 3 H₂ ⇌ 2 NH₃", sp: [["N₂", -1, 1], ["H₂", -3, 1], ["NH₃", 2, 1]], K: 4, dH: -92, start: [0.24, 0.32, 0], src: "Band 4, Aufgabe 4", dHnote: "ΔH = −92 kJ/mol" },
  no2: { name: "2 NO₂ ⇌ N₂O₄", sp: [["NO₂", -2, 1], ["N₂O₄", 1, 1]], K: 8, dH: -57, start: [0.26, 0], src: "Band 1, 7.5 Typ 1", dHnote: "ΔH = −57 kJ/mol" },
  pcl5: { name: "PCl₅ ⇌ PCl₃ + Cl₂", sp: [["PCl₅", -1, 1], ["PCl₃", 1, 1], ["Cl₂", 1, 1]], K: 0.04, dH: 88, start: [1.0, 0, 0], src: "Band 1, 7.5 Typ 4", dHnote: "ΔH ≈ +88 kJ/mol" },
  ester: { name: "Säure + Alkohol ⇌ Ester + Wasser", sp: [["Essigsäure", -1, 0], ["Ethanol", -1, 0], ["Ester", 1, 0], ["Wasser", 1, 0]], K: 4, dH: 0, start: [1, 1, 0, 0], src: "Band 1, 7.5 Typ 5", dHnote: "ΔH nahe null: Temperatur verändert K kaum (im Modell nicht)" },
};
function Qof(R0, c) { let q = 1; R0.sp.forEach(([, nu], i) => { q *= Math.pow(Math.max(c[i], 1e-300), nu); }); return q; }
function solveEq(R0, c0, K) {
  // Umsatz x: c_i = c0_i + nu_i * x; ln Q(x) − ln K = 0, Q monoton steigend in x
  let lo = -Infinity, hi = Infinity;
  R0.sp.forEach(([, nu], i) => { const lim = -c0[i] / nu; if (nu < 0) hi = Math.min(hi, lim); else lo = Math.max(lo, lim); });
  const g = x => R0.sp.reduce((a, [, nu], i) => a + nu * Math.log(Math.max(c0[i] + nu * x, 1e-300)), 0) - Math.log(K);
  let a = lo + 1e-14 * (1 + Math.abs(lo)), b = hi - 1e-14 * (1 + Math.abs(hi));
  for (let i = 0; i < 200; i++) { const m = (a + b) / 2; if (g(m) > 0) b = m; else a = m; }
  const x = (a + b) / 2;
  return { x, c: c0.map((v, i) => Math.max(0, v + R0.sp[i][1] * x)) };
}
function mwgWidget(opt: any = {}) {
  const st = { key: opt.key || "hi", T: 700, hist: [], c: null, K: null };
  const root = h("div", { class: "lab-body" });
  const tableBox = h("div", { class: "tablewrap prose" }), mwg = h("p", { class: "formula prose" }), info = h("div", { class: "explain", "aria-live": "polite" });
  const startCtrls = h("div", { class: "controls" }), histBox = h("div", { class: "chartwrap" }), actions = h("div", { class: "btnrow" });
  const Rx = () => REACTIONS[st.key];
  const unitK = () => { const dn = Rx().sp.filter(x => x[2]).reduce((a, [, nu]) => a + nu, 0) + (Rx().sp.every(x => !x[2]) ? Rx().sp.reduce((a, [, nu]) => a + nu, 0) : 0);
    return dn === 0 ? "keine Einheit (Δν = 0)" : "(mol/l) hoch " + (dn > 0 ? dn : "(" + dn + ")") + " = " + (dn > 0 ? (dn === 1 ? "mol/l" : "mol" + "²³⁴"[dn - 2] + "/l" + "²³⁴"[dn - 2]) : (dn === -1 ? "l/mol" : "l" + "²³⁴"[-dn - 2] + "/mol" + "²³⁴"[-dn - 2])) + " (Δν = " + dn + ")"; };
  const sup = n => n === 1 ? "" : String(n).replace(/\d/g, c => "⁰¹²³⁴⁵⁶⁷⁸⁹"[c]);
  const mwgText = () => { const r = Rx(); const num = r.sp.filter(x => x[1] > 0).map(([n, nu]) => "c" + sup(nu) + "(" + n + ")").join(" · "); const den = r.sp.filter(x => x[1] < 0).map(([n, nu]) => "c" + sup(-nu) + "(" + n + ")").join(" · "); return "Kc = " + num + " / (" + den + ")"; };
  let c0 = [];
  const buildStart = () => {
    startCtrls.innerHTML = ""; c0 = Rx().start.slice();
    Rx().sp.forEach(([n], i) => startCtrls.append(slider(nid("c0"), "Start c(" + n + ")", 0, 3, 0.01, c0[i], "mol/l", v => { c0[i] = v; }, v => fmt(v, 2))));
  };
  const renderTable = (before, after, x) => {
    const r = Rx();
    tableBox.innerHTML = "";
    tableBox.append(h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Stoff"), h("th", {}, "Vorher (mol/l)"), h("th", {}, "Änderung"), h("th", {}, "GG (mol/l)"))),
      h("tbody", {}, ...r.sp.map(([n, nu], i) => h("tr", {}, h("td", {}, n), h("td", {}, fmt(before[i], 3)), h("td", {}, (nu > 0 ? "+" : "−") + (Math.abs(nu) === 1 ? "" : Math.abs(nu)) + "x = " + (nu * x >= 0 ? "+" : "−") + fmt(Math.abs(nu * x), 3)), h("td", {}, h("strong", {}, fmt(after[i], 3))))))));
  };
  const drawHist = () => {
    const r = Rx(); if (!st.hist.length) { histBox.innerHTML = ""; return; }
    const n = st.hist.length; const ymax = Math.max(...st.hist.flatMap(e => e.c)) * 1.15 || 1;
    const C = makeChart({ w: 640, h: 240, x: [0, Math.max(2, n)], y: [0, ymax], xl: "Ereignisse (schematische Zeitachse)", yl: "c in mol/l", xt: Math.max(2, n), yt: 4, xfmt: v => "", yfmt: v => fmt(v, 2), title: "c-t-Verlauf bei Störungen" });
    const cols = [css("--c-blue"), css("--c-orange"), css("--c-purple"), css("--c-green")];
    r.sp.forEach((sp, i) => {
      const pts = []; st.hist.forEach((e, j) => { pts.push([C.X(j), C.Y(e.c[i])]); pts.push([C.X(j + 1), C.Y(e.c[i])]); });
      C.svg.append(polyline(pts, { stroke: cols[i], "stroke-width": 2.4 }));
      C.svg.append(s("text", { x: C.X(n) - 4 - i * 34, y: C.Y(st.hist[n - 1].c[i]) - 5, "text-anchor": "end", style: `fill:${cols[i]};font-weight:600` }, sp[0]));
    });
    st.hist.forEach((e, j) => C.svg.append(s("text", { x: C.X(j + 0.5), y: C.h - C.pb + 16, "text-anchor": "middle" }, e.label)));
    histBox.innerHTML = ""; histBox.append(C.svg);
  };
  const equil = (label, before) => {
    const res = solveEq(Rx(), before, st.K);
    st.c = res.c; renderTable(before, res.c, res.x);
    st.hist.push({ c: res.c.slice(), label });
    const q = Qof(Rx(), res.c);
    const xs = res.x < -1e-12 ? ` Umsatz x = ${fmt(res.x, 3)} mol/l (negativ: Die Reaktion lief netto nach links).` : ` Umsatz x = ${fmt(res.x, 3)} mol/l.`;
    info.innerHTML = `<b>Probe:</b>${xs} Einsetzen der GG-Konzentrationen ergibt Q = ${sci(q, 3)} = K. Einheit von Kc: ${unitK()}.`;
    drawHist(); updActions();
  };
  const disturb = (label, fn) => {
    const before = st.c.slice(); const K0 = st.K; fn(before);
    const q = Qof(Rx(), before);
    const dir = Math.abs(Math.log(q / st.K)) < 1e-9 ? "Q = K: keine Verschiebung." : q < st.K ? "Q < K: Die Reaktion läuft netto nach rechts (Hinreaktion überwiegt), bis Q = K." : "Q > K: Die Reaktion läuft netto nach links (Rückreaktion überwiegt), bis Q = K.";
    st.hist.push({ c: before.slice(), label: label });
    const kmsg = K0 !== st.K ? ` K ändert sich von ${sci(K0, 3)} auf ${sci(st.K, 3)}.` : " K bleibt gleich.";
    info.innerHTML = `<b>Nach der Störung:</b> Q = ${sci(q, 3)}, K = ${sci(st.K, 3)}. ${dir}${kmsg}`;
    pending = before; drawHist(); updActions();
  };
  let pending = null;
  const eqBtn = h("button", { class: "btn primary", type: "button", onclick: () => { if (pending) { const p = pending; pending = null; equil("neues GG", p); } } }, "Neues Gleichgewicht einstellen");
  const bAdd = h("button", { class: "btn", type: "button", onclick: () => disturb("+Edukt", c => { const i = Rx().sp.findIndex(x => x[1] < 0); c[i] += 0.5 * Math.max(0.2, Rx().start[i]); }) }, "Edukt zugeben");
  const bRem = h("button", { class: "btn", type: "button", onclick: () => disturb("−Produkt", c => { const i = Rx().sp.findIndex(x => x[1] > 0); c[i] *= 0.5; }) }, "Produkt zur Hälfte entfernen");
  const bP = h("button", { class: "btn", type: "button", onclick: () => disturb("Druck ×2", c => { Rx().sp.forEach((sp, i) => { if (sp[2]) c[i] *= 2; }); }) }, "Volumen halbieren (Druck ×2)");
  const bT = h("button", { class: "btn", type: "button", onclick: () => disturb("T +50 K", c => { const T2 = st.T + 50; st.K = st.K * Math.exp(-Rx().dH * 1000 / R * (1 / T2 - 1 / st.T)); st.T = T2; }) }, "Temperatur +50 K");
  const bT2 = h("button", { class: "btn", type: "button", onclick: () => disturb("T −50 K", c => { const T2 = st.T - 50; st.K = st.K * Math.exp(-Rx().dH * 1000 / R * (1 / T2 - 1 / st.T)); st.T = T2; }) }, "Temperatur −50 K");
  const bKat = h("button", { class: "btn", type: "button", onclick: () => { if (!st.c) return; info.innerHTML = "<b>Katalysator:</b> k(hin) und k(rück) steigen um denselben Faktor, K = k(hin)/k(rück) bleibt gleich. Die Lage ändert sich nicht, ein Gleichgewicht würde sich nur schneller einstellen."; } }, "Katalysator zugeben");
  const updActions = () => {
    const ready = !!st.c && !pending;
    [bAdd, bRem, bT, bT2, bKat].forEach(b => b.disabled = !ready);
    bP.disabled = !ready || !Rx().sp.some(x => x[2]);
    bT.disabled = bT2.disabled = !ready || Rx().dH === 0;
    eqBtn.disabled = !pending;
  };
  actions.append(eqBtn, bAdd, bRem, bP, bT, bT2, bKat);
  const sel = h("select", { id: nid("rx") }, ...Object.entries(REACTIONS).map(([k, r]) => h("option", { value: k }, r.name)));
  sel.value = st.key;
  const head = h("p", { class: "note" });
  const reset = () => { st.key = sel.value; st.K = Rx().K; st.T = 700; st.hist = []; st.c = null; pending = null; buildStart(); mwg.textContent = mwgText() + "  ·  K = " + sci(st.K, 3); head.textContent = "Quelle des K-Werts: " + Rx().src + ". " + Rx().dHnote + ". Temperatureffekt im Modell über K = k(hin)/k(rück) mit k ∝ exp(−Eₐ/(R·T)) [Vertiefung]."; tableBox.innerHTML = ""; histBox.innerHTML = ""; info.textContent = "Wähle Startkonzentrationen und berechne das Gleichgewicht."; updActions(); };
  sel.addEventListener("change", reset);
  const go = h("button", { class: "btn primary", type: "button", onclick: () => { st.hist = []; pending = null; st.K = Rx().K; st.T = 700; mwg.textContent = mwgText() + "  ·  K = " + sci(st.K, 3); st.hist.push({ c: c0.slice(), label: "Start" }); equil("GG", c0.slice()); } }, "Gleichgewicht berechnen");
  reset();
  return lab("s", "Rechen- und Simulationslabor", opt.title || "Gleichgewichtstabelle und Le Chatelier", "sim",
    h("div", { class: "controls" }, h("div", { class: "ctl" }, h("label", { for: sel.id }, "Reaktion"), sel)), head, mwg, startCtrls,
    h("div", { class: "btnrow" }, go), tableBox, info,
    h("p", { class: "note" }, "Störungen (erst nach berechnetem Gleichgewicht):"), actions, histBox,
    h("p", { class: "note" }, "Der Rechner löst Kc = Q(x) exakt (Intervallhalbierung über den Umsatz x) und zeigt die Probe. Die Zeitachse der Störungsgrafik ist schematisch: Sie zeigt den Sprung bei der Störung und die neuen Plateaus."));
}

/* ---------- Schritt-für-Schritt-Aufgaben ---------- */
const STEPS = {
  mg: { title: "Wie viel ml H₂ entstehen aus 0,12 g Magnesium?", src: "Band 4, Übung 1.4 Nr. 3",
    steps: [["Gegeben", "m(Mg) = 0,12 g; M(Mg) = 24,31 g/mol; Vₘ = 22,4 ml/mmol"], ["Gesucht", "V(H₂) in ml"],
      ["Gleichung und Formeln", "Mg + 2 H₃O⁺ → Mg²⁺ + H₂ + 2 H₂O; n = m/M; V = n · Vₘ"], ["Einheiten", "g und g/mol ergeben mol; 1 mol = 1000 mmol; Vₘ in ml/mmol passt zu mmol"],
      ["Einsetzen", "n(Mg) = 0,12 g / 24,31 g/mol"], ["Rechnen", "n(Mg) = 4,94 mmol → n(H₂) = 4,94 mmol (1 : 1) → V = 4,94 mmol · 22,4 ml/mmol ≈ 111 ml"],
      ["Deuten", "Aus 0,12 g Mg entstehen etwa 111 ml Wasserstoff, fast genau das Endvolumen aus Aufgabe 1 (dort 5 mmol Mg ≈ 0,12 g)."], ["Prüfen", "Einheit ml ✓; Größenordnung: 5 mmol Gas ≈ 112 ml ✓"]] },
  vhat: { title: "Berechne v̂ und v̄ für O₂ bei 100 °C.", src: "Band 4, Übung zu Kapitel 4",
    steps: [["Gegeben", "ϑ = 100 °C; M(O₂) = 32 g/mol; R = 8,314 J/(mol·K)"], ["Gesucht", "v̂ und v̄ in m/s"],
      ["Formeln", "v̂ = √(2RT/M); v̄ = √(8RT/(πM))"], ["Einheiten umrechnen", "T = 100 + 273,15 = 373 K; M = 0,032 kg/mol (1 J = 1 kg·m²/s²)"],
      ["Einsetzen", "v̂ = √(2 · 8,314 · 373 / 0,032); v̄ = √(8 · 8,314 · 373 / (π · 0,032))"], ["Rechnen", "v̂ ≈ √193 800 ≈ 440 m/s; v̄ ≈ √246 800 ≈ 497 m/s"],
      ["Deuten", "Bei 100 °C sind O₂-Moleküle im Mittel fast 500 m/s schnell; v̄ liegt wegen des Ausläufers über v̂."], ["Prüfen", "v̄/v̂ = 497/440 ≈ 1,13 ✓; höher als bei 25 °C (394 m/s) ✓"]] },
  pcl5: { title: "PCl₅ ⇌ PCl₃ + Cl₂, Kc = 0,04 mol/l, Start 1,0 mol/l PCl₅. Berechne die GG-Konzentrationen.", src: "Band 1, 7.5 Typ 4",
    steps: [["Gegeben", "Kc = 0,04 mol/l; c₀(PCl₅) = 1,0 mol/l; c₀(PCl₃) = c₀(Cl₂) = 0"], ["Gesucht", "c(PCl₅), c(PCl₃), c(Cl₂) im GG"],
      ["MWG und Tabelle", "Kc = c(PCl₃) · c(Cl₂) / c(PCl₅); GG: PCl₅ 1,0 − x; PCl₃ x; Cl₂ x"], ["Einheiten", "alles in mol/l, V = 1 l"],
      ["Einsetzen", "x² / (1,0 − x) = 0,04 → x² + 0,04x − 0,04 = 0"], ["Rechnen", "x = −0,02 ± √(0,0004 + 0,04) = −0,02 ± 0,201 → x₁ ≈ 0,181; x₂ ≈ −0,221 (negativ, verworfen)"],
      ["Deuten", "c(PCl₃) = c(Cl₂) ≈ 0,18 mol/l, c(PCl₅) ≈ 0,82 mol/l: Das GG liegt auf der Eduktseite (K < 1)."], ["Prüfen", "0,181² / 0,819 ≈ 0,040 ✓"]] },
};
function stepWidget(key) {
  const S = STEPS[key]; let shown = 0;
  const list = h("div", { class: "stepbox" });
  const items = S.steps.map(([l, t], i) => { const e = h("div", { class: "step hidden-step" }, h("div", { class: "sl" }, (i + 1) + ". " + l), h("div", {}, t)); list.append(e); return e; });
  const own = h("textarea", { id: nid("own"), placeholder: "Dein eigener Lösungsweg (wird nur in diesem Browser gespeichert)" });
  const key2 = "step:" + key; own.value = Prog.d.notes[key2] || ""; own.addEventListener("input", () => { Prog.d.notes[key2] = own.value; Prog.save(); });
  const next = h("button", { class: "btn primary", type: "button" }, "Nächsten Schritt zeigen");
  const all = h("button", { class: "btn", type: "button" }, "Alle zeigen");
  const reset = h("button", { class: "btn", type: "button" }, "Verdecken");
  const upd = () => { items.forEach((e, i) => e.classList.toggle("hidden-step", i >= shown)); next.disabled = shown >= items.length; next.textContent = shown >= items.length ? "Alle Schritte gezeigt" : "Schritt " + (shown + 1) + " von " + items.length + " zeigen"; };
  next.addEventListener("click", () => { shown++; upd(); }); all.addEventListener("click", () => { shown = items.length; upd(); }); reset.addEventListener("click", () => { shown = 0; upd(); });
  upd();
  return lab("w", "Schritt für Schritt", S.title, "steps", h("p", { class: "note" }, "Quelle: " + S.src + ". Rechne zuerst selbst, dann deckst du einen Schritt nach dem anderen auf."),
    h("label", { for: own.id, class: "note" }, "Dein Ansatz"), own, list, h("div", { class: "btnrow" }, next, all, reset));
}

/* ---------- Begriffsnetz (Kapitel 9) ---------- */
function mapWidget() {
  const N: [string, number, number, string][] = [["Stöchiometrie", 80, 60, "Teilchenbilanz: Koeffizienten geben Stoffmengenverhältnisse. Grundlage für c, v und die GG-Tabelle."],
    ["Konzentration", 260, 60, "c = n/V. Bestimmt die Stoßhäufigkeit und steht im Geschwindigkeitsgesetz und im MWG."],
    ["Reaktions­geschwindigkeit", 450, 60, "v = Δc/Δt; nimmt ab, weil Edukte verbraucht werden."],
    ["Stoßtheorie", 450, 170, "v ~ Stoßhäufigkeit · Anteil wirksamer Stöße. Erklärt alle Einflussfaktoren."],
    ["Maxwell-Boltzmann", 260, 170, "Verteilung der Teilchengeschwindigkeiten; Temperatur verschiebt den Anteil über Eₐ."],
    ["Energetik (ΔH, Eₐ)", 80, 170, "ΔH: wie viel Energie; Eₐ: wie schnell. Zwei verschiedene Fragen."],
    ["Katalyse", 80, 280, "Senkt Eₐ für Hin- und Rückreaktion gleich stark; ΔH und K bleiben gleich."],
    ["Gleichgewicht", 260, 280, "v(hin) = v(rück); dynamisch; Konzentrationen konstant, nicht gleich."],
    ["MWG", 450, 280, "Kc = k(hin)/k(rück): Kinetik und Gleichgewicht in einer Gleichung."],
    ["Le Chatelier", 450, 390, "Zwang ändert Q; nur T ändert K (über unterschiedliche Eₐ von Hin- und Rückreaktion)."]];
  const E = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [3, 6], [6, 7], [2, 7], [7, 8], [8, 9], [5, 9], [1, 8]];
  const svg = s("svg", { viewBox: "0 0 560 440", class: "chart", role: "img", "aria-label": "Begriffsnetz" });
  const exp = h("div", { class: "explain", "aria-live": "polite" }, "Klick auf einen Begriff.");
  for (const [a, b] of E) svg.append(s("line", { x1: N[a][1], y1: N[a][2], x2: N[b][1], y2: N[b][2], stroke: css("--line"), "stroke-width": 2 }));
  N.forEach(([t, x, y, d]) => {
    const g = s("g", { class: "hit", tabindex: 0, role: "button" }, s("rect", { x: x - 72, y: y - 20, width: 144, height: 40, rx: 10, fill: css("--surface"), stroke: css("--c-blue"), "stroke-width": 1.5 }), s("text", { x, y: y + 4, "text-anchor": "middle", style: `fill:${css("--ink")};font-size:12.5px;font-weight:600` }, t.replace("­", "")));
    const sayIt = () => { exp.innerHTML = "<b>" + t.replace("­", "") + ":</b> " + d; };
    g.addEventListener("click", sayIt); g.addEventListener("keydown", e => { if (e.key === "Enter") sayIt(); });
    svg.append(g);
  });
  return lab("s", "Interaktives Begriffsnetz", "Der rote Faden (9.1)", "sim", h("div", { class: "chartwrap" }, svg), exp);
}

/* ---------- Wissenscheck ---------- */
function shuffle(arr, seed) { const a = arr.slice(); let x = seed || 1; for (let i = a.length - 1; i > 0; i--) { x = (x * 9301 + 49297) % 233280; const j = Math.floor(x / 233280 * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function quizWidget(cid, items, title, mixed?) {
  const box = h("div", { class: "stepbox" }); const score = h("div", { class: "score" });
  let answered = 0, right = 0;
  items.forEach((q, qi) => {
    const order = shuffle(q.opts.map((o, i) => i), qi + 7 + (q.q.length % 13));
    const fb = h("div", { class: "fb", hidden: true });
    const opts = h("div", { class: "opts", role: "group" });
    const btns = order.map(i => {
      const b = h("button", { class: "opt", type: "button" }, q.opts[i]);
      b.addEventListener("click", () => {
        btns.forEach(x => x.disabled = true);
        const ok = i === q.a; answered++; if (ok) right++;
        b.classList.add(ok ? "ok" : "bad"); btns[order.indexOf(q.a)].classList.add("ok");
        fb.hidden = false; fb.className = "fb " + (ok ? "ok" : "bad");
        fb.innerHTML = ""; fb.append(h("b", {}, ok ? "Richtig." : "Nicht ganz."), q.why);
        const wid = (q.cid || cid) + "#" + q.q.slice(0, 40);
        if (!ok) Prog.d.wrong[wid] = { cid: q.cid || cid, q: q.q }; else delete Prog.d.wrong[wid];
        if (answered === items.length && !mixed) {
          const sc = right / items.length; const prev = Prog.d.quiz[cid];
          Prog.d.quiz[cid] = { best: Math.max(sc, prev ? prev.best : 0), last: sc, t: Date.now() };
        }
        Prog.save();
        score.textContent = "Ergebnis: " + right + " von " + answered + " richtig" + (answered === items.length ? (right === items.length ? " · alles richtig" : " · falsch beantwortete Fragen landen unter „Wiederholen“") : "");
      });
      opts.append(b); return b;
    });
    box.append(h("div", { class: "q" }, h("div", { class: "qh" }, h("span", { class: "lvl", title: "Schwierigkeitsstufe 1 (Fakten) bis 5 (Transfer)" }, "Stufe " + q.lvl), h("span", {}, q.q)), opts, fb));
  });
  const prev = Prog.d.quiz[cid];
  const again = h("button", { class: "btn", type: "button", onclick: e => { const n = quizWidget(cid, items, title, mixed); e.target.closest(".lab").replaceWith(n); } }, "Neu starten");
  score.textContent = prev && !mixed ? "Bisher bestes Ergebnis: " + Math.round(prev.best * 100) + " %" : "Beantworte alle Fragen. Die Erklärung erscheint sofort.";
  return lab("q", "Wissenscheck", title || "Teste dein Verständnis", "check", box, h("div", { class: "btnrow" }, score, again));
}
function ruatWidget(cid) {
  const items = A.ruat[cid]; if (!items) return h("div");
  const grid = h("div", { class: "ruat-grid" });
  items.forEach(([k, q, a], i) => {
    const id = cid + ":ruat" + i;
    const ans = h("div", { class: "ans", hidden: true }, a);
    const show = h("button", { class: "btn", type: "button", onclick: () => { ans.hidden = false; show.remove(); rate.hidden = false; } }, "Musterantwort zeigen");
    const rate = rateButtons(id); rate.hidden = true;
    if (Prog.d.rate[id] != null) { ans.hidden = false; show.remove(); rate.hidden = false; }
    grid.append(h("div", { class: "ru" }, h("div", { class: "k" }, k), h("p", {}, q), show, ans, rate));
  });
  return lab("r", "Abruf · Verstehen · Anwenden · Transfer", "Erst antworten, dann aufdecken", "ruat", h("p", { class: "note" }, "Beantworte jede Frage laut oder schriftlich, bevor du die Musterantwort öffnest. Bewerte dich danach ehrlich: Das steuert deine Wiederholung."), grid);
}
function rateButtons(id) {
  const wrap = h("span", { class: "rate", role: "group", "aria-label": "Selbsteinschätzung" });
  const opts = [[2, "sicher", "r2"], [1, "unsicher", "r1"], [0, "nicht gewusst", "r0"]];
  const btns = opts.map(([v, t, c]) => { const b = h("button", { type: "button", class: c, "aria-pressed": Prog.d.rate[id] === v ? "true" : "false" }, t);
    b.addEventListener("click", () => { Prog.d.rate[id] = v; btns.forEach(x => x.setAttribute("aria-pressed", "false")); b.setAttribute("aria-pressed", "true"); Prog.save(); }); return b; });
  wrap.append(...btns); return wrap;
}

/* ---------- Widgets in den Text einsetzen ---------- */
const WIDGETS = {
  formula: o => formulaPanel(o.key), energy: o => energyWidget(o), ct: () => ctWidget(), mb: o => mbWidget(o), temp: () => tempWidget(),
  match: () => matchWidget(), eq: () => eqWidget(), mwg: o => mwgWidget(o), steps: o => stepWidget(o.key), map: () => mapWidget(),
};
function mountWidgets(root) {
  $$(".widget", root).forEach(el => {
    try { const o = JSON.parse(el.dataset.opt || "{}"); el.replaceWith(WIDGETS[el.dataset.w](o)); }
    catch (e) { el.replaceWith(h("p", { class: "note" }, "Dieses interaktive Element konnte nicht geladen werden.")); console.error(e); }
  });
}
function enhanceProse(root, cid) {
  // Selbsterklärungsfragen bewertbar machen
  $$(".sec.self li", root).forEach((li, i) => li.append(rateButtons(cid + ":self" + i)));
  // Lösungen schrittweise aufdecken
  $$(".solution", root).forEach(sol => {
    const parts = $$(":scope > .sol-content > *", sol);
    let shown = 0;
    const bar = $(".sol-bar", sol);
    const next = h("button", { class: "btn primary", type: "button" }), all = h("button", { class: "btn", type: "button" }, "Alles zeigen"), hide = h("button", { class: "btn", type: "button" }, "Verdecken");
    const upd = () => { parts.forEach((p, i) => p.classList.toggle("rv-hidden", i >= shown)); next.disabled = shown >= parts.length; next.textContent = shown >= parts.length ? "Vollständig aufgedeckt" : (shown === 0 ? "Lösung schrittweise aufdecken" : "Nächster Teil (" + (shown + 1) + "/" + parts.length + ")"); };
    next.addEventListener("click", () => { shown++; upd(); }); all.addEventListener("click", () => { shown = parts.length; upd(); }); hide.addEventListener("click", () => { shown = 0; upd(); });
    bar.append(next, all, hide); sol.classList.add("reveal-wrap"); upd();
  });
  $$("input.chk", root).forEach((cb, i) => { const k = cid + ":chk" + i; cb.id = nid("chk"); cb.checked = !!Prog.d.notes[k]; cb.setAttribute("aria-label", "erledigt"); cb.addEventListener("change", () => { Prog.d.notes[k] = cb.checked; Prog.save(); }); });
  $$(".blurcell", root).forEach(c => { c.tabIndex = 0; c.setAttribute("role", "button"); c.title = "Antwort aufdecken"; const t = () => c.classList.toggle("shown"); c.addEventListener("click", t); c.addEventListener("keydown", e => { if (e.key === "Enter") t(); }); });
}

/* ---------- Ansichten ---------- */
const VIEWS = [];
A.chapters.forEach(c => VIEWS.push({ id: c.id, kind: "chap", title: c.title, num: c.num, group: "Band 1 · Lehrbuch" }));
VIEWS.push({ id: "labor", kind: "labor", title: "Formel-Labor", num: "ƒ", group: "Werkzeuge" });
VIEWS.push({ id: "training", kind: "training", title: "Training & Karteikarten", num: "↻", group: "Werkzeuge" });
VIEWS.push({ id: "fortschritt", kind: "progress", title: "Mein Fortschritt", num: "◔", group: "Werkzeuge" });
VIEWS.push({ id: "pruefungen", kind: "exams", title: "Alle Prüfungen", num: "§", group: "Prüfungen" });
A.sims.forEach((x, i) => VIEWS.push({ id: x.id, kind: "sim", title: "Simulation " + "ABC"[i], num: "ABC"[i], group: "Prüfungen" }));
A.written.forEach((x, i) => VIEWS.push({ id: x.id, kind: "written", title: "Probeklausur " + "BC"[i], num: "P" + "BC"[i], group: "Prüfungen" }));
VIEWS.push({ id: "konto", kind: "konto", title: "Konto & Einstellungen", num: "◎", group: "Gemeinsam lernen" });
VIEWS.push({ id: "ranking", kind: "ranking", title: "Ranking", num: "#", group: "Gemeinsam lernen" });
VIEWS.push({ id: "vergleich", kind: "compare", title: "Vergleich mit Freunden", num: "⇄", group: "Gemeinsam lernen" });
VIEWS.push({ id: "teilen", kind: "share", title: "Mit Freunden teilen", num: "↗", group: "Gemeinsam lernen" });
A.ex.forEach(c => VIEWS.push({ id: c.id, kind: "ex", title: c.title, num: c.num, group: "Band 4 · Übungen & KA" }));

function themeVar(t) { return { blue: "--c-blue", cyan: "--c-cyan", orange: "--c-orange", purple: "--c-purple", green: "--c-green", neutral: "--muted", red: "--c-red" }[t] || "--c-blue"; }

function viewChapter(c) {
  const meta = A.meta[c.id] || {};
  const v = h("div", { class: "view" });
  const head = h("header", { class: "chap-head", style: `--stripe:var(${themeVar(meta.theme)})` },
    h("div", { class: "eyebrow" }, c.num === "0" ? "Band 1 · Einführung" : "Band 1 · Kapitel " + c.num),
    h("h1", { html: c.titleHtml }));
  if (meta.hook) head.append(h("p", { class: "hook" }, meta.hook));
  if (meta.goals) head.append(h("div", { class: "chap-meta" }, h("strong", {}, "Lernziele"), h("span", { class: "chip tag-app" }, "Ergänzung")), h("ul", { class: "goals" }, ...meta.goals.map(g => h("li", {}, g))));
  v.append(head);
  const prose = h("div", { class: "prose", html: c.html });
  v.append(prose);
  mountWidgets(prose); enhanceProse(prose, c.id);
  if (A.quiz[c.id]) v.append(quizWidget(c.id, A.quiz[c.id], "Wissenscheck Kapitel " + c.num));
  if (A.ruat[c.id]) v.append(ruatWidget(c.id));
  Prog.d.seen[c.id] = Date.now(); Prog.save();
  return v;
}
function viewEx(c) {
  const v = h("div", { class: "view" });
  v.append(h("header", { class: "chap-head", style: "--stripe:var(--c-green)" }, h("div", { class: "eyebrow" }, "Band 4 · Übungen & KA-Vorbereitung"), h("h1", { html: c.titleHtml }),
    h("p", { class: "note" }, "Lösungen sind verdeckt. Rechne zuerst selbst und decke dann Teil für Teil auf.")));
  const prose = h("div", { class: "prose", html: c.html }); v.append(prose); enhanceProse(prose, c.id);
  return v;
}
function viewLabor() {
  const v = h("div", { class: "view" });
  v.append(h("header", { class: "chap-head", style: "--stripe:var(--c-purple)" }, h("div", { class: "eyebrow" }, "Werkzeuge"), h("h1", {}, "Formel-Labor"),
    h("p", { class: "hook" }, "Alle Formeln der Bände an einem Ort. Klick auf eine Größe für Bedeutung, Einheit und Einfluss; mit den Reglern rechnest du live.")));
  const groups: [string, string[]][] = [["Stöchiometrie (Kap. 1)", ["n_m", "c_nV", "n_V", "yield"]], ["Energetik (Kap. 2)", ["ea_r"]], ["Kinetik (Kap. 3–4)", ["v_dc", "rate", "rgt", "vhat", "vbar", "boltz", "arrh"]], ["Gleichgewicht (Kap. 7)", ["K_k", "pq"]]];
  for (const [t, ks] of groups) { v.append(h("h2", { style: "font-family:var(--font-display);font-size:24px;margin:30px 0 0" }, t)); ks.forEach(k => v.append(formulaPanel(k))); }
  v.append(h("h2", { style: "font-family:var(--font-display);font-size:24px;margin:30px 0 0" }, "MWG-Rechner"), mwgWidget({ key: "nh3" }));
  return v;
}
// Karteikarten (Leitner-System)
const BOX_DAYS = [0, 1, 3, 7, 14];
function dueCards() { const now = Date.now(); return A.cards.map((c, i) => ({ c, i, st: Prog.d.cards[i] || { box: 0, due: 0 } })).filter(x => x.st.due <= now).sort((a, b) => a.st.box - b.st.box || a.st.due - b.st.due || a.i - b.i); }
function viewTraining() {
  const v = h("div", { class: "view" });
  v.append(h("header", { class: "chap-head", style: "--stripe:var(--c-orange)" }, h("div", { class: "eyebrow" }, "Werkzeuge"), h("h1", {}, "Training & Karteikarten"),
    h("p", { class: "hook" }, "Abrufen statt Wiederlesen: Die 40 Kurzfragen aus Band 4 als Karteikarten mit verteilter Wiederholung, dazu eine gemischte Runde aus allen Kapiteln (Interleaving).")));
  const boxes = h("div", { class: "boxes" });
  const cardWrap = h("div");
  const drawBoxes = () => { boxes.innerHTML = ""; for (let b = 0; b < 5; b++) { const n = A.cards.filter((c, i) => (Prog.d.cards[i] || { box: 0 }).box === b).length; boxes.append(h("div", { class: "box" }, h("div", { class: "l" }, "Fach " + (b + 1) + (b ? " · alle " + BOX_DAYS[b] + " Tag" + (BOX_DAYS[b] > 1 ? "e" : "") : " · neu/falsch")), h("div", { class: "v" }, String(n)))); } };
  const next = () => {
    drawBoxes(); cardWrap.innerHTML = "";
    const due = dueCards();
    if (!due.length) { cardWrap.append(h("div", { class: "card" }, h("div", { class: "front" }, "Für heute ist alles wiederholt."), h("p", { class: "note" }, "Die nächsten Karten werden nach ihrem Intervall wieder fällig."))); return; }
    const { c, i, st } = due[0];
    const back = h("div", { class: "back", hidden: true }, c.a);
    const btnShow = h("button", { class: "btn primary", type: "button" }, "Antwort zeigen");
    const rateRow = h("div", { class: "btnrow", hidden: true, style: "justify-content:center" });
    const grade = ok => { const nb = ok ? Math.min(4, st.box + 1) : 0; Prog.d.cards[i] = { box: nb, due: ok ? Date.now() + BOX_DAYS[nb] * 864e5 : Date.now() + 1 }; Prog.save(); next(); };
    rateRow.append(h("button", { class: "btn", type: "button", onclick: () => grade(false) }, "Nicht gewusst"), h("button", { class: "btn primary", type: "button", onclick: () => grade(true) }, "Gewusst"));
    btnShow.addEventListener("click", () => { back.hidden = false; btnShow.hidden = true; rateRow.hidden = false; });
    cardWrap.append(h("div", { class: "card" }, h("div", { class: "note" }, "Karte " + (i + 1) + " von " + A.cards.length + " · Fach " + (st.box + 1) + " · noch " + due.length + " fällig"), h("div", { class: "front" }, c.q), back, h("div", { class: "btnrow", style: "justify-content:center" }, btnShow), rateRow));
  };
  next();
  v.append(h("section", { class: "panel", style: "margin-top:22px" }, h("h2", {}, "Karteikarten"), boxes, h("div", { style: "margin-top:14px" }, cardWrap)));
  // gemischte Runde
  const pool = Object.entries(A.quiz).flatMap(([cid, qs]) => qs.map(q => Object.assign({ cid }, q)));
  const pick = shuffle(pool, (new Date()).getDate() + 3).slice(0, 10);
  v.append(quizWidget("mixed", pick, "Gemischte Runde: 10 Fragen aus allen Kapiteln", true));
  return v;
}
function viewProgress() {
  const v = h("div", { class: "view dash" });
  v.append(h("header", { class: "chap-head", style: "--stripe:var(--c-green)" }, h("div", { class: "eyebrow" }, "Werkzeuge"), h("h1", {}, "Mein Fortschritt"),
    h("p", { class: "hook" }, "Gezählt wird gezeigtes Verständnis: dein bestes Ergebnis im Wissenscheck (60 %) und deine Selbsteinschätzung bei den Abruf- und Erklärfragen (40 %). Lesen allein bringt keine Punkte.")));
  const rows = h("div", { class: "rows" });
  let nextGoal = null;
  A.chapters.filter(c => A.quiz[c.id]).forEach(c => {
    const m = mastery(c.id); const [lab_, cls] = masteryLabel(m);
    if (!nextGoal && (m == null || m < 0.8)) nextGoal = c;
    rows.append(h("a", { class: "prow", href: "#" + c.id }, h("span", {}, "Kap. " + c.num + " · " + c.plain), h("span", { class: "bar" }, h("i", { style: "width:" + Math.round((m || 0) * 100) + "%" })), h("span", { class: "pill " + cls }, lab_)));
  });
  const goal = nextGoal ? h("p", {}, "Nächstes Ziel: ", h("a", { href: "#" + nextGoal.id }, "Kapitel " + nextGoal.num + " · " + nextGoal.plain), ". Lies die Abschnitte, bearbeite den Wissenscheck und die Abruf-Fragen am Kapitelende.") : h("p", {}, "Alle Kapitel sind sicher. Jetzt: ", h("a", { href: "#u7a" }, "Probeklausur unter Zeitdruck"), " und Karteikarten im Training.");
  const wrongs: any[] = Object.values(Prog.d.wrong);
  const weak = Object.entries(Prog.d.rate).filter(([, r]) => r < 2);
  const due = dueCards().length;
  v.append(h("div", { class: "grid2" },
    h("section", { class: "panel" }, h("h2", {}, "Was als Nächstes?"), goal, h("p", {}, due + " Karteikarte" + (due === 1 ? " ist" : "n sind") + " fällig. ", h("a", { href: "#training" }, "Zum Training"))),
    h("section", { class: "panel" }, h("h2", {}, "Wiederholen"),
      wrongs.length ? h("ul", {}, ...wrongs.slice(0, 12).map(w => h("li", {}, h("a", { href: "#" + w.cid }, "Kap. " + (A.chapters.find(c => c.id === w.cid) || {}).num), ": " + w.q))) : h("p", { class: "note" }, "Keine falsch beantworteten Fragen gespeichert."),
      h("p", { class: "note" }, weak.length + " Abruf- oder Erklärfrage" + (weak.length === 1 ? "" : "n") + " mit „unsicher“ oder „nicht gewusst“ markiert."))));
  v.append(h("section", { class: "panel" }, h("h2", {}, "Kapitel"), rows));
  v.append(h("section", { class: "panel" }, h("h2", {}, "Fortschritt zurücksetzen"), h("p", { class: "note" }, "Löscht alle Ergebnisse, Bewertungen und Karteikarten-Fächer dieses Lernsystems."),
    h("button", { class: "btn", type: "button", onclick: e => { if (e.target.dataset.sure) { Prog.d = { quiz: {}, rate: {}, cards: {}, notes: {}, seen: {}, wrong: {}, exams: {}, written: {}, settings: Prog.d.settings, t: 0 }; Prog.save(); render(); } else { e.target.dataset.sure = "1"; e.target.textContent = "Wirklich alles löschen? Nochmal klicken"; } } }, "Zurücksetzen")));
  return v;
}
function viewStart() {
  const v = h("div", { class: "view dash" });
  v.append(h("header", { class: "chap-head", style: "--stripe:var(--c-blue)" }, h("div", { class: "eyebrow" }, "Reaktionslabor · WG12 · 1. KA · Kapitel 26/27"), h("h1", {}, "Energetik, Kinetik und chemisches Gleichgewicht"),
    h("p", { class: "hook" }, "Dein vollständiges Lehrbuch (Band 1) und alle Übungen mit Probeklausur (Band 4) als interaktives Lernsystem: Diagramme zum Ausprobieren, Formeln zum Anklicken, Wissenschecks mit sofortiger Erklärung und Karteikarten mit verteilter Wiederholung."),
    h("div", { class: "btnrow" }, h("a", { class: "btn primary", href: "#" + (lastSeen() || "k1"), style: "text-decoration:none" }, lastSeen() ? "Weiterlernen" : "Mit Kapitel 1 beginnen"), h("a", { class: "btn", href: "#fortschritt", style: "text-decoration:none" }, "Mein Fortschritt"), h("a", { class: "btn", href: "#pruefungen", style: "text-decoration:none" }, "Prüfungen"), h("a", { class: "btn", href: "#ranking", style: "text-decoration:none" }, "Ranking"))));
  const legend = [["--c-blue", "Begriffe und Definitionen"], ["--c-cyan", "Prozesse, Simulationen"], ["--c-orange", "Bedingungen, Zusammenhänge"], ["--c-purple", "Formeln und Mathematik"], ["--c-green", "Versuche, Beobachtungen, Lösungen"], ["--c-red", "Fehlvorstellungen, Warnungen"]];
  v.append(h("section", { class: "panel" }, h("h2", {}, "So liest du dieses System"),
    h("div", { class: "legend" }, ...legend.map(([c, t]) => h("span", { class: "chip", style: `color:var(${c})` }, h("i"), t))),
    h("p", {}, "Herkunft der Inhalte: ", h("span", { class: "chip tag-ka" }, "[KA]"), " auf der Ich-kann-Liste · ", h("span", { class: "chip tag-unterricht" }, "[Unterricht]"), " aus deinen Mitschriften · ", h("span", { class: "chip tag-abitur" }, "[Abitur]"), " Abiturstoff über die KA hinaus · ", h("span", { class: "chip tag-vertiefung" }, "[Vertiefung]"), " Hintergrund · ", h("span", { class: "chip tag-app" }, "Ergänzung"), " von der App hinzugefügt (Einstiege, Wissenschecks, Simulationen)."),
    h("p", { class: "note" }, "Der Text von Band 1 und Band 4 ist vollständig enthalten. Abschnitte lassen sich auf- und zuklappen, sind aber beim Öffnen sichtbar. Band 2 (Kernsätze) und Band 3 (Active Recall) bleiben als eigene Dokumente bestehen.")));
  const grid = h("div", { class: "startgrid" });
  A.chapters.forEach(c => { const m = A.meta[c.id] || {}; grid.append(h("a", { class: "tilelink", href: "#" + c.id, style: `--stripe:var(${themeVar(m.theme)})` }, h("span", {}, c.num === "0" ? "Einführung" : "Kapitel " + c.num), h("b", {}, c.plain), h("span", {}, masteryLabel(mastery(c.id))[0]))); });
  grid.append(h("a", { class: "tilelink", href: "#u7a", style: "--stripe:var(--c-green)" }, h("span", {}, "Band 4"), h("b", {}, "Probeklausur"), h("span", {}, "90 Minuten, 64 Punkte, mit Erwartungshorizont")));
  v.append(h("section", { class: "panel" }, h("h2", {}, "Kapitel"), grid));
  return v;
}
function lastSeen() { const e = Object.entries(Prog.d.seen).filter(([k]) => /^k\d$/.test(k)).sort((a, b) => b[1] - a[1]); return e.length ? e[0][0] : null; }

/* ---------- Navigation ---------- */
function buildSide() {
  const side = $("#side"); side.innerHTML = "";
  side.append(h("div", { class: "brand" }, h("div", { class: "eyebrow" }, "Chemie · 1. KA"), h("h1", {}, h("a", { href: "#start", style: "color:inherit;text-decoration:none" }, "Reaktionslabor"))));
  const groups = {};
  VIEWS.forEach(v => (groups[v.group] = groups[v.group] || []).push(v));
  for (const [g, vs] of Object.entries(groups)) {
    side.append(h("nav", { class: "navgroup", "aria-label": g }, h("h2", {}, g), h("ul", { class: "nav" }, ...vs.map(v => h("li", {}, h("a", { href: "#" + v.id, "data-id": v.id }, h("span", { class: "num" }, v.num), h("span", {}, v.kind === "chap" || v.kind === "ex" ? (A.chapters.concat(A.ex).find(c => c.id === v.id) || {}).plain : v.title), h("span", { class: "ringslot", "data-ring": v.kind === "chap" && A.quiz[v.id] ? v.id : "" })))))));
  }
  side.append(h("div", { class: "sidefoot" }, h("div", { id: "sync" }, "Fortschritt wird in diesem Browser gespeichert."), h("div", { style: "margin-top:6px" }, h("button", { class: "btn", type: "button", onclick: toggleTheme, style: "font-size:12.5px;padding:4px 10px" }, "Hell / Dunkel"))));
  updateSideRings();
}
function ring(m) {
  const r = 8, C = 2 * Math.PI * r, val = m || 0;
  return s("svg", { viewBox: "0 0 22 22", class: "ring", "aria-hidden": "true" }, s("circle", { cx: 11, cy: 11, r, fill: "none", stroke: css("--line"), "stroke-width": 3 }),
    s("circle", { cx: 11, cy: 11, r, fill: "none", stroke: val >= 0.8 ? css("--c-green") : css("--c-orange"), "stroke-width": 3, "stroke-dasharray": `${C * val} ${C}`, transform: "rotate(-90 11 11)" }));
}
function updateSideRings() { $$("[data-ring]").forEach(el => { const id = el.dataset.ring; el.innerHTML = ""; if (id) { el.append(ring(mastery(id))); el.title = "Meisterschaft: " + masteryLabel(mastery(id))[0]; } }); }
function toggleTheme() {
  const r = document.documentElement; const cur = r.getAttribute("data-theme") || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  r.setAttribute("data-theme", cur === "dark" ? "light" : "dark"); render();
}
function render() {
  if (typeof examTimer !== "undefined" && examTimer) { clearInterval(examTimer); examTimer = null; }
  const id = (location.hash || "#start").slice(1);
  const v = VIEWS.find(x => x.id === id);
  const main = $("#main"); main.innerHTML = "";
  main.append(h("button", { class: "btn menu-btn", type: "button", onclick: () => $("#side").classList.toggle("open") }, "Inhalt"));
  let view;
  if (!v) view = viewStart();
  else if (v.kind === "chap") view = viewChapter(A.chapters.find(c => c.id === id));
  else if (v.kind === "ex") view = viewEx(A.ex.find(c => c.id === id));
  else if (v.kind === "labor") view = viewLabor();
  else if (v.kind === "training") view = viewTraining();
  else if (EXTRA[v.kind]) view = EXTRA[v.kind](v);
  else view = viewProgress();
  main.append(view);
  if (v) {
    const i = VIEWS.indexOf(v), prev = VIEWS[i - 1], nxt = VIEWS[i + 1];
    view.append(h("nav", { class: "pager", "aria-label": "Blättern" }, prev ? h("a", { class: "btn", href: "#" + prev.id, style: "text-decoration:none" }, "← " + navTitle(prev)) : h("span"), nxt ? h("a", { class: "btn", href: "#" + nxt.id, style: "text-decoration:none" }, navTitle(nxt) + " →") : h("span")));
  }
  $$(".nav a").forEach(a => a.classList.toggle("active", a.dataset.id === id));
  $$(".bottomnav a").forEach(a => a.classList.toggle("active", a.dataset.bn === id));
  $("#side").classList.remove("open");
  window.scrollTo(0, 0);
}
function navTitle(v) { return v.kind === "chap" ? "Kapitel " + v.num : v.kind === "ex" ? "Band 4 · " + v.num : v.title; }
/* ---------- Gemeinsam lernen: Konto, Ranking, Vergleich, Teilen ---------- */
const Social = {
  st: { db: null, user: null, id: null, saveOk: null, canWrite: null, board: null, boardErr: null, lastPub: null, isOwner: false, canEdit: false },
  init(db, user, id) {
    this.st.db = db; this.st.user = user; this.st.id = id;
    try { user.can("data.write").then(v => { this.st.canWrite = v; }); user.isOwner().then(v => { this.st.isOwner = v; }); user.canEdit().then(v => { this.st.canEdit = v; }); } catch (e) {}
    const timer = setTimeout(() => { if (this.st.board == null) { this.st.boardErr = "timeout"; refreshSocial(); } }, 10000);
    try {
      db.collection("board").onSnapshot(snap => {
        clearTimeout(timer);
        this.st.board = snap.docs.map(d => Object.assign({ id: d.id }, d.data()));
        const mine = this.st.board.find(b => b.id === this.st.id);
        if (mine && this.st.lastPub == null) this.st.lastPub = JSON.stringify(this.body(mine));
        if (!snap.metadata.fromCache) this.st.boardErr = null;
        refreshSocial();
      }, err => { clearTimeout(timer); this.st.boardErr = err.code || "unavailable"; refreshSocial(); });
    } catch (e) { this.st.boardErr = "unavailable"; }
    this.publish();
  },
  summary() {
    const ch = {}, ex = {};
    let pts = 0;
    A.chapters.filter(c => A.quiz[c.id]).forEach(c => { const m = mastery(c.id); ch[c.id] = m == null ? null : Math.round(m * 100); const q = Prog.d.quiz[c.id]; if (q) pts += Math.round(q.best * 100); });
    A.sims.forEach(x => { const e = Prog.d.exams[x.id]; ex[x.id] = e ? Math.round(e.best * 100) : null; if (e) pts += Math.round(e.best * 100); });
    return { pts, ch, ex };
  },
  body(b) { return { name: b.name, pts: b.pts, ch: b.ch, ex: b.ex }; },
  async publish() {
    const st = this.st; if (!st.db || !st.id) return;
    const ref = st.db.doc("board/" + st.id);
    const name = cleanName(Prog.d.settings.name);
    if (Prog.d.settings.show && name) {
      const s = this.summary(); const body = { name, pts: s.pts, ch: s.ch, ex: s.ex };
      const key = JSON.stringify(body);
      if (key === st.lastPub) return;
      await ref.set(Object.assign({ t: Date.now() }, body)); st.lastPub = key;
    } else if (st.lastPub && st.lastPub !== "none") {
      await ref.delete(); st.lastPub = "none";
    }
  },
};
function cleanName(n) { return String(n || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 24); }
function refreshSocial() { const id = (location.hash || "").slice(1); if (id === "ranking" || id === "vergleich" || id === "teilen") render(); }
function statusInfo() {
  const st = Social.st;
  if (!st.db || !st.id) return { ok: false, cls: "p1", text: "Nur in diesem Browser", detail: "Du bist nicht angemeldet oder diese Ansicht erlaubt kein Speichern im Konto. Dein Fortschritt bleibt in diesem Browser; Ranking und Vergleich sind nicht verfügbar." };
  if (st.saveOk === false) return { ok: false, cls: "p2", text: "Nur Lesezugriff", detail: "Du kannst die App benutzen, aber nicht in deinem Konto speichern. Das passiert, wenn du die App nur ansehen darfst (Rolle „Viewer“ oder öffentlicher Link). Bitte den Besitzer, dich als Contributor oder Editor einzuladen." };
  return { ok: true, cls: "p3", text: "Im Konto gespeichert", detail: "Dein Fortschritt wird in deinem Konto gespeichert und ist auf Handy und Laptop gleich." };
}
const SHARE_URL = "https://claude.ai/artifact/JPhTxJkT28zEo5PM5EP9kC";

function pageHead(eyebrow, title, hook, stripe) {
  return h("header", { class: "chap-head", style: "--stripe:var(" + (stripe || "--c-blue") + ")" }, h("div", { class: "eyebrow" }, eyebrow), h("h1", {}, title), hook ? h("p", { class: "hook" }, hook) : null);
}

/* ---------- Prüfungen ---------- */
let examTimer = null;
function viewExams() {
  const v = h("div", { class: "view dash" });
  v.append(pageHead("Prüfungen", "Prüfungen", "Drei automatisch ausgewertete Klausur-Simulationen mit Zeitlimit und zwei neue schriftliche Probeklausuren mit Erwartungshorizont. Dazu kommt die Original-Probeklausur aus Band 4.", "--c-green"));
  const grid = h("div", { class: "startgrid" });
  A.sims.forEach(x => { const e = Prog.d.exams[x.id]; grid.append(h("a", { class: "tilelink", href: "#" + x.id, style: "--stripe:var(--c-green)" }, h("span", {}, "Automatisch ausgewertet · " + x.min + " min · " + x.items.length + " Aufgaben"), h("b", {}, x.title), h("span", {}, e ? "Bestes Ergebnis: " + Math.round(e.best * 100) + " %" : "Noch nicht bearbeitet"))); });
  A.written.forEach(x => { const w = Prog.d.written[x.id]; const sum = w ? w.pts.reduce((a, b) => a + (+b || 0), 0) : null; grid.append(h("a", { class: "tilelink", href: "#" + x.id, style: "--stripe:var(--c-orange)" }, h("span", {}, "Schriftlich · Selbstkorrektur"), h("b", {}, x.title), h("span", {}, sum != null ? "Deine Punkte: " + sum + " / 60" : "Noch nicht korrigiert"))); });
  grid.append(h("a", { class: "tilelink", href: "#u7a", style: "--stripe:var(--c-blue)" }, h("span", {}, "Band 4 · Original"), h("b", {}, "Probeklausur A (64 Punkte)"), h("span", {}, "mit Erwartungshorizont in 7B")));
  v.append(h("section", { class: "panel" }, h("h2", {}, "Auswahl"), grid,
    h("p", { class: "note" }, "Die Simulationen fließen ins Ranking ein. Die schriftlichen Klausuren korrigierst du selbst; diese Punkte bleiben privat. Alle neuen Aufgaben sind Ergänzungen und wurden nachgerechnet; die Messwerte in Probeklausur B sind ausdrücklich fiktive Übungswerte.")));
  return v;
}
function parseNum(t) { const s0 = String(t).trim().replace(/\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."); return s0 === "" ? NaN : Number(s0); }
function viewSim(v) {
  const X = A.sims.find(x => x.id === v.id);
  const wrap = h("div", { class: "view" });
  wrap.append(pageHead("Klausur-Simulation · " + X.min + " Minuten · " + X.items.length + " Aufgaben", X.title, "Rechne auf Papier und gib nur das Ergebnis ein. Dezimalkomma oder Punkt sind beide erlaubt. Bei Zahlenaufgaben zählt das Ergebnis innerhalb einer kleinen Rundungstoleranz.", "--c-green"));
  const best = Prog.d.exams[X.id];
  const body = h("div");
  const start = () => {
    body.innerHTML = "";
    let left = X.min * 60; const answers = {};
    const clock = h("div", { class: "tile", style: "position:sticky;top:8px;z-index:5" }, h("div", { class: "l" }, "Verbleibende Zeit"), h("div", { class: "v" }, ""));
    const tick = () => { const m = Math.floor(left / 60), s2 = left % 60; clock.lastChild.textContent = m + ":" + String(s2).padStart(2, "0"); if (left <= 0) submit(); left--; };
    const list = h("div", { class: "stepbox" });
    X.items.forEach((it, i) => {
      const q = h("div", { class: "q" }, h("div", { class: "qh" }, h("span", { class: "lvl" }, "Nr. " + (i + 1)), h("span", {}, it.q)));
      if (it.t === "mc") {
        const order = shuffle(it.opts.map((o, j) => j), i + 11);
        const opts = h("div", { class: "opts", role: "radiogroup" });
        order.forEach(j => { const b = h("button", { class: "opt", type: "button", role: "radio", "aria-checked": "false" }, it.opts[j]); b.addEventListener("click", () => { answers[i] = j; $$(".opt", opts).forEach(x => { x.setAttribute("aria-checked", "false"); x.style.outline = ""; }); b.setAttribute("aria-checked", "true"); b.style.outline = "2px solid var(--accent)"; }); opts.append(b); });
        q.append(opts);
      } else {
        const id = nid("ans");
        const inp = h("input", { type: "text", inputmode: "decimal", id, autocomplete: "off", placeholder: "Ergebnis" });
        inp.addEventListener("input", () => { answers[i] = inp.value; });
        q.append(h("div", { class: "btnrow" }, h("label", { for: id, class: "note" }, "Ergebnis:"), h("span", { style: "max-width:220px;flex:1" }, inp), h("span", {}, it.unit || "(ohne Einheit)")));
      }
      q.append(h("div", { class: "fb", hidden: true }));
      list.append(q);
    });
    const submitBtn = h("button", { class: "btn primary", type: "button" }, "Abgeben und auswerten");
    let done = false;
    const submit = () => {
      if (done) return; done = true; clearInterval(examTimer); examTimer = null;
      let right = 0;
      X.items.forEach((it, i) => {
        const q = list.children[i], fb = q.querySelector(".fb");
        let ok, shown;
        if (it.t === "mc") { ok = answers[i] === it.a; shown = it.opts[it.a]; $$(".opt", q).forEach(b => { b.disabled = true; if (b.textContent === it.opts[it.a]) b.classList.add("ok"); else if (b.getAttribute("aria-checked") === "true") b.classList.add("bad"); }); }
        else { const x = parseNum(answers[i]); ok = isFinite(x) && Math.abs(x - it.ans) <= Math.abs(it.ans) * it.tol + 1e-12; shown = sci(it.ans, 3) + (it.unit ? " " + it.unit : ""); q.querySelector("input").disabled = true; }
        if (ok) right++;
        fb.hidden = false; fb.className = "fb " + (ok ? "ok" : "bad"); fb.innerHTML = "";
        fb.append(h("b", {}, ok ? "Richtig." : "Nicht richtig. Lösung: " + shown), it.why);
      });
      const sc = right / X.items.length;
      const prev = Prog.d.exams[X.id];
      Prog.d.exams[X.id] = { best: Math.max(sc, prev ? prev.best : 0), last: sc, t: Date.now(), used: X.min * 60 - Math.max(0, left) };
      Prog.save();
      submitBtn.remove();
      result.innerHTML = "";
      result.append(h("h2", {}, right + " von " + X.items.length + " richtig (" + Math.round(sc * 100) + " %)"),
        h("p", {}, sc >= 0.85 ? "Sehr gut, das entspricht etwa 13–15 Punkten." : sc >= 0.7 ? "Gut. Lies bei den falschen Aufgaben die Erklärung und wiederhole das Kapitel." : "Hier lohnt sich Wiederholung. Die Erklärungen stehen unter jeder Aufgabe."),
        h("div", { class: "btnrow" }, h("button", { class: "btn primary", type: "button", onclick: () => render() }, "Neuer Versuch"), h("a", { class: "btn", href: "#ranking", style: "text-decoration:none" }, "Zum Ranking")));
      result.hidden = false; result.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    submitBtn.addEventListener("click", submit);
    const result = h("section", { class: "panel", hidden: true });
    body.append(clock, result, list, h("div", { class: "btnrow", style: "margin-top:16px" }, submitBtn));
    clearInterval(examTimer); tick(); examTimer = setInterval(tick, 1000);
  };
  body.append(h("section", { class: "panel" }, h("h2", {}, "Bereit?"),
    h("p", {}, "Zeitlimit " + X.min + " Minuten. Nach Ablauf wird automatisch abgegeben. Hilfsmittel wie in der KA: Taschenrechner und die Formeln aus der Formelsammlung."),
    best ? h("p", { class: "note" }, "Bisher bestes Ergebnis: " + Math.round(best.best * 100) + " %") : null,
    h("button", { class: "btn primary", type: "button", onclick: start }, "Simulation starten")));
  wrap.append(body);
  return wrap;
}
function textBlock(t) { const d = h("div", { class: "prose" }); t.split("\n\n").forEach(par => { const p = h("p"); par.split("\n").forEach((line, i) => { if (i) p.append(h("br")); p.append(line); }); d.append(p); }); return d; }
function viewWritten(v) {
  const X = A.written.find(x => x.id === v.id);
  const wrap = h("div", { class: "view" });
  wrap.append(pageHead("Schriftliche Probeklausur · Ergänzung", X.title, "Unter echten Bedingungen bearbeiten: Uhr stellen, keine Unterlagen. Danach den Erwartungshorizont je Aufgabe aufdecken und deine Punkte eintragen.", "--c-orange"));
  wrap.append(h("section", { class: "panel" }, h("p", {}, h("strong", {}, "Gegeben: "), X.given)));
  const saved = Prog.d.written[X.id] || { pts: X.tasks.map(() => "") };
  const total = h("div", { class: "tile" }, h("div", { class: "l" }, "Deine Summe"), h("div", { class: "v" }, ""));
  const maxOf = t => +((t[0].match(/\((\d+) P\)/) || [0, 0])[1]);
  const upd = () => { const s = saved.pts.reduce((a, b) => a + (+b || 0), 0); total.lastChild.textContent = s + " / " + X.tasks.reduce((a, t) => a + maxOf(t), 0) + " Punkte"; };
  X.tasks.forEach((t, i) => {
    const sol = h("div", { class: "solution", hidden: true }, h("div", { class: "sol-bar" }, "Erwartungshorizont"), textBlock(t[2]));
    const btn = h("button", { class: "btn", type: "button", onclick: () => { sol.hidden = false; btn.remove(); } }, "Erwartungshorizont aufdecken");
    const id = nid("pts");
    const inp = h("input", { type: "number", id, min: 0, max: maxOf(t), step: 0.5, value: saved.pts[i] ?? "", style: "max-width:100px" });
    inp.addEventListener("input", () => { const m = maxOf(t); let val = inp.value === "" ? "" : Math.max(0, Math.min(m, +inp.value)); saved.pts[i] = val; Prog.d.written[X.id] = saved; Prog.save(); upd(); });
    wrap.append(h("details", { class: "sec", open: "" }, h("summary", {}, h("h3", {}, t[0]), h("span", { class: "caret", "aria-hidden": "true" }, "▸")),
      h("div", { class: "body" }, textBlock(t[1]), btn, sol, h("div", { class: "btnrow" }, h("label", { for: id, class: "note" }, "Deine Punkte (max. " + maxOf(t) + "):"), inp))));
  });
  upd();
  wrap.append(h("div", { class: "readout", style: "margin-top:16px" }, total));
  return wrap;
}

/* ---------- Konto ---------- */
function viewKonto() {
  const v = h("div", { class: "view dash" });
  v.append(pageHead("Gemeinsam lernen", "Konto & Einstellungen", null, "--c-blue"));
  const si = statusInfo();
  v.append(h("section", { class: "panel" }, h("h2", {}, "Speicherstatus"), h("p", {}, h("span", { class: "pill " + si.cls }, si.text)), h("p", {}, si.detail)));
  const nameId = nid("name"), showId = nid("show");
  const nameInp = h("input", { type: "text", id: nameId, maxlength: 24, value: Prog.d.settings.name || "", placeholder: "z. B. Izzy", style: "max-width:320px", autocomplete: "nickname" });
  const show = h("input", { type: "checkbox", id: showId }); show.checked = !!Prog.d.settings.show;
  const msg = h("p", { class: "note", "aria-live": "polite" });
  const save = h("button", { class: "btn primary", type: "button" }, "Speichern");
  save.addEventListener("click", async () => {
    const n = cleanName(nameInp.value);
    if (show.checked && !n) { msg.textContent = "Gib einen Anzeigenamen ein, um im Ranking zu erscheinen."; return; }
    Prog.d.settings = { name: n, show: show.checked }; Prog.save();
    msg.textContent = "Gespeichert.";
    try { await Social.publish(); msg.textContent = show.checked ? (si.ok ? "Gespeichert. Du erscheinst im Ranking als „" + n + "“." : "Gespeichert. Ranking ist in dieser Ansicht nicht verfügbar (siehe Speicherstatus).") : "Gespeichert. Du bist aus dem Ranking entfernt."; }
    catch (e) { msg.textContent = "Gespeichert, aber das Ranking konnte nicht aktualisiert werden (keine Schreibrechte)."; }
  });
  v.append(h("section", { class: "panel" }, h("h2", {}, "Profil"),
    h("div", { class: "ctl", style: "max-width:420px" }, h("label", { for: nameId }, "Anzeigename (nur dieser Name ist für andere sichtbar)"), nameInp),
    h("div", { class: "ctl", style: "margin-top:10px" }, h("label", { for: showId, style: "justify-content:flex-start;gap:10px" }, show, "Im Ranking und im Vergleich mit Freunden anzeigen")),
    h("p", { class: "note" }, "Sichtbar für andere sind nur dein Anzeigename, deine Punkte, deine Kapitel-Meisterschaft und deine Prüfungsergebnisse. Notizen, Antworten und Karteikarten bleiben privat."),
    h("div", { class: "btnrow" }, save), msg));
  v.append(h("section", { class: "panel" }, h("h2", {}, "Darstellung"), h("div", { class: "btnrow" }, h("button", { class: "btn", type: "button", onclick: toggleTheme }, "Hell / Dunkel wechseln")), h("p", { class: "note" }, "Die App passt sich automatisch an Handy, Tablet und Laptop an. Auf dem Handy findest du die wichtigsten Bereiche in der Leiste unten.")));
  const s = Social.summary();
  v.append(h("section", { class: "panel" }, h("h2", {}, "Deine Punkte"), h("p", { class: "score" }, s.pts + " Punkte"),
    h("p", { class: "note" }, "Punkte = bestes Ergebnis jedes Wissenschecks in Prozent (8 Kapitel, max. 800) + bestes Ergebnis jeder Klausur-Simulation in Prozent (3 Simulationen, max. 300)."),
    h("a", { class: "btn", href: "#fortschritt", style: "text-decoration:none" }, "Fortschritt ansehen oder zurücksetzen")));
  return v;
}

/* ---------- Ranking ---------- */
function boardOrNote() {
  const st = Social.st;
  if (!st.db || !st.id) return h("p", {}, "Ranking und Vergleich brauchen eine angemeldete Ansicht mit Speicherrecht. In dieser Ansicht nicht verfügbar.");
  if (st.board == null) return h("p", { class: "note" }, st.boardErr === "timeout" ? "Das Ranking ist gerade nicht erreichbar. Versuch es später noch einmal." : "Ranking wird geladen …");
  return null;
}
function viewRanking() {
  const v = h("div", { class: "view dash" });
  v.append(pageHead("Gemeinsam lernen", "Ranking", "Nur Anzeigenamen und Punkte. Wer mitmachen will, trägt in „Konto & Einstellungen“ einen Namen ein und schaltet die Anzeige ein.", "--c-orange"));
  const note = boardOrNote();
  const panel = h("section", { class: "panel" }, h("h2", {}, "Bestenliste"));
  if (note) panel.append(note);
  else {
    const rows = Social.st.board.filter(b => b.name).slice().sort((a, b) => (b.pts || 0) - (a.pts || 0));
    if (!rows.length) panel.append(h("p", {}, "Noch niemand im Ranking. Sei die erste Person: ", h("a", { href: "#konto" }, "Namen eintragen"), "."));
    else {
      let rank = 0, lastPts = null;
      const tb = h("tbody");
      rows.forEach((b, i) => { if (b.pts !== lastPts) { rank = i + 1; lastPts = b.pts; } const me = b.id === Social.st.id;
        const tr = h("tr", { style: me ? "background:var(--t-blue)" : "" }, h("td", {}, String(rank) + "."), h("td", {}), h("td", { style: "text-align:right;font-family:var(--font-mono)" }, String(b.pts || 0)));
        tr.children[1].textContent = b.name + (me ? " (du)" : ""); tb.append(tr); });
      panel.append(h("div", { class: "tablewrap prose" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Platz"), h("th", {}, "Name"), h("th", { style: "text-align:right" }, "Punkte"))), tb)));
    }
    if (!Prog.d.settings.show) panel.append(h("p", { class: "note" }, "Du bist nicht im Ranking. ", h("a", { href: "#konto" }, "In den Einstellungen einschalten"), "."));
  }
  v.append(panel);
  v.append(h("section", { class: "panel" }, h("h2", {}, "So entstehen die Punkte"), h("p", {}, "Bestes Ergebnis jedes Wissenschecks (Kapitel 1–8) und jeder Klausur-Simulation (A–C), jeweils in Prozent. Maximal 1100 Punkte. Lesen allein bringt keine Punkte.")));
  return v;
}

/* ---------- Vergleich ---------- */
const cmpSel = new Set();
function viewCompare() {
  const v = h("div", { class: "view dash" });
  v.append(pageHead("Gemeinsam lernen", "Vergleich mit Freunden", "Vergleiche deine Kapitel-Meisterschaft und Prüfungsergebnisse mit bis zu vier Personen aus dem Ranking. So seht ihr, wer wem bei welchem Thema helfen kann.", "--c-purple"));
  const note = boardOrNote();
  if (note) { v.append(h("section", { class: "panel" }, note)); return v; }
  const others = Social.st.board.filter(b => b.name && b.id !== Social.st.id);
  const me = Object.assign({ name: (cleanName(Prog.d.settings.name) || "Du") + " (du)", id: "me" }, Social.summary());
  const pick = h("div", { class: "btnrow" });
  if (!others.length) pick.append(h("p", { class: "note" }, "Noch keine anderen Personen im Ranking. Lade Freunde ein: ", h("a", { href: "#teilen" }, "Mit Freunden teilen"), "."));
  others.forEach(o => { const b = h("button", { class: "btn", type: "button", "aria-pressed": cmpSel.has(o.id) ? "true" : "false", style: cmpSel.has(o.id) ? "border-color:var(--accent);background:var(--t-blue)" : "" });
    b.textContent = o.name; b.addEventListener("click", () => { if (cmpSel.has(o.id)) cmpSel.delete(o.id); else if (cmpSel.size < 4) cmpSel.add(o.id); render(); }); pick.append(b); });
  v.append(h("section", { class: "panel" }, h("h2", {}, "Personen auswählen (max. 4)"), pick));
  const people = [me].concat(others.filter(o => cmpSel.has(o.id)));
  const cell = val => { const td = h("td", {}); if (val == null) { td.append(h("span", { class: "pill p0" }, "–")); return td; } const cls = val >= 80 ? "p3" : val >= 40 ? "p2" : "p1"; td.append(h("div", { class: "bar", style: "margin-bottom:4px" }, h("i", { style: "width:" + val + "%" })), h("span", { class: "pill " + cls }, val + " %")); return td; };
  const thead = h("tr", {}, h("th", {}, "Bereich"));
  people.forEach(p => { const th = h("th", {}); th.textContent = p.name; thead.append(th); });
  const tb = h("tbody");
  A.chapters.filter(c => A.quiz[c.id]).forEach(c => { const tr = h("tr", {}, h("td", {}, "Kap. " + c.num + " · " + c.plain)); people.forEach(p => tr.append(cell(p.ch ? p.ch[c.id] : null))); tb.append(tr); });
  A.sims.forEach((x, i) => { const tr = h("tr", {}, h("td", {}, "Simulation " + "ABC"[i])); people.forEach(p => tr.append(cell(p.ex ? p.ex[x.id] : null))); tb.append(tr); });
  const trp = h("tr", {}, h("td", {}, h("strong", {}, "Punkte"))); people.forEach(p => trp.append(h("td", { style: "font-family:var(--font-mono)" }, String(p.pts || 0)))); tb.append(trp);
  v.append(h("section", { class: "panel" }, h("h2", {}, "Gegenüberstellung"), h("div", { class: "tablewrap prose" }, h("table", {}, h("thead", {}, thead), tb)),
    h("p", { class: "note" }, "Meisterschaft je Kapitel: 60 % Wissenscheck, 40 % Selbsteinschätzung. Die Werte der anderen werden aktualisiert, sobald sie lernen.")));
  return v;
}

/* ---------- Teilen ---------- */
function viewShare() {
  const v = h("div", { class: "view dash" });
  v.append(pageHead("Gemeinsam lernen", "Mit Freunden teilen", "Die App läuft im Browser auf Handy und Laptop. Wer Zugriff bekommt, entscheidest du im Teilen-Menü von claude.ai; diese Seite erklärt, welche Variante was ermöglicht.", "--c-green"));
  const urlId = nid("url");
  const url = h("input", { type: "text", id: urlId, value: SHARE_URL, readonly: "", style: "max-width:460px" });
  const copyMsg = h("span", { class: "note", "aria-live": "polite" });
  const copy = h("button", { class: "btn primary", type: "button", onclick: async () => { try { await navigator.clipboard.writeText(SHARE_URL); copyMsg.textContent = "Link kopiert."; } catch (e) { url.select(); copyMsg.textContent = "Kopieren nicht erlaubt: Link ist markiert, kopiere ihn mit Strg+C bzw. lange drücken."; } } }, "Link kopieren");
  v.append(h("section", { class: "panel" }, h("h2", {}, "1. Link"), h("div", { class: "ctl" }, h("label", { for: urlId }, "Adresse der App"), url), h("div", { class: "btnrow", style: "margin-top:8px" }, copy, copyMsg),
    h("p", { class: "note" }, "Der Link allein gibt noch keinen Zugriff. Zugriff vergibst du im nächsten Schritt.")));
  const tb = h("tbody");
  [["Privat mit Freunden (empfohlen)", "Auf claude.ai die App öffnen → Teilen → Freunde per E-Mail einladen. Freunde außerhalb deiner Organisation als „Editor“, Mitglieder deines Teams als „Contributor“. Keinen öffentlichen Link aktivieren.", "Ja, im eigenen Konto", "Ja"],
   ["Öffentlich als Website", "Teilen → Link-Zugriff für alle mit Link (veröffentlichen).", "Nur im eigenen Browser", "Nein, nur ansehen"],
   ["Nur ansehen", "Einladen als „Viewer“ oder „Commenter“.", "Nur im eigenen Browser", "Nein"]].forEach(r => tb.append(h("tr", {}, ...r.map((x, i) => h(i ? "td" : "th", { scope: i ? null : "row" }, x)))));
  v.append(h("section", { class: "panel" }, h("h2", {}, "2. Zugriff vergeben"),
    h("div", { class: "tablewrap prose" }, h("table", {}, h("thead", {}, h("tr", {}, h("th", {}, "Variante"), h("th", {}, "So geht's"), h("th", {}, "Fortschritt speichern"), h("th", {}, "Ranking & Vergleich"))), tb)),
    h("p", {}, h("strong", {}, "Wichtig: "), "Ein öffentlicher Link und gemeinsames Speichern schließen sich für Freunde außerhalb deiner Organisation aus: Sobald der Link öffentlich ist, dürfen eingeladene Editoren von außen nicht mehr speichern. Editoren können außerdem neue Versionen der Seite veröffentlichen; lade also nur Leute ein, denen du vertraust."),
    h("p", { class: "note" }, "Die App kann selbst niemanden einladen oder Rechte vergeben; das geht nur über das Teilen-Menü von claude.ai.")));
  const n = Social.st.board ? Social.st.board.filter(b => b.name).length : null;
  v.append(h("section", { class: "panel" }, h("h2", {}, "3. Gemeinsam starten"),
    h("ol", {}, h("li", {}, "Jede Person öffnet die App und trägt unter ", h("a", { href: "#konto" }, "Konto & Einstellungen"), " einen Anzeigenamen ein."),
      h("li", {}, "„Im Ranking anzeigen“ einschalten."), h("li", {}, "Wissenschecks und Klausur-Simulationen bearbeiten: Die Punkte erscheinen im ", h("a", { href: "#ranking" }, "Ranking"), ", Details im ", h("a", { href: "#vergleich" }, "Vergleich"), ".")),
    h("p", { class: "note" }, n == null ? "Teilnehmerzahl erscheint, sobald das Ranking geladen ist." : n + " Person" + (n === 1 ? "" : "en") + " im Ranking.")));
  const si = statusInfo();
  v.append(h("section", { class: "panel" }, h("h2", {}, "Dein Status in dieser Ansicht"), h("p", {}, h("span", { class: "pill " + si.cls }, si.text), " ", si.detail)));
  return v;
}

/* ---------- Handy-Leiste ---------- */
function bottomNav() {
  const items = [["start", "Start", "⌂"], ["menu", "Kapitel", "☰"], ["pruefungen", "Prüfungen", "§"], ["training", "Training", "↻"], ["ranking", "Ranking", "#"]];
  const nav = h("nav", { class: "bottomnav", "aria-label": "Schnellnavigation" });
  items.forEach(([id, t, ic]) => {
    const a = id === "menu" ? h("button", { type: "button", onclick: () => $("#side").classList.toggle("open") }, h("span", { class: "ic", "aria-hidden": "true" }, ic), t)
      : h("a", { href: "#" + id, "data-bn": id }, h("span", { class: "ic", "aria-hidden": "true" }, ic), t);
    nav.append(a);
  });
  document.body.append(nav);
}
const EXTRA = { exams: viewExams, sim: viewSim, written: viewWritten, konto: viewKonto, ranking: viewRanking, compare: viewCompare, share: viewShare };



let started = false;
export function startLab(): void {
  if (started) return;
  started = true;
  Prog.load();
  buildSide();
  bottomNav();
  render();
  window.addEventListener("hashchange", render);
  Prog.connect();
}
