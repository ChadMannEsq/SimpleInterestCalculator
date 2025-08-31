import React, { useMemo, useState, useEffect } from "react";
import jsPDF from "jspdf";
import "jspdf-autotable";

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
function generateId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // Fallback for browsers without crypto.randomUUID.
  // Uses Math.random and is not cryptographically secure.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const blankRow = (type = "payment") => ({ id: generateId(), date: "", type, amount: "", note: "", source: "direct" });

// ========================= Component =========================
export default function InterestCalculator() {
  // Calculator core
  const [caseName, setCaseName] = useState("");
  const [debtor, setDebtor] = useState("");
  const [principalStart, setPrincipalStart] = useState("");
  const [startDate, setStartDate] = useState("");
  const [annualRatePct, setAnnualRatePct] = useState("9.000");
  const BASIS = 365;
  const [asOfDate, setAsOfDate] = useState("");
  const [rows, setRows] = useState([blankRow("payment")]);
  const [pdfFontSize, setPdfFontSize] = useState(12);

  useEffect(() => {
    const stored = localStorage.getItem("pdfFontSize");
    if (stored) {
      const n = parseInt(stored, 10);
      if (Number.isFinite(n)) setPdfFontSize(n);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("pdfFontSize", String(pdfFontSize));
  }, [pdfFontSize]);


  // Auto-add new blank row once last row has both date & amount
  useEffect(() => {
    const last = rows[rows.length - 1];
    const amt = parseMoney(last?.amount);
    if (last?.date && Number.isFinite(amt)) setRows((r) => [...r, blankRow("payment")]);
  }, [rows]);

  const dailyRate = useMemo(() => {
    const a = Number(annualRatePct);
    return Number.isFinite(a) ? a / 100 / BASIS : 0;
  }, [annualRatePct]);

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

  function printPDF() {
    const pdf = new jsPDF();
    pdf.setFontSize(pdfFontSize);
    let y = 10;
    pdf.text(`Case: ${caseName}`, 10, y); y += 10;
    pdf.text(`Debtor: ${debtor}`, 10, y); y += 10;
    pdf.text(`Starting principal: ${principalStart}`, 10, y); y += 10;
    pdf.text(`Start date: ${fmtDateISO(startDate)}`, 10, y); y += 10;
    pdf.text(`Annual rate (%): ${annualRatePct}`, 10, y); y += 10;
    pdf.text(`As-of date: ${fmtDateISO(asOfDate)}`, 10, y); y += 20;
    pdf.text("Schedule:", 10, y); y += 10;

    pdf.autoTable({
      head: [[
        "Date",
        "Type",
        "Payment",
        "Expense",
        "→ Interest",
        "→ Principal",
        "Principal (after)",
        "Unpaid Interest",
        "Source",
        "Note",
      ]],
      body: schedule.rows.map((r) => [
        fmtDateISO(r.date),
        r.type,
        r.payment ? currency(r.payment) : "—",
        r.expense ? currency(r.expense) : "—",
        r.appliedToInterest ? currency(r.appliedToInterest) : "—",
        r.appliedToPrincipal ? currency(r.appliedToPrincipal) : "—",
        currency(r.principalAfter),
        currency(r.carryInterest),
        r.source || "",
        r.note || "",
      ]),
      startY: y,
      styles: { lineWidth: 0.1 },
      tableLineColor: [0, 0, 0],
      theme: "grid",
    });

    // After the schedule table, output totals aligned at the end of the document
    const finalY = pdf.lastAutoTable?.finalY || y;
    const lines = [
      `Principal (current): ${currency(schedule.totals.principal)}`,
      `Unpaid Interest (carryover): ${currency(schedule.totals.carryInterest)}`,
      `Total Due (as of ${fmtDateISO(asOfDate) || 'latest entry'}): ${currency(schedule.totals.balance)}`,
    ];

    let startY = finalY + 10; // add spacing after table
    const lineHeight = pdf.getLineHeight() / pdf.internal.scaleFactor;
    const bottomMargin = 10;
    const pageHeight = pdf.internal.pageSize.getHeight();

    if (startY + lines.length * lineHeight > pageHeight - bottomMargin) {
      pdf.addPage();
      startY = 10;
    }

    lines.forEach((text, i) => {
      pdf.text(text, 10, startY + i * lineHeight);
    });

    pdf.save(`${caseName || "schedule"}.pdf`);
  }


  // ========================= UI =========================
  const headerSummary = useMemo(() => {
    const p0 = parseMoney(principalStart);
    return { principalValid: Number.isFinite(p0) && p0 >= 0, startValid: !!startDate };
  }, [principalStart, startDate]);

  return (
    <div className="min-h-screen w-full bg-gray-100 text-gray-800 p-4 md:p-6 font-sans">
      <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
        {/* Left panel: calculator */}
        <div className="lg:col-span-1 space-y-4">
          <div className="rounded-2xl bg-white p-4 md:p-6 shadow-md hover:shadow-lg transition-shadow">
            <h1 className="text-2xl font-semibold mb-1 text-indigo-700">Simple Interest Calculator</h1>
            <p className="text-sm text-gray-500">Payments, expenses, and daily simple interest.</p>
          </div>

          {/* Core calculator inputs */}
          <div className="rounded-2xl bg-white p-4 md:p-6 space-y-4 shadow-md hover:shadow-lg transition-shadow">
            <div>
              <label className="block text-sm font-medium mb-1">Case name / file #</label>
              <input value={caseName} onChange={(e) => setCaseName(e.target.value)} className="w-full rounded-xl border border-gray-300 p-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300 transition" placeholder="e.g., Mann v. Debtor" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Debtor</label>
              <input value={debtor} onChange={(e) => setDebtor(e.target.value)} className="w-full rounded-xl border border-gray-300 p-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300 transition" placeholder="e.g., John Doe" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Starting principal</label>
                <input value={principalStart} onChange={(e) => setPrincipalStart(e.target.value)} className="w-full rounded-xl border border-gray-300 p-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300 transition" placeholder="$10,000.00" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Start date</label>
                <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded-xl border border-gray-300 p-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300 transition" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Annual interest rate (%)</label>
              <input value={annualRatePct} onChange={(e) => setAnnualRatePct(e.target.value)} className="w-full rounded-xl border border-gray-300 p-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300 transition" placeholder="9.000" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">As-of date (preview)</label>
              <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="w-full rounded-xl border border-gray-300 p-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300 transition" />
            </div>
          </div>

        </div>

          {/* Right panel: entries & schedule */}
          <div className="lg:col-span-2 space-y-6 flex flex-col">
          <div className="rounded-2xl bg-white p-4 md:p-6 shadow-md hover:shadow-lg transition-shadow">
            <h2 className="text-lg font-semibold mb-3 text-indigo-700">Entries</h2>
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
                      <td className="py-2 pr-3"><input type="date" value={r.date} onChange={(e) => updateRow(r.id, { date: e.target.value })} className="rounded-lg border border-gray-300 p-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300 transition" /></td>
                      <td className="py-2 pr-3"><select value={r.type} onChange={(e) => updateRow(r.id, { type: e.target.value })} className="rounded-lg border border-gray-300 p-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300 transition"><option value="payment">Payment</option><option value="expense">Expense</option></select></td>
                      <td className="py-2 pr-3"><select value={r.source} onChange={(e) => updateRow(r.id, { source: e.target.value })} className="rounded-lg border border-gray-300 p-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300 transition"><option value="direct">Direct</option><option value="garnishee">Garnishee</option></select></td>
                      <td className="py-2 pr-3"><input value={r.amount} onChange={(e) => updateRow(r.id, { amount: e.target.value })} className="rounded-lg border border-gray-300 p-2 w-36 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300 transition" placeholder="$0.00" /></td>
                      <td className="py-2 pr-3"><input value={r.note} onChange={(e) => updateRow(r.id, { note: e.target.value })} className="rounded-lg border border-gray-300 p-2 w-full focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300 transition" placeholder="optional" /></td>
                      <td className="py-2 pr-3 text-right"></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-2xl bg-white p-4 md:p-6 shadow-md hover:shadow-lg transition-shadow">
            <h2 className="text-lg font-semibold mb-3 text-indigo-700">Amortization Schedule (Simple Interest)</h2>
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

            <div className="rounded-2xl bg-white p-4 md:p-6 shadow-md hover:shadow-lg transition-shadow">
              <h3 className="text-base font-semibold mb-2 text-indigo-700">Methodology</h3>
              <ol className="list-decimal ml-5 text-sm space-y-1 text-gray-700">
                <li>Daily rate = (annual rate ÷ 365) per day. Accrued interest between entries = principal × daily rate × days.</li>
                <li>Payments apply to accrued/unpaid interest first; the remainder reduces principal.</li>
                <li>Expenses increase principal on their effective date; interest is simple (no compounding).</li>
              </ol>
            </div>
              <div className="flex justify-end mt-auto pt-6 space-x-2">
                <input
                  type="number"
                  aria-label="PDF font size"
                  value={pdfFontSize}
                  onChange={(e) => setPdfFontSize(Number(e.target.value))}
                  className="w-16 px-2 py-1 rounded-xl border shadow-sm text-sm"
                />
                <button onClick={printPDF} className="flex items-center space-x-2 px-4 py-2 rounded-xl border shadow-sm hover:bg-gray-50 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.506 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z" />
                  </svg>
                  <span>Print PDF</span>
                </button>
                <button onClick={clearAll} className="flex items-center space-x-2 px-4 py-2 rounded-xl border shadow-sm hover:bg-gray-50 transition-colors">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
                  </svg>
                  <span>Clear rows</span>
                </button>
              </div>
          </div>
      </div>
    </div>
  );
}
