// ============================================================
// app.js — dashboard logic (no build step needed)
// Talks to the SAME Supabase project + Edge Functions as the
// Chrome extension (analyze-website, rank-check, recommendations,
// report, rank-history, gsc-oauth-start, gsc-data).
// ============================================================

const FUNCTIONS_BASE = `${CONFIG.SUPABASE_URL}/functions/v1`;
const REST_BASE = `${CONFIG.SUPABASE_URL}/rest/v1`;
const AUTH_BASE = `${CONFIG.SUPABASE_URL}/auth/v1`;
const SESSION_KEY = 'rankinsight_session';
const THEME_KEY = 'rankinsight_theme';

let session = null;
let currentWebsiteId = null;
let currentKeywords = [];
let allWebsites = []; // cached for sidebar search/filter
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

const btnThemeToggle = document.getElementById('btn-theme-toggle');
const btnLogout = document.getElementById('btn-logout');
const creditsBadge = document.getElementById('credits-badge');
const inputUrl = document.getElementById('input-url');
const inputLanguage = document.getElementById('input-language');
const inputLocation = document.getElementById('input-location');
const btnAnalyze = document.getElementById('btn-analyze');
const btnRefreshWebsites = document.getElementById('btn-refresh-websites');
const inputSiteSearch = document.getElementById('input-site-search');
const siteList = document.getElementById('site-list');
const siteListEmpty = document.getElementById('site-list-empty');
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

const historyHint = document.getElementById('history-hint');
const historyEmpty = document.getElementById('history-empty');
const historyChart = document.getElementById('history-chart');

const btnGscConnect = document.getElementById('btn-gsc-connect');
const gscStatus = document.getElementById('gsc-status');
const gscTableWrap = document.getElementById('gsc-table-wrap');
const gscTbody = document.getElementById('gsc-tbody');

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

// Uses the stored refresh_token to get a fresh access_token from Supabase.
// Supabase access tokens expire after 1 hour — this keeps the user logged
// in without them noticing, instead of every request failing with
// "JWT expired" once the hour is up.
async function refreshAccessToken() {
  if (!session?.refresh_token) return false;
  try {
    const res = await fetch(`${AUTH_BASE}/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: CONFIG.SUPABASE_ANON_KEY },
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    });
    const data = await res.json();
    if (!res.ok || !data.access_token) return false;
    saveSession({
      access_token: data.access_token,
      refresh_token: data.refresh_token || session.refresh_token,
      user: data.user || session.user,
    });
    return true;
  } catch {
    return false;
  }
}

// Drop-in replacement for fetch() on any authenticated call. If the token
// has expired, it silently refreshes and retries once. If the refresh
// token itself is invalid/expired (e.g. user hasn't opened the app in
// weeks), it logs the user out with a clear message instead of leaving
// them stuck looking at cryptic "JWT expired" errors.
async function apiFetch(url, options = {}) {
  const headers = options.headers || authHeaders();
  let res = await fetch(url, { ...options, headers });

  const looksExpired =
    res.status === 401 ||
    (res.status === 403 &&
      (await res
        .clone()
        .json()
        .catch(() => ({})))?.message?.toLowerCase()
        .includes('jwt'));

  if (looksExpired) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      clearSession();
      showAuth();
      setAuthMessage('Your session expired. Please log in again.', true);
      throw new Error('Session expired');
    }
    res = await fetch(url, { ...options, headers: options.headers ? options.headers : authHeaders() });
  }

  return res;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ---------- Theme (dark mode) ----------
function applyTheme(theme) {
  document.body.dataset.theme = theme;
  btnThemeToggle.textContent = theme === 'dark' ? '☀' : '☾';
  localStorage.setItem(THEME_KEY, theme);
}

function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
}

btnThemeToggle.addEventListener('click', () => {
  const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  // Re-render the chart so its stroke color matches the new theme.
  if (currentWebsiteId && !reportView.classList.contains('hidden')) loadHistory(currentWebsiteId);
});

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
        saveSession({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user });
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

      saveSession({ access_token: data.access_token, refresh_token: data.refresh_token, user: data.user });
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
  refreshWebsiteList().then(() => handleGscRedirectParam());
  refreshCredits();
}

const btnUpgrade = document.getElementById('btn-upgrade');
const upgradeMessage = document.getElementById('upgrade-message');

async function refreshCredits() {
  try {
    const res = await apiFetch(`${REST_BASE}/profiles?select=credits_remaining,rank_check_credits_remaining,plan,plan_expires_at`, {
      headers: { ...authHeaders(), Accept: 'application/vnd.pgrst.object+json' },
    });
    const profile = await res.json();
    if (!res.ok) return;

    if (profile.plan === 'pro') {
      const renews = profile.plan_expires_at
        ? new Date(profile.plan_expires_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
        : '';
      creditsBadge.textContent = `Pro plan${renews ? ' — renews ' + renews : ''}`;
      btnUpgrade.classList.add('hidden');
    } else {
      creditsBadge.textContent = `${profile.credits_remaining} analyses · ${profile.rank_check_credits_remaining} rank checks left`;
      btnUpgrade.classList.remove('hidden');
    }
  } catch {
    // non-critical
  }
}

// ---------- Upgrade to Pro (Razorpay) ----------
btnUpgrade.addEventListener('click', async () => {
  upgradeMessage.textContent = '';
  btnUpgrade.disabled = true;
  btnUpgrade.textContent = 'Starting checkout…';
  try {
    const res = await apiFetch(`${FUNCTIONS_BASE}/create-order`, {
      method: 'POST',
      headers: authHeaders(),
    });
    const order = await res.json();
    if (!res.ok) throw new Error(order.error || 'Could not start checkout.');

    const rzp = new Razorpay({
      key: order.key_id,
      amount: order.amount,
      currency: order.currency,
      name: 'RankInsight',
      description: 'Pro plan — 1 month',
      order_id: order.order_id,
      handler: async (response) => {
        upgradeMessage.textContent = '';
        btnUpgrade.textContent = 'Confirming payment…';
        try {
          const verifyRes = await apiFetch(`${FUNCTIONS_BASE}/verify-payment`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
            }),
          });
          const verifyData = await verifyRes.json();
          if (!verifyRes.ok) throw new Error(verifyData.error || 'Payment verification failed.');
          upgradeMessage.style.color = 'var(--good)';
          upgradeMessage.textContent = "You're now on Pro! 🎉";
          await refreshCredits();
        } catch (err) {
          upgradeMessage.style.color = '';
          upgradeMessage.textContent = err.message;
        } finally {
          btnUpgrade.disabled = false;
          btnUpgrade.textContent = '⚡ Upgrade to Pro — ₹199/mo';
        }
      },
      modal: {
        ondismiss: () => {
          btnUpgrade.disabled = false;
          btnUpgrade.textContent = '⚡ Upgrade to Pro — ₹199/mo';
        },
      },
      theme: { color: '#4338CA' },
    });
    rzp.open();
  } catch (err) {
    upgradeMessage.textContent = err.message;
    btnUpgrade.disabled = false;
    btnUpgrade.textContent = '⚡ Upgrade to Pro — ₹199/mo';
  }
});

// ---------- Analyze website ----------
btnAnalyze.addEventListener('click', async () => {
  const url = inputUrl.value.trim();
  if (!url) return setAppMessage('Enter a website URL first.');

  setAppMessage('');
  btnAnalyze.disabled = true;
  btnAnalyze.textContent = 'Analyzing…';
  try {
    const res = await apiFetch(`${FUNCTIONS_BASE}/analyze-website`, {
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
    const res = await apiFetch(
      `${REST_BASE}/websites?select=id,url,niche,last_crawled_at&order=created_at.desc`,
      { headers: authHeaders() }
    );
    const websites = await res.json();
    if (!res.ok) throw new Error(websites.message || 'Failed to load websites');

    allWebsites = websites;
    renderSiteList(selectId);
  } catch (err) {
    setAppMessage(err.message);
  }
}
btnRefreshWebsites.addEventListener('click', () => refreshWebsiteList());

function renderSiteList(selectId) {
  const query = inputSiteSearch.value.trim().toLowerCase();
  const filtered = query
    ? allWebsites.filter(
        (w) => w.url.toLowerCase().includes(query) || (w.niche || '').toLowerCase().includes(query)
      )
    : allWebsites;

  siteList.innerHTML = '';
  siteListEmpty.classList.toggle('hidden', filtered.length > 0 || allWebsites.length === 0);

  if (allWebsites.length === 0) {
    siteList.innerHTML = '<li style="padding:10px 11px;font-size:12.5px;color:rgba(255,255,255,0.45);">No websites yet — analyze one above.</li>';
    return;
  }

  filtered.forEach((w) => {
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
}

inputSiteSearch.addEventListener('input', () => renderSiteList());

// ---------- Report ----------
async function loadReport(websiteId) {
  setAppMessage('');
  showLoading(true);
  recPanel.classList.add('hidden');
  try {
    const res = await apiFetch(`${FUNCTIONS_BASE}/report?website_id=${websiteId}`, {
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load report');

    currentWebsiteId = websiteId;
    currentKeywords = data.keywords;
    renderReport(data);
    loadHistory(websiteId);
    loadGscData(websiteId);
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
    const res = await apiFetch(`${FUNCTIONS_BASE}/rank-check?website_id=${currentWebsiteId}`, {
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

// ---------- Rank history (trend chart) ----------
async function loadHistory(websiteId) {
  historyChart.classList.add('hidden');
  historyEmpty.classList.remove('hidden');
  historyHint.textContent = '';
  historyChart.innerHTML = '';

  try {
    const res = await apiFetch(`${FUNCTIONS_BASE}/rank-history?website_id=${websiteId}`, {
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load history');

    const trend = (data.trend || []).filter((p) => p.avg_position !== null);
    if (trend.length < 2) return; // keep the empty-state hint

    renderHistoryChart(trend);
    historyEmpty.classList.add('hidden');
    historyChart.classList.remove('hidden');
    historyHint.textContent = `${trend.length} checks tracked`;
  } catch {
    // Non-critical — chart just stays in its empty state.
  }
}

function renderHistoryChart(trend) {
  const W = 640, H = 160, PAD = 24;
  const positions = trend.map((p) => p.avg_position);
  const maxPos = Math.max(...positions);
  const minPos = Math.min(...positions);
  // Position 1 is "best" so the axis is inverted: low position = high on chart.
  const yRange = Math.max(maxPos - minPos, 1);

  const xStep = trend.length > 1 ? (W - PAD * 2) / (trend.length - 1) : 0;
  const points = trend.map((p, i) => {
    const x = PAD + i * xStep;
    const y = PAD + ((p.avg_position - minPos) / yRange) * (H - PAD * 2);
    return { x, y, date: p.date, value: p.avg_position };
  });

  const linePath = points.map((pt, i) => `${i === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ');
  const areaPath = `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${H - PAD} L ${points[0].x.toFixed(1)} ${H - PAD} Z`;

  const dots = points
    .map(
      (pt) =>
        `<circle class="history-dot" cx="${pt.x.toFixed(1)}" cy="${pt.y.toFixed(1)}" r="3.5"><title>${pt.date}: avg #${pt.value}</title></circle>`
    )
    .join('');

  const firstLabel = `<text class="history-axis-label" x="${points[0].x}" y="${H - 6}">${points[0].date}</text>`;
  const lastLabel = `<text class="history-axis-label" x="${points[points.length - 1].x}" y="${H - 6}" text-anchor="end">${points[points.length - 1].date}</text>`;

  historyChart.innerHTML = `
    <path class="history-area" d="${areaPath}"></path>
    <path class="history-line" d="${linePath}"></path>
    ${dots}
    ${firstLabel}
    ${lastLabel}
  `;
}

// ---------- Google Search Console ----------
function gscRedirectUrl() {
  // Bounce back to exactly this page (without stray query params from a
  // previous run) so the OAuth callback can send the user right back here.
  const u = new URL(window.location.href);
  u.search = '';
  return u.toString();
}

btnGscConnect.addEventListener('click', async () => {
  if (!currentWebsiteId) return;
  btnGscConnect.disabled = true;
  try {
    const res = await apiFetch(
      `${FUNCTIONS_BASE}/gsc-oauth-start?website_id=${currentWebsiteId}&redirect=${encodeURIComponent(gscRedirectUrl())}`,
      { headers: authHeaders() }
    );
    const data = await res.json();
    if (!res.ok || !data.url) throw new Error(data.error || 'Could not start Search Console connection');
    window.location.href = data.url; // hands off to Google's consent screen
  } catch (err) {
    setAppMessage(err.message);
    btnGscConnect.disabled = false;
  }
});

async function loadGscData(websiteId) {
  gscTableWrap.classList.add('hidden');
  gscTbody.innerHTML = '';
  gscStatus.textContent = 'Loading…';
  btnGscConnect.classList.remove('hidden');
  btnGscConnect.textContent = 'Connect Search Console';

  try {
    const res = await apiFetch(`${FUNCTIONS_BASE}/gsc-data?website_id=${websiteId}`, {
      headers: authHeaders(),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to load Search Console data');

    if (!data.connected) {
      gscStatus.textContent = 'Not connected — connect to see real clicks, impressions and average position from Google.';
      return;
    }

    btnGscConnect.textContent = 'Reconnect';
    gscStatus.textContent = `${data.property_url} · ${data.period.start} to ${data.period.end}`;

    if (!data.rows || data.rows.length === 0) {
      gscStatus.textContent += ' · No query data yet for this period.';
      return;
    }

    data.rows.forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${escapeHtml(row.query)}</td>
        <td>${row.clicks}</td>
        <td>${row.impressions}</td>
        <td>${row.ctr}%</td>
        <td>${row.position}</td>
      `;
      gscTbody.appendChild(tr);
    });
    gscTableWrap.classList.remove('hidden');
  } catch (err) {
    gscStatus.textContent = err.message;
  }
}

// Handles the ?gsc=connected / ?gsc=denied / ?gsc=error / ?gsc=no_property
// param that gsc-oauth-callback appends when it redirects back here.
function handleGscRedirectParam() {
  const params = new URLSearchParams(window.location.search);
  const status = params.get('gsc');
  if (!status) return;

  const messages = {
    connected: ['Search Console connected.', false],
    denied: ['Search Console connection was cancelled.', true],
    no_property: ["Connected, but no verified property matched this website's domain in your Search Console account.", true],
    error: ['Search Console connection failed — please try again.', true],
  };
  const [text, isError] = messages[status] || ['', false];
  if (text) setAppMessage(text, isError);

  // Clean the URL so refreshing doesn't re-trigger this message.
  const clean = new URL(window.location.href);
  clean.search = '';
  window.history.replaceState({}, '', clean.toString());

  if (status === 'connected' && currentWebsiteId) loadGscData(currentWebsiteId);
}

// ---------- AI recommendation ----------
async function loadRecommendation(keywordText) {
  const keywordRow = currentKeywords.find((k) => k.keyword === keywordText);
  if (!keywordRow) return;

  showLoading(true);
  try {
    const kwRes = await apiFetch(
      `${REST_BASE}/keywords?website_id=eq.${currentWebsiteId}&keyword=eq.${encodeURIComponent(keywordText)}&select=id`,
      { headers: authHeaders() }
    );
    const kwData = await kwRes.json();
    if (!kwRes.ok || !kwData[0]) throw new Error('Could not find keyword record');
    const keywordId = kwData[0].id;

    const res = await apiFetch(
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
  initTheme();
  loadSession();
  if (session?.access_token) {
    showApp();
  } else {
    showAuth();
  }
})();
