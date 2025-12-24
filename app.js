const APP_VERSION = window.APP_VERSION || "1.4.0"; // Tek sürüm referansı (HTML de buradan beslenir)
const BRAND_NAME = "Zihin Atölyesi";
const SUPPORT_EMAIL = "destek@zihinatolyesi.com";
const SUPPORT_HOURS = "Hafta içi 09.00-22.00 • Hafta sonu 10.00-20.00";
const WHATSAPP_NUMBER = "905426726750"; // wa.me formatı (ülke kodu, başta 0 yok)
const PROD_HOSTS = ["asdasfasamas.vercel.app"];
const IS_LOCAL = ["localhost", "127.0.0.1", "0.0.0.0"].some(h => location.hostname.includes(h));
const DEV_MODE = IS_LOCAL && !PROD_HOSTS.includes(location.hostname);
const SUPABASE_URL = "https://kengcnwwxdsnuylfnhre.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtlbmdjbnd3eGRzbnV5bGZuaHJlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjU5MTYwNjQsImV4cCI6MjA4MTQ5MjA2NH0.UF5r4458DtzJIEFYAe9ZcukDKg2-NoJMBHVwJTX8B1A";
// Debug kilidi için eşikler
const DEBUG_UNLOCK_KEY = "debugUnlocked";
const DEBUG_TAP_THRESHOLD = 7;
const DEBUG_TAP_RESET_MS = 900;
const LOG_VERBOSE = DEV_MODE;
if (!window.supabase) {
  alert("Supabase kütüphanesi yüklenemedi (CDN engeli/ağ). Adblock varsa kapatıp yenile.");
}
const HEADER_SELECTORS = [
  "header.site-header",
  "#site-header",
  ".site-header",
  "#header",
  "header",
  ".header",
  "#main-header",
  "body > header",
  "body > nav"
];
let headerObserver = null;
let lastHeaderHeight = -1;
const HEADER_FALLBACK = 64;
let headerRecalcQueued = false;
const IS_PANEL_PAGE = document.body?.classList.contains("panel-page");

function findHostHeader() {
  const header = HEADER_SELECTORS
    .map(sel => document.querySelector(sel))
    .find(el => el && !el.closest("#app"));
  return header || null;
}

function computeHeaderHeight(el) {
  if (!el) return 0;
  const rect = el.getBoundingClientRect();
  const styles = window.getComputedStyle(el);
  const marginTop = parseFloat(styles.marginTop) || 0;
  const marginBottom = parseFloat(styles.marginBottom) || 0;
  return Math.max(0, Math.ceil(rect.height + marginTop + marginBottom));
}

function applyHeaderOffset() {
  headerRecalcQueued = false;
  if (IS_PANEL_PAGE) {
    if (headerObserver) headerObserver.disconnect();
    lastHeaderHeight = 0;
    document.documentElement.style.setProperty("--header-h", "0px");
    return;
  }
  const header = findHostHeader();
  let height = computeHeaderHeight(header);
  if (!height) {
    height = lastHeaderHeight > 0 ? lastHeaderHeight : HEADER_FALLBACK;
  }
  if (height === lastHeaderHeight) return;
  lastHeaderHeight = height;
  document.documentElement.style.setProperty("--header-h", `${height}px`);

  if (headerObserver) headerObserver.disconnect();
  if (window.ResizeObserver && header) {
    headerObserver = new ResizeObserver(() => {
      const next = computeHeaderHeight(header);
      if (next !== lastHeaderHeight) {
        lastHeaderHeight = next;
        document.documentElement.style.setProperty("--header-h", `${next}px`);
      }
    });
    headerObserver.observe(header);
  }
}

function initPanelOffsets() {
  const scheduleHeaderOffset = () => {
    if (headerRecalcQueued) return;
    headerRecalcQueued = true;
    requestAnimationFrame(applyHeaderOffset);
  };

  scheduleHeaderOffset();
  window.addEventListener("resize", scheduleHeaderOffset, { passive: true });
  window.addEventListener("orientationchange", scheduleHeaderOffset);
  window.addEventListener("load", scheduleHeaderOffset);
  if (!IS_PANEL_PAGE) {
    // Late header injection watchdog (e.g., SPA shells)
    const bodyObserver = new MutationObserver(scheduleHeaderOffset);
    bodyObserver.observe(document.body, { childList: true, subtree: true });
    setTimeout(scheduleHeaderOffset, 50);
    setTimeout(scheduleHeaderOffset, 300);
  }
}


const supabaseConfigOk = Boolean(SUPABASE_URL) && Boolean(SUPABASE_ANON_KEY);
if (!supabaseConfigOk) {
  alert("Supabase yapılandırması eksik (URL veya ANON KEY boş). Lütfen ortam değişkenlerini kontrol et.");
}
const sb = (window.supabase && supabaseConfigOk)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

const $app = document.getElementById("app");
const $modal = document.getElementById("modal");
const $backdrop = document.getElementById("modalBackdrop");
const $modalTitle = document.getElementById("modalTitle");
const $modalBody = document.getElementById("modalBody");
const $modalFoot = document.getElementById("modalFoot");
document.getElementById("modalClose").addEventListener("click", closeModal);
$backdrop.addEventListener("click", closeModal);
initPanelOffsets();
const state = {
  roleChoice: localStorage.getItem("roleChoice") || "",
  session: null,
  user: null,
  profile: null,
  profileDetails: null,
  cache: {
    subjects: null,
    subjectsMeta: { error: null, empty: false },
    packagesBySubject: new Map(),
    packagesMeta: new Map(),
    teacherSubjects: null,
    profilesList: null,
  },
  debugOpen: false,
  debugElements: { panel: null, chip: null },
  debugDeniedToastShown: false,
  debugTapCount: 0,
  debugTapTimer: null,
  lastError: "",
  adminLockUntil: parseInt(localStorage.getItem("adminLockUntil") || "0", 10),
  adminTries: parseInt(localStorage.getItem("adminTries") || "0", 10),
};

ensureDebugPanel();
ensureContactWidget();
init();

async function init() {
  if (!sb) {
    $app.innerHTML = `<div class="container"><div class="card"><h2>Supabase bağlantısı yok</h2><p>CDN veya anahtar eksik. İnternetini ve anahtarları kontrol et.</p></div></div>`;
    return;
  }

  const { data, error } = await sb.auth.getSession();
  logSupabase("auth.getSession", { data, error });
  state.session = data?.session || null;
  state.user = state.session?.user || null;

  window.addEventListener("hashchange", route);
  sb.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    state.user = session?.user || null;
    state.profile = null;
    state.profileDetails = null;
    await route();
  });

  await route();
  await pingSupabase();
}

async function pingSupabase() {
  if (!sb) return;
  const { error } = await sb.from("profiles").select("count", { count: "exact", head: true });
  if (error) console.error("❌ Supabase Bağlantı Hatası:", error);
  else if (LOG_VERBOSE) console.log("✅ Supabase bağlantısı çalışıyor (ping)");}

function setRoleChoice(role) {
  state.roleChoice = role;
  localStorage.setItem("roleChoice", role);
  setBodyRoleClass();
}

function clearRoleChoice() {
  state.roleChoice = "";
  localStorage.removeItem("roleChoice");
  setBodyRoleClass();
}

function isEmailConfirmed() {
  return !!state.user?.email_confirmed_at;
}

function logSupabase(action, { data, error, status } = {}) {
  if (LOG_VERBOSE) {
    console.log(`[SB] ${action}`, { status, data, error });
  } else if (error) {
    console.warn(`[SB] ${action} hata`, { status, message: error.message, code: error.code });
  }
}

function friendlyPostgrestError(err) {
  if (!err) return "Bilinmeyen bir hata oluştu.";
  
  const msg = err.message || "";
  
  // İnternet/Sunucu Hatası
  if (msg.includes("Failed to fetch") || msg.includes("Network")) {
    return "Bağlantı koptu. Lütfen internetinizi kontrol edip tekrar deneyin.";
  }
  
  // Yetki Hataları (RLS)
  if (err.code === "401" || err.code === "403" || msg.includes("row-level security")) {
    return "Bu işlemi yapmaya yetkiniz yok veya oturumunuz sonlanmış.";
  }
  
  // Eksik Veri
  if (err.code === "23502" || err.code === "400") {
    return "Lütfen tüm alanları eksiksiz doldurun.";
  }

  // Çakışma (Örn: Aynı T.C. veya Mail)
  if (err.code === "23505") {
    return "Bu kayıt zaten mevcut.";
  }

  return "İşlem şu an gerçekleştirilemedi. Lütfen tekrar deneyin.";
}

function toast(type, msg) {
  const wrap = document.getElementById("toasts");
  const t = document.createElement("div");
  t.className = `toast ${type || ""}`.trim();
  let text = msg;
  const isFetchErr = (msg || "").includes("Failed to fetch") || (msg || "").includes("ağ/SSL");
  if (isFetchErr) {
    text = `${msg} (ağ/SSL ya da CORS engeli olabilir)`;
    showNetStatus(text);
  } else {
    clearNetStatus();
  }
  t.textContent = text;
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 4200);
  if (type === "error" || type === "warn") {
    setLastError(text);
  }
}

function showNetStatus(message, retryCb){
  let box = qs("#netStatus");
  if(!box){
    box = document.createElement("div");
    box.id = "netStatus";
    box.className = "net-status";
    box.innerHTML = `
      <div class="net-text"></div>
      <div class="net-actions">
        <button class="btn secondary" id="netRetry">Yeniden Dene</button>
        <button class="btn" id="netDismiss">Gizle</button>
      </div>
    `;
    document.body.appendChild(box);
    qs("#netDismiss", box)?.addEventListener("click", clearNetStatus);
    qs("#netRetry", box)?.addEventListener("click", () => {
      if(typeof retryCb === "function") retryCb();
      else location.reload();
    });
  }
  const textEl = qs(".net-text", box);
  if(textEl) textEl.textContent = message;
}
function clearNetStatus(){
  qs("#netStatus")?.remove();
}

function adminLockActive(){
  const now = Date.now();
  if(state.adminLockUntil && state.adminLockUntil > now){
    return true;
  }
  if(state.adminLockUntil && state.adminLockUntil <= now){
    state.adminLockUntil = 0;
    state.adminTries = 0;
    localStorage.removeItem("adminLockUntil");
    localStorage.removeItem("adminTries");
  }
  return false;
}
function recordAdminFailure(){
  state.adminTries = (state.adminTries || 0) + 1;
  localStorage.setItem("adminTries", String(state.adminTries));
  if(state.adminTries >= 5){
    state.adminLockUntil = Date.now() + (5 * 60 * 1000);
    localStorage.setItem("adminLockUntil", String(state.adminLockUntil));
    toast("warn","Admin giriş denemeleri 5 dk kilitlendi.");
  }
}
function clearAdminFailures(){
  state.adminTries = 0;
  state.adminLockUntil = 0;
  localStorage.removeItem("adminTries");
  localStorage.removeItem("adminLockUntil");
}

function openModal(title, bodyHTML, footHTML) {
  $modalTitle.textContent = title || "İşlem";
  $modalBody.innerHTML = bodyHTML || "";
  $modalFoot.innerHTML = footHTML || "";
  $backdrop.classList.remove("hidden");
  $modal.classList.remove("hidden");
}
function closeModal() {
  $backdrop.classList.add("hidden");
  $modal.classList.add("hidden");
  $modalTitle.textContent = "";
  $modalBody.innerHTML = "";
  $modalFoot.innerHTML = "";
}

function qs(sel, root = document) { return root ? root.querySelector(sel) : null; }
function qsa(sel, root = document) { return (!root || !root.querySelectorAll) ? [] : Array.from(root.querySelectorAll(sel)); }
function esc(s) { return (s ?? "").toString().replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m])); }
function applyMobileTableLabels() {
  document.querySelectorAll(".table").forEach(tbl => {
    const headers = Array.from(tbl.querySelectorAll("thead th")).map(th => th.textContent.trim());
    tbl.querySelectorAll("tbody tr").forEach(row => {
      Array.from(row.children).forEach((cell, idx) => {
        if (headers[idx]) cell.setAttribute("data-label", headers[idx]);
      });
    });
  });
}
function ensureDebugPanel() {
  if (state.debugElements?.panel) return;
  const box = document.createElement("div");
  box.id = "debugPanel";
  box.className = "debug-panel hidden";
  box.innerHTML = `
    <div class="debug-head">
      <div>Debug</div>
      <button class="icon-btn" id="debugToggle" aria-label="Debug kapat">✕</button>
    </div>
    <div id="debugBody" class="debug-body"></div>
  `;

  const chip = document.createElement("button");
  chip.id = "debugChip";
  chip.className = "debug-chip";
  chip.textContent = "Debug";
  chip.addEventListener("click", () => {
    state.debugOpen = !state.debugOpen;
    updateDebugPanel();
  });

  box.querySelector("#debugToggle").addEventListener("click", () => {
    state.debugOpen = false;
    updateDebugPanel();
  });
  state.debugElements = { panel: box, chip };
}

function attachDebugUI() {
  ensureDebugPanel();
  const { panel, chip } = state.debugElements;
  if (!chip.isConnected) document.body.appendChild(chip);
  if (!panel.isConnected) document.body.appendChild(panel);
}

function detachDebugUI() {
  const { panel, chip } = state.debugElements || {};
  if (chip?.isConnected) chip.remove();
  if (panel?.isConnected) panel.remove();
  state.debugOpen = false;
}

function shouldEnableDebug() {
  const params = new URLSearchParams(location.search);
  return params.get("debug") === "1" || localStorage.getItem(DEBUG_UNLOCK_KEY) === "1";
}

function hasDebugAccess() {
  return DEV_MODE || state.profile?.role === "admin";
}

function unlockDebugWithToast() {
  localStorage.setItem(DEBUG_UNLOCK_KEY, "1");
  state.debugDeniedToastShown = false;
  toast("success", "Debug açıldı");
  updateDebugPanel();
}

function attachDebugUnlockers(root = document) {
  qsa(".brand", root).forEach(el => {
    if (el.dataset.debugTapReady) return;
    el.dataset.debugTapReady = "1";
    el.addEventListener("click", () => {
      state.debugTapCount = (state.debugTapCount || 0) + 1;
      clearTimeout(state.debugTapTimer);
      state.debugTapTimer = setTimeout(() => { state.debugTapCount = 0; }, DEBUG_TAP_RESET_MS);
      if (state.debugTapCount >= DEBUG_TAP_THRESHOLD) {
        state.debugTapCount = 0;
        unlockDebugWithToast();
      }
    });
  });
}

function ensureContactWidget(){
  const widget = qs("#contactWidget");
  if(!widget || widget.dataset.ready) return;
  widget.dataset.ready = "1";
  const toggle = qs("#contactToggle", widget);
  const panel = qs("#contactPanel", widget);
  const closeBtn = qs("#contactClose", widget);
  const meta = qs("#widgetMeta", widget);
  if(meta) meta.textContent = `${SUPPORT_EMAIL} • ${SUPPORT_HOURS}`;

  const open = () => panel?.classList.toggle("hidden");
  const hide = () => panel?.classList.add("hidden");
  toggle?.addEventListener("click", open);
  closeBtn?.addEventListener("click", hide);

  function sendTemplate(text){
    const role = state.profile?.role || state.roleChoice || "ziyaretçi";
    const uid = state.user?.id ? state.user.id.slice(0,8) : "anon";
    const full = `${text}\nDers/Amaç: …\n\nRol: ${role} • Kullanıcı: ${uid}\n${BRAND_NAME} | v${APP_VERSION}`;    const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(full)}`;
    window.open(url, "_blank");
    hide();
  }

  qsa("[data-whatsapp]", widget).forEach(btn => {
    btn.addEventListener("click", () => {
      const type = btn.getAttribute("data-whatsapp");
      const msg = type === "teacher"
        ? "Merhaba, öğretmen yönlendirmesi rica ediyorum. Ders: … Seviye: … Hedef: …"
        : "Merhaba, genel destek almak istiyorum.";
      sendTemplate(msg);
    });
  });
  qsa(".template", widget).forEach(btn => {
    btn.addEventListener("click", () => sendTemplate(btn.textContent.trim()));
  });
}

function openWhatsAppMessage(text){
  const role = state.profile?.role || state.roleChoice || "ziyaretçi";
  const uid = state.user?.id ? state.user.id.slice(0,8) : "anon";
  const full = `${text}\nDers/Amaç: …\n\nRol: ${role} • Kullanıcı: ${uid}\n${BRAND_NAME} | v${APP_VERSION}`;  const url = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(full)}`;
  window.open(url, "_blank");
}

function setLastError(msg) {
  state.lastError = msg || "";
  updateDebugPanel();
}

function updateDebugPanel() {
  const wantsDebug = shouldEnableDebug();
  const allowDebug = hasDebugAccess();

  if (!wantsDebug) {
    detachDebugUI();
    state.debugDeniedToastShown = false;
    return;
  }
  if (!allowDebug) {
    detachDebugUI();
    if (!state.debugDeniedToastShown) {
      toast("warn", "Yetki yok");
      state.debugDeniedToastShown = true;
    }
    return;
  }
  attachDebugUI();
  state.debugDeniedToastShown = false;
  const box = state.debugElements?.panel;
  const chip = state.debugElements?.chip;
  if (!box || !chip) return;
  const body = qs("#debugBody", box);
  const subjectsCount = state.cache.subjects?.length || 0;
  const packagesCount = Array.from(state.cache.packagesBySubject.values()).reduce((sum, arr) => sum + (arr?.length || 0), 0);
  body.innerHTML = `
    <div><b>Versiyon:</b> v${APP_VERSION}</div>
    <div><b>Session:</b> ${state.session ? "var" : "yok"}</div>
    <div><b>User:</b> ${esc(state.user?.id || "-")} • ${esc(state.user?.email || "")}</div>
    <div><b>Email doğrulandı:</b> ${isEmailConfirmed() ? "evet" : "hayır"}</div>
    <div><b>Rol:</b> ${esc(state.profile?.role || "?")}</div>
    <div><b>Son hata:</b> ${esc(state.lastError || "-")}</div>
    <div><b>Ders/Paket:</b> ${subjectsCount} / ${packagesCount}</div>
    <div><b>Subjects meta:</b> ${state.cache.subjectsMeta?.error ? "hata" : state.cache.subjectsMeta?.empty ? "boş" : "ok"}</div>
  `;
  box.classList.toggle("hidden", !state.debugOpen);
}

function setBodyRoleClass() {
  document.body.classList.remove("role-student", "role-parent", "role-admin", "role-teacher");
  if (state.roleChoice === "student") document.body.classList.add("role-student");
  if (state.roleChoice === "parent") document.body.classList.add("role-parent");
  if (state.roleChoice === "admin") document.body.classList.add("role-admin");
  if (state.roleChoice === "teacher") document.body.classList.add("role-teacher");
}

function activeHash() {
  const h = location.hash.replace("#", "").trim();
  return h || "home";
}

async function route() {
  setBodyRoleClass();
  updateDebugPanel();

  if (!state.roleChoice) {
    renderRoleSelect();
    return;
  }

  if (!state.user) {
    renderAuth(state.roleChoice);
    return;
  }

  await ensureProfileLoaded();
  const pRole = state.profile?.role;

  // --- DÜZELTME BAŞLANGICI: Admin Torpili ---
  // Eğer kullanıcı Admin ise, rol kontrolüne takılmadan her yere girebilsin.
  const isAdmin = (pRole === "admin");

  if (!isAdmin) {
    // Admin DEĞİLSE sıkı kontrol yap
    if (state.roleChoice === "student" && pRole !== "student") return renderRoleMismatch("Bu hesap öğrenci değil. Lütfen çıkış yapıp doğru rolü seç.");
    if (state.roleChoice === "parent" && pRole !== "parent") return renderRoleMismatch("Bu hesap veli değil. Lütfen çıkış yapıp doğru rolü seç.");
    if (state.roleChoice === "teacher" && pRole !== "teacher") return renderRoleMismatch("Bu hesap öğretmen değil. Çıkış yapıp öğretmen hesabıyla giriş yap.");
    // Admin paneline admin olmayan girmeye çalışırsa
    if (state.roleChoice === "admin" && pRole !== "admin") return renderAdminLock(pRole || "-");
  }
  // --- DÜZELTME BİTİŞİ ---

 if (pRole === "admin" && shouldEnableDebug()) state.debugOpen = true;  

  const h = activeHash();
  // Admin, öğrenci panelini seçtiyse orayı render etsin (kontrolü geçtik artık)
  if (state.roleChoice === "student") return renderStudentApp(h);
  if (state.roleChoice === "parent") return renderParentApp(h);
  if (state.roleChoice === "teacher") return renderTeacherApp(h);
  if (state.roleChoice === "admin") return renderAdminHub(h);
}

async function ensureProfileLoaded() {
  if (state.profile) return;
  if (!state.user) return;

  const isAdmin = state.roleChoice === "admin";
  const baseColumns = isAdmin
    ? "id, role, full_name, verified, created_at, public_name_pref, phone"
    : "id, role, full_name, verified, created_at, public_name_pref";
  const { data: prof, error } = await sb
    .from("profiles")
    .select(baseColumns)
    .eq("id", state.user.id)
    .maybeSingle();

  logSupabase("profiles.select", { data: prof, error });

  if (error) {
    toast("error", "Profil okunamadı: " + error.message);
    state.profile = null;
    return;
  }

  if (prof) {
    state.profile = prof;
    updateDebugPanel();
    return;
  }

  if (state.roleChoice === "admin" || state.roleChoice === "teacher") {
    toast("error", "Bu rol için profil bulunamadı. Admin tarafından atanmalı.");
    state.profile = null;
    return;
  }

  const role = ["student","parent"].includes(state.roleChoice) ? state.roleChoice : "student";
  const full_name = state.user.user_metadata?.full_name || state.user.email?.split("@")[0] || "Kullanıcı";
  const { data: ins, error: e2 } = await sb
    .from("profiles")
    .insert([{ id: state.user.id, role, full_name, verified: false, public_name_pref: "anonymous" }])
    .select("*")
    .single();

  logSupabase("profiles.insert", { data: ins, error: e2 });

  if (e2) {
    toast("error", "Profil oluşturulamadı: " + e2.message);
    state.profile = null;
    return;
  }
  state.profile = ins;
  updateDebugPanel();
}

function shell({ titleRight = "", navItems = [], contentHTML = "" }) {
  const navHTML = navItems.map(it => {
    const active = activeHash() === it.hash ? "active" : "";
    return `<a class="${active}" href="#${esc(it.hash)}">${esc(it.label)}</a>`;
  }).join("");

  $app.innerHTML = `
    <div class="container">
      <div class="topbar">
        <div class="brand">
          <span class="dot"></span>
          <span>KoçTakip</span>
          <span class="badge ${state.roleChoice === "admin" ? "green" : state.roleChoice === "parent" ? "warn" : state.roleChoice === "teacher" ? "blue" : "blue"}">
            ${state.roleChoice === "student" ? "Öğrenci" : state.roleChoice === "parent" ? "Veli" : state.roleChoice === "teacher" ? "Öğretmen" : "Admin"}
          </span>
        </div>
        <div class="nav">
          ${navHTML}
          <button class="btn secondary" id="logoutBtn">Çıkış</button>
        </div>
      </div>
      <div class="main">${contentHTML}</div>
      <div class="footer-note">
        <div>${BRAND_NAME} • v${APP_VERSION} • ${SUPPORT_EMAIL} • ${SUPPORT_HOURS}</div>
        <div>Fiyatlar: yalnızca <b>email doğrulaması</b> tamamlandıktan sonra görünür. Rol seçimi: çıkış yapmadan değişmez.</div>
      </div>
    </div>
  `;

  const logoutBtn = qs("#logoutBtn");
  logoutBtn?.addEventListener("click", async () => {
    await safeSignOut();
    attachDebugUnlockers($app); // Debug kilidi: brand tıklaması
  });
  applyMobileTableLabels();
}

function renderRoleSelect() {
  document.body.classList.remove("role-student", "role-parent", "role-admin", "role-teacher");

  $app.innerHTML = `
    <div class="container" style="min-height:100vh; padding-top: 80px; padding-bottom: 40px;">
      <div class="card" style="text-align:center; padding:40px;">
        <div class="brand" style="justify-content:center; font-size:32px; margin-bottom:10px;">
          <span class="dot"></span>Zihin Atölyesi
        </div>
        <p style="color:var(--muted); margin-bottom:40px;">Lütfen giriş yapmak istediğiniz paneli seçiniz.</p>
        <div class="grid3">
          <div class="role-card" data-role="student">
            <div style="font-size:40px; margin-bottom:10px;">🎓</div>
            <div class="t">Öğrenci</div>
            <div class="d">Derslerim, ödevlerim ve gelişim grafiğim.</div>
            <button class="btn" style="width:100%; margin-top:15px;">Giriş Yap</button>
          </div>
          <div class="role-card" data-role="parent">
            <div style="font-size:40px; margin-bottom:10px;">👨‍👩‍👧‍👦</div>
            <div class="t">Veli</div>
            <div class="d">Çocuğumun durumu, raporlar ve ödemeler.</div>
            <button class="btn" style="width:100%; margin-top:15px; border-color:var(--warn); color:var(--warn);">Giriş Yap</button>
          </div>
          <div class="role-card" data-role="teacher">
            <div style="font-size:40px; margin-bottom:10px;">🧑‍🏫</div>
            <div class="t">Öğretmen</div>
            <div class="d">Ders atamaları, görevler ve yorumlar.</div>
            <button class="btn" style="width:100%; margin-top:15px; border-color:var(--accent); color:var(--accent);">Öğretmen Girişi</button>
          </div>
          <div class="role-card" data-role="admin">
            <div style="font-size:40px; margin-bottom:10px;">🚀</div>
            <div class="t">Yönetim</div>
            <div class="d">Yalnızca admin rolü atanmış hesaplar erişebilir.</div>
            <button class="btn" style="width:100%; margin-top:15px; border-color:var(--good); color:var(--good);">Admin Girişi</button>
          </div>
        </div>
        <div class="footer-note" style="margin-top:30px;">KoçTakip v${APP_VERSION} • Güvenli Giriş Sistemi</div>
      </div>
    </div>
  `;

  qsa(".role-card").forEach(card => {
    card.addEventListener("click", () => {
      const role = card.getAttribute("data-role");
      setRoleChoice(role);
      location.hash = "#home";
      route();
    });
  });
  attachDebugUnlockers($app); 
}

function renderAdminLock(realRole) {
  shell({
    navItems: [{ hash: "home", label: "Durum" }],
    contentHTML: `
      <div class="card">
        <h2>Admin Erişimi Kapalı</h2>
        <p>Bu hesap rolü: <b>${esc(realRole)}</b>. Admin paneline girmek için veritabanında admin rolü atanmış olmalısın.</p>
        <div class="divider"></div>
        <button class="btn secondary" id="logoutBtn">Çıkış</button>
      </div>
    `
  });
}

function renderRoleMismatch(msg) {
  shell({
    navItems: [{ hash: "home", label: "Durum" }],
    contentHTML: `
      <div class="card">
        <h2>Erişim Uyumsuzluğu</h2>
        <p>${esc(msg)}</p>
        <div class="lock">Rol seçimi kilitli. Doğru rol ile giriş için çıkış yap.</div>
      </div>
    `
  });
}

function renderAuth(role) {
  const roleName = role === "student" ? "Öğrenci" : role === "parent" ? "Veli" : role === "teacher" ? "Öğretmen" : "Yönetim";
  const accentBadge = role === "student" ? "blue" : role === "parent" ? "warn" : role === "teacher" ? "blue" : "green";

  $app.innerHTML = `
    <div class="container" style="min-height:100vh; padding-top: 80px; padding-bottom: 40px;">
      <button class="btn secondary" onclick="clearRoleChoice(); route();" style="margin-bottom:20px;">← Rol Seçimine Dön</button>
      
      <div class="card" style="width:100%; max-width:400px; padding:30px;">
        <div class="row spread" style="margin-bottom:20px;">
          <div class="brand"><span class="dot"></span><span>Giriş Yap</span></div>
          <span class="badge ${accentBadge}">${roleName}</span>
        </div>

        <label>Email Adresi</label>
        <input class="input" id="loginEmail" placeholder="ornek@mail.com" type="email" />
        
        <label>Şifre</label>
        <input class="input" id="loginPass" type="password" placeholder="••••••••" />
        
        <div class="row" style="margin-top:20px;">
          <button class="btn" id="loginBtn" style="width:100%; padding:12px;">Giriş Yap</button>
        </div>

        <div style="margin-top:15px; text-align:center;">
          <button class="btn secondary" id="forgotBtn" style="font-size:13px; border:none; background:transparent;">Şifremi Unuttum</button>
        </div>
        
        <div class="divider"></div>
        
        <div class="lock" style="text-align:center; font-size:12px;">
          <i class="fa-solid fa-lock"></i> Kayıtlar kapalıdır.<br>Yeni kayıt için yönetimle iletişime geçiniz.
        </div>
      </div>
    </div>
  `;

  qs("#loginBtn")?.addEventListener("click", doLogin);
  
  qs("#forgotBtn")?.addEventListener("click", doForgot);
  attachDebugUnlockers($app);

  async function doLogin() {
    const email = qs("#loginEmail").value.trim();
    const password = qs("#loginPass").value;
    if(role === "admin" && adminLockActive()){
      const wait = Math.ceil((state.adminLockUntil - Date.now())/1000/60);
      return toast("warn", `Admin girişleri kilitli. ${wait > 0 ? wait + " dk" : "Kısa süre"} sonra tekrar deneyin.`);
    }
    
    if (!email || !password || !validEmail(email)) return toast("error", "Geçerli email ve şifre giriniz.");

    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    logSupabase("auth.signInWithPassword", { data, error });
    if (error) {
      if(role === "admin") recordAdminFailure();
      return toast("error", `Giriş başarısız (${error.status || ""}): ${friendlyPostgrestError(error)}`);
    }
    if(role === "admin") clearAdminFailures();    
    toast("success", "Giriş başarılı, yönlendiriliyor...");
    route(); 
  }

  async function doForgot() {
    const email = qs("#loginEmail").value.trim();
    if (!validEmail(email)) return toast("error", "Şifre sıfırlama linki için lütfen yukarıya email adresinizi yazın.");
    
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.href });
    logSupabase("auth.resetPasswordForEmail", { error });
    if (error) return toast("error", `Hata (${error.status || ""}): ${friendlyPostgrestError(error)}`);
    toast("success", "Şifre sıfırlama bağlantısı e-mail adresinize gönderildi.");
  }
}
async function safeSignOut() {
  // 1. Önce "yerel" olarak ölü taklidi yap (Race Condition önleyici)
  // Bunu en başa koyuyoruz ki, alttaki işlemler sürerken arayüz veri çekmeye çalışmasın.
  state.user = null;
  state.session = null;
  state.profile = null;
  state.profileDetails = null;
  
  // Rol seçimini temizle
  clearRoleChoice();

  if (!sb) {
    location.hash = "";
    return;
  }

  try {
    // 2. Supabase sunucusuna "ben çıkıyorum" de
    // Burası hata verse bile umursamıyoruz çünkü yerelde zaten çıktık.
    const { error } = await sb.auth.signOut({ scope: "global" });
    if (error) {
        // Token zaten ölüyse 'local' scope ile temizlemeyi dene
        await sb.auth.signOut({ scope: "local" });
        console.warn("Global çıkış hatası (önemsiz):", error.message);
    }
  } catch (err) {
    console.warn("Çıkış sırasında ağ hatası:", err);
  }

  // 3. Çöp Temizliği (Local Storage)
  const ref = (SUPABASE_URL.split("https://")[1] || "").split(".")[0];
  const key = `sb-${ref}-auth-token`;
  localStorage.removeItem(key);
  localStorage.removeItem(`${key}-global`);
  
  // Cache temizliği
  state.cache = { 
    subjects: null, 
    subjectsMeta: { error: null, empty: false }, 
    packagesBySubject: new Map(), 
    packagesMeta: new Map(), 
    teacherSubjects: null, 
    profilesList: null 
  };

  // 4. Sayfayı tertemiz yap
  location.hash = "";
  toast("success", "Başarıyla çıkış yapıldı.");
  updateDebugPanel();
  
  // Garanti olsun diye sayfayı yenilemek en temizidir (isteğe bağlı)
  // location.reload(); 
}
function renderRoleMismatch(msg) {
  shell({
    navItems: [{ hash: "home", label: "Durum" }],
    contentHTML: `
      <div class="card">
        <h2>Erişim Uyumsuzluğu</h2>
        <p>${esc(msg)}</p>
        <div class="lock">Rol seçimi kilitli. Doğru rol ile giriş için çıkış yap.</div>
      </div>
    `
  });
}

/* ----------------- STUDENT APP ----------------- */
function renderStudentApp(hash) {
  const nav = [
    { hash: "home", label: "Panel" },
    { hash: "profile", label: "Profilim" },
    { hash: "catalog", label: "Dersler" },
    { hash: "market", label: "Öğretmenler" },
    { hash: "my", label: "Derslerim" },
    { hash: "progress", label: "İlerleme" },
    { hash: "messages", label: "Notlar" }
  ];
  if (hash === "profile") return renderStudentProfile(nav);
  if (hash === "catalog") return studentCatalog(nav);
  if (hash === "market") return renderTeacherMarket(nav, "student");
  if (hash === "my") return studentMySubjects(nav);
  if (hash === "progress") return studentProgress(nav);
  if (hash === "messages") return studentMessages(nav);
  return studentHome(nav);
}

function renderParentApp(hash) {
  const nav = [
    { hash: "home", label: "Özet" },
    { hash: "profile", label: "Profilim" },
    { hash: "linked", label: "Bağlı Öğrenciler" },
    { hash: "catalog", label: "Dersler" },
    { hash: "market", label: "Öğretmenler" },
    { hash: "my", label: "Takip" },
    { hash: "reports", label: "Rapor" },
    { hash: "notes", label: "Notlar" }
  ];
  if (hash === "profile") return renderParentProfile(nav);
  if (hash === "linked") return renderParentLinked(nav);
  if (hash === "catalog") return parentCatalog(nav);
  if (hash === "market") return renderTeacherMarket(nav, "parent");
  if (hash === "my") return parentMy(nav);
  if (hash === "reports") return parentReports(nav);
  if (hash === "notes") return parentNotes(nav);
  return parentHome(nav);
}

function renderTeacherApp(hash) {
  const nav = [
    { hash: "home", label: "Öğretmen Paneli" },
    { hash: "profile", label: "Profilim" },
    { hash: "subjects", label: "Derslerim" },
    { hash: "reviews", label: "Puanlar" }
  ];
  if (hash === "profile") return renderTeacherProfile(nav);
  if (hash === "subjects") return teacherSubjects(nav);
  if (hash === "reviews") return teacherReviews(nav);
  return teacherHome(nav);
}

function renderAdminHub(hash) {
  const nav = [
    { hash: "home", label: "Admin Hub" },
    { hash: "admin-users", label: "Kullanıcılar" },
    { hash: "admin-profile", label: "Profil Detayı" },
    { hash: "admin-linking", label: "Veli–Öğrenci" },
    { hash: "enrollments", label: "Tüm Kayıtlar" },
    { hash: "teachers", label: "Öğretmenler" },
    { hash: "catalog", label: "Ders Kataloğu" },
    { hash: "reviews", label: "Yorumlar" },
    { hash: "panel", label: "Yönetim" }
  ];
  if (hash === "admin-users") return renderAdminUsers(nav);
  if (hash === "admin-profile") return renderAdminProfile(nav);
  if (hash === "admin-linking") return renderAdminLinking(nav);
  if (hash === "enrollments") return adminEnrollments(nav);
  if (hash === "teachers") return adminTeachers(nav);
  if (hash === "catalog") return adminCatalog(nav);
  if (hash === "reviews") return adminReviews(nav);
  if (hash === "panel") return adminPanel(nav);
  return adminHome(nav);
}

/* ----------------- COMMON DATA ----------------- */
async function fetchSubjects() {
  if (state.cache.subjects) return state.cache.subjects;
  state.cache.subjectsMeta = { error: null, empty: false };
  const { data, error, status } = await sb
    .from("subjects")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });
  logSupabase("subjects.select", { data, error, status });
  if (error) {
    state.cache.subjectsMeta.error = error;
    setLastError(error.message);
    toast("error", "Dersler alınamadı: " + friendlyPostgrestError(error));
    return [];
  }
  state.cache.subjects = data || [];
  state.cache.subjectsMeta.empty = !(data && data.length);
  updateDebugPanel();
  return state.cache.subjects;
}
function resetCatalogCache() {
  state.cache.subjects = null;
  state.cache.subjectsMeta = { error: null, empty: false };
  state.cache.packagesBySubject.clear();
  state.cache.packagesMeta.clear();
  updateDebugPanel();
}
async function fetchPackages(subject_id) {
  if (state.cache.packagesBySubject.has(subject_id)) return state.cache.packagesBySubject.get(subject_id);

  const { data, error, status } = await sb
    .from("subject_packages")
    .select("*")
    .eq("subject_id", subject_id)
    .order("price_try", { ascending: true });
  logSupabase("subject_packages.select", { data, error, status });
  if (error) {
    setLastError(error.message);
    state.cache.packagesMeta.set(subject_id, { error, status });
    toast("error", "Paketler alınamadı: " + friendlyPostgrestError(error));
    state.cache.packagesBySubject.set(subject_id, []);
    updateDebugPanel();
    return [];
  }
  state.cache.packagesMeta.set(subject_id, { error: null, status });
  state.cache.packagesBySubject.set(subject_id, data || []);
  updateDebugPanel();
  return data || [];
}

async function fetchTeacherLinksForSubject(subject_id) {
  // teacher_subjects + profiles + teachers (ayrı sorgular)
  const { data: links, error } = await sb
    .from("teacher_subjects")
    .select("teacher_profile_id, subject_id")
    .eq("subject_id", subject_id);
  logSupabase("teacher_subjects.select", { data: links, error });
  if (error) return [];

  const ids = [...new Set((links||[]).map(x=>x.teacher_profile_id))].filter(Boolean);
  if(!ids.length) return [];

  const { data: profs } = await sb
    .from("profiles")
    .select("id, full_name, role")
    .in("id", ids);
  const { data: teachers } = await sb
    .from("teachers")
    .select("profile_id, bio, photo_url")
    .in("profile_id", ids);

  const tMap = new Map((teachers||[]).map(t=>[t.profile_id, t]));
  const pMap = new Map((profs||[]).map(p=>[p.id, p]));

  return ids.map(id => ({
    id,
    name: pMap.get(id)?.full_name || "Öğretmen",
    bio: tMap.get(id)?.bio || "",
    photo_url: tMap.get(id)?.photo_url || ""
  }));
}

async function fetchTeacherRating(teacher_profile_id){
  const { data, error } = await sb
    .from("reviews")
    .select("rating, is_hidden")
    .eq("teacher_profile_id", teacher_profile_id)
    .eq("is_hidden", false);
  logSupabase("reviews.select.rating", { data, error });
  if(error) return { avg: null, count: 0 };
  const rows = (data||[]).filter(r => !r.is_hidden);
  const count = rows.length;
  if(!count) return { avg: null, count: 0 };
  const avg = rows.reduce((s,r)=>s+(r.rating||0),0)/count;
  return { avg: Math.round(avg*10)/10, count };
}

/* ----------------- MARKETPLACE (Student/Parent) ----------------- */
async function renderTeacherMarket(nav, viewer){
  const viewerLabel = viewer === "parent" ? "veli" : "öğrenci";
  shell({ navItems: nav, contentHTML: `
    <div class="grid2">
      <div class="card">
        <div class="row spread">
          <div>
            <h2>Öğretmen Marketi</h2>
            <p>Doğrulanmış eğitmenler, WhatsApp köprüsü ve talep gönderme ekranı.</p>
          </div>
          <span class="badge ${state.profile?.verified ? "green" : "warn"}">${state.profile?.verified ? "Doğrulanmış" : "Yorum kilitli"}</span>
        </div>
        <div class="divider"></div>
        <div id="marketList"><div class="skel" style="width:70%"></div></div>
      </div>
      <div class="card">
        <h2>Bugün 1 şey yap</h2>
        <div class="lock">Bir öğretmen seç, talep gönder ya da WhatsApp’tan merhaba de. Küçük adım, büyük ivme.</div>
        <div class="divider"></div>
        <div class="kpis">
          <div class="kpi"><div class="v">${state.profile?.verified ? "✔" : "–"}</div><div class="k">Doğrulama</div></div>
          <div class="kpi"><div class="v">${isEmailConfirmed() ? "✔" : "–"}</div><div class="k">Email</div></div>
          <div class="kpi"><div class="v">${state.profile?.role === "parent" ? "Veli" : "Öğrenci"}</div><div class="k">Rol</div></div>
          <div class="kpi"><div class="v">${APP_VERSION}</div><div class="k">Sürüm</div></div>
        </div>
      </div>
    </div>
  `});

  const { data: links, error } = await sb
    .from("teacher_subjects")
    .select("teacher_profile_id, subject_id");
  logSupabase("teacher_subjects.market", { data: links, error });

  const listEl = qs("#marketList");
  if(error){
    listEl.innerHTML = `<div class="lock">Bağlantı sorunu: ${esc(friendlyPostgrestError(error))}</div>`;
    return;
  }
  const subjects = await fetchSubjects();
  const subjMap = new Map(subjects.map(s=>[s.id, s]));

  const teacherIds = [...new Set((links||[]).map(l=>l.teacher_profile_id))];
  if(!teacherIds.length){
    listEl.innerHTML = `<div class="lock">Bağlantı/policy engeli: ${esc(friendlyPostgrestError(error))}</div>`;
    qs("#marketWa")?.addEventListener("click", ()=>openWhatsAppMessage("Merhaba, öğretmen listesi boş görünüyor. Yönlendirme rica ederim."));
    return;
  }

  const { data: profs } = await sb
    .from("profiles")
    .select("id, full_name, role, verified")
    .in("id", teacherIds);
  const { data: teachers } = await sb
    .from("teachers")
    .select("profile_id, bio");

  const tMap = new Map((teachers||[]).map(t=>[t.profile_id, t.bio]));
  const pMap = new Map((profs||[]).map(p=>[p.id, p]));

  const cards = await Promise.all(teacherIds.map(async tid => {
    const p = pMap.get(tid) || {};
    const bio = tMap.get(tid) || "Bio eklenmemiş.";
    const teacherSubs = (links||[]).filter(l=>l.teacher_profile_id===tid).map(l=>l.subject_id);
    const subNames = teacherSubs.map(id => subjMap.get(id)?.name).filter(Boolean);
    const rating = await fetchTeacherRating(tid);
    return `
      <div class="card" style="margin-bottom:12px;">
        <div class="row spread">
          <div>
            <div style="font-weight:900">${esc(p.full_name || "Öğretmen")}</div>
            <small>${subNames.join(", ") || "Ders ataması bekliyor"}</small>
          </div>
          <span class="badge">${rating.avg ? `⭐ ${rating.avg} (${rating.count})` : "Puan yok"}</span>
        </div>
        <p>${esc(bio)}</p>
        ${p.verified ? `` : `<div class="lock">Yorum yazma kilitli (öğretmen doğrulanmadı).</div>`}
        <div class="divider"></div>
        <div class="row">
          <button class="btn secondary" data-wa-teacher="${esc(tid)}">WhatsApp’tan yaz</button>
          <button class="btn" data-request="${esc(tid)}">Talep Gönder</button>
        </div>
      </div>
    `;
  }));

  listEl.innerHTML = cards.join("") || renderEmptyState("Henüz kayıtlı öğretmen bulunmuyor.");

  qsa("[data-wa-teacher]", listEl).forEach(btn => {
    btn.addEventListener("click", () => {
      const tid = btn.getAttribute("data-wa-teacher");
      const name = pMap.get(tid)?.full_name || "Öğretmen";
      const subjText = (links||[]).filter(l=>l.teacher_profile_id===tid).map(l=>subjMap.get(l.subject_id)?.name).filter(Boolean).join(", ");
      const msg = `Merhaba, ${viewerLabel} olarak ${name} hocaya yazmak istiyorum. Ders: ${subjText || "belirtiniz"} • Rol: ${viewerLabel} • Kullanıcı: ${state.user?.id || "anon"}`;
      openWhatsAppMessage(msg);
    });
  });

  qsa("[data-request]", listEl).forEach(btn => {
    btn.addEventListener("click", async () => {
      const tid = btn.getAttribute("data-request");
      const teacherSubs = (links||[]).filter(l=>l.teacher_profile_id===tid).map(l=>l.subject_id);
      await openMarketRequestModal(tid, teacherSubs, viewerLabel);
    });
  });
}

async function openMarketRequestModal(teacher_profile_id, subjectIds, viewerLabel){
  const subjects = await fetchSubjects();
  const options = subjectIds.map(id => `<option value="${esc(id)}">${esc(subjects.find(s=>s.id===id)?.name || "Ders")}</option>`).join("");
  openModal("Talep Gönder", `
    <label>Ders</label>
    <select id="reqSub">${options || `<option value=\"\">Ders atanmadı</option>`}</select>
    <label>Not</label>
    <textarea class="input" id="reqNote" placeholder="Hedef, mevcut durum, ek not..."></textarea>
  `, `
    <button class="btn secondary" onclick="closeModal()">Vazgeç</button>
    <button class="btn" id="reqSend">Gönder</button>
  `);

  qs("#reqSend")?.addEventListener("click", async () => {
    const subject_id = qs("#reqSub").value;
    const note = qs("#reqNote").value.trim();
    if(!subject_id) return toast("error","Ders seçin.");

    const meta = viewerLabel === "veli" ? await askChildMeta() : {};
    meta.teacher_hint = teacher_profile_id;
    meta.viewer = viewerLabel;
    meta.note = note;

    const { error } = await sb.from("enrollments").insert([{
      user_profile_id: state.profile.id,
      subject_id,
      status: "requested",
      meta
    }]);
    logSupabase("enrollments.insert.market", { error });
    if(error) return toast("error","Talep gönderilemedi: " + friendlyPostgrestError(error));
    toast("success","Talep alındı. Öğretmen yönlendirmesi yapılacak.");
    closeModal();
  });
}

function validEmail(email){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
/* ----------------- PROFILE HELPERS ----------------- */
function isAdminRole() {
  return state.profile?.role === "admin";
}

function policyToast(error) {
  if (!error) return;
  if (error.code === "403" || error.code === "401" || (error.message || "").toLowerCase().includes("policy")) {
    toast("error", "Bu bilgiye erişim yetkiniz yok");
  }
}

async function fetchProfileCore(profileId, includePhone = false) {
  const columns = includePhone
    ? "id, role, full_name, verified, created_at, public_name_pref, phone"
    : "id, role, full_name, verified, created_at, public_name_pref";
  const { data, error, status } = await sb
    .from("profiles")
    .select(columns)
    .eq("id", profileId)
    .maybeSingle();
  logSupabase("profiles.core", { data, error, status });
  if (error) {
    policyToast(error);
    return null;
  }
  return data;
}

async function fetchStudentDetail(profileId) {
  const { data, error } = await sb
    .from("student_profiles")
    .select("class_level, target_exam, target_major, city, about")
    .eq("profile_id", profileId)
    .maybeSingle();
  logSupabase("student_profiles.select", { data, error });
  if (error && error.code !== "PGRST116") policyToast(error);
  return data || null;
}

async function fetchParentDetail(profileId) {
  const { data, error } = await sb
    .from("parent_profiles")
    .select("preferred_contact, about")
    .eq("profile_id", profileId)
    .maybeSingle();
  logSupabase("parent_profiles.select", { data, error });
  if (error && error.code !== "PGRST116") policyToast(error);
  return data || null;
}

async function fetchTeacherDetail(profileId) {
  const { data, error } = await sb
    .from("teacher_profiles")
    .select("bio, city, experience_years, lesson_format")
    .eq("profile_id", profileId)
    .maybeSingle();
  logSupabase("teacher_profiles.select", { data, error });
  if (error && error.code !== "PGRST116") policyToast(error);
  return data || null;
}

async function fetchParentStudents(profileId) {
  const { data, error } = await sb
    .from("parent_students")
    .select("id, parent_profile_id, student_profile_id, relation")
    .eq("parent_profile_id", profileId);
  logSupabase("parent_students.select", { data, error });
  if (error) {
    policyToast(error);
    return [];
  }
  const studentIds = [...new Set((data || []).map(r => r.student_profile_id))];
  let profileMap = new Map();
  if (studentIds.length) {
    const { data: students, error: sErr } = await sb
      .from("profiles")
      .select("id, full_name, role")
      .in("id", studentIds);
    logSupabase("profiles.students", { data: students, error: sErr });
    profileMap = new Map((students || []).map(s => [s.id, s]));
  }
  return (data || []).map(row => ({
    id: row.id,
    relation: row.relation || "öğrenci",
    student: profileMap.get(row.student_profile_id) || { id: row.student_profile_id, full_name: "Öğrenci", role: "student" }
  }));
}

async function loadProfileDetails(force = false) {
  if (state.profileDetails && !force) return state.profileDetails;
  if (!state.profile?.id) return null;

  const core = await fetchProfileCore(state.profile.id, isAdminRole());
  if (!core) return null;

  const role = core.role;
  const detail = { core };

  if (role === "student") detail.student = await fetchStudentDetail(core.id);
  if (role === "parent") {
    detail.parent = await fetchParentDetail(core.id);
    detail.children = await fetchParentStudents(core.id);
  }
  if (role === "teacher") detail.teacher = await fetchTeacherDetail(core.id);

  state.profileDetails = detail;
  return detail;
}

async function loadAnyProfileDetails(profileId, roleHint) {
  const core = await fetchProfileCore(profileId, true);
  if (!core) return null;
  const role = roleHint || core.role;
  const detail = { core };
  if (role === "student") detail.student = await fetchStudentDetail(profileId);
  if (role === "parent") {
    detail.parent = await fetchParentDetail(profileId);
    detail.children = await fetchParentStudents(profileId);
  }
  if (role === "teacher") detail.teacher = await fetchTeacherDetail(profileId);
  return detail;
}
/* ----------------- STUDENT: HOME ----------------- */
async function studentHome(nav){
  const contentHTML = `
    <div class="grid2">
      <div class="card">
        <h2>Bugünün Planı</h2>
        <div id="todayTasks">
          <div class="skel" style="width:70%"></div>
          <div class="skel" style="width:55%; margin-top:8px"></div>
          <div class="skel" style="width:62%; margin-top:8px"></div>
        </div>
        <div class="divider"></div>
        <div class="row">
          <button class="btn secondary" id="addStudyLogBtn">Çalışma Kaydı Ekle</button>
          <span class="badge blue">${esc(state.profile?.full_name || "")}</span>
          ${isEmailConfirmed() ? `<span class="badge green">Email Doğrulandı</span>` : `<span class="badge warn">Email Doğrulanmadı</span>`}
        </div>
      </div>

      <div class="card">
        <h2>Hızlı Bakış</h2>
        <div class="kpis">
          <div class="kpi"><div class="v" id="kpiMyLessons">–</div><div class="k">Aktif ders</div></div>
          <div class="kpi"><div class="v" id="kpiReq">–</div><div class="k">Talep</div></div>
          <div class="kpi"><div class="v" id="kpiDone">–</div><div class="k">Tamamlanan görev</div></div>
          <div class="kpi"><div class="v" id="kpiStreak">–</div><div class="k">Seri (gün)</div></div>
        </div>
        <div class="divider"></div>
        <div class="lock">
          İpucu: Net yerine önce <b>hata türü</b> düşür. Site bunu görevlerle otomatik besler.
        </div>
      </div>
    </div>
  `;

  shell({ navItems: nav, contentHTML });

  qs("#addStudyLogBtn")?.addEventListener("click", () => {
    openModal("Çalışma Kaydı", `
      <label>Bugün ne yaptın?</label>
      <textarea class="input" id="studyNote" placeholder="Örn: Problemler 40 dk, deneme analizi 15 dk..."></textarea>
      <label>Odak (1–5)</label>
      <input class="input" id="studyFocus" type="number" min="1" max="5" value="3"/>
    `, `
      <button class="btn secondary" onclick="closeModal()">Vazgeç</button>
      <button class="btn" id="saveStudyLog">Kaydet</button>
    `);
    setTimeout(() => {
      qs("#saveStudyLog")?.addEventListener("click", () => {
        closeModal();
        toast("success","Kaydedildi (MVP: lokal).");
      });
    }, 0);
  });

  // KPIs + tasks from real tables (tasks/enrollments)
  await fillStudentKPIsAndTasks();
}

async function fillStudentKPIsAndTasks(){
  // enrollments
  const { data: enrolls, error } = await sb
    .from("enrollments")
    .select("id,status,created_at")
    .eq("user_profile_id", state.profile.id);
  logSupabase("enrollments.select.student", { data: enrolls, error });

  const active = (enrolls||[]).filter(e => e.status === "active").length;
  const req = (enrolls||[]).filter(e => e.status === "requested").length;

  // tasks
  let done = 0;
  let tasksTodayHTML = "";
  if(enrolls?.length){
    const enrollIds = enrolls.map(e=>e.id);
    const { data: tasks, error: tErr } = await sb
      .from("tasks")
      .select("*")
      .in("enrollment_id", enrollIds)
      .order("due_date", { ascending: true });
    logSupabase("tasks.select.student", { data: tasks, error: tErr });

    const today = new Date();
    const ymd = today.toISOString().slice(0,10);

    const todays = (tasks||[]).filter(t => (t.due_date||"").slice(0,10) === ymd).slice(0,6);
    done = (tasks||[]).filter(t => t.completed).length;

    if(todays.length){
      tasksTodayHTML = todays.map(t => `
        <div class="row spread" style="padding:10px 0; border-bottom:1px solid var(--line);">
          <div>
            <div style="font-weight:800">${esc(t.title)}</div>
            <small>${esc(t.notes||"")}</small>
          </div>
          <button class="btn secondary" data-task="${esc(t.id)}">${t.completed ? "Tamamlandı" : "Tamamla"}</button>
        </div>
      `).join("");
    } else {
      tasksTodayHTML = `<div class="lock">Bugün için görev yok. Derslerimden birine kayıt olunca öğretmenin görev ekleyebilir.</div>`;
    }
  } else {
    tasksTodayHTML = `<div class="lock">Henüz ders kaydın yok. “Dersler” sekmesinden talep gönder.</div>`;
  }

  qs("#kpiMyLessons").textContent = String(active);
  qs("#kpiReq").textContent = String(req);
  qs("#kpiDone").textContent = String(done);
  qs("#kpiStreak").textContent = String(calcFakeStreak(done)); // MVP

  qs("#todayTasks").innerHTML = tasksTodayHTML;

  qsa("[data-task]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-task");
      const { error } = await sb.from("tasks").update({ completed: true }).eq("id", id);
      logSupabase("tasks.update.complete", { error });
      if(error) return toast("error","Görev güncellenemedi: " + error.message);
      toast("success","Görev tamamlandı.");
      await fillStudentKPIsAndTasks();
    });
  });
}
function calcFakeStreak(done){
  if(done <= 0) return 0;
  if(done < 4) return 1;
  if(done < 10) return 3;
  return 5;
}

/* ----------------- STUDENT: PROFILE ----------------- */
async function renderStudentProfile(nav){
  const details = await loadProfileDetails();
  const student = details?.student || {};
  const core = details?.core || state.profile || {};

  shell({ navItems: nav, contentHTML: `
    <div class="card">
      <div class="row spread">
        <div>
          <h2>Profilim</h2>
          <p>Ad soyad, sınıf ve hedef bilgilerini güncelle. Yalnızca kendi profilini düzenleyebilirsin.</p>
        </div>
        <span class="badge blue">Öğrenci</span>
      </div>
      <div class="divider"></div>
      <div class="grid2">
        <div>
          <label>Ad Soyad</label>
          <input class="input" id="spName" autocomplete="name" />
        </div>
        <div>
          <label>Sınıf</label>
          <input class="input" id="spClass" placeholder="Örn: 11" />
        </div>
      </div>
      <div class="grid2">
        <div>
          <label>Hedef Sınav</label>
          <select id="spTargetExam">
            <option value="">Seçiniz</option>
            <option value="YKS">YKS</option>
            <option value="LGS">LGS</option>
            <option value="Okul">Okul</option>
          </select>
        </div>
        <div>
          <label>Hedef Bölüm</label>
          <input class="input" id="spTargetMajor" placeholder="Örn: Tıp, Yazılım" />
        </div>
      </div>
      <div class="grid2">
        <div>
          <label>Şehir</label>
          <input class="input" id="spCity" placeholder="İstanbul" />
        </div>
        <div>
          <label>Hakkımda</label>
          <textarea class="input" id="spAbout" placeholder="Kısa bir not..."></textarea>
        </div>
      </div>
      <div class="divider"></div>
      <div class="row end">
        <button class="btn" id="spSave">Kaydet</button>
      </div>
    </div>
  `});

  qs("#spName").value = core.full_name || "";
  qs("#spClass").value = student.class_level || "";
  qs("#spTargetExam").value = student.target_exam || "";
  qs("#spTargetMajor").value = student.target_major || "";
  qs("#spCity").value = student.city || "";
  qs("#spAbout").value = student.about || "";

  qs("#spSave")?.addEventListener("click", async () => {
    const full_name = qs("#spName").value.trim();
    const class_level = qs("#spClass").value.trim();
    const target_exam = qs("#spTargetExam").value;
    const target_major = qs("#spTargetMajor").value.trim();
    const city = qs("#spCity").value.trim();
    const about = qs("#spAbout").value.trim();

    if(!full_name) return toast("error","Ad soyad zorunlu.");
    const updates = { full_name };
    const { error: pErr } = await sb.from("profiles").update(updates).eq("id", state.profile.id);
    logSupabase("profiles.update.student", { error: pErr });
    if(pErr) return toast("error", friendlyPostgrestError(pErr));

    const payload = { profile_id: state.profile.id, class_level, target_exam, target_major, city, about };
    const { error: sErr } = await sb.from("student_profiles").upsert([payload]);
    logSupabase("student_profiles.upsert", { error: sErr });
    if(sErr) return toast("error", friendlyPostgrestError(sErr));

    toast("success","Profil güncellendi.");
    state.profileDetails = null;
    await loadProfileDetails(true);
  });
}

/* ----------------- PARENT: PROFILE ----------------- */
async function renderParentProfile(nav){
  const details = await loadProfileDetails();
  const parent = details?.parent || {};
  const core = details?.core || state.profile || {};

  shell({ navItems: nav, contentHTML: `
    <div class="card">
      <div class="row spread">
        <div>
          <h2>Profilim</h2>
          <p>İletişim tercihini ve hakkımda alanını güncelle. Telefon bilgisi gösterilmez.</p>
        </div>
        <span class="badge warn">Veli</span>
      </div>
      <div class="divider"></div>
      <div class="grid2">
        <div>
          <label>Ad Soyad</label>
          <input class="input" id="ppName" autocomplete="name" />
        </div>
        <div>
          <label>Tercih edilen iletişim</label>
          <select id="ppContact">
            <option value="">Seçiniz</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
          </select>
        </div>
      </div>
      <div>
        <label>Hakkımda</label>
        <textarea class="input" id="ppAbout" placeholder="Kısa tanıtım"></textarea>
      </div>
      <div class="divider"></div>
      <div class="row end">
        <button class="btn" id="ppSave">Kaydet</button>
      </div>
    </div>
  `});

  qs("#ppName").value = core.full_name || "";
  qs("#ppContact").value = parent.preferred_contact || "";
  qs("#ppAbout").value = parent.about || "";

  qs("#ppSave")?.addEventListener("click", async () => {
    const full_name = qs("#ppName").value.trim();
    const preferred_contact = qs("#ppContact").value;
    const about = qs("#ppAbout").value.trim();
    if(!full_name) return toast("error","Ad soyad zorunlu.");

    const { error: pErr } = await sb.from("profiles").update({ full_name }).eq("id", state.profile.id);
    logSupabase("profiles.update.parent", { error: pErr });
    if(pErr) return toast("error", friendlyPostgrestError(pErr));

    const payload = { profile_id: state.profile.id, preferred_contact, about };
    const { error: dErr } = await sb.from("parent_profiles").upsert([payload]);
    logSupabase("parent_profiles.upsert", { error: dErr });
    if(dErr) return toast("error", friendlyPostgrestError(dErr));

    toast("success","Profil güncellendi.");
    state.profileDetails = null;
    await loadProfileDetails(true);
  });
}

async function renderParentLinked(nav){
  const details = await loadProfileDetails();
  const children = details?.children || [];

  shell({ navItems: nav, contentHTML: `
    <div class="card">
      <div class="row spread">
        <div>
          <h2>Bağlı Öğrenciler</h2>
          <p>Bu listede yalnızca admin tarafından bağlanan öğrenciler görünür. İsim ve ilişki bilgisi yer alır.</p>
        </div>
        <span class="badge warn">Salt Okunur</span>
      </div>
      <div class="divider"></div>
      <div id="parentLinkedList"></div>
    </div>
  `});

  const listEl = qs("#parentLinkedList");
  if(!children.length){
    listEl.innerHTML = renderEmptyState("Henüz profil bilgisi girilmedi");
    return;
  }
  listEl.innerHTML = children.map(ch => `
    <div class="linked-item">
      <div>
        <div class="title">${esc(ch.student.full_name || "Öğrenci")}</div>
        <small>${esc(ch.relation || "öğrenci")}</small>
      </div>
    </div>
  `).join("");
}

/* ----------------- TEACHER: PROFILE ----------------- */
async function renderTeacherProfile(nav){
  const details = await loadProfileDetails();
  const teacher = details?.teacher || {};
  const core = details?.core || state.profile || {};

  shell({ navItems: nav, contentHTML: `
    <div class="card">
      <div class="row spread">
        <div>
          <h2>Profilim</h2>
          <p>Bio, şehir ve deneyim bilgilerini güncelle. Telefon alanı gösterilmez.</p>
        </div>
        <span class="badge blue">Öğretmen</span>
      </div>
      <div class="divider"></div>
      <div class="grid2">
        <div>
          <label>Ad Soyad</label>
          <input class="input" id="tpName" autocomplete="name" />
        </div>
        <div>
          <label>Şehir</label>
          <input class="input" id="tpCity" placeholder="Ankara" />
        </div>
      </div>
      <div class="grid2">
        <div>
          <label>Deneyim yılı</label>
          <input class="input" id="tpExp" type="number" min="0" />
        </div>
        <div>
          <label>Ders verdiği format</label>
          <select id="tpFormat">
            <option value="">Seçiniz</option>
            <option value="online">Online</option>
            <option value="yüzyüze">Yüzyüze</option>
          </select>
        </div>
      </div>
      <div>
        <label>Bio</label>
        <textarea class="input" id="tpBio" placeholder="Deneyim, uzmanlık..."></textarea>
      </div>
      <div class="divider"></div>
      <div class="row end">
        <button class="btn" id="tpSave">Kaydet</button>
      </div>
    </div>
  `});

  qs("#tpName").value = core.full_name || "";
  qs("#tpCity").value = teacher.city || "";
  qs("#tpExp").value = teacher.experience_years || "";
  qs("#tpFormat").value = teacher.lesson_format || "";
  qs("#tpBio").value = teacher.bio || "";

  qs("#tpSave")?.addEventListener("click", async () => {
    const full_name = qs("#tpName").value.trim();
    const city = qs("#tpCity").value.trim();
    const experience_years = Number(qs("#tpExp").value || 0);
    const lesson_format = qs("#tpFormat").value;
    const bio = qs("#tpBio").value.trim();
    if(!full_name) return toast("error","Ad soyad zorunlu.");

    const { error: pErr } = await sb.from("profiles").update({ full_name }).eq("id", state.profile.id);
    logSupabase("profiles.update.teacher", { error: pErr });
    if(pErr) return toast("error", friendlyPostgrestError(pErr));

    const payload = { profile_id: state.profile.id, city, experience_years, lesson_format, bio };
    const { error: tErr } = await sb.from("teacher_profiles").upsert([payload]);
    logSupabase("teacher_profiles.upsert", { error: tErr });
    if(tErr) return toast("error", friendlyPostgrestError(tErr));

    toast("success","Profil güncellendi.");
    state.profileDetails = null;
    await loadProfileDetails(true);
  });
}
/* ----------------- STUDENT: CATALOG ----------------- */
async function studentCatalog(nav){
  shell({ navItems: nav, contentHTML: `
    <div class="card">
      <div class="row spread">
        <div>
          <h2>Ders Kataloğu</h2>
          <p>Lise + Ortaöğretim + İlköğretim tüm dersler. İngilizce öncelikli.</p>
        </div>
        <div class="row" style="gap:8px;">
          <span class="badge ${isEmailConfirmed() ? "green" : "warn"}">
            ${isEmailConfirmed() ? "Email doğrulandı" : "Fiyatlar kilitli"}
          </span>
          <button class="btn secondary" id="catalogRefresh">Yenile</button>
        </div>
      </div>
      <div class="grid3" style="margin-top:12px;">
        <div>
          <label>Kademe</label>
          <select id="fLevel">
            <option value="all">Tümü</option>
            <option value="primary">İlköğretim</option>
            <option value="middle">Ortaöğretim</option>
            <option value="high">Lise</option>
          </select>
        </div>
        <div>
          <label>Arama</label>
          <input class="input" id="fSearch" placeholder="Ders ara (örn: İngilizce, Matematik)" />
        </div>
        <div>
          <label>Sırala</label>
          <select id="fSort">
            <option value="smart">Önerilen</option>
            <option value="name">İsme göre</option>
          </select>
        </div>
      </div>
      <div class="divider"></div>
      <div id="catalogList">
        <div class="skel" style="width:78%"></div>
        <div class="skel" style="width:58%; margin-top:8px"></div>
        <div class="skel" style="width:64%; margin-top:8px"></div>
      </div>
    </div>
  `});

  const subjects = await fetchSubjects();
  const meta = state.cache.subjectsMeta || {};
  const listEl = qs("#catalogList");
  qs("#catalogRefresh")?.addEventListener("click", async () => {
    resetCatalogCache();
    await studentCatalog(nav);
  });

  if(meta.error){
    listEl.innerHTML = `<div class="lock">Bağlantı sorunu: ${esc(meta.error.message || "bilinmiyor")}</div>`;
    return;
  } else if(meta.empty){
    listEl.innerHTML = `<div class="lock">Boş veri (RLS veya henüz eklenmedi).</div>`;
    return;
  }


  const render = async () => {
    const level = qs("#fLevel").value;
    const search = qs("#fSearch").value.trim().toLowerCase();
    const sort = qs("#fSort").value;

    let list = subjects.slice();
    if(level !== "all") list = list.filter(s => s.level === level);
    if(search) list = list.filter(s => (s.name||"").toLowerCase().includes(search));

    if(sort === "name"){
      list.sort((a,b)=> (a.name||"").localeCompare(b.name||""));
    } else {
      // smart: already ordered by sort_order; english should be low sort_order
    }

    const cards = await Promise.all(list.map(async s => {
      const isEnglish = (s.name||"").toLowerCase().includes("ingilizce") || (s.name||"").toLowerCase().includes("english");
      const teachers = await fetchTeacherLinksForSubject(s.id);
      const teacherPreview = teachers.slice(0,2).map(t=>esc(t.name)).join(", ") || "Atanmadı";
      return `
        <div class="card" style="padding:14px; margin-bottom:12px;">
          <div class="row spread">
            <div class="row" style="gap:10px;">
              <div style="font-weight:900">${esc(s.name)}</div>
              <span class="badge ${isEnglish ? "blue" : "secondary"}">${levelLabel(s.level)}</span>
              ${isEnglish ? `<span class="badge blue">Öncelikli</span>` : ``}
              <span class="badge">Koç Takipli</span>
            </div>
            <button class="btn secondary" data-open="${esc(s.id)}">Detay</button>
          </div>
          <p style="margin:10px 0 0;">Öğretmen(ler): <b>${teacherPreview}</b></p>
          <div class="footer-note">Fiyatlar: ${isEmailConfirmed() ? "açık" : "kilitli (email doğrula)"}</div>
        </div>
      `;
    }));

    qs("#catalogList").innerHTML = cards.join("") || renderEmptyState("Aradığınız kriterde ders bulunamadı.");

    qsa("[data-open]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const sid = btn.getAttribute("data-open");
        await openSubjectDetailModal(sid, "student");
      });
    });
  };

  qs("#fLevel").addEventListener("change", render);
  qs("#fSearch").addEventListener("input", render);
  qs("#fSort").addEventListener("change", render);
  await render();
}

function levelLabel(level){
  if(level==="primary") return "İlkğretim";
  if(level==="middle") return "Ortaöğretim";
  return "Lise";
}

async function openSubjectDetailModal(subjectId, viewer){
  const subjects = await fetchSubjects();
  const s = subjects.find(x=>x.id===subjectId);
  if(!s) return toast("error","Ders bulunamadı.");

  const teachers = await fetchTeacherLinksForSubject(subjectId);
  const packages = await fetchPackages(subjectId);
  const pkgMeta = state.cache.packagesMeta.get(subjectId);
  const isEnglish = (s.name||"").toLowerCase().includes("ingilizce") || (s.name||"").toLowerCase().includes("english");

  let pkgHTML = "";
  if(!isEmailConfirmed()){
    pkgHTML = `<div class="lock">Fiyatları görmek için email doğrulaması gerekli. (Giriş yaptıysan email kutunu kontrol et.)</div>`;
    } else if(pkgMeta?.error && (pkgMeta.error.code === "401" || pkgMeta.error.code === "403")){
    pkgHTML = `<div class="lock">Yetki/RLS engeli: Paket fiyatları için email doğrulaması veya ek yetki gerekiyor.</div>`;
  } else {
    pkgHTML = packages.map(p => `
      <div class="row spread" style="padding:10px 0; border-bottom:1px solid var(--line);">
        
      <div>
        
          <div style="font-weight:900">${esc(p.title)}</div>
          <small>${esc(p.package_code)}</small>
        </div>
        <div class="row" style="gap:10px;">
          <span class="badge blue">${esc(p.price_try)} ₺</span>
          <button class="btn secondary" data-enroll="${esc(p.id)}">Derse Kaydol</button>
        </div>
      </div>
    `).join("") || `<div class="lock">Paket tanımlı değil.</div>`;
  }

  const teacherCards = await Promise.all(teachers.map(async t => {
    const r = await fetchTeacherRating(t.id);
    return `
      <div class="card" style="padding:12px; border-color: rgba(31,42,58,.7); background: rgba(17,27,40,.45);">
        <div class="row spread">
          <div style="font-weight:900">${esc(t.name)}</div>
          <span class="badge">${r.avg ? `⭐ ${r.avg} (${r.count})` : "Henüz puan yok"}</span>
        </div>
        <div class="footer-note">${esc(t.bio || "Bio eklenmemiş.")}</div>
        <div class="row" style="margin-top:10px;">
          <button class="btn secondary" data-open-teacher="${esc(t.id)}">Yorumları Gör</button>
          ${isEmailConfirmed() ? `<button class="btn secondary" data-review="${esc(t.id)}">Puanla/Yorumla</button>` : ``}
        </div>
      </div>
    `;
  }));

  openModal(
    `${s.name} • ${levelLabel(s.level)}`,
    `
      <div class="row" style="gap:10px;">
        <span class="badge ${isEnglish ? "blue" : ""}">${isEnglish ? "İngilizce öncelikli" : "Koç takipli"}</span>
        <span class="badge">${levelLabel(s.level)}</span>
      </div>

      <div class="divider"></div>

      <h3>Paketler</h3>
      ${pkgHTML}

      <div class="divider"></div>

      <h3>Öğretmenler</h3>
      <div class="grid2">${teacherCards.join("") || `<div class="lock">Bu derse öğretmen atanmadı.</div>`}</div>
    `,
    `<button class="btn secondary" onclick="closeModal()">Kapat</button>`
  );

  // enroll
  qsa("[data-enroll]", $modalBody).forEach(btn => {
    btn.addEventListener("click", async () => {
      const package_id = btn.getAttribute("data-enroll");

      // verified gerekli değil, sadece yorum için gerekli. enrollment talebi serbest.
      const meta = viewer === "parent" ? await askChildMeta() : {};
      const { error } = await sb.from("enrollments").insert([{
        user_profile_id: state.profile.id,
        subject_id: subjectId,
        package_id,
        status: "requested",
        meta
      }]);
      logSupabase("enrollments.insert", { error });
      if(error) return toast("error","Talep gönderilemedi: " + friendlyPostgrestError(error));
      toast("success","Ders talebin alındı. Admin onayı bekleniyor.");
      closeModal();
      resetCatalogCache();
    });
  });

  // teacher reviews view
  qsa("[data-open-teacher]", $modalBody).forEach(btn => {
    btn.addEventListener("click", async () => {
      const tid = btn.getAttribute("data-open-teacher");
      await openTeacherReviewsModal(tid);
    });
  });

  // add review
  qsa("[data-review]", $modalBody).forEach(btn => {
    btn.addEventListener("click", async () => {
      const tid = btn.getAttribute("data-review");
      await openAddReviewModal(tid);
    });
  });
}

function askChildMeta(){
  return new Promise(resolve => {
    openModal("Veli Bilgisi", `
      <label>Öğrenci adı (isteğe bağlı)</label>
      <input class="input" id="childName" placeholder="Örn: Ahmet" />
      <label>Not (isteğe bağlı)</label>
      <textarea class="input" id="childNote" placeholder="Örn: Hedef okul / mevcut net / çalışma sorunu..."></textarea>
    `, `
      <button class="btn secondary" id="childCancel">İptal</button>
      <button class="btn" id="childOk">Devam</button>
    `);
    qs("#childCancel")?.addEventListener("click", () => { closeModal(); resolve({}); });
    qs("#childOk")?.addEventListener("click", () => {
      const child_name = qs("#childName").value.trim();
      const note = qs("#childNote").value.trim();
      closeModal();
      resolve({ child_name, note });
    });
  });
}

/* ----------------- REVIEWS ----------------- */
async function openTeacherReviewsModal(teacher_profile_id){
  const { data: reviews, error } = await sb
    .from("reviews")
    .select("rating, comment, is_anonymous, created_at, is_hidden")
    .eq("teacher_profile_id", teacher_profile_id)
    .eq("is_hidden", false)
    .order("created_at", { ascending: false });
  logSupabase("reviews.select.modal", { data: reviews, error });
  if(error) return toast("error","Yorumlar alınamadı: " + friendlyPostgrestError(error));

  const rating = await fetchTeacherRating(teacher_profile_id);
  const list = (reviews||[]).map(r => `
    <div style="padding:10px 0; border-bottom:1px solid var(--line);">
      <div class="row spread">
        <div style="font-weight:900">⭐ ${esc(r.rating)}</div>
        <small>${new Date(r.created_at).toLocaleDateString("tr-TR")}</small>
      </div>
      <div class="footer-note">${esc(r.is_anonymous ? "Onaylı Kullanıcı" : "Adı Açık Kullanıcı")}</div>
      <div style="margin-top:8px;">${esc(r.comment || "")}</div>
    </div>
  `).join("");

  openModal("Öğretmen Puanları", `
    <div class="row spread">
      <span class="badge">${rating.avg ? `⭐ ${rating.avg} (${rating.count})` : "Henüz puan yok"}</span>
      ${state.profile?.verified ? `<span class="badge blue">Mavi Tikli</span>` : `<span class="badge warn">Tik gerekli</span>`}
    </div>
    <div class="divider"></div>
    ${list || `<div class="lock">Henüz yorum yok.</div>`}
  `, `<button class="btn secondary" onclick="closeModal()">Kapat</button>`);
}

async function openAddReviewModal(teacher_profile_id){
  if(!isEmailConfirmed()) return toast("warn","Yorum için önce email doğrulaması gerekli.");
  if(!state.profile?.verified) return toast("warn","Yorum/puan için mavi tik gerekli (admin onayı).");

  openModal("Puanla / Yorumla", `
    <label>Puan (1-5)</label>
    <div class="stars" id="stars"></div>
    <label>Yorum</label>
    <textarea class="input" id="revComment" placeholder="Kısa, net, faydalı bir yorum..."></textarea>
    <label>İsim</label>
    <select id="revAnon">
      <option value="1">Anonim (Onaylı Kullanıcı)</option>
      <option value="0">Açık isimle</option>
    </select>
  `, `
    <button class="btn secondary" onclick="closeModal()">Vazgeç</button>
    <button class="btn" id="sendReview">Gönder</button>
  `);

  // star selector
  const stars = qs("#stars");
  let val = 5;
  renderStars();
  function renderStars(){
    stars.innerHTML = "";
    for(let i=1;i<=5;i++){
      const sp = document.createElement("span");
      sp.className = "star " + (i<=val ? "on" : "");
      sp.textContent = "★";
      sp.addEventListener("click", () => { val=i; renderStars(); });
      stars.appendChild(sp);
    }
  }

  qs("#sendReview")?.addEventListener("click", async () => {
    const comment = qs("#revComment").value.trim();
    const is_anonymous = qs("#revAnon").value === "1";
    if(comment.length < 3) return toast("error","Yorum çok kısa.");
    const { error } = await sb.from("reviews").insert([{
      teacher_profile_id,
      reviewer_profile_id: state.profile.id,
      rating: val,
      comment,
      is_anonymous,
      is_hidden: false
    }]);
    logSupabase("reviews.insert", { error });
    if(error) return toast("error","Gönderilemedi: " + friendlyPostgrestError(error));
    toast("success","Yorum gönderildi.");
    closeModal();
  });
}

/* ----------------- STUDENT: MY SUBJECTS ----------------- */
async function studentMySubjects(nav){
  shell({ navItems: nav, contentHTML: `
    <div class="card">
      <h2>Derslerim</h2>
      <div id="myEnrolls">
        <div class="skel" style="width:72%"></div>
        <div class="skel" style="width:52%; margin-top:8px"></div>
      </div>
    </div>
  `});

  const { data: enrolls, error } = await sb
    .from("enrollments")
    .select("id,status,created_at, subject_id, package_id, meta")
    .eq("user_profile_id", state.profile.id)
    .order("created_at", { ascending: false });
  logSupabase("enrollments.select.student.my", { data: enrolls, error });
  if(error) return toast("error","Dersler alınamadı: " + friendlyPostgrestError(error));

  const subjects = await fetchSubjects();
  const subjMap = new Map(subjects.map(s=>[s.id, s]));

  const rows = (enrolls||[]).map(e => `
    <tr>
      <td>
        <b>${esc(subjMap.get(e.subject_id)?.name || "Ders")}</b>
        <div><small>${esc(levelLabel(subjMap.get(e.subject_id)?.level || ""))}</small></div>
        ${e.meta?.child_name ? `<div class="badge warn" style="margin-top:6px;">Öğrenci: ${esc(e.meta.child_name)}</div>` : ``}
      </td>
      <td>${esc(e.status)}</td>
      <td><small>${new Date(e.created_at).toLocaleDateString("tr-TR")}</small></td>
      <td><button class="btn secondary" data-open-en="${esc(e.id)}">Görevler</button></td>
    </tr>
  `).join("");

  qs("#myEnrolls").innerHTML = `
    <table class="table">
      <thead><tr><th>Ders</th><th>Durum</th><th>Tarih</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">' + renderEmptyState("Henüz hiç ders talebin yok. Kataloğa göz at!") + '</td></tr>'}</tbody>
    </table>
  `;
  applyMobileTableLabels();
  applyMobileTableLabels();

  qsa("[data-open-en]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-open-en");
      await openEnrollmentTasksModal(id, "student");
    });
  });
}

async function openEnrollmentTasksModal(enrollment_id, viewer){
  const { data: tasks, error } = await sb
    .from("tasks")
    .select("*")
    .eq("enrollment_id", enrollment_id)
    .order("due_date", { ascending: true });
  logSupabase("tasks.select.enrollment", { data: tasks, error });
  if(error) return toast("error","Görevler alınamadı: " + friendlyPostgrestError(error));

  const list = (tasks||[]).map(t => `
    <div class="row spread" style="padding:10px 0; border-bottom:1px solid var(--line);">
      <div>
        <div style="font-weight:900">${esc(t.title)}</div>
        <small>${esc(t.due_date ? new Date(t.due_date).toLocaleDateString("tr-TR") : "")} • ${esc(t.visibility||"")}</small>
        <div class="footer-note">${esc(t.notes||"")}</div>
      </div>
      ${viewer==="student" ? `<button class="btn secondary" data-done="${esc(t.id)}">${t.completed ? "Tamam" : "Tamamla"}</button>` : ``}
    </div>
  `).join("");

  openModal("Görevler", list || `<div class="lock">Görev yok.</div>`, `<button class="btn secondary" onclick="closeModal()">Kapat</button>`);

  qsa("[data-done]", $modalBody).forEach(btn => {
    btn.addEventListener("click", async () => {
      const tid = btn.getAttribute("data-done");
      const { error: e2 } = await sb.from("tasks").update({ completed:true }).eq("id", tid);
      logSupabase("tasks.update.done", { error: e2 });
      if(e2) return toast("error","Güncellenemedi: " + friendlyPostgrestError(e2));
      toast("success","Tamamlandı.");
      closeModal();
    });
  });
}

async function studentProgress(nav){
  shell({ navItems: nav, contentHTML: `
    <div class="card">
      <h2>İlerleme</h2>
      <p>Bu MVP’de grafikler sade tutuldu. Görev tamamlamayı ve ders kayıtlarını görünür yapar.</p>
      <div class="divider"></div>
      <div class="kpis">
        <div class="kpi"><div class="v">${state.profile?.verified ? "✔" : "–"}</div><div class="k">Mavi tik</div></div>
        <div class="kpi"><div class="v">${isEmailConfirmed() ? "✔" : "–"}</div><div class="k">Email doğrulama</div></div>
        <div class="kpi"><div class="v">TYT</div><div class="k">Deneme: yakında</div></div>
        <div class="kpi"><div class="v">AYT</div><div class="k">Deneme: yakında</div></div>
      </div>
      <div class="divider"></div>
      <div class="lock">İstersen bir sonraki adımda “deneme sonuçları” tablosunu da ekleyebiliriz.</div>
    </div>
  `});
}

async function studentMessages(nav){
  shell({ navItems: nav, contentHTML: `
    <div class="card">
      <h2>Notlar</h2>
      <p>Öğretmen notlar görevler içinde görünecek şekilde tasarlandı (tasks.notes).</p>
      <div class="divider"></div>
      <div class="lock">Öğretmenin görev eklediğinde burada “son notlar” akışı da göstereceğiz.</div>
    </div>
  `});
}

/* ----------------- PARENT APP ----------------- */
async function parentHome(nav){
  shell({ navItems: nav, contentHTML: `
    <div class="grid2">
      <div class="card">
        <h2>Haftalık Özet</h2>
        <div class="lock">MVP: Ders talepleri ve görevler üzerinden özetlenir. (İstersen “haftalık rapor” tablosu ekleriz.)</div>
        <div class="divider"></div>
        <div class="row">
          <span class="badge warn">${esc(state.profile?.full_name || "")}</span>
          ${isEmailConfirmed() ? `<span class="badge green">Email Doğrulandı</span>` : `<span class="badge warn">Email Doğrulanmadı</span>`}
        </div>
      </div>
      <div class="card">
        <h2>Uyarılar</h2>
        <div class="lock">3 gün görev yoksa uyarı gibi kuralları bir sonraki adımda otomatikleştiririz.</div>
      </div>
    </div>
  `});
}

async function parentCatalog(nav){
  // same catalog but viewer=parent for enrollment meta (child)
  shell({ navItems: nav, contentHTML: `
    <div class="card">
      <div class="row spread">
        <div>
          <h2>Ders Kataloğu</h2>
          <p>Veli olarak ders talebi gönderirken öğrenci adını (opsiyonel) ekleyebilirsin.</p>
        </div>
        <div class="row" style="gap:8px;">
          <span class="badge ${isEmailConfirmed() ? "green" : "warn"}">${isEmailConfirmed() ? "Email doğrulandı" : "Fiyatlar kilitli"}</span>
          <button class="btn secondary" id="catalogRefresh">Yenile</button>
        </div>      </div>
      <div class="divider"></div>
      <div id="catalogList"><div class="skel" style="width:78%"></div></div>
    </div>
  `});

  const subjects = await fetchSubjects();
  const meta = state.cache.subjectsMeta || {};
  const listEl = qs("#catalogList");
  const btnRefresh = qs("#catalogRefresh");
  if(btnRefresh){
    btnRefresh.addEventListener("click", async () => {
      resetCatalogCache();
      await parentCatalog(nav);
    });
  }
  if(meta.error){
    listEl.innerHTML = `<div class="lock">Bağlantı sorunu: ${esc(meta.error.message || "bilinmiyor")}</div>`;
    return;
  } else if(meta.empty){
    listEl.innerHTML = `<div class="lock">Boş veri (RLS veya henüz eklenmedi).</div>`;
    return;
  }
  // English top by sort_order already.
  const html = subjects.map(s => {
    const isEnglish = (s.name||"").toLowerCase().includes("ingilizce") || (s.name||"").toLowerCase().includes("english");
    return `
      <div class="card" style="padding:14px; margin-bottom:12px;">
        <div class="row spread">
          <div class="row" style="gap:10px;">
            <div style="font-weight:900">${esc(s.name)}</div>
            <span class="badge">${levelLabel(s.level)}</span>
            ${isEnglish ? `<span class="badge blue">Öncelikli</span>` : ``}
          </div>
          <button class="btn secondary" data-open="${esc(s.id)}">Detay</button>
        </div>
        <div class="footer-note">Fiyatlar: ${isEmailConfirmed() ? "açık" : "kilitli (email doğrula)"}</div>
      </div>
    `;
  }).join("");

  qs("#catalogList").innerHTML = html || `<div class="lock">Ders yok.</div>`;

  qsa("[data-open]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await openSubjectDetailModal(btn.getAttribute("data-open"), "parent");
    });
  });
}

async function parentMy(nav){
  shell({ navItems: nav, contentHTML: `
    <div class="card">
      <h2>Takip</h2>
      <div id="myEnrolls"><div class="skel" style="width:72%"></div></div>
    </div>
  `});
  // same as student my but display child meta if exists
  const { data: enrolls, error } = await sb
    .from("enrollments")
    .select("id,status,created_at, subject_id, meta")
    .eq("user_profile_id", state.profile.id)
    .order("created_at", { ascending: false });

  logSupabase("enrollments.select.parent", { data: enrolls, error });
  if(error) return toast("error","Alınamadı: " + friendlyPostgrestError(error));

  const subjects = await fetchSubjects();
  const subjMap = new Map(subjects.map(s=>[s.id, s]));
  const rows = (enrolls||[]).map(e => `
    <tr>
      <td>
        <b>${esc(subjMap.get(e.subject_id)?.name || "Ders")}</b>
        <div><small>${esc(levelLabel(subjMap.get(e.subject_id)?.level || ""))}</small></div>
        ${e.meta?.child_name ? `<div class="badge warn" style="margin-top:6px;">Öğrenci: ${esc(e.meta.child_name)}</div>` : ``}
      </td>
      <td>${esc(e.status)}</td>
      <td><small>${new Date(e.created_at).toLocaleDateString("tr-TR")}</small></td>
      <td><button class="btn secondary" data-open-en="${esc(e.id)}">Görevler</button></td>
    </tr>
  `).join("");

  qs("#myEnrolls").innerHTML = `
    <table class="table">
      <thead><tr><th>Ders</th><th>Durum</th><th>Tarih</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4">' + renderEmptyState("Henüz hiç ders talebin yok. Kataloğa göz at!") + '</td></tr>'}</tbody>
    </table>
  `;

  qsa("[data-open-en]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-open-en");
      // veli sadece parent_visible olanları görsün istiyorsan RLS/filtre gerekir. MVP: hepsini gösterir.
      await openEnrollmentTasksModal(id, "parent");
    });
  });
}

async function parentReports(nav){
  shell({ navItems: nav, contentHTML: `
    <div class="card">
      <h2>Rapor</h2>
      <div class="lock">MVP: Raporlar “görev tamamlanma + son notlar” üzerinden özetlenir.</div>
    </div>
  `});
}
async function parentNotes(nav){
  shell({ navItems: nav, contentHTML: `
    <div class="card">
      <h2>Öğretmen Notları</h2>
      <div class="lock">Öğretmen notları görev notlarında görünür.</div>
    </div>
  `});
}

/* ----------------- TEACHER APP ----------------- */
async function teacherHome(nav){
  shell({ navItems: nav, contentHTML: `
    <div class="card">
      <h2>Öğretmen Paneli</h2>
      <p>Derslerini seç, kayıtlı öğrencileri gör, görev ekle, kısa not bırak.</p>
      <div class="divider"></div>
      <div class="row">
        <span class="badge green">${esc(state.profile?.full_name || "")}</span>
        <span class="badge">Role: ${esc(state.profile?.role)}</span>
      </div>
    </div>
  `});
}

async function teacherSubjects(nav){
  shell({ navItems: nav, contentHTML: `
    <div class="grid2">
      <div class="card">
        <h2>Derslerim</h2>
        <div id="teacherSubs"><div class="skel" style="width:60%"></div></div>
      </div>
      <div class="card">
        <h2>Ders Detayı</h2>
        <div id="teacherDetail" class="lock">Soldan bir ders seç.</div>
      </div>
    </div>
  `});

  const { data: links, error } = await sb
    .from("teacher_subjects")
    .select("subject_id")
    .eq("teacher_profile_id", state.profile.id);
  logSupabase("teacher_subjects.select.teacher", { data: links, error });

  if(error) return toast("error","Dersler alınamadı: " + friendlyPostgrestError(error));

  const subjects = await fetchSubjects();
  const subjMap = new Map(subjects.map(s=>[s.id, s]));
  const ids = (links||[]).map(l=>l.subject_id);
  const list = ids.map(id => {
    const s = subjMap.get(id);
    if(!s) return "";
    return `
      <div class="row spread" style="padding:10px 0; border-bottom:1px solid var(--line);">
        <div>
          <div style="font-weight:900">${esc(s.name)}</div>
          <small>${esc(levelLabel(s.level))}</small>
        </div>
        <button class="btn secondary" data-tsel="${esc(s.id)}">Aç</button>
      </div>
    `;
  }).join("");

  qs("#teacherSubs").innerHTML = list || `<div class="lock">Henüz ders atanmamış. Admin’den ders atanmalı.</div>`;

  qsa("[data-tsel]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const subject_id = btn.getAttribute("data-tsel");
      await renderTeacherSubjectDetail(subject_id);
    });
  });
}

async function renderTeacherSubjectDetail(subject_id){
  // show enrollments for this subject
  const { data: enrolls, error } = await sb
    .from("enrollments")
    .select("id,status,created_at,user_profile_id,meta")
    .eq("subject_id", subject_id)
    .order("created_at", { ascending:false });

  logSupabase("enrollments.select.teacher.detail", { data: enrolls, error });
  if(error) return toast("error","Kayıtlar alınamadı: " + friendlyPostgrestError(error));

  const userIds = [...new Set((enrolls||[]).map(e=>e.user_profile_id))];
  let profs = [];
  if(userIds.length){
    const r = await sb.from("profiles").select("id,full_name,role").in("id", userIds);
    logSupabase("profiles.select.byIds", { data: r.data, error: r.error });
    profs = r.data || [];
  }
  const pMap = new Map(profs.map(p=>[p.id,p]));

  const rows = (enrolls||[]).map(e => `
    <tr>
      <td>
        <b>${esc(pMap.get(e.user_profile_id)?.full_name || "Kullanıcı")}</b>
        <div><small>${esc(pMap.get(e.user_profile_id)?.role || "")}</small></div>
        ${e.meta?.child_name ? `<div class="badge warn" style="margin-top:6px;">Öğrenci: ${esc(e.meta.child_name)}</div>` : ``}
      </td>
      <td>${esc(e.status)}</td>
      <td><small>${new Date(e.created_at).toLocaleDateString("tr-TR")}</small></td>
      <td>
        ${e.status === "requested" ? `<button class="btn green" data-approve="${esc(e.id)}">Onayla</button>` : ``}
        <button class="btn secondary" data-taskfor="${esc(e.id)}">Görev Ekle</button>
        <button class="btn secondary" data-viewtasks="${esc(e.id)}">Görevler</button>
      </td>
    </tr>
  `).join("");

  qs("#teacherDetail").innerHTML = `
    <div class="row spread">
      <div>
        <div style="font-weight:900">Kayıtlı Öğrenciler</div>
        <small>Bu dersin altındaki kayıtlar. Ortak ders varsa diğer derste de ayrı enrollment görünür.</small>
      </div>
    </div>
    <div class="divider"></div>
    <table class="table">
      <thead><tr><th>Kullanıcı</th><th>Durum</th><th>Tarih</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="4"><div class="lock">Kayıt yok.</div></td></tr>`}</tbody>
    </table>
  `;
  applyMobileTableLabels();
  qsa("[data-approve]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const eid = btn.getAttribute("data-approve");
      const { error } = await sb.from("enrollments").update({ status: "active" }).eq("id", eid);
      logSupabase("enrollments.update.approve", { error });
      if(error) toast("error", friendlyPostgrestError(error));
      else {
        toast("success","Kayıt onaylandı.");
        await renderTeacherSubjectDetail(subject_id);
      }
    });
  });

  qsa("[data-taskfor]").forEach(btn => {
    btn.addEventListener("click", () => {
      const eid = btn.getAttribute("data-taskfor");
      openAddTaskModal(eid);
    });
  });

  qsa("[data-viewtasks]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const eid = btn.getAttribute("data-viewtasks");
      await openEnrollmentTasksModal(eid, "teacher");
    });
  });
}

function openAddTaskModal(enrollment_id){
  openModal("Görev Ekle", `
    <label>Başlık</label>
    <input class="input" id="tTitle" placeholder="Örn: Paragraf 20 soru" />
    <label>Not</label>
    <textarea class="input" id="tNotes" placeholder="Kaynak, sayfa, süre vb."></textarea>
    <label>Son Tarih</label>
    <input class="input" id="tDue" type="date" />
    <label>Görünürlük</label>
    <select id="tVis">
      <option value="student">Öğrenci</option>
      <option value="parent">Veli</option>
      <option value="both">Her ikisi</option>
    </select>
  `, `
    <button class="btn secondary" onclick="closeModal()">Vazgeç</button>
    <button class="btn" id="tSave">Kaydet</button>
  `);

  qs("#tSave")?.addEventListener("click", async () => {
    const title = qs("#tTitle").value.trim();
    const notes = qs("#tNotes").value.trim();
    const due_date = qs("#tDue").value ? new Date(qs("#tDue").value).toISOString() : null;
    const visibility = qs("#tVis").value;
    if(title.length < 3) return toast("error","Başlık çok kısa.");
    const { error } = await sb.from("tasks").insert([{
      enrollment_id, title, notes, due_date, completed:false, visibility
    }]);
    logSupabase("tasks.insert", { error });
    if(error) return toast("error","Kaydedilemedi: " + friendlyPostgrestError(error));
    toast("success","Görev eklendi.");
    closeModal();
  });
}

async function teacherReviews(nav){
  shell({ navItems: nav, contentHTML: `
    <div class="card">
      <h2>Puanlarım</h2>
      <div id="myReviews"><div class="skel" style="width:70%"></div></div>
    </div>
  `});

  const rating = await fetchTeacherRating(state.profile.id);

  const { data: reviews, error } = await sb
    .from("reviews")
    .select("rating, comment, is_anonymous, created_at, is_hidden")
    .eq("teacher_profile_id", state.profile.id)
    .eq("is_hidden", false)
    .order("created_at", { ascending:false });

  logSupabase("reviews.select.teacher", { data: reviews, error });
  if(error) return toast("error","Alınamadı: " + friendlyPostgrestError(error));

  const list = (reviews||[]).map(r => `
    <div style="padding:10px 0; border-bottom:1px solid var(--line);">
      <div class="row spread">
        <div style="font-weight:900">⭐ ${esc(r.rating)}</div>
        <small>${new Date(r.created_at).toLocaleDateString("tr-TR")}</small>
      </div>
      <div class="footer-note">${esc(r.is_anonymous ? "Anonim" : "Açık")}</div>
      <div style="margin-top:8px;">${esc(r.comment||"")}</div>
    </div>
  `).join("");

  qs("#myReviews").innerHTML = `
    <div class="row spread">
      <span class="badge">${rating.avg ? `⭐ ${rating.avg} (${rating.count})` : "Henüz puan yok"}</span>
      <span class="badge green">Öğretmen</span>
    </div>
    <div class="divider"></div>
    ${list || `<div class="lock">Henüz yorum yok.</div>`}
  `;
}

/* ----------------- ADMIN HUB ----------------- */
async function adminHome(nav){
  shell({ navItems: nav, contentHTML: `
    <div class="card">
      <div class="row spread">
        <div>
          <h2>Admin Hub</h2>
          <p>Öğretmenler, ders kataloğu, yorumlar ve PIN’li yönetim paneli burada.</p>
        </div>
        <span class="badge green">${esc(state.profile?.full_name || "")}</span>
      </div>
      <div class="divider"></div>
      <div class="kpis" id="adminKPIs">
        <div class="kpi"><div class="v">–</div><div class="k">Toplam kullanıcı</div></div>
        <div class="kpi"><div class="v">–</div><div class="k">Mavi tik</div></div>
        <div class="kpi"><div class="v">–</div><div class="k">Talep</div></div>
        <div class="kpi"><div class="v">–</div><div class="k">Yorum</div></div>
      </div>
      <div class="divider"></div>
      <div class="row">
        ${DEV_MODE ? `<button class="btn secondary" id="quickSetupBtn">Hızlı Kurulum (Ders + Paket)</button>` : `<div class="lock">Hızlı kurulum yayın ortamında devre dışıdır.</div>`}
        <span class="lock">Boş projede ders/paket yoksa bunu bir kez çalıştır.</span>
      </div>
    </div>
  `});

  qs("#quickSetupBtn")?.addEventListener("click", async () => {
    await adminQuickSetup();
    toast("success","Kurulum tamamlandı (varsa atlandı).");
    resetCatalogCache();
  });

  await fillAdminKPIs();
}

async function fillAdminKPIs(){
  const a = await sb.from("profiles").select("id,verified", { count:"exact" });
  const totalUsers = a.count || 0;
  const blue = (a.data||[]).filter(x=>x.verified).length;

  const e = await sb.from("enrollments").select("id", { count:"exact" });
  const totalEn = e.count || 0;

  const r = await sb.from("reviews").select("id", { count:"exact" });
  const totalRev = r.count || 0;

  const kpis = qs("#adminKPIs");
  if(!kpis) return;
  const cards = kpis.querySelectorAll(".kpi .v");
  if(cards.length >= 4){
    cards[0].textContent = String(totalUsers);
    cards[1].textContent = String(blue);
    cards[2].textContent = String(totalEn);
    cards[3].textContent = String(totalRev);
  }
}

async function adminCatalog(nav){
  shell({ navItems: nav, contentHTML: `
    <div class="card">
      <h2>Ders Kataloğu (Admin)</h2>
      <div class="row" style="gap:10px;">
        <button class="btn secondary" id="refreshSub">Yenile</button>
        <button class="btn" id="addSub">Ders Ekle</button>
      </div>
      <div class="divider"></div>
      <div id="adminSubList"><div class="skel" style="width:72%"></div></div>
    </div>
  `});

  qs("#refreshSub")?.addEventListener("click", async ()=>{ resetCatalogCache(); await adminCatalog(nav); });
  qs("#addSub")?.addEventListener("click", ()=> openAddSubjectModal());

  const subjects = await fetchSubjects();
  const rows = subjects.map(s => `
    <tr>
      <td><b>${esc(s.name)}</b><div><small>${esc(levelLabel(s.level))}</small></div></td>
      <td>${esc(s.sort_order ?? 999)}</td>
      <td>${s.is_active ? `<span class="badge green">Aktif</span>` : `<span class="badge warn">Kapalı</span>`}</td>
      <td>
        <button class="btn secondary" data-pkg="${esc(s.id)}">Paketler</button>
        <button class="btn secondary" data-toggle="${esc(s.id)}">${s.is_active ? "Pasif" : "Aktif"}</button>
      </td>
    </tr>
  `).join("");

  qs("#adminSubList").innerHTML = `
    <table class="table">
      <thead><tr><th>Ders</th><th>Order</th><th>Durum</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="4"><div class="lock">Ders yok.</div></td></tr>`}</tbody>
    </table>
  `;
  applyMobileTableLabels();
  qsa("[data-toggle]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-toggle");
      const s = subjects.find(x=>x.id===id);
      const { error } = await sb.from("subjects").update({ is_active: !s.is_active }).eq("id", id);
      logSupabase("subjects.update.toggle", { error });
      if(error) return toast("error","Güncellenemedi: " + friendlyPostgrestError(error));
      toast("success","Güncellendi.");
      resetCatalogCache();
      await adminCatalog(nav);
    });
  });

  qsa("[data-pkg]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-pkg");
      await openManagePackagesModal(id);
    });
  });
}

function openAddSubjectModal(){
  openModal("Ders Ekle", `
    <label>Ders Adı</label>
    <input class="input" id="sName" placeholder="Örn: Matematik" />
    <label>Kademe</label>
    <select id="sLevel">
      <option value="primary">İlköğretim</option>
      <option value="middle">Ortaöğretim</option>
      <option value="high">Lise</option>
    </select>
    <label>Sort Order (İngilizceyi öne almak için küçük değer)</label>
    <input class="input" id="sOrder" type="number" value="50" />
  `, `
    <button class="btn secondary" onclick="closeModal()">Vazgeç</button>
    <button class="btn" id="saveSub">Kaydet</button>
  `);

  qs("#saveSub")?.addEventListener("click", async () => {
    const name = qs("#sName").value.trim();
    const level = qs("#sLevel").value;
    const sort_order = parseInt(qs("#sOrder").value || "50", 10);
    if(name.length < 3) return toast("error","İsim kısa.");
    const { error } = await sb.from("subjects").insert([{ name, level, is_active:true, sort_order }]);
    logSupabase("subjects.insert", { error });
    if(error) return toast("error","Eklenemedi: " + friendlyPostgrestError(error));
    toast("success","Eklendi.");
    closeModal();
    resetCatalogCache();
    location.hash="#catalog";
    route();
  });
}

async function openManagePackagesModal(subject_id){
  const subjects = await fetchSubjects();
  const s = subjects.find(x=>x.id===subject_id);
  const packages = await fetchPackages(subject_id);

  openModal(`${esc(s?.name || "Ders")} • Paketler`, `
    <div class="lock">Fiyat kuralları: Lise 950/1350, Orta+İlk 650/950, İngilizce A1–C2 max 1000.</div>
    <div class="divider"></div>
    <div id="pkgList">
      ${packages.map(p => `
        <div class="row spread" style="padding:10px 0; border-bottom:1px solid var(--line);">
          <div>
            <div style="font-weight:900">${esc(p.title)}</div>
            <small>${esc(p.package_code)}</small>
          </div>
          <div class="row">
            <input class="input" style="width:120px" type="number" value="${esc(p.price_try)}" data-price="${esc(p.id)}"/>
            <button class="btn secondary" data-saveprice="${esc(p.id)}">Kaydet</button>
          </div>
        </div>
      `).join("") || `<div class="lock">Paket yok.</div>`}
    </div>
    <div class="divider"></div>
    <button class="btn" id="addPkgBtn">Paket Ekle</button>
  `, `
    <button class="btn secondary" onclick="closeModal()">Kapat</button>
  `);

  qs("#addPkgBtn")?.addEventListener("click", () => openAddPackageModal(subject_id, s?.level));

  qsa("[data-saveprice]", $modalBody).forEach(btn => {
    btn.addEventListener("click", async () => {
      const pid = btn.getAttribute("data-saveprice");
      const inp = qs(`[data-price="${pid}"]`, $modalBody);
      const price = parseInt(inp.value || "0", 10);
      const ok = validatePriceRule(s?.name || "", s?.level || "", price);
      if(!ok.ok) return toast("error", ok.msg);

      const { error } = await sb.from("subject_packages").update({ price_try: price }).eq("id", pid);
      logSupabase("subject_packages.update.price", { error });
      if(error) return toast("error","Güncellenemedi: " + friendlyPostgrestError(error));
      toast("success","Güncellendi.");
      state.cache.packagesBySubject.delete(subject_id);
    });
  });
}

function openAddPackageModal(subject_id, level){
  openModal("Paket Ekle", `
    <label>Başlık</label>
    <input class="input" id="pTitle" placeholder="Örn: Koç Takipli" />
    <label>Kod</label>
    <select id="pCode">
      <option value="coach">coach</option>
      <option value="plus">plus</option>
      <option value="english_level">english_level</option>
    </select>
    <label>Fiyat (₺)</label>
    <input class="input" id="pPrice" type="number" placeholder="Örn: 950" />
    <label>Meta (İngilizce seviyesi için)</label>
    <input class="input" id="pMeta" placeholder='{"level":"A1"}' />
  `, `
    <button class="btn secondary" onclick="closeModal()">Vazgeç</button>
    <button class="btn" id="pSave">Kaydet</button>
  `);

  qs("#pSave")?.addEventListener("click", async () => {
    const title = qs("#pTitle").value.trim();
    const package_code = qs("#pCode").value;
    const price_try = parseInt(qs("#pPrice").value || "0", 10);
    let meta = {};
    const metaRaw = qs("#pMeta").value.trim();
    if(metaRaw){
      try { meta = JSON.parse(metaRaw); } catch { return toast("error","Meta JSON değil."); }
    }
    if(title.length < 3) return toast("error","Başlık kısa.");

    // price rules
    const subjects = await fetchSubjects();
    const subj = subjects.find(x=>x.id===subject_id);
    const ok = validatePriceRule(subj?.name || "", subj?.level || level || "", price_try, meta);
    if(!ok.ok) return toast("error", ok.msg);

    const { error } = await sb.from("subject_packages").insert([{
      subject_id, package_code, title, price_try, meta
    }]);
    logSupabase("subject_packages.insert", { error });
    if(error) return toast("error","Eklenemedi: " + friendlyPostgrestError(error));
    toast("success","Eklendi.");
    closeModal();
    state.cache.packagesBySubject.delete(subject_id);
  });
}

function validatePriceRule(subjectName, level, price, meta={}){
  const n = (subjectName||"").toLowerCase();
  const isEnglish = n.includes("ingilizce") || n.includes("english");
  if(isEnglish){
    if(price > 1000) return { ok:false, msg:"İngilizce fiyatı en fazla 1000 olmalı." };
    // optional: enforce level ladder if meta.level exists
    const ladder = {A1:1000,A2:900,B1:800,B2:700,C1:600,C2:500};
    const lvl = (meta?.level || meta?.cefr || "").toString().toUpperCase();
    if(lvl && ladder[lvl] != null && price !== ladder[lvl]){
      return { ok:false, msg:`İngilizce ${lvl} için fiyat ${ladder[lvl]} olmalı (kademeli düşüş).` };
    }
    return { ok:true, msg:"ok" };
  }

  const isHigh = level === "high";
  const allowed = isHigh ? [950,1350] : [650,950];
  if(!allowed.includes(price)){
    return { ok:false, msg:`Bu kademede izinli fiyatlar: ${allowed.join(" / ")}.` };
  }
  return { ok:true, msg:"ok" };
}

async function adminTeachers(nav){
  shell({ navItems: nav, contentHTML: `
    <div class="grid2">
      <div class="card">
        <h2>Öğretmenler</h2>
        <div class="lock">Öğretmen rolü olan profilleri burada derslere atayacaksın.</div>
        <div class="divider"></div>
        <div id="tList"><div class="skel" style="width:62%"></div></div>
      </div>
      <div class="card">
        <h2>Atama</h2>
        <div id="tAssign" class="lock">Soldan öğretmen seç.</div>
      </div>
    </div>
  `});

  const { data: teachers, error } = await sb
    .from("profiles")
    .select("id,full_name,role")
    .in("role", ["teacher","admin"])
    .order("full_name", { ascending:true });

  logSupabase("profiles.select.teachers", { data: teachers, error });
  if(error) return toast("error","Öğretmenler alınamadı: " + friendlyPostgrestError(error));

  qs("#tList").innerHTML = teachers.map(t => `
    <div class="row spread" style="padding:10px 0; border-bottom:1px solid var(--line);">
      <div>
        <div style="font-weight:900">${esc(t.full_name)}</div>
        <small>${esc(t.role)}</small>
      </div>
      <button class="btn secondary" data-tpick="${esc(t.id)}">Seç</button>
    </div>
  `).join("") || `<div class="lock">Öğretmen yok.</div>`;

  qsa("[data-tpick]").forEach(btn => {
    btn.addEventListener("click", async () => {
      await renderTeacherAssign(btn.getAttribute("data-tpick"));
    });
  });
}

async function renderTeacherAssign(teacher_profile_id){
  const subjects = await fetchSubjects();

  const { data: links } = await sb
    .from("teacher_subjects")
    .select("id,subject_id")
    .eq("teacher_profile_id", teacher_profile_id);

  const set = new Set((links||[]).map(l=>l.subject_id));

  const items = subjects.map(s => `
    <div class="row spread" style="padding:10px 0; border-bottom:1px solid var(--line);">
      <div>
        <div style="font-weight:900">${esc(s.name)}</div>
        <small>${esc(levelLabel(s.level))}</small>
      </div>
      <button class="btn secondary" data-assign="${esc(s.id)}">${set.has(s.id) ? "Kaldır" : "Ata"}</button>
    </div>
  `).join("");

  qs("#tAssign").innerHTML = `
    <div class="row spread">
      <div style="font-weight:900">Ders Atama</div>
      <span class="badge green">Teacher</span>
    </div>
    <div class="divider"></div>
    ${items}
  `;

  qsa("[data-assign]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const subject_id = btn.getAttribute("data-assign");
      const exists = set.has(subject_id);

      if(exists){
        const link = (links||[]).find(l=>l.subject_id===subject_id);
        const { error } = await sb.from("teacher_subjects").delete().eq("id", link.id);
        logSupabase("teacher_subjects.delete", { error });
        if(error) return toast("error","Kaldırılamadı: " + friendlyPostgrestError(error));
        toast("success","Kaldırıldı.");
      } else {
        const { error } = await sb.from("teacher_subjects").insert([{ teacher_profile_id, subject_id }]);
        logSupabase("teacher_subjects.insert", { error });
        if(error) return toast("error","Atanamadı: " + friendlyPostgrestError(error));
        toast("success","Atandı.");
      }
      await renderTeacherAssign(teacher_profile_id);
    });
  });
}

async function adminReviews(nav){
  shell({ navItems: nav, contentHTML: `
    <div class="card">
      <h2>Yorum Moderasyonu</h2>
      <div id="revList"><div class="skel" style="width:70%"></div></div>
    </div>
  `});

  const { data: reviews, error } = await sb
    .from("reviews")
    .select("id, teacher_profile_id, reviewer_profile_id, rating, comment, is_anonymous, is_hidden, created_at")
    .order("created_at", { ascending:false })
    .limit(50);

  logSupabase("reviews.select.admin", { data: reviews, error });
  if(error) return toast("error","Yorumlar alınamadı: " + friendlyPostgrestError(error));

  // map teacher/reviewer names
  const ids = [...new Set((reviews||[]).flatMap(r => [r.teacher_profile_id, r.reviewer_profile_id]).filter(Boolean))];
  let profs = [];
  if(ids.length){
    const res = await sb.from("profiles").select("id,full_name").in("id", ids);
    logSupabase("profiles.select.forReviews", { data: res.data, error: res.error });
    profs = res.data || [];
  }
  const pMap = new Map(profs.map(p=>[p.id,p.full_name]));

  const rows = (reviews||[]).map(r => `
    <tr>
      <td><b>${esc(pMap.get(r.teacher_profile_id) || "Öğretmen")}</b><div><small>${new Date(r.created_at).toLocaleDateString("tr-TR")}</small></div></td>
      <td>${esc(r.rating)}</td>
      <td>${esc(r.is_anonymous ? "Anonim" : (pMap.get(r.reviewer_profile_id) || "Kullanıcı"))}</td>
      <td>${esc(r.comment||"")}</td>
      <td>
        <button class="btn secondary" data-hide="${esc(r.id)}">${r.is_hidden ? "Göster" : "Gizle"}</button>
      </td>
    </tr>
  `).join("");

  qs("#revList").innerHTML = `
    <table class="table">
      <thead><tr><th>Öğretmen</th><th>Puan</th><th>Yazan</th><th>Yorum</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5"><div class="lock">Yorum yok.</div></td></tr>`}</tbody>
    </table>
  `;
  applyMobileTableLabels();
  qsa("[data-hide]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-hide");
      const row = (reviews||[]).find(x=>x.id===id);
      const { error } = await sb.from("reviews").update({ is_hidden: !row.is_hidden }).eq("id", id);
      logSupabase("reviews.update.hide", { error });
      if(error) return toast("error","Güncellenemedi: " + friendlyPostgrestError(error));
      toast("success","Güncellendi.");
      await adminReviews(nav);
    });
  });
}
/* ----------------- ADMIN: USERS (PHONE-GATED) ----------------- */
async function ensureAdminProfileCache(force = false){
  if(!force && state.cache.profilesList) return state.cache.profilesList;
  const { data: users, error, status } = await sb
    .from("profiles")
    .select("id, full_name, role, verified, phone, created_at")
    .order("created_at", { ascending:false })
    .limit(300);
  logSupabase("profiles.select.admin.list", { data: users, error, status });
  if(error){
    policyToast(error);
    return null;
  }
  state.cache.profilesList = users || [];
  return state.cache.profilesList;
}

async function renderAdminUsers(nav){
  const users = await ensureAdminProfileCache(true);
  shell({ navItems: nav, contentHTML: `
    <div class="card">
      <div class="row spread">
        <div>
          <h2>Kullanıcılar</h2>
          <p>Telefon bilgisi sadece bu ekranda gösterilir.</p>
        </div>
        <span class="badge green"><i class="fa-solid fa-lock"></i> Admin</span>
      </div>
      <div class="divider"></div>
      <div id="adminUserTable">${renderEmptyState("Yükleniyor...")}</div>
    </div>
  `});

  if(!users){
    qs("#adminUserTable").innerHTML = `<div class="lock">Veri alınamadı.</div>`;
    return;
  }

  const rows = users.map(u => `
    <tr>
      <td><b>${esc(u.full_name)}</b><div><small>${esc(u.id)}</small></div></td>
      <td>${esc(u.role)}</td>
      <td>${u.verified ? `<span class="badge blue">✔</span>` : `–`}</td>
      <td>${esc(u.phone || "—")}</td>
      <td>${new Date(u.created_at).toLocaleDateString("tr-TR")}</td>
    </tr>
  `).join("");

  qs("#adminUserTable").innerHTML = `
    <table class="table">
      <thead><tr><th>Kullanıcı</th><th>Rol</th><th>Onay</th><th><i class="fa-solid fa-lock"></i> Telefon</th><th>Tarih</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5"><div class="lock">Kayıt bulunamadı.</div></td></tr>`}</tbody>
    </table>
    <div class="admin-phone-note"><i class="fa-solid fa-lock"></i> Bu bilgi sadece admin tarafından görülebilir</div>
  `;
  applyMobileTableLabels();
}

/* ----------------- ADMIN: PROFILE DETAIL ----------------- */
async function renderAdminProfile(nav){
  let users = await ensureAdminProfileCache();
  if(!users){
    users = [];
  }
  shell({ navItems: nav, contentHTML: `
    <div class="card">
      <div class="row spread">
        <div>
          <h2>Profil Detayı</h2>
          <p>Tüm rol bilgilerini tek ekranda görüntüle. Telefon sadece burada gösterilir.</p>
        </div>
        <span class="badge green"><i class="fa-solid fa-lock"></i> Admin</span>
      </div>
      <div class="divider"></div>
      <div class="grid2">
        <div>
          <label>Kullanıcı seç</label>
          <select id="adminProfileSelect">${users.map(u=>`<option value="${esc(u.id)}">${esc(u.full_name)} (${esc(u.role)})</option>`).join("")}</select>
        </div>
      </div>
      <div class="divider"></div>
      <div id="adminProfileDetail">${renderEmptyState("Profil seçiniz")}</div>
    </div>
  `});

  const select = qs("#adminProfileSelect");
  const detailBox = qs("#adminProfileDetail");
  async function draw(profileId){
    if(!profileId){
      detailBox.innerHTML = renderEmptyState("Profil seçiniz");
      return;
    }
    detailBox.innerHTML = `<div class="skel" style="width:60%"></div>`;
    const selected = (users || []).find(u=>u.id===profileId);
    const detail = await loadAnyProfileDetails(profileId, selected?.role);
    if(!detail){
      detailBox.innerHTML = `<div class="lock">Profil okunamadı.</div>`;
      return;
    }
    const core = detail.core;
    const phoneHtml = `<div class="admin-phone">
      <i class="fa-solid fa-lock"></i>
      <div>
        <div class="label">Telefon</div>
        <div class="value">${esc(core.phone || "—")}</div>
        <small>Bu bilgi sadece admin tarafından görülebilir</small>
      </div>
    </div>`;
    let roleHtml = `<div class="lock">Henüz profil bilgisi girilmedi</div>`;
    if(core.role === "student"){
      const s = detail.student || {};
      roleHtml = `
        <div class="grid2">
          <div><label>Sınıf</label><div class="pill">${esc(s.class_level || "—")}</div></div>
          <div><label>Hedef Sınav</label><div class="pill">${esc(s.target_exam || "—")}</div></div>
        </div>
        <div class="grid2">
          <div><label>Hedef Bölüm</label><div class="pill">${esc(s.target_major || "—")}</div></div>
          <div><label>Şehir</label><div class="pill">${esc(s.city || "—")}</div></div>
        </div>
        <div><label>Hakkında</label><div class="pill">${esc(s.about || "—")}</div></div>
      `;
    } else if(core.role === "parent"){
      const p = detail.parent || {};
      const kids = (detail.children || []).map(ch => `<div class="pill">${esc(ch.student.full_name || "Öğrenci")} • ${esc(ch.relation || "")}</div>`).join("") || `<div class="lock">Henüz profil bilgisi girilmedi</div>`;
      roleHtml = `
        <div class="grid2">
          <div><label>İletişim</label><div class="pill">${esc(p.preferred_contact || "—")}</div></div>
          <div><label>Hakkında</label><div class="pill">${esc(p.about || "—")}</div></div>
        </div>
        <div><label>Bağlı öğrenciler</label><div class="pill-row">${kids}</div></div>
      `;
    } else if(core.role === "teacher"){
      const t = detail.teacher || {};
      roleHtml = `
        <div class="grid2">
          <div><label>Şehir</label><div class="pill">${esc(t.city || "—")}</div></div>
          <div><label>Deneyim yılı</label><div class="pill">${esc(t.experience_years || "—")}</div></div>
        </div>
        <div><label>Format</label><div class="pill">${esc(t.lesson_format || "—")}</div></div>
        <div><label>Bio</label><div class="pill">${esc(t.bio || "—")}</div></div>
      `;
    }

    detailBox.innerHTML = `
      <div class="profile-summary">
        <div>
          <div class="title">${esc(core.full_name || "")}</div>
          <div class="muted">${esc(core.role)}</div>
        </div>
        ${phoneHtml}
      </div>
      <div class="divider"></div>
      ${roleHtml}
    `;
  }
  select?.addEventListener("change", e => draw(e.target.value));
  if(select && select.value) draw(select.value);
}

/* ----------------- ADMIN: PARENT/STUDENT LINKING ----------------- */
async function renderAdminLinking(nav){
  shell({ navItems: nav, contentHTML: `
    <div class="card">
      <div class="row spread">
        <div>
          <h2>Veli–Öğrenci Eşleştirme</h2>
          <p>Bağla / kaldır işlemleri yalnızca admin tarafından yapılır.</p>
        </div>
        <span class="badge green"><i class="fa-solid fa-lock"></i> Admin</span>
      </div>
      <div class="divider"></div>
      <div class="grid3">
        <div>
          <label>Veli</label>
          <select id="linkParent"></select>
        </div>
        <div>
          <label>Öğrenci</label>
          <select id="linkStudent"></select>
        </div>
        <div>
          <label>İlişki</label>
          <input class="input" id="linkRelation" placeholder="Anne/Baba vb." />
        </div>
      </div>
      <div class="row end" style="margin-top:12px;">
        <button class="btn" id="btnLink">Bağla</button>
      </div>
      <div class="divider"></div>
      <div id="linkList"></div>
    </div>
  `});

  const parentSel = qs("#linkParent");
  const studentSel = qs("#linkStudent");
  const linkList = qs("#linkList");

  const { data: parents } = await sb.from("profiles").select("id, full_name").eq("role","parent").order("full_name");
  const { data: students } = await sb.from("profiles").select("id, full_name").eq("role","student").order("full_name");
  parentSel.innerHTML = (parents||[]).map(p=>`<option value="${esc(p.id)}">${esc(p.full_name)}</option>`).join("");
  studentSel.innerHTML = (students||[]).map(s=>`<option value="${esc(s.id)}">${esc(s.full_name)}</option>`).join("");

  async function loadLinks(){
    const { data: links, error } = await sb.from("parent_students").select("id, parent_profile_id, student_profile_id, relation");
    logSupabase("parent_students.list", { data: links, error });
    if(error){
      policyToast(error);
      linkList.innerHTML = `<div class="lock">${esc(friendlyPostgrestError(error))}</div>`;
      return;
    }
    if(!links?.length){
      linkList.innerHTML = renderEmptyState("Henüz profil bilgisi girilmedi");
      return;
    }
    linkList.innerHTML = links.map(l => {
      const p = (parents||[]).find(x=>x.id===l.parent_profile_id);
      const s = (students||[]).find(x=>x.id===l.student_profile_id);
      return `
        <div class="linked-item">
          <div>
            <div class="title">${esc(p?.full_name || "Veli")}</div>
            <small>${esc(s?.full_name || "Öğrenci")} • ${esc(l.relation || "ilişki yok")}</small>
          </div>
          <button class="btn secondary" data-unlink="${esc(l.id)}">Kaldır</button>
        </div>
      `;
    }).join("");

    qsa("[data-unlink]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-unlink");
        const { error: delErr } = await sb.from("parent_students").delete().eq("id", id);
        logSupabase("parent_students.delete", { error: delErr });
        if(delErr) return toast("error", friendlyPostgrestError(delErr));
        toast("success","Bağlantı kaldırıldı.");
        loadLinks();
      });
    });
  }

  qs("#btnLink")?.addEventListener("click", async () => {
    const parent_profile_id = parentSel.value;
    const student_profile_id = studentSel.value;
    const relation = qs("#linkRelation").value.trim();
    if(!parent_profile_id || !student_profile_id) return toast("error","Veli ve öğrenci seçin.");
    const { error } = await sb.from("parent_students").insert([{ parent_profile_id, student_profile_id, relation }]);
    logSupabase("parent_students.insert", { error });
    if(error) return toast("error", friendlyPostgrestError(error));
    toast("success","Bağlantı eklendi.");
    qs("#linkRelation").value = "";
    loadLinks();
  });

  loadLinks();
}
async function adminPanel(nav){
  await renderAdminPanelInside(nav);
}

async function renderAdminPanelInside(nav){
  shell({ navItems: nav, contentHTML: `
    <div class="grid2">
      <div class="card">
      ${DEV_MODE ? `<button class="btn" id="btnAddUserModal">Manuel Üye Ekle</button>` : `<div class="lock">Manuel üye ekleme prod'da kapalı.</div>`}
        <h2>Kullanıcı Yönetimi</h2>
        <div id="userList"><div class="skel" style="width:70%"></div></div>
      </div>
      <div class="card">
        <h2>Site Bilgileri</h2>
        <div class="lock">Toplam kullanıcı, doğrulama, talepler ve yorumlar.</div>
        <div class="divider"></div>

        <div class="kpis" id="siteKPIs">
          <div class="kpi"><div class="v">–</div><div class="k">Kullanıcı</div></div>
          <div class="kpi"><div class="v">–</div><div class="k">Mavi tik</div></div>
          <div class="kpi"><div class="v">–</div><div class="k">Talep</div></div>
          <div class="kpi"><div class="v">–</div><div class="k">Yorum</div></div>
        </div>
      </div>
    </div>
  `});

  await fillAdminKPIs();
  // mirror KPIs in panel box too
  const kpis = qs("#siteKPIs");
  const hub = qs("#adminKPIs");
  if(kpis && hub){
    const hv = hub.querySelectorAll(".kpi .v");
    const pv = kpis.querySelectorAll(".kpi .v");
    for(let i=0;i<Math.min(hv.length, pv.length); i++) pv[i].textContent = hv[i].textContent;
  }

  // users list
  const { data: users, error } = await sb
    .from("profiles")
    .select("id,full_name,role,verified,created_at")
    .order("created_at", { ascending:false })
    .limit(80);

  logSupabase("profiles.select.admin", { data: users, error });
  if(error) return toast("error","Kullanıcılar alınamadı: " + friendlyPostgrestError(error));

  const rows = users.map(u => `
    <tr>
      <td>
        <b>${esc(u.full_name)}</b>
        <div><small>${esc(u.id)}</small></div>
      </td>
      <td>${esc(u.role)}</td>
      <td>${u.verified ? `<span class="badge blue">✔ Mavi Tik</span>` : `<span class="badge">–</span>`}</td>
      <td><small>${new Date(u.created_at).toLocaleDateString("tr-TR")}</small></td>
      <td>
        <button class="btn secondary" data-verify="${esc(u.id)}">${u.verified ? "Tik Kaldır" : "Tik Ver"}</button>
      </td>
    </tr>
  `).join("");

  qs("#userList").innerHTML = `
    <table class="table">
      <thead><tr><th>Kullanıcı</th><th>Rol</th><th>Onay</th><th>Tarih</th><th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="5"><div class="lock">Kullanıcı yok.</div></td></tr>`}</tbody>
    </table>
  `;
  applyMobileTableLabels();

  qsa("[data-verify]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-verify");
      const u = users.find(x=>x.id===id);
      const { error } = await sb.from("profiles").update({ verified: !u.verified }).eq("id", id);
      logSupabase("profiles.update.verify", { error });
      if(error) return toast("error","Güncellenemedi: " + friendlyPostgrestError(error));
      toast("success","Güncellendi.");
      await renderAdminPanelInside(nav);
    });
  });
  // --- MANUEL ÜYE EKLEME (Admin İçin) ---
  const btnAddUser = qs("#btnAddUserModal");
  if(btnAddUser) {
    btnAddUser.addEventListener("click", () => {
      if(!DEV_MODE){
        toast("warn","Manuel üye ekleme prod'da kapalı.");
        return;
      }
      openModal("Manuel Kullanıcı Oluştur", `
        <div class="lock" style="color:var(--warn); margin-bottom:15px;">
          ⚠️ <b>DİKKAT:</b> Tarayıcı tabanlı sistemlerde, yeni bir kullanıcı oluşturduğunda Supabase otomatik olarak o kullanıcının oturumunu açar. 
          Bu işlemi yapınca <b>Admin hesabından çıkış yapılmış olacak</b> ve yeni öğrenci olarak giriş yapmış olacaksın. 
          Tekrar Admin girmek için çıkış yapman gerekir.
        </div>
        <label>Rol Seç</label>
        <select id="newUserRole">
          <option value="student">Öğrenci</option>
          <option value="parent">Veli</option>
        </select>
        <label>Ad Soyad</label>
        <input class="input" id="newUserName" placeholder="Ad Soyad" />
        <label>Email</label>
        <input class="input" id="newUserEmail" placeholder="Email" />
        <label>Şifre</label>
        <input class="input" id="newUserPass" type="text" value="12345678" />
      `, `
        <button class="btn secondary" onclick="closeModal()">İptal</button>
        <button class="btn" id="btnCreateUser">Oluştur</button>
      `);

      setTimeout(() => {
        qs("#btnCreateUser")?.addEventListener("click", async () => {
          if(!DEV_MODE){
            toast("warn","Manuel kullanıcı oluşturma yayın ortamında kapalı.");
            closeModal();
            return;
          }
          const role = qs("#newUserRole").value;
          const full_name = qs("#newUserName").value;
          const email = qs("#newUserEmail").value;
          const password = qs("#newUserPass").value;
          const safeRole = ["student","parent"].includes(role) ? role : "student";
          const { data, error } = await sb.auth.signUp({
            email, password,
            options: { data: { full_name } }
          });

          logSupabase("auth.signUp.admin", { data, error });
          if(error) return toast("error", friendlyPostgrestError(error));

          // Profil tablosuna da yaz
          if(data.user){
             await sb.from("profiles").insert([{ 
               id: data.user.id, 
               role: safeRole, 
               full_name: full_name, 
               verified: true // Biz ekledik, onaylı olsun
             }]);
          }

          toast("success", "Kullanıcı oluşturuldu! (Oturum yeni kullanıcıya geçti)");
          closeModal();
          location.reload(); // Sayfayı yenile ki yeni oturumla açılsın
        });
      }, 100);
    });
  }
}

/* ----------------- QUICK SETUP ----------------- */
async function adminQuickSetup(){
  if(!DEV_MODE) {
  toast("info","Hızlı kurulum yayında kapalı.");
  return;
}
  // Check if subjects exist
  const { data: existing, error } = await sb.from("subjects").select("id").limit(1);
  logSupabase("subjects.check", { data: existing, error });
  if(error) return toast("error","Kontrol hatası: " + friendlyPostgrestError(error));
  if(existing && existing.length) return; // already set

  const subjects = buildDefaultSubjects();
  const { data: inserted, error: e2 } = await sb
    .from("subjects")
    .insert(subjects)
    .select("id,name,level");

  logSupabase("subjects.insert.default", { data: inserted, error: e2 });
  if(e2) return toast("error","Ders eklenemedi: " + friendlyPostgrestError(e2));

  // packages
  const pkgs = [];
  for(const s of inserted){
    const isEnglish = (s.name||"").toLowerCase().includes("ingilizce") || (s.name||"").toLowerCase().includes("english");
    if(isEnglish){
      const ladder = [
        ["A1",1000],["A2",900],["B1",800],["B2",700],["C1",600],["C2",500]
      ];
      for(const [lvl, price] of ladder){
        pkgs.push({
          subject_id: s.id,
          package_code: "english_level",
          title: `İngilizce ${lvl} (Koç Takipli)`,
          price_try: price,
          meta: { level: lvl }
        });
      }
    } else {
      const isHigh = s.level === "high";
      pkgs.push({
        subject_id: s.id,
        package_code: "coach",
        title: "Koç Takipli",
        price_try: isHigh ? 950 : 650,
        meta: {}
      });
      pkgs.push({
        subject_id: s.id,
        package_code: "plus",
        title: "Yoğun / Plus",
        price_try: isHigh ? 1350 : 950,
        meta: {}
      });
    }
  }

  const { error: e3 } = await sb.from("subject_packages").insert(pkgs);
  logSupabase("subject_packages.insert.default", { error: e3 });
  if(e3) return toast("error","Paket eklenemedi: " + friendlyPostgrestError(e3));
}

function buildDefaultSubjects(){
  // İngilizceyi öne almak için sort_order küçük
  const common = [
    { name:"İngilizce", sort_order: 1 },
    { name:"Matematik", sort_order: 10 },
    { name:"Türkçe", sort_order: 11 },
    { name:"Fen Bilimleri", sort_order: 12 },
    { name:"Sosyal Bilgiler", sort_order: 13 },
    { name:"Geometri", sort_order: 14 },
    { name:"Fizik", sort_order: 15 },
    { name:"Kimya", sort_order: 16 },
    { name:"Biyoloji", sort_order: 17 },
    { name:"Tarih", sort_order: 18 },
    { name:"Coğrafya", sort_order: 19 },
    { name:"Edebiyat", sort_order: 20 },
    { name:"Felsefe", sort_order: 21 },
    { name:"Din Kültürü", sort_order: 22 },
    { name:"Rehberlik / Koçluk", sort_order: 23 }
  ];
  const levels = ["primary","middle","high"];
  const rows = [];
  for(const lvl of levels){
    for(const c of common){
      rows.push({
        name: `${c.name} (${levelLabel(lvl)})`,
        level: lvl,
        is_active: true,
        sort_order: c.sort_order
      });
    }
  }
  return rows;
}
/* --- YENİ EKLENEN FONKSİYON: TÜM KAYITLARI LİSTELE --- */
async function adminEnrollments(nav){
  shell({ navItems: nav, contentHTML: `
    <div class="card">
      <div class="row spread">
        <div>
          <h2>Öğrenci Kayıt Defteri</h2>
          <p>Sisteme gelen tüm ders talepleri ve onaylı kayıtlar.</p>
        </div>
        <button class="btn secondary" id="refreshEnrolls">Yenile</button>
      </div>
      <div class="divider"></div>
      
      <div class="grid3" style="margin-bottom:15px;">
        <div>
          <label>Durum Filtresi</label>
          <select id="filterStatus">
            <option value="all">Tümü</option>
            <option value="requested">Talep (Onay Bekleyen)</option>
            <option value="active">Aktif (Onaylı)</option>
          </select>
        </div>
        <div>
           <label>Arama</label>
           <input class="input" id="searchEnroll" placeholder="Öğrenci adı ara..." />
        </div>
      </div>

      <div id="enrollList"><div class="skel" style="width:80%"></div></div>
    </div>
  `});

  const listEl = qs("#enrollList");
  
  // Verileri Çekelim
  async function loadData(){
    listEl.innerHTML = `<div class="skel" style="width:80%"></div>`;
    
    // 1. Kayıtları Çek
    const { data: enrolls, error } = await sb
      .from("enrollments")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);
    logSupabase("enrollments.select.admin", { data: enrolls, error });

    if(error) return listEl.innerHTML = `<div class="lock">Hata: ${esc(friendlyPostgrestError(error))}</div>`;
    if(!enrolls.length) return listEl.innerHTML = `<div class="lock">Hiç kayıt bulunamadı.</div>`;

    // 2. İlişkili Verileri (Öğrenci Adı, Ders Adı) Çek
    const userIds = [...new Set(enrolls.map(e => e.user_profile_id))];
    const subjectIds = [...new Set(enrolls.map(e => e.subject_id))];

    // Profilleri al
    const { data: profiles } = await sb.from("profiles").select("id, full_name, role").in("id", userIds);
    const pMap = new Map((profiles||[]).map(p => [p.id, p]));

    // Dersleri al
    const { data: subjects } = await sb.from("subjects").select("id, name, level").in("id", subjectIds);
    const sMap = new Map((subjects||[]).map(s => [s.id, s]));

    renderTable(enrolls, pMap, sMap);
  }

  // Tabloyu Çiz
  function renderTable(enrolls, pMap, sMap){
    const statusFilter = qs("#filterStatus").value;
    const search = qs("#searchEnroll").value.toLowerCase();

    const filtered = enrolls.filter(e => {
      const p = pMap.get(e.user_profile_id);
      const name = (p?.full_name || "").toLowerCase();
      
      const statusMatch = (statusFilter === "all") || (e.status === statusFilter);
      const searchMatch = !search || name.includes(search);
      
      return statusMatch && searchMatch;
    });

    const rows = filtered.map(e => {
      const p = pMap.get(e.user_profile_id);
      const s = sMap.get(e.subject_id);
      const date = new Date(e.created_at).toLocaleDateString("tr-TR");

      // Durum rengi
      let badgeClass = "secondary";
      let statusText = "Bilinmiyor";
      if(e.status === "requested") { badgeClass = "warn"; statusText = "Talep Edildi"; }
      if(e.status === "active") { badgeClass = "green"; statusText = "Aktif"; }

      return `
        <tr>
          <td>
            <b>${esc(p?.full_name || "Silinmiş Üye")}</b>
            <div><small>${esc(p?.role || "-")}</small></div>
            ${e.meta?.child_name ? `<div class="badge warn" style="font-size:10px">Öğrenci: ${esc(e.meta.child_name)}</div>` : ""}
          </td>
          <td>
            <b>${esc(s?.name || "Silinmiş Ders")}</b>
            <div><small>${esc(s?.level || "")}</small></div>
          </td>
          <td><span class="badge ${badgeClass}">${statusText}</span></td>
          <td>${date}</td>
          <td>
            ${e.status === 'requested' 
              ? `<button class="btn green" data-approve-en="${e.id}">Onayla</button>` 
              : `<button class="btn secondary" data-cancel-en="${e.id}">İptal</button>`}
          </td>
        </tr>
      `;
    }).join("");

    listEl.innerHTML = `
      <table class="table">
        <thead><tr><th>Öğrenci / Veli</th><th>Ders</th><th>Durum</th><th>Tarih</th><th>İşlem</th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5"><div class="lock">Kriterlere uygun kayıt yok.</div></td></tr>`}</tbody>
      </table>
    `;
    applyMobileTableLabels();

    qsa("[data-approve-en]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-approve-en");
        const { error } = await sb.from("enrollments").update({ status: "active" }).eq("id", id);
        logSupabase("enrollments.update.admin.approve", { error });
        if(error) toast("error", friendlyPostgrestError(error));
        else { toast("success", "Kayıt onaylandı!"); loadData(); }
      });
    });

    qsa("[data-cancel-en]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-cancel-en");
        if(!confirm("Bu kaydı iptal etmek/silmek istediğine emin misin?")) return;
        const { error } = await sb.from("enrollments").delete().eq("id", id);
        logSupabase("enrollments.delete.admin", { error });
        if(error) toast("error", friendlyPostgrestError(error));
        else { toast("success", "Kayıt silindi."); loadData(); }
      });
    });
  }

  // Eventler
  qs("#refreshEnrolls")?.addEventListener("click", loadData);
  qs("#filterStatus")?.addEventListener("change", loadData);
  qs("#searchEnroll")?.addEventListener("input", loadData);
  
  // İlk yükleme
  loadData();
}
/* ----------------- NAV: default hash ----------------- */
if(typeof location !== "undefined" && !location.hash) location.hash = "#home";
/* --- YENİ EKLENTİ: Modern Boş Durum Tasarımı --- */
function renderEmptyState(message = "Veri bulunamadı") {
  return `
    <div style="text-align:center; padding:30px 20px; color:var(--muted); border:1px dashed var(--line); border-radius:14px; background:rgba(17,27,40,0.3);">
      <i class="fa-regular fa-folder-open" style="font-size:32px; margin-bottom:10px; opacity:0.5; display:inline-block;"></i>
      <div style="font-size:14px;">${esc(message)}</div>
    </div>
  `;
}