// app.js
/*  Supabase tabloları (beklenen):
    profiles(id, role, full_name, created_at, verified, public_name_pref)
    subjects(id, name, level, is_active, sort_order)
    subject_packages(id, subject_id, package_code, title, price_try, meta)
    teachers(id, profile_id, bio, photo_url)
    teacher_subjects(id, teacher_profile_id, subject_id)
    enrollments(id, user_profile_id, subject_id, package_id, status, created_at, meta)
    tasks(id, enrollment_id, title, notes, due_date, completed, visibility)
    reviews(id, teacher_profile_id, reviewer_profile_id, rating, comment, is_anonymous, is_hidden, created_at)

   RLS notu (özet): admin her şeyi görür; teacher sadece kendi teacher_subjects -> enrollments/tasks;
   student/parent sadece kendi enrollments/tasks; reviews insert sadece verified=true.
*/

const SUPABASE_URL = "https://vgszhwqpyzzcxlczuedl.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZnc3pod3FweXp6Y3hsY3p1ZWRsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjYwMDE4NjEsImV4cCI6MjA4MTU3Nzg2MX0.XNTCzfWBJR4WY6S3KxcitO9JaTYD53PnYJwM2v46yGE";
const ADMIN_PANEL_PIN = "1234"; // sadece ekstra kapı, asıl güvenlik RLS + admin role.

const supabaseConfigOk = Boolean(SUPABASE_URL) && Boolean(SUPABASE_ANON_KEY);
if(!window.supabase){
  alert("Supabase kütüphanesi yüklenemedi (CDN engeli/ağ). Adblock varsa kapatıp yenile.");
}
if(!supabaseConfigOk){
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

const state = {
  roleChoice: localStorage.getItem("roleChoice") || "", // "student" | "parent" | "admin"
  session: null,
  user: null,
  profile: null,
  view: "home",
  params: {},
  cache: {
    subjects: null,
    subjectsMeta: { error:null, empty:false },
    packagesBySubject: new Map(),
    teacherSubjects: null,
      },
  debugOpen: false,
  lastError: "",
  };
ensureDebugPanel();


init();

async function init(){
  if(!sb){
    $app.innerHTML = `<div class="container"><div class="card"><h2>Supabase bağlantısı yok</h2><p>CDN veya anahtar eksik. İnternetini ve anahtarları kontrol et.</p></div></div>`;
    return;
  }
  const { data } = await sb.auth.getSession();
  state.session = data.session || null;
  state.user = state.session?.user || null;

  // router
  window.addEventListener("hashchange", route);
  sb.auth.onAuthStateChange(async (_event, session) => {
    state.session = session;
    state.user = session?.user || null;
    state.profile = null;
    await route();
  });

  await route();
}

function setRoleChoice(role){
  state.roleChoice = role;
  localStorage.setItem("roleChoice", role);
}

function clearRoleChoice(){
  state.roleChoice = "";
  localStorage.removeItem("roleChoice");
}

function isEmailConfirmed(){
  // Supabase user: email_confirmed_at
  return !!state.user?.email_confirmed_at;
}

function toast(type, msg){
  const wrap = document.getElementById("toasts");
  const t = document.createElement("div");
  t.className = `toast ${type || ""}`.trim();
  let text = msg;
  if((msg||"").includes("Failed to fetch")){
    text = `${msg} (ağ/SSL ya da CORS engeli olabilir)`;
  }
  t.textContent = text;
  wrap.appendChild(t);
  wrap.appendChild(t);
  setTimeout(() => t.remove(), 3600);
  if(type === "error" || type === "warn"){
    setLastError(text);
  }
}

function openModal(title, bodyHTML, footHTML){
  $modalTitle.textContent = title || "İşlem";
  $modalBody.innerHTML = bodyHTML || "";
  $modalFoot.innerHTML = footHTML || "";
  $backdrop.classList.remove("hidden");
  $modal.classList.remove("hidden");
}
function closeModal(){
  $backdrop.classList.add("hidden");
  $modal.classList.add("hidden");
  $modalTitle.textContent = "";
  $modalBody.innerHTML = "";
  $modalFoot.innerHTML = "";
}
$backdrop.addEventListener("click", closeModal);

function qs(sel, root=document){ return root ? root.querySelector(sel) : null; }
function qsa(sel, root=document){
  if(!root || !root.querySelectorAll) return [];
  return Array.from(root.querySelectorAll(sel));
}
function esc(s){ return (s ?? "").toString().replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':"&quot;","'":"&#039;"}[m])); }
function ensureDebugPanel(){
  if(qs("#debugPanel")) return;
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
  document.body.appendChild(box);

  const chip = document.createElement("button");
  chip.id = "debugChip";
  chip.className = "debug-chip";
  chip.textContent = "Debug";
  chip.addEventListener("click", () => {
    state.debugOpen = !state.debugOpen;
    updateDebugPanel();
  });
  document.body.appendChild(chip);

  box.querySelector("#debugToggle").addEventListener("click", () => {
    state.debugOpen = false;
    updateDebugPanel();
  });
}

function setLastError(msg){
  state.lastError = msg || "";
  updateDebugPanel();
}

function updateDebugPanel(){
  const box = qs("#debugPanel");
  if(!box) return;
  const body = qs("#debugBody", box);
  const subjectsCount = state.cache.subjects?.length || 0;
  const packagesCount = Array.from(state.cache.packagesBySubject.values()).reduce((sum, arr)=> sum + (arr?.length||0),0);
  body.innerHTML = `
    <div><b>Session:</b> ${state.session ? "var" : "yok"}</div>
    <div><b>User:</b> ${esc(state.user?.id || "-")} • ${esc(state.user?.email || "")}</div>
    <div><b>Email doğrulandı:</b> ${isEmailConfirmed() ? "evet" : "hayır"}</div>
    <div><b>Son hata:</b> ${esc(state.lastError || "-")}</div>
    <div><b>Ders/Paket:</b> ${subjectsCount} / ${packagesCount}</div>
    <div><b>Subjects meta:</b> ${state.cache.subjectsMeta?.error ? "hata" : state.cache.subjectsMeta?.empty ? "boş" : "ok"}</div>
  `;

  if(state.roleChoice === "admin") state.debugOpen = true;
  box.classList.toggle("hidden", !state.debugOpen);
}

function setBodyRoleClass(){
  document.body.classList.remove("role-student","role-parent","role-admin");
  if(state.roleChoice === "student") document.body.classList.add("role-student");
  if(state.roleChoice === "parent") document.body.classList.add("role-parent");
  if(state.roleChoice === "admin") document.body.classList.add("role-admin");
}

function activeHash(){
  const h = location.hash.replace("#","").trim();
  if(!h) return "home";
  return h;
}

async function route(){
  setBodyRoleClass();
  const h = activeHash();
  if(state.roleChoice === "admin") state.debugOpen = true;
  updateDebugPanel();

  if(!state.roleChoice){
    renderRoleSelect();
    return;
  }

  // Role seçildi ama login yoksa auth
  if(!state.user){
    renderAuth(state.roleChoice);
    return;
  }

  // profile yükle
  await ensureProfileLoaded();

  // Role kilidi: seçilen role ile profil role uyuşmalı (admin seçildiyse teacher/admin kabul)
  const pRole = state.profile?.role || "";
  if(state.roleChoice === "student" && pRole !== "student"){
    renderRoleMismatch("Bu hesap öğrenci değil. Doğru rol ile giriş yapman gerekiyor.");
    return;
  }
  if(state.roleChoice === "parent" && pRole !== "parent"){
    renderRoleMismatch("Bu hesap veli değil. Doğru rol ile giriş yapman gerekiyor.");
    return;
  }
  if(state.roleChoice === "admin" && !(pRole === "admin" || pRole === "teacher")){
    renderRoleMismatch("Bu hesap admin/öğretmen değil.");
    return;
  }

  // View
  if(state.roleChoice === "student"){
    renderStudentApp(h);
    return;
  }
  if(state.roleChoice === "parent"){
    renderParentApp(h);
    return;
  }
  if(state.roleChoice === "admin"){
    if(pRole === "teacher") renderTeacherApp(h);
    else renderAdminHub(h);
    return;
  }
}

/* ----------------- PROFILE ----------------- */
async function ensureProfileLoaded(){
  if(state.profile) return;

  // profiles row get
  const { data: prof, error } = await sb
    .from("profiles")
    .select("*")
    .eq("id", state.user.id)
    .maybeSingle();

  if(error){
    toast("error", "Profil okunamadı: " + error.message);
    state.profile = null;
    return;
  }

  if(prof){
    state.profile = prof;
    updateDebugPanel();
    return;
  }

  // create profile on first login for student/parent flows only
  // admin/teacher profiles should be created by admin, but if missing we create minimal role from roleChoice
  const role = (state.roleChoice === "admin") ? "teacher" : state.roleChoice;
  const full_name = state.user.user_metadata?.full_name || state.user.email?.split("@")[0] || "Kullanıcı";

  const { data: ins, error: e2 } = await sb
    .from("profiles")
    .insert([{ id: state.user.id, role, full_name, verified: false, public_name_pref: "anonymous" }])
    .select("*")
    .single();

  if(e2){
    toast("error", "Profil oluşturulamadı: " + e2.message);
    state.profile = null;
    return;
  }
  state.profile = ins;
  updateDebugPanel();
}

/* ----------------- UI: SHELL ----------------- */
function shell({ titleRight="", navItems=[] , contentHTML="" }){
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
          <span class="badge ${state.roleChoice === "admin" ? "green" : state.roleChoice === "parent" ? "warn" : "blue"}">
            ${state.roleChoice === "student" ? "Öğrenci" : state.roleChoice === "parent" ? "Veli" : (state.profile?.role === "admin" ? "Admin" : "Öğretmen")}
          </span>
        </div>
        <div class="nav">
          ${navHTML}
          <button class="btn secondary" id="logoutBtn">Çıkış</button>
        </div>
      </div>
      <div class="main">
        ${contentHTML}
      </div>
      <div class="footer-note">
        <div>Fiyatlar: yalnızca <b>email doğrulaması</b> tamamlandıktan sonra görünür. Rol seçimi: çıkış yapmadan değişmez.</div>
      </div>
    </div>
  `;

  qs("#logoutBtn").addEventListener("click", async () => {
    await safeSignOut();
  });
}

/* ----------------- ROLE SELECT ----------------- */
function renderRoleSelect(){
  document.body.classList.remove("role-student","role-parent","role-admin");
  $app.innerHTML = `
    <div class="container">
      <div class="card">
        <div class="row spread">
          <div>
            <div class="brand"><span class="dot"></span><span>KoçTakip</span></div>
            <p style="margin:10px 0 0;">Tek site, üç ayrı dünya: Öğrenci, Veli, Yönetim. Rolünü seç, içerisi ona göre şekillensin.</p>
          </div>
          <span class="badge blue">Supabase</span>
        </div>
        <div class="divider"></div>
        <div class="role-select">
          <div class="role-card" id="chooseStudent">
            <div class="t">Öğrenci</div>
            <div class="d">Günlük plan, ilerleme grafiği, deneme kayıtları, derslere kayıt ve öğretmen notları.</div>
            <div style="margin-top:12px" class="badge blue">Odak: gelişim + takip</div>
          </div>
          <div class="role-card" id="chooseParent">
            <div class="t">Veli</div>
            <div class="d">Haftalık özet, uyarılar, öğretmen notları ve çocuğun ders sürecini sade bir panelde gör.</div>
            <div style="margin-top:12px" class="badge warn">Odak: şeffaf rapor</div>
          </div>
          <div class="role-card small" id="chooseAdmin">
            <div class="t">Admin / Öğretmen</div>
            <div class="d">Öğretmen panelleri ve yalnız admin için PIN’li yönetim.</div>
            <div style="margin-top:12px" class="badge green">Odak: yönetim</div>
          </div>
        </div>
        <div class="footer-note">
          Not: Rol seçimi <b>çıkış yapana kadar</b> kilitli kalır.
        </div>
      </div>
    </div>
  `;
  qs("#chooseStudent").addEventListener("click", () => { setRoleChoice("student"); location.hash="#home"; route(); });
  qs("#chooseParent").addEventListener("click", () => { setRoleChoice("parent"); location.hash="#home"; route(); });
  qs("#chooseAdmin").addEventListener("click", () => { setRoleChoice("admin"); location.hash="#home"; route(); });
}

/* ----------------- AUTH ----------------- */
function renderAuth(role){
  const roleName = role === "student" ? "Öğrenci" : role === "parent" ? "Veli" : "Admin / Öğretmen";
  const accentBadge = role === "student" ? "blue" : role === "parent" ? "warn" : "green";

  const canSignup = (role === "student" || role === "parent");

  $app.innerHTML = `
    <div class="container">
      <div class="card">
        <div class="row spread">
          <div class="brand"><span class="dot"></span><span>KoçTakip</span></div>
          <span class="badge ${accentBadge}">${roleName} Girişi</span>
        </div>

        <div class="grid2" style="margin-top:14px;">
          <div class="card">
            <h2>${esc(roleName)} Giriş</h2>
            <label>Email</label>
            <input class="input" id="loginEmail" placeholder="ornek@mail.com" />
            <label>Şifre</label>
            <input class="input" id="loginPass" type="password" placeholder="En az 8 karakter" />
            <div class="row" style="margin-top:12px;">
              <button class="btn" id="loginBtn">Giriş Yap</button>
              <button class="btn secondary" id="forgotBtn">Şifre Sıfırla</button>
            </div>
            <div class="divider"></div>
            <div class="lock">
              Fiyatlar ve kayıt işlemleri için email doğrulaması gerekir.
            </div>
          </div>

          <div class="card">
            ${canSignup ? `
              <h2>Kayıt Ol</h2>
              <label>Ad Soyad</label>
              <input class="input" id="suName" placeholder="Ad Soyad" />
              <label>Email</label>
              <input class="input" id="suEmail" placeholder="ornek@mail.com" />
              <label>Şifre</label>
              <input class="input" id="suPass" type="password" placeholder="En az 8 karakter" />
              <div class="row" style="margin-top:12px;">
                <button class="btn" id="signupBtn">Kayıt Ol</button>
              </div>
              <div class="footer-note">
                Kayıt sonrası emailine doğrulama linki gider. Doğrulamadan fiyatlar açılmaz.
              </div>
            ` : `
              <h2>Kayıt Kapalı</h2>
              <p>Admin/Öğretmen hesapları sadece yönetim tarafından oluşturulur.</p>
              <div class="lock">Yetkili değilsen çıkış yapıp doğru rol seç.</div>
            `}
          </div>
        </div>

        <div class="footer-note">
          Rol: <b>${esc(roleName)}</b> seçili. (Rol değiştirmek için çıkış yapman gerekir.)
        </div>
      </div>
    </div>
  `;

  qs("#loginBtn").addEventListener("click", () => doLogin());
  qs("#forgotBtn").addEventListener("click", () => doForgot());

  if(canSignup){
    qs("#signupBtn").addEventListener("click", () => doSignup(role));
  }

  async function doLogin(){
    const email = qs("#loginEmail").value.trim();
    const password = qs("#loginPass").value;
    if(!validEmail(email)) return toast("error","Geçerli bir email gir.");
    if(password.length < 8) return toast("error","Şifre en az 8 karakter olmalı.");

    const { error } = await sb.auth.signInWithPassword({ email, password });
    if(error) return toast("error", "Giriş başarısız: " + error.message);
    toast("success","Giriş başarılı.");
    location.hash = "#home";
  }

  async function doForgot(){
    const email = qs("#loginEmail").value.trim();
    if(!validEmail(email)) return toast("error","Şifre sıfırlamak için geçerli email gir.");
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin });
    if(error) return toast("error", "Hata: " + error.message);
    toast("success","Şifre sıfırlama maili gönderildi.");
  }

  async function doSignup(role){
    const full_name = qs("#suName").value.trim();
    const email = qs("#suEmail").value.trim();
    const password = qs("#suPass").value;
    
    if(full_name.length < 3) return toast("error","Ad soyad gir.");
    if(!validEmail(email)) return toast("error","Geçerli bir email gir.");
    if(password.length < 8) return toast("error","Şifre en az 8 karakter olmalı.");
    if(error) return toast("error","Kayıt başarısız: " + error.message);
    const { data, error } = await sb.auth.signUp({
  email,
  password,
  options: {
    data: { full_name },
    emailRedirectTo: window.location.origin
  }
});
    if(error) return toast("error","Kayıt başarısız: " + error.message);

    // profiles insert (role)
    // user id hemen oluşur; bazı projelerde null gelebilir, o zaman login sonrası ensureProfile oluşturur.
    const uid = data?.user?.id;
    if(uid){
      const { error: e2 } = await sb.from("profiles").insert([{
        id: uid,
        role,
        full_name,
        verified: false,
        public_name_pref: "anonymous"
      }]);
      // RLS engeli varsa sorun değil, ensureProfileLoaded toparlar
      if(e2) console.warn("profile insert warn:", e2.message);
    }

    toast("success","Kayıt alındı. Email doğrulama linkini kontrol et.");
  }
}
async function safeSignOut(){
  clearRoleChoice();
  if(!sb){
    state.session = null;
    state.user = null;
    state.profile = null;
    location.hash = "";
    return;
  }
  try{
    const { error: refreshError } = await sb.auth.refreshSession();
    if(refreshError && refreshError.message && refreshError.message.includes("Failed to fetch")){
      toast("warn","Bağlantı zayıf: refresh başarısız (çıkış zorlanıyor).");
    }
    let { error } = await sb.auth.signOut({ scope: "global" });
    if(error && (error.status === 403 || /token/i.test(error.message || ""))){
      const alt = await sb.auth.signOut({ scope: "local" });
      if(alt.error){
        toast("warn", "Yerel oturum kapatma uyarısı: " + alt.error.message);
      }
    } else if(error){
      toast("error","Çıkış hatası: " + error.message);
    }
  } catch(err){
    const msg = err?.message || String(err);
    toast("error","Çıkış tamamlanamadı: " + msg);
  }

  // sb local storage anahtarı temizle
  const ref = (SUPABASE_URL.split("https://")[1] || "").split(".")[0];
  const key = `sb-${ref}-auth-token`;
  localStorage.removeItem(key);
  localStorage.removeItem(`${key}-global`);

  state.session = null;
  state.user = null;
  state.profile = null;
  state.cache = { subjects:null, subjectsMeta:{error:null, empty:false}, packagesBySubject:new Map(), teacherSubjects:null };
  location.hash = "";
  toast("success", "Çıkış yapıldı.");
  updateDebugPanel();
}
function renderRoleMismatch(msg){
  shell({
    navItems: [{hash:"home", label:"Durum"}],
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
function renderStudentApp(hash){
  const nav = [
    {hash:"home", label:"Panel"},
    {hash:"catalog", label:"Dersler"},
    {hash:"my", label:"Derslerim"},
    {hash:"progress", label:"İlerleme"},
    {hash:"messages", label:"Notlar"}
  ];

  if(hash === "catalog") return studentCatalog(nav);
  if(hash === "my") return studentMySubjects(nav);
  if(hash === "progress") return studentProgress(nav);
  if(hash === "messages") return studentMessages(nav);
  return studentHome(nav);
}

function renderParentApp(hash){
  const nav = [
    {hash:"home", label:"Özet"},
    {hash:"catalog", label:"Dersler"},
    {hash:"my", label:"Takip"},
    {hash:"reports", label:"Rapor"},
    {hash:"notes", label:"Notlar"}
  ];

  if(hash === "catalog") return parentCatalog(nav);
  if(hash === "my") return parentMy(nav);
  if(hash === "reports") return parentReports(nav);
  if(hash === "notes") return parentNotes(nav);
  return parentHome(nav);
}

function renderTeacherApp(hash){
  const nav = [
    {hash:"home", label:"Öğretmen Paneli"},
    {hash:"subjects", label:"Derslerim"},
    {hash:"reviews", label:"Puanlar"}
  ];
  if(hash === "subjects") return teacherSubjects(nav);
  if(hash === "reviews") return teacherReviews(nav);
  return teacherHome(nav);
}

function renderAdminHub(hash){
  const nav = [
    {hash:"home", label:"Admin Hub"},
    {hash:"teachers", label:"Öğretmenler"},
    {hash:"catalog", label:"Ders Kataloğu"},
    {hash:"reviews", label:"Yorumlar"},
    {hash:"panel", label:"Yönetim (PIN)"}
  ];

  if(hash === "teachers") return adminTeachers(nav);
  if(hash === "catalog") return adminCatalog(nav);
  if(hash === "reviews") return adminReviews(nav);
  if(hash === "panel") return adminPanel(nav);
  return adminHome(nav);
}

/* ----------------- COMMON DATA ----------------- */
async function fetchSubjects(){
  if(state.cache.subjects) return state.cache.subjects;
  state.cache.subjectsMeta = { error:null, empty:false };
  const { data, error } = await sb
    .from("subjects")
    .select("*")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  if(error){
    state.cache.subjectsMeta.error = error;
    toast("error","Dersler alınamadı: " + error.message);
    return [];
  }
  state.cache.subjects = data || [];
  state.cache.subjectsMeta.empty = !(data && data.length);
  updateDebugPanel();
  return state.cache.subjects;
}
function resetCatalogCache(){
  state.cache.subjects = null;
  state.cache.subjectsMeta = { error:null, empty:false };
  state.cache.packagesBySubject = new Map();
  updateDebugPanel();
}
async function fetchPackages(subject_id){
  if(state.cache.packagesBySubject.has(subject_id)) return state.cache.packagesBySubject.get(subject_id);

  const { data, error } = await sb
    .from("subject_packages")
    .select("*")
    .eq("subject_id", subject_id)
    .order("price_try", { ascending: true });

  if(error){
    toast("error","Paketler alınamadı: " + error.message);
    return [];
  }
  state.cache.packagesBySubject.set(subject_id, data || []);
  return data || [];
  updateDebugPanel();
  return state.cache.packagesBySubject.get(subject_id);
}

async function fetchTeacherLinksForSubject(subject_id){
  // teacher_subjects + profiles + teachers (ayrı sorgular)
  const { data: links, error } = await sb
    .from("teacher_subjects")
    .select("teacher_profile_id, subject_id")
    .eq("subject_id", subject_id);

  if(error) return [];

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

  if(error) return { avg: null, count: 0 };
  const rows = (data||[]).filter(r => !r.is_hidden);
  const count = rows.length;
  if(!count) return { avg: null, count: 0 };
  const avg = rows.reduce((s,r)=>s+(r.rating||0),0)/count;
  return { avg: Math.round(avg*10)/10, count };
}

function validEmail(email){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

  qs("#addStudyLogBtn").addEventListener("click", () => {
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
      qs("#saveStudyLog").addEventListener("click", () => {
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
  const { data: enrolls } = await sb
    .from("enrollments")
    .select("id,status,created_at")
    .eq("user_profile_id", state.profile.id);

  const active = (enrolls||[]).filter(e => e.status === "active").length;
  const req = (enrolls||[]).filter(e => e.status === "requested").length;

  // tasks
  let done = 0;
  let tasksTodayHTML = "";
  if(enrolls?.length){
    const enrollIds = enrolls.map(e=>e.id);
    const { data: tasks } = await sb
      .from("tasks")
      .select("*")
      .in("enrollment_id", enrollIds)
      .order("due_date", { ascending: true });

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
  const btnRefresh = qs("#catalogRefresh");
  if(btnRefresh){
    btnRefresh.addEventListener("click", async () => {
      resetCatalogCache();
      await studentCatalog(nav);
    });
  }

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

    qs("#catalogList").innerHTML = cards.join("") || `<div class="lock">Sonuç yok.</div>`;

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
  if(level==="primary") return "İlköğretim";
  if(level==="middle") return "Ortaöğretim";
  return "Lise";
}

async function openSubjectDetailModal(subjectId, viewer){
  const subjects = await fetchSubjects();
  const s = subjects.find(x=>x.id===subjectId);
  if(!s) return toast("error","Ders bulunamadı.");

  const teachers = await fetchTeacherLinksForSubject(subjectId);
  const packages = await fetchPackages(subjectId);

  const isEnglish = (s.name||"").toLowerCase().includes("ingilizce") || (s.name||"").toLowerCase().includes("english");

  let pkgHTML = "";
  if(!isEmailConfirmed()){
    pkgHTML = `<div class="lock">Fiyatları görmek için email doğrulaması gerekli. (Giriş yaptıysan email kutunu kontrol et.)</div>`;
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
      if(error) return toast("error","Talep gönderilemedi: " + error.message);
      toast("success","Ders talebin alındı. Admin onayı bekleniyor.");
      closeModal();
      state.cache.subjects = null;
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

async function askChildMeta(){
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
    qs("#childCancel").addEventListener("click", () => { closeModal(); resolve({}); });
    qs("#childOk").addEventListener("click", () => {
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

  if(error) return toast("error","Yorumlar alınamadı: " + error.message);

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

  qs("#sendReview").addEventListener("click", async () => {
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
    if(error) return toast("error","Gönderilemedi: " + error.message);
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

  if(error) return toast("error","Dersler alınamadı: " + error.message);

  const subjects = await fetchSubjects();
  const subjMap = new Map(subjects.map(s=>[s.id, s]));

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
      ${e.status === 'requested' 
        ? `<button class="btn green" data-approve="${esc(e.id)}">Onayla</button>` 
        : ``}
      <button class="btn secondary" data-taskfor="${esc(e.id)}">Görev Ekle</button>
      <button class="btn secondary" data-viewtasks="${esc(e.id)}">Görevler</button>
    </td>
  </tr>
`).join("");

// 2. HTML'i ekrana bas
qs("#teacherDetail").innerHTML = `
  <div class="row spread">
    <div>
      <div style="font-weight:900">Kayıtlı Öğrenciler</div>
      <small>Bu dersin altındaki kayıtlar.</small>
    </div>
  </div>
  <div class="divider"></div>
  <table class="table">
    <thead><tr><th>Kullanıcı</th><th>Durum</th><th>Tarih</th><th>İşlem</th></tr></thead>
    <tbody>${rows || `<tr><td colspan="4"><div class="lock">Kayıt yok.</div></td></tr>`}</tbody>
  </table>
`;

// 3. Listener'ları HTML basıldıktan SONRA, tırnakların DIŞINA ekle
qsa("[data-approve]").forEach(btn => {
  btn.addEventListener("click", async () => {
    const eid = btn.getAttribute("data-approve");
    const { error } = await sb.from("enrollments").update({ status: "active" }).eq("id", eid);
    if(error) toast("error", error.message);
    else {
      toast("success", "Öğrenci derse kabul edildi.");
      await renderTeacherSubjectDetail(subject_id);
    }
  });
});

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

  if(error) return toast("error","Görevler alınamadı: " + error.message);

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
      if(e2) return toast("error","Güncellenemedi: " + e2.message);
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
      <p>Öğretmen notları görevler içinde görünecek şekilde tasarlandı (tasks.notes).</p>
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

  if(error) return toast("error","Alınamadı: " + error.message);

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
      <tbody>${rows || `<tr><td colspan="4"><div class="lock">Henüz talep yok.</div></td></tr>`}</tbody>
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
      <div class="lock">MVP: Raporlar “görev tamamlanma + son notlar” üzerinden özetlenir. İstersen ayrı reports tablosu ekleriz.</div>
    </div>
  `});
}
async function parentNotes(nav){
  shell({ navItems: nav, contentHTML: `
    <div class="card">
      <h2>Öğretmen Notları</h2>
      <div class="lock">Öğretmen notları görev notlarında görünür. Bir sonraki adım: “parent_visible” filtreli akış.</div>
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

  if(error) return toast("error","Dersler alınamadı: " + error.message);

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

  if(error) return toast("error","Kayıtlar alınamadı: " + error.message);

  const userIds = [...new Set((enrolls||[]).map(e=>e.user_profile_id))];
  let profs = [];
  if(userIds.length){
    const r = await sb.from("profiles").select("id,full_name,role").in("id", userIds);
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
        <button class="btn secondary" data-taskfor="${esc(e.id)}">Görev Ekle</button>
        <button class="btn secondary" data-viewtasks="${esc(e.id)}">Görevler</button>
      </td>
    </tr>
    qsa("[data-approve]").forEach(btn => {
  btn.addEventListener("click", async () => {
    const eid = btn.getAttribute("data-approve");
    const { error } = await sb.from("enrollments").update({ status: "active" }).eq("id", eid);
    if(error) toast("error", error.message);
    else {
      toast("success", "Öğrenci derse kabul edildi.");
      // Listeyi yenilemek için fonksiyonu tekrar çağır
      await renderTeacherSubjectDetail(subject_id);
    }
  });
});
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

  qsa("[data-taskfor]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const enrollment_id = btn.getAttribute("data-taskfor");
      await openCreateTaskModal(enrollment_id);
    });
  });

  qsa("[data-viewtasks]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const enrollment_id = btn.getAttribute("data-viewtasks");
      await openEnrollmentTasksModal(enrollment_id, "teacher");
    });
  });
}

async function openCreateTaskModal(enrollment_id){
  openModal("Görev Ekle", `
    <label>Başlık</label>
    <input class="input" id="tTitle" placeholder="Örn: Problem seti 10 soru" />
    <label>Not</label>
    <textarea class="input" id="tNotes" placeholder="Örn: İşlem hatası için birim kontrolü..."></textarea>
    <label>Teslim Tarihi</label>
    <input class="input" id="tDue" type="date" />
    <label>Görünürlük</label>
    <select id="tVis">
      <option value="student_only">Sadece öğrenci</option>
      <option value="parent_visible">Veli de görsün</option>
    </select>
  `, `
    <button class="btn secondary" onclick="closeModal()">Vazgeç</button>
    <button class="btn" id="tSave">Kaydet</button>
  `);

  qs("#tSave").addEventListener("click", async () => {
    const title = qs("#tTitle").value.trim();
    const notes = qs("#tNotes").value.trim();
    const due_date = qs("#tDue").value ? new Date(qs("#tDue").value).toISOString() : null;
    const visibility = qs("#tVis").value;
    if(title.length < 3) return toast("error","Başlık çok kısa.");
    const { error } = await sb.from("tasks").insert([{
      enrollment_id, title, notes, due_date, completed:false, visibility
    }]);
    if(error) return toast("error","Kaydedilemedi: " + error.message);
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

  if(error) return toast("error","Alınamadı: " + error.message);

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
        <button class="btn secondary" id="quickSetupBtn">Hızlı Kurulum (Ders + Paket)</button>
        <span class="lock">Boş projede ders/paket yoksa bunu bir kez çalıştır.</span>
      </div>
    </div>
  `});

  qs("#quickSetupBtn").addEventListener("click", async () => {
    await adminQuickSetup();
    toast("success","Kurulum tamamlandı (varsa atlandı).");
    state.cache.subjects = null;
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

  qs("#refreshSub").addEventListener("click", async ()=>{ state.cache.subjects=null; await adminCatalog(nav); });
  qs("#addSub").addEventListener("click", ()=> openAddSubjectModal());

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

  qsa("[data-toggle]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-toggle");
      const s = subjects.find(x=>x.id===id);
      const { error } = await sb.from("subjects").update({ is_active: !s.is_active }).eq("id", id);
      if(error) return toast("error","Güncellenemedi: " + error.message);
      toast("success","Güncellendi.");
      state.cache.subjects = null;
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

  qs("#saveSub").addEventListener("click", async () => {
    const name = qs("#sName").value.trim();
    const level = qs("#sLevel").value;
    const sort_order = parseInt(qs("#sOrder").value || "50", 10);
    if(name.length < 3) return toast("error","İsim kısa.");
    const { error } = await sb.from("subjects").insert([{ name, level, is_active:true, sort_order }]);
    if(error) return toast("error","Eklenemedi: " + error.message);
    toast("success","Eklendi.");
    closeModal();
    state.cache.subjects = null;
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

  qs("#addPkgBtn").addEventListener("click", () => openAddPackageModal(subject_id, s?.level));

  qsa("[data-saveprice]", $modalBody).forEach(btn => {
    btn.addEventListener("click", async () => {
      const pid = btn.getAttribute("data-saveprice");
      const inp = qs(`[data-price="${pid}"]`, $modalBody);
      const price = parseInt(inp.value || "0", 10);
      const ok = validatePriceRule(s?.name || "", s?.level || "", price);
      if(!ok.ok) return toast("error", ok.msg);

      const { error } = await sb.from("subject_packages").update({ price_try: price }).eq("id", pid);
      if(error) return toast("error","Güncellenemedi: " + error.message);
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
    <input class="input" id="pMeta" placeholder='Örn: {"level":"A1"}' />
  `, `
    <button class="btn secondary" onclick="closeModal()">Vazgeç</button>
    <button class="btn" id="pSave">Kaydet</button>
  `);

  qs("#pSave").addEventListener("click", async () => {
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
    if(error) return toast("error","Eklenemedi: " + error.message);
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

  if(error) return toast("error","Öğretmenler alınamadı: " + error.message);

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
        if(error) return toast("error","Kaldırılamadı: " + error.message);
        toast("success","Kaldırıldı.");
      } else {
        const { error } = await sb.from("teacher_subjects").insert([{ teacher_profile_id, subject_id }]);
        if(error) return toast("error","Atanamadı: " + error.message);
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

  if(error) return toast("error","Yorumlar alınamadı: " + error.message);

  // map teacher/reviewer names
  const ids = [...new Set((reviews||[]).flatMap(r => [r.teacher_profile_id, r.reviewer_profile_id]).filter(Boolean))];
  let profs = [];
  if(ids.length){
    const res = await sb.from("profiles").select("id,full_name").in("id", ids);
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

  qsa("[data-hide]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-hide");
      const row = (reviews||[]).find(x=>x.id===id);
      const { error } = await sb.from("reviews").update({ is_hidden: !row.is_hidden }).eq("id", id);
      if(error) return toast("error","Güncellenemedi: " + error.message);
      toast("success","Güncellendi.");
      await adminReviews(nav);
    });
  });
}

async function adminPanel(nav){
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
  // PIN gate
  openModal("PIN Girişi", `
    <label>Yönetim Paneli PIN</label>
    <input class="input" id="pinIn" type="password" placeholder="PIN" />
    <div class="footer-note">Bu PIN sadece ekstra kapı. Asıl güvenlik: admin role + RLS.</div>
  `, `
    <button class="btn secondary" onclick="closeModal()">Vazgeç</button>
    <button class="btn" id="pinOk">Aç</button>
  `);

  qs("#pinOk").addEventListener("click", async () => {
    const pin = qs("#pinIn").value.trim();
    if(pin !== ADMIN_PANEL_PIN) return toast("error","PIN yanlış.");
    closeModal();
    await renderAdminPanelInside(nav);
  });

  // Keep shell on page
  shell({ navItems: nav, contentHTML: `
    <div class="card">
      <h2>Yönetim Paneli</h2>
      <div class="lock">Açmak için PIN girmen gerekiyor (modal açıldı).</div>
    </div>
  `});
}

async function renderAdminPanelInside(nav){
  shell({ navItems: nav, contentHTML: `
    <div class="grid2">
      <div class="card">
        <h2>Kullanıcı Yönetimi</h2>
        <div id="userList"><div class="skel" style="width:70%"></div></div>
      </div>
      <div class="card">
        <h2>Site Bilgileri</h2>
        <div class="lock">Bu alanda toplam kullanıcı, doğrulama, talepler ve yorumlar görünür.</div>
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

  if(error) return toast("error","Kullanıcılar alınamadı: " + error.message);

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

  qsa("[data-verify]").forEach(btn => {
    btn.addEventListener("click", async () => {
      const id = btn.getAttribute("data-verify");
      const u = users.find(x=>x.id===id);
      const { error } = await sb.from("profiles").update({ verified: !u.verified }).eq("id", id);
      if(error) return toast("error","Güncellenemedi: " + error.message);
      toast("success","Güncellendi.");
      await renderAdminPanelInside(nav);
    });
  });
}

/* ----------------- QUICK SETUP ----------------- */
async function adminQuickSetup(){
  // Check if subjects exist
  const { data: existing, error } = await sb.from("subjects").select("id").limit(1);
  if(error) return toast("error","Kontrol hatası: " + error.message);
  if(existing && existing.length) return; // already set

  const subjects = buildDefaultSubjects();
  const { data: inserted, error: e2 } = await sb
    .from("subjects")
    .insert(subjects)
    .select("id,name,level");

  if(e2) return toast("error","Ders eklenemedi: " + e2.message);

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
  if(e3) return toast("error","Paket eklenemedi: " + e3.message);
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

/* ----------------- NAV: default hash ----------------- */
if(typeof location !== "undefined" && !location.hash) location.hash = "#home";
