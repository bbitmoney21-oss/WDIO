const express = require('express');
const { getAnalyticsForTenant } = require('../services/usageService');

const router = express.Router();

router.get('/:tenant_id', (req, res) => {
  if (req.tenant.id !== req.params.tenant_id) {
    return res.status(403).json({
      error: 'Forbidden tenant access',
    });
  }

  return res.json({
    tenant_id: req.tenant.id,
    analytics: getAnalyticsForTenant(req.tenant.id),
  });
});

module.exports = router;
