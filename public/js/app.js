// ============== GLOBAL STATE ==============
let currentUser = null;
let currentPage = 'students';
let courseConfig = null;
let currentWeekStart = getMonday(new Date());

// ============== API HELPERS ==============
async function api(url, opts = {}) {
    const res = await fetch(url, {
        ...opts,
        headers: { 'Content-Type': 'application/json', ...opts.headers },
        body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    if (!res.ok && res.status === 401) {
        window.location.href = '/dev-launch';
        return;
    }
    const ct = res.headers.get('content-type');
    if (ct && ct.includes('application/json')) return res.json();
    return res;
}

function toast(msg, type = 'info') {
    const c = document.getElementById('toast-container');
    const t = document.createElement('div');
    t.className = `toast ${type}`;
    t.innerHTML = msg;
    c.appendChild(t);
    setTimeout(() => t.remove(), 3500);
}

function formatDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}
function formatTime(d) {
    if (!d) return '';
    return new Date(d).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function formatDateTime(d) {
    if (!d) return '—';
    return formatDate(d) + ' ' + formatTime(d);
}
function getMonday(d) {
    const dt = new Date(d);
    const day = dt.getDay();
    const diff = dt.getDate() - day + (day === 0 ? -6 : 1);
    dt.setDate(diff);
    dt.setHours(0, 0, 0, 0);
    return dt;
}
function addDays(d, n) {
    const dt = new Date(d);
    dt.setDate(dt.getDate() + n);
    return dt;
}

function showModal(html) {
    document.getElementById('modal-content').innerHTML = html;
    document.getElementById('modal-overlay').classList.add('active');
}
function closeModal() {
    document.getElementById('modal-overlay').classList.remove('active');
}
document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === document.getElementById('modal-overlay')) closeModal();
});

// ============== NAVIGATION ==============
function navigate(page, params = {}) {
    currentPage = page;
    window._pageParams = params;

    // Update nav
    document.querySelectorAll('.nav-item').forEach(n => {
        n.classList.toggle('active', n.dataset.page === page);
    });

    // Render
    const content = document.getElementById('content');
    content.innerHTML = '<div class="spinner"></div>';

    switch (page) {
        case 'setup': renderSetup(); break;
        case 'students': renderStudents(); break;
        case 'sessions': renderSessions(); break;
        case 'codes': renderCodes(); break;
        case 'reports': renderReports(); break;
        case 'student-detail': renderStudentDetail(params.studentId); break;
        default: renderStudents();
    }
}

// ============== INIT ==============
async function init() {
    try {
        currentUser = await api('/api/me');
        document.getElementById('user-name').textContent = currentUser.userName;
        courseConfig = await api('/api/config');

        if (!courseConfig.configured) {
            navigate('setup');
        } else {
            navigate('students');
        }
    } catch (e) {
        document.getElementById('content').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🔒</div>
        <div class="empty-text">Please launch from Canvas LTI</div>
        <div class="empty-hint">Or use dev mode: <a href="/dev-launch" class="setup-link">Launch as Instructor →</a></div>
      </div>`;
    }
}

// ============== SETUP PAGE ==============
async function renderSetup() {
    const config = courseConfig || {};
    const statuses = config.statuses ? (typeof config.statuses === 'string' ? JSON.parse(config.statuses) : config.statuses) : ['Present', 'Absent', 'Late', 'Excused'];
    const rules = config.rules || [];
    const content = document.getElementById('content');

    content.innerHTML = `
    <div style="max-width:700px;margin:0 auto">
      <div class="page-header">
        <div>
          <h1 class="page-title">⚙ Attendance Setup</h1>
          <p class="page-subtitle">Configure attendance tracking for your course</p>
        </div>
      </div>

      <div class="card" style="margin-bottom:20px">
        <div class="card-title" style="margin-bottom:16px">🔑 Canvas API Connection</div>
        <div class="form-group">
          <label class="form-label">Course Name</label>
          <input class="form-input" id="cfg-name" value="${config.name || ''}" placeholder="e.g. Biology 101">
        </div>
        <div class="form-group">
          <label class="form-label">Canvas API URL</label>
          <input class="form-input" id="cfg-api-url" value="${config.canvas_api_url || 'https://canvas.instructure.com/api/v1'}" placeholder="https://canvas.instructure.com/api/v1">
          <span class="form-hint">Your Canvas instance URL + /api/v1</span>
        </div>
        <div class="form-group">
          <label class="form-label">Canvas API Token</label>
          <input class="form-input" type="password" id="cfg-api-token" value="${config.canvas_api_token || ''}" placeholder="Paste your Canvas API token">
          <span class="form-hint">Generate from Canvas → Account → Settings → New Access Token</span>
        </div>
      </div>

      <div class="card" style="margin-bottom:20px">
        <div class="card-title" style="margin-bottom:16px">📅 Calendar</div>
        <label class="form-check">
          <input type="checkbox" id="cfg-calendar" ${config.calendar_sync ? 'checked' : ''}>
          <span>Pull sessions from Canvas course calendar</span>
        </label>
        <span class="form-hint" style="margin-top:6px;display:block">You can always add sessions manually regardless of this setting</span>
      </div>

      <div class="card" style="margin-bottom:20px">
        <div class="card-title" style="margin-bottom:16px">📊 Grading</div>
        <label class="form-check" style="margin-bottom:16px">
          <input type="checkbox" id="cfg-grading" ${config.grading_enabled ? 'checked' : ''} onchange="toggleGradingOptions()">
          <span>Enable attendance grading</span>
        </label>

        <div id="grading-options" style="display:${config.grading_enabled ? 'block' : 'none'}">
          <div class="form-group">
            <label class="form-label">Grading Mode</label>
            <div id="grading-modes">
              <div class="grading-mode-card ${config.grading_mode === 'proportional' || !config.grading_mode ? 'selected' : ''}" onclick="selectGradingMode('proportional')">
                <div class="grading-mode-title">📐 Proportional</div>
                <div class="grading-mode-desc">Score = (sessions attended ÷ sessions taught) × max points</div>
              </div>
              <div class="grading-mode-card ${config.grading_mode === 'rule_percentage' ? 'selected' : ''}" onclick="selectGradingMode('rule_percentage')">
                <div class="grading-mode-title">📏 Rule-Based Percentage Penalty</div>
                <div class="grading-mode-desc">Define absence thresholds that trigger a % penalty of total grade</div>
              </div>
              <div class="grading-mode-card ${config.grading_mode === 'rule_absolute' ? 'selected' : ''}" onclick="selectGradingMode('rule_absolute')">
                <div class="grading-mode-title">🔢 Rule-Based Absolute Points Penalty</div>
                <div class="grading-mode-desc">Define absence thresholds that deduct specific points</div>
              </div>
              <div class="grading-mode-card ${config.grading_mode === 'raw_points' ? 'selected' : ''}" onclick="selectGradingMode('raw_points')">
                <div class="grading-mode-title">📝 Raw Points by Session Attended</div>
                <div class="grading-mode-desc">Each session is worth a proportion of total attendance points</div>
              </div>
            </div>
          </div>

          <div class="form-row">
            <div class="form-group">
              <label class="form-label">Points Value</label>
              <input class="form-input" type="number" id="cfg-points" value="${config.grading_points || 100}" min="0">
            </div>
            <div class="form-group" id="total-sessions-group" style="display:${config.grading_mode === 'raw_points' ? 'block' : 'none'}">
              <label class="form-label">Total Sessions</label>
              <input class="form-input" type="number" id="cfg-total-sessions" value="${config.grading_total_sessions || 0}" min="0">
              <span class="form-hint">Number of sessions for full attendance</span>
            </div>
          </div>

          <div id="rules-section" style="display:${['rule_percentage', 'rule_absolute'].includes(config.grading_mode) ? 'block' : 'none'}">
            <div class="card-title" style="margin-bottom:12px">📋 Grading Rules</div>
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:12px">
              ${config.grading_mode === 'rule_percentage' ? 'Penalty is a percentage of total grade' : 'Penalty is absolute points deduction'}
            </div>
            <div id="rules-list">
              ${rules.map((r, i) => ruleRowHTML(r, i)).join('')}
            </div>
            <button class="btn btn-secondary btn-sm" onclick="addRule()">+ Add Rule</button>
          </div>
        </div>
      </div>

      <div class="btn-group" style="justify-content:flex-end">
        <button class="btn btn-primary" onclick="saveConfig()" style="padding:12px 32px">
          💾 Save Configuration
        </button>
      </div>
    </div>`;

    window._selectedGradingMode = config.grading_mode || 'proportional';
    window._ruleCount = rules.length;
}

function ruleRowHTML(rule = {}, idx = 0) {
    return `
    <div class="rule-row" id="rule-${idx}">
      <input class="form-input" type="number" placeholder="Min absences" value="${rule.min_absences ?? ''}" data-rule="min" min="0">
      <input class="form-input" type="number" placeholder="Max absences" value="${rule.max_absences ?? ''}" data-rule="max" min="0">
      <input class="form-input" type="number" placeholder="Penalty value" value="${rule.penalty_value ?? ''}" data-rule="penalty" min="0">
      <button class="remove-rule" onclick="this.parentElement.remove()">✕</button>
    </div>`;
}

function addRule() {
    window._ruleCount = (window._ruleCount || 0) + 1;
    document.getElementById('rules-list').insertAdjacentHTML('beforeend', ruleRowHTML({}, window._ruleCount));
}

function selectGradingMode(mode) {
    window._selectedGradingMode = mode;
    document.querySelectorAll('.grading-mode-card').forEach(c => c.classList.remove('selected'));
    event.currentTarget.classList.add('selected');

    document.getElementById('rules-section').style.display =
        ['rule_percentage', 'rule_absolute'].includes(mode) ? 'block' : 'none';
    document.getElementById('total-sessions-group').style.display =
        mode === 'raw_points' ? 'block' : 'none';
}

function toggleGradingOptions() {
    document.getElementById('grading-options').style.display =
        document.getElementById('cfg-grading').checked ? 'block' : 'none';
}

async function saveConfig() {
    const rules = [];
    document.querySelectorAll('.rule-row').forEach(row => {
        const min = row.querySelector('[data-rule="min"]').value;
        const max = row.querySelector('[data-rule="max"]').value;
        const penalty = row.querySelector('[data-rule="penalty"]').value;
        if (min !== '' && penalty !== '') {
            rules.push({
                min_absences: parseInt(min),
                max_absences: max ? parseInt(max) : null,
                penalty_value: parseFloat(penalty)
            });
        }
    });

    const body = {
        name: document.getElementById('cfg-name').value,
        canvas_api_url: document.getElementById('cfg-api-url').value,
        canvas_api_token: document.getElementById('cfg-api-token').value,
        calendar_sync: document.getElementById('cfg-calendar').checked,
        grading_enabled: document.getElementById('cfg-grading').checked,
        grading_mode: window._selectedGradingMode || 'proportional',
        grading_points: parseFloat(document.getElementById('cfg-points').value) || 100,
        grading_total_sessions: parseInt(document.getElementById('cfg-total-sessions')?.value) || 0,
        rules
    };

    try {
        const result = await api('/api/config', { method: 'POST', body });
        if (result.success) {
            courseConfig = result.course;
            courseConfig.configured = true;
            toast('✓ Configuration saved!', 'success');
            setTimeout(() => navigate('students'), 800);
        } else {
            toast('Error: ' + (result.error || 'Failed'), 'error');
        }
    } catch (e) {
        toast('Failed to save: ' + e.message, 'error');
    }
}

// ============== STUDENTS PAGE ==============
async function renderStudents() {
    const content = document.getElementById('content');
    const weekEnd = addDays(currentWeekStart, 6);
    const weekEndStr = addDays(currentWeekStart, 7).toISOString();

    try {
        const data = await api(`/api/attendance-grid?start=${currentWeekStart.toISOString()}&end=${weekEndStr}`);
        const { students, sessions, attendance } = data;

        content.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Students</h1>
          <p class="page-subtitle">${students.length} students enrolled</p>
        </div>
        <div class="btn-group">
          <button class="btn btn-secondary btn-sm" onclick="syncStudents()">🔄 Sync from Canvas</button>
          <button class="btn btn-secondary btn-sm" onclick="showAddStudentModal()">+ Add Student</button>
        </div>
      </div>

      <div class="week-nav">
        <button class="week-btn" onclick="changeWeek(-1)">◄</button>
        <span class="week-label">${formatDate(currentWeekStart)} — ${formatDate(weekEnd)}</span>
        <button class="week-btn" onclick="changeWeek(1)">►</button>
        <button class="btn btn-secondary btn-xs" onclick="currentWeekStart=getMonday(new Date());navigate('students')">Today</button>
      </div>

      ${students.length === 0 ? `
        <div class="empty-state">
          <div class="empty-icon">👥</div>
          <div class="empty-text">No students enrolled</div>
          <div class="empty-hint">Sync students from Canvas or add them manually</div>
        </div>
      ` : sessions.length === 0 ? `
        <div class="card">
          <div class="table-wrapper">
            <table>
              <thead><tr><th>Student</th><th>Email</th><th>Actions</th></tr></thead>
              <tbody>
                ${students.map(s => `
                  <tr>
                    <td><a style="color:var(--accent);cursor:pointer" onclick="navigate('student-detail',{studentId:${s.id}})">${s.name}</a></td>
                    <td style="color:var(--text-muted)">${s.email || '—'}</td>
                    <td><button class="btn btn-secondary btn-xs" onclick="navigate('student-detail',{studentId:${s.id}})">View</button></td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          <p style="color:var(--text-muted);font-size:13px;margin-top:12px">No sessions this week. Navigate to a different week or add sessions.</p>
        </div>
      ` : `
        <div class="card">
          <div class="card-header">
            <span class="card-title">Weekly Attendance</span>
            <button class="btn btn-success btn-sm" onclick="saveAttendanceGrid()">💾 Save All</button>
          </div>
          <div class="table-wrapper">
            <table id="attendance-grid">
              <thead>
                <tr>
                  <th style="min-width:180px">Student</th>
                  ${sessions.map(s => `<th style="min-width:130px;text-align:center">
                    <div style="font-size:11px">${formatDate(s.start_time)}</div>
                    <div style="font-weight:700;font-size:12px">${s.title}</div>
                    <div style="font-size:10px;color:var(--text-muted)">${formatTime(s.start_time)}</div>
                    <div style="margin-top:4px"><button class="btn btn-secondary btn-xs" onclick="fillSession(${s.id},'Present')">Fill ✓</button></div>
                  </th>`).join('')}
                  <th>Comment</th>
                </tr>
              </thead>
              <tbody>
                ${students.map(s => {
            return `<tr data-student="${s.id}">
                    <td><a style="color:var(--accent);cursor:pointer" onclick="navigate('student-detail',{studentId:${s.id}})">${s.name}</a></td>
                    ${sessions.map(sess => {
                const key = `${s.id}_${sess.id}`;
                const att = attendance[key];
                const status = att ? att.status : 'unmarked';
                return `<td style="text-align:center">
                        <select class="status-select" data-session="${sess.id}" data-student="${s.id}"
                                style="color:var(${status === 'Present' ? '--success' : status === 'Absent' ? '--danger' : status === 'Late' ? '--warning' : status === 'Excused' ? '--excused' : '--text-muted'})">
                          <option value="unmarked" ${status === 'unmarked' ? 'selected' : ''}>—</option>
                          <option value="Present" ${status === 'Present' ? 'selected' : ''}>✓ Present</option>
                          <option value="Absent" ${status === 'Absent' ? 'selected' : ''}>✗ Absent</option>
                          <option value="Late" ${status === 'Late' ? 'selected' : ''}>⏰ Late</option>
                          <option value="Excused" ${status === 'Excused' ? 'selected' : ''}>📋 Excused</option>
                        </select>
                      </td>`;
            }).join('')}
                    <td><input class="comment-input" data-student="${s.id}" placeholder="Note..." value="${(() => {
                    // Get latest comment for this student in these sessions
                    for (const sess of sessions) {
                        const key = `${s.id}_${sess.id}`;
                        if (attendance[key] && attendance[key].comment) return attendance[key].comment;
                    }
                    return '';
                })()}"></td>
                  </tr>`;
        }).join('')}
              </tbody>
            </table>
          </div>
        </div>
      `}`;

        // Add change listeners for status color
        document.querySelectorAll('.status-select').forEach(sel => {
            sel.addEventListener('change', function () {
                const v = this.value;
                this.style.color = v === 'Present' ? 'var(--success)' : v === 'Absent' ? 'var(--danger)' : v === 'Late' ? 'var(--warning)' : v === 'Excused' ? 'var(--excused)' : 'var(--text-muted)';
            });
        });
    } catch (e) {
        content.innerHTML = `<div class="empty-state"><div class="empty-text">Error loading data</div><div class="empty-hint">${e.message}</div></div>`;
    }
}

function changeWeek(dir) {
    currentWeekStart = addDays(currentWeekStart, dir * 7);
    navigate('students');
}

async function saveAttendanceGrid() {
    const selects = document.querySelectorAll('.status-select');
    const bySession = {};

    selects.forEach(sel => {
        const sessionId = sel.dataset.session;
        const studentId = sel.dataset.student;
        if (!bySession[sessionId]) bySession[sessionId] = [];
        const comment = document.querySelector(`.comment-input[data-student="${studentId}"]`)?.value || '';
        bySession[sessionId].push({
            student_id: parseInt(studentId),
            status: sel.value,
            comment
        });
    });

    try {
        for (const [sessionId, records] of Object.entries(bySession)) {
            await api(`/api/attendance/${sessionId}`, { method: 'POST', body: { records } });
        }
        toast('✓ Attendance saved!', 'success');
    } catch (e) {
        toast('Error saving: ' + e.message, 'error');
    }
}

async function fillSession(sessionId, status) {
    try {
        await api(`/api/attendance/${sessionId}/fill`, { method: 'POST', body: { status } });
        toast(`Filled blanks with "${status}"`, 'success');
        navigate('students');
    } catch (e) {
        toast('Error: ' + e.message, 'error');
    }
}

async function syncStudents() {
    toast('Syncing students from Canvas...', 'info');
    try {
        const result = await api('/api/students/sync', { method: 'POST' });
        if (result.success) {
            toast(`✓ Synced ${result.count} students`, 'success');
            navigate('students');
        } else {
            toast(result.error || 'Sync failed', 'error');
        }
    } catch (e) {
        toast('Error: ' + e.message, 'error');
    }
}

function showAddStudentModal() {
    showModal(`
    <div class="modal-header">
      <div class="modal-title">Add Student</div>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="form-group">
      <label class="form-label">Name</label>
      <input class="form-input" id="new-student-name" placeholder="Student name">
    </div>
    <div class="form-group">
      <label class="form-label">Email (optional)</label>
      <input class="form-input" id="new-student-email" placeholder="student@email.com">
    </div>
    <button class="btn btn-primary" onclick="addStudent()">Add Student</button>
  `);
}

async function addStudent() {
    const name = document.getElementById('new-student-name').value;
    const email = document.getElementById('new-student-email').value;
    if (!name) { toast('Name is required', 'error'); return; }

    try {
        await api('/api/students', { method: 'POST', body: { name, email } });
        toast('✓ Student added', 'success');
        closeModal();
        navigate('students');
    } catch (e) {
        toast('Error: ' + e.message, 'error');
    }
}

// ============== SESSIONS PAGE ==============
async function renderSessions() {
    const content = document.getElementById('content');

    try {
        const sessions = await api('/api/sessions');

        content.innerHTML = `
      <div class="page-header">
        <div>
          <h1 class="page-title">Sessions</h1>
          <p class="page-subtitle">${sessions.length} sessions</p>
        </div>
        <div class="btn-group">
          <button class="btn btn-secondary btn-sm" onclick="syncSessions()">🔄 Sync Calendar</button>
          <button class="btn btn-primary btn-sm" onclick="showAddSessionModal()">+ Add Sessions</button>
        </div>
      </div>

      <div class="view-toggle" style="margin-bottom:20px">
        <button class="view-toggle-btn active" onclick="setSessionView('grid',this)">Grid</button>
        <button class="view-toggle-btn" onclick="setSessionView('list',this)">List</button>
      </div>

      <div id="sessions-container">
        ${sessions.length === 0 ? `
          <div class="empty-state">
            <div class="empty-icon">📅</div>
            <div class="empty-text">No sessions yet</div>
            <div class="empty-hint">Add sessions manually or sync from your Canvas calendar</div>
          </div>
        ` : `
          <div class="session-grid" id="sessions-grid">
            ${sessions.map(s => sessionCardHTML(s)).join('')}
          </div>
          <div id="sessions-list" style="display:none">
            <div class="card">
              <div class="table-wrapper">
                <table>
                  <thead><tr><th>Title</th><th>Date</th><th>Time</th><th>Location</th><th>Actions</th></tr></thead>
                  <tbody>
                    ${sessions.map(s => `
                      <tr>
                        <td style="font-weight:500">${s.title}</td>
                        <td>${formatDate(s.start_time)}</td>
                        <td>${formatTime(s.start_time)} – ${formatTime(s.end_time)}</td>
                        <td style="color:var(--text-muted)">${s.location || '—'}</td>
                        <td>
                          <div class="btn-group">
                            <button class="btn btn-secondary btn-xs" onclick="openSessionAttendance(${s.id},'${s.title.replace(/'/g, "\\'")}')">Attendance</button>
                            <button class="btn btn-secondary btn-xs" onclick="showEditSessionModal(${s.id})">Edit</button>
                            <button class="btn btn-danger btn-xs" onclick="deleteSession(${s.id})">Delete</button>
                          </div>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        `}
      </div>`;

        window._allSessions = sessions;
    } catch (e) {
        content.innerHTML = `<div class="empty-state"><div class="empty-text">Error loading sessions</div></div>`;
    }
}

function sessionCardHTML(s) {
    return `
    <div class="session-card" onclick="openSessionAttendance(${s.id},'${s.title.replace(/'/g, "\\'")}')">
      <div class="session-date">${formatDate(s.start_time)} • ${formatTime(s.start_time)}</div>
      <div class="session-title">${s.title}</div>
      ${s.location ? `<div style="font-size:12px;color:var(--text-muted)">📍 ${s.location}</div>` : ''}
    </div>`;
}

function setSessionView(view, btn) {
    document.querySelectorAll('.view-toggle-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('sessions-grid').style.display = view === 'grid' ? 'grid' : 'none';
    document.getElementById('sessions-list').style.display = view === 'list' ? 'block' : 'none';
}

function openSessionAttendance(sessionId, title) {
    showModal(`
    <div class="modal-header">
      <div class="modal-title">📋 ${title}</div>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div id="session-attendance-content"><div class="spinner"></div></div>
  `);
    loadSessionAttendance(sessionId);
}

async function loadSessionAttendance(sessionId) {
    const data = await api(`/api/attendance/${sessionId}`);
    const el = document.getElementById('session-attendance-content');

    el.innerHTML = `
    <div style="margin-bottom:12px">
      <button class="btn btn-secondary btn-sm" onclick="fillSessionModal(${sessionId},'Present')">Fill Present</button>
      <button class="btn btn-secondary btn-sm" onclick="fillSessionModal(${sessionId},'Absent')">Fill Absent</button>
    </div>
    <div class="table-wrapper">
      <table>
        <thead><tr><th>Student</th><th>Status</th><th>Comment</th></tr></thead>
        <tbody>
          ${data.map(r => `
            <tr>
              <td>${r.student_name || r.name}</td>
              <td>
                <select class="status-select session-att-select" data-student="${r.id || r.student_id}"
                  style="color:var(${(r.status || 'unmarked') === 'Present' ? '--success' : (r.status || 'unmarked') === 'Absent' ? '--danger' : (r.status || 'unmarked') === 'Late' ? '--warning' : (r.status || 'unmarked') === 'Excused' ? '--excused' : '--text-muted'})">
                  <option value="unmarked" ${(!r.status || r.status === 'unmarked') ? 'selected' : ''}>—</option>
                  <option value="Present" ${r.status === 'Present' ? 'selected' : ''}>✓ Present</option>
                  <option value="Absent" ${r.status === 'Absent' ? 'selected' : ''}>✗ Absent</option>
                  <option value="Late" ${r.status === 'Late' ? 'selected' : ''}>⏰ Late</option>
                  <option value="Excused" ${r.status === 'Excused' ? 'selected' : ''}>📋 Excused</option>
                </select>
              </td>
              <td><input class="comment-input session-att-comment" data-student="${r.id || r.student_id}" value="${r.comment || ''}" placeholder="Note..."></td>
            </tr>
          `).join('')}
          ${data.length === 0 ? '<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">No students enrolled</td></tr>' : ''}
        </tbody>
      </table>
    </div>
    <div style="margin-top:16px;text-align:right">
      <button class="btn btn-success" onclick="saveSessionAttendance(${sessionId})">💾 Save</button>
    </div>`;

    el.querySelectorAll('.session-att-select').forEach(sel => {
        sel.addEventListener('change', function () {
            const v = this.value;
            this.style.color = v === 'Present' ? 'var(--success)' : v === 'Absent' ? 'var(--danger)' : v === 'Late' ? 'var(--warning)' : v === 'Excused' ? 'var(--excused)' : 'var(--text-muted)';
        });
    });
}

async function saveSessionAttendance(sessionId) {
    const records = [];
    document.querySelectorAll('.session-att-select').forEach(sel => {
        const studentId = parseInt(sel.dataset.student);
        const comment = document.querySelector(`.session-att-comment[data-student="${studentId}"]`)?.value || '';
        records.push({ student_id: studentId, status: sel.value, comment });
    });

    try {
        await api(`/api/attendance/${sessionId}`, { method: 'POST', body: { records } });
        toast('✓ Attendance saved!', 'success');
        closeModal();
    } catch (e) {
        toast('Error: ' + e.message, 'error');
    }
}

async function fillSessionModal(sessionId, status) {
    await api(`/api/attendance/${sessionId}/fill`, { method: 'POST', body: { status } });
    loadSessionAttendance(sessionId);
}

function showAddSessionModal() {
    showModal(`
    <div class="modal-header">
      <div class="modal-title">Add Sessions</div>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="form-group">
      <label class="form-label">Title</label>
      <input class="form-input" id="new-sess-title" placeholder="e.g. Lecture, Lab, Tutorial">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Start Date & Time</label>
        <input class="form-input" type="datetime-local" id="new-sess-start">
      </div>
      <div class="form-group">
        <label class="form-label">End Date & Time</label>
        <input class="form-input" type="datetime-local" id="new-sess-end">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Location (optional)</label>
      <input class="form-input" id="new-sess-location" placeholder="e.g. Room 101">
    </div>
    <div class="form-group">
      <label class="form-label">Repeat Weekly</label>
      <select class="form-select" id="new-sess-repeat">
        <option value="0">No repeat</option>
        <option value="2">2 weeks</option>
        <option value="4">4 weeks</option>
        <option value="8">8 weeks</option>
        <option value="12">12 weeks</option>
        <option value="16">16 weeks</option>
      </select>
    </div>
    <div style="text-align:right;margin-top:16px">
      <button class="btn btn-primary" onclick="createSessions()">Create Sessions</button>
    </div>
  `);
}

async function createSessions() {
    const title = document.getElementById('new-sess-title').value;
    const start = document.getElementById('new-sess-start').value;
    const end = document.getElementById('new-sess-end').value;
    const location = document.getElementById('new-sess-location').value;
    const repeat = parseInt(document.getElementById('new-sess-repeat').value);

    if (!title || !start) { toast('Title and start time are required', 'error'); return; }

    const sessions = [];
    for (let i = 0; i <= repeat; i++) {
        const s = new Date(start);
        const e = end ? new Date(end) : new Date(start);
        s.setDate(s.getDate() + i * 7);
        e.setDate(e.getDate() + i * 7);
        sessions.push({ title, start_time: s.toISOString(), end_time: e.toISOString(), location });
    }

    try {
        await api('/api/sessions', { method: 'POST', body: sessions });
        toast(`✓ Created ${sessions.length} session(s)`, 'success');
        closeModal();
        navigate('sessions');
    } catch (e) {
        toast('Error: ' + e.message, 'error');
    }
}

async function showEditSessionModal(sessionId) {
    const s = window._allSessions?.find(x => x.id === sessionId);
    if (!s) return;
    showModal(`
    <div class="modal-header">
      <div class="modal-title">Edit Session</div>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="form-group">
      <label class="form-label">Title</label>
      <input class="form-input" id="edit-sess-title" value="${s.title}">
    </div>
    <div class="form-row">
      <div class="form-group">
        <label class="form-label">Start</label>
        <input class="form-input" type="datetime-local" id="edit-sess-start" value="${s.start_time ? s.start_time.slice(0, 16) : ''}">
      </div>
      <div class="form-group">
        <label class="form-label">End</label>
        <input class="form-input" type="datetime-local" id="edit-sess-end" value="${s.end_time ? s.end_time.slice(0, 16) : ''}">
      </div>
    </div>
    <div class="form-group">
      <label class="form-label">Location</label>
      <input class="form-input" id="edit-sess-location" value="${s.location || ''}">
    </div>
    <div class="btn-group" style="justify-content:flex-end;margin-top:16px">
      <button class="btn btn-danger btn-sm" onclick="deleteSession(${s.id})">Delete</button>
      <button class="btn btn-primary" onclick="updateSession(${s.id})">Save</button>
    </div>
  `);
}

async function updateSession(id) {
    try {
        await api(`/api/sessions/${id}`, {
            method: 'PUT',
            body: {
                title: document.getElementById('edit-sess-title').value,
                start_time: new Date(document.getElementById('edit-sess-start').value).toISOString(),
                end_time: new Date(document.getElementById('edit-sess-end').value).toISOString(),
                location: document.getElementById('edit-sess-location').value
            }
        });
        toast('✓ Session updated', 'success');
        closeModal();
        navigate('sessions');
    } catch (e) { toast('Error: ' + e.message, 'error'); }
}

async function deleteSession(id) {
    if (!confirm('Delete this session? This will also delete attendance records.')) return;
    try {
        await api(`/api/sessions/${id}`, { method: 'DELETE' });
        toast('Session deleted', 'info');
        closeModal();
        navigate('sessions');
    } catch (e) { toast('Error: ' + e.message, 'error'); }
}

async function syncSessions() {
    toast('Syncing sessions from Canvas calendar...', 'info');
    try {
        const result = await api('/api/sessions/sync', { method: 'POST' });
        if (result.success) {
            toast(`✓ Synced ${result.synced} new sessions (${result.total} total in calendar)`, 'success');
            navigate('sessions');
        } else {
            toast(result.error || 'Sync failed', 'error');
        }
    } catch (e) { toast('Error: ' + e.message, 'error'); }
}

// ============== CODES PAGE ==============
async function renderCodes() {
    const content = document.getElementById('content');
    const sessions = await api('/api/sessions');
    const codes = await api('/api/codes');

    content.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">🎫 Attendance Codes</h1>
        <p class="page-subtitle">Generate codes for students to self-register attendance</p>
      </div>
    </div>

    ${codes.length > 0 ? `
      <div style="margin-bottom:24px">
        <div class="card-title" style="margin-bottom:12px">Active Codes</div>
        ${codes.map(c => `
          <div class="code-display">
            <div style="font-size:14px;color:var(--text-secondary);margin-bottom:8px">${c.session_title} — ${formatDateTime(c.start_time)}</div>
            <div class="code-value">${c.code}</div>
            <div class="code-expires">Expires: ${formatDateTime(c.expires_at)}</div>
          </div>
        `).join('')}
      </div>
    ` : ''}

    <div class="card">
      <div class="card-title" style="margin-bottom:16px">Generate New Code</div>
      ${sessions.length === 0 ? `<p style="color:var(--text-muted)">No sessions available. Add sessions first.</p>` : `
        <div class="form-group">
          <label class="form-label">Select Session</label>
          <select class="form-select" id="code-session">
            ${sessions.map(s => `<option value="${s.id}">${s.title} — ${formatDateTime(s.start_time)}</option>`).join('')}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Code Duration (minutes)</label>
          <select class="form-select" id="code-duration">
            <option value="10">10 minutes</option>
            <option value="15">15 minutes</option>
            <option value="30" selected>30 minutes</option>
            <option value="60">1 hour</option>
            <option value="120">2 hours</option>
          </select>
        </div>
        <button class="btn btn-primary" onclick="generateCode()">Generate Code</button>
      `}
    </div>`;
}

async function generateCode() {
    const sessionId = document.getElementById('code-session').value;
    const minutes = parseInt(document.getElementById('code-duration').value);
    const expiresAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();

    try {
        const result = await api(`/api/codes/${sessionId}/generate`, { method: 'POST', body: { expires_at: expiresAt } });
        toast('✓ Code generated!', 'success');
        navigate('codes');
    } catch (e) { toast('Error: ' + e.message, 'error'); }
}

// ============== REPORTS PAGE ==============
async function renderReports() {
    const content = document.getElementById('content');

    content.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">📊 Reports</h1>
        <p class="page-subtitle">Attendance analytics and exports</p>
      </div>
      <div class="btn-group">
        <button class="btn btn-secondary btn-sm" onclick="exportReport('csv')">📥 Export CSV</button>
        <button class="btn btn-secondary btn-sm" onclick="exportReport('xlsx')">📥 Export Excel</button>
      </div>
    </div>

    <div class="tabs" id="report-tabs">
      <div class="tab active" onclick="switchReportTab('summary',this)">Summary</div>
      <div class="tab" onclick="switchReportTab('by-date',this)">By Date</div>
      <div class="tab" onclick="switchReportTab('comments',this)">Comments</div>
      <div class="tab" onclick="switchReportTab('grades',this)">Grades</div>
    </div>

    <div id="report-content"><div class="spinner"></div></div>`;

    loadReportTab('summary');
}

function switchReportTab(tab, el) {
    document.querySelectorAll('#report-tabs .tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    document.getElementById('report-content').innerHTML = '<div class="spinner"></div>';
    loadReportTab(tab);
}

async function loadReportTab(tab) {
    const el = document.getElementById('report-content');

    try {
        if (tab === 'summary') {
            const data = await api('/api/reports/summary');
            el.innerHTML = `
        <div class="stats-grid">
          <div class="stat-card info"><div class="stat-value">${data.length}</div><div class="stat-label">Total Students</div></div>
          <div class="stat-card success"><div class="stat-value">${data.length > 0 ? Math.round(data.reduce((s, d) => s + d.stats.rate, 0) / data.length) : 0}%</div><div class="stat-label">Avg Attendance</div></div>
          <div class="stat-card danger"><div class="stat-value">${data.filter(d => d.stats.rate < 75).length}</div><div class="stat-label">Below 75%</div></div>
        </div>
        <div class="card">
          <div class="table-wrapper">
            <table>
              <thead><tr><th>Student</th><th>Present</th><th>Absent</th><th>Late</th><th>Excused</th><th>Rate</th>${data[0]?.grade !== null && data[0]?.grade !== undefined ? '<th>Grade</th>' : ''}</tr></thead>
              <tbody>
                ${data.map(d => `
                  <tr onclick="navigate('student-detail',{studentId:${d.student.id}})" style="cursor:pointer">
                    <td style="font-weight:500">${d.student.name}</td>
                    <td><span class="status-badge status-Present">${d.stats.Present}</span></td>
                    <td><span class="status-badge status-Absent">${d.stats.Absent}</span></td>
                    <td><span class="status-badge status-Late">${d.stats.Late}</span></td>
                    <td><span class="status-badge status-Excused">${d.stats.Excused}</span></td>
                    <td>
                      <div style="display:flex;align-items:center;gap:8px">
                        <div class="progress-bar" style="width:80px">
                          <div class="progress-fill ${d.stats.rate >= 75 ? 'success' : d.stats.rate >= 50 ? 'warning' : 'danger'}" style="width:${d.stats.rate}%"></div>
                        </div>
                        <span style="font-weight:600">${d.stats.rate}%</span>
                      </div>
                    </td>
                    ${d.grade !== null && d.grade !== undefined ? `<td style="font-weight:600">${d.grade}</td>` : ''}
                  </tr>
                `).join('')}
                ${data.length === 0 ? '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">No data yet</td></tr>' : ''}
              </tbody>
            </table>
          </div>
        </div>`;
        } else if (tab === 'by-date') {
            const data = await api('/api/reports/by-date');
            el.innerHTML = `
        <div class="card">
          <div class="table-wrapper">
            <table>
              <thead><tr><th>Session</th><th>Date</th><th>Present</th><th>Absent</th><th>Late</th><th>Excused</th><th>Total</th></tr></thead>
              <tbody>
                ${data.map(d => `
                  <tr>
                    <td style="font-weight:500">${d.title}</td>
                    <td>${formatDateTime(d.start_time)}</td>
                    <td><span class="status-badge status-Present">${d.present_count}</span></td>
                    <td><span class="status-badge status-Absent">${d.absent_count}</span></td>
                    <td><span class="status-badge status-Late">${d.late_count}</span></td>
                    <td><span class="status-badge status-Excused">${d.excused_count}</span></td>
                    <td>${d.total_marked}</td>
                  </tr>
                `).join('')}
                ${data.length === 0 ? '<tr><td colspan="7" style="text-align:center;color:var(--text-muted)">No sessions yet</td></tr>' : ''}
              </tbody>
            </table>
          </div>
        </div>`;
        } else if (tab === 'comments') {
            const data = await api('/api/reports/comments');
            el.innerHTML = `
        <div class="card">
          <div class="table-wrapper">
            <table>
              <thead><tr><th>Student</th><th>Session</th><th>Date</th><th>Status</th><th>Comment</th></tr></thead>
              <tbody>
                ${data.map(d => `
                  <tr>
                    <td style="font-weight:500">${d.student_name}</td>
                    <td>${d.session_title}</td>
                    <td>${formatDate(d.start_time)}</td>
                    <td><span class="status-badge status-${d.status}">${d.status}</span></td>
                    <td style="color:var(--text-secondary)">${d.comment}</td>
                  </tr>
                `).join('')}
                ${data.length === 0 ? '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No comments yet</td></tr>' : ''}
              </tbody>
            </table>
          </div>
        </div>`;
        } else if (tab === 'grades') {
            const data = await api('/api/grades/calculate', { method: 'POST' });
            if (data.message) {
                el.innerHTML = `<div class="empty-state"><div class="empty-icon">📊</div><div class="empty-text">${data.message}</div><div class="empty-hint">Enable grading in Attendance Setup</div></div>`;
                return;
            }
            el.innerHTML = `
        <div style="margin-bottom:16px;text-align:right">
          <button class="btn btn-success btn-sm" onclick="syncGradesToCanvas()">🔄 Sync Grades to Canvas</button>
        </div>
        <div class="card">
          <div class="table-wrapper">
            <table>
              <thead><tr><th>Student</th><th>Present</th><th>Absent</th><th>Rate</th><th>Grade</th></tr></thead>
              <tbody>
                ${data.map(d => `
                  <tr>
                    <td style="font-weight:500">${d.student.name}</td>
                    <td>${d.stats.Present}</td>
                    <td>${d.stats.Absent}</td>
                    <td>${d.stats.rate}%</td>
                    <td style="font-weight:700;font-size:16px;color:var(--accent)">${d.grade}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>`;
        }
    } catch (e) {
        el.innerHTML = `<div class="empty-state"><div class="empty-text">Error loading report</div><div class="empty-hint">${e.message}</div></div>`;
    }
}

function exportReport(format) {
    window.open(`/api/reports/export?format=${format}`, '_blank');
}

async function syncGradesToCanvas() {
    toast('Syncing grades to Canvas...', 'info');
    try {
        const result = await api('/api/grades/sync-canvas', { method: 'POST' });
        if (result.success) {
            toast(`✓ Synced grades for ${result.synced}/${result.total} students`, 'success');
        } else {
            toast(result.error || 'Sync failed', 'error');
        }
    } catch (e) { toast('Error: ' + e.message, 'error'); }
}

// ============== STUDENT DETAIL PAGE ==============
async function renderStudentDetail(studentId) {
    const content = document.getElementById('content');

    try {
        const data = await api(`/api/reports/student/${studentId}`);
        if (!data || !data.student) {
            content.innerHTML = '<div class="empty-state"><div class="empty-text">Student not found</div></div>';
            return;
        }

        const { student, stats, grade, detail } = data;
        const initial = student.name ? student.name.charAt(0).toUpperCase() : '?';

        content.innerHTML = `
      <button class="back-btn" onclick="navigate('students')">← Back to Students</button>

      <div class="student-header">
        <div class="student-avatar">${initial}</div>
        <div>
          <div class="student-name">${student.name}</div>
          <div class="student-email">${student.email || 'No email'}</div>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card info"><div class="stat-value">${stats.rate}%</div><div class="stat-label">Attendance Rate</div></div>
        <div class="stat-card success"><div class="stat-value">${stats.Present}</div><div class="stat-label">Present</div></div>
        <div class="stat-card danger"><div class="stat-value">${stats.Absent}</div><div class="stat-label">Absent</div></div>
        <div class="stat-card warning"><div class="stat-value">${stats.Late}</div><div class="stat-label">Late</div></div>
        <div class="stat-card excused"><div class="stat-value">${stats.Excused}</div><div class="stat-label">Excused</div></div>
        ${grade !== null ? `<div class="stat-card"><div class="stat-value" style="color:var(--accent)">${grade}</div><div class="stat-label">Grade</div></div>` : ''}
      </div>

      <div class="card" style="margin-bottom:20px">
        <div class="card-title" style="margin-bottom:4px">Attendance Rate</div>
        <div class="progress-bar" style="height:12px;margin-top:12px">
          <div class="progress-fill ${stats.rate >= 75 ? 'success' : stats.rate >= 50 ? 'warning' : 'danger'}" style="width:${stats.rate}%"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:12px;color:var(--text-muted)">
          <span>0%</span><span>${stats.rate}%</span><span>100%</span>
        </div>
      </div>

      <div class="card">
        <div class="card-title" style="margin-bottom:16px">Detailed Attendance</div>
        <div class="table-wrapper">
          <table>
            <thead><tr><th>Session</th><th>Date</th><th>Time</th><th>Location</th><th>Status</th><th>Comment</th></tr></thead>
            <tbody>
              ${detail.map(d => `
                <tr>
                  <td style="font-weight:500">${d.session_title}</td>
                  <td>${formatDate(d.start_time)}</td>
                  <td>${formatTime(d.start_time)} – ${formatTime(d.end_time)}</td>
                  <td style="color:var(--text-muted)">${d.location || '—'}</td>
                  <td><span class="status-badge status-${d.status || 'unmarked'}">${d.status || '—'}</span></td>
                  <td style="color:var(--text-secondary)">${d.comment || '—'}</td>
                </tr>
              `).join('')}
              ${detail.length === 0 ? '<tr><td colspan="6" style="text-align:center;color:var(--text-muted)">No attendance records</td></tr>' : ''}
            </tbody>
          </table>
        </div>
      </div>`;
    } catch (e) {
        content.innerHTML = `<div class="empty-state"><div class="empty-text">Error loading student</div><div class="empty-hint">${e.message}</div></div>`;
    }
}

// ============== START ==============
init();
