(() => {
  "use strict";

  const els = {
    status: document.querySelector("#billing-status"),
    refresh: document.querySelector("#refresh-billing"),
    balance: document.querySelector("#billing-balance"),
    form: document.querySelector("#deposit-form"),
    amount: document.querySelector("#deposit-amount"),
    paymentForm: document.querySelector("#payment-form"),
    paymentAmount: document.querySelector("#payment-amount"),
    providerStatus: document.querySelector("#provider-status"),
    orders: document.querySelector("#orders-list"),
  };

  let latestBilling = null;

  function setStatus(message, kind = "") {
    els.status.textContent = message;
    els.status.className = "settings-status" + (kind ? ` ${kind}` : "");
  }

  function formatTime(ts) {
    if (!ts) return "—";
    return new Date(Number(ts) * 1000).toLocaleString("zh-CN", { hour12: false });
  }

  function toggleAdminLinks(show) {
    document.querySelectorAll(".admin-only").forEach((item) => {
      item.hidden = !show;
    });
  }

  async function loadAdminFlag() {
    try {
      const res = await fetch("/api/auth/me", { credentials: "same-origin" });
      const data = await res.json().catch(() => ({}));
      toggleAdminLinks(Boolean(data.user?.isAdmin));
    } catch {
      toggleAdminLinks(false);
    }
  }

  function renderProviders(data) {
    const providers = data.providers || [];
    if (!els.providerStatus) return;
    els.providerStatus.innerHTML = "";
    for (const provider of providers) {
      const card = document.createElement("div");
      card.className = `provider-pill ${provider.enabled ? "ok" : "warn"}`;
      const title = document.createElement("strong");
      title.textContent = `${provider.label} · ${provider.enabled ? "已配置" : "未配置"}`;
      const desc = document.createElement("span");
      desc.textContent = provider.doc || "";
      card.append(title, desc);
      els.providerStatus.append(card);
    }
    if (!providers.length) {
      els.providerStatus.textContent = "未读取到支付通道配置。";
    }
  }

  function renderOrders(orders = []) {
    if (!els.orders) return;
    els.orders.innerHTML = "";
    if (!orders.length) {
      els.orders.textContent = "暂无订单";
      return;
    }
    for (const order of orders) {
      const row = document.createElement("div");
      row.className = `order-row ${order.status || "pending"}`;
      const left = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = `${order.provider === "epay" ? "易支付" : "码支付"} · $${order.amountUsd}`;
      const meta = document.createElement("span");
      meta.textContent = `${order.orderNo} · ${order.payType} · ${formatTime(order.createdAt)}`;
      left.append(title, meta);
      const status = document.createElement("em");
      status.textContent = order.status === "paid" ? "已支付" : "待支付";
      row.append(left, status);
      els.orders.append(row);
    }
  }

  function render(data) {
    latestBilling = data;
    els.balance.textContent = `$${data.balanceUsd || "0.00"}`;
    setStatus(`已连接 · 可用余额 $${data.balanceUsd || "0.00"} · ${data.purpose || "用于模型调用预算提示"}`, "ok");
    renderProviders(data);
    renderOrders(data.orders || []);
  }

  async function loadBilling() {
    setStatus("正在读取余额...");
    const response = await fetch("/api/billing", { credentials: "same-origin" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
    render(data);
    return data;
  }

  async function deposit(event) {
    event.preventDefault();
    const amount = els.amount.value.trim();
    if (!amount) {
      setStatus("请输入入金金额", "warn");
      return;
    }
    const submit = els.form.querySelector("button[type='submit']");
    submit.disabled = true;
    setStatus("正在手动保存余额...");
    try {
      const response = await fetch("/api/billing/deposit", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      els.amount.value = "";
      await loadBilling();
    } catch (error) {
      setStatus(error.message || String(error), "warn");
    } finally {
      submit.disabled = false;
    }
  }

  async function createPayment(event) {
    event.preventDefault();
    const amount = els.paymentAmount.value.trim();
    const provider = els.paymentForm.querySelector("input[name='provider']:checked")?.value || "epay";
    const payType = els.paymentForm.querySelector("input[name='payType']:checked")?.value || "alipay";
    if (!amount) {
      setStatus("请输入充值金额", "warn");
      return;
    }
    const providerInfo = (latestBilling?.providers || []).find((item) => item.key === provider);
    if (providerInfo && !providerInfo.enabled) {
      setStatus(`${providerInfo.label} 还没有配置商户参数，无法创建真实支付订单`, "warn");
      return;
    }
    const submit = els.paymentForm.querySelector("button[type='submit']");
    submit.disabled = true;
    setStatus("正在创建支付订单...");
    try {
      const response = await fetch("/api/payment/create", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount, provider, payType }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
      const order = data.order;
      setStatus(`订单已创建：${order.orderNo}，即将打开 ${order.providerLabel} 支付页`, "ok");
      await loadBilling();
      window.open(order.payUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      setStatus(error.message || String(error), "warn");
    } finally {
      submit.disabled = false;
    }
  }

  els.refresh.addEventListener("click", () => {
    loadBilling().catch((error) => setStatus(error.message || String(error), "warn"));
  });
  els.form.addEventListener("submit", deposit);
  els.paymentForm.addEventListener("submit", createPayment);
  loadAdminFlag();
  loadBilling().catch((error) => setStatus(error.message || String(error), "warn"));
})();
