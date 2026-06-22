import express from "express";
import http from "http";
import path from "path";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const server = http.createServer(app);

app.use(express.json());

// --- Global State ---
let esp32State = {
  relays: [false, false, false, false],
  variation: 0, // 0: None, 1: 1-2-3-4, 2: 4-3-2-1
  delay: 100, // 50 - 500 ms
  dht: { temperature: 0.0, humidity: 0.0 },
};

// In-memory clients for active auth sessions
const telegramClients: Record<string, TelegramClient> = {};
const phoneCodeHashes: Record<string, string> = {};

// --- API Routes for Web/App ---

// Send Code
app.post("/api/telegram/sendCode", async (req, res) => {
  const { phoneNumber, apiId, apiHash } = req.body;
  if (!apiId || !apiHash) {
    return res.status(400).json({ error: "Telegram API ID and API Hash are required" });
  }

  const parsedApiId = parseInt(apiId, 10);

  try {
    const stringSession = new StringSession(""); // A new session
    const client = new TelegramClient(stringSession, parsedApiId, apiHash, {
      connectionRetries: 5,
    });

    await client.connect();
    
    const result = await client.sendCode(
      {
        apiId: parsedApiId,
        apiHash: apiHash,
      },
      phoneNumber
    );

    telegramClients[phoneNumber] = client;
    phoneCodeHashes[phoneNumber] = result.phoneCodeHash;

    res.json({ success: true });
  } catch (err: any) {
    console.error("GramJS Error:", err);
    res.status(500).json({ error: err.errorMessage || err.message || "Failed to send code" });
  }
});

// Sign In
app.post("/api/telegram/signIn", async (req, res) => {
  const { phoneNumber, code } = req.body;
  const client = telegramClients[phoneNumber];
  const phoneCodeHash = phoneCodeHashes[phoneNumber];

  if (!client || !phoneCodeHash) {
    return res.status(400).json({ error: "Session not found, please request code again" });
  }

  try {
    const user = await client.invoke(
      new Api.auth.SignIn({
        phoneNumber,
        phoneCodeHash,
        phoneCode: code,
      })
    );
    
    // Save session string so user is logged in
    const sessionString = (client.session as StringSession).save();
    
    res.json({ success: true, session: sessionString, user });
  } catch (err: any) {
    console.error("GramJS Error:", err);
    res.status(500).json({ error: err.errorMessage || err.message || "Failed to sign in" });
  }
});


// --- ESP32 & Web Polling API ---
app.get("/api/esp32/state", (req, res) => {
  res.json({
    relays: esp32State.relays.map((v) => (v ? 1 : 0)), // For ESP32 (0 or 1 arrays)
    relaysBool: esp32State.relays, // For Web (Boolean)
    variation: esp32State.variation,
    delay: esp32State.delay,
    dht: esp32State.dht
  });
});

app.post("/api/esp32/sensor", (req, res) => {
  const { temperature, humidity } = req.body;
  
  if (temperature !== undefined) esp32State.dht.temperature = Number(temperature);
  if (humidity !== undefined) esp32State.dht.humidity = Number(humidity);

  res.json({ success: true });
});

// For Web UI Control
app.post("/api/esp32/relays", (req, res) => {
  const { relays } = req.body;
  if (Array.isArray(relays)) {
    esp32State.relays = relays;
  }
  res.json({ success: true });
});

app.post("/api/esp32/variation", (req, res) => {
  const { variation, delay } = req.body;
  if (variation !== undefined) esp32State.variation = Number(variation);
  if (delay !== undefined) esp32State.delay = Number(delay);
  res.json({ success: true });
});

// Vite middleware for development
async function startServer() {
  const PORT = process.env.PORT || 3000;

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(process.cwd(), "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(process.cwd(), "dist", "index.html"));
    });
  }

  server.listen(PORT, "0.0.0.0" as any, () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
