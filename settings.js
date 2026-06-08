(() => {
  "use strict";

  const els = {
    status: document.querySelector("#settings-status"),
    refresh: document.querySelector("#refresh-settings"),
    memoryList: document.querySelector("#memory-list"),
    modelRouting: document.querySelector("#model-routing"),
    hermesCore: document.querySelector("#hermes-core"),
    memoryFiles: document.querySelector("#memory-files"),
    storageInfo: document.querySelector("#storage-info"),
  };

  let currentFiles = [];
  let originalContent = {};
  let currentSettings = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function formatTime(ts) {
    if (!ts) return "--";
    return new Date(ts * 1000).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function fileLabel(rel) {
    const isUser = rel.endsWith("USER.md");
    return isUser ? "USER.md（个人配置）" : "MEMORY.md（个人记忆）";
  }

  function cardId(rel) {
    return "card-" + rel.replace(/[^a-zA-Z0-9]/g, "_");
  }

  function renderMemoryCards(files) {
    if (!files || !files.length) {
      els.memoryList.innerHTML =
        '<p class="muted-text">未找到任何记忆文件。</p>';
      return;
    }
    const uid = currentSettings?.user?.id ?? "unknown";
    const userDir = `user_memories/${uid}/`;
    els.memoryList.innerHTML = files
      .map((f) => {
        const id = cardId(f.path);
        const lines = f.content
          ? escapeHtml(f.content).split("\n")
          : [];
        const lineCount = f.lineCount || 0;
        return `
      <div class="memory-card" id="${escapeHtml(id)}">
        <div class="memory-card-header">
          <div class="memory-card-meta">
            <span class="memory-card-label">${escapeHtml(fileLabel(f.path))}</span>
            <code class="memory-card-path">${userDir}${escapeHtml(f.path)}</code>
          </div>
          <div class="memory-card-stats">
            <span>${f.exists ? "存在" : "不存在"}</span>
            <span>${formatBytes(f.size)}</span>
            <span>${lineCount} 行</span>
            <span>${formatTime(f.modifiedAt)}</span>
          </div>
        </div>
        <div class="memory-card-body">
          <textarea
            id="ta-${escapeHtml(id)}"
            class="memory-textarea"
            spellcheck="false"
            ${f.exists ? "" : "placeholder='文件不存在，点击保存来创建'"}
          >${f.exists ? escapeHtml(f.content) : ""}</textarea>
        </div>
        <div class="memory-card-footer">
          <button class="save-btn" data-path="${escapeHtml(f.path)}" ${f.exists ? "" : "disabled"}>保存</button>
          <button class="revert-btn" data-path="${escapeHtml(f.path)}">恢复</button>
          <span class="save-hint" id="hint-${escapeHtml(id)}"></span>
        </div>
      </div>
    `;
      })
      .join("");

    // Attach save/revert handlers
    els.memoryList.querySelectorAll(".save-btn").forEach((btn) => {
      btn.addEventListener("click", () => saveMemory(btn.dataset.path));
    });
    els.memoryList.querySelectorAll(".revert-btn").forEach((btn) => {
      btn.addEventListener("click", () => revertMemory(btn.dataset.path));
    });
  }

  async function saveMemory(rel) {
    const id = cardId(rel);
    const ta = document.getElementById("ta-" + id);
    const hint = document.getElementById("hint-" + id);
    const btn = els.memoryList.querySelector(
      `.save-btn[data-path="${CSS.escape(rel)}"]`
    );
    const newContent = ta.value;
    const origContent = originalContent[rel] ?? "";
    if (newContent === origContent) {
      hint.textContent = "内容未变，无需保存";
      return;
    }
    btn.disabled = true;
    hint.textContent = "保存中...";
    try {
      const res = await fetch("/api/memory", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: rel, content: newContent }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "保存失败");
      }
      originalContent[rel] = newContent;
      hint.textContent = "已保存 " + formatTime(data.file.modifiedAt);
    } catch (err) {
      hint.textContent = "错误：" + err.message;
    } finally {
      btn.disabled = false;
    }
  }

  function revertMemory(rel) {
    const id = cardId(rel);
    const ta = document.getElementById("ta-" + id);
    const hint = document.getElementById("hint-" + id);
    if (ta) ta.value = originalContent[rel] ?? "";
    if (hint) hint.textContent = "";
  }

  async function loadMemoryFiles() {
    els.status.textContent = "正在加载记忆文件...";
    els.status.className = "settings-status";
    try {
      const res = await fetch("/api/memory", {
        credentials: "same-origin",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "加载失败");
      }
      currentFiles = data.files || [];
      // Cache original content for revert
      originalContent = {};
      for (const f of currentFiles) {
        originalContent[f.path] = f.content;
      }
      renderMemoryCards(currentFiles);
      els.status.textContent = `已连接：${currentSettings?.user?.username ?? "未知"} · 记忆文件已加载`;
      els.status.className = "settings-status ok";
    } catch (err) {
      els.status.textContent = "加载失败：" + err.message;
      els.status.className = "settings-status warn";
    }
  }

  function renderRouteCard(item) {
    const apiKeyDisplay = item.apiKeyConfigured ? "已配置" : "未配置";
    return `
      <div class="route-card">
        <span>${escapeHtml(item.role)}</span>
        <strong>${escapeHtml(item.model)}</strong>
        <div class="route-meta">
          <span>${escapeHtml(item.provider)}</span>
          <span>Base URL：${item.baseUrlConfigured ? "已配置" : "未配置"}</span>
          <span>API Key：${apiKeyDisplay}</span>
        </div>
      </div>
    `;
  }

  function renderFileRow(label, meta) {
    const exists = meta && meta.exists;
    return `
      <div class="settings-row file-row ${exists ? "ok" : "warn"}">
        <span>${escapeHtml(label)}</span>
        <strong>${exists ? "存在" : "不存在"}</strong>
        <code>${escapeHtml(meta?.path || "--")}</code>
        <em>${exists ? `${formatBytes(meta.size)} · ${formatTime(meta.modifiedAt)}` : "--"}</em>
      </div>
    `;
  }

  function render(data) {
    currentSettings = data;
    els.status.textContent = `已连接：${data.user.username} · 不展示任何 API Key 明文`;
    els.status.className = "settings-status ok";

    if (data.modelRouting && data.modelRouting.length) {
      els.modelRouting.innerHTML = data.modelRouting
        .map(renderRouteCard)
        .join("");
    }

    if (data.hermes && Object.keys(data.hermes).length) {
      const c = data.hermes;
      els.hermesCore.innerHTML = `
        ${c.configPath ? renderFileRow("config.yaml", c.configPath) : ""}
        ${c.defaultMemory ? renderFileRow("默认 MEMORY.md", c.defaultMemory) : ""}
        ${c.defaultUser ? renderFileRow("默认 USER.md", c.defaultUser) : ""}
        ${c.fenxiMemory ? renderFileRow("fenxi MEMORY.md", c.fenxiMemory) : ""}
        ${c.fenxiUser ? renderFileRow("fenxi USER.md", c.fenxiUser) : ""}
      `;
    }

    if (data.memories && data.memories.length) {
      els.memoryFiles.innerHTML = data.memories
        .map((mf) => renderFileRow(mf.label, mf))
        .join("");
    }

    if (data.storage) {
      const s = data.storage;
      els.storageInfo.innerHTML = `
        <div class="settings-row">
          <span>数据库路径</span>
          <strong>${escapeHtml(s.dbPath)}</strong>
        </div>
        <div class="settings-row">
          <span>用户 / 会话</span>
          <strong>${s.userCount} / ${s.sessionCount}</strong>
        </div>
        <div class="settings-row">
          <span>历史问答 / 概念库</span>
          <strong>${s.messageCount} / ${s.conceptCount}</strong>
        </div>
        <div class="settings-row">
          <span>.env 存在</span>
          <strong class="${s.envExists ? "ok" : "warn"}">${s.envExists ? "是" : "否"}</strong>
        </div>
        <div class="settings-row">
          <span>API Key 已配置</span>
          <strong class="${s.apiKeyConfigured ? "ok" : "warn"}">${s.apiKeyConfigured ? "是" : "否"}</strong>
        </div>
      `;
    }
  }

  async function loadSettings() {
    els.status.textContent = "正在读取 Hermes 设置...";
    els.status.className = "settings-status";
    const res = await fetch("/api/settings", {
      credentials: "same-origin",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "读取设置失败");
    }
    render(data);
    await loadMemoryFiles();
  }

  els.refresh.addEventListener("click", () => {
    loadSettings().catch((err) => {
      els.status.textContent = err.message;
      els.status.className = "settings-status warn";
    });
  });

  loadSettings().catch((err) => {
    els.status.textContent = err.message;
    els.status.className = "settings-status warn";
  });
})();