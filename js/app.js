// =========================================================
// منطق التطبيق الكامل
// =========================================================

const state = {
  session: null,      // { role: 'admin'|'store', data: {...} }
  stores: [],
  orders: [],
  complaints: [],
  announcements: [],
  apiSettings: {},
  productsDraft: [],  // منتجات مؤقتة أثناء تعديل/إضافة متجر (لوحة الأدمن)
  editingStoreId: null,
  ordersFilter: "all",
  waPollTimer: null,  // مؤقت فحص حالة ربط واتساب (لوحة المتجر)
  adminWaPollTimer: null, // مؤقت تحديث شارات الربط بلوحة الأدمن
  products: [],        // منتجات متجر التاجر الحالي (تبويب المنتجات)
  productsFilter: "all",
  productCategoryFilter: "",
  editingProductId: null,
  aiPool: [],           // مفاتيح الذكاء الاصطناعي الاحتياطية (لوحة الأدمن فقط)
  channelGlobalSettings: [], // إعداد كل قناة العام (لوحة الأدمن): [{channel, visibility, status}]
  channelOverrides: [],      // استثناءات لمتاجر محددة (لوحة الأدمن): [{store_id, channel, visibility, status}]
  channelOverrideModalChannel: null, // القناة المفتوح لها مودال الاستثناءات حاليًا
  channelEffective: {},      // الحالة الفعلية لكل قناة لمتجر التاجر الحالي بعد دمج العام+الاستثناء
};

// ---------------------------------------------------------
// أدوات مساعدة عامة
// ---------------------------------------------------------
function $(sel, root = document) { return root.querySelector(sel); }
function $all(sel, root = document) { return [...root.querySelectorAll(sel)]; }

function toast(msg, kind = "") {
  const host = $("#toast-host");
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

function fmtTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("ar-IQ", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// تنسيق سنة/شهر/يوم فقط (يُستخدم بجدول الطلبات والطباعة حسب الطلب)
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}/${m}/${day}`;
}

// تنسيق السعر مع الخصم بين قوسين إن وُجد
function fmtPrice(unitPrice, discountPercent) {
  if (unitPrice === null || unitPrice === undefined || unitPrice === "") return "—";
  const price = Number(unitPrice).toLocaleString("ar-IQ");
  if (discountPercent && Number(discountPercent) > 0) {
    return `${price} (خصم ${Number(discountPercent)}%)`;
  }
  return price;
}

// مكان الطلب: يجمع بين نوع القناة والاسم الفعلي المخزّن وقت الطلب
const CHANNEL_LABELS = { whatsapp: "واتساب", messenger: "ماسنجر", instagram: "انستغرام" };
function fmtOrderPlace(order) {
  const label = CHANNEL_LABELS[order.type] || order.type || "—";
  return order.channel_name ? `${label} — ${escapeHtml(order.channel_name)}` : label;
}

function statusBadge(status) {
  const map = {
    pending: { c: "wait", t: "بالانتظار" },
    completed: { c: "ok", t: "منجز" },
    cancelled: { c: "bad", t: "ملغي" },
  };
  const s = map[status] || map.pending;
  return `<span class="badge ${s.c}">${s.t}</span>`;
}

function showScreen(id) {
  $all(".screen").forEach(s => s.classList.remove("active"));
  $(`#${id}`).classList.add("active");
}

function switchTab(prefix, tabId, navRoot) {
  $all(`#${navRoot} .nav-item`).forEach(b => b.classList.toggle("active", b.dataset.tab === tabId));
  $all(".tab-panel").forEach(p => {
    if (p.id.startsWith(`tab-${prefix}`)) p.classList.add("hidden");
  });
  $(`#tab-${tabId}`)?.classList.remove("hidden");
}

// ---------------------------------------------------------
// التحقق من صحة رقم الهاتف: يبدأ بـ 07 و 11 رقم بالضبط
// ---------------------------------------------------------
function validatePhone(phone) {
  const p = (phone || "").trim();
  if (!/^\d+$/.test(p)) return { valid: false, msg: "رقم الهاتف يجب أن يتكوّن من أرقام فقط." };
  if (!p.startsWith("07")) return { valid: false, msg: "رقم الهاتف يجب أن يبدأ بـ 07." };
  if (p.length !== 11) return { valid: false, msg: "رقم الهاتف يجب أن يتكوّن من 11 رقمًا بالضبط." };
  return { valid: true };
}

// ---------------------------------------------------------
// تسجيل الدخول
// ---------------------------------------------------------
let selectedRole = "store";

function setRole(role) {
  selectedRole = role;
  $("#role-store-btn").classList.toggle("active", role === "store");
  $("#role-admin-btn").classList.toggle("active", role === "admin");
  hideLoginAlert();
}

function showLoginAlert(msg) {
  const a = $("#login-alert");
  a.textContent = msg;
  a.classList.add("show");
}
function hideLoginAlert() { $("#login-alert").classList.remove("show"); }

$("#login-phone").addEventListener("input", () => {
  $("#login-phone").classList.remove("err");
  $("#phone-error").classList.remove("show");
});

// =========================================================
// معالج تسجيل الدخول الذكي (البحث في المتاجر ثم المشرفين)
// =========================================================
$("#login-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  
  const phoneEl = $("#login-phone");
  const passEl = $("#login-password");
  const errEl = $("#phone-error");
  const alertEl = $("#login-alert");
  const btnSubmit = $("#login-submit");

  const phone = phoneEl.value.trim();
  const password = passEl.value.trim();

  // إخفاء التنبيهات والأخطاء السابقة
  alertEl.style.display = "none";
  alertEl.textContent = "";

  // 1. التحقق من صيغة رقم الهاتف (11 رقم وبدايته 07)
  const phoneRegex = /^07\d{9}$/;
  if (!phoneRegex.test(phone)) {
    errEl.style.display = "block";
    phoneEl.focus();
    return;
  } else {
    errEl.style.display = "none";
  }

  // 2. التحقق من كتابة كلمة المرور
  if (!password) {
    alertEl.textContent = "يرجى إدخال كلمة المرور.";
    alertEl.style.display = "block";
    passEl.focus();
    return;
  }

  // تعطيل زر الدخول أثناء التحقق
  btnSubmit.disabled = true;
  btnSubmit.textContent = "جارٍ التحقق...";

  try {
    // --- Step 1: البحث في جدول أصحاب المتاجر (stores) أولاً ---
    const stores = await SB.select("stores", `phone=eq.${encodeURIComponent(phone)}`);
    
    if (stores && stores.length > 0) {
      const store = stores[0];
      
      // إذا وجد الرقم لكن كلمة المرور خاطئة
      if (store.password !== password) {
        alertEl.textContent = "كلمة المرور غير صحيحة.";
        alertEl.style.display = "block";
        btnSubmit.disabled = false;
        btnSubmit.textContent = "دخول";
        return;
      }

      // إذا كان المتجر معطلاً
      if (store.status === "suspended") {
        alertEl.textContent = "هذا الحساب معطل حالياً. يرجى مراجعة المشرف العام.";
        alertEl.style.display = "block";
        btnSubmit.disabled = false;
        btnSubmit.textContent = "دخول";
        return;
      }

      // نجاح الدخول كصاحب متجر
      state.currentUser = { ...store, role: "store" };
      sessionStorage.setItem("user", JSON.stringify(state.currentUser));
      
      await loadStoreData();
      showScreen("store");
      toast("أهلاً بك! تم تسجيل الدخول بنجاح", "ok");
      return;
    }

    // --- Step 2: إذا لم يوجد في المتاجر، يبحث في جدول المشرفين (admins) ---
    const admins = await SB.select("admins", `phone=eq.${encodeURIComponent(phone)}`);

    if (admins && admins.length > 0) {
      const admin = admins[0];

      // إذا وجد الرقم لكن كلمة المرور خاطئة
      if (admin.password !== password) {
        alertEl.textContent = "كلمة المرور غير صحيحة.";
        alertEl.style.display = "block";
        btnSubmit.disabled = false;
        btnSubmit.textContent = "دخول";
        return;
      }

      // نجاح الدخول كمشرف عام
      state.currentUser = { ...admin, role: "admin" };
      sessionStorage.setItem("user", JSON.stringify(state.currentUser));

      await loadAdminData();
      showScreen("admin");
      toast("أهلاً بك أيها المشرف العام", "ok");
      return;
    }

    // --- Step 3: إذا لم يوجد الرقم في الجدولين ---
    alertEl.textContent = "رقم الهاتف غير مسجل في النظام.";
    alertEl.style.display = "block";

  } catch (err) {
    console.error(err);
    alertEl.textContent = `حدث خطأ أثناء تسجيل الدخول: ${readableSupabaseError(err)}`;
    alertEl.style.display = "block";
  } finally {
    btnSubmit.disabled = false;
    btnSubmit.textContent = "دخول";
  }
});

function logout() {
  state.session = null;
  localStorage.removeItem("wb_session");
  stopWaPolling();
  if (state.adminWaPollTimer) { clearInterval(state.adminWaPollTimer); state.adminWaPollTimer = null; }
  $("#login-form").reset();
  showScreen("screen-login");
}
$("#admin-logout").addEventListener("click", logout);
$("#store-logout").addEventListener("click", logout);

// استعادة الجلسة عند إعادة فتح الصفحة
(async function restoreSession() {
  const raw = localStorage.getItem("wb_session");
  if (!raw) return;
  try {
    const sess = JSON.parse(raw);
    state.session = sess;
    if (sess.role === "admin") await enterAdmin();
    else await enterStore();
  } catch {
    localStorage.removeItem("wb_session");
  }
})();

// ---------------------------------------------------------
// قائمة الجوال (سايدبار) - فتح/إغلاق
// ---------------------------------------------------------
function wireMobileMenu(toggleId, sidebarId, scrimId) {
  const toggle = $(`#${toggleId}`), sidebar = $(`#${sidebarId}`), scrim = $(`#${scrimId}`);
  toggle?.addEventListener("click", () => { sidebar.classList.add("open"); scrim.classList.add("show"); });
  scrim?.addEventListener("click", () => { sidebar.classList.remove("open"); scrim.classList.remove("show"); });
  $all(`#${sidebarId} .nav-item`).forEach(b => b.addEventListener("click", () => {
    sidebar.classList.remove("open"); scrim.classList.remove("show");
  }));
}
wireMobileMenu("admin-menu-toggle", "admin-sidebar", "admin-scrim");
wireMobileMenu("store-menu-toggle", "store-sidebar", "store-scrim");

// =========================================================
// ============  قسم لوحة المشرف (Admin)  ===================
// =========================================================

async function enterAdmin() {
  showScreen("screen-admin");
  $("#admin-name-label").textContent = state.session.data.full_name || "المشرف العام";
  await loadAdminData();
  renderAdminOverview();
  renderStoresGrid();
  renderChannelsTab();
  renderApiSettingsTab();
  renderAnnouncementsTab();
  renderComplaintsTab();

  if (state.adminWaPollTimer) clearInterval(state.adminWaPollTimer);
  state.adminWaPollTimer = setInterval(refreshAdminWaBadges, 8000);
}

async function loadAdminData() {
  try {
    const [stores, orders, complaints, announcements, apiRows, aiPool, channelSettings, channelOverrides] = await Promise.all([
      SB.select("stores", "select=*&order=created_at.desc"),
      SB.select("orders", "select=*&order=created_at.desc&limit=2000"),
      SB.select("complaints", "select=*&order=created_at.desc"),
      SB.select("announcements", "select=*&order=created_at.desc"),
      SB.select("api_settings", "select=*"),
      SB.select("ai_provider_pool", "select=*&order=priority.asc"),
      SB.select("channel_global_settings", "select=*"),
      SB.select("channel_store_overrides", "select=*"),
    ]);
    state.stores = stores;
    state.orders = orders;
    state.complaints = complaints;
    state.announcements = announcements;
    state.apiSettings = {};
    apiRows.forEach(r => state.apiSettings[r.key_name] = r.key_value);
    state.aiPool = aiPool;
    state.channelGlobalSettings = channelSettings;
    state.channelOverrides = channelOverrides;
  } catch (err) {
    console.error(err);
    toast("خطأ في تحميل بيانات لوحة المشرف", "bad");
  }
}

$all(".nav-item[data-tab^='a-']").forEach(btn => {
  btn.addEventListener("click", () => switchTab("a", btn.dataset.tab, "admin-sidebar"));
});
$all("[data-goto]").forEach(btn => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.goto;
    switchTab("a", tab, "admin-sidebar");
    $all(`#admin-sidebar .nav-item`).forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  });
});

function renderAdminOverview() {
  const totalStores = state.stores.length;
  const activeStores = state.stores.filter(s => s.status === "active").length;
  const totalOrders = state.orders.length;
  const pending = state.orders.filter(o => o.status === "pending").length;
  const completed = state.orders.filter(o => o.status === "completed").length;
  const cancelled = state.orders.filter(o => o.status === "cancelled").length;

  $("#admin-stats").innerHTML = `
    <div class="stat-card palm"><div class="num">${totalStores}</div><div class="lbl">إجمالي المتاجر</div></div>
    <div class="stat-card ok"><div class="num">${activeStores}</div><div class="lbl">متاجر نشطة</div></div>
    <div class="stat-card"><div class="num">${totalOrders}</div><div class="lbl">إجمالي الطلبات</div></div>
    <div class="stat-card wait"><div class="num">${pending}</div><div class="lbl">بالانتظار</div></div>
    <div class="stat-card ok"><div class="num">${completed}</div><div class="lbl">منجزة</div></div>
    <div class="stat-card bad"><div class="num">${cancelled}</div><div class="lbl">ملغاة</div></div>
  `;

  const recent = state.stores.slice(0, 4);
  $("#admin-recent-stores").innerHTML = recent.length
    ? recent.map(storeCardHtml).join("")
    : `<div class="empty-state"><div class="glyph">▤</div><p>لا توجد متاجر مضافة بعد</p></div>`;
  wireStoreCardButtons("#admin-recent-stores");
}

function storeOrderCount(storeId) {
  return state.orders.filter(o => o.store_id === storeId).length;
}

function storeCardHtml(s) {
  const orderCount = storeOrderCount(s.id);
  return `
  <div class="store-card" data-id="${s.id}">
    <div class="top">
      <div>
        <h4>${escapeHtml(s.store_name)}</h4>
        <div class="meta">${escapeHtml(s.phone)}</div>
      </div>
      <span class="status-dot ${s.status === 'active' ? 'active' : 'suspended'}" title="${s.status === 'active' ? 'نشط' : 'موقوف'}"></span>
    </div>
    <div class="stat-line">
      <span>الطلبات: <b>${orderCount}</b></span>
      <span>البوت: <b style="font-family:var(--font-mono)">${escapeHtml(s.ai_phone || '—')}</b></span>
    </div>
    <div>
      ${s.whatsapp_connected
        ? `<span class="badge ok">مربوط واتساب${s.whatsapp_connected_number ? ' — ' + escapeHtml(s.whatsapp_connected_number) : ''}</span>`
        : `<span class="badge bad">غير مربوط واتساب</span>`}
    </div>
    <div class="actions">
      <button class="btn btn-outline btn-sm" data-edit-store="${s.id}">تعديل</button>
      <button class="btn btn-outline btn-sm" data-view-customers="${s.id}">الزبائن</button>
      <button class="btn btn-bad btn-sm" data-delete-store="${s.id}">حذف</button>
    </div>
  </div>`;
}

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderStoresGrid() {
  $("#stores-count-label").textContent = `${state.stores.length} متجر`;
  const q = ($("#store-search").value || "").trim().toLowerCase();
  const filtered = state.stores.filter(s =>
    !q || s.store_name.toLowerCase().includes(q) || (s.phone || "").includes(q)
  );
  $("#stores-grid").innerHTML = filtered.length
    ? filtered.map(storeCardHtml).join("")
    : `<div class="empty-state"><div class="glyph">▤</div><p>لا توجد نتائج مطابقة</p></div>`;
  wireStoreCardButtons("#stores-grid");
}
$("#store-search").addEventListener("input", renderStoresGrid);

function wireStoreCardButtons(scopeSel) {
  $all(`${scopeSel} [data-edit-store]`).forEach(b => b.addEventListener("click", () => openStoreModal(b.dataset.editStore)));
  $all(`${scopeSel} [data-delete-store]`).forEach(b => b.addEventListener("click", () => deleteStore(b.dataset.deleteStore)));
  $all(`${scopeSel} [data-view-customers]`).forEach(b => b.addEventListener("click", () => openCustomersModal(b.dataset.viewCustomers)));
}

// ---- إضافة / تعديل متجر ----
$("#btn-add-store").addEventListener("click", () => openStoreModal(null));

function openStoreModal(storeId) {
  state.editingStoreId = storeId;
  const modal = $("#modal-store");
  const s = storeId ? state.stores.find(x => x.id === storeId) : null;

  $("#store-modal-title").textContent = s ? "تعديل المتجر" : "إضافة متجر جديد";
  $("#f-store-name").value = s?.store_name || "";
  $("#f-full-name").value = s?.full_name || "";
  $("#f-store-phone").value = s?.phone || "";
  $("#f-store-password").value = s?.password || "";
  $("#f-ai-phone").value = s?.ai_phone || "";
  $("#f-status").value = s?.status || "active";
  $("#f-barcode").value = s?.barcode_data || s?.whatsapp_link || "";
  $("#f-notes").value = s?.notes || "";

  state.productsDraft = [];
  renderProductsDraft();
  if (s) loadStoreProducts(s.id);

  modal.classList.add("show");
}

async function loadStoreProducts(storeId) {
  try {
    const rows = await SB.select("products", `store_id=eq.${storeId}&select=*&order=created_at.asc`);
    state.productsDraft = rows;
    renderProductsDraft();
  } catch (err) { console.error(err); }
}

function renderProductsDraft() {
  const host = $("#products-list");
  if (state.productsDraft.length === 0) {
    host.innerHTML = `<div class="empty-state" style="padding:24px;"><p>لا توجد منتجات مضافة بعد</p></div>`;
    return;
  }
  host.innerHTML = state.productsDraft.map((p, i) => `
    <div class="mini-product">
      <div class="info">
        <b>${escapeHtml(p.name || "منتج بدون اسم")}</b>
        <span>${p.price ? p.price + " د.ع" : "بدون سعر"}</span>
      </div>
      <div class="row-actions">
        <button class="btn btn-outline btn-sm" data-edit-prod="${i}">تعديل</button>
        <button class="btn btn-bad btn-sm" data-del-prod="${i}">حذف</button>
      </div>
    </div>
  `).join("");
  $all("#products-list [data-edit-prod]").forEach(b => b.addEventListener("click", () => editProductRow(+b.dataset.editProd)));
  $all("#products-list [data-del-prod]").forEach(b => b.addEventListener("click", () => {
    state.productsDraft.splice(+b.dataset.delProd, 1);
    renderProductsDraft();
  }));
}

$("#btn-add-product-row").addEventListener("click", () => {
  const name = prompt("اسم المنتج:");
  if (!name) return;
  const priceStr = prompt("سعر المنتج (اختياري):", "");
  const description = prompt("وصف المنتج (اختياري):", "");
  state.productsDraft.push({ name, price: priceStr ? Number(priceStr) : null, description: description || "" });
  renderProductsDraft();
});

function editProductRow(index) {
  const p = state.productsDraft[index];
  const name = prompt("اسم المنتج:", p.name || "");
  if (name === null) return;
  const priceStr = prompt("سعر المنتج:", p.price ?? "");
  const description = prompt("وصف المنتج:", p.description || "");
  state.productsDraft[index] = { ...p, name, price: priceStr ? Number(priceStr) : null, description: description || "" };
  renderProductsDraft();
}

$all("[data-close]").forEach(b => b.addEventListener("click", () => {
  $(`#${b.dataset.close}`).classList.remove("show");
}));

$("#save-store-btn").addEventListener("click", async () => {
  const store_name = $("#f-store-name").value.trim();
  const full_name = $("#f-full-name").value.trim();
  const phone = $("#f-store-phone").value.trim();
  const password = $("#f-store-password").value;
  const ai_phone = $("#f-ai-phone").value.trim();
  const status = $("#f-status").value;
  const barcode_data = $("#f-barcode").value.trim();
  const notes = $("#f-notes").value.trim();

  const v = validatePhone(phone);
  if (!v.valid) { toast(v.msg, "bad"); return; }
  if (!store_name) { toast("الرجاء إدخال اسم المتجر.", "bad"); return; }
  if (!password) { toast("الرجاء إدخال كلمة المرور.", "bad"); return; }
  if (!ai_phone) { toast("الرجاء إدخال رقم واتساب البوت المرتبط.", "bad"); return; }

  const payload = { store_name, full_name, phone, password, ai_phone, status, barcode_data, notes };

  const btn = $("#save-store-btn");
  btn.disabled = true; btn.textContent = "جارٍ الحفظ...";

  try {
    let storeId = state.editingStoreId;
    if (storeId) {
      await SB.update("stores", `id=eq.${storeId}`, payload);
    } else {
      const created = await SB.insert("stores", payload);
      storeId = created[0].id;
    }

    // مزامنة المنتجات: نحذف القديمة (بدون id ثابت من db) ونعيد الإدخال بشكل مبسط
    const existing = await SB.select("products", `store_id=eq.${storeId}&select=id`);
    const draftIds = new Set(state.productsDraft.filter(p => p.id).map(p => p.id));
    const toDelete = existing.filter(e => !draftIds.has(e.id));
    for (const d of toDelete) {
      await SB.remove("products", `id=eq.${d.id}`);
    }
    for (const p of state.productsDraft) {
      if (p.id) {
        await SB.update("products", `id=eq.${p.id}`, { name: p.name, price: p.price, description: p.description });
      } else {
        await SB.insert("products", { store_id: storeId, name: p.name, price: p.price, description: p.description });
      }
    }

    toast("تم حفظ المتجر بنجاح", "ok");
    $("#modal-store").classList.remove("show");
    await loadAdminData();
    renderAdminOverview();
    renderStoresGrid();
    renderApiSettingsTab();
  } catch (err) {
    console.error(err);
    toast("تعذر حفظ المتجر. تحقق من رقم الهاتف (يجب أن يكون فريدًا).", "bad");
  } finally {
    btn.disabled = false; btn.textContent = "حفظ المتجر";
  }
});

async function deleteStore(id) {
  if (!confirm("هل أنت متأكد من حذف هذا المتجر؟ سيتم حذف منتجاته أيضًا.")) return;
  try {
    await SB.remove("stores", `id=eq.${id}`);
    toast("تم حذف المتجر", "ok");
    await loadAdminData();
    renderAdminOverview();
    renderStoresGrid();
  } catch (err) {
    console.error(err);
    toast("تعذر حذف المتجر", "bad");
  }
}

// ---- عرض زبائن متجر معين من لوحة الأدمن ----
function openCustomersModal(storeId) {
  const s = state.stores.find(x => x.id === storeId);
  if (!s) return;
  $("#customers-modal-title").textContent = `زبائن متجر: ${s.store_name}`;
  const rows = state.orders.filter(o => o.store_id === s.id);
  $("#admin-customers-tbody").innerHTML = rows.length ? rows.map(o => `
    <tr>
      <td>${escapeHtml(o.name || '—')}</td>
      <td>${escapeHtml(o.location || '—')}</td>
      <td style="font-family:var(--font-mono)">${escapeHtml(o.phone || '—')}</td>
      <td>${statusBadge(o.status)}</td>
      <td>${fmtTime(o.created_at)}</td>
    </tr>`).join("") : `<tr><td colspan="5" style="text-align:center;color:var(--ink-soft);padding:24px;">لا يوجد زبائن لهذا المتجر بعد</td></tr>`;
  $("#modal-store-customers").classList.add("show");
}

// ---- إعدادات API (Gemini فقط — مبسّطة بطلب المستخدم لتقليل التعقيد واحتمالية الأعطال) ----

function renderApiSettingsTab() {
  $("#gemini-api-key").value = state.apiSettings.global_gemini_api_key || "";
  $("#gemini-model").value = state.apiSettings.global_gemini_model || "gemini-3.6-flash";
  renderAiPoolTable();
}

// ---------------------------------------------------------
// مفتاح احتياطي واحد فقط (للضرورة القصوى) — Gemini حصرًا، لا OpenRouter ولا تعقيد إضافي
// ---------------------------------------------------------
function renderAiPoolTable() {
  $("#ai-pool-tbody").innerHTML = state.aiPool.length ? state.aiPool.map(p => `
    <tr>
      <td>${escapeHtml(p.label || '—')}</td>
      <td style="font-family:var(--font-mono);font-size:12.5px;">${escapeHtml(p.model || '—')}</td>
      <td>${p.enabled ? '<span class="badge ok">مفعّل</span>' : '<span class="badge wait">معطّل</span>'}</td>
      <td class="row-actions">
        <button class="btn btn-outline btn-sm" data-toggle-pool="${p.id}">${p.enabled ? 'تعطيل' : 'تفعيل'}</button>
        <button class="btn btn-bad btn-sm" data-delete-pool="${p.id}">حذف</button>
      </td>
    </tr>
  `).join("") : `<tr><td colspan="4" style="text-align:center;color:var(--ink-soft);padding:24px;">لا يوجد مفتاح احتياطي بعد</td></tr>`;

  $all("[data-toggle-pool]").forEach(b => b.addEventListener("click", async () => {
    const p = state.aiPool.find(x => x.id === b.dataset.togglePool);
    try {
      await SB.update("ai_provider_pool", `id=eq.${p.id}`, { enabled: !p.enabled });
      await loadAdminData(); renderApiSettingsTab();
    } catch (err) { console.error(err); toast("تعذر التحديث", "bad"); }
  }));

  $all("[data-delete-pool]").forEach(b => b.addEventListener("click", async () => {
    if (!confirm("حذف هذا المفتاح الاحتياطي؟")) return;
    try {
      await SB.remove("ai_provider_pool", `id=eq.${b.dataset.deletePool}`);
      toast("تم الحذف", "ok");
      await loadAdminData(); renderApiSettingsTab();
    } catch (err) { console.error(err); toast("تعذر الحذف", "bad"); }
  }));
}

$("#add-pool-key").addEventListener("click", async () => {
  const model = $("#pool-model").value.trim();
  const apiKey = $("#pool-api-key").value.trim();
  if (!model || !apiKey) { toast("الرجاء إدخال الموديل والمفتاح", "bad"); return; }

  // نكتفي بمفتاح احتياطي واحد فقط لتقليل التعقيد — إذا كان يوجد مفتاح مسبقًا نستبدله بدل الإضافة عليه
  try {
    if (state.aiPool.length > 0) {
      await SB.remove("ai_provider_pool", `id=eq.${state.aiPool[0].id}`);
    }
    await SB.insert("ai_provider_pool", {
      label: $("#pool-label").value.trim() || "احتياط",
      provider: "gemini",
      model,
      api_key: apiKey,
      priority: 0,
      enabled: true,
    });
    toast("تم حفظ المفتاح الاحتياطي", "ok");
    ["pool-label", "pool-model", "pool-api-key"].forEach(id => $(`#${id}`).value = "");
    await loadAdminData(); renderApiSettingsTab();
  } catch (err) { console.error(err); toast("تعذر إضافة المفتاح", "bad"); }
});

async function upsertApiSetting(key_name, key_value) {
  const rows = await SB.select("api_settings", `key_name=eq.${key_name}&select=id`);
  if (rows.length) {
    await SB.update("api_settings", `key_name=eq.${key_name}`, { key_value });
  } else {
    await SB.insert("api_settings", { key_name, key_value });
  }
}

$("#save-global-api").addEventListener("click", async () => {
  try {
    await upsertApiSetting("global_ai_provider", "gemini");
    await upsertApiSetting("global_gemini_api_key", $("#gemini-api-key").value.trim());
    await upsertApiSetting("global_gemini_model", $("#gemini-model").value.trim() || "gemini-3.6-flash");
    toast("تم حفظ المفتاح الأساسي", "ok");
    await loadAdminData();
  } catch (err) { console.error(err); toast("تعذر حفظ المفتاح", "bad"); }
});

// ---- الإعلانات ----
// ---------------------------------------------------------
// إدارة القنوات (لوحة الأدمن): إظهار/إخفاء وتفعيل/إغلاق كل قناة عامًا،
// مع إمكانية استثناء متاجر محددة من الإعداد العام
// ---------------------------------------------------------
function getChannelGlobalRow(channel) {
  return state.channelGlobalSettings.find(r => r.channel === channel) || { visibility: "visible", status: "enabled" };
}

// أخطاء Supabase/PostgREST تصل كنص JSON خام برسالة err.message (مثال:
// {"code":"42P01","message":"relation \"channel_global_settings\" does not exist"})
// هذه الدالة تحاول استخراج الرسالة الحقيقية بدل عرض "تعذر..." عامة لا تشرح شيئًا
function readableSupabaseError(err) {
  try {
    const parsed = JSON.parse(err.message);
    return parsed.message || parsed.hint || parsed.details || err.message;
  } catch (e) {
    return err.message || "خطأ غير معروف";
  }
}

function renderChannelsTab() {
  $("#admin-channels-list").innerHTML = ALL_CHANNELS.map(channel => {
    const g = getChannelGlobalRow(channel);
    const overridesCount = state.channelOverrides.filter(o => o.channel === channel).length;
    return `
    <div class="mini-product" style="align-items:center;flex-wrap:wrap;gap:14px;">
      <div class="info" style="min-width:110px;">
        <b>${METACHANNEL_LABELS[channel]}</b>
        <span>${overridesCount ? `${overridesCount} استثناء لمتاجر محددة` : "بدون استثناءات"}</span>
      </div>
      <div class="channel-ai-row" style="border:none;padding:0;margin:0;">
        <span>ظاهرة للتجار</span>
        <label class="switch">
          <input type="checkbox" class="channel-visibility-toggle" data-channel="${channel}" ${g.visibility !== "hidden" ? "checked" : ""}>
          <span class="slider"></span>
        </label>
      </div>
      <div class="channel-ai-row" style="border:none;padding:0;margin:0;">
        <span>مفتوحة للربط</span>
        <label class="switch">
          <input type="checkbox" class="channel-status-toggle" data-channel="${channel}" ${g.status !== "disabled" ? "checked" : ""}>
          <span class="slider"></span>
        </label>
      </div>
      <button class="btn btn-outline btn-sm" data-open-override="${channel}">استثناءات لمتاجر محددة</button>
    </div>`;
  }).join("");
}

async function upsertChannelGlobalSetting(channel, patch) {
  const exists = state.channelGlobalSettings.some(r => r.channel === channel);
  if (exists) {
    await SB.update("channel_global_settings", `channel=eq.${channel}`, { ...patch, updated_at: new Date().toISOString() });
  } else {
    await SB.insert("channel_global_settings", { channel, visibility: "visible", status: "enabled", ...patch });
  }
}

$("#admin-channels-list").addEventListener("change", async (e) => {
  const channel = e.target.dataset.channel;
  if (!channel) return;
  try {
    if (e.target.classList.contains("channel-visibility-toggle")) {
      await upsertChannelGlobalSetting(channel, { visibility: e.target.checked ? "visible" : "hidden" });
    } else if (e.target.classList.contains("channel-status-toggle")) {
      await upsertChannelGlobalSetting(channel, { status: e.target.checked ? "enabled" : "disabled" });
    } else {
      return;
    }
    await loadAdminData();
    renderChannelsTab();
    toast("تم تحديث إعداد القناة", "ok");
  } catch (err) {
    console.error(err);
    toast(`تعذر تحديث إعداد القناة: ${readableSupabaseError(err)}`, "bad");
    renderChannelsTab(); // إعادة الحالة القديمة بصريًا لأن الحفظ فشل
  }
});

$("#admin-channels-list").addEventListener("click", (e) => {
  const channel = e.target.dataset.openOverride;
  if (channel) openChannelOverrideModal(channel);
});

function openChannelOverrideModal(channel) {
  state.channelOverrideModalChannel = channel;
  $("#channel-override-title").textContent = `(${METACHANNEL_LABELS[channel]})`;
  $("#ov-store-select").innerHTML = state.stores.map(s => `<option value="${s.id}">${escapeHtml(s.store_name)}</option>`).join("");
  $("#ov-visibility-select").value = "";
  $("#ov-status-select").value = "";
  renderChannelOverrideList(channel);
  $("#modal-channel-override").classList.add("show");
}

function renderChannelOverrideList(channel) {
  const rows = state.channelOverrides.filter(o => o.channel === channel);
  $("#channel-override-list").innerHTML = rows.length ? rows.map(o => {
    const storeName = state.stores.find(s => s.id === o.store_id)?.store_name || "متجر محذوف";
    const parts = [];
    if (o.visibility) parts.push(o.visibility === "hidden" ? "مخفية" : "ظاهرة دائمًا");
    if (o.status) parts.push(o.status === "disabled" ? "مغلقة دائمًا" : "مفتوحة دائمًا");
    return `
    <div class="mini-product">
      <div class="info">
        <b>${escapeHtml(storeName)}</b>
        <span>${parts.join(" — ") || "بدون تخصيص"}</span>
      </div>
      <button class="btn btn-bad btn-sm" data-remove-override="${o.store_id}">إزالة</button>
    </div>`;
  }).join("") : `<div class="empty-state"><p>لا توجد استثناءات لهذه القناة</p></div>`;
}

// تحديث معالج حفظ الاستثناءات بجدول channel_store_overrides
$("#btn-save-override").addEventListener("click", async () => {
  const channel = state.channelOverrideModalChannel;
  const storeId = $("#ov-store-select").value;
  const visibility = $("#ov-visibility-select").value || null;
  const status = $("#ov-status-select").value || null;
  
  if (!storeId) { 
    toast("اختر متجرًا أولًا", "bad"); 
    return; 
  }
  if (!visibility && !status) { 
    toast("اختر إظهارًا أو حالة لتخصيصها، أو استخدم زر الإزالة لحذف استثناء قائم", "bad"); 
    return; 
  }

  try {
    const exists = state.channelOverrides.some(o => o.store_id === storeId && o.channel === channel);
    const payload = { 
      store_id: storeId, 
      channel: channel, 
      visibility: visibility, 
      status: status, 
      updated_at: new Date().toISOString() 
    };

    if (exists) {
      await SB.update("channel_store_overrides", `store_id=eq.${storeId}&channel=eq.${channel}`, payload);
    } else {
      await SB.insert("channel_store_overrides", payload);
    }

    await loadAdminData();
    renderChannelsTab();
    renderChannelOverrideList(channel);
    toast("تم حفظ الاستثناء بنجاح", "ok");
  } catch (err) {
    console.error(err);
    toast(`تعذر حفظ الاستثناء: ${readableSupabaseError(err)}`, "bad");
  }
});

// تحديث معالج مفتاح التفعيل والإظهار بجدول channel_global_settings
async function upsertChannelGlobalSetting(channel, patch) {
  const exists = state.channelGlobalSettings.some(r => r.channel === channel);
  const payload = { channel, visibility: "visible", status: "enabled", ...patch, updated_at: new Date().toISOString() };
  
  if (exists) {
    await SB.update("channel_global_settings", `channel=eq.${channel}`, payload);
  } else {
    await SB.insert("channel_global_settings", payload);
  }
}


$("#channel-override-list").addEventListener("click", async (e) => {
  const storeId = e.target.dataset.removeOverride;
  if (!storeId) return;
  const channel = state.channelOverrideModalChannel;
  try {
    await SB.remove("channel_store_overrides", `store_id=eq.${storeId}&channel=eq.${channel}`);
    await loadAdminData();
    renderChannelsTab();
    renderChannelOverrideList(channel);
    toast("تمت إزالة الاستثناء", "ok");
  } catch (err) {
    console.error(err);
    toast(`تعذر إزالة الاستثناء: ${readableSupabaseError(err)}`, "bad");
  }
});

function renderAnnouncementsTab() {
  const select = $("#ann-target");
  select.innerHTML = `<option value="">جميع المتاجر (عام)</option>` +
    state.stores.map(s => `<option value="${s.id}">${escapeHtml(s.store_name)}</option>`).join("");

  $("#announcements-list").innerHTML = state.announcements.length ? state.announcements.map(a => {
    const target = a.store_id ? (state.stores.find(s => s.id === a.store_id)?.store_name || "متجر محذوف") : "جميع المتاجر";
    return `
    <div class="mini-product" style="align-items:flex-start;">
      <div class="info">
        <b>${escapeHtml(a.title)} <span style="font-weight:400;color:var(--ink-soft);">— ${escapeHtml(target)}</span></b>
        <span style="font-family:var(--font-display);color:var(--ink);">${escapeHtml(a.message)}</span><br>
        <span>${fmtTime(a.created_at)}</span>
      </div>
    </div>`;
  }).join("") : `<div class="empty-state"><p>لم يتم نشر أي إعلان بعد</p></div>`;
}

$("#send-announcement").addEventListener("click", async () => {
  const title = $("#ann-title").value.trim();
  const message = $("#ann-message").value.trim();
  const store_id = $("#ann-target").value || null;
  if (!title || !message) { toast("الرجاء إدخال العنوان والنص", "bad"); return; }

  try {
    await SB.insert("announcements", { title, message, store_id });
    toast("تم نشر الإعلان", "ok");
    $("#ann-title").value = ""; $("#ann-message").value = "";
    await loadAdminData();
    renderAnnouncementsTab();
  } catch (err) { console.error(err); toast("تعذر نشر الإعلان", "bad"); }
});

// ---- الشكاوى (عرض الأدمن) ----
function renderComplaintsTab() {
  $("#complaints-tbody").innerHTML = state.complaints.length ? state.complaints.map(c => `
    <tr>
      <td>${escapeHtml(c.store_name || '—')}</td>
      <td>${escapeHtml(c.subject || '—')}</td>
      <td style="max-width:260px;">${escapeHtml(c.message)}</td>
      <td>${c.status === 'resolved' ? '<span class="badge ok">تم الحل</span>' : '<span class="badge wait">مفتوحة</span>'}</td>
      <td>${fmtTime(c.created_at)}</td>
      <td>${c.status !== 'resolved' ? `<button class="btn btn-ok btn-sm" data-resolve="${c.id}">تعليم كمحلولة</button>` : '—'}</td>
    </tr>
  `).join("") : `<tr><td colspan="6" style="text-align:center;color:var(--ink-soft);padding:24px;">لا توجد شكاوى حاليًا</td></tr>`;

  $all("[data-resolve]").forEach(b => b.addEventListener("click", async () => {
    try {
      await SB.update("complaints", `id=eq.${b.dataset.resolve}`, { status: "resolved" });
      toast("تم تحديث حالة الشكوى", "ok");
      await loadAdminData(); renderComplaintsTab();
    } catch (err) { console.error(err); toast("تعذر التحديث", "bad"); }
  }));
}

// =========================================================
// ============  قسم لوحة المتجر (Store)  ===================
// =========================================================

async function enterStore() {
  showScreen("screen-store");
  const s = state.session.data;
  $("#store-name-label").textContent = s.store_name;
  $("#store-mobile-name").textContent = s.store_name;
  $("#store-side-name").textContent = s.store_name;
  await loadStoreData();
  renderStoreOverview();
  renderStoreInfo();
  renderProductsTab();
  renderMyComplaints();
  renderStoreAnnouncementBanner();
  setChannelCardStatus("wa", "disconnected", "غير متصل");
  setChannelCardStatus("messenger", "disconnected", "غير متصل");
  setChannelCardStatus("instagram", "disconnected", "غير متصل");
  setChannelCardStatus("telegram", "disconnected", "غير متصل");
  setChannelCardStatus("tiktok", "disconnected", "غير متصل");
  refreshWaStatus();
  refreshMetaStatus();
  refreshChannelAvailability();
}

async function loadStoreData() {
  const storeId = state.session.data.id;
  try {
    const [orders, complaints, announcements, products] = await Promise.all([
      SB.select("orders", `store_id=eq.${storeId}&select=*&order=created_at.desc`),
      SB.select("complaints", `store_id=eq.${storeId}&select=*&order=created_at.desc`),
      SB.select("announcements", `store_id=eq.${storeId}&select=*&order=created_at.desc`),
      SB.select("products", `store_id=eq.${storeId}&select=*&order=created_at.desc`),
    ]);
    state.orders = orders;
    state.complaints = complaints;
    state.products = products;

    // نجيب أيضا الإعلانات العامة (store_id فاضي)
    const generalAnn = await SB.select("announcements", "store_id=is.null&select=*&order=created_at.desc&limit=5");
    state.announcements = [...announcements, ...generalAnn].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  } catch (err) {
    console.error(err);
    toast("تعذر تحميل بيانات المتجر", "bad");
  }
}

$all(".nav-item[data-tab^='s-']").forEach(btn => {
  btn.addEventListener("click", () => {
    switchTab("s", btn.dataset.tab, "store-sidebar");
    if (btn.dataset.tab === "s-whatsapp") { refreshWaStatus(); refreshMetaStatus(); refreshChannelAvailability(); }
    if (btn.dataset.tab === "s-ai") renderStoreAiSettingsTab();
    if (btn.dataset.tab === "s-products") renderProductsTab();
  });
});

function renderStoreAnnouncementBanner() {
  const host = $("#store-announcement-banner");
  if (!state.announcements.length) { host.innerHTML = ""; return; }
  const latest = state.announcements[0];
  host.innerHTML = `
    <div class="panel" style="border-right:4px solid var(--gold);background:var(--gold-tint);">
      <b style="display:block;margin-bottom:4px;">📣 ${escapeHtml(latest.title)}</b>
      <span style="font-size:13.5px;color:var(--ink-soft);">${escapeHtml(latest.message)}</span>
    </div>`;
}

function renderStoreOverview() {
  const pending = state.orders.filter(o => o.status === "pending").length;
  const completed = state.orders.filter(o => o.status === "completed").length;
  const cancelled = state.orders.filter(o => o.status === "cancelled").length;

  $("#store-stats").innerHTML = `
    <div class="stat-card"><div class="num">${state.orders.length}</div><div class="lbl">إجمالي الطلبات</div></div>
    <div class="stat-card wait"><div class="num">${pending}</div><div class="lbl">بالانتظار</div></div>
    <div class="stat-card ok"><div class="num">${completed}</div><div class="lbl">منجزة</div></div>
    <div class="stat-card bad"><div class="num">${cancelled}</div><div class="lbl">ملغاة</div></div>
  `;
  renderOrdersTable();
}

$all("#orders-filter-tabs .tab-btn").forEach(b => b.addEventListener("click", () => {
  $all("#orders-filter-tabs .tab-btn").forEach(x => x.classList.remove("active"));
  b.classList.add("active");
  state.ordersFilter = b.dataset.filter;
  renderOrdersTable();
}));

function renderOrdersTable() {
  const filtered = state.ordersFilter === "all" ? state.orders : state.orders.filter(o => o.status === state.ordersFilter);
  $("#orders-empty").classList.toggle("hidden", filtered.length !== 0);
  $("#orders-tbody").innerHTML = filtered.map(o => `
    <tr>
      <td>${escapeHtml(o.name || '—')}</td>
      <td>${escapeHtml(o.location || '—')}</td>
      <td style="font-family:var(--font-mono)">${escapeHtml(o.phone || '—')}</td>
      <td>${escapeHtml(o.product_name || o.order_type || '—')}</td>
      <td>${escapeHtml(o.order_variant || '—')}</td>
      <td>${fmtPrice(o.unit_price, o.discount_percent)}</td>
      <td>${o.quantity ?? 1}</td>
      <td>${escapeHtml(o.notes || '—')}</td>
      <td>${fmtOrderPlace(o)}</td>
      <td>${fmtDate(o.created_at)}</td>
      <td>${statusBadge(o.status)}</td>
      <td class="row-actions">
        ${o.status !== 'completed' ? `<button class="btn btn-ok btn-sm" data-complete="${o.id}">إنجاز</button>` : ''}
        ${o.status !== 'cancelled' ? `<button class="btn btn-bad btn-sm" data-cancel="${o.id}">إلغاء</button>` : ''}
        ${o.status !== 'pending' ? `<button class="btn btn-outline btn-sm" data-pending="${o.id}">إرجاع للانتظار</button>` : ''}
      </td>
    </tr>
  `).join("");

  $all("[data-complete]").forEach(b => b.addEventListener("click", () => updateOrderStatus(b.dataset.complete, "completed")));
  $all("[data-cancel]").forEach(b => b.addEventListener("click", () => updateOrderStatus(b.dataset.cancel, "cancelled")));
  $all("[data-pending]").forEach(b => b.addEventListener("click", () => updateOrderStatus(b.dataset.pending, "pending")));
}

async function updateOrderStatus(id, status) {
  try {
    await SB.update("orders", `id=eq.${id}`, { status });
    const o = state.orders.find(x => x.id === id);
    if (o) o.status = status;
    renderStoreOverview();
    toast(status === "completed" ? "تم تعليم الطلب كمنجز" : status === "cancelled" ? "تم إلغاء الطلب" : "تم إرجاع الطلب للانتظار", "ok");
  } catch (err) {
    console.error(err);
    toast("تعذر تحديث حالة الطلب", "bad");
  }
}

function renderStoreInfo() {
  const s = state.session.data;
  $("#store-info-view").innerHTML = `
    <div class="field"><label>اسم المتجر</label><input value="${escapeHtml(s.store_name)}" disabled></div>
    <div class="field"><label>الاسم الكامل</label><input value="${escapeHtml(s.full_name || '—')}" disabled></div>
    <div class="field"><label>رقم الدخول</label><input value="${escapeHtml(s.phone)}" disabled style="font-family:var(--font-mono)"></div>
    <div class="field"><label>رقم واتساب البوت</label><input value="${escapeHtml(s.ai_phone)}" disabled style="font-family:var(--font-mono)"></div>
    <div class="field" style="grid-column:1/-1;"><label>ملاحظة</label><input value="لتعديل هذه البيانات تواصل مع المشرف العام" disabled></div>
  `;
}

// ---- شكوى المتجر ----
$("#send-complaint").addEventListener("click", async () => {
  const subject = $("#complaint-subject").value.trim();
  const message = $("#complaint-message").value.trim();
  if (!message) { toast("الرجاء كتابة تفاصيل الشكوى", "bad"); return; }
  try {
    await SB.insert("complaints", {
      store_id: state.session.data.id,
      store_name: state.session.data.store_name,
      subject, message,
    });
    toast("تم إرسال الشكوى إلى المشرف", "ok");
    $("#complaint-subject").value = ""; $("#complaint-message").value = "";
    await loadStoreData();
    renderMyComplaints();
  } catch (err) { console.error(err); toast("تعذر إرسال الشكوى", "bad"); }
});

function renderMyComplaints() {
  $("#my-complaints-list").innerHTML = state.complaints.length ? state.complaints.map(c => `
    <div class="mini-product" style="align-items:flex-start;">
      <div class="info">
        <b>${escapeHtml(c.subject || 'بدون عنوان')}</b>
        <span style="font-family:var(--font-display);color:var(--ink);">${escapeHtml(c.message)}</span><br>
        <span>${fmtTime(c.created_at)}</span>
      </div>
      ${c.status === 'resolved' ? '<span class="badge ok">تم الحل</span>' : '<span class="badge wait">قيد المراجعة</span>'}
    </div>
  `).join("") : `<div class="empty-state"><p>لم تقدّم أي شكوى بعد</p></div>`;
}

// ---------------------------------------------------------
// المنتجات (لوحة التاجر) — عرض، بحث، تصفية، إضافة/تعديل/حذف
// ---------------------------------------------------------

// عدد مرات طلب كل منتج (بالاعتماد على مطابقة اسم المنتج بجدول orders)
function productOrderCount(productName) {
  if (!productName) return 0;
  return state.orders.filter(o => (o.product_name || o.order_type || "") === productName)
    .reduce((sum, o) => sum + (o.quantity || 1), 0);
}

function renderProductsTab() {
  // تحديث قائمة الفئات المتاحة (select + datalist)
  const categories = [...new Set(state.products.map(p => p.category).filter(Boolean))].sort();
  const catSelect = $("#product-category-filter");
  const currentCatValue = state.productCategoryFilter;
  catSelect.innerHTML = `<option value="">كل الفئات</option>` + categories.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  catSelect.value = currentCatValue;
  $("#p-category-list").innerHTML = categories.map(c => `<option value="${escapeHtml(c)}">`).join("");

  // إحصائيات سريعة
  const outOfStock = state.products.filter(p => (p.stock_quantity ?? 0) <= 0).length;
  const lowStock = state.products.filter(p => (p.stock_quantity ?? 0) > 0 && (p.stock_quantity ?? 0) <= 5).length;
  $("#products-stats").innerHTML = `
    <div class="stat-card"><div class="num">${state.products.length}</div><div class="lbl">إجمالي المنتجات</div></div>
    <div class="stat-card wait"><div class="num">${lowStock}</div><div class="lbl">قريبة النفاذ (≤5)</div></div>
    <div class="stat-card bad"><div class="num">${outOfStock}</div><div class="lbl">منتهية الكمية</div></div>
  `;

  renderProductsGrid();
}

function renderProductsGrid() {
  const q = ($("#product-search").value || "").trim().toLowerCase();
  const cat = $("#product-category-filter").value;
  let list = [...state.products];

  if (cat) list = list.filter(p => p.category === cat);
  if (q) {
    list = list.filter(p =>
      (p.name || "").toLowerCase().includes(q) ||
      String(p.price || "").includes(q) ||
      (p.variant_type || "").toLowerCase().includes(q)
    );
  }

  if (state.productsFilter === "low_stock") {
    list = list.filter(p => (p.stock_quantity ?? 0) > 0 && (p.stock_quantity ?? 0) <= 5);
  } else if (state.productsFilter === "out_of_stock") {
    list = list.filter(p => (p.stock_quantity ?? 0) <= 0);
  } else if (state.productsFilter === "most_ordered") {
    list = list.map(p => ({ ...p, _count: productOrderCount(p.name) })).sort((a, b) => b._count - a._count);
  } else if (state.productsFilter === "least_ordered") {
    list = list.map(p => ({ ...p, _count: productOrderCount(p.name) })).sort((a, b) => a._count - b._count);
  }

  $("#products-empty").classList.toggle("hidden", list.length !== 0);
  $("#products-count-label").textContent = `${state.products.length} منتج`;

  $("#products-grid").innerHTML = list.map(p => productCardHtml(p)).join("");

  $all("#products-grid [data-edit-product]").forEach(b => b.addEventListener("click", () => openProductModal(b.dataset.editProduct)));
  $all("#products-grid [data-delete-product]").forEach(b => b.addEventListener("click", () => deleteProduct(b.dataset.deleteProduct)));
  $all("#products-grid [data-restock]").forEach(b => b.addEventListener("click", () => restockProduct(b.dataset.restock)));
}

function productCardHtml(p) {
  const stock = p.stock_quantity ?? 0;
  const stockBadge = stock <= 0
    ? `<span class="badge bad">نفذت الكمية</span>`
    : stock <= 5
      ? `<span class="badge wait">قريبة النفاذ (${stock})</span>`
      : `<span class="badge ok">متوفر (${stock})</span>`;
  const priceLine = fmtPrice(p.price, p.discount_percent);
  const orderCount = productOrderCount(p.name);

  return `
  <div class="store-card" data-id="${p.id}">
    <div class="top">
      <div>
        <h4>${escapeHtml(p.name)}</h4>
        <div class="meta">${escapeHtml(p.category || "بدون فئة")}${p.variant_type ? " — " + escapeHtml(p.variant_type) : ""}</div>
      </div>
    </div>
    <div class="stat-line">
      <span>السعر: <b>${priceLine}</b></span>
      <span>الطلبات: <b>${orderCount}</b></span>
    </div>
    <div>${stockBadge}</div>
    <div class="actions">
      <button class="btn btn-outline btn-sm" data-edit-product="${p.id}">تعديل</button>
      <button class="btn btn-outline btn-sm" data-restock="${p.id}">إعادة شحن</button>
      <button class="btn btn-bad btn-sm" data-delete-product="${p.id}">حذف</button>
    </div>
  </div>`;
}

$("#product-search").addEventListener("input", renderProductsGrid);
$("#product-category-filter").addEventListener("change", () => {
  state.productCategoryFilter = $("#product-category-filter").value;
  renderProductsGrid();
});
$all("#products-filter-tabs .tab-btn").forEach(b => b.addEventListener("click", () => {
  $all("#products-filter-tabs .tab-btn").forEach(x => x.classList.remove("active"));
  b.classList.add("active");
  state.productsFilter = b.dataset.pfilter;
  renderProductsGrid();
}));

$("#btn-add-product").addEventListener("click", () => openProductModal(null));

function openProductModal(productId) {
  state.editingProductId = productId;
  const p = productId ? state.products.find(x => x.id === productId) : null;

  $("#product-modal-title").textContent = p ? "تعديل المنتج" : "إضافة منتج جديد";
  $("#p-name").value = p?.name || "";
  $("#p-category").value = p?.category || "";
  $("#p-variant-type").value = p?.variant_type || "";
  $("#p-price").value = p?.price ?? "";
  $("#p-discount").value = p?.discount_percent ?? "";
  $("#p-stock").value = p?.stock_quantity ?? 0;
  $("#p-video").value = p?.video_url || "";
  $("#p-description").value = p?.description || "";

  $("#modal-product").classList.add("show");
}

$("#save-product-btn").addEventListener("click", async () => {
  const name = $("#p-name").value.trim();
  if (!name) { toast("الرجاء إدخال اسم المنتج", "bad"); return; }

  const payload = {
    name,
    category: $("#p-category").value.trim() || null,
    variant_type: $("#p-variant-type").value.trim() || null,
    price: $("#p-price").value ? Number($("#p-price").value) : null,
    discount_percent: $("#p-discount").value ? Number($("#p-discount").value) : null,
    stock_quantity: $("#p-stock").value ? Number($("#p-stock").value) : 0,
    video_url: $("#p-video").value.trim() || null,
    description: $("#p-description").value.trim() || null,
  };

  const btn = $("#save-product-btn");
  btn.disabled = true; btn.textContent = "جارٍ الحفظ...";

  try {
    if (state.editingProductId) {
      await SB.update("products", `id=eq.${state.editingProductId}`, payload);
    } else {
      await SB.insert("products", { ...payload, store_id: state.session.data.id });
    }
    toast("تم حفظ المنتج بنجاح", "ok");
    $("#modal-product").classList.remove("show");
    await loadStoreData();
    renderProductsTab();
  } catch (err) {
    console.error(err);
    toast("تعذر حفظ المنتج", "bad");
  } finally {
    btn.disabled = false; btn.textContent = "حفظ المنتج";
  }
});

async function deleteProduct(id) {
  if (!confirm("هل أنت متأكد من حذف هذا المنتج؟")) return;
  try {
    await SB.remove("products", `id=eq.${id}`);
    toast("تم حذف المنتج", "ok");
    await loadStoreData();
    renderProductsTab();
  } catch (err) {
    console.error(err);
    toast("تعذر حذف المنتج", "bad");
  }
}

async function restockProduct(id) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  const addStr = prompt("كم قطعة تريد إضافتها للمخزون؟", "10");
  if (!addStr) return;
  const add = Number(addStr);
  if (!Number.isFinite(add) || add <= 0) { toast("رقم غير صالح", "bad"); return; }
  try {
    const newStock = (p.stock_quantity || 0) + add;
    await SB.update("products", `id=eq.${id}`, { stock_quantity: newStock });
    toast("تم تحديث المخزون", "ok");
    await loadStoreData();
    renderProductsTab();
  } catch (err) {
    console.error(err);
    toast("تعذر تحديث المخزون", "bad");
  }
}

// ---------------------------------------------------------
// ربط واتساب (لوحة المتجر)
// ---------------------------------------------------------

function showWaState(state) {
  // state: 'disconnected' | 'loading' | 'qr' | 'connected'
  $("#wa-state-disconnected").classList.toggle("hidden", state !== "disconnected");
  $("#wa-state-loading").classList.toggle("hidden", state !== "loading");
  $("#wa-state-qr").classList.toggle("hidden", state !== "qr");
  $("#wa-state-connected").classList.toggle("hidden", state !== "connected");
}

function setChannelCardStatus(channel, status, label) {
  const row = $(`#${channel}-status-row`);
  const labelEl = $(`#${channel}-status-label`);
  if (!row || !labelEl) return;
  row.classList.remove("connected", "pending", "disconnected");
  row.classList.add(status === "connected" ? "connected" : status === "pending" || status === "loading" || status === "qr" ? "pending" : "disconnected");
  labelEl.textContent = label;
}

// ---------------------------------------------------------
// تطبيق تحكم الأدمن بالقنوات (إظهار/إخفاء وتفعيل/إغلاق) على لوحة التاجر
// ---------------------------------------------------------
async function refreshChannelAvailability() {
  const storeId = state.session.data.id;
  try {
    const [globalRows, overrideRows] = await Promise.all([
      SB.select("channel_global_settings", "select=*"),
      SB.select("channel_store_overrides", `store_id=eq.${storeId}&select=*`),
    ]);
    const globalByChannel = Object.fromEntries(globalRows.map(r => [r.channel, r]));
    const overrideByChannel = Object.fromEntries(overrideRows.map(r => [r.channel, r]));

    const effective = {};
    ALL_CHANNELS.forEach(channel => {
      const g = globalByChannel[channel] || { visibility: "visible", status: "enabled" };
      const o = overrideByChannel[channel] || {};
      effective[channel] = {
        visibility: o.visibility || g.visibility || "visible",
        status: o.status || g.status || "enabled",
      };
    });
    state.channelEffective = effective;
    applyChannelAvailability();
  } catch (err) {
    console.error(err);
    // تعذر جلب إعدادات القنوات: نترك كل القنوات كما هي (ظاهرة ومفتوحة) بدل تعطيل اللوحة بالكامل
  }
}

function isChannelClosed(channel) {
  return state.channelEffective[channel]?.status === "disabled";
}

function applyChannelAvailability() {
  ALL_CHANNELS.forEach(channel => {
    const card = $(`#channel-card-${channel}`);
    if (!card) return;
    const info = state.channelEffective[channel] || { visibility: "visible", status: "enabled" };
    const hidden = info.visibility === "hidden";
    const closed = info.status === "disabled";
    card.classList.toggle("hidden", hidden);
    card.classList.toggle("channel-closed", !hidden && closed);
  });
}

async function refreshWaStatus() {
  const storeId = state.session.data.id;
  try {
    const res = await LinkAPI.status(storeId);
    applyWaStatus(res);
  } catch (err) {
    console.error(err);
    // تعذر الوصول لسيرفر الربط: نعرض حالة غير مربوط بدل تعليق الواجهة
    showWaState("disconnected");
    setChannelCardStatus("wa", "disconnected", "غير متصل");
  }
}

function applyWaStatus(res) {
  if (res.status === "connected") {
    const numberText = res.number ? `الرقم المرتبط: ${res.number}` : "";
    $("#wa-connected-number-modal").textContent = numberText;
    $("#wa-connected-number").textContent = res.number || "";
    $("#wa-connected-number").classList.toggle("hidden", !res.number);
    showWaState("connected");
    setChannelCardStatus("wa", "connected", "متصل");
    stopWaPolling();
  } else if (res.status === "qr" && res.qr) {
    $("#wa-qr-img").src = res.qr;
    showWaState("qr");
    setChannelCardStatus("wa", "pending", "بانتظار مسح الرمز");
    startWaPolling();
  } else if (res.status === "connecting" || res.status === "pending") {
    showWaState("loading");
    setChannelCardStatus("wa", "pending", "جارٍ التحضير...");
    startWaPolling();
  } else {
    showWaState("disconnected");
    setChannelCardStatus("wa", "disconnected", "غير متصل");
    stopWaPolling();
  }
}

function startWaPolling() {
  if (state.waPollTimer) return;
  state.waPollTimer = setInterval(refreshWaStatus, 4000);
}
function stopWaPolling() {
  if (state.waPollTimer) { clearInterval(state.waPollTimer); state.waPollTimer = null; }
}

$("#btn-wa-open-modal").addEventListener("click", () => {
  $("#modal-wa").classList.add("show");
  refreshWaStatus();
});

$("#btn-wa-connect").addEventListener("click", async () => {
  if (isChannelClosed("wa")) { toast("عذرًا، هذه القناة مغلقة في الوقت الحالي", "bad"); return; }
  showWaState("loading");
  setChannelCardStatus("wa", "pending", "جارٍ التحضير...");
  const storeId = state.session.data.id;
  try {
    const res = await LinkAPI.connect(storeId);
    applyWaStatus(res);
  } catch (err) {
    console.error(err);
    toast("تعذر الاتصال بسيرفر الربط. تحقق من إعدادات LINK_SERVER بملف config.js", "bad");
    showWaState("disconnected");
    setChannelCardStatus("wa", "disconnected", "غير متصل");
  }
});

$("#btn-wa-refresh-qr").addEventListener("click", async () => {
  showWaState("loading");
  const storeId = state.session.data.id;
  try {
    const res = await LinkAPI.connect(storeId);
    applyWaStatus(res);
  } catch (err) {
    console.error(err);
    toast("تعذر تحديث رمز الربط", "bad");
  }
});

$("#btn-wa-disconnect").addEventListener("click", async () => {
  if (!confirm("هل تريد فصل ربط الواتساب؟ ستحتاج لمسح رمز جديد لإعادة الربط.")) return;
  const storeId = state.session.data.id;
  try {
    await LinkAPI.disconnect(storeId);
    toast("تم فصل الربط", "ok");
    showWaState("disconnected");
    setChannelCardStatus("wa", "disconnected", "غير متصل");
  } catch (err) {
    console.error(err);
    toast("تعذر فصل الربط", "bad");
  }
});

// ---------------------------------------------------------
// ربط ماسنجر / انستغرام عبر Meta OAuth (لوحة المتجر)
// ---------------------------------------------------------

const METACHANNEL_LABELS = { wa: "واتساب", messenger: "ماسنجر", instagram: "انستغرام", telegram: "تيليجرام", tiktok: "تيك توك" };
const ALL_CHANNELS = ["wa", "messenger", "instagram", "telegram", "tiktok"];

async function refreshMetaStatus() {
  const storeId = state.session.data.id;
  try {
    const res = await MetaAPI.status(storeId);
    const byChannel = {};
    (res.channels || []).forEach(c => { byChannel[c.channel] = c; });

    ["messenger", "instagram", "telegram", "tiktok"].forEach(channel => {
      const info = byChannel[channel];
      const connected = info && info.status === "connected";

      setChannelCardStatus(channel, connected ? "connected" : "disconnected", connected ? "متصل" : "غير متصل");

      $(`#btn-${channel}-connect`).classList.toggle("hidden", connected);
      $(`#btn-${channel}-disconnect`).classList.toggle("hidden", !connected);
      $(`#${channel}-ai-row`).classList.toggle("hidden", !connected);

      const nameEl = $(`#${channel}-external-name`);
      if (connected && info.external_name) {
        nameEl.textContent = info.external_name;
        nameEl.classList.remove("hidden");
      } else {
        nameEl.classList.add("hidden");
      }

      if (connected) {
        $(`#${channel}-ai-toggle`).checked = !!info.ai_enabled;
      }
    });
  } catch (err) {
    console.error(err);
    // تعذر الوصول لسيرفر الربط: نعرض حالة غير متصل بدل تعليق الواجهة
    ["messenger", "instagram", "telegram", "tiktok"].forEach(channel => setChannelCardStatus(channel, "disconnected", "غير متصل"));
  }
}

function startMetaOAuth(channel) {
  if (isChannelClosed(channel)) { toast("عذرًا، هذه القناة مغلقة في الوقت الحالي", "bad"); return; }
  const storeId = state.session.data.id;
  setChannelCardStatus(channel, "pending", "جارٍ فتح نافذة الربط...");

  const getUrl =
    channel === "instagram" ? MetaAPI.getInstagramOAuthUrl(storeId) :
    channel === "tiktok" ? MetaAPI.getTikTokOAuthUrl(storeId) :
    MetaAPI.getOAuthUrl(storeId);

  getUrl.then(({ url }) => {
    const popup = window.open(url, "meta_oauth", "width=600,height=720");
    if (!popup) {
      toast("يرجى السماح للنوافذ المنبثقة (Popups) بهذا الموقع للمتابعة", "bad");
      setChannelCardStatus(channel, "disconnected", "غير متصل");
      return;
    }

    const timer = setInterval(() => {
      if (popup.closed) clearInterval(timer);
    }, 1000);

    function handler(event) {
      if (!event.data || typeof event.data !== "object") return;
      if (event.data.type === "meta_oauth_success" || event.data.type === "tiktok_oauth_success") {
        window.removeEventListener("message", handler);
        clearInterval(timer);
        toast("تم ربط الحساب بنجاح", "ok");
        refreshMetaStatus();
      } else if (event.data.type === "meta_oauth_pages") {
        // التاجر يملك أكثر من صفحة فيسبوك: نعرض قائمة ليختار بدل ربط صفحة عشوائية
        window.removeEventListener("message", handler);
        clearInterval(timer);
        setChannelCardStatus("messenger", "pending", "اختر الصفحة التي تريد ربطها...");
        showPageSelectionModal(event.data.selectionId, event.data.pages || []);
      } else if (event.data.type === "meta_oauth_error" || event.data.type === "tiktok_oauth_error") {
        window.removeEventListener("message", handler);
        clearInterval(timer);
        toast(event.data.message || "تعذر إتمام الربط", "bad");
        setChannelCardStatus(channel, "disconnected", "غير متصل");
      }
    }
    window.addEventListener("message", handler);
  }).catch(err => {
    console.error(err);
    toast("تعذر بدء عملية الربط. تحقق من إعدادات السيرفر", "bad");
    setChannelCardStatus(channel, "disconnected", "غير متصل");
  });
}

// ربط بوت تيليجرام: لا يوجد OAuth هنا، فقط نفتح مودال لصق التوكن
function startTelegramConnect() {
  if (isChannelClosed("telegram")) { toast("عذرًا، هذه القناة مغلقة في الوقت الحالي", "bad"); return; }
  $("#f-telegram-bot-token").value = "";
  $("#modal-telegram-connect").classList.add("show");
}

$("#btn-telegram-connect-submit").addEventListener("click", async () => {
  const botToken = $("#f-telegram-bot-token").value.trim();
  if (!botToken) {
    toast("الصق توكن البوت أولًا", "bad");
    return;
  }
  const btn = $("#btn-telegram-connect-submit");
  btn.disabled = true;
  setChannelCardStatus("telegram", "pending", "جارٍ التحقق من التوكن...");
  try {
    const storeId = state.session.data.id;
    await MetaAPI.connectTelegram(storeId, botToken);
    $("#modal-telegram-connect").classList.remove("show");
    toast("تم ربط بوت تيليجرام بنجاح", "ok");
    refreshMetaStatus();
  } catch (err) {
    console.error(err);
    toast("تعذر ربط البوت — تأكد أن التوكن صحيح ومنسوخ بالكامل", "bad");
    setChannelCardStatus("telegram", "disconnected", "غير متصل");
  } finally {
    btn.disabled = false;
  }
});



// قائمة اختيار صفحة فيسبوك (خاصة بماسنجر فقط — لا وجود لهذا المفهوم بتدفق
// انستغرام المباشر) تظهر فقط عندما يملك حساب التاجر أكثر من صفحة
function showPageSelectionModal(selectionId, pages) {
  const list = $("#page-select-list");
  list.innerHTML = pages.length
    ? ""
    : `<p style="color:var(--ink-soft);font-size:13px;">لم يتم العثور على أي صفحة.</p>`;

  pages.forEach(p => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "page-pick-row";
    btn.innerHTML = `
      ${p.picture
        ? `<img src="${escapeHtml(p.picture)}" alt="">`
        : `<span class="ph-avatar">${escapeHtml((p.name || "؟").trim().charAt(0) || "؟")}</span>`}
      <span class="info">
        <b>${escapeHtml(p.name || "بدون اسم")}</b>
        ${p.category ? `<span>${escapeHtml(p.category)}</span>` : ""}
      </span>
    `;
    btn.addEventListener("click", async () => {
      $all("button", list).forEach(b => b.disabled = true);
      try {
        const storeId = state.session.data.id;
        await MetaAPI.selectPage(storeId, selectionId, p.id);
        $("#modal-page-select").classList.remove("show");
        toast("تم ربط الحساب بنجاح", "ok");
        refreshMetaStatus();
      } catch (err) {
        console.error(err);
        toast("تعذر ربط الصفحة المختارة، حاول مجددًا", "bad");
        setChannelCardStatus("messenger", "disconnected", "غير متصل");
        $all("button", list).forEach(b => b.disabled = false);
      }
    });
    list.appendChild(btn);
  });

  $("#modal-page-select").classList.add("show");
}

$("#btn-page-select-close").addEventListener("click", () => {
  $("#modal-page-select").classList.remove("show");
  setChannelCardStatus("messenger", "disconnected", "غير متصل");
});

$("#btn-messenger-connect").addEventListener("click", () => startMetaOAuth("messenger"));
$("#btn-instagram-connect").addEventListener("click", () => startMetaOAuth("instagram"));
$("#btn-telegram-connect").addEventListener("click", () => startTelegramConnect());
$("#btn-tiktok-connect").addEventListener("click", () => startMetaOAuth("tiktok"));

["messenger", "instagram", "telegram", "tiktok"].forEach(channel => {
  $(`#btn-${channel}-disconnect`).addEventListener("click", async () => {
    if (!confirm(`هل تريد فصل ربط ${METACHANNEL_LABELS[channel]}؟`)) return;
    const storeId = state.session.data.id;
    try {
      await MetaAPI.disconnect(storeId, channel);
      toast("تم فصل الربط", "ok");
      refreshMetaStatus();
    } catch (err) {
      console.error(err);
      toast("تعذر فصل الربط", "bad");
    }
  });

  $(`#${channel}-ai-toggle`).addEventListener("change", async (e) => {
    const storeId = state.session.data.id;
    const enabled = e.target.checked;
    try {
      await MetaAPI.setAiEnabled(storeId, channel, enabled);
      toast(enabled ? "تم تفعيل الذكاء الاصطناعي" : "تم إيقاف الذكاء الاصطناعي", "ok");
    } catch (err) {
      console.error(err);
      e.target.checked = !enabled; // تراجع عن التغيير بالواجهة إذا فشل الحفظ
      toast("تعذر حفظ التغيير", "bad");
    }
  });
});

// ---------------------------------------------------------
// إعدادات الذكاء الاصطناعي الخاصة بالمتجر (System Prompt + نموذج + مفتاح)
// ---------------------------------------------------------

function renderStoreAiSettingsTab() {
  const s = state.session.data;
  $("#store-ai-display-name").value = s.ai_display_name || "";
  $("#store-ai-contact-info").value = s.ai_contact_info || "";
}

$("#save-store-ai-settings").addEventListener("click", async () => {
  const storeId = state.session.data.id;
  const patch = {
    ai_display_name: $("#store-ai-display-name").value.trim(),
    ai_contact_info: $("#store-ai-contact-info").value.trim(),
  };
  try {
    const rows = await SB.update("stores", `id=eq.${storeId}`, patch);
    state.session.data = { ...state.session.data, ...patch };
    localStorage.setItem("wb_session", JSON.stringify(state.session));
    toast("تم حفظ إعدادات الذكاء الاصطناعي", "ok");
  } catch (err) {
    console.error(err);
    toast("تعذر حفظ الإعدادات", "bad");
  }
});

// ---------------------------------------------------------
// شارات حالة ربط واتساب بلوحة الأدمن (قراءة فقط، بدون تحكم)
// ---------------------------------------------------------
async function refreshAdminWaBadges() {
  // نعتمد على عمود whatsapp_connected المخزّن بجدول stores (يحدّثه سيرفر الربط تلقائيًا)
  // لذا يكفي إعادة تحميل بيانات المتاجر من Supabase مباشرة بدون الحاجة لسيرفر الربط
  try {
    const stores = await SB.select("stores", "select=*&order=created_at.desc");
    state.stores = stores;
    renderStoresGrid();
    renderAdminOverview();
  } catch (err) {
    console.error(err);
  }
}

// ---------------------------------------------------------
// الطباعة
// ---------------------------------------------------------
$("#btn-print").addEventListener("click", () => {
  const status = $("#print-status").value;
  const mode = $("#print-mode").value;
  const fromDateStr = $("#print-from-date").value; // اختياري: YYYY-MM-DD

  let rows = status === "all" ? state.orders : state.orders.filter(o => o.status === status);

  if (fromDateStr) {
    const fromDate = new Date(fromDateStr);
    fromDate.setHours(0, 0, 0, 0);
    rows = rows.filter(o => o.created_at && new Date(o.created_at) >= fromDate);
  }

  if (!rows.length) { toast("لا توجد بيانات مطابقة للطباعة", "bad"); return; }

  const statusLabel = { all: "كل الطلبات", pending: "الطلبات بالانتظار", completed: "الطلبات المنجزة", cancelled: "الطلبات الملغاة" }[status];
  const dateRangeLabel = fromDateStr ? ` — من تاريخ ${fromDateStr}` : "";
  const area = $("#print-area");

  // ترتيب زمني تصاعدي (الأقدم أولاً) حتى يكون رقم الترتيب منطقيًا، ثم رقم تسلسلي يبدأ من 1
  const ordered = [...rows].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const orderLabel = o => escapeHtml([o.product_name || o.order_type, o.order_variant].filter(Boolean).join(" / ") || "—");
  const priceQtyLabel = o => `${fmtPrice(o.unit_price, o.discount_percent)} / ${o.quantity ?? 1}`;

  if (mode === "table") {
    area.innerHTML = `
      <h2>${escapeHtml(state.session.data.store_name)} — ${statusLabel}${dateRangeLabel}</h2>
      <p>تاريخ الطباعة: ${new Date().toLocaleString("ar-IQ")}</p>
      <table class="print-table">
        <thead><tr><th>#</th><th>الاسم</th><th>الرقم</th><th>الطلب / نوع الطلب</th><th>السعر / الكمية</th><th>التوقيت</th></tr></thead>
        <tbody>
          ${ordered.map((o, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(o.name || '')}</td><td>${escapeHtml(o.phone || '')}</td><td>${orderLabel(o)}</td><td>${priceQtyLabel(o)}</td><td>${fmtDate(o.created_at)}</td></tr>`).join("")}
        </tbody>
      </table>`;
  } else {
    area.innerHTML = `
      <h2>${escapeHtml(state.session.data.store_name)} — بطاقات ${statusLabel}${dateRangeLabel}</h2>
      <div class="print-labels">
        ${ordered.map((o, i) => `
          <div class="print-label">
            <h4>#${i + 1} — ${escapeHtml(state.session.data.store_name)}</h4>
            <p><b>الزبون:</b> ${escapeHtml(o.name || '—')}</p>
            <p><b>الرقم:</b> ${escapeHtml(o.phone || '—')}</p>
            <p><b>الطلب:</b> ${orderLabel(o)}</p>
            <p><b>السعر / الكمية:</b> ${priceQtyLabel(o)}</p>
            <p><b>التوقيت:</b> ${fmtDate(o.created_at)}</p>
          </div>
        `).join("")}
      </div>`;
  }

  window.print();
});
