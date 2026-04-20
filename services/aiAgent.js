const OpenAI = require('openai');

const DOMAIN_INTENTS = ['restaurant_order', 'clinic_booking', 'unknown'];
const OPENAI_RETRYABLE_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504]);
const OPENAI_MAX_ATTEMPTS = 3;
const OPENAI_BASE_DELAY_MS = 500;

let openaiClient;

function hasOpenAiConfig() {
  return Boolean(process.env.OPENAI_API_KEY);
}

function createServiceError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function buildConfigurationResponse() {
  return 'The booking service is still being configured. Please try again shortly.';
}

function getOpenAiClient() {
  if (!hasOpenAiConfig()) {
    throw createServiceError('OpenAI is not configured. Set OPENAI_API_KEY before using the booking agent.', 503);
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  return openaiClient;
}

function sanitizeMessage(message) {
  return typeof message === 'string' ? message.trim() : '';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableOpenAiError(error) {
  return OPENAI_RETRYABLE_STATUS_CODES.has(error?.status);
}

async function callOpenAiWithRetry(requestBuilder) {
  const client = getOpenAiClient();
  let lastError;

  for (let attempt = 1; attempt <= OPENAI_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await requestBuilder(client);
    } catch (error) {
      lastError = error;

      if (!isRetryableOpenAiError(error) || attempt === OPENAI_MAX_ATTEMPTS) {
        throw error;
      }

      const delayMs = OPENAI_BASE_DELAY_MS * 2 ** (attempt - 1);
      await sleep(delayMs);
    }
  }

  throw lastError;
}

function detectIntentByRules(message) {
  const sanitizedMessage = sanitizeMessage(message).toLowerCase();

  if (!sanitizedMessage) {
    return 'unknown';
  }

  const restaurantSignals = [
    'order',
    'food',
    'pizza',
    'burger',
    'biryani',
    'coke',
    'cola',
    'juice',
    'tea',
    'snack',
    'pasta',
    'fries',
    'sushi',
    'drink',
    'coffee',
    'meal',
    'delivery',
    'takeout',
    'restaurant',
  ];
  const clinicSignals = [
    'appointment',
    'doctor',
    'clinic',
    'book',
    'schedule',
    'checkup',
    'consultation',
    'visit',
    'dentist',
    'therapy',
    'physician',
    'dermatologist',
  ];

  const restaurantScore = restaurantSignals.filter((signal) => sanitizedMessage.includes(signal)).length;
  const clinicScore = clinicSignals.filter((signal) => sanitizedMessage.includes(signal)).length;

  if (restaurantScore === 0 && clinicScore === 0) {
    return 'unknown';
  }

  return restaurantScore >= clinicScore ? 'restaurant_order' : 'clinic_booking';
}

function normalizeIntent(intent) {
  return DOMAIN_INTENTS.includes(intent) ? intent : 'unknown';
}

function extractRestaurantItemsByRules(message) {
  const sanitizedMessage = sanitizeMessage(message);

  if (!sanitizedMessage) {
    return [];
  }

  const itemDictionary = [
    'pizza',
    'burger',
    'fries',
    'pasta',
    'salad',
    'sushi',
    'taco',
    'burrito',
    'sandwich',
    'biryani',
    'coke',
    'cola',
    'coffee',
    'tea',
    'juice',
    'cake',
    'noodles',
    'rice',
    'steak',
    'soup',
  ];
  const quantityPattern = /(\d+)\s+([a-zA-Z][a-zA-Z\s]{1,30})/g;
  const items = [];
  let match;

  while ((match = quantityPattern.exec(sanitizedMessage)) !== null) {
    const [, quantity, rawName] = match;
    const normalizedName = rawName.trim().toLowerCase();
    const matchedDictionaryItem = itemDictionary.find((item) => normalizedName.includes(item));

    if (matchedDictionaryItem) {
      items.push({
        name: matchedDictionaryItem,
        quantity: Number(quantity),
      });
    }
  }

  if (items.length > 0) {
    return items;
  }

  const detectedItems = itemDictionary
    .filter((item) => sanitizedMessage.toLowerCase().includes(item))
    .map((item) => ({
      name: item,
      quantity: 1,
    }));

  if (detectedItems.length > 0) {
    return detectedItems;
  }

  return [
    {
      name: sanitizedMessage,
      quantity: 1,
    },
  ];
}

function extractClinicBookingByRules(message, userId) {
  const sanitizedMessage = sanitizeMessage(message);
  const lowerMessage = sanitizedMessage.toLowerCase();
  const doctorMatch = sanitizedMessage.match(/\b[Dd]r\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?/);
  const serviceMatch = sanitizedMessage.match(
    /\b(dentist|doctor|dermatologist|physician|therapy|consultation|checkup|eye exam|cardiology|pediatrics)\b/i,
  );
  const timeMatch = sanitizedMessage.match(
    /\b(today|tomorrow|next\s+\w+|this\s+\w+)(?:\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm))?|\bon\s+[A-Z][a-z]+(?:\s+(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm))?|\b(?:at\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i,
  );
  const explicitNameMatch = sanitizedMessage.match(
    /\b(?:for|name is|this is|patient is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/,
  );

  let patientName = explicitNameMatch ? explicitNameMatch[1].trim() : '';

  if (!patientName && userId) {
    patientName = userId;
  }

  return {
    patient_name: patientName || 'Patient',
    service_type: doctorMatch ? doctorMatch[0] : serviceMatch ? serviceMatch[1] : 'general consultation',
    time_preference: timeMatch ? timeMatch[0] : lowerMessage.includes('as soon as possible') ? 'as soon as possible' : 'no time preference provided',
  };
}

async function classifyIntent(message, mode = 'auto') {
  const sanitizedMessage = sanitizeMessage(message);

  if (!sanitizedMessage) {
    return 'unknown';
  }

  if (mode === 'restaurant') {
    return 'restaurant_order';
  }

  if (mode === 'clinic') {
    return 'clinic_booking';
  }

  if (!hasOpenAiConfig()) {
    return detectIntentByRules(sanitizedMessage);
  }

  try {
    const response = await callOpenAiWithRetry((client) =>
      client.responses.create({
        model: process.env.OPENAI_INTENT_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        temperature: 0,
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: [
                  'Classify the user request into one of three intents.',
                  'Return JSON only with key intent.',
                  'Valid values: restaurant_order, clinic_booking, unknown.',
                  'Use unknown if the request is unrelated or ambiguous.',
                ].join(' '),
              },
            ],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: sanitizedMessage }],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'booking_intent',
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                intent: {
                  type: 'string',
                  enum: DOMAIN_INTENTS,
                },
              },
              required: ['intent'],
            },
          },
        },
      }),
    );

    return normalizeIntent(JSON.parse(response.output_text).intent);
  } catch (error) {
    console.error('Intent classification fallback triggered:', error.message);
    return detectIntentByRules(sanitizedMessage);
  }
}

async function extractRestaurantOrder(message) {
  const sanitizedMessage = sanitizeMessage(message);
  const fallbackItems = extractRestaurantItemsByRules(sanitizedMessage);

  if (!hasOpenAiConfig()) {
    return { items: fallbackItems };
  }

  try {
    const response = await callOpenAiWithRetry((client) =>
      client.responses.create({
        model: process.env.OPENAI_EXTRACTION_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        temperature: 0,
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: [
                  'Extract restaurant order items from the user message.',
                  'Return JSON only.',
                  'Use the schema exactly.',
                  'If the quantity is unknown, default to 1.',
                ].join(' '),
              },
            ],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: sanitizedMessage }],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'restaurant_order_extraction',
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                items: {
                  type: 'array',
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      name: { type: 'string' },
                      quantity: { type: 'number' },
                    },
                    required: ['name', 'quantity'],
                  },
                },
              },
              required: ['items'],
            },
          },
        },
      }),
    );

    const parsed = JSON.parse(response.output_text);

    return {
      items: Array.isArray(parsed.items) && parsed.items.length > 0 ? parsed.items : fallbackItems,
    };
  } catch (error) {
    console.error('Restaurant extraction fallback triggered:', error.message);
    return { items: fallbackItems };
  }
}

async function extractClinicBooking(message, userId) {
  const sanitizedMessage = sanitizeMessage(message);
  const fallbackExtraction = extractClinicBookingByRules(sanitizedMessage, userId);
  const emailMatch = sanitizedMessage.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);

  if (!hasOpenAiConfig()) {
    return {
      ...fallbackExtraction,
      patient_email: emailMatch ? emailMatch[0] : '',
    };
  }

  try {
    const response = await callOpenAiWithRetry((client) =>
      client.responses.create({
        model: process.env.OPENAI_EXTRACTION_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini',
        temperature: 0,
        input: [
          {
            role: 'system',
            content: [
              {
                type: 'input_text',
                text: [
                  'Extract clinic booking details from the user message.',
                  'Return JSON only with patient_name, service_type, and time_preference.',
                  'If something is missing, return a helpful fallback value instead of null.',
                ].join(' '),
              },
            ],
          },
          {
            role: 'user',
            content: [{ type: 'input_text', text: sanitizedMessage }],
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'clinic_booking_extraction',
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                patient_name: { type: 'string' },
                service_type: { type: 'string' },
                time_preference: { type: 'string' },
                patient_email: { type: 'string' },
              },
              required: ['patient_name', 'service_type', 'time_preference', 'patient_email'],
            },
          },
        },
      }),
    );

    const parsed = JSON.parse(response.output_text);

    return {
      patient_name: parsed.patient_name || fallbackExtraction.patient_name,
      service_type: parsed.service_type || fallbackExtraction.service_type,
      time_preference: parsed.time_preference || fallbackExtraction.time_preference,
      patient_email: parsed.patient_email || (emailMatch ? emailMatch[0] : ''),
    };
  } catch (error) {
    console.error('Clinic extraction fallback triggered:', error.message);
    return {
      ...fallbackExtraction,
      patient_email: emailMatch ? emailMatch[0] : '',
    };
  }
}

function buildUnknownResponse() {
  return 'I can help with restaurant orders or clinic appointments. Could you tell me which one you need?';
}

function buildRestaurantResponse(result) {
  if (!result.stored) {
    return `I captured your restaurant order request as ${result.order_id}, but I could not save it to the database right now.`;
  }

  return `Your restaurant order has been created with ID ${result.order_id}.`;
}

function buildClinicResponse(result) {
  if (!result.stored) {
    return `I captured your appointment request as ${result.appointment_id}, but I could not save it to the database right now.`;
  }

  return `Your clinic appointment request has been created with ID ${result.appointment_id}.`;
}

module.exports = {
  buildClinicResponse,
  buildConfigurationResponse,
  buildRestaurantResponse,
  buildUnknownResponse,
  classifyIntent,
  createServiceError,
  detectIntentByRules,
  extractClinicBooking,
  extractRestaurantOrder,
  hasOpenAiConfig,
  sanitizeMessage,
};
