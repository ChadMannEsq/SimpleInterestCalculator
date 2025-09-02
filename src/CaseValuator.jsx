import React from "react";
import { Link } from "react-router-dom";

export default function CaseValuator() {
  return (
    <>
      <header className="sticky top-0 z-30 bg-ink text-white border-b border-black/20">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight">Case Valuator</h1>
          <Link
            to="/"
            className="px-3 py-1.5 rounded-xl border border-white/20 text-sm hover:bg-white/10"
          >
            Home
          </Link>
        </div>
      </header>
      <div className="min-h-screen p-8 bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-100">
        <div className="max-w-3xl mx-auto">
          <p>Coming soon.</p>
        </div>
      </div>
    </>
  );
}
