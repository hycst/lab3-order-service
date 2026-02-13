// index.js
const express = require("express");
const amqp = require("amqplib");     // NOTE: uses promise-based amqplib
const cors = require("cors");

const app = express();
app.use(cors());
app.use(express.json());

// ===== Azure/App settings =====
const PORT = process.env.PORT || 3000;

// IMPORTANT: In Azure Web App, set this in Configuration > Application settings
// Example: amqp://newuser:newpassword@20.163.62.61:5672/
const RABBITMQ_URL = process.env.RABBITMQ_URL;

// Queue name can also be env-based
const QUEUE_NAME = process.env.QUEUE_NAME || "order_queue";

// ===== RabbitMQ connection reuse (don’t reconnect per request) =====
let connection = null;
let channel = null;

async function getChannel() {
  if (channel) return channel;

  if (!RABBITMQ_URL) {
    throw new Error("RABBITMQ_URL is not set (Azure: Configuration > Application settings).");
  }

  connection = await amqp.connect(RABBITMQ_URL);
  channel = await connection.createChannel();
  await channel.assertQueue(QUEUE_NAME, { durable: false });

  connection.on("error", () => {
    channel = null;
    connection = null;
  });

  connection.on("close", () => {
    channel = null;
    connection = null;
  });

  return channel;
}

// ===== Routes =====
app.get("/", (req, res) => res.status(200).send("OK"));
app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));

// Basic debug page (safe-ish: masks password)
app.get("/debug", (req, res) => {
  const masked =
    RABBITMQ_URL ? RABBITMQ_URL.replace(/\/\/([^:]+):([^@]+)@/, "//$1:***@") : null;

  res.json({
    port: PORT,
    queue: QUEUE_NAME,
    rabbitmq_url_set: Boolean(RABBITMQ_URL),
    rabbitmq_url_masked: masked,
  });
});

app.post("/orders", async (req, res) => {
  try {
    const order = req.body;
    if (!order || Object.keys(order).length === 0) {
      return res.status(400).json({ error: "Missing JSON body" });
    }

    const ch = await getChannel();
    const msg = JSON.stringify(order);

    ch.sendToQueue(QUEUE_NAME, Buffer.from(msg));
    console.log("Sent order to queue:", msg);

    return res.status(200).json({ message: "Order received", queued: true });
  } catch (err) {
    console.error("Order error:", err?.message || err);
    return res.status(500).json({
      error: "Error connecting to RabbitMQ",
      detail: err?.message || String(err),
    });
  }
});

app.listen(PORT, () => {
  console.log(`Order service listening on port ${PORT}`);
});
