async function sendEmail(to, subject, body) {
  return {
    status: 'queued',
    provider: 'mock-email-service',
    to,
    subject,
    body,
  };
}

module.exports = {
  sendEmail,
};
