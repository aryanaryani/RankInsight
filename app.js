// ============================================================
// app.js — dashboard logic (no build step needed)
// Talks to the SAME Supabase project + Edge Functions as the
// Chrome extension (analyze-website, rank-check, recommendations, report).
// ============================================================

const FUNCTIONS_BASE = `${CONFIG.SUPABASE_URL}/functions/v1`;
const REST_BASE = `${CONFIG.SUPABASE_URL}/rest/v1`;
const AUTH_BASE = `${CONFIG.SUPABASE_URL}/auth/v1`;
const SESSION_KEY = 'rankinsight_session';

let session = null;
let currentWebsiteId = null;
let currentKeywords = [];
let authMode = 'login';

// ---------- DOM refs ----------
const viewAuth = document.getElementById('view-auth');
const viewApp = document.getElementById('view-app');
const tabLogin = document.getElementById('tab-login');
const tabSignup = document.getElementById('tab-signup');
const formAuth = document.getElementById('form-auth');
const btnAuthSubmit = document.getElementById('btn-auth-submit');
const inputEmail = document.getElementById('input-email');
const inputPassword = document.getElementById('input-password');
const authMessage = document.getElementById('auth-message');

const btnLogout = document.getElementById('btn-logout');
const creditsBadge = document.getElementById('credits-badge');
const inputUrl = document.getElementById('input-url');
const inputLanguage = document.getElementById('input-language');
const inputLocation = document.getElementById('input-location');
const btnAnalyze = document.getElementById('btn-analyze');
const btnRefreshWebsites = document.getElementById('btn-refresh-websites');
const siteList = document.getElementById('site-list');
const appMessage = document.getElementById('app-message');

const emptyState = document.getElementById('empty-state');
const loadingEl = document.getElementById('loading');
const reportView = document.getElementById('report-view');
const reportTitle = document.getElementById('report-title');
const reportNiche = document.getElementById('report-niche');
const btnRankCheck = document.getElementById('btn-rank-check');
const statTotal = document.getElementById('stat-total');
const statRanking = document.getElementById('stat-ranking');
const statNotRanking = document.getElementById('stat-not-ranking');
const statBest = document.getElementById('stat-best');
const statAvg = document.getElementById('stat-avg');
const keywordsTbody = document.getElementById('keywords-tbody');

const recPanel = document.getElementById('recommendation-panel');
const recommendationKeyword = document.getElementById('recommendation-keyword');
const recReason = document.getElementById('rec-reason');
const recSuggestions = document.getElementById('rec-suggestions');
const recGaps = document.getElementById('rec-gaps');
const btnCloseRecommendation = document.getElementById('btn-close-recommendation');

// ---------- Helpers ----------
function showLoading(show) {
  loadingEl.classList.toggle('hidden', !show);
  if (show) {
    emptyState.classList.add('hidden');
    reportView.classList.add('hidden');
  }
}

function setAppMessage(text, isError = true) {
  appMessage.textContent = text || '';
  appMessage.style.color = isError ? '#FFB4C0' : '#8FE3B0';
}

function setAuthMessage(text, isError = true) {
  authMessage.textContent = text || '';
  authMessage.style.color = isError ? '#B00020' : '#16A34A';
}

function saveSession(newSession) {
  session = newSession;
  localStorage.setItem(SESSION_KEY, JSON.stringify(newSession));
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    session = raw ? JSON.parse(raw) : null;
  } catch {
    session = null;
  }
  return session;
}

function clearSession() {
  session = null;
  localStorage.removeItem(SESSION_KEY);
}

function authHeaders() {
  return {
    'Content-Type': 'application/json',
    apikey: CONFIG.SUPABASE_ANON_KEY,
    Authorization: `Bearer ${session.access_token}`,
  };
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Auth ----------
tabLogin.addEventListener('click', () => switchAuthTab('login'));
tabSignup.addEventListener('click', () => switchAuthTab('signup'));

function switchAuthTab(mode) {
  authMode = mode;
  tabLogin.classList.toggle('active', mode === 'login');
  tabSignup.classList.toggle('active', mode === 'signup');
  btnAuthSubmit.textContent = mode === 'login' ? 'Log in' : 'Sign up';
  setAuthMessage('');
}

formAuth.addEventListener('submit', async (e) => {
  e.preventDefault();
  setAuthMessage('');
  const email = inputEmail.value.trim();
  const password = inputPassword.value;
  btnAuthSubmit.disabled = true;

  try {
    if (authMode === 'signup') {
      const res = await fetch(`${AUTH_BASE}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: CONFIG.SUPABASE_ANON_KEY },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error_description || data.msg || 'Signup failed');

      if (data.access_token) {
        saveSession({ access_token: data.access_token, user: data.user });
        showApp();
      } else {
        setAuthMessage('Signup successful! Check your email to confirm, then log in.', false);
        switchAuthTab('login');
      }
    } else {
      const res = await fetch(`${AUTH_BASE}/token?grant_type=password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', apikey: CONFIG.SUPABASE_ANON_KEY },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error_description || data.msg || 'Login failed');

      saveSession({ access_token: data.access_token, user: data.user });
      showApp();
    }
  } catch (err) {
    setAuthMessage(err.message);
  } finally {
    btnAuthSubmit.disabled = false;
  }
});

btnLogout.addEventListener('click', () => {
  clearSession();
  showAuth();
});

// ---------- View switching ----------
function showAuth() {
  viewAuth.classList.remove('hidden');
  viewApp.classList.add('hidden');
}

function showApp() {
  viewAuth.classList.add('hidden');
  viewApp.classList.remove('hidden');
  refreshWebsiteList();
  refreshCredits();
}

async function refreshCredits() {
  try {
    const res = await fetch(`${REST_BASE}/profiles?select=credits_remaining,plan`, {
      headers: { ...authHeaders(), Accept: 'application/vnd.pgrst.object+json' },
    });
    const profile = await res.json();
    if (!res.ok) return;
    creditsBadge.textContent =
      profile.plan === 'pro' ? 'Pro plan' : `${profile.credits_remaining} credits left`;
  } catch {
    // non-critical
  }
}

// ---------- Analyze website ----------
btnAnalyze.addEventListener('click', async () => {
  const url = inputUrl.value.trim();
  if (!url) return setAppMessage('Enter a website URL first.');

  setAppMessage('');
  btnAnalyze.disabled = true;
  btnAnalyze.textContent = 'Analyzing…';
  try {
    const res = await fetch(`${FUNCTIONS_BASE}/analyze-website`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        url,
        language: inputLanguage.value.trim() || undefined,
        location: inputLocation.value.trim() || undefined,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Analysis failed');

    setAppMessage(`Done — "${data.niche}", ${data.keywords.length} keywords generated.`, false);
    inputUrl.value = '';
    currentWebsiteId = data.website.id;
    await refreshWebsiteList(currentWebsiteId);
    await loadReport(currentWebsiteId);
    await refreshCredits();
  } catch (err) {
    setAppMessage(err.message);
  } finally {
    btnAnalyze.disabled = false;
    btnAnalyze.textContent = 'Analyze website';
  }
});

// ---------- Website list (sidebar) ----------
async function refreshWebsiteList(selectId) {
  try {
    const res = await fetch(
      `${REST_BASE}/websites?select=id,url,niche,last_crawled_at&order=created_at.desc`,
      { headers: authHeaders() }
    );
    const websites = await res.json();
    if (!res.ok) throw new Error(websites.message || 'Failed to load websites');

    siteList.innerHTML = '';
    websites.forEach((w) => {
      const li = document.createElement('li');
      li.className = 'site-item';
      li.dataset.id = w.id;
      if (w.id === (selectId || currentWebsiteId)) li.classList.add('active');

      const niche = w.niche || 'No keywords yet';
      li.innerHTML = `
        <span class="site-item-url">${escapeHtml(w.url)}</span>
        <span class="site-item-niche">${escapeHtml(niche)}</span>
      `;
      li.addEventListener('click', () => {
        document.querySelectorAll('.site-item').forEach((el) => el.classList.remove('active'));
        li.classList.add('active');
        loadReport(w.id);
      });
      siteList.appendChild(li);
    });

    if (websites.length === 0) {
      siteList.innerHTML = '<li style="padding:10px 11px;font-size:12.5px;color:rgba(255,255,255,0.45);">No websites yet — analyze one above.</li>';
    }
  } catch (err) {
    setAppMessage(err.message);
  }
}
btnRefreshWebsites.addEventListener('click', () => refreshWebsiteList());

// ---------- Report ----------
async function loadReport(websiteId) {
  setAppMessage('');
  showLoading(true);
  recPanel.classList.add('hidden');
  try {
    const res = await fetch(`${FUNCTIONS_BASE}/report?website_id=${websiteId}`, {
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load report');

    currentWebsiteId = websiteId;
    currentKeywords = data.keywords;
    renderReport(data);
  } catch (err) {
    setAppMessage(err.message);
  } finally {
    showLoading(false);
  }
}

function renderReport(data) {
  emptyState.classList.add('hidden');
  reportView.classList.remove('hidden');

  reportTitle.textContent = data.website.url;
  reportNiche.textContent = data.website.niche ? data.website.niche : '';
  statTotal.textContent = data.total_keywords;
  statRanking.textContent = data.ranking_keywords;
  statNotRanking.textContent = data.not_ranking_keywords;
  statBest.textContent = data.best_position ?? '–';
  statAvg.textContent = data.average_position ?? '–';

  keywordsTbody.innerHTML = '';
  data.keywords.forEach((row) => {
    const tr = document.createElement('tr');
    const posText = row.position ? `#${row.position}` : 'Not ranking';
    const posClass = row.position ? 'pos-good' : 'pos-bad';

    tr.innerHTML = `
      <td>${escapeHtml(row.keyword)}</td>
      <td class="kw-type">${escapeHtml(row.type)}</td>
      <td class="${posClass}">${posText}</td>
      <td><button class="mini-btn" data-keyword="${escapeHtml(row.keyword)}">Why?</button></td>
    `;
    keywordsTbody.appendChild(tr);
  });

  keywordsTbody.querySelectorAll('.mini-btn').forEach((btn) => {
    btn.addEventListener('click', () => loadRecommendation(btn.dataset.keyword));
  });
}

// ---------- Rank check ----------
btnRankCheck.addEventListener('click', async () => {
  if (!currentWebsiteId) return;
  setAppMessage('Checking rankings — this can take a minute for many keywords…', false);
  btnRankCheck.disabled = true;
  btnRankCheck.textContent = 'Checking…';
  try {
    const res = await fetch(`${FUNCTIONS_BASE}/rank-check?website_id=${currentWebsiteId}`, {
      method: 'POST',
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Rank check failed');

    setAppMessage('Rank check complete.', false);
    await loadReport(currentWebsiteId);
  } catch (err) {
    setAppMessage(err.message);
  } finally {
    btnRankCheck.disabled = false;
    btnRankCheck.textContent = 'Check rankings';
  }
});

// ---------- AI recommendation ----------
async function loadRecommendation(keywordText) {
  const keywordRow = currentKeywords.find((k) => k.keyword === keywordText);
  if (!keywordRow) return;

  showLoading(true);
  try {
    const kwRes = await fetch(
      `${REST_BASE}/keywords?website_id=eq.${currentWebsiteId}&keyword=eq.${encodeURIComponent(keywordText)}&select=id`,
      { headers: authHeaders() }
    );
    const kwData = await kwRes.json();
    if (!kwRes.ok || !kwData[0]) throw new Error('Could not find keyword record');
    const keywordId = kwData[0].id;

    const res = await fetch(
      `${FUNCTIONS_BASE}/recommendations?website_id=${currentWebsiteId}&keyword_id=${keywordId}`,
      { method: 'POST', headers: authHeaders() }
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to generate recommendation');

    recPanel.classList.remove('hidden');
    recommendationKeyword.textContent = `"${keywordText}"`;
    recReason.textContent = data.reason_not_ranking;
    recSuggestions.textContent = data.content_suggestions;
    recGaps.textContent = data.competitor_gaps;
  } catch (err) {
    setAppMessage(err.message);
  } finally {
    showLoading(false);
    reportView.classList.remove('hidden');
  }
}

btnCloseRecommendation.addEventListener('click', () => {
  recPanel.classList.add('hidden');
});

// ---------- Boot ----------
(function init() {
  loadSession();
  if (session?.access_token) {
    showApp();
  } else {
    showAuth();
  }
})();
