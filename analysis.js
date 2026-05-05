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
      bands.push({ upper: mean + stdMult * std, middle: mean, lower: mean - stdMult * std });
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
    const kSmoothed = [];
    for (let i = smoothing - 1; i < kValues.length; i++) kSmoothed.push(kValues.slice(i - smoothing + 1, i + 1).reduce((a, b) => a + b, 0) / smoothing);
    const dSmoothed = [];
    if (kSmoothed.length >= smoothing) for (let i = smoothing - 1; i < kSmoothed.length; i++) dSmoothed.push(kSmoothed.slice(i - smoothing + 1, i + 1).reduce((a, b) => a + b, 0) / smoothing);
    return { k: kSmoothed.length ? kSmoothed[kSmoothed.length - 1] : 50, d: dSmoothed.length ? dSmoothed[dSmoothed.length - 1] : 50 };
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

  static cci(candles, period = 20) {
    if (candles.length < period) return 0;
    let tpSum = 0;
    const tps = [];
    for (let i = candles.length - period; i < candles.length; i++) {
      const tp = (candles[i].high + candles[i].low + candles[i].close) / 3;
      tps.push(tp);
      tpSum += tp;
    }
    const meanTP = tpSum / period;
    let meanDev = 0;
    tps.forEach(tp => meanDev += Math.abs(tp - meanTP));
    meanDev /= period;
    const currentTP = (candles[candles.length - 1].high + candles[candles.length - 1].low + candles[candles.length - 1].close) / 3;
    return meanDev === 0 ? 0 : (currentTP - meanTP) / (0.015 * meanDev);
  }

  static obv(candles) {
    let obv = 0;
    for (let i = 1; i < candles.length; i++) {
      if (candles[i].close > candles[i-1].close) obv += candles[i].volume;
      else if (candles[i].close < candles[i-1].close) obv -= candles[i].volume;
    }
    return obv;
  }

  static supertrend(candles, period = 10, multiplier = 3) {
    if (candles.length < period + 1) return { trend: "NEUTRAL", value: 0 };
    const atr = this.atr(candles, period);
    if (!atr.length) return { trend: "NEUTRAL", value: 0 };
    const lastATR = atr[atr.length - 1];
    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];
    const hl2 = (lastCandle.high + lastCandle.low) / 2;
    const upperBand = hl2 + (multiplier * lastATR);
    const lowerBand = hl2 - (multiplier * lastATR);
    // Simplified logic: Price above lower band = bullish, below = bearish
    const trend = lastCandle.close > lowerBand ? "BULLISH" : "BEARISH";
    return { trend, value: trend === "BULLISH" ? lowerBand : upperBand };
  }

  static parabolicSAR(candles, step = 0.02, max = 0.2) {
    if (candles.length < 2) return { value: 0, trend: "NEUTRAL" };
    const len = candles.length;
    let af = step;
    let ep = candles[len - 2].high > candles[len - 3].high ? candles[len - 2].high : candles[len - 2].low;
    let sar = candles[len - 2].low;
    let uptrend = candles[len - 2].close > sar;

    // One step calculation for current candle approximation
    if (uptrend) {
      sar = sar + af * (ep - sar);
      if (candles[len-1].low < sar) {
        uptrend = false;
        sar = ep;
        af = step;
        ep = candles[len-1].low;
      }
    } else {
      sar = sar - af * (sar - ep);
      if (candles[len-1].high > sar) {
        uptrend = true;
        sar = ep;
        af = step;
        ep = candles[len-1].high;
      }
    }
    return { value: sar, trend: uptrend ? "BULLISH" : "BEARISH" };
  }

  static ichimoku(candles) {
    if (candles.length < 26) return { tenkan: 0, kijun: 0, senkouA: 0, senkouB: 0 };
    const slice = (n) => candles.slice(-n).map(c => c.high + c.low).reduce((a,b)=>a+b,0) / 2 / n; // Simplified High+Low/2
    // Actually Ichimoku uses (Highest High + Lowest Low) / 2
    const hl = (n) => { const s = candles.slice(-n); return (Math.max(...s.map(c=>c.high)) + Math.min(...s.map(c=>c.low))) / 2; };
    const tenkan = hl(9);
    const kijun = hl(26);
    const senkouA = (tenkan + kijun) / 2;
    const senkouB = hl(52);
    return { tenkan, kijun, senkouA, senkouB };
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

    if (body < range * 0.1) patterns.push({ name: "Doji", type: "NEUTRAL", strength: 2 });
    const lowerWick = Math.min(last.open, last.close) - last.low;
    const upperWick = last.high - Math.max(last.open, last.close);
    if (lowerWick > body * 2 && last.close > last.open) patterns.push({ name: "Hammer", type: "BULLISH", strength: 3 });
    if (upperWick > body * 2 && last.close < last.open) patterns.push({ name: "Inverted Hammer", type: "BEARISH", strength: 3 });
    if (body > range * 0.9) patterns.push({ name: last.close > last.open ? "Bullish Marubozu" : "Bearish Marubozu", type: last.close > last.open ? "BULLISH" : "BEARISH", strength: 3 });
    
    if (prev.close < prev.open && last.close > last.open && last.close > prev.close && last.open < prev.close) patterns.push({ name: "Bullish Engulfing", type: "BULLISH", strength: 4 });
    if (prev.close > prev.open && last.close < last.open && last.close < prev.open && last.open > prev.close) patterns.push({ name: "Bearish Engulfing", type: "BEARISH", strength: 4 });

    // Harami
    if (prev.close < prev.open && last.close > last.open && last.close < prev.close && last.open > prev.close) patterns.push({ name: "Bullish Harami", type: "BULLISH", strength: 2 });
    if (prev.close > prev.open && last.close < last.open && last.close > prev.close && last.open < prev.open) patterns.push({ name: "Bearish Harami", type: "BEARISH", strength: 2 });

    return patterns;
  }

  static calculateLevels(candles) {
    const lookback = 50;
    const slice = candles.slice(-lookback);
    const resistance = Math.max(...slice.map(c => c.high));
    const support = Math.min(...slice.map(c => c.low));
    return { resistance, support };
  }

  static _findSwings(candles, lookback = 80, leftLeg = 5, rightLeg = 5) {
    const highs = [], lows = [];
    const slice = candles.slice(-lookback);
    for (let i = leftLeg; i < slice.length - rightLeg; i++) {
      let isHigh = true, isLow = true;
      for (let j = 1; j <= leftLeg; j++) {
        if (slice[i].high <= slice[i - j].high) isHigh = false;
        if (slice[i].low >= slice[i - j].low) isLow = false;
      }
      for (let j = 1; j <= rightLeg; j++) {
        if (slice[i].high <= slice[i + j].high) isHigh = false;
        if (slice[i].low >= slice[i + j].low) isLow = false;
      }
      if (isHigh) highs.push({ idx: i, price: slice[i].high, type: "HIGH" });
      if (isLow) lows.push({ idx: i, price: slice[i].low, type: "LOW" });
    }
    return { highs, lows };
  }

  static vwap(candles) {
    if (candles.length < 2) return 0;
    let cumVolPrice = 0, cumVol = 0;
    for (const c of candles) {
      const tp = (c.high + c.low + c.close) / 3;
      cumVolPrice += tp * c.volume;
      cumVol += c.volume;
    }
    return cumVol === 0 ? 0 : cumVolPrice / cumVol;
  }

  static fibonacci(candles) {
    if (candles.length < 20) return { levels: [], trend: "NEUTRAL" };
    const slice = candles.slice(-100); // Son 100 mumdan hesapla
    const high = Math.max(...slice.map(c => c.high));
    const low = Math.min(...slice.map(c => c.low));
    const range = high - low;
    const trend = candles[candles.length - 1].close > candles[candles.length - 20].close ? "UP" : "DOWN";
    
    // Düzeltme seviyeleri (Trend yükselişse dipten tepeye, düşüşse tepeden dibe)
    const levels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    const fibLevels = levels.map(l => {
      const price = trend === "UP" ? high - range * l : low + range * l;
      return { level: l, price };
    });
    
    return { levels: fibLevels, trend };
  }

  static chartPatterns(candles) {
    const patterns = [];
    const { highs, lows } = this._findSwings(candles, 80, 5, 5);
    if (highs.length < 3 || lows.length < 3) return patterns;

    const lastHigh = highs[highs.length - 1];
    const prevHigh = highs[highs.length - 2];
    const prevHigh2 = highs[highs.length - 3];
    const lastLow = lows[lows.length - 1];
    const prevLow = lows[lows.length - 2];
    const prevLow2 = lows[lows.length - 3];

    const tolerance = 0.015; // 1.5% tolerance

    // --- HEAD AND SHOULDERS ---
    // Right shoulder lower than head, head higher than left shoulder, neckline break
    if (prevHigh2.price < prevHigh.price && lastHigh.price < prevHigh.price &&
        Math.abs(prevHigh2.price - lastHigh.price) / prevHigh2.price < tolerance) {
      // Check for downtrend into pattern
      const neckline = Math.min(prevLow2.price, prevLow.price);
      patterns.push({ name: "Omuz-Baş-Omuz", type: "BEARISH", strength: 8, neckline });
    }

    // --- INVERSE HEAD AND SHOULDERS ---
    if (prevLow2.price > prevLow.price && lastLow.price > prevLow.price &&
        Math.abs(prevLow2.price - lastLow.price) / prevLow2.price < tolerance) {
      const neckline = Math.max(prevHigh2.price, prevHigh.price);
      patterns.push({ name: "Ters OBO", type: "BULLISH", strength: 8, neckline });
    }

    // --- DOUBLE TOP ---
    if (highs.length >= 2) {
      const h1 = highs[highs.length - 2], h2 = highs[highs.length - 1];
      if (Math.abs(h1.price - h2.price) / h1.price < tolerance && h1.price > lows[lows.length - 1].price * 1.02) {
        const neckline = lows[lows.length - 1].price;
        patterns.push({ name: "İkili Tepe", type: "BEARISH", strength: 7, neckline });
      }
    }

    // --- DOUBLE BOTTOM ---
    if (lows.length >= 2) {
      const l1 = lows[lows.length - 2], l2 = lows[lows.length - 1];
      if (Math.abs(l1.price - l2.price) / l1.price < tolerance && l1.price < highs[highs.length - 1].price * 0.98) {
        const neckline = highs[highs.length - 1].price;
        patterns.push({ name: "İkili Dip", type: "BULLISH", strength: 7, neckline });
      }
    }

    // --- ASCENDING TRIANGLE ---
    if (highs.length >= 3 && lows.length >= 2) {
      const recentHighs = highs.slice(-3);
      const maxH = Math.max(...recentHighs.map(h => h.price));
      const minH = Math.min(...recentHighs.map(h => h.price));
      const flatResistance = (maxH - minH) / maxH < 0.02; // Flat top
      
      const recentLows = lows.slice(-2);
      const risingLows = recentLows[1].price > recentLows[0].price * 1.005;
      
      if (flatResistance && risingLows) {
        patterns.push({ name: "Yükselen Üçgen", type: "BULLISH", strength: 6, neckline: maxH });
      }
    }

    // --- DESCENDING TRIANGLE ---
    if (highs.length >= 2 && lows.length >= 3) {
      const recentLows = lows.slice(-3);
      const maxL = Math.max(...recentLows.map(l => l.price));
      const minL = Math.min(...recentLows.map(l => l.price));
      const flatSupport = (maxL - minL) / maxL < 0.02; // Flat bottom
      
      const recentHighs = lows.length >= 2 ? highs.slice(-2) : [];
      if (recentHighs.length >= 2) {
        const fallingHighs = recentHighs[1].price < recentHighs[0].price * 0.995;
        if (flatSupport && fallingHighs) {
          patterns.push({ name: "Düşen Üçgen", type: "BEARISH", strength: 6, neckline: minL });
        }
      }
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
    const cci = this.cci(candles);
    const obv = this.obv(candles);
    const supertrend = this.supertrend(candles);
    const psar = this.parabolicSAR(candles);
    const ichimoku = this.ichimoku(candles);
    const vwap = this.vwap(candles);
    const fib = this.fibonacci(candles);
    
    const patterns = this.candlestickPatterns(candles);
    const chartPats = this.chartPatterns(candles);
    const allPatterns = [...patterns, ...chartPats];
    const levels = this.calculateLevels(candles);

    const idx = closes.length - 1;
    const avgVol = candles.slice(-20).reduce((sum, c) => sum + c.volume, 0) / 20;
    const volumeRatio = avgVol > 0 ? candles[idx].volume / avgVol : 1;

    return {
      currentPrice: closes[idx],
      volumeRatio,
      rsi: rsi.length ? rsi[rsi.length - 1] : 50,
      macdHistogram: macd.histogram.length ? macd.histogram[macd.histogram.length - 1] : 0,
      macdLine: macd.macdLine.length ? macd.macdLine[macd.macdLine.length - 1] : 0,
      macdSignal: macd.signalLine.length ? macd.signalLine[macd.signalLine.length - 1] : 0,
      bbUpper: bb.length ? bb[bb.length - 1].upper : closes[idx],
      bbLower: bb.length ? bb[bb.length - 1].lower : closes[idx],
      atr: atr.length ? atr[atr.length - 1] : 0,
      ema50: ema50.length ? ema50[ema50.length - 1] : closes[idx],
      ema200: ema200.length ? ema200[ema200.length - 1] : closes[idx],
      sma20: sma20.length ? sma20[sma20.length - 1] : closes[idx],
      stochK: stoch.k,
      stochD: stoch.d,
      adx: adx.adx,
      plusDI: adx.plusDI,
      minusDI: adx.minusDI,
      cci: cci,
      obv: obv,
      supertrend: supertrend,
      psar: psar,
      ichimoku: ichimoku,
      vwap: vwap,
      fib: fib,
      patterns: allPatterns,
      candlestickPatterns: patterns,
      chartPatterns: chartPats,
      resistance: levels.resistance,
      support: levels.support,
    };
  }
}

module.exports = Analysis;
