/* ================= Storage ================= */
const STORE_KEY = "taskstar:v2";

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return migrateState(JSON.parse(raw));
  } catch (e) {}
  return { tasks: [], lists: [], notes: [], settings: { theme: "dark", accent: "violet" } };
}

function migrateState(s) {
  if (!s.lists) s.lists = [];
  if (!s.notes) s.notes = [];
  if (!s.settings) s.settings = { theme: "dark", accent: "violet" };
  (s.tasks || []).forEach((t) => { if (t.deletedAt === undefined) t.deletedAt = null; });
  return s;
}

function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

let state = loadState();
let activeTab = "active";
let currentView = "tasks";
let searchQuery = "";
let editingTaskId = null;
let editingNoteId = null; // { type: 'note'|'list', id }
let editingNoteType = null;
let confirmCallback = null;
let openDropdownEl = null;

const ACCENTS = {
  violet: { c: "#7c6cf6", soft: "rgba(124,108,246,0.16)" },
  red: { c: "#f2716d", soft: "rgba(242,113,109,0.16)" },
  blue: { c: "#5b9df9", soft: "rgba(91,157,249,0.16)" },
  purple: { c: "#b06cf6", soft: "rgba(176,108,246,0.16)" },
};

/* ================= Helpers ================= */
const el = (sel) => document.querySelector(sel);
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str == null ? "" : str;
  return d.innerHTML;
}

// Local-date key (fixes the UTC off-by-one-day bug)
function dayKey(d) {
  const x = new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

function dayLabel(dateKeyStr) {
  const today = dayKey(new Date());
  const [ty, tm, td] = today.split("-").map(Number);
  const [ky, km, kd] = dateKeyStr.split("-").map(Number);
  const diff = Math.round((new Date(ty, tm - 1, td) - new Date(ky, km - 1, kd)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff > 1) return `${diff} days ago`;
  if (diff === -1) return "Tomorrow";
  if (diff < -1) return `In ${-diff} days`;
  return new Date(ky, km - 1, kd).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function fmtDate(dateStr) {
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

// Exact time like "1:25am"
function fmtTime(dateStr) {
  const d = new Date(dateStr);
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const ampm = h >= 12 ? "pm" : "am";
  h = h % 12; if (h === 0) h = 12;
  return `${h}:${m}${ampm}`;
}

function fmtDateTime(dateStr) { return `${fmtDate(dateStr)}, ${fmtTime(dateStr)}`; }

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

function starsForTask(task) { return task.special ? 25 : 10; }
function totalStars() {
  return state.tasks.filter((t) => t.completed && !t.deletedAt).reduce((sum, t) => sum + starsForTask(t), 0);
}

function groupByDay(items, field) {
  const groups = {};
  items.forEach((t) => {
    const key = dayKey(t[field]);
    if (!groups[key]) groups[key] = [];
    groups[key].push(t);
  });
  return Object.keys(groups)
    .sort((a, b) => (a < b ? 1 : -1))
    .map((key) => ({
      key, label: dayLabel(key), date: dayLabel(key) === "Today" || dayLabel(key) === "Yesterday" ? fmtDate(key + "T12:00") : fmtDate(key + "T12:00"),
      items: groups[key].sort((a, b) => new Date(b[field]) - new Date(a[field])),
    }));
}

function closeDropdowns() {
  document.querySelectorAll(".dropdown.open").forEach((d) => d.classList.remove("open"));
  openDropdownEl = null;
}

function showToast(msg) {
  const t = el("#toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

/* ================= Theme & accent ================= */
function applyAccent(name) {
  const a = ACCENTS[name] || ACCENTS.violet;
  document.documentElement.style.setProperty("--violet", a.c);
  document.documentElement.style.setProperty("--violet-soft", a.soft);
  document.querySelectorAll(".accent-dot").forEach((d) => d.classList.toggle("active", d.dataset.accent === name));
  state.settings.accent = name;
  saveState();
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  el("#themeBtn").textContent = theme === "dark" ? "🌙" : "☀️";
  const sw = document.getElementById("settingsThemeSwitch");
  if (sw) { sw.classList.toggle("on", theme === "dark"); sw.dataset.on = theme === "dark" ? "1" : "0"; }
  state.settings.theme = theme;
  saveState();
}

/* ================= Rendering: Tasks view ================= */
function renderStarTotal() { el("#starTotal").textContent = totalStars(); }

function renderTodayCard() {
  const key = dayKey(new Date());
  const todays = state.tasks.filter((t) => !t.deletedAt && dayKey(t.createdAt) === key);
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
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = dayKey(d);
    const c = state.tasks.filter((t) => !t.deletedAt && t.completed && dayKey(t.completedAt) === key).length;
    counts.push({ c, d });
  }
  const max = Math.max(1, ...counts.map((x) => x.c));
  counts.forEach(({ c, d }) => {
    const wrap = document.createElement("div");
    wrap.className = "week-day";
    const pctH = Math.max(6, Math.round((c / max) * 100));
    wrap.innerHTML = `<div class="dot-track"><div class="dot-fill" style="height:${c ? pctH : 0}%"></div></div><span class="dlabel">${d.toLocaleDateString(undefined, { weekday: "narrow" })}</span>`;
    strip.appendChild(wrap);
  });
}

function matchesSearch(text) {
  if (!searchQuery) return true;
  return text.toLowerCase().includes(searchQuery.toLowerCase());
}

function renderTaskList() {
  const container = el("#listContainer");
  container.innerHTML = "";

  let tasks = state.tasks.filter((t) => !t.deletedAt);
  let groups;
  if (activeTab === "active") {
    groups = groupByDay(tasks.filter((t) => !t.completed && matchesSearch(t.text)), "createdAt");
  } else if (activeTab === "completed") {
    groups = groupByDay(tasks.filter((t) => t.completed && matchesSearch(t.text)), "completedAt");
  } else {
    groups = groupByDay(tasks.filter((t) => t.completed && t.special && matchesSearch(t.text)), "completedAt");
  }

  if (!groups.length) {
    container.innerHTML = `<div class="empty-state">${
      activeTab === "active" ? "Nothing here. Tap + to add your first task." :
      activeTab === "completed" ? "No completed tasks yet." :
      "Mark a task as special and complete it to earn an achievement."
    }</div>`;
    return;
  }

  groups.forEach((g) => {
    const section = document.createElement("div");
    section.className = "day-section";
    section.innerHTML = `<div class="day-heading"><h2>${g.label}</h2><span class="day-date">${g.date}</span></div><div class="task-list"></div>`;
    const list = section.querySelector(".task-list");
    g.items.forEach((t) => list.appendChild(renderTaskCard(t)));
    container.appendChild(section);
  });
}

function renderTaskCard(t) {
  const card = document.createElement("div");
  card.className = "item-card" + (t.special ? " special" : "") + (t.completed ? " completed" : "");

  let meta = "";
  if (t.special) meta += `<span class="pill star-pill">★ ${starsForTask(t)}</span>`;
  if (t.deadline && !t.completed) meta += `<span class="pill timer-pill" data-deadline="${t.deadline}">…</span>`;
  if (t.reminderAt && !t.completed) meta += `<span class="pill remind-pill">🔔 ${fmtDateTime(t.reminderAt)}</span>`;
  if (t.completed) meta += `<span class="pill">done ${fmtDateTime(t.completedAt)}</span>`;
  else meta += `<span class="pill">created ${fmtDateTime(t.createdAt)}</span>`;

  card.innerHTML = `
    <button class="check ${t.completed ? "checked" : ""}" aria-label="Toggle complete">
      <svg viewBox="0 0 24 24" fill="none"><path d="M5 13l4 4L19 7" stroke="white" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
    <div class="item-body">
      <div class="item-title">${escapeHtml(t.text)}</div>
      <div class="item-meta">${meta}</div>
    </div>
    <div class="more-wrap">
      <button class="more-btn">⋮</button>
      <div class="dropdown">
        <button class="edit-opt">Edit</button>
        <button class="danger del-opt">Delete</button>
      </div>
    </div>
  `;

  card.querySelector(".check").addEventListener("click", () => toggleComplete(t.id));
  card.querySelector(".item-body").addEventListener("click", () => openTaskSheet(t.id));
  wireMoreMenu(card, () => openTaskSheet(t.id), () => confirmDelete("task", t.id, t.text));

  return card;
}

function wireMoreMenu(card, onEdit, onDelete) {
  const moreBtn = card.querySelector(".more-btn");
  const dropdown = card.querySelector(".dropdown");
  moreBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const wasOpen = dropdown.classList.contains("open");
    closeDropdowns();
    if (!wasOpen) { dropdown.classList.add("open"); openDropdownEl = dropdown; }
  });
  dropdown.querySelector(".edit-opt").addEventListener("click", (e) => { e.stopPropagation(); closeDropdowns(); onEdit(); });
  dropdown.querySelector(".del-opt").addEventListener("click", (e) => { e.stopPropagation(); closeDropdowns(); onDelete(); });
}

/* ================= Task actions ================= */
function toggleComplete(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  t.completed = !t.completed;
  t.completedAt = t.completed ? new Date().toISOString() : null;
  renderAll();
  if (t.completed) {
    confettiBurst();
    if (t.special) showAchievementToast(t.text);
  }
}

function softDeleteTask(id) {
  const t = state.tasks.find((x) => x.id === id);
  if (!t) return;
  t.deletedAt = new Date().toISOString();
  renderAll();
  showToast("Task moved to trash");
}

/* ================= Task sheet (add / edit) ================= */
function openTaskSheet(id) {
  editingTaskId = id || null;
  const t = id ? state.tasks.find((x) => x.id === id) : null;
  el("#taskSheetTitle").textContent = t ? "Edit task" : "New task";
  el("#saveTaskBtn").textContent = t ? "Save changes" : "Add task";
  el("#taskText").value = t ? t.text : "";
  el("#deadlineInput").value = t && t.deadline ? toLocalInputValue(t.deadline) : "";
  el("#reminderInput").value = t && t.reminderAt ? toLocalInputValue(t.reminderAt) : "";
  setSwitch("#specialSwitch", t ? !!t.special : false);
  el("#sheetBackdrop").classList.add("open");
  setTimeout(() => el("#taskText").focus(), 50);
}

function toLocalInputValue(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function closeTaskSheet() { el("#sheetBackdrop").classList.remove("open"); editingTaskId = null; }

function setSwitch(sel, on) {
  const s = el(sel);
  s.classList.toggle("on", on);
  s.dataset.on = on ? "1" : "0";
}

function saveTaskFromSheet() {
  const text = el("#taskText").value.trim();
  if (!text) { el("#taskText").focus(); return; }
  const special = el("#specialSwitch").dataset.on === "1";
  const deadline = el("#deadlineInput").value ? new Date(el("#deadlineInput").value).toISOString() : null;
  const reminderAt = el("#reminderInput").value ? new Date(el("#reminderInput").value).toISOString() : null;

  if (editingTaskId) {
    const t = state.tasks.find((x) => x.id === editingTaskId);
    if (t) {
      t.text = text; t.special = special; t.deadline = deadline;
      if (t.reminderAt !== reminderAt) t.notified = false;
      t.reminderAt = reminderAt;
    }
  } else {
    state.tasks.push({
      id: uid(), text, createdAt: new Date().toISOString(), special,
      deadline, reminderAt, notified: false, completed: false, completedAt: null, deletedAt: null,
    });
  }
  if (reminderAt) requestNotificationPermission();
  closeTaskSheet();
  renderAll();
}

/* ================= Notes & Lists ================= */
function renderCardCollection(containerSel, items, type, emptyMsg) {
  const container = el(containerSel);
  container.innerHTML = "";
  const visible = items.filter((i) => !i.deletedAt && matchesSearch(i.title + " " + (i.body || "") + " " + (i.tags || []).join(" ")));
  if (!visible.length) { container.innerHTML = `<div class="empty-state">${emptyMsg}</div>`; return; }
  visible.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).forEach((item) => {
    container.appendChild(renderNoteCard(item, type));
  });
}

function renderNoteCard(item, type) {
  const card = document.createElement("div");
  card.className = "item-card";
  const tagPills = (item.tags || []).map((tg) => `<span class="pill tag-pill">#${escapeHtml(tg)}</span>`).join("");
  card.innerHTML = `
    <div class="item-body">
      <div class="item-title">${escapeHtml(item.title || "Untitled")}</div>
      ${item.body ? `<div class="item-snippet">${escapeHtml(item.body.slice(0, 90))}${item.body.length > 90 ? "…" : ""}</div>` : ""}
      <div class="item-meta">${tagPills}<span class="pill">${fmtDateTime(item.createdAt)}</span></div>
    </div>
    <div class="more-wrap">
      <button class="more-btn">⋮</button>
      <div class="dropdown">
        <button class="edit-opt">Edit</button>
        <button class="danger del-opt">Delete</button>
      </div>
    </div>
  `;
  card.querySelector(".item-body").addEventListener("click", () => openNoteSheet(type, item.id));
  wireMoreMenu(card, () => openNoteSheet(type, item.id), () => confirmDelete(type, item.id, item.title));
  return card;
}

function openNoteSheet(type, id) {
  editingNoteType = type;
  editingNoteId = id || null;
  const coll = type === "note" ? state.notes : state.lists;
  const item = id ? coll.find((x) => x.id === id) : null;
  el("#noteSheetTitle").textContent = (item ? "Edit " : "New ") + (type === "note" ? "note" : "list");
  el("#noteTitle").value = item ? item.title : "";
  el("#noteTags").value = item ? (item.tags || []).join(", ") : "";
  el("#noteBody").value = item ? item.body || "" : "";
  el("#noteSheetBackdrop").classList.add("open");
  setTimeout(() => el("#noteTitle").focus(), 50);
}

function closeNoteSheet() { el("#noteSheetBackdrop").classList.remove("open"); editingNoteId = null; editingNoteType = null; }

function saveNoteFromSheet() {
  const title = el("#noteTitle").value.trim();
  if (!title) { el("#noteTitle").focus(); return; }
  const tags = el("#noteTags").value.split(",").map((s) => s.trim()).filter(Boolean);
  const body = el("#noteBody").value;
  const coll = editingNoteType === "note" ? state.notes : state.lists;
  if (editingNoteId) {
    const item = coll.find((x) => x.id === editingNoteId);
    if (item) { item.title = title; item.tags = tags; item.body = body; }
  } else {
    coll.push({ id: uid(), title, tags, body, createdAt: new Date().toISOString(), deletedAt: null });
  }
  closeNoteSheet();
  renderAll();
}

function softDeleteItem(type, id) {
  const coll = type === "note" ? state.notes : type === "list" ? state.lists : state.tasks;
  const item = coll.find((x) => x.id === id);
  if (item) item.deletedAt = new Date().toISOString();
  renderAll();
  showToast((type === "task" ? "Task" : type === "note" ? "Note" : "List") + " moved to trash");
}

/* ================= Trash ================= */
function renderTrash() {
  const container = el("#trashContainer");
  container.innerHTML = "";
  const deletedTasks = state.tasks.filter((t) => t.deletedAt);
  const deletedNotes = state.notes.filter((n) => n.deletedAt);
  const deletedLists = state.lists.filter((l) => l.deletedAt);
  const all = [
    ...deletedTasks.map((t) => ({ type: "task", id: t.id, label: t.text, deletedAt: t.deletedAt, icon: "✅" })),
    ...deletedNotes.map((n) => ({ type: "note", id: n.id, label: n.title, deletedAt: n.deletedAt, icon: "📝" })),
    ...deletedLists.map((l) => ({ type: "list", id: l.id, label: l.title, deletedAt: l.deletedAt, icon: "📋" })),
  ].sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));

  if (!all.length) { container.innerHTML = `<div class="empty-state">Trash is empty.</div>`; return; }

  all.forEach((entry) => {
    const card = document.createElement("div");
    card.className = "item-card";
    card.innerHTML = `
      <div class="item-body" style="cursor:default;">
        <div class="item-title">${entry.icon} ${escapeHtml(entry.label || "Untitled")}</div>
        <div class="item-meta"><span class="pill">deleted ${fmtDateTime(entry.deletedAt)}</span></div>
      </div>
      <div class="more-wrap"><button class="btn ghost" style="padding:8px 12px;font-size:12px;" >Restore</button></div>
    `;
    card.querySelector("button").addEventListener("click", () => restoreItem(entry.type, entry.id));
    container.appendChild(card);
  });
}

function restoreItem(type, id) {
  const coll = type === "task" ? state.tasks : type === "note" ? state.notes : state.lists;
  const item = coll.find((x) => x.id === id);
  if (item) item.deletedAt = null;
  renderAll();
  showToast("Restored");
}

/* ================= Confirm modal ================= */
function confirmDelete(type, id, label) {
  el("#confirmTitle").textContent = `Delete "${(label || "this item").slice(0, 40)}"?`;
  el("#confirmMsg").textContent = "You can recover it from the trash bin later.";
  confirmCallback = () => softDeleteItem(type, id);
  el("#confirmBackdrop").classList.add("open");
}

function closeConfirm() { el("#confirmBackdrop").classList.remove("open"); confirmCallback = null; }

/* ================= View switching ================= */
function switchView(view) {
  currentView = view;
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("active"));
  el("#view-" + view).classList.add("active");
  document.querySelectorAll(".nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  el("#fab").style.display = ["tasks", "notes", "lists"].includes(view) ? "flex" : "none";
  el("#searchInput").placeholder =
    view === "tasks" ? "Search tasks..." : view === "notes" ? "Search notes..." : view === "lists" ? "Search lists..." : "Search...";
  renderAll();
}

function fabAction() {
  if (currentView === "tasks") openTaskSheet(null);
  else if (currentView === "notes") openNoteSheet("note", null);
  else if (currentView === "lists") openNoteSheet("list", null);
}

/* ================= Countdown ticking ================= */
function tickCountdowns() {
  document.querySelectorAll(".timer-pill[data-deadline]").forEach((pillEl) => {
    const deadline = new Date(pillEl.dataset.deadline).getTime();
    const diff = deadline - Date.now();
    pillEl.textContent = "⏱ " + fmtCountdown(diff);
    pillEl.classList.toggle("overdue", diff < 0);
  });
}

/* ================= Reminders / notifications ================= */
function checkReminders() {
  const now = Date.now();
  let changed = false;
  state.tasks.forEach((t) => {
    if (t.reminderAt && !t.notified && !t.completed && !t.deletedAt && new Date(t.reminderAt).getTime() <= now) {
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
      navigator.serviceWorker.controller.postMessage({ type: "SHOW_NOTIFICATION", payload: { title, body, tag: "taskstar-reminder" } });
    } else {
      new Notification(title, { body, icon: "icon-192.png" });
    }
  }
}

function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") Notification.requestPermission();
}

/* ================= Achievements toast + confetti ================= */
function showAchievementToast(text) {
  const toast = el("#achieveToast");
  toast.textContent = "🏆 Achievement unlocked: " + text;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2600);
}

function confettiBurst() {
  const canvas = el("#confetti-canvas");
  const ctx = canvas.getContext("2d");
  canvas.width = window.innerWidth; canvas.height = window.innerHeight;
  const colors = [ACCENTS[state.settings.accent].c, "#ffc857", "#2dd4bf", "#f2716d"];
  const particles = Array.from({ length: 60 }, () => ({
    x: canvas.width / 2, y: canvas.height * 0.4,
    vx: (Math.random() - 0.5) * 12, vy: Math.random() * -10 - 4,
    size: Math.random() * 6 + 4, color: colors[Math.floor(Math.random() * colors.length)],
    rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.3,
  }));
  let frame = 0;
  function step() {
    frame++;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((p) => {
      p.vy += 0.35; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    });
    if (frame < 90) requestAnimationFrame(step); else ctx.clearRect(0, 0, canvas.width, canvas.height);
  }
  step();
}

/* ================= Backup / restore ================= */
function exportData() {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `taskstar-backup-${dayKey(new Date())}.json`; a.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (!Array.isArray(data.tasks)) throw new Error("bad file");
      state = migrateState(data);
      applyTheme(state.settings.theme); applyAccent(state.settings.accent);
      renderAll();
      showToast("Backup restored");
    } catch (e) { alert("Couldn't read that file."); }
  };
  reader.readAsText(file);
}

/* ================= Calculator ================= */
let calcExpr = "";
function calcPress(k) {
  if (k === "C") { calcExpr = ""; }
  else if (k === "=") {
    try {
      if (!/^[0-9+\-*/().\s]+$/.test(calcExpr)) throw new Error("bad");
      const result = Function('"use strict"; return (' + calcExpr + ")")();
      if (!isFinite(result)) throw new Error("inf");
      el("#calcSub").textContent = calcExpr + " =";
      calcExpr = String(Math.round(result * 1e10) / 1e10);
    } catch (e) { el("#calcSub").textContent = "Error"; calcExpr = ""; }
  } else {
    calcExpr += k;
  }
  el("#calcDisplay").textContent = calcExpr || "0";
}

/* ================= Stopwatch / Timer ================= */
let timerMode = "stopwatch";
let swElapsed = 0, swRunning = false, swStart = 0, swInterval = null;
let tmTotal = 0, tmRemaining = 0, tmRunning = false, tmInterval = null;
let laps = [];

function fmtStopwatch(ms) {
  const cs = Math.floor((ms % 1000) / 100);
  const s = Math.floor(ms / 1000) % 60;
  const m = Math.floor(ms / 60000);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${cs}`;
}
function fmtTimer(sec) {
  const s = Math.max(0, Math.ceil(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function updateTimerDisplay() {
  if (timerMode === "stopwatch") {
    const elapsed = swRunning ? swElapsed + (Date.now() - swStart) : swElapsed;
    el("#timerDisplay").textContent = fmtStopwatch(elapsed);
  } else {
    el("#timerDisplay").textContent = fmtTimer(tmRemaining);
  }
}

function timerStartPause() {
  if (timerMode === "stopwatch") {
    if (!swRunning) {
      swRunning = true; swStart = Date.now();
      swInterval = setInterval(updateTimerDisplay, 100);
      el("#timerStartBtn").textContent = "⏸";
    } else {
      swRunning = false; swElapsed += Date.now() - swStart;
      clearInterval(swInterval);
      el("#timerStartBtn").textContent = "▶";
    }
  } else {
    if (!tmRunning) {
      if (tmRemaining <= 0) {
        const min = parseInt(el("#timerMin").value, 10) || 0;
        const sec = parseInt(el("#timerSec").value, 10) || 0;
        tmTotal = min * 60 + sec;
        tmRemaining = tmTotal;
      }
      if (tmRemaining <= 0) return;
      tmRunning = true;
      const tick = () => {
        tmRemaining -= 0.1;
        if (tmRemaining <= 0) {
          tmRemaining = 0; tmRunning = false; clearInterval(tmInterval);
          el("#timerStartBtn").textContent = "▶";
          updateTimerDisplay();
          confettiBurst();
          fireNotification("Timer done", "Your countdown timer has finished.");
          showToast("Timer done!");
          return;
        }
        updateTimerDisplay();
      };
      tmInterval = setInterval(tick, 100);
      el("#timerStartBtn").textContent = "⏸";
    } else {
      tmRunning = false; clearInterval(tmInterval);
      el("#timerStartBtn").textContent = "▶";
    }
  }
}

function timerReset() {
  if (timerMode === "stopwatch") {
    swRunning = false; swElapsed = 0; clearInterval(swInterval);
    laps = []; renderLaps();
  } else {
    tmRunning = false; clearInterval(tmInterval); tmRemaining = 0; tmTotal = 0;
  }
  el("#timerStartBtn").textContent = "▶";
  updateTimerDisplay();
}

function timerLap() {
  if (timerMode !== "stopwatch" || !swRunning) return;
  const elapsed = swElapsed + (Date.now() - swStart);
  laps.unshift(elapsed);
  renderLaps();
}

function renderLaps() {
  const c = el("#lapsContainer");
  c.innerHTML = laps.map((l, i) => `<div><span>Lap ${laps.length - i}</span><span>${fmtStopwatch(l)}</span></div>`).join("");
}

function switchTimerMode(mode) {
  timerMode = mode;
  document.querySelectorAll(".timer-toggle button").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  el("#timerSetRow").style.display = mode === "timer" ? "flex" : "none";
  el("#lapsContainer").style.display = mode === "stopwatch" ? "block" : "none";
  el("#timerLapBtn").style.visibility = mode === "stopwatch" ? "visible" : "hidden";
  timerReset();
}

/* ================= Settings ================= */
function clearAllData() {
  state = { tasks: [], lists: [], notes: [], settings: state.settings };
  renderAll();
  showToast("All data cleared");
}

/* ================= Render everything ================= */
function renderAll() {
  renderStarTotal();
  renderTodayCard();
  renderWeekStrip();
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === activeTab));
  renderTaskList();
  renderCardCollection("#notesContainer", state.notes, "note", "No notes yet. Tap + to write one.");
  renderCardCollection("#listsContainer", state.lists, "list", "No lists yet. Tap + to create one.");
  renderTrash();
  saveState();
}

/* ================= Wire up ================= */
window.addEventListener("DOMContentLoaded", () => {
  applyTheme(state.settings.theme || "dark");
  applyAccent(state.settings.accent || "violet");
  renderAll();
  requestNotificationPermission();
  setInterval(tickCountdowns, 1000);
  setInterval(checkReminders, 20000);
  checkReminders();
  updateTimerDisplay();

  // Menu
  el("#menuBtn").addEventListener("click", () => el("#menuOverlay").classList.add("open"));
  el("#menuOverlay").addEventListener("click", (e) => { if (e.target.id === "menuOverlay") el("#menuOverlay").classList.remove("open"); });
  document.querySelectorAll(".menu-btn").forEach((b) => {
    b.addEventListener("click", () => {
      el("#menuOverlay").classList.remove("open");
      const a = b.dataset.action;
      if (a === "playlists") switchView("lists");
      else if (a === "newtask") { switchView("tasks"); openTaskSheet(null); }
      else if (a === "export") exportData();
      else if (a === "import") el("#importInput").click();
      else if (a === "trash") switchView("trash");
    });
  });
  document.querySelectorAll(".accent-dot").forEach((d) => d.addEventListener("click", () => applyAccent(d.dataset.accent)));

  // Theme toggle
  el("#themeBtn").addEventListener("click", () => applyTheme(state.settings.theme === "dark" ? "light" : "dark"));

  // Search
  el("#searchInput").addEventListener("input", (e) => { searchQuery = e.target.value; renderAll(); });

  // Bottom nav
  document.querySelectorAll(".nav-btn").forEach((b) => b.addEventListener("click", () => switchView(b.dataset.view)));

  // FAB
  el("#fab").addEventListener("click", fabAction);

  // Task sheet
  el("#sheetBackdrop").addEventListener("click", (e) => { if (e.target.id === "sheetBackdrop") closeTaskSheet(); });
  el("#cancelBtn").addEventListener("click", closeTaskSheet);
  el("#saveTaskBtn").addEventListener("click", saveTaskFromSheet);
  el("#specialSwitch").addEventListener("click", (e) => { const on = e.currentTarget.dataset.on === "1"; setSwitch("#specialSwitch", !on); });

  // Note/list sheet
  el("#noteSheetBackdrop").addEventListener("click", (e) => { if (e.target.id === "noteSheetBackdrop") closeNoteSheet(); });
  el("#noteCancelBtn").addEventListener("click", closeNoteSheet);
  el("#noteSaveBtn").addEventListener("click", saveNoteFromSheet);

  // Confirm modal
  el("#confirmBackdrop").addEventListener("click", (e) => { if (e.target.id === "confirmBackdrop") closeConfirm(); });
  el("#confirmCancelBtn").addEventListener("click", closeConfirm);
  el("#confirmOkBtn").addEventListener("click", () => { if (confirmCallback) confirmCallback(); closeConfirm(); });

  // Tabs
  document.querySelectorAll(".tab-btn").forEach((b) => b.addEventListener("click", () => { activeTab = b.dataset.tab; renderAll(); }));

  // Import/export
  el("#importInput").addEventListener("change", (e) => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ""; });

  // Settings page
  el("#settingsThemeSwitch").addEventListener("click", () => applyTheme(state.settings.theme === "dark" ? "light" : "dark"));
  el("#notifPermBtn").addEventListener("click", () => {
    if ("Notification" in window) Notification.requestPermission().then((p) => showToast(p === "granted" ? "Notifications enabled" : "Permission not granted"));
  });
  el("#settingsExportBtn").addEventListener("click", exportData);
  el("#settingsImportBtn").addEventListener("click", () => el("#importInput").click());
  el("#clearDataBtn").addEventListener("click", () => {
    el("#confirmTitle").textContent = "Clear all data?";
    el("#confirmMsg").textContent = "This deletes every task, note and list permanently. Export a backup first if you're not sure.";
    confirmCallback = clearAllData;
    el("#confirmBackdrop").classList.add("open");
  });

  // Calculator
  document.querySelectorAll(".calc-btn").forEach((b) => b.addEventListener("click", () => calcPress(b.dataset.k)));

  // Timer
  document.querySelectorAll(".timer-toggle button").forEach((b) => b.addEventListener("click", () => switchTimerMode(b.dataset.mode)));
  el("#timerStartBtn").addEventListener("click", timerStartPause);
  el("#timerResetBtn").addEventListener("click", timerReset);
  el("#timerLapBtn").addEventListener("click", timerLap);

  // Close dropdowns / menus on outside click
  document.addEventListener("click", () => closeDropdowns());

  if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
});
