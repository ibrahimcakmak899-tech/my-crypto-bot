const ccxt = require("ccxt");

class BinanceClient {
  constructor() {
    this.exchange = new ccxt.binance({
      enableRateLimit: true,
    });
  }

  async getKlines(symbol, timeframe = "15m", limit = 300) {
    const ohlcv = await this.exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
    return ohlcv.map((candle) => ({
      timestamp: candle[0],
      open: candle[1],
      high: candle[2],
      low: candle[3],
      close: candle[4],
      volume: candle[5],
    }));
  }

  async getPrice(symbol) {
    const ticker = await this.exchange.fetchTicker(symbol);
    return ticker.last;
  }

  async get24hChange(symbol) {
    const ticker = await this.exchange.fetchTicker(symbol);
    return ticker.percentage;
  }

  async getMarketOverview() {
    const tickers = await this.exchange.fetchTickers();
    return tickers;
  }
}

module.exports = BinanceClient;
