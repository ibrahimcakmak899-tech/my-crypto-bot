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
const exchange = new ExchangeClient();

const chatIds = new Set();
let autoScanRunning = false;
let autoScanInterval = null;

// Dosya Yolları
const SIGNALS_PATH = path.join(__dirname, "signals.json");
const USERS_PATH = path.join(__dirname, "users.json");

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
    if (fs.existsSync(USERS_PATH)) {
      const ids = JSON.parse(fs.readFileSync(USERS_PATH, "utf8"));
      ids.forEach(id => chatIds.add(id));
    }
  } catch (e) { console.error("Kullanıcı yükleme hatası:", e); }
}

function saveChatIds() {
  try {
    fs.writeFileSync(USERS_PATH, JSON.stringify(Array.from(chatIds)));
  } catch (e) { console.error("Kullanıcı kaydetme hatası:", e); }
}

function addSignal(signal) {
  const signals = loadSignals();
  signal.id = Date.now() + "_" + signal.symbol;
  signal.status = "active"; // active, tp1, tp2, sl
  signal.timestamp = Date.now();
  signals.unshift(signal); // En başa ekle
  if (signals.length > 50) signals.pop();
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

// --- MENÜ TANIMLARI ---
function startMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🚀 SİNYALLERİ BAŞLAT", callback_data: "start_btn" }]
      ]
    }
  };
}

function mainMenu() {
  return {
    reply_markup: {
      inline_keyboard: [
        [
          { text: "🚀 Hızlı Tarama", callback_data: "scan_fast" },
          { text: "🔍 Derin Analiz", callback_data: "scan_deep" }
        ],
        [
          { text: "💰 Altın & Forex", callback_data: "scan_forex" },
          { text: "🦄 Meme Coinler", callback_data: "scan_meme" }
        ],
        [
          { text: "📊 Trend Takibi", callback_data: "scan_trend" },
          { text: "🕰️ Son Sinyaller", callback_data: "history" }
        ],
        [
          { text: "🔔 Oto Sinyal", callback_data: "toggle_auto" },
          { text: "ℹ️ Yardım", callback_data: "help" }
        ]
      ]
    }
  };
}

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

// --- BOT OLAYLARI ---

// Kayıtlı kullanıcıları yükle
loadChatIds();

bot.onText(/\/start/, (msg) => {
  chatIds.add(msg.chat.id);
  saveChatIds();
  
  // İlk açılışta buton göster
  bot.sendMessage(msg.chat.id, 
    `👋 <b>Merhaba! Trading Pro Bot'a hoş geldin.</b>\n\n` +
    `🤖 Ben senin kişisel teknik analiz asistanınım.\n` +
    `📊 18 indikatör, grafik formasyonları ve AI skoru ile piyasayı tarıyorum.\n\n` +
    `🚀 Analize başlamak için butona tıkla!`, 
    { parse_mode: "HTML", ...startMenu() }
  );
});

bot.on("callback_query", async (query) => {
  const data = query.data;
  bot.answerCallbackQuery(query.id);

  // Start Button Handler
  if (data === "start_btn") {
    chatIds.add(query.message.chat.id);
    saveChatIds();
    
    bot.editMessageText(
      `✅ <b>Sistem Başlatıldı!</b>\n\n` +
      `🔔 Artık tüm sinyaller ve kırılımlar buraya düşecek.\n` +
      `Menüden istediğin analizi seçebilirsin.`,
      { 
        chat_id: query.message.chat.id, 
        message_id: query.message.message_id, 
        parse_mode: "HTML", 
        ...mainMenu() 
      }
    );
    return;
  }

  if (data === "back_menu") {
    bot.editMessageText("🤖 <b>TRADING PRO BOT</b>\nAna menüye döndünüz.", { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: "HTML", ...mainMenu() });
    return;
  }

  if (data === "history") {
    const signals = loadSignals();
    let msg = "🕰️ <b>Son Sinyaller ve Durumları</b>\n\n";
    
    if (signals.length === 0) {
      msg += "Henüz hiç sinyal yok.";
    } else {
      signals.slice(0, 10).forEach(s => {
        let icon = "⏳";
        if (s.status === "tp1" || s.status === "tp2" || s.status === "tp3") icon = "✅";
        if (s.status === "sl") icon = "❌";
        
        msg += `${icon} <b>${s.symbol}</b> (${s.type})\n`;
        msg += `   Giriş: $${s.entry} | Skor: ${s.aiScore}\n`;
        if (s.status !== "active") msg += `   <b>Sonuç: ${s.status.toUpperCase()}</b>\n`;
        else msg += `   SL: $${s.sl} | TP1: $${s.tp1}\n`;
        msg += "\n";
      });
    }
    
    bot.editMessageText(msg, { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: "HTML", ...mainMenu() });
    return;
  }

  if (data.startsWith("detail_")) {
    const pair = data.split("detail_")[1];
    const msg = await bot.sendMessage(query.message.chat.id, `🔎 ${pair} analiz ediliyor...`);
    const candles = await exchange.getKlines(pair, "1h", 200);
    if (!candles.length) { bot.editMessageText(`❌ Veri yok.`, { chat_id: query.message.chat.id, message_id: msg.message_id }); return; }
    const signal = SignalGenerator.generate(candles, pair, "1h");
    if (signal) {
      bot.editMessageText(formatSignal(signal), { chat_id: query.message.chat.id, message_id: msg.message_id, parse_mode: "HTML" });
      addSignal(signal); // Kaydet
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
    bot.editMessageText(autoScanRunning ? "🔔 <b>OTO SİNYAL AÇIK</b>\nKırılım ve Trend takibi başlatıldı! Sonuçlar kaydedilecek." : "🔕 <b>OTO SİNYAL KAPALI</b>", { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: "HTML", ...mainMenu() });
    if (autoScanRunning) {
      clearInterval(autoScanInterval);
      autoScanInterval = setInterval(runAutoScan, CHECK_INTERVAL);
      runAutoScan();
    } else clearInterval(autoScanInterval);
    return;
  }

  if (data === "help") {
    bot.editMessageText("ℹ️ <b>BOT HAKKINDA</b>\n\n📈 İndikatörler: RSI, MACD, Stokastik, ADX, Ichimoku, VWAP.\n📐 Formasyonlar: OBO, İkili Tepe, Üçgenler.\n🕯️ Mumlar: Çekiç, Yutan, Harami.\n🚨 Kırılım: Destek/Direnç takibi.\n💾 Kayıt: Tüm sinyaller ve sonuçları saklanır.", { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: "HTML", ...mainMenu() });
  }
});

function formatSignal(signal) {
  const emoji = signal.type === "LONG" ? "🟢" : "🔴";
  let fibText = "Yok";
  if (signal.fib && signal.fib.levels) {
    fibText = signal.fib.levels.slice(0, 3).map(l => `${l.level}: $${l.price.toFixed(4)}`).join(" | ");
  }
  
  return `
${emoji} <b>${signal.type} SİNYALİ</b> ${emoji}
💎 <b>${signal.symbol}</b> | 📊 ${signal.timeframe}

💵 Giriş: $${signal.entry}
🎯 TP1: $${signal.tp1} | TP2: $${signal.tp2}
🛑 Stop: $${signal.sl}

🧠 ${signal.reasons.join("\n")}
📐 <b>Grafik:</b> ${signal.chartPatterns || "Yok"}
📈 RSI: ${signal.rsi} | Stoch: ${signal.stochK} | ADX: ${signal.adx}
☁️ Ichimoku: ${signal.ichimoku} | 🟢 Supertrend: ${signal.supertrend}
📡 PSAR: ${signal.psar} | ⚖️ VWAP: $${signal.vwap}
🎯 <b>Fib:</b> ${fibText}

🧠 <b>Güven Skoru: ${signal.aiScore}/100</b>
${signal.aiScore > 80 ? "🔥 ÇOK YÜKSEK İHTİMAL" : signal.aiScore > 70 ? "✅ GÜÇLÜ SİNYAL" : "👀 RİSKLİ / İZLE"}
`.trim();
}

// --- OTOMATİK TARAMA ---
let scanIndex = 0; // Her turda farklı coinleri taramak için

async function runAutoScan() {
  if (!autoScanRunning) return;
  
  const targets = TRADING_PAIRS.filter(p => p.includes("/USDT") && !p.startsWith("XAU") && !p.startsWith("XAG") && !p.startsWith("EUR") && !p.startsWith("GBP") && !p.startsWith("AUD") && !p.startsWith("USD"));
  console.log(`🔍 Otomatik tarama başlıyor... (${targets.length} coin)`);
  
  // Her turda 10 coin tara (API limitini korumak için)
  const batchSize = 10;
  const batch = targets.slice(scanIndex, scanIndex + batchSize);
  
  // Indexi güncelle, sona geldiyse başa dön
  scanIndex = (scanIndex + batchSize) % targets.length;
  if (scanIndex === 0) console.log("🔄 Tüm coinler tarandı, başa dönülüyor.");
  
  for (const pair of batch) {
    try {
      // 1. Sinyal Taraması
      const candles1h = await exchange.getKlines(pair, "1h", 200);
      if (candles1h.length > 50) {
        const signal = SignalGenerator.generate(candles1h, pair, "1h");
        if (signal && signal.aiScore >= 70) {
          addSignal(signal);
          notifySignal(signal);
        }
      }

      // 2. Kırılım Taraması (4 Saatlik)
      const candles4h = await exchange.getKlines(pair, "4h", 100);
      if (candles4h.length > 50) {
        const analysis = require("./analysis");
        const ind = analysis.compute(candles4h);
        const breakouts = SignalGenerator.checkBreakouts(ind, pair);
        
        for (const b of breakouts) {
          // Basit tekrar kontrolü
          const signals = loadSignals();
          const recentBreakout = signals.find(s => s.symbol === pair && s.type === b.type && (Date.now() - s.timestamp < 7200000));
          if (!recentBreakout) {
             notifyBreakout(b);
             addSignal({ symbol: pair, type: b.type === "BREAKOUT" ? "LONG" : "SHORT", entry: b.price, aiScore: 90, timestamp: Date.now(), reasons: ["Kırılım Tespiti"] });
          }
        }
      }

    } catch (e) { console.error(`Hata: ${pair}`, e.message); }
  }

  // 3. Aktif Sinyallerin Sonuçlarını Kontrol Et
  await checkActiveTrades();
}

async function checkActiveTrades() {
  const signals = loadSignals();
  const activeSignals = signals.filter(s => s.status === "active");

  for (const s of activeSignals) {
    try {
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
        for (const cid of chatIds) {
          try { await bot.sendMessage(cid, msg, { parse_mode: "HTML" }); } catch(e) {}
        }
      }
    } catch (e) { console.error(`Kontrol Hatası: ${s.symbol}`, e.message); }
  }
}

function notifyBreakout(b) {
  const msg = `🚨 <b>KIRILIM TESPİT EDİLDİ!</b> 🚨\n${b.msg}\n\n<b>Sembol:</b> ${b.symbol}\n<b>Fiyat:</b> $${b.price}\n<b>Seviye:</b> $${b.level}\n\n🔥 <b>HACİM DESTEKLİ!</b>`;
  for (const cid of chatIds) { try { bot.sendMessage(cid, msg, { parse_mode: "HTML" }); } catch(e) {} }
}

function notifySignal(signal) {
  const msg = formatSignal(signal);
  console.log(`📡 Sinyal Bildirimi: ${signal.symbol} - ${chatIds.size} kullanıcıya gönderiliyor.`);
  for (const cid of chatIds) { 
      try { 
          bot.sendMessage(cid, msg, { parse_mode: "HTML" }); 
      } catch(e) { 
          console.error(`❌ Bildirim hatası (ID: ${cid}):`, e.message); 
      } 
  }
}

// --- RENDER "KEEP-ALIVE" SİSTEMİ ---
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot is alive.");
}).listen(process.env.PORT || 3000, () => {
  console.log(`✅ Sunucu port ${process.env.PORT || 3000} üzerinde çalışıyor.`);
  setTimeout(async () => {
    for (const cid of chatIds) {
      try { await bot.sendMessage(cid, "🟢 <b>BOT BAŞLADI!</b>\nSistem aktif, sinyaller kaydediliyor.", { parse_mode: "HTML" }); } catch(e) {}
    }
  }, 5000);
});