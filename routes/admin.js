const express = require('express');
const { getPricing, updatePricing, validatePricingPayload } = require('../services/pricingService');
const {
  getTenantKnowledge,
  setTenantKnowledge,
  clearKnowledgeCache,
} = require('../services/knowledgeService');
const { getTenantById } = require('../services/tenantService');

const router = express.Router();

function requireAdminToken(req, res, next) {
  const token = req.headers['x-admin-token'];

  if (!process.env.PRICING_ADMIN_TOKEN || token !== process.env.PRICING_ADMIN_TOKEN) {
    return res.status(401).json({
      error: 'Unauthorized admin',
    });
  }

  return next();
}

router.get('/pricing', requireAdminToken, async (_req, res, next) => {
  try {
    return res.json({
      pricing: await getPricing(),
    });
  } catch (error) {
    return next(error);
  }
});

router.post('/pricing', requireAdminToken, async (req, res, next) => {
  try {
    const { pricing } = req.body || {};
    validatePricingPayload(pricing);
    const savedPricing = await updatePricing(pricing);

    return res.json({
      message: 'Pricing updated',
      pricing: savedPricing,
    });
  } catch (error) {
    return next(error);
  }
});

// ─── Knowledge management ─────────────────────────────────────────────────────

router.get('/knowledge/:tenantId', requireAdminToken, async (req, res, next) => {
  try {
    const tenant = getTenantById(req.params.tenantId);
    const tenantType = tenant ? tenant.type : 'restaurant';
    const knowledge = await getTenantKnowledge(req.params.tenantId, tenantType);
    return res.json({ tenant_id: req.params.tenantId, knowledge });
  } catch (error) {
    return next(error);
  }
});

router.post('/knowledge/:tenantId', requireAdminToken, (req, res) => {
  const { knowledge } = req.body || {};

  if (!knowledge || typeof knowledge !== 'object') {
    return res.status(400).json({ error: '`knowledge` must be a non-empty object.' });
  }

  setTenantKnowledge(req.params.tenantId, knowledge);
  clearKnowledgeCache(req.params.tenantId); // clear and re-set so cache is fresh
  setTenantKnowledge(req.params.tenantId, knowledge);

  return res.json({
    message: 'Tenant knowledge updated',
    tenant_id: req.params.tenantId,
    knowledge,
  });
});

module.exports = router;
