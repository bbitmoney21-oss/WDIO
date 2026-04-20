require('dotenv').config();

const express = require('express');
const analyticsRouter = require('./routes/analytics');
const adminRouter = require('./routes/admin');
const agentRouter = require('./routes/agent');
const billingRouter = require('./routes/billing');
const dashboardRouter = require('./routes/dashboard');
const onboardingRouter = require('./routes/onboarding');
const publicRouter = require('./routes/public');
const webRouter = require('./routes/web');
const { authenticateTenant } = require('./middleware/authenticateTenant');
const supportRouter = require('./routes/support');
const leadRouter = require('./routes/lead');
const { hasOpenAiConfig } = require('./services/aiAgent');
const { hasSupabaseConfig } = require('./services/supabaseClient');

const app = express();
const port = process.env.PORT || 3000;
const startedAt = Date.now();

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', process.env.CORS_ORIGIN || '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  return next();
});

app.use(express.json());

app.use('/', webRouter);

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'universal-booking-ai-agent',
    uptime: Math.floor((Date.now() - startedAt) / 1000),
  });
});

app.use('/api/agent', authenticateTenant, agentRouter);
app.use('/api/admin', adminRouter);
app.use('/api/billing', authenticateTenant, billingRouter);
app.use('/api/analytics', authenticateTenant, analyticsRouter);
app.use('/api/onboarding', onboardingRouter);
app.use('/api/public', publicRouter);
app.use('/dashboard', authenticateTenant, dashboardRouter);
app.use('/onboarding', onboardingRouter);
app.use('/api/support', supportRouter);
app.use('/api/lead', leadRouter);

app.use((err, _req, res, _next) => {
  const statusCode = err.statusCode || 500;

  if (statusCode >= 500) {
    console.error(err);
  }

  if (_req.path === '/api/agent/handle') {
    return res.status(statusCode).json({
      intent: 'unknown',
      response:
        statusCode === 503
          ? 'The booking service is still being configured. Please try again shortly.'
          : 'I ran into an issue while handling that booking request. Please try again in a moment.',
      data: {},
    });
  }

  if (_req.path === '/api/support/message') {
    return res.status(statusCode).json({
      intent: 'unknown',
      response:
        statusCode === 503
          ? 'The support service is still being configured. Please try again shortly.'
          : 'I ran into an issue while processing that request. Please try again in a moment.',
      order_data: null,
    });
  }

  res.status(statusCode).json({
    error: err.message || 'Internal server error',
  });
});

if (require.main === module) {
  if (!hasOpenAiConfig()) {
    console.error('Warning: OPENAI_API_KEY is not configured. The agent will use rule-based intent detection and extraction.');
  }

  if (!hasSupabaseConfig()) {
    console.error('Warning: Supabase is not fully configured. Requests will be captured in fallback draft mode instead of persistent storage.');
  }

  app.listen(port, () => {
    console.log(`Universal Booking AI Agent listening on port ${port}`);
  });
}

module.exports = app;
