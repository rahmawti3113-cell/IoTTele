import React, { useEffect, useState, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { Power, Mic, Terminal, Activity, Thermometer, Droplet, Send } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ESP32State } from "./types";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const socket = io();

export default function App() {
  const [sessionInfo, setSessionInfo] = useState<any>(null); // Telegram session
  const [espState, setEspState] = useState<ESP32State>({
    relays: [false, false, false, false],
    variation: 0,
    delay: 100,
    dht: { temperature: 0, humidity: 0 },
  });

  // Telegram Auth State
  const [apiId, setApiId] = useState("");
  const [apiHash, setApiHash] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code" | "dashboard">("phone");
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // Voice Command State
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  useEffect(() => {
    socket.on("stateUpdate", (state: ESP32State) => {
      setEspState(state);
    });
    return () => {
      socket.off("stateUpdate");
    };
  }, []);

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.lang = "id-ID";
      recognition.continuous = false;
      recognition.interimResults = false;

      recognition.onresult = (event: any) => {
        const command = event.results[0][0].transcript.toLowerCase();
        handleVoiceCommand(command);
      };

      recognition.onerror = (e: any) => {
        console.error("Speech error", e.error);
        setListening(false);
      };

      recognition.onend = () => {
        setListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, [espState]);

  const speak = (text: string) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "id-ID";
    window.speechSynthesis.speak(utterance);
  };

  const handleVoiceCommand = (cmd: string) => {
    console.log("Command:", cmd);
    let matched = false;
    let newRelays = [...espState.relays];

    // Check individual relays
    for (let i = 1; i <= 4; i++) {
        const statusMap: Record<string, string> = { "satu": "1", "dua": "2", "tiga": "3", "empat": "4" };
        if (cmd.includes(`nyalakan lampu ${i}`) || cmd.includes(`hidupkan lampu ${i}`) || Object.keys(statusMap).some(k => i.toString() === statusMap[k] && cmd.includes(`nyalakan lampu ${k}`))) {
            newRelays[i-1] = true;
            matched = true;
            speak(`Lampu ${i} dinyalakan`);
        } else if (cmd.includes(`matikan lampu ${i}`) || Object.keys(statusMap).some(k => i.toString() === statusMap[k] && cmd.includes(`matikan lampu ${k}`))) {
            newRelays[i-1] = false;
            matched = true;
            speak(`Lampu ${i} dimatikan`);
        }
    }

    if (cmd.includes("nyalakan semua")) {
        newRelays = [true, true, true, true];
        matched = true;
        speak("Semua lampu dinyalakan");
    } else if (cmd.includes("matikan semua")) {
        newRelays = [false, false, false, false];
        matched = true;
        speak("Semua lampu dimatikan");
    }

    if (matched) {
        setServerRelays(newRelays);
        setServerVariation(0, espState.delay); // Cancel variation
    } else if (cmd.includes("suhu") || cmd.includes("kelembapan") || cmd.includes("kelembaban")) {
        speak(`Suhu saat ini adalah ${espState.dht.temperature} derajat celcius dengan kelembapan ${espState.dht.humidity} persen`);
    } else {
        speak("Perintah tidak dikenali");
    }
  };

  const toggleListening = () => {
    if (listening) {
      recognitionRef.current?.stop();
    } else {
      setListening(true);
      recognitionRef.current?.start();
    }
  };

  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");
    try {
      const res = await fetch("/api/telegram/sendCode", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: phone, apiId, apiHash }),
      });
      const data = await res.json();
      if (data.success) {
        setStep("code");
      } else {
        setErrorMsg(data.error);
      }
    } catch (err: any) {
      setErrorMsg("Failed to connect to server");
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");
    try {
      const res = await fetch("/api/telegram/signIn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: phone, code }),
      });
      const data = await res.json();
      if (data.success) {
        setSessionInfo(data.user);
        setStep("dashboard");
      } else {
        setErrorMsg(data.error);
      }
    } catch (err: any) {
      setErrorMsg("Failed to connect to server");
    } finally {
      setLoading(false);
    }
  };

  const toggleRelay = (index: number) => {
    const newRelays = [...espState.relays];
    newRelays[index] = !newRelays[index];
    setServerRelays(newRelays);
    if (espState.variation !== 0) {
      setServerVariation(0, espState.delay);
    }
  };

  const [showCode, setShowCode] = useState(false);

  return (
    <div className="w-full h-screen bg-slate-950 text-slate-100 flex flex-col font-sans overflow-hidden relative">
      {/* Background Decor */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 blur-[120px] rounded-full pointer-events-none"></div>
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-500/10 blur-[120px] rounded-full pointer-events-none"></div>
      
      {/* Header */}
      <header className="h-20 flex-shrink-0 flex items-center justify-between px-4 md:px-8 bg-white/5 backdrop-blur-xl border-b border-white/10 z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-sky-500 rounded-full flex items-center justify-center shadow-lg shadow-sky-500/20">
            <Activity className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight uppercase">ESP32-TELEGRAM NODE</h1>
            <p className="text-xs text-slate-400 font-mono hidden sm:block">STATION ID: ESP32_RELAY_4CH_V1</p>
          </div>
        </div>
        
        <div className="flex items-center gap-4 sm:gap-6">
          <div className="hidden sm:flex items-center gap-3 px-4 py-2 bg-white/5 rounded-full border border-white/10">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
            <span className="text-sm font-medium">SYSTEM ONLINE</span>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setShowCode(true)}
              className="p-2 hover:bg-white/10 rounded-lg transition-colors text-slate-300"
              title="ESP32 Code"
            >
              <Terminal className="w-6 h-6" />
            </button>
            {sessionInfo && (
              <div className="flex items-center gap-2 px-4 py-2 bg-[#24A1DE] rounded-lg font-semibold text-sm shadow-lg pointer-events-none">
                <Send className="w-4 h-4 text-white" />
                <span className="hidden sm:inline">LOGGED IN: @{sessionInfo.username || sessionInfo.firstName}</span>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main Viewport */}
      <main className="flex-1 w-full overflow-y-auto p-4 md:p-6 z-10 relative">
        {step !== "dashboard" ? (
          <div className="max-w-md mx-auto bg-white/5 backdrop-blur-md p-8 rounded-3xl border border-white/10 shadow-2xl space-y-6 mt-12 sm:mt-24">
            <div className="text-center">
              <div className="w-16 h-16 bg-[#24A1DE] rounded-full mx-auto flex items-center justify-center mb-4 shadow-lg shadow-[#24A1DE]/20">
                <Send className="w-8 h-8 text-white ml-[-2px] mt-[2px]" />
              </div>
              <h2 className="text-2xl font-bold mb-2">Telegram Sign In</h2>
              <p className="text-sm text-slate-400">
                Authenticate via Telegram to access IoT commands.<br/>
                <a href="https://my.telegram.org/apps" target="_blank" rel="noreferrer" className="text-[#24A1DE] hover:underline">Dapatkan API ID & Hash di sini</a>
              </p>
            </div>

            {errorMsg && (
              <div className="bg-red-500/10 border border-red-500/50 text-red-400 px-4 py-3 rounded-xl text-sm text-center backdrop-blur-sm">
                {errorMsg}
              </div>
            )}

            {step === "phone" ? (
              <form onSubmit={handleSendCode} className="space-y-4">
                <div>
                  <label className="block text-sm font-bold mb-1.5 text-slate-300">
                    API ID
                  </label>
                  <input
                    type="text"
                    value={apiId}
                    onChange={(e) => setApiId(e.target.value)}
                    placeholder="e.g. 1234567"
                    className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-xl focus:ring-2 focus:ring-[#24A1DE] focus:border-transparent outline-none transition font-mono placeholder:text-slate-600"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold mb-1.5 text-slate-300">
                    API Hash
                  </label>
                  <input
                    type="text"
                    value={apiHash}
                    onChange={(e) => setApiHash(e.target.value)}
                    placeholder="e.g. abcdef1234567890"
                    className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-xl focus:ring-2 focus:ring-[#24A1DE] focus:border-transparent outline-none transition font-mono placeholder:text-slate-600"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-bold mb-1.5 text-slate-300">
                    Phone Number
                  </label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1234567890"
                    className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-xl focus:ring-2 focus:ring-[#24A1DE] focus:border-transparent outline-none transition font-mono placeholder:text-slate-600"
                    required
                  />
                  <p className="mt-2 text-xs text-slate-500">Include country code (e.g. +62)</p>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[#24A1DE] hover:bg-[#208fca] text-white py-3 rounded-xl font-bold transition-all shadow-lg disabled:opacity-50"
                >
                  {loading ? "Sending..." : "Send Code"}
                </button>
              </form>
            ) : (
              <form onSubmit={handleSignIn} className="space-y-4">
                <div>
                  <label className="block text-sm font-bold mb-1.5 text-slate-300">
                    Authentication Code
                  </label>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="12345"
                    className="w-full px-4 py-3 bg-black/40 border border-white/10 rounded-xl focus:ring-2 focus:ring-[#24A1DE] focus:border-transparent outline-none transition font-mono placeholder:text-slate-600"
                    required
                  />
                  <p className="mt-2 text-xs text-slate-500">Check your Telegram app for the code.</p>
                </div>
                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-[#24A1DE] hover:bg-[#208fca] text-white py-3 rounded-xl font-bold transition-all shadow-lg disabled:opacity-50"
                >
                  {loading ? "Signing in..." : "Sign In"}
                </button>
              </form>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-full max-w-7xl mx-auto">
            {/* Left Section: Sensors & Status */}
            <section className="col-span-1 lg:col-span-3 flex flex-col gap-6">
              <div className="flex-1 bg-white/5 backdrop-blur-md rounded-3xl border border-white/10 p-6 flex flex-col shadow-2xl">
                <div className="flex justify-between items-start mb-6">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest">DHT11 Sensor Data</h3>
                  <span className="text-[10px] bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded-full font-bold">LIVE</span>
                </div>
                
                <div className="space-y-8 flex-1">
                  <div>
                    <div className="flex items-end gap-1">
                      <span className="text-6xl font-light tracking-tighter">{espState.dht.temperature.toFixed(1)}</span>
                      <span className="text-2xl text-slate-500 mb-2 font-serif">&deg;C</span>
                    </div>
                    <p className="text-sm text-slate-400 mt-1 flex items-center gap-2"><Thermometer className="w-4 h-4 text-orange-500"/> Ambient Temperature</p>
                  </div>
                  
                  <div>
                    <div className="flex items-end gap-1">
                      <span className="text-6xl font-light tracking-tighter">{espState.dht.humidity.toFixed(1)}</span>
                      <span className="text-2xl text-slate-500 mb-2 font-serif">%</span>
                    </div>
                    <p className="text-sm text-slate-400 mt-1 flex items-center gap-2"><Droplet className="w-4 h-4 text-cyan-500"/> Relative Humidity</p>
                  </div>
                </div>

                <div className="pt-6 border-t border-white/5 mt-auto">
                  <button 
                    onClick={toggleListening}
                    className={cn(
                      "w-full py-4 rounded-2xl flex flex-col items-center gap-2 border transition-all group",
                      listening ? "bg-red-500/20 border-red-500/50 hover:bg-red-500/30" : "bg-white/5 border-white/5 hover:bg-white/10"
                    )}
                  >
                    <div className={cn(
                      "w-10 h-10 rounded-full flex items-center justify-center transition-all",
                      listening ? "bg-red-500 animate-pulse text-white shadow-lg shadow-red-500/50" : "bg-sky-500/20 group-active:scale-95 text-sky-400"
                    )}>
                       <Mic className="w-5 h-5" />
                    </div>
                    <span className={cn(
                      "text-xs font-bold uppercase tracking-tighter",
                      listening ? "text-red-400" : "text-slate-300"
                    )}>
                      {listening ? "Mendengarkan..." : "Voice Command"}
                    </span>
                  </button>
                </div>
              </div>
            </section>

            {/* Center Section: Relay Controls */}
            <section className="col-span-1 lg:col-span-6 flex flex-col gap-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 h-full">
                {espState.relays.map((isOn, idx) => (
                  <div key={idx} className="bg-white/5 backdrop-blur-md rounded-3xl border border-white/10 p-6 flex flex-col justify-between shadow-xl relative overflow-hidden transition-all duration-300">
                    {isOn && <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/10 blur-3xl -mr-16 -mt-16 pointer-events-none"></div>}
                    <div className="flex justify-between items-center relative z-10">
                      <div className={cn(
                        "w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-300",
                        isOn ? "bg-amber-500 shadow-lg shadow-amber-500/20" : "bg-slate-700"
                      )}>
                        <Power className={cn("w-6 h-6", isOn ? "text-white" : "text-slate-400")} />
                      </div>
                      <span className={cn(
                         "text-[10px] font-bold px-2 py-1 rounded-md transition-colors",
                         isOn ? "text-amber-500 bg-amber-500/10" : "text-slate-400 bg-slate-700"
                      )}>
                        {isOn ? "ON" : "OFF"}
                      </span>
                    </div>
                    <div className="relative z-10 py-6">
                      <h4 className={cn("text-lg font-bold", isOn ? "text-white" : "text-slate-300")}>Lampu {idx + 1}</h4>
                      <p className="text-xs text-slate-400">Relay Channel 0{idx + 1}</p>
                    </div>
                    <button 
                      onClick={() => toggleRelay(idx)}
                      className={cn(
                        "w-full py-3 rounded-xl font-bold text-sm transition-all duration-300 relative z-10",
                        isOn 
                          ? "bg-amber-500 text-white shadow-lg" 
                          : "bg-white/5 text-slate-300 border border-white/10 hover:bg-white/10"
                      )}
                    >
                      {isOn ? "TURN OFF" : "TURN ON"}
                    </button>
                  </div>
                ))}
              </div>
            </section>

            {/* Right Section: Variation & Settings */}
            <section className="col-span-1 lg:col-span-3 flex flex-col gap-6">
              <div className="flex-1 bg-white/5 backdrop-blur-md rounded-3xl border border-white/10 p-6 flex flex-col shadow-2xl">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6">Sequencer Settings</h3>
                
                <div className="space-y-4">
                  <button 
                    onClick={() => setServerVariation(0, espState.delay)}
                    className={cn(
                      "w-full p-4 rounded-2xl border-2 flex flex-col gap-1 items-start transition-all",
                      espState.variation === 0 ? "border-slate-500 bg-slate-500/10" : "border-white/10 bg-white/5 hover:bg-white/10"
                    )}
                  >
                    <span className={cn("text-xs font-bold uppercase tracking-tighter", espState.variation === 0 ? "text-slate-400" : "text-slate-500")}>Manual Mode</span>
                    <span className="text-sm font-medium">Individual Control</span>
                  </button>

                  <button 
                    onClick={() => setServerVariation(1, espState.delay)}
                    className={cn(
                      "w-full p-4 rounded-2xl border-2 flex flex-col gap-1 items-start transition-all",
                      espState.variation === 1 ? "border-sky-500 bg-sky-500/10" : "border-white/10 bg-white/5 hover:bg-white/10"
                    )}
                  >
                    <span className={cn("text-xs font-bold uppercase tracking-tighter", espState.variation === 1 ? "text-sky-400" : "text-slate-500")}>Variasi 01</span>
                    <span className="text-sm font-medium">Ascending (1 → 2 → 3 → 4)</span>
                  </button>
                  
                  <button 
                    onClick={() => setServerVariation(2, espState.delay)}
                    className={cn(
                      "w-full p-4 rounded-2xl border-2 flex flex-col gap-1 items-start transition-all",
                      espState.variation === 2 ? "border-purple-500 bg-purple-500/10" : "border-white/10 bg-white/5 hover:bg-white/10"
                    )}
                  >
                    <span className={cn("text-xs font-bold uppercase tracking-tighter", espState.variation === 2 ? "text-purple-400" : "text-slate-500")}>Variasi 02</span>
                    <span className="text-sm font-medium">Descending (4 → 3 → 2 → 1)</span>
                  </button>
                </div>

                <div className="mt-8">
                  <div className="flex justify-between items-center mb-4">
                    <span className="text-xs font-bold text-slate-400">Interval Delay</span>
                    <span className="text-xs font-mono bg-white/10 px-2 py-1 rounded">{espState.delay} ms</span>
                  </div>
                  <input 
                    type="range" 
                    min="50" 
                    max="500" 
                    step="10"
                    value={espState.delay}
                    onChange={(e) => setServerVariation(espState.variation, Number(e.target.value))}
                    className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-sky-500" 
                  />
                  <div className="flex justify-between mt-2">
                    <span className="text-[10px] text-slate-500">50ms (Fast)</span>
                    <span className="text-[10px] text-slate-500">500ms (Slow)</span>
                  </div>
                </div>

                <div className="mt-auto hidden lg:block">
                  <div className="bg-black/40 rounded-xl p-3 border border-white/5 h-32 flex flex-col">
                    <p className="text-[10px] text-slate-400 font-mono mb-2 uppercase flex-shrink-0">Terminal Output</p>
                    <div className="font-mono text-[10px] text-emerald-400/80 leading-relaxed overflow-y-auto flex-1 flex flex-col justify-end">
                      <p>&gt; Connection established</p>
                      <p>&gt; State loaded...</p>
                      <p>&gt; Relays synchronized</p>
                      {espState.variation > 0 && <p className="animate-pulse">&gt; Sequence running: {espState.variation === 1 ? '1-2-3-4' : '4-3-2-1'} @ {espState.delay}ms</p>}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}
      </main>

      {/* Footer Context Bar */}
      <footer className="h-10 sm:h-12 flex-shrink-0 bg-black/40 backdrop-blur-2xl border-t border-white/5 px-4 sm:px-8 flex items-center justify-between text-[10px] sm:text-[11px] text-slate-500 w-full z-10 relative">
        <div className="flex gap-2 sm:gap-4 truncate">
          <span>Relays: Active ({espState.relays.filter(Boolean).length}/4)</span>
          <span className="text-slate-700">|</span>
          <span className="truncate">Sensors: {espState.dht.temperature > 0 ? "Online" : "Waiting..."}</span>
        </div>
        <div className="font-mono tracking-widest text-sky-500/50 uppercase hidden sm:block">
          GramJS-ESP32 Bridge Interface
        </div>
      </footer>

      {/* Code Modal with Glass theme */}
      {showCode && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-slate-900/90 backdrop-blur-xl border border-white/10 rounded-3xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="flex justify-between items-center p-6 border-b border-white/10 bg-white/5">
              <h3 className="font-bold text-lg flex items-center gap-2 text-white"><Terminal className="w-5 h-5 text-sky-400"/> ESP32 C++ Code</h3>
              <button onClick={() => setShowCode(false)} className="text-slate-400 hover:text-white font-bold px-3 py-1.5 bg-white/10 hover:bg-white/20 transition-all rounded-lg text-sm">Close</button>
            </div>
            <div className="p-6 overflow-y-auto font-mono text-sm bg-black/40 text-slate-300 flex-1 custom-scrollbar">
              <pre className="whitespace-pre-wrap leading-relaxed">{getESP32Code(window.location.host)}</pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function getESP32Code(hostDomain: string) {
  return `#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <DHT.h>

const char* ssid = "YOUR_WIFI_SSID";
const char* password = "YOUR_WIFI_PASSWORD";

// Gunakan protokol HTTPS
const char* apiStateUrl = "https://${hostDomain}/api/esp32/state";
const char* apiSensorUrl = "https://${hostDomain}/api/esp32/sensor";

#define DHTPIN 4     // Digital pin connected to the DHT sensor
#define DHTTYPE DHT11   // DHT 11
DHT dht(DHTPIN, DHTTYPE);

// Relay Pins
const int relayPins[4] = {12, 14, 27, 26};
int currentStates[4] = {0, 0, 0, 0};

// Server state
int variationMode = 0;
int variationDelay = 100;
unsigned long lastVarUpdate = 0;
int varStep = 0;

unsigned long lastPoll = 0;
const int pollInterval = 1000;

// WiFi Secure Client untuk HTTPS
WiFiClientSecure secureClient;

void setup() {
  Serial.begin(115200);
  
  // Setup Relays
  for (int i = 0; i < 4; i++) {
    pinMode(relayPins[i], OUTPUT);
    digitalWrite(relayPins[i], LOW); // Assuming Active HIGH
  }

  dht.begin();

  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\\nConnected to WiFi");

  // Bypass SSL Certificate validation (Penting untuk Cloud Run / Vercel HTTPS)
  secureClient.setInsecure();
}

void updateRelays() {
  for (int i = 0; i < 4; i++) {
    digitalWrite(relayPins[i], currentStates[i] ? HIGH : LOW);
  }
}

void fetchState() {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    // Gunakan secureClient untuk HTTPS
    http.begin(secureClient, apiStateUrl);
    http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
    int httpCode = http.GET();
    
    if (httpCode == HTTP_CODE_OK || httpCode == HTTP_CODE_MOVED_PERMANENTLY) {
      Serial.println("GET State: Berhasil");
      String payload = http.getString();
      DynamicJsonDocument doc(1024);
      deserializeJson(doc, payload);

      variationMode = doc["variation"];
      variationDelay = doc["delay"];

      if (variationMode == 0) {
        JsonArray relays = doc["relays"];
        for(int i=0; i<4; i++) {
          currentStates[i] = relays[i];
        }
        updateRelays();
      }
    } else {
      Serial.print("Error GET State. HTTP Code: ");
      Serial.println(httpCode);
    }
    http.end();
  }
}

void sendSensorData() {
  if (WiFi.status() == WL_CONNECTED) {
    float h = dht.readHumidity();
    float t = dht.readTemperature();

    if (!isnan(h) && !isnan(t)) {
      HTTPClient http;
      http.begin(secureClient, apiSensorUrl);
      http.setFollowRedirects(HTTPC_STRICT_FOLLOW_REDIRECTS);
      http.addHeader("Content-Type", "application/json");

      String jsonPayload = "{\\"temperature\\":" + String(t) + ", \\"humidity\\":" + String(h) + "}";
      int httpCode = http.POST(jsonPayload);
      if (httpCode == HTTP_CODE_OK || httpCode == 200) {
        Serial.println("POST Sensor: Berhasil");
      } else {
        Serial.print("Error POST Sensor. HTTP Code: ");
        Serial.println(httpCode);
      }
      http.end();
    } else {
      Serial.println("Error: Gagal membaca sensor DHT11. Periksa kabel Anda!");
    }
  }
}

void loop() {
  unsigned long currentMillis = millis();

  // Poll state and sensor every 1 second
  if (currentMillis - lastPoll >= pollInterval) {
    lastPoll = currentMillis;
    fetchState();
    sendSensorData();
  }

  // Handle local variations for fast response
  if (variationMode > 0) {
    if (currentMillis - lastVarUpdate >= variationDelay) {
      lastVarUpdate = currentMillis;
      
      // Clear all
      for(int i=0; i<4; i++) currentStates[i] = 0;
      
      if (variationMode == 1) { // 1 -> 2 -> 3 -> 4
        currentStates[varStep] = 1;
        varStep = (varStep + 1) % 4;
      } 
      else if (variationMode == 2) { // 4 -> 3 -> 2 -> 1
        currentStates[3 - varStep] = 1;
        varStep = (varStep + 1) % 4;
      }
      
      updateRelays();
    }
  }
}
`;
}

