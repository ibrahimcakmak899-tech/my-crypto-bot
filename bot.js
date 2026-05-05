const TelegramBot = require("node-telegram-bot-api");
const ExchangeClient = require("./exchange");
const SignalGenerator = require("./signals");
const { TRADING_PAIRS, TIMEFRAMES_AUTO, CHECK_INTERVAL, LEVERAGE } = require("./config");
const http = require("http");
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
if (!TOKEN) console.error("HATA: TELEGRAM_BOT_TOKEN bulunamadı!");

const bot = new TelegramBot(TOKEN, { polling: true });

// --- GLOBAL STATE ---
const chatIds = new Set();
const userSettings = {};
let globalScanInterval = null;
let signalCounter = 0;

const SIGNALS_PATH = path.join(__dirname, "signals.json");
const STATE_PATH = path.join(__dirname, "state.json");

// --- VERİ TABANI ---
function loadState() {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const data = JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
      if (data.chatIds) data.chatIds.forEach(id => chatIds.add(Number(id)));
      if (data.userSettings) {
        Object.entries(data.userSettings).forEach(([k, v]) => {
          userSettings[Number(k)] = v;
        });
      }
    }
  } catch (e) { console.error("State yükleme hatası:", e); }
  try {
    if (fs.existsSync(path.join(__dirname, "chat_ids.json"))) {
      const old = JSON.parse(fs.readFileSync(path.join(__dirname, "chat_ids.json"), "utf8"));
      if (old.users) old.users.forEach(id => chatIds.add(Number(id)));
    }
  } catch (e) {}
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
  fs.writeFileSync(SIGNALS_PATH, JSON.stringify(signals, null, 2));
}

function getSettings(userId) {
  const uid = Number(userId);
  if (!userSettings[uid]) {
    userSettings[uid] = { minScore: 70, autoScan: false, exchange: "bitget" };
  }
  return userSettings[uid];
}

function addSignal(signal) {
  const signals = loadSignals();
  signalCounter++;
  signal.id = Date.now() + "_" + signal.symbol + "_" + signalCounter;
  signal.status = "active";
  signal.timestamp = Date.now();
  signals.unshift(signal);
  if (signals.length > 100) signals.splice(50);
  saveSignals(signals);
}

function updateSignalStatus(signalId, status) {
  const signals = loadSignals();
  const idx = signals.findIndex(s => s.id === signalId);
  if (idx !== -1) {
    signals[idx].status = status;
    signals[idx].closeTime = Date.now();
    saveSignals(signals);
  }
}

loadState();
console.log(`📋 ${chatIds.size} kullanıcı yüklendi.`);

// --- TEK CALLBACK HANDLER (Çift handler hatası düzeltildi) ---
bot.on("callback_query", async (query) => {
  const uid = Number(query.from.id);
  const data = query.data;
  
  // Otomatik abonelik
  chatIds.add(uid);
  saveState();
  bot.answerCallbackQuery(query.id);

  // Geri butonu
  if (data === "back") {
    try { bot.editMessageText("Ana menüye dönülüyor.", { chat_id: uid, message_id: query.message.message_id }); } catch(e) {}
    bot.sendMessage(uid, "📋 Menü:", { ...getKeyboard(uid) });
    return;
  }

  // Detay analiz
  if (data.startsWith("d_")) {
    const pair = data.split("d_")[1];
    try {
      const sentMsg = await bot.sendMessage(uid, `🔎 ${pair} analiz ediliyor...`);
      const ex = new ExchangeClient(getSettings(uid).exchange);
      const candles = await ex.getKlines(pair, "1h", 200);
      const sig = SignalGenerator.generate(candles, pair, "1h");
      if (sig) {
        bot.editMessageText(formatSignal(sig), { chat_id: uid, message_id: sentMsg.message_id, parse_mode: "HTML" });
        addSignal(sig);
      } else {
        bot.editMessageText(`📊 ${pair}: Net sinyal yok.`, { chat_id: uid, message_id: sentMsg.message_id });
      }
    } catch(e) {
      try { bot.editMessageText("❌ Veri alınamadı.", { chat_id: uid, message_id: query.message.message_id }); } catch(e2) {}
    }
    return;
  }

  // Oto sinyal toggle
  if (data === "toggle_auto") {
    getSettings(uid).autoScan = !getSettings(uid).autoScan;
    saveState();
    const status = getSettings(uid).autoScan ? "AÇIK ✅" : "KAPALI ❌";
    try { bot.editMessageText(`Oto Sinyal: ${status}`, { chat_id: uid, message_id: query.message.message_id }); } catch(e) {}
    bot.sendMessage(uid, `Oto Sinyal: ${status}`, { ...getKeyboard(uid) });
    checkGlobalScan();
    return;
  }
});

// --- OTOMATİK ABONELİK (Mesaj gelince) ---
bot.on("message", (msg) => {
  if (msg.from && !msg.from.is_bot) {
    chatIds.add(Number(msg.from.id));
    saveState();
  }
});

// --- MENÜ ---
function getKeyboard(userId) {
  const s = getSettings(userId);
  return {
    reply_markup: {
      keyboard: [
        [{ text: "🚀 Hızlı Tarama" }, { text: "📊 Derin Analiz" }],
        [{ text: "💰 Altcoinler" }, { text: "🦄 Meme Coinler" }],
        [{ text: "📈 Trend Takip" }, { text: "🕰️ Son Sinyaller" }],
        [{ text: "🔔 Oto Sinyal: " + (s.autoScan ? "AÇIK ✅" : "KAPALI ❌") }, { text: "ℹ️ Yardım" }],
        [{ text: "⚙️ Ayarlarım" }, { text: "💼 Portföyüm" }],
        [{ text: "📊 Backtest" }]
      ],
      resize_keyboard: true
    }
  };
}

// --- KOMUTLAR ---
bot.onText(/\/start/, (msg) => {
  const uid = msg.from ? Number(msg.from.id) : msg.chat.id;
  chatIds.add(uid);
  saveState();
  bot.sendMessage(msg.chat.id, "🤖 <b>TRADING PRO BOT</b>\nSistem aktif! Aşağıdaki menüyü kullanabilirsin.", { parse_mode: "HTML", ...getKeyboard(uid) });
});

bot.onText(/🚀 Hızlı Tarama/, (msg) => bot.sendMessage(msg.chat.id, "📂 Seçin:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{text:"BTC", callback_data:"d_BTC/USDT"},{text:"ETH", callback_data:"d_ETH/USDT"}],[{text:"SOL", callback_data:"d_SOL/USDT"},{text:"XRP", callback_data:"d_XRP/USDT"}],[{text:"🔙 Geri", callback_data:"back"}]] }}));
bot.onText(/📊 Derin Analiz/, (msg) => bot.sendMessage(msg.chat.id, "📂 Seçin:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{text:"BTC", callback_data:"d_BTC/USDT"},{text:"AVAX", callback_data:"d_AVAX/USDT"}],[{text:"LINK", callback_data:"d_LINK/USDT"},{text:"DOT", callback_data:"d_DOT/USDT"}],[{text:"🔙 Geri", callback_data:"back"}]] }}));
bot.onText(/💰 Altcoinler/, (msg) => bot.sendMessage(msg.chat.id, "📂 Seçin:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{text:"ADA", callback_data:"d_ADA/USDT"},{text:"NEAR", callback_data:"d_NEAR/USDT"}],[{text:"APT", callback_data:"d_APT/USDT"},{text:"ARB", callback_data:"d_ARB/USDT"}],[{text:"🔙 Geri", callback_data:"back"}]] }}));
bot.onText(/🦄 Meme Coinler/, (msg) => bot.sendMessage(msg.chat.id, "📂 Seçin:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{text:"DOGE", callback_data:"d_DOGE/USDT"},{text:"PEPE", callback_data:"d_PEPE/USDT"}],[{text:"WIF", callback_data:"d_WIF/USDT"},{text:"FLOKI", callback_data:"d_FLOKI/USDT"}],[{text:"🔙 Geri", callback_data:"back"}]] }}));
bot.onText(/📈 Trend Takip/, (msg) => bot.sendMessage(msg.chat.id, "📂 Seçin:", { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{text:"BTC", callback_data:"d_BTC/USDT"},{text:"ETH", callback_data:"d_ETH/USDT"}],[{text:"SOL", callback_data:"d_SOL/USDT"},{text:"AVAX", callback_data:"d_AVAX/USDT"}],[{text:"🔙 Geri", callback_data:"back"}]] }}));

bot.onText(/ℹ️ Yardım/, (msg) => bot.sendMessage(msg.chat.id, "ℹ️ 18 İndikatör, Formasyonlar, AI Skoru.\n⏰ 5dk, 15dk, 1s, 4s.\n\n/skor 75 - Min skor\n/borsa bitget - Borsa seç", { parse_mode: "HTML" }));

bot.onText(/⚙️ Ayarlarım/, (msg) => {
  const s = getSettings(msg.from.id);
  bot.sendMessage(msg.chat.id, "⚙️ Min Skor: <b>" + s.minScore + "</b>\nBorsa: <b>" + s.exchange.toUpperCase() + "</b>\nOto: <b>" + (s.autoScan ? "Açık" : "Kapalı") + "</b>\n\n/skor 75 - Ayarla", { parse_mode: "HTML" });
});

bot.onText(/\/skor (.+)/, (msg, match) => {
  const s = parseInt(match[1]);
  if (s >= 50 && s <= 95) { getSettings(msg.from.id).minScore = s; saveState(); bot.sendMessage(msg.chat.id, "✅ Min skor " + s + " yapıldı."); }
  else bot.sendMessage(msg.chat.id, "❌ 50-95 arası gir.");
});

bot.onText(/\/borsa (.+)/, (msg, match) => {
  const ex = match[1].toLowerCase();
  if (["bitget","binance","bybit"].includes(ex)) { getSettings(msg.from.id).exchange = ex; saveState(); bot.sendMessage(msg.chat.id, "✅ Borsa " + ex + " yapıldı."); }
});

bot.onText(/💼 Portföyüm/, (msg) => bot.sendMessage(msg.chat.id, "💼 <code>/ekle BTC 65000 LONG 100</code>", { parse_mode: "HTML" }));
bot.onText(/📊 Backtest/, (msg) => bot.sendMessage(msg.chat.id, "📊 <code>/backtest BTC</code>", { parse_mode: "HTML" }));

bot.onText(/\/ekle (.+)/, async (msg, match) => {
  const parts = match[1].split(" ");
  if (parts.length < 4) { bot.sendMessage(msg.chat.id, "❌ /ekle BTC 65000 LONG 100"); return; }
  const symbol = parts[0].includes("/") ? parts[0] : parts[0] + "/USDT";
  const entry = parseFloat(parts[1]);
  const type = parts[2].toUpperCase();
  const size = parseFloat(parts[3]);
  if (isNaN(entry) || isNaN(size)) { bot.sendMessage(msg.chat.id, "❌ Sayı gir."); return; }
  try {
    const ex = new ExchangeClient(getSettings(msg.from.id).exchange);
    const price = await ex.getPrice(symbol);
    if (!price) { bot.sendMessage(msg.chat.id, "❌ Fiyat alınamadı."); return; }
    const pnl = type === "LONG" ? (price - entry) * size : (entry - price) * size;
    const pct = ((price - entry) / entry * 100 * (type === "LONG" ? 1 : -1));
    bot.sendMessage(msg.chat.id, "💼 <b>" + symbol + "</b> (" + type + ")\nGiriş: $" + entry + " | Anlık: $" + price + "\n" + (pnl >= 0 ? "🟢" : "🔴") + " K/Z: $" + pnl.toFixed(2) + " (%" + pct.toFixed(2) + ")", { parse_mode: "HTML" });
  } catch(e) { bot.sendMessage(msg.chat.id, "❌ Hata: " + e.message); }
});

bot.onText(/\/backtest (.+)/, (msg, match) => {
  const coin = match[1].includes("/") ? match[1] : match[1] + "/USDT";
  const sigs = loadSignals().filter(s => s.symbol === coin || s.symbol === coin.replace("/USDT", ""));
  if (sigs.length === 0) { bot.sendMessage(msg.chat.id, "❌ Sinyal yok."); return; }
  const tp = sigs.filter(s => s.status && s.status.startsWith("tp")).length;
  const sl = sigs.filter(s => s.status === "sl").length;
  const active = sigs.filter(s => s.status === "active").length;
  const wr = (tp + sl) > 0 ? ((tp / (tp + sl)) * 100).toFixed(1) : "N/A";
  bot.sendMessage(msg.chat.id, "📊 <b>" + coin + "</b>\nToplam: " + sigs.length + "\n✅ TP: " + tp + " | ❌ SL: " + sl + " | ⏳ Aktif: " + active + "\n🏆 Başarı: %" + wr, { parse_mode: "HTML" });
});

// --- SİNYAL FORMATI ---
function formatSignal(s) {
  var tf = s.timeframe === "5m" ? "⚡ 5 Dk" : s.timeframe === "15m" ? "⚡ 15 Dk" : s.timeframe === "1h" ? "🕐 1 Saat" : "📅 4 Saat";
  var isScalp = s.timeframe.indexOf("m") !== -1;
  var fibVal = "Yok";
  if (s.fib && s.fib.levels && s.fib.levels.length > 0) {
    var f618 = s.fib.levels.find(function(l) { return l.level === 0.618; });
    if (f618) fibVal = "$" + f618.price.toFixed(4);
  }
  return (
    (s.type === "LONG" ? "🟢" : "🔴") + " <b>" + s.type + " SİNYALİ</b>\n" +
    "💎 <b>" + s.symbol + "</b> | " + tf + "\n\n" +
    "💵 Giriş: $" + s.entry + "\n" +
    "🎯 TP1: $" + s.tp1 + " | TP2: $" + s.tp2 + "\n" +
    "🛑 Stop: $" + s.sl + "\n\n" +
    "🧠 " + s.reasons.join("\n") + "\n" +
    (isScalp ? "" : "📐 Grafik: " + (s.chartPatterns || "Yok") + "\n🕯️ Mumlar: " + (s.candlestickPatterns || "Yok") + "\n") +
    "📈 RSI: " + s.rsi + " | Stoch: " + s.stochK + " | ADX: " + s.adx + "\n" +
    "☁️ Ichimoku: " + s.ichimoku + " | Supertrend: " + s.supertrend + "\n" +
    "⚖️ VWAP: $" + s.vwap + " | 🎯 Fib: " + fibVal + "\n\n" +
    "🧠 <b>Skor: " + s.aiScore + "/100</b>"
  );
}

// --- TARAMA MOTORU ---
async function runGlobalScan() {
  var activeUsers = Object.entries(userSettings).filter(function(entry) { return entry[1].autoScan; });
  if (activeUsers.length === 0) return;

  var targets = TRADING_PAIRS.filter(function(p) {
    return p.indexOf("/USDT") !== -1 && p.indexOf("XAU") !== 0 && p.indexOf("XAG") !== 0 && p.indexOf("EUR") !== 0;
  });
  console.log("🔍 Global tarama: " + targets.length + " coin, 4 timeframe");

  for (var i = 0; i < targets.length; i += 3) {
    var batch = targets.slice(i, i + 3);
    await Promise.all(batch.map(async function(pair) {
      var tfs = ["5m", "15m", "1h", "4h"];
      var results = await Promise.all(tfs.map(async function(tf) {
        try {
          var ex = new ExchangeClient("bitget");
          var candles = await ex.getKlines(pair, tf, 200);
          if (candles.length < 50) return null;
          return SignalGenerator.generate(candles, pair, tf);
        } catch(e) { return null; }
      }));

      results.forEach(function(sig) {
        if (!sig) return;
        activeUsers.forEach(function(entry) {
          var uid = Number(entry[0]);
          var settings = entry[1];
          if (sig.aiScore < settings.minScore) return;
          if (settings.longOnly && sig.type !== "LONG") return;
          if (settings.shortOnly && sig.type !== "SHORT") return;
          
          addSignal(sig);
          try { bot.sendMessage(uid, formatSignal(sig), { parse_mode: "HTML" }); } catch(e) {}
        });
      });
    }));
    await new Promise(function(r) { setTimeout(r, 2000); });
  }
  
  await checkActiveTrades();
}

function checkGlobalScan() {
  var hasActive = Object.values(userSettings).some(function(s) { return s.autoScan; });
  if (hasActive && !globalScanInterval) {
    console.log("🟢 Oto tarama başlatıldı.");
    globalScanInterval = setInterval(runGlobalScan, CHECK_INTERVAL);
    runGlobalScan();
  } else if (!hasActive && globalScanInterval) {
    console.log("🔴 Oto tarama durduruldu.");
    clearInterval(globalScanInterval);
    globalScanInterval = null;
  }
}

async function checkActiveTrades() {
  var signals = loadSignals().filter(function(s) { return s.status === "active"; });
  for (var i = 0; i < signals.length; i++) {
    var s = signals[i];
    try {
      var ex = new ExchangeClient("bitget");
      var price = await ex.getPrice(s.symbol);
      if (!price) continue;
      var status = null;
      var msg = "";
      if (s.type === "LONG") {
        if (price <= s.sl) { status = "sl"; msg = "❌ STOP: " + s.symbol + " @ $" + price; }
        else if (price >= s.tp2) { status = "tp2"; msg = "🎉 TP2: " + s.symbol + " @ $" + price; }
        else if (price >= s.tp1) { status = "tp1"; msg = "✅ TP1: " + s.symbol + " @ $" + price; }
      } else {
        if (price >= s.sl) { status = "sl"; msg = "❌ STOP: " + s.symbol + " @ $" + price; }
        else if (price <= s.tp2) { status = "tp2"; msg = "🎉 TP2: " + s.symbol + " @ $" + price; }
        else if (price <= s.tp1) { status = "tp1"; msg = "✅ TP1: " + s.symbol + " @ $" + price; }
      }
      if (status) {
        updateSignalStatus(s.id, status);
        chatIds.forEach(function(cid) {
          try { bot.sendMessage(cid, msg, { parse_mode: "HTML" }); } catch(e) {}
        });
      }
    } catch(e) {}
  }
}

// Bot açılınca taramayı başlat
if (Object.values(userSettings).some(function(s) { return s.autoScan; })) {
  globalScanInterval = setInterval(runGlobalScan, CHECK_INTERVAL);
  setTimeout(runGlobalScan, 3000);
}

// --- RENDER KEEP-ALIVE ---
http.createServer(function(req, res) { res.writeHead(200); res.end("Alive"); }).listen(process.env.PORT || 3000);
