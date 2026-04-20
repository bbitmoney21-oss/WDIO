const crypto = require('crypto');
const { getSupabaseClient, hasSupabaseConfig, isMissingRelationError, isSchemaError } = require('./supabaseClient');

function generateAppointmentId() {
  const dateSegment = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = crypto.randomInt(0, 10000).toString().padStart(4, '0');
  return `CLINIC-${dateSegment}-${suffix}`;
}

async function tryInsertAppointment(supabase, payload) {
  const { data, error } = await supabase.from('appointments').insert(payload).select().maybeSingle();

  if (error) {
    throw error;
  }

  return data || payload;
}

async function createClinicAppointment({ tenant, userId, patientName, serviceType, timePreference, rawMessage }) {
  const appointmentId = generateAppointmentId();
  const timestamp = new Date().toISOString();
  const fallbackResult = {
    appointment_id: appointmentId,
    stored: false,
    details: {
      tenant_id: tenant.id,
      user_id: userId,
      patient_name: patientName,
      service_type: serviceType,
      time_preference: timePreference,
      status: 'draft',
      message: rawMessage,
    },
  };

  if (!hasSupabaseConfig()) {
    return fallbackResult;
  }

  const supabase = getSupabaseClient();
  const payloadVariants = [
    {
      id: appointmentId,
      tenant_id: tenant.id,
      user_id: userId,
      patient_name: patientName,
      service_type: serviceType,
      time_preference: timePreference,
      status: 'pending',
      updated_at: timestamp,
    },
    {
      id: appointmentId,
      tenant_id: tenant.id,
      patient_name: patientName,
      service_type: serviceType,
      time_preference: timePreference,
      status: 'pending',
      created_at: timestamp,
    },
    {
      id: appointmentId,
      tenant_id: tenant.id,
      patient_name: patientName,
      status: 'pending',
      created_at: timestamp,
    },
  ];

  for (const payload of payloadVariants) {
    try {
      const insertedAppointment = await tryInsertAppointment(supabase, payload);

      return {
        appointment_id: appointmentId,
        stored: true,
        details: insertedAppointment,
      };
    } catch (error) {
      if (isMissingRelationError(error)) {
        return fallbackResult;
      }

      if (!isSchemaError(error)) {
        console.error('Appointment insert failed:', error.message);
        return fallbackResult;
      }
    }
  }

  return fallbackResult;
}

module.exports = {
  createClinicAppointment,
  generateAppointmentId,
};
