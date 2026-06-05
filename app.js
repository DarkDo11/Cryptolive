"use strict";

const API_BASE = "https://api.coingecko.com/api/v3";
const MARKET_URL = `${API_BASE}/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1&sparkline=true&price_change_percentage=24h`;
const FEAR_GREED_VALUE = 63;
const UPDATE_CHECK_MS = 1000;
const MIN_STREAM_DELAY_MS = 3000;
const MAX_STREAM_DELAY_MS = 5000;

const state = {
  coins: [],
  selectedCoinId: null,
  chart: null,
  chartCoinId: null,
  nextStreamAt: 0,
  streamTimer: null,
  historyCache: new Map(),
};

const els = {
  marketCap: document.querySelector("#marketCap"),
  btcDominance: document.querySelector("#btcDominance"),
  fearGreed: document.querySelector("#fearGreed"),
  streamStatus: document.querySelector("#streamStatus"),
  themeToggle: document.querySelector("#themeToggle"),
  themeLabel: document.querySelector("#themeLabel"),
  marketTable: document.querySelector("#marketTable"),
  lastUpdated: document.querySelector("#lastUpdated"),
  chartTitle: document.querySelector("#chartTitle"),
  chartMeta: document.querySelector("#chartMeta"),
  chartCanvas: document.querySelector("#priceChart"),
  chartPlaceholder: document.querySelector("#chartPlaceholder"),
};

function createSimulatedEventSource(url) {
  const listeners = new Map();

  return {
    url,
    readyState: 1,
    addEventListener(type, callback) {
      const bucket = listeners.get(type) || new Set();
      bucket.add(callback);
      listeners.set(type, bucket);
    },
    removeEventListener(type, callback) {
      listeners.get(type)?.delete(callback);
    },
    emit(type, detail) {
      const event = { type, data: JSON.stringify(detail), timeStamp: Date.now() };
      listeners.get(type)?.forEach((callback) => callback(event));
    },
    close() {
      this.readyState = 2;
      listeners.clear();
    },
  };
}

const simulatedStream = createSimulatedEventSource("/api/stream");

document.addEventListener("DOMContentLoaded", init);

async function init() {
  setupTheme();
  setupStream();
  els.fearGreed.textContent = FEAR_GREED_VALUE;
  await loadMarketData();
}

function setupTheme() {
  const savedTheme = localStorage.getItem("cryptolive-theme");
  const theme = savedTheme || "dark";
  applyTheme(theme);

  els.themeToggle.addEventListener("click", () => {
    const nextTheme = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    localStorage.setItem("cryptolive-theme", nextTheme);
    applyTheme(nextTheme);
    updateChartTheme();
  });
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const isLight = theme === "light";
  els.themeToggle.setAttribute("aria-pressed", String(isLight));
  els.themeToggle.setAttribute("aria-label", `Switch to ${isLight ? "dark" : "light"} theme`);
  els.themeLabel.textContent = isLight ? "Light" : "Dark";
}

async function loadMarketData() {
  try {
    const response = await fetch(MARKET_URL, { cache: "no-store" });

    if (!response.ok) {
      throw new Error(`CoinGecko responded with ${response.status}`);
    }

    const data = await response.json();
    state.coins = data.map(normalizeCoin);
    renderMarketSummary();
    renderTable();
    scheduleNextStreamUpdate();
    els.lastUpdated.textContent = `Loaded ${formatTime(new Date())}`;
  } catch (error) {
    els.marketTable.innerHTML = `<tr><td colspan="6" class="error-cell">Market data unavailable. ${escapeHtml(error.message)}</td></tr>`;
    els.streamStatus.textContent = "Waiting for market data";
  }
}

function normalizeCoin(coin) {
  const price = Number(coin.current_price || 0);
  const sparkline = Array.isArray(coin.sparkline_in_7d?.price)
    ? coin.sparkline_in_7d.price.map((point) => Number(point)).filter(Number.isFinite)
    : [];

  return {
    id: coin.id,
    rank: coin.market_cap_rank,
    name: coin.name,
    symbol: coin.symbol,
    image: coin.image,
    price,
    basePrice: price,
    change24h: Number(coin.price_change_percentage_24h_in_currency ?? coin.price_change_percentage_24h ?? 0),
    volume: Number(coin.total_volume || 0),
    marketCap: Number(coin.market_cap || 0),
    sparkline,
  };
}

function setupStream() {
  simulatedStream.addEventListener("price-tick", (event) => {
    const updates = JSON.parse(event.data);
    applyPriceUpdates(updates);
    renderTable();
    renderMarketSummary();
    updateSelectedChartLivePrice();
    els.lastUpdated.textContent = `Simulated tick ${formatTime(new Date())}`;
  });

  state.streamTimer = window.setInterval(() => {
    if (!state.coins.length || Date.now() < state.nextStreamAt) {
      return;
    }

    simulatedStream.emit("price-tick", generatePriceUpdates());
    scheduleNextStreamUpdate();
  }, UPDATE_CHECK_MS);

  window.addEventListener("beforeunload", () => {
    window.clearInterval(state.streamTimer);
    simulatedStream.close();
  });
}

function scheduleNextStreamUpdate() {
  state.nextStreamAt = Date.now() + randomInt(MIN_STREAM_DELAY_MS, MAX_STREAM_DELAY_MS);
}

function generatePriceUpdates() {
  return state.coins.map((coin) => {
    const volatility = coin.id === "bitcoin" || coin.id === "ethereum" ? 0.006 : 0.012;
    const drift = randomFloat(-volatility, volatility);
    const price = Math.max(coin.price * (1 + drift), 0.000001);
    const sparkline = coin.sparkline.length ? [...coin.sparkline.slice(1), price] : [price];

    return {
      id: coin.id,
      price,
      change24h: clamp(coin.change24h + randomFloat(-0.22, 0.22), -30, 30),
      volume: Math.max(coin.volume * (1 + randomFloat(-0.008, 0.008)), 0),
      marketCap: Math.max(coin.marketCap * (price / coin.price), 0),
      sparkline,
    };
  });
}

function applyPriceUpdates(updates) {
  const byId = new Map(updates.map((update) => [update.id, update]));

  state.coins = state.coins.map((coin) => {
    const update = byId.get(coin.id);
    return update ? { ...coin, ...update } : coin;
  });
}

function renderMarketSummary() {
  const totalMarketCap = state.coins.reduce((sum, coin) => sum + coin.marketCap, 0);
  const btc = state.coins.find((coin) => coin.id === "bitcoin");
  const btcDominance = btc && totalMarketCap ? (btc.marketCap / totalMarketCap) * 100 : 0;

  els.marketCap.textContent = formatCompactCurrency(totalMarketCap);
  els.btcDominance.textContent = `${btcDominance.toFixed(1)}%`;
}

function renderTable() {
  els.marketTable.innerHTML = state.coins.map(renderCoinRow).join("");

  els.marketTable.querySelectorAll("tr[data-coin-id]").forEach((row) => {
    row.addEventListener("click", () => selectCoin(row.dataset.coinId));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectCoin(row.dataset.coinId);
      }
    });
  });
}

function renderCoinRow(coin, index) {
  const directionClass = coin.change24h >= 0 ? "is-up" : "is-down";
  const selectedClass = coin.id === state.selectedCoinId ? "is-selected" : "";

  return `
    <tr class="${selectedClass}" data-coin-id="${escapeHtml(coin.id)}" tabindex="0" aria-label="Load ${escapeHtml(coin.name)} chart">
      <td>${index + 1}</td>
      <td>
        <div class="asset-cell">
          <span class="asset-icon" aria-hidden="true">${escapeHtml(coin.symbol.slice(0, 3))}</span>
          <span class="asset-copy">
            <span class="asset-name">${escapeHtml(coin.name)}</span>
            <span class="asset-symbol">${escapeHtml(coin.symbol)}</span>
          </span>
        </div>
      </td>
      <td class="price-cell" data-price="${coin.price}">${formatCurrency(coin.price)}</td>
      <td><span class="change-badge ${directionClass}">${formatPercent(coin.change24h)}</span></td>
      <td class="volume-cell">${formatCompactCurrency(coin.volume)}</td>
      <td>${renderSparkline(coin.sparkline, coin.change24h >= 0)}</td>
    </tr>
  `;
}

function renderSparkline(values, isPositive) {
  if (!values.length) {
    return `<span class="${isPositive ? "is-up" : "is-down"}">--</span>`;
  }

  const width = 126;
  const height = 34;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const points = values.map((value, index) => {
    const x = values.length === 1 ? width : (index / (values.length - 1)) * width;
    const y = height - ((value - min) / range) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const stroke = isPositive ? "var(--green)" : "var(--red)";

  return `
    <svg class="sparkline" viewBox="0 0 ${width} ${height}" aria-hidden="true" focusable="false">
      <path d="M ${points.join(" L ")}" stroke="${stroke}"></path>
    </svg>
  `;
}

async function selectCoin(coinId) {
  const coin = state.coins.find((item) => item.id === coinId);
  if (!coin) {
    return;
  }

  state.selectedCoinId = coinId;
  renderTable();
  els.chartTitle.textContent = `${coin.name} / USD`;
  els.chartMeta.textContent = "Loading 7 day history";
  els.chartPlaceholder.classList.add("is-hidden");

  try {
    const history = await getCoinHistory(coinId);
    renderPriceChart(coin, history);
  } catch (error) {
    els.chartMeta.textContent = `History unavailable: ${error.message}`;
    els.chartPlaceholder.classList.remove("is-hidden");
  }
}

async function getCoinHistory(coinId) {
  if (state.historyCache.has(coinId)) {
    return state.historyCache.get(coinId);
  }

  const url = `${API_BASE}/coins/${encodeURIComponent(coinId)}/market_chart?vs_currency=usd&days=7&interval=daily`;
  const response = await fetch(url, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`CoinGecko responded with ${response.status}`);
  }

  const data = await response.json();
  const history = (data.prices || []).map(([timestamp, price]) => ({
    timestamp,
    price: Number(price),
  })).filter((point) => Number.isFinite(point.price));

  state.historyCache.set(coinId, history);
  return history;
}

function renderPriceChart(coin, history) {
  if (!window.Chart) {
    els.chartMeta.textContent = "Chart.js is not available";
    return;
  }

  const styles = getComputedStyle(document.documentElement);
  const up = coin.change24h >= 0;
  const lineColor = styles.getPropertyValue(up ? "--green" : "--red").trim();
  const gridColor = styles.getPropertyValue("--line").trim();
  const textColor = styles.getPropertyValue("--muted-strong").trim();
  const labels = history.map((point) => formatChartDate(point.timestamp));
  const values = history.map((point) => point.price);
  const ctx = els.chartCanvas.getContext("2d");

  if (state.chart) {
    state.chart.destroy();
  }

  state.chartCoinId = coin.id;
  state.chart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: `${coin.name} price`,
          data: values,
          borderColor: lineColor,
          backgroundColor: createGradient(ctx, lineColor),
          pointRadius: 0,
          pointHoverRadius: 4,
          borderWidth: 2,
          fill: true,
          tension: 0.32,
        },
      ],
    },
    options: {
      animation: { duration: 280 },
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        intersect: false,
        mode: "index",
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          backgroundColor: styles.getPropertyValue("--panel").trim(),
          borderColor: gridColor,
          borderWidth: 1,
          displayColors: false,
          callbacks: {
            label(context) {
              return formatCurrency(context.parsed.y);
            },
          },
        },
      },
      scales: {
        x: {
          grid: {
            color: gridColor,
            drawBorder: false,
          },
          ticks: {
            color: textColor,
            maxTicksLimit: 7,
          },
        },
        y: {
          position: "right",
          grid: {
            color: gridColor,
            drawBorder: false,
          },
          ticks: {
            color: textColor,
            callback(value) {
              return formatCompactCurrency(value);
            },
          },
        },
      },
    },
  });

  els.chartMeta.textContent = `${formatCurrency(coin.price)} current | ${formatPercent(coin.change24h)} 24h`;
}

function updateSelectedChartLivePrice() {
  if (!state.chart || !state.chartCoinId) {
    return;
  }

  const coin = state.coins.find((item) => item.id === state.chartCoinId);
  if (!coin) {
    return;
  }

  const dataset = state.chart.data.datasets[0];
  const currentLabel = "Live";
  const nextData = [...dataset.data];
  const nextLabels = [...state.chart.data.labels];

  if (nextLabels.at(-1) === currentLabel) {
    nextData[nextData.length - 1] = coin.price;
  } else {
    nextLabels.push(currentLabel);
    nextData.push(coin.price);
  }

  state.chart.data.labels = nextLabels.slice(-12);
  dataset.data = nextData.slice(-12);
  state.chart.update("none");
  els.chartMeta.textContent = `${formatCurrency(coin.price)} current | ${formatPercent(coin.change24h)} 24h`;
}

function updateChartTheme() {
  if (!state.chart || !state.chartCoinId) {
    return;
  }

  const coin = state.coins.find((item) => item.id === state.chartCoinId);
  const cachedHistory = state.historyCache.get(state.chartCoinId);

  if (coin && cachedHistory) {
    renderPriceChart(coin, cachedHistory);
  }
}

function createGradient(ctx, color) {
  const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height || 360);
  gradient.addColorStop(0, colorMix(color, 0.28));
  gradient.addColorStop(1, colorMix(color, 0));
  return gradient;
}

function colorMix(color, alpha) {
  if (color.startsWith("#")) {
    const hex = color.replace("#", "");
    const value = hex.length === 3
      ? hex.split("").map((char) => `${char}${char}`).join("")
      : hex;
    const r = parseInt(value.slice(0, 2), 16);
    const g = parseInt(value.slice(2, 4), 16);
    const b = parseInt(value.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  return color;
}

function formatCurrency(value) {
  const absolute = Math.abs(Number(value) || 0);

  if (absolute >= 1) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: absolute >= 1000 ? 0 : 2,
    }).format(value);
  }

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  }).format(value);
}

function formatCompactCurrency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  }).format(value);
}

function formatPercent(value) {
  const sign = value > 0 ? "+" : "";
  return `${sign}${Number(value || 0).toFixed(2)}%`;
}

function formatTime(date) {
  return new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function formatChartDate(timestamp) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(timestamp));
}

function randomFloat(min, max) {
  return Math.random() * (max - min) + min;
}

function randomInt(min, max) {
  return Math.floor(randomFloat(min, max + 1));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
