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

  // حالة قنوات ميتا (بيانات عامة فقط، بدون أي توكن)
  async status(storeId) {
    const res = await fetch(`${LINK_SERVER.baseUrl}/api/stores/${storeId}/meta/status`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(await res.text());
    return res.json(); // { channels: [...] }
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
