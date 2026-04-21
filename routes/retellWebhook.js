// Retell AI webhook handler.
//
// Handles all Retell server events:
//   call_started  — initialise per-call session
//   call_ended    — persist call log to Supabase, clear session
//   transcript    — update in-flight transcript
//   function_call — execute tool (capture_lead, check_listing, book_showing,
//                   schedule_callback) and return result JSON
//
// Session memory is held in a process-local Map keyed by call_id.
// Entries are cleaned up immediately on call_ended and by a 2-hour safety sweep.

const express = require('express');
const { verify } = require('retell-sdk');
const { getSupabaseClient, hasSupabaseConfig } = require('../services/supabaseClient');

const router = express.Router();

// ─── Webhook signature verification ──────────────────────────────────────────
// Retell signs every request with your API key. We capture the raw body before
// JSON parsing so the HMAC validates correctly.

router.use(
  express.raw({ type: 'application/json' }),
  (req, _res, next) => {
    // Attach parsed body for downstream handlers
    try {
      req.parsedBody = JSON.parse(req.body);
    } catch {
      req.parsedBody = {};
    }
    next();
  },
);

function verifyRetellSignature(req) {
  const apiKey    = process.env.RETELL_API_KEY;
  const signature = req.headers['x-retell-signature'];

  // Skip in dev when no key configured
  if (!apiKey) return true;
  if (!signature) return false;

  try {
    return verify(req.body, apiKey, signature);
  } catch {
    return false;
  }
}

// ─── Per-call session memory ──────────────────────────────────────────────────

const callSessions = new Map();

function initSession(callId) {
  const session = {
    callId,
    transcript:          [],    // [{role, content}]
    lead:                null,  // {name, phone, intent|coverage_type|interest_level}
    propertyInterest:    null,  // {property_type, budget, location}
    bookings:            [],    // [{date, time}]
    callbacks:           [],    // [{preferred_time, notes}] — insurance
    suggestedItems:      new Set(),
    startedAt:           Date.now(),
  };
  callSessions.set(callId, session);
  return session;
}

function getSession(callId) {
  return callSessions.has(callId) ? callSessions.get(callId) : initSession(callId);
}

function clearSession(callId) {
  callSessions.delete(callId);
}

// Sweep sessions older than 2 hours (safety against missed call_ended events)
setInterval(() => {
  const cutoff = Date.now() - 2 * 60 * 60 * 1000;
  for (const [id, s] of callSessions.entries()) {
    if (s.startedAt < cutoff) callSessions.delete(id);
  }
}, 30 * 60 * 1000);

// ─── Supabase persistence helpers ─────────────────────────────────────────────

async function trySupabaseInsert(table, row) {
  if (!hasSupabaseConfig()) return;
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from(table).insert(row);
    if (error) console.warn(`[retell] ${table} insert:`, error.message);
  } catch (err) {
    console.warn(`[retell] ${table} insert error:`, err.message);
  }
}

async function trySupabaseUpsert(table, row, conflict) {
  if (!hasSupabaseConfig()) return;
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.from(table).upsert(row, { onConflict: conflict });
    if (error) console.warn(`[retell] ${table} upsert:`, error.message);
  } catch (err) {
    console.warn(`[retell] ${table} upsert error:`, err.message);
  }
}

async function persistCallLog(call, session) {
  const duration = call.end_timestamp && call.start_timestamp
    ? Math.round((call.end_timestamp - call.start_timestamp) / 1000)
    : null;

  await trySupabaseUpsert('call_logs', {
    call_id:          call.call_id,
    call_status:      call.call_status || 'ended',
    transcript:       typeof call.transcript === 'string' ? call.transcript : null,
    duration_seconds: duration,
    lead_name:        session?.lead?.name  || null,
    lead_phone:       session?.lead?.phone || null,
    metadata:         JSON.stringify({
      propertyInterest: session?.propertyInterest || null,
      bookings:         session?.bookings         || [],
      callbacks:        session?.callbacks        || [],
    }),
    created_at: new Date().toISOString(),
  }, 'call_id');
}

// ─── Function call handlers ───────────────────────────────────────────────────

async function handleCaptureLead(args, session) {
  const { name, phone, intent, coverage_type, interest_level } = args;

  // Dedupe: same phone number already captured this call
  if (session.lead && phone && session.lead.phone === phone) {
    return `Already have your details, ${session.lead.name}. How can I help you further?`;
  }

  session.lead = {
    name:           name           || 'Unknown',
    phone:          phone          || '',
    intent:         intent         || coverage_type || 'general',
    interest_level: interest_level || null,
  };

  await trySupabaseUpsert('leads', {
    name:       session.lead.name,
    phone:      session.lead.phone,
    intent:     session.lead.intent,
    call_id:    session.callId,
    source:     'retell_voice',
    created_at: new Date().toISOString(),
  }, 'call_id');

  console.log('[retell] lead captured callId=%s name=%s', session.callId, session.lead.name);
  return `Thanks ${session.lead.name}, I've noted your details. How can I help you further?`;
}

async function handleCheckListing(args, session) {
  const { property_type, budget, location } = args;
  session.propertyInterest = { property_type, budget, location };

  await trySupabaseInsert('property_inquiries', {
    property_type: property_type || null,
    budget:        budget        || null,
    location:      location      || null,
    call_id:       session.callId,
    lead_name:     session.lead?.name || null,
    created_at:    new Date().toISOString(),
  });

  const desc = [
    property_type,
    location ? `in ${location}` : null,
    budget   ? `around ${budget}` : null,
  ].filter(Boolean).join(' ') || 'a property';

  console.log('[retell] listing checked callId=%s desc=%s', session.callId, desc);
  return `Got it — looking for ${desc}. I have some great options that could work. Would you like to schedule a viewing?`;
}

async function handleBookShowing(args, session) {
  const { date, time } = args;
  if (!date || !time) {
    return "Could you confirm the date and time you'd prefer for the showing?";
  }

  session.bookings.push({ date, time, confirmedAt: new Date().toISOString() });

  await trySupabaseInsert('showings', {
    date:          date,
    time:          time,
    call_id:       session.callId,
    lead_name:     session.lead?.name  || 'Unknown',
    lead_phone:    session.lead?.phone || '',
    property_type: session.propertyInterest?.property_type || null,
    location:      session.propertyInterest?.location      || null,
    status:        'scheduled',
    created_at:    new Date().toISOString(),
  });

  console.log('[retell] showing booked callId=%s date=%s time=%s', session.callId, date, time);
  return `Perfect! I've booked your showing for ${date} at ${time}. Is there anything else you'd like to know?`;
}

async function handleScheduleCallback(args, session) {
  const { preferred_time, notes } = args;
  if (!preferred_time) {
    return "When would be a good time for him to call you back?";
  }

  session.callbacks.push({ preferred_time, notes, scheduledAt: new Date().toISOString() });

  await trySupabaseInsert('callbacks', {
    preferred_time: preferred_time,
    notes:          notes || null,
    call_id:        session.callId,
    lead_name:      session.lead?.name  || null,
    lead_phone:     session.lead?.phone || null,
    status:         'pending',
    created_at:     new Date().toISOString(),
  });

  console.log('[retell] callback scheduled callId=%s time=%s', session.callId, preferred_time);
  return `Sure, I'll arrange a call at ${preferred_time}. He'll reach out then. Thanks for your time!`;
}

// ─── Route: POST /retell-webhook ──────────────────────────────────────────────

router.post('/', async (req, res) => {
  // Signature check — reject invalid requests in production
  if (process.env.RETELL_API_KEY && !verifyRetellSignature(req)) {
    console.warn('[retell] invalid webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const body   = req.parsedBody || {};
  const { event, call, func_call } = body;
  const callId = call?.call_id;

  console.log('[retell] event=%s callId=%s', event, callId || '—');

  try {
    switch (event) {

      case 'call_started': {
        if (callId) initSession(callId);
        return res.json({ status: 'ok' });
      }

      case 'call_ended': {
        if (callId) {
          const session = getSession(callId);
          await persistCallLog(call, session);
          clearSession(callId);
        }
        return res.json({ status: 'ok' });
      }

      case 'transcript': {
        if (callId && call?.transcript_object) {
          getSession(callId).transcript = call.transcript_object;
        }
        return res.json({ status: 'ok' });
      }

      case 'function_call': {
        if (!func_call) {
          return res.status(400).json({ error: 'Missing func_call in payload' });
        }

        const { func_call_id, name, arguments: args } = func_call;
        const session = callId ? getSession(callId) : initSession('orphan-' + Date.now());

        console.log('[retell] function_call name=%s callId=%s', name, callId);

        let result;
        switch (name) {
          case 'capture_lead':      result = await handleCaptureLead(args || {}, session);      break;
          case 'check_listing':     result = await handleCheckListing(args || {}, session);     break;
          case 'book_showing':      result = await handleBookShowing(args || {}, session);      break;
          case 'schedule_callback': result = await handleScheduleCallback(args || {}, session); break;
          default:
            console.warn('[retell] unrecognised function:', name);
            result = 'Done, let me continue helping you.';
        }

        return res.json({ func_call_id, result });
      }

      default:
        // Unknown event — acknowledge so Retell doesn't retry
        return res.json({ status: 'ok' });
    }
  } catch (err) {
    console.error('[retell] webhook error event=%s:', event, err.message);
    return res.status(500).json({ error: 'Internal error processing webhook' });
  }
});

module.exports = router;
