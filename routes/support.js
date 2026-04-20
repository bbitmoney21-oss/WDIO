const express = require('express');
const { handleSupportMessage } = require('../services/aiAgent');

const router = express.Router();

router.post('/message', async (req, res, next) => {
  try {
    const { user_id: userId, message } = req.body || {};

    if (!userId || typeof userId !== 'string') {
      return res.status(400).json({ error: '`user_id` is required and must be a string.' });
    }

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: '`message` is required and must be a string.' });
    }

    const payload = await handleSupportMessage({
      userId: userId.trim(),
      message: message.trim(),
    });

    return res.json(payload);
  } catch (error) {
    return next(error);
  }
});

module.exports = router;
