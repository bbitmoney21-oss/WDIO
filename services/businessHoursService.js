// Default business hours per tenant type.
// Tenants can override via a `business_hours` field on their record.
const DEFAULT_BUSINESS_HOURS = {
  restaurant: { open_time: '11:00', close_time: '23:00', timezone: 'America/New_York' },
  clinic:     { open_time: '09:00', close_time: '17:00', timezone: 'America/New_York' },
  custom:     { open_time: '09:00', close_time: '23:00', timezone: 'America/New_York' },
};

function getBusinessHours(tenant) {
  if (tenant && tenant.business_hours) return tenant.business_hours;
  const key = (tenant && (tenant.type || tenant.plan)) || 'restaurant';
  return DEFAULT_BUSINESS_HOURS[key] || DEFAULT_BUSINESS_HOURS.restaurant;
}

function formatTime12h(time24) {
  const [h, m] = time24.split(':').map(Number);
  const period = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 || 12;
  return `${h12}:${String(m).padStart(2, '0')} ${period}`;
}

function formatHoursDisplay(hours) {
  return `${formatTime12h(hours.open_time)} – ${formatTime12h(hours.close_time)}`;
}

function tzAbbreviation(timezone) {
  // Best-effort short label; avoids pulling in a tz library
  const map = {
    'America/New_York':    'EST',
    'America/Chicago':     'CST',
    'America/Denver':      'MST',
    'America/Los_Angeles': 'PST',
    'America/Toronto':     'EST',
    'Europe/London':       'GMT',
  };
  return map[timezone] || timezone;
}

function getCurrentTimeInZone(timezone) {
  // Intl.DateTimeFormat is available in Node 12+ without any package
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour:   '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());

  let h = 0, m = 0;
  for (const p of parts) {
    if (p.type === 'hour')   h = parseInt(p.value, 10);
    if (p.type === 'minute') m = parseInt(p.value, 10);
  }
  // Intl can return 24 for midnight
  if (h === 24) h = 0;
  return { h, m, minutes: h * 60 + m };
}

/**
 * Returns a rich status object for the tenant's current open/closed state.
 * @param {object} tenant
 * @returns {{ open: boolean, currentTime: string, openTime: string, closeTime: string,
 *             timezone: string, tzLabel: string, display: string }}
 */
function isWithinBusinessHours(tenant) {
  const hours  = getBusinessHours(tenant);
  const tz     = hours.timezone || 'America/New_York';
  const current = getCurrentTimeInZone(tz);

  const [openH,  openM]  = hours.open_time.split(':').map(Number);
  const [closeH, closeM] = hours.close_time.split(':').map(Number);
  const openMinutes  = openH  * 60 + openM;
  const closeMinutes = closeH * 60 + closeM;

  const open = current.minutes >= openMinutes && current.minutes < closeMinutes;

  return {
    open,
    currentTime: `${String(current.h).padStart(2, '0')}:${String(current.m).padStart(2, '0')}`,
    openTime:  hours.open_time,
    closeTime: hours.close_time,
    timezone:  tz,
    tzLabel:   tzAbbreviation(tz),
    display:   formatHoursDisplay(hours),
  };
}

const SCHEDULING_KEYWORDS = ['tomorrow', 'later', 'next week', 'next time', 'schedule for', 'future'];

/**
 * Returns true if the message signals the user wants to schedule for a future time.
 */
function detectSchedulingIntent(message) {
  const lower = (message || '').toLowerCase();
  return SCHEDULING_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Builds a smart after-hours message tailored to tenant type.
 */
function getAfterHoursResponse(tenant, intent, hoursInfo) {
  const { display, tzLabel } = hoursInfo;
  const isRestaurant = intent === 'restaurant_order' || tenant.type === 'restaurant';
  const isClinic     = intent === 'clinic_booking'   || tenant.type === 'clinic';

  if (isRestaurant) {
    return `We are closed now. Our working hours are ${display} ${tzLabel}. Would you like to schedule your order for tomorrow when we open?`;
  }
  if (isClinic) {
    return `We are closed. Our working hours are ${display} ${tzLabel}. You can book an appointment for the next available slot.`;
  }
  return `We are currently closed. Our working hours are ${display} ${tzLabel}. Please try again later.`;
}

module.exports = {
  getBusinessHours,
  isWithinBusinessHours,
  detectSchedulingIntent,
  getAfterHoursResponse,
  formatHoursDisplay,
  tzAbbreviation,
};
