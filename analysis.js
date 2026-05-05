const {
  RSI_PERIOD,
  RSI_OVERBOUGHT,
  RSI_OVERSOLD,
  MACD_FAST,
  MACD_SLOW,
  MACD_SIGNAL,
  BB_PERIOD,
  BB_STD,
  EMA_FAST,
  EMA_SLOW,
  ATR_PERIOD,
} = require("./config");

class Analysis {
  static rsi(closes, period = RSI_PERIOD) {
    const changes = [];
    for (let i = 1; i < closes.length; i++) {
      changes.push(closes[i] - closes[i - 1]);
    }

    let avgGain = 0,
      avgLoss = 0;
    for (let i = 0; i < period; i++) {
      if (changes[i] > 0) avgGain += changes[i];
      else avgLoss += Math.abs(changes[i]);
    }
    avgGain /= period;
    avgLoss /= period;

    const result = [];
    for (let i = period; i < changes.length; i++) {
      const gain = changes[i] > 0 ? changes[i] : 0;
      const loss = changes[i] < 0 ? Math.abs(changes[i]) : 0;
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      result.push(100 - 100 / (1 + rs));
    }
    return result;
  }

  static macd(closes) {
    const emaFast = this.ema(closes, MACD_FAST);
    const emaSlow = this.ema(closes, MACD_SLOW);
    const macdLine = [];
    const len = Math.min(emaFast.length, emaSlow.length);
    const start = emaFast.length - emaSlow.length;

    for (let i = 0; i < len; i++) {
      macdLine.push(emaFast[i + start] - emaSlow[i]);
    }

    const signalLine = this.ema(macdLine, MACD_SIGNAL);
    const histogram = [];
    const histStart = macdLine.length - signalLine.length;
    for (let i = 0; i < signalLine.length; i++) {
      histogram.push(macdLine[i + histStart] - signalLine[i]);
    }

    return { macdLine, signalLine, histogram };
  }

  static bollingerBands(closes, period = BB_PERIOD, stdMult = BB_STD) {
    const sma = this.sma(closes, period);
    const bands = [];
    for (let i = period - 1; i < closes.length; i++) {
      const slice = closes.slice(i - period + 1, i + 1);
      const mean = slice.reduce((a, b) => a + b, 0) / period;
      const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
      const std = Math.sqrt(variance);
      bands.push({
        upper: mean + stdMult * std,
        middle: mean,
        lower: mean - stdMult * std,
      });
    }
    return bands;
  }

  static atr(candles, period = ATR_PERIOD) {
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
      const highLow = candles[i].high - candles[i].low;
      const highClose = Math.abs(candles[i].high - candles[i - 1].close);
      const lowClose = Math.abs(candles[i].low - candles[i - 1].close);
      trs.push(Math.max(highLow, highClose, lowClose));
    }

    const result = [];
    let avg = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    result.push(avg);

    for (let i = period; i < trs.length; i++) {
      avg = (avg * (period - 1) + trs[i]) / period;
      result.push(avg);
    }
    return result;
  }

  static ema(values, period) {
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

  static sma(values, period) {
    const result = [];
    for (let i = period - 1; i < values.length; i++) {
      const sum = values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
      result.push(sum / period);
    }
    return result;
  }

  static compute(candles) {
    const closes = candles.map((c) => c.close);
    const rsi = this.rsi(closes);
    const macd = this.macd(closes);
    const bb = this.bollingerBands(closes);
    const atr = this.atr(candles);
    const ema50 = this.ema(closes, EMA_FAST);
    const ema200 = this.ema(closes, EMA_SLOW);

    return {
      currentPrice: closes[closes.length - 1],
      rsi: rsi[rsi.length - 1],
      macdHistogram: macd.histogram[macd.histogram.length - 1],
      macdLine: macd.macdLine[macd.macdLine.length - 1],
      macdSignal: macd.signalLine[macd.signalLine.length - 1],
      bbUpper: bb[bb.length - 1].upper,
      bbLower: bb[bb.length - 1].lower,
      bbMiddle: bb[bb.length - 1].middle,
      atr: atr[atr.length - 1],
      ema50: ema50[ema50.length - 1],
      ema200: ema200[ema200.length - 1],
      volume: candles[candles.length - 1].volume,
    };
  }
}

module.exports = Analysis;
