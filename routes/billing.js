const express = require('express');
const { buildUsageSummary } = require('../services/usageService');
const { getPlanConfig } = require('../services/tenantService');

const router = express.Router();

const UPGRADE_PATHS = {
  restaurant: {
    next_plan: 'custom',
    next_price: 499,
    message: 'Upgrade to the Custom plan (from $499/mo) to unlock multi-location support, advanced workflows, and clinic booking.',
  },
  clinic: {
    next_plan: 'custom',
    next_price: 499,
    message: 'Upgrade to the Custom plan (from $499/mo) to unlock multi-location support, advanced workflows, and restaurant ordering.',
  },
  custom: {
    next_plan: null,
    next_price: null,
    message: 'You are on our highest tier. Contact us for enterprise pricing.',
  },
  free: {
    next_plan: 'restaurant',
    next_price: 199,
    message: 'Upgrade to the Restaurant plan ($199/mo) or Clinic plan ($299/mo) to unlock full features.',
  },
  pro: {
    next_plan: 'custom',
    next_price: 499,
    message: 'Upgrade to the Custom plan (from $499/mo) for unlimited usage and advanced integrations.',
  },
  enterprise: {
    next_plan: null,
    next_price: null,
    message: 'You are on our highest tier. Contact us for additional customizations.',
  },
};

router.post('/upgrade', (req, res) => {
  const currentPlan = req.tenant.plan;
  const planConfig = getPlanConfig(currentPlan);
  const upgradePath = UPGRADE_PATHS[currentPlan] || UPGRADE_PATHS.free;

  return res.json({
    message: 'Upgrade request received',
    tenant_id: req.tenant.id,
    current_plan: currentPlan,
    monthly_price: planConfig.monthly_price ?? null,
    upgrade_info: upgradePath,
    usage: buildUsageSummary(req.tenant),
  });
});

module.exports = router;
