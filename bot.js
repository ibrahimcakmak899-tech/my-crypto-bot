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

const chatIds = new Set();
const groups = new Set();
let autoScanRunning = false;
let autoScanInterval = null;

// Dosya Yolları
const SIGNALS_PATH = path.join(__dirname, "signals.json");
const CHAT_IDS_PATH = path.join(__dirname, "chat_ids.json");

// --- VERİ TABANI İŞLEMLERİ ---
function loadSignals() {
  try {
    if (fs.existsSync(SIGNALS_PATH)) {
      return JSON.parse(fs.readFileSync(SIGNALS_PATH, "utf8"));
    }
  } catch (e) { console.error("Veri yükleme hatası:", e); }
  return [];
}

function saveSignals(signals) {
  try {
    fs.writeFileSync(SIGNALS_PATH, JSON.stringify(signals, null, 2));
  } catch (e) { console.error("Veri kaydetme hatası:", e); }
}

function loadChatIds() {
  try {
    if (fs.existsSync(CHAT_IDS_PATH)) {
      const data = JSON.parse(fs.readFileSync(CHAT_IDS_PATH, "utf8"));
      if (data.users) data.users.forEach(id => chatIds.add(id));
      if (data.groups) data.groups.forEach(id => groups.add(id));
    }
  } catch (e) { console.error("Kullanıcı yükleme hatası:", e); }
}

function saveChatIds() {
  try {
    const data = { users: Array.from(chatIds), groups: Array.from(groups) };
    fs.writeFileSync(CHAT_IDS_PATH, JSON.stringify(data));
  } catch (e) { console.error("Kaydetme hatası:", e); }
}

function getUserSettings(userId) {
  const settingsPath = path.join(__dirname, `settings_${userId}.json`);
  try {
    if (fs.existsSync(settingsPath)) {
      return JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    }
  } catch (e) {}
  return { minScore: 70, exchange: "bitget", longOnly: false, shortOnly: false };
}

function updateUserSetting(userId, key, value) {
  const settings = getUserSettings(userId);
  settings[key] = value;
  try {
    fs.writeFileSync(path.join(__dirname, `settings_${userId}.json`), JSON.stringify(settings));
  } catch (e) {}
}

function addSignal(signal) {
  const signals = loadSignals();
  signal.id = Date.now() + "_" + signal.symbol + "_" + signal.timeframe;
  signal.status = "active";
  signal.timestamp = Date.now();
  signals.unshift(signal);
  if (signals.length > 100) signals.splice(50);
  saveSignals(signals);
}

function updateSignalStatus(id, status) {
  const signals = loadSignals();
  const index = signals.findIndex(s => s.id === id);
  if (index !== -1) {
    signals[index].status = status;
    signals[index].closeTime = Date.now();
    saveSignals(signals);
  }
}

// --- SABİT KLAVYE ---
function replyKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: "🚀 Hızlı Tarama" }, { text: "📊 Derin Analiz" }],
        [{ text: "💰 Altcoinler" }, { text: "🦄 Meme Coinler" }],
        [{ text: "📈 Trend Takip" }, { text: "🕰️ Son Sinyaller" }],
        [{ text: "🔔 Oto Sinyal: KAPALI" }, { text: "ℹ️ Yardım" }],
        [{ text: "⚙️ Ayarlarım" }, { text: "💼 Portföyüm" }],
        [{ text: "📊 Backtest" }]
      ],
      resize_keyboard: true
    }
  };
}

function startMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚀 SİNYALLERİ BAŞLAT", callback_data: "start_btn" }]
      ]
    }
  };
}

function getExchangeForUser(userId) {
  const settings = getUserSettings(userId);
  const apiKey = process.env[`${settings.exchange.toUpperCase()}_API_KEY`] || "";
  const secret = process.env[`${settings.exchange.toUpperCase()}_SECRET`] || "";
  const password = process.env[`${settings.exchange.toUpperCase()}_PASSPHRASE`] || "";
  return new ExchangeClient(settings.exchange, apiKey, secret, password);
}

// --- KAYITLI KULLANICILARI YÜKLE ---
loadChatIds();
console.log(`📋 ${chatIds.size} kullanıcı, ${groups.size} grup yüklendi.`);

// --- TEXT KOMUTLARI ---
bot.onText(/\/start/, (msg) => {
  chatIds.add(msg.chat.id);
  saveChatIds();

  if (msg.chat.type === "group" || msg.chat.type === "supergroup") {
    groups.add(msg.chat.id);
    saveChatIds();
    bot.sendMessage(msg.chat.id, `✅ <b>Grup Bildirimleri Aktif!</b>\nArtık tüm sinyaller bu gruba da gönderilecek.`, { parse_mode: "HTML" });
    return;
  }

  // Kullanıcı zaten kayıtlıysa direkt menü
  if (chatIds.has(msg.chat.id)) {
    bot.sendMessage(msg.chat.id, `🤖 <b>TRADING PRO BOT</b>\n\nSistem çalışıyor! Aşağıdaki menüyü kullanabilirsin.`, { parse_mode: "HTML", ...replyKeyboard() });
  } else {
    bot.sendMessage(msg.chat.id, `👋 <b>Merhaba! Trading Pro Bot'a hoş geldin.</b>\n\n🤖 Ben senin kişisel teknik analiz asistanınım.\n📊 18 indikatör, grafik formasyonları ve AI skoru ile piyasayı tarıyorum.\n\n🚀 Analize başlamak için butona tıkla!`, { parse_mode: "HTML", ...startMenu() });
  }
});

bot.on("new_chat_members", (msg) => {
  msg.new_chat_members.forEach(member => {
    if (member.is_bot) {
      groups.add(msg.chat.id);
      saveChatIds();
      bot.sendMessage(msg.chat.id, `🤖 <b>Gruba katıldım!</b>\n\nOtomatik sinyal bildirimleri burada da aktif olacak.\nBir yönetici /start yazarak botu başlatabilir.`, { parse_mode: "HTML", ...replyKeyboard() });
    }
  });
});

bot.onText(/⚙️ Ayarlarım/, (msg) => {
  const userId = msg.from.id;
  const s = getUserSettings(userId);
  const txt = `⚙️ <b>Kişisel Ayarların</b>\n\n` +
    `📊 Min. Güven Skoru: <b>${s.minScore}</b>\n` +
    `🔄 Borsa: <b>${s.exchange.toUpperCase()}</b>\n` +
    `🟢 Sadece LONG: ${s.longOnly ? "Açık" : "Kapalı"}\n` +
    `🔴 Sadece SHORT: ${s.shortOnly ? "Açık" : "Kapalı"}\n\n` +
    `Skor eşiğini değiştir:\n` +
    `/skor 65 - Normal sinyaller\n` +
    `/skor 75 - Güçlü sinyaller\n` +
    `/skor 85 - Sadece çok güçlüler`;
  bot.sendMessage(msg.chat.id, txt, { parse_mode: "HTML" });
});

bot.onText(/\/skor (.+)/, (msg, match) => {
  const score = parseInt(match[1]);
  if (score < 50 || score > 95) {
    bot.sendMessage(msg.chat.id, "❌ Skor 50-95 arasında olmalı.");
    return;
  }
  updateUserSetting(msg.from.id, "minScore", score);
  bot.sendMessage(msg.chat.id, `✅ Minimum güven skoru <b>${score}</b> olarak ayarlandı.`, { parse_mode: "HTML" });
});

bot.onText(/\/borsa (.+)/, (msg, match) => {
  const ex = match[1].toLowerCase();
  const supported = ExchangeClient.getSupportedExchanges();
  if (!supported.includes(ex)) {
    bot.sendMessage(msg.chat.id, `❌ Desteklenen borsalar: ${supported.join(", ")}`);
    return;
  }
  updateUserSetting(msg.from.id, "exchange", ex);
  bot.sendMessage(msg.chat.id, `✅ Borsa <b>${ex.toUpperCase()}</b> olarak değiştirildi.`, { parse_mode: "HTML" });
});

bot.onText(/💼 Portföyüm/, (msg) => {
  bot.sendMessage(msg.chat.id, "💼 <b>Portföy Takibi</b>\n\nTakip etmek istediğin pozisyonu yaz:\n<code>/ekle BTC 65000 LONG 100</code>\n\nFormat: /ekle SEMBOL GIRIS_FIYATI TÜR MİKTAR", { parse_mode: "HTML" });
});

bot.onText(/\/ekle (.+)/, async (msg, match) => {
  const parts = match[1].split(" ");
  if (parts.length < 4) {
    bot.sendMessage(msg.chat.id, "❌ Format: <code>/ekle BTC 65000 LONG 100</code>", { parse_mode: "HTML" });
    return;
  }
  const [symbolRaw, entry, type, amount] = parts;
  const symbol = symbolRaw.includes("/") ? symbolRaw : `${symbolRaw}/USDT`;
  const entryPrice = parseFloat(entry);
  const positionType = type.toUpperCase();
  const size = parseFloat(amount);
  
  if (isNaN(entryPrice) || isNaN(size)) {
    bot.sendMessage(msg.chat.id, "❌ Fiyat ve miktar sayı olmalı.");
    return;
  }

  const exchange = getExchangeForUser(msg.from.id);
  const currentPrice = await exchange.getPrice(symbol);
  if (!currentPrice) {
    bot.sendMessage(msg.chat.id, "❌ Fiyat alınamadı. Borsa API anahtarlarını kontrol et.");
    return;
  }

  let pnl, pnlPercent;
  if (positionType === "LONG") {
    pnl = (currentPrice - entryPrice) * size;
    pnlPercent = ((currentPrice - entryPrice) / entryPrice) * 100;
  } else {
    pnl = (entryPrice - currentPrice) * size;
    pnlPercent = ((entryPrice - currentPrice) / entryPrice) * 100;
  }

  const icon = pnl >= 0 ? "🟢" : "🔴";
  const txt = `💼 <b>Portföy Durumu</b>\n\n` +
    `💎 <b>${symbol}</b> (${positionType})\n` +
    `📥 Giriş: $${entryPrice}\n` +
    `📈 Anlık: $${currentPrice}\n` +
    `📊 Miktar: ${size}\n\n` +
    `${icon} <b>K/Z: $${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)</b>`;
  bot.sendMessage(msg.chat.id, txt, { parse_mode: "HTML" });
});

bot.onText(/📊 Backtest/, (msg) => {
  bot.sendMessage(msg.chat.id, "📊 <b>Backtest</b>\n\nHangi coinin geçmiş performansını görmek istersin?\n<code>/backtest BTC</code> veya <code>/backtest SOL</code>", { parse_mode: "HTML" });
});

bot.onText(/\/backtest (.+)/, (msg, match) => {
  const coin = match[1].includes("/") ? match[1] : `${match[1]}/USDT`;
  const signals = loadSignals().filter(s => s.symbol === coin || s.symbol === coin.replace("/USDT", ""));
  
  if (signals.length === 0) {
    bot.sendMessage(msg.chat.id, `❌ <b>${coin}</b> için geçmiş sinyal bulunamadı.`);
    return;
  }

  let total = signals.length;
  let tpHits = signals.filter(s => s.status === "tp1" || s.status === "tp2" || s.status === "tp3").length;
  let slHits = signals.filter(s => s.status === "sl").length;
  let active = signals.filter(s => s.status === "active").length;
  let winRate = (tpHits + slHits) > 0 ? ((tpHits / (tpHits + slHits)) * 100).toFixed(1) : "N/A";

  const longCount = signals.filter(s => s.type === "LONG").length;
  const shortCount = signals.filter(s => s.type === "SHORT").length;
  const avgScore = (signals.reduce((a, s) => a + s.aiScore, 0) / total).toFixed(1);

  const txt = `📊 <b>${coin} - Backtest Sonuçları</b>\n\n` +
    `📈 Toplam Sinyal: <b>${total}</b>\n` +
    `✅ TP Aldı: <b>${tpHits}</b>\n` +
    `❌ Stop Oldu: <b>${slHits}</b>\n` +
    `⏳ Aktif: <b>${active}</b>\n\n` +
    `🏆 <b>Başarı Oranı: %${winRate}</b>\n` +
    `🟢 LONG: ${longCount} | 🔴 SHORT: ${shortCount}\n` +
    `🧠 Ort. Skor: ${avgScore}`;
  bot.sendMessage(msg.chat.id, txt, { parse_mode: "HTML" });
});

// Buton text komutları
bot.onText(/🚀 Hızlı Tarama/, (msg) => {
  bot.sendMessage(msg.chat.id, "📂 <b>Kategoriler</b>\nSeçin:", { parse_mode: "HTML", ...scanMenu("major") });
});

bot.onText(/📊 Derin Analiz/, (msg) => {
  bot.sendMessage(msg.chat.id, "📂 <b>Kategoriler</b>\nSeçin:", { parse_mode: "HTML", ...scanMenu("trend") });
});

bot.onText(/💰 Altcoinler/, (msg) => {
  bot.sendMessage(msg.chat.id, "📂 <b>Kategoriler</b>\nSeçin:", { parse_mode: "HTML", ...scanMenu("major") });
});

bot.onText(/🦄 Meme Coinler/, (msg) => {
  bot.sendMessage(msg.chat.id, "📂 <b>Kategoriler</b>\nSeçin:", { parse_mode: "HTML", ...scanMenu("meme") });
});

bot.onText(/📈 Trend Takip/, (msg) => {
  bot.sendMessage(msg.chat.id, "📂 <b>Kategoriler</b>\nSeçin:", { parse_mode: "HTML", ...scanMenu("trend") });
});

bot.onText(/🕰️ Son Sinyaller/, (msg) => {
  const signals = loadSignals();
  let txt = "🕰️ <b>Son Sinyaller ve Durumları</b>\n\n";
  if (signals.length === 0) txt += "Henüz hiç sinyal yok.";
  else {
    signals.slice(0, 10).forEach(s => {
      let icon = s.status === "sl" ? "❌" : s.status.startsWith("tp") ? "✅" : "⏳";
      txt += `${icon} <b>${s.symbol}</b> (${s.type} | ${s.timeframe}) | Skor: ${s.aiScore}\n`;
      if (s.status !== "active") txt += `   <b>Sonuç: ${s.status.toUpperCase()}</b>\n`;
      else txt += `   Giriş: $${s.entry} | SL: $${s.sl}\n`;
      txt += "\n";
    });
  }
  bot.sendMessage(msg.chat.id, txt, { parse_mode: "HTML" });
});

bot.onText(/ℹ️ Yardım/, (msg) => {
  bot.sendMessage(msg.chat.id, "ℹ️ <b>BOT HAKKINDA</b>\n\n📈 18 İndikatör, Grafik Formasyonları, AI Skoru.\n⏰ 5dk, 15dk, 1s, 4s zaman dilimleri.\n🚨 Kırılım takibi ve otomatik sinyal bildirimleri.\n💾 100 sinyal geçmişi.\n\n⚙️ <b>Komutlar:</b>\n/skor [50-95] - Min bildirim skoru\n/borsa [bitget/binance/bybit] - Borsa seç\n/ekle BTC 65000 LONG 100 - Portföy takibi\n/backtest BTC - Geçmiş performans", { parse_mode: "HTML" });
});

// --- CALLBACK QUERY ---
bot.on("callback_query", async (query) => {
  const data = query.data;
  bot.answerCallbackQuery(query.id);

  if (data === "start_btn") {
    chatIds.add(query.message.chat.id);
    saveChatIds();
    bot.deleteMessage(query.message.chat.id, query.message.message_id);
    bot.sendMessage(query.message.chat.id, `✅ <b>Sistem Başlatıldı!</b>\n\n🔔 Artık tüm sinyaller ve kırılımlar buraya düşecek.\nMenüden istediğin analizi seçebilirsin.`, { parse_mode: "HTML", ...replyKeyboard() });
    return;
  }

  if (data === "back_menu") {
    bot.editMessageText("🤖 <b>TRADING PRO BOT</b>\nAna menüye döndünüz.", { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: "HTML" });
    bot.sendMessage(query.message.chat.id, "📋 Menüyü kullan:", { ...replyKeyboard() });
    return;
  }

  if (data.startsWith("detail_")) {
    const pair = data.split("detail_")[1];
    const userId = query.message.chat.id;
    const msg = await bot.sendMessage(query.message.chat.id, `🔎 ${pair} analiz ediliyor...`);
    const exchange = getExchangeForUser(userId);
    const candles = await exchange.getKlines(pair, "1h", 200);
    if (!candles.length) { bot.editMessageText(`❌ Veri yok.`, { chat_id: query.message.chat.id, message_id: msg.message_id }); return; }
    const signal = SignalGenerator.generate(candles, pair, "1h");
    if (signal) {
      bot.editMessageText(formatSignal(signal), { chat_id: query.message.chat.id, message_id: msg.message_id, parse_mode: "HTML" });
      addSignal(signal);
    } else { bot.editMessageText(`📊 ${pair}: Net sinyal yok.`, { chat_id: query.message.chat.id, message_id: msg.message_id, parse_mode: "HTML" }); }
    return;
  }

  if (data.startsWith("scan_")) {
    const cat = data.split("scan_")[1];
    bot.editMessageText("📂 <b>Kategoriler</b>\nSeçin:", { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: "HTML", ...scanMenu(cat) });
    return;
  }

  if (data === "toggle_auto") {
    autoScanRunning = !autoScanRunning;
    const status = autoScanRunning ? "AÇIK ✅" : "KAPALI ❌";
    bot.editMessageText(autoScanRunning ? "🔔 <b>OTO SİNYAL AÇIK</b>\nKırılım ve Trend takibi başlatıldı!" : "🔕 <b>OTO SİNYAL KAPALI</b>", { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: "HTML" });
    const newKeyboard = replyKeyboard();
    newKeyboard.reply_markup.keyboard[3][0].text = `🔔 Oto Sinyal: ${status}`;
    bot.sendMessage(query.message.chat.id, `Oto Sinyal: ${status}`, { ...newKeyboard });
    if (autoScanRunning) {
      clearInterval(autoScanInterval);
      autoScanInterval = setInterval(runAutoScan, CHECK_INTERVAL);
      runAutoScan();
    } else clearInterval(autoScanInterval);
    return;
  }

  if (data === "history") {
    const signals = loadSignals();
    let txt = "🕰️ <b>Son Sinyaller ve Durumları</b>\n\n";
    if (signals.length === 0) txt += "Henüz hiç sinyal yok.";
    else {
      signals.slice(0, 10).forEach(s => {
        let icon = s.status === "sl" ? "❌" : s.status.startsWith("tp") ? "✅" : "⏳";
        txt += `${icon} <b>${s.symbol}</b> (${s.type}) | Giriş: $${s.entry} | Skor: ${s.aiScore}\n`;
        if (s.status !== "active") txt += `   <b>Sonuç: ${s.status.toUpperCase()}</b>\n`;
        else txt += `   SL: $${s.sl} | TP1: $${s.tp1}\n`;
        txt += "\n";
      });
    }
    bot.editMessageText(txt, { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: "HTML" });
    return;
  }
});

// --- MENÜ ---
function scanMenu(category) {
  const rows = [];
  const pairs = getPairsByCategory(category);
  for (let i = 0; i < pairs.length; i += 2) {
    rows.push([{ text: pairs[i].replace("/USDT", ""), callback_data: `detail_${pairs[i]}` }]);
    if (pairs[i+1]) rows[rows.length-1].push({ text: pairs[i+1].replace("/USDT", ""), callback_data: `detail_${pairs[i+1]}` });
  }
  rows.push([{ text: "🔙 Ana Menü", callback_data: "back_menu" }]);
  return { reply_markup: { inline_keyboard: rows } };
}

function getPairsByCategory(cat) {
  if (cat === "forex") return ["BTC/USDT", "ETH/USDT", "SOL/USDT", "XRP/USDT", "AVAX/USDT"];
  if (cat === "meme") return ["DOGE/USDT", "PEPE/USDT", "WIF/USDT", "SHIB/USDT", "FLOKI/USDT"];
  if (cat === "major") return ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT"];
  if (cat === "trend") return ["BTC/USDT", "ETH/USDT", "SOL/USDT", "AVAX/USDT", "LINK/USDT", "DOT/USDT"];
  return TRADING_PAIRS.slice(0, 15); 
}

// --- SİNYAL FORMATI ---
function formatSignal(signal) {
  const emoji = signal.type === "LONG" ? "🟢" : "🔴";
  const isScalp = signal.timeframe.includes("m") && parseInt(signal.timeframe) <= 15;
  
  let fibText = "Yok";
  if (signal.fib && signal.fib.levels) {
    fibText = signal.fib.levels.slice(0, 3).map(l => `${l.level}: $${l.price.toFixed(4)}`).join(" | ");
  }

  const tfLabel = signal.timeframe === "5m" ? "⚡ 5 Dk" : signal.timeframe === "15m" ? "⚡ 15 Dk" : signal.timeframe === "1h" ? "🕐 1 Saatlik" : signal.timeframe === "4h" ? "📅 4 Saatlik" : signal.timeframe;

  const patternText = isScalp ? "📊 <i>Scalp: İndikatör odaklı</i>" : `\n📐 <b>Grafik:</b> ${signal.chartPatterns || "Yok"}\n🕯️ <b>Mumlar:</b> ${signal.candlestickPatterns || "Yok"}`;
  
  return `
${emoji} <b>${signal.type} SİNYALİ</b> ${emoji}
💎 <b>${signal.symbol}</b> | ${tfLabel}

💵 Giriş: $${signal.entry}
🎯 TP1: $${signal.tp1} | TP2: $${signal.tp2}
🛑 Stop: $${signal.sl}

🧠 ${signal.reasons.filter(r => !r.startsWith("🕯️") && !r.startsWith("📐")).join("\n")}
${patternText}
📈 RSI: ${signal.rsi} | Stoch: ${signal.stochK} | ADX: ${signal.adx}
☁️ Ichimoku: ${signal.ichimoku} | 🟢 Supertrend: ${signal.supertrend}
📡 PSAR: ${signal.psar} | ⚖️ VWAP: $${signal.vwap}
🎯 <b>Fib:</b> ${fibText}

🧠 <b>Güven Skoru: ${signal.aiScore}/100</b>
${signal.aiScore > 80 ? "🔥 ÇOK YÜKSEK İHTİMAL" : signal.aiScore > 70 ? "✅ GÜÇLÜ SİNYAL" : "👀 RİSKLİ / İZLE"}
`.trim();
}

// --- OTOMATİK TARAMA ---
let scanIndex = 0;

async function runAutoScan() {
  if (!autoScanRunning) return;
  
  const targets = TRADING_PAIRS.filter(p => p.includes("/USDT") && !p.startsWith("XAU") && !p.startsWith("XAG") && !p.startsWith("EUR") && !p.startsWith("GBP") && !p.startsWith("AUD") && !p.startsWith("USD"));
  console.log(`🔍 Otomatik tarama başlıyor... (${targets.length} coin)`);
  
  // Her turda 3 coin tara, hepsini 4 timeframe'de
  const batchSize = 3;
  const timeframes = ["5m", "15m", "1h", "4h"];
  const batch = targets.slice(scanIndex, scanIndex + batchSize);
  
  scanIndex = (scanIndex + batchSize) % targets.length;
  if (scanIndex === 0) console.log("🔄 Tüm coinler tarandı, başa dönülüyor.");
  
  for (const pair of batch) {
    for (const tf of timeframes) {
      try {
        const exchange = new ExchangeClient("bitget"); // Public veri için API'siz
        const candles = await exchange.getKlines(pair, tf, 200);
        if (candles.length < 50) continue;
        
        const signal = SignalGenerator.generate(candles, pair, tf);
        
        if (signal && signal.aiScore >= 70) {
          addSignal(signal);
          notifySignal(signal);
        }

        // Sadece 4h'te kırılım kontrolü
        if (tf === "4h") {
          const analysis = require("./analysis");
          const ind = analysis.compute(candles);
          const breakouts = SignalGenerator.checkBreakouts(ind, pair);
          for (const b of breakouts) {
            const signals = loadSignals();
            const recentBreakout = signals.find(s => s.symbol === pair && s.type === b.type && (Date.now() - s.timestamp < 7200000));
            if (!recentBreakout) {
               notifyBreakout(b);
               addSignal({ symbol: pair, type: b.type === "BREAKOUT" ? "LONG" : "SHORT", entry: b.price, aiScore: 90, timestamp: Date.now(), reasons: ["Kırılım Tespiti"] });
            }
          }
        }
      } catch (e) { /* sessiz geç */ }
    }
  }

  await checkActiveTrades();
}

async function checkActiveTrades() {
  const signals = loadSignals();
  const activeSignals = signals.filter(s => s.status === "active");

  for (const s of activeSignals) {
    try {
      const exchange = new ExchangeClient("bitget");
      const currentPrice = await exchange.getPrice(s.symbol);
      if (!currentPrice) continue;

      let newStatus = null;
      let msg = "";

      if (s.type === "LONG") {
        if (currentPrice <= s.sl) { newStatus = "sl"; msg = `❌ <b>STOP OLDU!</b>\n${s.symbol} @ $${currentPrice}`; }
        else if (currentPrice >= s.tp2) { newStatus = "tp2"; msg = `🎉 <b>TP2 ALDI!</b>\n${s.symbol} @ $${currentPrice}`; }
        else if (currentPrice >= s.tp1) { newStatus = "tp1"; msg = `✅ <b>TP1 ALDI!</b>\n${s.symbol} @ $${currentPrice}`; }
      } else if (s.type === "SHORT") {
        if (currentPrice >= s.sl) { newStatus = "sl"; msg = `❌ <b>STOP OLDU!</b>\n${s.symbol} @ $${currentPrice}`; }
        else if (currentPrice <= s.tp2) { newStatus = "tp2"; msg = `🎉 <b>TP2 ALDI!</b>\n${s.symbol} @ $${currentPrice}`; }
        else if (currentPrice <= s.tp1) { newStatus = "tp1"; msg = `✅ <b>TP1 ALDI!</b>\n${s.symbol} @ $${currentPrice}`; }
      }

      if (newStatus) {
        updateSignalStatus(s.id, newStatus);
        for (const cid of [...chatIds, ...groups]) {
          try { await bot.sendMessage(cid, msg, { parse_mode: "HTML" }); } catch(e) {}
        }
      }
    } catch (e) { console.error(`Kontrol Hatası: ${s.symbol}`, e.message); }
  }
}

function notifyBreakout(b) {
  const msg = `🚨 <b>KIRILIM TESPİT EDİLDİ!</b> 🚨\n${b.msg}\n\n<b>Sembol:</b> ${b.symbol}\n<b>Fiyat:</b> $${b.price}\n<b>Seviye:</b> $${b.level}\n\n🔥 <b>HACİM DESTEKLİ!</b>`;
  for (const cid of [...chatIds, ...groups]) { try { bot.sendMessage(cid, msg, { parse_mode: "HTML" }); } catch(e) {} }
}

function notifySignal(signal) {
  const msg = formatSignal(signal);
  console.log(`📡 Sinyal Bildirimi: ${signal.symbol} (${signal.timeframe}) - ${chatIds.size + groups.size} hedefe gönderiliyor.`);
  for (const cid of [...chatIds, ...groups]) { 
      try { bot.sendMessage(cid, msg, { parse_mode: "HTML" }); } 
      catch(e) { console.error(`❌ Bildirim hatası (ID: ${cid}):`, e.message); } 
  }
}

// --- RENDER KEEP-ALIVE ---
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot is alive.");
}).listen(process.env.PORT || 3000, () => {
  console.log(`✅ Sunucu port ${process.env.PORT || 3000} üzerinde çalışıyor.`);
});
