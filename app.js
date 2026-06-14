const assets = {
  gold: {
    name: "黄金期货",
    ticker: "GC=F",
    symbol: "GC=F",
    unit: "美元/盎司",
    color: "#c8962b",
    className: "gold"
  },
  silver: {
    name: "白银期货",
    ticker: "SI=F",
    symbol: "SI=F",
    unit: "美元/盎司",
    color: "#7f8b96",
    className: "silver"
  },
  platinum: {
    name: "铂金期货",
    ticker: "PL=F",
    symbol: "PL=F",
    unit: "美元/盎司",
    color: "#2663a6",
    className: "platinum"
  },
  palladium: {
    name: "钯金期货",
    ticker: "PA=F",
    symbol: "PA=F",
    unit: "美元/盎司",
    color: "#0f766e",
    className: "palladium"
  }
};

const ranges = { "1D": 1, "1M": 30, "3M": 90, "1Y": 365, "5Y": 1260 };
const storeKey = "metal-desk-account-v1";
const alertStoreKey = "metal-desk-alerts-v1";
const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const money = value => `$${fmt.format(value)}`;
const pct = value => `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;

let activeAsset = "gold";
let activeRange = "3M";
let chartType = "line";
let history = {};
let intradayHistory = {};
let dataErrors = {};
let macroHistory = {};
let macroErrors = {};
let liveSource = "真实";
let account = loadAccount();
let alerts = loadAlerts();
let chartState = null;
let hoverIndex = null;

const els = {
  dataStatus: document.querySelector("#dataStatus"),
  marketStrip: document.querySelector("#marketStrip"),
  assetList: document.querySelector("#assetList"),
  assetTicker: document.querySelector("#assetTicker"),
  assetName: document.querySelector("#assetName"),
  activePrice: document.querySelector("#activePrice"),
  activeChange: document.querySelector("#activeChange"),
  rangeTabs: document.querySelector("#rangeTabs"),
  chart: document.querySelector("#priceChart"),
  ma20: document.querySelector("#ma20"),
  ma60: document.querySelector("#ma60"),
  rsi: document.querySelector("#rsi"),
  volatility: document.querySelector("#volatility"),
  trendText: document.querySelector("#trendText"),
  strategyText: document.querySelector("#strategyText"),
  equity: document.querySelector("#equity"),
  pnl: document.querySelector("#pnl"),
  tradeForm: document.querySelector("#tradeForm"),
  side: document.querySelector("#side"),
  quantity: document.querySelector("#quantity"),
  positions: document.querySelector("#positions"),
  tradeLog: document.querySelector("#tradeLog"),
  resetAccount: document.querySelector("#resetAccount"),
  decisionAction: document.querySelector("#decisionAction"),
  decisionConfidence: document.querySelector("#decisionConfidence"),
  decisionText: document.querySelector("#decisionText"),
  decisionFactors: document.querySelector("#decisionFactors"),
  modelBrief: document.querySelector("#modelBrief"),
  exportHistory: document.querySelector("#exportHistory")
  ,
  chartTypeTabs: document.querySelector("#chartTypeTabs"),
  signalRadar: document.querySelector("#signalRadar"),
  riskPercent: document.querySelector("#riskPercent"),
  tradePlan: document.querySelector("#tradePlan"),
  strategySelect: document.querySelector("#strategySelect"),
  runBacktest: document.querySelector("#runBacktest"),
  backtestResult: document.querySelector("#backtestResult"),
  macroGrid: document.querySelector("#macroGrid"),
  macroText: document.querySelector("#macroText"),
  tradeReason: document.querySelector("#tradeReason"),
  alertForm: document.querySelector("#alertForm"),
  alertDirection: document.querySelector("#alertDirection"),
  alertPrice: document.querySelector("#alertPrice"),
  alertList: document.querySelector("#alertList")
};

function loadAccount() {
  const fallback = { cash: 100000, trades: [], realized: 0 };
  try {
    return JSON.parse(localStorage.getItem(storeKey)) || fallback;
  } catch {
    return fallback;
  }
}

function saveAccount() {
  localStorage.setItem(storeKey, JSON.stringify(account));
}

function loadAlerts() {
  try {
    return JSON.parse(localStorage.getItem(alertStoreKey)) || [];
  } catch {
    return [];
  }
}

function saveAlerts() {
  localStorage.setItem(alertStoreKey, JSON.stringify(alerts));
}

async function fetchYahooSeries(assetKey) {
  const url = `/api/market/${assetKey}`;
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`行情代理返回 ${response.status}`);
  const data = await response.json();
  if (data.error) throw new Error(data.error);
  const points = (data.points || []).map(point => ({
    date: new Date(point.date),
    price: point.price,
    open: point.open ?? point.price,
    high: point.high ?? point.price,
    low: point.low ?? point.price,
    close: point.close ?? point.price,
    volume: point.volume ?? null
  })).filter(point => Number.isFinite(point.price));
  const intradayPoints = (data.intradayPoints || []).map(point => ({
    date: new Date(point.date),
    price: point.price,
    open: point.open ?? point.price,
    high: point.high ?? point.price,
    low: point.low ?? point.price,
    close: point.close ?? point.price,
    volume: point.volume ?? null
  })).filter(point => Number.isFinite(point.price));
  if (points.length < 30) throw new Error("market series incomplete");
  return { points, intradayPoints };
}

async function loadMarketData() {
  const keys = Object.keys(assets);
  els.dataStatus.textContent = "连接行情中";
  const results = await Promise.all(keys.map(async key => {
    try {
      const payload = await fetchYahooSeries(key);
      return [key, payload, null];
    } catch (error) {
      return [key, null, error.message || "行情接口不可用"];
    }
  }));

  history = Object.fromEntries(results.filter(([, payload]) => payload).map(([key, payload]) => [key, payload.points]));
  intradayHistory = Object.fromEntries(results.filter(([, payload]) => payload).map(([key, payload]) => [key, payload.intradayPoints]));
  dataErrors = Object.fromEntries(results.filter(([, payload]) => !payload).map(([key, , error]) => [key, error]));
  const loaded = Object.keys(history).length;
  liveSource = loaded ? "真实" : "无数据";
  render();
  els.dataStatus.textContent = loaded
    ? `${liveSource}行情 ${loaded}/${keys.length} · Yahoo/COMEX · ${new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`
    : "真实行情连接失败";
}

async function loadMacroData() {
  try {
    const response = await fetch("/api/macro", { cache: "no-store" });
    if (!response.ok) throw new Error(`宏观代理返回 ${response.status}`);
    const data = await response.json();
    macroHistory = Object.fromEntries((data.items || []).map(item => [
      item.key,
      {
        ...item,
        points: item.points.map(point => ({
          date: new Date(point.date),
          price: point.price,
          open: point.open ?? point.price,
          high: point.high ?? point.price,
          low: point.low ?? point.price,
          close: point.close ?? point.price,
          volume: point.volume ?? null
        }))
      }
    ]));
    macroErrors = data.errors || {};
  } catch (error) {
    macroHistory = {};
    macroErrors = { macro: error.message || "宏观接口不可用" };
  }
  renderMacro();
}

function sliceSeries(key) {
  if (!history[key]) return [];
  if (activeRange === "1D") {
    const intraday = intradayHistory[key] || [];
    return intraday.length > 1 ? intraday.slice(-288) : [];
  }
  const days = ranges[activeRange];
  return history[key].slice(-Math.min(days, history[key].length));
}

function latestPrice(key) {
  return intradayHistory[key]?.at(-1)?.price ?? history[key]?.at(-1)?.price;
}

function changeOf(series) {
  const first = series[0]?.price || 0;
  const last = series[series.length - 1]?.price || 0;
  return first ? ((last - first) / first) * 100 : 0;
}

function movingAverage(series, period) {
  if (series.length < period) return null;
  const list = series.slice(-period);
  return list.reduce((sum, point) => sum + point.price, 0) / list.length;
}

function rsi(series, period = 14) {
  if (series.length <= period) return null;
  const changes = series.slice(-period - 1).map((point, index, list) => index ? point.price - list[index - 1].price : 0).slice(1);
  const gains = changes.filter(change => change > 0).reduce((sum, change) => sum + change, 0) / period;
  const losses = Math.abs(changes.filter(change => change < 0).reduce((sum, change) => sum + change, 0) / period);
  if (losses === 0) return 100;
  return 100 - (100 / (1 + gains / losses));
}

function volatility(series) {
  const returns = series.slice(-31).map((point, index, list) => index ? Math.log(point.price / list[index - 1].price) : 0).slice(1);
  if (!returns.length) return 0;
  const avg = returns.reduce((sum, item) => sum + item, 0) / returns.length;
  const variance = returns.reduce((sum, item) => sum + (item - avg) ** 2, 0) / returns.length;
  return Math.sqrt(variance * 252) * 100;
}

function periodReturn(series, days) {
  if (series.length <= days) return null;
  const end = series.at(-1).price;
  const start = series.at(-days - 1).price;
  return start ? ((end - start) / start) * 100 : null;
}

function maxDrawdown(series, days = series.length) {
  const list = series.slice(-days);
  let peak = list[0]?.price || 0;
  let drawdown = 0;
  list.forEach(point => {
    peak = Math.max(peak, point.price);
    if (peak) drawdown = Math.min(drawdown, ((point.price - peak) / peak) * 100);
  });
  return drawdown;
}

function supportResistance(series, days = 120) {
  const list = series.slice(-days);
  const prices = list.map(point => point.price);
  return {
    support: Math.min(...prices),
    resistance: Math.max(...prices)
  };
}

function formatNullablePct(value) {
  return value === null || !Number.isFinite(value) ? "--" : pct(value);
}

function buildDecision(series, asset) {
  const last = series.at(-1).price;
  const ma20 = movingAverage(series, 20);
  const ma60 = movingAverage(series, 60);
  const ma200 = movingAverage(series, 200);
  const score = rsi(series);
  const vol = volatility(series);
  const oneMonth = periodReturn(series, 21);
  const threeMonth = periodReturn(series, 63);
  const oneYear = periodReturn(series, 252);
  const drawdown = maxDrawdown(series, 252);
  const levels = supportResistance(series, 120);
  const distanceToSupport = ((last - levels.support) / last) * 100;
  const distanceToResistance = ((levels.resistance - last) / last) * 100;
  let points = 0;
  const reasons = [];

  if (ma20 && ma60 && last > ma20 && ma20 > ma60) {
    points += 2;
    reasons.push("短中期均线多头排列，价格站上MA20。");
  } else if (ma20 && ma60 && last < ma20 && ma20 < ma60) {
    points -= 2;
    reasons.push("短中期均线空头排列，价格跌破MA20。");
  } else {
    reasons.push("均线结构尚未形成单边趋势。");
  }

  if (ma200 && last > ma200) {
    points += 1;
    reasons.push("价格位于MA200上方，长期趋势偏强。");
  } else if (ma200 && last < ma200) {
    points -= 1;
    reasons.push("价格位于MA200下方，长期趋势偏弱。");
  }

  if (score !== null && score < 35) {
    points += 1;
    reasons.push("RSI偏冷，存在修复反弹条件。");
  } else if (score !== null && score > 72) {
    points -= 1;
    reasons.push("RSI偏热，追涨性价比下降。");
  }

  if (threeMonth !== null && threeMonth > 8) points += 1;
  if (threeMonth !== null && threeMonth < -8) points -= 1;
  if (vol > 35) {
    points -= 1;
    reasons.push("年化波动率较高，仓位需要明显收缩。");
  }
  if (distanceToResistance < 2.5) {
    points -= 1;
    reasons.push("价格接近120日阻力位，上方空间暂时不宽。");
  }
  if (distanceToSupport < 2.5) {
    points += 1;
    reasons.push("价格靠近120日支撑位，止损位置更清晰。");
  }

  let action = "观望";
  let tone = "neutral";
  if (points >= 3) {
    action = "偏买入";
    tone = "buy";
  } else if (points <= -3) {
    action = "偏卖出";
    tone = "sell";
  }

  const confidence = Math.min(86, Math.max(48, 50 + Math.abs(points) * 8 - (vol > 35 ? 8 : 0)));
  const riskLine = action === "偏买入"
    ? `若买入，参考支撑位 ${money(levels.support)} 下方设置止损，首要观察阻力位 ${money(levels.resistance)}。`
    : action === "偏卖出"
      ? `若卖出，需防范价格重新站回MA20 ${ma20 ? money(ma20) : "--"} 后形成反抽。`
      : `当前更适合等待价格脱离 ${money(levels.support)} - ${money(levels.resistance)} 区间后再行动。`;

  return {
    action,
    tone,
    confidence,
    reasons,
    riskLine,
    metrics: {
      "1月": formatNullablePct(oneMonth),
      "3月": formatNullablePct(threeMonth),
      "1年": formatNullablePct(oneYear),
      "最大回撤": pct(drawdown),
      "MA200": ma200 ? money(ma200) : "--",
      "支撑": money(levels.support),
      "阻力": money(levels.resistance),
      "波动": `${vol.toFixed(1)}%`
    },
    brief: [
      `品种：${asset.name} (${asset.ticker})`,
      `当前价格：${money(last)}`,
      `近1月/3月/1年收益：${formatNullablePct(oneMonth)} / ${formatNullablePct(threeMonth)} / ${formatNullablePct(oneYear)}`,
      `MA20/MA60/MA200：${ma20 ? money(ma20) : "--"} / ${ma60 ? money(ma60) : "--"} / ${ma200 ? money(ma200) : "--"}`,
      `RSI(14)：${score ? score.toFixed(1) : "--"}`,
      `30日年化波动：${vol.toFixed(1)}%`,
      `近1年最大回撤：${pct(drawdown)}`,
      `120日支撑/阻力：${money(levels.support)} / ${money(levels.resistance)}`,
      `请基于上述真实历史价格数据，结合宏观环境、美元指数、实际利率、通胀预期和风险偏好，判断当前更适合买入、卖出还是观望，并给出仓位和止损建议。`
    ].join("\n")
  };
}

function clampScore(value) {
  return Math.max(0, Math.min(100, value));
}

function buildSignalRadar(series) {
  const last = latestPrice(activeAsset) ?? series.at(-1).price;
  const ma20 = movingAverage(series, 20);
  const ma60 = movingAverage(series, 60);
  const ma200 = movingAverage(series, 200);
  const score = rsi(series);
  const vol = volatility(series);
  const threeMonth = periodReturn(series, 63) ?? 0;
  const oneYear = periodReturn(series, 252) ?? 0;
  const levels = supportResistance(series, 120);
  const trendScore = clampScore(50 + (ma20 && ma60 ? (ma20 > ma60 ? 18 : -18) : 0) + (ma200 && last > ma200 ? 18 : -12) + Math.sign(threeMonth) * 10);
  const momentumScore = clampScore(score === null ? 50 : score > 70 ? 38 : score < 35 ? 68 : 54 + Math.sign(threeMonth) * 12);
  const riskScore = clampScore(100 - vol * 1.8 - Math.max(0, -maxDrawdown(series, 252)) * 0.9);
  const locationScore = clampScore(50 + ((last - levels.support) / Math.max(levels.resistance - levels.support, 1)) * 25 - ((levels.resistance - last) / Math.max(levels.resistance - levels.support, 1)) * 20);
  const macroProxy = buildMacroPressureScore(oneYear, vol);
  return [
    { name: "趋势", score: trendScore, note: ma20 && ma60 ? `MA20 ${ma20 > ma60 ? "高于" : "低于"} MA60` : "均线数据不足" },
    { name: "动量", score: momentumScore, note: score ? `RSI ${score.toFixed(1)}` : "RSI数据不足" },
    { name: "风险", score: riskScore, note: `波动 ${vol.toFixed(1)}%` },
    { name: "位置", score: locationScore, note: `${money(levels.support)} - ${money(levels.resistance)}` },
    { name: "宏观代理", score: macroProxy, note: `1年 ${formatNullablePct(oneYear)}` }
  ];
}

function buildMacroPressureScore(oneYear, vol) {
  const dxy = periodReturn(macroHistory.dxy?.points || [], 21);
  const tnx = periodReturn(macroHistory.tnx?.points || [], 21);
  let score = 50 + Math.sign(oneYear) * 12 - (vol > 35 ? 10 : 0);
  if (dxy !== null && dxy > 1.5) score -= 10;
  if (dxy !== null && dxy < -1.5) score += 10;
  if (tnx !== null && tnx > 5) score -= 8;
  if (tnx !== null && tnx < -5) score += 8;
  return clampScore(score);
}

function macroChange(key, days = 21) {
  const points = macroHistory[key]?.points || [];
  return periodReturn(points, days);
}

function buildTradePlan(series) {
  const last = latestPrice(activeAsset) ?? series.at(-1).price;
  const levels = supportResistance(series, 120);
  const atr = averageTrueRange(series, 14);
  const decision = buildDecision(series, assets[activeAsset]);
  const riskPct = Number(els.riskPercent.value) || 1;
  const equity = account.cash + markToMarket();
  const riskBudget = equity * (riskPct / 100);
  const longStop = Math.min(levels.support, last - atr * 1.4);
  const shortStop = Math.max(levels.resistance, last + atr * 1.4);
  const isSell = decision.action === "偏卖出";
  const stop = isSell ? shortStop : longStop;
  const riskPerUnit = Math.abs(last - stop);
  const qty = riskPerUnit ? riskBudget / riskPerUnit : 0;
  const target = isSell ? last - riskPerUnit * 2 : last + riskPerUnit * 2;
  return {
    side: isSell ? "卖出/做空" : decision.action === "偏买入" ? "买入/做多" : "等待突破后顺势",
    entry: last,
    stop,
    target,
    riskBudget,
    qty,
    rr: "1 : 2",
    invalidation: isSell ? `重新站上 ${money(shortStop)} 后空头计划失效` : `跌破 ${money(longStop)} 后多头计划失效`
  };
}

function averageTrueRange(series, period = 14) {
  if (series.length <= period) return 0;
  const slice = series.slice(-period - 1);
  const trs = [];
  for (let i = 1; i < slice.length; i += 1) {
    const point = slice[i];
    const prev = slice[i - 1];
    trs.push(Math.max(
      (point.high ?? point.price) - (point.low ?? point.price),
      Math.abs((point.high ?? point.price) - prev.price),
      Math.abs((point.low ?? point.price) - prev.price)
    ));
  }
  return trs.reduce((sum, value) => sum + value, 0) / trs.length;
}

function runStrategyBacktest(series, strategy) {
  let cash = 100000;
  let qty = 0;
  let entry = 0;
  const equityCurve = [];
  const trades = [];

  for (let i = 200; i < series.length; i += 1) {
    const window = series.slice(0, i + 1);
    const point = series[i];
    const price = point.price;
    const ma20 = movingAverage(window, 20);
    const ma60 = movingAverage(window, 60);
    const score = rsi(window);
    const levels = supportResistance(window.slice(0, -1), 120);
    let buy = false;
    let sell = false;

    if (strategy === "maCross") {
      const prevWindow = series.slice(0, i);
      const prevMa20 = movingAverage(prevWindow, 20);
      const prevMa60 = movingAverage(prevWindow, 60);
      buy = ma20 > ma60 && prevMa20 <= prevMa60;
      sell = ma20 < ma60 && prevMa20 >= prevMa60;
    } else if (strategy === "rsiRevert") {
      buy = score !== null && score < 32;
      sell = score !== null && score > 62;
    } else if (strategy === "breakout") {
      buy = price > levels.resistance;
      sell = price < movingAverage(window, 20);
    }

    if (!qty && buy) {
      qty = cash / price;
      cash = 0;
      entry = price;
      trades.push({ side: "买入", date: point.date, price });
    } else if (qty && sell) {
      cash = qty * price;
      trades.push({ side: "卖出", date: point.date, price, pnl: ((price - entry) / entry) * 100 });
      qty = 0;
      entry = 0;
    }
    equityCurve.push(cash + qty * price);
  }

  if (qty) cash = qty * series.at(-1).price;
  const finalEquity = cash;
  const totalReturn = ((finalEquity - 100000) / 100000) * 100;
  const peakAndDrawdown = equityCurve.reduce((state, equity) => {
    state.peak = Math.max(state.peak, equity);
    state.drawdown = Math.min(state.drawdown, ((equity - state.peak) / state.peak) * 100);
    return state;
  }, { peak: 100000, drawdown: 0 });
  const closed = trades.filter(trade => Number.isFinite(trade.pnl));
  const winners = closed.filter(trade => trade.pnl > 0).length;
  return {
    totalReturn,
    maxDrawdown: peakAndDrawdown.drawdown,
    trades: Math.floor(trades.length / 2),
    winRate: closed.length ? (winners / closed.length) * 100 : 0,
    finalEquity
  };
}

function positions() {
  const map = {};
  account.trades.forEach(trade => {
    if (trade.closed) return;
    map[trade.asset] ||= { asset: trade.asset, qty: 0, cost: 0 };
    const direction = trade.side === "buy" ? 1 : -1;
    map[trade.asset].qty += trade.qty * direction;
    map[trade.asset].cost += trade.price * trade.qty * direction;
  });
  return Object.values(map).filter(item => Math.abs(item.qty) > 0.0001);
}

function markToMarket() {
  return positions().reduce((sum, position) => {
    const price = latestPrice(position.asset);
    return Number.isFinite(price) ? sum + position.qty * price : sum;
  }, 0);
}

function renderMarketStrip() {
  els.marketStrip.innerHTML = Object.entries(assets).map(([key, asset]) => {
    const series = history[key];
    const last = latestPrice(key);
    const daySeries = intradayHistory[key]?.length > 1 ? intradayHistory[key] : series?.slice(-2);
    const day = daySeries ? changeOf(daySeries) : null;
    return `
      <article class="quote-card ${asset.className}">
        <button data-asset="${key}">
          <span>${asset.ticker} · ${asset.name}</span>
          <strong>${Number.isFinite(last) ? money(last) : "--"}</strong>
          <div class="change ${day === null ? "muted" : day >= 0 ? "up" : "down"}">
            ${day === null ? "暂无真实数据" : `${pct(day)} · ${asset.unit}`}
          </div>
        </button>
      </article>
    `;
  }).join("");
}

function renderAssetList() {
  els.assetList.innerHTML = Object.entries(assets).map(([key, asset]) => {
    const last = latestPrice(key);
    return `
      <button class="asset-btn ${key === activeAsset ? "active" : ""}" data-asset="${key}">
        <span class="swatch" style="background:${asset.color}"></span>
        <span><strong>${asset.name}</strong><small>${asset.ticker} · ${asset.unit}</small></span>
        <b>${Number.isFinite(last) ? money(last) : "--"}</b>
      </button>
    `;
  }).join("");
}

function drawNoDataChart(message = "暂无真实行情数据") {
  chartState = null;
  hoverIndex = null;
  const canvas = els.chart;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 360 * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, rect.width, 360);
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, rect.width, 360);
  ctx.strokeStyle = "#d9e0e7";
  ctx.strokeRect(0.5, 0.5, rect.width - 1, 359);
  ctx.fillStyle = "#6b7280";
  ctx.font = "15px system-ui";
  ctx.textAlign = "center";
  ctx.fillText(message, rect.width / 2, 180);
}

function formatPointDate(date) {
  if (activeRange === "1D") {
    return date.toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function drawHover(ctx) {
  if (!chartState || hoverIndex === null) return;
  const { series, xFor, yFor, left, right, w, h, bottomY } = chartState;
  const point = series[hoverIndex];
  if (!point) return;

  const x = xFor(hoverIndex);
  const y = yFor(point.price);
  const first = series[0]?.price || point.price;
  const change = first ? ((point.price - first) / first) * 100 : 0;
  const lines = [
    formatPointDate(point.date),
    `${money(point.price)} · ${pct(change)}`
  ];
  const tooltipW = Math.max(...lines.map(line => ctx.measureText(line).width)) + 24;
  const tooltipH = 58;
  const tooltipX = x + tooltipW + 16 > w - right ? x - tooltipW - 14 : x + 14;
  const tooltipY = Math.max(12, Math.min(y - tooltipH / 2, h - tooltipH - 12));

  ctx.save();
  ctx.strokeStyle = "rgba(22, 32, 42, 0.22)";
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath();
  ctx.moveTo(x, 18);
  ctx.lineTo(x, bottomY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(left, y);
  ctx.lineTo(w - right, y);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = assets[activeAsset].color;
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#fff";
  ctx.stroke();

  ctx.fillStyle = "rgba(17, 24, 39, 0.92)";
  ctx.strokeStyle = "rgba(255, 255, 255, 0.24)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(tooltipX, tooltipY, tooltipW, tooltipH, 8);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#e5edf5";
  ctx.font = "12px system-ui";
  ctx.fillText(lines[0], tooltipX + 12, tooltipY + 22);
  ctx.font = "bold 13px system-ui";
  ctx.fillStyle = change >= 0 ? "#8ee6b8" : "#ffaaa7";
  ctx.fillText(lines[1], tooltipX + 12, tooltipY + 43);
  ctx.restore();
}

function renderChart() {
  if (!history[activeAsset]) {
    drawNoDataChart();
    return;
  }
  const canvas = els.chart;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = 360 * dpr;
  ctx.scale(dpr, dpr);

  const series = sliceSeries(activeAsset);
  if (series.length < 2) {
    drawNoDataChart(activeRange === "1D" ? "暂无盘中分钟数据" : "暂无真实行情数据");
    return;
  }
  const values = series.map(point => point.price);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max((max - min) * 0.14, max * 0.01);
  const top = max + pad;
  const bottom = min - pad;
  const w = rect.width;
  const h = 360;
  const left = 54;
  const right = 18;
  const areaW = w - left - right;
  const areaH = h - 52;

  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "#d9e0e7";
  ctx.lineWidth = 1;
  ctx.fillStyle = "#6b7280";
  ctx.font = "12px system-ui";

  for (let i = 0; i < 5; i += 1) {
    const y = 18 + (areaH / 4) * i;
    const value = top - ((top - bottom) / 4) * i;
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(w - right, y);
    ctx.stroke();
    ctx.fillText(fmt.format(value), 8, y + 4);
  }

  const xFor = index => left + (index / Math.max(series.length - 1, 1)) * areaW;
  const yFor = value => 18 + ((top - value) / (top - bottom)) * areaH;
  chartState = {
    series,
    xFor,
    yFor,
    left,
    right,
    w,
    h,
    areaW,
    bottomY: h - 34
  };

  if (chartType === "candle") {
    const candleW = Math.max(3, Math.min(12, areaW / series.length * 0.62));
    series.forEach((point, index) => {
      const x = xFor(index);
      const open = point.open ?? point.price;
      const close = point.close ?? point.price;
      const high = point.high ?? Math.max(open, close);
      const low = point.low ?? Math.min(open, close);
      const up = close >= open;
      ctx.strokeStyle = up ? "#13795b" : "#c2413f";
      ctx.fillStyle = up ? "rgba(19, 121, 91, 0.78)" : "rgba(194, 65, 63, 0.78)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, yFor(high));
      ctx.lineTo(x, yFor(low));
      ctx.stroke();
      const bodyTop = yFor(Math.max(open, close));
      const bodyHeight = Math.max(2, Math.abs(yFor(open) - yFor(close)));
      ctx.fillRect(x - candleW / 2, bodyTop, candleW, bodyHeight);
    });
  } else {
    const gradient = ctx.createLinearGradient(0, 18, 0, h - 34);
    gradient.addColorStop(0, `${assets[activeAsset].color}44`);
    gradient.addColorStop(1, `${assets[activeAsset].color}00`);

    ctx.beginPath();
    values.forEach((value, index) => {
      const x = xFor(index);
      const y = yFor(value);
      index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.lineTo(w - right, h - 34);
    ctx.lineTo(left, h - 34);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    values.forEach((value, index) => {
      const x = xFor(index);
      const y = yFor(value);
      index ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.strokeStyle = assets[activeAsset].color;
    ctx.lineWidth = 3;
    ctx.stroke();

    const last = series.at(-1);
    ctx.fillStyle = assets[activeAsset].color;
    ctx.beginPath();
    ctx.arc(xFor(series.length - 1), yFor(last.price), 4, 0, Math.PI * 2);
    ctx.fill();
  }
  drawHover(ctx);
}

function renderAnalytics() {
  const series = history[activeAsset];
  const asset = assets[activeAsset];
  if (!series) {
    els.assetTicker.textContent = asset.ticker;
    els.assetName.textContent = asset.name;
    els.activePrice.textContent = "--";
    els.activeChange.textContent = "暂无真实数据";
    els.activeChange.className = "muted";
    els.ma20.textContent = "--";
    els.ma60.textContent = "--";
    els.rsi.textContent = "--";
    els.volatility.textContent = "--";
    els.trendText.innerHTML = `<p>当前无法获取${asset.name}的真实行情，已停止展示价格、历史趋势和技术指标，避免用模拟数据误导判断。</p>`;
    els.strategyText.innerHTML = `<p>暂无真实数据时不生成交易策略。请接入稳定行情接口或稍后刷新后再分析。</p>`;
    renderDecision(null);
    els.tradeForm.querySelector("button[type='submit']").disabled = true;
    return;
  }
  const scoped = sliceSeries(activeAsset);
  const visibleSeries = scoped.length > 1 ? scoped : series.slice(-2);
  const last = latestPrice(activeAsset) ?? visibleSeries.at(-1).price;
  const change = changeOf(visibleSeries);
  const ma20 = movingAverage(series, 20);
  const ma60 = movingAverage(series, 60);
  const score = rsi(series);
  const vol = volatility(series);
  const momentum = ma20 && ma60 ? ma20 - ma60 : 0;
  const trend = momentum > 0 && change > 0 ? "上行趋势保持" : momentum < 0 && change < 0 ? "下行压力偏强" : "震荡结构";
  const risk = vol > 32 ? "高波动" : vol > 18 ? "中等波动" : "低波动";
  const rsiText = score > 70 ? "RSI进入偏热区间" : score < 35 ? "RSI处于偏冷区间" : "RSI保持中性";

  els.assetTicker.textContent = asset.ticker;
  els.assetName.textContent = asset.name;
  els.activePrice.textContent = money(last);
  els.activeChange.textContent = `${pct(change)} · ${activeRange}`;
  els.activeChange.className = change >= 0 ? "up" : "down";
  els.ma20.textContent = ma20 ? money(ma20) : "--";
  els.ma60.textContent = ma60 ? money(ma60) : "--";
  els.rsi.textContent = score ? score.toFixed(1) : "--";
  els.volatility.textContent = `${vol.toFixed(1)}%`;

  els.trendText.innerHTML = `
    <p>${asset.name}${activeRange}涨跌幅为${pct(change)}，当前价格位于${money(last)}。短均线与中均线显示为${trend}，30日年化波动率约${vol.toFixed(1)}%，属于${risk}。</p>
    <p>${rsiText}。若价格持续站上MA20并且成交节奏放大，趋势延续概率提升；若跌破MA60，应优先控制仓位。</p>
  `;

  const stance = momentum > 0 && score < 72 ? "逢回调分批做多" : momentum < 0 && score > 40 ? "反弹减仓或轻仓试空" : "区间交易";
  const stop = vol > 28 ? "1.8%" : "1.1%";
  els.strategyText.innerHTML = `
    <p>当前策略倾向：${stance}。入场可参考MA20附近的价格反应，避免在RSI极端区追单。</p>
    <p>单笔风险建议不超过账户权益的2%，移动止损可设在入场价外${stop}，盈利达到2倍风险后逐步锁定收益。</p>
  `;
  renderDecision(series);
  els.tradeForm.querySelector("button[type='submit']").disabled = false;
}

function renderDecision(series) {
  const asset = assets[activeAsset];
  if (!series) {
    els.decisionAction.textContent = "--";
    els.decisionAction.className = "";
    els.decisionConfidence.textContent = "暂无真实历史数据";
    els.decisionText.innerHTML = `<p>没有真实历史价格时不生成买卖判断。</p>`;
    els.decisionFactors.innerHTML = "";
    els.modelBrief.textContent = "";
    els.exportHistory.disabled = true;
    return;
  }

  const decision = buildDecision(series, asset);
  els.decisionAction.textContent = decision.action;
  els.decisionAction.className = decision.tone;
  els.decisionConfidence.textContent = `置信度 ${decision.confidence.toFixed(0)}%`;
  els.decisionText.innerHTML = `
    <p>${decision.riskLine}</p>
    <p>${decision.reasons.join(" ")}</p>
    <p class="mini">这是基于历史价格和技术指标的决策辅助，不构成保证收益的投资建议。</p>
  `;
  els.decisionFactors.innerHTML = Object.entries(decision.metrics).map(([label, value]) => `
    <div>
      <span>${label}</span>
      <strong>${value}</strong>
    </div>
  `).join("");
  els.modelBrief.textContent = decision.brief;
  els.exportHistory.disabled = false;
}

function renderSignalRadar(series) {
  if (!series) {
    els.signalRadar.innerHTML = `<p class="empty">暂无真实历史数据</p>`;
    return;
  }
  els.signalRadar.innerHTML = buildSignalRadar(series).map(item => `
    <div class="radar-row">
      <div>
        <strong>${item.name}</strong>
        <span>${item.note}</span>
      </div>
      <div class="score-track">
        <i style="width:${item.score}%"></i>
      </div>
      <b>${item.score.toFixed(0)}</b>
    </div>
  `).join("");
}

function renderTradePlan(series) {
  if (!series) {
    els.tradePlan.innerHTML = `<p class="empty">暂无真实历史数据</p>`;
    return;
  }
  const plan = buildTradePlan(series);
  els.tradePlan.innerHTML = `
    <div><span>方向</span><strong>${plan.side}</strong></div>
    <div><span>参考入场</span><strong>${money(plan.entry)}</strong></div>
    <div><span>止损</span><strong>${money(plan.stop)}</strong></div>
    <div><span>止盈</span><strong>${money(plan.target)}</strong></div>
    <div><span>风险预算</span><strong>${money(plan.riskBudget)}</strong></div>
    <div><span>建议数量</span><strong>${plan.qty.toFixed(2)}</strong></div>
    <div><span>盈亏比</span><strong>${plan.rr}</strong></div>
    <div><span>失效条件</span><strong>${plan.invalidation}</strong></div>
  `;
}

function renderBacktest(series) {
  if (!series) {
    els.backtestResult.innerHTML = `<p class="empty">暂无真实历史数据</p>`;
    return;
  }
  const result = runStrategyBacktest(series, els.strategySelect.value);
  els.backtestResult.innerHTML = `
    <div><span>总收益</span><strong class="${result.totalReturn >= 0 ? "up" : "down"}">${pct(result.totalReturn)}</strong></div>
    <div><span>最大回撤</span><strong class="down">${pct(result.maxDrawdown)}</strong></div>
    <div><span>胜率</span><strong>${result.winRate.toFixed(1)}%</strong></div>
    <div><span>交易次数</span><strong>${result.trades}</strong></div>
    <div><span>期末权益</span><strong>${money(result.finalEquity)}</strong></div>
  `;
}

function renderMacro() {
  const items = Object.values(macroHistory);
  if (!items.length) {
    els.macroGrid.innerHTML = `<p class="empty">暂无宏观数据</p>`;
    els.macroText.innerHTML = `<p>宏观代理暂不可用：${Object.values(macroErrors).join("；") || "等待连接"}</p>`;
    return;
  }

  els.macroGrid.innerHTML = items.map(item => {
    const latest = item.points.at(-1)?.price;
    const change = periodReturn(item.points, 21);
    return `
      <div>
        <span>${item.symbol}</span>
        <strong>${Number.isFinite(latest) ? fmt.format(latest) : "--"}</strong>
        <em class="${change === null ? "muted" : change >= 0 ? "up" : "down"}">${formatNullablePct(change)} · 1M</em>
        <small>${item.name}</small>
      </div>
    `;
  }).join("");

  const dxy = macroChange("dxy");
  const tnx = macroChange("tnx");
  const gld = macroChange("gld");
  const slv = macroChange("slv");
  const pressure = [
    dxy !== null && dxy > 1.5 ? "美元走强压制贵金属估值" : "",
    dxy !== null && dxy < -1.5 ? "美元回落对贵金属形成支撑" : "",
    tnx !== null && tnx > 5 ? "美债收益率上行提高持有黄金的机会成本" : "",
    tnx !== null && tnx < -5 ? "美债收益率回落有利于贵金属" : "",
    gld !== null && gld > 2 ? "黄金ETF同步走强，资金偏好改善" : "",
    slv !== null && slv > 2 ? "白银ETF同步走强，工业金属情绪较好" : ""
  ].filter(Boolean);
  els.macroText.innerHTML = `<p>${pressure.length ? pressure.join("；") : "宏观代理信号暂未出现明显单边压力，仍以价格结构和风险预算为主。"}</p>`;
}

function renderAlerts() {
  if (!alerts.length) {
    els.alertList.innerHTML = `<p class="empty">暂无提醒</p>`;
    return;
  }
  els.alertList.innerHTML = alerts.map(alert => {
    const price = latestPrice(alert.asset);
    const hit = Number.isFinite(price) && (alert.direction === "above" ? price >= alert.price : price <= alert.price);
    return `
      <div class="alert-row ${hit ? "triggered" : ""}">
        <div>
          <strong>${assets[alert.asset]?.ticker || alert.asset} ${alert.direction === "above" ? "高于" : "低于"} ${money(alert.price)}</strong>
          <span>${hit ? "已触发" : `当前 ${Number.isFinite(price) ? money(price) : "--"}`}</span>
        </div>
        <button class="ghost" data-alert-remove="${alert.id}">删除</button>
      </div>
    `;
  }).join("");
}

function renderTrading() {
  const hasUnpricedPosition = positions().some(position => !Number.isFinite(latestPrice(position.asset)));
  const totalEquity = account.cash + markToMarket();
  const totalPnl = totalEquity - 100000;
  els.equity.textContent = hasUnpricedPosition ? "--" : money(totalEquity);
  els.pnl.textContent = hasUnpricedPosition ? "持仓缺少真实报价" : `${pct(totalPnl / 1000)} · ${money(totalPnl)}`;
  els.pnl.className = hasUnpricedPosition ? "muted" : totalPnl >= 0 ? "up" : "down";

  const openPositions = positions();
  els.positions.innerHTML = openPositions.length ? openPositions.map(position => {
    const price = latestPrice(position.asset);
    const avg = position.cost / position.qty;
    const unrealized = Number.isFinite(price) ? position.qty * (price - avg) : null;
    return `
      <div class="position-row">
        <div>
          <strong>${assets[position.asset].name} ${position.qty > 0 ? "多" : "空"} ${Math.abs(position.qty).toFixed(2)}</strong>
          <span class="mini">均价 ${money(Math.abs(avg))} · 现价 ${Number.isFinite(price) ? money(price) : "暂无真实数据"}</span>
        </div>
        <div>
          <strong class="${unrealized === null ? "muted" : unrealized >= 0 ? "up" : "down"}">${unrealized === null ? "--" : money(unrealized)}</strong>
          <button class="close-btn" data-close="${position.asset}" ${Number.isFinite(price) ? "" : "disabled"}>平仓</button>
        </div>
      </div>
    `;
  }).join("") : `<p class="empty">暂无持仓</p>`;

  const logs = account.trades.slice(-6).reverse();
  els.tradeLog.innerHTML = logs.length ? logs.map(trade => `
    <div class="trade-row">
      <div>
        <strong>${assets[trade.asset].name} · ${trade.side === "buy" ? "买入" : "卖出"}</strong>
        <span class="mini">${new Date(trade.time).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
        ${trade.reason ? `<span class="mini">${trade.reason}</span>` : ""}
      </div>
      <div><strong>${trade.qty.toFixed(2)}</strong><span class="mini">${money(trade.price)}</span></div>
    </div>
  `).join("") : `<p class="empty">暂无成交</p>`;
}

function render() {
  renderMarketStrip();
  renderAssetList();
  renderAnalytics();
  renderChart();
  renderTrading();
  const series = history[activeAsset];
  renderSignalRadar(series);
  renderTradePlan(series);
  renderBacktest(series);
  renderAlerts();
}

function placeTrade(event) {
  event.preventDefault();
  const qty = Number(els.quantity.value);
  if (!Number.isFinite(qty) || qty <= 0) return;
  if (!history[activeAsset]) return;
  const price = latestPrice(activeAsset);
  if (!Number.isFinite(price)) return;
  const side = els.side.value;
  const value = price * qty;
  account.cash += side === "buy" ? -value : value;
  account.trades.push({
    asset: activeAsset,
    side,
    qty,
    price,
    time: Date.now(),
    closed: false,
    reason: els.tradeReason.value.trim()
  });
  els.tradeReason.value = "";
  saveAccount();
  render();
}

function closePosition(assetKey) {
  const position = positions().find(item => item.asset === assetKey);
  if (!position) return;
  if (!history[assetKey]) return;
  const price = latestPrice(assetKey);
  if (!Number.isFinite(price)) return;
  const side = position.qty > 0 ? "sell" : "buy";
  const qty = Math.abs(position.qty);
  account.cash += position.qty > 0 ? price * qty : -price * qty;
  account.trades.forEach(trade => {
    if (trade.asset === assetKey && !trade.closed) trade.closed = true;
  });
  account.trades.push({ asset: assetKey, side, qty, price, time: Date.now(), closed: true });
  saveAccount();
  render();
}

document.addEventListener("click", event => {
  const assetButton = event.target.closest("[data-asset]");
  if (assetButton) {
    activeAsset = assetButton.dataset.asset;
    render();
  }

  const rangeButton = event.target.closest("[data-range]");
  if (rangeButton) {
    activeRange = rangeButton.dataset.range;
    document.querySelectorAll("[data-range]").forEach(button => button.classList.toggle("active", button === rangeButton));
    render();
  }

  const chartTypeButton = event.target.closest("[data-chart-type]");
  if (chartTypeButton) {
    chartType = chartTypeButton.dataset.chartType;
    document.querySelectorAll("[data-chart-type]").forEach(button => button.classList.toggle("active", button === chartTypeButton));
    renderChart();
  }

  const closeButton = event.target.closest("[data-close]");
  if (closeButton) closePosition(closeButton.dataset.close);

  const removeAlertButton = event.target.closest("[data-alert-remove]");
  if (removeAlertButton) {
    alerts = alerts.filter(alert => alert.id !== removeAlertButton.dataset.alertRemove);
    saveAlerts();
    renderAlerts();
  }
});

els.tradeForm.addEventListener("submit", placeTrade);
els.resetAccount.addEventListener("click", () => {
  account = { cash: 100000, trades: [], realized: 0 };
  saveAccount();
  render();
});

els.exportHistory.addEventListener("click", () => {
  const series = history[activeAsset];
  if (!series) return;
  const asset = assets[activeAsset];
  const rows = ["date,price"];
  series.forEach(point => {
    rows.push(`${point.date.toISOString().slice(0, 10)},${point.price}`);
  });
  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${asset.ticker.replace("=", "-")}-history.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
});

window.addEventListener("resize", renderChart);
els.riskPercent.addEventListener("input", () => renderTradePlan(history[activeAsset]));
els.strategySelect.addEventListener("change", () => renderBacktest(history[activeAsset]));
els.runBacktest.addEventListener("click", () => renderBacktest(history[activeAsset]));

els.alertForm.addEventListener("submit", event => {
  event.preventDefault();
  const price = Number(els.alertPrice.value);
  if (!Number.isFinite(price) || price <= 0) return;
  alerts.push({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    asset: activeAsset,
    direction: els.alertDirection.value,
    price,
    createdAt: Date.now()
  });
  els.alertPrice.value = "";
  saveAlerts();
  renderAlerts();
});

els.chart.addEventListener("pointermove", event => {
  if (!chartState) return;
  const rect = els.chart.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const { left, areaW, series } = chartState;
  const ratio = Math.max(0, Math.min(1, (x - left) / areaW));
  hoverIndex = Math.round(ratio * (series.length - 1));
  renderChart();
});

els.chart.addEventListener("pointerleave", () => {
  hoverIndex = null;
  renderChart();
});

loadMarketData();
loadMacroData();
setInterval(() => {
  loadMarketData();
  loadMacroData();
}, 60000);
