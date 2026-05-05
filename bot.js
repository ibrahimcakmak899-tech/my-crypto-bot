const TelegramBot = require("node-telegram-bot-api");
const ExchangeClient = require("./exchange");
const SignalGenerator = require("./signals");
const { TRADING_PAIRS, CHECK_INTERVAL } = require("./config");
const http = require("http");
const fs = require("fs");
const path = require("path");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
if (!TOKEN) { console.error("TOKEN HATASI"); process.exit(1); }

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
    console.warn("State yüklenemedi, temiz başlangıç.");
    saveState();
  }
}

function saveState() {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify({
      chatIds: Array.from(chatIds),
      userSettings: userSettings
    }, null, 2));
  } catch (e) { console.error("Save error:", e); }
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
    saveState();
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
console.log(`Bot hazır. ${chatIds.size} kullanıcı.`);

// --- TEKİL EVENT DİNLEYİCİLERİ (Çakışma yok) ---
bot.on("message", (msg) => {
  if (msg.from && !msg.from.is_bot) {
    chatIds.add(Number(msg.from.id));
    saveState();
  }
});

// Callback Listener (Tüm buton tıklamaları buradan geçer)
bot.on("callback_query", async (query) => {
  const uid = Number(query.from.id);
  const data = query.data;
  
  chatIds.add(uid);
  saveState();
  bot.answerCallbackQuery(query.id);

  try {
    if (data === "back") {
      bot.editMessageText("Ana menüye dönülüyor.", { chat_id: uid, message_id: query.message.message_id });
      bot.sendMessage(uid, "📋 Menü:", { ...getKeyboard(uid) });
      return;
    }
    
    if (data.startsWith("d_")) {
      const pair = data.split("d_")[1];
      const sent = await bot.sendMessage(uid, "🔎 Analiz ediliyor...");
      const ex = new ExchangeClient(getSettings(uid).exchange);
      const candles = await ex.getKlines(pair, "1h", 200);
      const sig = SignalGenerator.generate(candles, pair, "1h");
      
      if (sig) {
        bot.editMessageText(formatSignal(sig), { chat_id: uid, message_id: sent.message_id, parse_mode: "HTML" });
        addSignal(sig);
      } else {
        bot.editMessageText(`📊 ${pair}: Sinyal yok.`, { chat_id: uid, message_id: sent.message_id });
      }
    }
  } catch (e) {
    console.error("Callback Error:", e.message);
  }
});

// --- TEXT KOMUTLARI VE BUTONLAR ---
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "🤖 <b>TRADING PRO BOT</b>\nSistem aktif! Menüyü kullan.", { parse_mode: "HTML", ...getKeyboard(msg.from.id) });
});

// Oto Sinyal Toggle Butonu
bot.onText(/🔔 Oto Sinyal/, (msg) => {
  const uid = Number(msg.from.id);
  const s = getSettings(uid);
  s.autoScan = !s.autoScan;
  saveState();
  
  const status = s.autoScan ? "AÇIK ✅" : "KAPALI ❌";
  bot.sendMessage(msg.chat.id, `🔔 Oto Sinyal: ${status}`, { ...getKeyboard(uid) });
  
  if (s.autoScan) bot.sendMessage(msg.chat.id, "✅ Tarama başlatıldı.");
  else bot.sendMessage(msg.chat.id, "🔕 Tarama durduruldu.");
  
  checkGlobalScan();
});

// Diğer Butonlar
bot.onText(/ℹ️ Yardım/, (msg) => bot.sendMessage(msg.chat.id, "ℹ️ 18 İndikatör, AI Skoru.\n/skor 75 - Min skor\n/borsa bitget", { parse_mode: "HTML" }));
bot.onText(/⚙️ Ayarlarım/, (msg) => {
  const s = getSettings(msg.from.id);
  bot.sendMessage(msg.chat.id, `⚙️ Skor: ${s.minScore} | Borsa: ${s.exchange}`, { parse_mode: "HTML" });
});
bot.onText(/💼 Portföyüm/, (msg) => bot.sendMessage(msg.chat.id, "💼 <code>/ekle BTC 65000 LONG 100</code>", { parse_mode: "HTML" }));
bot.onText(/📊 Backtest/, (msg) => bot.sendMessage(msg.chat.id, "📊 <code>/backtest BTC</code>", { parse_mode: "HTML" }));
bot.onText(/🕰️ Son Sinyaller/, (msg) => {
  const sigs = loadSignals().slice(0, 5);
  if (!sigs.length) return bot.sendMessage(msg.chat.id, "Sinyal yok.");
  const txt = sigs.map(s => `${s.type} ${s.symbol} | ${s.aiScore}`).join("\n");
  bot.sendMessage(msg.chat.id, "🕰️ <b>Son Sinyaller</b>\n" + txt, { parse_mode: "HTML" });
});

// Komutlar
bot.onText(/\/skor (.+)/, (msg, match) => {
  const s = parseInt(match[1]);
  if (s >= 50 && s <= 95) { getSettings(msg.from.id).minScore = s; saveState(); bot.sendMessage(msg.chat.id, "✅ Skor " + s); }
});
bot.onText(/\/borsa (.+)/, (msg, match) => {
  const ex = match[1].toLowerCase();
  if (["bitget","binance","bybit"].includes(ex)) { getSettings(msg.from.id).exchange = ex; saveState(); bot.sendMessage(msg.chat.id, "✅ Borsa " + ex); }
});
bot.onText(/\/ekle (.+)/, async (msg, match) => {
  const parts = match[1].split(" ");
  if (parts.length < 4) return;
  const symbol = parts[0].includes("/") ? parts[0] : parts[0] + "/USDT";
  const entry = parseFloat(parts[1]);
  const type = parts[2].toUpperCase();
  const size = parseFloat(parts[3]);
  
  try {
    const ex = new ExchangeClient("bitget");
    const price = await ex.getPrice(symbol);
    if (!price) return bot.sendMessage(msg.chat.id, "❌ Fiyat yok.");
    
    const pnl = type === "LONG" ? (price - entry) * size : (entry - price) * size;
    const pct = ((price - entry) / entry * 100 * (type === "LONG" ? 1 : -1));
    bot.sendMessage(msg.chat.id, `💼 ${symbol} (${type})\nGiriş: $${entry} | Anlık: $${price}\nK/Z: $${pnl.toFixed(2)} (${pct.toFixed(2)}%)`, { parse_mode: "HTML" });
  } catch(e) { bot.sendMessage(msg.chat.id, "❌ Hata."); }
});
bot.onText(/\/backtest (.+)/, (msg, match) => {
  const coin = match[1].includes("/") ? match[1] : match[1] + "/USDT";
  const sigs = loadSignals().filter(s => s.symbol === coin || s.symbol === coin.replace("/USDT", ""));
  if (sigs.length === 0) return bot.sendMessage(msg.chat.id, "❌ Veri yok.");
  const tp = sigs.filter(s => s.status && s.status.startsWith("tp")).length;
  const sl = sigs.filter(s => s.status === "sl").length;
  bot.sendMessage(msg.chat.id, `📊 ${coin}\nTP: ${tp} | SL: ${sl}`, { parse_mode: "HTML" });
});

// --- MENÜ ---
function getKeyboard(userId) {
  const s = getSettings(userId);
  const autoText = s.autoScan ? "AÇIK ✅" : "KAPALI ❌";
  return {
    reply_markup: {
      keyboard: [
        [{ text: "🔔 Oto Sinyal: " + autoText }],
        [{ text: "🕰️ Son Sinyaller" }, { text: "⚙️ Ayarlarım" }],
        [{ text: "ℹ️ Yardım" }]
      ],
      resize_keyboard: true
    }
  };
}

function formatSignal(s) {
  const tf = s.timeframe === "5m" ? "⚡ 5 Dk" : s.timeframe === "15m" ? "⚡ 15 Dk" : s.timeframe === "1h" ? "🕐 1 Saat" : "📅 4 Saat";
  return `${s.type === "LONG" ? "🟢" : "🔴"} <b>${s.type}</b>\n💎 <b>${s.symbol}</b> | ${tf}\n\n💵 Giriş: $${s.entry}\n🎯 TP1: $${s.tp1}\n🛑 Stop: $${s.sl}\n\n🧠 ${s.reasons.join("\n")}\n📈 RSI: ${s.rsi} | Skor: <b>${s.aiScore}/100</b>`;
}

// --- TARAMA ---
async function runGlobalScan() {
  const activeUsers = Object.entries(userSettings).filter(e => e[1].autoScan);
  if (!activeUsers.length) return;

  console.log("🔍 Global tarama başladı...");
  
  // Başlangıç bildirimi
  activeUsers.forEach(([uid]) => {
      try { bot.sendMessage(Number(uid), "🔍 <b>Tarama Başladı...</b>\n5dk, 15dk, 1s, 4s kontrol ediliyor.", { parse_mode: "HTML" }); } catch(e) {}
  });

  const targets = TRADING_PAIRS.filter(p => p.includes("/USDT") && !p.startsWith("XAU") && !p.startsWith("XAG") && !p.startsWith("EUR"));
  const tfs = ["5m", "15m", "1h", "4h"];
  let errorCount = 0;

  for (const pair of targets) {
    for (const tf of tfs) {
      try {
        const ex = new ExchangeClient("bitget");
        const candles = await ex.getKlines(pair, tf, 200);
        
        if (!candles || candles.length < 50) {
           console.log(`⚠️ ${pair} ${tf}: Veri yetersiz.`);
           continue;
        }

        const sig = SignalGenerator.generate(candles, pair, tf);
        
        if (sig) {
          console.log(`📈 Sinyal Adayı: ${pair} ${tf} | Skor: ${sig.aiScore}`);
          activeUsers.forEach(([uid, settings]) => {
             if (sig.aiScore >= settings.minScore) {
                addSignal(sig);
                try { bot.sendMessage(Number(uid), formatSignal(sig), { parse_mode: "HTML" }); } catch(e) {}
             }
          });
        }
      } catch(e) {
        console.error(`❌ HATA: ${pair} ${tf} - ${e.message}`);
        errorCount++;
        // Hataları kullanıcıya bildir (Spam olmasın diye sadece sayıyı söyleyeceğiz sonda)
      }
    }
    // API limitine takılmamak için her coin arası 1 saniye bekle
    await new Promise(r => setTimeout(r, 1000));
  }
  
  // Bitiş bildirimi
  activeUsers.forEach(([uid]) => {
      const msg = errorCount > 0 
          ? `✅ Tarama bitti. <b>${errorCount} hata</b> tespit edildi.` 
          : `✅ Tarama tamamlandı, hata yok.`;
      try { bot.sendMessage(Number(uid), msg, { parse_mode: "HTML" }); } catch(e) {}
  });
}

function checkGlobalScan() {
  const hasActive = Object.values(userSettings).some(s => s.autoScan);
  if (hasActive && !globalScanInterval) {
    console.log("🟢 Tarama aktif.");
    globalScanInterval = setInterval(runGlobalScan, CHECK_INTERVAL);
    runGlobalScan();
  } else if (!hasActive && globalScanInterval) {
    console.log("🔴 Tarama pasif.");
    clearInterval(globalScanInterval);
    globalScanInterval = null;
  }
}

if (Object.values(userSettings).some(s => s.autoScan)) {
  setTimeout(() => {
    globalScanInterval = setInterval(runGlobalScan, CHECK_INTERVAL);
    runGlobalScan();
  }, 5000);
}

http.createServer((req, res) => { res.writeHead(200); res.end("Alive"); }).listen(process.env.PORT || 3000);
