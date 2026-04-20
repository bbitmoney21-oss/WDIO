const express = require('express');
const { getLatestOrderForUser } = require('../services/orderService');

const router = express.Router();

function buildPayload(intent, response, orderData = null) {
  return {
    intent,
    response,
    order_data: orderData,
  };
}

router.post('/message', async (req, res, next) => {
  try {
    const { user_id: userId, message } = req.body || {};
    const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
    const normalizedMessage = typeof message === 'string' ? message.trim() : '';

    if (!normalizedUserId) {
      return res
        .status(400)
        .json(buildPayload('unknown', '`user_id` is required and must be a non-empty string.'));
    }

    if (!normalizedMessage) {
      return res
        .status(400)
        .json(buildPayload('unknown', '`message` is required and must be a non-empty string.'));
    }

    const orderData = await getLatestOrderForUser(normalizedUserId);

    if (!orderData) {
      return res.json(
        buildPayload(
          'unknown',
          'The legacy support endpoint is limited. Please use /api/agent/handle for new restaurant and clinic requests.',
        ),
      );
    }

    return res.json(
      buildPayload(
        'unknown',
        `Your latest order is currently marked as ${orderData.status}. Please use /api/agent/handle for the new unified booking flow.`,
        orderData,
      ),
    );
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
