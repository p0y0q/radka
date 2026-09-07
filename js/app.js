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
  productsDraft: [],  // منتجات مؤقتة أثناء تعديل/إضافة متجر
  editingStoreId: null,
  ordersFilter: "all",
  waPollTimer: null,  // مؤقت فحص حالة ربط واتساب (لوحة المتجر)
  adminWaPollTimer: null, // مؤقت تحديث شارات الربط بلوحة الأدمن
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

$("#role-store-btn").addEventListener("click", () => setRole("store"));
$("#role-admin-btn").addEventListener("click", () => setRole("admin"));

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

$("#login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  hideLoginAlert();

  const phone = $("#login-phone").value.trim();
  const password = $("#login-password").value;

  const v = validatePhone(phone);
  if (!v.valid) {
    $("#login-phone").classList.add("err");
    $("#phone-error").textContent = v.msg;
    $("#phone-error").classList.add("show");
    return;
  }

  const btn = $("#login-submit");
  btn.disabled = true;
  btn.textContent = "جارٍ التحقق...";

  try {
    if (selectedRole === "admin") {
      const rows = await SB.select("admins", `phone=eq.${encodeURIComponent(phone)}&password=eq.${encodeURIComponent(password)}&select=*`);
      if (rows.length === 0) {
        showLoginAlert("رقم الهاتف أو كلمة المرور غير صحيحة.");
      } else {
        state.session = { role: "admin", data: rows[0] };
        localStorage.setItem("wb_session", JSON.stringify(state.session));
        await enterAdmin();
      }
    } else {
      const rows = await SB.select("stores", `phone=eq.${encodeURIComponent(phone)}&password=eq.${encodeURIComponent(password)}&select=*`);
      if (rows.length === 0) {
        showLoginAlert("رقم الهاتف أو كلمة المرور غير صحيحة.");
      } else if (rows[0].status === "suspended") {
        showLoginAlert("هذا المتجر موقوف حاليًا. يرجى التواصل مع المشرف.");
      } else {
        state.session = { role: "store", data: rows[0] };
        localStorage.setItem("wb_session", JSON.stringify(state.session));
        await enterStore();
      }
    }
  } catch (err) {
    console.error(err);
    showLoginAlert("تعذر الاتصال بقاعدة البيانات. تحقق من إعدادات Supabase في js/config.js");
  } finally {
    btn.disabled = false;
    btn.textContent = "دخول";
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
  renderApiSettingsTab();
  renderAnnouncementsTab();
  renderComplaintsTab();

  if (state.adminWaPollTimer) clearInterval(state.adminWaPollTimer);
  state.adminWaPollTimer = setInterval(refreshAdminWaBadges, 8000);
}

async function loadAdminData() {
  try {
    const [stores, orders, complaints, announcements, apiRows] = await Promise.all([
      SB.select("stores", "select=*&order=created_at.desc"),
      SB.select("orders", "select=*&order=created_at.desc&limit=2000"),
      SB.select("complaints", "select=*&order=created_at.desc"),
      SB.select("announcements", "select=*&order=created_at.desc"),
      SB.select("api_settings", "select=*"),
    ]);
    state.stores = stores;
    state.orders = orders;
    state.complaints = complaints;
    state.announcements = announcements;
    state.apiSettings = {};
    apiRows.forEach(r => state.apiSettings[r.key_name] = r.key_value);
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

function storeOrderCount(aiPhone) {
  return state.orders.filter(o => o.ai_phone === aiPhone).length;
}

function storeCardHtml(s) {
  const orderCount = storeOrderCount(s.ai_phone);
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
  const rows = state.orders.filter(o => o.ai_phone === s.ai_phone);
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

// ---- إعدادات API ----
let selectedProvider = "gemini";

function setProvider(provider) {
  selectedProvider = provider;
  $("#provider-gemini-btn").classList.toggle("active", provider === "gemini");
  $("#provider-openrouter-btn").classList.toggle("active", provider === "openrouter");
  $("#provider-fields-gemini").classList.toggle("hidden", provider !== "gemini");
  $("#provider-fields-openrouter").classList.toggle("hidden", provider !== "openrouter");
}
$("#provider-gemini-btn").addEventListener("click", () => setProvider("gemini"));
$("#provider-openrouter-btn").addEventListener("click", () => setProvider("openrouter"));

function renderApiSettingsTab() {
  setProvider(state.apiSettings.global_ai_provider || "gemini");
  $("#gemini-api-key").value = state.apiSettings.global_gemini_api_key || "";
  $("#gemini-model").value = state.apiSettings.global_gemini_model || "gemini-3.6-flash";
  $("#openrouter-base-url").value = state.apiSettings.global_openrouter_base_url || "https://openrouter.ai/api/v1";
  $("#openrouter-api-key").value = state.apiSettings.global_openrouter_api_key || "";
  $("#openrouter-model").value = state.apiSettings.global_openrouter_model || "";

  $("#api-stores-tbody").innerHTML = state.stores.length ? state.stores.map(s => `
    <tr>
      <td>${escapeHtml(s.store_name)}</td>
      <td style="font-family:var(--font-mono)">${escapeHtml(s.phone)}</td>
      <td>${s.use_global_api ? '<span class="badge ok">المفتاح العام</span>' : '<span class="badge wait">مفتاح خاص</span>'}</td>
      <td>
        <input type="text" data-api-key-input="${s.id}" value="${escapeHtml(s.ai_api_key || '')}" placeholder="مفتاح خاص..." style="width:180px;padding:7px 10px;border-radius:7px;border:1.5px solid var(--line);font-family:var(--font-mono);font-size:12.5px;">
      </td>
      <td class="row-actions">
        <button class="btn btn-outline btn-sm" data-toggle-api="${s.id}">${s.use_global_api ? 'تفعيل الخاص' : 'استخدام العام'}</button>
        <button class="btn btn-primary btn-sm" data-save-api="${s.id}">حفظ</button>
      </td>
    </tr>
  `).join("") : `<tr><td colspan="5" style="text-align:center;color:var(--ink-soft);padding:24px;">لا توجد متاجر بعد</td></tr>`;

  $all("[data-toggle-api]").forEach(b => b.addEventListener("click", async () => {
    const s = state.stores.find(x => x.id === b.dataset.toggleApi);
    try {
      await SB.update("stores", `id=eq.${s.id}`, { use_global_api: !s.use_global_api });
      toast("تم تحديث وضع API للمتجر", "ok");
      await loadAdminData(); renderApiSettingsTab();
    } catch (err) { console.error(err); toast("تعذر التحديث", "bad"); }
  }));

  $all("[data-save-api]").forEach(b => b.addEventListener("click", async () => {
    const input = $(`[data-api-key-input="${b.dataset.saveApi}"]`);
    try {
      await SB.update("stores", `id=eq.${b.dataset.saveApi}`, { ai_api_key: input.value.trim() });
      toast("تم حفظ مفتاح المتجر", "ok");
      await loadAdminData(); renderApiSettingsTab();
    } catch (err) { console.error(err); toast("تعذر الحفظ", "bad"); }
  }));
}

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
    await upsertApiSetting("global_ai_provider", selectedProvider);

    if (selectedProvider === "gemini") {
      await upsertApiSetting("global_gemini_api_key", $("#gemini-api-key").value.trim());
      await upsertApiSetting("global_gemini_model", $("#gemini-model").value.trim() || "gemini-3.6-flash");
    } else {
      await upsertApiSetting("global_openrouter_base_url", $("#openrouter-base-url").value.trim() || "https://openrouter.ai/api/v1");
      await upsertApiSetting("global_openrouter_api_key", $("#openrouter-api-key").value.trim());
      await upsertApiSetting("global_openrouter_model", $("#openrouter-model").value.trim());
    }

    toast("تم حفظ المفتاح العام", "ok");
    await loadAdminData();
  } catch (err) { console.error(err); toast("تعذر حفظ المفتاح", "bad"); }
});

// ---- الإعلانات ----
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
  renderMyComplaints();
  renderStoreAnnouncementBanner();
  setChannelCardStatus("wa", "disconnected", "غير متصل");
  setChannelCardStatus("messenger", "disconnected", "غير متصل");
  setChannelCardStatus("instagram", "disconnected", "غير متصل");
  refreshWaStatus();
  refreshMetaStatus();
}

async function loadStoreData() {
  const aiPhone = state.session.data.ai_phone;
  try {
    const [orders, complaints, announcements] = await Promise.all([
      SB.select("orders", `ai_phone=eq.${encodeURIComponent(aiPhone)}&select=*&order=created_at.desc`),
      SB.select("complaints", `store_id=eq.${state.session.data.id}&select=*&order=created_at.desc`),
      SB.select("announcements", `store_id=eq.${state.session.data.id}&select=*&order=created_at.desc`),
    ]);
    state.orders = orders;
    state.complaints = complaints;

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
    if (btn.dataset.tab === "s-whatsapp") { refreshWaStatus(); refreshMetaStatus(); }
    if (btn.dataset.tab === "s-ai") renderStoreAiSettingsTab();
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
      <td>${escapeHtml(o.order_type || '—')}</td>
      <td>${escapeHtml(o.notes || '—')}</td>
      <td>${fmtTime(o.created_at)}</td>
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

const METACHANNEL_LABELS = { messenger: "ماسنجر", instagram: "انستغرام" };

async function refreshMetaStatus() {
  const storeId = state.session.data.id;
  try {
    const res = await MetaAPI.status(storeId);
    const byChannel = {};
    (res.channels || []).forEach(c => { byChannel[c.channel] = c; });

    ["messenger", "instagram"].forEach(channel => {
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
    ["messenger", "instagram"].forEach(channel => setChannelCardStatus(channel, "disconnected", "غير متصل"));
  }
}

function startMetaOAuth(channel) {
  const storeId = state.session.data.id;
  setChannelCardStatus(channel, "pending", "جارٍ فتح نافذة الربط...");

  MetaAPI.getOAuthUrl(storeId).then(({ url }) => {
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
      if (event.data.type === "meta_oauth_success") {
        window.removeEventListener("message", handler);
        clearInterval(timer);
        toast("تم ربط الحساب بنجاح", "ok");
        refreshMetaStatus();
      } else if (event.data.type === "meta_oauth_error") {
        window.removeEventListener("message", handler);
        clearInterval(timer);
        toast(event.data.message || "تعذر إتمام الربط عبر Meta", "bad");
        setChannelCardStatus(channel, "disconnected", "غير متصل");
      }
    }
    window.addEventListener("message", handler);
  }).catch(err => {
    console.error(err);
    toast("تعذر بدء عملية الربط عبر Meta. تحقق من إعدادات السيرفر", "bad");
    setChannelCardStatus(channel, "disconnected", "غير متصل");
  });
}

$("#btn-messenger-connect").addEventListener("click", () => startMetaOAuth("messenger"));
$("#btn-instagram-connect").addEventListener("click", () => startMetaOAuth("instagram"));

["messenger", "instagram"].forEach(channel => {
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
  $("#store-ai-system-prompt").value = s.ai_system_prompt || "";
  $("#store-use-global-api").checked = s.use_global_api !== false;
  $("#store-ai-api-key").value = s.ai_api_key || "";
  $("#store-ai-model").value = s.ai_model || "gemini-1.5-flash";
}

$("#save-store-ai-settings").addEventListener("click", async () => {
  const storeId = state.session.data.id;
  const patch = {
    ai_system_prompt: $("#store-ai-system-prompt").value.trim(),
    use_global_api: $("#store-use-global-api").checked,
    ai_api_key: $("#store-ai-api-key").value.trim(),
    ai_model: $("#store-ai-model").value,
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

  if (mode === "table") {
    area.innerHTML = `
      <h2>${escapeHtml(state.session.data.store_name)} — ${statusLabel}${dateRangeLabel}</h2>
      <p>تاريخ الطباعة: ${new Date().toLocaleString("ar-IQ")}</p>
      <table class="print-table">
        <thead><tr><th>الاسم</th><th>الموقع</th><th>الرقم</th><th>نوع الطلب</th><th>الحالة</th><th>الوقت</th></tr></thead>
        <tbody>
          ${rows.map(o => `<tr><td>${escapeHtml(o.name || '')}</td><td>${escapeHtml(o.location || '')}</td><td>${escapeHtml(o.phone || '')}</td><td>${escapeHtml(o.order_type || '')}</td><td>${{pending:'بالانتظار',completed:'منجز',cancelled:'ملغي'}[o.status]||''}</td><td>${fmtTime(o.created_at)}</td></tr>`).join("")}
        </tbody>
      </table>`;
  } else {
    area.innerHTML = `
      <h2>${escapeHtml(state.session.data.store_name)} — بطاقات ${statusLabel}${dateRangeLabel}</h2>
      <div class="print-labels">
        ${rows.map(o => `
          <div class="print-label">
            <h4>${escapeHtml(state.session.data.store_name)}</h4>
            <p><b>الزبون:</b> ${escapeHtml(o.name || '—')}</p>
            <p><b>الموقع:</b> ${escapeHtml(o.location || '—')}</p>
            <p><b>الهاتف:</b> ${escapeHtml(o.phone || '—')}</p>
            <p><b>الطلب:</b> ${escapeHtml(o.order_type || '—')}</p>
            <p><b>الحالة:</b> ${{pending:'بالانتظار',completed:'منجز',cancelled:'ملغي'}[o.status]||''}</p>
            <p><b>الوقت:</b> ${fmtTime(o.created_at)}</p>
          </div>
        `).join("")}
      </div>`;
  }

  window.print();
});
