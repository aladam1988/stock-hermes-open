(() => {
  "use strict";

  const els = {
    status: document.querySelector("#billing-status"),
    refresh: document.querySelector("#refresh-billing"),
    balance: document.querySelector("#billing-balance"),
    form: document.querySelector("#deposit-form"),
    amount: document.querySelector("#deposit-amount"),
  };

  function setStatus(message, kind = "") {
    els.status.textContent = message;
    els.status.className = "settings-status" + (kind ? ` ${kind}` : "");
  }

  function render(data) {
    els.balance.textContent = `$${data.balanceUsd || "0.00"}`;
    setStatus(`已连接 · 可用余额 $${data.balanceUsd || "0.00"} · ${data.purpose || "用于模型调用预算提示"}`, "ok");
  }

  async function loadBilling() {
    setStatus("正在读取余额...");
    const response = await fetch("/api/billing", { credentials: "same-origin" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
    render(data);
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
    setStatus("正在保存余额...");
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
      render(data);
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
  loadBilling().catch((error) => setStatus(error.message || String(error), "warn"));
})();
