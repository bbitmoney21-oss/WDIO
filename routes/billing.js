const express = require('express');
const { buildUsageSummary } = require('../services/usageService');

const router = express.Router();

router.post('/upgrade', (req, res) => {
  return res.json({
    message: 'Upgrade request received',
    tenant_id: req.tenant.id,
    current_plan: req.tenant.plan,
    usage: buildUsageSummary(req.tenant),
  });
});

module.exports = router;
