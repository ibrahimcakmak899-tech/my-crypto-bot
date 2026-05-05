const BinanceClient = require("./binance");
const SignalGenerator = require("./signals");
const { TRADING_PAIRS, ATR_MULTIPLIER_SL, TP1_RR, TP2_RR } = require("./config");

const INITIAL_CAPITAL = 100;
const TRADE_SIZE = 10;
const LEVERAGE = 10;
const DAYS = 7;
const TIMEFRAME = "1h";
const COOLDOWN = 4 * 60 * 60 * 1000;

class Backtest {
  constructor() {
    this.client = new BinanceClient();
    this.trades = [];
    this.equity = INITIAL_CAPITAL;
    this.wins = 0;
    this.losses = 0;
    this.tp1Hits = 0;
    this.tp2Hits = 0;
    this.slHits = 0;
    this.cooldowns = {};
  }

  async run() {
    console.log("🔍 Backtesting...");
    console.log(`💰 Capital: $${INITIAL_CAPITAL} | Trade: $${TRADE_SIZE} | Leverage: ${LEVERAGE}x`);
    console.log(`📊 Period: ${DAYS} days | Timeframe: ${TIMEFRAME}`);
    console.log("=" .repeat(50));

    for (const symbol of TRADING_PAIRS) {
      try {
        console.log(`\n📈 Scanning ${symbol}...`);
        const candles = await this.client.getKlines(symbol, TIMEFRAME, 1000);

        if (candles.length < 300) {
          console.log(`  ⚠️ Not enough data for ${symbol}`);
          continue;
        }

        const lastPrice = candles[candles.length - 1].close;
        const closes = candles.map(c => c.close);
        const ema50Arr = this._ema(closes, 50);
        const ema200Arr = this._ema(closes, 200);
        const ema50 = ema50Arr[ema50Arr.length - 1];
        const ema200 = ema200Arr[ema200Arr.length - 1];
        const trend = lastPrice > ema50 && ema50 > ema200 ? "UPTREND" : lastPrice < ema50 && ema50 < ema200 ? "DOWNTREND" : "NO TREND";
        console.log(`  📊 ${symbol}: $${lastPrice} | EMA50: $${ema50.toFixed(2)} | EMA200: $${ema200.toFixed(2)} | ${trend}`);

        for (let i = 200; i < candles.length - 50; i++) {
          const history = candles.slice(0, i);
          const future = candles.slice(i, i + 50);

          const signal = SignalGenerator.generate(history, symbol, TIMEFRAME);
          if (!signal) continue;

          const now = history[history.length - 1].timestamp;
          if (this.cooldowns[symbol] && now - this.cooldowns[symbol] < COOLDOWN) continue;

          const result = this.checkExit(signal.entry, signal.sl, signal.tp1, signal.tp2, future, signal.type);

          if (result.exitType) {
            this.processTrade(signal, result);
            this.cooldowns[symbol] = now;
          }
        }
      } catch (e) {
        console.error(`❌ Error: ${symbol} - ${e.message}`);
      }
    }

    this.printResults();
  }

  checkExit(entry, sl, tp1, tp2, future, type) {
    for (const candle of future) {
      if (candle.low <= sl) return { exitType: "SL", exitPrice: sl };
      if (candle.high >= tp2) return { exitType: "TP2", exitPrice: tp2 };
      if (candle.high >= tp1) return { exitType: "TP1", exitPrice: tp1 };
    }
    return { exitType: null };
  }

  processTrade(signal, result) {
    const priceChange = Math.abs(result.exitPrice - signal.entry) / signal.entry;
    const pnlPct = priceChange * LEVERAGE;

    let pnl;
    if (result.exitType === "SL") {
      pnl = -TRADE_SIZE * pnlPct;
      this.losses++;
      this.slHits++;
    } else {
      pnl = TRADE_SIZE * pnlPct;
      this.wins++;
      if (result.exitType === "TP1") this.tp1Hits++;
      if (result.exitType === "TP2") this.tp2Hits++;
    }

    this.equity += pnl;

    this.trades.push({
      symbol: signal.symbol,
      type: signal.type,
      entry: signal.entry,
      sl: signal.sl,
      tp1: signal.tp1,
      tp2: signal.tp2,
      exitType: result.exitType,
      exitPrice: result.exitPrice,
      pnl: parseFloat(pnl.toFixed(2)),
      equity: parseFloat(this.equity.toFixed(2)),
      rsi: signal.rsi,
    });
  }

  printResults() {
    const totalPnl = this.equity - INITIAL_CAPITAL;
    const winRate = this.trades.length > 0 ? ((this.wins / this.trades.length) * 100).toFixed(1) : 0;
    const avgWin = this._avgWin();
    const avgLoss = this._avgLoss();
    const pf = this._profitFactor();

    console.log("\n" + "=".repeat(50));
    console.log("📊 BACKTEST RESULTS");
    console.log("=".repeat(50));
    console.log(`💰 Initial:      $${INITIAL_CAPITAL.toFixed(2)}`);
    console.log(`💵 Final:        $${this.equity.toFixed(2)}`);
    console.log(`📈 PnL:          $${totalPnl.toFixed(2)} (${((totalPnl / INITIAL_CAPITAL) * 100).toFixed(1)}%)`);
    console.log(`📊 Trades:       ${this.trades.length}`);
    console.log(`✅ Wins:         ${this.wins}`);
    console.log(`❌ Losses:       ${this.losses}`);
    console.log(`🎯 Win Rate:     ${winRate}%`);
    console.log(`  - TP1 Hits:    ${this.tp1Hits}`);
    console.log(`  - TP2 Hits:    ${this.tp2Hits}`);
    console.log(`  - SL Hits:     ${this.slHits}`);
    console.log(`📊 Avg Win:      $${avgWin.toFixed(2)}`);
    console.log(`📉 Avg Loss:     $${avgLoss.toFixed(2)}`);
    console.log(`📊 Profit Factor: ${pf.toFixed(2)}`);
    console.log("=".repeat(50));

    console.log("\n📋 LAST 10 TRADES:");
    this.trades.slice(-10).forEach((t, i) => {
      const emoji = t.pnl > 0 ? "✅" : "❌";
      console.log(`  ${emoji} ${t.symbol} ${t.type} | Entry: ${t.entry} | Exit: ${t.exitType} | PnL: $${t.pnl}`);
    });
  }

  _avgWin() {
    const wins = this.trades.filter((t) => t.pnl > 0);
    if (wins.length === 0) return 0;
    return wins.reduce((a, b) => a + b.pnl, 0) / wins.length;
  }

  _avgLoss() {
    const losses = this.trades.filter((t) => t.pnl < 0);
    if (losses.length === 0) return 0;
    return losses.reduce((a, b) => a + b.pnl, 0) / losses.length;
  }

  _profitFactor() {
    const wins = this.trades.filter((t) => t.pnl > 0).reduce((a, b) => a + b.pnl, 0);
    const losses = Math.abs(this.trades.filter((t) => t.pnl < 0).reduce((a, b) => a + b.pnl, 0));
    return losses === 0 ? wins : wins / losses;
  }

  _ema(values, period) {
    const result = [];
    const multiplier = 2 / (period + 1);
    let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    result.push(ema);
    for (let i = period; i < values.length; i++) {
      ema = (values[i] - ema) * multiplier + ema;
      result.push(ema);
    }
    return result;
  }
}

new Backtest().run();
