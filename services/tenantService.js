const crypto = require('crypto');
const { getBusinessHours } = require('./businessHoursService');

const PLAN_LIMITS = {
  // --- Primary plans ---
  restaurant: {
    monthly_price: 199,
    ai_requests_monthly: 5000,
    executions_monthly: 2000,
    integrationsEnabled: true,
    priority: 'standard',
    allowed_intents: ['restaurant_order'],
  },
  clinic: {
    monthly_price: 299,
    ai_requests_monthly: 5000,
    executions_monthly: 2000,
    integrationsEnabled: true,
    priority: 'standard',
    allowed_intents: ['clinic_booking'],
  },
  custom: {
    monthly_price: 499,
    ai_requests_monthly: Number.POSITIVE_INFINITY,
    executions_monthly: Number.POSITIVE_INFINITY,
    integrationsEnabled: true,
    priority: 'priority',
    allowed_intents: ['restaurant_order', 'clinic_booking'],
  },
  // --- Legacy aliases (kept for backward compatibility) ---
  free: {
    monthly_price: 0,
    ai_requests_monthly: 50,
    executions_monthly: 20,
    integrationsEnabled: false,
    priority: 'standard',
    allowed_intents: ['restaurant_order', 'clinic_booking'],
  },
  pro: {
    monthly_price: 299,
    ai_requests_monthly: 2000,
    executions_monthly: 1000,
    integrationsEnabled: true,
    priority: 'standard',
    allowed_intents: ['restaurant_order', 'clinic_booking'],
  },
  enterprise: {
    monthly_price: 499,
    ai_requests_monthly: Number.POSITIVE_INFINITY,
    executions_monthly: Number.POSITIVE_INFINITY,
    integrationsEnabled: true,
    priority: 'priority',
    allowed_intents: ['restaurant_order', 'clinic_booking'],
  },
};

const tenantStore = new Map([
  [
    'tenant_resto_demo',
    {
      id: 'tenant_resto_demo',
      name: 'Demo Restaurant',
      type: 'restaurant',
      plan: 'restaurant',
      price: 199,
      usage_limit: { ai_requests_monthly: 5000, executions_monthly: 2000 },
      // business_hours can be overridden here; null means use default for type
      business_hours: null,
      api_key: 'demo-resto-free-key',
      created_at: new Date().toISOString(),
    },
  ],
  [
    'tenant_clinic_demo',
    {
      id: 'tenant_clinic_demo',
      name: 'Demo Clinic',
      type: 'clinic',
      plan: 'clinic',
      price: 299,
      usage_limit: { ai_requests_monthly: 5000, executions_monthly: 2000 },
      business_hours: null,
      api_key: 'demo-clinic-pro-key',
      created_at: new Date().toISOString(),
    },
  ],
  [
    'tenant_bhagibhavan',
    {
      id: 'tenant_bhagibhavan',
      name: 'Bhagibhavan',
      type: 'restaurant',
      plan: 'restaurant',
      price: 199,
      usage_limit: { ai_requests_monthly: 5000, executions_monthly: 2000 },
      business_hours: null,
      api_key: 'bhagibhavan-api-key',
      created_at: new Date().toISOString(),
    },
  ],
]);

function createServiceError(message, statusCode = 500) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function getPlanConfig(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.restaurant;
}

function defaultPlanForType(type) {
  if (type === 'clinic') return 'clinic';
  return 'restaurant';
}

function createTenant({ name, type, plan, business_hours }) {
  const resolvedPlan = plan || defaultPlanForType(type);
  const planConfig = getPlanConfig(resolvedPlan);

  // Build a minimal tenant stub so getBusinessHours can derive the default
  const stub = { type, plan: resolvedPlan, business_hours: business_hours || null };
  const resolvedHours = business_hours || null; // store null → service derives from type

  const tenant = {
    id: `tenant_${crypto.randomUUID()}`,
    name,
    type,
    plan: resolvedPlan,
    price: planConfig.monthly_price,
    usage_limit: {
      ai_requests_monthly: Number.isFinite(planConfig.ai_requests_monthly)
        ? planConfig.ai_requests_monthly
        : 'unlimited',
      executions_monthly: Number.isFinite(planConfig.executions_monthly)
        ? planConfig.executions_monthly
        : 'unlimited',
    },
    business_hours: resolvedHours,
    api_key: `tenant_${crypto.randomUUID().replace(/-/g, '')}`,
    created_at: new Date().toISOString(),
  };

  tenantStore.set(tenant.id, tenant);
  return tenant;
}

function getTenantById(tenantId) {
  return tenantStore.get(tenantId) || null;
}

function getTenantByApiKey(apiKey) {
  for (const tenant of tenantStore.values()) {
    if (tenant.api_key === apiKey) {
      return tenant;
    }
  }

  return null;
}

function resolveTenant({ apiKey, tenantId }) {
  const tenant = apiKey ? getTenantByApiKey(apiKey) : getTenantById(tenantId);

  if (!tenant) {
    throw createServiceError('Unauthorized tenant', 401);
  }

  if (tenantId && tenant.id !== tenantId) {
    throw createServiceError('Unauthorized tenant', 401);
  }

  return tenant;
}

function listTenants() {
  return Array.from(tenantStore.values());
}

function upgradeTenantPlan(tenantId, plan) {
  const tenant = getTenantById(tenantId);

  if (!tenant) {
    throw createServiceError('Tenant not found', 404);
  }

  const planConfig = getPlanConfig(plan);
  tenant.plan = plan;
  tenant.price = planConfig.monthly_price;
  tenant.usage_limit = {
    ai_requests_monthly: Number.isFinite(planConfig.ai_requests_monthly)
      ? planConfig.ai_requests_monthly
      : 'unlimited',
    executions_monthly: Number.isFinite(planConfig.executions_monthly)
      ? planConfig.executions_monthly
      : 'unlimited',
  };

  return tenant;
}

module.exports = {
  createServiceError,
  createTenant,
  defaultPlanForType,
  getPlanConfig,
  getTenantById,
  getTenantByApiKey,
  listTenants,
  resolveTenant,
  upgradeTenantPlan,
  getBusinessHours,
};
