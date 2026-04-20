const OpenAI = require('openai');
const { getLatestOrderForUser } = require('./orderService');

const openaiApiKey = process.env.OPENAI_API_KEY;

if (!openaiApiKey) {
  throw new Error('Missing OpenAI configuration. Set OPENAI_API_KEY.');
}

const openai = new OpenAI({
  apiKey: openaiApiKey,
});

const ORDER_RELATED_INTENTS = new Set([
  'order_status',
  'cancel_order',
  'refund_request',
  'delivery_issue',
]);

async function classifyIntent(message) {
  const response = await openai.responses.create({
    model: process.env.OPENAI_INTENT_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text:
              'Classify the customer support intent. Return JSON only with one key: intent. Valid values: order_status, cancel_order, refund_request, delivery_issue, unknown.',
          },
        ],
      },
      {
        role: 'user',
        content: [{ type: 'input_text', text: message }],
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'support_intent',
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            intent: {
              type: 'string',
              enum: ['order_status', 'cancel_order', 'refund_request', 'delivery_issue', 'unknown'],
            },
          },
          required: ['intent'],
        },
      },
    },
  });

  const parsed = JSON.parse(response.output_text);
  return parsed.intent;
}

async function generateSupportResponse({ message, intent, orderData }) {
  if (intent === 'unknown') {
    return 'Could you clarify whether you need help with your order status, cancellation, refund, or a delivery issue?';
  }

  if (ORDER_RELATED_INTENTS.has(intent) && !orderData) {
    return 'I could not find an order linked to your account. Please share the order ID or check that you are using the correct account.';
  }

  const response = await openai.responses.create({
    model: process.env.OPENAI_RESPONSE_MODEL || process.env.OPENAI_MODEL || 'gpt-4.1-mini',
    input: [
      {
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: [
              'You are a customer support assistant.',
              'Keep the reply short, clear, and friendly.',
              'Do not invent order facts.',
              'Only mention order details that are explicitly present in the provided order data.',
              'If the order data is missing, say that cleanly.',
              'If the user wants cancellation or refund help, explain the next step based on the available order status only.',
            ].join(' '),
          },
        ],
      },
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: JSON.stringify({
              customer_message: message,
              intent,
              order_data: orderData,
            }),
          },
        ],
      },
    ],
  });

  return response.output_text.trim();
}

async function handleSupportMessage({ userId, message }) {
  const intent = await classifyIntent(message);
  const orderData = ORDER_RELATED_INTENTS.has(intent) ? await getLatestOrderForUser(userId) : null;
  const response = await generateSupportResponse({ message, intent, orderData });

  return {
    intent,
    response,
    order_data: orderData || {},
  };
}

module.exports = {
  handleSupportMessage,
  classifyIntent,
  generateSupportResponse,
};
