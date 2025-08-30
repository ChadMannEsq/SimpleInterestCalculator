import React, { useMemo, useState, useEffect } from "react";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
// IMPORTANT: Place a copy of the CV93 PDF in the SAME FOLDER as this file, named exactly `CV93.pdf`.
// The bundler will emit a public URL we can fetch at runtime.
// Vite/CRA support importing static assets like this:
//   src/components/InterestCalculator.jsx
//   src/components/CV93.pdf   <-- put the file here
import cv93TemplateUrl from "./CV93.pdf";

// ========================= Helpers =========================
function currency(n) {
  if (n == null || isNaN(n)) return "";
  return Number(n).toLocaleString(undefined, { style: "currency", currency: "USD" });
}
function parseMoney(str) {
  if (str === undefined || str === null || str === "") return NaN;
  const cleaned = String(str).replace(/[^0-9.\-]/g, "");
  const v = Number(cleaned);
  return Number.isFinite(v) ? v : NaN;
}
function daysBetween(d1, d2) {
  if (!d1 || !d2) return 0;
  const a = new Date(d1);
  const b = new Date(d2);
  const aUTC = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const bUTC = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((bUTC - aUTC) / (1000 * 60 * 60 * 24));
}
function fmtDateISO(d) {
  if (!d) return "";
  const x = new Date(d);
  const yyyy = x.getFullYear();
  const mm = String(x.getMonth() + 1).padStart(2, "0");
  const dd = String(x.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function fixed(n) { return Number.isFinite(n) ? Number(n).toFixed(2) : ""; }
function money(n) { return Number.isFinite(n) ? Number(n).toFixed(2) : ""; }
function toNumber(str) { const n = parseMoney(str); return Number.isFinite(n) ? n : 0; }
function escapeCsv(val) {
  if (val == null) return "";
  const s = String(val);
  // Quote the field if it contains a comma, quote, or newline
  if (/[",\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}
const blankRow = (type = "payment") => ({ id: crypto.randomUUID(), date: "", type, amount: "", note: "", source: "direct" });

// ========================= Component =========================
export default function InterestCalculator() {
  // Calculator core
  const [caseName, setCaseName] = useState("");
  const [debtor, setDebtor] = useState("");
  const [principalStart, setPrincipalStart] = useState("");
  const [startDate, setStartDate] = useState("");
  const [annualRatePct, setAnnualRatePct] = useState("9.000");
  const [basis, setBasis] = useState(365);
  const [asOfDate, setAsOfDate] = useState("");
  const [rows, setRows] = useState([blankRow("payment")]);

  // CV93-specific state
  const [court, setCourt] = useState({ circuit: "", county: "", judgeDivision: "", caseNumber: "", garnishmentNumber: "" });
  const [parties, setParties] = useState({ petitioner: "", respondent: "", debtorBlock: "", creditorBlock: "", garnisheeBlock: "" });
  const [period, setPeriod] = useState({ fromISO: "", thruISO: "" });
  const [cv92Baseline, setCv92Baseline] = useState(""); // Page 2 line 9
  const [increases, setIncreases] = useState({ interestRatePct: "", postJudgmentInterest: "", postJudgmentCosts: "", otherIncreasesNote: "", otherIncreasesAmount: "" });
  const [carryForwards, setCarryForwards] = useState({ garnisheePriorTotal: "", directPriorTotal: "" }); // Page 1 line 3 & 6
  const [signer, setSigner] = useState({ name: "", dateISO: "" });

  // Auto-add new blank row once last row has both date & amount
  useEffect(() => {
    const last = rows[rows.length - 1];
    const amt = parseMoney(last?.amount);
    if (last?.date && Number.isFinite(amt)) setRows((r) => [...r, blankRow("payment")]);
  }, [rows]);

  const dailyRate = useMemo(() => {
    const a = Number(annualRatePct);
    const b = Number(basis);
    return Number.isFinite(a) && Number.isFinite(b) && b > 0 ? a / 100 / b : 0;
  }, [annualRatePct, basis]);

  // Build computed schedule
  const schedule = useMemo(() => {
    const events = rows
      .map((r) => ({ ...r, amountNum: parseMoney(r.amount) }))
      .filter((r) => r.date && Number.isFinite(r.amountNum) && r.amountNum !== 0);
    events.sort((a, b) => {
      const d = new Date(a.date) - new Date(b.date);
      if (d !== 0) return d;
      return a.type === b.type ? 0 : a.type === "expense" ? -1 : 1;
    });

    const out = [];
    const p0 = parseMoney(principalStart);
    const hasStart = Number.isFinite(p0) && p0 > 0 && startDate;
    let principal = hasStart ? p0 : 0;
    let carryInterest = 0;
    let lastDate = hasStart ? startDate : null;
    if (!hasStart) return { rows: [], totals: { principal: 0, carryInterest: 0, balance: 0 } };

    for (const ev of events) {
      const days = lastDate ? Math.max(0, daysBetween(lastDate, ev.date)) : 0;
      const accrued = principal * dailyRate * days;
      carryInterest += accrued;

      let appliedToInterest = 0, appliedToPrincipal = 0, principalBefore = principal;
      if (ev.type === "expense") {
        principal += ev.amountNum;
      } else if (ev.type === "payment") {
        appliedToInterest = Math.min(ev.amountNum, carryInterest);
        carryInterest -= appliedToInterest;
        appliedToPrincipal = Math.max(0, ev.amountNum - appliedToInterest);
        principal = Math.max(0, principal - appliedToPrincipal);
      }
      out.push({
        date: ev.date,
        type: ev.type,
        source: ev.source,
        note: ev.note || "",
        days,
        accrued,
        payment: ev.type === "payment" ? ev.amountNum : 0,
        expense: ev.type === "expense" ? ev.amountNum : 0,
        appliedToInterest,
        appliedToPrincipal,
        principalBefore,
        principalAfter: principal,
        carryInterest,
      });
      lastDate = ev.date;
    }

    if (asOfDate && lastDate) {
      const extraDays = Math.max(0, daysBetween(lastDate, asOfDate));
      if (extraDays > 0) {
        const accrued = principal * dailyRate * extraDays;
        carryInterest += accrued;
        out.push({ date: asOfDate, type: "asof", source: "", note: "As-of accrual", days: extraDays, accrued, payment: 0, expense: 0, appliedToInterest: 0, appliedToPrincipal: 0, principalBefore: principal, principalAfter: principal, carryInterest });
      }
    }

    return { rows: out, totals: { principal, carryInterest, balance: principal + carryInterest } };
  }, [rows, principalStart, startDate, dailyRate, asOfDate]);

  function updateRow(id, patch) { setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r))); }
  function clearAll() { setRows([blankRow("payment")]); }

  // ========================= CSV Export =========================
  function exportCSV() {
    const headers = ["Date","Type","Source","Note","Days","Accrued Interest","Payment","Expense","Applied to Interest","Applied to Principal","Principal Before","Principal After","Unpaid Interest (Carryover)"];
    const lines = [headers.join(",")];
    for (const r of schedule.rows) {
      lines.push([r.date,r.type,r.source||"",escapeCsv(r.note||""),r.days,fixed(r.accrued),fixed(r.payment),fixed(r.expense),fixed(r.appliedToInterest),fixed(r.appliedToPrincipal),fixed(r.principalBefore),fixed(r.principalAfter),fixed(r.carryInterest)].join(","));
    }
    lines.push("");
    lines.push(["Totals as of", asOfDate || (schedule.rows.at(-1)?.date || startDate), "", "", "", "", "", "", "", "", fixed(schedule.totals.principal), fixed(schedule.totals.carryInterest), fixed(schedule.totals.balance)].join(","));
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeCase = caseName ? caseName.replace(/[^a-z0-9\-_. ]/gi, "_") : "schedule";
    a.href = url; a.download = `${safeCase}_simple_interest_schedule.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }

  // ========================= CV93 Export =========================
  function buildCv93Payload() {
    const inWindow = (d) => (!period.fromISO || daysBetween(period.fromISO, d) >= 0) && (!period.thruISO || daysBetween(d, period.thruISO) >= 0);
    const payments = rows
      .map((r) => ({ date: r.date, amount: parseMoney(r.amount), type: r.type, source: r.source }))
      .filter((r) => r.type === "payment" && r.date && Number.isFinite(r.amount) && inWindow(r.date))
      .map((r) => ({ date: fmtDateISO(r.date), amount: r.amount, source: r.source }));
    return {
      court,
      parties,
      period,
      cv92Baseline: toNumber(cv92Baseline),
      increases: {
        interestRatePct: increases.interestRatePct || annualRatePct,
        postJudgmentInterest: toNumber(increases.postJudgmentInterest),
        postJudgmentCosts: toNumber(increases.postJudgmentCosts),
        otherIncreasesNote: increases.otherIncreasesNote,
        otherIncreasesAmount: toNumber(increases.otherIncreasesAmount),
      },
      payments,
      carryForwards,
      signer: { name: signer.name, dateISO: signer.dateISO || period.thruISO || fmtDateISO(new Date().toISOString()) },
    };
  }

  async function exportCV93() {
    const payload = buildCv93Payload();
    const ab = await fetch(cv93TemplateUrl).then((r) => r.arrayBuffer()); // <-- same-folder asset
    const pdf = await PDFDocument.load(ab);
    const font = await pdf.embedFont(StandardFonts.Helvetica);

    const page1 = pdf.getPage(0);
    const page2 = pdf.getPage(1);
    const draw = (page, text, x, y, size = 10) => page.drawText(String(text ?? ""), { x, y, size, font, color: rgb(0, 0, 0) });
    const drawBlock = (page, text, x, yStart, lineH = 12) => String(text || "").split("
").forEach((ln, i) => draw(page, ln, x, yStart - i * lineH));

    const garn = payload.payments.filter((p) => p.source === "garnishee");
    const direct = payload.payments.filter((p) => p.source === "direct");
    const garnPrior = toNumber(payload.carryForwards.garnisheePriorTotal);
    const directPrior = toNumber(payload.carryForwards.directPriorTotal);
    const garnTotal = garnPrior + garn.reduce((s, p) => s + p.amount, 0);
    const directTotal = directPrior + direct.reduce((s, p) => s + p.amount, 0);

    // ------- PAGE 1 (coordinates tuned generically; tweak once for your exact PDF) -------
    draw(page1, payload.court.circuit, 110, 740);
    draw(page1, payload.court.county, 390, 740);
    draw(page1, payload.court.judgeDivision, 80, 706);
    draw(page1, payload.court.caseNumber, 390, 706);
    draw(page1, payload.parties.petitioner, 80, 690);
    draw(page1, payload.parties.respondent, 80, 672);
    draw(page1, payload.court.garnishmentNumber, 390, 690);

    drawBlock(page1, payload.parties.debtorBlock, 24, 615);
    drawBlock(page1, payload.parties.creditorBlock, 290, 615);
    drawBlock(page1, payload.parties.garnisheeBlock, 24, 560);

    draw(page1, payload.period.fromISO, 160, 522);
    draw(page1, payload.period.thruISO, 160, 500);

    // Line 3 (prior garnishee total)
    draw(page1, `$${money(garnPrior)}`, 520, 475);

    // Line 4 (garnishee payments within window)
    let y = 420;
    garn.slice(0, 9).forEach((p) => { draw(page1, p.date, 120, y); draw(page1, `$${money(p.amount)}`, 520, y); y -= 18; });

    // Line 5 (sum garnishee: prior + current)
    draw(page1, `$${money(garnTotal)}`, 520, 245);

    // Line 6 (prior direct total)
    draw(page1, `$${money(directPrior)}`, 520, 210);

    // Line 7 (direct payments within window)
    y = 160;
    direct.slice(0, 6).forEach((p) => { draw(page1, p.date, 120, y); draw(page1, `$${money(p.amount)}`, 520, y); y -= 18; });

    // Line 8 (sum direct: prior + current)
    draw(page1, `$${money(directTotal)}`, 520, 50);

    // ------- PAGE 2 -------
    // Line 9 – CV92 baseline
    draw(page2, `$${money(payload.cv92Baseline)}`, 520, 705);

    // Lines 10–12 and 13
    draw(page2, `(${payload.increases.interestRatePct}%)`, 250, 668); // parenthetical interest rate
    draw(page2, `$${money(payload.increases.postJudgmentInterest)}`, 520, 668);
    draw(page2, `$${money(payload.increases.postJudgmentCosts)}`, 520, 640);
    if (payload.increases.otherIncreasesNote) draw(page2, payload.increases.otherIncreasesNote, 250, 612);
    draw(page2, `$${money(payload.increases.otherIncreasesAmount)}`, 520, 612);
    const line13 = payload.increases.postJudgmentInterest + payload.increases.postJudgmentCosts + payload.increases.otherIncreasesAmount;
    draw(page2, `$${money(line13)}`, 520, 585);

    // Line 14 – Direct payments total (decrease)
    draw(page2, `($${money(directTotal)})`, 520, 536);

    // Line 15
    const line15 = payload.cv92Baseline + line13 - directTotal;
    draw(page2, `$${money(line15)}`, 520, 510);

    // Line 16 – Garnishee payments total (decrease)
    draw(page2, `($${money(garnTotal)})`, 520, 482);

    // Line 17 – Unsatisfied balance remaining due
    const line17 = line15 - garnTotal;
    draw(page2, `$${money(line17)}`, 520, 455);

    // Signature/date block
    draw(page2, payload.signer.dateISO, 60, 360);
    draw(page2, payload.signer.name, 300, 360);

    // OPTIONAL: add attachment page(s) for overflow beyond visible rows on Page 1
    // const attach = pdf.addPage();
    // draw(attach, "Attachment A – Payments (continued)", 50, attach.getHeight() - 50, 12);
    // ...list remaining payments here...

    const bytes = await pdf.save();
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `CV93_${payload.court.caseNumber || "case"}.pdf`; a.click();
    URL.revokeObjectURL(url);
  }

  // ========================= UI =========================
  const headerSummary = useMemo(() => {
    const p0 = parseMoney(principalStart);
    return { principalValid: Number.isFinite(p0) && p0 >= 0, startValid: !!startDate };
  }, [principalStart, startDate]);

  return (
    <div className="min-h-screen w-full bg-gray-50 text-gray-800 p-6">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left panel: calculator & CV93 inputs */}
        <div className="lg:col-span-1 space-y-4">
          <div className="rounded-2xl shadow-sm bg-white p-5">
            <h1 className="text-2xl font-semibold mb-1">Simple Interest Calculator</h1>
            <p className="text-sm text-gray-500">Payments, expenses, daily simple interest, and CV93 export.</p>
          </div>

          {/* Core calculator inputs */}
          <div className="rounded-2xl shadow-sm bg-white p-5 space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Case name / file #</label>
              <input value={caseName} onChange={(e) => setCaseName(e.target.value)} className="w-full rounded-xl border p-2" placeholder="e.g., Mann v. Debtor" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Debtor</label>
              <input value={debtor} onChange={(e) => setDebtor(e.target.value)} className="w-full rounded-xl border p-2" placeholder="e.g., John Doe" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Starting principal</label>
                <input value={principalStart} onChange={(e) => setPrincipalStart(e.target.value)} className="w-full rounded-xl border p-2" placeholder="$10,000.00" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Start date</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded-xl border p-2" />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-4 items-end">
              <div className="col-span-2">
                <label className="block text-sm font-medium mb-1">Annual interest rate (%)</label>
                <input value={annualRatePct} onChange={(e) => setAnnualRatePct(e.target.value)} className="w-full rounded-xl border p-2" placeholder="9.000" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Day count</label>
                <select value={basis} onChange={(e) => setBasis(Number(e.target.value))} className="w-full rounded-xl border p-2">
                  <option value={365}>Actual/365</option>
                  <option value={360}>Banker’s/360</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">As-of date (preview)</label>
                <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="w-full rounded-xl border p-2" />
              </div>
              <div className="flex gap-3 items-end">
                <button onClick={exportCSV} className="mt-6 px-4 py-2 rounded-xl bg-gray-900 text-white shadow-sm">Export CSV</button>
                <button onClick={clearAll} className="mt-6 px-4 py-2 rounded-xl border shadow-sm">Clear rows</button>
              </div>
            </div>
          </div>

          {/* CV93 inputs */}
          <div className="rounded-2xl shadow-sm bg-white p-5 space-y-4">
            <h2 className="text-lg font-semibold">CV93 – Court & Case</h2>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-sm font-medium mb-1">Judicial Circuit</label><input className="w-full rounded-xl border p-2" value={court.circuit} onChange={(e)=>setCourt({...court,circuit:e.target.value})} /></div>
              <div><label className="block text-sm font-medium mb-1">County</label><input className="w-full rounded-xl border p-2" value={court.county} onChange={(e)=>setCourt({...court,county:e.target.value})} /></div>
              <div><label className="block text-sm font-medium mb-1">Judge/Division</label><input className="w-full rounded-xl border p-2" value={court.judgeDivision} onChange={(e)=>setCourt({...court,judgeDivision:e.target.value})} /></div>
              <div><label className="block text-sm font-medium mb-1">Case No.</label><input className="w-full rounded-xl border p-2" value={court.caseNumber} onChange={(e)=>setCourt({...court,caseNumber:e.target.value})} /></div>
              <div><label className="block text-sm font-medium mb-1">Garnishment No.</label><input className="w-full rounded-xl border p-2" value={court.garnishmentNumber} onChange={(e)=>setCourt({...court,garnishmentNumber:e.target.value})} /></div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-sm font-medium mb-1">Petitioner(s)</label><input className="w-full rounded-xl border p-2" value={parties.petitioner} onChange={(e)=>setParties({...parties,petitioner:e.target.value})} /></div>
              <div><label className="block text-sm font-medium mb-1">Respondent(s)</label><input className="w-full rounded-xl border p-2" value={parties.respondent} onChange={(e)=>setParties({...parties,respondent:e.target.value})} /></div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div><label className="block text-sm font-medium mb-1">Debtor (name + address)</label><textarea className="w-full rounded-xl border p-2" rows={3} value={parties.debtorBlock} onChange={(e)=>setParties({...parties,debtorBlock:e.target.value})} /></div>
              <div><label className="block text-sm font-medium mb-1">Creditor (name + address + phone)</label><textarea className="w-full rounded-xl border p-2" rows={3} value={parties.creditorBlock} onChange={(e)=>setParties({...parties,creditorBlock:e.target.value})} /></div>
              <div><label className="block text-sm font-medium mb-1">Garnishee (name + address)</label><textarea className="w-full rounded-xl border p-2" rows={3} value={parties.garnisheeBlock} onChange={(e)=>setParties({...parties,garnisheeBlock:e.target.value})} /></div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-sm font-medium mb-1">Reporting from</label><input type="date" className="w-full rounded-xl border p-2" value={period.fromISO} onChange={(e)=>setPeriod({...period, fromISO: e.target.value})} /></div>
              <div><label className="block text-sm font-medium mb-1">Reporting thru</label><input type="date" className="w-full rounded-xl border p-2" value={period.thruISO} onChange={(e)=>setPeriod({...period, thruISO: e.target.value})} /></div>
            </div>

            <h3 className="text-base font-semibold">CV92 Baseline & Increases</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-sm font-medium mb-1">Line 9 – CV92 total due ($)</label><input className="w-full rounded-xl border p-2" value={cv92Baseline} onChange={(e)=>setCv92Baseline(e.target.value)} placeholder="$0.00" /></div>
              <div><label className="block text-sm font-medium mb-1">Line 10 – Interest rate (%)</label><input className="w-full rounded-xl border p-2" value={increases.interestRatePct} onChange={(e)=>setIncreases({...increases, interestRatePct: e.target.value})} placeholder={annualRatePct} /></div>
              <div><label className="block text-sm font-medium mb-1">Line 10 – Post-judgment interest ($)</label><input className="w-full rounded-xl border p-2" value={increases.postJudgmentInterest} onChange={(e)=>setIncreases({...increases, postJudgmentInterest: e.target.value})} placeholder="$0.00" /></div>
              <div><label className="block text-sm font-medium mb-1">Line 11 – Post-judgment costs ($)</label><input className="w-full rounded-xl border p-2" value={increases.postJudgmentCosts} onChange={(e)=>setIncreases({...increases, postJudgmentCosts: e.target.value})} placeholder="$0.00" /></div>
              <div className="col-span-2"><label className="block text-sm font-medium mb-1">Line 12 – Other increases (explain)</label><input className="w-full rounded-xl border p-2" value={increases.otherIncreasesNote} onChange={(e)=>setIncreases({...increases, otherIncreasesNote: e.target.value})} placeholder="Explanation" /></div>
              <div><label className="block text-sm font-medium mb-1">Line 12 – Other increases ($)</label><input className="w-full rounded-xl border p-2" value={increases.otherIncreasesAmount} onChange={(e)=>setIncreases({...increases, otherIncreasesAmount: e.target.value})} placeholder="$0.00" /></div>
            </div>

            <h3 className="text-base font-semibold">Carry-forwards & Signature</h3>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-sm font-medium mb-1">Line 3 prior garnishee total ($)</label><input className="w-full rounded-xl border p-2" value={carryForwards.garnisheePriorTotal} onChange={(e)=>setCarryForwards({...carryForwards, garnisheePriorTotal: e.target.value})} placeholder="$0.00" /></div>
              <div><label className="block text-sm font-medium mb-1">Line 6 prior direct total ($)</label><input className="w-full rounded-xl border p-2" value={carryForwards.directPriorTotal} onChange={(e)=>setCarryForwards({...carryForwards, directPriorTotal: e.target.value})} placeholder="$0.00" /></div>
              <div><label className="block text-sm font-medium mb-1">Signer name</label><input className="w-full rounded-xl border p-2" value={signer.name} onChange={(e)=>setSigner({...signer, name: e.target.value})} /></div>
              <div><label className="block text-sm font-medium mb-1">Signature date</label><input type="date" className="w-full rounded-xl border p-2" value={signer.dateISO} onChange={(e)=>setSigner({...signer, dateISO: e.target.value})} /></div>
            </div>

            <button onClick={exportCV93} className="mt-2 px-4 py-2 rounded-xl bg-gray-900 text-white shadow-sm">Export CV93 PDF</button>
          </div>
        </div>

        {/* Right panel: entries & schedule */}
        <div className="lg:col-span-2 space-y-6">
          <div className="rounded-2xl shadow-sm bg-white p-5">
            <h2 className="text-lg font-semibold mb-3">Entries</h2>
            {!headerSummary.principalValid || !headerSummary.startValid ? (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-3">Enter a valid starting principal and start date to activate calculations.</p>
            ) : null}
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-600 border-b">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3">Source</th>
                    <th className="py-2 pr-3">Amount</th>
                    <th className="py-2 pr-3">Note</th>
                    <th className="py-2 pr-3"></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b last:border-b-0">
                      <td className="py-2 pr-3"><input type="date" value={r.date} onChange={(e) => updateRow(r.id, { date: e.target.value })} className="rounded-lg border p-2" /></td>
                      <td className="py-2 pr-3"><select value={r.type} onChange={(e) => updateRow(r.id, { type: e.target.value })} className="rounded-lg border p-2"><option value="payment">Payment</option><option value="expense">Expense</option></select></td>
                      <td className="py-2 pr-3"><select value={r.source} onChange={(e) => updateRow(r.id, { source: e.target.value })} className="rounded-lg border p-2"><option value="direct">Direct</option><option value="garnishee">Garnishee</option></select></td>
                      <td className="py-2 pr-3"><input value={r.amount} onChange={(e) => updateRow(r.id, { amount: e.target.value })} className="rounded-lg border p-2 w-36" placeholder="$0.00" /></td>
                      <td className="py-2 pr-3"><input value={r.note} onChange={(e) => updateRow(r.id, { note: e.target.value })} className="rounded-lg border p-2 w-full" placeholder="optional" /></td>
                      <td className="py-2 pr-3 text-right"></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl shadow-sm bg-white p-5">
            <h2 className="text-lg font-semibold mb-3">Amortization Schedule (Simple Interest)</h2>
            <div className="mb-3 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-xl bg-gray-50 p-3 border"><div className="text-xs text-gray-500">Principal (current)</div><div className="text-xl font-semibold">{currency(schedule.totals.principal)}</div></div>
              <div className="rounded-xl bg-gray-50 p-3 border"><div className="text-xs text-gray-500">Unpaid Interest (carryover)</div><div className="text-xl font-semibold">{currency(schedule.totals.carryInterest)}</div></div>
              <div className="rounded-xl bg-gray-50 p-3 border"><div className="text-xs text-gray-500">Total Due {asOfDate ? `(as of ${fmtDateISO(asOfDate)})` : "(latest entry)"}</div><div className="text-xl font-semibold">{currency(schedule.totals.balance)}</div></div>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs md:text-sm">
                <thead>
                  <tr className="text-left text-gray-600 border-b">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3">Days</th>
                    <th className="py-2 pr-3">Accrued</th>
                    <th className="py-2 pr-3">Payment</th>
                    <th className="py-2 pr-3">Expense</th>
                    <th className="py-2 pr-3">→ Interest</th>
                    <th className="py-2 pr-3">→ Principal</th>
                    <th className="py-2 pr-3">Principal (before → after)</th>
                    <th className="py-2 pr-3">Unpaid Interest</th>
                    <th className="py-2 pr-3">Source</th>
                    <th className="py-2 pr-3">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {schedule.rows.length === 0 ? (
                    <tr><td colSpan={12} className="py-6 text-center text-gray-500">Enter starting values and at least one entry to see the schedule.</td></tr>
                  ) : (
                    schedule.rows.map((r, i) => (
                      <tr key={`${r.date}-${i}`} className="border-b last:border-b-0">
                        <td className="py-2 pr-3 font-mono">{fmtDateISO(r.date)}</td>
                        <td className="py-2 pr-3 capitalize">{r.type}</td>
                        <td className="py-2 pr-3">{r.days}</td>
                        <td className="py-2 pr-3">{currency(r.accrued)}</td>
                        <td className="py-2 pr-3">{r.payment ? currency(r.payment) : "—"}</td>
                        <td className="py-2 pr-3">{r.expense ? currency(r.expense) : "—"}</td>
                        <td className="py-2 pr-3">{r.appliedToInterest ? currency(r.appliedToInterest) : "—"}</td>
                        <td className="py-2 pr-3">{r.appliedToPrincipal ? currency(r.appliedToPrincipal) : "—"}</td>
                        <td className="py-2 pr-3">{currency(r.principalBefore)} → {currency(r.principalAfter)}</td>
                        <td className="py-2 pr-3">{currency(r.carryInterest)}</td>
                        <td className="py-2 pr-3">{r.source || ""}</td>
                        <td className="py-2 pr-3">{r.note || ""}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl shadow-sm bg-white p-5">
            <h3 className="text-base font-semibold mb-2">Methodology</h3>
            <ol className="list-decimal ml-5 text-sm space-y-1 text-gray-700">
              <li>Daily rate = (annual rate ÷ {basis}) per day. Accrued interest between entries = principal × daily rate × days.</li>
              <li>Payments apply to accrued/unpaid interest first; the remainder reduces principal.</li>
              <li>Expenses increase principal on their effective date; interest is simple (no compounding).</li>
              <li>CV93 export splits payments into “Garnishee” vs “Direct” and fills Page 1 lines 3–8 and Page 2 lines 9–17.</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}
