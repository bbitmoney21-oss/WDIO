require('dotenv').config();

const express = require('express');
const supportRouter = require('./routes/support');

const app = express();
const port = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/support', supportRouter);

app.use((err, _req, res, _next) => {
  const statusCode = err.statusCode || 500;

  if (statusCode >= 500) {
    console.error(err);
  }

  res.status(statusCode).json({
    error: err.message || 'Internal server error',
  });
});

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Customer Support AI API listening on port ${port}`);
  });
}

module.exports = app;
