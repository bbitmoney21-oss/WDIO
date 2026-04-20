const crypto = require('crypto');
const { getSupabaseClient, hasSupabaseConfig, isSchemaError, isMissingRelationError } = require('./supabaseClient');

function createServiceError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function generateOrderId() {
  const dateSegment = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = crypto.randomInt(0, 10000).toString().padStart(4, '0');
  return `RESTO-${dateSegment}-${suffix}`;
}

function normalizeItems(items) {
  return Array.isArray(items)
    ? items.map((item) => ({
        name: String(item.name || 'item'),
        quantity: Number(item.quantity) > 0 ? Number(item.quantity) : 1,
      }))
    : [];
}

async function tryInsertOrder(supabase, payload) {
  const { data, error } = await supabase.from('orders').insert(payload).select().maybeSingle();

  if (error) {
    throw error;
  }

  return data || payload;
}

async function createRestaurantOrder({ tenant, userId, items, rawMessage }) {
  const normalizedItems = normalizeItems(items);
  const orderId = generateOrderId();
  const timestamp = new Date().toISOString();
  const fallbackResult = {
    order_id: orderId,
    stored: false,
    details: {
      tenant_id: tenant.id,
      user_id: userId,
      items: normalizedItems,
      status: 'draft',
      instructions: rawMessage,
      message: rawMessage,
    },
  };

  if (!hasSupabaseConfig()) {
    return fallbackResult;
  }

  const supabase = getSupabaseClient();
  const payloadVariants = [
    {
      id: orderId,
      tenant_id: tenant.id,
      user_id: userId,
      items: normalizedItems,
      status: 'pending',
      updated_at: timestamp,
      instructions: rawMessage,
    },
    {
      id: orderId,
      tenant_id: tenant.id,
      customer_name: userId,
      items: normalizedItems,
      total: 0,
      status: 'pending',
      created_at: timestamp,
      restaurant_id: 'unknown',
      instructions: rawMessage,
    },
    {
      id: orderId,
      tenant_id: tenant.id,
      items: normalizedItems,
      status: 'pending',
      created_at: timestamp,
      instructions: rawMessage,
    },
  ];

  for (const payload of payloadVariants) {
    try {
      const insertedOrder = await tryInsertOrder(supabase, payload);

      return {
        order_id: orderId,
        stored: true,
        details: insertedOrder,
      };
    } catch (error) {
      if (isMissingRelationError(error)) {
        return fallbackResult;
      }

      if (!isSchemaError(error)) {
        console.error('Order insert failed:', error.message);
        return fallbackResult;
      }
    }
  }

  return fallbackResult;
}

async function getLatestOrderForUser(tenant, userId) {
  const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';

  if (!normalizedUserId) {
    throw createServiceError('A valid user_id is required to fetch order data.', 400);
  }

  if (!hasSupabaseConfig()) {
    return null;
  }

  const supabase = getSupabaseClient();
  const queryAttempts = [
    () =>
      supabase
        .from('orders')
        .select('id, user_id, status, items, updated_at')
        .eq('tenant_id', tenant.id)
        .eq('user_id', normalizedUserId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    () =>
      supabase
        .from('orders')
        .select('id, customer_name, status, items, created_at')
        .eq('tenant_id', tenant.id)
        .eq('customer_name', normalizedUserId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    () =>
      supabase
        .from('orders')
        .select('*')
        .eq('tenant_id', tenant.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
  ];

  for (const queryAttempt of queryAttempts) {
    try {
      const { data, error } = await queryAttempt();

      if (error) {
        if (isMissingRelationError(error)) {
          return null;
        }

        if (isSchemaError(error)) {
          continue;
        }

        throw error;
      }

      if (!data) {
        continue;
      }

      return {
        id: data.id || null,
        user_id: data.user_id || normalizedUserId,
        status: data.status || 'unknown',
        items: data.items || [],
        updated_at: data.updated_at || data.created_at || null,
      };
    } catch (error) {
      if (isSchemaError(error) || isMissingRelationError(error)) {
        continue;
      }

      console.error('Order lookup failed:', error.message);
      return null;
    }
  }

  return null;
}

module.exports = {
  createRestaurantOrder,
  generateOrderId,
  getLatestOrderForUser,
};
