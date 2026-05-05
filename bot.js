const TelegramBot = require("node-telegram-bot-api");
const BinanceClient = require("./binance");
const SignalGenerator = require("./signals");
const { TRADING_PAIRS, TIMEFRAMES, CHECK_INTERVAL, TELEGRAM_BOT_TOKEN } = require("./config");
const http = require("http");

// Render'dan token'ı al, yoksa config'deki dene
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(TOKEN, { polling: true });
const client = new BinanceClient();

const activeSignals = {};
let autoScanRunning = false;
let autoScanInterval = null;

function formatSignal(signal) {
  const emoji = signal.type === "LONG" ? "🟢" : "🔴";
  return `
${emoji} <b>NEW SIGNAL</b> ${emoji}

<b>Pair:</b> ${signal.symbol}
<b>Type:</b> ${signal.type}
<b>Timeframe:</b> ${signal.timeframe}
<b>Entry:</b> $${signal.entry}

🎯 <b>TAKE PROFIT:</b>
<b>TP1:</b> $${signal.tp1}
<b>TP2:</b> $${signal.tp2}

🛑 <b>STOP LOSS:</b> $${signal.sl}
📊 <b>RR:</b> 1:${signal.rr1} / 1:${signal.rr2}

📈 <b>INDICATORS:</b>
<b>RSI:</b> ${signal.rsi}
<b>MACD:</b> ${signal.macdHistogram}
<b>ATR:</b> ${signal.atr}

🔍 <b>REASONS:</b>
${signal.reasons.map((r) => "• " + r).join("\n")}

⚡ <b>Strength:</b> ${signal.strength}/5
`.trim();
}

bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id, "🤖 Bot started! Use /scan to check signals.");
});

bot.onText(/\/scan/, async (msg, match) => {
  const pair = match.input.split(" ")[1];
  const pairs = pair ? [pair.toUpperCase()] : TRADING_PAIRS;
  const found = [];

  const statusMsg = await bot.sendMessage(msg.chat.id, "🔍 Scanning...");

  for (const p of pairs) {
    for (const tf of TIMEFRAMES) {
      try {
        const candles = await client.getKlines(p, tf);
        const signal = SignalGenerator.generate(candles, p, tf);
        if (signal) found.push(signal);
      } catch (e) {
        console.error(`Error: ${p} ${tf}`, e.message);
      }
    }
  }

  await bot.deleteMessage(msg.chat.id, statusMsg.message_id);

  if (found.length === 0) {
    bot.sendMessage(msg.chat.id, "📭 No signals found.");
    return;
  }

  for (const signal of found) {
    bot.sendMessage(msg.chat.id, formatSignal(signal), { parse_mode: "HTML" });
  }
});

// Render'ın uygulamayı durdurmaması için sahte bir web sunucusu
http.createServer((req, res) => res.end("Bot is running")).listen(process.env.PORT || 3000, () => {
  console.log(`✅ Bot listening on port ${process.env.PORT || 3000}`);
});

console.log("🤖 Bot started.");