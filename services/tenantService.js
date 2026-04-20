const crypto = require('crypto');

const PLAN_LIMITS = {
  free: {
    ai_requests_monthly: 50,
    executions_monthly: 20,
    integrationsEnabled: false,
    priority: 'standard',
  },
  pro: {
    ai_requests_monthly: 2000,
    executions_monthly: 1000,
    integrationsEnabled: true,
    priority: 'standard',
  },
  enterprise: {
    ai_requests_monthly: Number.POSITIVE_INFINITY,
    executions_monthly: Number.POSITIVE_INFINITY,
    integrationsEnabled: true,
    priority: 'priority',
  },
};

const tenantStore = new Map([
  [
    'tenant_resto_demo',
    {
      id: 'tenant_resto_demo',
      name: 'Demo Restaurant',
      type: 'restaurant',
      plan: 'free',
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
      plan: 'pro',
      api_key: 'demo-clinic-pro-key',
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
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

function createTenant({ name, type, plan = 'free' }) {
  const tenant = {
    id: `tenant_${crypto.randomUUID()}`,
    name,
    type,
    plan,
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

  tenant.plan = plan;
  return tenant;
}

module.exports = {
  createServiceError,
  createTenant,
  getPlanConfig,
  getTenantById,
  listTenants,
  resolveTenant,
  upgradeTenantPlan,
};
