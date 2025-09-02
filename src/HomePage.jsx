import React from "react";
import { Link } from "react-router-dom";

export default function HomePage() {
  return (
    <div className="min-h-screen p-8 bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
      <div className="max-w-3xl mx-auto grid gap-6 md:grid-cols-2">
        <Link
          to="/interest-calculator"
          className="rounded-2xl bg-white dark:bg-gray-800 p-6 shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md transition"
        >
          <h2 className="text-xl font-semibold mb-2">Interest Calculator</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Compute interest schedules and export PDFs.
          </p>
        </Link>
        <Link
          to="/case-valuator"
          className="rounded-2xl bg-white dark:bg-gray-800 p-6 shadow-sm border border-gray-200 dark:border-gray-700 hover:shadow-md transition"
        >
          <h2 className="text-xl font-semibold mb-2">Case Valuator</h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Estimate case values quickly and easily.
          </p>
        </Link>
      </div>
    </div>
  );
}
