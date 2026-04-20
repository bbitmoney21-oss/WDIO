const express = require('express');
const { getPricing, updatePricing, validatePricingPayload } = require('../services/pricingService');

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

module.exports = router;
