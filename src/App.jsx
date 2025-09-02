import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import HomePage from "./HomePage";
import InterestCalculator from "../InterestCalculator";
import CaseValuator from "./CaseValuator";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/interest-calculator" element={<InterestCalculator />} />
        <Route path="/case-valuator" element={<CaseValuator />} />
      </Routes>
    </BrowserRouter>
  );
}
