import { Kafka, Consumer, Producer } from 'kafkajs';
import { createClient } from 'redis';

// Set up Kafka
const kafka = new Kafka({
  clientId: 'payment-service',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092'],
});

// Create consumer and producer
const consumer: Consumer = kafka.consumer({ 
  groupId: 'payment-service-group' 
});

const producer: Producer = kafka.producer({
  idempotent: true,
});

// Redis for idempotence
const redis = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

async function initialize(): Promise<void> {
  await redis.connect();
  await consumer.connect();
  await producer.connect();
  
  // Subscribe to orders topic
  await consumer.subscribe({ topic: 'orders' });
  
  // Process messages
  await consumer.run({
    eachMessage: async ({ topic, partition, message }) => {
      // Parse message
      const order = JSON.parse(message.value?.toString() || '{}');
      const eventType = message.headers?.['event-type']?.toString();
      
      // Only process new orders
      if (eventType !== 'order-created') {
        return;
      }
      
      // Check for duplicate processing
      const processingKey = `payment:${order.orderId}`;
      const alreadyProcessed = await redis.exists(processingKey);
      
      if (alreadyProcessed) {
        console.log(`Payment for order ${order.orderId} already processed`);
        return;
      }
      
      try {
        console.log(`Processing payment for order ${order.orderId}`);
        
        // Simulate payment processing
        const paymentSuccess = Math.random() > 0.2; // 80% success rate
        
        if (paymentSuccess) {
          // Mark order as paid
          const updatedOrder = {
            ...order,
            status: 'paid',
            paymentTimestamp: Date.now(),
          };
          
          // Send updated order status
          await producer.send({
            topic: 'orders',
            messages: [
              {
                key: order.customerId,
                value: JSON.stringify(updatedOrder),
                headers: {
                  'event-type': 'order-paid'
                }
              }
            ],
          });
          
          console.log(`Payment successful for order ${order.orderId}`);
        } else {
          // Send payment failure event
          await producer.send({
            topic: 'orders',
            messages: [
              {
                key: order.customerId,
                value: JSON.stringify({
                  ...order,
                  paymentError: 'Payment processing failed'
                }),
                headers: {
                  'event-type': 'payment-failed'
                }
              }
            ],
          });
          
          console.log(`Payment failed for order ${order.orderId}`);
        }
        
        // Mark as processed to prevent duplicate processing
        await redis.set(processingKey, '1', { EX: 86400 }); // 24-hour TTL
      } catch (error) {
        console.error(`Error processing payment for order ${order.orderId}:`, error);
      }
    },
  });
}

// Start the service
initialize()
  .then(() => console.log('Payment service started'))
  .catch(error => console.error('Failed to start payment service:', error));

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await consumer.disconnect();
  await producer.disconnect();
  await redis.disconnect();
  process.exit(0);
});