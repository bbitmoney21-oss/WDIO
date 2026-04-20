const express = require('express');

const router = express.Router();

router.get('/', (_req, res) => {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Universal Booking AI Agent</title>
    <style>
      :root {
        --bg: #f7f3ec;
        --card: #fffdf8;
        --ink: #171717;
        --muted: #5d5d5d;
        --accent: #c4572b;
        --accent-2: #1d6a5d;
      }
      * { box-sizing: border-box; }
      body { margin: 0; font-family: Georgia, serif; background: linear-gradient(180deg, #f7f3ec 0%, #efe6d7 100%); color: var(--ink); }
      .wrap { width: min(1120px, calc(100% - 32px)); margin: 0 auto; }
      .hero { padding: 72px 0 48px; display: grid; gap: 24px; }
      .eyebrow { font: 600 14px/1.2 Arial, sans-serif; letter-spacing: 0.12em; text-transform: uppercase; color: var(--accent-2); }
      h1 { margin: 0; font-size: clamp(42px, 7vw, 78px); line-height: 0.98; max-width: 900px; }
      .sub { max-width: 720px; font: 400 20px/1.6 Arial, sans-serif; color: var(--muted); }
      .actions { display: flex; gap: 12px; flex-wrap: wrap; }
      .btn { display: inline-block; border-radius: 999px; padding: 14px 22px; text-decoration: none; font: 600 15px/1 Arial, sans-serif; }
      .btn-primary { background: var(--accent); color: #fff; }
      .btn-secondary { background: rgba(23,23,23,0.08); color: var(--ink); }
      section { padding: 28px 0; }
      .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
      .card { background: var(--card); border: 1px solid rgba(23,23,23,0.08); border-radius: 20px; padding: 24px; box-shadow: 0 12px 30px rgba(0,0,0,0.05); }
      h2 { margin: 0 0 12px; font-size: 30px; }
      h3 { margin: 0 0 10px; font-size: 20px; }
      p, li { font: 400 16px/1.6 Arial, sans-serif; color: var(--muted); }
      ul { margin: 0; padding-left: 18px; }
      .pricing .card strong { display: block; font-size: 28px; margin-bottom: 10px; }
      .cta { padding: 48px 0 80px; text-align: center; }
      .cta .card { background: #171717; color: #fff; }
      .cta p { color: rgba(255,255,255,0.75); }
      code { background: rgba(0,0,0,0.06); padding: 2px 6px; border-radius: 8px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <section class="hero">
        <div class="eyebrow">Universal Booking AI Agent</div>
        <h1>One AI that handles orders, bookings, and customer requests instantly.</h1>
        <p class="sub">Replace phone calls, booking delays, and manual staff handoffs with one SaaS platform for restaurants and clinics.</p>
        <div class="actions">
          <a class="btn btn-primary" href="/onboarding">Start Free Trial</a>
          <a class="btn btn-secondary" href="#pricing">See Pricing</a>
        </div>
      </section>

      <section>
        <h2>The problem</h2>
        <div class="grid">
          <div class="card"><h3>Missed calls</h3><p>Customers give up when nobody answers during rush hours or after-hours.</p></div>
          <div class="card"><h3>Manual booking errors</h3><p>Wrong items, double-booked slots, and inconsistent confirmations cost time and trust.</p></div>
          <div class="card"><h3>Staff overload</h3><p>Your team should serve customers, not repeat the same order and booking workflow all day.</p></div>
        </div>
      </section>

      <section>
        <h2>The solution</h2>
        <div class="grid">
          <div class="card"><h3>Instant AI handling</h3><p>The agent detects whether a customer wants a food order or a clinic appointment.</p></div>
          <div class="card"><h3>Execution built in</h3><p>Orders route to a kitchen print flow. Appointments route to calendar + email confirmations.</p></div>
          <div class="card"><h3>Tenant-ready SaaS</h3><p>API keys, plan limits, tenant analytics, and upgrade flow are included out of the box.</p></div>
        </div>
      </section>

      <section>
        <h2>Features</h2>
        <div class="grid">
          <div class="card"><h3>AI order taking</h3><p>Turn free-text customer messages into structured restaurant orders.</p></div>
          <div class="card"><h3>Appointment booking</h3><p>Capture patient name, service, and preferred time with a single request.</p></div>
          <div class="card"><h3>Email confirmations</h3><p>Send booking confirmation emails to patients and clinic admins.</p></div>
          <div class="card"><h3>Kitchen printing</h3><p>Trigger mock or real kitchen printer execution from the same order pipeline.</p></div>
        </div>
      </section>

      <section class="pricing" id="pricing">
        <h2>Pricing</h2>
        <div class="grid">
          <div class="card"><strong>Free</strong><p>50 AI requests/month, 20 orders or bookings, core API access.</p></div>
          <div class="card"><strong>Pro</strong><p>2000 AI requests/month, 1000 orders or bookings, printer + email enabled.</p></div>
          <div class="card"><strong>Enterprise</strong><p>Unlimited usage, priority processing, and custom integrations.</p></div>
        </div>
      </section>

      <section class="cta">
        <div class="card">
          <h2>Start in 2 minutes</h2>
          <p>Create a tenant, generate an API key, and embed the SDK into your site or POS.</p>
          <a class="btn btn-primary" href="/onboarding">Start Free Trial</a>
        </div>
      </section>
    </div>
  </body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(html);
});

module.exports = router;
