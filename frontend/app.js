'use strict';
/**
 * app.js — Abdullah AI Video Studio frontend (dependency-free, no build step).
 *
 * Talks to the backend REST API (/api/*). The backend URL comes from
 * localStorage ('aivs-backend-url') or defaults to the same origin, so
 * when this site is served BY the backend it just works with no setup.
 *
 * NO API key field exists anywhere in this app — keys live only in the
 * server .env file. Demo Mode returns a storyboard plan, never a video,
 * and the UI says so everywhere a download appears.
 */

const LS_KEY = 'aivs-backend-url';

/* ---------- small helpers ---------- */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
}

function backendUrl() {
  const stored = (localStorage.getItem(LS_KEY) || '').trim();
  if (stored) return stored.replace(/\/+$/, '');
  return window.location.origin;
}

function saveBackendUrl(url) {
  const clean = (url || '').trim().replace(/\/+$/, '');
  if (!clean || clean === window.location.origin) {
    localStorage.removeItem(LS_KEY);
  } else {
    localStorage.setItem(LS_KEY, clean);
  }
}

/**
 * JSON API call. Throws a plain-language Error on network failure or
 * on any non-2xx response (uses the backend's own error message).
 */
async function api(path, options = {}) {
  const { isForm, ...rest } = options;
  const headers = {};
  if (!isForm) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(backendUrl() + path, { ...rest, headers: { ...headers, ...(rest.headers || {}) } });
  } catch (e) {
    throw new Error('Backend se connect nahi ho raha. Backend URL check karein ya backend on karein. (' + e.message + ')');
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { data = null; }
  if (!res.ok) {
    throw new Error((data && (data.error || data.message)) || ('Server error: HTTP ' + res.status));
  }
  return data;
}

/* ---------- tabs ---------- */
function showTab(name) {
  $$('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  $$('.panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'projects') loadProjects();
  if (name === 'history') loadHistory();
  if (name === 'characters') loadCharacters();
  if (name === 'settings') loadSettingsTab();
  if (name === 'create') loadCharacterOptions();
  window.scrollTo(0, 0);
}

/* ---------- segmented controls ---------- */
function setupSeg(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener('click', (e) => {
    const btn = e.target.closest('.seg-btn');
    if (!btn) return;
    el.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
  });
}
function segValue(id) {
  const b = document.querySelector('#' + id + ' .seg-btn.active');
  return b ? b.dataset.value : null;
}

/* ---------- health / demo badge ---------- */
async function refreshHealth() {
  const badge = $('#demoBadge');
  const banner = $('#demoBanner');
  const homeHealth = $('#homeHealth');
  try {
    const h = await api('/api/health');
    if (h.demoMode) {
      badge.textContent = 'Demo Mode';
      badge.className = 'badge badge-demo';
      banner.className = 'banner banner-demo';
    } else {
      badge.textContent = 'LIVE — ' + (h.configuredProvider || 'provider');
      badge.className = 'badge badge-live';
      banner.className = 'banner banner-live';
      banner.innerHTML = '<strong>Live Mode.</strong> Provider connected hai (' + esc(h.configuredProvider || '') + '). Generate se asli AI video banegi aur paise kharch honge — pehle qeemat zaroor dekhein.';
    }
    homeHealth.textContent =
      'Version ' + h.version + ' — FFmpeg: ' + (h.ffmpegAvailable ? 'Yes' : 'No') +
      ' — Provider: ' + (h.configuredProvider || 'koi nahi (Demo Mode)') +
      ' — Demo Mode: ' + (h.demoMode ? 'ON' : 'OFF');
    return h;
  } catch (e) {
    badge.textContent = 'No connection';
    badge.className = 'badge badge-error';
    homeHealth.textContent = 'Backend se connect nahi ho raha: ' + e.message;
    return null;
  }
}

/* ---------- estimate ---------- */
function estimateTableHtml(est) {
  const byKey = {};
  (est.breakdown || []).forEach((r) => { byKey[r.durationSeconds + '|' + r.quality] = r; });
  const quals = ['720p', '1080p', '4K', '360p'];
  const cell = (seconds, q) => {
    const r = byKey[seconds + '|' + q];
    if (!r || r.videoCostUsd == null) return '—';
    return '$' + r.videoCostUsd + '<br><span class="muted">PKR ' + r.videoCostPkr + '</span>';
  };
  let html = '<h2>Qeemat (verified rates)</h2>';
  html += '<p>Is video ki qeemat: <strong>$' + est.videoCostUsd + ' (PKR ' + est.videoCostPkr + ')</strong> — ' +
    esc(est.durationSeconds) + ' second, ' + esc(est.quality) + '.</p>';
  html += '<table><thead><tr><th>Video</th>' + quals.map((q) => '<th class="num">' + q + '</th>').join('') + '</tr></thead><tbody>';
  [8, 60].forEach((s) => {
    html += '<tr><td>' + (s === 8 ? '8s test clip' : '60s video') + '</td>' +
      quals.map((q) => '<td class="num">' + cell(s, q) + '</td>').join('') + '</tr>';
  });
  html += '</tbody></table>';
  html += '<p class="muted">Model: <code>' + esc(est.model || '') + '</code> — verified from ' +
    '<a href="' + esc(est.verifiedFrom || '') + '" target="_blank" rel="noopener">official pricing page</a>' +
    ' (' + esc(est.verifiedAt || '') + '). Kharch se pehle rate dobara check karein. PKR taqreeban hai (280 PKR/USD).</p>';
  if (est.previousGeneration) {
    html += '<p class="muted">Previous generation ' + esc(est.previousGeneration.model) +
      ' mehengi hai (8s 720p $' + est.previousGeneration.cost8s720pUsd +
      ', 60s 720p $' + est.previousGeneration.cost60s720pUsd + ') — use na karein. ' +
      esc(est.previousGeneration.note || '') + '</p>';
  }
  if (est.ttsNote) html += '<p class="muted">' + esc(est.ttsNote) + '</p>';
  if (est.modelNote) {
    html += '<details><summary>Model ke baare mein (1.1 vs 1.2)</summary><p class="muted">' + esc(est.modelNote) + '</p></details>';
  }
  return html;
}

async function showEstimate() {
  const box = $('#estimateBox');
  box.classList.remove('hidden');
  box.innerHTML = '<p class="muted">Qeemat load ho rahi hai…</p>';
  try {
    const est = await api(
      '/api/estimate?provider=omni&quality=' + encodeURIComponent(segValue('qualitySeg')) +
      '&durationSeconds=' + encodeURIComponent(segValue('durationSeg'))
    );
    box.innerHTML = estimateTableHtml(est);
  } catch (e) {
    box.innerHTML = '<p class="error">Qeemat nahi mili: ' + esc(e.message) + '</p>';
  }
}

/* ---------- storyboard rendering ---------- */
function voiceLabel(v) {
  if (!v) return '';
  if (typeof v === 'string') return v;
  const parts = [];
  if (v.voiceName) parts.push(v.voiceName);
  if (v.voiceId) parts.push(v.voiceId);
  if (v.voiceProvider) parts.push(v.voiceProvider);
  return parts.join(' · ');
}

function sceneHtml(scene) {
  let html = '<div class="scene"><h3>Scene ' + (scene.index + 1) +
    ' (' + scene.startSec + 's–' + scene.endSec + 's, ' + scene.durationSec + 's)</h3>';
  html += '<p><strong>Setting:</strong> ' + esc(scene.setting) + '</p>';
  html += '<p><strong>Action:</strong> ' + esc(scene.action) + '</p>';
  html += '<p class="meta">Camera: ' + esc(scene.cameraMovement) +
    ' · Transition: ' + esc(scene.transition) + '</p>';
  html += '<p><strong>Narration:</strong> ' + esc(scene.narration) +
    ' <span class="muted">(' + scene.narrationStartSec + 's–' + scene.narrationEndSec + 's' +
    (voiceLabel(scene.narrationVoice) ? ', voice: ' + esc(voiceLabel(scene.narrationVoice)) : '') + ')</span></p>';
  (scene.dialogue || []).forEach((d) => {
    html += '<div class="dialogue-line"><span class="who">' + esc(d.character) + ':</span> ' +
      esc(d.line) + '<br><span class="voice">' + d.startSec + 's–' + d.endSec + 's' +
      (d.voiceId ? ' · voice: ' + esc(d.voiceId) + (d.voiceProvider ? ' (' + esc(d.voiceProvider) + ')' : '') : '') +
      '</span></div>';
  });
  html += '<details><summary>Video prompt dekhein</summary><pre>' + esc(scene.videoPrompt) + '</pre></details>';
  html += '</div>';
  return html;
}

function storyboardHtml(sb, project) {
  let html = '<div class="card"><h2>' + esc(sb.title) + '</h2>';
  html += '<p class="muted">' + esc(sb.logline || '') + '</p>';
  html += '<p class="meta">' + esc(sb.mode) + ' · ' + esc(sb.durationSeconds) + 's · ' +
    esc(sb.aspect) + ' · ' + esc(sb.quality) + ' · ' + esc(sb.language) + ' · total ' + esc(sb.totalSeconds) + 's</p>';
  html += '<h3>Character Lock</h3><div class="lock-box">' + esc(sb.characterLock) + '</div>';
  if (sb.keywords && sb.keywords.length) {
    html += '<p class="muted">Keywords: ' + esc(sb.keywords.join(', ')) + '</p>';
  }
  html += '</div>';
  (sb.scenes || []).forEach((s) => { html += sceneHtml(s); });
  const dlUrl = backendUrl() + '/api/projects/' + encodeURIComponent(project.id) + '/download';
  if (project.demo) {
    html += '<div class="card"><p><strong>Ye Demo Mode ka project hai.</strong> ' +
      'Asli video nahi bani — sirf storyboard plan hai.</p>' +
      '<p><a class="btn btn-primary" href="' + esc(dlUrl) + '">Download demo plan — NOT a video</a></p>' +
      '<p class="muted">Ye file aik plan hai (Markdown), video nahi hai. Asli MP4 ke liye provider key chahiye (approval ke baad).</p></div>';
  } else if (project.hasOutput) {
    html += '<div class="card"><p><strong>Video tayyar hai!</strong></p>' +
      '<p><a class="btn btn-primary" href="' + esc(dlUrl) + '">Download MP4</a></p>' +
      '<p class="muted">Download karte hi file aap ke phone ke Downloads folder mein save ho jayegi. ' +
      (project.upscaled4K ? '4K upscale hai (native 4K nahi).' : '') + '</p></div>';
  } else {
    html += '<div class="card"><p class="muted">Download abhi tayyar nahi hai.</p></div>';
  }
  return html;
}

/* ---------- generate + poll ---------- */
let pollTimer = null;

function setJobBox(statusText, progress, stepText) {
  $('#jobBox').classList.remove('hidden');
  $('#jobStatusText').textContent = statusText;
  $('#jobProgressBar').style.width = Math.max(0, Math.min(100, progress || 0)) + '%';
  $('#jobStepText').textContent = stepText || '—';
}

function showCreateError(msg) {
  const el = $('#createError');
  el.classList.remove('hidden');
  el.textContent = msg;
}
function hideCreateError() {
  $('#createError').classList.add('hidden');
  $('#createError').textContent = '';
}

async function showResult(projectId) {
  const box = $('#resultBox');
  box.classList.remove('hidden');
  box.innerHTML = '<div class="card"><p class="muted">Storyboard load ho raha hai…</p></div>';
  try {
    const [sbRes, projRes] = await Promise.all([
      api('/api/projects/' + encodeURIComponent(projectId) + '/storyboard'),
      api('/api/projects/' + encodeURIComponent(projectId)),
    ]);
    box.innerHTML = storyboardHtml(sbRes.storyboard, projRes.project);
  } catch (e) {
    box.innerHTML = '<div class="card"><p class="error">Storyboard nahi mila: ' + esc(e.message) + '</p></div>';
  }
}

function pollJob(jobId, projectId) {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const r = await api('/api/jobs/' + encodeURIComponent(jobId));
      const job = r.job;
      setJobBox('Status: ' + job.status, job.progress || 0, job.currentStep || '');
      if (job.status === 'demo_complete' || job.status === 'complete') {
        clearInterval(pollTimer);
        pollTimer = null;
        setJobBox('Complete: ' + job.status, 100, job.currentStep || 'Tayyar hai');
        await showResult(projectId);
        loadProjects();
        loadHistory();
      } else if (job.status === 'failed') {
        clearInterval(pollTimer);
        pollTimer = null;
        showCreateError('Job fail ho gaya: ' + (job.error || 'koi wajah nahi mili'));
      }
    } catch (e) {
      clearInterval(pollTimer);
      pollTimer = null;
      showCreateError('Job status nahi mili: ' + e.message);
    }
  }, 3000);
}

async function generate() {
  hideCreateError();
  const prompt = $('#promptInput').value.trim();
  if (prompt.length < 3) {
    showCreateError('Kahani ka prompt kam az kam 3 characters ka hona chahiye.');
    return;
  }
  const btn = $('#generateBtn');
  btn.disabled = true;
  $('#resultBox').classList.add('hidden');
  $('#resultBox').innerHTML = '';
  setJobBox('Job start ho raha hai…', 0, '');
  const characterId = $('#characterSelect').value || null;
  const body = {
    prompt,
    mode: segValue('modeSeg'),
    durationSeconds: Number(segValue('durationSeg')),
    aspect: segValue('aspectSeg'),
    quality: segValue('qualitySeg'),
    language: segValue('languageSeg'),
    voiceover: $('#voiceoverToggle').checked,
    music: $('#musicToggle').checked,
    characterId,
  };
  try {
    const res = await api('/api/generate', { method: 'POST', body: JSON.stringify(body) });
    if (res.demo) {
      setJobBox('Demo Mode — storyboard plan ban raha hai…', 5, res.message || '');
    } else {
      setJobBox('Job queued — provider: ' + (res.estimate ? 'Omni' : ''), 5, res.message || '');
    }
    pollJob(res.jobId, res.projectId);
  } catch (e) {
    showCreateError('Generate nahi hua: ' + e.message);
    $('#jobBox').classList.add('hidden');
  } finally {
    btn.disabled = false;
  }
}

/* ---------- projects ---------- */
function statusPill(status) {
  return '<span class="status-pill status-' + esc(status) + '">' + esc(status) + '</span>';
}

async function loadProjects() {
  const list = $('#projectsList');
  try {
    const res = await api('/api/projects?limit=50');
    const projects = res.projects || [];
    if (!projects.length) {
      list.innerHTML = '<p class="muted">Abhi koi project nahi hai. Create tab se pehla video banayein.</p>';
      return;
    }
    list.innerHTML = projects.map((p) => (
      '<div class="list-item"><h3>' + esc(p.title) + '</h3>' +
      '<p class="meta">' + esc(p.mode) + ' · ' + esc(p.durationSeconds) + 's · ' + esc(p.aspect) +
      ' · ' + esc(p.quality) + ' · ' + esc(p.language) + ' · ' + fmtDate(p.createdAt) + '</p>' +
      '<p>' + statusPill(p.status) + ' ' + (p.demo ? '<span class="status-pill">Demo — NOT a video</span>' : '<span class="status-pill">Real video</span>') + '</p>' +
      '<p><button type="button" class="btn btn-secondary" data-open-project="' + esc(p.id) + '">Kholein</button></p></div>'
    )).join('');
    list.querySelectorAll('[data-open-project]').forEach((b) => {
      b.addEventListener('click', () => loadProjectDetail(b.getAttribute('data-open-project')));
    });
  } catch (e) {
    list.innerHTML = '<p class="error">Projects nahi mile: ' + esc(e.message) + '</p>';
  }
}

async function loadProjectDetail(id) {
  const detail = $('#projectDetail');
  detail.classList.remove('hidden');
  detail.innerHTML = '<div class="card"><p class="muted">Project load ho raha hai…</p></div>';
  try {
    const [sbRes, projRes] = await Promise.all([
      api('/api/projects/' + encodeURIComponent(id) + '/storyboard'),
      api('/api/projects/' + encodeURIComponent(id)),
    ]);
    const p = projRes.project;
    let html = '<div class="card"><h2>' + esc(p.title) + '</h2>' +
      '<p class="meta">' + esc(p.prompt) + '</p>' +
      '<p>' + statusPill(p.status) + ' ' + (p.demo ? '<span class="status-pill">Demo — NOT a video</span>' : '') + '</p>' +
      '<p class="muted">' + esc(p.mode) + ' · ' + esc(p.durationSeconds) + 's · ' + esc(p.aspect) +
      ' · ' + esc(p.quality) + ' · ' + esc(p.language) + ' · ' + fmtDate(p.createdAt) + '</p>' +
      (p.error ? '<p class="error">Error: ' + esc(p.error) + '</p>' : '') +
      '<div class="actions">' +
      '<a class="btn btn-primary" href="' + esc(backendUrl() + '/api/projects/' + encodeURIComponent(p.id) + '/download') + '">' +
      (p.demo ? 'Download demo plan — NOT a video' : 'Download MP4') + '</a>' +
      '<button type="button" class="btn btn-danger" id="deleteProjectBtn">Delete karein</button>' +
      '</div></div>';
    html += storyboardHtml(sbRes.storyboard, p);
    detail.innerHTML = html;
    $('#deleteProjectBtn').addEventListener('click', async () => {
      if (!window.confirm('Ye project delete kar dein? Ye wapas nahi aayega.')) return;
      try {
        await api('/api/projects/' + encodeURIComponent(p.id), { method: 'DELETE' });
        detail.classList.add('hidden');
        detail.innerHTML = '';
        loadProjects();
      } catch (e) {
        window.alert('Delete nahi hua: ' + e.message);
      }
    });
    detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    detail.innerHTML = '<div class="card"><p class="error">Project nahi mila: ' + esc(e.message) + '</p></div>';
  }
}

/* ---------- characters ---------- */
const ABDULLAH_REALISTIC_DESC = "Abdullah, a young man in his early twenties, black wavy hair, neatly trimmed beard, warm brown eyes, wearing a black Levi's hoodie, blue jeans and blue-grey sneakers";
const ABDULLAH_CARTOON_DESC = "Abdullah, a 3D cartoon young man, big expressive brown eyes, black wavy hair, neatly trimmed beard, gentle smile, wearing a black Levi's hoodie, blue jeans and blue-grey sneakers";

async function loadCharacters() {
  const list = $('#charactersList');
  try {
    const res = await api('/api/characters');
    const chars = res.characters || [];
    if (!chars.length) {
      list.innerHTML = '<p class="muted">Abhi koi character nahi hai. Upar wala form bharein.</p>';
      return;
    }
    list.innerHTML = chars.map((c) => (
      '<div class="list-item"><h3>' + esc(c.name) + '</h3>' +
      '<p>' + esc(c.description) + '</p>' +
      '<p class="meta">Voice: ' + esc(c.voiceName || c.voiceId || '—') +
      (c.voiceProvider ? ' (' + esc(c.voiceProvider) + ')' : '') + ' · ' + fmtDate(c.createdAt) + '</p>' +
      '<p><button type="button" class="btn btn-danger" data-del-char="' + esc(c.id) + '">Delete karein</button></p></div>'
    )).join('');
    list.querySelectorAll('[data-del-char]').forEach((b) => {
      b.addEventListener('click', async () => {
        if (!window.confirm('Ye character delete kar dein?')) return;
        try {
          await api('/api/characters/' + encodeURIComponent(b.getAttribute('data-del-char')), { method: 'DELETE' });
          loadCharacters();
          loadCharacterOptions();
        } catch (e) {
          window.alert('Delete nahi hua: ' + e.message);
        }
      });
    });
  } catch (e) {
    list.innerHTML = '<p class="error">Characters nahi mile: ' + esc(e.message) + '</p>';
  }
}

async function loadCharacterOptions() {
  const sel = $('#characterSelect');
  const current = sel.value;
  try {
    const res = await api('/api/characters');
    const chars = res.characters || [];
    sel.innerHTML = '<option value="">Koi character nahi (default Abdullah)</option>' +
      chars.map((c) => '<option value="' + esc(c.id) + '">' + esc(c.name) +
        (c.voiceName ? ' — ' + esc(c.voiceName) : '') + '</option>').join('');
    if (current && chars.some((c) => c.id === current)) sel.value = current;
  } catch (_) {
    /* options stay empty — the select still works with the default */
  }
}

function fillAbdullah(mode) {
  $('#charName').value = 'Abdullah';
  $('#charDescription').value = mode === 'cartoon' ? ABDULLAH_CARTOON_DESC : ABDULLAH_REALISTIC_DESC;
  $('#charVoiceProvider').value = 'google-tts';
  $('#charVoiceId').value = 'ur-IN-Wavenet-B';
  $('#charVoiceName').value = 'Abdullah — young male';
}

/* ---------- history ---------- */
async function loadHistory() {
  const list = $('#historyList');
  try {
    const res = await api('/api/jobs?limit=50');
    const jobs = res.jobs || [];
    if (!jobs.length) {
      list.innerHTML = '<p class="muted">Abhi koi job nahi hai.</p>';
      return;
    }
    list.innerHTML = jobs.map((j) => (
      '<div class="list-item"><p>' + statusPill(j.status) +
      ' <strong>' + (j.progress || 0) + '%</strong></p>' +
      '<p class="meta">' + esc(j.currentStep || '') + '</p>' +
      '<p class="meta">Job: ' + esc(j.id) + '<br>Project: ' + esc(j.projectId) +
      '<br>' + fmtDate(j.createdAt) + (j.error ? '<br>Error: ' + esc(j.error) : '') + '</p></div>'
    )).join('');
  } catch (e) {
    list.innerHTML = '<p class="error">History nahi mili: ' + esc(e.message) + '</p>';
  }
}

/* ---------- settings ---------- */
async function loadSettingsTab() {
  const providersEl = $('#providersList');
  const defaultsEl = $('#settingsDefaults');
  const input = $('#backendUrlInput');
  input.value = localStorage.getItem(LS_KEY) || '';
  try {
    const res = await api('/api/settings');
    const providers = res.providers || [];
    providersEl.innerHTML = providers.map((p) => (
      '<div class="list-item"><h3>' + esc(p.label || p.name) + '</h3>' +
      '<p class="meta">Model: ' + esc(p.model || '—') + '</p>' +
      '<p class="meta">Configured: ' + (p.configured ? 'Yes' : 'No') + '</p>' +
      (p.pricingUrl ? '<p><a href="' + esc(p.pricingUrl) + '" target="_blank" rel="noopener">Pricing page</a></p>' : '') +
      '</div>'
    )).join('') || '<p class="muted">Koi provider nahi mila.</p>';
    const s = res.settings || {};
    defaultsEl.innerHTML =
      'Demo Mode: <strong>' + (res.demoMode ? 'ON' : 'OFF') + '</strong><br>' +
      'Default provider: ' + esc(s.provider || 'omni') + '<br>' +
      'Default mode: ' + esc(s.default_mode || 'cartoon') + '<br>' +
      'Default duration: ' + esc(s.default_duration_seconds || '60') + 's<br>' +
      'Default aspect: ' + esc(s.default_aspect || '9:16') + '<br>' +
      'Default quality: ' + esc(s.default_quality || '1080p') + '<br>' +
      'Default language: ' + esc(s.default_language || 'ur') + '<br>' +
      '<span class="muted">' + esc(res.note || '') + '</span>';
  } catch (e) {
    providersEl.innerHTML = '<p class="error">Settings nahi mile: ' + esc(e.message) + '</p>';
    defaultsEl.textContent = 'Settings nahi mile: ' + e.message;
  }
}

async function testConnection() {
  const input = $('#backendUrlInput').value.trim();
  const url = input ? input.replace(/\/+$/, '') : window.location.origin;
  const result = $('#connectionResult');
  result.textContent = 'Test ho raha hai…';
  try {
    const res = await fetch(url + '/api/health');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const h = await res.json();
    saveBackendUrl(input);
    result.innerHTML = '<span class="success" style="display:inline-block">Connected!</span><br>' +
      'Version: ' + esc(h.version) + '<br>' +
      'FFmpeg: ' + (h.ffmpegAvailable ? 'Yes' : 'No') + '<br>' +
      'Provider: ' + esc(h.configuredProvider || 'koi nahi (Demo Mode)') + '<br>' +
      'Demo Mode: ' + (h.demoMode ? 'ON' : 'OFF');
    refreshHealth();
    loadCharacterOptions();
  } catch (e) {
    result.innerHTML = '<span class="error" style="display:inline-block">Connect nahi hua: ' +
      esc(e.message) + '</span><br><span class="muted">URL check karein (https, koi extra space nahi) aur backend on hai ya nahi dekhein. URL save nahi hui.</span>';
  }
}

/* ---------- init ---------- */
function init() {
  ['modeSeg', 'durationSeg', 'aspectSeg', 'qualitySeg', 'languageSeg'].forEach(setupSeg);
  $$('.tab-btn').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('#estimateBtn').addEventListener('click', showEstimate);
  $('#generateBtn').addEventListener('click', generate);
  $('#projectsRefreshBtn').addEventListener('click', loadProjects);
  $('#historyRefreshBtn').addEventListener('click', loadHistory);
  $('#homeTestBtn').addEventListener('click', refreshHealth);
  $('#testConnectionBtn').addEventListener('click', testConnection);
  $('#abdullahRealisticBtn').addEventListener('click', () => fillAbdullah('realistic'));
  $('#abdullahCartoonBtn').addEventListener('click', () => fillAbdullah('cartoon'));

  const imgInput = $('#charImage');
  imgInput.addEventListener('change', () => {
    const file = imgInput.files && imgInput.files[0];
    const preview = $('#charPreview');
    if (!file) { preview.classList.add('hidden'); preview.src = ''; return; }
    const reader = new FileReader();
    reader.onload = () => { preview.src = reader.result; preview.classList.remove('hidden'); };
    reader.readAsDataURL(file);
  });

  $('#characterForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl = $('#charError');
    const okEl = $('#charSuccess');
    errEl.classList.add('hidden');
    okEl.classList.add('hidden');
    const fd = new FormData();
    const file = imgInput.files && imgInput.files[0];
    if (!file) {
      errEl.textContent = 'Pehle aik reference tasveer chunein.';
      errEl.classList.remove('hidden');
      return;
    }
    fd.append('image', file);
    fd.append('name', $('#charName').value.trim());
    fd.append('description', $('#charDescription').value.trim());
    fd.append('voice_provider', $('#charVoiceProvider').value);
    fd.append('voice_id', $('#charVoiceId').value.trim());
    fd.append('voice_name', $('#charVoiceName').value.trim());
    try {
      const res = await api('/api/characters', { method: 'POST', body: fd, isForm: true });
      okEl.textContent = 'Character save ho gaya: ' + res.character.name;
      okEl.classList.remove('hidden');
      e.target.reset();
      $('#charPreview').classList.add('hidden');
      $('#charPreview').src = '';
      loadCharacters();
      loadCharacterOptions();
    } catch (err) {
      errEl.textContent = 'Character save nahi hua: ' + err.message;
      errEl.classList.remove('hidden');
    }
  });

  refreshHealth();
  loadCharacterOptions();
}

init();
