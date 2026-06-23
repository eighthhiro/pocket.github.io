'use strict';

const STORAGE_KEY = 'pocketMoney.state.v2';

const POCKET_ICONS = ['receipt','food','car','heart','bag','plane','phone-mob','pill','book','home','bolt','paw','scissors','coffee','gamepad'];

function defaultState(){
  return {
    categories:{
      excess:{ name:'Excess', balance:0, icon:'sparkle', locked:true },
      bills: { name:'Bills',  balance:0, icon:'receipt' },
      food:  { name:'Food',   balance:0, icon:'food'    }
    },
    catOrder:['excess','bills','food'],
    paymentMethods:{ cash:0, card:0 },
    transactions:[],
    goals:[]
  };
}

function migrateState(s){
  // Ensure catOrder exists
  if(!s.catOrder){
    s.catOrder = ['excess', ...Object.keys(s.categories).filter(k => k !== 'excess')];
  }
  // Ensure icon and locked fields
  const iconMap = { bills:'receipt', food:'food', excess:'sparkle' };
  s.catOrder.forEach(k => {
    if(!s.categories[k]) return;
    if(!s.categories[k].icon) s.categories[k].icon = iconMap[k] || 'receipt';
    if(k === 'excess') s.categories[k].locked = true;
  });
  // Add paymentMethods if missing
  if(!s.paymentMethods){
    const total = s.catOrder.reduce((sum,k) => sum + (s.categories[k]?.balance || 0), 0);
    s.paymentMethods = { cash: total, card: 0 };
  }
  return s;
}

function loadState(){
  try{
    // Try v2 first
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){ const p = JSON.parse(raw); if(p.categories && p.catOrder) return migrateState(p); }
    // Try v1 migration
    const v1 = localStorage.getItem('pocketMoney.state.v1');
    if(v1){ const p = JSON.parse(v1); if(p.categories) return migrateState(p); }
  }catch(e){ console.error('State load error',e); }
  return defaultState();
}

function saveState(){
  try{ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  catch(e){ alert('Could not save: storage may be full or blocked.'); }
}

let state = loadState();
let currentPeriod = 'today';
let currentFundGoalId = null;
let currentPocketKey = null;
let currentPmFrom = 'cash';
let addPocketSelectedIcon = 'receipt';
let pocketSelectedIcon = 'receipt';

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

function fmt(n){
  const v = Number(n) || 0;
  const sign = v < 0 ? '-' : '';
  return sign + '₱' + Math.abs(v).toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
}

function computeTotal(){
  return state.catOrder.reduce((s,k) => s + (state.categories[k]?.balance || 0), 0);
}

function escHtml(str){
  const d = document.createElement('div');
  d.textContent = str == null ? '' : str;
  return d.innerHTML;
}

function localDateKey(d){ return d.toISOString().slice(0,10); }

function startOfWeek(d){
  const date = new Date(d);
  const day = date.getDay();
  date.setDate(date.getDate() + (day === 0 ? -6 : 1 - day));
  date.setHours(0,0,0,0);
  return date;
}

function inPeriod(isoDate, period){
  const now = new Date(), t = new Date(isoDate);
  if(period === 'today') return localDateKey(t) === localDateKey(now);
  if(period === 'week'){ const s = startOfWeek(now); return t >= s && t <= now; }
  return t.getFullYear() === now.getFullYear() && t.getMonth() === now.getMonth();
}

function daysLeft(deadline){
  const d = new Date(deadline + 'T00:00:00');
  const now = new Date(); now.setHours(0,0,0,0);
  const diff = Math.round((d - now) / 86400000);
  if(diff < 0) return 'Past target date';
  if(diff === 0) return 'Due today';
  return diff + ' day' + (diff === 1 ? '' : 's') + ' left';
}

function catName(k){ return state.categories[k]?.name || k; }

/* ---- Icon picker ---- */
function renderIconPicker(pickerId, selectedIcon){
  const picker = document.getElementById(pickerId);
  picker.classList.remove('open');
  picker.innerHTML = POCKET_ICONS.map(icon =>
    `<button type="button" class="icon-opt${icon === selectedIcon ? ' selected' : ''}" data-icon="${icon}" aria-label="${icon}" data-picker="${pickerId}">
      <svg class="icon"><use href="#icon-${icon}"/></svg>
    </button>`
  ).join('');
}

function toggleIconPicker(toggleBtnId, pickerId){
  const picker = document.getElementById(pickerId);
  const btn = document.getElementById(toggleBtnId);
  const isOpen = picker.classList.toggle('open');
  btn.classList.toggle('active', isOpen);
  btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
}

function collapseIconPicker(toggleBtnId, pickerId){
  document.getElementById(pickerId).classList.remove('open');
  const btn = document.getElementById(toggleBtnId);
  btn.classList.remove('active');
  btn.setAttribute('aria-expanded', 'false');
}

/* ---- Render ---- */
function renderTotals(){
  document.getElementById('totalAmount').textContent = fmt(computeTotal());
  document.getElementById('pmCashAmount').textContent = fmt(state.paymentMethods.cash);
  document.getElementById('pmCardAmount').textContent = fmt(state.paymentMethods.card);
}

function renderCarousel(){
  const carousel = document.getElementById('pocketsCarousel');
  const pocketCards = state.catOrder.map(key => {
    const cat = state.categories[key];
    const bal = cat.balance;
    const action = cat.locked ? 'open-add-money' : 'open-pocket';
    const excessHint = cat.locked ? `<span class="excess-hint">source</span>` : '';
    return `<div class="card-pocket" data-action="${action}" data-cat-id="${key}" role="button" tabindex="0">
      <span class="pocket-icon"><svg class="icon"><use href="#icon-${escHtml(cat.icon)}"/></svg></span>
      <span class="pocket-label">${escHtml(cat.name)}</span>
      <span class="pocket-amount${bal < 0 ? ' negative' : ''}">${fmt(bal)}</span>
      ${excessHint}
    </div>`;
  }).join('');

  const addCard = `<div class="card-add-pocket card-pocket" data-action="open-add-pocket" role="button" tabindex="0">
    <span class="pocket-icon"><svg class="icon"><use href="#icon-plus"/></svg></span>
    <span class="pocket-label">New</span>
  </div>`;

  carousel.innerHTML = pocketCards + addCard;
  updateCarouselScrollHint();
}

function updateCarouselScrollHint(){
  const wrap = document.querySelector('.pockets-wrap');
  const carousel = document.getElementById('pocketsCarousel');
  if(!wrap || !carousel) return;
  const scrollable = carousel.scrollWidth > carousel.clientWidth + 2;
  wrap.classList.toggle('scrollable', scrollable);
  const atEnd = carousel.scrollLeft + carousel.clientWidth >= carousel.scrollWidth - 2;
  wrap.classList.toggle('at-end', atEnd);
}

function renderTxnRow(t){
  let icon, cls, label, amount;
  const pm = t.paymentMethod;
  const pmBadge = pm ? `<span class="pm-badge"><svg class="icon-xs" style="display:inline;width:10px;height:10px;"><use href="#icon-${pm}"/></svg>&nbsp;${pm}</span>` : '';

  if(t.type === 'income'){
    icon='plus'; cls='pos';
    label='Added to Excess';
    amount='+ ' + fmt(t.amount);
  } else if(t.type === 'expense'){
    icon='minus'; cls='neg';
    const cn = catName(t.category);
    label = cn + (t.note ? ' · ' + escHtml(t.note) : '');
    amount='- ' + fmt(t.amount);
  } else if(t.type === 'transfer'){
    icon='swap'; cls='neu';
    label = catName(t.from) + ' → ' + catName(t.to);
    amount = fmt(t.amount);
  } else if(t.type === 'pm_transfer'){
    icon='swap'; cls='neu';
    label = (t.from === 'cash' ? 'Cash' : 'Card') + ' → ' + (t.to === 'cash' ? 'Cash' : 'Card');
    amount = fmt(t.amount);
  } else { // goal_fund
    icon='target'; cls='pos';
    label = 'To goal · from ' + catName(t.category);
    amount = '- ' + fmt(t.amount);
  }

  const time = new Date(t.date).toLocaleString('en-PH',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});

  return `<li class="txn-row">
    <span class="txn-icon ${cls}"><svg class="icon"><use href="#icon-${icon}"/></svg></span>
    <span class="txn-info">
      <span class="txn-label">${label}</span>
      <span class="txn-time">${time}${pmBadge ? ' · ' + pmBadge : ''}</span>
    </span>
    <span class="txn-amount ${cls}">${amount}</span>
  </li>`;
}

function renderTxnList(period){
  const list = document.getElementById('txnList');
  const items = state.transactions
    .filter(t => inPeriod(t.date, period))
    .sort((a,b) => new Date(b.date) - new Date(a.date));

  if(!items.length){
    const w = period==='today'?'today':period==='week'?'this week':'this month';
    list.innerHTML = `<li class="empty">Nothing logged ${w} yet.</li>`;
  } else {
    list.innerHTML = items.map(renderTxnRow).join('');
  }

  const spent = items.filter(t=>t.type==='expense').reduce((s,t)=>s+t.amount, 0);
  document.getElementById('periodSummary').innerHTML =
    `<span>Spent <strong>${fmt(spent)}</strong></span><span class="dot">·</span><span>Left <strong>${fmt(computeTotal())}</strong></span>`;
}

function renderGoals(){
  const wrap = document.getElementById('goalsList');
  if(!state.goals.length){
    wrap.innerHTML = `<p class="empty">No goals yet. Start one and watch the bar fill up.</p>`;
    return;
  }
  wrap.innerHTML = state.goals.map(g => {
    const pct = g.target > 0 ? Math.min(100, Math.round(g.saved/g.target*100)) : 0;
    const dl = g.deadline ? daysLeft(g.deadline) : '';
    return `<div class="goal-card">
      <div class="goal-top">
        <div>
          <div class="goal-title">${escHtml(g.title)}</div>
          ${dl ? `<div class="goal-deadline">${dl}</div>` : ''}
        </div>
        <button type="button" class="btn-icon-ghost" data-action="delete-goal" data-goal-id="${g.id}" aria-label="Delete goal"><svg class="icon"><use href="#icon-trash"/></svg></button>
      </div>
      <div class="goal-bar"><div class="goal-bar-fill" style="width:${pct}%"></div></div>
      <div class="goal-bottom">
        <span class="goal-amounts">${fmt(g.saved)} <span class="text-muted">of ${fmt(g.target)}</span></span>
        <button type="button" class="btn-small" data-action="open-fund-goal" data-goal-id="${g.id}">Fund</button>
      </div>
    </div>`;
  }).join('');
}

function fillPocketSelect(sel, excludeKey){
  sel.innerHTML = state.catOrder
    .filter(k => k !== excludeKey)
    .map(k => `<option value="${k}">${escHtml(state.categories[k].name)} — ${fmt(state.categories[k].balance)}</option>`)
    .join('');
}

function renderAll(){
  renderTotals();
  renderCarousel();
  renderTxnList(currentPeriod);
  renderGoals();
}

/* ---- Sheets ---- */
function openSheet(id){
  document.getElementById('overlay').classList.add('show');
  document.getElementById(id).classList.add('show');
  document.body.classList.add('no-scroll');
}
function closeAllSheets(){
  document.querySelectorAll('.sheet.show').forEach(s => s.classList.remove('show'));
  document.getElementById('overlay').classList.remove('show');
  document.body.classList.remove('no-scroll');
}
function clearErr(id){ const e=document.getElementById(id); if(e) e.textContent=''; }

function openAddMoneySheet(){
  clearErr('addMoneyError');
  document.getElementById('addMoneyAmount').value = '';
  closeAllSheets();
  openSheet('sheet-add-money');
}

function openPmTransferSheet(from){
  currentPmFrom = from;
  clearErr('pmTransferError');
  document.getElementById('pmTransferAmount').value = '';
  const fromLabel = from === 'cash' ? 'Cash' : 'Card';
  const toLabel = from === 'cash' ? 'Card' : 'Cash';
  document.getElementById('pmTransferTitle').textContent = fromLabel + ' → ' + toLabel;
  document.getElementById('pmTransferAvail').textContent = fmt(state.paymentMethods[from]);
  closeAllSheets();
  openSheet('sheet-pm-transfer');
}

function openPocketSheet(catKey){
  currentPocketKey = catKey;
  const cat = state.categories[catKey];
  document.getElementById('pocketSheetTitle').textContent = cat.name;
  document.getElementById('pocketName').value = cat.name;
  pocketSelectedIcon = cat.icon || 'receipt';
  renderIconPicker('pocketIconPicker', pocketSelectedIcon);
  document.getElementById('pocketIconPreviewUse').setAttribute('href', '#icon-' + pocketSelectedIcon);
  document.getElementById('pocketIconToggle').classList.remove('active');
  document.getElementById('pocketIconToggle').setAttribute('aria-expanded', 'false');
  document.getElementById('pocketAmount').value = cat.balance > 0 ? cat.balance : '';
  document.getElementById('pocketExcessAvail').textContent = fmt(state.categories.excess.balance);
  clearErr('pocketError');
  closeAllSheets();
  openSheet('sheet-pocket');
}

function openAddPocketSheet(){
  document.getElementById('addPocketName').value = '';
  clearErr('addPocketError');
  addPocketSelectedIcon = 'receipt';
  renderIconPicker('addIconPicker', addPocketSelectedIcon);
  document.getElementById('addPocketIconPreviewUse').setAttribute('href', '#icon-receipt');
  document.getElementById('addPocketIconToggle').classList.remove('active');
  document.getElementById('addPocketIconToggle').setAttribute('aria-expanded', 'false');
  closeAllSheets();
  openSheet('sheet-add-pocket');
}

function openExpenseSheet(){
  clearErr('expenseError');
  document.getElementById('expenseAmount').value = '';
  document.getElementById('expenseNote').value = '';
  fillPocketSelect(document.getElementById('expenseCategory'), null);
  // Reset PM toggle
  document.querySelector('input[name="expensePm"][value="cash"]').checked = true;
  document.getElementById('pmOptCash').classList.add('selected');
  document.getElementById('pmOptCard').classList.remove('selected');
  closeAllSheets();
  openSheet('sheet-expense');
}

function openGoalSheet(){
  clearErr('goalError');
  document.getElementById('goalForm').reset();
  closeAllSheets();
  openSheet('sheet-goal');
}

function openFundGoalSheet(goalId){
  const goal = state.goals.find(g => g.id === goalId);
  if(!goal) return;
  currentFundGoalId = goalId;
  document.getElementById('fundGoalTitle').textContent = 'Fund "' + goal.title + '"';
  clearErr('fundGoalError');
  document.getElementById('fundGoalAmount').value = '';
  document.getElementById('fundGoalExcessAvail').textContent = fmt(state.categories.excess.balance);
  closeAllSheets();
  openSheet('sheet-fund-goal');
}

function deleteGoal(goalId){
  const goal = state.goals.find(g => g.id === goalId);
  if(!goal) return;
  if(!confirm(`Delete "${goal.title}"? Its saved ${fmt(goal.saved)} will return to Excess.`)) return;
  state.categories.excess.balance += goal.saved;
  if(goal.saved > 0) state.transactions.push({ id:uid(), type:'income', category:'excess', amount:goal.saved, date:new Date().toISOString() });
  state.goals = state.goals.filter(g => g.id !== goalId);
  saveState(); renderAll();
  showToast('Goal deleted, funds returned to Excess');
}

function deletePocket(catKey){
  const cat = state.categories[catKey];
  if(!cat || cat.locked) return;
  if(!confirm(`Delete "${cat.name}"? Its ${fmt(cat.balance)} will return to Excess.`)) return;
  state.categories.excess.balance += cat.balance;
  if(cat.balance > 0) state.transactions.push({ id:uid(), type:'transfer', from:catKey, to:'excess', amount:cat.balance, date:new Date().toISOString() });
  state.catOrder = state.catOrder.filter(k => k !== catKey);
  delete state.categories[catKey];
  saveState(); closeAllSheets(); renderAll();
  showToast('"' + cat.name + '" deleted, funds returned to Excess');
}

/* ---- Toast ---- */
let toastTimer;
function showToast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

/* ---- Backup ---- */
function downloadBackup(){
  const blob = new Blob([JSON.stringify(state,null,2)],{type:'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pocket-backup-${localDateKey(new Date())}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  showToast('Backup downloaded');
}

/* ---- Init ---- */
document.addEventListener('DOMContentLoaded', () => {
  renderAll();

  document.getElementById('pocketsCarousel').addEventListener('scroll', updateCarouselScrollHint);

  document.getElementById('pocketIconToggle').addEventListener('click', () => toggleIconPicker('pocketIconToggle', 'pocketIconPicker'));
  document.getElementById('addPocketIconToggle').addEventListener('click', () => toggleIconPicker('addPocketIconToggle', 'addIconPicker'));

  /* Global click delegation */
  document.addEventListener('click', e => {
    // Icon picker selection — checked first since these buttons have no data-action
    const iconOpt = e.target.closest('.icon-opt');
    if(iconOpt){
      const pickerId = iconOpt.dataset.picker;
      const icon = iconOpt.dataset.icon;
      document.querySelectorAll(`#${pickerId} .icon-opt`).forEach(o => o.classList.remove('selected'));
      iconOpt.classList.add('selected');
      if(pickerId === 'addIconPicker'){
        addPocketSelectedIcon = icon;
        document.getElementById('addPocketIconPreviewUse').setAttribute('href', '#icon-' + icon);
        collapseIconPicker('addPocketIconToggle', 'addIconPicker');
      }else{
        pocketSelectedIcon = icon;
        document.getElementById('pocketIconPreviewUse').setAttribute('href', '#icon-' + icon);
        collapseIconPicker('pocketIconToggle', 'pocketIconPicker');
      }
      return;
    }

    const el = e.target.closest('[data-action]');
    if(!el) return;
    const action = el.dataset.action;

    switch(action){
      case 'open-add-money':    e.stopPropagation(); openAddMoneySheet(); break;
      case 'open-pm-transfer':  openPmTransferSheet(el.dataset.pm); break;
      case 'open-pocket':       openPocketSheet(el.dataset.catId); break;
      case 'open-add-pocket':   openAddPocketSheet(); break;
      case 'open-expense':      openExpenseSheet(); break;
      case 'open-goal':         openGoalSheet(); break;
      case 'open-fund-goal':    openFundGoalSheet(el.dataset.goalId); break;
      case 'delete-goal':       deleteGoal(el.dataset.goalId); break;
      case 'open-settings':     closeAllSheets(); openSheet('sheet-settings'); break;
      case 'close-sheet':       closeAllSheets(); break;
    }
  });

  /* Keyboard support */
  document.addEventListener('keydown', e => {
    if(e.key === 'Escape'){ closeAllSheets(); return; }
    if((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"]')){
      e.preventDefault(); e.target.click();
    }
  });

  /* Period toggle */
  document.querySelectorAll('.period-toggle button').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.period-toggle button').forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected','false'); });
      btn.classList.add('active'); btn.setAttribute('aria-selected','true');
      currentPeriod = btn.dataset.period;
      renderTxnList(currentPeriod);
    });
  });

  /* Nav */
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.getElementById('view-' + btn.dataset.view).classList.add('active');
    });
  });

  /* PM toggle in expense form */
  document.querySelectorAll('input[name="expensePm"]').forEach(radio => {
    radio.addEventListener('change', () => {
      document.getElementById('pmOptCash').classList.toggle('selected', radio.value === 'cash' ? radio.checked : !radio.checked);
      document.getElementById('pmOptCard').classList.toggle('selected', radio.value === 'card' ? radio.checked : !radio.checked);
    });
  });

  /* ---- Form submissions ---- */

  // Add money
  document.getElementById('addMoneyForm').addEventListener('submit', e => {
    e.preventDefault();
    const amount = parseFloat(document.getElementById('addMoneyAmount').value);
    const err = document.getElementById('addMoneyError');
    if(!amount || amount <= 0){ err.textContent = 'Enter an amount greater than 0.'; return; }
    state.categories.excess.balance += amount;
    state.paymentMethods.cash += amount;
    state.transactions.push({ id:uid(), type:'income', category:'excess', amount, paymentMethod:'cash', date:new Date().toISOString() });
    saveState(); closeAllSheets(); renderAll();
    showToast('Added ' + fmt(amount) + ' to Excess & Cash');
  });

  // PM Transfer
  document.getElementById('pmTransferForm').addEventListener('submit', e => {
    e.preventDefault();
    const amount = parseFloat(document.getElementById('pmTransferAmount').value);
    const err = document.getElementById('pmTransferError');
    const from = currentPmFrom;
    const to = from === 'cash' ? 'card' : 'cash';
    if(!amount || amount <= 0){ err.textContent = 'Enter an amount greater than 0.'; return; }
    if(state.paymentMethods[from] < amount){ err.textContent = `Not enough in ${from === 'cash' ? 'Cash' : 'Card'}.`; return; }
    state.paymentMethods[from] -= amount;
    state.paymentMethods[to] += amount;
    state.transactions.push({ id:uid(), type:'pm_transfer', from, to, amount, date:new Date().toISOString() });
    saveState(); closeAllSheets(); renderAll();
    showToast('Moved ' + fmt(amount) + ' to ' + (to === 'cash' ? 'Cash' : 'Card'));
  });

  // Pocket sheet: name, icon, and amount saved together
  document.getElementById('pocketForm').addEventListener('submit', e => {
    e.preventDefault();
    const cat = state.categories[currentPocketKey];
    const name = document.getElementById('pocketName').value.trim();
    const err = document.getElementById('pocketError');
    if(!name){ err.textContent = 'Name cannot be empty.'; return; }
    const amountRaw = document.getElementById('pocketAmount').value;
    const newAmount = amountRaw === '' ? cat.balance : (parseFloat(amountRaw) || 0);
    if(newAmount < 0){ err.textContent = 'Amount cannot be negative.'; return; }
    const diff = newAmount - cat.balance;
    if(diff > 0 && state.categories.excess.balance < diff){
      err.textContent = 'Not enough in Excess (have ' + fmt(state.categories.excess.balance) + ').'; return;
    }
    cat.name = name;
    cat.icon = pocketSelectedIcon;
    if(diff !== 0){
      cat.balance = newAmount;
      state.categories.excess.balance -= diff;
      state.transactions.push({ id:uid(), type:'transfer',
        from: diff > 0 ? 'excess' : currentPocketKey,
        to:   diff > 0 ? currentPocketKey : 'excess',
        amount: Math.abs(diff), date:new Date().toISOString() });
    }
    saveState(); closeAllSheets(); renderAll();
    showToast('Saved "' + name + '"');
  });

  document.getElementById('pocketReturnBtn').addEventListener('click', () => {
    const cat = state.categories[currentPocketKey];
    if(!cat || cat.balance === 0){ closeAllSheets(); return; }
    const amount = cat.balance;
    state.categories.excess.balance += amount;
    cat.balance = 0;
    state.transactions.push({ id:uid(), type:'transfer', from:currentPocketKey, to:'excess', amount, date:new Date().toISOString() });
    saveState(); closeAllSheets(); renderAll();
    showToast('Returned ' + fmt(amount) + ' to Excess');
  });

  document.getElementById('pocketDeleteBtn').addEventListener('click', () => {
    deletePocket(currentPocketKey);
  });

  // Add pocket
  document.getElementById('addPocketForm').addEventListener('submit', e => {
    e.preventDefault();
    const name = document.getElementById('addPocketName').value.trim();
    const err = document.getElementById('addPocketError');
    if(!name){ err.textContent = 'Give your pocket a name.'; return; }
    const key = 'pocket_' + uid();
    state.categories[key] = { name, balance:0, icon:addPocketSelectedIcon };
    state.catOrder.push(key);
    saveState(); closeAllSheets(); renderAll();
    showToast('"' + name + '" pocket created');
  });

  // Expense
  document.getElementById('expenseForm').addEventListener('submit', e => {
    e.preventDefault();
    const category = document.getElementById('expenseCategory').value;
    const amount = parseFloat(document.getElementById('expenseAmount').value);
    const note = document.getElementById('expenseNote').value.trim();
    const paymentMethod = document.querySelector('input[name="expensePm"]:checked').value;
    const err = document.getElementById('expenseError');
    if(!amount || amount <= 0){ err.textContent = 'Enter an amount greater than 0.'; return; }
    state.categories[category].balance -= amount;
    state.paymentMethods[paymentMethod] -= amount;
    state.transactions.push({ id:uid(), type:'expense', category, amount, note:note||undefined, paymentMethod, date:new Date().toISOString() });
    saveState(); closeAllSheets(); renderAll();
    showToast('Logged ' + fmt(amount) + ' from ' + catName(category));
  });

  // New goal
  document.getElementById('goalForm').addEventListener('submit', e => {
    e.preventDefault();
    const title = document.getElementById('goalTitle').value.trim();
    const target = parseFloat(document.getElementById('goalTarget').value);
    const deadline = document.getElementById('goalDeadline').value || null;
    const err = document.getElementById('goalError');
    if(!title){ err.textContent = 'Give your goal a title.'; return; }
    if(!target || target <= 0){ err.textContent = 'Target should be greater than 0.'; return; }
    state.goals.push({ id:uid(), title, target, saved:0, deadline, createdAt:new Date().toISOString() });
    saveState(); closeAllSheets(); renderAll();
    showToast('Goal created');
  });

  // Fund goal
  document.getElementById('fundGoalForm').addEventListener('submit', e => {
    e.preventDefault();
    const source = 'excess';
    const amount = parseFloat(document.getElementById('fundGoalAmount').value);
    const err = document.getElementById('fundGoalError');
    const goal = state.goals.find(g => g.id === currentFundGoalId);
    if(!goal) return;
    if(!amount || amount <= 0){ err.textContent = 'Enter an amount greater than 0.'; return; }
    if(state.categories.excess.balance < amount){ err.textContent = 'Not enough in Excess.'; return; }
    state.categories.excess.balance -= amount;
    goal.saved += amount;
    state.transactions.push({ id:uid(), type:'goal_fund', category:source, amount, goalId:goal.id, date:new Date().toISOString() });
    saveState(); closeAllSheets(); renderAll();
    showToast('Added ' + fmt(amount) + ' to "' + goal.title + '"');
  });

  // Backup
  document.getElementById('exportBtn').addEventListener('click', downloadBackup);

  document.getElementById('importInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try{
        const parsed = JSON.parse(reader.result);
        if(!parsed.categories || !parsed.catOrder) throw new Error('bad shape');
        if(!confirm('Import this backup? It will replace all current data.')) return;
        state = migrateState(parsed);
        saveState(); renderAll(); closeAllSheets();
        showToast('Backup imported');
      }catch(err){ alert("That file doesn't look like a valid Pocket backup."); }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  document.getElementById('resetBtn').addEventListener('click', () => {
    if(!confirm('Erase everything? This cannot be undone unless you have a backup.')) return;
    state = defaultState();
    saveState(); renderAll(); closeAllSheets();
    showToast('All data erased');
  });
});