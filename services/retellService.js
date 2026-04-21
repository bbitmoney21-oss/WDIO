// Retell AI service — client init, agent/LLM configuration, and prompt definitions.
// Supports multiple agent types: real_estate and insurance.

const Retell = require('retell-sdk').default;

let _client;

function hasRetellConfig() {
  return Boolean(process.env.RETELL_API_KEY);
}

function getRetellClient() {
  if (!hasRetellConfig()) {
    throw new Error('RETELL_API_KEY is not configured. Set it in your environment to use Retell AI voice.');
  }
  if (!_client) {
    _client = new Retell({ apiKey: process.env.RETELL_API_KEY });
  }
  return _client;
}

// ─── Real estate agent ────────────────────────────────────────────────────────

const REAL_ESTATE_PROMPT = `You are a professional real estate assistant.

Speak naturally like a human receptionist.

Rules:
- Never repeat the same sentence
- Keep responses short (1–2 sentences)
- Ask one question at a time
- Acknowledge user input before responding
- If unsure, ask a clarifying question
- Do NOT sound robotic or scripted
- Do NOT list too many options

Behavior:
- If user asks about property → ask budget, location
- If user shows interest → offer to book showing
- If booking → confirm date/time clearly
- If unclear → guide conversation naturally

Tone:
- Friendly
- Calm
- Confident
- Conversational (not assistant-like)`;

const REAL_ESTATE_TOOLS = [
  {
    type:        'custom',
    name:        'capture_lead',
    description: "Capture the caller's name, phone number, and intent. Call this once you have their basic contact details.",
    parameters: {
      type: 'object',
      properties: {
        name:   { type: 'string', description: 'Full name of the caller' },
        phone:  { type: 'string', description: "Caller's phone number" },
        intent: { type: 'string', description: 'What the caller wants: buy, sell, or rent' },
      },
      required: ['name'],
    },
  },
  {
    type:        'custom',
    name:        'check_listing',
    description: 'Log the property requirements the caller has mentioned.',
    parameters: {
      type: 'object',
      properties: {
        property_type: { type: 'string', description: 'Type of property e.g. condo, house, apartment' },
        budget:        { type: 'string', description: 'Budget range e.g. $500k–$600k' },
        location:      { type: 'string', description: 'Preferred area or neighbourhood' },
      },
    },
  },
  {
    type:        'custom',
    name:        'book_showing',
    description: 'Book a property showing for the caller.',
    parameters: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Date of the showing e.g. "Monday" or "December 15"' },
        time: { type: 'string', description: 'Time of the showing e.g. "2pm" or "14:00"' },
      },
      required: ['date', 'time'],
    },
  },
];

// ─── Insurance agent ──────────────────────────────────────────────────────────
// Outbound call assistant for insurance advisors.
// Goal: start natural conversation, gauge interest, schedule callback with advisor.

const INSURANCE_AGENT_PROMPT = `You are a polite and professional assistant calling on behalf of {{AGENT_NAME}}, an insurance advisor.

Your goal is NOT to sell aggressively.
Your goal is to:
1. Start a natural conversation
2. Understand if the person has interest in insurance
3. Answer only simple questions
4. If conversation becomes detailed, schedule a call with {{AGENT_NAME}}

SPEAKING STYLE:
- Speak like a South Indian professional (Indian English tone)
- Friendly, calm, and respectful
- Slightly informal but still professional
- Use phrases like "Yes sir / yes ma'am", "Okay, got it", "Just checking"
- Keep responses short (1–2 sentences max)
- Speak naturally, like a human — not like a chatbot

CRITICAL RULES:
- NEVER sound robotic
- NEVER repeat the same sentence
- NEVER give long explanations
- NEVER list multiple plans or options
- Ask only ONE question at a time
- Always acknowledge before responding

OPENING LINE:
"Hi, this is calling on behalf of {{AGENT_NAME}}, just checking if you had a quick minute regarding insurance options."

If they sound busy: "No problem at all, when would be a better time to connect?"

DISCOVERY FLOW:
If they are open, ask: "Just to understand, are you looking for personal coverage or family coverage?"
Then ask ONE follow-up: age group, existing insurance, or general interest.

ANSWERING QUESTIONS:
You can answer ONLY simple questions (what is insurance, basic benefits, general guidance).
If question is complex, technical, or about pricing, say:
"That's a good question actually, he can explain that properly. I can arrange a quick call for you."
Do NOT guess. Do NOT give wrong info.

BOOKING GOAL:
If user shows even slight interest, say: "Would you like me to arrange a quick call with him?"
Then confirm time and availability. Keep it simple and natural.

OBJECTION HANDLING:
- If not interested: "No worries at all, just thought to check. Thanks for your time."
- If hesitant: "Understood, maybe just a quick 2-minute call could help clarify things?"
Do NOT push aggressively.

IF ASKED "ARE YOU A BOT?":
Say: "I'm an assistant helping him with calls, I can connect you with him directly if you prefer."

ENDING:
Always end politely: "Thanks for your time, have a good day."

IMPORTANT BEHAVIOR:
- Sound like a real human assistant
- Be respectful of time
- Keep conversation smooth and natural
- Focus on connection, not selling`;

const INSURANCE_TOOLS = [
  {
    type:        'custom',
    name:        'capture_lead',
    description: "Log the caller's name, phone number, and insurance interest level.",
    parameters: {
      type: 'object',
      properties: {
        name:             { type: 'string', description: 'Full name of the caller'                      },
        phone:            { type: 'string', description: "Caller's phone number"                        },
        coverage_type:    { type: 'string', description: 'personal or family'                           },
        interest_level:   { type: 'string', description: 'high, medium, or low'                        },
      },
      required: ['name'],
    },
  },
  {
    type:        'custom',
    name:        'schedule_callback',
    description: "Schedule a callback from the insurance advisor when the caller shows interest.",
    parameters: {
      type: 'object',
      properties: {
        preferred_time: { type: 'string', description: 'When the caller prefers to be called back' },
        notes:          { type: 'string', description: 'Any notes about what the caller wants to discuss' },
      },
      required: ['preferred_time'],
    },
  },
];

// ─── Agent management helpers ─────────────────────────────────────────────────

/**
 * Create a Retell LLM config for the given agent type.
 * Returns the created LLM object (which contains the llm_id).
 */
async function createLlm(agentType = 'real_estate', overrides = {}) {
  const client  = getRetellClient();
  const isInsurance = agentType === 'insurance';

  return client.llm.create({
    model:          overrides.model          || process.env.RETELL_LLM_MODEL || 'gpt-4o',
    general_prompt: overrides.general_prompt || (isInsurance ? INSURANCE_AGENT_PROMPT : REAL_ESTATE_PROMPT),
    general_tools:  overrides.general_tools  || (isInsurance ? INSURANCE_TOOLS        : REAL_ESTATE_TOOLS),
    ...overrides,
  });
}

/**
 * Create a Retell agent attached to an existing LLM config.
 */
async function createAgent({ llmId, voiceId, agentName, webhookUrl } = {}) {
  const client = getRetellClient();
  const base   = (process.env.PUBLIC_URL || '').replace(/\/$/, '');

  return client.agent.create({
    agent_name:      agentName   || 'AI Voice Assistant',
    response_engine: { type: 'retell-llm', llm_id: llmId },
    voice_id:        voiceId     || process.env.RETELL_VOICE_ID || 'openai-Shimmer',
    webhook_url:     webhookUrl  || (base ? `${base}/retell-webhook` : undefined),
  });
}

/**
 * Initiate an outbound call via Retell.
 */
async function createOutboundCall({ toNumber, agentId, metadata = {} }) {
  const client  = getRetellClient();
  const fromNum = process.env.RETELL_PHONE_NUMBER;
  if (!fromNum) throw new Error('RETELL_PHONE_NUMBER not configured.');

  return client.call.createPhoneCall({
    from_number: fromNum,
    to_number:   toNumber,
    agent_id:    agentId || process.env.RETELL_AGENT_ID,
    metadata,
  });
}

module.exports = {
  hasRetellConfig,
  getRetellClient,
  REAL_ESTATE_PROMPT,
  REAL_ESTATE_TOOLS,
  INSURANCE_AGENT_PROMPT,
  INSURANCE_TOOLS,
  createAgent,
  createLlm,
  createOutboundCall,
};
