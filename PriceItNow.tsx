import React, { useMemo, useState } from "react";

/**
 * Retail401k "Price it Now" — single-file React component
 * Target: ultra-simple repo (root-level PriceItNow.tsx)
 * Requires Tailwind CSS (already configured in the package I gave you)
 *
 * IMPORTANT:
 * - This version calls your Vercel API routes:
 *     POST /api/price-it-now/request-code
 *     POST /api/price-it-now/verify-code
 *     POST /api/price-it-now/send-quote
 *     POST /api/price-it-now/notify-internal
 * - Set env vars in Vercel (Settings → Environment Variables):
 *     SENDGRID_API_KEY, FROM_EMAIL, TEAM_EMAIL
 */

// ---------------- Utils ----------------
const currency = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(isFinite(n) ? n : 0);

const numberFmt = (n: number) =>
  new Intl.NumberFormat("en-US").format(isFinite(n) ? n : 0);

// ---------------- Pricing Tables & Constants ----------------
const TIERS = [
  { min: 0, max: 1_000_000 - 0.01, rate: 0.006, label: "$0 – $1,000,000", rateLabel: "0.60%" },
  { min: 1_000_000, max: 4_000_000 - 0.01, rate: 0.004, label: "$1,000,000 – $4,000,000", rateLabel: "0.40%" },
  { min: 4_000_000, max: 10_000_000 - 0.01, rate: 0.0037, label: "$4,000,000 – $10,000,000", rateLabel: "0.37%" },
  { min: 10_000_000, max: 20_000_000 - 0.01, rate: 0.0028, label: "$10,000,000 – $20,000,000", rateLabel: "0.28%" },
];
const STATIC_QDIA_RATE = 0.0007;   // 0.07%
const STARTUP_ADVISOR_RATE = 0.005; // 0.50%
const TPA_MONTHLY_FEE = 69.99;      // per month
const TPA_ANNUAL_FEE = 750;         // discounted annual option
const ONE_TIME_SETUP_FEE = 750;     // Waived for takeover/existing plans

function getRateForBalance(balance: number) {
  if (balance >= 20_000_000) return null; // Custom pricing above this
  return TIERS.find((t) => balance >= t.min && balance <= t.max) || TIERS[0];
}

// ---------------- Small verifiable helpers (for tests) ----------------
export function __employeeFee(participants: number, autoEnrollYes: boolean) {
  const p = Number(participants) || 0;
  return p * (autoEnrollYes ? 30 : 40);
}
export function __qdiaFee(base: number) {
  return (Number(base) || 0) * STATIC_QDIA_RATE;
}
export function __advisorFee(base: number, isStartup: boolean, advisorPct: number) {
  const b = Number(base) || 0;
  return isStartup ? b * STARTUP_ADVISOR_RATE : b * ((Number(advisorPct) || 0) / 100);
}

// ---------------- Component ----------------
export default function PriceItNow() {
  // Inputs
  const [hasExisting, setHasExisting] = useState<"no" | "yes">("no");
  const [balance, setBalance] = useState<number>(0);
  const [annualContrib, setAnnualContrib] = useState<number>(0);
  const [eligible, setEligible] = useState<number>(0);
  const [participants, setParticipants] = useState<number>(0);
  const [autoEnrollExisting, setAutoEnrollExisting] = useState<"no" | "yes">("no");
  const [advisorRate, setAdvisorRate] = useState<number>(0); // % for existing plan
  const [tpaBilling, setTpaBilling] = useState<"monthly" | "annual">("monthly");

  // UI state
  const [showSheet, setShowSheet] = useState<boolean>(false); // results revealed only after verification success
  const [showContactModal, setShowContactModal] = useState<boolean>(false);
  const [contact, setContact] = useState({ firstName: "", lastName: "", company: "", email: "", phone: "" });
  const [formErr, setFormErr] = useState<string>("");

  // Verification flow
  const [verifyStep, setVerifyStep] = useState<"contact" | "code" | "done">("contact");
  const [sending, setSending] = useState<boolean>(false);
  const [code, setCode] = useState<string>("");
  const [verifying, setVerifying] = useState<boolean>(false);
  const [sentOk, setSentOk] = useState<boolean>(false);

  // Derived
  const tier = useMemo(
    () => getRateForBalance(hasExisting === "yes" ? (Number(balance) || 0) : 0),
    [hasExisting, balance]
  );

  // SECURE 2.0 assumption: startups use auto-enrollment
  const assumedAutoEnroll: "yes" | "no" = hasExisting === "yes" ? autoEnrollExisting : "yes";

  // Fee base: existing = balance + contributions; start-up = contributions only
  const feeBase = useMemo(() => {
    const b = Number(balance) || 0;
    const c = Number(annualContrib) || 0;
    return hasExisting === "yes" ? b + c : c;
  }, [hasExisting, balance, annualContrib]);

  // Annualized fees
  const annualAssetFee = useMemo(() => (!tier ? null : feeBase * tier.rate), [tier, feeBase]);
  const annualEmployeeFee = useMemo(
    () => __employeeFee(participants, assumedAutoEnroll === "yes"),
    [participants, assumedAutoEnroll]
  );
  const annualQdiaFee = useMemo(() => __qdiaFee(feeBase), [feeBase]);
  const annualAdvisorFee = useMemo(
    () => __advisorFee(feeBase, hasExisting === "no", advisorRate),
    [feeBase, hasExisting, advisorRate]
  );
  const annualTpaFee = useMemo(
    () => (tpaBilling === "annual" ? TPA_ANNUAL_FEE : TPA_MONTHLY_FEE * 12),
    [tpaBilling]
  );

  const setupFee = hasExisting === "yes" ? 0 : ONE_TIME_SETUP_FEE;

  const totalOngoingAnnual = useMemo(
    () => (annualAssetFee || 0) + annualEmployeeFee + annualQdiaFee + annualAdvisorFee + annualTpaFee,
    [annualAssetFee, annualEmployeeFee, annualQdiaFee, annualAdvisorFee, annualTpaFee]
  );

  const firstYearTotal = useMemo(() => totalOngoingAnnual + setupFee, [totalOngoingAnnual, setupFee]);

  const percentOfBase = (fee: number) => (!feeBase ? "0.00%" : ((fee / feeBase) * 100).toFixed(2) + "%");
  const totalPercentage = useMemo(
    () => (!feeBase ? "0.00" : ((totalOngoingAnnual / feeBase) * 100).toFixed(2)),
    [totalOngoingAnnual, feeBase]
  );

  // Simple sanity gating
  const canContinue = useMemo(
    () =>
      eligible >= 0 &&
      participants >= 0 &&
      (hasExisting === "yes" ? Number(balance) >= 0 : true) &&
      (hasExisting === "no" ? Number(annualContrib) >= 0 : true),
    [eligible, participants, hasExisting, balance, annualContrib]
  );

  // ---------- Email payload + flow ----------
  function buildCalcHtml() {
    const lines: string[] = [];
    const planType = hasExisting === "yes" ? "Existing 401(k) Plan" : "Start-up 401(k) Plan";
    const advLabel = hasExisting === "no" ? "0.50% startup" : String(advisorRate || 0) + "%";
    const autoEnrollText = assumedAutoEnroll === "yes" ? "Yes" : "No";
    const tpaText = tpaBilling === "annual"
      ? `Prepaid annually (${currency(TPA_ANNUAL_FEE)}/yr)`
      : `Billed monthly (${currency(TPA_MONTHLY_FEE)}/mo)`;

    lines.push("<h2>Retail401k Cost Sheet</h2>");
    lines.push(`<p><strong>Plan Type:</strong> ${planType}</p>`);
    lines.push(`<p><strong>Auto-Enrollment:</strong> ${autoEnrollText}${hasExisting === "no" ? " (Assumed per SECURE 2.0)" : ""}</p>`);
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
    if (tier) lines.push(`<li>Asset-based fee ${tier.rateLabel}: ${currency(annualAssetFee || 0)}</li>`);
    else lines.push(`<li>Asset-based fee: Custom pricing for $20,000,000+ balances</li>`);
    lines.push(`<li>QDIA fee (0.07%): ${currency(annualQdiaFee)}</li>`);
    lines.push(`<li>Advisor fee (${advLabel}): ${currency(annualAdvisorFee)}</li>`);
    lines.push(`<li>Active employee fee (${assumedAutoEnroll === 'yes' ? '$30' : '$40'} × participants): ${currency(annualEmployeeFee)}</li>`);
    lines.push(`<li>TPA/3(16) Admin/Compliance: ${currency(annualTpaFee)} (${tpaText})</li>`);
    if (setupFee > 0) lines.push(`<li>One-time setup fee (first year only): ${currency(setupFee)}</li>`);
    else lines.push(`<li>One-time setup fee: Waived for takeover (existing plan)</li>`);
    lines.push("</ul>");
    const totalPct = hasExisting === "yes" && feeBase > 0 ? ` (${totalPercentage}% of fee base)` : "";
    lines.push(`<p><strong>Ongoing annual cost:</strong> ${currency(totalOngoingAnnual)}${totalPct}</p>`);
    lines.push(`<p><strong>First-year total:</strong> ${currency(firstYearTotal)}</p>`);
    lines.push("<hr/>");
    lines.push(`<p style="font-size:12px;color:#334155;">Disclosures: This calculator is provided for illustrative and educational purposes only. Calculations are estimates and not a guarantee of actual fees or expenses. Additional fees may apply. Past performance is not indicative of future results. Please consult your financial, tax, or legal advisor for advice specific to your situation. Tax credit illustrations, if any, are estimates only; consult a qualified tax professional to confirm applicability and eligibility to your circumstances.</p>`);
    lines.push(`<p style="font-size:12px;color:#334155;">Recordkeeping services provided by Transamerica Retirement Services. 3(38) Fiduciary Services provided by Atlas Fiduciary Services, Inc., an SEC registered Investment Advisor. 3(16) Services provided by Atlas Pension Administrators, Inc. Costs associated with these services are included in the recordkeeping asset fees described above. Investment Advisor Fees are a separate engagement between the adopting employer and the advisor or advisor's firm. TPA/3(16) Plan Administration/Compliance Fee is billed directly to the employer. Discounts apply if paid annually. Annual billable of $750 if preferred.</p>`);
    return lines.join("");
  }

  async function requestCode() {
    const res = await fetch("/api/price-it-now/request-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: contact.email, contact }),
    });
    if (!res.ok) throw new Error("Failed to send code");
    return res.json();
  }

  async function verifyCodeReq() {
    const res = await fetch("/api/price-it-now/verify-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: contact.email, code }),
    });
    if (!res.ok) throw new Error("Invalid code");
    return res.json();
  }

  async function sendQuoteEmail(calcHtml: string) {
    const res = await fetch("/api/price-it-now/send-quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sendTo: contact.email, calcHtml }),
    });
    if (!res.ok) throw new Error("Failed to send quote");
    return res.json();
  }

  async function notifyInternal(calcHtml: string) {
    const payload = {
      timestamp: new Date().toISOString(),
      sendTo: contact.email,
      notifyTo: "team@retail401k.com",
      contact,
      inputs: {
        hasExisting,
        balance: Number(balance) || 0,
        annualContrib: Number(annualContrib) || 0,
        eligible,
        participants,
        autoEnroll: assumedAutoEnroll,
        advisorRate: hasExisting === "no" ? 0.5 : Number(advisorRate || 0),
        tpaBilling,
      },
      feeBase,
      calculations: {
        tier: tier ? { label: tier.label, rateLabel: tier.rateLabel, rate: tier.rate } : null,
        annualAssetFee: annualAssetFee ?? 0,
        annualEmployeeFee,
        annualQdiaFee,
        annualAdvisorFee,
        annualTpaFee,
        setupFee,
        totalOngoingAnnual: totalOngoingAnnual,
        firstYearTotal: firstYearTotal,
        totalPercentage: hasExisting === "yes" ? Number(totalPercentage || 0) : null,
      },
      calcHtml,
    };
    const res = await fetch("/api/price-it-now/notify-internal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error("Failed to notify internal");
    return res.json();
  }

  // ---------- UI Handlers ----------
  function openContactModal() {
    setShowContactModal(true);
    setVerifyStep("contact");
    setFormErr("");
    setSentOk(false);
    setCode("");
  }

  async function handleContactSubmit() {
    setFormErr("");
    // Basic validation
    if (!contact.firstName || !contact.lastName || !contact.company || !contact.email) {
      setFormErr("Please complete all required fields.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
      setFormErr("Please enter a valid email address.");
      return;
    }
    try {
      setSending(true);
      await requestCode();
      setSentOk(true);
      setVerifyStep("code");
    } catch (e) {
      setFormErr("We couldn't send a verification code. Please verify your email is correct and try again.");
    } finally {
      setSending(false);
    }
  }

  async function handleVerifySubmit() {
    setFormErr("");
    if (!code || code.trim().length < 4) {
      setFormErr("Please enter the verification code that was emailed to you.");
      return;
    }
    try {
      setVerifying(true);
      await verifyCodeReq();

      // Build sheet + send emails
      const calcHtml = buildCalcHtml();
      await sendQuoteEmail(calcHtml);
      await notifyInternal(calcHtml);

      // Reveal results
      setShowContactModal(false);
      setShowSheet(true);
      setVerifyStep("done");
    } catch (e) {
      setFormErr("That code didn’t work. Please check the email and try again (or resend).");
    } finally {
      setVerifying(false);
    }
  }

  async function handleResendCode() {
    setFormErr("");
    try {
      setSending(true);
      await requestCode();
      setSentOk(true);
    } catch (e) {
      setFormErr("We couldn't resend the code. Please try again shortly.");
    } finally {
      setSending(false);
    }
  }

  async function handleEmailToSelf() {
    const calcHtml = buildCalcHtml();
    try {
      await sendQuoteEmail(calcHtml);
    } catch {
      // surface a gentle message?
      alert("We couldn't email a copy right now. Please try again later.");
    }
  }

  function clearAll() {
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
    setContact({ firstName: "", lastName: "", company: "", email: "", phone: "" });
    setFormErr("");
    setVerifyStep("contact");
    setSentOk(false);
    setCode("");
  }

  // ---------------- Render ----------------
  return (
    <div className="min-h-screen bg-slate-50 py-10">
      <div className="mx-auto max-w-5xl px-4">
        <header className="mb-8 flex items-center justify-between print:hidden">
          <h1 className="text-3xl font-semibold tracking-tight">Price it Now</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={clearAll}
              className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-1.5 text-sm shadow-sm hover:bg-white"
              title="Reset all inputs"
            >
              Clear inputs
            </button>
            {showSheet && (
              <>
                <button
                  onClick={() => window.print()}
                  className="inline-flex items-center rounded-2xl border border-slate-300 px-3 py-1.5 text-sm shadow-sm hover:bg-white"
                >
                  Print
                </button>
                <button
                  onClick={handleEmailToSelf}
                  className="inline-flex items-center rounded-2xl border border-blue-600 text-blue-600 px-3 py-1.5 text-sm shadow-sm hover:bg-blue-50"
                >
                  Email me a copy
                </button>
              </>
            )}
          </div>
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
                  {[
                    { id: "existing-no", label: "No" as const },
                    { id: "existing-yes", label: "Yes" as const },
                  ].map((opt) => (
                    <label
                      key={opt.id}
                      htmlFor={opt.id}
                      className={`cursor-pointer rounded-xl border px-4 py-2 text-sm shadow-sm transition ${
                        hasExisting === opt.label.toLowerCase()
                          ? "border-blue-600 ring-2 ring-blue-200"
                          : "border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <input
                        id={opt.id}
                        type="radio"
                        className="sr-only"
                        name="hasExisting"
                        value={opt.label.toLowerCase()}
                        checked={hasExisting === opt.label.toLowerCase()}
                        onChange={(e) => setHasExisting(e.target.value as "no" | "yes")}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  If you select "No", we'll treat this as a start-up 401(k) plan and assume auto-enrollment per SECURE 2.0.
                </p>
              </div>

              {/* Balance (existing only) */}
              {hasExisting === "yes" && (
                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor="balance">
                    Current plan balance
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                    <input
                      id="balance"
                      type="number"
                      min={0}
                      step="1000"
                      placeholder="0"
                      value={balance}
                      onChange={(e) => setBalance(Number(e.target.value))}
                      className="w-full rounded-xl border border-slate-300 px-8 py-2 shadow-sm focus:border-blue-600 focus:outline-none"
                    />
                  </div>
                </div>
              )}

              {/* Annual contributions */}
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="annualContrib">
                  {hasExisting === "yes" ? "Projected annual contributions" : "Estimated first-year contributions"}
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">$</span>
                  <input
                    id="annualContrib"
                    type="number"
                    min={0}
                    step="1000"
                    placeholder="0"
                    value={annualContrib}
                    onChange={(e) => setAnnualContrib(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-300 px-8 py-2 shadow-sm focus:border-blue-600 focus:outline-none"
                  />
                </div>
              </div>

              {/* Eligible employees */}
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="eligible">
                  How many eligible employees will there be?
                </label>
                <input
                  id="eligible"
                  type="number"
                  min={0}
                  value={eligible}
                  onChange={(e) => setEligible(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-600 focus:outline-none"
                />
              </div>

              {/* Participants */}
              <div>
                <label className="mb-1 block text-sm font-medium" htmlFor="participants">
                  How many employees will participate? (estimate is OK)
                </label>
                <input
                  id="participants"
                  type="number"
                  min={0}
                  value={participants}
                  onChange={(e) => setParticipants(Number(e.target.value))}
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-600 focus:outline-none"
                />
              </div>

              {/* Auto-enrollment (existing only) */}
              {hasExisting === "yes" && (
                <div>
                  <label className="mb-2 block text-sm font-medium">Do you offer Auto-Enrollment today?</label>
                  <div className="flex gap-3">
                    {(["no", "yes"] as const).map((v) => (
                      <label
                        key={v}
                        className={`cursor-pointer rounded-xl border px-4 py-2 text-sm shadow-sm transition ${
                          autoEnrollExisting === v ? "border-blue-600 ring-2 ring-blue-200" : "border-slate-300 hover:bg-slate-50"
                        }`}
                      >
                        <input
                          type="radio"
                          name="ae"
                          className="sr-only"
                          value={v}
                          checked={autoEnrollExisting === v}
                          onChange={(e) => setAutoEnrollExisting(e.target.value as "no" | "yes")}
                        />
                        {v === "yes" ? "Yes" : "No"}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* Advisor compensation (existing only) */}
              {hasExisting === "yes" && (
                <div>
                  <label className="mb-1 block text-sm font-medium" htmlFor="advisorRate">
                    Current Financial Advisor Compensation (% of assets)
                  </label>
                  <input
                    id="advisorRate"
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    value={advisorRate}
                    onChange={(e) => setAdvisorRate(Number(e.target.value))}
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-600 focus:outline-none"
                  />
                </div>
              )}

              {/* TPA Billing Preference */}
              <div>
                <label className="mb-2 block text-sm font-medium">TPA/3(16) Billing Preference</label>
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: "tpa-monthly", label: `Monthly (${currency(TPA_MONTHLY_FEE)}/mo)`, value: "monthly" as const },
                    {
                      id: "tpa-annual",
                      label: `Annual (${currency(TPA_ANNUAL_FEE)}/yr, saves ${currency(TPA_MONTHLY_FEE * 12 - TPA_ANNUAL_FEE)})`,
                      value: "annual" as const,
                    },
                  ].map((opt) => (
                    <label
                      key={opt.id}
                      htmlFor={opt.id}
                      className={`cursor-pointer rounded-xl border px-4 py-2 text-sm shadow-sm transition ${
                        tpaBilling === opt.value ? "border-blue-600 ring-2 ring-blue-200" : "border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <input
                        id={opt.id}
                        type="radio"
                        className="sr-only"
                        name="tpaBilling"
                        value={opt.value}
                        checked={tpaBilling === opt.value}
                        onChange={(e) => setTpaBilling(e.target.value as "monthly" | "annual")}
                      />
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
                  className={`w-full rounded-2xl px-4 py-3 text-center text-sm font-medium shadow-sm transition ${
                    canContinue ? "bg-blue-600 text-white hover:bg-blue-700" : "bg-slate-200 text-slate-500"
                  }`}
                >
                  Submit
                </button>
              </div>
            </div>
          </section>

          {/* OUTPUT CARD */}
          <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-medium">Your cost sheet</h2>
              {showSheet && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => window.print()}
                    className="inline-flex items-center rounded-xl border border-slate-300 px-3 py-1.5 text-xs shadow-sm hover:bg-slate-50 print:hidden"
                  >
                    Print
                  </button>
                  <button
                    onClick={handleEmailToSelf}
                    className="inline-flex items-center rounded-xl border border-blue-600 text-blue-600 px-3 py-1.5 text-xs shadow-sm hover:bg-blue-50 print:hidden"
                  >
                    Email me a copy
                  </button>
                </div>
              )}
            </div>

            {!showSheet ? (
              <div className="rounded-xl border border-slate-200 p-6 text-slate-600">
                {/* Intentionally subtle: no warning about contact info here */}
                Your personalized cost breakdown will appear here after you submit.
              </div>
            ) : (
              <div className="space-y-6">
                {/* Summary */}
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-xl bg-slate-50 p-4">
                    <p className="text-xs uppercase tracking-wider text-slate-500">Plan Type</p>
                    <p className="text-sm font-medium">{hasExisting === "yes" ? "Existing 401(k) Plan" : "Start-up 401(k) Plan"}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-4">
                    <p className="text-xs uppercase tracking-wider text-slate-500">Auto-Enrollment</p>
                    <p className="text-sm font-medium">
                      {assumedAutoEnroll === "yes" ? "Yes" : "No"}
                      {hasExisting === "no" && <span className="ml-2 text-xs text-slate-500">(Assumed per SECURE 2.0)</span>}
                    </p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-4">
                    <p className="text-xs uppercase tracking-wider text-slate-500">Eligible Employees</p>
                    <p className="text-sm font-medium">{numberFmt(eligible)}</p>
                  </div>
                  <div className="rounded-xl bg-slate-50 p-4">
                    <p className="text-xs uppercase tracking-wider text-slate-500">Expected Participants</p>
                    <p className="text-sm font-medium">{numberFmt(participants)}</p>
                  </div>
                </div>

                {/* Asset Charge Schedule */}
                <div className="rounded-2xl border border-slate-200">
                  <div className="border-b px-4 py-3">
                    <p className="text-sm font-medium">Contract Asset Charge</p>
                    <p className="text-xs text-slate-500">Based on total contract balance</p>
                  </div>
                  <div className="divide-y">
                    {TIERS.map((t, i) => (
                      <div key={i} className="flex items-center justify-between px-4 py-3">
                        <div className="text-sm">{t.label}</div>
                        <div className="text-sm font-medium">{t.rateLabel}</div>
                      </div>
                    ))}
                    <div className="flex items-center justify-between px-4 py-3">
                      <div className="text-sm">$20,000,000+</div>
                      <div className="text-sm font-medium">Custom</div>
                    </div>
                  </div>
                </div>

                {/* Fee base explanation */}
                <div className="rounded-xl bg-slate-50 p-4 text-sm">
                  {hasExisting === "yes" ? (
                    <>
                      <p>
                        Current balance: <span className="font-medium">{currency(Number(balance) || 0)}</span>
                      </p>
                      <p>
                        Projected contributions: <span className="font-medium">{currency(Number(annualContrib) || 0)}</span>
                      </p>
                      <p>
                        Fee base (balance + contributions): <span className="font-semibold">{currency(feeBase)}</span>
                      </p>
                    </>
                  ) : (
                    <>
                      <p>
                        Estimated first-year contributions: <span className="font-medium">{currency(Number(annualContrib) || 0)}</span>
                      </p>
                      <p>
                        Fee base: <span className="font-semibold">{currency(feeBase)}</span>
                      </p>
                    </>
                  )}
                </div>

                {/* Calculation & (percentages hidden for startups) */}
                <div className="rounded-2xl bg-slate-50 p-4 space-y-2 text-sm">
                  {tier ? (
                    <div>
                      Asset-based fee (@ {tier.rateLabel}): <span className="font-semibold">{currency(annualAssetFee || 0)}</span>
                      {hasExisting === "yes" && <span className="ml-2 text-xs text-slate-600">({percentOfBase(annualAssetFee || 0)})</span>}
                    </div>
                  ) : (
                    <div className="text-sm">
                      For balances of $20,000,000 or more, pricing is custom. Please contact us for a tailored proposal.
                    </div>
                  )}

                  <div>
                    QDIA investment fee (0.07%): <span className="font-semibold">{currency(annualQdiaFee)}</span>
                    {hasExisting === "yes" && <span className="ml-2 text-xs text-slate-600">({percentOfBase(annualQdiaFee)})</span>}
                  </div>

                  <div>
                    Financial Advisor fee ({hasExisting === "no" ? "0.50% startup" : String(advisorRate || 0) + "%"}):{" "}
                    <span className="font-semibold">{currency(annualAdvisorFee)}</span>
                    {hasExisting === "yes" && <span className="ml-2 text-xs text-slate-600">({percentOfBase(annualAdvisorFee)})</span>}
                  </div>

                  <div>
                    Active employee fee ({assumedAutoEnroll === "yes" ? "$30" : "$40"} × participants):{" "}
                    <span className="font-semibold">{currency(annualEmployeeFee)}</span>
                    {hasExisting === "yes" && <span className="ml-2 text-xs text-slate-600">({percentOfBase(annualEmployeeFee)})</span>}
                  </div>

                  <div>
                    TPA/3(16) Admin/Compliance fee: <span className="font-semibold">{currency(annualTpaFee)}</span>
                    {hasExisting === "yes" && <span className="ml-2 text-xs text-slate-600">({percentOfBase(annualTpaFee)})</span>}
                    <span className="ml-2 text-xs text-slate-500">
                      {tpaBilling === "monthly"
                        ? `(billed ${currency(TPA_MONTHLY_FEE)}/month)`
                        : `(prepaid annually, saves ${currency(TPA_MONTHLY_FEE * 12 - TPA_ANNUAL_FEE)})`}
                    </span>
                  </div>

                  <div>
                    One-time setup fee:{" "}
                    <span className="font-semibold">
                      {hasExisting === "yes" ? "Waived (takeover)" : currency(setupFee)}
                    </span>{" "}
                    <span className="ml-2 text-xs text-slate-500">(applies first year only)</span>
                  </div>

                  <div className="font-medium border-t pt-2 mt-2">
                    Ongoing annual cost: <span className="font-semibold">{currency(totalOngoingAnnual)}</span>
                    {hasExisting === "yes" && feeBase > 0 && (
                      <span className="ml-2 text-slate-600">({totalPercentage}% of fee base)</span>
                    )}
                  </div>
                  <div className="font-medium">
                    First-year total: <span className="font-semibold">{currency(firstYearTotal)}</span>
                  </div>
                </div>

                {/* Existing plan CTA */}
                {hasExisting === "yes" && (
                  <div className="rounded-xl border border-blue-200 bg-blue-50 p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <p className="text-sm text-slate-700">
                        Want a complimentary cost/benefit analysis comparing your current plan vs. the Retail401k MEP 401(k)?
                      </p>
                      <a
                        href="https://calendly.com/jheise-1/mep-401k-info-session"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
                      >
                        Schedule a call
                      </a>
                    </div>
                  </div>
                )}

                {/* Disclosures (collapsible on-screen, visible when printed) */}
                <details className="print:hidden rounded-xl border border-slate-200 p-4 bg-white">
                  <summary className="cursor-pointer select-none text-sm font-medium">Disclosures</summary>
                  <div className="mt-2 text-xs text-slate-600 space-y-2">
                    <p>
                      This calculator is provided for illustrative and educational purposes only. Calculations are estimates and not a
                      guarantee of actual fees or expenses. Additional fees may apply. Past performance is not indicative of future results.
                      Please consult your financial, tax, or legal advisor for advice specific to your situation. Tax credit illustrations,
                      if any, are estimates only; consult a qualified tax professional to confirm applicability and eligibility to your
                      circumstances.
                    </p>
                    <p>
                      Recordkeeping services provided by Transamerica Retirement Services. 3(38) Fiduciary Services provided by Atlas
                      Fiduciary Services, Inc., an SEC registered Investment Advisor. 3(16) Services provided by Atlas Pension
                      Administrators, Inc. Costs associated with these services are included in the recordkeeping asset fees described
                      above. Investment Advisor Fees are a separate engagement between the adopting employer and the advisor or advisor's
                      firm. TPA/3(16) Plan Administration/Compliance Fee is billed directly to the employer. Discounts apply if paid
                      annually. Annual billable of $750 if preferred.
                    </p>
                  </div>
                </details>
                <div className="hidden print:block text-[11px] leading-snug text-slate-700 space-y-1">
                  <p>
                    <strong>Disclosures:</strong> This calculator is provided for illustrative and educational purposes only. Calculations are
                    estimates and not a guarantee of actual fees or expenses. Additional fees may apply. Past performance is not indicative
                    of future results. Please consult your financial, tax, or legal advisor for advice specific to your situation. Tax credit
                    illustrations, if any, are estimates only; consult a qualified tax professional to confirm applicability and eligibility
                    to your circumstances.
                  </p>
                  <p>
                    Recordkeeping services provided by Transamerica Retirement Services. 3(38) Fiduciary Services provided by Atlas
                    Fiduciary Services, Inc., an SEC registered Investment Advisor. 3(16) Services provided by Atlas Pension
                    Administrators, Inc. Costs associated with these services are included in the recordkeeping asset fees described above.
                    Investment Advisor Fees are a separate engagement between the adopting employer and the advisor or advisor's firm.
                    TPA/3(16) Plan Administration/Compliance Fee is billed directly to the employer. Discounts apply if paid annually. Annual
                    billable of $750 if preferred.
                  </p>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>

      {/* CONTACT / VERIFICATION MODAL */}
      {showContactModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:hidden"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-medium">
                {verifyStep === "contact" ? "Send my cost sheet" : verifyStep === "code" ? "Enter verification code" : "All set"}
              </h3>
              <button
                onClick={() => setShowContactModal(false)}
                className="rounded-lg px-2 py-1 text-slate-500 hover:bg-slate-100"
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {verifyStep === "contact" && (
              <div className="grid gap-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-slate-600" htmlFor="firstName">
                      First name*
                    </label>
                    <input
                      id="firstName"
                      className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                      value={contact.firstName}
                      onChange={(e) => setContact({ ...contact, firstName: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-slate-600" htmlFor="lastName">
                      Last name*
                    </label>
                    <input
                      id="lastName"
                      className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                      value={contact.lastName}
                      onChange={(e) => setContact({ ...contact, lastName: e.target.value })}
                    />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-slate-600" htmlFor="company">
                    Company*
                  </label>
                  <input
                    id="company"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                    value={contact.company}
                    onChange={(e) => setContact({ ...contact, company: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-600" htmlFor="email">
                    Email*
                  </label>
                  <input
                    id="email"
                    type="email"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                    value={contact.email}
                    onChange={(e) => setContact({ ...contact, email: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs text-slate-600" htmlFor="phone">
                    Phone
                  </label>
                  <input
                    id="phone"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                    value={contact.phone}
                    onChange={(e) => setContact({ ...contact, phone: e.target.value })}
                  />
                </div>

                {formErr && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{formErr}</div>}
                {sentOk && (
                  <div className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-700">
                    Thanks! We sent a verification code to your email.
                  </div>
                )}

                <div className="mt-2 flex items-center justify-end gap-3">
                  <button onClick={() => setShowContactModal(false)} className="rounded-2xl px-4 py-2 text-sm ring-1 ring-slate-300 hover:bg-slate-50">
                    Cancel
                  </button>
                  <button
                    disabled={sending}
                    onClick={handleContactSubmit}
                    className={`rounded-2xl px-4 py-2 text-sm font-medium text-white ${
                      sending ? "bg-blue-400" : "bg-blue-600 hover:bg-blue-700"
                    }`}
                  >
                    {sending ? "Sending…" : "Submit"}
                  </button>
                </div>
              </div>
            )}

            {verifyStep === "code" && (
              <div className="grid gap-3">
                <p className="text-sm text-slate-600">
                  We emailed a verification code to <span className="font-medium">{contact.email}</span>. Enter it below to see your results.
                </p>
                <div>
                  <label className="text-xs text-slate-600" htmlFor="code">
                    Verification code
                  </label>
                  <input
                    id="code"
                    className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 tracking-widest"
                    placeholder="######"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </div>

                {formErr && <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{formErr}</div>}

                <div className="mt-2 flex items-center justify-between gap-3">
                  <button
                    onClick={handleResendCode}
                    disabled={sending}
                    className="rounded-2xl px-4 py-2 text-sm ring-1 ring-slate-300 hover:bg-slate-50"
                  >
                    {sending ? "Resending…" : "Resend code"}
                  </button>
                  <button
                    disabled={verifying}
                    onClick={handleVerifySubmit}
                    className={`rounded-2xl px-4 py-2 text-sm font-medium text-white ${
                      verifying ? "bg-blue-400" : "bg-blue-600 hover:bg-blue-700"
                    }`}
                  >
                    {verifying ? "Verifying…" : "Verify & Show Results"}
                  </button>
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

    // eslint-disable-next-line no-console
    console.debug("PriceItNow: tests passed");
  } catch (err: any) {
    // eslint-disable-next-line no-console
    console.warn("PriceItNow: tests warning:", err?.message || err);
  }
}
if (typeof window !== "undefined") __runDevTests();
