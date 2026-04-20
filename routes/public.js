const express = require('express');
const { getPricing } = require('../services/pricingService');

const router = express.Router();

router.get('/pricing', async (_req, res, next) => {
  try {
    const pricing = await getPricing();
    return res.json({ pricing });
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
