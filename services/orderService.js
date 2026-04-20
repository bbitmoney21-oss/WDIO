const { supabase } = require('./supabaseClient');

async function getLatestOrderForUser(userId) {
  const { data, error } = await supabase
    .from('orders')
    .select('id, user_id, status, items, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    const serviceError = new Error(`Failed to fetch order data: ${error.message}`);
    serviceError.statusCode = 500;
    throw serviceError;
  }

  return data || null;
}

module.exports = {
  getLatestOrderForUser,
};
