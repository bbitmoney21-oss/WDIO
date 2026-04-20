async function sendToKitchenPrinter(order) {
  const printJob = {
    order_id: order.order_id,
    items: order.items || [],
    time: order.time || new Date().toISOString(),
    instructions: order.instructions || '',
  };

  return {
    status: 'queued',
    provider: 'mock-kitchen-printer',
    print_job: printJob,
  };
}

module.exports = {
  sendToKitchenPrinter,
};
