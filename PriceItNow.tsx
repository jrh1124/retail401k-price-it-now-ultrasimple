import React, { useEffect, useMemo, useState } from "react";

// Retail401k "Price it Now" — V4
// TailwindCSS required for styling
// This version wires REAL fetch() calls to your deployed Vercel API routes
//   /api/price-it-now/request-code
//   /api/price-it-now/verify-code
//   /api/price-it-now/send-quote
//   /api/price-it-now/notify-internal
// Keep your backend already deployed/verified. Squarespace should embed this app via <iframe>.

// ---------------- Config ----------------
const USE_SIMPLE_HUMAN_CHECK = true; // fallback math challenge; set false when you wire real CAPTCHA
const CALENDLY_URL = "https://calendly.com/jheise-1/mep-401k-info-session";

// ---------------- Utils ----------------
const currency = (n) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(isFinite(n) ? n : 0);
const numberFmt = (n) => new Intl.NumberFormat("en-US").format(isFinite(n) ? n : 0);

// ---------------- Pricing Tables & Constants ----------------
const TIERS = [
  { min: 0, max: 1_000_000 - 0.01, rate: 0.006, label: "$0 – $1,000,000", rateLabel: "0.60%" },
  { min: 1_000_000, max: 4_000_000 - 0.01, rate: 0.004, label: "$1,000,000 – $4,000,000", rateLabel: "0.40%" },
  { min: 4_000_000, max: 10_000_000 - 0.01, rate: 0.0037, label: "$4,000,000 – $10,000,000", rateLabel: "0.37%" },
  { min: 10_000_000, max: 20_000_000 - 0.01, rate: 0.0028, label: "$10,000,000 – $20,000,000", rateLabel: "0.28%" },
];
const STATIC_QDIA_RATE = 0.0007; // 0.07%
const STARTUP_ADVISOR_RATE = 0.005; // 0.50%
const TPA_MONTHLY_FEE = 69.99; // per month
const TPA_ANNUAL_FEE = 750;    // discounted annual option
const SETUP_FEE = 750;         // one-time setup (startup only; waived for takeovers)

function getRateForBalance(balance) {
  if (balance >= 20_000_000) return null; // Custom pricing above this
  return TIERS.find((t) => balance >= t.min && balance <= t.max) || TIERS[0];
}

// ---------------- Small verifiable helpers (for tests) ----------------
export function __employeeFee(participants, autoEnrollYes) {
  const p = Number(participants) || 0;
  return p * (autoEnrollYes ? 30 : 40);
}
export function __qdiaFee(base) { return (Number(base) || 0) * STATIC_QDIA_RATE; }
export function __advisorFee(base, isStartup, advisorPct) {
  const b = Number(base) || 0;
  return isStartup ? b * STARTUP_ADVISOR_RATE : b * ((Number(advisorPct) || 0) / 100);
}
// SECURE 2.0 credit helpers
export function __startupCreditCap(nhce) {
  const nh = Math.max(0, Number(nhce) || 0);
  const cap = Math.min(5000, 250 * nh);
  return Math.max(500, cap);
}
export function __contribCreditRate(yearIndex /*0..4*/, totalEmployees) {
  const schedule = [1.0, 1.0, 0.75, 0.5, 0.25];
  const base = schedule[Math.min(4, Math.max(0, yearIndex))];
  const emp = Math.max(1, Math.min(100, Number(totalEmployees) || 1));
  const over = Math.max(0, emp - 50);
  const reduction = over * 0.02; // 2% per employee >50
  return Math.max(0, base - reduction);
}

export function __employerAnnualCostForTest(annualTpaFee, annualEmployeeFee, employerPaysPerParticipant){
  return (Number(annualTpaFee)||0) + ((employerPaysPerParticipant?1:0) ? (Number(annualEmployeeFee)||0) : 0);
}
export function __startupEligibleAdminCostForTest(annualTpaFee, annualEmployeeFee, includeEmpFeeInStartupCredit, employerPaysPerParticipant){
  return (Number(annualTpaFee)||0) + ((includeEmpFeeInStartupCredit && employerPaysPerParticipant) ? (Number(annualEmployeeFee)||0) : 0);
}

export function __employerAnnualCostYForTest(baseEmployerCost, isStartup, year, setupFee = 750){
  return (Number(baseEmployerCost)||0) + ((isStartup && Number(year) === 1) ? (Number(setupFee)||0) : 0);
}

// ---------------- Component ----------------
export default function PriceItNow() {
  // Inputs
  const [hasExisting, setHasExisting] = useState("no");
  const [balance, setBalance] = useState(0);
  const [annualContrib, setAnnualContrib] = useState(0);
  const [eligible, setEligible] = useState(0);
  const [participants, setParticipants] = useState(0);
  const [autoEnrollExisting, setAutoEnrollExisting] = useState("no");
  const [advisorRate, setAdvisorRate] = useState(0); // % for existing plan
  const [tpaBilling, setTpaBilling] = useState("monthly"); // monthly | annual

  // UI state
  const [showSheet, setShowSheet] = useState(false); // results are revealed only after verified contact submission
  const [showContactModal, setShowContactModal] = useState(false);
  const [modalStep, setModalStep] = useState("info"); // "info" | "verify"
  const [sending, setSending] = useState(false);
  const [sentOk, setSentOk] = useState(false);
  const [formErr, setFormErr] = useState("");
  const [contact, setContact] = useState({ firstName: "", lastName: "", company: "", email: "", phone: "" });
  const [analysisSent, setAnalysisSent] = useState(false);
  const [analysisSending, setAnalysisSending] = useState(false);
  const [analysisErr, setAnalysisErr] = useState("");

  // Verification state
  const [verificationId, setVerificationId] = useState("");
  const [code, setCode] = useState("");
  const [codeErr, setCodeErr] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  // Human check (simple math fallback)
  const [humanA, setHumanA] = useState(() => Math.floor(Math.random() * 8) + 1);
  const [humanB, setHumanB] = useState(() => Math.floor(Math.random() * 8) + 1);
  const [humanAnswer, setHumanAnswer] = useState("");
  const humanOk = !USE_SIMPLE_HUMAN_CHECK || Number(humanAnswer) === humanA + humanB;

  useEffect(() => {
    let iv = null;
    if (resendCooldown > 0) iv = setInterval(() => setResendCooldown((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => iv && clearInterval(iv);
  }, [resendCooldown]);

  // Derived
  const tier = useMemo(() => getRateForBalance(Number(balance) || 0), [balance]);
  const assumedAutoEnroll = hasExisting === "yes" ? autoEnrollExisting : "yes"; // SECURE 2.0 assumption for start-ups

  // Fee base: existing = balance + contributions; start-up = contributions only
  const feeBase = useMemo(() => {
    const b = Number(balance) || 0;
    const c = Number(annualContrib) || 0;
    return hasExisting === "yes" ? b + c : c;
  }, [hasExisting, balance, annualContrib]);

  // Annualized fees
  const annualAssetFee    = useMemo(() => (!tier ? null : feeBase * tier.rate), [tier, feeBase]);
  const annualEmployeeFee = useMemo(() => __employeeFee(participants, assumedAutoEnroll === "yes"), [participants, assumedAutoEnroll]);
  const annualQdiaFee     = useMemo(() => __qdiaFee(feeBase), [feeBase]);
  const annualAdvisorFee  = useMemo(() => __advisorFee(feeBase, hasExisting === "no", advisorRate), [feeBase, hasExisting, advisorRate]);
  const annualTpaFee      = useMemo(() => (tpaBilling === "annual" ? TPA_ANNUAL_FEE : TPA_MONTHLY_FEE * 12), [tpaBilling]);

  const totalAnnualCost = useMemo(
    () => (annualAssetFee || 0) + annualEmployeeFee + annualQdiaFee + annualAdvisorFee + annualTpaFee,
    [annualAssetFee, annualEmployeeFee, annualQdiaFee, annualAdvisorFee, annualTpaFee]
  );

  const percentOfBase = (fee) => (!feeBase ? "0.00%" : ((fee / feeBase) * 100).toFixed(2) + "%");
  const totalPercentage = useMemo(() => (!feeBase ? 0 : ((totalAnnualCost / feeBase) * 100).toFixed(2)), [totalAnnualCost, feeBase]);

  const canContinue = useMemo(
    () => eligible >= 0 && participants >= 0 && (hasExisting === "yes" ? Number(balance) >= 0 : true),
    [eligible, participants, hasExisting, balance]
  );

  // ---------- Email payload + flow ----------
  function buildCalcHtml(creditsHtml = "") {
    const lines = [];
    const planType = hasExisting === "yes" ? "Existing 401(k) Plan" : "Start‑up 401(k) Plan";
    const advLabel = hasExisting === "no" ? "0.50% startup" : String(advisorRate || 0) + "%";
    lines.push("<h2>Retail401k Cost Sheet</h2>");
    lines.push(`<p><strong>Plan Type:</strong> ${planType}</p>`);
    lines.push(`<p><strong>Auto-Enrollment:</strong> ${assumedAutoEnroll === 'yes' ? 'Yes' : 'No'}</p>`);
    lines.push(`<p><strong>Eligible Employees:</strong> ${numberFmt(eligible)}</p>`);
    lines.push(`<p><strong>Expected Participants:</strong> ${numberFmt(participants)}</p>`);
    lines.push("<hr/>");
    if (hasExisting === "yes") {
      lines.push(`<p><strong>Current Balance:</strong> ${currency(Number(balance) || 0)}</p>`);
      lines.push(`<p><strong>Projected Contributions:</strong> ${currency(Number(annualContrib) || 0)}</p>`);
      lines.push(`<p><strong>Fee Base (balance + contributions):</strong> ${currency(feeBase)}</p>`);
    } else {
      lines.push(`<p><strong>Estimated First-year Contributions:</strong> ${currency(Number(annualContrib) || 0)}</p>`);
      lines.push(`<p><strong>Fee Base:</strong> ${currency(feeBase)}</p>`);
    }
    lines.push("<ul>");
    if (tier) lines.push(`<li>Asset-based fee ${tier.rateLabel}: ${currency(annualAssetFee)}</li>`);
    lines.push(`<li>QDIA fee (0.07%): ${currency(annualQdiaFee)}</li>`);
    lines.push(`<li>Advisor fee (${advLabel}): ${currency(annualAdvisorFee)}</li>`);
    lines.push(`<li>Employee fee (${assumedAutoEnroll === 'yes' ? '$30' : '$40'} × participants): ${currency(annualEmployeeFee)}</li>`);
    lines.push(`<li>TPA/3(16) Admin/Compliance: ${currency(annualTpaFee)}</li>`);
    lines.push(`<li>One-time setup fee (Year 1 only): ${hasExisting === 'yes' ? 'Waived' : currency(SETUP_FEE)}</li>`);
    lines.push("</ul>");
    const totalPct = hasExisting === "yes" && feeBase > 0 ? ` (${totalPercentage}% of fee base)` : "";
    lines.push(`<p><strong>Total Annual Cost:</strong> ${currency(totalAnnualCost)}${totalPct}</p>`);
    if (hasExisting === "yes") {
      lines.push("<hr/>");
      lines.push("<h3>Complimentary cost/benefit analysis</h3>");
      lines.push("<p>Compare your current plan with the <strong>Retail401k MEP 401(k)</strong>. We’ll provide a detailed analysis at no cost.</p>");
      lines.push("<ul><li>Transparent all‑in fee comparison (recordkeeping, advisory, investment, per‑participant).</li><li>Fiduciary scope & responsibilities (3(16) administration, 3(38) investment management).</li><li>Participant experience: auto‑enrollment, QDIA, education & support.</li><li>Investment lineup & average expense ratios (including QDIA).</li><li>Administrative workload & vendor coordination.</li><li>Transition plan (timeline, blackout period, required data).</li></ul>");
    }
    lines.push(`<p><a href="${CALENDLY_URL}" target="_blank" rel="noopener noreferrer">Schedule a call</a></p>`);
    if (creditsHtml) {
      lines.push("<hr/>");
      lines.push(creditsHtml);
    }
    lines.push("<hr/>");
    lines.push('<div style="font-size:12px;color:#475569"><p><strong>Important:</strong> This cost sheet is for educational purposes only and does not constitute tax, legal, or accounting advice. Eligibility for any credits depends on your specific circumstances and applicable law. Consult a qualified tax professional to determine how (and whether) SECURE 2.0 credits apply to you. Calculations are estimates and subject to change.</p></div>');
    return lines.join("");
  }

  // ----- Contact + verification -----
  async function requestVerificationCode() {
    setSending(true);
    setFormErr("");
    try {
      const payload = { email: contact.email, contact };
      const res = await doPost("/api/price-it-now/request-code", payload);
      setVerificationId(res?.verificationId || "ver-id");
      setModalStep("verify");
      setResendCooldown(30);
      setCode("");
      setCodeErr("");
    } catch (e) {
      setFormErr("We couldn't send a verification code. Please try again.");
    } finally {
      setSending(false);
    }
  }

  async function verifyCodeAndReveal() {
    setSending(true);
    setCodeErr("");
    try {
      if (!/^\d{4,8}$/.test(code)) {
        setCodeErr("Enter the code we emailed to you.");
        setSending(false);
        return;
      }
      await doPost("/api/price-it-now/verify-code", { verificationId, email: contact.email, code });
      await sendEmailsAndReveal();
    } catch (e) {
      setCodeErr("That code didn’t match. Please try again or resend.");
    } finally {
      setSending(false);
    }
  }

  async function resendCode() {
    if (resendCooldown > 0) return;
    try {
      await doPost("/api/price-it-now/request-code", { email: contact.email, contact });
      setResendCooldown(30);
    } catch {
      // ignore
    }
  }

  async function sendEmailsAndReveal(creditsHtml = "") {
    setSending(true);
    setFormErr("");
    try {
      const calcHtml = buildCalcHtml(creditsHtml);
      const payload = {
        timestamp: new Date().toISOString(),
        sendTo: contact.email,            // user copy
        notifyTo: "team@retail401k.com", // internal notification
        contact,
        inputs: { hasExisting, balance: Number(balance)||0, annualContrib: Number(annualContrib)||0, eligible, participants, autoEnroll: assumedAutoEnroll, advisorRate: hasExisting === "no" ? 0.5 : Number(advisorRate||0), tpaBilling },
        feeBase,
        calculations: {
          tier: tier ? { label: tier.label, rateLabel: tier.rateLabel, rate: tier.rate } : null,
          annualAssetFee: annualAssetFee ?? 0,
          annualEmployeeFee,
          annualQdiaFee,
          annualAdvisorFee,
          annualTpaFee,
          totalAnnualCost,
          totalPercentage: hasExisting === "yes" ? Number(totalPercentage || 0) : null,
        },
        calcHtml,
      };
      await doPost("/api/price-it-now/send-quote", payload);
      await doPost("/api/price-it-now/notify-internal", payload);
      setSentOk(true);
      setShowContactModal(false);
      setShowSheet(true); // Reveal calculation after email verification + submission (required)
    } catch (e) {
      setFormErr("We couldn't send your request. Please try again.");
    } finally {
      setSending(false);
    }
  }

  function openContactModal() {
    setShowContactModal(true);
    setModalStep("info");
    setSentOk(false);
    setFormErr("");
    setCode("");
    setCodeErr("");
    setHumanA(Math.floor(Math.random() * 8) + 1);
    setHumanB(Math.floor(Math.random() * 8) + 1);
    setHumanAnswer("");
  }

  async function handleInfoContinue() {
    setFormErr("");
    if (!contact.firstName || !contact.lastName || !contact.company || !contact.email) {
      setFormErr("Please complete all required fields.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
      setFormErr("Please enter a valid email address.");
      return;
    }
    if (!humanOk) {
      setFormErr("Please complete the human check.");
      return;
    }
    await requestVerificationCode();
  }

  async function handleEmailToSelf() {
    if (!contact.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
      openContactModal();
      return;
    }
    await sendEmailsAndReveal();
  }

  // Clear all inputs & UI state
  function resetAll() {
    // Core inputs
    setHasExisting("no");
    setBalance(0);
    setAnnualContrib(0);
    setEligible(0);
    setParticipants(0);
    setAutoEnrollExisting("no");
    setAdvisorRate(0);
    setTpaBilling("monthly");

    // Results & modals
    setShowSheet(false);
    setShowContactModal(false);
    setModalStep("info");

    // Contact & sending
    setSending(false);
    setSentOk(false);
    setFormErr("");
    setContact({ firstName: "", lastName: "", company: "", email: "", phone: "" });

    // Analysis CTA state
    setAnalysisSent(false);
    setAnalysisSending(false);
    setAnalysisErr("");

    // Verification
    setVerificationId("");
    setCode("");
    setCodeErr("");
    setResendCooldown(0);

    // Human check
    setHumanA(Math.floor(Math.random() * 8) + 1);
    setHumanB(Math.floor(Math.random() * 8) + 1);
    setHumanAnswer("");

    // SECURE 2.0 assumptions
    setCreditsOn(false);
    setEmployerPaysPerParticipant(true);
    setIncludeEmpFeeInStartupCredit(true);
    setTotalEmployees(0);
    setNhceEligible(0);
    setWillContribute(false);
    setContribEligibleCount(0);
    setAvgContribPerEmp(0);
  }

  // Generic POST helper to your API routes
  async function doPost(path, data) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data || {}),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(txt || `HTTP ${res.status}`);
    }
    const ct = res.headers.get("content-type") || "";
    if (ct.includes("application/json")) return await res.json();
    return {};
  }

  async function handleRequestAnalysis() {
    setAnalysisSending(true);
    setAnalysisErr("");
    try {
      const payload = {
        timestamp: new Date().toISOString(),
        type: "complimentary_analysis_request",
        notifyTo: "team@retail401k.com",
        contact,
        inputs: { hasExisting, balance: Number(balance)||0, annualContrib: Number(annualContrib)||0, eligible, participants, autoEnroll: assumedAutoEnroll, advisorRate: hasExisting === "no" ? 0.5 : Number(advisorRate||0), tpaBilling },
        feeBase,
      };
      await doPost("/api/price-it-now/notify-internal", payload);
      setAnalysisSent(true);
    } catch (e) {
      setAnalysisErr("We couldn't submit your request. Please try again.");
    } finally {
      setAnalysisSending(false);
    }
  }

  // ---------------- SECURE 2.0 Credits (startup only) ----------------
  const isStartup = hasExisting === "no";
  const [creditsOn, setCreditsOn] = useState(false);
  const [employerPaysPerParticipant, setEmployerPaysPerParticipant] = useState(true);
  const [includeEmpFeeInStartupCredit, setIncludeEmpFeeInStartupCredit] = useState(true);
  const [totalEmployees, setTotalEmployees] = useState(eligible || 0); // employees with >=$5k comp
  const [nhceEligible, setNhceEligible] = useState(eligible || 0); // estimated NHCEs eligible to participate
  const [willContribute, setWillContribute] = useState(false);
  const [contribEligibleCount, setContribEligibleCount] = useState(participants || 0); // <=$100k comp
  const [avgContribPerEmp, setAvgContribPerEmp] = useState(0);

  useEffect(() => {
    setTotalEmployees(eligible || 0);
    setNhceEligible(eligible || 0);
    setContribEligibleCount(participants || 0);
  }, [eligible, participants]);

  const employerAnnualCostBase = useMemo(() => {
    // Employer pays only TPA admin + optional per‑participant; participants pay asset, QDIA, advisor
    return annualTpaFee + (employerPaysPerParticipant ? annualEmployeeFee : 0);
  }, [annualTpaFee, employerPaysPerParticipant, annualEmployeeFee]);

  // Eligible admin cost for startup credit (assumption: admin/recordkeeping + optional per‑participant)
  const startupEligibleAdminCost = useMemo(() => {
    const admin = annualTpaFee + (includeEmpFeeInStartupCredit && employerPaysPerParticipant ? annualEmployeeFee : 0);
    return admin;
  }, [annualTpaFee, annualEmployeeFee, includeEmpFeeInStartupCredit, employerPaysPerParticipant]);

  const startupCreditPercent = useMemo(() => (totalEmployees <= 50 ? 1 : totalEmployees <= 100 ? 0.5 : 0), [totalEmployees]);
  const startupCreditCap = useMemo(() => __startupCreditCap(nhceEligible), [nhceEligible]);
  const startupCreditYear = useMemo(() => Math.min(startupEligibleAdminCost * startupCreditPercent, startupCreditCap), [startupEligibleAdminCost, startupCreditPercent, startupCreditCap]);
  const autoEnrollCreditYear = 500; // $500 for 3 years

  // Employer contribution credit per year (array of 5 years)
  const contribCreditByYear = useMemo(() => {
    if (!willContribute) return [0,0,0,0,0];
    const perEmpEligible = Math.min(1000, Math.max(0, Number(avgContribPerEmp) || 0));
    const base = perEmpEligible * Math.max(0, Number(contribEligibleCount) || 0);
    const rates = [0,1,2,3,4].map((i) => __contribCreditRate(i, totalEmployees));
    return rates.map((r) => base * r);
  }, [willContribute, avgContribPerEmp, contribEligibleCount, totalEmployees]);

  // Build 5‑year grid
  const fiveYearRows = useMemo(() => {
    const arr = [];
    for (let y = 1; y <= 5; y++) {
      const idx = y - 1;
      const employerCostY = employerAnnualCostBase + (isStartup && y === 1 ? SETUP_FEE : 0);
      // Year-specific eligible admin cost for startup credit (includes setup only in Y1)
      const eligibleAdminY = startupEligibleAdminCost + (isStartup && y === 1 ? SETUP_FEE : 0);
      const scPercent = startupCreditPercent;
      const scCap = startupCreditCap;
      const startupCreditY = y <= 3 ? Math.min(eligibleAdminY * scPercent, scCap) : 0;
      const autoEnrollY = y <= 3 ? autoEnrollCreditYear : 0;
      const contribY = contribCreditByYear[idx] || 0;
      const credits = startupCreditY + autoEnrollY + contribY;
      const net = Math.max(0, employerCostY - credits);
      arr.push({
        year: `Year ${y}`,
        employerAnnualCost: employerCostY,
        startupCredit: startupCreditY,
        autoEnrollCredit: autoEnrollY,
        contribCredit: contribY,
        totalCredits: credits,
        netCost: net,
      });
    }
    return arr;
  }, [employerAnnualCostBase, startupEligibleAdminCost, startupCreditPercent, startupCreditCap, autoEnrollCreditYear, contribCreditByYear, isStartup]);

  const creditsHtmlBlock = useMemo(() => {
    if (!creditsOn || !isStartup) return "";
    const rows = fiveYearRows.map(r => `<tr><td>${r.year}</td><td>${currency(r.employerAnnualCost)}</td><td>${currency(r.startupCredit)}</td><td>${currency(r.autoEnrollCredit)}</td><td>${currency(r.contribCredit)}</td><td>${currency(r.totalCredits)}</td><td><strong>${currency(r.netCost)}</strong></td></tr>`).join("");
    return `
      <h3>SECURE 2.0 — Estimated Tax Credits (Start‑up)</h3>
      <p><em>Assumptions:</em> Employees: ${numberFmt(totalEmployees)}; NHCEs: ${numberFmt(nhceEligible)}; Employer pays per‑participant: ${employerPaysPerParticipant ? 'Yes' : 'No'}; Include per‑participant in startup credit: ${includeEmpFeeInStartupCredit ? 'Yes' : 'No'}; ${willContribute ? `Avg employer contribution per eligible employee: ${currency(avgContribPerEmp)} for ${numberFmt(contribEligibleCount)} employees.` : 'No employer contributions assumed.'} Asset‑based, QDIA investment, and Financial Advisor fees are assumed participant‑paid and excluded from employer cost and startup credit eligibility. The one‑time setup fee (${currency(SETUP_FEE)}) is included in employer cost and startup credit eligibility in Year 1 only.</p>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:12px">
        <thead><tr><th>Year</th><th>Employer Cost</th><th>Startup Credit</th><th>Auto‑Enroll Credit</th><th>Employer Contrib Credit</th><th>Total Credits</th><th>Net Cost</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }, [creditsOn, isStartup, fiveYearRows, totalEmployees, nhceEligible, employerPaysPerParticipant, includeEmpFeeInStartupCredit, willContribute, avgContribPerEmp, contribEligibleCount]);

  // ---------------- Render ----------------
  return (
    <div className="min-h-screen bg-slate-50 py-10">
      <div className="mx-auto max-w-5xl px-4">
        <header className="mb-8 flex items-center justify-between print:hidden">
          <h1 className="text-3xl font-semibold tracking-tight">Price it Now</h1>
          {showSheet && (
            <div className="flex items-center gap-2">
              <button onClick={() => window.print()} className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-1.5 text-sm shadow-sm hover:bg-white">Print</button>
              <button onClick={() => sendEmailsAndReveal(creditsHtmlBlock)} className="inline-flex items-center rounded-2xl border border-blue-600 text-blue-600 px-3 py-1.5 text-sm shadow-sm hover:bg-blue-50">Email me a copy</button>
            </div>
          )}
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          {/* INPUT CARD */}
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 className="mb-4 text-xl font-medium">Tell us about your plan</h2>
            <div className="space-y-5">
              {/* Existing plan? */}
              <div>
                <label className="mb-2 block text-sm font-medium">Do you have an existing retirement plan?</label>
                <div className="flex gap-3">
                  {[{ id: "existing-no", label: "No" }, { id: "existing-yes", label: "Yes" }].map((opt) => (
                    <label key={opt.id} htmlFor={opt.id} className={`cursor-pointer rounded-xl border px-4 py-2 text-sm shadow-sm transition ${hasExisting === opt.label.toLowerCase() ? "border-blue-600 ring-2 ring-blue-200" : "border-slate-300 hover:bg-slate-50"}`}>
                      <input id={opt.id} type="radio" className="sr-only" name="hasExisting" value={opt.label.toLowerCase()} checked={hasExisting === opt.label.toLowerCase()} onChange={(e) => setHasExisting(e.target.value)} />
                      {opt.label}
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-500">If you select "No", we'll treat this as a start‑up 401(k) plan and assume auto‑enrollment per SECURE 2.0.</p>
              </div>

              {/* Balance (existing only) */}
              {hasExisting === "yes" && (
                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor="balance">Current plan balance</label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                    <input id="balance" type="number" min={0} step="1000" placeholder="0" value={balance} onChange={(e) => setBalance(e.target.value)} className="w-full rounded-xl border border-slate-300 px-8 py-2 shadow-sm focus:border-blue-600 focus:outline-none" />
                  </div>
                </div>
              )}

              {/* Annual contributions */}
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="annualContrib">{hasExisting === "yes" ? "Projected annual contributions" : "Estimated first‑year contributions"}</label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                  <input id="annualContrib" type="number" min={0} step="1000" placeholder="0" value={annualContrib} onChange={(e) => setAnnualContrib(e.target.value)} className="w-full rounded-xl border border-slate-300 px-8 py-2 shadow-sm focus:border-blue-600 focus:outline-none" />
                </div>
              </div>

              {/* Eligible employees */}
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="eligible">How many eligible employees will there be?</label>
                <input id="eligible" type="number" min={0} value={eligible} onChange={(e) => setEligible(Number(e.target.value))} className="w-full rounded-xl border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-600 focus:outline-none" />
              </div>

              {/* Participants */}
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="participants">How many employees will participate? (estimate is OK)</label>
                <input id="participants" type="number" min={0} value={participants} onChange={(e) => setParticipants(Number(e.target.value))} className="w-full rounded-xl border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-600 focus:outline-none" />
              </div>

              {/* Auto‑enrollment */}
              {hasExisting === "yes" && (
                <div>
                  <label className="mb-2 block text-sm font-medium">Do you offer Auto‑Enrollment today?</label>
                  <div className="flex gap-3">
                    {["no", "yes"].map((v) => (
                      <label key={v} className={`cursor-pointer rounded-xl border px-4 py-2 text-sm shadow-sm transition ${autoEnrollExisting === v ? "border-blue-600 ring-2 ring-blue-200" : "border-slate-300 hover:bg-slate-50"}`}>
                        <input type="radio" name="ae" className="sr-only" value={v} checked={autoEnrollExisting === v} onChange={(e) => setAutoEnrollExisting(e.target.value)} />
                        {v === "yes" ? "Yes" : "No"}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Advisor compensation (existing only) */}
              {hasExisting === "yes" && (
                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor="advisorRate">Current Financial Advisor Compensation (% of assets)</label>
                  <input id="advisorRate" type="number" min={0} step="0.01" placeholder="0.00" value={advisorRate} onChange={(e) => setAdvisorRate(e.target.value)} className="w-full rounded-xl border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-600 focus:outline-none" />
                </div>
              )}

              {/* TPA Billing Preference */}
              <div>
                <label className="mb-2 block text-sm font-medium">TPA/3(16) Billing Preference</label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: "tpa-monthly", label: `Monthly (${currency(TPA_MONTHLY_FEE)}/mo)`, value: "monthly" },
                    { id: "tpa-annual", label: `Annual (${currency(TPA_ANNUAL_FEE)}/yr, saves ${currency(TPA_MONTHLY_FEE*12 - TPA_ANNUAL_FEE)})`, value: "annual" },
                  ].map((opt) => (
                    <label key={opt.id} htmlFor={opt.id} className={`cursor-pointer rounded-xl border px-4 py-2 text-sm shadow-sm transition ${tpaBilling === opt.value ? "border-blue-600 ring-2 ring-blue-200" : "border-slate-300 hover:bg-slate-50"}`}>
                      <input id={opt.id} type="radio" className="sr-only" name="tpaBilling" value={opt.value} checked={tpaBilling === opt.value} onChange={(e) => setTpaBilling(e.target.value)} />
                      {opt.label}
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-slate-500">Discounts apply if paid annually.</p>
              </div>

              {/* Action: require contact to view results */}
              <div className="pt-2">
                <button
                  disabled={!canContinue}
                  onClick={openContactModal}
                  className={`w-full rounded-2xl px-4 py-3 text-center text-sm font-medium shadow-sm transition ${canContinue ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-slate-200 text-slate-500"}`}
                > Submit</button>
                <button type="button" onClick={resetAll} className="mt-2 w-full rounded-2xl px-4 py-3 text-center text-sm font-medium shadow-sm ring-1 ring-slate-300 text-slate-700 hover:bg-slate-50">Clear inputs</button>
              </div>
            </div>
          </section>

          {/* OUTPUT CARD */}
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-medium">Your cost sheet</h2>
              {showSheet && (
                <div className="flex items-center gap-2">
                  <button onClick={() => window.print()} className="inline-flex items-center rounded-xl border border-slate-300 px-3 py-1.5 text-xs shadow-sm hover:bg-slate-50 print:hidden">Print</button>
                  <button onClick={() => sendEmailsAndReveal(creditsHtmlBlock)} className="inline-flex items-center rounded-xl border border-blue-600 text-blue-600 px-3 py-1.5 text-xs shadow-sm hover:bg-blue-50 print:hidden">Email me a copy</button>
                </div>
              )}
            </div>

            {!showSheet ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-6 text-slate-500">
                Your cost sheet will appear here.
              </div>
            ) : (
              <div className="space-y-6">
                {/* Summary */}
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs uppercase tracking-wider text-slate-500">Plan Type</p><p className="text-sm font-medium">{hasExisting === "yes" ? "Existing 401(k) Plan" : "Start‑up 401(k) Plan"}</p></div>
                  <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs uppercase tracking-wider text-slate-500">Auto‑Enrollment</p><p className="text-sm font-medium">{assumedAutoEnroll === "yes" ? "Yes" : "No"}{hasExisting === "no" && (<span className="ml-2 text-xs text-slate-500">(Assumed per SECURE 2.0)</span>)}</p></div>
                  <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs uppercase tracking-wider text-slate-500">Eligible Employees</p><p className="text-sm font-medium">{numberFmt(eligible)}</p></div>
                  <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs uppercase tracking-wider text-slate-500">Expected Participants</p><p className="text-sm font-medium">{numberFmt(participants)}</p></div>
                </div>

                {/* Asset Charge Schedule */}
                <div className="rounded-2xl border border-slate-200">
                  <div className="border-b px-4 py-3"><p className="text-sm font-medium">Contract Asset Charge</p><p className="text-xs text-slate-500">Based on total contract balance</p></div>
                  <div className="divide-y">
                    {TIERS.map((t, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-3"><div className="text-sm">{t.label}</div><div className="text-sm font-medium">{t.rateLabel}</div></div>
                    ))}
                    <div className="flex items-center justify-between px-4 py-3"><div className="text-sm">$20,000,000+</div><div className="text-sm font-medium">Custom</div></div>
                  </div>
                </div>

                {/* Fee base explanation */}
                <div className="rounded-xl bg-slate-50 p-4 text-sm">
                  {hasExisting === "yes" ? (
                    <>
                      <p>Current balance: <span className="font-medium">{currency(Number(balance) || 0)}</span></p>
                      <p>Projected contributions: <span className="font-medium">{currency(Number(annualContrib) || 0)}</span></p>
                      <p>Fee base (balance + contributions): <span className="font-semibold">{currency(feeBase)}</span></p>
                    </>
                  ) : (
                    <>
                      <p>Estimated first‑year contributions: <span className="font-medium">{currency(Number(annualContrib) || 0)}</span></p>
                      <p>Fee base: <span className="font-semibold">{currency(feeBase)}</span></p>
                    </>
                  )}
                </div>

                {/* Calculation & (percentages hidden for startups) */}
                <div className="rounded-2xl bg-slate-50 p-4 space-y-2 text-sm">
                  {tier ? (
                    <div>
                      Asset‑based fee (@ {tier.rateLabel}): <span className="font-semibold">{currency(annualAssetFee)}</span>
                      {hasExisting === "yes" && <span className="ml-2 text-xs text-slate-600">({percentOfBase(annualAssetFee)})</span>}
                    </div>
                  ) : (
                    <div className="text-sm">For balances of $20,000,000 or more, pricing is custom. Please contact us for a tailored proposal.</div>
                  )}

                  <div>
                    QDIA investment fee (0.07%): <span className="font-semibold">{currency(annualQdiaFee)}</span>
                    {hasExisting === "yes" && <span className="ml-2 text-xs text-slate-600">({percentOfBase(annualQdiaFee)})</span>}
                  </div>

                  <div>
                    Financial Advisor fee ({hasExisting === "no" ? "0.50% startup" : String(advisorRate || 0) + "%"}): <span className="font-semibold">{currency(annualAdvisorFee)}</span>
                    {hasExisting === "yes" && <span className="ml-2 text-xs text-slate-600">({percentOfBase(annualAdvisorFee)})</span>}
                  </div>

                  <div>
                    Active employee fee ({assumedAutoEnroll === "yes" ? "$30" : "$40"} × participants): <span className="font-semibold">{currency(annualEmployeeFee)}</span>
                    {hasExisting === "yes" && <span className="ml-2 text-xs text-slate-600">({percentOfBase(annualEmployeeFee)})</span>}
                  </div>

                  <div>
                    TPA/3(16) Admin/Compliance fee: <span className="font-semibold">{currency(annualTpaFee)}</span>
                    {hasExisting === "yes" && <span className="ml-2 text-xs text-slate-600">({percentOfBase(annualTpaFee)})</span>}
                    <span className="ml-2 text-xs text-slate-500">{tpaBilling === "monthly" ? `(billed ${currency(TPA_MONTHLY_FEE)}/month)` : `(prepaid annually, saves ${currency(TPA_MONTHLY_FEE*12 - TPA_ANNUAL_FEE)})`}</span>
                  </div>

                  <div>
                    One-time setup fee (Year 1 only): <span className="font-semibold">{hasExisting === "yes" ? "Waived" : currency(SETUP_FEE)}</span>
                  </div>

                  <div className="font-medium border-t pt-2 mt-2">
                    Total Annual Cost: <span className="font-semibold">{currency(totalAnnualCost)}</span>
                    {hasExisting === "yes" && feeBase > 0 && (
                      <span className="ml-2 text-slate-600">({totalPercentage}% of fee base)</span>
                    )}
                  </div>
                </div>

                {/* SECURE 2.0 Credits (startup only) */}
                {isStartup && (
                  <section className="rounded-2xl border border-blue-100 bg-blue-50 p-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium text-blue-900">Estimate your net cost with SECURE 2.0 tax credits?</h3>
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input type="checkbox" className="h-4 w-4" checked={creditsOn} onChange={(e) => setCreditsOn(e.target.checked)} />
                        Include credits
                      </label>
                    </div>

                    {creditsOn && (
                      <div className="mt-3 grid gap-3">
                        <p className="text-[11px] text-slate-600">Assumption: Asset‑based, QDIA investment, and Financial Advisor fees are participant‑paid and excluded from employer cost and start‑up credit eligibility.</p>
                        <div className="grid gap-3 md:grid-cols-3">
                          <div>
                            <label className="text-xs text-slate-700" htmlFor="empCount">Employees (comp ≥ $5,000)</label>
                            <input id="empCount" type="number" min={1} max={100} value={totalEmployees} onChange={(e)=>setTotalEmployees(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" />
                          </div>
                          <div>
                            <label className="text-xs text-slate-700" htmlFor="nhce">NHCEs eligible to participate</label>
                            <input id="nhce" type="number" min={0} value={nhceEligible} onChange={(e)=>setNhceEligible(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" />
                          </div>
                          <div>
                            <label className="text-xs text-slate-700">Employer pays per‑participant fee?</label>
                            <div className="mt-1 flex gap-2">
                              {['yes','no'].map(v=> (
                                <label key={v} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs ${ (employerPaysPerParticipant === (v==='yes')) ? 'border-blue-600 ring-2 ring-blue-200' : 'border-slate-300' }`}>
                                  <input className="sr-only" type="radio" name="paypp" value={v} checked={employerPaysPerParticipant === (v==='yes')} onChange={()=>setEmployerPaysPerParticipant(v==='yes')} />{v==='yes'?'Yes':'No'}
                                </label>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-3">
                          <div>
                            <label className="text-xs text-slate-700">Include per‑participant fee in startup credit?</label>
                            <div className="mt-1 flex gap-2">
                              {['yes','no'].map(v=> (
                                <label key={v} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs ${ (includeEmpFeeInStartupCredit === (v==='yes')) ? 'border-blue-600 ring-2 ring-blue-200' : 'border-slate-300' }`}>
                                  <input className="sr-only" type="radio" name="incpp" value={v} checked={includeEmpFeeInStartupCredit === (v==='yes')} onChange={()=>setIncludeEmpFeeInStartupCredit(v==='yes')} />{v==='yes'?'Yes':'No'}
                                </label>
                              ))}
                            </div>
                          </div>
                          <div>
                            <label className="text-xs text-slate-700">Provide employer contributions?</label>
                            <div className="mt-1 flex gap-2">
                              {['no','yes'].map(v=> (
                                <label key={v} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs ${ (willContribute === (v==='yes')) ? 'border-blue-600 ring-2 ring-blue-200' : 'border-slate-300' }`}>
                                  <input className="sr-only" type="radio" name="willc" value={v} checked={willContribute === (v==='yes')} onChange={()=>setWillContribute(v==='yes')} />{v==='yes'?'Yes':'No'}
                                </label>
                              ))}
                            </div>
                          </div>
                        </div>

                        {willContribute && (
                          <div className="grid gap-3 md:grid-cols-3">
                            <div>
                              <label className="text-xs text-slate-700" htmlFor="contribCnt">Employees eligible for contribution credit (≤$100k comp)</label>
                              <input id="contribCnt" type="number" min={0} value={contribEligibleCount} onChange={(e)=>setContribEligibleCount(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" />
                            </div>
                            <div>
                              <label className="text-xs text-slate-700" htmlFor="avgContrib">Avg employer contribution per eligible employee (annual)</label>
                              <div className="relative">
                                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                                <input id="avgContrib" type="number" min={0} step="50" value={avgContribPerEmp} onChange={(e)=>setAvgContribPerEmp(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-slate-300 px-8 py-2" />
                              </div>
                              <p className="mt-1 text-[11px] text-slate-500">Credit applies up to $1,000 per employee; phased 100%/100%/75%/50%/25% (reduced for 51–100 employees).</p>
                            </div>
                          </div>
                        )}

                        {/* Five‑year grid */}
                        <div className="mt-3 overflow-x-auto">
                          <table className="w-full text-sm border-collapse">
                            <thead>
                              <tr className="border-b">
                                <th className="px-2 py-2 text-left">Year</th>
                                <th className="px-2 py-2 text-right">Employer Cost</th>
                                <th className="px-2 py-2 text-right">Startup Credit</th>
                                <th className="px-2 py-2 text-right">Auto‑Enroll Credit</th>
                                <th className="px-2 py-2 text-right">Contribution Credit</th>
                                <th className="px-2 py-2 text-right">Total Credits</th>
                                <th className="px-2 py-2 text-right">Net Cost</th>
                              </tr>
                            </thead>
                            <tbody>
                              {fiveYearRows.map((r, i) => (
                                <tr key={i} className="border-b last:border-0">
                                  <td className="px-2 py-1">{r.year}</td>
                                  <td className="px-2 py-1 text-right">{currency(r.employerAnnualCost)}</td>
                                  <td className="px-2 py-1 text-right">{currency(r.startupCredit)}</td>
                                  <td className="px-2 py-1 text-right">{currency(r.autoEnrollCredit)}</td>
                                  <td className="px-2 py-1 text-right">{currency(r.contribCredit)}</td>
                                  <td className="px-2 py-1 text-right">{currency(r.totalCredits)}</td>
                                  <td className="px-2 py-1 text-right font-semibold">{currency(r.netCost)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <p className="text-[11px] text-slate-500">These tax credit estimates are for educational purposes only, based on current public guidance and your inputs. They do <em>not</em> constitute tax or legal advice. Consult a qualified tax professional to determine eligibility and how any credits apply to your circumstances.</p>
                      </div>
                    )}
                  </section>
                )}

                {/* Complimentary analysis CTA (existing plans only; after verification) */}
                {hasExisting === "yes" && showSheet && (
                  <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                    <h3 className="text-sm font-medium text-emerald-900">Complimentary cost/benefit analysis of your current plan</h3>
                    <p className="mt-1 text-sm text-emerald-900/80">Compare your current plan with the <span className="font-semibold">Retail401k MEP 401(k)</span>. We’ll provide a detailed analysis at no cost.</p>
                    <ul className="mt-2 text-xs text-emerald-900/90 list-disc pl-5 space-y-1">
                      <li>Transparent all‑in fee comparison (recordkeeping, advisory, investment, per‑participant).</li>
                      <li>Fiduciary scope & responsibilities (3(16) administration, 3(38) investment management).</li>
                      <li>Participant experience: auto‑enrollment, QDIA, education & support.</li>
                      <li>Investment lineup & average expense ratios (including QDIA).</li>
                      <li>Administrative workload & vendor coordination.</li>
                      <li>Transition plan (timeline, blackout period, required data).</li>
                    </ul>
                    {analysisErr && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{analysisErr}</div>}
                    <div className="mt-3">
                      <a href={CALENDLY_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center rounded-2xl px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700">
                        Schedule a call
                      </a>
                    </div>
                  </section>
                )}

                {/* Disclosures (collapsible on-screen, visible when printed) */}
                <details className="print:hidden rounded-xl border border-slate-200 p-4 bg-white">
                  <summary className="cursor-pointer select-none text-sm font-medium">Disclosures</summary>
                  <div className="mt-2 text-xs text-slate-600 space-y-2">
                    <p>This calculator is for educational and illustrative purposes only and does not constitute tax, legal, or accounting advice. Calculations are estimates, not guarantees, and additional fees may apply. Past performance is not indicative of future results. Please consult a qualified tax professional (and your legal/financial advisors) to determine eligibility and applicability of any credits to your situation.</p>
                    <p>Recordkeeping services provided by Transamerica Retirement Services. 3(38) Fiduciary Services provided by Atlas Fiduciary Services, Inc., an SEC registered Investment Advisor. 3(16) Services provided by Atlas Pension Administrators, Inc. Costs associated with these services are included in the recordkeeping asset fees described above. Investment Advisor Fees are a separate engagement between the adopting employer and the advisor or advisor's firm.</p>
                    <p>TPA/3(16) Plan Administration/Compliance Fee is billed directly to the employer. Discounts apply if paid annually. Annual billable of $750 if preferred.</p>
                  </div>
                </details>
                <div className="hidden print:block text-[11px] leading-snug text-slate-700 space-y-1">
                  <p><strong>Assumption:</strong> Asset-based, QDIA investment, and Financial Advisor fees are participant-paid and excluded from employer cost and start-up credit eligibility.</p>
                  <p><strong>Disclosures:</strong> This calculator is for educational and illustrative purposes only and does not constitute tax, legal, or accounting advice. Calculations are estimates, not guarantees, and additional fees may apply. Past performance is not indicative of future results. Please consult a qualified tax professional (and your legal/financial advisors) to determine eligibility and applicability of any credits to your situation.</p>
                  <p>Recordkeeping services provided by Transamerica Retirement Services. 3(38) Fiduciary Services provided by Atlas Fiduciary Services, Inc., an SEC registered Investment Advisor. 3(16) Services provided by Atlas Pension Administrators, Inc. Costs associated with these services are included in the recordkeeping asset fees described above. Investment Advisor Fees are a separate engagement between the adopting employer and the advisor or advisor's firm.</p>
                  <p>TPA/3(16) Plan Administration/Compliance Fee is billed directly to the employer. Discounts apply if paid annually. Annual billable of $750 if preferred.</p>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* CONTACT MODAL (screen only) */}
      {showContactModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:hidden" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-medium">Send my cost sheet</h3>
              <button onClick={() => setShowContactModal(false)} className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100" aria-label="Close">×</button>
            </div>

            {modalStep === "info" ? (
              <div className="grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-600" htmlFor="firstName">First name*</label>
                    <input id="firstName" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" value={contact.firstName} onChange={(e) => setContact({ ...contact, firstName: e.target.value })} />
                  </div>
                  <div>
                    <label className="text-xs text-slate-600" htmlFor="lastName">Last name*</label>
                    <input id="lastName" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" value={contact.lastName} onChange={(e) => setContact({ ...contact, lastName: e.target.value })} />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-600" htmlFor="company">Company*</label>
                  <input id="company" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" value={contact.company} onChange={(e) => setContact({ ...contact, company: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-slate-600" htmlFor="email">Email*</label>
                  <input id="email" type="email" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} />
                </div>
                <div>
                  <label className="text-xs text-slate-600" htmlFor="phone">Phone</label>
                  <input id="phone" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} />
                </div>

                {USE_SIMPLE_HUMAN_CHECK && (
                  <div className="mt-1">
                    <label className="text-xs text-slate-600">Prove you're human*</label>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="rounded-lg bg-slate-100 px-2 py-1 text-sm">{humanA} + {humanB} =</span>
                      <input inputMode="numeric" pattern="[0-9]*" placeholder="?" className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-sm" value={humanAnswer} onChange={(e) => setHumanAnswer(e.target.value)} />
                    </div>
                  </div>
                )}

                {formErr && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{formErr}</div>}

                <div className="mt-2 flex items-center justify-end gap-3">
                  <button onClick={() => setShowContactModal(false)} className="rounded-2xl px-4 py-2 text-sm ring-1 ring-slate-300 hover:bg-slate-50">Cancel</button>
                  <button disabled={sending} onClick={handleInfoContinue} className={`rounded-2xl px-4 py-2 text-sm font-medium text-white ${sending ? "bg-blue-400" : "bg-blue-600 hover:bg-blue-700"}`}>{sending ? "Sending…" : "Send Code"}</button>
                </div>
              </div>
            ) : (
              <div className="grid gap-3">
                <p className="text-sm text-slate-600">We emailed a verification code to <span className="font-medium">{contact.email}</span>. Enter it below to view your results and receive your cost sheet.</p>
                <div>
                  <label className="text-xs text-slate-600" htmlFor="code">Verification code</label>
                  <input id="code" inputMode="numeric" pattern="[0-9]*" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 tracking-widest" placeholder="e.g., 123456" value={code} onChange={(e) => setCode(e.target.value.trim())} />
                  {codeErr && <div className="mt-1 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{codeErr}</div>}
                </div>

                <div className="flex items-center justify-between text-xs">
                  <button disabled={resendCooldown>0} onClick={resendCode} className={`underline-offset-2 hover:underline ${resendCooldown>0 ? "text-slate-400" : "text-slate-600"}`}>{resendCooldown>0 ? `Resend available in ${resendCooldown}s` : "Resend code"}</button>
                  <button onClick={() => setModalStep("info")} className="text-slate-600 underline-offset-2 hover:underline">Change email</button>
                </div>

                <div className="mt-2 flex items-center justify-end gap-3">
                  <button onClick={() => setShowContactModal(false)} className="rounded-2xl px-4 py-2 text-sm ring-1 ring-slate-300 hover:bg-slate-50">Cancel</button>
                  <button disabled={sending} onClick={verifyCodeAndReveal} className={`rounded-2xl px-4 py-2 text-sm font-medium text-white ${sending ? "bg-blue-400" : "bg-blue-600 hover:bg-blue-700"}`}>{sending ? "Verifying…" : "Verify & Show Results"}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------- Lightweight runtime tests (console only) ----------------
function __runDevTests() {
  try {
    // Tier boundary tests
    const t0 = getRateForBalance(0); if (!t0 || t0.rate !== 0.006) throw new Error("Tier fail @0");
    const t1 = getRateForBalance(1_000_000); if (!t1 || t1.rate !== 0.004) throw new Error("Tier fail @1M");
    const t2 = getRateForBalance(4_000_000); if (!t2 || t2.rate !== 0.0037) throw new Error("Tier fail @4M");
    const t3 = getRateForBalance(10_000_000); if (!t3 || t3.rate !== 0.0028) throw new Error("Tier fail @10M");
    const t4 = getRateForBalance(20_000_000); if (t4 !== null) throw new Error("Tier fail @20M+");
    // Per-element fee tests
    if (__employeeFee(10, true) !== 300) throw new Error("Employee fee AE yes");
    if (__employeeFee(10, false) !== 400) throw new Error("Employee fee AE no");
    if (Math.abs(__qdiaFee(1_000_000) - 700) > 0.001) throw new Error("QDIA 0.07% calc");
    if (Math.abs(__advisorFee(200_000, true, 0) - 1_000) > 0.001) throw new Error("Advisor startup 0.5% calc");
    if (Math.abs(__advisorFee(200_000, false, 0.75) - 1_500) > 0.001) throw new Error("Advisor existing % calc");
    // Extra edge tests
    if (__employeeFee(0, true) !== 0) throw new Error("Employee fee zero participants");
    if (getRateForBalance(25_000_000) !== null) throw new Error("Custom tier should be null");
    // New credit helper tests
    if (__startupCreditCap(0) !== 500) throw new Error("Startup cap min $500");
    if (__startupCreditCap(10) !== 2500) throw new Error("Startup cap 10 NHCEs");
    if (Math.abs(__contribCreditRate(0, 40) - 1.0) > 1e-9) throw new Error("Rate y1 <=50 emp");
    if (Math.abs(__contribCreditRate(2, 60) - 0.55) > 1e-9) throw new Error("Rate y3 60 emp (0.75-0.2=0.55)");

    // Additional tests for employer/credit assumptions
    if (__employerAnnualCostForTest(750, 300, true) !== 1050) throw new Error("Employer annual cost calc");
    if (__employerAnnualCostForTest(750, 300, false) !== 750) throw new Error("Employer annual cost no per-ptp");
    if (__startupEligibleAdminCostForTest(750, 300, true, true) !== 1050) throw new Error("Startup eligible admin inc pp");
    if (__startupEligibleAdminCostForTest(750, 300, false, true) !== 750) throw new Error("Startup eligible admin exclude pp");

    // Year-1 setup fee tests
    if (__employerAnnualCostYForTest(1050, true, 1, 750) !== 1800) throw new Error("Y1 employer cost includes setup");
    if (__employerAnnualCostYForTest(1050, true, 2, 750) !== 1050) throw new Error("Y2 employer cost excludes setup");

    console.debug("PriceItNow V4: tests passed");
  } catch (err) {
    console.warn("PriceItNow V4: tests warning:", err?.message || err);
  }
}
if (typeof window !== "undefined") __runDevTests();
