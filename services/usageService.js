const { getPlanConfig } = require('./tenantService');

const usageStore = new Map();
const activityStore = new Map();

function currentMonthKey() {
  return new Date().toISOString().slice(0, 7);
}

function getUsageRecord(tenantId) {
  const key = `${tenantId}:${currentMonthKey()}`;

  if (!usageStore.has(key)) {
    usageStore.set(key, {
      tenant_id: tenantId,
      month: currentMonthKey(),
      total_orders: 0,
      total_bookings: 0,
      ai_requests_count: 0,
      monthly_usage: 0,
      current_usage: 0,
      overage_flag: false,
    });
  }

  return usageStore.get(key);
}

function recordActivity(tenantId, type, metadata = {}) {
  if (!activityStore.has(tenantId)) {
    activityStore.set(tenantId, []);
  }

  activityStore.get(tenantId).push({
    type,
    timestamp: new Date().toISOString(),
    metadata,
  });
}

function assertWithinPlanLimits(tenant) {
  const usage = getUsageRecord(tenant.id);
  const planConfig = getPlanConfig(tenant.plan);
  const totalExecutions = usage.total_orders + usage.total_bookings;

  if (usage.ai_requests_count >= planConfig.ai_requests_monthly) {
    usage.overage_flag = true;
    const error = new Error('Usage limit exceeded. Upgrade plan.');
    error.statusCode = 429;
    throw error;
  }

  if (totalExecutions >= planConfig.executions_monthly) {
    usage.overage_flag = true;
    const error = new Error('Usage limit exceeded. Upgrade plan.');
    error.statusCode = 429;
    throw error;
  }
}

function incrementAiUsage(tenant) {
  const usage = getUsageRecord(tenant.id);
  usage.ai_requests_count += 1;
  usage.monthly_usage += 1;
  usage.current_usage = usage.ai_requests_count + usage.total_orders + usage.total_bookings;
  recordActivity(tenant.id, 'ai_request');
  return usage;
}

function incrementExecutionUsage(tenant, intent) {
  const usage = getUsageRecord(tenant.id);

  if (intent === 'restaurant_order') {
    usage.total_orders += 1;
  }

  if (intent === 'clinic_booking') {
    usage.total_bookings += 1;
  }

  usage.monthly_usage += 1;
  usage.current_usage = usage.ai_requests_count + usage.total_orders + usage.total_bookings;
  recordActivity(tenant.id, intent);
  return usage;
}

function buildUsageSummary(tenant) {
  const usage = getUsageRecord(tenant.id);
  const planConfig = getPlanConfig(tenant.plan);
  const totalExecutions = usage.total_orders + usage.total_bookings;
  const aiRemaining = Number.isFinite(planConfig.ai_requests_monthly)
    ? Math.max(planConfig.ai_requests_monthly - usage.ai_requests_count, 0)
    : null;
  const executionRemaining = Number.isFinite(planConfig.executions_monthly)
    ? Math.max(planConfig.executions_monthly - totalExecutions, 0)
    : null;

  const warning =
    (aiRemaining !== null && aiRemaining <= 5) || (executionRemaining !== null && executionRemaining <= 5)
      ? 'You are near your plan limit.'
      : null;

  return {
    plan: tenant.plan,
    usage_limit: {
      ai_requests_monthly: Number.isFinite(planConfig.ai_requests_monthly)
        ? planConfig.ai_requests_monthly
        : 'unlimited',
      executions_monthly: Number.isFinite(planConfig.executions_monthly)
        ? planConfig.executions_monthly
        : 'unlimited',
    },
    current_usage: {
      ai_requests_count: usage.ai_requests_count,
      total_orders: usage.total_orders,
      total_bookings: usage.total_bookings,
      monthly_usage: usage.monthly_usage,
    },
    overage_flag: usage.overage_flag,
    warning,
  };
}

function getAnalyticsForTenant(tenantId) {
  const events = activityStore.get(tenantId) || [];
  const ordersPerDay = {};
  const bookingsPerDay = {};
  const hourCounts = {};

  for (const event of events) {
    const day = event.timestamp.slice(0, 10);
    const hour = event.timestamp.slice(11, 13);
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;

    if (event.type === 'restaurant_order') {
      ordersPerDay[day] = (ordersPerDay[day] || 0) + 1;
    }

    if (event.type === 'clinic_booking') {
      bookingsPerDay[day] = (bookingsPerDay[day] || 0) + 1;
    }
  }

  const peakUsageTimes = Object.entries(hourCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([hour, count]) => ({ hour, count }));

  return {
    orders_per_day: ordersPerDay,
    bookings_per_day: bookingsPerDay,
    peak_usage_times: peakUsageTimes,
  };
}

function getRecentActivity(tenantId, limit = 10) {
  const events = activityStore.get(tenantId) || [];
  return events.slice(-limit).reverse();
}

module.exports = {
  assertWithinPlanLimits,
  buildUsageSummary,
  getAnalyticsForTenant,
  getRecentActivity,
  incrementAiUsage,
  incrementExecutionUsage,
};
