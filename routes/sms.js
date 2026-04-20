const express = require('express');
const { handleAgentRequest } = require('../services/bookingAgent');
const { getTenantById, getTenantByApiKey } = require('../services/tenantService');
const { isWithinBusinessHours, getAfterHoursResponse } = require('../services/businessHoursService');

const router = express.Router();

// ─── TwiML helpers (SMS uses <Message>, never <Say> or <Gather>) ──────────────

function xmlEscape(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function smsMessage(text) {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xmlEscape(text)}</Message></Response>`;
}

function sendSMSTwiML(res, text) {
  res.setHeader('Content-Type', 'text/xml; charset=utf-8');
  return res.send(smsMessage(text));
}

// ─── Tenant resolution (reuses same env vars as voice) ───────────────────────

function resolveSMSTenant() {
  const apiKey   = process.env.SMS_API_KEY || process.env.VOICE_API_KEY;
  const tenantId = process.env.SMS_TENANT_ID || process.env.VOICE_TENANT_ID;

  if (apiKey) {
    const t = getTenantByApiKey(apiKey);
    if (t) return t;
  }
  if (tenantId) {
    const t = getTenantById(tenantId);
    if (t) return t;
  }

  const demoType = (process.env.SMS_DEMO_TYPE || process.env.VOICE_DEMO_TYPE || 'restaurant').toLowerCase();
  const demoId   = demoType === 'clinic' ? 'tenant_clinic_demo' : 'tenant_resto_demo';
  return getTenantById(demoId);
}

// ─── Strip response text for clean SMS (no markdown) ─────────────────────────

function toSmsText(text) {
  return String(text || '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/`/g, '')
    .replace(/#+\s?/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, 1600); // SMS segment safety limit
}

// ─── Route: inbound SMS ───────────────────────────────────────────────────────

router.post('/incoming', async (req, res) => {
  const from    = req.body?.From    || 'unknown';
  const body    = (req.body?.Body   || '').trim();
  const smsSid  = req.body?.SmsSid  || req.body?.MessageSid || 'sms-unknown';
  console.log('[sms] incoming smsSid=%s from=%s body=%s', smsSid, from, body);

  try {
    const tenant = resolveSMSTenant();

    if (!tenant) {
      return sendSMSTwiML(res, 'Service not configured. Please contact support.');
    }

    if (!body) {
      return sendSMSTwiML(res, 'Hi! How can I help you today? Send us your order or appointment request.');
    }

    const hoursInfo = isWithinBusinessHours(tenant);
    if (!hoursInfo.open) {
      const closedMsg = getAfterHoursResponse(tenant, null, hoursInfo);
      return sendSMSTwiML(res, toSmsText(closedMsg));
    }

    const result = await handleAgentRequest({
      tenant,
      userId:  from,
      message: body,
      mode:    'auto',
    });

    return sendSMSTwiML(res, toSmsText(result.response));

  } catch (err) {
    console.error('[sms] /incoming error smsSid=%s:', smsSid, err.message);

    if (err.statusCode === 403 || err.code === 'PLAN_RESTRICTION') {
      return sendSMSTwiML(res, 'This feature is not available on your current plan. Please contact us to upgrade.');
    }

    if (err.statusCode === 429) {
      return sendSMSTwiML(res, 'You have reached your usage limit for this month. Please upgrade your plan to continue.');
    }

    return sendSMSTwiML(res, 'Sorry, we encountered an issue. Please try again shortly.');
  }
});

// ─── Route: SMS fallback (Twilio calls this on delivery failure) ──────────────
// CHANNEL ISOLATION: this route NEVER references or calls voice endpoints.

router.post('/fallback', (req, res) => {
  const smsSid = req.body?.SmsSid || req.body?.MessageSid || 'unknown';
  console.error('[sms] fallback triggered smsSid=%s', smsSid);
  return sendSMSTwiML(res, 'Sorry, we had trouble processing your message. Please try again shortly.');
});

module.exports = router;
