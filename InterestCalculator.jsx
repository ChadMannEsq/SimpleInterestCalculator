import React, { useMemo, useState, useEffect } from "react";

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


  // ========================= UI =========================
  const headerSummary = useMemo(() => {
    const p0 = parseMoney(principalStart);
    return { principalValid: Number.isFinite(p0) && p0 >= 0, startValid: !!startDate };
  }, [principalStart, startDate]);

  return (
    <div className="min-h-screen w-full bg-gray-50 text-gray-800 p-6">
      <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left panel: calculator */}
        <div className="lg:col-span-1 space-y-4">
          <div className="rounded-2xl shadow-sm bg-white p-5">
            <h1 className="text-2xl font-semibold mb-1">Simple Interest Calculator</h1>
            <p className="text-sm text-gray-500">Payments, expenses, and daily simple interest.</p>
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
            <div>
              <label className="block text-sm font-medium mb-1">Annual interest rate (%)</label>
              <input value={annualRatePct} onChange={(e) => setAnnualRatePct(e.target.value)} className="w-full rounded-xl border p-2" placeholder="9.000" />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">As-of date (preview)</label>
              <input type="date" value={asOfDate} onChange={(e) => setAsOfDate(e.target.value)} className="w-full rounded-xl border p-2" />
            </div>
          </div>

        </div>

          {/* Right panel: entries & schedule */}
          <div className="lg:col-span-2 space-y-6 flex flex-col">
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
                <li>Daily rate = (annual rate ÷ 365) per day. Accrued interest between entries = principal × daily rate × days.</li>
                <li>Payments apply to accrued/unpaid interest first; the remainder reduces principal.</li>
                <li>Expenses increase principal on their effective date; interest is simple (no compounding).</li>
              </ol>
            </div>
            <div className="flex justify-end mt-auto pt-6">
              <button onClick={clearAll} className="px-4 py-2 rounded-xl border shadow-sm">Clear rows</button>
            </div>
          </div>
      </div>
    </div>
  );
}
