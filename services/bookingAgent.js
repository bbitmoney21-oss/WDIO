const {
  buildUnknownResponse,
  classifyIntent,
  createServiceError,
  extractClinicBooking,
  extractRestaurantOrder,
  sanitizeMessage,
} = require('./aiAgent');
const { createClinicAppointment } = require('./appointmentService');
const { createCalendarEvent } = require('./calendarService');
const { sendEmail } = require('./emailService');
const { createRestaurantOrder } = require('./orderService');
const { sendToKitchenPrinter } = require('./printerService');
const {
  assertWithinPlanLimits,
  buildUsageSummary,
  incrementAiUsage,
  incrementExecutionUsage,
} = require('./usageService');
const { getPlanConfig } = require('./tenantService');
const {
  isWithinBusinessHours,
  detectSchedulingIntent,
  getAfterHoursResponse,
} = require('./businessHoursService');
const {
  getTenantKnowledge,
  buildRestaurantSystemPrompt,
  buildClinicSystemPrompt,
  validateAndPriceItems,
  normaliseClinicService,
} = require('./knowledgeService');

// ─── Response builder ────────────────────────────────────────────────────────

function buildResponse({ intent, executionStatus, id = null, response, data = {}, tenant, hoursInfo, statusOverride }) {
  const planConfig = getPlanConfig(tenant.plan);
  const status = statusOverride || (hoursInfo ? (hoursInfo.open ? 'open' : 'closed') : 'open');

  return {
    intent,
    execution_status: executionStatus,
    id,
    response,
    status,
    business_hours: hoursInfo ? hoursInfo.display : null,
    timezone: hoursInfo ? hoursInfo.timezone : null,
    plan: tenant.plan,
    monthly_price: planConfig.monthly_price ?? null,
    data,
  };
}

function getClinicAdminEmail() {
  return process.env.CLINIC_ADMIN_EMAIL || 'clinic-admin@example.com';
}

// ─── Plan enforcement ────────────────────────────────────────────────────────

function assertPlanAllowsIntent(tenant, intent) {
  const planConfig = getPlanConfig(tenant.plan);
  const allowed = planConfig.allowed_intents || [];
  if (intent === 'unknown') return;

  if (!allowed.includes(intent)) {
    const upgradeMsg =
      intent === 'restaurant_order'
        ? 'Restaurant order processing requires the Restaurant plan ($199/mo) or Custom plan (from $499/mo).'
        : 'Appointment booking requires the Clinic plan ($299/mo) or Custom plan (from $499/mo).';
    const error = new Error(`Feature not available in your plan. Upgrade required. ${upgradeMsg}`);
    error.statusCode = 403;
    error.code = 'PLAN_RESTRICTION';
    throw error;
  }
}

// ─── Execution flows ─────────────────────────────────────────────────────────

async function executeRestaurantFlow({ tenant, userId, message, hoursInfo }) {
  // Phase 3: fetch knowledge and build a menu-aware system prompt
  const knowledge   = await getTenantKnowledge(tenant.id, tenant.type).catch(() => null);
  const promptOverride = knowledge ? buildRestaurantSystemPrompt(knowledge) : null;

  const extraction = await extractRestaurantOrder(message, promptOverride);

  // Phase 4: validate extracted items against the menu; calculate totals
  const { validItems, unavailableItems, total, menuConfigured } =
    validateAndPriceItems(extraction.items, knowledge);

  // Phase 6: all items unavailable — return menu-aware "not available" response
  if (menuConfigured && validItems.length === 0 && unavailableItems.length > 0) {
    const menuList = Array.isArray(knowledge.menu)
      ? knowledge.menu.slice(0, 6).map((m) => m.name).join(', ')
      : '';
    const planConfig = getPlanConfig(tenant.plan);
    return {
      intent: 'restaurant_order',
      execution_status: 'item_unavailable',
      id: null,
      status: 'open',
      business_hours: hoursInfo ? hoursInfo.display : null,
      timezone: hoursInfo ? hoursInfo.timezone : null,
      plan: tenant.plan,
      monthly_price: planConfig.monthly_price ?? null,
      response: `Sorry, ${unavailableItems.join(', ')} ${unavailableItems.length === 1 ? 'is' : 'are'} not available. ${menuList ? `We serve: ${menuList}.` : 'Please check our menu.'}`,
      data: { unavailable_items: unavailableItems, tenant_id: tenant.id, usage: buildUsageSummary(tenant) },
    };
  }

  const itemsToOrder = validItems.length > 0 ? validItems : extraction.items;

  const orderResult = await createRestaurantOrder({
    tenant,
    userId,
    items: itemsToOrder,
    rawMessage: message,
  });
  const planConfig = getPlanConfig(tenant.plan);

  let printerResult = { status: 'skipped', provider: 'mock-kitchen-printer' };

  if (planConfig.integrationsEnabled) {
    try {
      printerResult = await sendToKitchenPrinter({
        order_id: orderResult.order_id,
        items: itemsToOrder,
        time: new Date().toISOString(),
        instructions: message,
      });
    } catch (err) {
      console.error('Kitchen printer execution failed:', err.message);
    }
  }

  const usage = incrementExecutionUsage(tenant, 'restaurant_order');

  // Build a rich response that includes pricing when menu is configured
  const unavailableNote = unavailableItems.length > 0
    ? ` (Note: ${unavailableItems.join(', ')} not available and was excluded.)`
    : '';

  const baseResponse = planConfig.integrationsEnabled
    ? 'Order received and sent to kitchen printer'
    : 'Order received. Upgrade your plan to enable kitchen printer execution.';

  return buildResponse({
    intent: 'restaurant_order',
    executionStatus: printerResult.status === 'queued' ? 'completed' : 'partial',
    id: orderResult.order_id,
    response: `${baseResponse}${unavailableNote}`,
    data: {
      order_id: orderResult.order_id,
      details: orderResult.details,
      items: itemsToOrder,
      order_total: total !== null ? total : undefined,
      unavailable_items: unavailableItems.length > 0 ? unavailableItems : undefined,
      printer: printerResult,
      stored: orderResult.stored,
      tenant_id: tenant.id,
      usage: buildUsageSummary(tenant),
      current_usage_snapshot: usage,
    },
    tenant,
    hoursInfo,
    statusOverride: 'open',
  });
}

async function executeClinicFlow({ tenant, userId, message, hoursInfo }) {
  // Phase 3 & 5: fetch knowledge and inject service catalog into prompt
  const knowledge      = await getTenantKnowledge(tenant.id, tenant.type).catch(() => null);
  const promptOverride = knowledge ? buildClinicSystemPrompt(knowledge) : null;

  const extraction = await extractClinicBooking(message, userId, promptOverride);

  // Phase 5: normalise service type against known services
  const normalisedService = normaliseClinicService(extraction.service_type, knowledge);

  const appointmentResult = await createClinicAppointment({
    tenant,
    userId,
    patientName: extraction.patient_name,
    serviceType: normalisedService,
    timePreference: extraction.time_preference,
    rawMessage: message,
  });

  let calendarResult  = { status: 'skipped', provider: 'mock-google-calendar' };
  let patientEmailResult = { status: 'skipped', provider: 'mock-email-service' };
  let adminEmailResult   = { status: 'skipped', provider: 'mock-email-service' };

  const planConfig = getPlanConfig(tenant.plan);

  if (planConfig.integrationsEnabled) {
    try {
      calendarResult = await createCalendarEvent({
        appointment_id: appointmentResult.appointment_id,
        patient_name:   extraction.patient_name,
        service_type:   extraction.service_type,
        time_preference: extraction.time_preference,
        attendees: extraction.patient_email
          ? [{ email: extraction.patient_email }, { email: getClinicAdminEmail() }]
          : [{ email: getClinicAdminEmail() }],
      });
    } catch (err) {
      console.error('Calendar execution failed:', err.message);
    }
  }

  const emailBody = [
    `Appointment ID: ${appointmentResult.appointment_id}`,
    `Service: ${extraction.service_type}`,
    `Preferred time: ${extraction.time_preference}`,
  ].join('\n');

  if (planConfig.integrationsEnabled) {
    try {
      if (extraction.patient_email) {
        patientEmailResult = await sendEmail(
          extraction.patient_email,
          `Appointment confirmation ${appointmentResult.appointment_id}`,
          emailBody,
        );
      }
      adminEmailResult = await sendEmail(
        getClinicAdminEmail(),
        `New clinic booking ${appointmentResult.appointment_id}`,
        emailBody,
      );
    } catch (err) {
      console.error('Email execution failed:', err.message);
    }
  }

  const usage = incrementExecutionUsage(tenant, 'clinic_booking');

  return buildResponse({
    intent: 'clinic_booking',
    executionStatus:
      calendarResult.status === 'created' &&
      (patientEmailResult.status === 'queued' || patientEmailResult.status === 'skipped') &&
      adminEmailResult.status === 'queued'
        ? 'completed'
        : 'partial',
    id: appointmentResult.appointment_id,
    response: planConfig.integrationsEnabled
      ? 'Appointment booked and confirmation sent via email'
      : 'Appointment booked. Upgrade your plan to enable email and calendar confirmations.',
    data: {
      appointment_id: appointmentResult.appointment_id,
      service_type:   normalisedService,
      details: appointmentResult.details,
      calendar: calendarResult,
      email: { patient: patientEmailResult, admin: adminEmailResult },
      stored: appointmentResult.stored,
      tenant_id: tenant.id,
      usage: buildUsageSummary(tenant),
      current_usage_snapshot: usage,
    },
    tenant,
    hoursInfo,
    statusOverride: 'open',
  });
}

// ─── After-hours / scheduling response builders ───────────────────────────────

function buildClosedResponse(tenant, intent, hoursInfo, isScheduled) {
  const planConfig = getPlanConfig(tenant.plan);

  if (isScheduled) {
    const scheduleMsg =
      intent === 'restaurant_order' || tenant.type === 'restaurant'
        ? 'Your order has been noted and will be processed when we open tomorrow.'
        : 'Your appointment request has been noted. We will confirm your slot when we open.';

    return {
      intent: intent || 'unknown',
      execution_status: 'pending',
      id: null,
      status: 'scheduled',
      business_hours: hoursInfo.display,
      timezone: hoursInfo.timezone,
      plan: tenant.plan,
      monthly_price: planConfig.monthly_price ?? null,
      response: scheduleMsg,
      data: { tenant_id: tenant.id, scheduled: true },
    };
  }

  return {
    intent: intent || 'unknown',
    execution_status: 'closed',
    id: null,
    status: 'closed',
    business_hours: hoursInfo.display,
    timezone: hoursInfo.timezone,
    plan: tenant.plan,
    monthly_price: planConfig.monthly_price ?? null,
    response: getAfterHoursResponse(tenant, intent, hoursInfo),
    data: { tenant_id: tenant.id },
  };
}

// ─── Main handler ─────────────────────────────────────────────────────────────

async function handleAgentRequest({ tenant, userId, message, mode = 'auto' }) {
  const normalizedUserId  = typeof userId  === 'string' ? userId.trim()             : '';
  const normalizedMessage = sanitizeMessage(message);
  const normalizedMode    = typeof mode    === 'string' ? mode.trim().toLowerCase() : 'auto';

  if (!normalizedUserId) {
    throw createServiceError('`user_id` is required and must be a non-empty string.', 400);
  }
  if (!normalizedMessage) {
    throw createServiceError('`message` is required and must be a non-empty string.', 400);
  }
  if (!['auto', 'restaurant', 'clinic'].includes(normalizedMode)) {
    throw createServiceError('`mode` must be one of: auto, restaurant, clinic.', 400);
  }

  // ── Business hours check (Phase 2) ──────────────────────────────────────────
  const hoursInfo = isWithinBusinessHours(tenant);

  if (!hoursInfo.open) {
    // Phase 4: detect scheduling intent before hard-blocking
    const wantsToSchedule = detectSchedulingIntent(normalizedMessage);

    // Classify intent even when closed so we can give smart messages
    const intent = await classifyIntent(normalizedMessage, normalizedMode).catch(() => 'unknown');

    return buildClosedResponse(tenant, intent, hoursInfo, wantsToSchedule);
  }

  // ── Normal open-hours flow ───────────────────────────────────────────────────
  assertWithinPlanLimits(tenant);
  incrementAiUsage(tenant);

  const intent = await classifyIntent(normalizedMessage, normalizedMode);

  // Phase 7: enforce plan-based feature access
  assertPlanAllowsIntent(tenant, intent);

  if (intent === 'restaurant_order') {
    return executeRestaurantFlow({ tenant, userId: normalizedUserId, message: normalizedMessage, hoursInfo });
  }

  if (intent === 'clinic_booking') {
    return executeClinicFlow({ tenant, userId: normalizedUserId, message: normalizedMessage, hoursInfo });
  }

  const planConfig = getPlanConfig(tenant.plan);
  return {
    intent: 'unknown',
    execution_status: 'clarification_required',
    id: null,
    status: 'open',
    business_hours: hoursInfo.display,
    timezone: hoursInfo.timezone,
    plan: tenant.plan,
    monthly_price: planConfig.monthly_price ?? null,
    response: buildUnknownResponse(),
    data: { tenant_id: tenant.id, usage: buildUsageSummary(tenant) },
  };
}

module.exports = {
  handleAgentRequest,
};
