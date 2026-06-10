import React, { useEffect, useMemo, useState } from "react";

// Retail401k "Price it Now" - V4.1 overwrite file
// Results are no longer email-gated. Email/contact is only required for "Email me a copy".
// Anonymous marketing events are sent to dataLayer/gtag and optional API hooks.

// ---------------- Config ----------------
const CALENDLY_URL = "https://calendly.com/jheise-1/mep-401k-info-session";
const LOGO_URL = "/logo-retail401k.png";

// Optional. Add this to index.html to activate:
// <script>window.__RECAPTCHA_SITE_KEY="YOUR_RECAPTCHA_V3_SITE_KEY"</script>
const RECAPTCHA_SITE_KEY =
  typeof window !== "undefined" ? (window as any).__RECAPTCHA_SITE_KEY || "" : "";

// Optional hooks. If not created yet, failures are ignored so the calculator still works.
const ANON_EVENT_ENDPOINT = "/api/price-it-now/anonymous-event";
const CRM_ENDPOINT = "/api/crm/retail401k/log";
const SHEET_ENDPOINT = "/api/sheets/retail401k/requests";

// ---------------- Utils ----------------
const currency = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number.isFinite(n) ? n : 0);

const numberFmt = (n: number) =>
  new Intl.NumberFormat("en-US").format(Number.isFinite(n) ? n : 0);

function getAnonymousSessionId() {
  try {
    const key = "retail401k_pin_session_id";
    let id = window.localStorage.getItem(key);
    if (!id) {
      id = "pin_" + Math.random().toString(36).slice(2) + "_" + Date.now();
      window.localStorage.setItem(key, id);
    }
    return id;
  } catch {
    return "pin_unknown_" + Date.now();
  }
}

function trackEvent(eventName: string, data: Record<string, any> = {}) {
  if (typeof window === "undefined") return;
  const w = window as any;
  const payload = {
    event: eventName,
    pin_session_id: getAnonymousSessionId(),
    page_url: window.location.href,
    page_path: window.location.pathname,
    ...data,
  };

  w.dataLayer = w.dataLayer || [];
  w.dataLayer.push(payload);

  try {
    if (w.gtag) w.gtag("event", eventName, payload);
  } catch {
    // no-op
  }
}

async function postJson(url: string, body: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (!res.ok) {
    let msg = "";
    try { msg = await res.text(); } catch {}
    throw new Error(msg || `HTTP ${res.status}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? await res.json() : {};
}

async function safePostJson(url: string, body: any) {
  try { return await postJson(url, body); } catch { return null; }
}

async function logAnonymousEvent(type: string, payload: Record<string, any>) {
  await safePostJson(ANON_EVENT_ENDPOINT, {
    type,
    pin_session_id: getAnonymousSessionId(),
    timestamp: new Date().toISOString(),
    ...payload,
  });
}

function recaptchaConfigured() {
  return !!RECAPTCHA_SITE_KEY && !String(RECAPTCHA_SITE_KEY).startsWith("YOUR_");
}

function loadRecaptcha(): Promise<void> {
  if (!recaptchaConfigured()) return Promise.resolve();
  return new Promise((resolve) => {
    const w = window as any;
    if (w.grecaptcha?.ready) return w.grecaptcha.ready(() => resolve());

    const existing = document.querySelector("script[data-rk-recaptcha='true']");
    if (existing) {
      const check = () => {
        if (w.grecaptcha?.ready) w.grecaptcha.ready(() => resolve());
        else setTimeout(check, 100);
      };
      check();
      return;
    }

    const script = document.createElement("script");
    script.src = `https://www.google.com/recaptcha/api.js?render=${RECAPTCHA_SITE_KEY}`;
    script.async = true;
    script.defer = true;
    script.setAttribute("data-rk-recaptcha", "true");
    script.onload = () => {
      if (w.grecaptcha?.ready) w.grecaptcha.ready(() => resolve());
      else resolve();
    };
    document.head.appendChild(script);
  });
}

async function getRecaptchaToken(action: string) {
  if (!recaptchaConfigured()) return null;
  await loadRecaptcha();
  const w = window as any;
  try {
    if (!w.grecaptcha) return null;
    return await w.grecaptcha.execute(RECAPTCHA_SITE_KEY, { action });
  } catch {
    return null;
  }
}

// ---------------- Pricing ----------------
const TIERS = [
  { min: 0, max: 1_000_000 - 0.01, rate: 0.006, label: "$0 - $1,000,000", rateLabel: "0.60%" },
  { min: 1_000_000, max: 4_000_000 - 0.01, rate: 0.004, label: "$1,000,000 - $4,000,000", rateLabel: "0.40%" },
  { min: 4_000_000, max: 10_000_000 - 0.01, rate: 0.0037, label: "$4,000,000 - $10,000,000", rateLabel: "0.37%" },
  { min: 10_000_000, max: 20_000_000 - 0.01, rate: 0.0028, label: "$10,000,000 - $20,000,000", rateLabel: "0.28%" },
];

const STATIC_QDIA_RATE = 0.0007;
const STARTUP_ADVISOR_RATE = 0.005;
const TPA_MONTHLY_FEE = 69.99;
const TPA_ANNUAL_FEE = 750;
const SETUP_FEE = 750;

function getRateForBalance(balance: number) {
  if (balance >= 20_000_000) return null;
  return TIERS.find((t) => balance >= t.min && balance <= t.max) || TIERS[0];
}

export function __employeeFee(participants: number, autoEnrollYes: boolean) {
  return (Number(participants) || 0) * (autoEnrollYes ? 30 : 40);
}
export function __qdiaFee(base: number) {
  return (Number(base) || 0) * STATIC_QDIA_RATE;
}
export function __advisorFee(base: number, isStartup: boolean, advisorPct: number) {
  const b = Number(base) || 0;
  return isStartup ? b * STARTUP_ADVISOR_RATE : b * ((Number(advisorPct) || 0) / 100);
}
export function __startupCreditCap(nhce: number) {
  const nh = Math.max(0, Number(nhce) || 0);
  return Math.max(500, Math.min(5000, 250 * nh));
}
export function __contribCreditRate(yearIndex: number, totalEmployees: number) {
  const schedule = [1.0, 1.0, 0.75, 0.5, 0.25];
  const base = schedule[Math.min(4, Math.max(0, yearIndex))];
  const emp = Math.max(1, Math.min(100, Number(totalEmployees) || 1));
  const over = Math.max(0, emp - 50);
  return Math.max(0, base - over * 0.02);
}

// ---------------- Component ----------------
export default function PriceItNow() {
  const [hasExisting, setHasExisting] = useState("no");
  const [balance, setBalance] = useState(0);
  const [annualContrib, setAnnualContrib] = useState(0);
  const [eligible, setEligible] = useState(0);
  const [participants, setParticipants] = useState(0);
  const [autoEnrollExisting, setAutoEnrollExisting] = useState("no");
  const [advisorRate, setAdvisorRate] = useState(0);
  const [tpaBilling, setTpaBilling] = useState("monthly");

  const [showSheet, setShowSheet] = useState(false);
  const [showContactModal, setShowContactModal] = useState(false);
  const [modalStep, setModalStep] = useState<"info" | "verify">("info");
  const [sending, setSending] = useState(false);
  const [formErr, setFormErr] = useState("");
  const [contact, setContact] = useState({ firstName: "", lastName: "", company: "", email: "", phone: "" });

  const [verificationId, setVerificationId] = useState("");
  const [code, setCode] = useState("");
  const [codeErr, setCodeErr] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);

  const [creditsOn, setCreditsOn] = useState(false);
  const [employerPaysPerParticipant, setEmployerPaysPerParticipant] = useState(true);
  const [includeEmpFeeInStartupCredit, setIncludeEmpFeeInStartupCredit] = useState(true);
  const [totalEmployees, setTotalEmployees] = useState(0);
  const [nhceEligible, setNhceEligible] = useState(0);
  const [willContribute, setWillContribute] = useState(false);
  const [contribEligibleCount, setContribEligibleCount] = useState(0);
  const [avgContribPerEmp, setAvgContribPerEmp] = useState(0);

  useEffect(() => {
    let iv: any = null;
    if (resendCooldown > 0) iv = setInterval(() => setResendCooldown((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => iv && clearInterval(iv);
  }, [resendCooldown]);

  useEffect(() => {
    setTotalEmployees(Number(eligible) || 0);
    setNhceEligible(Number(eligible) || 0);
    setContribEligibleCount(Number(participants) || 0);
  }, [eligible, participants]);

  const isStartup = hasExisting === "no";
  const assumedAutoEnroll = hasExisting === "yes" ? autoEnrollExisting : "yes";
  const tier = useMemo(() => getRateForBalance(Number(balance) || 0), [balance]);

  const feeBase = useMemo(() => {
    const b = Number(balance) || 0;
    const c = Number(annualContrib) || 0;
    return hasExisting === "yes" ? b + c : c;
  }, [hasExisting, balance, annualContrib]);

  const annualAssetFee = useMemo(() => (!tier ? null : feeBase * tier.rate), [tier, feeBase]);
  const annualEmployeeFee = useMemo(() => __employeeFee(participants, assumedAutoEnroll === "yes"), [participants, assumedAutoEnroll]);
  const annualQdiaFee = useMemo(() => __qdiaFee(feeBase), [feeBase]);
  const annualAdvisorFee = useMemo(() => __advisorFee(feeBase, isStartup, advisorRate), [feeBase, isStartup, advisorRate]);
  const annualTpaFee = useMemo(() => (tpaBilling === "annual" ? TPA_ANNUAL_FEE : TPA_MONTHLY_FEE * 12), [tpaBilling]);

  const totalAnnualCost = useMemo(
    () => (annualAssetFee || 0) + annualEmployeeFee + annualQdiaFee + annualAdvisorFee + annualTpaFee,
    [annualAssetFee, annualEmployeeFee, annualQdiaFee, annualAdvisorFee, annualTpaFee]
  );

  const totalPercentage = useMemo(() => (!feeBase ? "0.00" : ((totalAnnualCost / feeBase) * 100).toFixed(2)), [totalAnnualCost, feeBase]);
  const percentOfBase = (fee: number) => (!feeBase ? "0.00%" : ((fee / feeBase) * 100).toFixed(2) + "%");
  const canContinue = eligible >= 0 && participants >= 0 && (hasExisting === "yes" ? Number(balance) >= 0 : true);

  const employerAnnualCostBase = useMemo(() => {
    return annualTpaFee + (employerPaysPerParticipant ? annualEmployeeFee : 0);
  }, [annualTpaFee, employerPaysPerParticipant, annualEmployeeFee]);

  const startupEligibleAdminCost = useMemo(() => {
    return annualTpaFee + (includeEmpFeeInStartupCredit && employerPaysPerParticipant ? annualEmployeeFee : 0);
  }, [annualTpaFee, annualEmployeeFee, includeEmpFeeInStartupCredit, employerPaysPerParticipant]);

  const startupCreditPercent = totalEmployees <= 50 ? 1 : totalEmployees <= 100 ? 0.5 : 0;
  const startupCreditCap = __startupCreditCap(nhceEligible);
  const autoEnrollCreditYear = 500;

  const contribCreditByYear = useMemo(() => {
    if (!willContribute) return [0, 0, 0, 0, 0];
    const perEmpEligible = Math.min(1000, Math.max(0, Number(avgContribPerEmp) || 0));
    const base = perEmpEligible * Math.max(0, Number(contribEligibleCount) || 0);
    return [0, 1, 2, 3, 4].map((i) => base * __contribCreditRate(i, totalEmployees));
  }, [willContribute, avgContribPerEmp, contribEligibleCount, totalEmployees]);

  const fiveYearRows = useMemo(() => {
    const rows = [];
    for (let year = 1; year <= 5; year++) {
      const idx = year - 1;
      const employerCost = employerAnnualCostBase + (isStartup && year === 1 ? SETUP_FEE : 0);
      const eligibleAdmin = startupEligibleAdminCost + (isStartup && year === 1 ? SETUP_FEE : 0);
      const startupCredit = year <= 3 ? Math.min(eligibleAdmin * startupCreditPercent, startupCreditCap) : 0;
      const autoEnrollCredit = year <= 3 ? autoEnrollCreditYear : 0;
      const contribCredit = contribCreditByYear[idx] || 0;
      const totalCredits = startupCredit + autoEnrollCredit + contribCredit;
      rows.push({
        year: `Year ${year}`,
        employerCost,
        startupCredit,
        autoEnrollCredit,
        contribCredit,
        totalCredits,
        netCost: Math.max(0, employerCost - totalCredits),
      });
    }
    return rows;
  }, [employerAnnualCostBase, startupEligibleAdminCost, startupCreditPercent, startupCreditCap, contribCreditByYear, isStartup]);

  const creditsHtmlBlock = useMemo(() => {
    if (!creditsOn || !isStartup) return "";
    const rows = fiveYearRows.map((r) =>
      `<tr><td>${r.year}</td><td>${currency(r.employerCost)}</td><td>${currency(r.startupCredit)}</td><td>${currency(r.autoEnrollCredit)}</td><td>${currency(r.contribCredit)}</td><td>${currency(r.totalCredits)}</td><td><strong>${currency(r.netCost)}</strong></td></tr>`
    ).join("");
    return `
      <h3>SECURE 2.0 - Estimated Tax Credits</h3>
      <p><em>Assumptions:</em> Employees: ${numberFmt(totalEmployees)}; NHCEs: ${numberFmt(nhceEligible)}; employer pays per-participant fee: ${employerPaysPerParticipant ? "Yes" : "No"}; employer contributions assumed: ${willContribute ? "Yes" : "No"}. Asset-based, QDIA, and advisor fees are assumed participant-paid and excluded from employer cost and startup credit eligibility.</p>
      <table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;font-size:12px">
        <thead><tr><th>Year</th><th>Employer Cost</th><th>Startup Credit</th><th>Auto-Enroll Credit</th><th>Contribution Credit</th><th>Total Credits</th><th>Net Cost</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }, [creditsOn, isStartup, fiveYearRows, totalEmployees, nhceEligible, employerPaysPerParticipant, willContribute]);

  const eventPayload = () => ({
    plan_type: isStartup ? "startup_plan" : "existing_plan",
    has_existing_plan: hasExisting,
    eligible_employees: Number(eligible) || 0,
    participants: Number(participants) || 0,
    fee_base: Number(feeBase) || 0,
    total_annual_cost: Number(totalAnnualCost) || 0,
    tpa_billing: tpaBilling,
    auto_enrollment: assumedAutoEnroll,
  });

  function handleCalculate() {
    setShowSheet(true);
    const payload = eventPayload();
    trackEvent("pin_results_viewed", payload);
    logAnonymousEvent("results_viewed", payload);
  }

  function buildCalcHtml(creditsHtml = "") {
    const planType = isStartup ? "Start-up 401(k) Plan" : "Existing 401(k) Plan";
    const advLabel = isStartup ? "0.50% startup" : `${advisorRate || 0}%`;
    const lines: string[] = [];
    lines.push("<h2>Retail401k Cost Sheet</h2>");
    lines.push(`<p><strong>Plan Type:</strong> ${planType}</p>`);
    lines.push(`<p><strong>Auto-Enrollment:</strong> ${assumedAutoEnroll === "yes" ? "Yes" : "No"}</p>`);
    lines.push(`<p><strong>Eligible Employees:</strong> ${numberFmt(eligible)}</p>`);
    lines.push(`<p><strong>Expected Participants:</strong> ${numberFmt(participants)}</p>`);
    lines.push("<hr/>");
    if (!isStartup) {
      lines.push(`<p><strong>Current Balance:</strong> ${currency(Number(balance) || 0)}</p>`);
      lines.push(`<p><strong>Projected Contributions:</strong> ${currency(Number(annualContrib) || 0)}</p>`);
      lines.push(`<p><strong>Fee Base:</strong> ${currency(feeBase)}</p>`);
    } else {
      lines.push(`<p><strong>Estimated First-year Contributions:</strong> ${currency(Number(annualContrib) || 0)}</p>`);
      lines.push(`<p><strong>Fee Base:</strong> ${currency(feeBase)}</p>`);
    }
    lines.push("<ul>");
    if (tier) lines.push(`<li>Asset-based fee ${tier.rateLabel}: ${currency(annualAssetFee || 0)}</li>`);
    lines.push(`<li>QDIA fee (0.07%): ${currency(annualQdiaFee)}</li>`);
    lines.push(`<li>Advisor fee (${advLabel}): ${currency(annualAdvisorFee)}</li>`);
    lines.push(`<li>Employee fee (${assumedAutoEnroll === "yes" ? "$30" : "$40"} x participants): ${currency(annualEmployeeFee)}</li>`);
    lines.push(`<li>TPA/3(16) Admin/Compliance: ${currency(annualTpaFee)}</li>`);
    lines.push(`<li>One-time setup fee (Year 1 only): ${isStartup ? currency(SETUP_FEE) : "Waived"}</li>`);
    lines.push("</ul>");
    lines.push(`<p><strong>Total Annual Cost:</strong> ${currency(totalAnnualCost)}${!isStartup && feeBase > 0 ? ` (${totalPercentage}% of fee base)` : ""}</p>`);
    if (creditsHtml) lines.push("<hr/>" + creditsHtml);
    lines.push(`<p><a href="${CALENDLY_URL}">Schedule a call</a></p>`);
    lines.push('<hr/><p style="font-size:12px;color:#475569"><strong>Important:</strong> This calculator is for educational and illustrative purposes only and does not constitute tax, legal, accounting, or investment advice. Consult a qualified tax professional to confirm eligibility and amounts for any SECURE 2.0 credits.</p>');
    return lines.join("");
  }

  function buildQuotePayload(creditsHtml = "") {
    const calcHtml = buildCalcHtml(creditsHtml);
    return {
      timestamp: new Date().toISOString(),
      sendTo: contact.email,
      notifyTo: "team@retail401k.com",
      contact,
      anonymousSessionId: getAnonymousSessionId(),
      inputs: {
        hasExisting,
        balance: Number(balance) || 0,
        annualContrib: Number(annualContrib) || 0,
        eligible: Number(eligible) || 0,
        participants: Number(participants) || 0,
        autoEnroll: assumedAutoEnroll,
        advisorRate: isStartup ? 0.5 : Number(advisorRate || 0),
        tpaBilling,
        creditsOn,
        employerPaysPerParticipant,
        includeEmpFeeInStartupCredit,
        totalEmployees,
        nhceEligible,
        willContribute,
        contribEligibleCount,
        avgContribPerEmp,
      },
      feeBase,
      calculations: {
        tier: tier ? { label: tier.label, rateLabel: tier.rateLabel, rate: tier.rate } : null,
        annualAssetFee: annualAssetFee ?? 0,
        annualEmployeeFee,
        annualQdiaFee,
        annualAdvisorFee,
        annualTpaFee,
        totalAnnualCost,
        totalPercentage: !isStartup ? Number(totalPercentage || 0) : null,
        credits: creditsOn && isStartup ? fiveYearRows : null,
      },
      calcHtml,
    };
  }

  async function requestVerificationCode() {
    setSending(true);
    setFormErr("");
    try {
      const recaptchaToken = await getRecaptchaToken("request_code");
      const res = await postJson("/api/price-it-now/request-code", {
        email: contact.email,
        contact,
        recaptchaToken,
        anonymousSessionId: getAnonymousSessionId(),
      });
      setVerificationId(res?.verificationId || "ok");
      setModalStep("verify");
      setResendCooldown(30);
      setCode("");
      setCodeErr("");
      trackEvent("pin_submit_contact", eventPayload());
    } catch {
      setFormErr("We couldn't send a verification code. Please try again.");
    } finally {
      setSending(false);
    }
  }

  async function verifyCodeAndSend() {
    setSending(true);
    setCodeErr("");
    try {
      if (!/^\d{4,8}$/.test(code)) {
        setCodeErr("Enter the code we emailed to you.");
        setSending(false);
        return;
      }

      const recaptchaToken = await getRecaptchaToken("verify_code");
      await postJson("/api/price-it-now/verify-code", {
        verificationId,
        email: contact.email,
        code,
        recaptchaToken,
      });

      trackEvent("pin_verification_success", eventPayload());
      await sendEmailsAndLog(creditsHtmlBlock);
      setShowContactModal(false);
      setShowSheet(true);
    } catch {
      trackEvent("pin_verification_failed", eventPayload());
      setCodeErr("That code didn't match. Please try again or resend.");
    } finally {
      setSending(false);
    }
  }

  async function resendCode() {
    if (resendCooldown > 0) return;
    try {
      const recaptchaToken = await getRecaptchaToken("resend_code");
      await postJson("/api/price-it-now/request-code", { email: contact.email, contact, recaptchaToken });
      setResendCooldown(30);
    } catch {}
  }

  async function sendEmailsAndLog(creditsHtml = "") {
    const payload = buildQuotePayload(creditsHtml);
    await postJson("/api/price-it-now/send-quote", payload);
    await postJson("/api/price-it-now/notify-internal", payload);

    safePostJson(CRM_ENDPOINT, { type: "quote_sent", ...payload });
    safePostJson(SHEET_ENDPOINT, { type: "quote_sent", ...payload });

    trackEvent("pin_email_quote", eventPayload());
  }

  async function handleEmailToSelf() {
    if (!contact.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
      openContactModal();
      return;
    }
    try {
      setSending(true);
      await sendEmailsAndLog(creditsHtmlBlock);
    } finally {
      setSending(false);
    }
  }

  function openContactModal() {
    setShowContactModal(true);
    setModalStep("info");
    setFormErr("");
    setCode("");
    setCodeErr("");
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
    await requestVerificationCode();
  }

  function resetAll() {
    setHasExisting("no");
    setBalance(0);
    setAnnualContrib(0);
    setEligible(0);
    setParticipants(0);
    setAutoEnrollExisting("no");
    setAdvisorRate(0);
    setTpaBilling("monthly");
    setShowSheet(false);
    setShowContactModal(false);
    setModalStep("info");
    setSending(false);
    setFormErr("");
    setContact({ firstName: "", lastName: "", company: "", email: "", phone: "" });
    setVerificationId("");
    setCode("");
    setCodeErr("");
    setResendCooldown(0);
    setCreditsOn(false);
    setEmployerPaysPerParticipant(true);
    setIncludeEmpFeeInStartupCredit(true);
    setTotalEmployees(0);
    setNhceEligible(0);
    setWillContribute(false);
    setContribEligibleCount(0);
    setAvgContribPerEmp(0);
  }

  return (
    <div className="min-h-screen bg-slate-50 py-10">
      <style>{`
        @media print {
          .print\\:hidden { display: none !important; }
          .page-break { break-before: page; }
          body { background: white !important; }
        }
      `}</style>

      <div className="hidden print:flex items-center gap-3 px-6 mb-4">
        <img
          src={LOGO_URL}
          alt="Retail401k"
          className="h-8 w-auto"
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
        />
        <div className="text-lg font-semibold">Retail401k - Price it Now</div>
      </div>

      <div className="mx-auto max-w-5xl px-4">
        <header className="mb-8 flex items-center justify-between print:hidden">
          <h1 className="text-3xl font-semibold tracking-tight">Price it Now</h1>
          {showSheet && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  trackEvent("pin_print_clicked", eventPayload());
                  window.print();
                }}
                className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-1.5 text-sm shadow-sm hover:bg-white"
              >
                Print
              </button>
              <button
                onClick={() => {
                  trackEvent("pin_email_copy_clicked", eventPayload());
                  handleEmailToSelf();
                }}
                className="inline-flex items-center rounded-2xl border border-blue-600 text-blue-600 px-3 py-1.5 text-sm shadow-sm hover:bg-blue-50"
              >
                Email me a copy
              </button>
            </div>
          )}
        </header>

        <div className="grid gap-6 md:grid-cols-2">
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <h2 className="mb-4 text-xl font-medium">Tell us about your plan</h2>

            <div className="space-y-5">
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
                <p className="mt-2 text-xs text-slate-500">If you select "No", we'll treat this as a start-up 401(k) plan and assume auto-enrollment per SECURE 2.0.</p>
              </div>

              {hasExisting === "yes" && (
                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor="balance">Current plan balance</label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                    <input id="balance" type="number" min={0} step={1000} value={balance} onChange={(e) => setBalance(Number(e.target.value))} className="w-full rounded-xl border border-slate-300 px-8 py-2 shadow-sm focus:border-blue-600 focus:outline-none" />
                  </div>
                </div>
              )}

              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="annualContrib">{hasExisting === "yes" ? "Projected annual contributions" : "Estimated first-year contributions"}</label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                  <input id="annualContrib" type="number" min={0} step={1000} value={annualContrib} onChange={(e) => setAnnualContrib(Number(e.target.value))} className="w-full rounded-xl border border-slate-300 px-8 py-2 shadow-sm focus:border-blue-600 focus:outline-none" />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="eligible">How many eligible employees will there be?</label>
                <input id="eligible" type="number" min={0} value={eligible} onChange={(e) => setEligible(Number(e.target.value))} className="w-full rounded-xl border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-600 focus:outline-none" />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="participants">How many employees will participate? (estimate is OK)</label>
                <input id="participants" type="number" min={0} value={participants} onChange={(e) => setParticipants(Number(e.target.value))} className="w-full rounded-xl border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-600 focus:outline-none" />
              </div>

              {hasExisting === "yes" && (
                <div>
                  <label className="mb-2 block text-sm font-medium">Do you offer Auto-Enrollment today?</label>
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

              {hasExisting === "yes" && (
                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor="advisorRate">Current Financial Advisor Compensation (% of assets)</label>
                  <input id="advisorRate" type="number" min={0} step={0.01} value={advisorRate} onChange={(e) => setAdvisorRate(Number(e.target.value))} className="w-full rounded-xl border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-600 focus:outline-none" />
                </div>
              )}

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

              <div className="pt-2">
                <button
                  disabled={!canContinue}
                  onClick={handleCalculate}
                  className={`w-full rounded-2xl px-4 py-3 text-center text-sm font-medium shadow-sm transition ${canContinue ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-slate-200 text-slate-500"}`}
                >
                  Calculate
                </button>
                <button type="button" onClick={resetAll} className="mt-2 w-full rounded-2xl px-4 py-3 text-center text-sm font-medium shadow-sm ring-1 ring-slate-300 text-slate-700 hover:bg-slate-50">Clear inputs</button>
                <p className="mt-2 text-xs text-slate-500">Results display instantly. Email is only required if you want a copy or follow-up.</p>
              </div>
            </div>
          </section>

          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-medium">Your cost sheet</h2>
              {showSheet && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      trackEvent("pin_print_clicked", eventPayload());
                      window.print();
                    }}
                    className="inline-flex items-center rounded-xl border border-slate-300 px-3 py-1.5 text-xs shadow-sm hover:bg-slate-50 print:hidden"
                  >
                    Print
                  </button>
                  <button
                    onClick={() => {
                      trackEvent("pin_email_copy_clicked", eventPayload());
                      handleEmailToSelf();
                    }}
                    className="inline-flex items-center rounded-xl border border-blue-600 text-blue-600 px-3 py-1.5 text-xs shadow-sm hover:bg-blue-50 print:hidden"
                  >
                    Email me a copy
                  </button>
                </div>
              )}
            </div>

            {!showSheet ? (
              <div className="rounded-xl border border-dashed border-slate-300 p-6 text-slate-500">
                Enter your plan information, then click Calculate to view your cost sheet instantly.
              </div>
            ) : (
              <div className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs uppercase tracking-wider text-slate-500">Plan Type</p><p className="text-sm font-medium">{isStartup ? "Start-up 401(k) Plan" : "Existing 401(k) Plan"}</p></div>
                  <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs uppercase tracking-wider text-slate-500">Auto-Enrollment</p><p className="text-sm font-medium">{assumedAutoEnroll === "yes" ? "Yes" : "No"}{isStartup && <span className="ml-2 text-xs text-slate-500">(Assumed per SECURE 2.0)</span>}</p></div>
                  <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs uppercase tracking-wider text-slate-500">Eligible Employees</p><p className="text-sm font-medium">{numberFmt(eligible)}</p></div>
                  <div className="rounded-xl bg-slate-50 p-4"><p className="text-xs uppercase tracking-wider text-slate-500">Expected Participants</p><p className="text-sm font-medium">{numberFmt(participants)}</p></div>
                </div>

                <div className="rounded-2xl border border-slate-200">
                  <div className="border-b px-4 py-3"><p className="text-sm font-medium">Contract Asset Charge</p><p className="text-xs text-slate-500">Based on total contract balance</p></div>
                  <div className="divide-y">
                    {TIERS.map((t, i) => <div key={i} className="flex items-center justify-between px-4 py-3"><div className="text-sm">{t.label}</div><div className="text-sm font-medium">{t.rateLabel}</div></div>)}
                    <div className="flex items-center justify-between px-4 py-3"><div className="text-sm">$20,000,000+</div><div className="text-sm font-medium">Custom</div></div>
                  </div>
                </div>

                <div className="rounded-xl bg-slate-50 p-4 text-sm">
                  {!isStartup ? (
                    <>
                      <p>Current balance: <span className="font-medium">{currency(Number(balance) || 0)}</span></p>
                      <p>Projected contributions: <span className="font-medium">{currency(Number(annualContrib) || 0)}</span></p>
                      <p>Fee base (balance + contributions): <span className="font-semibold">{currency(feeBase)}</span></p>
                    </>
                  ) : (
                    <>
                      <p>Estimated first-year contributions: <span className="font-medium">{currency(Number(annualContrib) || 0)}</span></p>
                      <p>Fee base: <span className="font-semibold">{currency(feeBase)}</span></p>
                    </>
                  )}
                </div>

                <div className="rounded-2xl bg-slate-50 p-4 space-y-2 text-sm">
                  {tier ? (
                    <div>Asset-based fee (@ {tier.rateLabel}): <span className="font-semibold">{currency(annualAssetFee || 0)}</span>{!isStartup && <span className="ml-2 text-xs text-slate-600">({percentOfBase(annualAssetFee || 0)})</span>}</div>
                  ) : (
                    <div className="text-sm">For balances of $20,000,000 or more, pricing is custom. Please contact us for a tailored proposal.</div>
                  )}

                  <div>QDIA investment fee (0.07%): <span className="font-semibold">{currency(annualQdiaFee)}</span>{!isStartup && <span className="ml-2 text-xs text-slate-600">({percentOfBase(annualQdiaFee)})</span>}</div>
                  <div>Financial Advisor fee ({isStartup ? "0.50% startup" : String(advisorRate || 0) + "%"}): <span className="font-semibold">{currency(annualAdvisorFee)}</span>{!isStartup && <span className="ml-2 text-xs text-slate-600">({percentOfBase(annualAdvisorFee)})</span>}</div>
                  <div>Active employee fee ({assumedAutoEnroll === "yes" ? "$30" : "$40"} x participants): <span className="font-semibold">{currency(annualEmployeeFee)}</span>{!isStartup && <span className="ml-2 text-xs text-slate-600">({percentOfBase(annualEmployeeFee)})</span>}</div>
                  <div>TPA/3(16) Admin/Compliance fee: <span className="font-semibold">{currency(annualTpaFee)}</span>{!isStartup && <span className="ml-2 text-xs text-slate-600">({percentOfBase(annualTpaFee)})</span>}<span className="ml-2 text-xs text-slate-500">{tpaBilling === "monthly" ? `(billed ${currency(TPA_MONTHLY_FEE)}/month)` : `(prepaid annually, saves ${currency(TPA_MONTHLY_FEE*12 - TPA_ANNUAL_FEE)})`}</span></div>
                  <div>One-time setup fee (Year 1 only): <span className="font-semibold">{isStartup ? currency(SETUP_FEE) : "Waived"}</span></div>

                  <div className="font-medium border-t pt-2 mt-2">
                    Total Annual Cost: <span className="font-semibold">{currency(totalAnnualCost)}</span>
                    {!isStartup && feeBase > 0 && <span className="ml-2 text-slate-600">({totalPercentage}% of fee base)</span>}
                  </div>
                </div>

                {isStartup && (
                  <section className="rounded-2xl border border-blue-100 bg-blue-50 p-4 page-break">
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-medium text-blue-900">Estimate your net cost with SECURE 2.0 tax credits?</h3>
                      <label className="inline-flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={creditsOn}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setCreditsOn(checked);
                            const payload = eventPayload();
                            trackEvent(checked ? "pin_tax_credits_opened" : "pin_tax_credits_closed", payload);
                            logAnonymousEvent(checked ? "tax_credits_opened" : "tax_credits_closed", payload);
                          }}
                        />
                        Include credits
                      </label>
                    </div>

                    {creditsOn && (
                      <div className="mt-3 grid gap-3">
                        <p className="text-[11px] text-slate-600">Assumption: Asset-based, QDIA investment, and Financial Advisor fees are participant-paid and excluded from employer cost and startup credit eligibility.</p>

                        <div className="grid gap-3 md:grid-cols-3">
                          <div>
                            <label className="text-xs text-slate-700" htmlFor="empCount">Employees (comp &gt;= $5,000)</label>
                            <input id="empCount" type="number" min={1} max={100} value={totalEmployees} onChange={(e) => setTotalEmployees(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" />
                          </div>
                          <div>
                            <label className="text-xs text-slate-700" htmlFor="nhce">NHCEs eligible to participate</label>
                            <input id="nhce" type="number" min={0} value={nhceEligible} onChange={(e) => setNhceEligible(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" />
                          </div>
                          <div>
                            <label className="text-xs text-slate-700">Employer pays per-participant fee?</label>
                            <div className="mt-1 flex gap-2">
                              {["yes", "no"].map((v) => (
                                <label key={v} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs ${employerPaysPerParticipant === (v === "yes") ? "border-blue-600 ring-2 ring-blue-200" : "border-slate-300"}`}>
                                  <input className="sr-only" type="radio" name="paypp" checked={employerPaysPerParticipant === (v === "yes")} onChange={() => setEmployerPaysPerParticipant(v === "yes")} />{v === "yes" ? "Yes" : "No"}
                                </label>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="grid gap-3 md:grid-cols-3">
                          <div>
                            <label className="text-xs text-slate-700">Include per-participant fee in startup credit?</label>
                            <div className="mt-1 flex gap-2">
                              {["yes", "no"].map((v) => (
                                <label key={v} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs ${includeEmpFeeInStartupCredit === (v === "yes") ? "border-blue-600 ring-2 ring-blue-200" : "border-slate-300"}`}>
                                  <input className="sr-only" type="radio" name="incpp" checked={includeEmpFeeInStartupCredit === (v === "yes")} onChange={() => setIncludeEmpFeeInStartupCredit(v === "yes")} />{v === "yes" ? "Yes" : "No"}
                                </label>
                              ))}
                            </div>
                          </div>
                          <div>
                            <label className="text-xs text-slate-700">Provide employer contributions?</label>
                            <div className="mt-1 flex gap-2">
                              {["no", "yes"].map((v) => (
                                <label key={v} className={`cursor-pointer rounded-lg border px-3 py-1.5 text-xs ${willContribute === (v === "yes") ? "border-blue-600 ring-2 ring-blue-200" : "border-slate-300"}`}>
                                  <input className="sr-only" type="radio" name="willc" checked={willContribute === (v === "yes")} onChange={() => setWillContribute(v === "yes")} />{v === "yes" ? "Yes" : "No"}
                                </label>
                              ))}
                            </div>
                          </div>
                        </div>

                        {willContribute && (
                          <div className="grid gap-3 md:grid-cols-3">
                            <div>
                              <label className="text-xs text-slate-700" htmlFor="contribCnt">Employees eligible for contribution credit (&lt;= $100k comp)</label>
                              <input id="contribCnt" type="number" min={0} value={contribEligibleCount} onChange={(e) => setContribEligibleCount(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" />
                            </div>
                            <div>
                              <label className="text-xs text-slate-700" htmlFor="avgContrib">Avg employer contribution per eligible employee (annual)</label>
                              <div className="relative">
                                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                                <input id="avgContrib" type="number" min={0} step={50} value={avgContribPerEmp} onChange={(e) => setAvgContribPerEmp(Number(e.target.value))} className="mt-1 w-full rounded-xl border border-slate-300 px-8 py-2" />
                              </div>
                              <p className="mt-1 text-[11px] text-slate-500">Credit applies up to $1,000 per employee; phased 100%/100%/75%/50%/25% and reduced for 51-100 employees.</p>
                            </div>
                          </div>
                        )}

                        <div className="mt-3 overflow-x-auto">
                          <table className="w-full text-sm border-collapse">
                            <thead>
                              <tr className="border-b">
                                <th className="px-2 py-2 text-left">Year</th>
                                <th className="px-2 py-2 text-right">Employer Cost</th>
                                <th className="px-2 py-2 text-right">Startup Credit</th>
                                <th className="px-2 py-2 text-right">Auto-Enroll Credit</th>
                                <th className="px-2 py-2 text-right">Contribution Credit</th>
                                <th className="px-2 py-2 text-right">Total Credits</th>
                                <th className="px-2 py-2 text-right">Net Cost</th>
                              </tr>
                            </thead>
                            <tbody>
                              {fiveYearRows.map((r, i) => (
                                <tr key={i} className="border-b last:border-0">
                                  <td className="px-2 py-1">{r.year}</td>
                                  <td className="px-2 py-1 text-right">{currency(r.employerCost)}</td>
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

                        <p className="text-[11px] text-slate-500">These tax credit estimates are for educational purposes only and do not constitute tax or legal advice. Consult a qualified tax professional to confirm eligibility.</p>
                      </div>
                    )}
                  </section>
                )}

                {!isStartup && (
                  <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 page-break">
                    <h3 className="text-sm font-medium text-emerald-900">Complimentary cost/benefit analysis of your current plan</h3>
                    <p className="mt-1 text-sm text-emerald-900/80">Compare your current plan with the Retail401k MEP 401(k). We'll provide a detailed analysis at no cost.</p>
                    <ul className="mt-2 text-xs text-emerald-900/90 list-disc pl-5 space-y-1">
                      <li>Transparent all-in fee comparison.</li>
                      <li>Fiduciary scope and responsibilities.</li>
                      <li>Participant experience, QDIA, education, and support.</li>
                      <li>Investment lineup and average expense ratios.</li>
                      <li>Administrative workload and transition plan.</li>
                    </ul>
                    <div className="mt-3 print:hidden">
                      <a
                        href={CALENDLY_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => {
                          const payload = eventPayload();
                          trackEvent("pin_schedule_call_clicked", payload);
                          logAnonymousEvent("schedule_call_clicked", payload);
                        }}
                        className="inline-flex items-center rounded-2xl px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-700"
                      >
                        Schedule a call
                      </a>
                    </div>
                  </section>
                )}

                <details className="print:hidden rounded-xl border border-slate-200 p-4 bg-white">
                  <summary className="cursor-pointer select-none text-sm font-medium">Disclosures</summary>
                  <div className="mt-2 text-xs text-slate-600 space-y-2">
                    <p>This calculator is for educational and illustrative purposes only and does not constitute tax, legal, accounting, or investment advice. Calculations are estimates, not guarantees, and additional fees may apply. Consult a qualified tax professional to determine eligibility and applicability of any credits.</p>
                    <p>Recordkeeping services provided by Transamerica Retirement Services. 3(38) Fiduciary Services provided by Atlas Fiduciary Services, Inc., an SEC registered Investment Advisor. 3(16) Services provided by Atlas Pension Administrators, Inc.</p>
                    <p>TPA/3(16) Plan Administration/Compliance Fee is billed directly to the employer. Discounts apply if paid annually. Annual billable of $750 if preferred.</p>
                  </div>
                </details>

                <div className="hidden print:block text-[11px] leading-snug text-slate-700 space-y-1">
                  <p><strong>Disclosures:</strong> This calculator is for educational and illustrative purposes only and does not constitute tax, legal, accounting, or investment advice. Consult a qualified tax professional to determine eligibility and applicability of any credits.</p>
                  <p>Recordkeeping services provided by Transamerica Retirement Services. 3(38) Fiduciary Services provided by Atlas Fiduciary Services, Inc., an SEC registered Investment Advisor. 3(16) Services provided by Atlas Pension Administrators, Inc.</p>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

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

                {formErr && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{formErr}</div>}

                <div className="mt-2 flex items-center justify-end gap-3">
                  <button onClick={() => setShowContactModal(false)} className="rounded-2xl px-4 py-2 text-sm ring-1 ring-slate-300 hover:bg-slate-50">Cancel</button>
                  <button disabled={sending} onClick={handleInfoContinue} className={`rounded-2xl px-4 py-2 text-sm font-medium text-white ${sending ? "bg-blue-400" : "bg-blue-600 hover:bg-blue-700"}`}>{sending ? "Sending..." : "Send Code"}</button>
                </div>
              </div>
            ) : (
              <div className="grid gap-3">
                <p className="text-sm text-slate-600">We emailed a verification code to <span className="font-medium">{contact.email}</span>. Enter it below to receive your cost sheet.</p>
                <div>
                  <label className="text-xs text-slate-600" htmlFor="code">Verification code</label>
                  <input id="code" inputMode="numeric" pattern="[0-9]*" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 tracking-widest" placeholder="e.g., 123456" value={code} onChange={(e) => setCode(e.target.value.trim())} />
                  {codeErr && <div className="mt-1 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{codeErr}</div>}
                </div>

                <div className="flex items-center justify-between text-xs">
                  <button disabled={resendCooldown > 0} onClick={resendCode} className={`underline-offset-2 hover:underline ${resendCooldown > 0 ? "text-slate-400" : "text-slate-600"}`}>{resendCooldown > 0 ? `Resend available in ${resendCooldown}s` : "Resend code"}</button>
                  <button onClick={() => setModalStep("info")} className="text-slate-600 underline-offset-2 hover:underline">Change email</button>
                </div>

                <div className="mt-2 flex items-center justify-end gap-3">
                  <button onClick={() => setShowContactModal(false)} className="rounded-2xl px-4 py-2 text-sm ring-1 ring-slate-300 hover:bg-slate-50">Cancel</button>
                  <button disabled={sending} onClick={verifyCodeAndSend} className={`rounded-2xl px-4 py-2 text-sm font-medium text-white ${sending ? "bg-blue-400" : "bg-blue-600 hover:bg-blue-700"}`}>{sending ? "Verifying..." : "Verify & Send"}</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Lightweight runtime tests
function __runDevTests() {
  try {
    const t0 = getRateForBalance(0); if (!t0 || t0.rate !== 0.006) throw new Error("Tier fail @0");
    const t1 = getRateForBalance(1_000_000); if (!t1 || t1.rate !== 0.004) throw new Error("Tier fail @1M");
    const t2 = getRateForBalance(4_000_000); if (!t2 || t2.rate !== 0.0037) throw new Error("Tier fail @4M");
    const t3 = getRateForBalance(10_000_000); if (!t3 || t3.rate !== 0.0028) throw new Error("Tier fail @10M");
    const t4 = getRateForBalance(20_000_000); if (t4 !== null) throw new Error("Tier fail @20M+");
    if (__employeeFee(10, true) !== 300) throw new Error("Employee fee AE yes");
    if (__employeeFee(10, false) !== 400) throw new Error("Employee fee AE no");
    if (Math.abs(__qdiaFee(1_000_000) - 700) > 0.001) throw new Error("QDIA calc");
    if (Math.abs(__advisorFee(200_000, true, 0) - 1_000) > 0.001) throw new Error("Advisor startup calc");
    if (__startupCreditCap(0) !== 500) throw new Error("Startup cap min");
    if (__startupCreditCap(10) !== 2500) throw new Error("Startup cap 10");
    console.debug("PriceItNow V4.1: tests passed");
  } catch (err: any) {
    console.warn("PriceItNow V4.1: tests warning:", err?.message || err);
  }
}
if (typeof window !== "undefined") __runDevTests();
