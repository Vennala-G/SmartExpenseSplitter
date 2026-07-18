/* ==============================================================
   SMART EXPENSE SPLITTER WITH DEBT SIMPLIFICATION
   script.js — all application logic (vanilla JS, no frameworks)
   ============================================================== */

'use strict';

/* =================================================================
   1. CONSTANTS
================================================================= */

// LocalStorage keys — kept separate so partial data never corrupts the rest
const STORAGE_KEYS = {
  MEMBERS: 'ses_members',
  EXPENSES: 'ses_expenses',
  HISTORY: 'ses_history',       // settled transactions
  THEME: 'ses_theme'
};

// Palette offered when creating/editing a member avatar
const AVATAR_COLORS = [
  '#8b5cf6', '#f43f5e', '#10b981', '#06b6d4',
  '#f59e0b', '#6366f1', '#ec4899', '#14b8a6',
  '#a855f7', '#0ea5e9'
];

// Category → icon + color mapping, used across table rows, charts, pills
const CATEGORY_META = {
  Food:          { icon: 'fa-burger',        color: '#f59e0b' },
  Travel:        { icon: 'fa-plane',         color: '#06b6d4' },
  Rent:          { icon: 'fa-house',         color: '#8b5cf6' },
  Utilities:     { icon: 'fa-bolt',          color: '#eab308' },
  Entertainment: { icon: 'fa-film',          color: '#ec4899' },
  Shopping:      { icon: 'fa-bag-shopping',  color: '#f43f5e' },
  Health:        { icon: 'fa-suitcase-medical', color: '#10b981' },
  Other:         { icon: 'fa-box',           color: '#6366f1' }
};

const CURRENCY_SYMBOL = '₹';
const BALANCE_EPSILON = 0.005; // treat anything smaller than half a paisa as zero

/* =================================================================
   2. APPLICATION STATE
================================================================= */

const state = {
  members: [],          // { id, name, email, color, createdAt }
  expenses: [],          // { id, title, amount, category, date, paidBy, splitBetween[], notes, createdAt }
  history: [],           // settled transactions { id, from, to, amount, date, settledAt }
  currentView: 'landing',
  selectedColor: AVATAR_COLORS[0],
  editingMemberId: null,
  editingExpenseId: null,
  charts: { category: null, member: null }, // Chart.js instances, tracked so we can destroy/rebuild
  confirmAction: null    // callback stashed for the generic confirm modal
};

/* =================================================================
   3. STORAGE LAYER
================================================================= */

/**
 * Persist a piece of state to LocalStorage as JSON.
 * Wrapped in try/catch because LocalStorage can throw (quota, private mode).
 */
function saveToStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.error('Failed to save to localStorage:', err);
    showToast('error', 'Storage Error', 'Could not save data. Your browser storage may be full.');
  }
}

/** Read and parse a piece of state from LocalStorage, with a safe fallback. */
function loadFromStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (err) {
    console.error('Failed to read from localStorage:', err);
    return fallback;
  }
}

/** Load all app data from LocalStorage into `state`. Called once on boot. */
function loadState() {
  state.members = loadFromStorage(STORAGE_KEYS.MEMBERS, []);
  state.expenses = loadFromStorage(STORAGE_KEYS.EXPENSES, []);
  state.history = loadFromStorage(STORAGE_KEYS.HISTORY, []);
}

function persistMembers() { saveToStorage(STORAGE_KEYS.MEMBERS, state.members); }
function persistExpenses() { saveToStorage(STORAGE_KEYS.EXPENSES, state.expenses); }
function persistHistory() { saveToStorage(STORAGE_KEYS.HISTORY, state.history); }

/* =================================================================
   4. GENERAL UTILITIES
================================================================= */

/** Generate a reasonably unique id without any external library. */
function generateId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Format a number as Indian Rupee currency, e.g. 12500.5 -> "₹12,500.50" */
function formatCurrency(amount) {
  const num = Number(amount) || 0;
  const formatted = num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${CURRENCY_SYMBOL}${formatted}`;
}

/** Format a number as currency without decimals, for compact stat cards. */
function formatCurrencyCompact(amount) {
  const num = Number(amount) || 0;
  return `${CURRENCY_SYMBOL}${Math.round(num).toLocaleString('en-IN')}`;
}

/** Format an ISO date string ("2026-07-18") into "18 Jul 2026". */
function formatDate(isoDate) {
  if (!isoDate) return '—';
  const d = new Date(isoDate + 'T00:00:00');
  if (isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Format a full timestamp, used in transaction history. */
function formatDateTime(isoString) {
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

/** Return today's date as YYYY-MM-DD, for pre-filling the date input. */
function todayIso() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60000);
  return local.toISOString().slice(0, 10);
}

/** Escape any characters that could break out of innerHTML strings. */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

/** Produce initials from a full name, e.g. "Priya Sharma" -> "PS". */
function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/** Look up a member by id, returning a safe placeholder if not found. */
function getMember(id) {
  return state.members.find(m => m.id === id) || { id, name: 'Unknown', color: '#6b7280', email: '' };
}

/** Round to 2 decimal places, avoiding floating point artifacts like 99.999999998. */
function round2(num) {
  return Math.round((num + Number.EPSILON) * 100) / 100;
}

/* =================================================================
   5. TOAST NOTIFICATIONS
================================================================= */

const TOAST_ICONS = {
  success: 'fa-circle-check',
  error: 'fa-circle-exclamation',
  info: 'fa-circle-info',
  warning: 'fa-triangle-exclamation'
};

/**
 * Show a floating toast notification.
 * @param {'success'|'error'|'info'|'warning'} type
 * @param {string} title
 * @param {string} message
 */
function showToast(type, title, message) {
  const container = document.getElementById('toastContainer');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <i class="fa-solid ${TOAST_ICONS[type] || TOAST_ICONS.info} toast-icon"></i>
    <div class="toast-content">
      <strong>${escapeHtml(title)}</strong>
      ${message ? `<div style="color:var(--text-muted); margin-top:2px;">${escapeHtml(message)}</div>` : ''}
    </div>
    <button class="toast-close" aria-label="Dismiss"><i class="fa-solid fa-xmark"></i></button>
  `;

  container.appendChild(toast);

  const remove = () => {
    toast.classList.add('removing');
    setTimeout(() => toast.remove(), 320);
  };

  toast.querySelector('.toast-close').addEventListener('click', remove);
  setTimeout(remove, 4200);
}

/* =================================================================
   6. MODAL SYSTEM
================================================================= */

/** Open a modal overlay by its element id. */
function openModal(overlayId) {
  const overlay = document.getElementById(overlayId);
  if (!overlay) return;
  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

/** Close a modal overlay by its element id. */
function closeModal(overlayId) {
  const overlay = document.getElementById(overlayId);
  if (!overlay) return;
  overlay.classList.remove('open');
  document.body.style.overflow = '';
}

/** Wire up every element with [data-close] and click-outside-to-close behaviour. */
function initModalDismissHandlers() {
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.getAttribute('data-close')));
  });

  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay.id);
    });
  });

  // Escape key closes whichever modal is currently open
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.modal-overlay.open').forEach(overlay => closeModal(overlay.id));
  });
}

/**
 * Open the generic confirm modal with custom text and a callback.
 * @param {string} text - message shown to the user
 * @param {Function} onConfirm - called if the user clicks the danger button
 * @param {string} [confirmLabel] - button label, defaults to "Delete"
 */
function openConfirmModal(text, onConfirm, confirmLabel) {
  document.getElementById('confirmModalText').textContent = text;
  const btn = document.getElementById('confirmModalActionBtn');
  btn.innerHTML = `<i class="fa-solid fa-trash"></i> ${escapeHtml(confirmLabel || 'Delete')}`;
  state.confirmAction = onConfirm;
  openModal('confirmModalOverlay');
}

/* =================================================================
   7. NAVIGATION (single-page view switching)
================================================================= */

const VIEW_IDS = ['landing', 'dashboard', 'members', 'expenses', 'settlements', 'history', 'stats'];

/**
 * Switch the visible view, update nav highlighting, and re-render that
 * view's data so it's always fresh when the user lands on it.
 */
function navigateTo(viewName) {
  if (!VIEW_IDS.includes(viewName)) viewName = 'landing';
  state.currentView = viewName;

  VIEW_IDS.forEach(v => {
    const el = document.getElementById(`view-${v}`);
    if (el) el.classList.toggle('active', v === viewName);
  });

  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.getAttribute('data-nav') === viewName);
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });

  // Lazily render whichever view was just opened
  if (viewName === 'dashboard') renderDashboard();
  if (viewName === 'members') renderMembers();
  if (viewName === 'expenses') renderExpenses();
  if (viewName === 'settlements') renderSettlements();
  if (viewName === 'history') renderHistory();
  if (viewName === 'stats') renderStats();

  // Collapse the mobile nav if it was open
  document.getElementById('navLinks').classList.remove('mobile-open');
}

/** Wire every element carrying a [data-nav] attribute to the router above. */
function initNavigation() {
  document.querySelectorAll('[data-nav]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      navigateTo(el.getAttribute('data-nav'));
    });
  });

  document.getElementById('getStartedBtn').addEventListener('click', () => navigateTo('dashboard'));
  document.getElementById('heroStartBtn').addEventListener('click', () => navigateTo('dashboard'));
  document.getElementById('ctaStartBtn').addEventListener('click', () => navigateTo('dashboard'));

  document.getElementById('navBurger').addEventListener('click', () => {
    document.getElementById('navLinks').classList.toggle('mobile-open');
  });
}

/* =================================================================
   8. DARK / LIGHT THEME
================================================================= */

function applyTheme(theme) {
  document.body.setAttribute('data-theme', theme);
  const icon = document.querySelector('#themeToggle i');
  if (icon) icon.className = theme === 'light' ? 'fa-solid fa-sun' : 'fa-solid fa-moon';
  saveToStorage(STORAGE_KEYS.THEME, theme);
  refreshChartsTheme();
}

function initTheme() {
  const saved = loadFromStorage(STORAGE_KEYS.THEME, null);
  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  applyTheme(saved || (prefersLight ? 'light' : 'dark'));

  document.getElementById('themeToggle').addEventListener('click', () => {
    const current = document.body.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    applyTheme(current === 'light' ? 'dark' : 'light');
  });
}

/* =================================================================
   9. MEMBER MANAGEMENT
================================================================= */

/** Render the color swatch picker inside the member modal. */
function renderColorSwatches() {
  const wrap = document.getElementById('memberColorSwatches');
  wrap.innerHTML = AVATAR_COLORS.map(color => `
    <div class="color-swatch ${color === state.selectedColor ? 'selected' : ''}"
         style="background:${color}" data-color="${color}" title="${color}"></div>
  `).join('');

  wrap.querySelectorAll('.color-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      state.selectedColor = swatch.getAttribute('data-color');
      wrap.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
      swatch.classList.add('selected');
    });
  });
}

/** Reset and open the member modal for creating a brand new member. */
function openAddMemberModal() {
  state.editingMemberId = null;
  document.getElementById('memberModalTitle').innerHTML = '<i class="fa-solid fa-user-plus"></i> Add Member';
  document.getElementById('memberForm').reset();
  document.getElementById('memberId').value = '';
  clearFieldError('memberName');
  clearFieldError('memberEmail');
  state.selectedColor = AVATAR_COLORS[state.members.length % AVATAR_COLORS.length];
  renderColorSwatches();
  openModal('memberModalOverlay');
  setTimeout(() => document.getElementById('memberName').focus(), 150);
}

/** Populate and open the member modal for editing an existing member. */
function openEditMemberModal(memberId) {
  const member = state.members.find(m => m.id === memberId);
  if (!member) return;

  state.editingMemberId = memberId;
  document.getElementById('memberModalTitle').innerHTML = '<i class="fa-solid fa-user-pen"></i> Edit Member';
  document.getElementById('memberId').value = member.id;
  document.getElementById('memberName').value = member.name;
  document.getElementById('memberEmail').value = member.email || '';
  clearFieldError('memberName');
  clearFieldError('memberEmail');
  state.selectedColor = member.color;
  renderColorSwatches();
  openModal('memberModalOverlay');
}

/** Show a small red message under a form field and mark the input invalid. */
function setFieldError(inputId, message) {
  const errorEl = document.getElementById(`${inputId}Error`);
  const inputEl = document.getElementById(inputId);
  if (errorEl) errorEl.textContent = message || '';
  if (inputEl) inputEl.classList.toggle('invalid', Boolean(message));
}
function clearFieldError(inputId) { setFieldError(inputId, ''); }

/** Validate the member form; returns true if valid, otherwise shows errors. */
function validateMemberForm(name, email, excludeId) {
  let valid = true;

  if (!name || name.trim().length < 2) {
    setFieldError('memberName', 'Name must be at least 2 characters.');
    valid = false;
  } else if (state.members.some(m => m.name.toLowerCase() === name.trim().toLowerCase() && m.id !== excludeId)) {
    setFieldError('memberName', 'A member with this name already exists.');
    valid = false;
  } else {
    clearFieldError('memberName');
  }

  if (email && email.trim()) {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(email.trim())) {
      setFieldError('memberEmail', 'Enter a valid email address.');
      valid = false;
    } else {
      clearFieldError('memberEmail');
    }
  } else {
    clearFieldError('memberEmail');
  }

  return valid;
}

/** Handle submission of the add/edit member form. */
function handleMemberFormSubmit(e) {
  e.preventDefault();
  const name = document.getElementById('memberName').value;
  const email = document.getElementById('memberEmail').value;

  if (!validateMemberForm(name, email, state.editingMemberId)) return;

  if (state.editingMemberId) {
    const member = state.members.find(m => m.id === state.editingMemberId);
    member.name = name.trim();
    member.email = email.trim();
    member.color = state.selectedColor;
    showToast('success', 'Member updated', `${member.name}'s details were saved.`);
  } else {
    const member = {
      id: generateId('mem'),
      name: name.trim(),
      email: email.trim(),
      color: state.selectedColor,
      createdAt: new Date().toISOString()
    };
    state.members.push(member);
    showToast('success', 'Member added', `${member.name} was added to the group.`);
  }

  persistMembers();
  closeModal('memberModalOverlay');
  renderMembers();
  renderDashboard();
  populateMemberDropdowns();
}

/** Delete a member after checking they have no expenses tied to them. */
function deleteMember(memberId) {
  const member = getMember(memberId);
  const isInvolved = state.expenses.some(exp => exp.paidBy === memberId || exp.splitBetween.includes(memberId));

  if (isInvolved) {
    showToast('error', 'Cannot delete member', `${member.name} is linked to existing expenses. Remove those expenses first.`);
    return;
  }

  openConfirmModal(
    `Delete ${member.name}? This cannot be undone.`,
    () => {
      state.members = state.members.filter(m => m.id !== memberId);
      persistMembers();
      closeModal('confirmModalOverlay');
      renderMembers();
      renderDashboard();
      populateMemberDropdowns();
      showToast('success', 'Member deleted', `${member.name} was removed.`);
    }
  );
}

/** Compute paid / owed / net balance for a single member from all expenses. */
function computeMemberFinancials(memberId) {
  let totalPaid = 0;
  let totalShare = 0;
  let expenseCount = 0;

  state.expenses.forEach(exp => {
    if (exp.paidBy === memberId) {
      totalPaid += exp.amount;
    }
    if (exp.splitBetween.includes(memberId)) {
      totalShare += exp.amount / exp.splitBetween.length;
      expenseCount++;
    }
  });

  const rawBalance = round2(totalPaid - totalShare);
  const netBalance = round2(rawBalance + getSettledAdjustment(memberId));

  return {
    totalPaid: round2(totalPaid),
    totalShare: round2(totalShare),
    rawBalance,
    netBalance,
    expenseCount
  };
}

/** Render every member as a card in the Members view. */
function renderMembers() {
  const grid = document.getElementById('membersGrid');
  const empty = document.getElementById('membersEmpty');

  if (state.members.length === 0) {
    grid.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  grid.innerHTML = state.members.map(member => {
    const fin = computeMemberFinancials(member.id);
    const balanceClass = fin.netBalance > BALANCE_EPSILON ? 'value-positive' : (fin.netBalance < -BALANCE_EPSILON ? 'value-negative' : '');
    const balanceLabel = fin.netBalance > BALANCE_EPSILON ? 'gets back' : (fin.netBalance < -BALANCE_EPSILON ? 'owes' : 'settled');

    return `
      <div class="member-card glass hover-lift" data-member-id="${member.id}">
        <div class="member-card-top">
          <div class="avatar avatar-lg" style="background:${member.color}">${getInitials(member.name)}</div>
          <div>
            <div class="member-card-name">${escapeHtml(member.name)}</div>
            <div class="member-card-email">${escapeHtml(member.email) || 'No email on file'}</div>
          </div>
        </div>
        <div class="member-card-stats">
          <div class="member-stat">
            <span class="member-stat-label">Total Paid</span>
            <span class="member-stat-value">${formatCurrency(fin.totalPaid)}</span>
          </div>
          <div class="member-stat">
            <span class="member-stat-label">${balanceLabel}</span>
            <span class="member-stat-value ${balanceClass}">${formatCurrency(Math.abs(fin.netBalance))}</span>
          </div>
        </div>
        <div class="member-card-actions">
          <button class="icon-btn" data-action="view-member" data-id="${member.id}" title="View details"><i class="fa-solid fa-eye"></i></button>
          <button class="icon-btn" data-action="edit-member" data-id="${member.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
          <button class="icon-btn" data-action="delete-member" data-id="${member.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
        </div>
      </div>
    `;
  }).join('');

  // Delegate clicks for the freshly-rendered cards
  grid.querySelectorAll('[data-action="view-member"]').forEach(btn =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); openMemberDetailModal(btn.getAttribute('data-id')); }));
  grid.querySelectorAll('[data-action="edit-member"]').forEach(btn =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); openEditMemberModal(btn.getAttribute('data-id')); }));
  grid.querySelectorAll('[data-action="delete-member"]').forEach(btn =>
    btn.addEventListener('click', (e) => { e.stopPropagation(); deleteMember(btn.getAttribute('data-id')); }));
  grid.querySelectorAll('.member-card').forEach(card =>
    card.addEventListener('click', () => openMemberDetailModal(card.getAttribute('data-member-id'))));
}

/** Fill every <select> that lists members (paid-by, filter, etc). */
function populateMemberDropdowns() {
  const paidBySelect = document.getElementById('expensePaidBy');
  const filterSelect = document.getElementById('filterMember');

  const optionsHtml = state.members.map(m => `<option value="${m.id}">${escapeHtml(m.name)}</option>`).join('');

  paidBySelect.innerHTML = state.members.length
    ? optionsHtml
    : '<option value="">Add a member first</option>';

  filterSelect.innerHTML = '<option value="">All Members</option>' + optionsHtml;

  renderExpenseMembersChecklist();
}

/** Build the "split between" checklist inside the expense modal. */
function renderExpenseMembersChecklist(checkedIds) {
  const wrap = document.getElementById('expenseMembersChecklist');
  const checked = new Set(checkedIds || []);

  if (state.members.length === 0) {
    wrap.innerHTML = '<p style="color:var(--text-muted); font-size:13px;">Add members before creating an expense.</p>';
    return;
  }

  wrap.innerHTML = state.members.map(m => `
    <label class="check-item ${checked.has(m.id) ? 'checked' : ''}" data-member-id="${m.id}">
      <input type="checkbox" value="${m.id}" ${checked.has(m.id) ? 'checked' : ''} />
      <span>${escapeHtml(m.name)}</span>
    </label>
  `).join('');

  wrap.querySelectorAll('.check-item').forEach(item => {
    const input = item.querySelector('input');
    input.addEventListener('change', () => {
      item.classList.toggle('checked', input.checked);
      updateSplitPreview();
    });
  });

  updateSplitPreview();
}

/** Open the read-only member detail modal with stats and recent expenses. */
function openMemberDetailModal(memberId) {
  const member = getMember(memberId);
  const fin = computeMemberFinancials(memberId);
  const memberExpenses = state.expenses
    .filter(e => e.paidBy === memberId || e.splitBetween.includes(memberId))
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 6);

  document.getElementById('memberDetailTitle').innerHTML = `<i class="fa-solid fa-user"></i> ${escapeHtml(member.name)}`;

  const balanceClass = fin.netBalance > BALANCE_EPSILON ? 'value-positive' : (fin.netBalance < -BALANCE_EPSILON ? 'value-negative' : '');
  const balanceText = fin.netBalance > BALANCE_EPSILON
    ? `Is owed ${formatCurrency(fin.netBalance)}`
    : (fin.netBalance < -BALANCE_EPSILON ? `Owes ${formatCurrency(Math.abs(fin.netBalance))}` : 'All settled up');

  document.getElementById('memberDetailBody').innerHTML = `
    <div style="display:flex; align-items:center; gap:16px; margin-bottom:8px;">
      <div class="avatar avatar-lg" style="background:${member.color}">${getInitials(member.name)}</div>
      <div>
        <div style="font-weight:700; font-size:17px;">${escapeHtml(member.name)}</div>
        <div style="color:var(--text-muted); font-size:13px;">${escapeHtml(member.email) || 'No email on file'}</div>
      </div>
    </div>
    <div class="stat-detail-rows">
      <div class="stat-detail-row"><span><i class="fa-solid fa-hand-holding-dollar"></i> Total Paid</span><span>${formatCurrency(fin.totalPaid)}</span></div>
      <div class="stat-detail-row"><span><i class="fa-solid fa-people-group"></i> Total Share of Expenses</span><span>${formatCurrency(fin.totalShare)}</span></div>
      <div class="stat-detail-row"><span><i class="fa-solid fa-scale-balanced"></i> Net Balance</span><span class="${balanceClass}">${balanceText}</span></div>
      <div class="stat-detail-row"><span><i class="fa-solid fa-receipt"></i> Expenses Involved In</span><span>${fin.expenseCount}</span></div>
    </div>
    <h4 style="margin-top:8px; font-size:14px;">Recent Activity</h4>
    <div class="mini-list">
      ${memberExpenses.length ? memberExpenses.map(exp => {
        const meta = CATEGORY_META[exp.category] || CATEGORY_META.Other;
        const share = round2(exp.amount / exp.splitBetween.length);
        return `
          <div class="mini-list-item">
            <div class="mini-list-icon" style="background:${meta.color}"><i class="fa-solid ${meta.icon}"></i></div>
            <div class="mini-list-content">
              <div class="mini-list-title">${escapeHtml(exp.title)}</div>
              <div class="mini-list-sub">${exp.paidBy === memberId ? 'Paid full amount' : `Share: ${formatCurrency(share)}`} · ${formatDate(exp.date)}</div>
            </div>
            <div class="mini-list-amount">${formatCurrency(exp.amount)}</div>
          </div>
        `;
      }).join('') : '<p style="color:var(--text-muted); font-size:13px;">No expenses yet.</p>'}
    </div>
  `;

  openModal('memberDetailModalOverlay');
}

/* =================================================================
   10. EXPENSE MANAGEMENT
================================================================= */

/** Update the live "₹X split Y ways = ₹Z each" preview inside the expense form. */
function updateSplitPreview() {
  const amount = parseFloat(document.getElementById('expenseAmount').value) || 0;
  const checked = Array.from(document.querySelectorAll('#expenseMembersChecklist input:checked'));
  const preview = document.getElementById('splitPreview');
  const previewText = document.getElementById('splitPreviewText');

  if (checked.length === 0 || amount <= 0) {
    preview.hidden = true;
    return;
  }

  const each = round2(amount / checked.length);
  preview.hidden = false;
  previewText.textContent = `${formatCurrency(amount)} split between ${checked.length} member${checked.length > 1 ? 's' : ''} = ${formatCurrency(each)} each`;
}

/** Reset and open the expense modal for creating a new expense. */
function openAddExpenseModal() {
  if (state.members.length === 0) {
    showToast('warning', 'Add members first', 'You need at least one member before logging an expense.');
    navigateTo('members');
    return;
  }

  state.editingExpenseId = null;
  document.getElementById('expenseModalTitle').innerHTML = '<i class="fa-solid fa-receipt"></i> Add Expense';
  document.getElementById('expenseForm').reset();
  document.getElementById('expenseId').value = '';
  document.getElementById('expenseDate').value = todayIso();
  ['expenseTitle', 'expenseAmount', 'expensePaidBy', 'expenseDate', 'expenseMembers'].forEach(clearFieldError);
  renderExpenseMembersChecklist([]);
  document.getElementById('splitPreview').hidden = true;
  openModal('expenseModalOverlay');
  setTimeout(() => document.getElementById('expenseTitle').focus(), 150);
}

/** Populate and open the expense modal for editing an existing expense. */
function openEditExpenseModal(expenseId) {
  const exp = state.expenses.find(e => e.id === expenseId);
  if (!exp) return;

  state.editingExpenseId = expenseId;
  document.getElementById('expenseModalTitle').innerHTML = '<i class="fa-solid fa-pen"></i> Edit Expense';
  document.getElementById('expenseId').value = exp.id;
  document.getElementById('expenseTitle').value = exp.title;
  document.getElementById('expenseAmount').value = exp.amount;
  document.getElementById('expenseCategory').value = exp.category;
  document.getElementById('expenseDate').value = exp.date;
  document.getElementById('expensePaidBy').value = exp.paidBy;
  document.getElementById('expenseNotes').value = exp.notes || '';
  ['expenseTitle', 'expenseAmount', 'expensePaidBy', 'expenseDate', 'expenseMembers'].forEach(clearFieldError);
  renderExpenseMembersChecklist(exp.splitBetween);
  openModal('expenseModalOverlay');
}

/** Validate the expense form fields; shows inline errors and returns true/false. */
function validateExpenseForm(title, amount, paidBy, date, splitBetween) {
  let valid = true;

  if (!title || title.trim().length < 2) {
    setFieldError('expenseTitle', 'Give the expense a short title.');
    valid = false;
  } else clearFieldError('expenseTitle');

  if (!amount || isNaN(amount) || amount <= 0) {
    setFieldError('expenseAmount', 'Enter an amount greater than 0.');
    valid = false;
  } else clearFieldError('expenseAmount');

  if (!paidBy) {
    setFieldError('expensePaidBy', 'Choose who paid.');
    valid = false;
  } else clearFieldError('expensePaidBy');

  if (!date) {
    setFieldError('expenseDate', 'Pick a date.');
    valid = false;
  } else clearFieldError('expenseDate');

  if (!splitBetween || splitBetween.length === 0) {
    setFieldError('expenseMembers', 'Select at least one member to split this with.');
    valid = false;
  } else clearFieldError('expenseMembers');

  return valid;
}

/** Handle submission of the add/edit expense form. */
function handleExpenseFormSubmit(e) {
  e.preventDefault();

  const title = document.getElementById('expenseTitle').value;
  const amount = parseFloat(document.getElementById('expenseAmount').value);
  const category = document.getElementById('expenseCategory').value;
  const date = document.getElementById('expenseDate').value;
  const paidBy = document.getElementById('expensePaidBy').value;
  const notes = document.getElementById('expenseNotes').value;
  const splitBetween = Array.from(document.querySelectorAll('#expenseMembersChecklist input:checked')).map(i => i.value);

  if (!validateExpenseForm(title, amount, paidBy, date, splitBetween)) return;

  if (state.editingExpenseId) {
    const exp = state.expenses.find(x => x.id === state.editingExpenseId);
    Object.assign(exp, { title: title.trim(), amount: round2(amount), category, date, paidBy, notes: notes.trim(), splitBetween });
    showToast('success', 'Expense updated', `"${exp.title}" was saved.`);
  } else {
    const exp = {
      id: generateId('exp'),
      title: title.trim(),
      amount: round2(amount),
      category,
      date,
      paidBy,
      splitBetween,
      notes: notes.trim(),
      createdAt: new Date().toISOString()
    };
    state.expenses.push(exp);
    showToast('success', 'Expense added', `"${exp.title}" for ${formatCurrency(exp.amount)} was logged.`);
  }

  persistExpenses();
  closeModal('expenseModalOverlay');
  renderExpenses();
  renderDashboard();
  renderMembers();
}

/** Delete an expense after confirmation. */
function deleteExpense(expenseId) {
  const exp = state.expenses.find(x => x.id === expenseId);
  if (!exp) return;

  openConfirmModal(
    `Delete "${exp.title}" (${formatCurrency(exp.amount)})? This cannot be undone.`,
    () => {
      state.expenses = state.expenses.filter(x => x.id !== expenseId);
      persistExpenses();
      closeModal('confirmModalOverlay');
      renderExpenses();
      renderDashboard();
      renderMembers();
      showToast('success', 'Expense deleted', `"${exp.title}" was removed.`);
    }
  );
}

/** Read the current search/filter/sort controls and return matching expenses. */
function getFilteredExpenses() {
  const search = document.getElementById('expenseSearchInput').value.trim().toLowerCase();
  const category = document.getElementById('filterCategory').value;
  const memberId = document.getElementById('filterMember').value;
  const sortBy = document.getElementById('sortExpenses').value;

  let list = state.expenses.filter(exp => {
    const matchesSearch = !search ||
      exp.title.toLowerCase().includes(search) ||
      (exp.notes && exp.notes.toLowerCase().includes(search));
    const matchesCategory = !category || exp.category === category;
    const matchesMember = !memberId || exp.paidBy === memberId || exp.splitBetween.includes(memberId);
    return matchesSearch && matchesCategory && matchesMember;
  });

  list.sort((a, b) => {
    switch (sortBy) {
      case 'date-asc': return new Date(a.date) - new Date(b.date);
      case 'amount-desc': return b.amount - a.amount;
      case 'amount-asc': return a.amount - b.amount;
      case 'date-desc':
      default: return new Date(b.date) - new Date(a.date);
    }
  });

  return list;
}

/** Render the expenses table according to the current filters. */
function renderExpenses() {
  const tbody = document.getElementById('expensesTableBody');
  const empty = document.getElementById('expensesEmpty');
  const table = document.getElementById('expensesTable');
  const list = getFilteredExpenses();

  if (list.length === 0) {
    tbody.innerHTML = '';
    table.style.display = 'none';
    empty.hidden = false;
    return;
  }
  table.style.display = '';
  empty.hidden = true;

  tbody.innerHTML = list.map(exp => {
    const meta = CATEGORY_META[exp.category] || CATEGORY_META.Other;
    const payer = getMember(exp.paidBy);
    const splitAvatars = exp.splitBetween.slice(0, 5).map(id => {
      const m = getMember(id);
      return `<div class="avatar" style="background:${m.color}" title="${escapeHtml(m.name)}">${getInitials(m.name)}</div>`;
    }).join('');
    const extraCount = exp.splitBetween.length > 5 ? `<span style="margin-left:6px; font-size:11.5px; color:var(--text-muted);">+${exp.splitBetween.length - 5}</span>` : '';

    return `
      <tr>
        <td>
          <div class="table-title">${escapeHtml(exp.title)}</div>
          ${exp.notes ? `<div class="table-notes">${escapeHtml(exp.notes)}</div>` : ''}
        </td>
        <td><span class="category-pill"><i class="fa-solid ${meta.icon}" style="color:${meta.color}"></i> ${exp.category}</span></td>
        <td>
          <div style="display:flex; align-items:center; gap:8px;">
            <div class="avatar" style="width:28px;height:28px;font-size:11px;background:${payer.color}">${getInitials(payer.name)}</div>
            ${escapeHtml(payer.name)}
          </div>
        </td>
        <td><div class="split-avatars">${splitAvatars}</div>${extraCount}</td>
        <td class="table-amount">${formatCurrency(exp.amount)}</td>
        <td>${formatDate(exp.date)}</td>
        <td>
          <div class="table-actions">
            <button class="icon-btn" data-action="edit-expense" data-id="${exp.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
            <button class="icon-btn" data-action="delete-expense" data-id="${exp.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('[data-action="edit-expense"]').forEach(btn =>
    btn.addEventListener('click', () => openEditExpenseModal(btn.getAttribute('data-id'))));
  tbody.querySelectorAll('[data-action="delete-expense"]').forEach(btn =>
    btn.addEventListener('click', () => deleteExpense(btn.getAttribute('data-id'))));
}

/** Wire up search/filter/sort controls to re-render the expense table live. */
function initExpenseFilters() {
  ['expenseSearchInput', 'filterCategory', 'filterMember', 'sortExpenses'].forEach(id => {
    const el = document.getElementById(id);
    const evt = id === 'expenseSearchInput' ? 'input' : 'change';
    el.addEventListener(evt, renderExpenses);
  });
}

/* =================================================================
   11. BALANCE CALCULATION & SETTLED-TRANSACTION ADJUSTMENT
================================================================= */

/**
 * How much a member's raw balance shifts because of settlements they've
 * already made or received. Paying down a debt moves your balance toward
 * zero (+= amount); receiving a payment does the same from the other side
 * (-= amount), since it reduces what you're still owed.
 */
function getSettledAdjustment(memberId) {
  let adjustment = 0;
  state.history.forEach(tx => {
    if (tx.from === memberId) adjustment += tx.amount;
    if (tx.to === memberId) adjustment -= tx.amount;
  });
  return round2(adjustment);
}

/**
 * Compute the net balance for every member: how much they paid across all
 * expenses minus their fair share of those same expenses, adjusted for any
 * settlements already recorded. Positive = owed money. Negative = owes money.
 * @returns {Object} map of memberId -> netBalance
 */
function calculateNetBalances() {
  const balances = {};
  state.members.forEach(m => { balances[m.id] = 0; });

  state.expenses.forEach(exp => {
    if (balances[exp.paidBy] === undefined) balances[exp.paidBy] = 0;
    balances[exp.paidBy] += exp.amount;

    const share = exp.amount / exp.splitBetween.length;
    exp.splitBetween.forEach(memberId => {
      if (balances[memberId] === undefined) balances[memberId] = 0;
      balances[memberId] -= share;
    });
  });

  // Apply prior settlements so already-paid debts don't show up again
  state.history.forEach(tx => {
    if (balances[tx.from] !== undefined) balances[tx.from] += tx.amount;
    if (balances[tx.to] !== undefined) balances[tx.to] -= tx.amount;
  });

  Object.keys(balances).forEach(id => { balances[id] = round2(balances[id]); });
  return balances;
}

/* =================================================================
   12. MINIMUM CASH FLOW — DEBT SIMPLIFICATION ALGORITHM
================================================================= */

/**
 * Greedy Minimum Cash Flow algorithm.
 *
 * Given a map of memberId -> netBalance (positive = creditor, negative =
 * debtor), repeatedly match the member owed the MOST money with the member
 * who owes the MOST money, settle the smaller of the two amounts between
 * them, and repeat until every balance is zero. This greedy "largest vs
 * largest" pairing is the standard approach for minimizing the number of
 * transactions needed to settle a group of debts, collapsing what could be
 * O(n^2) pairwise IOUs down to at most (n - 1) transactions.
 *
 * Example: A owes 700, B owes 300, C is owed 1000
 *   -> Step 1: max creditor = C (+1000), max debtor = A (-700)
 *      settle 700 -> "A pays C ₹700"; A now 0, C now +300
 *   -> Step 2: max creditor = C (+300), max debtor = B (-300)
 *      settle 300 -> "B pays C ₹300"; both now 0. Done in 2 transactions.
 *
 * @param {Object} balances - map of memberId -> netBalance
 * @returns {Array<{from:string, to:string, amount:number}>}
 */
function simplifyDebts(balances) {
  // Work on a mutable copy so we never touch the caller's object
  const working = Object.entries(balances)
    .map(([id, amount]) => ({ id, amount: round2(amount) }))
    .filter(entry => Math.abs(entry.amount) > BALANCE_EPSILON);

  const transactions = [];
  let safetyCounter = 0;
  const maxIterations = working.length * working.length + 10; // guards against infinite loops

  while (safetyCounter < maxIterations) {
    safetyCounter++;

    // Find the biggest creditor (most positive) and biggest debtor (most negative)
    let creditor = null;
    let debtor = null;
    working.forEach(entry => {
      if (entry.amount > BALANCE_EPSILON && (!creditor || entry.amount > creditor.amount)) creditor = entry;
      if (entry.amount < -BALANCE_EPSILON && (!debtor || entry.amount < debtor.amount)) debtor = entry;
    });

    // Nobody owes anybody anything anymore — we're done
    if (!creditor || !debtor) break;

    const settleAmount = round2(Math.min(creditor.amount, -debtor.amount));
    if (settleAmount <= BALANCE_EPSILON) break;

    transactions.push({ from: debtor.id, to: creditor.id, amount: settleAmount });

    creditor.amount = round2(creditor.amount - settleAmount);
    debtor.amount = round2(debtor.amount + settleAmount);
  }

  return transactions;
}

/** Convenience wrapper: compute balances fresh, then simplify them. */
function getSimplifiedSettlements() {
  const balances = calculateNetBalances();
  return simplifyDebts(balances);
}

/* =================================================================
   13. SETTLEMENTS VIEW ("Settle Up")
================================================================= */

/** Render the list of suggested minimum-transaction settlements. */
function renderSettlements() {
  const list = document.getElementById('settlementsList');
  const empty = document.getElementById('settlementsEmpty');
  const settlements = getSimplifiedSettlements();

  document.getElementById('settleTxnCount').textContent = settlements.length;
  document.getElementById('settleTotalAmount').textContent = formatCurrency(settlements.reduce((sum, s) => sum + s.amount, 0));

  if (settlements.length === 0) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  list.innerHTML = settlements.map((s, index) => {
    const from = getMember(s.from);
    const to = getMember(s.to);
    return `
      <div class="settlement-item glass">
        <div class="settlement-flow">
          <div class="avatar" style="background:${from.color}">${getInitials(from.name)}</div>
          <div class="settlement-names">
            <strong>${escapeHtml(from.name)}</strong>
            <span style="font-size:12px; color:var(--text-muted);">pays</span>
          </div>
          <div class="settlement-arrow">
            <i class="fa-solid fa-arrow-right"></i>
            <span class="settlement-amount">${formatCurrency(s.amount)}</span>
          </div>
          <div class="avatar" style="background:${to.color}">${getInitials(to.name)}</div>
          <div class="settlement-names">
            <strong>${escapeHtml(to.name)}</strong>
            <span style="font-size:12px; color:var(--text-muted);">receives</span>
          </div>
        </div>
        <button class="btn btn-primary btn-sm" data-action="settle" data-index="${index}">
          <i class="fa-solid fa-check"></i> Mark as Settled
        </button>
      </div>
    `;
  }).join('');

  list.querySelectorAll('[data-action="settle"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const s = settlements[Number(btn.getAttribute('data-index'))];
      markSettlementPaid(s);
    });
  });
}

/** Record a settlement as paid: pushes it to history and refreshes every view. */
function markSettlementPaid(settlement) {
  const from = getMember(settlement.from);
  const to = getMember(settlement.to);

  openConfirmModal(
    `Confirm that ${from.name} paid ${to.name} ${formatCurrency(settlement.amount)}?`,
    () => {
      state.history.push({
        id: generateId('txn'),
        from: settlement.from,
        to: settlement.to,
        amount: settlement.amount,
        settledAt: new Date().toISOString()
      });
      persistHistory();
      closeModal('confirmModalOverlay');
      renderSettlements();
      renderHistory();
      renderDashboard();
      renderMembers();
      showToast('success', 'Settlement recorded', `${from.name} → ${to.name}: ${formatCurrency(settlement.amount)}`);
    },
    'Confirm Payment'
  );
}

/* =================================================================
   14. TRANSACTION HISTORY VIEW
================================================================= */

function renderHistory() {
  const list = document.getElementById('historyList');
  const empty = document.getElementById('historyEmpty');

  if (state.history.length === 0) {
    list.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const sorted = [...state.history].sort((a, b) => new Date(b.settledAt) - new Date(a.settledAt));

  list.innerHTML = sorted.map(tx => {
    const from = getMember(tx.from);
    const to = getMember(tx.to);
    return `
      <div class="settlement-item glass settled">
        <div class="settlement-flow">
          <div class="avatar" style="background:${from.color}">${getInitials(from.name)}</div>
          <div class="settlement-names">
            <strong>${escapeHtml(from.name)}</strong>
            <span style="font-size:12px; color:var(--text-muted);">paid</span>
          </div>
          <div class="settlement-arrow">
            <i class="fa-solid fa-check"></i>
            <span class="settlement-amount">${formatCurrency(tx.amount)}</span>
          </div>
          <div class="avatar" style="background:${to.color}">${getInitials(to.name)}</div>
          <div class="settlement-names">
            <strong>${escapeHtml(to.name)}</strong>
            <span style="font-size:12px; color:var(--text-muted);">received</span>
          </div>
        </div>
        <span class="badge badge-success"><i class="fa-solid fa-check"></i> ${formatDateTime(tx.settledAt)}</span>
      </div>
    `;
  }).join('');
}

/* =================================================================
   15. STATISTICS VIEW (per-member breakdown)
================================================================= */

function renderStats() {
  const grid = document.getElementById('statsGrid');
  const empty = document.getElementById('statsEmpty');

  if (state.members.length === 0) {
    grid.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const totalGroupSpend = state.expenses.reduce((sum, e) => sum + e.amount, 0);

  grid.innerHTML = state.members.map(member => {
    const fin = computeMemberFinancials(member.id);
    const totalReceived = state.history.filter(tx => tx.to === member.id).reduce((sum, tx) => sum + tx.amount, 0);
    const totalPaidToOthers = state.history.filter(tx => tx.from === member.id).reduce((sum, tx) => sum + tx.amount, 0);
    const shareOfGroup = totalGroupSpend > 0 ? round2((fin.totalShare / totalGroupSpend) * 100) : 0;
    const balanceClass = fin.netBalance > BALANCE_EPSILON ? 'value-positive' : (fin.netBalance < -BALANCE_EPSILON ? 'value-negative' : '');
    const balanceText = fin.netBalance > BALANCE_EPSILON
      ? `Owed ${formatCurrency(fin.netBalance)}`
      : (fin.netBalance < -BALANCE_EPSILON ? `Owes ${formatCurrency(Math.abs(fin.netBalance))}` : 'Settled');

    return `
      <div class="stat-detail-card glass hover-lift">
        <div class="stat-detail-head">
          <div class="avatar" style="background:${member.color}">${getInitials(member.name)}</div>
          <div>
            <div style="font-weight:700; font-size:15.5px;">${escapeHtml(member.name)}</div>
            <div style="font-size:12px; color:var(--text-muted);">${fin.expenseCount} expense${fin.expenseCount === 1 ? '' : 's'}</div>
          </div>
        </div>
        <div class="stat-detail-rows">
          <div class="stat-detail-row"><span><i class="fa-solid fa-hand-holding-dollar"></i> Total Spent (Paid)</span><span>${formatCurrency(fin.totalPaid)}</span></div>
          <div class="stat-detail-row"><span><i class="fa-solid fa-people-group"></i> Total Owed (Share)</span><span>${formatCurrency(fin.totalShare)}</span></div>
          <div class="stat-detail-row"><span><i class="fa-solid fa-arrow-up"></i> Total Received (Settled)</span><span>${formatCurrency(totalReceived)}</span></div>
          <div class="stat-detail-row"><span><i class="fa-solid fa-arrow-down"></i> Total Paid Out (Settled)</span><span>${formatCurrency(totalPaidToOthers)}</span></div>
          <div class="stat-detail-row"><span><i class="fa-solid fa-scale-balanced"></i> Net Balance</span><span class="${balanceClass}">${balanceText}</span></div>
        </div>
        <div style="margin-top:12px;">
          <div style="display:flex; justify-content:space-between; font-size:11.5px; color:var(--text-muted);">
            <span>Share of group spend</span><span>${shareOfGroup}%</span>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:${Math.min(shareOfGroup, 100)}%"></div></div>
        </div>
      </div>
    `;
  }).join('');
}

/* =================================================================
   16. DASHBOARD VIEW + CHARTS
================================================================= */

/** Compute the CSS custom property value so Chart.js text matches the theme. */
function getThemeColor(varName) {
  return getComputedStyle(document.body).getPropertyValue(varName).trim();
}

/** Render the four summary stat cards at the top of the dashboard. */
function renderDashboardStats() {
  const totalSpend = state.expenses.reduce((sum, e) => sum + e.amount, 0);
  const settlements = getSimplifiedSettlements();

  document.getElementById('statTotalSpend').textContent = formatCurrencyCompact(totalSpend);
  document.getElementById('statExpenseCount').textContent = state.expenses.length;
  document.getElementById('statMemberCount').textContent = state.members.length;
  document.getElementById('statPendingSettlements').textContent = settlements.length;
}

/** Render the "Recent Expenses" mini list on the dashboard. */
function renderRecentExpenses() {
  const container = document.getElementById('recentExpensesList');
  const empty = document.getElementById('recentExpensesEmpty');
  const recent = [...state.expenses].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);

  if (recent.length === 0) {
    container.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  container.innerHTML = recent.map(exp => {
    const meta = CATEGORY_META[exp.category] || CATEGORY_META.Other;
    const payer = getMember(exp.paidBy);
    return `
      <div class="mini-list-item">
        <div class="mini-list-icon" style="background:${meta.color}"><i class="fa-solid ${meta.icon}"></i></div>
        <div class="mini-list-content">
          <div class="mini-list-title">${escapeHtml(exp.title)}</div>
          <div class="mini-list-sub">Paid by ${escapeHtml(payer.name)} · ${formatDate(exp.date)}</div>
        </div>
        <div class="mini-list-amount">${formatCurrency(exp.amount)}</div>
      </div>
    `;
  }).join('');
}

/** Render the "Net Balances" mini list on the dashboard. */
function renderNetBalancesList() {
  const container = document.getElementById('netBalancesList');
  const empty = document.getElementById('netBalancesEmpty');
  const balances = calculateNetBalances();
  const entries = Object.entries(balances).filter(([, amt]) => Math.abs(amt) > BALANCE_EPSILON);

  if (entries.length === 0) {
    container.innerHTML = '';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  entries.sort((a, b) => b[1] - a[1]);

  container.innerHTML = entries.map(([memberId, amount]) => {
    const member = getMember(memberId);
    const isPositive = amount > 0;
    return `
      <div class="mini-list-item">
        <div class="avatar" style="background:${member.color}">${getInitials(member.name)}</div>
        <div class="mini-list-content">
          <div class="mini-list-title">${escapeHtml(member.name)}</div>
          <div class="mini-list-sub">${isPositive ? 'Should receive' : 'Should pay'}</div>
        </div>
        <div class="mini-list-amount ${isPositive ? 'value-positive' : 'value-negative'}">${formatCurrency(Math.abs(amount))}</div>
      </div>
    `;
  }).join('');
}

/** Build/refresh the category-breakdown doughnut chart. */
function renderCategoryChart() {
  const canvas = document.getElementById('categoryChart');
  const empty = document.getElementById('categoryChartEmpty');

  const totals = {};
  state.expenses.forEach(exp => { totals[exp.category] = (totals[exp.category] || 0) + exp.amount; });
  const labels = Object.keys(totals);

  if (state.charts.category) { state.charts.category.destroy(); state.charts.category = null; }

  if (labels.length === 0) {
    canvas.style.display = 'none';
    empty.hidden = false;
    return;
  }
  canvas.style.display = '';
  empty.hidden = true;

  const colors = labels.map(cat => (CATEGORY_META[cat] || CATEGORY_META.Other).color);
  const textColor = getThemeColor('--text-secondary');

  state.charts.category = new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: labels.map(l => round2(totals[l])),
        backgroundColor: colors,
        borderColor: getThemeColor('--bg-base'),
        borderWidth: 3,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '62%',
      plugins: {
        legend: { position: 'bottom', labels: { color: textColor, boxWidth: 12, padding: 14, font: { size: 12 } } },
        tooltip: { callbacks: { label: (ctx) => `${ctx.label}: ${formatCurrency(ctx.raw)}` } }
      }
    }
  });
}

/** Build/refresh the spend-per-member bar chart. */
function renderMemberChart() {
  const canvas = document.getElementById('memberChart');
  const empty = document.getElementById('memberChartEmpty');

  if (state.charts.member) { state.charts.member.destroy(); state.charts.member = null; }

  if (state.expenses.length === 0 || state.members.length === 0) {
    canvas.style.display = 'none';
    empty.hidden = false;
    return;
  }
  canvas.style.display = '';
  empty.hidden = true;

  const textColor = getThemeColor('--text-secondary');
  const gridColor = getThemeColor('--border-glass');
  const labels = state.members.map(m => m.name);
  const data = state.members.map(m => computeMemberFinancials(m.id).totalPaid);
  const colors = state.members.map(m => m.color);

  state.charts.member = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Amount Paid',
        data,
        backgroundColor: colors,
        borderRadius: 8,
        maxBarThickness: 42
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (ctx) => formatCurrency(ctx.raw) } }
      },
      scales: {
        x: { ticks: { color: textColor, font: { size: 11.5 } }, grid: { display: false } },
        y: { ticks: { color: textColor, callback: (v) => `${CURRENCY_SYMBOL}${v}` }, grid: { color: gridColor } }
      }
    }
  });
}

/** Re-theme any live charts after a dark/light toggle without a full app reload. */
function refreshChartsTheme() {
  if (state.charts.category || state.charts.member) {
    renderCategoryChart();
    renderMemberChart();
  }
}

/** Master dashboard render — calls every sub-renderer for that view. */
function renderDashboard() {
  renderDashboardStats();
  renderRecentExpenses();
  renderNetBalancesList();
  renderCategoryChart();
  renderMemberChart();
}

/* =================================================================
   17. JSON EXPORT / IMPORT
================================================================= */

/** Download the entire ledger (members, expenses, history) as a JSON file. */
function exportData() {
  const payload = {
    exportedAt: new Date().toISOString(),
    app: 'SmartExpenseSplitter',
    version: 1,
    members: state.members,
    expenses: state.expenses,
    history: state.history
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `smart-expense-splitter-backup-${todayIso()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('success', 'Export complete', 'Your ledger was downloaded as a JSON file.');
}

/** Basic structural validation for an imported JSON payload. */
function isValidImportPayload(data) {
  return data && typeof data === 'object' &&
    Array.isArray(data.members) && Array.isArray(data.expenses) && Array.isArray(data.history);
}

/** Handle the hidden file input's change event to import a JSON backup. */
function handleImportFile(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = (evt) => {
    try {
      const data = JSON.parse(evt.target.result);
      if (!isValidImportPayload(data)) {
        showToast('error', 'Import failed', 'That file does not look like a valid Smart Expense Splitter backup.');
        return;
      }

      openConfirmModal(
        `Import ${data.members.length} members and ${data.expenses.length} expenses? This will REPLACE your current data.`,
        () => {
          state.members = data.members;
          state.expenses = data.expenses;
          state.history = data.history;
          persistMembers();
          persistExpenses();
          persistHistory();
          closeModal('confirmModalOverlay');
          populateMemberDropdowns();
          navigateTo('dashboard');
          showToast('success', 'Import complete', 'Your ledger was restored from the backup file.');
        },
        'Import & Replace'
      );
    } catch (err) {
      console.error(err);
      showToast('error', 'Import failed', 'That file is not valid JSON.');
    } finally {
      e.target.value = ''; // allow re-selecting the same file later
    }
  };
  reader.readAsText(file);
}

/* =================================================================
   18. DEMO DATA
================================================================= */

/** Populate the ledger with a small realistic dataset so a first-time visitor can explore. */
function loadDemoData() {
  openConfirmModal(
    'Load demo data? This will REPLACE any members and expenses you currently have.',
    () => {
      const demoMembers = [
        { id: generateId('mem'), name: 'Aarav', email: 'aarav@example.com', color: AVATAR_COLORS[0], createdAt: new Date().toISOString() },
        { id: generateId('mem'), name: 'Diya', email: 'diya@example.com', color: AVATAR_COLORS[1], createdAt: new Date().toISOString() },
        { id: generateId('mem'), name: 'Kabir', email: 'kabir@example.com', color: AVATAR_COLORS[2], createdAt: new Date().toISOString() },
        { id: generateId('mem'), name: 'Meera', email: 'meera@example.com', color: AVATAR_COLORS[3], createdAt: new Date().toISOString() }
      ];
      const [aarav, diya, kabir, meera] = demoMembers.map(m => m.id);
      const allFour = [aarav, diya, kabir, meera];

      const demoExpenses = [
        { id: generateId('exp'), title: 'Weekend Cabin Booking', amount: 8000, category: 'Travel', date: todayIso(), paidBy: aarav, splitBetween: allFour, notes: 'Two nights in the hills', createdAt: new Date().toISOString() },
        { id: generateId('exp'), title: 'Groceries Run', amount: 2400, category: 'Food', date: todayIso(), paidBy: diya, splitBetween: allFour, notes: '', createdAt: new Date().toISOString() },
        { id: generateId('exp'), title: 'Petrol for the trip', amount: 1600, category: 'Travel', date: todayIso(), paidBy: kabir, splitBetween: [aarav, kabir, meera], notes: '', createdAt: new Date().toISOString() },
        { id: generateId('exp'), title: 'Movie Night', amount: 1200, category: 'Entertainment', date: todayIso(), paidBy: meera, splitBetween: [diya, meera], notes: 'IMAX tickets', createdAt: new Date().toISOString() },
        { id: generateId('exp'), title: 'Electricity Bill', amount: 3200, category: 'Utilities', date: todayIso(), paidBy: aarav, splitBetween: allFour, notes: 'Shared flat', createdAt: new Date().toISOString() }
      ];

      state.members = demoMembers;
      state.expenses = demoExpenses;
      state.history = [];
      persistMembers();
      persistExpenses();
      persistHistory();
      closeModal('confirmModalOverlay');
      populateMemberDropdowns();
      navigateTo('dashboard');
      showToast('success', 'Demo data loaded', 'Explore the dashboard, expenses, and settle-up screen.');
    },
    'Load Demo Data'
  );
}

/* =================================================================
   19. EVENT WIRING
================================================================= */

/** Wire all buttons/forms that don't belong to a more specific init function above. */
function initGlobalEventListeners() {
  // Member modal triggers
  document.getElementById('addMemberBtn').addEventListener('click', openAddMemberModal);
  document.getElementById('emptyAddMemberBtn').addEventListener('click', openAddMemberModal);
  document.getElementById('memberForm').addEventListener('submit', handleMemberFormSubmit);

  // Expense modal triggers
  document.getElementById('addExpenseBtn').addEventListener('click', openAddExpenseModal);
  document.getElementById('dashAddExpenseBtn').addEventListener('click', openAddExpenseModal);
  document.getElementById('emptyAddExpenseBtn').addEventListener('click', openAddExpenseModal);
  document.getElementById('emptyAddExpenseBtn2').addEventListener('click', openAddExpenseModal);
  document.getElementById('expenseForm').addEventListener('submit', handleExpenseFormSubmit);
  document.getElementById('expenseAmount').addEventListener('input', updateSplitPreview);

  // Split-between quick actions
  document.getElementById('selectAllMembersBtn').addEventListener('click', () => {
    document.querySelectorAll('#expenseMembersChecklist input').forEach(input => {
      input.checked = true;
      input.closest('.check-item').classList.add('checked');
    });
    updateSplitPreview();
  });
  document.getElementById('clearAllMembersBtn').addEventListener('click', () => {
    document.querySelectorAll('#expenseMembersChecklist input').forEach(input => {
      input.checked = false;
      input.closest('.check-item').classList.remove('checked');
    });
    updateSplitPreview();
  });

  // Confirm modal action button runs whatever callback was stashed
  document.getElementById('confirmModalActionBtn').addEventListener('click', () => {
    if (typeof state.confirmAction === 'function') state.confirmAction();
  });

  // Export / Import
  document.getElementById('exportBtn').addEventListener('click', exportData);
  document.getElementById('importFileInput').addEventListener('change', handleImportFile);

  // Demo data (landing page)
  document.getElementById('heroDemoBtn').addEventListener('click', loadDemoData);
}

/* =================================================================
   20. APP BOOTSTRAP
================================================================= */

document.addEventListener('DOMContentLoaded', () => {
  loadState();
  initTheme();
  initNavigation();
  initModalDismissHandlers();
  initExpenseFilters();
  initGlobalEventListeners();
  populateMemberDropdowns();
  renderColorSwatches();

  // Start on the landing page; every other view renders lazily on first visit
  navigateTo('landing');
});
