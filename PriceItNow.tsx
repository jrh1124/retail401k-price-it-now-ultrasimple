import React from "react";

export default function PriceItNow(){
  return (
    <div className="min-h-screen grid place-items-center p-10">
      <div className="max-w-xl text-center space-y-3">
        <h1 className="text-3xl font-semibold">Retail401k – Price It Now</h1>
        <p className="text-slate-600">Success! This ultra-simple layout avoids the /src path issue.</p>
        <ol className="text-left text-slate-700 space-y-2 list-decimal">
          <li>Once live, open <code>PriceItNow.tsx</code> in GitHub and paste your full calculator code from ChatGPT.</li>
          <li>Commit → Vercel redeploys automatically.</li>
        </ol>
      </div>
    </div>
  );
}