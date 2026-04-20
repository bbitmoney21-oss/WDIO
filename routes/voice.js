const crypto = require('crypto');
const express = require('express');
const { getTenantById, getTenantByApiKey } = require('../services/tenantService');
const { isWithinBusinessHours, getAfterHoursResponse } = require('../services/businessHoursService');
const { getTenantKnowledge } = require('../services/knowledgeService');
const { createRestaurantOrder } = require('../services/orderService');
const { processVoiceTurn, clearCallState } = require('../services/voiceConversation');

const router = express.Router();

// ─── TwiML helpers ────────────────────────────────────────────────────────────
// We build TwiML as plain XML strings — no twilio npm package required.

const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>';

// Twilio requires fully-qualified HTTPS URLs in TwiML action attributes.
// Relative paths cause "application error occurred" after the initial greeting.
function gatherActionUrl() {
  const base = (process.env.PUBLIC_URL || 'https://universal-booking-ai-agent.onrender.com').replace(/\/$/, '');
  return `${base}/api/voice/gather`;
}

// Voice selection: default to Polly.Aditi (Indian English, neural, natural for Bhagibhavan).
// Override via VOICE_TTS_VOICE env var if needed (e.g. "Polly.Raveena", "alice").
function getTtsVoice() {
  return process.env.VOICE_TTS_VOICE || 'Polly.Aditi';
}

function xmlEscape(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function say(text) {
  return `<Say voice="${getTtsVoice()}">${xmlEscape(text)}</Say>`;
}

// Wraps optional inner content in a <Gather> block that captures speech.
// language="en-IN" improves recognition of Indian-accented English callers.
function gather({ action = null, prompt = null, timeout = 3 } = {}) {
  const resolvedAction = action || gatherActionUrl();
  const lang  = process.env.VOICE_SPEECH_LANGUAGE || 'en-IN';
  const inner = prompt ? say(prompt) : '';
  return `<Gather input="speech" action="${resolvedAction}" method="POST" speechTimeout="${timeout}" language="${lang}">${inner}</Gather>`;
}

function twiml(body) {
  return `${XML_HEADER}<Response>${body}</Response>`;
}

function sendTwiML(res, body) {
  res.setHeader('Content-Type', 'text/xml; charset=utf-8');
  return res.send(twiml(body));
}

// ─── Twilio webhook signature validation (Phase 9) ───────────────────────────
// Uses HMAC-SHA1 with the auth token — identical to the twilio npm package
// implementation but without the dependency. Skipped when TWILIO_AUTH_TOKEN
// is not set (e.g. during local development).

function validateTwilioSignature(req) {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) return true; // dev mode: skip validation

  const incomingSig = req.headers['x-twilio-signature'];
  if (!incomingSig) return false;

  const publicUrl = (process.env.PUBLIC_URL || 'https://api.canadataxpro.me').replace(/\/$/, '');
  const fullUrl   = `${publicUrl}${req.originalUrl}`;

  // Sort POST params alphabetically, concatenate key+value pairs
  const params    = req.body || {};
  const paramStr  = Object.keys(params).sort().reduce((acc, k) => acc + k + params[k], '');
  const expected  = crypto.createHmac('sha1', authToken).update(fullUrl + paramStr).digest('base64');

  return expected === incomingSig;
}

function twilioAuth(req, res, next) {
  if (!validateTwilioSignature(req)) {
    console.warn('Twilio signature validation failed for', req.originalUrl);
    res.setHeader('Content-Type', 'text/xml; charset=utf-8');
    return res.status(403).send(twiml(say('Unauthorized request.')));
  }
  return next();
}

// ─── Tenant resolution for voice (Phase 9) ───────────────────────────────────
// Voice calls bypass the normal x-api-key header flow.
// Resolution order:
//   1. VOICE_API_KEY  env var
//   2. VOICE_TENANT_ID env var
//   3. Demo tenant for VOICE_DEMO_TYPE (restaurant | clinic)

function resolveVoiceTenant() {
  const apiKey   = process.env.VOICE_API_KEY;
  const tenantId = process.env.VOICE_TENANT_ID;

  if (apiKey) {
    const t = getTenantByApiKey(apiKey);
    if (t) return t;
  }
  if (tenantId) {
    const t = getTenantById(tenantId);
    if (t) return t;
  }

  // Default to Bhagibhavan; set VOICE_DEMO_TYPE=clinic to override for clinic demos
  const demoType = (process.env.VOICE_DEMO_TYPE || '').toLowerCase();
  if (demoType === 'clinic') return getTenantById('tenant_clinic_demo');
  if (demoType === 'demo')   return getTenantById('tenant_resto_demo');
  return getTenantById('tenant_bhagibhavan');
}

// ─── Strip AI response for clean TTS output ──────────────────────────────────
// Removes markdown formatting and replaces IDs with spoken equivalents.

function toSpeech(text) {
  return String(text || '')
    .replace(/\*\*/g, '')
    .replace(/\*/g, '')
    .replace(/`/g, '')
    .replace(/#+\s?/g, '')
    .replace(/\n+/g, '. ')
    .replace(/RESTO-[\w-]+/gi,  'order confirmed')
    .replace(/CLINIC-[\w-]+/gi, 'appointment confirmed')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// ─── Route: incoming call ─────────────────────────────────────────────────────

router.post('/incoming', twilioAuth, (req, res) => {
  const callSid = req.body?.CallSid || 'unknown';
  console.log('[voice] incoming call callSid=%s', callSid);

  try {
    const tenant = resolveVoiceTenant();

    if (!tenant) {
      return sendTwiML(res,
        say('This service is not yet configured. Please contact support.') +
        '<Hangup/>',
      );
    }

    const hoursInfo = isWithinBusinessHours(tenant);
    if (!hoursInfo.open) {
      const closedMsg = getAfterHoursResponse(tenant, null, hoursInfo);
      return sendTwiML(res, say(closedMsg) + '<Hangup/>');
    }

    const venueName = tenant.name || 'Bhagibhavan';
    return sendTwiML(res,
      say(`Thank you for calling ${venueName}! What can I get for you today?`) +
      gather(),
    );
  } catch (err) {
    console.error('[voice] /incoming error callSid=%s:', callSid, err.message);
    return sendTwiML(res,
      say('Sorry, we are experiencing technical issues. Please try again shortly.') +
      '<Hangup/>',
    );
  }
});

// ─── Route: speech received ───────────────────────────────────────────────────

router.post('/gather', twilioAuth, async (req, res) => {
  const speechResult = (req.body?.SpeechResult || '').trim();
  const callSid      = req.body?.CallSid || 'voice-caller';
  console.log('[voice] gather callSid=%s speech=%s', callSid, speechResult || '(empty)');

  const tenant = resolveVoiceTenant();
  if (!tenant) {
    return sendTwiML(res, say('Service not configured. Goodbye.') + '<Hangup/>');
  }

  // No speech detected → prompt to repeat without advancing state
  if (!speechResult) {
    return sendTwiML(res,
      say("Sorry, I didn't catch that — could you repeat?") +
      gather(),
    );
  }

  try {
    // Load Bhagibhavan knowledge (menu, combos, specials, spice levels)
    const knowledge = await getTenantKnowledge(tenant.id, tenant.type).catch(() => null);

    // Run the stateful conversation engine
    const { response, shouldHangUp, finalOrder } = await processVoiceTurn(callSid, speechResult, knowledge);

    // Persist order to DB when customer confirms
    if (finalOrder) {
      try {
        const orderResult = await createRestaurantOrder({
          tenant,
          userId:     callSid,
          items:      finalOrder.items,
          rawMessage: finalOrder.items.map((i) => `${i.quantity}x ${i.name}`).join(', '),
        });
        console.log('[voice] order persisted orderId=%s', orderResult.order_id);
      } catch (err) {
        console.error('[voice] order persistence failed:', err.message);
        // Non-fatal — call still ends gracefully
      }
      clearCallState(callSid);
    }

    if (shouldHangUp) {
      return sendTwiML(res,
        say(toSpeech(response)) +
        '<Pause length="1"/>' +
        '<Hangup/>',
      );
    }

    return sendTwiML(res, say(toSpeech(response)) + gather());

  } catch (err) {
    console.error('[voice] gather error callSid=%s:', callSid, err.message);
    return sendTwiML(res,
      say("Sorry about that — could you say that again?") +
      gather(),
    );
  }
});

// ─── Route: voice fallback (Twilio calls this when /incoming or /gather fail) ─
// Must NEVER reference SMS routes — voice failures stay in voice channel only.

router.post('/fallback', twilioAuth, (req, res) => {
  const callSid = req.body?.CallSid || 'unknown';
  console.error('[voice] fallback triggered callSid=%s', callSid);
  return sendTwiML(res,
    say('Sorry, we are experiencing technical issues. Please call back shortly.') +
    '<Hangup/>',
  );
});

// ─── Route: call status callback (Twilio posts async, no TwiML needed) ────────

router.post('/status', (req, res) => {
  const { CallSid, CallStatus, CallDuration } = req.body || {};
  console.log('[voice] status callSid=%s status=%s duration=%s', CallSid, CallStatus, CallDuration);
  // Clean up call state on any terminal status to prevent memory leaks
  if (CallSid && ['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(CallStatus)) {
    clearCallState(CallSid);
  }
  return res.sendStatus(204);
});

module.exports = router;
