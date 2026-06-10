const els = {
  status: document.querySelector('#wechat-status'),
  content: document.querySelector('#wechat-content'),
  refresh: document.querySelector('#refresh-wechat'),
  form: document.querySelector('#wechat-settings-form'),
  appid: document.querySelector('#wechat-appid'),
  appsecret: document.querySelector('#wechat-appsecret'),
  author: document.querySelector('#wechat-author'),
  digest: document.querySelector('#wechat-digest'),
  thumb: document.querySelector('#wechat-thumb'),
  candidates: document.querySelector('#candidate-list'),
  title: document.querySelector('#draft-title'),
  draftDigest: document.querySelector('#draft-digest'),
  draftContent: document.querySelector('#draft-content'),
  buildDraft: document.querySelector('#build-draft'),
  saveDraft: document.querySelector('#save-draft'),
  publishDraft: document.querySelector('#publish-draft'),
  posts: document.querySelector('#post-list'),
};

let state = {
  user: null,
  settings: {},
  candidates: [],
  posts: [],
  selectedIds: new Set(),
  latestPostId: null,
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"]/g, (ch) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
  }[ch]));
}

function fmtTime(seconds) {
  if (!seconds) return '--';
  return new Date(Number(seconds) * 1000).toLocaleString('zh-CN', { hour12: false });
}

function setStatus(text, ok = true) {
  els.status.textContent = text;
  els.status.classList.toggle('error', !ok);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function toggleAdminLinks(show) {
  document.querySelectorAll('.admin-only').forEach((item) => { item.hidden = !show; });
}

async function checkAuth() {
  const data = await fetchJson('/api/auth/me');
  if (!data.user) {
    location.href = './index.html';
    return false;
  }
  state.user = data.user;
  toggleAdminLinks(Boolean(data.user.isAdmin));
  if (!data.user.isAdmin) {
    els.content.hidden = true;
    setStatus('无权限：只有站长账号可以访问公众号后台。', false);
    return false;
  }
  return true;
}

async function loadWechat() {
  try {
    setStatus('正在读取公众号后台...');
    const authed = await checkAuth();
    if (!authed) return;
    const data = await fetchJson('/api/admin/wechat');
    state.settings = data.settings || {};
    state.candidates = data.candidates || [];
    state.posts = data.posts || [];
    els.content.hidden = false;
    renderSettings();
    renderCandidates();
    renderPosts();
    setStatus(`已加载：${state.candidates.length} 个候选问题，${state.posts.length} 篇草稿。`);
  } catch (error) {
    els.content.hidden = true;
    setStatus(`加载失败：${error.message || error}`, false);
  }
}

function renderSettings() {
  els.appid.value = state.settings.appid || '';
  els.appsecret.value = '';
  els.appsecret.placeholder = state.settings.hasAppsecret ? '已配置，留空不修改' : '公众号 AppSecret';
  els.author.value = state.settings.author || '';
  els.digest.value = state.settings.defaultDigest || '';
  els.thumb.value = state.settings.thumbMediaId || '';
  if (!els.draftDigest.value) els.draftDigest.value = state.settings.defaultDigest || '来自用户问题的美股观察笔记';
}

function renderCandidates() {
  if (!state.candidates.length) {
    els.candidates.innerHTML = '<div class="empty-card">暂无符合条件的问题。用户提问后会自动进入这里。</div>';
    return;
  }
  els.candidates.innerHTML = state.candidates.map((item) => {
    const checked = state.selectedIds.has(Number(item.id)) ? 'checked' : '';
    const reasons = (item.reasons || []).map((reason) => `<span>${escapeHtml(reason)}</span>`).join('');
    return `
      <label class="candidate-card">
        <input type="checkbox" data-id="${item.id}" ${checked} />
        <div>
          <div class="candidate-head">
            <strong>${escapeHtml(item.suggestedTitle || '未命名选题')}</strong>
            <em>${item.score} 分</em>
          </div>
          <p>${escapeHtml(item.text)}</p>
          <div class="candidate-meta">
            <span>${escapeHtml(item.username || '用户')}</span>
            <span>${escapeHtml(item.market || 'us')}</span>
            ${item.ticker ? `<span>${escapeHtml(item.ticker)}</span>` : ''}
            <span>${fmtTime(item.createdAt)}</span>
          </div>
          <div class="reason-tags">${reasons}</div>
        </div>
      </label>`;
  }).join('');
  els.candidates.querySelectorAll('input[type="checkbox"]').forEach((box) => {
    box.addEventListener('change', () => {
      const id = Number(box.dataset.id);
      if (box.checked) state.selectedIds.add(id);
      else state.selectedIds.delete(id);
      syncDraftTitle();
    });
  });
}

function selectedCandidates() {
  return state.candidates.filter((item) => state.selectedIds.has(Number(item.id)));
}

function syncDraftTitle() {
  const selected = selectedCandidates();
  if (!selected.length || els.title.value.trim()) return;
  els.title.value = selected[0].suggestedTitle || '站内热门问题观察';
}

function localTitleFor(text, ticker) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= 34) return clean.replace(/[?？]$/, '');
  if (ticker) return `${ticker} 值得关注吗？`;
  if (clean.includes('半导体') && clean.includes('物理')) return '半导体和物理 AI，美股还有机会吗？';
  if (clean.includes('财报')) return '这份财报真正该看什么？';
  if (clean.includes('估值')) return '估值高的时候，应该看什么？';
  return clean.slice(0, 32).replace(/[，。,.!?！？]$/, '');
}

function buildLocalArticle() {
  const selected = selectedCandidates();
  const title = els.title.value.trim() || selected[0]?.suggestedTitle || '站内热门问题观察';
  els.title.value = title;
  if (!els.draftDigest.value.trim()) els.draftDigest.value = state.settings.defaultDigest || '来自用户问题的美股观察笔记';
  const lines = [
    `# ${title}`,
    '',
    '这篇来自站内用户向 小牛AI投研提出的问题。',
    '我把其中适合公开讨论的部分整理成一篇观察笔记，只做研究，不构成买卖建议。',
    '',
  ];
  selected.forEach((item, index) => {
    lines.push(`## ${index + 1}. ${localTitleFor(item.text, item.ticker)}`);
    lines.push('');
    lines.push(`> 用户原问题：${item.text}`);
    lines.push('');
    lines.push('可以从三个角度看：');
    lines.push('- 它背后的产业链逻辑是什么；');
    lines.push('- 哪些数据能验证这个判断；');
    lines.push('- 哪些风险会让这个判断失效。');
    lines.push('');
  });
  lines.push('如果你也在观察美股、半导体、物理 AI 或机器人供应链，可以把问题丢给这个研究助手，让它先帮你整理一版观察框架。');
  els.draftContent.value = lines.join('\n');
}

function renderPosts() {
  if (!state.posts.length) {
    els.posts.innerHTML = '<div class="empty-card">还没有保存草稿。</div>';
    return;
  }
  els.posts.innerHTML = state.posts.map((post) => `
    <article class="post-card">
      <div>
        <strong>${escapeHtml(post.title)}</strong>
        <p>${escapeHtml(post.digest || '无摘要')}</p>
        <span>${escapeHtml(post.status)} · ${fmtTime(post.createdAt)}</span>
      </div>
      <button class="ghost-button" type="button" data-post-id="${post.id}">载入</button>
    </article>
  `).join('');
  els.posts.querySelectorAll('[data-post-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const post = state.posts.find((item) => Number(item.id) === Number(button.dataset.postId));
      if (!post) return;
      els.title.value = post.title || '';
      els.draftDigest.value = post.digest || '';
      els.draftContent.value = post.content || '';
      state.latestPostId = post.id;
      setStatus(`已载入草稿 #${post.id}`);
    });
  });
}

async function saveSettings(event) {
  event.preventDefault();
  try {
    const data = await fetchJson('/api/admin/wechat/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appid: els.appid.value.trim(),
        appsecret: els.appsecret.value.trim(),
        author: els.author.value.trim(),
        defaultDigest: els.digest.value.trim(),
        thumbMediaId: els.thumb.value.trim(),
      }),
    });
    state.settings = data.settings || {};
    renderSettings();
    setStatus('公众号参数已保存。');
  } catch (error) {
    setStatus(`保存失败：${error.message || error}`, false);
  }
}

async function saveDraft() {
  try {
    if (!els.draftContent.value.trim()) buildLocalArticle();
    const data = await fetchJson('/api/admin/wechat/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: els.title.value.trim(),
        digest: els.draftDigest.value.trim(),
        content: els.draftContent.value.trim(),
        sourceMessageIds: Array.from(state.selectedIds),
      }),
    });
    state.posts = data.posts || [];
    state.latestPostId = data.post?.id || state.latestPostId;
    renderPosts();
    setStatus(`草稿已保存：#${data.post?.id || ''}`);
    return data.post;
  } catch (error) {
    setStatus(`保存草稿失败：${error.message || error}`, false);
    return null;
  }
}

async function publishDraft() {
  try {
    let postId = state.latestPostId;
    if (!postId) {
      const post = await saveDraft();
      postId = post?.id;
    }
    if (!postId) throw new Error('请先保存或载入一篇草稿');
    const data = await fetchJson('/api/admin/wechat/publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ postId }),
    });
    state.posts = data.posts || state.posts;
    renderPosts();
    setStatus(`已提交到微信草稿箱，media_id=${data.result?.mediaId || ''}`);
  } catch (error) {
    setStatus(`提交微信失败：${error.message || error}`, false);
  }
}

els.refresh.addEventListener('click', loadWechat);
els.form.addEventListener('submit', saveSettings);
els.buildDraft.addEventListener('click', buildLocalArticle);
els.saveDraft.addEventListener('click', saveDraft);
els.publishDraft.addEventListener('click', publishDraft);

loadWechat();
