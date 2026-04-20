async function createCalendarEvent(appointment) {
  return {
    status: 'created',
    provider: 'mock-google-calendar',
    event: {
      summary: `${appointment.service_type} appointment`,
      description: `Appointment ${appointment.appointment_id} for ${appointment.patient_name}`,
      start: {
        dateTime: appointment.time_preference,
      },
      end: {
        dateTime: appointment.time_preference,
      },
      attendees: appointment.attendees || [],
    },
  };
}

module.exports = {
  createCalendarEvent,
};
