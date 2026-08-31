import React, { useState, useMemo, useEffect } from "react";
import { AreaChartMini, ComboChartMini, LineChartMini } from "./charts.jsx";
import {
  Home, Wallet, ListTree, Settings, Calendar, Plus, X, FileText,
  ArrowUpRight, ArrowDownRight, ChevronRight, Search, Info,
} from "./icons.jsx";

/* =========================================================================
   BANK EXPORT FORMAT (Danish bank CSV, e.g. Danske Bank "Posteringsdetaljer")
   Semicolon-delimited, no header row. Column positions (0-indexed):
   0 note/case-ref   1 description   2 from-account   3 to-account
   4 amount (da-DK)  5 counterpart   6 (unused)       7 transaction date
   8 posting date    9 value date    10 ref #1        11 ref #2
   12,13 (unused)    14 alt display text              15 (unused)

   No transactions are hardcoded — everything comes from files you import
   in the Konti tab, stored locally on this device.
   ========================================================================= */

/* ---------- yearly budget plan taxonomy ---------- */
const MONTH_NAMES_SHORT = ["Jan", "Feb", "Mar", "Apr", "Maj", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dec"];
const DEFAULT_INCOME_SUBCATS = [
  { id: "inc-loen", name: "Løn", mapTo: "løn" },
  { id: "inc-skat", name: "Skat", mapTo: null },
  { id: "inc-andet", name: "Andet", mapTo: null },
];
const DEFAULT_EXPENSE_SUBCATS = [
  { id: "exp-dagligvarer", name: "Dagligvarer", mapTo: "dagligvarer" },
  { id: "exp-bil", name: "Bil og værksted", mapTo: "transport" },
  { id: "exp-cafe", name: "Café og restaurant", mapTo: "restaurant" },
  { id: "exp-underholdning", name: "Underholdning", mapTo: "abonnement" },
  { id: "exp-foreninger", name: "Foreninger", mapTo: null },
  { id: "exp-sport", name: "Sport og fritid", mapTo: "fritid" },
];

/* ---------- annual bills budget (from the user's own budget CSV) ---------- */
// Matches real transaction descriptions to each named line item in the imported
// household budget. Order matters where two rules could both match the same text —
// more specific patterns (e.g. "kredsløb genbrug") are checked before broader ones.
const BILL_MATCHERS = [
  { name: "Bolig, Realkredit", test: (d) => /totalkredit/i.test(d) },
  { name: "Bolig, Banklån Saxild", test: (d) => /overført til lån|til lån \d/i.test(d) },
  { name: "Bolig, Ejendomsskat", test: (d) => /ejendomsskat/i.test(d) },
  { name: "Sommerhus", test: (d) => /vibevej/i.test(d) },
  { name: "Fællesudgifter, børn", test: (d) => /fællesudgifter/i.test(d) && !/vibevej/i.test(d) },
  { name: "Fagforening", test: (d) => /\bprosa\b/i.test(d) },
  { name: "Bil, ejerafgift", test: (d) => /skattestyrelsen motor/i.test(d) },
  { name: "Forsikringer, Alka", test: (d) => /\balka\b/i.test(d) },
  { name: "Bolig, Vand", test: (d) => /aarhus vand/i.test(d) },
  { name: "Bolig, Renovation", test: (d) => /kredsløb genbrug/i.test(d) },
  { name: "Bolig, Varme", test: (d) => /kredsløb a\/s/i.test(d) && !/genbrug/i.test(d) },
  { name: "Bolig, El", test: (d) => /\baura\b|vindstød/i.test(d) },
  { name: "Bil, FDM", test: (d) => /\bfdm\b/i.test(d) },
  { name: "Forsikring, danmark", test: (d) => /sygeforsikringen danmark/i.test(d) },
];
function matchBillLine(desc) {
  const hit = BILL_MATCHERS.find((m) => m.test(desc));
  return hit ? hit.name : null;
}

const DA_MONTH_NAMES_LONG = [
  "Januar", "Februar", "Marts", "April", "Maj", "Juni",
  "Juli", "August", "September", "Oktober", "November", "December",
];

function parseBillBudget(raw) {
  const lines = raw.split(/\r\n|\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { year: null, rows: [] };
  const headerYear = parseInt(parseLine(lines[0])[0], 10);
  const rows = [];
  for (const line of lines.slice(1)) {
    const f = parseLine(line);
    const name = f[0];
    if (!name || name === "Udgifter" || name === "Indtægter" || /^Difference|^Forventet|^Faktisk/.test(name)) break;
    const months = f.slice(1, 13).map((v) => parseDkAmount(v));
    rows.push({ name, months });
  }
  return { year: Number.isFinite(headerYear) ? headerYear : null, rows };
}

// Handles bank exports where a description field contains an embedded newline
// (rare, but real Danske Bank fee lines do this) — merges those back into a
// single logical row before the normal semicolon-split parser runs.
function fixMultilineQuotedFields(raw) {
  const rawLines = raw.split(/\r\n|\n/);
  const out = [];
  let buffer = null;
  for (const line of rawLines) {
    if (buffer === null) {
      const q = (line.match(/"/g) || []).length;
      if (q % 2 !== 0) buffer = line;
      else out.push(line);
    } else {
      buffer += " " + line.trim();
      const q = (buffer.match(/"/g) || []).length;
      if (q % 2 === 0) {
        out.push(buffer);
        buffer = null;
      }
    }
  }
  if (buffer !== null) out.push(buffer);
  return out.join("\n");
}

/* ---------- category taxonomy ---------- */
const CATS = [
  { id: "dagligvarer", name: "Dagligvarer", color: "#6FA98C", group: "budget", budget: 3000 },
  { id: "transport", name: "Transport & brændstof", color: "#4A6FA5", group: "budget", budget: 700 },
  { id: "bolig", name: "Bolig & indbo", color: "#2F5D50", group: "budget", budget: 3000 },
  { id: "regninger", name: "Regninger & telefoni", color: "#7A8B99", group: "budget", budget: 600 },
  { id: "abonnement", name: "Abonnementer & streaming", color: "#D9A441", group: "budget", budget: 300 },
  { id: "restaurant", name: "Restaurant & café", color: "#8C6E96", group: "budget", budget: 1200 },
  { id: "fritid", name: "Fritid & oplevelser", color: "#B57A52", group: "budget", budget: 600 },
  { id: "sundhed", name: "Sundhed & personligt", color: "#C4886B", group: "budget", budget: 300 },
  { id: "lån", name: "Lån & afdrag", color: "#6E5B7A", group: "budget", budget: 4000 },
  { id: "løn", name: "Løn & indbetalinger", color: "#3F8F5E", group: "flow" },
  { id: "overførsler", name: "Overførsler & privat", color: "#4E8B8B", group: "flow" },
  { id: "opsparing", name: "Opsparing & investering", color: "#3E6E5E", group: "flow" },
  { id: "gebyrer", name: "Gebyrer & det offentlige", color: "#9C8465", group: "flow" },
  { id: "diverse", name: "Diverse", color: "#9AA39D", group: "flow" },
  { id: "ignorer", name: "Ignorer (ekstraordinært)", color: "#B8BDB6", group: "ignore" },
];
const catById = Object.fromEntries(CATS.map((c) => [c.id, c]));
const CAT_GROUPS = [
  { group: "budget", label: "Budgetkategorier" },
  { group: "flow", label: "Andre bevægelser" },
  { group: "ignore", label: "Særlig" },
];

/* ---------- keyword rules (checked in order, most specific first) ---------- */
const RULES = [
  ["lysa", "opsparing"],
  ["thansen", "fritid"],
  ["freetrailer", "fritid"],
  ["weekendavisen", "abonnement"],
  ["headspace", "abonnement"],
  ["hbomax", "abonnement"],
  ["disney plus", "abonnement"],
  ["netflix", "abonnement"],
  ["apple.com", "abonnement"],
  ["itunes", "abonnement"],
  ["saxo.com", "fritid"],
  ["danskespil", "fritid"],
  ["folkeuniversitet", "fritid"],
  ["saxild minigolf", "fritid"],
  ["waxies", "fritid"],
  ["sport 24", "fritid"],
  ["loebeshop", "fritid"],
  ["br tilst", "fritid"],
  ["jem&fix", "bolig"],
  ["harald nyborg", "bolig"],
  ["bauhaus", "bolig"],
  ["ikea", "bolig"],
  ["depositum", "bolig"],
  ["boligportal", "bolig"],
  ["fællesudgifter", "bolig"],
  ["fællesudg", "bolig"],
  ["depotrum", "bolig"],
  ["andel energi", "regninger"],
  ["lebara", "regninger"],
  ["aura a/s", "regninger"],
  ["kredsløb", "regninger"],
  ["prosa", "regninger"],
  ["louis nielsen", "sundhed"],
  ["nordania finans", "transport"],
  ["til lån", "lån"],
  ["retsafgift", "gebyrer"],
  ["civilstyrels", "gebyrer"],
  ["netto scanngo", "dagligvarer"],
  ["netto ", "dagligvarer"],
  ["bilka", "dagligvarer"],
  ["rema1000", "dagligvarer"],
  ["lidl", "dagligvarer"],
  ["coop app", "dagligvarer"],
  ["mibmadmarked", "dagligvarer"],
  ["circle k", "transport"],
  ["ok a.m.b.a", "transport"],
  ["dsb", "transport"],
  ["metro", "transport"],
  ["surdejspza", "restaurant"],
  ["havblik", "restaurant"],
  ["frederiks,", "restaurant"],
  ["tir na nog", "restaurant"],
  ["groft aps", "restaurant"],
  ["voxhall", "fritid"],
  ["hotel himmelbjerget", "fritid"],
  ["mcompany", "diverse"],
  ["betaling pa dba", "diverse"],
  ["lønoverførsel", "løn"],
  ["fælles dødsbo", "overførsler"],
  ["sine", "overførsler"],
];

function categorize(desc, altDesc, amount) {
  const t = `${desc} ${altDesc}`.toLowerCase();
  for (const [kw, cat] of RULES) {
    if (t.includes(kw)) return cat;
  }
  if (t.includes("mobilepay")) return amount < 0 ? "diverse" : "overførsler";
  if (/^til |^overførsel|^overført|^b\/e |^advis |^vedr\.|^terrasse/.test(t)) return "overførsler";
  return amount > 0 ? "overførsler" : "diverse";
}

/* ---------- CSV parsing helpers ---------- */
function parseDkAmount(s) {
  if (!s) return 0;
  return parseFloat(s.replace(/\./g, "").replace(",", ".")) || 0;
}
function parseDkDate(s) {
  const [d, m, y] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function parseLine(line) {
  return line.split(";").map((f) => f.trim().replace(/^"|"$/g, ""));
}
function maskAccount(acc) {
  const clean = (acc || "").replace(/\s+/g, "");
  if (clean.length < 8) return acc || "";
  return `${clean.slice(0, 4)} •••• ${clean.slice(-4)}`;
}

function parseTransactions(raw, accountMeta, knownRawAccounts) {
  return raw
    .split(/\r\n|\n/)
    .filter((l) => l.trim().length)
    .map((line, i) => {
      const f = parseLine(line);
      const desc = f[1] || f[0] || "Ukendt postering";
      const fromAcct = f[2] || "";
      const toAcct = f[3] || "";
      const amount = parseDkAmount(f[4]);
      const altDesc = f[14] || "";
      const date = parseDkDate(f[7] || f[8]);
      const ref = f[10] || "";
      const counterpart =
        fromAcct === accountMeta.raw ? toAcct : toAcct === accountMeta.raw ? fromAcct : fromAcct || toAcct;
      const isInternal = !!counterpart && knownRawAccounts.has(counterpart);
      return {
        id: `${accountMeta.id}-${ref || i}`,
        ref,
        desc,
        fromAcct,
        toAcct,
        counterpart,
        isInternal,
        amount,
        date,
        accountId: accountMeta.id,
        accountName: accountMeta.name,
        cat: categorize(desc, altDesc, amount),
      };
    });
}

/* ---------- design tokens ---------- */
const C = {
  paper: "#F2F4EF",
  card: "#FFFFFF",
  ink: "#1B2B28",
  inkSoft: "#5C6E68",
  hairline: "#DEE3DC",
  pine: "#2F5D50",
  pineDeep: "#1E3E35",
  denim: "#4A6FA5",
  mustard: "#D9A441",
  mint: "#0AAA5A",
  plum: "#8C6E96",
  slate: "#7A8B99",
  rust: "#FF5353",
  spiirOrange: "#FF9700",
};

const fontImport = `
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,500;9..144,600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500;600&display=swap');
`;

const OWNER_NAME = "Dig"; // no name is hardcoded — everything below is generic

const dfMonth = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short" });
const kr = (n) =>
  new Intl.NumberFormat("da-DK", { maximumFractionDigits: 0 }).format(Math.round(n)) + " kr.";
const krDec = (n) =>
  new Intl.NumberFormat("da-DK", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) + " kr.";

/* ---------- small UI atoms ---------- */
function NavItem({ icon: Icon, label, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-left transition-colors"
      style={{
        background: active ? "rgba(255,255,255,0.10)" : "transparent",
        color: active ? "#FFFFFF" : "rgba(255,255,255,0.62)",
        fontFamily: "'IBM Plex Sans', sans-serif",
        fontWeight: 500,
        fontSize: 14,
      }}
    >
      <Icon size={17} strokeWidth={2} />
      {label}
    </button>
  );
}

function Card({ children, style, className = "" }) {
  return (
    <div
      className={`rounded-2xl ${className}`}
      style={{ background: C.card, border: `1px solid ${C.hairline}`, ...style }}
    >
      {children}
    </div>
  );
}

function CatDot({ color, size = 8 }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: color,
        flexShrink: 0,
      }}
    />
  );
}

/* ---------- add-account card, shown in the Konti grid ---------- */
function AddAccountCard({ onAdd }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [raw, setRaw] = useState("");
  const [balance, setBalance] = useState("");

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex flex-col items-center justify-center"
        style={{
          border: `1.5px dashed ${C.hairline}`, borderRadius: 16, minHeight: 180,
          color: C.inkSoft, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, fontWeight: 500,
        }}
      >
        <Plus size={20} style={{ marginBottom: 6 }} />
        Tilføj konto
      </button>
    );
  }

  return (
    <div className="rounded-2xl p-5" style={{ background: C.card, border: `1px solid ${C.hairline}` }}>
      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 500, marginBottom: 10 }}>Ny konto</div>
      <input
        placeholder="Navn (fx Lønkonto)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        style={{ width: "100%", fontSize: 13, border: `1px solid ${C.hairline}`, borderRadius: 8, padding: "7px 10px", marginBottom: 8 }}
      />
      <input
        placeholder="Kontonummer (som det står i CSV'en)"
        value={raw}
        onChange={(e) => setRaw(e.target.value)}
        style={{ width: "100%", fontSize: 13, border: `1px solid ${C.hairline}`, borderRadius: 8, padding: "7px 10px", marginBottom: 8 }}
      />
      <input
        type="number"
        placeholder="Nuværende saldo"
        value={balance}
        onChange={(e) => setBalance(e.target.value)}
        style={{ width: "100%", fontSize: 13, border: `1px solid ${C.hairline}`, borderRadius: 8, padding: "7px 10px", marginBottom: 12 }}
      />
      <div className="flex gap-2">
        <button
          onClick={() => { onAdd(name, raw, balance); setName(""); setRaw(""); setBalance(""); setOpen(false); }}
          style={{ flex: 1, fontSize: 12.5, fontWeight: 500, color: "#fff", background: C.pine, borderRadius: 8, padding: "8px 10px" }}
        >
          Tilføj
        </button>
        <button
          onClick={() => setOpen(false)}
          style={{ fontSize: 12.5, fontWeight: 500, color: C.inkSoft, borderRadius: 8, padding: "8px 10px" }}
        >
          Annuller
        </button>
      </div>
    </div>
  );
}

/* ---------- Kompas: signature radial budget gauge ---------- */
function Kompas({ categories }) {
  const totalBudget = categories.reduce((s, c) => s + c.budget, 0);
  const totalSpent = categories.reduce((s, c) => s + c.spent, 0);
  const pct = Math.round((totalSpent / totalBudget) * 100);

  const cx = 118, cy = 118;
  const innerR = 118 * 0.34;
  const outerR = 118 * 0.96;
  const n = categories.length || 1;
  const step = (outerR - innerR) / n;
  const strokeW = step * 0.78;

  return (
    <div style={{ position: "relative", width: 236, height: 236, margin: "0 auto" }}>
      {/* tick ring, compass-rose reference */}
      <svg width="236" height="236" style={{ position: "absolute", inset: 0 }}>
        <circle cx="118" cy="118" r="115" fill="none" stroke={C.hairline} strokeWidth="1" />
        {Array.from({ length: 48 }).map((_, i) => {
          const angle = (i / 48) * 2 * Math.PI;
          const long = i % 6 === 0;
          const r1 = long ? 108 : 112;
          const r2 = 115;
          const x1 = 118 + r1 * Math.cos(angle);
          const y1 = 118 + r1 * Math.sin(angle);
          const x2 = 118 + r2 * Math.cos(angle);
          const y2 = 118 + r2 * Math.sin(angle);
          return (
            <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={C.hairline} strokeWidth={long ? 1.3 : 0.7} />
          );
        })}
      </svg>

      {/* budget rings, one per category, replacing the old recharts RadialBarChart */}
      <svg width="236" height="236" style={{ position: "absolute", inset: 0 }}>
        {categories.map((c, i) => {
          const r = innerR + step * (i + 0.5);
          const circumference = 2 * Math.PI * r;
          const value = Math.min(100, Math.round((c.spent / c.budget) * 100)) || 0;
          const dash = circumference * (value / 100);
          return (
            <g key={c.id} transform={`rotate(-90 ${cx} ${cy})`}>
              <circle cx={cx} cy={cy} r={r} fill="none" stroke="#EEF1EC" strokeWidth={strokeW} />
              <circle
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={c.color}
                strokeWidth={strokeW}
                strokeLinecap="round"
                strokeDasharray={`${dash} ${circumference - dash}`}
              />
            </g>
          );
        })}
      </svg>

      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 30, fontWeight: 600, color: C.ink, letterSpacing: -0.5 }}>
          {pct}%
        </div>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11.5, color: C.inkSoft, marginTop: 2 }}>
          af budget brugt
        </div>
      </div>
    </div>
  );
}

/* ---------- category row w/ inline bar ---------- */
function CategoryRow({ c, onClick, active }) {
  const pct = Math.min(100, Math.round((c.spent / c.budget) * 100));
  const over = c.spent > c.budget;
  return (
    <button
      onClick={onClick}
      className="w-full text-left"
      style={{
        padding: "12px 4px",
        borderBottom: `1px solid ${C.hairline}`,
        background: active ? "#F7F8F5" : "transparent",
        borderRadius: 10,
      }}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <CatDot color={c.color} />
          <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, fontWeight: 500, color: C.ink }}>
            {c.name}
          </span>
        </div>
        <span
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: 12.5,
            color: over ? C.rust : C.inkSoft,
          }}
        >
          {kr(c.spent)} <span style={{ opacity: 0.55 }}>/ {kr(c.budget)}</span>
        </span>
      </div>
      <div style={{ height: 6, borderRadius: 4, background: "#EEF1EC", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${pct}%`,
            background: over ? C.rust : c.color,
            borderRadius: 4,
            transition: "width 0.4s ease",
          }}
        />
      </div>
    </button>
  );
}

/* ---------- yearly budget plan row ---------- */
function PlanRow({ row, kind, suggestion, monthsWithDataCount, onAmountChange, onToggleMonth, onApplySuggestion, onRemove }) {
  const activeMonths = row.months.filter(Boolean).length;
  const yearlyTotal = row.monthlyAmount * activeMonths;
  const suggestionRounded = Math.round(suggestion);
  const hasSuggestion = row.mapTo && suggestionRounded > 0;

  return (
    <div className="py-3" style={{ borderTop: `1px solid ${C.hairline}` }}>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, fontWeight: 500, color: C.ink, flex: 1, minWidth: 120 }}>
          {row.name}
        </span>
        <div className="flex items-center gap-1" style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13 }}>
          <input
            type="number"
            value={row.monthlyAmount}
            onChange={(e) => onAmountChange(e.target.value)}
            style={{
              width: 92,
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 13,
              color: C.ink,
              background: C.paper,
              border: `1px solid ${C.hairline}`,
              borderRadius: 6,
              padding: "4px 6px",
              textAlign: "right",
            }}
          />
          <span style={{ fontSize: 11.5, color: C.inkSoft }}>kr./md.</span>
        </div>
        <button onClick={onRemove} aria-label={`Fjern ${row.name}`} style={{ color: C.inkSoft, padding: 2 }}>
          <X size={14} />
        </button>
      </div>

      <div className="flex items-center gap-1 flex-wrap mb-1.5">
        {MONTH_NAMES_SHORT.map((m, i) => (
          <button
            key={m}
            onClick={() => onToggleMonth(i)}
            style={{
              fontFamily: "'IBM Plex Sans', sans-serif",
              fontSize: 10.5,
              fontWeight: 500,
              padding: "3px 7px",
              borderRadius: 999,
              border: `1px solid ${row.months[i] ? C.pine : C.hairline}`,
              background: row.months[i] ? C.pine : "transparent",
              color: row.months[i] ? "#fff" : "#B7BEB9",
            }}
          >
            {m}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between flex-wrap gap-1" style={{ fontSize: 11, color: C.inkSoft }}>
        <span>
          {activeMonths} mdr. × {kr(row.monthlyAmount)} = <strong style={{ color: C.ink }}>{kr(yearlyTotal)}</strong> / år
        </span>
        {hasSuggestion && (
          <button onClick={onApplySuggestion} style={{ color: C.denim, fontSize: 11 }}>
            Sidste år: ca. {kr(suggestionRounded)}/md. ({monthsWithDataCount} mdr. data) — brug forslag
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------- bills budget-vs-actual row ---------- */
function BillRow({ name, budgetMonths, actualMonths, unmatched, billsYear, lastBillsMonthIdx }) {
  const yearlyBudget = budgetMonths.reduce((s, v) => s + v, 0);
  const gnsMd = yearlyBudget / 12;
  const budgetSoFar = budgetMonths.slice(0, lastBillsMonthIdx + 1).reduce((s, v) => s + v, 0);
  const actualSoFar = actualMonths.slice(0, lastBillsMonthIdx + 1).reduce((s, v) => s + v, 0);
  const over = actualSoFar > budgetSoFar;

  return (
    <div className="py-3" style={{ borderTop: `1px solid ${C.hairline}` }}>
      <div className="flex items-center justify-between mb-2 flex-wrap gap-1">
        <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, fontWeight: 500, color: C.ink }}>
          {name}
        </span>
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 12, color: C.inkSoft }}>
          {kr(gnsMd)} <span style={{ opacity: 0.6 }}>gns/md</span>
        </span>
      </div>
      <div className="flex items-center gap-1 flex-wrap mb-1.5">
        {MONTH_NAMES_SHORT.map((m, i) => {
          const hasOccurred = i <= lastBillsMonthIdx;
          const budget = budgetMonths[i];
          const actual = actualMonths[i];
          const isOver = hasOccurred && actual > budget + 1; // small tolerance for rounding
          const color = unmatched || !hasOccurred ? "#DCE0DA" : isOver ? C.rust : C.mint;
          return (
            <span
              key={m}
              title={unmatched ? `${m}: ikke sporet automatisk` : hasOccurred ? `${m}: budget ${kr(budget)}, faktisk ${kr(actual)}` : `${m}: fremtid`}
              style={{
                width: 20, height: 20, borderRadius: "50%", background: color,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                fontSize: 8.5, fontFamily: "'IBM Plex Sans', sans-serif", color: !unmatched && hasOccurred ? "#fff" : "#9AA39D",
              }}
            >
              {m[0]}
            </span>
          );
        })}
      </div>
      <div style={{ fontSize: 11, color: C.inkSoft }}>
        {unmatched ? (
          "Ikke sporet automatisk — indgår ikke i noget beløb ovenfor"
        ) : (
          <>Hidtil i {billsYear}: <strong style={{ color: over ? C.rust : C.ink }}>{kr(actualSoFar)}</strong> af {kr(budgetSoFar)} budgetteret</>
        )}
      </div>
    </div>
  );
}

/* ---------- main app ---------- */
export default function App() {
  const [tab, setTab] = useState("overblik");
  const [activeCat, setActiveCat] = useState(null);

  /* ---------- accounts + imported transactions (all local, nothing hardcoded) ---------- */
  const [accounts, setAccounts] = useState([]); // {id, raw, name, currentBalance}
  const [txLines, setTxLines] = useState({}); // accountId -> array of raw CSV line strings (deduped by ref)
  const [dataLoaded, setDataLoaded] = useState(false);
  const [importMessage, setImportMessage] = useState(null);
  const ACCOUNTS_KEY = "accounts-config";
  const TX_LINES_KEY = "tx-lines";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const a = await window.storage.get(ACCOUNTS_KEY, false);
        if (!cancelled && a?.value) setAccounts(JSON.parse(a.value));
      } catch (err) { /* no accounts saved yet */ }
      try {
        const t = await window.storage.get(TX_LINES_KEY, false);
        if (!cancelled && t?.value) setTxLines(JSON.parse(t.value));
      } catch (err) { /* no transactions saved yet */ }
      if (!cancelled) setDataLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!dataLoaded) return;
    (async () => {
      try { await window.storage.set(ACCOUNTS_KEY, JSON.stringify(accounts), false); }
      catch (err) { console.error("Kunne ikke gemme konti", err); }
    })();
  }, [accounts, dataLoaded]);

  useEffect(() => {
    if (!dataLoaded) return;
    (async () => {
      try { await window.storage.set(TX_LINES_KEY, JSON.stringify(txLines), false); }
      catch (err) { console.error("Kunne ikke gemme transaktioner", err); }
    })();
  }, [txLines, dataLoaded]);

  const knownRawAccounts = useMemo(() => new Set(accounts.map((a) => a.raw)), [accounts]);

  const ALL_TX = useMemo(() => {
    let combined = [];
    accounts.forEach((a) => {
      const raw = (txLines[a.id] || []).join("\n");
      if (raw) combined = combined.concat(parseTransactions(raw, a, knownRawAccounts));
    });
    combined.sort((x, y) => y.date - x.date);
    // Reconstruct running balances per account, anchored to today's known balance
    // at the newest transaction, walking backward through older postings.
    accounts.forEach((a) => {
      const forAccount = combined.filter((t) => t.accountId === a.id);
      let running = a.currentBalance || 0;
      forAccount.forEach((t) => {
        t.balanceAfter = running;
        running -= t.amount;
      });
    });
    return combined;
  }, [accounts, txLines, knownRawAccounts]);

  const DATA_YEAR = useMemo(() => {
    if (!ALL_TX.length) return new Date().getFullYear();
    return Math.max(...ALL_TX.map((t) => t.date.getFullYear()));
  }, [ALL_TX]);
  const PLAN_YEAR = DATA_YEAR + 1;

  function addAccount(name, raw, currentBalance) {
    if (!name.trim() || !raw.trim()) return;
    const id = `acc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setAccounts((prev) => [...prev, { id, raw: raw.trim(), name: name.trim(), currentBalance: Number(currentBalance) || 0 }]);
  }
  function updateAccountBalance(id, value) {
    setAccounts((prev) => prev.map((a) => (a.id === id ? { ...a, currentBalance: Number(value) || 0 } : a)));
  }
  function removeAccount(id) {
    setAccounts((prev) => prev.filter((a) => a.id !== id));
    setTxLines((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }
  async function importFileToAccount(accountId, file) {
    const text = await file.text();
    const fixed = fixMultilineQuotedFields(text);
    const newLines = fixed.split(/\r\n|\n/).map((l) => l.trim()).filter(Boolean);
    const existing = txLines[accountId] || [];
    const existingRefs = new Set(existing.map((l) => parseLine(l)[10]).filter(Boolean));
    const toAdd = [];
    let skipped = 0;
    newLines.forEach((line) => {
      const ref = parseLine(line)[10];
      if (ref && existingRefs.has(ref)) { skipped++; return; }
      if (ref) existingRefs.add(ref);
      toAdd.push(line);
    });
    setTxLines((prev) => ({ ...prev, [accountId]: [...existing, ...toAdd] }));
    setImportMessage(`${toAdd.length} nye posteringer importeret${skipped ? `, ${skipped} sprunget over (allerede importeret)` : ""}.`);
  }

  /* ---------- bills budget (imported CSV, optional) ---------- */
  const [billBudget, setBillBudget] = useState({ year: null, rows: [] });
  const [billBudgetLoaded, setBillBudgetLoaded] = useState(false);
  const BILL_BUDGET_KEY = "bill-budget";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.storage.get(BILL_BUDGET_KEY, false);
        if (!cancelled && res?.value) setBillBudget(JSON.parse(res.value));
      } catch (err) { /* none saved yet */ }
      if (!cancelled) setBillBudgetLoaded(true);
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!billBudgetLoaded) return;
    (async () => {
      try { await window.storage.set(BILL_BUDGET_KEY, JSON.stringify(billBudget), false); }
      catch (err) { console.error("Kunne ikke gemme budget", err); }
    })();
  }, [billBudget, billBudgetLoaded]);

  async function importBillBudgetFile(file) {
    const text = await file.text();
    const fixed = fixMultilineQuotedFields(text);
    const parsed = parseBillBudget(fixed);
    setBillBudget(parsed);
  }

  const BILLS_YEAR = billBudget.year || DATA_YEAR;
  const BILL_ACTUALS = useMemo(() => {
    const byName = {};
    ALL_TX.forEach((t) => {
      if (t.isInternal || t.amount >= 0 || t.date.getFullYear() !== BILLS_YEAR) return;
      const lineName = matchBillLine(t.desc);
      if (!lineName) return;
      if (!byName[lineName]) byName[lineName] = new Array(12).fill(0);
      byName[lineName][t.date.getMonth()] += Math.abs(t.amount);
    });
    return byName;
  }, [ALL_TX, BILLS_YEAR]);
  const LAST_BILLS_MONTH_IDX = useMemo(() => {
    let last = -1;
    ALL_TX.forEach((t) => {
      if (t.date.getFullYear() === BILLS_YEAR) last = Math.max(last, t.date.getMonth());
    });
    return last;
  }, [ALL_TX, BILLS_YEAR]);

  const [overrides, setOverrides] = useState({}); // txId -> category id chosen by the user
  const [overridesLoaded, setOverridesLoaded] = useState(false);
  const OVERRIDES_KEY = "category-overrides";

  // Load saved category changes once on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await window.storage.get(OVERRIDES_KEY, false);
        if (!cancelled && res?.value) setOverrides(JSON.parse(res.value));
      } catch (err) {
        // no saved overrides yet — start from an empty map
      } finally {
        if (!cancelled) setOverridesLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist changes, but only once the initial load has finished so we
  // never overwrite saved data with the empty starting state.
  useEffect(() => {
    if (!overridesLoaded) return;
    (async () => {
      try {
        await window.storage.set(OVERRIDES_KEY, JSON.stringify(overrides), false);
      } catch (err) {
        console.error("Kunne ikke gemme kategori-ændringer", err);
      }
    })();
  }, [overrides, overridesLoaded]);

  const resetOverrides = async () => {
    try {
      await window.storage.delete(OVERRIDES_KEY, false);
    } catch (err) {
      // nothing to delete — fine
    }
    setOverrides({});
  };

  const TX = useMemo(
    () => ALL_TX.map((t) => (overrides[t.id] ? { ...t, cat: overrides[t.id] } : t)),
    [ALL_TX, overrides]
  );

  // "Ignorer" transactions are extraordinary and excluded from every budget/overview figure below.
  const externalTx = useMemo(() => TX.filter((t) => !t.isInternal && t.cat !== "ignorer"), [TX]);

  const { budgetCats, ignoredTotal, ignoredTx, weeklySpend, monthlyNet, income, expense, net, period, accountStats } = useMemo(() => {
    const spentByCat = {};
    externalTx.forEach((t) => {
      if (t.amount < 0) spentByCat[t.cat] = (spentByCat[t.cat] || 0) + Math.abs(t.amount);
    });
    const budgetCats = CATS.filter((c) => c.group === "budget").map((c) => ({
      ...c,
      spent: spentByCat[c.id] || 0,
    }));

    const ignoredTx = TX.filter((t) => t.cat === "ignorer");
    const ignoredTotal = ignoredTx.reduce((s, t) => s + Math.abs(t.amount), 0);

    let income = 0, expense = 0;
    externalTx.forEach((t) => {
      if (t.amount > 0) income += t.amount; else expense += Math.abs(t.amount);
    });
    // internal transfers net to 0 across accounts; ignored items are deliberately left out of "net" too
    const net = TX.filter((t) => t.cat !== "ignorer").reduce((s, t) => s + t.amount, 0);

    const dates = ALL_TX.map((t) => t.date);
    const minDate = dates.length ? new Date(Math.min(...dates)) : new Date();
    const maxDate = dates.length ? new Date(Math.max(...dates)) : new Date();
    const dfFull = new Intl.DateTimeFormat("da-DK", { day: "numeric", month: "short", year: "numeric" });
    const period = !dates.length
      ? "ingen data importeret endnu"
      : minDate.getFullYear() === maxDate.getFullYear()
      ? `${dfMonth.format(minDate)} – ${dfFull.format(maxDate)}`
      : `${dfFull.format(minDate)} – ${dfFull.format(maxDate)}`;

    const weekBuckets = {};
    externalTx.forEach((t) => {
      if (t.amount >= 0) return;
      const weekIdx = Math.floor((t.date - minDate) / (7 * 86400000));
      weekBuckets[weekIdx] = (weekBuckets[weekIdx] || 0) + Math.abs(t.amount);
    });
    const weeklySpend = Object.keys(weekBuckets)
      .sort((a, b) => a - b)
      .map((k, i) => ({ uge: `Uge ${i + 1}`, forbrug: Math.round(weekBuckets[k]) }));

    const dfMonthShort = new Intl.DateTimeFormat("da-DK", { month: "short" });
    const monthIncome = new Array(12).fill(0);
    const monthExpense = new Array(12).fill(0);
    externalTx.forEach((t) => {
      if (t.date.getFullYear() !== DATA_YEAR) return;
      const m = t.date.getMonth();
      if (t.amount > 0) monthIncome[m] += t.amount;
      else monthExpense[m] += t.amount; // kept negative, so the bar draws downward like Spiir's chart
    });
    const monthlyNet = monthIncome.map((inc, i) => ({
      month: dfMonthShort.format(new Date(DATA_YEAR, i, 1)),
      indtægter: Math.round(inc),
      udgifter: Math.round(monthExpense[i]),
      netto: Math.round(inc + monthExpense[i]),
    }));

    // account balances/cashflow reflect real bank activity — categorization never changes these
    const accountStats = accounts.map((a) => {
      const tx = ALL_TX.filter((t) => t.accountId === a.id);
      const inc = tx.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
      const exp = tx.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);
      return { ...a, income: inc, expense: exp, net: inc - exp, count: tx.length };
    });

    return { budgetCats, ignoredTotal, ignoredTx, weeklySpend, monthlyNet, income, expense, net, period, accountStats };
  }, [TX, externalTx, accounts, ALL_TX]);

  const [accountFilter, setAccountFilter] = useState("alle");
  const [txPage, setTxPage] = useState(0);
  const TX_PAGE_SIZE = 50;

  const visibleTx = useMemo(
    () =>
      TX.filter(
        (t) => (!activeCat || t.cat === activeCat) && (accountFilter === "alle" || t.accountId === accountFilter)
      ),
    [TX, activeCat, accountFilter]
  );

  // Any change to the filters should land back on page 1, so the page number
  // never points past the end of a newly-filtered (shorter) list.
  useEffect(() => {
    setTxPage(0);
  }, [activeCat, accountFilter]);

  const txPageCount = Math.max(1, Math.ceil(visibleTx.length / TX_PAGE_SIZE));
  const pagedTx = useMemo(
    () => visibleTx.slice(txPage * TX_PAGE_SIZE, txPage * TX_PAGE_SIZE + TX_PAGE_SIZE),
    [visibleTx, txPage]
  );

  /* ---------- yearly budget plan (for PLAN_YEAR) ---------- */
  const monthsWithDataCount = useMemo(() => {
    const keys = new Set(externalTx.map((t) => `${t.date.getFullYear()}-${t.date.getMonth()}`));
    return keys.size || 1;
  }, [externalTx]);

  const catAverage = (catId, kind) => {
    if (!catId) return 0;
    const total = externalTx
      .filter((t) => t.cat === catId && (kind === "income" ? t.amount > 0 : t.amount < 0))
      .reduce((s, t) => s + Math.abs(t.amount), 0);
    return total / monthsWithDataCount;
  };

  const buildDefaultPlan = () => {
    const makeRow = (def, kind) => ({
      id: def.id,
      name: def.name,
      mapTo: def.mapTo,
      monthlyAmount: Math.round(catAverage(def.mapTo, kind)),
      months: new Array(12).fill(true),
    });
    return {
      income: DEFAULT_INCOME_SUBCATS.map((d) => makeRow(d, "income")),
      expense: DEFAULT_EXPENSE_SUBCATS.map((d) => makeRow(d, "expense")),
    };
  };

  const [budgetPlan, setBudgetPlan] = useState(null);
  const [budgetPlanLoaded, setBudgetPlanLoaded] = useState(false);
  const BUDGET_PLAN_KEY = `yearly-budget-plan-${PLAN_YEAR}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let loadedPlan = null;
      try {
        const res = await window.storage.get(BUDGET_PLAN_KEY, false);
        if (res?.value) loadedPlan = JSON.parse(res.value);
      } catch (err) {
        // no saved plan yet
      }
      if (!cancelled) {
        setBudgetPlan(loadedPlan || buildDefaultPlan());
        setBudgetPlanLoaded(true);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!budgetPlanLoaded || !budgetPlan) return;
    (async () => {
      try {
        await window.storage.set(BUDGET_PLAN_KEY, JSON.stringify(budgetPlan), false);
      } catch (err) {
        console.error("Kunne ikke gemme årsbudget", err);
      }
    })();
  }, [budgetPlan, budgetPlanLoaded]);

  const updatePlanAmount = (kind, id, value) => {
    const amount = value === "" ? 0 : Math.round(Number(value) || 0);
    setBudgetPlan((p) => ({
      ...p,
      [kind]: p[kind].map((r) => (r.id === id ? { ...r, monthlyAmount: amount } : r)),
    }));
  };

  const togglePlanMonth = (kind, id, monthIdx) => {
    setBudgetPlan((p) => ({
      ...p,
      [kind]: p[kind].map((r) =>
        r.id === id ? { ...r, months: r.months.map((m, i) => (i === monthIdx ? !m : m)) } : r
      ),
    }));
  };

  const applyPlanSuggestion = (kind, id) => {
    setBudgetPlan((p) => ({
      ...p,
      [kind]: p[kind].map((r) =>
        r.id === id ? { ...r, monthlyAmount: Math.round(catAverage(r.mapTo, kind)) } : r
      ),
    }));
  };

  const removePlanRow = (kind, id) => {
    setBudgetPlan((p) => ({ ...p, [kind]: p[kind].filter((r) => r.id !== id) }));
  };

  const addPlanRow = (kind, name) => {
    if (!name || !name.trim()) return;
    const newRow = {
      id: `${kind}-custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: name.trim(),
      mapTo: null,
      monthlyAmount: 0,
      months: new Array(12).fill(true),
    };
    setBudgetPlan((p) => ({ ...p, [kind]: [...p[kind], newRow] }));
  };

  const planTotals = useMemo(() => {
    if (!budgetPlan) return null;
    const yearlyTotal = (rows) => rows.reduce((s, r) => s + r.monthlyAmount * r.months.filter(Boolean).length, 0);
    const totalIncome = yearlyTotal(budgetPlan.income);
    const totalExpense = yearlyTotal(budgetPlan.expense);
    const monthlyProjection = Array.from({ length: 12 }, (_, m) => {
      const inc = budgetPlan.income.reduce((s, r) => s + (r.months[m] ? r.monthlyAmount : 0), 0);
      const exp = budgetPlan.expense.reduce((s, r) => s + (r.months[m] ? r.monthlyAmount : 0), 0);
      return { month: MONTH_NAMES_SHORT[m], netto: inc - exp };
    });
    return { totalIncome, totalExpense, totalNet: totalIncome - totalExpense, monthlyProjection };
  }, [budgetPlan]);

  const [newRowName, setNewRowName] = useState({ income: "", expense: "" });

  return (
    <div style={{ minHeight: "100vh", background: C.paper, color: C.ink, fontFamily: "'IBM Plex Sans', sans-serif" }}>
      <style>{fontImport}</style>

      <div className="flex flex-col md:flex-row" style={{ minHeight: "100vh" }}>
        {/* sidebar (desktop) */}
        <aside
          className="hidden md:flex flex-col justify-between"
          style={{ width: 216, background: C.pineDeep, padding: "24px 14px", flexShrink: 0 }}
        >
          <div>
            <div style={{ padding: "6px 10px 26px" }}>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 600, color: "#fff" }}>
                Overblik
              </div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: "rgba(255,255,255,0.45)", marginTop: 2, letterSpacing: 0.5 }}>
                PRIVATØKONOMI
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <NavItem icon={Home} label="Overblik" active={tab === "overblik"} onClick={() => setTab("overblik")} />
              <NavItem icon={ListTree} label="Budget" active={tab === "budget"} onClick={() => setTab("budget")} />
              <NavItem icon={FileText} label="Regninger" active={tab === "regninger"} onClick={() => setTab("regninger")} />
              <NavItem icon={Calendar} label={`Budget ${PLAN_YEAR}`} active={tab === "budgetplan"} onClick={() => setTab("budgetplan")} />
              <NavItem icon={Search} label="Transaktioner" active={tab === "transaktioner"} onClick={() => setTab("transaktioner")} />
              <NavItem icon={Wallet} label="Konti" active={tab === "konti"} onClick={() => setTab("konti")} />
            </div>
          </div>
          <NavItem icon={Settings} label="Indstillinger" active={false} onClick={() => {}} />
        </aside>

        {/* top tab bar (mobile) */}
        <nav
          className="flex md:hidden items-center gap-1.5 overflow-x-auto"
          style={{ background: C.pineDeep, padding: "12px 12px", flexShrink: 0, WebkitOverflowScrolling: "touch" }}
        >
          {[
            { id: "overblik", icon: Home, label: "Overblik" },
            { id: "budget", icon: ListTree, label: "Budget" },
            { id: "regninger", icon: FileText, label: "Regninger" },
            { id: "budgetplan", icon: Calendar, label: `Budget ${PLAN_YEAR}` },
            { id: "transaktioner", icon: Search, label: "Transaktioner" },
            { id: "konti", icon: Wallet, label: "Konti" },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className="flex items-center gap-1.5"
              style={{
                flexShrink: 0,
                fontFamily: "'IBM Plex Sans', sans-serif",
                fontSize: 12.5,
                fontWeight: 500,
                padding: "7px 12px",
                borderRadius: 999,
                background: tab === item.id ? "rgba(255,255,255,0.14)" : "transparent",
                color: tab === item.id ? "#fff" : "rgba(255,255,255,0.6)",
                whiteSpace: "nowrap",
              }}
            >
              <item.icon size={14} strokeWidth={2} />
              {item.label}
            </button>
          ))}
        </nav>

        {/* main */}
        <main className="flex-1 px-5 md:px-10 py-8 md:py-10" style={{ maxWidth: 1180 }}>
          <div className="flex items-baseline justify-between mb-3 flex-wrap gap-2">
            <div>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 26, fontWeight: 500, color: C.ink }}>
                Hej, {OWNER_NAME}
              </div>
              <div style={{ fontSize: 13, color: C.inkSoft, marginTop: 3 }}>
                3 konti forbundet · {period}
              </div>
            </div>
            <div className="text-right">
              <div style={{ fontSize: 11.5, color: C.inkSoft, textTransform: "uppercase", letterSpacing: 0.6 }}>
                Netto for perioden
              </div>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 26, fontWeight: 600, color: net >= 0 ? C.pine : C.rust }}>
                {net >= 0 ? "+" : ""}{kr(net)}
              </div>
            </div>
          </div>

          <div className="flex items-start gap-1.5 mb-8" style={{ fontSize: 11.5, color: C.inkSoft }}>
            <Info size={13} style={{ marginTop: 1.5, flexShrink: 0 }} />
            <span>
              Bygget på dine rigtige posteringer fra 3 konti (Lønkonto, Budgetkonto, Opsparing), forankret til de
              saldi du har opgivet. Overførsler mellem dine egne konti er talt fra, så Indbetalt/Betalt og
              budgetterne viser kun penge der reelt kommer ind eller ud af husholdningen. Budgetterne er forslag.
            </span>
          </div>

          {/* ---- OVERBLIK TAB ---- */}
          {tab === "overblik" && (
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              <Card className="lg:col-span-2 p-6 flex flex-col items-center">
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 500, alignSelf: "flex-start", marginBottom: 10 }}>
                  Budget for perioden
                </div>
                <Kompas categories={budgetCats} />
                <div style={{ fontSize: 12, color: C.inkSoft, marginTop: 14, textAlign: "center" }}>
                  Brugt {kr(budgetCats.reduce((s, c) => s + c.spent, 0))} af {kr(budgetCats.reduce((s, c) => s + c.budget, 0))} foreslået budget
                </div>
                <div className="w-full grid grid-cols-2 gap-3 mt-6 pt-5" style={{ borderTop: `1px solid ${C.hairline}` }}>
                  <div>
                    <div style={{ fontSize: 11, color: C.inkSoft, textTransform: "uppercase", letterSpacing: 0.4 }}>Indbetalt</div>
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 15, fontWeight: 600, color: C.mint }}>{kr(income)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: C.inkSoft, textTransform: "uppercase", letterSpacing: 0.4 }}>Betalt/hævet</div>
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 15, fontWeight: 600, color: C.ink }}>{kr(expense)}</div>
                  </div>
                </div>
              </Card>

              <Card className="lg:col-span-3 p-6">
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 500, marginBottom: 10 }}>
                  Forbrug pr. uge
                </div>
                <AreaChartMini
                  data={weeklySpend}
                  xKey="uge"
                  yKey="forbrug"
                  color={C.pine}
                  height={190}
                  hairline={C.hairline}
                  inkSoft={C.inkSoft}
                  formatValue={kr}
                />

                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 500, margin: "18px 0 6px" }}>
                  Kategorier
                </div>
                <div>
                  {budgetCats.map((c) => (
                    <CategoryRow key={c.id} c={c} active={activeCat === c.id} onClick={() => { setActiveCat(activeCat === c.id ? null : c.id); setTab("transaktioner"); }} />
                  ))}
                </div>
              </Card>

              <Card className="lg:col-span-5 p-6">
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 500, marginBottom: 2 }}>
                  Indtægter og udgifter ({DATA_YEAR})
                </div>
                <div style={{ fontSize: 11.5, color: C.inkSoft, marginBottom: 14 }}>
                  Summeret på tværs af dine 3 konti (kun eksterne bevægelser). Grøn = indtægter, orange = udgifter,
                  linjen viser nettoresultatet. Måneder uden importerede data vises som 0.
                </div>
                <ComboChartMini
                  data={monthlyNet}
                  xKey="month"
                  barPos="indtægter"
                  barPosColor={C.mint}
                  barNeg="udgifter"
                  barNegColor={C.spiirOrange}
                  lineKey="netto"
                  lineColor={C.ink}
                  height={240}
                  hairline={C.hairline}
                  inkSoft={C.inkSoft}
                  formatValue={kr}
                />
              </Card>
            </div>
          )}

          {/* ---- BUDGET TAB ---- */}
          {tab === "budget" && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {budgetCats.map((c) => {
                const pct = Math.min(100, Math.round((c.spent / c.budget) * 100));
                const over = c.spent > c.budget;
                const remaining = c.budget - c.spent;
                return (
                  <Card key={c.id} className="p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2.5">
                        <CatDot color={c.color} size={11} />
                        <span style={{ fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 500 }}>{c.name}</span>
                      </div>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, color: over ? C.rust : C.inkSoft }}>{pct}%</span>
                    </div>
                    <div style={{ height: 8, borderRadius: 5, background: "#EEF1EC", overflow: "hidden", marginBottom: 12 }}>
                      <div style={{ height: "100%", width: `${pct}%`, background: over ? C.rust : c.color, borderRadius: 5 }} />
                    </div>
                    <div className="flex justify-between" style={{ fontSize: 12.5, fontFamily: "'IBM Plex Mono', monospace" }}>
                      <span style={{ color: C.inkSoft }}>{kr(c.spent)} brugt</span>
                      <span style={{ color: over ? C.rust : C.mint, fontWeight: 600 }}>
                        {over ? `${kr(Math.abs(remaining))} over` : `${kr(remaining)} tilbage`}
                      </span>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {/* ---- REGNINGER (BILLS) TAB ---- */}
          {tab === "regninger" && (
            <div className="flex flex-col gap-5">
              <div className="flex items-start gap-1.5" style={{ fontSize: 11.5, color: C.inkSoft }}>
                <Info size={13} style={{ marginTop: 1.5, flexShrink: 0 }} />
                <span>
                  {billBudget.rows.length > 0
                    ? <>Budgettet er importeret fra din {BILLS_YEAR}-budget CSV. Faktisk forbrug er matchet til hver
                        post ud fra beskrivelsen i dine transaktioner — kun {MONTH_NAMES_SHORT[Math.max(0, LAST_BILLS_MONTH_IDX)]} og
                        tidligere måneder har rigtige data; resten af året vises gråt.</>
                    : "Importer din årsbudget-CSV (samme format som Spiirs eksport: linjenavn;jan;feb;...;dec;i alt) for at se budget mod faktisk forbrug her."}
                </span>
              </div>

              <Card className="p-5">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div style={{ fontFamily: "'Fraunces', serif", fontSize: 14, fontWeight: 500 }}>
                    {billBudget.rows.length > 0 ? `Budget for ${BILLS_YEAR} importeret (${billBudget.rows.length} linjer)` : "Intet budget importeret endnu"}
                  </div>
                  <label
                    style={{
                      fontSize: 12.5, fontWeight: 500, color: "#fff", background: C.pine,
                      borderRadius: 8, padding: "7px 14px", cursor: "pointer",
                    }}
                  >
                    Importer budget CSV
                    <input
                      type="file"
                      accept=".csv,text/csv"
                      style={{ display: "none" }}
                      onChange={(e) => {
                        if (e.target.files[0]) importBillBudgetFile(e.target.files[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
              </Card>

              {billBudget.rows.length > 0 && (
                <Card className="p-6">
                  {billBudget.rows.map((row) => (
                    <BillRow
                      key={row.name}
                      name={row.name}
                      budgetMonths={row.months}
                      actualMonths={BILL_ACTUALS[row.name] || new Array(12).fill(0)}
                      unmatched={!BILL_MATCHERS.some((m) => m.name === row.name)}
                      billsYear={BILLS_YEAR}
                      lastBillsMonthIdx={LAST_BILLS_MONTH_IDX}
                    />
                  ))}
                </Card>
              )}
            </div>
          )}

          {/* ---- TRANSAKTIONER TAB ---- */}
          {tab === "transaktioner" && (
            <Card className="p-2">
              <div className="flex items-center justify-between px-4 pt-4 pb-1 flex-wrap gap-2">
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 500 }}>
                  {activeCat ? `Transaktioner — ${catById[activeCat]?.name}` : "Alle transaktioner"}
                </div>
                {activeCat && (
                  <button
                    onClick={() => setActiveCat(null)}
                    style={{ fontSize: 12.5, color: C.denim, fontFamily: "'IBM Plex Sans', sans-serif" }}
                  >
                    Ryd filter ×
                  </button>
                )}
              </div>
              {Object.keys(overrides).length > 0 && (
                <div className="flex items-center justify-between px-4 pb-2" style={{ fontSize: 11, color: C.inkSoft }}>
                  <span>{Object.keys(overrides).length} kategori-ændring(er) gemt</span>
                  <button
                    onClick={resetOverrides}
                    style={{ fontSize: 11, color: C.denim, fontFamily: "'IBM Plex Sans', sans-serif" }}
                  >
                    Nulstil kategorier
                  </button>
                </div>
              )}
              <div className="flex items-center gap-1.5 px-4 pb-3 flex-wrap">
                {[{ id: "alle", name: "Alle konti" }, ...accounts].map((a) => (
                  <button
                    key={a.id}
                    onClick={() => setAccountFilter(a.id)}
                    style={{
                      fontFamily: "'IBM Plex Sans', sans-serif",
                      fontSize: 12,
                      fontWeight: 500,
                      padding: "5px 11px",
                      borderRadius: 999,
                      border: `1px solid ${accountFilter === a.id ? C.pine : C.hairline}`,
                      background: accountFilter === a.id ? C.pine : "transparent",
                      color: accountFilter === a.id ? "#fff" : C.inkSoft,
                    }}
                  >
                    {a.name}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1.5 px-4 pb-3 flex-wrap">
                <button
                  onClick={() => setActiveCat(null)}
                  style={{
                    fontFamily: "'IBM Plex Sans', sans-serif",
                    fontSize: 12,
                    fontWeight: 500,
                    padding: "5px 11px",
                    borderRadius: 999,
                    border: `1px solid ${!activeCat ? C.pine : C.hairline}`,
                    background: !activeCat ? C.pine : "transparent",
                    color: !activeCat ? "#fff" : C.inkSoft,
                  }}
                >
                  Alle kategorier
                </button>
                <button
                  onClick={() => setActiveCat("ignorer")}
                  style={{
                    fontFamily: "'IBM Plex Sans', sans-serif",
                    fontSize: 12,
                    fontWeight: 500,
                    padding: "5px 11px",
                    borderRadius: 999,
                    border: `1px solid ${activeCat === "ignorer" ? C.rust : C.hairline}`,
                    background: activeCat === "ignorer" ? C.rust : "transparent",
                    color: activeCat === "ignorer" ? "#fff" : C.inkSoft,
                  }}
                >
                  Ignoreret ({ignoredTx.length})
                </button>
              </div>
              <div>
                {pagedTx.map((t) => {
                  const cat = catById[t.cat];
                  const isIncome = t.amount > 0;
                  return (
                    <div
                      key={t.id}
                      className="flex items-center justify-between px-4 py-3"
                      style={{ borderTop: `1px solid ${C.hairline}`, opacity: t.cat === "ignorer" ? 0.55 : 1 }}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          style={{
                            width: 34, height: 34, borderRadius: 10, flexShrink: 0,
                            background: isIncome ? "#E9F3EC" : "#F3F4F1",
                            display: "flex", alignItems: "center", justifyContent: "center",
                          }}
                        >
                          {isIncome
                            ? <ArrowUpRight size={16} color={C.mint} />
                            : <ArrowDownRight size={16} color={C.inkSoft} />}
                        </div>
                        <div className="min-w-0">
                          <div style={{ fontSize: 13.5, fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {t.desc}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                            {cat && <CatDot color={cat.color} size={6} />}
                            <select
                              value={t.cat}
                              onChange={(e) =>
                                setOverrides((o) => ({ ...o, [t.id]: e.target.value }))
                              }
                              style={{
                                fontFamily: "'IBM Plex Sans', sans-serif",
                                fontSize: 11.5,
                                color: cat?.id === "ignorer" ? C.rust : C.inkSoft,
                                background: "transparent",
                                border: "none",
                                padding: 0,
                                margin: 0,
                                cursor: "pointer",
                                maxWidth: 150,
                              }}
                            >
                              {CAT_GROUPS.map((g) => (
                                <optgroup key={g.group} label={g.label}>
                                  {CATS.filter((c) => c.group === g.group).map((c) => (
                                    <option key={c.id} value={c.id}>{c.name}</option>
                                  ))}
                                </optgroup>
                              ))}
                            </select>
                            <span style={{ fontSize: 11.5, color: C.inkSoft }}>
                              · {dfMonth.format(t.date)} · {t.accountName}
                              {t.isInternal ? " · intern" : ""}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 12 }}>
                        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13.5, fontWeight: 600, color: isIncome ? C.mint : C.ink }}>
                          {isIncome ? "+" : ""}{kr(t.amount)}
                        </div>
                        {accountFilter !== "alle" && (
                          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: C.inkSoft, marginTop: 1 }}>
                            {krDec(t.balanceAfter)}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {visibleTx.length > 0 && (
                <div className="flex items-center justify-between px-4 py-3 flex-wrap gap-2" style={{ borderTop: `1px solid ${C.hairline}` }}>
                  <span style={{ fontSize: 11.5, color: C.inkSoft }}>
                    Viser {txPage * TX_PAGE_SIZE + 1}–{Math.min(visibleTx.length, (txPage + 1) * TX_PAGE_SIZE)} af {visibleTx.length}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setTxPage((p) => Math.max(0, p - 1))}
                      disabled={txPage === 0}
                      style={{
                        fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, fontWeight: 500,
                        padding: "6px 12px", borderRadius: 8, border: `1px solid ${C.hairline}`,
                        color: txPage === 0 ? "#C7CDC5" : C.ink, background: "transparent",
                      }}
                    >
                      Forrige
                    </button>
                    <span style={{ fontSize: 12, color: C.inkSoft, fontFamily: "'IBM Plex Mono', monospace" }}>
                      {txPage + 1} / {txPageCount}
                    </span>
                    <button
                      onClick={() => setTxPage((p) => Math.min(txPageCount - 1, p + 1))}
                      disabled={txPage >= txPageCount - 1}
                      style={{
                        fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, fontWeight: 500,
                        padding: "6px 12px", borderRadius: 8, border: `1px solid ${C.hairline}`,
                        color: txPage >= txPageCount - 1 ? "#C7CDC5" : C.ink, background: "transparent",
                      }}
                    >
                      Næste
                    </button>
                  </div>
                </div>
              )}
            </Card>
          )}

          {/* ---- KONTI TAB ---- */}
          {tab === "konti" && (
            <div className="flex flex-col gap-5">
              {importMessage && (
                <div style={{ fontSize: 12.5, color: C.pine, background: "#E9F3EC", borderRadius: 8, padding: "10px 14px" }}>
                  {importMessage}
                </div>
              )}

              {accounts.length > 0 && (
                <Card className="p-6">
                  <div style={{ fontSize: 11.5, color: C.inkSoft, textTransform: "uppercase", letterSpacing: 0.5 }}>
                    Samlet formue nu
                  </div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 30, fontWeight: 600, color: C.pine, marginTop: 4 }}>
                    {krDec(accounts.reduce((s, a) => s + (a.currentBalance || 0), 0))}
                  </div>
                  <div style={{ fontSize: 11, color: C.inkSoft, marginTop: 4 }}>
                    Netto for perioden: <span style={{ color: net >= 0 ? C.pine : C.rust, fontWeight: 600 }}>{net >= 0 ? "+" : ""}{kr(net)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-4 mt-5">
                    <div>
                      <div style={{ fontSize: 11, color: C.inkSoft, textTransform: "uppercase", letterSpacing: 0.4 }}>Indbetalt (eksternt)</div>
                      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 16, fontWeight: 600, color: C.mint }}>{kr(income)}</div>
                    </div>
                    <div>
                      <div style={{ fontSize: 11, color: C.inkSoft, textTransform: "uppercase", letterSpacing: 0.4 }}>Betalt/hævet (eksternt)</div>
                      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 16, fontWeight: 600, color: C.ink }}>{kr(expense)}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: C.inkSoft, marginTop: 10 }}>
                    Overførsler mellem dine egne konti tæller ikke som ind/ud — kun rigtige eksterne bevægelser.
                  </div>
                </Card>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
                {accountStats.map((a) => (
                  <Card key={a.id} className="p-5">
                    <div className="flex items-center justify-between mb-4">
                      <div
                        style={{
                          width: 34, height: 34, borderRadius: 10, background: C.pineDeep,
                          display: "flex", alignItems: "center", justifyContent: "center",
                        }}
                      >
                        <Wallet size={16} color="#fff" />
                      </div>
                      <button onClick={() => removeAccount(a.id)} style={{ color: C.inkSoft, padding: 2 }} aria-label={`Fjern ${a.name}`}>
                        <X size={15} />
                      </button>
                    </div>
                    <div style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 500 }}>{a.name}</div>
                    <div style={{ fontSize: 11.5, color: C.inkSoft, marginBottom: 12 }}>{maskAccount(a.raw)} · {a.count} posteringer</div>

                    <div style={{ fontSize: 11, color: C.inkSoft, textTransform: "uppercase", letterSpacing: 0.4 }}>Saldo nu</div>
                    <input
                      type="number"
                      value={a.currentBalance}
                      onChange={(e) => updateAccountBalance(a.id, e.target.value)}
                      style={{
                        width: "100%", fontFamily: "'IBM Plex Mono', monospace", fontSize: 20, fontWeight: 600, color: C.ink,
                        border: `1px solid ${C.hairline}`, borderRadius: 8, padding: "4px 8px", marginTop: 2, marginBottom: 4,
                      }}
                    />
                    <div style={{ fontSize: 10.5, color: C.inkSoft, marginBottom: 10 }}>
                      Opdatér denne, når du importerer nyere posteringer, så saldoen matcher banken.
                    </div>

                    <div className="flex justify-between pt-3 mb-3" style={{ borderTop: `1px solid ${C.hairline}`, fontSize: 11.5, fontFamily: "'IBM Plex Mono', monospace" }}>
                      <span style={{ color: C.mint }}>+{kr(a.income)}</span>
                      <span style={{ color: C.inkSoft }}>-{kr(a.expense)}</span>
                    </div>

                    <label
                      className="flex items-center justify-center"
                      style={{
                        fontSize: 12.5, fontWeight: 500, color: "#fff", background: C.pine,
                        borderRadius: 8, padding: "8px 10px", cursor: "pointer",
                      }}
                    >
                      Importer CSV
                      <input
                        type="file"
                        accept=".csv,text/csv"
                        style={{ display: "none" }}
                        onChange={(e) => {
                          if (e.target.files[0]) importFileToAccount(a.id, e.target.files[0]);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </Card>
                ))}

                <AddAccountCard onAdd={addAccount} />
              </div>

              {accounts.length === 0 && (
                <div style={{ fontSize: 13, color: C.inkSoft, textAlign: "center", padding: "24px 0" }}>
                  Tilføj din første konto ovenfor for at komme i gang — så kan du importere en CSV-fil fra din bank.
                </div>
              )}
            </div>
          )}

          {/* ---- BUDGETPLAN (NEXT YEAR) TAB ---- */}
          {tab === "budgetplan" && budgetPlan && planTotals && (
            <div className="flex flex-col gap-5">
              <div className="flex items-start gap-1.5" style={{ fontSize: 11.5, color: C.inkSoft }}>
                <Info size={13} style={{ marginTop: 1.5, flexShrink: 0 }} />
                <span>
                  Startbeløbene er sat til gennemsnittet fra dine importerede måneder ({monthsWithDataCount} mdr.),
                  hvor der findes en tilsvarende kategori. Ret beløb og afkryds hvilke måneder posten forekommer i —
                  ikke afkrydset = 0 kr. den måned.
                </span>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <Card className="p-5">
                  <div style={{ fontSize: 11, color: C.inkSoft, textTransform: "uppercase", letterSpacing: 0.4 }}>Indtægter {PLAN_YEAR}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 22, fontWeight: 600, color: C.mint }}>{kr(planTotals.totalIncome)}</div>
                </Card>
                <Card className="p-5">
                  <div style={{ fontSize: 11, color: C.inkSoft, textTransform: "uppercase", letterSpacing: 0.4 }}>Udgifter {PLAN_YEAR}</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 22, fontWeight: 600, color: C.ink }}>{kr(planTotals.totalExpense)}</div>
                </Card>
                <Card className="p-5">
                  <div style={{ fontSize: 11, color: C.inkSoft, textTransform: "uppercase", letterSpacing: 0.4 }}>Budgetteret netto</div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 22, fontWeight: 600, color: planTotals.totalNet >= 0 ? C.pine : C.rust }}>
                    {planTotals.totalNet >= 0 ? "+" : ""}{kr(planTotals.totalNet)}
                  </div>
                </Card>
              </div>

              <Card className="p-6">
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 500, marginBottom: 2 }}>
                  Forventet netto pr. måned ({PLAN_YEAR})
                </div>
                <div style={{ fontSize: 11.5, color: C.inkSoft, marginBottom: 14 }}>
                  Baseret på beløb og afkrydsede måneder nedenfor.
                </div>
                <LineChartMini
                  data={planTotals.monthlyProjection}
                  xKey="month"
                  yKey="netto"
                  color={C.pine}
                  height={200}
                  hairline={C.hairline}
                  inkSoft={C.inkSoft}
                  formatValue={kr}
                />
              </Card>

              <Card className="p-6">
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
                  Indtægter
                </div>
                {budgetPlan.income.map((row) => (
                  <PlanRow
                    key={row.id}
                    row={row}
                    kind="income"
                    suggestion={catAverage(row.mapTo, "income")}
                    monthsWithDataCount={monthsWithDataCount}
                    onAmountChange={(v) => updatePlanAmount("income", row.id, v)}
                    onToggleMonth={(i) => togglePlanMonth("income", row.id, i)}
                    onApplySuggestion={() => applyPlanSuggestion("income", row.id)}
                    onRemove={() => removePlanRow("income", row.id)}
                  />
                ))}
                <div className="flex items-center gap-2 mt-3 pt-3" style={{ borderTop: `1px solid ${C.hairline}` }}>
                  <input
                    type="text"
                    placeholder="Ny indtægtskategori…"
                    value={newRowName.income}
                    onChange={(e) => setNewRowName((n) => ({ ...n, income: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        addPlanRow("income", newRowName.income);
                        setNewRowName((n) => ({ ...n, income: "" }));
                      }
                    }}
                    style={{
                      flex: 1, fontSize: 13, fontFamily: "'IBM Plex Sans', sans-serif",
                      border: `1px solid ${C.hairline}`, borderRadius: 6, padding: "6px 9px", background: C.paper,
                    }}
                  />
                  <button
                    onClick={() => { addPlanRow("income", newRowName.income); setNewRowName((n) => ({ ...n, income: "" })); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 500,
                      color: "#fff", background: C.pine, borderRadius: 6, padding: "6px 10px",
                    }}
                  >
                    <Plus size={14} /> Tilføj
                  </button>
                </div>
              </Card>

              <Card className="p-6">
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
                  Udgifter
                </div>
                {budgetPlan.expense.map((row) => (
                  <PlanRow
                    key={row.id}
                    row={row}
                    kind="expense"
                    suggestion={catAverage(row.mapTo, "expense")}
                    monthsWithDataCount={monthsWithDataCount}
                    onAmountChange={(v) => updatePlanAmount("expense", row.id, v)}
                    onToggleMonth={(i) => togglePlanMonth("expense", row.id, i)}
                    onApplySuggestion={() => applyPlanSuggestion("expense", row.id)}
                    onRemove={() => removePlanRow("expense", row.id)}
                  />
                ))}
                <div className="flex items-center gap-2 mt-3 pt-3" style={{ borderTop: `1px solid ${C.hairline}` }}>
                  <input
                    type="text"
                    placeholder="Ny udgiftskategori…"
                    value={newRowName.expense}
                    onChange={(e) => setNewRowName((n) => ({ ...n, expense: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        addPlanRow("expense", newRowName.expense);
                        setNewRowName((n) => ({ ...n, expense: "" }));
                      }
                    }}
                    style={{
                      flex: 1, fontSize: 13, fontFamily: "'IBM Plex Sans', sans-serif",
                      border: `1px solid ${C.hairline}`, borderRadius: 6, padding: "6px 9px", background: C.paper,
                    }}
                  />
                  <button
                    onClick={() => { addPlanRow("expense", newRowName.expense); setNewRowName((n) => ({ ...n, expense: "" })); }}
                    style={{
                      display: "flex", alignItems: "center", gap: 4, fontSize: 12.5, fontWeight: 500,
                      color: "#fff", background: C.pine, borderRadius: 6, padding: "6px 10px",
                    }}
                  >
                    <Plus size={14} /> Tilføj
                  </button>
                </div>
              </Card>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
