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

function buildResponse({ intent, executionStatus, id = null, response, data = {} }) {
  return {
    intent,
    execution_status: executionStatus,
    id,
    response,
    data,
  };
}

function getClinicAdminEmail() {
  return process.env.CLINIC_ADMIN_EMAIL || 'clinic-admin@example.com';
}

async function executeRestaurantFlow({ tenant, userId, message }) {
  const extraction = await extractRestaurantOrder(message);
  const orderResult = await createRestaurantOrder({
    tenant,
    userId,
    items: extraction.items,
    rawMessage: message,
  });
  const planConfig = getPlanConfig(tenant.plan);

  let printerResult = {
    status: 'skipped',
    provider: 'mock-kitchen-printer',
  };

  if (planConfig.integrationsEnabled) {
    try {
      printerResult = await sendToKitchenPrinter({
        order_id: orderResult.order_id,
        items: extraction.items,
        time: new Date().toISOString(),
        instructions: message,
      });
    } catch (error) {
      console.error('Kitchen printer execution failed:', error.message);
    }
  }

  const usage = incrementExecutionUsage(tenant, 'restaurant_order');

  return buildResponse({
    intent: 'restaurant_order',
    executionStatus: printerResult.status === 'queued' ? 'completed' : 'partial',
    id: orderResult.order_id,
    response: planConfig.integrationsEnabled
      ? 'Order received and sent to kitchen printer'
      : 'Order received. Upgrade your plan to enable kitchen printer execution.',
    data: {
      order_id: orderResult.order_id,
      details: orderResult.details,
      printer: printerResult,
      stored: orderResult.stored,
      tenant_id: tenant.id,
      usage: buildUsageSummary(tenant),
      current_usage_snapshot: usage,
    },
  });
}

async function executeClinicFlow({ tenant, userId, message }) {
  const extraction = await extractClinicBooking(message, userId);
  const appointmentResult = await createClinicAppointment({
    tenant,
    userId,
    patientName: extraction.patient_name,
    serviceType: extraction.service_type,
    timePreference: extraction.time_preference,
    rawMessage: message,
  });

  let calendarResult = {
    status: 'skipped',
    provider: 'mock-google-calendar',
  };
  let patientEmailResult = {
    status: 'skipped',
    provider: 'mock-email-service',
  };
  let adminEmailResult = {
    status: 'skipped',
    provider: 'mock-email-service',
  };
  const planConfig = getPlanConfig(tenant.plan);

  if (planConfig.integrationsEnabled) {
    try {
      calendarResult = await createCalendarEvent({
        appointment_id: appointmentResult.appointment_id,
        patient_name: extraction.patient_name,
        service_type: extraction.service_type,
        time_preference: extraction.time_preference,
        attendees: extraction.patient_email
          ? [{ email: extraction.patient_email }, { email: getClinicAdminEmail() }]
          : [{ email: getClinicAdminEmail() }],
      });
    } catch (error) {
      console.error('Calendar execution failed:', error.message);
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
    } catch (error) {
      console.error('Email execution failed:', error.message);
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
      details: appointmentResult.details,
      calendar: calendarResult,
      email: {
        patient: patientEmailResult,
        admin: adminEmailResult,
      },
      stored: appointmentResult.stored,
      tenant_id: tenant.id,
      usage: buildUsageSummary(tenant),
      current_usage_snapshot: usage,
    },
  });
}

async function handleAgentRequest({ tenant, userId, message, mode = 'auto' }) {
  const normalizedUserId = typeof userId === 'string' ? userId.trim() : '';
  const normalizedMessage = sanitizeMessage(message);
  const normalizedMode = typeof mode === 'string' ? mode.trim().toLowerCase() : 'auto';

  if (!normalizedUserId) {
    throw createServiceError('`user_id` is required and must be a non-empty string.', 400);
  }

  if (!normalizedMessage) {
    throw createServiceError('`message` is required and must be a non-empty string.', 400);
  }

  if (!['auto', 'restaurant', 'clinic'].includes(normalizedMode)) {
    throw createServiceError('`mode` must be one of: auto, restaurant, clinic.', 400);
  }

  assertWithinPlanLimits(tenant);
  incrementAiUsage(tenant);

  const intent = await classifyIntent(normalizedMessage, normalizedMode);

  if (intent === 'restaurant_order') {
    return executeRestaurantFlow({
      tenant,
      userId: normalizedUserId,
      message: normalizedMessage,
    });
  }

  if (intent === 'clinic_booking') {
    return executeClinicFlow({
      tenant,
      userId: normalizedUserId,
      message: normalizedMessage,
    });
  }

  return buildResponse({
    intent: 'unknown',
    executionStatus: 'clarification_required',
    id: null,
    response: buildUnknownResponse(),
    data: {
      tenant_id: tenant.id,
      usage: buildUsageSummary(tenant),
    },
  });
}

module.exports = {
  handleAgentRequest,
};
