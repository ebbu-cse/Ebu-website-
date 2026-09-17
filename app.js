/* ---------- Storage ---------- */
const STORE_KEY = "taskstar:v1";

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { tasks: [], achievements: [] };
}

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

let state = loadState();
let activeTab = "active";
let editingId = null;

/* ---------- Helpers ---------- */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function dayKey(d) {
  return startOfDay(d).toISOString().slice(0, 10);
}

function dayLabel(dateStr) {
  const today = startOfDay(new Date());
  const d = startOfDay(new Date(dateStr));
  const diff = Math.round((today - d) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff > 1) return `${diff} days ago`;
  if (diff === -1) return "Tomorrow";
  if (diff < -1) return `In ${-diff} days`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtDate(dateStr) {
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtTime(dateStr) {
  return new Date(dateStr).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function fmtCountdown(ms) {
  const overdue = ms < 0;
  const abs = Math.abs(ms);
  const d = Math.floor(abs / 86400000);
  const h = Math.floor((abs % 86400000) / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const s = Math.floor((abs % 60000) / 1000);
  let str;
  if (d > 0) str = `${d}d ${h}h`;
  else if (h > 0) str = `${h}h ${m}m`;
  else if (m > 0) str = `${m}m ${s}s`;
  else str = `${s}s`;
  return overdue ? `Overdue ${str}` : `${str} left`;
}

function starsForTask(task) {
  return task.special ? 25 : 10;
}

function totalStars() {
  return state.tasks
    .filter((t) => t.completed)
    .reduce((sum, t) => sum + starsForTask(t), 0);
}

/* ---------- Grouping ---------- */
function groupByDay(tasks, field) {
  const groups = {};
  tasks.forEach((t) => {
    const key = dayKey(t[field]);
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  });
  return Object.keys(groups)
    .sort((a, b) => (a < b ? 1 : -1))
    .map((key) => ({
      key,
      label: dayLabel(key),
      date: fmtDate(key),
      items: groups[key].sort((a, b) => new Date(b[field]) - new Date(a[field])),
    }));
}

/* ---------- Rendering ---------- */
const el = (sel) => document.querySelector(sel);

function render() {
  renderStarTotal();
  renderTodayCard();
  renderWeekStrip();
  renderTabs();
  renderList();
  saveState();
}

function renderStarTotal() {
  el("#starTotal").textContent = totalStars();
}

function renderTodayCard() {
  const key = dayKey(new Date());
  const todays = state.tasks.filter((t) => dayKey(t.createdAt) === key);
  const done = todays.filter((t) => t.completed).length;
  const total = todays.length;
  const pct = total ? Math.round((done / total) * 100) : 0;
  el("#todayCount").textContent = total ? `${done} / ${total} done` : "No tasks yet";
  el("#todayBarFill").style.width = pct + "%";
}

function renderWeekStrip() {
  const strip = el("#weekStrip");
  strip.innerHTML = "";
  const counts = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = dayKey(d);
    const c = state.tasks.filter((t) => t.completed && dayKey(t.completedAt) === key).length;
    counts.push({ key, c, d });
  }
  const max = Math.max(1, ...counts.map((x) => x.c));
  counts.forEach(({ c, d }) => {
    const wrap = document.createElement("div");
    wrap.className = "week-day";
    const pctH = Math.max(6, Math.round((c / max) * 100));
    wrap.innerHTML = `
      <div class="dot-track"><div class="dot-fill" style="height:${c ? pctH : 0}%"></div></div>
      <span class="dlabel">${d.toLocaleDateString(undefined, { weekday: "narrow" })}</span>
    `;
    strip.appendChild(wrap);
  });
}

function renderTabs() {
  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.classList.toggle("active", b.dataset.tab === activeTab);
  });
}

function renderList() {
  const container = el("#listContainer");
  container.innerHTML = "";

  let groups;
  if (activeTab === "active") {
    const tasks = state.tasks.filter((t) => !t.completed);
    groups = groupByDay(tasks, "createdAt");
  } else if (activeTab === "completed") {
    const tasks = state.tasks.filter((t) => t.completed);
    groups = groupByDay(tasks, "completedAt");
  } else {
    const tasks = state.tasks.filter((t) => t.completed && t.special);
    groups = groupByDay(tasks, "completedAt");
  }

  if (!groups.length) {
    container.innerHTML = `<div class="empty-state">${
      activeTab === "active"
        ? "Nothing here. Tap + to add your first task."
        : activeTab === "completed"
        ? "No completed tasks yet."
        : "Mark a task as special and complete it to earn an achievement."
    }</div>`;
    return;
  }

  groups.forEach((g) => {
    const section = document.createElement("div");
    section.className = "day-section";
    section.innerHTML = `
      <div class="day-heading"><h2>${g.label}</h2><span class="day-date">${g.date}</span></div>
      <div class="task-list"></div>
    `;
    const list = section.querySelector(".task-list");
    g.items.forEach((t) => list.appendChild(renderTaskCard(t)));
    container.appendChild(section);
  });
}

function renderTaskCard(t) {
  const card = document.createElement("div");
  card.className = "task-card" + (t.special ? " special" : "") + (t.completed ? " completed" : "");
  card.dataset.id = t.id;

  let meta = "";
  if (t.special) meta += `<span class="pill star-pill">★ ${starsForTask(t)}</span>`;
  if (t.deadline && !t.completed) {
    meta += `<span class="pill timer-pill" data-deadline="${t.deadline}">…</span>`;
  }
  if (t.reminderAt && !t.completed) {
    meta += `<span class="pill remind-pill">🔔 ${fmtDate(t.reminderAt)}, ${fmtTime(t.reminderAt)}</span>`;
  }
  if (t.completed) {
    meta += `<span class="pill">done ${fmtTime(t.completedAt)}</span>`;
  }

  card.innerHTML = `
    <button class="check ${t.completed ? "checked" : ""}" aria-label="Toggle complete">
      <svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <div class="task-body">
      <div class="task-text">${escapeHtml(t.text)}</div>
      <div class="task-meta">${meta}</div>
    </div>
    <div class="task-actions">
      <button class="icon-btn del-btn" aria-label="Delete">✕</button>
    </div>
  `;

  card.querySelector(".check").addEventListener("click", () => toggleComplete(t.id));
  card.querySelector(".del-btn").addEventListener("click", () => deleteTask(t.id));

  return card;
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

/* ---------- Actions ---------- */
function addTask({ text, special, deadline, reminderAt }) {
  state.tasks.push({
    id: uid(),
    text,
    createdAt: new Date().toISOString(),
    special,
    deadline: deadline || null,
    reminderAt: reminderAt || null,
    notified: false,
    completed: false,
    completedAt: null,
  });
  render();
}

function toggleComplete(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  t.completed = !t.completed;
  t.completedAt = t.completed ? new Date().toISOString() : null;
  render();
  if (t.completed) {
    confettiBurst();
    if (t.special) showAchievementToast(t.text);
  }
}

function deleteTask(id) {
  state.tasks = state.tasks.filter((x) => x.id !== id);
  render();
}

/* ---------- Sheet (add task) ---------- */
const backdrop = () => el("#sheetBackdrop");

function openSheet() {
  el("#taskText").value = "";
  el("#deadlineInput").value = "";
  el("#reminderInput").value = "";
  setSwitch("#specialSwitch", false);
  backdrop().classList.add("open");
  setTimeout(() => el("#taskText").focus(), 50);
}

function closeSheet() {
  backdrop().classList.remove("open");
}

function setSwitch(sel, on) {
  const s = el(sel);
  s.classList.toggle("on", on);
  s.dataset.on = on ? "1" : "0";
}

/* ---------- Countdown ticking ---------- */
function tickCountdowns() {
  document.querySelectorAll(".timer-pill[data-deadline]").forEach((pillEl) => {
    const deadline = new Date(pillEl.dataset.deadline).getTime();
    const diff = deadline - Date.now();
    pillEl.textContent = "⏱ " + fmtCountdown(diff);
    pillEl.classList.toggle("overdue", diff < 0);
  });
}

/* ---------- Reminders ---------- */
function checkReminders() {
  const now = Date.now();
  let changed = false;
  state.tasks.forEach((t) => {
    if (t.reminderAt && !t.notified && !t.completed && new Date(t.reminderAt).getTime() <= now) {
      fireNotification("Task reminder", t.text);
      t.notified = true;
      changed = true;
    }
  });
  if (changed) saveState();
}

function fireNotification(title, body) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: "SHOW_NOTIFICATION",
        payload: { title, body, tag: "taskstar-reminder" },
      });
    } else {
      new Notification(title, { body, icon: "icon-192.png" });
    }
  }
}

function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission();
  }
}

/* ---------- Achievement toast ---------- */
function showAchievementToast(text) {
  const toast = el("#achieveToast");
  toast.textContent = "🏆 Achievement unlocked: " + text;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2600);
}

/* ---------- Confetti ---------- */
function confettiBurst() {
  const canvas = el("#confetti-canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  const colors = ["#ffc857", "#7c6cf6", "#2dd4bf", "#f2716d"];
  const particles = Array.from({ length: 60 }, () => ({
    x: canvas.width / 2,
    y: canvas.height * 0.4,
    vx: (Math.random() - 0.5) * 12,
    vy: Math.random() * -10 - 4,
    size: Math.random() * 6 + 4,
    color: colors[Math.floor(Math.random() * colors.length)],
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
  }));
  let frame = 0;
  function step() {
    frame++;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((p) => {
      p.vy += 0.35;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    });
    if (frame < 90) requestAnimationFrame(step);
    else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  step();
}

/* ---------- Backup / restore ---------- */
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `taskstar-backup-${dayKey(new Date())}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.tasks)) throw new Error("bad file");
      state = data;
      render();
      alert("Backup restored.");
    } catch (e) {
      alert("Couldn't read that file.");
    }
  };
  reader.readAsText(file);
}

/* ---------- Wire up ---------- */
window.addEventListener("DOMContentLoaded", () => {
  render();
  requestNotificationPermission();
  setInterval(tickCountdowns, 1000);
  setInterval(checkReminders, 20000);
  checkReminders();

  el("#fab").addEventListener("click", openSheet);
  el("#sheetBackdrop").addEventListener("click", (e) => {
    if (e.target.id === "sheetBackdrop") closeSheet();
  });
  el("#cancelBtn").addEventListener("click", closeSheet);

  el("#specialSwitch").addEventListener("click", (e) => {
    const on = e.currentTarget.dataset.on === "1";
    setSwitch("#specialSwitch", !on);
  });

  el("#saveTaskBtn").addEventListener("click", () => {
    const text = el("#taskText").value.trim();
    if (!text) {
      el("#taskText").focus();
      return;
    }
    const special = el("#specialSwitch").dataset.on === "1";
    const deadline = el("#deadlineInput").value ? new Date(el("#deadlineInput").value).toISOString() : null;
    const reminderAt = el("#reminderInput").value ? new Date(el("#reminderInput").value).toISOString() : null;
    addTask({ text, special, deadline, reminderAt });
    if (reminderAt) requestNotificationPermission();
    closeSheet();
  });

  document.querySelectorAll(".tab-btn").forEach((b) => {
    b.addEventListener("click", () => {
      activeTab = b.dataset.tab;
      renderTabs();
      renderList();
    });
  });

  el("#exportBtn").addEventListener("click", exportData);
  el("#importInput").addEventListener("change", (e) => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = "";
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
});
