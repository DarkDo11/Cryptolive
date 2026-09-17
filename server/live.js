const BINANCE_MAP = {
  'bitcoin': 'btcusdt',
  'ethereum': 'ethusdt',
  'binancecoin': 'bnbusdt',
  'solana': 'solusdt',
  'ripple': 'xrpusdt',
  'cardano': 'adausdt',
  'dogecoin': 'dogeusdt',
  'tron': 'trxusdt',
  'avalanche-2': 'avaxusdt',
  'chainlink': 'linkusdt',
  'polkadot': 'dotusdt',
  'matic-network': 'polusdt',
  'litecoin': 'ltcusdt',
  'bitcoin-cash': 'bchusdt',
  'shiba-inu': 'shibusdt',
  'uniswap': 'uniusdt',
  'stellar': 'xlmusdt',
  'near': 'nearusdt',
  'aptos': 'aptusdt',
  'internet-computer': 'icpusdt',
  'ethereum-classic': 'etcusdt',
  'filecoin': 'filusdt',
  'hedera-hashgraph': 'hbarusdt',
  'sui': 'suiusdt',
  'arbitrum': 'arbusdt',
  'optimism': 'opusdt',
  'cosmos': 'atomusdt',
  'render-token': 'renderusdt',
  'injective-protocol': 'injusdt',
  'the-graph': 'grtusdt',
  'pepe': 'pepeusdt',
  'zcash': 'zecusdt',
  'fetch-ai': 'fetusdt',
  'immutable-x': 'imxusdt',
  'algorand': 'algousdt',
  'vechain': 'vetusdt',
  'aave': 'aaveusdt',
  'maker': 'mkrusdt',
  'the-sandbox': 'sandusdt',
  'decentraland': 'manausdt',
  'axie-infinity': 'axsusdt',
  'theta-token': 'thetausdt',
  'eos': 'eosusdt',
  'tezos': 'xtzusdt',
  'neo': 'neousdt',
  'toncoin': 'tonusdt',
  'crypto-com-chain': 'crousdt',
  'bittensor': 'taousdt',
  'ondo-finance': 'ondousdt',
  'worldcoin-wld': 'wldusdt',
  'jupiter-exchange-solana': 'jupusdt',
  'sei-network': 'seiusdt',
  'celestia': 'tiausdt',
  'mantle': 'mntusdt',
  'dogwifcoin': 'wifusdt',
  'floki': 'flokiusdt',
  'bonk': 'bonkusdt',
  'starknet': 'strkusdt',
  'ethena': 'enausdt',
  'pyth-network': 'pythusdt'
};

const SYMBOL_TO_ID = Object.fromEntries(Object.entries(BINANCE_MAP).map(([id, sym]) => [sym.toUpperCase(), id]));

export function createLive() {
  let subscribers = new Set();
  let ws = null;
  let disconnectTimer = null;
  let tickTimer = null;
  let keepAliveTimer = null;
  let reconnectDelay = 1000;
  
  let connected = false;
  let latestPrices = {};   // pending delta since the last broadcast
  let snapshot = {};       // last known price for every symbol
  let changedSinceLastTick = false;
  let lastMessageAt = null;
  let reconnects = 0;

  const getStreamUrl = () => {
    const streams = Object.values(BINANCE_MAP).map(s => `${s}@miniTicker`).join('/');
    return `wss://stream.binance.com:9443/stream?streams=${streams}`;
  };

  const broadcast = (event, data) => {
    if (subscribers.size === 0) return;
    const msg = data ? `event: ${event}\ndata: ${JSON.stringify(data)}\n\n` : `event: ${event}\n\n`;
    for (const res of subscribers) {
      res.write(msg);
    }
  };

  const pingAll = () => {
    if (subscribers.size === 0) return;
    for (const res of subscribers) {
      res.write(`: ping\n\n`);
    }
  };

  const flushTicks = () => {
    if (!changedSinceLastTick || subscribers.size === 0) return;
    broadcast('tick', { ts: Date.now(), prices: latestPrices });
    latestPrices = {};
    changedSinceLastTick = false;
  };

  const connect = () => {
    if (ws) return;
    ws = new WebSocket(getStreamUrl());
    
    ws.onopen = () => {
      connected = true;
      reconnectDelay = 1000;
    };
    
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.data && msg.data.s) {
          const sym = msg.data.s;
          const id = SYMBOL_TO_ID[sym];
          if (id) {
            const p = parseFloat(msg.data.c);
            const o = parseFloat(msg.data.o);
            const c = o !== 0 ? ((p - o) / o) * 100 : 0;
            latestPrices[id] = { p, c };
            snapshot[id] = { p, c };
            changedSinceLastTick = true;
            lastMessageAt = Date.now();
          }
        }
      } catch (e) {}
    };
    
    ws.onclose = () => {
      connected = false;
      ws = null;
      if (subscribers.size > 0) {
        setTimeout(connect, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
        reconnects++;
      }
    };

    ws.onerror = () => {
      // ws.onclose will handle reconnect
    };
  };

  const checkConnection = () => {
    if (subscribers.size > 0) {
      if (disconnectTimer) {
        clearTimeout(disconnectTimer);
        disconnectTimer = null;
      }
      if (!ws && !disconnectTimer) {
        connect();
      }
      if (!tickTimer) {
        tickTimer = setInterval(flushTicks, 1000);
      }
      if (!keepAliveTimer) {
        keepAliveTimer = setInterval(pingAll, 25000);
      }
    } else {
      if (!disconnectTimer) {
        disconnectTimer = setTimeout(() => {
          if (ws) {
            ws.close();
            ws = null;
          }
          if (tickTimer) {
            clearInterval(tickTimer);
            tickTimer = null;
          }
          if (keepAliveTimer) {
            clearInterval(keepAliveTimer);
            keepAliveTimer = null;
          }
        }, 60000);
      }
    }
  };

  return {
    subscribe(res) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
      });
      subscribers.add(res);
      
      const ids = Object.keys(BINANCE_MAP);
      if (Object.keys(snapshot).length > 0) {
        res.write(`event: tick\ndata: ${JSON.stringify({ ts: Date.now(), prices: snapshot })}\n\n`);
      }
      res.write(`event: hello\ndata: ${JSON.stringify({ symbols: ids })}\n\n`);
      
      checkConnection();
    },
    unsubscribe(res) {
      subscribers.delete(res);
      checkConnection();
    },
    status() {
      return {
        connected,
        subscribers: subscribers.size,
        symbols: Object.keys(BINANCE_MAP).length,
        pricesKnown: Object.keys(snapshot).length,
        lastMessageAt,
        reconnects
      };
    }
  };
}
