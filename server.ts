import express from "express";
import http from "http";
import path from "path";
import { TelegramClient, Api } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const server = http.createServer(app);

app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  next();
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use((req, res, next) => {
  if (req.method === 'POST' && typeof req.body === 'string') {
    try { req.body = JSON.parse(req.body); } catch(e) {}
  }
  next();
});

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
    
    // Start listening to messages
    startTelegramListener(client);

    res.json({ success: true, session: sessionString, user });
  } catch (err: any) {
    console.error("GramJS Error:", err);
    res.status(500).json({ error: err.errorMessage || err.message || "Failed to sign in" });
  }
});

// Start Session
app.post("/api/telegram/start", async (req, res) => {
  const { sessionString, apiId, apiHash } = req.body;
  if (!sessionString || !apiId || !apiHash) {
    return res.status(400).json({ error: "Session string, API ID, and API Hash required" });
  }

  try {
    const stringSession = new StringSession(sessionString);
    const client = new TelegramClient(stringSession, parseInt(apiId, 10), apiHash, {
      connectionRetries: 5,
    });
    
    await client.connect();
    startTelegramListener(client);
    
    const user = await client.getMe();
    res.json({ success: true, user });
  } catch (err: any) {
    console.error("GramJS Error:", err);
    res.status(500).json({ error: "Failed to connect session" });
  }
});

// Telegram Listener Mapped to ESP32 State
import { NewMessage, NewMessageEvent } from "telegram/events/index.js";

function startTelegramListener(client: TelegramClient) {
  client.addEventHandler(async (event: NewMessageEvent) => {
    const message = event.message;
    const text = message.text.toLowerCase();

    let reply = "";
    let matched = false;

    // We mutate the global state directly
    const currentRelays = [...esp32State.relays];
    
    if (text.includes("nyalakan semua")) {
      for (let i = 0; i < 4; i++) currentRelays[i] = true;
      reply = "Semua lampu dinyalakan.";
      matched = true;
    } else if (text.includes("matikan semua")) {
      for (let i = 0; i < 4; i++) currentRelays[i] = false;
      reply = "Semua lampu dimatikan.";
      matched = true;
    } else if (text.includes("nyalakan lampu 1")) {
      currentRelays[0] = true;
      reply = "Lampu 1 dinyalakan.";
      matched = true;
    } else if (text.includes("matikan lampu 1")) {
      currentRelays[0] = false;
      reply = "Lampu 1 dimatikan.";
      matched = true;
    } else if (text.includes("nyalakan lampu 2")) {
      currentRelays[1] = true;
      reply = "Lampu 2 dinyalakan.";
      matched = true;
    } else if (text.includes("matikan lampu 2")) {
      currentRelays[1] = false;
      reply = "Lampu 2 dimatikan.";
      matched = true;
    } else if (text.includes("nyalakan lampu 3")) {
      currentRelays[2] = true;
      reply = "Lampu 3 dinyalakan.";
      matched = true;
    } else if (text.includes("matikan lampu 3")) {
      currentRelays[2] = false;
      reply = "Lampu 3 dimatikan.";
      matched = true;
    } else if (text.includes("nyalakan lampu 4")) {
      currentRelays[3] = true;
      reply = "Lampu 4 dinyalakan.";
      matched = true;
    } else if (text.includes("matikan lampu 4")) {
      currentRelays[3] = false;
      reply = "Lampu 4 dimatikan.";
      matched = true;
    } else if (text.includes("variasi 1")) {
      esp32State.variation = 1;
      reply = "Mode Variasi 1 diaktifkan.";
    } else if (text.includes("variasi 2")) {
      esp32State.variation = 2;
      reply = "Mode Variasi 2 diaktifkan.";
    } else if (text.includes("suhu") || text.includes("kelembapan") || text.includes("kelembaban")) {
      reply = `Suhu ruangan: ${esp32State.dht.temperature}°C, Kelembapan: ${esp32State.dht.humidity}%`;
    }

    if (matched) {
      esp32State.relays = currentRelays;
      esp32State.variation = 0; // Turn off variation when manual override
    }

    if (reply !== "") {
      try {
        await client.sendMessage(message.chatId as any, { message: reply });
      } catch (err) {
        console.error("Failed to reply:", err);
      }
    }
  }, new NewMessage({}));
}


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
  console.log("Received POST /api/esp32/sensor:", req.body);
  const { temperature, humidity } = req.body || {};
  
  if (temperature !== undefined && temperature !== null && !isNaN(Number(temperature))) {
    esp32State.dht.temperature = Number(temperature);
  }
  if (humidity !== undefined && humidity !== null && !isNaN(Number(humidity))) {
    esp32State.dht.humidity = Number(humidity);
  }

  res.json({ success: true, dht: esp32State.dht });
});

// For Web UI Control
app.post("/api/esp32/relays", (req, res) => {
  const { relays } = req.body;
  console.log("Received POST /api/esp32/relays:", req.body);
  if (Array.isArray(relays)) {
    esp32State.relays = relays;
  }
  res.json({ success: true, updatedRelays: esp32State.relays });
});

app.post("/api/esp32/variation", (req, res) => {
  const { variation, delay } = req.body;
  console.log("Received POST /api/esp32/variation:", req.body);
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
