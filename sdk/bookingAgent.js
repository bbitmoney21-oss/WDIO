async function bookOrOrder(input, context = {}) {
  const payload =
    typeof input === 'string'
      ? {
          message: input,
          mode: 'auto',
          user_id: context.user_id || 'guest-user',
          tenant_id: context.tenantId || null,
        }
      : {
          message: input?.message || '',
          mode: input?.mode || 'auto',
          user_id: input?.user_id || context.user_id || 'guest-user',
          tenant_id: input?.tenant_id || context.tenantId || null,
        };

  const inferredOrigin =
    typeof window !== 'undefined' && window.location && window.location.origin ? window.location.origin : '';
  const backendUrl = (context.backendUrl || process.env.BOOKING_AGENT_API_URL || inferredOrigin).replace(/\/$/, '');
  const fetchImpl = context.fetch || globalThis.fetch;

  if (typeof fetchImpl !== 'function') {
    throw new Error('No fetch implementation available for bookingAgent SDK.');
  }

  if (!backendUrl) {
    throw new Error('Set backendUrl or BOOKING_AGENT_API_URL before using bookingAgent SDK outside the browser.');
  }

  const response = await fetchImpl(`${backendUrl}/api/agent/handle`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(context.apiKey ? { 'x-api-key': context.apiKey } : {}),
      ...(context.headers || {}),
    },
    body: JSON.stringify(payload),
  });

  const json = await response.json();

  if (!response.ok) {
    const error = new Error(json.error || json.response || 'Booking agent request failed.');
    error.payload = json;
    // Attach plan info to the error so callers can display upgrade prompts
    error.plan = json.plan || null;
    error.monthly_price = json.monthly_price || null;
    throw error;
  }

  if (json?.data?.usage?.warning) {
    json.sdk_warning = json.data.usage.warning;
  }

  // Surface plan and price at the top level for easy SDK consumer access
  json.plan = json.plan || json?.data?.usage?.plan || null;
  json.price = json.monthly_price ?? json?.data?.usage?.monthly_price ?? null;

  return json;
}

module.exports = {
  bookOrOrder,
};
