const config = require("./config");
const TelegramBot = require("node-telegram-bot-api");
const ExchangeClient = require("./exchange");
const SignalGenerator = require("./signals");
const { TRADING_PAIRS, TIMEFRAMES_AUTO, CHECK_INTERVAL, TRADE_SIZE_USDT, LEVERAGE } = require("./config");
const http = require("http");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
if (!TOKEN) console.error("HATA: TELEGRAM_BOT_TOKEN bulunamadı!");

const bot = new TelegramBot(TOKEN, { polling: true });
const exchange = new ExchangeClient();

const activeTrades = {};
const chatIds = new Set();
let autoScanRunning = false;
let autoScanInterval = null;
let totalPnL = 0;
let wins = 0, losses = 0;

function mainKeyboard() {
  return {
    reply_markup: {
      keyboard: [
        [{ text: "🔍 Tarama Yap" }, { text: "💰 Fiyat Sorgula" }],
        [{ text: "💼 İşlemlerim" }, { text: "📊 İstatistik" }],
        [{ text: "▶️ Oto İşlem Başlat" }, { text: "⏹️ Oto İşlem Durdur" }]
      ],
      resize_keyboard: true
    }
  };
}

function formatSignal(signal) {
  return `
🟢 <b>YENİ SİNYAL</b> 🟢

<b>Çift:</b> ${signal.symbol}
<b>Yön:</b> ${signal.type}
<b>Zaman Dilimi:</b> ${signal.timeframe}
<b>Giriş:</b> $${signal.entry}

🎯 <b>KAR AL (TP):</b>
<b>TP1:</b> $${signal.tp1} (R/R 1:${signal.rr1})
<b>TP2:</b> $${signal.tp2} (R/R 1:${signal.rr2})
<b>TP3:</b> $${signal.tp3} (R/R 1:${signal.rr3})

🛑 <b>STOP LOSS:</b> $${signal.sl}
🔄 <b>TRAILING SL:</b> $${signal.trailingStop}

📊 <b>YAPAY ZEKA SKORU:</b> ${signal.aiScore}/100

🕯️ <b>MUM FORMASYONLARI:</b>
${signal.patterns || "Belirgin formasyon yok"}

🔍 <b>SEBEPLER:</b>
${signal.reasons.map(r => "• " + r).join("\n")}
`.trim();
}

bot.onText(/\/start/, (msg) => {
  chatIds.add(msg.chat.id);
  bot.sendMessage(msg.chat.id, "🤖 <b>Crypto Bot'a Hoşgeldin!</b>\n\nMenüden işlem yapabilirsin.", { parse_mode: "HTML", ...mainKeyboard() });
});

bot.onText(/🔍 Tarama Yap/, async (msg) => {
  const pairs = TRADING_PAIRS.slice(0, 8);
  bot.sendMessage(msg.chat.id, "🔍 Piyasa taranıyor...", mainKeyboard());

  for (const p of pairs) {
    try {
      for (const tf of TIMEFRAMES_AUTO) {
        const candles = await exchange.getKlines(p, tf);
        if (!candles.length) continue;
        const signal = SignalGenerator.generate(candles, p, tf);
        if (signal) {
          const chartUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${signal.symbol.replace("/", "")}`;
          const kb = { inline_keyboard: [[{ text: "📊 Grafiği Aç", url: chartUrl }]] };
          bot.sendMessage(msg.chat.id, formatSignal(signal), { parse_mode: "HTML", reply_markup: kb });
        }
      }
    } catch (e) { console.error(`Hata: ${p}`, e.message); }
  }
});

bot.onText(/▶️ Oto İşlem Başlat/, async (msg) => {
  if (autoScanRunning) { bot.sendMessage(msg.chat.id, "⚠️ Zaten çalışıyor!", mainKeyboard()); return; }
  if (!config.BITGET_API_KEY) {
    bot.sendMessage(msg.chat.id, "⚠️ Bitget API anahtarları ayarlanmamış! Önce Render Environment kısmına BITGET_API_KEY, BITGET_SECRET ve BITGET_PASSPHRASE ekle.", mainKeyboard());
    return;
  }
  autoScanRunning = true;
  bot.sendMessage(msg.chat.id, `▶️ Otomatik işlem başladı!\nGüvenilir sinyallerde (65+ puan) otomatik ${LEVERAGE}x kaldıraçla işlem açacağım.`, mainKeyboard());

  autoScanInterval = setInterval(async () => {
    if (!autoScanRunning) return;
    await scanAndTrade();
    await checkPositions();
  }, CHECK_INTERVAL);
  await scanAndTrade();
});

bot.onText(/⏹️ Oto İşlem Durdur/, (msg) => {
  if (!autoScanRunning) { bot.sendMessage(msg.chat.id, "⚠️ Çalışmıyor!", mainKeyboard()); return; }
  clearInterval(autoScanInterval);
  autoScanRunning = false;
  bot.sendMessage(msg.chat.id, "⏹️ Otomatik işlem durduruldu!", mainKeyboard());
});

bot.onText(/💰 Fiyat Sorgula/, (msg) => {
  const inline = {
    reply_markup: {
      inline_keyboard: TRADING_PAIRS.slice(0, 6).map(p => [{ text: `${p.replace("/USDT", "")}`, callback_data: `price_${p}` }])
    }
  };
  bot.sendMessage(msg.chat.id, "📈 Hangi coinin fiyatını görmek istersin?", inline);
});

bot.on("callback_query", async (query) => {
  if (query.data.startsWith("price_")) {
    const pair = query.data.split("price_")[1];
    try {
      const price = await exchange.getPrice(pair);
      bot.answerCallbackQuery(query.id);
      bot.sendMessage(query.message.chat.id, `💰 <b>${pair}</b>\nFiyat: $${price}`, { parse_mode: "HTML" });
    } catch (e) {
      bot.answerCallbackQuery(query.id);
      bot.sendMessage(query.message.chat.id, `Hata: ${e.message}`);
    }
  }
});

bot.onText(/💼 İşlemlerim/, async (msg) => {
  bot.sendMessage(msg.chat.id, "💼 İşlemler kontrol ediliyor...", mainKeyboard());
  try {
    const positions = await exchange.getOpenPositions();
    if (!positions.length) {
      bot.sendMessage(msg.chat.id, "📭 Açık pozisyon yok.", mainKeyboard());
      return;
    }
    let txt = "📋 <b>AÇIK POZİSYONLAR</b>\n\n";
    for (const p of positions) {
      if (parseFloat(p.contracts) > 0) {
        const side = p.side === "long" ? "🟢 Long" : "🔴 Short";
        txt += `${side} <b>${p.symbol}</b>\nGiriş: $${p.entryPrice.toFixed(2)}\nKar/Zarar: $${p.unrealizedPnL.toFixed(2)}\n\n`;
      }
    }
    bot.sendMessage(msg.chat.id, txt, { parse_mode: "HTML" });
  } catch (e) {
    bot.sendMessage(msg.chat.id, `Hata: ${e.message}`, mainKeyboard());
  }
});

bot.onText(/📊 İstatistik/, (msg) => {
  const txt = `📊 <b>İSTATİSTİKLER</b>\n\nToplam İşlem: ${wins + losses}\nKazanılan: ${wins}\nKaybedilen: ${losses}\nToplam PnL: $${totalPnL.toFixed(2)}`;
  bot.sendMessage(msg.chat.id, txt, { parse_mode: "HTML", ...mainKeyboard() });
});

async function scanAndTrade() {
  const pairs = TRADING_PAIRS.slice(0, 5);
  for (const p of pairs) {
    try {
      for (const tf of TIMEFRAMES_AUTO) {
        const candles = await exchange.getKlines(p, tf);
        if (!candles.length) continue;
        const signal = SignalGenerator.generate(candles, p, tf);
        if (signal && signal.aiScore >= 75) {
          await executeTrade(signal);
          break;
        }
      }
    } catch (e) { console.error(`Oto: ${p}`, e.message); }
  }
}

async function executeTrade(signal) {
  const key = signal.symbol;
  if (activeTrades[key]) return;

  try {
    const price = await exchange.getPrice(signal.symbol);
    // Bitget uses contract size calculation, simplified here to amount = size / price
    const amount = TRADE_SIZE_USDT / price;
    const side = signal.type === "LONG" ? "open_long" : "open_short";
    
    bot.sendMessage(chatIds.values().next().value, `🚀 <b>İŞLEM AÇILDI</b>\n${signal.symbol} ${side} @ $${price}\nBoyut: $${TRADE_SIZE_USDT} | ${LEVERAGE}x`, { parse_mode: "HTML" });
    
    const order = await exchange.placeOrder(signal.symbol, side, amount);
    
    activeTrades[key] = {
      symbol: signal.symbol,
      entryPrice: price,
      side: signal.type,
      sl: signal.sl,
      tp1: signal.tp1,
      tp2: signal.tp2,
      orderId: order.id,
      time: Date.now()
    };
  } catch (e) {
    bot.sendMessage(chatIds.values().next().value, `❌ İşlem Hatası: ${e.message}`);
  }
}

async function checkPositions() {
  for (const [key, trade] of Object.entries(activeTrades)) {
    try {
      const currentPrice = await exchange.getPrice(trade.symbol);
      const pnl = trade.side === "LONG" 
        ? (currentPrice - trade.entryPrice) * (TRADE_SIZE_USDT / trade.entryPrice) * LEVERAGE
        : (trade.entryPrice - currentPrice) * (TRADE_SIZE_USDT / trade.entryPrice) * LEVERAGE;
      
      // SL Check
      if ((trade.side === "LONG" && currentPrice <= trade.sl) || (trade.side === "SHORT" && currentPrice >= trade.sl)) {
        await closeTrade(key, "Stop Loss", currentPrice, pnl);
      }
      // TP1 Check
      else if ((trade.side === "LONG" && currentPrice >= trade.tp1) || (trade.side === "SHORT" && currentPrice <= trade.tp1)) {
        if (!trade.tp1Notified) {
          bot.sendMessage(chatIds.values().next().value, `🎯 <b>TP1 Tetiklendi!</b>\n${trade.symbol}\nPnL: $${pnl.toFixed(2)}`, { parse_mode: "HTML" });
          trade.tp1Notified = true;
        }
      }
    } catch (e) { console.error(`Pozisyon kontrol: ${key}`, e.message); }
  }
}

async function closeTrade(key, reason, price, pnl) {
  const trade = activeTrades[key];
  try {
    const side = trade.side === "LONG" ? "close_long" : "close_short";
    await exchange.closePosition(trade.symbol, side);
    
    if (pnl > 0) wins++; else losses++;
    totalPnL += pnl;
    
    bot.sendMessage(chatIds.values().next().value, `🛑 <b>${reason}!</b>\n${trade.symbol} @ $${price}\nPnL: $${pnl.toFixed(2)}`, { parse_mode: "HTML" });
  } catch (e) { console.error(`Kapatma hatası: ${key}`, e.message); }
  delete activeTrades[key];
}

http.createServer((req, res) => res.end("Bot çalışıyor.")).listen(process.env.PORT || 3000);
console.log("✅ Sunucu başladı.");
