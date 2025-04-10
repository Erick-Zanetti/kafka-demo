import { Kafka, Producer } from 'kafkajs';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';

// Set up Kafka
const kafka = new Kafka({
  clientId: 'order-service',
  brokers: [process.env.KAFKA_BROKER || 'localhost:9092']
});

// Create a producer with idempotence enabled
const producer: Producer = kafka.producer({
  idempotent: true,
});

// Initialize Express app
const app = express();
app.use(express.json());

// Connect to Kafka
async function initialize(): Promise<void> {
  await producer.connect();
  console.log('Connected to Kafka');
}

interface Order {
  orderId: string;
  customerId: string;
  items: Array<{
    productId: string;
    quantity: number;
    price: number;
  }>;
  totalAmount: number;
  status: 'created' | 'paid' | 'shipped' | 'delivered';
  timestamp: number;
}

// API endpoint to create an order
app.post('/orders', async (req, res) => {
  try {
    const orderId = uuidv4();
    const { customerId, items } = req.body;
    
    // Calculate total amount
    const totalAmount = items.reduce(
      (total, item) => total + (item.price * item.quantity), 
      0
    );
    
    // Create order object
    const order: Order = {
      orderId,
      customerId,
      items,
      totalAmount,
      status: 'created',
      timestamp: Date.now(),
    };
    
    // Send to Kafka
    await producer.send({
      topic: 'orders',
      messages: [
        { 
          key: customerId, // Using customerId as key ensures order for the same customer
          value: JSON.stringify(order),
          headers: {
            'event-type': 'order-created'
          }
        }
      ],
    });
    
    res.status(201).json({ 
      success: true, 
      orderId,
      message: 'Order created successfully' 
    });
  } catch (error) {
    console.error('Failed to create order:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to create order' 
    });
  }
});

// Start the server
const PORT = 3000;
app.listen(PORT, async () => {
  await initialize();
  console.log(`Order service running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down...');
  await producer.disconnect();
  process.exit(0);
});