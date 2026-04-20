// Tenant knowledge store — restaurant menus + clinic service catalogs.
// Each tenant gets its own knowledge that is injected into AI prompts at runtime.
//
// Resolution order per request:
//   1. In-memory cache (knowledgeCache Map)
//   2. Supabase `tenant_knowledge` table  (when configured)
//   3. Built-in defaults keyed by tenant type

const { getSupabaseClient, hasSupabaseConfig, isMissingRelationError, isSchemaError } = require('./supabaseClient');

// ─── Built-in defaults ────────────────────────────────────────────────────────

const DEFAULT_RESTAURANT_KNOWLEDGE = {
  type: 'restaurant',
  menu: [
    { id: 'burger',          name: 'Classic Burger',         price: 12.99, category: 'mains'  },
    { id: 'chicken-biryani', name: 'Chicken Biryani',        price: 14.99, category: 'mains'  },
    { id: 'margherita',      name: 'Margherita Pizza',       price: 13.99, category: 'mains'  },
    { id: 'pasta',           name: 'Spaghetti Bolognese',    price: 11.99, category: 'mains'  },
    { id: 'noodles',         name: 'Stir-Fry Noodles',      price: 10.99, category: 'mains'  },
    { id: 'fries',           name: 'French Fries',           price:  4.99, category: 'sides'  },
    { id: 'salad',           name: 'Garden Salad',           price:  6.99, category: 'sides'  },
    { id: 'coke',            name: 'Coke',                   price:  2.99, category: 'drinks' },
    { id: 'juice',           name: 'Fresh Orange Juice',     price:  3.99, category: 'drinks' },
    { id: 'coffee',          name: 'Coffee',                 price:  3.49, category: 'drinks' },
    { id: 'water',           name: 'Sparkling Water',        price:  1.99, category: 'drinks' },
  ],
  currency: 'USD',
  rules: ['No substitutions after order is placed', 'Last order 30 minutes before closing'],
};

const DEFAULT_CLINIC_KNOWLEDGE = {
  type: 'clinic',
  services: [
    { id: 'general',       name: 'General Consultation',     duration: 30, price:  80 },
    { id: 'dental',        name: 'Dental Checkup',           duration: 45, price: 120 },
    { id: 'dermatology',   name: 'Dermatology Consultation', duration: 30, price: 150 },
    { id: 'pediatrics',    name: 'Pediatrics Consultation',  duration: 30, price: 100 },
    { id: 'cardiology',    name: 'Cardiology Consultation',  duration: 60, price: 200 },
    { id: 'physiotherapy', name: 'Physiotherapy Session',    duration: 60, price: 110 },
    { id: 'eye-exam',      name: 'Eye Examination',          duration: 30, price:  90 },
  ],
  rules: ['Bring insurance card', 'Arrive 10 minutes early for paperwork'],
};

// ─── Phase 8: In-memory cache ──────────────────────────────────────────────────

const knowledgeCache = new Map();

function getDefaultKnowledge(tenantType) {
  return tenantType === 'clinic'
    ? JSON.parse(JSON.stringify(DEFAULT_CLINIC_KNOWLEDGE))
    : JSON.parse(JSON.stringify(DEFAULT_RESTAURANT_KNOWLEDGE));
}

// ─── Core functions ────────────────────────────────────────────────────────────

/**
 * Fetch full knowledge for a tenant.
 * Falls back through: cache → Supabase → built-in defaults.
 */
async function getTenantKnowledge(tenantId, tenantType = 'restaurant') {
  if (knowledgeCache.has(tenantId)) {
    return knowledgeCache.get(tenantId);
  }

  if (hasSupabaseConfig()) {
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('tenant_knowledge')
        .select('type, data')
        .eq('tenant_id', tenantId)
        .single();

      if (!error && data?.data) {
        const knowledge = typeof data.data === 'string'
          ? JSON.parse(data.data)
          : data.data;
        knowledgeCache.set(tenantId, knowledge);
        return knowledge;
      }
    } catch (err) {
      if (!isMissingRelationError(err) && !isSchemaError(err)) {
        console.warn('[knowledge] Supabase fetch fallback:', err.message);
      }
    }
  }

  const defaults = getDefaultKnowledge(tenantType);
  knowledgeCache.set(tenantId, defaults);
  return defaults;
}

/** Replace the cached knowledge for a tenant (used by admin API). */
function setTenantKnowledge(tenantId, knowledge) {
  knowledgeCache.set(tenantId, knowledge);
}

/** Invalidate cache for one tenant or all tenants. */
function clearKnowledgeCache(tenantId) {
  if (tenantId) {
    knowledgeCache.delete(tenantId);
  } else {
    knowledgeCache.clear();
  }
}

async function getMenuItems(tenantId, tenantType = 'restaurant') {
  const knowledge = await getTenantKnowledge(tenantId, tenantType);
  return Array.isArray(knowledge.menu) ? knowledge.menu : [];
}

async function getClinicServices(tenantId) {
  const knowledge = await getTenantKnowledge(tenantId, 'clinic');
  return Array.isArray(knowledge.services) ? knowledge.services : [];
}

// ─── Phase 3: System prompt builders ─────────────────────────────────────────

/**
 * Build a knowledge-enriched system prompt for restaurant order extraction.
 * Returns null when knowledge has no menu (caller falls back to generic prompt).
 */
function buildRestaurantSystemPrompt(knowledge) {
  const menu = Array.isArray(knowledge?.menu) ? knowledge.menu : [];
  if (menu.length === 0) return null;

  const menuLines = menu
    .map((item) => `- ${item.name} ($${Number(item.price).toFixed(2)})${item.category ? ` [${item.category}]` : ''}`)
    .join('\n');

  const currency = knowledge.currency || 'USD';
  const rulesText = Array.isArray(knowledge.rules) && knowledge.rules.length
    ? `\nRules: ${knowledge.rules.join('. ')}.`
    : '';

  return [
    `You are an AI order-taking assistant for a restaurant. Currency: ${currency}.`,
    `Menu:\n${menuLines}${rulesText}`,
    '',
    'Extract order items from the user message.',
    'Only extract items that appear on the menu above (case-insensitive match).',
    'For each matched item include the exact price from the menu.',
    'If a requested item is NOT on the menu set is_available to false and price to 0.',
    'Return JSON only. Use the schema exactly. Default quantity to 1 if not stated.',
  ].join('\n');
}

/**
 * Build a knowledge-enriched system prompt for clinic booking extraction.
 * Returns null when knowledge has no services.
 */
function buildClinicSystemPrompt(knowledge) {
  const services = Array.isArray(knowledge?.services) ? knowledge.services : [];
  if (services.length === 0) return null;

  const serviceLines = services
    .map((s) => `- ${s.name} (${s.duration} min, $${Number(s.price).toFixed(2)})`)
    .join('\n');

  const rulesText = Array.isArray(knowledge.rules) && knowledge.rules.length
    ? `\nClinic rules: ${knowledge.rules.join('. ')}.`
    : '';

  return [
    'You are an AI booking assistant for a clinic.',
    `Available services:\n${serviceLines}${rulesText}`,
    '',
    'Extract clinic booking details from the user message.',
    "Map the user's request to the closest matching service name from the list above.",
    'Return JSON only with patient_name, service_type, and time_preference.',
    'If something is missing return a helpful fallback value instead of null.',
  ].join('\n');
}

// ─── Phase 4: Order validation and pricing ────────────────────────────────────

/**
 * Validate extracted order items against the menu.
 * Returns { validItems, unavailableItems, total, menuConfigured }.
 */
function validateAndPriceItems(items, knowledge) {
  const menu = Array.isArray(knowledge?.menu) ? knowledge.menu : [];

  if (menu.length === 0) {
    // No menu configured — pass items through untouched
    return { validItems: items, unavailableItems: [], total: null, menuConfigured: false };
  }

  const validItems   = [];
  const unavailableItems = [];

  for (const item of items) {
    // Item already flagged unavailable by AI
    if (item.is_available === false) {
      unavailableItems.push(item.name);
      continue;
    }

    const nameLower = (item.name || '').toLowerCase();
    const matched = menu.find((m) =>
      m.name.toLowerCase() === nameLower ||
      m.name.toLowerCase().includes(nameLower) ||
      nameLower.includes(m.name.toLowerCase()) ||
      (m.id && m.id.toLowerCase() === nameLower),
    );

    if (matched) {
      validItems.push({
        name:       matched.name,
        quantity:   item.quantity,
        price:      matched.price,
        category:   matched.category || null,
        line_total: Number((matched.price * item.quantity).toFixed(2)),
      });
    } else {
      // AI returned an item that has no match — could be a menu item not in defaults
      // Keep it with whatever price AI provided (may be 0); flag it
      if (item.price && item.price > 0) {
        validItems.push({
          name:       item.name,
          quantity:   item.quantity,
          price:      item.price,
          category:   null,
          line_total: Number((item.price * item.quantity).toFixed(2)),
        });
      } else {
        unavailableItems.push(item.name);
      }
    }
  }

  const total = validItems.reduce((sum, i) => sum + i.line_total, 0);

  return {
    validItems,
    unavailableItems,
    total:           Number(total.toFixed(2)),
    menuConfigured:  true,
  };
}

// ─── Phase 5: Clinic service validation ──────────────────────────────────────

/**
 * Try to match the extracted service_type against the knowledge services list.
 * Returns the normalised service name, or the original if no match.
 */
function normaliseClinicService(serviceType, knowledge) {
  const services = Array.isArray(knowledge?.services) ? knowledge.services : [];
  if (services.length === 0) return serviceType;

  const lower = (serviceType || '').toLowerCase();
  const matched = services.find((s) =>
    s.name.toLowerCase().includes(lower) ||
    lower.includes(s.name.toLowerCase()) ||
    (s.id && s.id.toLowerCase() === lower),
  );

  return matched ? matched.name : serviceType;
}

module.exports = {
  buildClinicSystemPrompt,
  buildRestaurantSystemPrompt,
  clearKnowledgeCache,
  getClinicServices,
  getMenuItems,
  getTenantKnowledge,
  normaliseClinicService,
  setTenantKnowledge,
  validateAndPriceItems,
};
