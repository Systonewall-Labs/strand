// ─── THEME ────────────────────────────────────────────────────────────────

function toggleTheme() {
  const body = document.body;
  const toggleBtn = document.getElementById('theme-toggle');
  const isDark = body.classList.toggle('dark');

  if (isDark) {
    localStorage.setItem('theme', 'dark');
    toggleBtn.textContent = '☾';
  } else {
    localStorage.setItem('theme', 'light');
    toggleBtn.textContent = '☀';
  }
}

// ─── TOAST NOTIFICATIONS ─────────────────────────────────────────────────────

function showToast(message, type = 'error') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const icon = type === 'error' ? '✕' : '✓';

  toast.innerHTML = `
    <div class="toast-icon">${icon}</div>
    <div class="toast-message">${escapeHtml(message)}</div>
    <button class="toast-close" onclick="this.parentElement.remove()">✕</button>
  `;

  container.appendChild(toast);

  // Auto-dismiss after 5 seconds
  setTimeout(() => {
    toast.classList.add('hiding');
    toast.addEventListener('animationend', () => toast.remove());
  }, 5000);
}

// ─── WORKSPACE MANAGEMENT ────────────────────────────────────────────────────

let currentWorkspaceId = null;
let userWorkspaces = [];
let csrfToken = null;

// Helper function to make authenticated fetch requests with workspace header
async function fetchWithWorkspace(url, options = {}) {
  const headers = {
    ...options.headers,
    'Content-Type': 'application/json'
  };

  if (currentWorkspaceId) {
    headers['X-Workspace-Id'] = currentWorkspaceId;
  }

  // Add CSRF token for state-changing requests
  const method = (options.method || 'GET').toUpperCase();
  if (['POST', 'PATCH', 'DELETE'].includes(method)) {
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
  }

  return fetch(url, {
    ...options,
    headers
  });
}

async function loadWorkspaces() {
  try {
    const response = await fetch('/api/workspaces');
    if (response.ok) {
      const data = await response.json();
      userWorkspaces = data.workspaces;
      renderWorkspaceDropdown();
    }
  } catch (error) {
    console.error('Load workspaces error:', error);
  }
}

function renderWorkspaceDropdown() {
  const workspaceList = document.getElementById('workspace-list');
  if (!workspaceList) return;

  workspaceList.innerHTML = '';

  userWorkspaces.forEach(workspace => {
    const item = document.createElement('div');
    item.className = `workspace-item ${workspace.id === currentWorkspaceId ? 'active' : ''}`;
    item.onclick = () => switchWorkspace(workspace.id);

    const initial = workspace.name.charAt(0).toUpperCase();

    item.innerHTML = `
      <div class="workspace-item-icon">${initial}</div>
      <div class="workspace-item-name">${escapeHtml(workspace.name)}</div>
      <div class="workspace-item-role">${escapeHtml(workspace.role)}</div>
    `;

    workspaceList.appendChild(item);
  });
}

function toggleWorkspaceDropdown() {
  const dropdown = document.getElementById('workspace-dropdown');
  if (!dropdown) return;

  const isOpen = dropdown.style.display !== 'none';
  dropdown.style.display = isOpen ? 'none' : 'block';
}

function switchWorkspace(workspaceId) {
  currentWorkspaceId = workspaceId;
  localStorage.setItem('lastWorkspaceId', workspaceId);

  // Update UI
  const workspace = userWorkspaces.find(w => w.id === workspaceId);
  if (workspace) {
    const workspaceNameEl = document.getElementById('workspace-name');
    if (workspaceNameEl) {
      workspaceNameEl.textContent = workspace.name;
    }
  }

  // Close dropdown
  const dropdown = document.getElementById('workspace-dropdown');
  if (dropdown) {
    dropdown.style.display = 'none';
  }

  // Reload workspace data
  loadWorkspace();
  renderWorkspaceDropdown();
}

// Close dropdown when clicking outside
document.addEventListener('click', (e) => {
  const selector = document.querySelector('.workspace-selector');
  if (selector && !selector.contains(e.target)) {
    const dropdown = document.getElementById('workspace-dropdown');
    if (dropdown) {
      dropdown.style.display = 'none';
    }
  }
});

// ─── VIEW SWITCHING ────────────────────────────────────────────────────────

function switchView(view, el) {
  const strandsView = document.getElementById('view-strands');
  const wikiView = document.getElementById('view-wiki');
  const navStrands = document.getElementById('nav-strands');
  const navWiki = document.getElementById('nav-wiki');

  if (view === 'strands') {
    strandsView.style.display = 'flex';
    wikiView.style.display = 'none';
    navStrands.classList.add('active');
    navWiki.classList.remove('active');
    navStrands.setAttribute('aria-pressed', 'true');
    navWiki.setAttribute('aria-pressed', 'false');
  } else if (view === 'wiki') {
    strandsView.style.display = 'none';
    wikiView.style.display = 'flex';
    navStrands.classList.remove('active');
    navWiki.classList.add('active');
    navStrands.setAttribute('aria-pressed', 'false');
    navWiki.setAttribute('aria-pressed', 'true');
    loadWiki();
  }
}

// ─── NAVIGATION ──────────────────────────────────────────────────────────

async function goTo(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
  if (screenId === 'screen-app') {
    // Load initial data when entering the app
    await loadWorkspace();
  }
}

// Check session on page load and initialize search
document.addEventListener('DOMContentLoaded', async () => {
  // Load saved theme
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') {
    document.body.classList.add('dark');
    document.getElementById('theme-toggle').textContent = '☾';
  }

  // Check for verification errors in URL
  const urlParams = new URLSearchParams(window.location.search);
  const error = urlParams.get('error');
  if (error) {
    switch (error) {
      case 'missing_token':
        showToast('Verification token is missing');
        break;
      case 'invalid_token':
        showToast('Invalid verification link. Please request a new one.');
        break;
      case 'expired_token':
        showToast('Verification link has expired. Please request a new one.');
        break;
      case 'already_verified':
        showToast('Email is already verified. You can log in.');
        break;
      case 'server_error':
        showToast('An error occurred during verification. Please try again.');
        break;
    }
    // Clean URL
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  // Check session
  try {
    const response = await fetch('/api/auth/me', {
      credentials: 'include'
    });
    if (response.ok) {
      const data = await response.json();
      localStorage.setItem('userId', data.user.id);
      localStorage.setItem('userName', data.user.name);
      if (data.csrfToken) {
        csrfToken = data.csrfToken;
      }
      goTo('screen-app');
    }
  } catch (error) {
    console.error('Session check error:', error);
  }

  // Search functionality
  const searchInput = document.getElementById('wiki-search-input');
  if (searchInput) {
    let debounceTimer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        searchWiki(e.target.value, currentFilter);
      }, 300);
    });
  }

  // Message input Enter/Shift+Enter behavior
  const msgInput = document.getElementById('msg-input');
  if (msgInput) {
    msgInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
      // Shift+Enter allows default behavior (newline)
    });
  }

  // Filter functionality
  const filters = document.querySelectorAll('.wiki-filter');
  filters.forEach(filter => {
    filter.addEventListener('click', () => {
      filters.forEach(f => {
        f.classList.remove('active');
        f.setAttribute('aria-pressed', 'false');
      });
      filter.classList.add('active');
      filter.setAttribute('aria-pressed', 'true');
      currentFilter = filter.textContent.toLowerCase();
      const query = document.getElementById('wiki-search-input')?.value || '';
      if (query) {
        searchWiki(query, currentFilter);
      } else {
        loadWiki();
      }
    });

    // Keyboard support
    filter.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        filter.click();
      }
    });
  });
});

let currentFilter = 'all';

// ─── PANEL TABS ──────────────────────────────────────────────────────────

function switchTab(name, el) {
  document.querySelectorAll('.p-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  el.classList.add('active');
  document.getElementById('tab-' + name).classList.add('active');
}

// ─── MODALS ──────────────────────────────────────────────────────────────

function openModal(type, strandId = null) {
  const container = document.getElementById('modal-container');
  let content = '';
  let title = '';

  if (type === 'members') {
    const isStrandParticipants = strandId !== null;
    title = isStrandParticipants ? 'Strand participants' : 'Team members';
    content = `
      <div class="modal-header">
        <span class="modal-title" id="modal-title">${title}</span>
        <button class="modal-close" onclick="closeModal()" aria-label="Close modal">×</button>
      </div>
      <div class="modal-body" id="members-body">
        <div style="padding:20px;text-align:center;color:var(--text-muted);font-size:11px;">Loading members...</div>
      </div>
      ${!isStrandParticipants ? `
      <div class="modal-footer">
        <div style="display:flex;gap:10px;align-items:center;flex:1;">
          <input type="email" id="modal-invite-email" placeholder="Invite by email" aria-label="Email to invite" style="flex:1;padding:8px;border:1px solid var(--border);border-radius:4px;">
          <button class="btn-ok" onclick="inviteMember()" aria-label="Send invitation">Invite</button>
        </div>
        <button class="btn-ok" onclick="closeModal()" aria-label="Close modal">done</button>
      </div>` : `
      <div class="modal-footer">
        <button class="btn-ok" onclick="closeModal()" aria-label="Close modal">done</button>
      </div>`}`;
    // Load members after modal is rendered
    setTimeout(() => loadMembers(strandId), 0);
  }

  if (type === 'strand') {
    title = 'New strand';
    content = `
      <div class="modal-header">
        <span class="modal-title" id="modal-title">New strand</span>
        <button class="modal-close" onclick="closeModal()" aria-label="Close modal">×</button>
      </div>
      <div class="modal-body">
        <div>
          <div class="field-label">What needs to be worked on?</div>
          <input type="text" class="field-input" id="f-strand-title" placeholder="e.g. Investigate memory leak in worker" aria-label="Strand title" autofocus>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel-sm" onclick="closeModal()" aria-label="Cancel">cancel</button>
        <button class="btn-ok" onclick="createStrand()" aria-label="Create strand">open strand</button>
      </div>`;
  }

  if (type === 'task') {
    content = `
      <div class="modal-header">
        <span class="modal-title" id="modal-title">New task</span>
        <button class="modal-close" onclick="closeModal()" aria-label="Close modal">×</button>
      </div>
      <div class="modal-body">
        <div>
          <div class="field-label">What needs to be done?</div>
          <input type="text" class="field-input" id="f-task-name" placeholder="e.g. Fix the memory leak" aria-label="Task name" autofocus>
        </div>
        <div class="field-row">
          <div>
            <div class="field-label">Assigned to</div>
            <select class="field-input" id="f-task-assignee" aria-label="Assignee">
              <option value="">Unassigned</option>
            </select>
          </div>
          <div>
            <div class="field-label">Due date</div>
            <input type="date" class="field-input" id="f-task-due" aria-label="Due date">
          </div>
        </div>
        <div>
          <div class="field-label">Status</div>
          <select class="field-input" id="f-task-status" aria-label="Status">
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="done">Done</option>
          </select>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel-sm" onclick="closeModal()" aria-label="Cancel">cancel</button>
        <button class="btn-ok" onclick="createTask()" aria-label="Create task">add task</button>
      </div>`;

    // Load workspace members into assignee select
    loadMembersIntoAssigneeSelect();
  }

  if (type === 'doc') {
    content = `
      <div class="modal-header">
        <span class="modal-title" id="modal-title">Add to doc</span>
        <button class="modal-close" onclick="closeModal()" aria-label="Close modal">×</button>
      </div>
      <div class="modal-body">
        <div>
          <div class="field-label">Section title</div>
          <input type="text" class="field-input" id="f-doc-label" placeholder="e.g. Root cause, Decision, Next steps" aria-label="Section title" autofocus>
        </div>
        <div>
          <div class="field-label">Content</div>
          <textarea class="field-input" id="f-doc-content" placeholder="Write the context you want to preserve..." rows="4" aria-label="Section content"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel-sm" onclick="closeModal()" aria-label="Cancel">cancel</button>
        <button class="btn-ok" style="background:var(--blue)" onclick="createDoc()" aria-label="Add to doc">add to doc</button>
      </div>`;
  }

  if (type === 'decision') {
    content = `
      <div class="modal-header">
        <span class="modal-title" id="modal-title">Record a decision</span>
        <button class="modal-close" onclick="closeModal()" aria-label="Close modal">×</button>
      </div>
      <div class="modal-body">
        <div>
          <div class="field-label">What was decided? <span class="immutable-badge" style="font-size:9px;padding:1px 5px;border-radius:2px;background:var(--surface2);border:1px solid var(--border);color:var(--text-muted);">will be locked</span></div>
          <input type="text" class="field-input" id="f-decision-what" placeholder="e.g. Use Lucia Auth instead of next-auth" aria-label="Decision statement" autofocus>
        </div>
        <div>
          <div class="field-label">Why? <span class="immutable-badge" style="font-size:9px;padding:1px 5px;border-radius:2px;background:var(--surface2);border:1px solid var(--border);color:var(--text-muted);">will be locked</span></div>
          <textarea class="field-input" id="f-decision-why" placeholder="Reasoning, alternatives considered, trade-offs accepted..." rows="3" aria-label="Decision reasoning"></textarea>
        </div>
        <div>
          <div class="field-label">How it's going so far (optional — editable later)</div>
          <textarea class="field-input" id="f-decision-notes" placeholder="Any early notes on implementation..." rows="2" aria-label="Decision notes"></textarea>
        </div>
        <div class="modal-note" style="font-size:10px;color:var(--text-muted);font-weight:300;line-height:1.6;background:var(--surface2);border:1px solid var(--border);border-radius:4px;padding:8px 10px;">The first two fields will be locked after saving — they are the historical record. Only "how it went" can be updated as the work evolves.</div>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel-sm" onclick="closeModal()" aria-label="Cancel">cancel</button>
        <button class="btn-ok" onclick="createDecision()" aria-label="Record decision">record decision</button>
      </div>`;
  }

  if (type === 'workspace') {
    content = `
      <div class="modal-header">
        <span class="modal-title" id="modal-title">Create new workspace</span>
        <button class="modal-close" onclick="closeModal()" aria-label="Close modal">×</button>
      </div>
      <div class="modal-body">
        <div>
          <div class="field-label">Workspace name</div>
          <input type="text" class="field-input" id="new-workspace-name" placeholder="e.g. Acme Corp, Project Nova" aria-label="Workspace name" autofocus>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn-cancel-sm" onclick="closeModal()" aria-label="Cancel">cancel</button>
        <button class="btn-ok" onclick="createNewWorkspace()" aria-label="Create workspace">create workspace</button>
      </div>`;
  }

  container.innerHTML = `<div class="modal-overlay" onclick="overlayClick(event)"><div class="modal">${content}</div></div>`;
  setTimeout(() => { const f = container.querySelector('input, textarea'); if (f) f.focus(); }, 80);
}

function closeModal() { document.getElementById('modal-container').innerHTML = ''; }
function overlayClick(e) { if (e.target.classList.contains('modal-overlay')) closeModal(); }

// ─── CREATION FUNCTIONS ────────────────────────────────────────────────────

async function createStrand() {
  const title = document.getElementById('f-strand-title').value.trim();
  if (!title) return;

  try {
    const response = await fetchWithWorkspace('/api/strands', {
      method: 'POST',
      body: JSON.stringify({ title })
    });

    if (response.ok) {
      closeModal();
      const data = await response.json();
      const strandId = data.strand.id;

      await loadStrands();
      selectStrand(strandId);
    } else {
      const data = await response.json();
      showToast(data.error || 'Failed to create strand');
    }
  } catch (error) {
    console.error('Create strand error:', error);
    showToast('An error occurred while creating the strand');
  }
}

async function createTask() {
  const name = document.getElementById('f-task-name').value.trim();
  const assigneeId = document.getElementById('f-task-assignee').value;
  const dueDate = document.getElementById('f-task-due').value;
  const status = document.getElementById('f-task-status').value;
  if (!name || !currentStrandId) return;

  try {
    const response = await fetchWithWorkspace('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({
        strandId: currentStrandId,
        name,
        assigneeId: assigneeId || null,
        dueDate: dueDate || null,
        status,
        origin: true
      })
    });

    if (response.ok) {
      closeModal();
      await loadTasks(currentStrandId);
    } else {
      const data = await response.json();
      showToast(data.error || 'Failed to create task');
    }
  } catch (error) {
    console.error('Create task error:', error);
    showToast('An error occurred while creating the task');
  }
}

async function createDoc() {
  const label = document.getElementById('f-doc-label').value.trim();
  const content = document.getElementById('f-doc-content').value.trim();
  if (!label || !content || !currentStrandId) return;

  try {
    // First, get existing doc to preserve sections
    const docResponse = await fetchWithWorkspace(`/api/strands/${currentStrandId}/doc`);
    let existingSections = [];
    if (docResponse.ok) {
      const docData = await docResponse.json();
      existingSections = docData.doc?.sections || [];
    }

    const newSections = [...existingSections, { label, content }];

    const response = await fetchWithWorkspace('/api/docs', {
      method: 'POST',
      body: JSON.stringify({ strandId: currentStrandId, sections: newSections })
    });

    if (response.ok) {
      closeModal();
      await loadDoc(currentStrandId);
    } else {
      const data = await response.json();
      showToast(data.error || 'Failed to add to doc');
    }
  } catch (error) {
    console.error('Create doc error:', error);
    showToast('An error occurred while adding to the doc');
  }
}

async function createDecision() {
  const what = document.getElementById('f-decision-what').value.trim();
  const why = document.getElementById('f-decision-why').value.trim();
  const notes = document.getElementById('f-decision-notes').value.trim();
  if (!what || !currentStrandId) return;

  try {
    const response = await fetchWithWorkspace('/api/decisions', {
      method: 'POST',
      body: JSON.stringify({ strandId: currentStrandId, what, why, notes })
    });

    if (response.ok) {
      closeModal();
      await loadDecisions(currentStrandId);
      // Add decision marker message to conversation
      try {
        const msgResponse = await fetchWithWorkspace('/api/messages', {
          method: 'POST',
          body: JSON.stringify({
            strandId: currentStrandId,
            content: '',
            cards: [{
              type: 'decision',
              id: Date.now().toString(),
              what,
              why,
              notes
            }],
            isDecision: true
          })
        });
        if (msgResponse.ok) {
          await loadMessages(currentStrandId);
        }
      } catch (msgError) {
        console.error('Error creating decision message:', msgError);
      }
    } else {
      const data = await response.json();
      showToast(data.error || 'Failed to record decision');
    }
  } catch (error) {
    console.error('Create decision error:', error);
    showToast('An error occurred while recording the decision');
  }
}

// ─── AUTHENTICATION & ONBOARDING ───────────────────────────────────────────

async function handleSignup() {
  const name = document.getElementById('s-name').value.trim();
  const email = document.getElementById('s-email').value.trim();
  const password = document.getElementById('s-password').value.trim();

  if (!name || !email || !password) {
    showToast('Please fill in all fields');
    return;
  }

  try {
    const response = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });

    const data = await response.json();

    if (!response.ok) {
      showToast(data.error || 'Signup failed');
      return;
    }

    // Show verification message - user must verify email before logging in
    showToast('Please check your email to verify your account');
    goTo('screen-login');
  } catch (error) {
    console.error('Signup error:', error);
    showToast('An error occurred during signup');
  }
}

async function handleLogin() {
  const email = document.getElementById('l-email').value.trim();
  const password = document.getElementById('l-password').value.trim();

  if (!email || !password) {
    showToast('Please enter email and password');
    return;
  }

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (response.ok) {
      const data = await response.json();
      localStorage.setItem('userId', data.user.id);
      localStorage.setItem('userName', data.user.name);
      if (data.csrfToken) {
        csrfToken = data.csrfToken;
      }
      loadWorkspace();
      goTo('screen-app');
    } else {
      const data = await response.json();
      if (response.status === 403 && data.requiresVerification) {
        // Navigate to verification screen and pre-fill email
        document.getElementById('v-email').value = email;
        document.getElementById('v-password').value = password;
        goTo('screen-verification');
      } else {
        showToast(data.error || 'Login failed');
      }
    }
  } catch (error) {
    console.error('Login error:', error);
    showToast('An error occurred during login');
  }
}

async function handleResendVerification() {
  const email = document.getElementById('v-email').value.trim();
  const password = document.getElementById('v-password').value.trim();

  if (!email || !password) {
    showToast('Please enter email and password');
    return;
  }

  try {
    const response = await fetch('/api/auth/resend-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await response.json();

    if (response.ok) {
      showToast('Verification email sent successfully');
    } else {
      if (response.status === 429) {
        showToast(data.error || 'Please wait before requesting another email');
      } else {
        showToast(data.error || 'Failed to resend verification email');
      }
    }
  } catch (error) {
    console.error('Resend verification error:', error);
    showToast('An error occurred while resending verification email');
  }
}

async function handleLogout() {
  try {
    const response = await fetch('/api/auth/logout', {
      method: 'POST'
    });

    if (response.ok) {
      localStorage.clear();
      goTo('screen-signup');
    }
  } catch (error) {
    console.error('Logout error:', error);
    showToast('An error occurred during logout');
  }
}

async function handleWorkspaceCreation() {
  const name = document.getElementById('w-name').value.trim();
  const firstStrand = document.getElementById('w-strand').value.trim();

  if (!name) {
    showToast('Please enter a workspace name');
    return;
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch('/api/workspace', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name, firstStrand })
    });

    const data = await response.json();

    if (!response.ok) {
      showToast(data.error || 'Workspace creation failed');
      return;
    }

    goTo('screen-invite');
  } catch (error) {
    console.error('Workspace creation error:', error);
    showToast('An error occurred during workspace creation');
  }
}

async function skipWorkspace() {
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch('/api/workspace', {
      method: 'POST',
      headers,
      body: JSON.stringify({})
    });

    const data = await response.json();

    if (!response.ok) {
      showToast(data.error || 'Workspace creation failed');
      return;
    }

    goTo('screen-invite');
  } catch (error) {
    console.error('Workspace creation error:', error);
    showToast('An error occurred during workspace creation');
  }
}

async function createNewWorkspace() {
  const name = document.getElementById('new-workspace-name').value.trim();

  if (!name) {
    showToast('Please enter a workspace name');
    return;
  }

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
    const response = await fetch('/api/workspace', {
      method: 'POST',
      headers,
      body: JSON.stringify({ name })
    });

    const data = await response.json();

    if (!response.ok) {
      showToast(data.error || 'Workspace creation failed');
      return;
    }

    closeModal();
    showToast('Workspace created successfully', 'success');
    await loadWorkspaces();
    await switchWorkspace(data.workspace.id);
  } catch (error) {
    console.error('Create workspace error:', error);
    showToast('An error occurred during workspace creation');
  }
}

async function loadWorkspace() {
  try {
    // Load user info
    const response = await fetch('/api/auth/me');
    if (response.ok) {
      const data = await response.json();
      // Store user info
      localStorage.setItem('userId', data.user.id);
      localStorage.setItem('userName', data.user.name);
      // Store CSRF token
      if (data.csrfToken) {
        csrfToken = data.csrfToken;
      }
      // Update UI with user info
      const userInitial = data.user.name.charAt(0).toUpperCase();
      document.querySelector('.avatar-sm.you').textContent = userInitial;
    }

    // Load workspaces list
    await loadWorkspaces();

    // Determine which workspace to use
    const lastWorkspaceId = localStorage.getItem('lastWorkspaceId');
    if (lastWorkspaceId && userWorkspaces.find(w => w.id === lastWorkspaceId)) {
      currentWorkspaceId = lastWorkspaceId;
    } else if (userWorkspaces.length > 0) {
      currentWorkspaceId = userWorkspaces[0].id;
      localStorage.setItem('lastWorkspaceId', currentWorkspaceId);
    }

    // Update UI with selected workspace
    const workspace = userWorkspaces.find(w => w.id === currentWorkspaceId);
    if (workspace) {
      const workspaceNameEl = document.getElementById('workspace-name');
      if (workspaceNameEl) {
        workspaceNameEl.textContent = workspace.name;
      }
    }

    // Load strands
    await loadStrands();
    // Connect to SSE for real-time updates
    connectSSE();
  } catch (error) {
    console.error('Load workspace error:', error);
  }
}

let currentStrandId = null;

async function loadStrands() {
  try {
    const response = await fetchWithWorkspace('/api/strands');
    if (response.ok) {
      const data = await response.json();
      renderStrands(data.strands);
    }
  } catch (error) {
    console.error('Load strands error:', error);
  }
}

function renderStrands(strands) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  // Clear existing strands and labels
  sidebar.querySelectorAll('.strand-item').forEach(el => el.remove());
  sidebar.querySelectorAll('.sidebar-divider').forEach(el => el.remove());
  sidebar.querySelectorAll('.section-label').forEach(el => el.remove());

  // Hide/show empty state
  const emptySidebar = document.getElementById('empty-sidebar');
  if (emptySidebar) {
    emptySidebar.style.display = strands.length === 0 ? 'block' : 'none';
  }

  // Separate strands into open and resolved
  const openStrands = strands.filter(s => !s.resolved);
  const resolvedStrands = strands.filter(s => s.resolved);

  // Render Open section
  if (openStrands.length > 0) {
    const openLabel = document.createElement('div');
    openLabel.className = 'section-label';
    openLabel.textContent = 'Open';
    sidebar.appendChild(openLabel);

    openStrands.forEach(strand => {
      const item = document.createElement('div');
      item.className = 'strand-item' + (currentStrandId === strand.id ? ' active' : '');
      item.dataset.id = strand.id;
      item.dataset.taskCount = strand._count.tasks;
      item.dataset.decisionCount = strand._count.decisions;
      item.dataset.memberCount = strand.participants?.length || 0;
      item.onclick = () => selectStrand(strand.id);
      item.innerHTML = `
        <div class="strand-title">${escapeHtml(strand.title)}</div>
        <div class="strand-meta">
          <span class="strand-count">${strand._count.messages} messages</span>
        </div>
      `;
      sidebar.appendChild(item);
    });
  }

  // Render Resolved section
  if (resolvedStrands.length > 0) {
    const divider = document.createElement('div');
    divider.className = 'sidebar-divider';
    sidebar.appendChild(divider);

    const resolvedLabel = document.createElement('div');
    resolvedLabel.className = 'section-label';
    resolvedLabel.textContent = 'Resolved';
    sidebar.appendChild(resolvedLabel);

    resolvedStrands.forEach(strand => {
      const item = document.createElement('div');
      item.className = 'strand-item resolved' + (currentStrandId === strand.id ? ' active' : '');
      item.dataset.id = strand.id;
      item.dataset.taskCount = strand._count.tasks;
      item.dataset.decisionCount = strand._count.decisions;
      item.dataset.memberCount = strand.participants?.length || 0;
      item.onclick = () => selectStrand(strand.id);
      item.innerHTML = `
        <div class="strand-title">${escapeHtml(strand.title)}</div>
        <div class="strand-meta">
          <span class="strand-count">${strand._count.messages} messages</span>
        </div>
      `;
      sidebar.appendChild(item);
    });
  }

  // Auto-select strand if none selected
  if (!currentStrandId && strands.length > 0) {
    const lastSelectedId = localStorage.getItem('lastStrandId');
    const lastSelected = strands.find(s => s.id === lastSelectedId);
    if (lastSelected) {
      selectStrand(lastSelected.id);
    } else {
      const firstOpen = strands.find(s => !s.resolved);
      selectStrand((firstOpen || strands[0]).id);
    }
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

async function selectStrand(strandId) {
  currentStrandId = strandId;
  localStorage.setItem('lastStrandId', strandId);

  // Update active state in sidebar
  document.querySelectorAll('.strand-item').forEach(item => {
    item.classList.toggle('active', item.dataset.id === strandId);
  });

  // Update thread title and status
  const strandItem = document.querySelector(`.strand-item[data-id="${strandId}"]`);
  if (strandItem) {
    const strandTitle = strandItem.querySelector('.strand-title')?.textContent || 'Unknown strand';
    const strandResolved = strandItem.classList.contains('resolved');
    const taskCount = strandItem.dataset.taskCount || 0;
    const decisionCount = strandItem.dataset.decisionCount || 0;
    const memberCount = strandItem.dataset.memberCount || 0;
    const threadTitle = document.getElementById('thread-title');
    const threadChips = document.getElementById('thread-chips');
    const messagesContainer = document.getElementById('messages-container');
    const inputArea = document.querySelector('.input-area');
    const resolveBtn = document.getElementById('resolve-btn');

    if (threadTitle) threadTitle.textContent = strandTitle;
    if (threadChips) {
      threadChips.innerHTML = `
        <div class="chip"><div class="chip-dot green"></div>${taskCount} tasks</div>
        <div class="chip"><div class="chip-dot accent"></div>${decisionCount} decisions</div>
        <div class="chip" onclick="openModal('members', '${strandId}')" style="cursor:pointer"><div class="chip-dot blue"></div>${memberCount} members</div>
      `;
    }

    // Show resolve button and update its state
    if (resolveBtn) {
      resolveBtn.style.display = '';
      updateResolveButton(strandResolved);
    }

    // Show input area and reset messages container
    const emptyState = document.getElementById('empty-state');
    if (emptyState) emptyState.style.display = 'none';
    if (messagesContainer) {
      messagesContainer.style.display = '';
    }
    if (inputArea) inputArea.style.display = '';
  }

  // Load messages
  await loadMessages(strandId);

  // Load tasks, decisions, doc
  await loadTasks(strandId);
  await loadDecisions(strandId);
  await loadDoc(strandId);
}

async function loadMessages(strandId) {
  try {
    const response = await fetchWithWorkspace(`/api/strands/${strandId}/messages`);
    if (response.ok) {
      const data = await response.json();
      renderMessages(data.messages);
    }
  } catch (error) {
    console.error('Load messages error:', error);
  }
}

function renderMessages(messages) {
  const container = document.getElementById('messages-container');
  container.innerHTML = '';

  messages.forEach(msg => {
    // Handle decision markers
    if (msg.isDecision) {
      const decision = msg.cards && msg.cards[0] ? msg.cards[0] : {};
      const marker = document.createElement('div');
      marker.className = 'decision-marker';
      marker.innerHTML = `
        <div class="d-line"></div>
        <div class="d-label"><div class="d-icon">✓</div>Decision: ${escapeHtml(decision.what || 'recorded')}</div>
        <div class="d-line"></div>
      `;
      container.appendChild(marker);
      return;
    }

    const group = document.createElement('div');
    group.className = 'msg-group';
    group.dataset.messageId = msg.id;

    const avatarClass = msg.user.id === getCurrentUserId() ? 'you' : 'r';
    const initial = msg.user.name.charAt(0).toUpperCase();

    let cardsHtml = '';
    if (msg.cards && Array.isArray(msg.cards)) {
      msg.cards.forEach(card => {
        if (card.type === 'task') {
          const statusLabels = { open: 'Open', in_progress: 'In Progress', done: 'Done', closed: 'Done' };
          const dueDateStr = card.dueDate ? new Date(card.dueDate).toISOString().split('T')[0] : '';
          cardsHtml += `
            <div class="ctx-card" data-task-id="${card.id}">
              <div class="ctx-head">
                <div class="ctx-type task">TASK</div>
                <div class="ctx-title">${escapeHtml(card.name)}</div>
                <div class="ctx-status">
                  <div class="st-dot ${card.done ? 'done' : ''}"></div>
                  <select class="ctx-status-select" onchange="updateTaskStatus('${card.id}', this.value)" style="font-size:9px;padding:2px 6px;border:1px solid var(--border);border-radius:3px;background:var(--surface2);color:var(--text-dim);">
                    <option value="open" ${card.status === 'open' ? 'selected' : ''}>Open</option>
                    <option value="in_progress" ${card.status === 'in_progress' ? 'selected' : ''}>In Progress</option>
                    <option value="done" ${card.status === 'done' || card.status === 'closed' ? 'selected' : ''}>Done</option>
                  </select>
                </div>
              </div>
              <div class="ctx-body">
                <div style="margin-bottom:8px;">
                  <label style="font-size:9px;color:var(--text-muted);">Assigned to:</label>
                  <select class="ctx-assignee-select ctx-assignee-${card.id}" data-assignee-id="${card.assigneeId || ''}" onchange="updateTaskAssignee('${card.id}', this.value)" style="font-size:9px;padding:2px 6px;border:1px solid var(--border);border-radius:3px;background:var(--surface2);color:var(--text-dim);width:100%;">
                    <option value="">Unassigned</option>
                  </select>
                </div>
                <div>
                  <label style="font-size:9px;color:var(--text-muted);">Due date:</label>
                  <input type="date" class="ctx-due-input" value="${dueDateStr}" onchange="updateTaskDueDate('${card.id}', this.value)" style="font-size:9px;padding:2px 6px;border:1px solid var(--border);border-radius:3px;background:var(--surface2);color:var(--text-dim);width:100%;">
                </div>
              </div>
            </div>
          `;
        }
      });
    }

    group.innerHTML = `
      <div class="msg-av ${avatarClass}">${initial}</div>
      <div class="msg-body">
        <div class="msg-meta">
          <span class="msg-author">${msg.user.name}</span>
          <span class="msg-time">${formatTime(msg.createdAt)}</span>
        </div>
        ${msg.content ? `<div class="msg-text">${msg.content}</div>` : ''}
        ${cardsHtml}
      </div>
    `;

    container.appendChild(group);
  });

  // Scroll to bottom
  container.scrollTop = container.scrollHeight;

  // Load members into assignee selects in task cards
  loadMembersIntoTaskCards();
}

async function loadTasks(strandId) {
  try {
    const response = await fetchWithWorkspace(`/api/strands/${strandId}/tasks`);
    if (response.ok) {
      const data = await response.json();
      renderTasks(data.tasks);
    }
  } catch (error) {
    console.error('Load tasks error:', error);
  }
}

function renderTasks(tasks) {
  const container = document.getElementById('tab-tasks');
  if (tasks.length === 0) {
    container.innerHTML = '<div style="padding:20px 0;text-align:center;color:var(--text-muted);font-size:11px;font-weight:300;">no tasks yet</div>';
    return;
  }

  container.innerHTML = '';
  tasks.forEach(task => {
    const row = document.createElement('div');
    row.className = 'task-row';
    row.onclick = (e) => {
      if (!e.target.classList.contains('t-check')) {
        scrollToTask(task.id);
      }
    };

    const statusLabels = { open: 'Open', in_progress: 'In Progress', closed: 'Done', done: 'Done' };
    const dueDateStr = task.dueDate ? new Date(task.dueDate).toLocaleDateString() : '';
    const assigneeName = task.assignee?.user?.name || '';

    row.innerHTML = `
      <div class="t-check ${task.done || task.status === 'done' ? 'done' : ''}" onclick="event.stopPropagation();toggleTask('${task.id}', ${task.done || task.status === 'done'})"></div>
      <div class="t-info">
        <div class="t-name ${task.done || task.status === 'done' ? 'done' : ''}">${escapeHtml(task.name)}</div>
        <div class="t-meta">
          <span class="t-status">${statusLabels[task.status] || task.status}</span>
          ${assigneeName ? `<span class="t-assignee">• ${escapeHtml(assigneeName)}</span>` : ''}
          ${dueDateStr ? `<span class="t-due">• Due: ${dueDateStr}</span>` : ''}
          <span class="t-origin">• view in conversation</span>
        </div>
      </div>
    `;
    container.appendChild(row);
  });
}

function scrollToTask(taskId) {
  // Find the message with the task card
  const messages = document.querySelectorAll('.msg-group');
  for (const msg of messages) {
    const card = msg.querySelector('.ctx-card');
    if (card && card.onclick && card.onclick.toString().includes(taskId)) {
      msg.scrollIntoView({ behavior: 'smooth', block: 'center' });
      // Highlight the message temporarily
      msg.style.backgroundColor = 'var(--accent-bg)';
      setTimeout(() => {
        msg.style.backgroundColor = '';
      }, 2000);
      break;
    }
  }
}

async function loadMembersIntoAssigneeSelect() {
  try {
    const response = await fetchWithWorkspace('/api/members');
    if (response.ok) {
      const data = await response.json();
      const select = document.getElementById('f-task-assignee');
      if (select) {
        select.innerHTML = '<option value="">Unassigned</option>';
        data.members.forEach(member => {
          const option = document.createElement('option');
          option.value = member.id;
          option.textContent = member.user.name;
          select.appendChild(option);
        });
      }
    }
  } catch (error) {
    console.error('Load members error:', error);
  }
}

async function loadMembersIntoTaskCards() {
  try {
    const response = await fetchWithWorkspace('/api/members');
    if (response.ok) {
      const data = await response.json();

      document.querySelectorAll('.ctx-assignee-select').forEach(select => {
        const assigneeId = select.dataset.assigneeId;

        select.innerHTML = '<option value="">Unassigned</option>';
        data.members.forEach(member => {
          const option = document.createElement('option');
          option.value = member.id;
          option.textContent = member.user.name;
          select.appendChild(option);
        });

        if (assigneeId) {
          select.value = assigneeId;
        }
      });
    }
  } catch (error) {
    console.error('Load members error:', error);
  }
}

async function updateTaskStatus(taskId, status) {
  try {
    console.log('Updating task status:', taskId, status);
    const response = await fetchWithWorkspace(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status })
    });
    if (response.ok) {
      await loadTasks(currentStrandId);
      await loadMessages(currentStrandId);
    } else {
      const data = await response.json();
      console.error('Update task status failed:', data.error);
    }
  } catch (error) {
    console.error('Update task status error:', error);
  }
}

async function updateTaskAssignee(taskId, assigneeId) {
  try {
    console.log('Updating task assignee:', taskId, assigneeId);
    const response = await fetchWithWorkspace(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ assigneeId: assigneeId || null })
    });
    if (response.ok) {
      await loadTasks(currentStrandId);
      await loadMessages(currentStrandId);
    } else {
      const data = await response.json();
      console.error('Update task assignee failed:', data.error);
    }
  } catch (error) {
    console.error('Update task assignee error:', error);
  }
}

async function updateTaskDueDate(taskId, dueDate) {
  try {
    console.log('Updating task due date:', taskId, dueDate);
    const response = await fetchWithWorkspace(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ dueDate: dueDate || null })
    });
    if (response.ok) {
      await loadTasks(currentStrandId);
      await loadMessages(currentStrandId);
    } else {
      const data = await response.json();
      console.error('Update task due date failed:', data.error);
    }
  } catch (error) {
    console.error('Update task due date error:', error);
  }
}

async function loadDecisions(strandId) {
  try {
    const response = await fetchWithWorkspace(`/api/strands/${strandId}/decisions`);
    if (response.ok) {
      const data = await response.json();
      renderDecisions(data.decisions);
    }
  } catch (error) {
    console.error('Load decisions error:', error);
  }
}

function renderDecisions(decisions) {
  const container = document.getElementById('tab-decisions');
  if (decisions.length === 0) {
    container.innerHTML = '<div style="padding:20px 0;text-align:center;color:var(--text-muted);font-size:11px;font-weight:300;">no decisions yet</div>';
    return;
  }

  container.innerHTML = '';
  decisions.forEach((dec, i) => {
    const row = document.createElement('div');
    row.className = 'dec-row';
    row.style.animationDelay = `${i * 0.05}s`;
    row.innerHTML = `
      <div class="dec-what">${escapeHtml(dec.what)}</div>
      ${dec.why ? `
      <div class="dec-field">
        <div class="dec-field-label">Why <span class="immutable-badge">locked</span></div>
        <div class="dec-field-content">${escapeHtml(dec.why)}</div>
      </div>` : ''}
      <div class="dec-field">
        <div class="dec-field-label">How it went</div>
        <div class="dec-notes-content" contenteditable="true" data-decision-id="${dec.id}" onblur="saveDecisionNotes(this)">${dec.notes || ''}</div>
      </div>
      <div class="dec-meta"><span>${new Date(dec.createdAt).toLocaleDateString()}</span></div>
    `;
    container.appendChild(row);
  });
}

async function saveDecisionNotes(el) {
  const decisionId = el.dataset.decisionId;
  const notes = el.innerText.trim();

  try {
    const response = await fetchWithWorkspace(`/api/decisions/${decisionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ notes })
    });

    if (!response.ok) {
      const data = await response.json();
      showToast(data.error || 'Failed to update notes');
      // Revert to original value
      await loadDecisions(currentStrandId);
    }
  } catch (error) {
    console.error('Save decision notes error:', error);
    showToast('An error occurred while updating notes');
    await loadDecisions(currentStrandId);
  }
}

async function loadDoc(strandId) {
  try {
    const response = await fetchWithWorkspace(`/api/strands/${strandId}/doc`);
    if (response.ok) {
      const data = await response.json();
      renderDoc(data.doc);
    }
  } catch (error) {
    console.error('Load doc error:', error);
  }
}

function renderDoc(doc) {
  const container = document.getElementById('tab-doc');
  if (!container) return; // Doc tab was removed
  if (!doc || !doc.sections || doc.sections.length === 0) {
    container.innerHTML = '<div style="padding:20px 0;text-align:center;color:var(--text-muted);font-size:11px;font-weight:300;">no doc yet</div>';
    return;
  }

  container.innerHTML = '';
  doc.sections.forEach(section => {
    const block = document.createElement('div');
    block.className = 'doc-block';
    block.innerHTML = `
      <div class="doc-block-label">${escapeHtml(section.label)}</div>
      <div class="doc-block-content">${escapeHtml(section.content)}</div>
    `;
    container.appendChild(block);
  });
}

function formatTime(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return date.toLocaleDateString();
}

function getCurrentUserId() {
  // This would be stored from the auth/me response
  // For now, return a placeholder
  return localStorage.getItem('userId') || null;
}

async function toggleTask(taskId, done) {
  try {
    const response = await fetchWithWorkspace(`/api/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify({ done: !done, status: !done ? 'done' : 'open' })
    });
    if (response.ok) {
      await loadTasks(currentStrandId);
      await loadMessages(currentStrandId);
    }
  } catch (error) {
    console.error('Toggle task error:', error);
  }
}

async function toggleResolve() {
  if (!currentStrandId) return;

  try {
    // Get current resolved state from the strand item in sidebar
    const strandItem = document.querySelector(`.strand-item[data-id="${currentStrandId}"]`);
    const currentResolved = strandItem && strandItem.classList.contains('resolved');

    const response = await fetchWithWorkspace(`/api/strands/${currentStrandId}`, {
      method: 'PATCH',
      body: JSON.stringify({ resolved: !currentResolved })
    });
    if (response.ok) {
      await loadStrands();
      const data = await response.json();
      updateResolveButton(data.strand.resolved);
    }
  } catch (error) {
    console.error('Toggle resolve error:', error);
  }
}

function updateResolveButton(resolved) {
  const btn = document.getElementById('resolve-btn');
  if (!btn) return;

  if (resolved) {
    btn.textContent = 'resolved';
    btn.style.background = 'var(--green)';
    btn.style.color = 'white';
  } else {
    btn.textContent = 'resolve';
    btn.style.background = 'var(--green-bg)';
    btn.style.color = 'var(--green)';
  }
}

// ─── MESSAGE SENDING ───────────────────────────────────────────────────────

async function sendMessage() {
  const input = document.getElementById('msg-input');
  const sendBtn = document.querySelector('.send-btn');
  const text = input.value.trim();
  if (!text || !currentStrandId) return;

  // Show loading state
  const originalText = sendBtn.textContent;
  sendBtn.textContent = 'sending...';
  sendBtn.disabled = true;

  try {
    const response = await fetchWithWorkspace('/api/messages', {
      method: 'POST',
      body: JSON.stringify({
        strandId: currentStrandId,
        content: text
      })
    });

    if (response.ok) {
      input.value = '';
      await loadMessages(currentStrandId);
    } else {
      const data = await response.json();
      showToast(data.error || 'Failed to send message');
    }
  } catch (error) {
    console.error('Send message error:', error);
    showToast('An error occurred while sending the message');
  } finally {
    // Restore button state
    sendBtn.textContent = originalText;
    sendBtn.disabled = false;
  }
}

// ─── INVITE FUNCTION ──────────────────────────────────────────────────────

function addInvite() {
  const email = document.getElementById('invite-email').value.trim();
  if (!email) return;
  const initials = email[0].toUpperCase();
  const chip = document.createElement('div');
  chip.className = 'invited-chip';
  chip.innerHTML = `<div class="chip-av">${initials}</div><span>${escapeHtml(email)}</span><select class="role-select"><option>member</option><option>admin</option></select><span class="chip-remove" onclick="this.parentElement.remove()">×</span>`;
  document.getElementById('invited-list').appendChild(chip);
  document.getElementById('invite-email').value = '';
}

// ─── MEMBER MANAGEMENT ─────────────────────────────────────────────────────

async function loadMembers(strandId = null) {
  try {
    if (strandId) {
      // Load strand participants
      const response = await fetchWithWorkspace(`/api/strands/${strandId}/participants`);
      if (response.ok) {
        const data = await response.json();
        renderMembers(data.participants, [], true); // true = strand participants mode
      }
    } else {
      // Load workspace members
      const [membersRes, invitationsRes] = await Promise.all([
        fetchWithWorkspace('/api/members'),
        fetchWithWorkspace('/api/invitations')
      ]);

      if (membersRes.ok) {
        const membersData = await membersRes.json();
        let invitations = [];
        if (invitationsRes.ok) {
          const invitationsData = await invitationsRes.json();
          invitations = invitationsData.invitations || [];
        }
        renderMembers(membersData.members, invitations, false);
      }
    }
  } catch (error) {
    console.error('Load members error:', error);
  }
}

function renderMembers(members, invitations = [], isStrandParticipants = false) {
  const body = document.getElementById('members-body');
  if (!body) return;

  if (members.length === 0 && invitations.length === 0) {
    body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted);font-size:11px;">No members yet</div>';
    return;
  }

  let html = '';

  // Render pending invitations first (only for workspace members, not strand participants)
  if (!isStrandParticipants && invitations.length > 0) {
    html += `<div class="section-title">Pending invitations</div>`;

    invitations.forEach(invitation => {
      const initial = invitation.email.charAt(0).toUpperCase();
      html += `
        <div class="member-row">
          <div class="member-av" style="background:var(--accent-color)">?</div>
          <div class="member-info">
            <div class="member-name">${invitation.email}</div>
            <div class="member-email" style="font-size:10px;">Pending invitation</div>
          </div>
          <button class="member-remove" onclick="resendInvitation('${invitation.id}')">resend</button>
          <button class="member-remove" onclick="deleteInvitation('${invitation.id}')">delete</button>
        </div>
      `;
    });
  }

  // Render members
  if (members.length > 0) {
    html += `<div class="section-title">${isStrandParticipants ? 'Participants' : 'Members'}</div>`;

    members.forEach(member => {
      const isYou = member.userId === getCurrentUserId() || member.user?.id === getCurrentUserId();
      const name = member.name || member.user?.name;
      const email = member.email || member.user?.email;
      const role = member.role;
      const initial = name.charAt(0).toUpperCase();
      const avatarClass = name.charAt(0).toLowerCase();

      html += `
        <div class="member-row">
          <div class="member-av ${avatarClass}">${initial}</div>
          <div class="member-info">
            <div class="member-name">${name}${isYou ? ' (you)' : ''}</div>
            <div class="member-email">${email}</div>
          </div>
          ${!isStrandParticipants ? `<span class="member-role ${role}">${role}</span>` : ''}
          ${!isStrandParticipants && !isYou ? '<button class="member-remove" onclick="removeMember(\'' + member.id + '\')">remove</button>' : ''}
        </div>
      `;
    });
  }

  body.innerHTML = html;
}

async function removeMember(memberId) {
  if (!confirm('Are you sure you want to remove this member?')) return;

  try {
    const response = await fetchWithWorkspace(`/api/members/${memberId}`, {
      method: 'DELETE'
    });

    if (response.ok) {
      await loadMembers();
    } else {
      const data = await response.json();
      showToast(data.error || 'Failed to remove member');
    }
  } catch (error) {
    console.error('Remove member error:', error);
    showToast('An error occurred while removing the member');
  }
}

async function resendInvitation(invitationId) {
  try {
    const response = await fetchWithWorkspace(`/api/invitations/${invitationId}/resend`, {
      method: 'POST'
    });

    if (response.ok) {
      showToast('Invitation resent successfully', 'success');
    } else {
      const data = await response.json();
      showToast(data.error || 'Failed to resend invitation');
    }
  } catch (error) {
    console.error('Resend invitation error:', error);
    showToast('An error occurred while resending invitation');
  }
}

async function deleteInvitation(invitationId) {
  try {
    const response = await fetchWithWorkspace(`/api/invitations/${invitationId}`, {
      method: 'DELETE'
    });

    if (response.ok) {
      await loadMembers();
      showToast('Invitation deleted', 'success');
    } else {
      const data = await response.json();
      showToast(data.error || 'Failed to delete invitation');
    }
  } catch (error) {
    console.error('Delete invitation error:', error);
    showToast('An error occurred while deleting invitation');
  }
}

async function inviteMember() {
  const email = document.getElementById('modal-invite-email').value.trim();
  if (!email) {
    showToast('Please enter an email');
    return;
  }

  try {
    const response = await fetchWithWorkspace('/api/invitations', {
      method: 'POST',
      body: JSON.stringify({ email })
    });

    if (response.ok) {
      showToast('Invitation sent successfully', 'success');
      document.getElementById('modal-invite-email').value = '';
    } else {
      const data = await response.json();
      showToast(data.error || 'Failed to send invitation');
    }
  } catch (error) {
    console.error('Invite error:', error);
    showToast('An error occurred while sending invitation');
  }
}

// ─── WIKI ────────────────────────────────────────────────────────────────

async function loadWiki() {
  try {
    const response = await fetchWithWorkspace('/api/wiki/search?filter=all');
    const data = await response.json();
    renderWiki(data.decisions || []);
  } catch (error) {
    console.error('Load wiki error:', error);
  }
}

async function searchWiki(query, filter = 'all') {
  try {
    if (!query || query.trim() === '') {
      loadWiki();
      return;
    }

    const response = await fetchWithWorkspace(`/api/wiki/search?q=${encodeURIComponent(query)}&filter=${filter}`);
    const data = await response.json();
    renderWiki(data.decisions || []);
  } catch (error) {
    console.error('Search wiki error:', error);
  }
}

function renderWiki(decisions) {
  const body = document.getElementById('wiki-body');
  body.innerHTML = '';

  if (decisions.length === 0) {
    body.innerHTML = '<div style="padding:40px;text-align:center;color:var(--text-muted);font-size:12px;font-weight:300;">no decisions found</div>';
    return;
  }

  // Group decisions by strand status
  const open = decisions.filter(d => !d.strand.resolved);
  const resolved = decisions.filter(d => d.strand.resolved);

  function renderDecCard(dec, i) {
    const card = document.createElement('div');
    card.className = 'wiki-dec-card';
    card.style.animationDelay = `${i * 0.04}s`;
    card.onclick = () => {
      switchView('strands', document.getElementById('nav-strands'));
      selectStrand(dec.strand.id);
    };
    card.innerHTML = `
      <div class="wiki-dec-head">
        <div class="wiki-dec-what">${dec.what}</div>
        <div class="wiki-strand-chip">↗ ${dec.strand.title}</div>
      </div>
      <div class="wiki-dec-body">
        ${dec.why ? `
        <div>
          <div class="wiki-field-label">Why <span class="immutable-badge">locked</span></div>
          <div class="wiki-field-content">${dec.why}</div>
        </div>` : ''}
        <div>
          <div class="wiki-field-label">How it went</div>
          <div class="wiki-notes-content" contenteditable="true" data-decision-id="${dec.id}" onblur="saveDecisionNotes(this)">${dec.notes || ''}</div>
        </div>
      </div>
      <div class="wiki-dec-foot">
        <span>${new Date(dec.createdAt).toLocaleDateString()}</span>
        ${dec.strand.resolved ? '<span>·</span><span style="color:var(--green)">strand resolved</span>' : ''}
      </div>
    `;
    return card;
  }

  if (open.length > 0) {
    const label = document.createElement('div');
    label.className = 'wiki-section-label';
    label.textContent = `From open strands (${open.length})`;
    body.appendChild(label);

    open.forEach((dec, i) => {
      body.appendChild(renderDecCard(dec, i));
    });
  }

  if (resolved.length > 0) {
    const label = document.createElement('div');
    label.className = 'wiki-section-label';
    label.style.marginTop = open.length > 0 ? '16px' : '0';
    label.textContent = `From resolved strands (${resolved.length})`;
    body.appendChild(label);

    resolved.forEach((dec, i) => {
      body.appendChild(renderDecCard(dec, i));
    });
  }
}

// ─── KEYBOARD SHORTCUTS ────────────────────────────────────────────────────

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ─── SSE REAL-TIME UPDATES ───────────────────────────────────────────────

let eventSource = null;

function connectSSE() {
  if (eventSource) {
    eventSource.close();
  }

  const url = currentWorkspaceId ? `/api/events?workspaceId=${currentWorkspaceId}` : '/api/events';
  eventSource = new EventSource(url);

  eventSource.addEventListener('message', (e) => {
    try {
      const event = JSON.parse(e.data);
      handleSSEEvent(event);
    } catch (error) {
      console.error('SSE parse error:', error);
    }
  });

  eventSource.addEventListener('error', () => {
    console.error('SSE connection error, reconnecting in 5s...');
    setTimeout(connectSSE, 5000);
  });
}

function handleSSEEvent(event) {
  if (event.type === 'new_message' && event.data.strandId === currentStrandId) {
    loadMessages(currentStrandId);
  }
  if (event.type === 'new_message') {
    loadStrands(); // Update message count in sidebar
  }
}
