const express = require('express');
const { handleAgentRequest } = require('../services/bookingAgent');

const router = express.Router();

function buildPayload(intent, response, data = {}) {
  return {
    intent,
    execution_status: intent === 'unknown' ? 'clarification_required' : 'failed',
    id: null,
    response,
    data,
  };
}

router.post('/handle', async (req, res, next) => {
  try {
    const { user_id: userId, message, mode = 'auto' } = req.body || {};
    const payload = await handleAgentRequest({
      tenant: req.tenant,
      userId,
      message,
      mode,
    });

    return res.json(payload);
  } catch (error) {
    if (error.statusCode && error.statusCode < 500) {
      return res.status(error.statusCode).json(buildPayload('unknown', error.message, { tenant_id: req.tenant?.id || null }));
    }

    if (error.statusCode === 429) {
      return res.status(429).json({
        error: 'Usage limit exceeded. Upgrade plan.',
      });
    }

    return next(error);
  }
});

module.exports = router;
