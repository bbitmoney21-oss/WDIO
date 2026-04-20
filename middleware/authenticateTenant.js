const { resolveTenant } = require('../services/tenantService');

function authenticateTenant(req, res, next) {
  try {
    const apiKey = req.headers['x-api-key'] || req.query?.api_key;
    const tenantId = req.body?.tenant_id || req.params?.tenant_id || req.query?.tenant_id;

    req.tenant = resolveTenant({
      apiKey,
      tenantId,
    });

    return next();
  } catch (_error) {
    return res.status(401).json({
      error: 'Unauthorized tenant',
    });
  }
}

module.exports = {
  authenticateTenant,
};
