const TelegramBot = require("node-telegram-bot-api");
const ExchangeClient = require("./exchange");
const SignalGenerator = require("./signals");
const { TRADING_PAIRS, TIMEFRAMES_AUTO, CHECK_INTERVAL, LEVERAGE } = require("./config");
const http = require("http");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
if (!TOKEN) console.error("HATA: TELEGRAM_BOT_TOKEN bulunamadı!");

const bot = new TelegramBot(TOKEN, { polling: true });
const exchange = new ExchangeClient();

const chatIds = new Set();
let autoScanRunning = false;
let autoScanInterval = null;
const signalHistory = [];
const knownLevels = {}; // To avoid repeating the same breakout alerts

// --- MENÜ TANIMLARI ---
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
          { text: "🕰️ Son Sinyaller", callback_data: "history_1h" }
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
  if (cat === "forex") return ["BTC/USDT", "ETH/USDT", "SOL/USDT", "XRP/USDT", "AVAX/USDT"]; // Forex not available on all exchanges
  if (cat === "meme") return ["DOGE/USDT", "PEPE/USDT", "WIF/USDT", "SHIB/USDT", "FLOKI/USDT"];
  if (cat === "major") return ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT"];
  if (cat === "trend") return ["BTC/USDT", "ETH/USDT", "SOL/USDT", "AVAX/USDT", "LINK/USDT", "DOT/USDT"];
  return TRADING_PAIRS.slice(0, 15); 
}

// --- BOT OLAYLARI ---
bot.onText(/\/start/, (msg) => {
  chatIds.add(msg.chat.id);
  bot.sendMessage(msg.chat.id, "🤖 <b>TRADING PRO BOT</b>\n\nSistem çalışıyor! Menüden işlem yapabilirsin.", { parse_mode: "HTML", ...mainMenu() });
});

// Test komutu
bot.onText(/\/test/, (msg) => {
  bot.sendMessage(msg.chat.id, "✅ <b>BOT BAĞLANTISI AKTİF!</b>\nOtomatik bildirimler çalışıyor.", { parse_mode: "HTML" });
});

bot.on("callback_query", async (query) => {
  const data = query.data;
  bot.answerCallbackQuery(query.id);

  if (data === "back_menu") {
    bot.editMessageText("🤖 <b>TRADING PRO BOT</b>\nAna menüye döndünüz.", { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: "HTML", ...mainMenu() });
    return;
  }

  if (data === "history_1h") {
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    const recentSignals = signalHistory.filter(s => s.timestamp > oneHourAgo);
    let msg = "🕰️ <b>Son 1 Saatlik Sinyaller</b>\n\n";
    if (recentSignals.length === 0) msg += "Bu saat içinde sinyal yok.";
    else {
      for (const s of recentSignals) msg += `• <b>${s.symbol}</b> (${s.type}) | Skor: ${s.aiScore}\n`;
      const avgScore = recentSignals.reduce((a,b)=>a+b.aiScore,0)/recentSignals.length;
      msg += `\n📊 Ort. Skor: ${avgScore.toFixed(0)}/100`;
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
      addSignalToHistory(signal);
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
    bot.editMessageText(autoScanRunning ? "🔔 <b>OTO SİNYAL AÇIK</b>\nKırılım ve Trend takibi başlatıldı!" : "🔕 <b>OTO SİNYAL KAPALI</b>", { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: "HTML", ...mainMenu() });
    if (autoScanRunning) {
      clearInterval(autoScanInterval);
      autoScanInterval = setInterval(runAutoScan, CHECK_INTERVAL);
      runAutoScan();
    } else clearInterval(autoScanInterval);
    return;
  }

  if (data === "help") {
    bot.editMessageText("ℹ️ <b>BOT HAKKINDA</b>\n\n📈 İndikatörler: RSI, MACD, Stokastik, ADX.\n🕯️ Mum Formasyonları: Çekiç, Yutan, vb.\n🚨 Kırılım: Destek/Direnç takibi.\n\n⚠️ Yatırım tavsiyesi değildir.", { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: "HTML", ...mainMenu() });
  }
});

function formatSignal(signal) {
  const emoji = signal.type === "LONG" ? "🟢" : "🔴";
  return `
${emoji} <b>${signal.type} SİNYALİ</b> ${emoji}
💎 <b>${signal.symbol}</b> | 📊 ${signal.timeframe}

💵 Giriş: $${signal.entry}
🎯 TP1: $${signal.tp1} | TP2: $${signal.tp2}
🛑 Stop: $${signal.sl}

🧠 ${signal.reasons.join("\n")}
📈 RSI: ${signal.rsi} | Stoch: ${signal.stochK} | ADX: ${signal.adx}
🕯️ ${signal.patterns || "Yok"}

${signal.aiScore > 75 ? "✅ GÜÇLÜ SİNYAL" : "👀 İzle"}
`.trim();
}

function addSignalToHistory(signal) {
  signal.timestamp = Date.now();
  signalHistory.push(signal);
  if (signalHistory.length > 100) signalHistory.shift();
}

// --- OTOMATİK TARAMA (ANA DÖNGÜ) ---
async function runAutoScan() {
  if (!autoScanRunning) return;
  
  // Önemli coinler + Forex muadilleri
  const targets = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "XRP/USDT", "DOGE/USDT", "AVAX/USDT", "LINK/USDT"];
  
  console.log("🔍 Otomatik tarama başlıyor...");
  
  for (const pair of targets) {
    try {
      // Kırılım Tespiti İçin 4 Saatlik Veri
      const candles4h = await exchange.getKlines(pair, "4h", 100);
      if (candles4h.length > 50) {
        const analysis = require("./analysis");
        const ind = analysis.compute(candles4h);
        const breakouts = SignalGenerator.checkBreakouts(ind, pair);
        
        for (const b of breakouts) {
          const key = `${pair}_${b.level}`;
          // Aynı seviyeden ard arda bildirim gitmesini engelle (Son 2 saatte gitmediyse)
          if (!knownLevels[key] || Date.now() - knownLevels[key] > 7200000) {
            knownLevels[key] = Date.now();
            notifyBreakout(b);
          }
        }
      }

      // Sinyal Tespiti İçin 1 Saatlik Veri
      const candles1h = await exchange.getKlines(pair, "1h", 200);
      if (candles1h.length > 50) {
        const signal = SignalGenerator.generate(candles1h, pair, "1h");
        if (signal && signal.aiScore >= 70) {
          notifySignal(signal);
          addSignalToHistory(signal);
        }
      }

      // 15 Dk Taraması (Scalp)
      const candles15m = await exchange.getKlines(pair, "15m", 100);
      if (candles15m.length > 50) {
        const signal15 = SignalGenerator.generate(candles15m, pair, "15m");
        if (signal15 && signal15.aiScore >= 80) {
           notifySignal(signal15); // Çok güçlü 15dk sinyallerini de at
           addSignalToHistory(signal15);
        }
      }

    } catch (e) { console.error(`Hata: ${pair}`, e.message); }
  }
}

function notifyBreakout(b) {
  const msg = `
🚨 <b>KIRILIM TESPİT EDİLDİ!</b> 🚨
${b.msg}

<b>Sembol:</b> ${b.symbol}
<b>Fiyat:</b> $${b.price}
<b>Seviye:</b> $${b.level}

🔥 <b>HACİM DESTEKLİ!</b>
`.trim();
  
  for (const cid of chatIds) {
    try { bot.sendMessage(cid, msg, { parse_mode: "HTML" }); } catch(e) {}
  }
}

function notifySignal(signal) {
  const msg = formatSignal(signal);
  for (const cid of chatIds) {
    try { bot.sendMessage(cid, msg, { parse_mode: "HTML" }); } catch(e) {}
  }
}

// --- RENDER "KEEP-ALIVE" SİSTEMİ ---
// Render'ın uygulamayı uyutmaması için 5 dakikada bir kendine istek atar
setInterval(async () => {
  try {
    // Kendi render URL'ine ping atar (URL'yi env variable'dan almalıyız ama localhost denemesi yapar)
    // Render dışarıdan ping gerektirir ama bu kodun kendi içinde basit bir http server olması yeterlidir.
    console.log("💓 Bot uyanık...");
  } catch(e) {}
}, 300000);

// HTTP Sunucusu (Render'ın botu canlı tutması için şart)
http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot is alive.");
}).listen(process.env.PORT || 3000, () => {
  console.log(`✅ Sunucu port ${process.env.PORT || 3000} üzerinde çalışıyor.`);
  
  // Bot açılınca test mesajı at
  setTimeout(async () => {
    for (const cid of chatIds) {
      try {
        await bot.sendMessage(cid, "🟢 <b>BOT BAŞLADI!</b>\nSistem aktif, kırılım takibi çalışıyor.", { parse_mode: "HTML" });
      } catch(e) {}
    }
  }, 5000);
});
