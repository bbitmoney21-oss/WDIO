const { getSupabaseClient, hasSupabaseConfig, isMissingRelationError, isSchemaError } = require('./supabaseClient');

const DEFAULT_PRICING = [
  {
    slug: 'restaurant',
    name: 'Restaurant Plan',
    price_label: '$199/mo',
    monthly_price: 199,
    description: 'AI order taking, kitchen print integration, and basic messaging for restaurants.',
    features: ['AI order taking', 'Kitchen print integration', 'Basic messaging'],
    sort_order: 1,
  },
  {
    slug: 'clinic',
    name: 'Clinic Plan',
    price_label: '$299/mo',
    monthly_price: 299,
    description: 'Appointment booking, calendar integration, and email confirmation for clinics.',
    features: ['Appointment booking', 'Calendar integration', 'Email confirmation'],
    sort_order: 2,
  },
  {
    slug: 'custom',
    name: 'Custom Plan',
    price_label: 'From $499/mo',
    monthly_price: 499,
    description: 'Multi-location, advanced workflows, and integrations beyond default features.',
    features: ['Multi-location support', 'Advanced workflows', 'Custom integrations', 'All restaurant + clinic features'],
    sort_order: 3,
  },
];

let pricingCache = DEFAULT_PRICING.map((tier) => ({ ...tier }));

function getDefaultPricing() {
  return pricingCache.map((tier) => ({ ...tier }));
}

async function getPricing() {
  if (!hasSupabaseConfig()) {
    return getDefaultPricing();
  }

  const supabase = getSupabaseClient();

  try {
    const { data, error } = await supabase
      .from('pricing_config')
      .select('slug, name, price_label, description, sort_order')
      .order('sort_order', { ascending: true });

    if (error) {
      if (isMissingRelationError(error) || isSchemaError(error)) {
        return getDefaultPricing();
      }

      throw error;
    }

    if (!Array.isArray(data) || data.length === 0) {
      return getDefaultPricing();
    }

    pricingCache = data.map((tier) => ({
      slug: tier.slug,
      name: tier.name,
      price_label: tier.price_label,
      monthly_price: tier.monthly_price ?? null,
      description: tier.description,
      features: tier.features ?? [],
      sort_order: tier.sort_order,
    }));

    return getDefaultPricing();
  } catch (error) {
    console.error('Pricing fetch fallback triggered:', error.message);
    return getDefaultPricing();
  }
}

async function updatePricing(nextPricing) {
  pricingCache = nextPricing
    .map((tier, index) => ({
      slug: tier.slug,
      name: tier.name,
      price_label: tier.price_label,
      monthly_price: tier.monthly_price ?? null,
      description: tier.description,
      features: tier.features ?? [],
      sort_order: Number.isFinite(tier.sort_order) ? tier.sort_order : index + 1,
    }))
    .sort((a, b) => a.sort_order - b.sort_order);

  if (!hasSupabaseConfig()) {
    return getDefaultPricing();
  }

  const supabase = getSupabaseClient();

  try {
    const { error } = await supabase.from('pricing_config').upsert(pricingCache, {
      onConflict: 'slug',
    });

    if (error) {
      if (isMissingRelationError(error) || isSchemaError(error)) {
        return getDefaultPricing();
      }

      throw error;
    }
  } catch (error) {
    console.error('Pricing update fallback triggered:', error.message);
  }

  return getDefaultPricing();
}

function validatePricingPayload(pricing) {
  if (!Array.isArray(pricing) || pricing.length === 0) {
    const error = new Error('`pricing` must be a non-empty array.');
    error.statusCode = 400;
    throw error;
  }

  pricing.forEach((tier, index) => {
    if (!tier || typeof tier !== 'object') {
      const error = new Error(`pricing[${index}] must be an object.`);
      error.statusCode = 400;
      throw error;
    }

    ['slug', 'name', 'price_label', 'description'].forEach((field) => {
      if (!String(tier[field] || '').trim()) {
        const error = new Error(`pricing[${index}].${field} is required.`);
        error.statusCode = 400;
        throw error;
      }
    });
  });
}

module.exports = {
  getPricing,
  updatePricing,
  validatePricingPayload,
};
