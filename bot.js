const TelegramBot = require("node-telegram-bot-api");
const ExchangeClient = require("./exchange");
const SignalGenerator = require("./signals");
const { TRADING_PAIRS, CHECK_INTERVAL } = require("./config");
const http = require("http");
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
if (!TOKEN) { console.error("HATA: TELEGRAM_BOT_TOKEN bulunamadı!"); process.exit(1); }

const bot = new TelegramBot(TOKEN, { polling: true });

// --- GLOBAL STATE ---
const chatIds = new Set();
const userSettings = {};
let globalScanInterval = null;
let signalCounter = 0;

const STATE_PATH = path.join(__dirname, "state.json");
const SIGNALS_PATH = path.join(__dirname, "signals.json");

// --- VERİ TABANI ---
function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
      if (data.chatIds) data.chatIds.forEach(id => chatIds.add(Number(id)));
      if (data.userSettings) Object.entries(data.userSettings).forEach(([k, v]) => userSettings[Number(k)] = v);
    }
  } catch (e) { 
    console.warn("State yüklenemedi, temiz başlangıç yapılıyor.");
    fs.writeFileSync(STATE_PATH, JSON.stringify({ chatIds: [], userSettings: {} }));
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify({
      chatIds: Array.from(chatIds),
      userSettings: userSettings
    }, null, 2));
  } catch (e) { console.error("State kaydetme hatası:", e); }
}

function loadSignals() {
  try { return JSON.parse(fs.readFileSync(SIGNALS_PATH, "utf8")); } catch(e) { return []; }
}

function saveSignals(signals) {
  try { fs.writeFileSync(SIGNALS_PATH, JSON.stringify(signals, null, 2)); } catch(e) {}
}

function getSettings(userId) {
  const uid = Number(userId);
  if (!userSettings[uid]) {
    userSettings[uid] = { minScore: 70, autoScan: false, exchange: "bitget" };
    saveState(); // Yeni kullanıcıyı kaydet
  }
  return userSettings[uid];
}

function addSignal(signal) {
  const signals = loadSignals();
  signalCounter++;
  signal.id = Date.now() + "_" + signalCounter;
  signal.status = "active";
  signal.timestamp = Date.now();
  signals.unshift(signal);
  if (signals.length > 100) signals.splice(50);
  saveSignals(signals);
}

// --- BAŞLAT ---
loadState();
console.log(`📋 ${chatIds.size} kullanıcı, ${Object.keys(userSettings).length} ayar yüklendi.`);

// --- OTOMATİK ABONELİK (Her mesajda kullanıcıyı ekle) ---
bot.on("message", (msg) => {
  if (msg.from && !msg.from.is_bot) {
    chatIds.add(Number(msg.from.id));
    saveState();
  }
});

bot.on("callback_query", (query) => {
  chatIds.add(Number(query.from.id));
  saveState();
  bot.answerCallbackQuery(query.id);
});

// --- MENÜLER ---
function getKeyboard(userId) {
  const s = getSettings(userId);
  const autoText = s.autoScan ? "AÇIK ✅" : "KAPALI ❌";
  return {
    reply_markup: {
      keyboard: [
        [{ text: "🚀 Hızlı Tarama" }, { text: "📊 Derin Analiz" }],
        [{ text: "💰 Altcoinler" }, { text: "🦄 Meme Coinler" }],
        [{ text: "📈 Trend Takip" }, { text: "🕰️ Son Sinyaller" }],
        [{ text: "🔔 Oto Sinyal: " + autoText }, { text: "ℹ️ Yardım" }],
        [{ text: "⚙️ Ayarlarım" }, { text: "💼 Portföyüm" }],
        [{ text: "📊 Backtest" }]
      ],
      resize_keyboard: true
    }
  };
}

// --- KOMUTLAR VE BUTONLAR ---
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "🤖 <b>TRADING PRO BOT</b>\nSistem aktif! Menüyü kullan.", { parse_mode: "HTML", ...getKeyboard(msg.from.id) });
});

// Alt Menü Butonları (Text) -> Inline Keyboard döner
bot.onText(/🚀 Hızlı Tarama/, (msg) => sendSubMenu(msg, [["BTC","ETH"],["SOL","XRP"]]));
bot.onText(/📊 Derin Analiz/, (msg) => sendSubMenu(msg, [["BTC","AVAX"],["LINK","DOT"]]));
bot.onText(/💰 Altcoinler/, (msg) => sendSubMenu(msg, [["ADA","NEAR"],["APT","ARB"]]));
bot.onText(/🦄 Meme Coinler/, (msg) => sendSubMenu(msg, [["DOGE","PEPE"],["WIF","FLOKI"]]));
bot.onText(/📈 Trend Takip/, (msg) => sendSubMenu(msg, [["BTC","ETH"],["SOL","AVAX"]]));

function sendSubMenu(msg, pairs) {
  const kb = pairs.map(row => row.map(p => ({ text: p, callback_data: "d_" + p + "/USDT" })));
  kb.push([{ text: "🔙 Geri", callback_data: "back" }]);
  bot.sendMessage(msg.chat.id, "📂 Seçin:", { reply_markup: { inline_keyboard: kb } });
}

// Oto Sinyal Butonu (Text) -> Toggle İşlemi
bot.onText(/🔔 Oto Sinyal/, (msg) => {
  const uid = Number(msg.from.id);
  const s = getSettings(uid);
  s.autoScan = !s.autoScan;
  saveState();
  
  const status = s.autoScan ? "AÇIK ✅" : "KAPALI ❌";
  bot.sendMessage(msg.chat.id, `🔔 Oto Sinyal: ${status}`, { ...getKeyboard(uid) });
  
  if (s.autoScan) bot.sendMessage(msg.chat.id, "✅ Tarama başlatıldı. Sinyaller buraya düşecek.");
  else bot.sendMessage(msg.chat.id, "🔕 Tarama durduruldu.");
  
  checkGlobalScan();
});

// Diğer Sabit Butonlar
bot.onText(/ℹ️ Yardım/, (msg) => bot.sendMessage(msg.chat.id, "ℹ️ 18 İndikatör, Formasyonlar, AI.\n\n/skor 75 - Min skor\n/borsa bitget - Borsa seç", { parse_mode: "HTML" }));
bot.onText(/⚙️ Ayarlarım/, (msg) => {
  const s = getSettings(msg.from.id);
  bot.sendMessage(msg.chat.id, `⚙️ Min Skor: ${s.minScore}\nBorsa: ${s.exchange}\nOto: ${s.autoScan ? "Açık" : "Kapalı"}`, { parse_mode: "HTML" });
});
bot.onText(/💼 Portföyüm/, (msg) => bot.sendMessage(msg.chat.id, "💼 <code>/ekle BTC 65000 LONG 100</code>", { parse_mode: "HTML" }));
bot.onText(/📊 Backtest/, (msg) => bot.sendMessage(msg.chat.id, "📊 <code>/backtest BTC</code>", { parse_mode: "HTML" }));
bot.onText(/🕰️ Son Sinyaller/, (msg) => {
  const sigs = loadSignals().slice(0, 5);
  if (!sigs.length) return bot.sendMessage(msg.chat.id, "Sinyal yok.");
  const txt = sigs.map(s => `${s.type} ${s.symbol} | Skor: ${s.aiScore}`).join("\n");
  bot.sendMessage(msg.chat.id, "🕰️ <b>Son Sinyaller</b>\n" + txt, { parse_mode: "HTML" });
});

// Komutlar
bot.onText(/\/skor (.+)/, (msg, match) => {
  const s = parseInt(match[1]);
  if (s >= 50 && s <= 95) { getSettings(msg.from.id).minScore = s; saveState(); bot.sendMessage(msg.chat.id, "✅ Min skor " + s); }
});
bot.onText(/\/borsa (.+)/, (msg, match) => {
  const ex = match[1].toLowerCase();
  if (["bitget","binance","bybit"].includes(ex)) { getSettings(msg.from.id).exchange = ex; saveState(); bot.sendMessage(msg.chat.id, "✅ Borsa " + ex); }
});

// Inline Callback İşlemleri
bot.on("callback_query", async (query) => {
  const uid = Number(query.from.id);
  const data = query.data;

  if (data === "back") {
    bot.editMessageText("Ana menü.", { chat_id: uid, message_id: query.message.message_id });
    bot.sendMessage(uid, "📋 Menü:", { ...getKeyboard(uid) });
    return;
  }
  
  if (data.startsWith("d_")) {
    const pair = data.split("d_")[1];
    try {
      const sent = await bot.sendMessage(uid, "🔎 Analiz ediliyor...");
      const ex = new ExchangeClient(getSettings(uid).exchange);
      const candles = await ex.getKlines(pair, "1h", 200);
      const sig = SignalGenerator.generate(candles, pair, "1h");
      if (sig) {
        bot.editMessageText(formatSignal(sig), { chat_id: uid, message_id: sent.message_id, parse_mode: "HTML" });
        addSignal(sig);
      } else bot.editMessageText(`📊 ${pair}: Net sinyal yok.`, { chat_id: uid, message_id: sent.message_id });
    } catch(e) { bot.editMessageText("❌ Hata.", { chat_id: uid, message_id: query.message.message_id }); }
    return;
  }
});

// Format
function formatSignal(s) {
  const tf = s.timeframe === "5m" ? "⚡ 5 Dk" : s.timeframe === "15m" ? "⚡ 15 Dk" : "📅 4 Saat";
  return (
    (s.type === "LONG" ? "🟢" : "🔴") + " <b>" + s.type + "</b>\n" +
    "💎 <b>" + s.symbol + "</b> | " + tf + "\n\n" +
    "💵 Giriş: $" + s.entry + "\n" +
    "🎯 TP1: $" + s.tp1 + "\n" +
    "🛑 Stop: $" + s.sl + "\n\n" +
    "🧠 " + s.reasons.join("\n") + "\n" +
    "📈 RSI: " + s.rsi + " | Skor: <b>" + s.aiScore + "/100</b>"
  );
}

// --- TARAMA ---
async function runGlobalScan() {
  const activeUsers = Object.entries(userSettings).filter(e => e[1].autoScan);
  if (!activeUsers.length) return;

  console.log("🔍 Tarama: " + activeUsers.length + " aktif kullanıcı");

  const targets = ["BTC/USDT", "ETH/USDT", "SOL/USDT"]; // Test için kısa liste
  const tfs = ["1h", "4h"]; // Test için kısa timeframe

  for (const pair of targets) {
    for (const tf of tfs) {
      try {
        const ex = new ExchangeClient("bitget");
        const candles = await ex.getKlines(pair, tf, 200);
        if (candles.length < 50) continue;
        const sig = SignalGenerator.generate(candles, pair, tf);
        
        if (sig) {
          activeUsers.forEach(([uid, settings]) => {
            if (sig.aiScore >= settings.minScore) {
              addSignal(sig);
              try { bot.sendMessage(Number(uid), formatSignal(sig), { parse_mode: "HTML" }); } catch(e) {}
            }
          });
        }
      } catch(e) { /* sessiz */ }
    }
    await new Promise(r => setTimeout(r, 1500));
  }
}

function checkGlobalScan() {
  const hasActive = Object.values(userSettings).some(s => s.autoScan);
  if (hasActive && !globalScanInterval) {
    console.log("🟢 Tarama başlatıldı.");
    globalScanInterval = setInterval(runGlobalScan, CHECK_INTERVAL);
    runGlobalScan();
  } else if (!hasActive && globalScanInterval) {
    console.log("🔴 Tarama durduruldu.");
    clearInterval(globalScanInterval);
    globalScanInterval = null;
  }
}

// Bot açılınca kontrol et
if (Object.values(userSettings).some(s => s.autoScan)) {
  setTimeout(() => {
    globalScanInterval = setInterval(runGlobalScan, CHECK_INTERVAL);
    runGlobalScan();
  }, 5000);
}

// Polling Hatalarını Yakala
bot.on('polling_error', (err) => console.error('Polling Error:', err.message));

// Keep-Alive
http.createServer((req, res) => { res.writeHead(200); res.end("Alive"); }).listen(process.env.PORT || 3000);
