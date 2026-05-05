const { RSI_PERIOD, MACD_FAST, MACD_SLOW, MACD_SIGNAL, BB_PERIOD, BB_STD, EMA_FAST, EMA_SLOW, ATR_PERIOD } = require("./config");

class Analysis {
  static rsi(closes, period = RSI_PERIOD) {
    const changes = [];
    for (let i = 1; i < closes.length; i++) changes.push(closes[i] - closes[i - 1]);
    let avgGain = 0, avgLoss = 0;
    for (let i = 0; i < period; i++) { if (changes[i] > 0) avgGain += changes[i]; else avgLoss += Math.abs(changes[i]); }
    avgGain /= period; avgLoss /= period;
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

  static ema(values, period) {
    const result = [];
    const m = 2 / (period + 1);
    if (values.length < period) return [];
    let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
    result.push(ema);
    for (let i = period; i < values.length; i++) { ema = (values[i] - ema) * m + ema; result.push(ema); }
    return result;
  }

  static sma(values, period) {
    const result = [];
    for (let i = period - 1; i < values.length; i++) {
      result.push(values.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period);
    }
    return result;
  }

  static atr(candles, period = ATR_PERIOD) {
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
      trs.push(Math.max(candles[i].high - candles[i].low, Math.abs(candles[i].high - candles[i - 1].close), Math.abs(candles[i].low - candles[i - 1].close)));
    }
    const result = [];
    if (trs.length < period) return [0];
    let avg = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    result.push(avg);
    for (let i = period; i < trs.length; i++) { avg = (avg * (period - 1) + trs[i]) / period; result.push(avg); }
    return result;
  }

  static macd(closes) {
    const emaFast = this.ema(closes, MACD_FAST);
    const emaSlow = this.ema(closes, MACD_SLOW);
    if (!emaFast.length || !emaSlow.length) return { macdLine: [], signalLine: [], histogram: [] };
    const macdLine = [];
    const start = emaFast.length - emaSlow.length;
    for (let i = 0; i < emaSlow.length; i++) macdLine.push(emaFast[i + start] - emaSlow[i]);
    const signalLine = this.ema(macdLine, MACD_SIGNAL);
    const histogram = [];
    const hStart = macdLine.length - signalLine.length;
    for (let i = 0; i < signalLine.length; i++) histogram.push(macdLine[i + hStart] - signalLine[i]);
    return { macdLine, signalLine, histogram };
  }

  static bollingerBands(closes, period = BB_PERIOD, stdMult = BB_STD) {
    const bands = [];
    for (let i = period - 1; i < closes.length; i++) {
      const slice = closes.slice(i - period + 1, i + 1);
      const mean = slice.reduce((a, b) => a + b, 0) / period;
      const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period;
      const std = Math.sqrt(variance);
      bands.push({ upper: mean + stdMult * std, middle: mean, lower: mean - stdMult * std, width: stdMult * std / mean * 100 });
    }
    return bands;
  }

  static stochastic(candles, period = 14, smoothing = 3) {
    if (candles.length < period + smoothing) return { k: 50, d: 50 };
    const kValues = [];
    for (let i = period - 1; i < candles.length; i++) {
      const slice = candles.slice(i - period + 1, i + 1);
      const high = Math.max(...slice.map(c => c.high));
      const low = Math.min(...slice.map(c => c.low));
      const close = slice[slice.length - 1].close;
      const k = high === low ? 50 : ((close - low) / (high - low)) * 100;
      kValues.push(k);
    }
    // Smoothing (Simple Moving Average of K)
    const kSmoothed = [];
    for (let i = smoothing - 1; i < kValues.length; i++) {
      kSmoothed.push(kValues.slice(i - smoothing + 1, i + 1).reduce((a, b) => a + b, 0) / smoothing);
    }
    // D = SMA of K
    const dSmoothed = [];
    if (kSmoothed.length >= smoothing) {
      for (let i = smoothing - 1; i < kSmoothed.length; i++) {
        dSmoothed.push(kSmoothed.slice(i - smoothing + 1, i + 1).reduce((a, b) => a + b, 0) / smoothing);
      }
    }
    return {
      k: kSmoothed.length ? kSmoothed[kSmoothed.length - 1] : 50,
      d: dSmoothed.length ? dSmoothed[dSmoothed.length - 1] : 50
    };
  }

  static adx(candles, period = 14) {
    if (candles.length < period + 1) return { adx: 20, plusDI: 20, minusDI: 20 };
    const tr = [], plusDM = [], minusDM = [];
    for (let i = 1; i < candles.length; i++) {
      const h = candles[i].high, l = candles[i].low;
      const ph = candles[i-1].high, pl = candles[i-1].low;
      tr.push(Math.max(h - l, Math.abs(h - candles[i-1].close), Math.abs(l - candles[i-1].close)));
      plusDM.push(h - ph > pl - l && h - ph > 0 ? h - ph : 0);
      minusDM.push(pl - l > h - ph && pl - l > 0 ? pl - l : 0);
    }
    const avgTR = tr.slice(0, period).reduce((a,b)=>a+b,0)/period;
    let avgPlusDM = plusDM.slice(0, period).reduce((a,b)=>a+b,0)/period;
    let avgMinusDM = minusDM.slice(0, period).reduce((a,b)=>a+b,0)/period;
    const results = [];
    for (let i = period; i < candles.length; i++) {
      const pDI = avgTR > 0 ? (avgPlusDM / avgTR) * 100 : 0;
      const mDI = avgTR > 0 ? (avgMinusDM / avgTR) * 100 : 0;
      const sum = pDI + mDI;
      const dx = sum > 0 ? Math.abs(pDI - mDI) / sum * 100 : 0;
      avgPlusDM = (avgPlusDM * (period - 1) + plusDM[i-1]) / period;
      avgMinusDM = (avgMinusDM * (period - 1) + minusDM[i-1]) / period;
      results.push({ adx: dx, pDI, mDI });
    }
    const adxVal = results.length ? results.slice(-period).reduce((a,b)=>a+b.adx,0)/period : 20;
    return { adx: adxVal, plusDI: results.length ? results[results.length-1].pDI : 0, minusDI: results.length ? results[results.length-1].mDI : 0 };
  }

  static volumeAnalysis(candles, period = 20) {
    if (candles.length < period) return { ratio: 1 };
    const currentVol = candles[candles.length - 1].volume;
    const avgVol = candles.slice(-period).reduce((a, c) => a + c.volume, 0) / period;
    return { ratio: avgVol > 0 ? currentVol / avgVol : 1 };
  }

  static candlestickPatterns(candles) {
    const patterns = [];
    if (candles.length < 3) return patterns;
    const last = candles[candles.length - 1];
    const prev = candles[candles.length - 2];
    const prev2 = candles[candles.length - 3];
    const body = Math.abs(last.close - last.open);
    const range = last.high - last.low;
    if (range === 0) return patterns;

    // Doji
    if (body < range * 0.1) patterns.push({ name: "Doji", type: "NEUTRAL", strength: 2 });
    
    // Hammer / Inverted Hammer
    const lowerWick = Math.min(last.open, last.close) - last.low;
    const upperWick = last.high - Math.max(last.open, last.close);
    if (lowerWick > body * 2 && last.close > last.open) patterns.push({ name: "Çekiç (Hammer)", type: "BULLISH", strength: 3 });
    if (upperWick > body * 2 && last.close < last.open) patterns.push({ name: "Ters Çekiç", type: "BEARISH", strength: 3 });
    
    // Marubozu
    if (body > range * 0.9) {
      if (last.close > last.open) patterns.push({ name: "Bullish Marubozu", type: "BULLISH", strength: 3 });
      else patterns.push({ name: "Bearish Marubozu", type: "BEARISH", strength: 3 });
    }

    // Engulfing
    if (prev.close < prev.open && last.close > last.open && last.close > prev.close && last.open < prev.close) patterns.push({ name: "Bullish Engulfing", type: "BULLISH", strength: 4 });
    if (prev.close > prev.open && last.close < last.open && last.close < prev.open && last.open > prev.close) patterns.push({ name: "Bearish Engulfing", type: "BEARISH", strength: 4 });

    // Morning / Evening Star
    if (prev2.close < prev2.open && Math.abs(prev.close - prev.open) < range * 0.3 && last.close > last.open && last.close > prev.close + body) patterns.push({ name: "Sabah Yıldızı", type: "BULLISH", strength: 3 });
    if (prev2.close > prev2.open && Math.abs(prev.close - prev.open) < range * 0.3 && last.close < last.open && last.close < prev.close - body) patterns.push({ name: "Akşam Yıldızı", type: "BEARISH", strength: 3 });
    
    // Three White Soldiers / Black Crows (simplified)
    if (candles.length >= 4) {
        const c3 = candles[candles.length-4];
        const allGreen = candles.slice(-4).every(c => c.close > c.open);
        const allRed = candles.slice(-4).every(c => c.close < c.open);
        if (allGreen && candles.slice(-4).every((c,i) => i>0 ? c.close > candles.slice(-4)[i-1].close : true)) patterns.push({ name: "3 Beyaz Asker", type: "BULLISH", strength: 3 });
        if (allRed && candles.slice(-4).every((c,i) => i>0 ? c.close < candles.slice(-4)[i-1].close : true)) patterns.push({ name: "3 Siyah Karga", type: "BEARISH", strength: 3 });
    }

    return patterns;
  }

  static compute(candles) {
    const closes = candles.map((c) => c.close);
    const rsi = this.rsi(closes);
    const macd = this.macd(closes);
    const bb = this.bollingerBands(closes);
    const atr = this.atr(candles);
    const ema50 = this.ema(closes, EMA_FAST);
    const ema200 = this.ema(closes, EMA_SLOW);
    const sma20 = this.sma(closes, 20);
    const stoch = this.stochastic(candles);
    const adx = this.adx(candles);
    const vol = this.volumeAnalysis(candles);
    const patterns = this.candlestickPatterns(candles);

    const idx = closes.length - 1;
    return {
      currentPrice: closes[idx],
      rsi: rsi.length ? rsi[rsi.length - 1] : 50,
      macdHistogram: macd.histogram.length ? macd.histogram[macd.histogram.length - 1] : 0,
      macdLine: macd.macdLine.length ? macd.macdLine[macd.macdLine.length - 1] : 0,
      macdSignal: macd.signalLine.length ? macd.signalLine[macd.signalLine.length - 1] : 0,
      bbUpper: bb.length ? bb[bb.length - 1].upper : closes[idx],
      bbLower: bb.length ? bb[bb.length - 1].lower : closes[idx],
      bbMiddle: bb.length ? bb[bb.length - 1].middle : closes[idx],
      atr: atr.length ? atr[atr.length - 1] : 0,
      ema50: ema50.length ? ema50[ema50.length - 1] : closes[idx],
      ema200: ema200.length ? ema200[ema200.length - 1] : closes[idx],
      sma20: sma20.length ? sma20[sma20.length - 1] : closes[idx],
      stochK: stoch.k,
      stochD: stoch.d,
      adx: adx.adx,
      plusDI: adx.plusDI,
      minusDI: adx.minusDI,
      volumeRatio: vol.ratio,
      patterns,
      volume: candles[idx].volume,
    };
  }
}

module.exports = Analysis;
