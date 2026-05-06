const ccxt = require("ccxt");

class ExchangeClient {
  constructor(exchangeName = "bitget", apiKey = "", secret = "", password = "") {
    this.name = exchangeName;
    const exchangeClass = ccxt[exchangeName];
    if (!exchangeClass) throw new Error(`Desteklenmeyen borsa: ${exchangeName}`);
    
    this.exchange = new exchangeClass({
      apiKey: apiKey || "",
      secret: secret || "",
      password: password || "",
      enableRateLimit: true,
      options: { defaultType: "spot" },
    });
  }

  async getKlines(symbol, timeframe = "1h", limit = 300) {
    try {
      const ohlcv = await this.exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
      return ohlcv.map((c) => ({ timestamp: c[0], open: c[1], high: c[2], low: c[3], close: c[4], volume: c[5] }));
    } catch (e) {
      console.error(`[${this.name}] Kline fetch error:`, e.message);
      return [];
    }
  }

  async getPrice(symbol) {
    try {
      const ticker = await this.exchange.fetchTicker(symbol);
      return ticker.last;
    } catch (e) {
      console.error(`[${this.name}] Price fetch error:`, e.message);
      return null;
    }
  }

  async placeOrder(symbol, side, amount, price = null, leverage = 10, marginMode = "cross") {
    try {
      await this.exchange.setLeverage(leverage, symbol);
      await this.exchange.setMarginMode(marginMode, symbol);
      const order = await this.exchange.createOrder(symbol, "market", side, amount, price, { marginMode });
      return order;
    } catch (e) {
      console.error(`[${this.name}] Order error:`, e.message);
      throw e;
    }
  }

  async closePosition(symbol, side, marginMode = "cross") {
    try {
      const positions = await this.exchange.fetchPositions([symbol]);
      const pos = positions.find(p => p.symbol === symbol && parseFloat(p.contracts) > 0);
      if (pos) {
        return await this.exchange.createOrder(symbol, "market", side, pos.contracts, undefined, { reduceOnly: true, marginMode });
      }
      return null;
    } catch (e) {
      console.error(`[${this.name}] Close position error:`, e.message);
      return null;
    }
  }

  async getOpenPositions() {
    try {
      return await this.exchange.fetchPositions();
    } catch (e) {
      return [];
    }
  }

  static getSupportedExchanges() {
    return ["bitget", "binance", "bybit", "okx", "gate"];
  }
}

module.exports = ExchangeClient;
