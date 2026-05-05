const TelegramBot = require("node-telegram-bot-api");
const BinanceClient = require("./binance");
const SignalGenerator = require("./signals");
const { TRADING_PAIRS, TIMEFRAMES, TIMEFRAMES_AUTO, CHECK_INTERVAL, MAX_ACTIVE_TRADES, TRADE_COOLDOWN } = require("./config");
const http = require("http");

const TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
if (!TOKEN) console.error("HATA: TELEGRAM_BOT_TOKEN bulunamadı!");

const bot = new TelegramBot(TOKEN, { polling: true });
const client = new BinanceClient();

const activeTrades = {};
const tradeCooldowns = {};
const chatIds = [];
let autoScanRunning = false;
let autoScanInterval = null;
let totalPnL = 0;

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

📈 <b>İNDİKATÖRLER:</b>
<b>RSI:</b> ${signal.rsi}
<b>MACD:</b> ${signal.macdHistogram}
<b>ATR:</b> ${signal.atr}

🕯️ <b>MUM FORMASYONLARI:</b>
${signal.patterns || "Belirgin formasyon yok"}

🔍 <b>SEBEPLER:</b>
${signal.reasons.map(r => "• " + r).join("\n")}

⚡ <b>Güç:</b> ${signal.strength}/100
`.trim();
}

function formatPortfolio() {
  if (Object.keys(activeTrades).length === 0) return "📭 Aktif işlem yok.";
  let msg = "💼 <b>AKTİF İŞLEMLER</b>\n\n";
  for (const [key, trade] of Object.entries(activeTrades)) {
    const pnl = trade.currentPnL || 0;
    const emoji = pnl >= 0 ? "✅" : "❌";
    msg += `${emoji} <b>${trade.symbol}</b> | Giriş: $${trade.entry}\n`;
    msg += `   SL: $${trade.sl} | TP1: $${trade.tp1} | PnL: $${pnl.toFixed(2)}\n\n`;
  }
  msg += `📊 <b>Toplam PnL:</b> $${totalPnL.toFixed(2)}`;
  return msg;
}

bot.onText(/\/start/, (msg) => {
  chatIds.push(msg.chat.id);
  bot.sendMessage(msg.chat.id, "🤖 <b>Crypto Sinyal Bot</b>\n\nKomutlar:\n/scan - Tüm coinleri tara\n/scan BTC/USDT - Tek coin tara\n/fiyat BTC/USDT - Anlık fiyat\n/islem - Açık işlemlerim\n/tarama_baslat - Otomatik tarama\n/tarama_dur - Otomatik durdur\n/istatistik - Bot istatistikleri", { parse_mode: "HTML" });
});

bot.onText(/\/scan/, async (msg) => {
  const pair = msg.text.split(" ")[1];
  const pairs = pair ? [pair.toUpperCase()] : TRADING_PAIRS.slice(0, 10);
  const found = [];
  let count = 0;

  const statusMsg = await bot.sendMessage(msg.chat.id, "🔍 Piyasa taranıyor...");

  for (const p of pairs) {
    for (const tf of TIMEFRAMES.slice(0, 3)) {
      try {
        if (count >= MAX_ACTIVE_TRADES) break;
        const candles = await client.getKlines(p, tf);
        const signal = SignalGenerator.generate(candles, p, tf);
        if (signal) {
          found.push(signal);
          count++;
        }
      } catch (e) { console.error(`Hata: ${p} ${tf}`, e.message); }
    }
    if (count >= MAX_ACTIVE_TRADES) break;
  }

  try { await bot.deleteMessage(msg.chat.id, statusMsg.message_id); } catch (e) {}

  if (found.length === 0) {
    bot.sendMessage(msg.chat.id, "📭 Şu an güçlü sinyal bulunamadı. Tekrar dene.");
    return;
  }

  for (const signal of found) {
    const chartUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${signal.symbol.replace("/", "")}&interval=${signal.timeframe}`;
    const keyboard = { inline_keyboard: [[{ text: "📊 Grafiği Aç", url: chartUrl }]] };
    bot.sendMessage(msg.chat.id, formatSignal(signal), { parse_mode: "HTML", reply_markup: keyboard });
    registerTrade(signal);
  }
});

bot.onText(/\/fiyat/, async (msg) => {
  const pair = msg.text.split(" ")[1];
  if (!pair) { bot.sendMessage(msg.chat.id, "Kullanım: /fiyat BTC/USDT"); return; }
  try {
    const price = await client.getPrice(pair);
    const change = await client.get24hChange(pair);
    const emoji = change > 0 ? "🟢" : "🔴";
    bot.sendMessage(msg.chat.id, `💰 <b>${pair}</b>\nFiyat: $${price}\n24s: ${emoji} ${change.toFixed(2)}%`, { parse_mode: "HTML" });
  } catch (e) { bot.sendMessage(msg.chat.id, `Hata: ${e.message}`); }
});

bot.onText(/\/islem/, (msg) => bot.sendMessage(msg.chat.id, formatPortfolio(), { parse_mode: "HTML" }));

bot.onText(/\/tarama_baslat/, async (msg) => {
  if (autoScanRunning) { bot.sendMessage(msg.chat.id, "⚠️ Zaten çalışıyor!"); return; }
  autoScanRunning = true;
  chatIds.push(msg.chat.id);
  bot.sendMessage(msg.chat.id, "▶️ Otomatik tarama başladı! (Her 5dk)");

  autoScanInterval = setInterval(async () => {
    const pairs = TRADING_PAIRS.slice(0, 8);
    for (const p of pairs) {
      if (!autoScanRunning) break;
      const now = Date.now();
      if (tradeCooldowns[p] && now - tradeCooldowns[p] < TRADE_COOLDOWN) continue;
      try {
        for (const tf of TIMEFRAMES_AUTO) {
          const candles = await client.getKlines(p, tf);
          const signal = SignalGenerator.generate(candles, p, tf);
          if (signal && signal.aiScore >= 70) {
            tradeCooldowns[p] = now;
            const chartUrl = `https://www.tradingview.com/chart/?symbol=BINANCE:${signal.symbol.replace("/", "")}`;
            const kb = { inline_keyboard: [[{ text: "📊 Grafik", url: chartUrl }]] };
            for (const cid of chatIds) {
              try { await bot.sendMessage(cid, formatSignal(signal), { parse_mode: "HTML", reply_markup: kb }); } catch (e) {}
            }
            registerTrade(signal);
            break;
          }
        }
      } catch (e) { console.error(`Oto: ${p}`, e.message); }
    }
    updateTrades();
  }, CHECK_INTERVAL);
});

bot.onText(/\/tarama_dur/, (msg) => {
  if (!autoScanRunning) { bot.sendMessage(msg.chat.id, "⚠️ Çalışmıyor!"); return; }
  clearInterval(autoScanInterval);
  autoScanRunning = false;
  bot.sendMessage(msg.chat.id, "⏹️ Otomatik tarama durduruldu!");
});

bot.onText(/\/istatistik/, (msg) => {
  const total = Object.keys(activeTrades).length;
  const wins = Object.values(activeTrades).filter(t => (t.currentPnL || 0) > 0).length;
  bot.sendMessage(msg.chat.id, `📊 <b>İSTATİSTİKLER</b>\n\nAktif: ${total}\nKarda: ${wins}\nZararda: ${total - wins}\nToplam PnL: $${totalPnL.toFixed(2)}`, { parse_mode: "HTML" });
});

function registerTrade(signal) {
  const key = signal.symbol;
  activeTrades[key] = {
    ...signal,
    openTime: Date.now(),
    currentPnL: 0,
    highestPrice: signal.entry,
  };
}

async function updateTrades() {
  for (const [key, trade] of Object.entries(activeTrades)) {
    try {
      const price = await client.getPrice(trade.symbol);
      const pnl = (price - trade.entry) * 10;
      trade.currentPnL = pnl;
      totalPnL += pnl * 0.01;
      if (price > trade.highestPrice) trade.highestPrice = price;
      if (price <= trade.sl) {
        for (const cid of chatIds) await bot.sendMessage(cid, `🛑 <b>SL Tetiklendi!</b>\n${trade.symbol} | $${price}\nPnL: $${pnl.toFixed(2)}`, { parse_mode: "HTML" });
        delete activeTrades[key];
      }
      if (price >= trade.tp1 && !trade.tp1Hit) {
        trade.tp1Hit = true;
        for (const cid of chatIds) await bot.sendMessage(cid, `🎯 <b>TP1 Geldi!</b>\n${trade.symbol} | $${price}\nPnL: $${pnl.toFixed(2)}`, { parse_mode: "HTML" });
      }
    } catch (e) { console.error(`Güncelleme: ${key}`, e.message); }
  }
}

http.createServer((req, res) => res.end("Bot çalışıyor.")).listen(process.env.PORT || 3000);
console.log("✅ Sunucu başladı.");
