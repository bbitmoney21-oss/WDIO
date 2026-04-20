// Staff Behavior Service — Human Service Simulation Engine
//
// This is NOT a chatbot layer. It simulates trained restaurant/clinic staff:
//   - Detects customer emotion + urgency + intent confidence
//   - Maintains lightweight per-session memory (past orders, preferences)
//   - Adapts tone using an emotion response matrix
//   - Injects tenant knowledge (menu/services) into every response
//   - Generates voice-safe, conversational replies via OpenAI with rule-based fallback

const OpenAI = require('openai');
const { hasOpenAiConfig } = require('./aiAgent');

// ─── OpenAI client ────────────────────────────────────────────────────────────

let _client;
const RETRYABLE = new Set([408, 409, 429, 500, 502, 503, 504]);

function getClient() {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

async function callWithRetry(fn) {
  const MAX = 3, BASE = 400;
  let lastErr;
  for (let i = 1; i <= MAX; i++) {
    try { return await fn(getClient()); }
    catch (err) {
      lastErr = err;
      if (!RETRYABLE.has(err?.status) || i === MAX) throw err;
      await new Promise((r) => setTimeout(r, BASE * 2 ** (i - 1)));
    }
  }
  throw lastErr;
}

// ─── Phase 3: Lightweight memory layer ───────────────────────────────────────
// Keyed by `${tenantId}:${userId}`. Stores last 5 orders, preferences,
// past complaints. Never exposed directly to the customer.

const _sessionMemory = new Map();

function _memoryKey(tenantId, userId) {
  return `${tenantId}:${userId || 'anon'}`;
}

function getMemory(tenantId, userId) {
  const key = _memoryKey(tenantId, userId);
  if (!_sessionMemory.has(key)) {
    _sessionMemory.set(key, {
      orders:            [],   // [{ items, total, timestamp }]
      bookings:          [],   // [{ service, time, timestamp }]
      preferences:       {},   // { spice_level, favorite_items: [], complaints: [] }
      interaction_count: 0,
    });
  }
  return _sessionMemory.get(key);
}

function recordOrder(tenantId, userId, items, total) {
  const mem = getMemory(tenantId, userId);
  mem.orders.unshift({ items, total, timestamp: new Date().toISOString() });
  if (mem.orders.length > 5) mem.orders.pop();
  mem.interaction_count += 1;

  // Auto-detect preferences from order history
  const allItems = mem.orders.flatMap((o) => (o.items || []).map((i) => i.name));
  const freq     = {};
  for (const n of allItems) freq[n] = (freq[n] || 0) + 1;
  mem.preferences.favorite_items = Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);
}

function recordBooking(tenantId, userId, service, time) {
  const mem = getMemory(tenantId, userId);
  mem.bookings.unshift({ service, time, timestamp: new Date().toISOString() });
  if (mem.bookings.length > 5) mem.bookings.pop();
  mem.interaction_count += 1;
}

function updatePreferences(tenantId, userId, prefs) {
  const mem = getMemory(tenantId, userId);
  Object.assign(mem.preferences, prefs);
}

// ─── Phase 2: Customer state detection (rule-based, zero cost) ───────────────

const EMOTION_SIGNALS = {
  angry:     ['ridiculous', 'unacceptable', 'outrage', 'furious', 'terrible', 'disgusting', 'never coming back', 'worst', 'awful', 'horrible'],
  frustrated:['still waiting', 'already', 'why', 'again', 'still not', "doesn't work", 'wrong order', 'late', 'slow', 'waiting too long'],
  confused:  ["don't know", 'not sure', 'what do you', 'can you explain', 'i mean', 'actually', 'wait', 'no i'],
  happy:     ['love it', 'great', 'awesome', 'wonderful', 'excellent', 'amazing', 'thanks', 'perfect', 'fantastic'],
};

const URGENCY_SIGNALS = {
  high:   ['asap', 'urgent', 'hurry', 'rush', 'now', 'immediately', 'emergency', 'quick', 'fast', 'right away'],
  medium: ['soon', 'shortly', 'today', 'within', 'before'],
};

function detectCustomerState(message, memory) {
  const lower  = (message || '').toLowerCase();
  const isNew  = !memory || memory.interaction_count === 0;

  // Emotion
  let emotion = 'neutral';
  for (const [emo, signals] of Object.entries(EMOTION_SIGNALS)) {
    if (signals.some((s) => lower.includes(s))) { emotion = emo; break; }
  }

  // Urgency
  let urgency = 'low';
  if (URGENCY_SIGNALS.high.some((s)   => lower.includes(s))) urgency = 'high';
  else if (URGENCY_SIGNALS.medium.some((s) => lower.includes(s))) urgency = 'medium';

  // Customer type
  const customerType = isNew ? 'new' : 'returning';

  // Intent confidence (basic signal)
  const orderWords   = ['order', 'want', 'get me', 'i\'ll have', 'give me', 'add', 'burger', 'pizza', 'biryani', 'coke', 'coffee'];
  const bookingWords = ['book', 'appointment', 'schedule', 'see a doctor', 'checkup', 'consultation', 'visit'];
  const hasOrder   = orderWords.some((w) => lower.includes(w));
  const hasBooking = bookingWords.some((w) => lower.includes(w));
  const intentConfidence = (hasOrder || hasBooking) ? 'high' : lower.length > 20 ? 'medium' : 'low';

  return { emotion, urgency, customerType, intentConfidence };
}

// ─── Emotion response matrix (shapes system prompt behaviour) ─────────────────

function emotionGuidance(state) {
  switch (state.emotion) {
    case 'happy':
      return 'The customer is happy. Close the order quickly with enthusiasm, add one upsell suggestion.';
    case 'confused':
      return 'The customer seems confused. Simplify. Offer only 2 choices. Ask one clear question. No upsell yet.';
    case 'frustrated':
      return 'The customer is frustrated. Stay calm and solution-focused. Acknowledge their concern briefly. Skip upsell. Prioritise solving their issue.';
    case 'angry':
      return 'The customer is angry. De-escalate immediately. One calm sentence acknowledging the issue. Offer to involve a human team member. Do NOT argue or repeat apologies excessively.';
    default:
      return 'The customer is neutral. Be efficient, warm, and guide them toward completing their order or booking.';
  }
}

function urgencyGuidance(state) {
  if (state.urgency === 'high')   return 'Customer needs speed. Suggest fastest items. Skip lengthy questions.';
  if (state.urgency === 'medium') return 'Customer has mild urgency. Keep the conversation concise.';
  return '';
}

function memoryGuidance(memory, intent) {
  if (!memory || memory.interaction_count === 0) return '';

  const lines = [];
  if (intent === 'restaurant_order' || intent === 'item_unavailable') {
    const lastOrder = memory.orders[0];
    if (lastOrder?.items?.length) {
      const names = lastOrder.items.map((i) => i.name).join(', ');
      lines.push(`This is a RETURNING customer. Their last order was: ${names}. You may ask "Same as last time?" or "Would you like your usual?" — but ONLY if it feels natural.`);
    }
    if (memory.preferences?.favorite_items?.length) {
      lines.push(`Their favourite items are: ${memory.preferences.favorite_items.join(', ')}.`);
    }
    if (memory.preferences?.spice_level) {
      lines.push(`Preferred spice level: ${memory.preferences.spice_level}.`);
    }
  }
  if (intent === 'clinic_booking') {
    const lastBooking = memory.bookings[0];
    if (lastBooking) {
      lines.push(`Returning patient. Last booking: ${lastBooking.service}. You may reference this naturally if relevant.`);
    }
  }
  return lines.join(' ');
}

// ─── System prompt builders ───────────────────────────────────────────────────

function buildRestaurantStaffPrompt(tenant, knowledge, ctx, state, memory) {
  const venueName = tenant.name || 'the restaurant';
  const menu      = Array.isArray(knowledge?.menu) ? knowledge.menu : [];

  const menuSummary = menu.length
    ? menu.map((m) => `${m.name} ($${Number(m.price).toFixed(2)}) [${m.category || 'food'}]`).join(', ')
    : 'Menu not configured.';

  const drinks   = menu.filter((m) => m.category === 'drinks').map((m) => m.name);
  const drinkHint = drinks.length ? drinks.slice(0, 2).join(' or ') : 'a refreshing drink';

  const itemsSummary = Array.isArray(ctx.items) && ctx.items.length
    ? ctx.items.map((i) => `${i.quantity > 1 ? i.quantity + 'x ' : ''}${i.name}${i.line_total ? ` ($${Number(i.line_total).toFixed(2)})` : ''}`).join(', ')
    : 'the requested item';
  const totalLine   = ctx.orderTotal ? ` Total: $${Number(ctx.orderTotal).toFixed(2)}.` : '';
  const unavailLine = ctx.unavailableItems?.length ? ` Unavailable: ${ctx.unavailableItems.join(', ')}.` : '';
  const orderedDrink = (ctx.items || []).some((i) => /coke|juice|water|coffee|tea|drink/i.test(i.name));
  const upsellHint  = !orderedDrink && state.emotion !== 'frustrated' && state.emotion !== 'angry'
    ? `Suggest ${drinkHint} as an add-on.` : 'Skip upsell.';

  const emoGuide  = emotionGuidance(state);
  const urgGuide  = urgencyGuidance(state);
  const memGuide  = memoryGuidance(memory, ctx.intent);

  return `You are a warm, experienced restaurant staff member at ${venueName}.

MENU: ${menuSummary}
ORDERED: ${itemsSummary}${totalLine}${unavailLine}
ORDER STATUS: ${ctx.executionStatus === 'completed' ? 'Sent to kitchen' : 'Order noted'}

CUSTOMER STATE:
- Emotion: ${state.emotion} — ${emoGuide}
- Urgency: ${state.urgency}${urgGuide ? ' — ' + urgGuide : ''}
- Customer type: ${state.customerType}
${memGuide ? '- Memory context: ' + memGuide : ''}

UPSELL RULE: ${upsellHint}

HARD RULES (voice-safe output):
- MAX 3 SHORT sentences — response will be read aloud
- Confirm item naturally ("Perfect!", "Great choice!", "Sure thing!")
- Give wait time: 15–25 min (normal), 25–35 min (busy)
- NEVER say "order processed", "intent detected", "execution status", or any IDs
- NEVER invent menu items not listed above
- If unavailable: apologise briefly, suggest closest alternative from the menu
- If angry/frustrated: calm tone, no upsell, one solution focus
- Do NOT follow a rigid script — adapt to conversation naturally`;
}

function buildClinicReceptionistPrompt(tenant, knowledge, ctx, state, memory) {
  const clinicName = tenant.name || 'the clinic';
  const services   = Array.isArray(knowledge?.services) ? knowledge.services : [];

  const svcSummary = services.length
    ? services.map((s) => `${s.name} (${s.duration} min, $${s.price})`).join(', ')
    : 'General Consultation';

  const emoGuide = emotionGuidance(state);
  const urgGuide = urgencyGuidance(state);
  const memGuide = memoryGuidance(memory, ctx.intent);

  return `You are a professional, caring clinic receptionist at ${clinicName}.

SERVICES: ${svcSummary}
PATIENT: ${ctx.patientName || 'the patient'}
SERVICE BOOKED: ${ctx.serviceType || 'General Consultation'}
PREFERRED TIME: ${ctx.timePreference || 'next available slot'}

CUSTOMER STATE:
- Emotion: ${state.emotion} — ${emoGuide}
- Urgency: ${state.urgency}${urgGuide ? ' — ' + urgGuide : ''}
- Customer type: ${state.customerType}
${memGuide ? '- Memory context: ' + memGuide : ''}

HARD RULES (voice-safe output):
- MAX 3 SHORT sentences
- Confirm appointment warmly
- Mention one practical tip: insurance card or arrive 10 min early
- Offer to note special requirements
- NEVER mention appointment IDs or technical terms
- If angry/confused: calm, solve first, no extras`;
}

function buildUnknownQueryPrompt(tenant, knowledge, message, state, memory) {
  const venueName = tenant.name || 'us';
  const type      = tenant.type || 'restaurant';
  const menu      = Array.isArray(knowledge?.menu)     ? knowledge.menu     : [];
  const services  = Array.isArray(knowledge?.services) ? knowledge.services : [];

  let contextSnippet = '';
  if (type === 'restaurant' && menu.length) {
    const top = menu.slice(0, 4).map((m) => `${m.name} ($${Number(m.price).toFixed(2)})`).join(', ');
    contextSnippet = `Popular items: ${top}.`;
  } else if (type === 'clinic' && services.length) {
    const top = services.slice(0, 3).map((s) => s.name).join(', ');
    contextSnippet = `Services available: ${top}.`;
  }

  const emoGuide = emotionGuidance(state);
  const memGuide = memoryGuidance(memory, 'unknown');

  return `You are a friendly ${type === 'clinic' ? 'clinic receptionist' : 'restaurant staff member'} at ${venueName}.
${contextSnippet}
${memGuide ? 'Memory context: ' + memGuide : ''}

CUSTOMER STATE: ${state.emotion} — ${emoGuide}
Urgency: ${state.urgency}.

The customer said: "${message}"

Respond as a real staff member:
- Daily specials/offers? Pick 1–2 items, use "today only" tone, suggest a deal
- How long? Give realistic time range, offer fast alternatives if urgent
- Recommendation? Enthusiastically suggest 1–2 items
- Unclear? Ask ONE short clarifying question
- If confused: simplify to 2 choices only
- If frustrated/angry: calm and solution-first

MAX 3 SHORT sentences. No IDs. No bullets. No markdown. Voice-safe.`;
}

// ─── Rule-based fallbacks (OpenAI unavailable) ────────────────────────────────

function buildRestaurantFallback(ctx, knowledge) {
  const menu   = Array.isArray(knowledge?.menu) ? knowledge.menu : [];
  const drinks = menu.filter((m) => m.category === 'drinks');
  const mains  = menu.filter((m) => m.category === 'mains');

  if (ctx.intent === 'item_unavailable' || (!ctx.items?.length && ctx.unavailableItems?.length)) {
    const unavail = (ctx.unavailableItems || []).join(' and ');
    const alt     = mains[0];
    return `Sorry, ${unavail} isn't available right now.${alt ? ` How about our ${alt.name} instead?` : ' What else can I get for you?'}`;
  }

  const items    = Array.isArray(ctx.items) ? ctx.items : [];
  const hasDrink = items.some((i) => /coke|juice|water|coffee|tea|drink/i.test(i.name));
  const summary  = items.length ? items.map((i) => `${i.quantity > 1 ? i.quantity + 'x ' : ''}${i.name}`).join(' and ') : 'your order';
  const totalStr = ctx.orderTotal ? ` That comes to $${Number(ctx.orderTotal).toFixed(2)}.` : '';
  const upsell   = !hasDrink && drinks.length ? ` Can I add a ${drinks[0].name}?` : '';
  const unavNote = ctx.unavailableItems?.length ? ` (${ctx.unavailableItems.join(', ')} wasn't available — sorry about that.)` : '';

  return `Perfect — ${summary}!${totalStr}${upsell} Ready in about 20–25 minutes.${unavNote}`;
}

function buildClinicFallback(ctx) {
  const patient = ctx.patientName || 'you';
  const service = ctx.serviceType || 'your appointment';
  const time    = ctx.timePreference && ctx.timePreference !== 'no time preference provided'
    ? ` for ${ctx.timePreference}` : ' at the next available slot';
  return `I've booked a ${service} for ${patient}${time}. Please arrive 10 minutes early and bring your insurance card. Anything else I can help with?`;
}

function buildUnknownFallback(tenant, knowledge) {
  const menu     = Array.isArray(knowledge?.menu)     ? knowledge.menu     : [];
  const services = Array.isArray(knowledge?.services) ? knowledge.services : [];
  if (tenant.type === 'restaurant' && menu.length) {
    const pick = menu[Math.floor(Math.random() * Math.min(3, menu.length))];
    return `Hey! Our ${pick.name} is really popular right now — I'd recommend it! Ready to order, or can I help with something else?`;
  }
  if (tenant.type === 'clinic' && services.length) {
    return `Hi! I can help you book a ${services[0].name} or any of our other services. What would you like to schedule today?`;
  }
  return `Hi! I can help you place a food order or book an appointment. Which can I help you with?`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Generate a human-like staff response for any outcome.
 *
 * @param {object} ctx
 *   intent           - restaurant_order | item_unavailable | clinic_booking | unknown
 *   tenant           - { id, name, type, plan }
 *   knowledge        - { menu, services, rules } or null
 *   message          - original user message
 *   userId           - for memory lookup
 *   items            - priced order items (restaurant)
 *   orderTotal       - number (restaurant)
 *   unavailableItems - string[] (restaurant)
 *   patientName      - (clinic)
 *   serviceType      - normalised service name (clinic)
 *   timePreference   - (clinic)
 *   executionStatus  - 'completed' | 'partial'
 */
async function generateStaffResponse(ctx) {
  const { intent, tenant, knowledge, message, userId } = ctx;

  // Phase 3: retrieve memory for this session
  const memory = getMemory(tenant.id, userId);

  // Phase 2: detect customer state
  const state  = detectCustomerState(message, memory);

  // After a successful response we update memory (done externally by bookingAgent)

  // Rule-based path when OpenAI is not configured
  if (!hasOpenAiConfig()) {
    if (intent === 'clinic_booking')                                      return buildClinicFallback(ctx);
    if (intent === 'restaurant_order' || intent === 'item_unavailable')  return buildRestaurantFallback(ctx, knowledge);
    return buildUnknownFallback(tenant, knowledge);
  }

  let systemPrompt, userMessage;

  if (intent === 'restaurant_order' || intent === 'item_unavailable') {
    systemPrompt = buildRestaurantStaffPrompt(tenant, knowledge, ctx, state, memory);
    userMessage  = 'Generate your response now.';
  } else if (intent === 'clinic_booking') {
    systemPrompt = buildClinicReceptionistPrompt(tenant, knowledge, ctx, state, memory);
    userMessage  = 'Generate your response now.';
  } else {
    systemPrompt = buildUnknownQueryPrompt(tenant, knowledge, message || '', state, memory);
    userMessage  = message || 'Hello';
  }

  try {
    const result = await callWithRetry((client) =>
      client.responses.create({
        model:       process.env.OPENAI_STAFF_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        temperature: 0.7,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: systemPrompt }] },
          { role: 'user',   content: [{ type: 'input_text', text: userMessage  }] },
        ],
      }),
    );

    const text = (result.output_text || '').trim();
    if (text) return text;
  } catch (err) {
    console.error('[staffBehavior] OpenAI call failed:', err.message);
  }

  // Fallback
  if (intent === 'clinic_booking')                                     return buildClinicFallback(ctx);
  if (intent === 'restaurant_order' || intent === 'item_unavailable') return buildRestaurantFallback(ctx, knowledge);
  return buildUnknownFallback(tenant, knowledge);
}

module.exports = {
  generateStaffResponse,
  recordOrder,
  recordBooking,
  updatePreferences,
  detectCustomerState,
  getMemory,
};
