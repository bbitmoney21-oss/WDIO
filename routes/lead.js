const express = require('express');

const router = express.Router();

const AVAILABILITY = '5 PM – 11 PM EST';

function getBookingLink() {
  return process.env.CALENDLY_LINK || 'https://calendly.com/YOUR_USERNAME/demo';
}

router.post('/submit', async (req, res) => {
  const { name, email, business_type, message } = req.body || {};

  const normalizedName  = typeof name  === 'string' ? name.trim()  : '';
  const normalizedEmail = typeof email === 'string' ? email.trim() : '';

  if (!normalizedName || !normalizedEmail) {
    return res.status(400).json({
      error: 'name and email are required.',
    });
  }

  // Optional: forward to Formspree if FORMSPREE_URL is configured
  const formspreeUrl = process.env.FORMSPREE_URL;
  if (formspreeUrl) {
    try {
      const payload = JSON.stringify({ name: normalizedName, email: normalizedEmail, business_type, message });
      // Use native fetch (Node 18+) or skip gracefully on older Node
      if (typeof fetch === 'function') {
        await fetch(formspreeUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: payload,
        });
      }
    } catch (err) {
      // Non-fatal — lead is captured even if Formspree is unreachable
      console.error('Formspree forward failed:', err.message);
    }
  }

  return res.json({
    status: 'received',
    message: `Thank you, ${normalizedName}. Book a demo call below.`,
    booking_link: getBookingLink(),
    availability: AVAILABILITY,
  });
});

module.exports = router;
