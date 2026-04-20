const express = require('express');
const { createTenant, defaultPlanForType, getPlanConfig } = require('../services/tenantService');

const router = express.Router();

router.get('/', (_req, res) => {
  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Onboarding | Universal Booking AI Agent</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; background: #f6f2ea; color: #171717; }
      .wrap { width: min(960px, calc(100% - 32px)); margin: 0 auto; padding: 48px 0 72px; }
      .card { background: #fff; border-radius: 20px; padding: 24px; box-shadow: 0 12px 24px rgba(0,0,0,0.06); margin-bottom: 18px; }
      h1 { margin: 0 0 8px; }
      .step { font-size: 14px; text-transform: uppercase; letter-spacing: 0.08em; color: #a65429; }
      label { display: block; margin-bottom: 8px; font-weight: 600; }
      input, select { width: 100%; padding: 12px 14px; border-radius: 12px; border: 1px solid rgba(0,0,0,0.12); margin-bottom: 14px; }
      button { background: #171717; color: #fff; border: 0; border-radius: 999px; padding: 12px 18px; cursor: pointer; }
      pre { white-space: pre-wrap; word-break: break-word; background: #faf7f2; padding: 16px; border-radius: 14px; }
      .muted { color: #626262; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <div class="step">Step 1</div>
        <h1>Create your workspace</h1>
        <p class="muted">Tell us your business name and whether you are a restaurant or clinic.</p>
        <form method="post" action="/api/onboarding/start">
          <label for="name">Business name</label>
          <input id="name" name="name" required />
          <label for="type">Business type</label>
          <select id="type" name="type">
            <option value="restaurant">Restaurant</option>
            <option value="clinic">Clinic</option>
          </select>
          <button type="submit">Generate API key</button>
        </form>
      </div>

      <div class="card">
        <div class="step">Step 2</div>
        <h2>What happens next</h2>
        <p class="muted">We will create your tenant, generate an API key, show a copy-paste SDK snippet, and give you a dashboard link.</p>
      </div>
    </div>
  </body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(html);
});

router.post('/start', (req, res) => {
  const { name, type } = req.body || {};
  const normalizedName = typeof name === 'string' ? name.trim() : '';
  const normalizedType = typeof type === 'string' ? type.trim().toLowerCase() : '';

  if (!normalizedName || !['restaurant', 'clinic'].includes(normalizedType)) {
    return res.status(400).json({
      error: 'Business name and valid type are required.',
    });
  }

  const assignedPlan = defaultPlanForType(normalizedType);
  const planConfig = getPlanConfig(assignedPlan);
  const tenant = createTenant({
    name: normalizedName,
    type: normalizedType,
    plan: assignedPlan,
  });
  const dashboardLink = `/dashboard?tenant_id=${tenant.id}&api_key=${tenant.api_key}`;
  const sdkSnippet = `import { bookOrOrder } from "universal-booking-sdk";

bookOrOrder({
  message: "${normalizedType === 'restaurant' ? '2 burgers and coke' : 'Book doctor appointment tomorrow 5pm'}",
  apiKey: "${tenant.api_key}",
  tenantId: "${tenant.id}"
});`;

  const acceptsHtml = String(req.headers.accept || '').includes('text/html');

  if (acceptsHtml) {
    const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Onboarding Complete</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 0; background: #f6f2ea; color: #171717; }
      .wrap { width: min(960px, calc(100% - 32px)); margin: 0 auto; padding: 48px 0 72px; }
      .card { background: #fff; border-radius: 20px; padding: 24px; box-shadow: 0 12px 24px rgba(0,0,0,0.06); margin-bottom: 18px; }
      pre { white-space: pre-wrap; word-break: break-word; background: #faf7f2; padding: 16px; border-radius: 14px; }
      a.button { display: inline-block; background: #171717; color: #fff; text-decoration: none; border-radius: 999px; padding: 12px 18px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <h1>${tenant.name} is ready</h1>
        <p>Your API key has been generated and your free workspace is live.</p>
        <p><strong>Tenant ID:</strong> ${tenant.id}</p>
        <p><strong>API Key:</strong> ${tenant.api_key}</p>
      </div>
      <div class="card">
        <h2>SDK snippet</h2>
        <pre>${sdkSnippet}</pre>
      </div>
      <div class="card">
        <h2>Dashboard</h2>
        <a class="button" href="${dashboardLink}">Open dashboard</a>
      </div>
    </div>
  </body>
</html>`;

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  }

  return res.json({
    tenant: {
      id: tenant.id,
      name: tenant.name,
      type: tenant.type,
      plan: tenant.plan,
      price: tenant.price,
      usage_limit: tenant.usage_limit,
      api_key: tenant.api_key,
    },
    plan_info: {
      plan: assignedPlan,
      monthly_price: planConfig.monthly_price,
      price_label: planConfig.monthly_price ? `$${planConfig.monthly_price}/mo` : 'Custom',
      features: planConfig.allowed_intents,
    },
    sdk_snippet: sdkSnippet,
    dashboard_link: dashboardLink,
  });
});

module.exports = router;
