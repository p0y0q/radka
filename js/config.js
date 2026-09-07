// =========================================================
// إعدادات الاتصال بـ Supabase
// ضع هنا رابط مشروعك ومفتاح anon public اللي تحصل عليهم من:
// Supabase Dashboard -> Project Settings -> API
// =========================================================

const SUPABASE_CONFIG = {
  url: "https://tdpjwsrgnciphdjrdpfl.supabase.co", // <-- غيّر هذا
  anonKey: "sb_publishable_MuRTYFnVwS9YFpzVplJM5g_-yYgeZzx", // <-- غيّر هذا
};

// اسم الجدول الموحد للطلبات (يطابق البوت الحالي)
const ORDERS_TABLE = "orders";

// =========================================================
// إعدادات سيرفر ربط واتساب (Backend منفصل يعمل على Fly.io)
// =========================================================
const LINK_SERVER = {
  // رابط السيرفر بعد نشره على Fly.io، مثال: https://whatsapp-link-server.fly.dev
  baseUrl: "https://whatsapp-link-server.fly.dev",
  // نفس القيمة الموجودة بملف .env الخاص بالسيرفر (LINK_SERVER_SECRET)
  secret: "NewMohammed2027",
};
