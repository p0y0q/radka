// =========================================================
// طبقة اتصال بسيطة مع Supabase عبر REST API (بدون أي مكتبات خارجية)
// =========================================================

const SB = {
  baseUrl: () => `${SUPABASE_CONFIG.url}/rest/v1`,
  headers: (prefer) => ({
    apikey: SUPABASE_CONFIG.anonKey,
    Authorization: `Bearer ${SUPABASE_CONFIG.anonKey}`,
    "Content-Type": "application/json",
    ...(prefer ? { Prefer: prefer } : {}),
  }),

  async select(table, query = "") {
    const res = await fetch(`${this.baseUrl()}/${table}?${query}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async insert(table, rows, prefer = "return=representation") {
    const res = await fetch(`${this.baseUrl()}/${table}`, {
      method: "POST",
      headers: this.headers(prefer),
      body: JSON.stringify(Array.isArray(rows) ? rows : [rows]),
    });
    if (!res.ok) throw new Error(await res.text());
    return prefer.includes("representation") ? res.json() : true;
  },

  async update(table, query, patch, prefer = "return=representation") {
    const res = await fetch(`${this.baseUrl()}/${table}?${query}`, {
      method: "PATCH",
      headers: this.headers(prefer),
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(await res.text());
    return prefer.includes("representation") ? res.json() : true;
  },

  async remove(table, query) {
    const res = await fetch(`${this.baseUrl()}/${table}?${query}`, {
      method: "DELETE",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(await res.text());
    return true;
  },

  // رفع ملف لـ Supabase Storage (bucket عام). upsert=true يستبدل نفس المسار
  // إن وُجد مسبقًا (مفيد لصور QR الثابتة بلوحة الأدمن)، false ينشئ ملفًا
  // جديدًا فقط (مفيد لصور إيصالات التحويل بمسارات فريدة).
  async uploadFile(bucket, path, file, upsert = false) {
    const res = await fetch(`${SUPABASE_CONFIG.url}/storage/v1/object/${bucket}/${path}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_CONFIG.anonKey,
        Authorization: `Bearer ${SUPABASE_CONFIG.anonKey}`,
        "Content-Type": file.type || "application/octet-stream",
        ...(upsert ? { "x-upsert": "true" } : {}),
      },
      body: file,
    });
    if (!res.ok) throw new Error(await res.text());
    return this.publicUrl(bucket, path);
  },

  publicUrl(bucket, path) {
    return `${SUPABASE_CONFIG.url}/storage/v1/object/public/${bucket}/${path}`;
  },
};

// =========================================================
// عميل سيرفر ربط واتساب (Backend منفصل — Fly.io)
// =========================================================
const LinkAPI = {
  headers() {
    return {
      "Content-Type": "application/json",
      "x-link-secret": LINK_SERVER.secret,
    };
  },

  async connect(storeId) {
    const res = await fetch(`${LINK_SERVER.baseUrl}/api/stores/${storeId}/connect`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async status(storeId) {
    const res = await fetch(`${LINK_SERVER.baseUrl}/api/stores/${storeId}/status`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async disconnect(storeId) {
    const res = await fetch(`${LINK_SERVER.baseUrl}/api/stores/${storeId}/disconnect`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
};

// =========================================================
// عميل قنوات ميتا (ماسنجر / انستغرام) — عبر نفس سيرفر الربط
// =========================================================
const MetaAPI = {
  headers() {
    return {
      "Content-Type": "application/json",
      "x-link-secret": LINK_SERVER.secret,
    };
  },

  // يرجع رابط OAuth جاهز لفتحه بنافذة popup (ماسنجر — عبر فيسبوك)
  async getOAuthUrl(storeId) {
    const res = await fetch(`${LINK_SERVER.baseUrl}/api/stores/${storeId}/meta/oauth-url`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // { url }
  },

  // يرجع رابط OAuth جاهز لفتحه بنافذة popup (انستغرام — تسجيل دخول مباشر عبر instagram.com،
  // بدون أي مرور بفيسبوك أو اختيار صفحة)
  async getInstagramOAuthUrl(storeId) {
    const res = await fetch(`${LINK_SERVER.baseUrl}/api/stores/${storeId}/instagram/oauth-url`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // { url }
  },

  // يرجع رابط OAuth جاهز لفتحه بنافذة popup (تيك توك)
  async getTikTokOAuthUrl(storeId) {
    const res = await fetch(`${LINK_SERVER.baseUrl}/api/stores/${storeId}/tiktok/oauth-url`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // { url }
  },

  // ربط بوت تيليجرام مباشرة بتوكن (بدون أي نافذة OAuth — التاجر يلصق التوكن يدويًا)
  async connectTelegram(storeId, botToken) {
    const res = await fetch(`${LINK_SERVER.baseUrl}/api/stores/${storeId}/telegram/connect`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ botToken }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  // حالة قنوات ميتا (بيانات عامة فقط، بدون أي توكن)
  async status(storeId) {
    const res = await fetch(`${LINK_SERVER.baseUrl}/api/stores/${storeId}/meta/status`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // { channels: [...] }
  },

  // يُستدعى بعد أن يختار التاجر صفحته من قائمة الصفحات (تظهر فقط عندما يملك
  // حسابه أكثر من صفحة فيسبوك عند ربط ماسنجر — انظر meta_oauth_pages بـ app.js)
  async selectPage(storeId, selectionId, pageId) {
    const res = await fetch(`${LINK_SERVER.baseUrl}/api/stores/${storeId}/meta/select-page`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ selectionId, pageId }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async setAiEnabled(storeId, channel, enabled) {
    const res = await fetch(`${LINK_SERVER.baseUrl}/api/stores/${storeId}/meta/${channel}/ai-toggle`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ enabled }),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  async disconnect(storeId, channel) {
    const res = await fetch(`${LINK_SERVER.baseUrl}/api/stores/${storeId}/meta/${channel}/disconnect`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },
};

// =========================================================
// عميل رموز التحقق عبر واتساب (OTP) — لصفحة إنشاء حساب جديد
// =========================================================
const OtpAPI = {
  headers() {
    return {
      "Content-Type": "application/json",
      "x-link-secret": LINK_SERVER.secret,
    };
  },

  // حالة جلسة ربط رقم إرسال رموز التحقق: { status: 'qr'|'connecting'|'connected', qr, number }
  async senderStatus() {
    const res = await fetch(`${LINK_SERVER.baseUrl}/api/otp/sender-status`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  // فصل الرقم المربوط حاليًا لإرسال رموز التحقق
  async disconnectSender() {
    const res = await fetch(`${LINK_SERVER.baseUrl}/api/otp/disconnect`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  // يرسل رمز تحقق من 6 أرقام إلى رقم واتساب التاجر، صالح 5 دقائق
  async send(phone) {
    const res = await fetch(`${LINK_SERVER.baseUrl}/api/otp/send`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ phone }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || "send_failed");
      err.data = data;
      throw err;
    }
    return data; // { ok: true, expiresInSeconds }
  },

  // يتحقق من الرمز المُدخل مقابل آخر رمز مُرسل لهذا الرقم
  async verify(phone, code) {
    const res = await fetch(`${LINK_SERVER.baseUrl}/api/otp/verify`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ phone, code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || "verify_failed");
      err.data = data;
      throw err;
    }
    return data; // { ok: true }
  },
};

// =========================================================
// عميل رسائل واتساب الأدمن (ربط أي رقم + إرسال جماعي/فردي)
// =========================================================
const AdminWaAPI = {
  headers() {
    return {
      "Content-Type": "application/json",
      "x-link-secret": LINK_SERVER.secret,
    };
  },

  // حالة جلسة الربط الحالية: { status: 'qr'|'connecting'|'connected'|'disconnected', qr, number }
  async status() {
    const res = await fetch(`${LINK_SERVER.baseUrl}/api/admin-wa/status`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  // فصل الرقم المربوط حاليًا
  async disconnect() {
    const res = await fetch(`${LINK_SERVER.baseUrl}/api/admin-wa/disconnect`, {
      method: "POST",
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json();
  },

  // إرسال رسالة لرقم واحد فقط (رقم مخصص)
  async sendOne(phone, message) {
    const res = await fetch(`${LINK_SERVER.baseUrl}/api/admin-wa/send-one`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ phone, message }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || "send_failed");
      err.data = data;
      throw err;
    }
    return data;
  },

  // إرسال جماعي لعدة أرقام (كل أرقام جدول الاشتراك مثلاً)
  async sendBulk(phones, message) {
    const res = await fetch(`${LINK_SERVER.baseUrl}/api/admin-wa/send-bulk`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ phones, message }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.error || "send_failed");
      err.data = data;
      throw err;
    }
    return data; // { ok: true, total }
  },

  // متابعة تقدّم آخر عملية إرسال جماعي
  async bulkStatus() {
    const res = await fetch(`${LINK_SERVER.baseUrl}/api/admin-wa/bulk-status`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // { exists, total, sent, failed, done, results }
  },
};
