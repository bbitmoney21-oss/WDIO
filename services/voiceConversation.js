// Voice Conversation Engine — stateful, stage-aware per-call conversation manager.
//
// Each Twilio call gets its own state entry keyed by CallSid:
//   ordering → customization → quantity → confirmation → completed
//
// The state machine advances based on rule-based extraction so it is reliable
// and cheap. OpenAI is only called to generate the human-sounding spoken text.

const OpenAI = require('openai');
const { hasOpenAiConfig } = require('./aiAgent');

// ─── Per-call memory ──────────────────────────────────────────────────────────

const callMemory = new Map();

function initCallState() {
  return {
    stage:           'ordering',  // ordering | customization | quantity | confirmation | completed
    items:           [],          // committed items: [{name,id,quantity,spice_level,price,line_total}]
    current_item:    null,        // item currently being configured
    spice_level:     null,        // pending spice for current_item
    upsell_done:     false,       // ensure upsell only happens once
    suggested_items: new Set(),   // names already in order — never re-suggest
    last_response:   null,        // loop prevention
    turn_count:      0,
  };
}

function getCallState(callSid) {
  if (!callMemory.has(callSid)) callMemory.set(callSid, initCallState());
  return callMemory.get(callSid);
}

function clearCallState(callSid) {
  callMemory.delete(callSid);
}

// ─── Rule-based extractors ────────────────────────────────────────────────────

function matchMenuItem(speech, menu) {
  const lower = speech.toLowerCase();
  const hits  = menu.filter((m) => {
    const name = m.name.toLowerCase();
    const id   = (m.id || '').replace(/-/g, ' ');
    return lower.includes(name) || lower.includes(id);
  });
  // Ambiguous (multiple matches) → return null so AI can ask to clarify
  return hits.length === 1 ? hits[0] : null;
}

function extractSpiceLevel(speech) {
  if (/extra\s*hot|very\s*hot/i.test(speech))   return 'extra hot';
  if (/\bhot\b/i.test(speech))                  return 'hot';
  if (/\bmedium\b|\bmoderate\b/i.test(speech))  return 'medium';
  if (/\bmild\b|\bnot\s*spicy\b/i.test(speech)) return 'mild';
  return null;
}

function extractQuantity(speech) {
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8 };
  const lower  = speech.toLowerCase();
  for (const [w, n] of Object.entries(words)) if (lower.includes(w)) return n;
  const m = speech.match(/\b([1-9])\b/);
  return m ? parseInt(m[1], 10) : null;
}

function extractYesNo(speech) {
  if (/\byes\b|\byep\b|\byeah\b|\bsure\b|\bplease\b|\bgo ahead\b|\bokay\b|\bok\b|\bconfirm\b|\bplace\b|\bthat.?s (it|all)\b/i.test(speech)) return 'yes';
  if (/\bno\b|\bnope\b|\bdon.?t\b|\bcancel\b|\bnothing\b|\bstop\b/i.test(speech)) return 'no';
  return null;
}

// ─── Commit item to order ─────────────────────────────────────────────────────

function commitItem(state, qty) {
  const item = state.current_item;
  if (!item) return;
  state.items.push({
    name:        item.name,
    id:          item.id,
    quantity:    qty,
    spice_level: state.spice_level,
    price:       item.price,
    line_total:  Number((item.price * qty).toFixed(2)),
  });
  state.suggested_items.add(item.name);
  state.current_item = null;
  state.spice_level  = null;
  // Return to ordering so customer can add more items
  state.stage = 'ordering';
}

// ─── State machine ────────────────────────────────────────────────────────────
// Uses entryStage to prevent chaining upsell/confirmation in the same turn.

function advanceState(state, speech, menu) {
  state.turn_count += 1;
  const entryStage = state.stage;

  // ORDERING: detect item, or "no more" → confirmation
  if (entryStage === 'ordering') {
    const item = matchMenuItem(speech, menu);
    if (item) {
      state.current_item = item;
      state.spice_level  = null;
      state.stage        = item.spice ? 'customization' : 'quantity';
    } else if (state.items.length > 0 && extractYesNo(speech) === 'no') {
      state.stage = 'confirmation';
    }
    // Fall through: if item detected, allow same-utterance spice/qty below
  }

  // CUSTOMIZATION: detect spice (can chain from ordering in same utterance)
  if (state.stage === 'customization') {
    const spice = extractSpiceLevel(speech);
    if (spice) {
      state.spice_level = spice;
      state.stage       = 'quantity';
    }
  }

  // QUANTITY: detect how many, commit item (can chain from above in same utterance)
  if (state.stage === 'quantity' && state.current_item) {
    const qty = extractQuantity(speech);
    if (qty !== null) commitItem(state, qty);  // stage resets to 'ordering' inside
    // If qty still null: stay in quantity, AI will ask
  }

  // CONFIRMATION: only process if we were already there — prevents same-turn bleed
  if (entryStage === 'confirmation') {
    const yn = extractYesNo(speech);
    if (yn === 'yes')     state.stage = 'completed';
    else if (yn === 'no') state.stage = 'ordering';  // customer wants to add more
  }
}

// ─── Prompt builder (uses the exact staff prompt the client specified) ─────────

function buildPrompt(state, knowledge) {
  const menu      = Array.isArray(knowledge?.menu)     ? knowledge.menu     : [];
  const combos    = Array.isArray(knowledge?.combos)   ? knowledge.combos   : [];
  const specials  = Array.isArray(knowledge?.specials) ? knowledge.specials : [];
  const spiceLevels = knowledge?.spice_levels || ['mild', 'medium', 'hot', 'extra hot'];

  // Serialise menu for injection
  const menuText = [
    ...menu.map((m) =>
      `${m.name} ($${Number(m.price).toFixed(2)})${m.spice ? ' [spice levels available]' : ''} [${m.category}]`,
    ),
    ...(combos.length ? [`--- Combos: ${combos.map((c) => `${c.name} ($${Number(c.price).toFixed(2)}): ${c.description}`).join(' | ')}`] : []),
    ...(specials.length ? [`--- Specials: ${specials.map((s) => `${s.name}: ${s.description}${s.price ? ` ($${Number(s.price).toFixed(2)})` : ''}`).join(' | ')}`] : []),
  ].join('\n');

  // Serialise current state for injection
  const orderSoFar = state.items.length
    ? state.items.map((i) => `${i.quantity}x ${i.name}${i.spice_level ? ` (${i.spice_level})` : ''} — $${Number(i.line_total).toFixed(2)}`).join(', ')
    : 'none yet';
  const total = Number(state.items.reduce((s, i) => s + i.line_total, 0).toFixed(2));
  const alreadySuggested = [...state.suggested_items].join(', ') || 'none';

  const currentCtx = state.current_item
    ? `Currently adding: ${state.current_item.name}${state.spice_level ? ` (spice: ${state.spice_level})` : ''} — spice required: ${state.current_item.spice}`
    : 'No item in progress';

  // Stage-specific task instruction
  const upsellInstruction = !state.upsell_done && state.items.length > 0
    ? `After confirming their order, suggest EXACTLY ONE add-on from the MENU that is NOT in [${alreadySuggested}]. Keep it brief.`
    : 'Upsell already done — do NOT suggest anything extra.';

  const taskInstruction = {
    ordering:
      state.items.length > 0
        ? `Customer already has: ${orderSoFar}. Ask if they want anything else. ${upsellInstruction} Or ask if they are ready to confirm.`
        : `Find out what the customer wants to order. If ambiguous, offer ONLY 2 options from MENU. NEVER suggest items in [${alreadySuggested}].`,
    customization: `Ask for spice level only: ${spiceLevels.join(' / ')}. Nothing else this turn.`,
    quantity:      `Ask how many ${state.current_item?.name || 'of those'} they want. One question only.`,
    confirmation:  `Read back the full order (${orderSoFar}, total $${total}). Ask "Shall I place the order?" One sentence only.`,
    completed:     `Thank the customer. Tell them roughly 25 minutes. Say goodbye warmly. One sentence.`,
  }[state.stage] || 'Help the customer with their order.';

  const stateBlock = JSON.stringify({
    stage:           state.stage,
    items:           orderSoFar,
    current_item:    state.current_item?.name || null,
    spice_level:     state.spice_level,
    upsell_done:     state.upsell_done,
    already_suggested: alreadySuggested,
    current_context: currentCtx,
    YOUR_TASK:       taskInstruction,
  }, null, 2);

  // Use the exact staff prompt template the client specified
  return `You are a real staff member at Bhagibhavan, an authentic Andhra restaurant.

You are speaking on a live phone call with a customer.

You are NOT an AI. You are restaurant staff.

You must speak naturally, like a human in a busy restaurant.

You do NOT control the conversation logic. You only respond based on the given STATE.

---

STATE:
${stateBlock}

MENU:
${menuText}

---

STRICT BEHAVIOR RULES:

1. NEVER repeat items already mentioned in STATE.items
2. NEVER suggest items not present in MENU
3. NEVER hallucinate food (no pizza, burger, etc.)
4. NEVER restart the conversation flow
5. NEVER repeat the same sentence or recommendation
6. ALWAYS move forward in the conversation

---

HARD CONSTRAINTS:

- Maximum 1–2 short sentences per response
- No long explanations
- No robotic or formal phrases like "your order has been successfully placed"
- No AI-like language
- No repeating the same question twice
- If confused → offer ONLY 2 menu options

---

UPSELL RULE:

- Suggest ONLY ONCE per call
- If STATE.upsell_done = true → NEVER upsell again

---

ERROR HANDLING:

If user is unclear or silent:
"Sorry, I didn't catch that. Could you repeat?"

---

TONE:

Friendly, fast, natural, Indian restaurant staff tone.

Example style:
- "Got it, 2 chicken biryanis. Spicy or medium?"
- "Anything to drink with that?"
- "Okay, noted."

---

FINAL RULE:

Only respond as spoken words in a phone call.
No meta explanations. No system behavior. No formatting.`;
}

// ─── Rule-based fallback (no OpenAI) ─────────────────────────────────────────

function buildFallback(state, knowledge) {
  const menu    = Array.isArray(knowledge?.menu)   ? knowledge.menu   : [];
  const mains   = menu.filter((m) => m.category === 'mains');
  const drinks  = menu.filter((m) => m.category === 'drinks');
  const spiceLevels = (knowledge?.spice_levels || ['mild', 'medium', 'hot', 'extra hot']).join(', ');

  switch (state.stage) {
    case 'ordering':
      if (state.items.length > 0) {
        const drink = drinks.find((d) => !state.suggested_items.has(d.name));
        return drink && !state.upsell_done
          ? `Anything else? We also have ${drink.name} if you'd like a drink.`
          : "Anything else, or shall I confirm the order?";
      }
      return mains.length
        ? `What would you like? We have ${mains.slice(0, 2).map((m) => m.name).join(' and ')} — both very popular.`
        : 'What would you like to order today?';
    case 'customization':
      return `How spicy would you like it? ${spiceLevels}.`;
    case 'quantity':
      return `How many ${state.current_item?.name || 'of those'} would you like?`;
    case 'confirmation': {
      const summary = state.items.map((i) => `${i.quantity} ${i.name}${i.spice_level ? ` (${i.spice_level})` : ''}`).join(' and ');
      const total   = state.items.reduce((s, i) => s + i.line_total, 0);
      return `So that's ${summary} — $${Number(total).toFixed(2)} total. Shall I place the order?`;
    }
    case 'completed':
      return "Perfect! Your order is in — should be ready in about 25 minutes. Thanks for calling Bhagibhavan!";
    default:
      return "What can I get for you?";
  }
}

// ─── OpenAI client ────────────────────────────────────────────────────────────

let _client;
function getAIClient() {
  if (!_client) _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return _client;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Process one voice turn.
 * @returns {{ response: string, shouldHangUp: boolean, finalOrder: object|null }}
 */
async function processVoiceTurn(callSid, speech, knowledge) {
  const state = getCallState(callSid);
  const menu  = Array.isArray(knowledge?.menu) ? knowledge.menu : [];

  // Advance the state machine based on what was extracted from speech
  advanceState(state, speech, menu);

  // Mark upsell as done after the first ordering turn with items (shown this response)
  if (state.stage === 'ordering' && state.items.length > 0 && !state.upsell_done) {
    state.upsell_done = true;
  }

  const shouldHangUp = state.stage === 'completed';
  const finalOrder   = shouldHangUp && state.items.length
    ? { items: [...state.items] }
    : null;

  // Generate spoken response
  let response;
  if (!hasOpenAiConfig()) {
    response = buildFallback(state, knowledge);
  } else {
    try {
      const result = await getAIClient().responses.create({
        model:       process.env.OPENAI_VOICE_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        temperature: 0.65,
        input: [
          { role: 'system', content: [{ type: 'input_text', text: buildPrompt(state, knowledge) }] },
          { role: 'user',   content: [{ type: 'input_text', text: speech || 'Hello'            }] },
        ],
      });
      response = (result.output_text || '').trim();
    } catch (err) {
      console.error('[voiceConversation] OpenAI error:', err.message);
      response = buildFallback(state, knowledge);
    }
  }

  // Loop prevention: if response is identical to last, add a brief opener
  if (response && response === state.last_response) {
    const openers = ['Sure! ', 'Right — ', 'Of course. '];
    response = openers[state.turn_count % openers.length] + response;
  }

  state.last_response = response;
  return { response, shouldHangUp, finalOrder };
}

module.exports = { getCallState, clearCallState, processVoiceTurn };
