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
          { text: "🔔 Oto Sinyal", callback_data: "toggle_auto" }
        ],
        [{ text: "📋 Aktif İşlemlerim", callback_data: "my_trades" }],
        [{ text: "ℹ️ Yardım / Info", callback_data: "help" }]
      ]
    }
  };
}

function scanMenu(category) {
  const rows = [];
  const pairs = getPairsByCategory(category);
  for (let i = 0; i < pairs.length; i += 2) {
    rows.push([
      { text: pairs[i].replace("/USDT", ""), callback_data: `detail_${pairs[i]}` }
    ]);
    if (pairs[i+1]) {
      rows[rows.length-1].push({ text: pairs[i+1].replace("/USDT", ""), callback_data: `detail_${pairs[i+1]}` });
    }
  }
  rows.push([{ text: "🔙 Ana Menü", callback_data: "back_menu" }]);
  return { reply_markup: { inline_keyboard: rows } };
}

function getPairsByCategory(cat) {
  if (cat === "forex") return ["XAU/USDT", "XAG/USDT", "EUR/USDT", "GBP/USDT", "AUD/USDT", "USD/JPY"];
  if (cat === "meme") return ["DOGE/USDT", "PEPE/USDT", "WIF/USDT", "SHIB/USDT", "FLOKI/USDT"];
  if (cat === "major") return ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT"];
  return TRADING_PAIRS; // Default all
}

// --- BOT OLAYLARI ---
bot.onText(/\/start/, (msg) => {
  chatIds.add(msg.chat.id);
  bot.sendMessage(msg.chat.id, "🤖 <b>TRADING PRO BOT</b>\n\nPiyasa analizi, sinyaller ve takip için menüyü kullanın.", { parse_mode: "HTML", ...mainMenu() });
});

bot.on("callback_query", async (query) => {
  const data = query.data;
  bot.answerCallbackQuery(query.id);

  if (data === "back_menu") {
    bot.editMessageText("🤖 <b>TRADING PRO BOT</b>\nAna menüye döndünüz.", { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: "HTML", ...mainMenu() });
    return;
  }

  if (data.startsWith("detail_")) {
    const pair = data.split("detail_")[1];
    const msg = await bot.sendMessage(query.message.chat.id, `🔎 ${pair} analiz ediliyor...`);
    const candles = await exchange.getKlines(pair, "1h", 200);
    if (!candles.length) {
      bot.editMessageText(`❌ ${pair} için veri alınamadı.`, { chat_id: query.message.chat.id, message_id: msg.message_id });
      return;
    }
    const signal = SignalGenerator.generate(candles, pair, "1h");
    if (signal) {
      bot.editMessageText(formatSignal(signal), { chat_id: query.message.chat.id, message_id: msg.message_id, parse_mode: "HTML", disable_web_page_preview: true });
    } else {
      bot.editMessageText(`📊 <b>${pair}</b>\nŞu an için net bir sinyal yok. Piyasa kararsız.`, { chat_id: query.message.chat.id, message_id: msg.message_id, parse_mode: "HTML" });
    }
    return;
  }

  if (data.startsWith("scan_")) {
    const cat = data.split("scan_")[1];
    bot.editMessageText("📂 <b>Kategoriler</b>\nAnaliz etmek istediğiniz varlığı seçin:", { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: "HTML", ...scanMenu(cat) });
    return;
  }

  if (data === "toggle_auto") {
    autoScanRunning = !autoScanRunning;
    bot.editMessageText(autoScanRunning ? "🔔 <b>Otomatik Sinyal AÇIK</b>\nHer 5 dakikada bir güçlü sinyaller paylaşılacak." : "🔕 <b>Otomatik Sinyal KAPALI</b>", { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: "HTML", ...mainMenu() });
    
    if (autoScanRunning) {
      clearInterval(autoScanInterval);
      autoScanInterval = setInterval(runAutoScan, CHECK_INTERVAL);
      runAutoScan();
    } else {
      clearInterval(autoScanInterval);
    }
    return;
  }

  if (data === "help") {
    bot.editMessageText(
      "ℹ️ <b>BOT HAKKINDA</b>\n\n" +
      "📈 <b>Analiz:</b> RSI, MACD, EMA, Bollinger Bands ve Mum Formasyonları.\n" +
      "💱 <b>Piyasalar:</b> Kripto, Altın, Forex.\n" +
      "⚡ <b>Zaman Dilimleri:</b> 15dk, 1s, 4s.\n\n" +
      "⚠️ Bu bir yatırım tavsiyesi değildir. Sinyaller teknik analiz sonuçlarıdır.",
      { chat_id: query.message.chat.id, message_id: query.message.message_id, parse_mode: "HTML", ...mainMenu() }
    );
  }
});

// --- YARDIMCI FONKSİYONLAR ---
function formatSignal(signal) {
  const emoji = signal.type === "LONG" ? "🟢" : "🔴";
  const scoreColor = signal.aiScore > 80 ? "🔥" : "⚡";
  
  return `
${emoji} <b>${signal.type} SİNYALİ</b> ${emoji}

💎 <b>${signal.symbol}</b>
📊 ZD: ${signal.timeframe} | ${scoreColor} Skor: ${signal.aiScore}

💵 <b>Giriş:</b> $${signal.entry}
🎯 <b>TP1:</b> $${signal.tp1}
🎯 <b>TP2:</b> $${signal.tp2}
🛑 <b>Stop:</b> $${signal.sl}

🧠 <b>Analiz:</b> ${signal.reasons[0] || "Güçlü Trend"}
🕯️ <b>Mum:</b> ${signal.patterns || "Yok"}

${signal.aiScore > 75 ? "✅ <b>GÜÇLÜ SİNYAL - İŞLEMELİ</b>" : "👀 İzle"}
`.trim();
}

async function runAutoScan() {
  if (!autoScanRunning) return;
  const targets = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "XAU/USDT", "XRP/USDT"];
  
  for (const pair of targets) {
    try {
      const candles = await exchange.getKlines(pair, "1h", 200);
      if (candles.length < 50) continue;
      const signal = SignalGenerator.generate(candles, pair, "1h");
      if (signal && signal.aiScore >= 70) {
        for (const cid of chatIds) {
          try { bot.sendMessage(cid, formatSignal(signal), { parse_mode: "HTML" }); } catch(e) {}
        }
      }
    } catch (e) { console.error("OtoScan Error:", e.message); }
  }
}

http.createServer((req, res) => res.end("Bot çalışıyor.")).listen(process.env.PORT || 3000);
console.log("✅ Sunucu başladı.");
