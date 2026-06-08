const STORAGE_KEY = "stockHermesState.v1";

const stockData = {
  CRCL: {
    name: "Circle Internet Group",
    price: 122.85,
    change: -5.8,
    signal: "IPO 后波动放大，稳定币监管和成交量是主线。",
    risk: "High",
    note: "短期估值锚不稳定，适合把新闻、锁定期和监管事件拆开跟踪。",
    action: "生成事件时间线，关注流动性和监管新闻。",
  },
  NVDA: {
    name: "NVIDIA",
    price: 143.92,
    change: 1.7,
    signal: "AI 数据中心需求仍强，市场关注毛利率和供给节奏。",
    risk: "Medium",
    note: "高预期使财报容错率降低，需看订单可见度。",
    action: "跟踪云厂商 CapEx、Blackwell 交付和毛利率。",
  },
  AAPL: {
    name: "Apple",
    price: 196.45,
    change: 0.4,
    signal: "服务收入提供稳定性，AI 终端周期决定估值弹性。",
    risk: "Low",
    note: "硬件换机周期偏温和，增长节奏可能不均。",
    action: "关注 WWDC、iPhone 需求和服务毛利。",
  },
  MSFT: {
    name: "Microsoft",
    price: 478.18,
    change: 0.9,
    signal: "Azure 与 Copilot 渗透率支撑长期叙事。",
    risk: "Low",
    note: "AI 投入推高资本开支，回报周期需要持续验证。",
    action: "跟踪 Azure 增速、AI 收入披露和费用率。",
  },
  TSLA: {
    name: "Tesla",
    price: 184.11,
    change: -2.1,
    signal: "交付、价格策略和自动驾驶预期互相拉扯。",
    risk: "High",
    note: "汽车毛利率压力与高估值叙事并存。",
    action: "拆分汽车业务、储能、FSD 三条假设。",
  },
  AMZN: {
    name: "Amazon",
    price: 188.24,
    change: 0.8,
    signal: "AWS 增速修复与零售利润率改善共同支撑。",
    risk: "Medium",
    note: "资本开支和广告业务韧性是利润弹性的关键。",
    action: "观察 AWS backlog、广告收入和履约费用。",
  },
  AVGO: {
    name: "Broadcom",
    price: 0,
    change: 0,
    signal: "AI ASIC 与 VMware 整合是市场关注主线。",
    risk: "Medium",
    note: "估值已经反映较高 AI 预期，重点看订单持续性。",
    action: "跟踪 AI 定制芯片订单、软件利润率和并购整合。",
  },
  PLTR: {
    name: "Palantir",
    price: 0,
    change: 0,
    signal: "AI 应用商业化热度高，收入增速与估值弹性绑定。",
    risk: "High",
    note: "高估值下容错率低，需区分真实需求和叙事溢价。",
    action: "看商业客户增速、续约率和利润率变化。",
  },
  AMD: {
    name: "AMD",
    price: 0,
    change: 0,
    signal: "GPU 追赶与 CPU 周期修复共同驱动关注度。",
    risk: "Medium",
    note: "AI 芯片份额验证仍在早期，容易受预期波动影响。",
    action: "跟踪 MI 系列收入指引、毛利率和云厂商采用。",
  },
};

// 静态 ticker → 公司名 映射（A股/港股常用标的）
// 公司名是公开静态信息，不属于「行情」，可以脱离实时接口直接展示。
// 美股公司名由 Nasdaq 真实 API 返回，无需在此维护。
// 没收录的 ticker 仍然按 ticker 自身显示 + unknownStock 兜底，不会假造。
const cnTickerNames = {
  // 上海主板
  "600519.SS": "贵州茅台",
  "600036.SS": "招商银行",
  "600276.SS": "恒瑞医药",
  "601318.SS": "中国平安",
  "601398.SS": "工商银行",
  "601939.SS": "建设银行",
  "600028.SS": "中国石化",
  "601857.SS": "中国石油",
  "600030.SS": "中信证券",
  "601012.SS": "隆基绿能",
  "600887.SS": "伊利股份",
  "600585.SS": "海螺水泥",
  "600690.SS": "海尔智家",
  "601628.SS": "中国人寿",
  "601088.SS": "中国神华",
  "601166.SS": "兴业银行",
  "601328.SS": "交通银行",
  "601668.SS": "中国建筑",
  "601800.SS": "中国交建",
  "601138.SS": "工业富联",
  "600050.SS": "中国联通",
  "600104.SS": "上汽集团",
  "600196.SS": "复星医药",
  "600436.SS": "片仔癀",
  "600438.SS": "通威股份",
  "600900.SS": "长江电力",
  "601888.SS": "中国中免",
  "688981.SS": "中芯国际",
  "688041.SS": "海光信息",
  "688981.SH": "中芯国际",
  // 深圳主板 + 创业板
  "000001.SZ": "平安银行",
  "000002.SZ": "万科A",
  "000333.SZ": "美的集团",
  "000858.SZ": "五粮液",
  "002594.SZ": "比亚迪",
  "002475.SZ": "立讯精密",
  "300750.SZ": "宁德时代",
  "300059.SZ": "东方财富",
  "002714.SZ": "牧原股份",
  "300015.SZ": "爱尔眼科",
  "300760.SZ": "迈瑞医疗",
  "300124.SZ": "汇川技术",
  "002415.SZ": "海康威视",
  "002230.SZ": "科大讯飞",
  "000063.SZ": "中兴通讯",
  "000725.SZ": "京东方A",
  "000538.SZ": "云南白药",
  "000568.SZ": "泸州老窖",
  "000651.SZ": "格力电器",
  "002371.SZ": "北方华创",
  "300782.SZ": "卓胜微",
  "300122.SZ": "智飞生物",
  "300999.SZ": "金龙鱼",
  "300347.SZ": "泰格医药",
  "300498.SZ": "温氏股份",
  // A股 ETF / LOF（用户研究"红利低波 / 自由现金流"时常用）
  "512690.SH": "酒ETF（汇添富中证主要消费）",
  "161725.SZ": "白酒基金（招商中证白酒）",
  "512890.SH": "红利低波ETF（华泰柏瑞中证红利低波）",
  "510880.SH": "红利ETF（华泰柏瑞中证红利）",
  "159201.SZ": "自由现金流ETF（嘉实国证自由现金流）",
  "510300.SH": "沪深300ETF（华泰柏瑞）",
  "510500.SH": "中证500ETF（南方）",
  "159915.SZ": "创业板ETF（易方达）",
};

const hkTickerNames = {
  "0700.HK": "腾讯控股",
  "09988.HK": "阿里巴巴",
  "9988.HK": "阿里巴巴",
  "03690.HK": "美团",
  "3690.HK": "美团",
  "01810.HK": "小米集团",
  "1810.HK": "小米集团",
  "09999.HK": "网易",
  "9999.HK": "网易",
  "01211.HK": "比亚迪股份",
  "1211.HK": "比亚迪股份",
  "01024.HK": "快手",
  "1024.HK": "快手",
  "09618.HK": "京东集团",
  "9618.HK": "京东集团",
  "01093.HK": "石药集团",
  "02020.HK": "安踏体育",
  "00388.HK": "香港交易所",
  "00005.HK": "汇丰控股",
  "00939.HK": "建设银行",
  "01398.HK": "工商银行",
  "02318.HK": "中国平安",
  "02628.HK": "中国人寿",
  "03988.HK": "中国银行",
  "01288.HK": "农业银行",
  "00941.HK": "中国移动",
  "00700.HK": "腾讯控股",
};

const updates = [
  {
    id: "author-v110",
    source: "作者发布",
    version: "1.1.0",
    title: "财报风险模板",
    description: "在日报和问答里优先拆解财报日期、指引、利润率和估值容错率。",
    changes: ["默认风格切到基本面", "增加财报前风险措辞", "扩展日报的风险段落"],
    patch(state) {
      state.version = "1.1.0";
      state.preferences.style = "基本面";
      state.template = "earnings-risk";
      state.lastUpdate = "作者发布：财报风险模板";
    },
  },
  {
    id: "community-v112",
    source: "社区改进",
    version: "1.1.2",
    title: "波动信号增强",
    description: "社区贡献的信号排序逻辑，会把高波动和新闻密集股票排在更靠前位置。",
    changes: ["CRCL / TSLA 风险权重提高", "日报强调异动原因", "问答增加替代假设"],
    patch(state) {
      state.version = "1.1.2";
      state.preferences.risk = "均衡";
      state.template = "volatility-watch";
      state.lastUpdate = "社区改进：波动信号增强";
    },
  },
  {
    id: "personal-v120",
    source: "个人优化",
    version: "1.2.0-personal",
    title: "我的长期跟踪版",
    description: "根据当前股票池自动收紧输出，减少短线噪声，把结论转成长期假设检查表。",
    changes: ["周期切到长期", "风险偏好切到稳健", "日报增加假设变化检查"],
    patch(state) {
      state.version = "1.2.0-personal";
      state.preferences.horizon = "长期";
      state.preferences.risk = "稳健";
      state.template = "long-term-thesis";
      state.lastUpdate = "个人优化：我的长期跟踪版";
    },
  },
];

const markets = {
  us: { label: "美股", quoteLabel: "Nasdaq 延迟行情", placeholder: "CRCL / NVDA", supportsLiveQuotes: true },
  hk: { label: "港股", quoteLabel: "港股行情", placeholder: "0700.HK / 9988.HK", supportsLiveQuotes: false },
  cn: { label: "A股", quoteLabel: "A股行情", placeholder: "600519.SS / 300750.SZ", supportsLiveQuotes: false },
};

// 把 ticker 缩成"展示用的短代码"——去掉 yfinance 后缀（.SS/.SZ/.SH/.HK）
function formatTickerCode(ticker) {
  return String(ticker || "").replace(/\.(SS|SZ|SH|HK)$/i, "").toUpperCase();
}

// 把 ticker 解析成"公司名"用于显示：
//   1. 优先用真实行情 API 返回的 name（仅美股，目前是 Nasdaq 真实接口）
//   2. 否则按当前市场用静态字典（A股/港股）
//   3. 都没有就退回 ticker 自身
// 这一层只负责"展示用的中文名"，不会污染 stockData[ticker].name 的数据语义。
function resolveTickerName(ticker, market = state.activeMarket) {
  const fromQuote = stockData[ticker]?.name;
  if (fromQuote && fromQuote !== "Custom ticker") return fromQuote;
  if (market === "cn") {
    if (cnTickerNames[ticker]) return cnTickerNames[ticker];
    // 用户手输的纯数字（512690 / 161725）→ 自动尝试补后缀
    for (const suffix of [".SS", ".SZ", ".SH"]) {
      if (cnTickerNames[ticker + suffix]) return cnTickerNames[ticker + suffix];
    }
  } else if (market === "hk") {
    if (hkTickerNames[ticker]) return hkTickerNames[ticker];
    if (hkTickerNames[ticker + ".HK"]) return hkTickerNames[ticker + ".HK"];
  }
  return ticker;
}

const defaultState = {
  version: "1.0.0",
  activeMarket: "us",
  watchlists: {
    us: ["CRCL", "NVDA", "AVGO", "PLTR", "AMD", "TSLA"],
    hk: ["0700.HK", "9988.HK", "3690.HK"],
    cn: ["600519.SS", "300750.SZ", "000001.SZ"],
  },
  preferences: {
    horizon: "长期",
    risk: "均衡",
    style: "基本面",
  },
  template: "balanced-research",
  history: [],
  chats: { us: [], hk: [], cn: [] },
  conceptAnnotationMode: "ask",
  relatedSignals: { us: {}, hk: {}, cn: {} },
  lastBriefAt: null,
  lastUpdate: "初始版本",
};

let state = loadState();
let toastTimer = null;
let authMode = "login";
let currentUser = null;
let quoteSource = "加载真实行情中";
let quoteUpdatedAt = null;
let quotesLoaded = false;

const els = {
  authScreen: document.querySelector("#auth-screen"),
  appShell: document.querySelector("#app-shell"),
  loginTab: document.querySelector("#login-tab"),
  registerTab: document.querySelector("#register-tab"),
  authForm: document.querySelector("#auth-form"),
  authUsername: document.querySelector("#auth-username"),
  authPassword: document.querySelector("#auth-password"),
  authSubmit: document.querySelector("#auth-submit"),
  authError: document.querySelector("#auth-error"),
  logoutButton: document.querySelector("#logout-button"),
  userBadge: document.querySelector("#user-badge"),
  watchlist: document.querySelector("#watchlist"),
  watchlistCount: document.querySelector("#watchlist-count"),
  marketTabs: document.querySelector("#market-tabs"),
  currentMarketLabel: document.querySelector("#current-market-label"),
  quoteScope: document.querySelector("#quote-scope"),
  balanceBadge: document.querySelector("#balance-badge"),
  tickerForm: document.querySelector("#ticker-form"),
  tickerInput: document.querySelector("#ticker-input"),
  expandRelated: document.querySelector("#expand-related"),
  horizon: document.querySelector("#horizon"),
  risk: document.querySelector("#risk"),
  style: document.querySelector("#style"),
  templatePill: document.querySelector("#template-pill"),
  versionBadge: document.querySelector("#version-badge"),
  marketRegime: document.querySelector("#market-regime"),
  alertCount: document.querySelector("#alert-count"),
  coverageCount: document.querySelector("#coverage-count"),
  briefOutput: document.querySelector("#brief-output"),
  chatLog: document.querySelector("#chat-log"),
  chatForm: document.querySelector("#chat-form"),
  chatInput: document.querySelector("#chat-input"),
  modelStatus: document.querySelector("#model-status"),
  signalsTable: document.querySelector("#signals-table"),
  resetState: document.querySelector("#reset-state"),
  toast: document.querySelector("#toast"),
};

async function initAuth() {
  try {
    const response = await fetch("/api/auth/me");
    const data = await response.json();
    if (data.ok && data.user) {
      setAuthenticated(data.user);
      return;
    }
  } catch {
    // show login screen
  }
  setUnauthenticated();
}

function setAuthenticated(user) {
  currentUser = user;
  document.body.classList.add("authenticated");
  els.authScreen.hidden = true;
  els.appShell.hidden = false;
  els.userBadge.textContent = user.username;
  render();
  renderChat();
  syncChatFromServer({ silent: true });
  loadModelStatus();
  loadBillingBalance();
  loadQuotes();
  setTimeout(loadQuotes, 1200);
}

function setUnauthenticated() {
  currentUser = null;
  document.body.classList.remove("authenticated");
  els.authScreen.hidden = false;
  els.appShell.hidden = true;
  els.userBadge.textContent = "未登录";
  setAuthMode("login");
}

function setAuthMode(mode) {
  authMode = mode;
  els.loginTab.classList.toggle("active", mode === "login");
  els.registerTab.classList.toggle("active", mode === "register");
  els.authSubmit.textContent = mode === "login" ? "登录" : "注册并登录";
  els.authPassword.autocomplete = mode === "login" ? "current-password" : "new-password";
  els.authError.textContent = "";
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  const username = els.authUsername.value.trim();
  const password = els.authPassword.value;
  els.authError.textContent = "";
  els.authSubmit.disabled = true;
  try {
    const endpoint = authMode === "login" ? "/api/auth/login" : "/api/auth/register";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
    els.authPassword.value = "";
    setAuthenticated(data.user);
    showToast(authMode === "login" ? "登录成功" : "注册成功");
  } catch (error) {
    els.authError.textContent = error.message || String(error);
  } finally {
    els.authSubmit.disabled = false;
  }
}

async function logout() {
  try {
    await fetch("/api/auth/logout", { method: "POST" });
  } finally {
    setUnauthenticated();
    showToast("已退出登录");
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const loaded = raw ? JSON.parse(raw) : {};
    const merged = {
      ...structuredClone(defaultState),
      ...loaded,
      preferences: { ...defaultState.preferences, ...(loaded.preferences || {}) },
      watchlists: { ...structuredClone(defaultState.watchlists), ...(loaded.watchlists || {}) },
      chats: { ...structuredClone(defaultState.chats), ...(loaded.chats || {}) },
      relatedSignals: { ...structuredClone(defaultState.relatedSignals), ...(loaded.relatedSignals || {}) },
    };
    if (Array.isArray(loaded.watchlist) && !loaded.watchlists) {
      merged.watchlists.us = loaded.watchlist;
    }
    if (!markets[merged.activeMarket]) merged.activeMarket = "us";
    return merged;
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function render() {
  els.horizon.value = state.preferences.horizon;
  els.risk.value = state.preferences.risk;
  els.style.value = state.preferences.style;
  els.versionBadge.textContent = `v${state.version}`;
  els.templatePill.textContent = `模板：${templateLabel(state.template)}`;
  renderMarketTabs();
  renderWatchlist();
  renderSignals();
  renderMetrics();
}

function renderMarketTabs() {
  if (!els.marketTabs) return;
  els.marketTabs.querySelectorAll("button[data-market]").forEach((button) => {
    const active = button.dataset.market === state.activeMarket;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (els.currentMarketLabel) els.currentMarketLabel.textContent = marketLabel();
  if (els.quoteScope) els.quoteScope.textContent = quoteMarketLabel();
  if (els.tickerInput) els.tickerInput.placeholder = markets[state.activeMarket].placeholder;
}

function activeWatchlist() {
  if (!state.watchlists) state.watchlists = structuredClone(defaultState.watchlists);
  if (!state.watchlists[state.activeMarket]) state.watchlists[state.activeMarket] = [];
  return state.watchlists[state.activeMarket];
}

function setActiveWatchlist(list) {
  state.watchlists[state.activeMarket] = list;
}

function activeRelatedSignals() {
  if (!state.relatedSignals) state.relatedSignals = structuredClone(defaultState.relatedSignals);
  if (!state.relatedSignals[state.activeMarket]) state.relatedSignals[state.activeMarket] = {};
  return state.relatedSignals[state.activeMarket];
}

function marketLabel(market = state.activeMarket) {
  return markets[market]?.label || market;
}

function quoteMarketLabel() {
  return markets[state.activeMarket]?.quoteLabel || "真实行情";
}

function renderWatchlist() {
  const list = activeWatchlist();
  els.watchlistCount.textContent = `${marketLabel()} · ${list.length}`;
  els.watchlist.innerHTML = "";

  if (!list.length) {
    els.watchlist.innerHTML = `<div class="empty-state">${marketLabel()}池暂无关注股票</div>`;
    return;
  }

  list.forEach((ticker) => {
    const data = stockData[ticker] || unknownStock(ticker);
    const name = resolveTickerName(ticker, state.activeMarket);
    const code = formatTickerCode(ticker);
    const row = document.createElement("div");
    row.className = "ticker-row";
    row.innerHTML = `
      <div>
        <strong>${name}</strong>
        <span>${code}</span>
      </div>
      <button class="remove-btn" type="button" title="移除 ${ticker}" data-remove="${ticker}">×</button>
    `;
    els.watchlist.appendChild(row);
  });
}

function renderSignals() {
  els.signalsTable.innerHTML = "";
  const list = activeWatchlist();

  list.forEach((ticker) => {
    const data = stockData[ticker] || unknownStock(ticker);
    const hasRealQuote = quotesLoaded && data.source;
    const row = document.createElement("tr");
    if (!hasRealQuote) {
      const quoteStatus = markets[state.activeMarket].supportsLiveQuotes ? `正在加载 ${quoteMarketLabel()}` : `${quoteMarketLabel()}待接入`;
      const related = activeRelatedSignals()[ticker] || (data.relation ? data : null);
      const signalStatus = related
        ? relationSignal(related)
        : markets[state.activeMarket].supportsLiveQuotes
          ? "真实行情返回前不显示本地默认信号，避免误判。"
          : "当前市场池已独立保存；真实行情接口接入前不显示默认价格。";
      const riskStatus = related ? (related.reason || data.note || "关联关系待验证") : markets[state.activeMarket].supportsLiveQuotes ? "加载中" : "待接入";
      row.innerHTML = `
        <td class="ticker-cell">
          <strong>${resolveTickerName(ticker, state.activeMarket)}</strong>
          <span>${formatTickerCode(ticker)} · 等待真实行情</span>
        </td>
        <td class="price-cell"><strong>--</strong><span class="risk-note">${quoteStatus}</span></td>
        <td><span class="change">--</span></td>
        <td>${signalStatus}</td>
        <td><span class="risk-chip medium">--</span><span class="risk-note">${riskStatus}</span></td>
      `;
      els.signalsTable.appendChild(row);
      return;
    }
    const change = Number.isFinite(data.change) ? data.change : 0;
    const price = Number.isFinite(data.price) ? `$${data.price.toFixed(2)}` : "--";
    const changeClass = change >= 0 ? "up" : "down";
    const sourceLine = data.lastTradeTimestamp
      ? `${quoteSource} · ${data.lastTradeTimestamp}${data.isRealTime ? " · 近实时" : " · 延迟"}`
      : quoteSource;
    const displayName = resolveTickerName(ticker, state.activeMarket);
    const displayCode = formatTickerCode(ticker);
    row.innerHTML = `
      <td class="ticker-cell">
        <strong>${displayName}</strong>
        <span>${displayCode}</span>
      </td>
      <td class="price-cell"><strong>${price}</strong><span class="risk-note">${sourceLine}</span></td>
      <td><span class="change ${changeClass}">${formatChange(change)}</span></td>
      <td>${data.signal}</td>
      <td><span class="risk-chip ${riskClass(data.risk)}">${riskText(data.risk)}</span><span class="risk-note">${data.note}</span></td>
    `;
    els.signalsTable.appendChild(row);
  });
}

function renderBrief() {
  const list = activeWatchlist();
  const names = list.map((ticker) => ticker).join("、") || "暂无股票";
  const topRisk = highestRiskTicker();
  const highMove = list
    .map((ticker) => [ticker, stockData[ticker] || unknownStock(ticker)])
    .sort((a, b) => Math.abs(b[1].change) - Math.abs(a[1].change))[0];

  els.briefOutput.innerHTML = `
    <article class="brief-card">
      <h4>今日研究范围</h4>
      <p>当前是「${marketLabel()}」股票池：${names}。Hermes 使用「${state.preferences.horizon} / ${state.preferences.risk} / ${state.preferences.style}」偏好，模板为「${templateLabel(state.template)}」。</p>
    </article>
    <article class="brief-card">
      <h4>优先级</h4>
      <ul>
        <li>${topRisk ? `${topRisk} 是当前风险最高标的，先看事件和估值假设。` : "先添加股票以生成优先级。"}</li>
        <li>${highMove ? `${highMove[0]} 日内波动 ${formatChange(highMove[1].change)}，适合做波动归因。` : "暂无波动数据。"}</li>
        <li>输出只做研究辅助，避免把信息摘要写成直接买卖建议。</li>
      </ul>
    </article>
    <article class="brief-card">
      <h4>下一步</h4>
      <p>${nextStepCopy()}</p>
    </article>
  `;
}

function renderMetrics() {
  if (!quotesLoaded) {
    els.marketRegime.textContent = "Loading";
    els.alertCount.textContent = "--";
    els.coverageCount.textContent = String(activeWatchlist().length);
    return;
  }
  const list = activeWatchlist();
  const highRiskCount = list.filter((ticker) => {
    const data = stockData[ticker] || unknownStock(ticker);
    const change = Number.isFinite(data.change) ? data.change : 0;
    return data.risk === "High" || Math.abs(change) >= 3;
  }).length;
  const avgChange =
    list.reduce((sum, ticker) => {
      const change = (stockData[ticker] || unknownStock(ticker)).change;
      return sum + (Number.isFinite(change) ? change : 0);
    }, 0) /
    Math.max(list.length, 1);

  els.marketRegime.textContent = avgChange >= 0 ? "Risk-on" : "Selective";
  els.alertCount.textContent = String(highRiskCount);
  els.coverageCount.textContent = String(list.length);
}

function renderUpdates() {
  els.updateCards.innerHTML = "";

  updates.forEach((update) => {
    const applied = state.version === update.version;
    const card = document.createElement("article");
    card.className = "update-card";
    card.innerHTML = `
      <header>
        <div>
          <h4>${update.title}</h4>
          <p>目标版本 v${update.version}</p>
        </div>
        <span class="source-tag">${update.source}</span>
      </header>
      <p>${update.description}</p>
      <ul>${update.changes.map((item) => `<li>${item}</li>`).join("")}</ul>
      <footer>
        <span class="pill">${applied ? "当前已应用" : "可应用"}</span>
        <button type="button" data-update="${update.id}" ${applied ? "disabled" : ""}>应用更新</button>
      </footer>
    `;
    els.updateCards.appendChild(card);
  });
}

function renderHistory() {
  els.historyList.innerHTML = "";
  if (!state.history.length) {
    els.historyList.innerHTML = '<div class="empty-state">还没有升级快照</div>';
    return;
  }

  state.history.forEach((snapshot) => {
    const item = document.createElement("div");
    item.className = "history-item";
    item.innerHTML = `
      <div>
        <strong>${snapshot.label}</strong>
        <span>保存于 ${snapshot.createdAt}；版本 v${snapshot.state.version}；${marketLabel(snapshot.state.activeMarket)}池 ${snapshot.state.watchlist.join("、") || "空"}</span>
      </div>
      <button class="secondary-button" type="button" data-rollback="${snapshot.id}">回滚</button>
    `;
    els.historyList.appendChild(item);
  });
}

async function addTicker(ticker) {
  const normalized = ticker.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  if (!normalized) return false;
  const list = activeWatchlist();
  if (list.includes(normalized)) {
    showToast(`${normalized} 已在${marketLabel()}池`);
    return false;
  }
  // 累加：直接 append 到当前 watchlist，不替换、不调关联 API
  // 之前会调 refreshRelatedStocks 触发「关联池替换」，导致每次添加都清空已有股票。
  setActiveWatchlist([...list, normalized]);
  saveState();
  render();
  loadQuotes();
  showToast(`已添加 ${normalized} 到${marketLabel()}池`);
  return true;
}

function relationSignal(item) {
  const relation = item.relation || "关联标的";
  const reason = item.reason || "与核心标的相关，需要进一步验证。";
  return `${relation}：${reason}`;
}

function applyRelatedStocks(items) {
  const cleaned = [];
  const seen = new Set();
  const relatedMap = activeRelatedSignals();
  items.forEach((item) => {
    const ticker = String(item.ticker || "").trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
    if (!ticker || seen.has(ticker)) return;
    seen.add(ticker);
    cleaned.push(ticker);
    relatedMap[ticker] = {
      ticker,
      relation: item.relation || "关联标的",
      reason: item.reason || "与核心标的相关，需要进一步验证。",
    };
    const previous = stockData[ticker] || unknownStock(ticker);
    stockData[ticker] = {
      ...previous,
      name: previous.name === "Custom ticker" ? `${ticker} 关联标的` : previous.name,
      signal: relationSignal(item),
      note: item.reason || previous.note,
      action: `围绕 ${items[0]?.ticker || ticker} 验证 ${item.relation || "关联关系"}。`,
      relation: item.relation || "关联标的",
      relationReason: item.reason || "",
    };
  });
  return cleaned;
}

async function refreshRelatedStocks(ticker) {
  const normalized = ticker.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  if (!normalized) return;
  showToast(`正在根据 ${normalized} 刷新关联股票池…`);
  try {
    const response = await fetch(`/api/related?ticker=${encodeURIComponent(normalized)}&market=${encodeURIComponent(state.activeMarket)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
    const related = applyRelatedStocks(data.related || []);
    if (!related.length) throw new Error("未生成关联股票");
    setActiveWatchlist(related.slice(0, 12));
    saveState();
    quotesLoaded = false;
    render();
    loadQuotes();
    showToast(`已根据 ${normalized} 刷新同行/上下游：${related.join("、")}`);
  } catch (error) {
    const related = applyRelatedStocks([{ ticker: normalized, relation: "核心标的", reason: "用户指定的研究起点。" }]);
    setActiveWatchlist(related);
    saveState();
    render();
    loadQuotes();
    showToast(`关联股票生成失败，已保留 ${normalized}`);
  }
}

function removeTicker(ticker) {
  setActiveWatchlist(activeWatchlist().filter((item) => item !== ticker));
  saveState();
  render();
  loadQuotes();
  showToast(`已从${marketLabel()}池移除 ${ticker}`);
}

function switchMarket(market) {
  if (!markets[market] || market === state.activeMarket) return;
  state.activeMarket = market;
  quotesLoaded = false;
  const nextMarketLabel = marketLabel(market);
  quoteSource = markets[market].supportsLiveQuotes ? "加载真实行情中" : `${nextMarketLabel}真实行情待接入`;
  quoteUpdatedAt = null;
  saveState();
  render();
  renderChat();
  syncChatFromServer({ silent: true });
  loadQuotes();
  showToast(`已切换到${marketLabel()}池`);
}

function updatePreference(key, value) {
  state.preferences[key] = value;
  saveState();
  render();
}

function generateBrief() {
  state.lastBriefAt = new Date().toLocaleString("zh-CN", { hour12: false });
  saveState();
  renderBrief();
  showToast(`日报已生成：${state.lastBriefAt}`);
}

async function askHermes(question) {
  const clean = question.trim();
  if (!clean) return;
  appendMessage("user", clean, "", true);
  els.chatInput.value = "";

  const loading = appendMessage("agent", "正在调用当前 Hermes 模型分析…", "loading", false);
  setChatBusy(true);

  try {
    const result = await askModel(clean);
    loading.classList.remove("loading");
    const concepts = result.concepts || [];
    const shouldAutoAnnotate = state.conceptAnnotationMode === "always";
    setMessageText(loading, result.answer, shouldAutoAnnotate ? concepts : []);
    saveChatMessage("agent", result.answer, concepts);
    if (concepts.length && state.conceptAnnotationMode === "ask") {
      showConceptPrompt(loading, concepts, result.answer);
    } else if (concepts.length && shouldAutoAnnotate) {
      showToast(`已自动标注 ${concepts.length} 个概念`);
    }
  } catch (error) {
    loading.classList.remove("loading");
    const fallbackAnswer = `${answerQuestion(clean)}\n\n（模型接口暂时不可用，已回退到本地规则回答。错误：${error.message || error}）`;
    setMessageText(loading, fallbackAnswer);
    saveChatMessage("agent", fallbackAnswer);
    showToast("模型调用失败，已回退本地回答");
  } finally {
    setChatBusy(false);
    els.chatLog.scrollTop = els.chatLog.scrollHeight;
  }
}

async function askModel(question) {
  // 模型调用链路可能需要 30-60s，给请求设置显式超时，避免浏览器长时间无反馈。
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question,
        state: chatContextState(state),
        // 不再发 stocks：watchlist 是用户本地查看用，不应该影响问答内容
      }),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    return { answer: data.answer, concepts: data.concepts || [] };
  } catch (err) {
    if (err && err.name === "AbortError") {
      throw new Error("模型调用超过 60 秒未返回，可稍后重试，或切换更稳定的网络后再试");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function loadQuotes() {
  const market = state.activeMarket;
  const list = activeWatchlist();
  if (!currentUser || !list.length) return;
  quotesLoaded = false;
  if (!markets[market].supportsLiveQuotes) {
    quoteSource = `${marketLabel(market)}真实行情待接入`;
    render();
    return;
  }
  quoteSource = "加载真实行情中";
  render();
  try {
    const response = await fetch(`/api/quotes?symbols=${encodeURIComponent(list.join(","))}`);
    const data = await response.json().catch(() => ({}));
    if (market !== state.activeMarket) return;
    if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
    quoteSource = data.source || "真实行情";
    quoteUpdatedAt = new Date();
    data.quotes.forEach((quote) => {
      if (!quote.ok) return;
      const ticker = quote.ticker;
      const previous = stockData[ticker] || unknownStock(ticker);
      stockData[ticker] = {
        ...previous,
        name: quote.name || previous.name || ticker,
        price: quote.price,
        change: quote.change,
        netChange: quote.netChange,
        volume: quote.volume,
        lastTradeTimestamp: quote.lastTradeTimestamp,
        isRealTime: quote.isRealTime,
        source: quote.source,
        signal: activeRelatedSignals()[ticker] ? relationSignal(activeRelatedSignals()[ticker]) : buildSignal(ticker, quote, previous),
        risk: quoteRisk(quote.change, previous.risk),
        note: activeRelatedSignals()[ticker]?.reason || buildRiskNote(quote),
      };
    });
    quotesLoaded = data.quotes.some((quote) => quote.ok);
    render();
    showToast(`已更新${marketLabel()}真实行情：${list.join("、")}`);
  } catch (error) {
    if (market !== state.activeMarket) return;
    quoteSource = `行情加载失败：${error.message || error}`;
    quotesLoaded = false;
    render();
    showToast("真实行情加载失败");
  }
}

function buildSignal(ticker, quote, previous) {
  const direction = quote.change >= 0 ? "上涨" : "下跌";
  const volume = Number.isFinite(quote.volume) ? `，成交量 ${quote.volume.toLocaleString("en-US")}` : "";
  return `${quote.lastTradeTimestamp || "最近交易日"} ${ticker} ${direction} ${Math.abs(quote.change || 0).toFixed(2)}%${volume}。`;
}

function quoteRisk(change, fallback = "Medium") {
  if (!Number.isFinite(change)) return fallback;
  const abs = Math.abs(change);
  if (abs >= 5) return "High";
  if (abs >= 2) return "Medium";
  return "Low";
}

function buildRiskNote(quote) {
  if (!Number.isFinite(quote.change)) return "真实行情暂缺涨跌幅，需稍后刷新。";
  const abs = Math.abs(quote.change);
  if (abs >= 5) return "当日波动较大，优先核对新闻、财报、行业和宏观催化。";
  if (abs >= 2) return "当日波动中等，建议结合成交量和市场环境判断是否为系统性波动。";
  return "当日波动较小，可继续按长期基本面假设跟踪。";
}

function setChatBusy(isBusy) {
  els.chatInput.disabled = isBusy;
  els.chatForm.querySelector("button").disabled = isBusy;
}

function appendMessage(type, text, extraClass = "", persist = false, concepts = []) {
  const item = document.createElement("div");
  item.className = `message ${type}${extraClass ? ` ${extraClass}` : ""}`;
  item.innerHTML = `<strong>${type === "user" ? "你" : "AI助手"}</strong><span></span>`;
  setMessageText(item, text, concepts);
  els.chatLog.appendChild(item);
  if (persist) saveChatMessage(type, text, concepts);
  return item;
}

function activeChat() {
  if (!state.chats) state.chats = structuredClone(defaultState.chats);
  if (!state.chats[state.activeMarket]) state.chats[state.activeMarket] = [];
  return state.chats[state.activeMarket];
}

function saveChatMessage(type, text, concepts = []) {
  const message = {
    type,
    text,
    concepts: Array.isArray(concepts) ? concepts : [],
    at: new Date().toISOString(),
  };
  state.chats[state.activeMarket] = [...activeChat(), message].slice(-40);
  saveState();
  persistChatMessage(message);
}

async function persistChatMessage(message) {
  if (!currentUser) return;
  try {
    await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        market: state.activeMarket,
        type: message.type,
        text: message.text,
        ticker: detectTicker(message.text) || null,
      }),
    });
  } catch {
    // local recent history remains available even if server archive is down
  }
}

async function syncChatFromServer({ silent = false, limit = 80 } = {}) {
  if (!currentUser) return;
  try {
    const response = await fetch(`/api/chat?market=${encodeURIComponent(state.activeMarket)}&limit=${limit}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
    state.chats[state.activeMarket] = (data.messages || []).map((message) => ({
      id: message.id,
      type: message.type,
      text: message.text,
      at: message.createdAt ? new Date(message.createdAt * 1000).toISOString() : new Date().toISOString(),
      favorite: Boolean(message.favorite),
    })).slice(-40);
    saveState();
    renderChat();
    if (!silent) showToast(`已加载${marketLabel()}历史记录`);
  } catch (error) {
    if (!silent) showToast(`历史记录加载失败：${error.message || error}`);
  }
}

async function clearCurrentChat() {
  if (!confirm(`确定清空${marketLabel()}池的本地和服务器问答记录？`)) return;
  state.chats[state.activeMarket] = [];
  saveState();
  renderChat();
  try {
    await fetch("/api/chat/clear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ market: state.activeMarket }),
    });
    showToast(`已清空${marketLabel()}问答记录`);
  } catch {
    showToast("已清空本地记录，服务器清理失败");
  }
}

async function favoriteLatestAnswer() {
  try {
    const response = await fetch("/api/chat/favorite-latest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ market: state.activeMarket }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
    showToast(data.updated ? "已收藏上一条回答" : "暂无可收藏回答");
  } catch (error) {
    showToast(`收藏失败：${error.message || error}`);
  }
}

function renderChat() {
  els.chatLog.innerHTML = "";
  const messages = activeChat();
  if (!messages.length) {
    seedChat();
  } else {
    messages.forEach((message) => {
      const concepts = state.conceptAnnotationMode === "always" ? (message.concepts || []) : [];
      appendMessage(message.type, message.text, "", false, concepts);
    });
  }
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function showConceptPrompt(item, concepts, answerText) {
  const cleanConcepts = (concepts || []).filter((concept) => concept && concept.term).slice(0, 8);
  if (!cleanConcepts.length || item.querySelector(".concept-prompt")) return;

  const prompt = document.createElement("div");
  prompt.className = "concept-prompt";

  const text = document.createElement("div");
  text.className = "concept-prompt-text";
  text.textContent = `发现 ${cleanConcepts.length} 个可能需要解释的概念：${cleanConcepts.map((c) => c.term).join("、")}。以后要在回答里标注这些概念吗？`;
  prompt.appendChild(text);

  const actions = document.createElement("div");
  actions.className = "concept-prompt-actions";

  const always = document.createElement("button");
  always.type = "button";
  always.textContent = "以后都标注";
  always.addEventListener("click", () => {
    state.conceptAnnotationMode = "always";
    saveState();
    setMessageText(item, answerText, cleanConcepts);
    prompt.remove();
    showToast("以后会自动标注回答里的投资概念");
  });

  const once = document.createElement("button");
  once.type = "button";
  once.className = "ghost-button";
  once.textContent = "仅本次标注";
  once.addEventListener("click", () => {
    setMessageText(item, answerText, cleanConcepts);
    prompt.remove();
    showToast("已标注本次回答里的概念");
  });

  const never = document.createElement("button");
  never.type = "button";
  never.className = "ghost-button";
  never.textContent = "暂不提示";
  never.addEventListener("click", () => {
    state.conceptAnnotationMode = "off";
    saveState();
    prompt.remove();
    showToast("已关闭概念标注提示，可通过重置状态恢复");
  });

  actions.append(always, once, never);
  prompt.appendChild(actions);
  item.appendChild(prompt);
  els.chatLog.scrollTop = els.chatLog.scrollHeight;
}

function setMessageText(item, text, concepts = []) {
  const target = item.querySelector("span");
  target.innerHTML = "";
  const shouldAnnotate = item.classList.contains("agent") && Array.isArray(concepts) && concepts.length;
  if (!shouldAnnotate) {
    target.textContent = text;
    return;
  }
  renderAnnotatedText(target, text, concepts);
}

function renderAnnotatedText(container, text, concepts) {
  const validConcepts = concepts
    .filter((concept) => concept && concept.term && String(concept.term).length >= 2)
    .sort((a, b) => String(b.term).length - String(a.term).length)
    .slice(0, 12);
  if (!validConcepts.length) {
    container.textContent = text;
    return;
  }

  const source = String(text || "");
  const lowerSource = source.toLowerCase();
  const ranges = [];
  for (const concept of validConcepts) {
    const term = String(concept.term);
    const lowerTerm = term.toLowerCase();
    let start = 0;
    while (start < source.length) {
      const index = lowerSource.indexOf(lowerTerm, start);
      if (index < 0) break;
      const end = index + term.length;
      const overlaps = ranges.some((range) => index < range.end && end > range.start);
      if (!overlaps) ranges.push({ start: index, end, concept });
      start = end;
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  if (!ranges.length) {
    container.textContent = source;
    return;
  }

  let cursor = 0;
  for (const range of ranges) {
    if (range.start > cursor) container.appendChild(document.createTextNode(source.slice(cursor, range.start)));
    container.appendChild(createConceptMark(source.slice(range.start, range.end), range.concept));
    cursor = range.end;
  }
  if (cursor < source.length) container.appendChild(document.createTextNode(source.slice(cursor)));
}

function createConceptMark(label, concept) {
  const mark = document.createElement("span");
  mark.className = "concept-mark";
  mark.tabIndex = 0;
  mark.textContent = label;

  const card = document.createElement("span");
  card.className = "concept-card";

  const title = document.createElement("strong");
  title.textContent = concept.term || label;
  card.appendChild(title);

  const definition = document.createElement("em");
  definition.textContent = concept.definition || "暂无解释";
  card.appendChild(definition);

  const simple = document.createElement("small");
  simple.textContent = concept.simple ? `通俗理解：${concept.simple}` : "";
  card.appendChild(simple);

  const why = document.createElement("small");
  why.textContent = concept.whyImportant ? `投资里怎么看：${concept.whyImportant}` : "";
  card.appendChild(why);

  if (Array.isArray(concept.related) && concept.related.length) {
    const related = document.createElement("small");
    related.textContent = `相关：${concept.related.slice(0, 4).join("、")}`;
    card.appendChild(related);
  }

  const source = document.createElement("small");
  source.className = "concept-source";
  source.textContent = `来源：${concept.source === "obsidian" ? "Obsidian" : "AI自动标注"}`;
  card.appendChild(source);

  mark.appendChild(card);
  return mark;
}

function answerQuestion(question) {
  const ticker = detectTicker(question);
  const data = ticker && quotesLoaded ? stockData[ticker] || unknownStock(ticker) : null;

  if (!ticker) {
    return `我会先按当前${marketLabel()}池做交叉检查：${activeWatchlist().join("、") || "暂无股票"}。当前偏好是 ${state.preferences.horizon}、${state.preferences.risk}、${state.preferences.style}。如果要具体到某只股票，请带上代码。`;
  }
  if (!data) {
    return `${ticker} 的真实行情还在加载中，等${quoteMarketLabel()}返回后我再基于真实价格和涨跌幅分析。`;
  }

  return `${ticker} 当前真实行情 $${Number.isFinite(data.price) ? data.price.toFixed(2) : "暂无"}，最近交易日 ${formatChange(Number.isFinite(data.change) ? data.change : 0)}。主要信号是：${data.signal} 风险等级为 ${riskText(data.risk)}。在 ${state.preferences.style} 风格下，我会先验证：${data.action} 这不是买卖建议，只是研究辅助。`;
}

function checkUpdates() {
  els.updateStatus.textContent = `发现 ${updates.length} 个更新源`;
  showToast("已检查作者、社区和个人优化源");
}

function applyUpdate(id) {
  const update = updates.find((item) => item.id === id);
  if (!update) return;

  const snapshot = {
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    label: `升级到 v${update.version} 前快照`,
    createdAt: new Date().toLocaleString("zh-CN", { hour12: false }),
    state: snapshotState(state),
  };

  state.history = [snapshot, ...state.history].slice(0, 8);
  update.patch(state);
  saveState();
  render();
  showToast(`已应用 ${update.source} 更新，可从快照回滚`);
}

function rollback(id) {
  const snapshot = state.history.find((item) => item.id === id);
  if (!snapshot) return;

  const preservedHistory = state.history;
  state = {
    ...structuredClone(defaultState),
    ...structuredClone(snapshot.state),
    history: preservedHistory,
  };
  saveState();
  render();
  showToast(`已回滚到 ${snapshot.label}`);
}

function clearHistory() {
  state.history = [];
  saveState();
  renderHistory();
  showToast("版本历史已清空");
}

function resetState() {
  state = structuredClone(defaultState);
  saveState();
  render();
  renderChat();
  showToast("已恢复默认状态");
}

function snapshotState(source) {
  return {
    version: source.version,
    activeMarket: source.activeMarket,
    activeMarketLabel: marketLabel(source.activeMarket),
    watchlist: [...activeWatchlist()],
    watchlists: structuredClone(source.watchlists),
    chats: structuredClone(source.chats || defaultState.chats),
    relatedSignals: structuredClone(source.relatedSignals || defaultState.relatedSignals),
    preferences: { ...source.preferences },
    template: source.template,
    lastBriefAt: source.lastBriefAt,
    lastUpdate: source.lastUpdate,
  };
}

function chatContextState(source) {
  const snapshot = snapshotState(source);
  snapshot.recentChat = activeChat().slice(-10);
  delete snapshot.chats;
  return snapshot;
}

function currentStockData() {
  return Object.fromEntries(activeWatchlist().map((ticker) => [ticker, stockData[ticker] || unknownStock(ticker)]));
}

function detectTicker(question) {
  const upper = question.toUpperCase();
  return activeWatchlist().find((ticker) => upper.includes(ticker)) || Object.keys(currentStockData()).find((ticker) => upper.includes(ticker));
}

function highestRiskTicker() {
  const rank = { High: 3, Medium: 2, Low: 1 };
  return activeWatchlist()
    .map((ticker) => [ticker, stockData[ticker] || unknownStock(ticker)])
    .sort((a, b) => rank[b[1].risk] - rank[a[1].risk] || Math.abs(b[1].change) - Math.abs(a[1].change))[0]?.[0];
}

function nextStepCopy() {
  if (state.template === "earnings-risk") {
    return "先按财报日程排序，逐只核对收入增速、毛利率、指引变化和估值容错率。";
  }
  if (state.template === "volatility-watch") {
    return "先处理波动最大的标的，把价格异动拆成新闻、成交量、估值和宏观四类原因。";
  }
  if (state.template === "long-term-thesis") {
    return "先检查每只股票的长期假设是否变化，只在假设变化时升级为重点研究。";
  }
  return "先把高风险标的和高波动标的排到前面，再为每只股票生成可验证的问题清单。";
}

function templateLabel(template) {
  const labels = {
    "balanced-research": "均衡研究",
    "earnings-risk": "财报风险",
    "volatility-watch": "波动监控",
    "long-term-thesis": "长期假设",
  };
  return labels[template] || template;
}

function unknownStock(ticker) {
  return {
    name: "Custom ticker",
    price: 100,
    change: 0,
    signal: "自定义标的暂无行情，等待接入真实数据源。",
    risk: "Medium",
    note: "需要补充交易所、财报和新闻源后才能提升可信度。",
    action: `为 ${ticker} 建立数据源和研究模板。`,
  };
}

function riskClass(risk) {
  return { High: "high", Medium: "medium", Low: "low" }[risk] || "medium";
}

function riskText(risk) {
  return { High: "高", Medium: "中", Low: "低" }[risk] || "中";
}

function formatChange(value) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function showToast(message) {
  clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("show");
  toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2200);
}

function seedChat() {
  els.chatLog.innerHTML = "";
  const intro = `我会按当前${marketLabel()}池、偏好和当前模板回答。切换到 A股/港股/美股后，我只看当前池。所有输出都是研究辅助，不是买卖建议。`;
  appendMessage("agent", intro, "", false);
}

els.loginTab.addEventListener("click", () => setAuthMode("login"));
els.registerTab.addEventListener("click", () => setAuthMode("register"));
els.authForm.addEventListener("submit", handleAuthSubmit);
els.logoutButton.addEventListener("click", logout);

els.tickerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await addTicker(els.tickerInput.value);
  els.tickerInput.value = "";
});

els.expandRelated.addEventListener("click", async () => {
  const value = els.tickerInput.value;
  if (!value) {
    showToast("先在输入框填写要展开的核心标的");
    return;
  }
  await refreshRelatedStocks(value);
  els.tickerInput.value = "";
});

els.marketTabs.addEventListener("click", (event) => {
  const market = event.target.dataset.market;
  if (market) switchMarket(market);
});

els.watchlist.addEventListener("click", (event) => {
  const ticker = event.target.dataset.remove;
  if (ticker) removeTicker(ticker);
});

els.horizon.addEventListener("change", (event) => updatePreference("horizon", event.target.value));
els.risk.addEventListener("change", (event) => updatePreference("risk", event.target.value));
els.style.addEventListener("change", (event) => updatePreference("style", event.target.value));

els.chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  askHermes(els.chatInput.value);
});

els.chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    askHermes(els.chatInput.value);
  }
});

els.resetState.addEventListener("click", resetState);

initAuth();

async function loadModelStatus() {
  try {
    const response = await fetch("/api/config");
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
    els.modelStatus.textContent = `${data.model} · ${data.provider}${data.fallbackModel ? `｜备用 ${data.fallbackModel}` : ""}`;
    els.modelStatus.classList.remove("error");
  } catch (error) {
    els.modelStatus.textContent = "模型未连接";
    els.modelStatus.classList.add("error");
  }
}

async function loadBillingBalance() {
  if (!els.balanceBadge) return;
  try {
    const response = await fetch("/api/billing", { credentials: "same-origin" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
    els.balanceBadge.textContent = `余额 $${data.balanceUsd || "0.00"}`;
    els.balanceBadge.title = data.purpose || "用于 gpt-5.5 股票分析调用预算提示";
  } catch {
    els.balanceBadge.textContent = "余额 --";
  }
}

async function loadQuotes() {
  const market = state.activeMarket;
  const config = markets[market];
  const tickers = activeWatchlist();
  if (!currentUser || !tickers.length) {
    quotesLoaded = true;
    render();
    return;
  }
  if (!config.supportsLiveQuotes) {
    quotesLoaded = false;
    quoteSource = `${config.label}真实行情待接入`;
    render();
    return;
  }

  const requestMarket = market;
  const requestTickers = [...tickers];
  try {
    const response = await fetch(`/api/quotes?symbols=${encodeURIComponent(requestTickers.join(','))}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
    if (state.activeMarket !== requestMarket) return;

    (data.quotes || []).forEach((quote) => {
      if (!quote || !quote.ticker || !quote.ok) return;
      const ticker = String(quote.ticker).toUpperCase();
      const existing = stockData[ticker] || unknownStock(ticker);
      stockData[ticker] = {
        ...existing,
        name: quote.name || existing.name,
        price: Number.isFinite(quote.price) ? quote.price : existing.price,
        change: Number.isFinite(quote.change) ? quote.change : existing.change,
        source: quote.source || data.source || "真实行情",
        lastTradeTimestamp: quote.lastTradeTimestamp || "",
        isRealTime: Boolean(quote.isRealTime),
      };
    });
    quoteSource = data.source || "Nasdaq 延迟行情";
    quoteUpdatedAt = new Date().toLocaleString("zh-CN", { hour12: false });
    quotesLoaded = true;
  } catch (error) {
    quoteSource = `行情加载失败：${error.message || error}`;
    quotesLoaded = false;
  }
  renderSignals();
  renderMetrics();
  renderWatchlist();
}
