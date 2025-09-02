import React, { useMemo, useState, useEffect } from "react";
import { Link } from "react-router-dom";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

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
  // --- Page & margins (Letter landscape in points) ---
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "letter" });
  const pageWidth  = pdf.internal.pageSize.getWidth();   // 792pt
  const pageHeight = pdf.internal.pageSize.getHeight();  // 612pt
  const M = { top: 56, right: 40, bottom: 56, left: 40 }; // printable width = 792 - (40+40) = 712

  // --- Helpers ---
  const safe = (s) => String(s ?? "")
    .replace(/→/g, "->")
    .replace(/\u2013|\u2014/g, "-"); // normalize dashes

  const money = (v) => currency(v) || "—"; // your currency() already formats

  // --- Build compact rows for a table that truly fits ---
  // We merge Payment/Expense into a single "Txn" column (expense as +$, payment as -$)
  const body = schedule.rows.map((r) => {
    const txn = r.expense ? `+${money(r.expense)}` : (r.payment ? `-${money(r.payment)}` : "—");
    const applied = `${r.appliedToInterest ? money(r.appliedToInterest) : "—"} / ${r.appliedToPrincipal ? money(r.appliedToPrincipal) : "—"}`;
    return {
      date: fmtDateISO(r.date),
      type: r.type,
      days: String(r.days),
      accr: money(r.accrued),
      txn,
      applied,
      prin: safe(`${money(r.principalBefore)} -> ${money(r.principalAfter)}`),
      carry: money(r.carryInterest),
      src: safe(r.source || ""),
      note: safe(r.note || "")
    };
  });

  // --- Header block (drawn once per page in didDrawPage) ---
  const drawHeader = () => {
    const lh = 14;
    let y = M.top; // start at top margin
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(13);
    pdf.text("Simple Interest Schedule", M.left, y);
    y += lh + 4;

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);

    // Two columns to save vertical space
    const left = [
      `Case: ${safe(caseName) || "—"}`,
      `Debtor: ${safe(debtor) || "—"}`,
      `Starting principal: ${money(principalStart)}`
    ];
    const right = [
      `Start date: ${fmtDateISO(startDate) || "—"}`,
      `Annual rate (%): ${safe(annualRatePct) || "—"}`,
      `As-of date: ${fmtDateISO(asOfDate) || "—"}`
    ];
    left.forEach((t, i)  => pdf.text(t, M.left, y + i * lh));
    right.forEach((t, i) => pdf.text(t, pageWidth / 2, y + i * lh));

    // Totals row beneath meta
    const yTotals = y + Math.max(left.length, right.length) * lh + 8;
    const totals = [
      `Principal (current): ${money(schedule.totals.principal)}`,
      `Unpaid Interest (carryover): ${money(schedule.totals.carryInterest)}`,
      `Total Due ${asOfDate ? `(as of ${fmtDateISO(asOfDate)})` : "(latest entry)"}: ${money(schedule.totals.balance)}`
    ];
    totals.forEach((t, i) => pdf.text(t, M.left + i * 230, yTotals)); // 3 items across

    // Return the Y-coordinate where content must start (leaving a safe gap)
    return yTotals + 22; // header height used by the table start
  };

  // Compute the startY only for first page; next pages will re-draw the header in didDrawPage
  const firstStartY = drawHeader();

  // --- Table columns that FIT the printable width exactly (712pt total) ---
  // widths: 56+44+34+60+60+82+110+70+52+144 = 712
  const colWidths = {
    date: 56,  // Date
    type: 44,  // Type
    days: 34,  // Days (right)
    accr: 60,  // Accrued (right)
    txn: 60,   // Txn (right)
    applied: 82, // Applied I/P (right)
    prin: 110, // Principal before->after
    carry: 70, // Unpaid Interest (right)
    src: 52,   // Source
    note: 144  // Note
  };

  autoTable(pdf, {
    columns: [
      { header: "Date", dataKey: "date" },
      { header: "Type", dataKey: "type" },
      { header: "Days", dataKey: "days" },
      { header: "Accrued", dataKey: "accr" },
      { header: "Txn", dataKey: "txn" },
      { header: "Applied (I / P)", dataKey: "applied" },
      { header: "Principal (before -> after)", dataKey: "prin" },
      { header: "Unpaid", dataKey: "carry" },
      { header: "Src", dataKey: "src" },
      { header: "Note", dataKey: "note" }
    ],
    body,
    startY: firstStartY, // <- guarantees no header overlap on page 1
    margin: { left: M.left, right: M.right, bottom: M.bottom, top: M.top },
    tableWidth: "wrap", // respect the margins; don't overflow horizontally
    styles: { font: "helvetica", fontSize: Number.isFinite(pdfFontSize) ? pdfFontSize : 8, cellPadding: 3, overflow: "linebreak" },
    headStyles: { fillColor: [67, 56, 202], textColor: 255, fontStyle: "bold" }, // indigo header
    columnStyles: {
      date: { cellWidth: colWidths.date },
      type: { cellWidth: colWidths.type },
      days: { cellWidth: colWidths.days, halign: "right" },
      accr: { cellWidth: colWidths.accr, halign: "right" },
      txn:  { cellWidth: colWidths.txn,  halign: "right" },
      applied: { cellWidth: colWidths.applied, halign: "right" },
      prin: { cellWidth: colWidths.prin },
      carry:{ cellWidth: colWidths.carry, halign: "right" },
      src:  { cellWidth: colWidths.src },
      note: { cellWidth: colWidths.note }
    },
    didDrawPage: () => {
      // Re-draw header on every page and keep the same spacing before table
      const y = drawHeader();
      // If AutoTable started too high on a new page, nudge it down by increasing the top margin for that page
      // (AutoTable handles page breaks; we only ensure header is above).
    }
  });

  // Footer page numbers
  const pageCount = pdf.getNumberOfPages();
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);
  pdf.setTextColor(120);
  for (let i = 1; i <= pageCount; i++) {
    pdf.setPage(i);
    pdf.text(
      `Page ${i} of ${pageCount}`,
      pageWidth - M.right,
      pageHeight - 20,
      { align: "right" }
    );
  }

  pdf.save(`${safe(caseName) || "schedule"}.pdf`);
}

  // ========================= UI =========================
  const headerSummary = useMemo(() => {
    const p0 = parseMoney(principalStart);
    return { principalValid: Number.isFinite(p0) && p0 >= 0, startValid: !!startDate };
  }, [principalStart, startDate]);

	return (
	  <>
		{/* Brand Header */}
		<header className="sticky top-0 z-30 bg-ink text-white border-b border-black/20">
		  <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
			<div>
			  <h1 className="text-lg font-semibold tracking-tight">Simple Interest Calculator</h1>
			  <p className="text-xs text-white/70">Matter finance · daily simple interest · printable ledgers</p>
			</div>
                        <div className="flex items-center gap-2">
                          <Link
                                to="/"
                                className="px-3 py-1.5 rounded-xl border border-white/20 text-sm hover:bg-white/10"
                          >
                                Home
                          </Link>
                          {/* Dark mode toggle with persistence */}
			  <button
				type="button"
				onClick={() => {
				  const el = document.documentElement;
				  const next = !el.classList.contains("dark");
				  el.classList.toggle("dark", next);
				  localStorage.setItem("theme", next ? "dark" : "light");
				}}
				className="px-3 py-1.5 rounded-xl border border-white/20 text-sm hover:bg-white/10"
				title="Toggle dark mode"
			  >
				🌙 / ☀️
			  </button>

			  <button
				onClick={printPDF}
				className="px-3 py-1.5 rounded-xl bg-brand text-ink text-sm hover:brightness-95"
			  >
				Export PDF
			  </button>

			  <button
				onClick={clearAll}
				className="px-3 py-1.5 rounded-xl border border-white/20 text-sm hover:bg-white/10"
			  >
				Clear
			  </button>
			</div>
		  </div>
		</header>

		{/* Page Surface */}
		<div className="min-h-screen w-full bg-white text-ink dark:bg-ink dark:text-white">
		  <div className="max-w-6xl mx-auto p-4 md:p-6 grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">

			{/* Left Sidebar (320px) */}
			<div className="space-y-4">
			  <div className="rounded-2xl bg-white dark:bg-gray-800 p-5 shadow-sm border border-gray-200 dark:border-gray-700">
				<h2 className="text-base font-semibold mb-3">Matter details</h2>
				<div className="space-y-4">
				  <label className="block">
					<span className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Case name / file #</span>
					<input
					  value={caseName}
					  onChange={(e) => setCaseName(e.target.value)}
					  className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300"
					  placeholder="e.g., Mann v. Debtor"
					/>
				  </label>

				  <label className="block">
					<span className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Debtor</span>
					<input
					  value={debtor}
					  onChange={(e) => setDebtor(e.target.value)}
					  className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300"
					  placeholder="e.g., John Doe"
					/>
				  </label>
				</div>

				<hr className="my-5 border-gray-200 dark:border-gray-700" />

				<h3 className="text-sm font-medium mb-3">Calculation settings</h3>
				<div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
				  <label className="block">
					<span className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Starting principal</span>
					<input
					  value={principalStart}
					  onChange={(e) => setPrincipalStart(e.target.value)}
					  className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300"
					  placeholder="$10,000.00"
					/>
				  </label>

				  <label className="block">
					<span className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Start date</span>
					<input
					  type="date"
					  value={startDate}
					  onChange={(e) => setStartDate(e.target.value)}
					  className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300"
					/>
				  </label>

				  <label className="block">
					<span className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">Annual interest rate (%)</span>
					<input
					  value={annualRatePct}
					  onChange={(e) => setAnnualRatePct(e.target.value)}
					  className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300"
					  placeholder="9.000"
					/>
				  </label>

				  <label className="block">
					<span className="block text-sm font-medium mb-1 text-gray-700 dark:text-gray-300">As-of date (preview)</span>
					<input
					  type="date"
					  value={asOfDate}
					  onChange={(e) => setAsOfDate(e.target.value)}
					  className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300"
					/>
				  </label>
				</div>

				<p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
				  Simple interest @ {annualRatePct || "—"}% on 365-day basis. Payments apply to interest first, then principal.
				</p>
			  </div>
			</div>

			{/* Right Column */}
			<div className="space-y-6 flex flex-col">

			  {/* Sticky Totals Bar */}
			  <div className="sticky top-16 z-20 rounded-xl border bg-white dark:bg-ink/80 backdrop-blur p-3 flex flex-wrap gap-3">
				<div className="rounded-xl border px-3 py-2">
				  <div className="text-xs opacity-70">Principal</div>
				  <div className="text-lg font-semibold text-brand">{currency(schedule.totals.principal)}</div>
				</div>
				<div className="rounded-xl border px-3 py-2">
				  <div className="text-xs opacity-70">Unpaid Interest</div>
				  <div className="text-lg font-semibold text-brand">{currency(schedule.totals.carryInterest)}</div>
				</div>
				<div className="rounded-xl border px-3 py-2">
				  <div className="text-xs opacity-70">{asOfDate ? `Total Due (as of ${fmtDateISO(asOfDate)})` : "Total Due"}</div>
				  <div className="text-lg font-semibold text-brand">{currency(schedule.totals.balance)}</div>
				</div>
			  </div>

			  {/* Entries */}
			  <div className="rounded-2xl bg-white dark:bg-gray-800 p-4 shadow-sm border border-gray-200 dark:border-gray-700"
				   style={{ boxShadow: 'inset 4px 0 0 0 #AD8D62' }}>
				<div className="flex items-center justify-between mb-3">
				  <h2 className="text-base font-semibold">Entries</h2>
				  {!headerSummary.principalValid || !headerSummary.startValid ? (
					<span className="text-xs text-amber-700 bg-amber-50/80 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg px-2 py-1">
					  Enter a valid starting principal and start date to activate calculations.
					</span>
				  ) : null}
				</div>

				<div className="overflow-auto max-h-[56vh] rounded-xl border border-gray-200 dark:border-gray-700">
				  <table className="min-w-full text-sm">
					<thead className="sticky top-0 z-10 bg-white/95 dark:bg-gray-800/95 backdrop-blur border-b border-gray-200 dark:border-gray-700">
					  <tr className="text-left text-gray-600 dark:text-gray-300">
						<th className="py-2 pr-3">Date</th>
						<th className="py-2 pr-3">Type</th>
						<th className="py-2 pr-3">Source</th>
						<th className="py-2 pr-3 text-right">Amount</th>
						<th className="py-2 pr-3">Note</th>
						<th className="py-2 pr-3 w-12"></th>
					  </tr>
					</thead>
					<tbody className="[&>tr:nth-child(odd)]:bg-gray-50/60 dark:[&>tr:nth-child(odd)]:bg-gray-900/20">
					  {rows.map((r) => (
						<tr key={r.id} className="border-b border-gray-200 dark:border-gray-700 last:border-b-0">
						  <td className="py-2 pr-3">
							<input
							  type="date"
							  value={r.date}
							  onChange={(e) => updateRow(r.id, { date: e.target.value })}
							  className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-300"
							/>
						  </td>
						  <td className="py-2 pr-3">
							<select
							  value={r.type}
							  onChange={(e) => updateRow(r.id, { type: e.target.value })}
							  className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-1"
							>
							  <option value="payment">Payment</option>
							  <option value="expense">Expense</option>
							</select>
						  </td>
						  <td className="py-2 pr-3">
							<select
							  value={r.source}
							  onChange={(e) => updateRow(r.id, { source: e.target.value })}
							  className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-1"
							>
							  <option value="direct">Direct</option>
							  <option value="garnishee">Garnishee</option>
							</select>
						  </td>
						  <td className="py-2 pr-3 text-right">
							<input
							  value={r.amount}
							  onChange={(e) => updateRow(r.id, { amount: e.target.value })}
							  className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-1 w-36 text-right"
							  placeholder="$0.00"
							/>
						  </td>
						  <td className="py-2 pr-3">
							<input
							  value={r.note}
							  onChange={(e) => updateRow(r.id, { note: e.target.value })}
							  className="rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 px-2 py-1 w-full"
							  placeholder="optional"
							/>
						  </td>
						  <td className="py-2 pr-3 text-right">{/* reserved for per-row actions */}</td>
						</tr>
					  ))}
					</tbody>
				  </table>
				</div>

				{/* Entries Toolbar */}
				<div className="mt-3 flex flex-wrap items-center gap-2 justify-end">
				  <div className="flex items-center space-x-2 mr-auto">
					<label htmlFor="pdfFontSize" className="text-sm text-gray-600 dark:text-gray-300">
					  PDF font size
					</label>
					<input
					  id="pdfFontSize"
					  type="number"
					  min={6}
					  max={18}
					  step={1}
					  value={pdfFontSize}
					  onChange={(e) => setPdfFontSize(Number(e.target.value))}
					  className="w-20 px-2 py-1 rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 text-sm shadow-sm"
					  title="Controls the font size used in the exported PDF"
					/>
					<button
					  type="button"
					  onClick={() => setPdfFontSize((s) => Math.max(6, s - 1))}
					  className="px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm"
					  aria-label="Decrease PDF font size"
					>
					  A–
					</button>
					<button
					  type="button"
					  onClick={() => setPdfFontSize((s) => Math.min(18, s + 1))}
					  className="px-2 py-1 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-900 text-sm"
					  aria-label="Increase PDF font size"
					>
					  A+
					</button>
				  </div>
				  <button
					onClick={printPDF}
					className="px-3 py-2 rounded-xl bg-brand text-ink text-sm hover:brightness-95"
				  >
					Export PDF
				  </button>
				  <button
					onClick={clearAll}
					className="px-3 py-2 rounded-xl border text-sm hover:bg-black/5 dark:hover:bg-white/10"
				  >
					Clear rows
				  </button>
				</div>
			  </div>

			  {/* Schedule */}
			  <div className="rounded-2xl bg-white dark:bg-gray-800 p-4 shadow-sm border border-gray-200 dark:border-gray-700">
				<h2 className="text-base md:text-lg font-semibold mb-3">Amortization schedule</h2>

				<div className="mb-3 grid grid-cols-1 md:grid-cols-3 gap-3">
				  <div className="rounded-2xl bg-gray-50 dark:bg-gray-900/40 p-3 border border-gray-200 dark:border-gray-700">
					<div className="text-xs text-gray-500 dark:text-gray-400">Principal (current)</div>
					<div className="text-xl font-semibold">{currency(schedule.totals.principal)}</div>
				  </div>
				  <div className="rounded-2xl bg-gray-50 dark:bg-gray-900/40 p-3 border border-gray-200 dark:border-gray-700">
					<div className="text-xs text-gray-500 dark:text-gray-400">Unpaid Interest (carryover)</div>
					<div className="text-xl font-semibold">{currency(schedule.totals.carryInterest)}</div>
				  </div>
				  <div className="rounded-2xl bg-gray-50 dark:bg-gray-900/40 p-3 border border-gray-200 dark:border-gray-700">
					<div className="text-xs text-gray-500 dark:text-gray-400">
					  Total Due {asOfDate ? `(as of ${fmtDateISO(asOfDate)})` : "(latest entry)"}
					</div>
					<div className="text-xl font-semibold">{currency(schedule.totals.balance)}</div>
				  </div>
				</div>

				<div className="overflow-x-auto">
				  <table className="min-w-full text-xs md:text-sm">
					<thead>
					  <tr className="text-left text-gray-600 dark:text-gray-300 border-b border-gray-200 dark:border-gray-700">
						<th className="py-2 pr-3">Date</th>
						<th className="py-2 pr-3">Type</th>
						<th className="py-2 pr-3 text-right">Days</th>
						<th className="py-2 pr-3 text-right">Accrued</th>
						<th className="py-2 pr-3 text-right">Payment</th>
						<th className="py-2 pr-3 text-right">Expense</th>
						<th className="py-2 pr-3 text-right">→ Interest</th>
						<th className="py-2 pr-3 text-right">→ Principal</th>
						<th className="py-2 pr-3">Principal (before → after)</th>
						<th className="py-2 pr-3 text-right">Unpaid Interest</th>
						<th className="py-2 pr-3">Source</th>
						<th className="py-2 pr-3">Note</th>
					  </tr>
					</thead>
					<tbody>
					  {schedule.rows.length === 0 ? (
						<tr>
						  <td colSpan={12} className="py-8 text-center text-gray-500 dark:text-gray-400">
							Add a starting principal, start date, and at least one entry to see the schedule.
						  </td>
						</tr>
					  ) : (
						schedule.rows.map((r, i) => (
						  <tr key={`${r.date}-${i}`} className="border-b border-gray-200 dark:border-gray-700 last:border-b-0">
							<td className="py-2 pr-3 font-mono">{fmtDateISO(r.date)}</td>
							<td className="py-2 pr-3 capitalize">{r.type}</td>
							<td className="py-2 pr-3 text-right">{r.days}</td>
							<td className="py-2 pr-3 text-right">{currency(r.accrued)}</td>
							<td className="py-2 pr-3 text-right">{r.payment ? currency(r.payment) : "—"}</td>
							<td className="py-2 pr-3 text-right">{r.expense ? currency(r.expense) : "—"}</td>
							<td className="py-2 pr-3 text-right">{r.appliedToInterest ? currency(r.appliedToInterest) : "—"}</td>
							<td className="py-2 pr-3 text-right">{r.appliedToPrincipal ? currency(r.appliedToPrincipal) : "—"}</td>
							<td className="py-2 pr-3">{currency(r.principalBefore)} → {currency(r.principalAfter)}</td>
							<td className="py-2 pr-3 text-right">{currency(r.carryInterest)}</td>
							<td className="py-2 pr-3">{r.source || ""}</td>
							<td className="py-2 pr-3">{r.note || ""}</td>
						  </tr>
						))
					  )}
					</tbody>
				  </table>
				</div>
			  </div>

			  {/* Methodology */}
			  <details className="rounded-2xl bg-white dark:bg-gray-800 p-4 shadow-sm border border-gray-200 dark:border-gray-700 group">
				<summary className="cursor-pointer select-none text-base font-semibold flex items-center justify-between">
				  Methodology
				  <span className="text-xs text-gray-500 dark:text-gray-400 group-open:hidden">Show</span>
				  <span className="text-xs text-gray-500 dark:text-gray-400 hidden group-open:inline">Hide</span>
				</summary>
				<ol className="mt-3 list-decimal ml-5 text-sm space-y-1 text-gray-700 dark:text-gray-300">
				  <li>Daily rate = (annual rate ÷ 365). Accrued between entries = principal × daily rate × days.</li>
				  <li>Payments apply to accrued/unpaid interest first; remainder reduces principal.</li>
				  <li>Expenses increase principal on their effective date; interest is simple (no compounding).</li>
				</ol>
			  </details>
			</div>
		  </div>
		</div>
	  </>
	);
}