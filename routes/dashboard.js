const express = require('express');
const { getAnalyticsForTenant, getRecentActivity, buildUsageSummary } = require('../services/usageService');

const router = express.Router();

router.get('/', (req, res) => {
  const usage = buildUsageSummary(req.tenant);
  const analytics = getAnalyticsForTenant(req.tenant.id);
  const recentActivity = getRecentActivity(req.tenant.id, 10);

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${req.tenant.name} Dashboard</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; padding: 32px; background: #f4efe8; color: #1e1e1e; }
      .grid { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); }
      .card { background: #fff; border-radius: 16px; padding: 20px; box-shadow: 0 8px 24px rgba(0,0,0,0.08); }
      h1, h2 { margin: 0 0 12px; }
      button { background: #1e1e1e; color: #fff; border: 0; border-radius: 999px; padding: 12px 18px; cursor: pointer; }
      pre { white-space: pre-wrap; word-break: break-word; }
    </style>
  </head>
  <body>
    <h1>${req.tenant.name}</h1>
    <p>Plan: <strong>${req.tenant.plan}</strong> | Type: <strong>${req.tenant.type}</strong></p>
    <div class="grid">
      <div class="card"><h2>Usage</h2><pre>${JSON.stringify(usage, null, 2)}</pre></div>
      <div class="card"><h2>Analytics</h2><pre>${JSON.stringify(analytics, null, 2)}</pre></div>
      <div class="card"><h2>Recent Activity</h2><pre>${JSON.stringify(recentActivity, null, 2)}</pre></div>
    </div>
    <form method="post" action="/api/billing/upgrade?tenant_id=${req.tenant.id}">
      <button type="submit">Request Upgrade</button>
    </form>
  </body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(html);
});

module.exports = router;
