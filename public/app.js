/* ===========================
   IPON CHALLENGE — APP LOGIC
   =========================== */

// ==================== CONFIG ====================
const INTEREST_RATE = 0.02; // 2% per annum
const DAILY_RATE = INTEREST_RATE / 365;
const SAVINGS_GOAL = 50000;

// User data is loaded from the server — no credentials stored in frontend
let usersData = {};
let sessionToken = null; // Session token from server

// ==================== SESSION PERSISTENCE ====================
function saveSession(token, role, userKey) {
  sessionToken = token;
  localStorage.setItem('ipon_session', JSON.stringify({ token, role, userKey }));
}

function clearSession() {
  sessionToken = null;
  localStorage.removeItem('ipon_session');
}

function getSavedSession() {
  try {
    const raw = localStorage.getItem('ipon_session');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// Load user list for login dropdown from the server
async function loadUserList() {
  try {
    const response = await fetch('/api/users');
    if (response.ok) {
      const users = await response.json();
      const select = document.getElementById('login-user');
      select.innerHTML = '';
      for (const [key, val] of Object.entries(users)) {
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = val.name;
        select.appendChild(opt);
      }
    }
  } catch (err) {
    console.error('Error loading user list:', err);
  }
}

loadUserList();

// ==================== AUTH HELPERS ====================
function getAuthHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (sessionToken) {
    headers['Authorization'] = `Bearer ${sessionToken}`;
  }
  return headers;
}

// Removed saveData() since we use individual CRUD endpoints now
async function loadData() {
  // 1. Initial Load from LocalStorage (Fastest)
  const saved = localStorage.getItem('ipon_challenge_v1');
  if (saved) {
    try {
      usersData = JSON.parse(saved);
      refreshDashboard();
    } catch (e) { console.error(e); }
  }

  // 2. Sync from Express Backend (requires auth token)
  if (!sessionToken) return;

  try {
    const response = await fetch('/api/data', {
      headers: getAuthHeaders()
    });
    if (response.ok) {
      const serverData = await response.json();
      if (serverData) {
        console.log("Cloud data loaded, syncing locally...");
        usersData = serverData;
        localStorage.setItem('ipon_challenge_v1', JSON.stringify(usersData));
        if (currentUser || currentRole === 'admin') {
          refreshDashboard();
        }
      }
    }
  } catch (err) {
    console.error("Error loading data from server:", err);
  }
}

// ==================== STATE ====================
let currentRole = null; // 'admin' or 'user'
let currentUser = null; // user key
let selectedUser = 'all'; // user key or 'all'
let selectedSubAccount = 'all'; // sub-account key or 'all'
let currentPage = 1;
const ROWS_PER_PAGE = 8;
let lineChart = null;
let barChart = null;

const notyf = new Notyf({
  duration: 4000,
  position: { x: 'right', y: 'top' },
  types: [
    { type: 'success', className: 'notyf-theme notyf-success', background: 'transparent', icon: { className: 'notyf-icon-success', tagName: 'i' } },
    { type: 'error', className: 'notyf-theme notyf-error', background: 'transparent', icon: { className: 'notyf-icon-error', tagName: 'i' } }
  ]
});

// ==================== TUTORIAL DATA ====================
let tutorialStepIndex = 0;
const tutorialSteps = [
  { target: null, title: "Welcome to Ipon Challenge!", text: "Your smart savings journey starts here! Let's take a 1-minute tour of your new dashboard.", icon: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>' },
  { target: "#cards-grid", title: "Smart Stats Overview", text: "At the top, you'll see your combined Balance, Interest earned, and overall progress across all savings goals.", icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>' },
  { target: "#progress-section", title: "Your Sub-Accounts", text: "Each goal (like 'Vacation' or 'Emergency Fund') is tracked separately. View your specific daily targets and progress here.", icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>' },
  { target: ".charts-section", title: "Growth Visuals", text: "Watch your money grow with interactive charts showing your cumulative deposits and monthly performance.", icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M18 9l-6 6-2-2-4 4"/></svg>' },
  { target: ".table-section", title: "Transaction History", text: "View your full transaction log here. Admins can manage specific entries or export everything as CSV.", icon: '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>' },
  { target: null, title: "Ready to Save!", text: "You're all set! Feel free to explore and enjoy the Ipon Challenge experience. Happy saving!", icon: '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>' }
];

// ==================== CUSTOM DIALOG LOGIC ====================
function showDialog(title, message, type = 'alert', style = 'info') {
  return new Promise((resolve) => {
    const modal = document.getElementById('dialog-modal');
    const titleEl = document.getElementById('dialog-title');
    const messageEl = document.getElementById('dialog-message');
    const iconCont = document.getElementById('dialog-icon');
    const okBtn = document.getElementById('dialog-ok-btn');
    const cancelBtn = document.getElementById('dialog-cancel-btn');

    titleEl.textContent = title;
    messageEl.textContent = message;

    // Set Icon
    iconCont.className = 'dialog-icon-container ' + style;
    if (style === 'danger') {
      iconCont.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
    } else {
      iconCont.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>';
    }

    // Configure buttons
    cancelBtn.style.display = type === 'confirm' ? '' : 'none';
    okBtn.textContent = type === 'confirm' ? 'Confirm' : 'OK';
    okBtn.className = style === 'danger' ? 'btn btn-danger' : 'btn btn-primary';

    modal.style.display = 'flex';

    const cleanup = () => {
      modal.style.display = 'none';
      okBtn.removeEventListener('click', onOk);
      cancelBtn.removeEventListener('click', onCancel);
    };

    function onOk() { cleanup(); resolve(true); }
    function onCancel() { cleanup(); resolve(false); }

    okBtn.addEventListener('click', onOk);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// ==================== INTEREST COMPUTATION ====================
function computeSubAccountData(subAccount) {
  const deposits = [...subAccount.deposits].sort((a, b) => new Date(a.date) - new Date(b.date));
  if (deposits.length === 0) {
    return { totalDeposited: 0, interest: 0, balance: 0, monthsElapsed: 0 };
  }

  const firstDepositDate = new Date(deposits[0].date);
  const now = new Date();
  const monthsElapsed = Math.max(0,
    (now.getFullYear() - firstDepositDate.getFullYear()) * 12 +
    (now.getMonth() - firstDepositDate.getMonth())
  );

  let totalDeposited = 0;
  let interest = 0;
  let balance = 0;

  deposits.forEach(dep => {
    if (dep.label && (dep.label === "Interest Earned" || dep.label.includes("Interest Income"))) {
      interest += dep.amount;
    } else {
      totalDeposited += dep.amount;
    }
    balance += dep.amount;
  });

  return { totalDeposited, interest, balance, monthsElapsed };
}

function getAllSubAccountsForView() {
  const result = [];
  const users = currentRole === 'admin' ? Object.keys(usersData) : [currentUser];

  users.forEach(userKey => {
    const user = usersData[userKey];
    if (!user) return; // Skip if user not found (safety check)
    if (!user.subAccounts) user.subAccounts = {}; // Safety check

    Object.keys(user.subAccounts).forEach(saKey => {
      const sa = user.subAccounts[saKey];
      if (!sa) return;
      const computed = computeSubAccountData(sa);
      result.push({
        userKey,
        userName: user.name || userKey,
        saKey,
        label: sa.label || "Unnamed Account",
        goal: sa.goal || 1, // Avoid division by zero
        dailyDeposit: sa.dailyDeposit || 0,
        deposits: sa.deposits || [],
        ...computed,
      });
    });
  });

  return result;
}

function getFilteredSubAccounts() {
  let all = getAllSubAccountsForView();

  // Filter by user first if not 'all'
  if (currentRole === 'admin' && selectedUser !== 'all') {
    all = all.filter(sa => sa.userKey === selectedUser);
  }

  // Then filter by sub-account if not 'all'
  if (selectedSubAccount !== 'all') {
    return all.filter(sa => sa.saKey === selectedSubAccount);
  }

  return all;
}

// ==================== FORMAT HELPERS ====================
function formatPeso(amount) {
  return '₱' + amount.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Ensures consistent YYYY-MM-DD from local date object
 * Fixes timezone shift issues with toISOString()
 */
function toLocalDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// ==================== COUNT-UP ANIMATION ====================
function animateValue(el, start, end, prefix = '', suffix = '', duration = 1200) {
  const startTime = performance.now();
  const isDecimal = Math.abs(end) >= 1 ? end % 1 !== 0 || end > 100 : true;

  function update(currentTime) {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = start + (end - start) * eased;

    if (isDecimal && prefix === '₱') {
      el.textContent = prefix + current.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + suffix;
    } else {
      el.textContent = prefix + Math.round(current).toLocaleString('en-PH') + suffix;
    }

    if (progress < 1) {
      requestAnimationFrame(update);
    }
  }

  requestAnimationFrame(update);
}

// ==================== RENDER FUNCTIONS ====================

function renderCards() {
  const subs = getFilteredSubAccounts();
  const totalSaved = subs.reduce((s, sa) => s + sa.balance, 0);
  const totalInterest = subs.reduce((s, sa) => s + sa.interest, 0);
  const maxMonths = subs.reduce((m, sa) => Math.max(m, sa.monthsElapsed), 0);
  const avgProgress = subs.length > 0
    ? subs.reduce((s, sa) => s + (sa.balance / sa.goal) * 100, 0) / subs.length
    : 0;

  const elTotal = document.getElementById('stat-total-saved');
  const elInterest = document.getElementById('stat-interest');
  const elMonths = document.getElementById('stat-months');
  const elGoal = document.getElementById('stat-goal');

  animateValue(elTotal, 0, totalSaved, '₱');
  animateValue(elInterest, 0, totalInterest, '₱');
  animateValue(elMonths, 0, maxMonths);
  animateValue(elGoal, 0, Math.min(avgProgress, 100), '', '%');

  document.querySelectorAll('.stat-card').forEach((card, i) => {
    card.classList.remove('animate-in');
    void card.offsetWidth;
    card.classList.add('animate-in');
  });
}

function renderProgressCards() {
  const subs = getFilteredSubAccounts();
  const grid = document.getElementById('progress-grid');
  grid.innerHTML = ''; // Always clear first

  if (subs.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 4rem 2rem; background: var(--bg-card); border: 2px dashed var(--border); border-radius: var(--radius); color: var(--text-muted);">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 1rem; opacity: 0.5;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <p style="font-size: 1.1rem; font-weight: 600; color: var(--text-secondary);">No Sub-Accounts Found</p>
        <p style="font-size: 0.9rem; margin-top: 0.25rem;">Ask an admin to assign sub-accounts to your profile.</p>
      </div>
    `;
    return;
  }

  subs.forEach((sa, idx) => {
    const progress = Math.min((sa.balance / sa.goal) * 100, 100);

    const card = document.createElement('div');
    card.className = 'progress-card animate-in';
    card.style.animationDelay = `${idx * 0.08}s`;

    const dailyInfo = sa.dailyDeposit ? `
      <div class="progress-stat-item">
        <div class="label">Daily</div>
        <div class="value">${formatPeso(sa.dailyDeposit)}</div>
      </div>
    ` : '';

    card.innerHTML = `
      <div class="progress-card-header">
        <h4>${sa.label}</h4>
        <span class="badge">${sa.userName}</span>
      </div>
      <div class="progress-stats">
        <div class="progress-stat-item balance-item">
          <div class="label">Balance</div>
          <div class="value">${formatPeso(sa.balance)}</div>
        </div>
        ${dailyInfo}
        <div class="progress-stat-item">
          <div class="label">Goal</div>
          <div class="value">${formatPeso(sa.goal)}</div>
        </div>
      </div>
      <div class="progress-bar-wrapper">
        <div class="progress-bar-label">
          <span>Progress</span>
          <span>${progress.toFixed(1)}%</span>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width: 0%;"></div>
        </div>
      </div>
    `;

    card.onclick = () => openSubAccountDetails(sa.userKey, sa.saKey);

    grid.appendChild(card);

    setTimeout(() => {
      const fill = card.querySelector('.progress-bar-fill');
      if (fill) fill.style.width = `${progress}%`;
    }, 300 + idx * 100);
  });
}

function renderTransactionTable() {
  const subs = getFilteredSubAccounts();
  const tbody = document.getElementById('transaction-tbody');
  const searchTerm = document.getElementById('table-search').value.toLowerCase();

  let allTx = [];
  subs.forEach(sa => {
    sa.deposits.forEach((dep, idx) => {
      allTx.push({
        date: dep.date,
        userName: sa.userName,
        userKey: sa.userKey,
        saKey: sa.saKey,
        saLabel: sa.label,
        type: dep.label || 'Deposit',
        amount: dep.amount,
        index: idx,
      });
    });
  });

  allTx.sort((a, b) => new Date(b.date) - new Date(a.date));

  if (searchTerm) {
    allTx = allTx.filter(tx =>
      tx.userName.toLowerCase().includes(searchTerm) ||
      tx.label.toLowerCase().includes(searchTerm) ||
      tx.date.includes(searchTerm) ||
      tx.amount.toString().includes(searchTerm)
    );
  }

  const totalPages = Math.max(1, Math.ceil(allTx.length / ROWS_PER_PAGE));
  if (currentPage > totalPages) currentPage = totalPages;
  const start = (currentPage - 1) * ROWS_PER_PAGE;
  const pageTx = allTx.slice(start, start + ROWS_PER_PAGE);

  tbody.innerHTML = '';
  if (pageTx.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:2rem;color:var(--text-muted)">No transactions found</td></tr>';
  } else {
    pageTx.forEach(tx => {
      const tr = document.createElement('tr');
      const isNegative = tx.amount < 0;
      const amountClass = isNegative ? 'amount-cell negative' : 'amount-cell';
      const amountPrefix = isNegative ? '' : '+';

      tr.innerHTML = `
        <td data-label="Date">${formatDate(tx.date)}</td>
        <td data-label="User">${tx.userName}</td>
        <td data-label="Type">${tx.type}</td>
        <td data-label="Account">${tx.saLabel}</td>
        <td data-label="Amount" class="${amountClass}">${amountPrefix}${formatPeso(tx.amount)}</td>
        <td data-label="Actions" class="admin-only">
          <div class="actions-cell">
            <button class="btn-icon" onclick="openEditTransaction('${tx.userKey}', '${tx.saKey}', ${tx.index})">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            <button class="btn-icon btn-danger" onclick="deleteTransaction('${tx.userKey}', '${tx.saKey}', ${tx.index})">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
            </button>
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });
  }
  renderPagination(totalPages);
}

function renderPagination(totalPages) {
  const container = document.getElementById('pagination');
  container.innerHTML = '';
  if (totalPages <= 1) return;

  const prevBtn = document.createElement('button');
  prevBtn.className = 'page-btn';
  prevBtn.textContent = '‹';
  prevBtn.disabled = currentPage === 1;
  prevBtn.onclick = () => { currentPage--; renderTransactionTable(); };
  container.appendChild(prevBtn);

  for (let i = 1; i <= totalPages; i++) {
    const btn = document.createElement('button');
    btn.className = 'page-btn' + (i === currentPage ? ' active' : '');
    btn.textContent = i;
    btn.onclick = () => { currentPage = i; renderTransactionTable(); };
    container.appendChild(btn);
  }

  const nextBtn = document.createElement('button');
  nextBtn.className = 'page-btn';
  nextBtn.textContent = '›';
  nextBtn.disabled = currentPage === totalPages;
  nextBtn.onclick = () => { currentPage++; renderTransactionTable(); };
  container.appendChild(nextBtn);
}

// ==================== CHARTS ====================
const CHART_COLORS = ['#2c7be5', '#00b894', '#6c5ce7', '#e17055', '#fdcb6e', '#00cec9', '#e84393', '#636e72'];

function getChartFontColor() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? '#94a3b8' : '#64748b';
}

function getChartGridColor() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'rgba(148,163,184,0.1)' : 'rgba(0,0,0,0.06)';
}

function renderCharts() {
  const subs = getFilteredSubAccounts();
  const fontColor = getChartFontColor();
  const gridColor = getChartGridColor();

  const monthsSet = new Set();
  subs.forEach(sa => {
    sa.deposits.forEach(dep => {
      const d = new Date(dep.date);
      monthsSet.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    });
  });

  // If no data, show at least current month
  if (monthsSet.size === 0) {
    const now = new Date();
    monthsSet.add(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  }

  const months = [...monthsSet].sort();
  const monthLabels = months.map(m => {
    const [y, mo] = m.split('-');
    return new Date(y, mo - 1).toLocaleDateString('en-PH', { month: 'short', year: 'numeric' });
  });

  // Dynamic Width Logic: Force more spreading to ensure horizontal scrolling
  const minWidthPerMonth = 100; // Balanced for fit vs scroll
  const totalMinWidth = Math.max(monthLabels.length * minWidthPerMonth, 500);

  const lWrapper = document.getElementById('line-chart-wrapper');
  const bWrapper = document.getElementById('bar-chart-wrapper');
  lWrapper.style.width = totalMinWidth + 'px';
  bWrapper.style.width = totalMinWidth + 'px';

  const lineDatasets = subs.map((sa, idx) => {
    let cumulative = 0;
    const data = months.map(m => {
      const monthDeposits = sa.deposits.filter(dep => {
        const d = new Date(dep.date);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === m;
      });
      cumulative += monthDeposits.reduce((s, dep) => s + dep.amount, 0);
      return cumulative;
    });
    return {
      label: `${sa.label} (${sa.userName})`,
      data,
      borderColor: CHART_COLORS[idx % CHART_COLORS.length],
      backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] + '20',
      fill: true, tension: 0.4, pointRadius: 5, pointHoverRadius: 7, borderWidth: 2.5,
    };
  });

  const barDatasets = subs.map((sa, idx) => {
    const data = months.map(m => {
      return sa.deposits.filter(dep => {
        const d = new Date(dep.date);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === m;
      }).reduce((s, dep) => s + dep.amount, 0);
    });
    return {
      label: `${sa.label} (${sa.userName})`,
      data,
      backgroundColor: CHART_COLORS[idx % CHART_COLORS.length] + 'CC',
      borderColor: CHART_COLORS[idx % CHART_COLORS.length],
      borderWidth: 1, borderRadius: 6,
      barPercentage: 0.5, // Make bars thinner
      categoryPercentage: 0.8,
    };
  });

  const commonOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        align: 'start',
        labels: {
          color: fontColor,
          font: { family: "'Inter', sans-serif", size: 11 },
          usePointStyle: true,
          pointStyle: 'circle',
          padding: 12
        }
      },
      tooltip: {
        backgroundColor: 'rgba(15,23,42,0.9)', padding: 12, cornerRadius: 8,
        callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${formatPeso(ctx.parsed.y)}` }
      },
    },
    scales: {
      x: { grid: { color: gridColor }, ticks: { color: fontColor, font: { family: "'Inter', sans-serif", size: 10 } } },
      y: { grid: { color: gridColor }, ticks: { color: fontColor, font: { family: "'Inter', sans-serif", size: 10 }, callback: v => '₱' + v.toLocaleString() } },
    },
    animation: { duration: 1200, easing: 'easeOutQuart' },
  };

  if (lineChart) lineChart.destroy();
  if (barChart) barChart.destroy();

  const lCtx = document.getElementById('line-chart').getContext('2d');
  lineChart = new Chart(lCtx, { type: 'line', data: { labels: monthLabels, datasets: lineDatasets }, options: commonOptions });

  const bCtx = document.getElementById('bar-chart').getContext('2d');
  barChart = new Chart(bCtx, { type: 'bar', data: { labels: monthLabels, datasets: barDatasets }, options: commonOptions });

  // Auto-scroll to the right so latest data is visible
  setTimeout(() => {
    document.querySelectorAll('.chart-container').forEach(container => {
      container.scrollTo({ left: container.scrollWidth, behavior: 'smooth' });
    });
  }, 500);
}

// ==================== SELECTORS & MODALS ====================
function populateSubAccountSelector() {
  const select = document.getElementById('subaccount-select');
  select.innerHTML = '<option value="all">All Accounts</option>';

  const allSubs = getAllSubAccountsForView();
  let filtered = allSubs;

  if (currentRole === 'admin' && selectedUser !== 'all') {
    filtered = allSubs.filter(sa => sa.userKey === selectedUser);
  }

  filtered.forEach(sa => {
    const opt = document.createElement('option');
    opt.value = sa.saKey;
    opt.textContent = `${sa.label} (${sa.userName})`;
    select.appendChild(opt);
  });

  // Reset selectedSubAccount if it's no longer in the filtered list
  if (selectedSubAccount !== 'all' && !filtered.find(sa => sa.saKey === selectedSubAccount)) {
    selectedSubAccount = 'all';
  }

  select.value = selectedSubAccount;
}

function populateUserFilter() {
  const filter = document.getElementById('user-filter');
  if (currentRole !== 'admin') {
    filter.style.display = 'none';
    return;
  }

  filter.style.display = '';
  filter.innerHTML = '<option value="all">All Users</option>';
  Object.keys(usersData).forEach(uK => {
    const opt = document.createElement('option');
    opt.value = uK;
    opt.textContent = usersData[uK].name;
    filter.appendChild(opt);
  });
  filter.value = selectedUser;
}

function populateDepositModal() {
  const userSelect = document.getElementById('deposit-user');
  userSelect.innerHTML = '';
  
  let addedUsers = 0;
  Object.keys(usersData).forEach(key => {
    // Regular users can only deposit to themselves
    if (currentRole === 'user' && key !== currentUser) return;

    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = usersData[key].name;
    userSelect.appendChild(opt);
    addedUsers++;
  });

  if (addedUsers === 0) {
    const opt = document.createElement('option');
    opt.disabled = true;
    opt.textContent = 'No available users';
    userSelect.appendChild(opt);
  }

  updateDepositSubAccounts();
  document.getElementById('deposit-date').value = new Date().toISOString().split('T')[0];
}

function updateDepositSubAccounts() {
  const userKey = document.getElementById('deposit-user').value;
  const saSelect = document.getElementById('deposit-subaccount');
  saSelect.innerHTML = '';
  
  if (userKey && usersData[userKey] && usersData[userKey].subAccounts) {
    const saKeys = Object.keys(usersData[userKey].subAccounts);
    if (saKeys.length === 0) {
      const opt = document.createElement('option');
      opt.value = "";
      opt.disabled = true;
      opt.selected = true;
      opt.textContent = 'No Sub-Accounts (Create one first)';
      saSelect.appendChild(opt);
    } else {
      saKeys.forEach(saKey => {
        const opt = document.createElement('option');
        opt.value = saKey;
        opt.textContent = usersData[userKey].subAccounts[saKey].label;
        saSelect.appendChild(opt);
      });
    }
  }
}

async function submitDeposit() {
  const u = document.getElementById('deposit-user').value;
  const s = document.getElementById('deposit-subaccount').value;
  const a = parseFloat(document.getElementById('deposit-amount').value);
  const d = document.getElementById('deposit-date').value;
  
  if (!s || s === "") {
    await showDialog('Invalid Target', 'Please select a valid sub-account. You may need to create one first.', 'alert', 'danger');
    return;
  }
  
  if (!a || a <= 0 || !d) {
    await showDialog('Invalid Input', 'Common! Please enter a valid amount and date.', 'alert', 'danger');
    return;
  }
  
  try {
    const res = await fetch('/api/transactions', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ sub_account_id: s, user_id: u, amount: a, date: d })
    });
    
    if (!res.ok) throw new Error('Deposit failed');
    
    await loadData();
    document.getElementById('deposit-modal').style.display = 'none';
    document.getElementById('deposit-amount').value = '';
    refreshDashboard();
    notyf.success('Deposit recorded successfully!');
  } catch (err) {
    console.error(err);
    notyf.error('Failed to record deposit.');
  }
}

function refreshDashboard() {
  applyDailyInterest();
  renderCards();
  renderProgressCards();
  renderTransactionTable();
  renderCharts();
}

// ==================== LOGIN / LOGOUT ====================
async function handleLogin() {
  const role = document.getElementById('login-role').value;
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.style.display = 'none';

  const userKey = role === 'user' ? document.getElementById('login-user').value : null;

  try {
    const response = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, userKey, password })
    });

    const result = await response.json();

    if (!response.ok) {
      errorEl.textContent = result.message || 'Login failed.';
      errorEl.style.display = 'block';
      return;
    }

    currentRole = result.role;
    currentUser = result.userKey || null;
    saveSession(result.token, result.role, result.userKey || null);
  } catch (err) {
    errorEl.textContent = 'Network error. Is the server running?';
    errorEl.style.display = 'block';
    return;
  }

  // Load data from server now that we have a valid session
  await loadData();

  setupDashboardUI();
  checkTutorial();
  history.pushState(null, '', '/dashboard');
}

// Reusable UI setup for both login and session restore
function setupDashboardUI() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app').style.display = '';
  document.body.setAttribute('data-role', currentRole);

  const badge = document.getElementById('role-badge');
  badge.textContent = currentRole.toUpperCase();
  badge.className = 'role-badge ' + currentRole;

  const nameDisplay = document.getElementById('user-name-display');
  if (currentRole === 'admin') {
    nameDisplay.textContent = 'Administrator';
  } else if (usersData[currentUser]) {
    nameDisplay.textContent = usersData[currentUser].name;
  } else {
    nameDisplay.textContent = currentUser || '';
  }

  document.getElementById('manage-users-btn').style.display = currentRole === 'admin' ? '' : 'none';
  document.getElementById('add-deposit-btn').style.display = currentRole === 'admin' ? '' : 'none';
  document.getElementById('download-csv-btn').style.display = currentRole === 'admin' ? '' : 'none';
  document.getElementById('btn-open-settings').style.display = currentRole === 'admin' ? '' : 'none';

  if (currentRole === 'admin') {
    document.getElementById('dashboard-title').textContent = 'Admin Dashboard';
    document.getElementById('dashboard-subtitle').textContent = 'Viewing all users and sub-accounts';
  } else {
    const name = usersData[currentUser] ? usersData[currentUser].name : currentUser;
    document.getElementById('dashboard-title').textContent = name + "'s Dashboard";
    document.getElementById('dashboard-subtitle').textContent = 'Your savings overview';
  }

  selectedSubAccount = 'all';
  selectedUser = 'all';
  currentPage = 1;
  populateUserFilter();
  populateSubAccountSelector();
  refreshDashboard();
}

function checkTutorial() {
  const userKey = currentRole === 'admin' ? 'admin' : currentUser;
  const seen = localStorage.getItem('tutorial_seen_' + userKey);
  if (!seen) {
    showTutorialStep(0);
    document.getElementById('tutorial-modal').style.display = '';
  }
}

function showTutorialStep(idx) {
  tutorialStepIndex = idx;
  const step = tutorialSteps[idx];
  const modal = document.getElementById('tutorial-modal');
  const card = modal.querySelector('.tutorial-card');
  const iconCont = document.getElementById('tutorial-icon-container');

  // Reset highlighting
  document.querySelectorAll('.tutorial-highlight').forEach(el => el.classList.remove('tutorial-highlight'));

  document.getElementById('tutorial-title').textContent = step.title;
  document.getElementById('tutorial-text').textContent = step.text;
  iconCont.innerHTML = step.icon;
  document.getElementById('tutorial-next').textContent = idx === tutorialSteps.length - 1 ? "Start Dashboard" : "Next Step →";

  const dots = document.getElementById('tutorial-dots');
  dots.innerHTML = tutorialSteps.map((_, i) => `<div class="dot ${i === idx ? 'active' : ''}"></div>`).join('');
}

function skipTutorial() {
  const userKey = currentRole === 'admin' ? 'admin' : currentUser;
  localStorage.setItem('tutorial_seen_' + userKey, 'true');
  document.getElementById('tutorial-modal').style.display = 'none';
  document.querySelectorAll('.tutorial-highlight').forEach(el => el.classList.remove('tutorial-highlight'));
}

function nextTutorialStep() {
  if (tutorialStepIndex < tutorialSteps.length - 1) {
    showTutorialStep(tutorialStepIndex + 1);
  } else {
    skipTutorial();
  }
}

function handleLogout() {
  // Invalidate session on server
  if (sessionToken) {
    fetch('/api/logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${sessionToken}` }
    }).catch(() => {});
  }

  clearSession();
  currentRole = null; currentUser = null; selectedSubAccount = 'all'; currentPage = 1;
  document.getElementById('app').style.display = 'none';
  document.getElementById('component-login').style.display = '';
  document.getElementById('login-screen').style.display = '';
  document.body.removeAttribute('data-role');
  document.getElementById('login-password').value = '';
  document.getElementById('login-role').value = 'admin';
  document.getElementById('user-select-group').style.display = 'none';
  history.pushState(null, '', '/login');
}

// ==================== SESSION RESTORE ON PAGE LOAD ====================
async function restoreSession() {
  const saved = getSavedSession();
  if (!saved || !saved.token) {
    document.getElementById('component-login').style.display = '';
    history.replaceState(null, '', '/login');
    return;
  }

  // Validate the token is still valid by calling a protected endpoint
  sessionToken = saved.token;
  try {
    const response = await fetch('/api/data', {
      headers: getAuthHeaders()
    });
    if (response.ok) {
      // Session is valid — restore state
      currentRole = saved.role;
      currentUser = saved.userKey;
      const serverData = await response.json();
      if (serverData) {
        usersData = serverData;
        localStorage.setItem('ipon_challenge_v1', JSON.stringify(usersData));
      }
      setupDashboardUI();
      console.log('✅ Session restored from localStorage');
      if (window.location.pathname === '/' || window.location.pathname === '/login') {
        history.replaceState(null, '', '/dashboard');
      }
    } else {
      // Token expired or invalid
      clearSession();
      document.getElementById('component-login').style.display = '';
      history.replaceState(null, '', '/login');
    }
  } catch (err) {
    console.error('Session restore failed:', err);
    clearSession();
    document.getElementById('component-login').style.display = '';
    history.replaceState(null, '', '/login');
  }
}

restoreSession();

// ==================== USER MANAGEMENT ====================
function renderUserMgmtTable() {
  const tbody = document.getElementById('user-mgmt-tbody');
  tbody.innerHTML = '';
  Object.keys(usersData).forEach(uK => {
    const u = usersData[uK];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td data-label="Name"><strong>${u.name}</strong></td>
      <td data-label="Password"><code class="password-sm">${u.password || '••••••••'}</code></td>
      <td data-label="Accounts">
        <div style="display: flex; flex-direction: column; gap: 0.4rem;">
          ${Object.keys(u.subAccounts).map(sK => `
            <div class="mgmt-subaccount-item">
              <span>${u.subAccounts[sK].label}</span>
              <div style="display: flex; gap: 0.25rem;">
                <button class="btn-icon" onclick="openEditSubAccount('${uK}', '${sK}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
                <button class="btn-icon btn-danger" onclick="deleteSubAccount('${uK}', '${sK}')"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
              </div>
            </div>
          `).join('')}
          <button class="btn btn-outline btn-sm" style="margin-top: 0.25rem; font-size: 0.7rem; justify-content: center;" onclick="openAddSubAccount('${uK}')">+ Add Account</button>
        </div>
      </td>
      <td data-label="Actions">
        <div style="display: flex; gap: 0.5rem;">
          <button class="btn btn-outline btn-sm" onclick="openEditUser('${uK}')">Edit</button>
          <button class="btn btn-danger btn-sm" onclick="deleteUser('${uK}')">Delete</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

window.openEditUser = function (uK) {
  const u = usersData[uK];
  document.getElementById('add-user-form').style.display = '';
  document.getElementById('user-form-title').textContent = 'Edit User: ' + u.name;
  document.getElementById('new-user-id').value = u.user_key || uK;
  document.getElementById('new-user-id').disabled = true;
  document.getElementById('new-user-name').value = u.name;
  document.getElementById('new-user-password').value = u.password || '';
};

window.deleteUser = async function (uK) {
  if (await showDialog('Delete User', `Are you sure you want to delete user "${uK}"? All their data will be lost forever.`, 'confirm', 'danger')) {
    try {
      const res = await fetch(`/api/users/${uK}`, { method: 'DELETE', headers: getAuthHeaders() });
      if (!res.ok) throw new Error(await res.text());
      await loadData();
      renderUserMgmtTable();
      populateUserDropdown();
      notyf.success('User deleted successfully.');
    } catch (err) {
      console.error(err);
      notyf.error('Failed to delete user.');
    }
  }
};

async function saveUser() {
  const i = document.getElementById('new-user-id').value.trim().toLowerCase();
  const n = document.getElementById('new-user-name').value.trim();
  const p = document.getElementById('new-user-password').value.trim();
  if (!i || !n) { await showDialog('Missing Info', 'Please fill all user fields.', 'alert', 'danger'); return; }
  
  const isEdit = document.getElementById('new-user-id').disabled;
  if (!isEdit && !p) { await showDialog('Missing Info', 'Password is required for new users.', 'alert', 'danger'); return; }
  
  const url = isEdit ? `/api/users/${i}` : '/api/users';
  const method = isEdit ? 'PUT' : 'POST';
  
  try {
    const res = await fetch(url, {
      method,
      headers: getAuthHeaders(),
      body: JSON.stringify({ id: i, name: n, password: p })
    });
    
    if (!res.ok) {
      const errData = await res.json();
      notyf.error(errData.error || 'Failed to save user.');
      return;
    }
    
    await loadData();
    renderUserMgmtTable();
    populateUserDropdown();
    document.getElementById('add-user-form').style.display = 'none';
    refreshDashboard();
    notyf.success(isEdit ? 'User updated successfully.' : 'User created successfully.');
  } catch (err) {
    console.error(err);
    notyf.error('An unexpected error occurred.');
  }
}

window.openAddSubAccount = function (uK) {
  document.getElementById('subaccount-modal').style.display = '';
  document.getElementById('sa-modal-title').textContent = 'Add Account for ' + usersData[uK].name;
  document.getElementById('sa-edit-userid').value = uK;
  document.getElementById('sa-edit-id').value = '';
  document.getElementById('sa-label').value = '';
  document.getElementById('sa-goal').value = 50000;
  document.getElementById('sa-daily').value = 50;
};

window.openEditSubAccount = function (uK, sK) {
  const sa = usersData[uK].subAccounts[sK];
  document.getElementById('subaccount-modal').style.display = '';
  document.getElementById('sa-modal-title').textContent = 'Edit Account';
  document.getElementById('sa-edit-userid').value = uK;
  document.getElementById('sa-edit-id').value = sK;
  document.getElementById('sa-label').value = sa.label;
  document.getElementById('sa-goal').value = sa.goal;
  document.getElementById('sa-daily').value = sa.dailyDeposit || 0;
};

window.deleteSubAccount = async function (uK, sK) {
  if (await showDialog('Delete Account', 'Are you sure you want to delete this specific savings goal? This cannot be undone.', 'confirm', 'danger')) {
    try {
      const res = await fetch(`/api/subaccounts/${sK}`, { method: 'DELETE', headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to delete sub-account');
      await loadData();
      renderUserMgmtTable();
      refreshDashboard();
      notyf.success('Savings goal deleted.');
    } catch (err) {
      console.error(err);
      notyf.error('Failed to delete sub-account.');
    }
  }
};

async function submitSubAccount() {
  const uK = document.getElementById('sa-edit-userid').value;
  const sK = document.getElementById('sa-edit-id').value;
  const l = document.getElementById('sa-label').value.trim();
  const g = parseFloat(document.getElementById('sa-goal').value.toString().replace(/,/g, ''));
  const d = parseFloat(document.getElementById('sa-daily').value.toString().replace(/,/g, ''));

  if (!l || isNaN(g)) { await showDialog('Invalid Data', 'Please provide a valid label and goal amount.', 'alert', 'danger'); return; }

  const data = {
    label: l,
    goal: g,
    daily_deposit: isNaN(d) ? 0 : d
  };

  try {
    let url, method;
    if (sK) {
      url = `/api/subaccounts/${sK}`;
      method = 'PUT';
    } else {
      url = '/api/subaccounts';
      method = 'POST';
      data.user_id = uK;
      data.id = l.toLowerCase().replace(/\s+/g, '_') + '_' + Date.now();
    }

    const res = await fetch(url, {
      method,
      headers: getAuthHeaders(),
      body: JSON.stringify(data)
    });

    if (!res.ok) throw new Error('Failed to save sub-account');

    await loadData();
    document.getElementById('subaccount-modal').style.display = 'none';
    renderUserMgmtTable();
    refreshDashboard();
    notyf.success(sK ? 'Savings goal updated.' : 'Sub-account created successfully.');
  } catch (err) {
    console.error(err);
    notyf.error('Failed to save sub-account.');
  }
}

// ==================== SYSTEM SETTINGS: DEMO DATA ====================

function openSubAccountDetails(uK, saK) {
  const sa = usersData[uK].subAccounts[saK];
  if (!sa) return;

  const computed = computeSubAccountData(sa);

  document.getElementById('sa-details-title').textContent = sa.label;
  document.getElementById('sa-details-balance').textContent = formatPeso(computed.balance);
  document.getElementById('sa-details-goal').textContent = formatPeso(sa.goal);
  document.getElementById('sa-details-interest').textContent = formatPeso(computed.interest);

  const tbody = document.getElementById('sa-details-tbody');
  tbody.innerHTML = '';

  // Sort deposits by date descending
  const deps = [...sa.deposits].sort((a, b) => new Date(b.date) - new Date(a.date));

  if (deps.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;padding:1rem;color:var(--text-muted)">No transactions</td></tr>';
  } else {
    deps.forEach(d => {
      const tr = document.createElement('tr');
      const isNeg = d.amount < 0;
      tr.innerHTML = `
        <td>${formatDate(d.date)}</td>
        <td>${d.label || 'Deposit'}</td>
        <td class="${isNeg ? 'negative' : ''}" style="font-weight:700; color:${isNeg ? 'var(--red)' : 'var(--green)'}">
          ${isNeg ? '' : '+'}${formatPeso(d.amount)}
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  document.getElementById('sa-details-modal').style.display = '';
}

// Close listeners for details modal
document.getElementById('sa-details-close').addEventListener('click', () => {
  document.getElementById('sa-details-modal').style.display = 'none';
});

async function clearAllData() {
  if (await showDialog('CRITICAL ACTION', 'Are you sure you want to PERMANENTLY CLEAR all sub-accounts and transaction history from the cloud? This cannot be undone.', 'confirm', 'danger')) {
    const delPromises = [];
    Object.keys(usersData).forEach(uK => {
      Object.keys(usersData[uK].subAccounts).forEach(saK => {
        delPromises.push(fetch(`/api/subaccounts/${saK}`, { method: 'DELETE', headers: getAuthHeaders() }));
      });
    });
    
    await Promise.all(delPromises);
    
    await loadData();
    refreshDashboard();
    populateSubAccountSelector();
    await showDialog('System Reset', 'All transaction data has been cleared.', 'alert', 'info');
    document.getElementById('settings-modal').style.display = 'none';
  }
}

async function applyDailyInterest() {
  const now = new Date();
  const todayStr = toLocalDateString(now);
  const interestLabel = "Interest Earned";
  const newTxs = [];

  Object.keys(usersData).forEach(uK => {
    Object.keys(usersData[uK].subAccounts).forEach(saK => {
      const sa = usersData[uK].subAccounts[saK];
      if (sa.deposits.length === 0) return;

      // Find the first deposit date to know when to start interest
      const sortedDeps = [...sa.deposits].sort((a, b) => new Date(a.date) - new Date(b.date));
      const firstDepDate = new Date(sortedDeps[0].date);

      // Start calculating interest from the day AFTER the first deposit
      let checkDate = new Date(firstDepDate);
      checkDate.setDate(checkDate.getDate() + 1);
      
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      while (checkDate < today) {
        const dStr = toLocalDateString(checkDate);
        const exists = sa.deposits.some(d => d.date === dStr && d.label === interestLabel);

        if (!exists) {
          const balanceBefore = sa.deposits
            .filter(d => new Date(d.date) < checkDate)
            .reduce((sum, d) => sum + d.amount, 0);

          // Daily interest = balance * (yearly% / 365)
          const interest = Math.floor(balanceBefore * DAILY_RATE * 100) / 100;
          if (interest > 0) {
            newTxs.push({
              sub_account_id: saK,
              user_id: uK,
              amount: interest,
              date: dStr,
              label: interestLabel
            });
            // Temporarily push locally so sequential days calc correct balance
            sa.deposits.push({ date: dStr, amount: interest, label: interestLabel });
          }
        }
        // Move to next day
        checkDate.setDate(checkDate.getDate() + 1);
      }
    });
  });

  if (newTxs.length > 0) {
    const promises = newTxs.map(tx => fetch('/api/transactions', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(tx)
    }));
    await Promise.all(promises);
    await loadData();
    refreshDashboard();
  }
}

function downloadCSV() {
  const subs = getAllSubAccountsForView();
  let csv = "Date,User,Sub-Account,Amount\n";
  let txs = [];
  subs.forEach(s => s.deposits.forEach(d => txs.push({ d: d.date, u: s.userName, a: s.label, v: d.amount })));
  txs.sort((a, b) => new Date(b.d) - new Date(a.d));
  txs.forEach(t => csv += `${t.d},"${t.u}","${t.a}",${t.v}\n`);
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `report_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

// ==================== TRANSACTION CRUD ====================
window.openEditTransaction = function (uK, sK, idx) {
  const tx = usersData[uK].subAccounts[sK].deposits[idx];
  document.getElementById('edit-tx-user').value = uK;
  document.getElementById('edit-tx-sa').value = sK;
  document.getElementById('edit-tx-index').value = idx;
  document.getElementById('edit-tx-amount').value = tx.amount;
  document.getElementById('edit-tx-date').value = tx.date;
  document.getElementById('edit-tx-modal').style.display = '';
};

window.deleteTransaction = async function (uK, sK, idx) {
  if (await showDialog('Delete Transaction', 'Are you sure you want to delete this record? This will permanently remove it from history.', 'confirm', 'danger')) {
    try {
      const tx = usersData[uK].subAccounts[sK].deposits[idx];
      const res = await fetch(`/api/transactions/${tx.id}`, { method: 'DELETE', headers: getAuthHeaders() });
      if (!res.ok) throw new Error('Failed to delete transaction');
      
      await loadData();
      refreshDashboard();
      notyf.success('Transaction deleted.');
    } catch (err) {
      console.error(err);
      notyf.error('Failed to delete transaction.');
    }
  }
};

async function submitEditTransaction() {
  const uK = document.getElementById('edit-tx-user').value;
  const sK = document.getElementById('edit-tx-sa').value;
  const idx = parseInt(document.getElementById('edit-tx-index').value);
  const amount = parseFloat(document.getElementById('edit-tx-amount').value);
  const date = document.getElementById('edit-tx-date').value;

  if (isNaN(amount) || !date) {
    await showDialog('Invalid Input', 'Common! Please enter a valid amount and date.', 'alert', 'danger');
    return;
  }

  try {
    const tx = usersData[uK].subAccounts[sK].deposits[idx];
    const res = await fetch(`/api/transactions/${tx.id}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ amount, date })
    });
    
    if (!res.ok) throw new Error('Failed to edit transaction');
    
    await loadData();
    document.getElementById('edit-tx-modal').style.display = 'none';
    refreshDashboard();
    notyf.success('Transaction updated successfully.');
  } catch (err) {
    console.error(err);
    notyf.error('Failed to edit transaction.');
  }
}

// ==================== THEME & EVENTS ====================
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('ipon-theme', next);
  document.getElementById('icon-sun').style.display = next === 'dark' ? 'none' : '';
  document.getElementById('icon-moon').style.display = next === 'dark' ? '' : 'none';
  renderCharts();
}

// Initialize all event listeners (runs immediately since app.js is loaded after components)
(function initEventListeners() {
  const theme = localStorage.getItem('ipon-theme') || 'light';
  document.documentElement.setAttribute('data-theme', theme);
  document.getElementById('icon-sun').style.display = theme === 'dark' ? 'none' : '';
  document.getElementById('icon-moon').style.display = theme === 'dark' ? '' : 'none';

  populateUserDropdown();

  const loginRole = document.getElementById('login-role');
  loginRole.addEventListener('change', () => {
    document.getElementById('user-select-group').style.display = loginRole.value === 'user' ? '' : 'none';
  });

  document.getElementById('login-btn').addEventListener('click', handleLogin);
  document.getElementById('login-password').addEventListener('keydown', e => {
    document.getElementById('login-error').style.display = 'none';
    if (e.key === 'Enter') handleLogin();
  });
  document.getElementById('login-password').addEventListener('input', () => {
    document.getElementById('login-error').style.display = 'none';
  });
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  document.getElementById('user-filter').addEventListener('change', e => {
    selectedUser = e.target.value;
    selectedSubAccount = 'all';
    currentPage = 1;
    populateSubAccountSelector();
    refreshDashboard();
  });

  document.getElementById('subaccount-select').addEventListener('change', e => {
    selectedSubAccount = e.target.value;
    currentPage = 1;
    refreshDashboard();
  });

  document.getElementById('table-search').addEventListener('input', () => { currentPage = 1; renderTransactionTable(); });

  document.getElementById('add-deposit-btn').addEventListener('click', () => { populateDepositModal(); document.getElementById('deposit-modal').style.display = ''; });
  document.getElementById('modal-close').addEventListener('click', () => { document.getElementById('deposit-modal').style.display = 'none'; });
  document.getElementById('modal-cancel').addEventListener('click', () => { document.getElementById('deposit-modal').style.display = 'none'; });
  document.getElementById('deposit-user').addEventListener('change', updateDepositSubAccounts);
  document.getElementById('modal-submit').addEventListener('click', submitDeposit);

  document.getElementById('download-csv-btn').addEventListener('click', downloadCSV);

  document.getElementById('manage-users-btn').addEventListener('click', () => { renderUserMgmtTable(); document.getElementById('user-mgmt-modal').style.display = ''; });
  document.getElementById('user-mgmt-close').addEventListener('click', () => { document.getElementById('user-mgmt-modal').style.display = 'none'; });
  document.getElementById('btn-show-add-user').addEventListener('click', () => {
    document.getElementById('add-user-form').style.display = '';
    document.getElementById('new-user-id').disabled = false; document.getElementById('new-user-id').value = '';
    document.getElementById('user-form-title').textContent = 'Add New User';
  });
  document.getElementById('cancel-user-btn').addEventListener('click', () => { document.getElementById('add-user-form').style.display = 'none'; });
  document.getElementById('submit-user-btn').addEventListener('click', saveUser);

  document.getElementById('sa-modal-close').addEventListener('click', () => { document.getElementById('subaccount-modal').style.display = 'none'; });
  document.getElementById('sa-modal-cancel').addEventListener('click', () => { document.getElementById('subaccount-modal').style.display = 'none'; });
  document.getElementById('sa-modal-submit').addEventListener('click', submitSubAccount);

  document.getElementById('edit-tx-close').addEventListener('click', () => { document.getElementById('edit-tx-modal').style.display = 'none'; });
  document.getElementById('edit-tx-cancel').addEventListener('click', () => { document.getElementById('edit-tx-modal').style.display = 'none'; });
  document.getElementById('edit-tx-submit').addEventListener('click', submitEditTransaction);

  document.getElementById('tutorial-next').addEventListener('click', nextTutorialStep);
  document.getElementById('tutorial-skip').addEventListener('click', skipTutorial);
  document.getElementById('start-tour-btn').addEventListener('click', () => {
    showTutorialStep(0);
    document.getElementById('tutorial-modal').style.display = '';
  });

  const openDonate = () => { document.getElementById('donate-modal').style.display = ''; };
  document.getElementById('donate-header-btn').addEventListener('click', openDonate);
  if (document.getElementById('login-donate-btn')) document.getElementById('login-donate-btn').addEventListener('click', openDonate);

  document.getElementById('donate-close-btn').addEventListener('click', () => {
    document.getElementById('donate-modal').style.display = 'none';
  });

  // Password Toggles
  const setupToggle = (btnId, inputId, eyeId, eyeOffId) => {
    const btn = document.getElementById(btnId);
    const input = document.getElementById(inputId);
    const eye = document.getElementById(eyeId);
    const eyeOff = document.getElementById(eyeOffId);
    if (btn && input) {
      btn.addEventListener('click', () => {
        const isPass = input.type === 'password';
        input.type = isPass ? 'text' : 'password';
        eye.style.display = isPass ? 'none' : '';
        eyeOff.style.display = isPass ? '' : 'none';
      });
    }
  };
  setupToggle('toggle-login-password', 'login-password', 'eye-icon-login', 'eye-off-icon-login');
  setupToggle('toggle-new-user-password', 'new-user-password', 'eye-icon-new', 'eye-off-icon-new');

  document.getElementById('btn-open-settings').addEventListener('click', () => { document.getElementById('settings-modal').style.display = 'flex'; });
  document.getElementById('settings-close').addEventListener('click', () => { document.getElementById('settings-modal').style.display = 'none'; });
  document.getElementById('btn-clear-data').addEventListener('click', clearAllData);

  document.querySelectorAll('.modal-overlay').forEach(m => m.addEventListener('click', e => { if (e.target === e.currentTarget && e.target.id !== 'tutorial-modal') e.target.style.display = 'none'; }));
})();

function populateUserDropdown() {
  const el = document.getElementById('login-user'); el.innerHTML = '';
  Object.keys(usersData).forEach(k => { const o = document.createElement('option'); o.value = k; o.textContent = usersData[k].name; el.appendChild(o); });
}
