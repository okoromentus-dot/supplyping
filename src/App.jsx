import { useState, useEffect } from "react";
import { supabase } from "./supabase.js";

// ── CONFIG ──
import emailjs from "@emailjs/browser";
const EMAILJS_SERVICE = "service_np65zh6";
const EMAILJS_TEMPLATE = "template_58s7r9h";
const EMAILJS_PUBLIC_KEY = "sVz8ve1fsqueZatOT";
const MANAGEMENT_EMAIL = "hello@supplyping.com";

// Build marker — bump when triggering redeploys; visible in browser console.
const BUILD_VERSION = "2026-07-26-schema-aligned";
try { console.log(`[SupplyPing] build ${BUILD_VERSION} — schema aligned`); } catch (e) {}

// Initialize EmailJS once at startup
try { emailjs.init(EMAILJS_PUBLIC_KEY); } catch (e) {}

// ── PHOTO CAPTURE (Supabase Storage bucket: report-photos) ──
// Compresses to ~1000px client-side so uploads are fast on facility Wi-Fi and
// never bloat the offline queue. Returns a public URL, or null on failure.
async function compressImage(file, maxDim = 1000, quality = 0.75) {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => resolve(blob), "image/jpeg", quality);
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.src = url;
  });
}

// Sends the compressed photo to our serverless function for AI triage.
// Fails soft: on any error the worker just fills the form manually.
async function analyzeHazardPhoto(file, lang) {
  try {
    const blob = await compressImage(file, 800, 0.7);
    if (!blob) return null;
    const b64 = await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(",")[1]);
      r.onerror = () => res(null);
      r.readAsDataURL(blob);
    });
    if (!b64) { console.error("[AI] Could not read/compress image"); return { _error: "Could not read the photo" }; }
    const resp = await fetch("/api/analyze-hazard", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: b64, mediaType: "image/jpeg", lang: lang || "en" }),
    });
    let data = null;
    try { data = await resp.json(); } catch (e) {
      console.error("[AI] Non-JSON response from /api/analyze-hazard — status", resp.status, "(if status is 200 with HTML, the vercel.json rewrite is swallowing /api routes)");
      return { _error: `Server returned status ${resp.status} (not JSON)` };
    }
    if (!resp.ok) {
      console.error("[AI] /api/analyze-hazard error:", resp.status, data);
      const msg = [data.error, data.detail].filter(Boolean).join(" — ");
      return { _error: msg || `Request failed (${resp.status})` };
    }
    console.log("[AI] analysis result:", data);
    return data;
  } catch (e) { console.error("[AI] fetch failed:", e); return { _error: "Network error reaching AI service" }; }
}

async function uploadReportPhoto(file) {
  try {
    const blob = await compressImage(file);
    if (!blob) return null;
    const name = `report-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { error } = await supabase.storage.from("report-photos").upload(name, blob, { contentType: "image/jpeg" });
    if (error) { console.log("Photo upload error:", error); return null; }
    const { data } = supabase.storage.from("report-photos").getPublicUrl(name);
    return data?.publicUrl || null;
  } catch (e) { console.log("Photo upload error:", e); return null; }
}

const AIRTABLE_TOKEN = "patkVT1Wc5FP40iAq.f98ab9293b37172e41e3d7a1ce3b58ce2ebcdc1b2b55aeff15a5b47198194d77";
const AIRTABLE_BASE = "appOkUWfKR5sb2Br4";

const WEB3FORMS_KEY = "7f502c28-1de9-4159-807c-773d5f4d5cbb";

// ── OFFLINE-FIRST REPORT QUEUE ──
// Restrooms & supply rooms are signal dead zones. If a worker submits while
// offline, we stash the payload in localStorage and flush it automatically the
// moment connectivity returns.
const QUEUE_KEY = "supplyping_offline_queue";

function readQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) { return []; }
}

function writeQueue(queue) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)); } catch (e) {}
}

function queueReport(payload) {
  const queue = readQueue();
  queue.push({ params: payload, savedAt: Date.now() });
  writeQueue(queue);
}

// The single sender — sends the alert via EmailJS.
// The payload's cleaning_email maps to the {{cleaning_email}} template variable
// (also sent as to_email and email so the template's "To Email" matches
// regardless of which variable name it uses).
async function postToFormspree(payload) {
  return emailjs.send(EMAILJS_SERVICE, EMAILJS_TEMPLATE, payload);
}

// Sends an alert if online; queues it to localStorage if offline or on failure.
// Returns: { status: "sent" } | { status: "offline" } | { status: "failed", error }
async function sendOrQueueAlert(payload) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    queueReport(payload);
    return { status: "offline" };
  }
  try {
    await postToFormspree(payload);
    return { status: "sent" };
  } catch (e) {
    queueReport(payload);
    // Surface the real EmailJS rejection so it can be diagnosed
    const msg = (e && (e.text || e.message)) ? (e.text || e.message) : JSON.stringify(e);
    return { status: "failed", error: msg };
  }
}

// Flush every queued report back to Formspree. Re-queues any that still fail.
async function flushQueue() {
  const queue = readQueue();
  if (queue.length === 0) return 0;
  const remaining = [];
  let flushed = 0;
  for (const entry of queue) {
    try {
      await postToFormspree(entry.params);
      flushed++;
    } catch (e) {
      remaining.push(entry);
    }
  }
  writeQueue(remaining);
  return flushed;
}

// ── DESIGN TOKENS ──
const T = {
  ink: "#1A1814", cream: "#F8F7F4", white: "#FFFFFF", border: "#E8E5DF",
  muted: "#9B9690", dim: "#C8C5BE",
  orange: "#EA580C", orangeLight: "#FFF7ED", orangeBorder: "#FED7AA",
  green: "#16A34A", greenLight: "#F0FDF4", greenBorder: "#BBF7D0",
  red: "#DC2626", redLight: "#FEF2F2", redBorder: "#FECACA",
  yellow: "#D97706", yellowLight: "#FFFBEB", yellowBorder: "#FDE68A",
  blue: "#2563EB", blueLight: "#EFF6FF", blueBorder: "#BFDBFE",
  purple: "#7C3AED", purpleLight: "#F5F3FF", purpleBorder: "#DDD6FE",
  shadow: "0 1px 3px rgba(0,0,0,0.06), 0 4px 16px rgba(0,0,0,0.06)",
  shadowMd: "0 4px 24px rgba(0,0,0,0.10)",
  shadowLg: "0 8px 48px rgba(0,0,0,0.14)",
};

const font = {
  display: "'Playfair Display', Georgia, serif",
  body: "'DM Sans', system-ui, sans-serif",
};

const INDUSTRIES = [
  { id: "warehouse", emoji: "🏭", label: "Warehouse / Logistics" },
  { id: "hotel", emoji: "🏨", label: "Hotel / Hospitality" },
  { id: "boutique", emoji: "🏩", label: "Boutique Hotel" },
  { id: "school", emoji: "🏫", label: "School" },
  { id: "university", emoji: "🎓", label: "University" },
  { id: "gym", emoji: "💪", label: "Gym / Fitness Center" },
  { id: "hospital", emoji: "🏥", label: "Hospital" },
  { id: "clinic", emoji: "🩺", label: "Clinic" },
  { id: "commercial", emoji: "🏢", label: "Commercial Building" },
  { id: "retail", emoji: "🛍️", label: "Retail / Shopping" },
  { id: "restaurant", emoji: "🍽️", label: "Restaurant / Events" },
  { id: "residential", emoji: "🏘️", label: "Residential Complex" },
  { id: "airport", emoji: "✈️", label: "Airport / Transit" },
  { id: "sports", emoji: "🏟️", label: "Sports Arena / Stadium" },
  { id: "government", emoji: "🏛️", label: "Government Building" },
  { id: "other", emoji: "➕", label: "Others" },
];

// ── REPORT CATEGORIES (safety-forward; Safety is the flagship) ──
const SUPPLY_CATEGORIES = [
  {
    id: "safety", label: "⚠️ Safety & Hazards", color: T.red, bg: T.redLight, border: T.redBorder,
    items: [
      { id: "spill", emoji: "💧", label: "Wet Floor / Spill" },
      { id: "blocked", emoji: "🚪", label: "Blocked Exit / Aisle" },
      { id: "hazard", emoji: "⚠️", label: "Trip / Fall Hazard" },
      { id: "nearmiss", emoji: "❗", label: "Near-Miss / Incident" },
      { id: "ppe", emoji: "🦺", label: "PPE / Equipment Unsafe" },
    ]
  },
  {
    id: "security", label: "🔒 Security & Facilities", color: T.purple, bg: T.purpleLight, border: T.purpleBorder,
    items: [
      { id: "access", emoji: "🚷", label: "Access / Door Issue" },
      { id: "damage", emoji: "🧱", label: "Property Damage" },
      { id: "suspicious", emoji: "👁️", label: "Suspicious Activity" },
    ]
  },
  {
    id: "maint", label: "🔧 Maintenance & Repairs", color: T.yellow, bg: T.yellowLight, border: T.yellowBorder,
    items: [
      { id: "lights", emoji: "💡", label: "Lighting Out / Flickering" },
      { id: "hvac", emoji: "🌡️", label: "HVAC / Temperature Issue" },
      { id: "fixture", emoji: "🔧", label: "Broken Fixture / Door" },
      { id: "equipment", emoji: "🛠️", label: "Equipment Issue" },
    ]
  },
  {
    id: "clean", label: "🧹 Cleaning & Sanitation", color: T.green, bg: T.greenLight, border: T.greenBorder,
    items: [
      { id: "spillclean", emoji: "🧹", label: "Spill / Mess Needs Cleanup" },
      { id: "restroomclean", emoji: "🚻", label: "Restroom Needs Attention" },
      { id: "trash", emoji: "🗑️", label: "Trash / Bins Full" },
    ]
  },
  {
    id: "supply", label: "🧻 Supplies", color: T.blue, bg: T.blueLight, border: T.blueBorder,
    items: [
      { id: "soap", emoji: "🧼", label: "No Soap" },
      { id: "towels", emoji: "🖐️", label: "No Paper Towels" },
      { id: "tp", emoji: "🧻", label: "No Toilet Paper" },
      { id: "sanitizer", emoji: "🧴", label: "No Hand Sanitizer" },
      { id: "breakroom", emoji: "☕", label: "Breakroom Restock" },
    ]
  },
];

const SUPPLIES = SUPPLY_CATEGORIES.flatMap(cat =>
  cat.items.map(item => ({ ...item, category: cat.id, color: cat.color, bg: cat.bg, border: cat.border }))
);

const WAREHOUSE_CATEGORIES = [
  {
    id: "warehouse", label: "🏭 Warehouse Issues", color: T.red, bg: T.redLight, border: T.redBorder,
    items: [
      { id: "spill", emoji: "💧", label: "Wet Floor / Spill" },
      { id: "blocked", emoji: "🚪", label: "Blocked Exit / Aisle" },
      { id: "hazard", emoji: "⚠️", label: "Trip / Fall Hazard" },
      { id: "tape", emoji: "🏷️", label: "Tape / Labels Low" },
      { id: "equipment", emoji: "🛠️", label: "Equipment Issue" },
    ]
  },
];

const RESTROOM_CATEGORIES = [SUPPLY_CATEGORIES.find(c => c.id === "supply")];
const ALL_ITEMS = [...SUPPLY_CATEGORIES, ...WAREHOUSE_CATEGORIES].flatMap(c => c.items);

function getReportCategories(assetType) {
  switch ((assetType || "").toLowerCase()) {
    case "warehouse": return WAREHOUSE_CATEGORIES;
    case "safety": return [SUPPLY_CATEGORIES.find(c => c.id === "safety")];
    case "restroom":
    case "supply": return RESTROOM_CATEGORIES;
    default: return SUPPLY_CATEGORIES;
  }
}

// ── WORKER LANGUAGES (report page). Labels stay canonical English in
// payloads/emails; translation is display-only, plus free-text translation
// to English at submit via /api/translate. ──
const LANGS = [
  { id: "en", label: "English", voice: "en-US" },
  { id: "es", label: "Español", voice: "es-MX" },
  { id: "fr", label: "Français", voice: "fr-FR" },
  { id: "ar", label: "العربية", voice: "ar-SA" },
  { id: "bn", label: "বাংলা", voice: "bn-BD" },
  { id: "hi", label: "हिन्दी", voice: "hi-IN" },
  { id: "zh", label: "中文", voice: "zh-CN" },
];

const TR = {
  es: { "Safety & Hazards": "Seguridad y Peligros", "Security & Facilities": "Vigilancia e Instalaciones", "Maintenance & Repairs": "Mantenimiento y Reparaciones", "Cleaning & Sanitation": "Limpieza e Higiene", "Supplies": "Suministros", "Wet Floor / Spill": "Piso Mojado / Derrame", "Blocked Exit / Aisle": "Salida / Pasillo Bloqueado", "Trip / Fall Hazard": "Riesgo de Tropiezo / Caída", "Near-Miss / Incident": "Casi Accidente / Incidente", "PPE / Equipment Unsafe": "EPP / Equipo Inseguro", "Access / Door Issue": "Problema de Acceso / Puerta", "Property Damage": "Daño a la Propiedad", "Suspicious Activity": "Actividad Sospechosa", "Lighting Out / Flickering": "Luz Apagada / Parpadeante", "HVAC / Temperature Issue": "Problema de Clima / Temperatura", "Broken Fixture / Door": "Accesorio / Puerta Rota", "Equipment Issue": "Problema de Equipo", "Spill / Mess Needs Cleanup": "Derrame / Suciedad por Limpiar", "Restroom Needs Attention": "Baño Necesita Atención", "Trash / Bins Full": "Basura / Botes Llenos", "No Soap": "Sin Jabón", "No Paper Towels": "Sin Toallas de Papel", "No Toilet Paper": "Sin Papel Higiénico", "No Hand Sanitizer": "Sin Desinfectante", "Breakroom Restock": "Reabastecer Comedor", "Report a Facility Issue": "Reportar un Problema", "Select the issue(s). Takes 10 seconds.": "Seleccione el problema. Toma 10 segundos.", "Select one or more issues, then tap Send": "Seleccione y toque Enviar", "Other / Custom Issue": "Otro Problema", "Describe any other issue here...": "Describa el problema aquí...", "Add a Photo (optional)": "Agregar Foto (opcional)", "Take Photo": "Tomar Foto", "From Library": "De la Galería", "Send Report →": "Enviar Reporte →", "Sending...": "Enviando...", "Report Sent!": "¡Reporte Enviado!", "The team has been notified and is on the way.": "El equipo ha sido notificado y va en camino.", "Report Another Issue": "Reportar Otro Problema", "Speak": "Hablar", "Listening...": "Escuchando...", "Low": "Baja", "Medium": "Media", "High": "Alta", "AI Suggestion — review & confirm": "Sugerencia IA — revise y confirme", "Suggested severity": "Severidad sugerida", "Description (editable)": "Descripción (editable)"  },
  fr: { "Safety & Hazards": "Sécurité et Dangers", "Security & Facilities": "Sûreté et Installations", "Maintenance & Repairs": "Maintenance et Réparations", "Cleaning & Sanitation": "Nettoyage et Hygiène", "Supplies": "Fournitures", "Wet Floor / Spill": "Sol Mouillé / Déversement", "Blocked Exit / Aisle": "Sortie / Allée Bloquée", "Trip / Fall Hazard": "Risque de Chute", "Near-Miss / Incident": "Quasi-Accident / Incident", "PPE / Equipment Unsafe": "EPI / Équipement Dangereux", "Access / Door Issue": "Problème d'Accès / Porte", "Property Damage": "Dommage Matériel", "Suspicious Activity": "Activité Suspecte", "Lighting Out / Flickering": "Éclairage Éteint / Clignotant", "HVAC / Temperature Issue": "Problème CVC / Température", "Broken Fixture / Door": "Équipement / Porte Cassée", "Equipment Issue": "Problème d'Équipement", "Spill / Mess Needs Cleanup": "Déversement / Saleté à Nettoyer", "Restroom Needs Attention": "Toilettes à Vérifier", "Trash / Bins Full": "Poubelles Pleines", "No Soap": "Pas de Savon", "No Paper Towels": "Pas d'Essuie-tout", "No Toilet Paper": "Pas de Papier Toilette", "No Hand Sanitizer": "Pas de Gel Désinfectant", "Breakroom Restock": "Réappro Salle de Pause", "Report a Facility Issue": "Signaler un Problème", "Select the issue(s). Takes 10 seconds.": "Sélectionnez le problème. 10 secondes.", "Select one or more issues, then tap Send": "Sélectionnez puis appuyez Envoyer", "Other / Custom Issue": "Autre Problème", "Describe any other issue here...": "Décrivez le problème ici...", "Add a Photo (optional)": "Ajouter une Photo (optionnel)", "Take Photo": "Prendre une Photo", "From Library": "De la Galerie", "Send Report →": "Envoyer →", "Sending...": "Envoi...", "Report Sent!": "Signalement Envoyé !", "The team has been notified and is on the way.": "L'équipe a été notifiée et arrive.", "Report Another Issue": "Signaler un Autre Problème", "Speak": "Parler", "Listening...": "Écoute...", "Low": "Faible", "Medium": "Moyen", "High": "Élevé", "AI Suggestion — review & confirm": "Suggestion IA — vérifiez et confirmez", "Suggested severity": "Gravité suggérée", "Description (editable)": "Description (modifiable)"  },
  ar: { "Safety & Hazards": "السلامة والمخاطر", "Security & Facilities": "الأمن والمرافق", "Maintenance & Repairs": "الصيانة والإصلاحات", "Cleaning & Sanitation": "التنظيف والنظافة", "Supplies": "المستلزمات", "Wet Floor / Spill": "أرضية مبللة / انسكاب", "Blocked Exit / Aisle": "مخرج / ممر مسدود", "Trip / Fall Hazard": "خطر التعثر / السقوط", "Near-Miss / Incident": "حادث وشيك / واقعة", "PPE / Equipment Unsafe": "معدات وقاية غير آمنة", "Access / Door Issue": "مشكلة دخول / باب", "Property Damage": "أضرار بالممتلكات", "Suspicious Activity": "نشاط مشبوه", "Lighting Out / Flickering": "إضاءة مطفأة / وامضة", "HVAC / Temperature Issue": "مشكلة تكييف / حرارة", "Broken Fixture / Door": "تركيبات / باب مكسور", "Equipment Issue": "مشكلة معدات", "Spill / Mess Needs Cleanup": "انسكاب يحتاج تنظيف", "Restroom Needs Attention": "دورة المياه تحتاج عناية", "Trash / Bins Full": "سلال القمامة ممتلئة", "No Soap": "لا يوجد صابون", "No Paper Towels": "لا توجد مناشف ورقية", "No Toilet Paper": "لا يوجد ورق تواليت", "No Hand Sanitizer": "لا يوجد معقم", "Breakroom Restock": "تزويد غرفة الاستراحة", "Report a Facility Issue": "الإبلاغ عن مشكلة", "Select the issue(s). Takes 10 seconds.": "اختر المشكلة. يستغرق 10 ثوانٍ.", "Select one or more issues, then tap Send": "اختر ثم اضغط إرسال", "Other / Custom Issue": "مشكلة أخرى", "Describe any other issue here...": "صف المشكلة هنا...", "Add a Photo (optional)": "أضف صورة (اختياري)", "Take Photo": "التقط صورة", "From Library": "من المعرض", "Send Report →": "إرسال البلاغ", "Sending...": "جارٍ الإرسال...", "Report Sent!": "تم إرسال البلاغ!", "The team has been notified and is on the way.": "تم إخطار الفريق وهو في الطريق.", "Report Another Issue": "الإبلاغ عن مشكلة أخرى", "Speak": "تحدث", "Listening...": "يستمع...", "Low": "منخفض", "Medium": "متوسط", "High": "مرتفع", "AI Suggestion — review & confirm": "اقتراح الذكاء الاصطناعي — راجع وأكد", "Suggested severity": "الخطورة المقترحة", "Description (editable)": "الوصف (قابل للتعديل)"  },
  bn: { "Safety & Hazards": "নিরাপত্তা ও ঝুঁকি", "Security & Facilities": "সিকিউরিটি ও ফ্যাসিলিটি", "Maintenance & Repairs": "রক্ষণাবেক্ষণ ও মেরামত", "Cleaning & Sanitation": "পরিচ্ছন্নতা ও স্যানিটেশন", "Supplies": "সরবরাহ", "Wet Floor / Spill": "ভেজা মেঝে / ছলকে পড়া", "Blocked Exit / Aisle": "অবরুদ্ধ প্রস্থান / পথ", "Trip / Fall Hazard": "হোঁচট / পড়ার ঝুঁকি", "Near-Miss / Incident": "প্রায়-দুর্ঘটনা / ঘটনা", "PPE / Equipment Unsafe": "পিপিই / অনিরাপদ সরঞ্জাম", "Access / Door Issue": "প্রবেশ / দরজার সমস্যা", "Property Damage": "সম্পত্তির ক্ষতি", "Suspicious Activity": "সন্দেহজনক কার্যকলাপ", "Lighting Out / Flickering": "লাইট নষ্ট / ঝিকমিক", "HVAC / Temperature Issue": "এসি / তাপমাত্রার সমস্যা", "Broken Fixture / Door": "ভাঙা ফিক্সচার / দরজা", "Equipment Issue": "সরঞ্জামের সমস্যা", "Spill / Mess Needs Cleanup": "পরিষ্কার প্রয়োজন", "Restroom Needs Attention": "টয়লেটে মনোযোগ প্রয়োজন", "Trash / Bins Full": "ময়লার ঝুড়ি ভর্তি", "No Soap": "সাবান নেই", "No Paper Towels": "কাগজের তোয়ালে নেই", "No Toilet Paper": "টয়লেট পেপার নেই", "No Hand Sanitizer": "স্যানিটাইজার নেই", "Breakroom Restock": "ব্রেকরুম রিস্টক", "Report a Facility Issue": "সমস্যা রিপোর্ট করুন", "Select the issue(s). Takes 10 seconds.": "সমস্যা নির্বাচন করুন। ১০ সেকেন্ড লাগে।", "Select one or more issues, then tap Send": "নির্বাচন করে পাঠান চাপুন", "Other / Custom Issue": "অন্যান্য সমস্যা", "Describe any other issue here...": "সমস্যাটি এখানে লিখুন...", "Add a Photo (optional)": "ছবি যোগ করুন (ঐচ্ছিক)", "Take Photo": "ছবি তুলুন", "From Library": "গ্যালারি থেকে", "Send Report →": "রিপোর্ট পাঠান →", "Sending...": "পাঠানো হচ্ছে...", "Report Sent!": "রিপোর্ট পাঠানো হয়েছে!", "The team has been notified and is on the way.": "টিমকে জানানো হয়েছে, তারা আসছে।", "Report Another Issue": "আরেকটি সমস্যা রিপোর্ট করুন", "Speak": "বলুন", "Listening...": "শোনা হচ্ছে...", "Low": "কম", "Medium": "মাঝারি", "High": "উচ্চ", "AI Suggestion — review & confirm": "এআই পরামর্শ — যাচাই করুন", "Suggested severity": "প্রস্তাবিত মাত্রা", "Description (editable)": "বিবরণ (সম্পাদনাযোগ্য)"  },
  hi: { "Safety & Hazards": "सुरक्षा और खतरे", "Security & Facilities": "सिक्योरिटी और सुविधाएँ", "Maintenance & Repairs": "रखरखाव और मरम्मत", "Cleaning & Sanitation": "सफ़ाई और स्वच्छता", "Supplies": "सामग्री", "Wet Floor / Spill": "गीला फ़र्श / रिसाव", "Blocked Exit / Aisle": "अवरुद्ध निकास / गलियारा", "Trip / Fall Hazard": "ठोकर / गिरने का खतरा", "Near-Miss / Incident": "निकट-चूक / घटना", "PPE / Equipment Unsafe": "पीपीई / असुरक्षित उपकरण", "Access / Door Issue": "प्रवेश / दरवाज़े की समस्या", "Property Damage": "संपत्ति क्षति", "Suspicious Activity": "संदिग्ध गतिविधि", "Lighting Out / Flickering": "लाइट बंद / टिमटिमाती", "HVAC / Temperature Issue": "एसी / तापमान समस्या", "Broken Fixture / Door": "टूटा उपकरण / दरवाज़ा", "Equipment Issue": "उपकरण समस्या", "Spill / Mess Needs Cleanup": "सफ़ाई की ज़रूरत", "Restroom Needs Attention": "शौचालय पर ध्यान दें", "Trash / Bins Full": "कूड़ेदान भरे हैं", "No Soap": "साबुन नहीं है", "No Paper Towels": "पेपर टॉवल नहीं है", "No Toilet Paper": "टॉयलेट पेपर नहीं है", "No Hand Sanitizer": "सैनिटाइज़र नहीं है", "Breakroom Restock": "ब्रेकरूम रीस्टॉक", "Report a Facility Issue": "समस्या रिपोर्ट करें", "Select the issue(s). Takes 10 seconds.": "समस्या चुनें। 10 सेकंड लगते हैं।", "Select one or more issues, then tap Send": "चुनें और भेजें दबाएँ", "Other / Custom Issue": "अन्य समस्या", "Describe any other issue here...": "समस्या यहाँ लिखें...", "Add a Photo (optional)": "फ़ोटो जोड़ें (वैकल्पिक)", "Take Photo": "फ़ोटो लें", "From Library": "गैलरी से", "Send Report →": "रिपोर्ट भेजें →", "Sending...": "भेजा जा रहा है...", "Report Sent!": "रिपोर्ट भेज दी गई!", "The team has been notified and is on the way.": "टीम को सूचित कर दिया गया है।", "Report Another Issue": "एक और समस्या रिपोर्ट करें", "Speak": "बोलें", "Listening...": "सुन रहा है...", "Low": "कम", "Medium": "मध्यम", "High": "उच्च", "AI Suggestion — review & confirm": "एआई सुझाव — जाँचें और पुष्टि करें", "Suggested severity": "सुझाई गई गंभीरता", "Description (editable)": "विवरण (संपादन योग्य)"  },
  zh: { "Safety & Hazards": "安全与隐患", "Security & Facilities": "安保与设施", "Maintenance & Repairs": "维护与维修", "Cleaning & Sanitation": "清洁与卫生", "Supplies": "物资", "Wet Floor / Spill": "地面湿滑 / 洒漏", "Blocked Exit / Aisle": "出口 / 通道堵塞", "Trip / Fall Hazard": "绊倒 / 跌倒风险", "Near-Miss / Incident": "险情 / 事故", "PPE / Equipment Unsafe": "防护装备不安全", "Access / Door Issue": "门禁 / 门的问题", "Property Damage": "财产损坏", "Suspicious Activity": "可疑活动", "Lighting Out / Flickering": "灯光故障 / 闪烁", "HVAC / Temperature Issue": "空调 / 温度问题", "Broken Fixture / Door": "设施 / 门损坏", "Equipment Issue": "设备问题", "Spill / Mess Needs Cleanup": "需要清理", "Restroom Needs Attention": "洗手间需要处理", "Trash / Bins Full": "垃圾桶已满", "No Soap": "没有肥皂", "No Paper Towels": "没有纸巾", "No Toilet Paper": "没有厕纸", "No Hand Sanitizer": "没有消毒液", "Breakroom Restock": "休息室补货", "Report a Facility Issue": "报告设施问题", "Select the issue(s). Takes 10 seconds.": "选择问题,只需10秒。", "Select one or more issues, then tap Send": "选择后点击发送", "Other / Custom Issue": "其他问题", "Describe any other issue here...": "在此描述问题...", "Add a Photo (optional)": "添加照片(可选)", "Take Photo": "拍照", "From Library": "从相册选择", "Send Report →": "发送报告 →", "Sending...": "发送中...", "Report Sent!": "报告已发送!", "The team has been notified and is on the way.": "团队已收到通知,正在处理。", "Report Another Issue": "报告另一个问题", "Speak": "说话", "Listening...": "正在听...", "Low": "低", "Medium": "中", "High": "高", "AI Suggestion — review & confirm": "AI 建议 — 请确认", "Suggested severity": "建议严重程度", "Description (editable)": "描述(可编辑)" },
};

// Translate a plain string; returns English when no translation exists.
function tr(lang, s) { return (TR[lang] && TR[lang][s]) || s; }
// Translate a label that may carry a leading emoji (category labels).
function trL(lang, label) {
  const m = String(label).match(/^([^A-Za-z\u0600-\u06FF]*)(.*)$/);
  return m ? m[1] + tr(lang, m[2]) : tr(lang, label);
}

const AREA_TYPES = [
  { id: "default", label: "All Categories (default)" },
  { id: "safety", label: "⚠️ Safety Zone" },
  { id: "warehouse", label: "🏭 Warehouse Floor" },
  { id: "supply", label: "🧻 Restroom / Supplies" },
];

const buildFormUrl = (cleaningEmail, locationName, roomName, stallNum, bizNameVal, categoryVal) => {
  const base = "https://supplyping.com/r";
  const params = new URLSearchParams();
  if (cleaningEmail) params.set("ce", cleaningEmail);
  if (locationName) params.set("l", locationName);
  if (roomName) params.set("r", roomName);
  if (stallNum) params.set("s", stallNum);
  if (bizNameVal) params.set("b", bizNameVal);
  if (categoryVal && categoryVal !== "default") params.set("category", categoryVal);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
};

const qr = (url, size = 130) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}&color=1A1814&bgcolor=F8F7F4&margin=8`;

// ── AIRTABLE ──
// Fetch ONLY this tenant's reports. Scoping happens in the Airtable query
// itself (filterByFormula), so other clients' data never reaches the browser.
// scope = { emails: [alert email, login email], location: facility name }
function buildScopeFormula(scope) {
  const esc = (s) => String(s || "").replace(/["\\]/g, "").toLowerCase().trim();
  const parts = [];
  (scope?.emails || []).map(esc).filter(Boolean).forEach(e => parts.push(`LOWER(TRIM({Cleaning Team Email}))="${e}"`));
  const loc = esc(scope?.location);
  if (loc) parts.push(`LOWER(TRIM({Location}))="${loc}"`);
  // Room names persist reliably in the client's Locations JSON, so they're the
  // most dependable tenant key even when profile fields are blank.
  (scope?.rooms || []).map(esc).filter(Boolean).slice(0, 20).forEach(r => parts.push(`LOWER(TRIM({Room}))="${r}"`));
  if (parts.length === 0) return null; // no identity → fetch nothing, never everything
  return parts.length === 1 ? parts[0] : `OR(${parts.join(",")})`;
}

async function fetchReports(scope) {
  try {
    const formula = buildScopeFormula(scope);
    if (!formula) { console.warn("[Dashboard] No tenant identifiers yet — skipping fetch."); return []; }
    const ff = `filterByFormula=${encodeURIComponent(formula)}`;
    let res = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE}/Reports?${ff}&sort[0][field]=Created Time&sort[0][direction]=desc&maxRecords=50`,
      { headers: { "Authorization": `Bearer ${AIRTABLE_TOKEN}` } }
    );
    let data = await res.json();
    if (!res.ok || !data.records) {
      console.error("[Dashboard] Sorted Airtable query failed:", res.status, data.error || data);
      res = await fetch(
        `https://api.airtable.com/v0/${AIRTABLE_BASE}/Reports?${ff}&maxRecords=50`,
        { headers: { "Authorization": `Bearer ${AIRTABLE_TOKEN}` } }
      );
      data = await res.json();
      if (!res.ok || !data.records) {
        console.error("[Dashboard] Airtable read failed entirely:", res.status, data.error || data);
        return [];
      }
      data.records.sort((a, b) => new Date(b.fields["Reported At"] || b.fields["Created Time"] || 0) - new Date(a.fields["Reported At"] || a.fields["Created Time"] || 0));
    }
    if (!data.records) return [];
    if (data.records.length === 0) {
      // Nothing matched the scope — log a sample of actual rows so the
      // mismatch (Location/Room/Email differences) is visible, not mysterious.
      try {
        const dbg = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/Reports?maxRecords=3&sort[0][field]=Created Time&sort[0][direction]=desc`, { headers: { "Authorization": `Bearer ${AIRTABLE_TOKEN}` } });
        const dj = await dbg.json();
        const sample = (dj.records || []).map(r => ({ Location: r.fields["Location"] || "(blank)", Room: r.fields["Room"] || "(blank)", CleaningTeamEmail: r.fields["Cleaning Team Email"] || "(blank)" }));
        // JSON.stringify so a plain copy-paste of the console shows full values —
        // no expanding collapsed "Array(2)"/"{...}" placeholders required.
        console.warn("[Dashboard] ZERO MATCH — FULL DUMP:\n  MY SCOPE = " + JSON.stringify(scope) + "\n  ACTUAL ROWS IN TABLE = " + JSON.stringify(sample));
      } catch (e) {}
    }
    return data.records.map(r => {
      const status = r.fields["Status"] || "";
      const supply = ALL_ITEMS.find(s => status.includes(s.label)) || { emoji: "📋", label: status || "Issue", color: T.orange, bg: T.orangeLight, border: T.orangeBorder, id: "general" };
      const createdAt = r.fields["Created Time"] ? new Date(r.fields["Created Time"]) : new Date();
      const diff = Math.round((Date.now() - createdAt.getTime()) / 60000);
      const timeAgo = diff < 1 ? "just now" : diff < 60 ? `${diff} min ago` : diff < 1440 ? `${Math.round(diff/60)} hr ago` : `${Math.round(diff/1440)}d ago`;
      return {
        id: r.id,
        room: r.fields["Room"] || "Unknown Room",
        stall: r.fields["Stall"] || "General",
        location: r.fields["Location"] || "",
        cleaningEmail: r.fields["Cleaning Team Email"] || "",
        status,
        supply,
        time: timeAgo,
        resolved: r.fields["Resolved"] || false,
      };
    });
  } catch (e) { return []; }
}

async function submitReportToAirtable(fields, attemptLabel = "write") {
  try {
    const res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/Reports`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields })
    });
    if (!res.ok) {
      // Airtable rejects the WHOLE row for one bad field (unknown name, or a
      // single-select value that isn't a configured option). Log the exact
      // reason — a silent failure here looks identical to an empty dashboard.
      const err = await res.json().catch(() => ({}));
      console.error(`[Airtable] REJECTED attempt "${attemptLabel}" —`, res.status,
        JSON.stringify(err.error || err),
        "| fields sent:", JSON.stringify(Object.keys(fields)),
        "| values:", JSON.stringify(fields));
      return false;
    }
    const saved = await res.json().catch(() => ({}));
    console.log(`[Airtable] Row created ✓ via "${attemptLabel}" — id:`, saved.id || "(unknown)");
    return true;
  } catch (e) { console.error("[Airtable] Network error on report write:", e); return false; }
}

async function resolveInAirtable(id) {
  try {
    // Resolving returns the room to normal operation. Bathroom Status is sent
    // alongside Resolved; if that field is absent the retry below still saves
    // the resolution itself so a fix is never lost to a schema mismatch.
    let res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/Reports/${id}`, {
      method: "PATCH",
      headers: { "Authorization": `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { "Resolved": true, "Bathroom Status": "Open" } })
    });
    if (!res.ok) {
      res = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/Reports/${id}`, {
        method: "PATCH",
        headers: { "Authorization": `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ fields: { "Resolved": true } })
      });
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error("[Resolve] Airtable PATCH failed:", res.status, err.error || err);
      return { ok: false, error: (err.error && (err.error.message || err.error.type)) || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    console.error("[Resolve] Network error:", e);
    return { ok: false, error: "Network error" };
  }
}

// ── LOCATION PERSISTENCE (Clients table → "Locations" Long-text field) ──
async function findClientRecordId(email) {
  if (!email) return null;
  try {
    const res = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE}/Clients?filterByFormula=${encodeURIComponent(`{Email}="${email}"`)}`,
      { headers: { "Authorization": `Bearer ${AIRTABLE_TOKEN}` } }
    );
    const data = await res.json();
    return data.records && data.records.length > 0 ? data.records[0].id : null;
  } catch (e) { return null; }
}

// Writes the client profile. Airtable rejects the ENTIRE row for one bad field
// (unknown name, or a single-select value that isn't a configured option), so a
// silent failure here means the client's setup vanishes on their next login.
// Strategy: verify the response, and if the full write is rejected, retry with
// only the fields the app actually needs to restore a session.
async function writeClientFields(email, fields, label) {
  const recordId = await findClientRecordId(email);
  const url = recordId
    ? `https://api.airtable.com/v0/${AIRTABLE_BASE}/Clients/${recordId}`
    : `https://api.airtable.com/v0/${AIRTABLE_BASE}/Clients`;
  const body = recordId ? { fields } : { fields: { "Email": email, ...fields } };
  const res = await fetch(url, {
    method: recordId ? "PATCH" : "POST",
    headers: { "Authorization": `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error(`[Airtable] Client profile REJECTED (${label}) —`, res.status,
      JSON.stringify(err.error || err), "| fields sent:", JSON.stringify(Object.keys(body.fields)));
    return false;
  }
  console.log(`[Airtable] Client profile saved ✓ (${label})`);
  return true;
}

async function saveLocationsToAirtable(email, roomsArray, extra = {}) {
  if (!email) return false;
  const fields = { "Locations": JSON.stringify(roomsArray || []), ...extra };
  try {
    // Attempt 1: everything.
    if (await writeClientFields(email, fields, "full profile")) return true;

    // Attempt 2: only what a session restore genuinely requires. Drops the
    // likely offenders (Plan / Client Status / Industry single-selects).
    const essential = {};
    for (const k of ["Locations", "Facility Name", "Cleaning Team Email", "Business Name", "Phone Number"]) {
      if (fields[k] !== undefined) essential[k] = fields[k];
    }
    if (await writeClientFields(email, essential, "essential fields only")) return true;

    // Attempt 3: the absolute minimum that keeps the dashboard working.
    const minimal = {};
    for (const k of ["Locations", "Facility Name", "Cleaning Team Email"]) {
      if (fields[k] !== undefined) minimal[k] = fields[k];
    }
    return await writeClientFields(email, minimal, "minimal (locations + facility + email)");
  } catch (e) {
    console.error("[Airtable] Client profile network error:", e);
    return false;
  }
}

// Local profile backup — a fallback for session restore when the Airtable
// write was rejected. Never the source of truth; Airtable always wins.
function saveProfileBackup(email, profile) {
  try { localStorage.setItem(`sp_profile_${String(email).toLowerCase()}`, JSON.stringify(profile)); } catch (e) {}
}
function loadProfileBackup(email) {
  try {
    const raw = localStorage.getItem(`sp_profile_${String(email).toLowerCase()}`);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}

async function loadClientData(email) {
  if (!email) return null;
  try {
    const res = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE}/Clients?filterByFormula=${encodeURIComponent(`{Email}="${email}"`)}`,
      { headers: { "Authorization": `Bearer ${AIRTABLE_TOKEN}` } }
    );
    const data = await res.json();
    if (!data.records || data.records.length === 0) return null;
    const f = data.records[0].fields;
    let rooms = null;
    if (f["Locations"]) { try { rooms = JSON.parse(f["Locations"]); } catch (e) { rooms = null; } }
    return {
      rooms: Array.isArray(rooms) && rooms.length > 0 ? rooms : null,
      facility: f["Facility Name"] || "",
      cleaningEmail: f["Cleaning Team Email"] || "",
      bizName: f["Business Name"] || "",
      phone: f["Phone Number"] || "",
    };
  } catch (e) { return null; }
}

// ── UI PRIMITIVES ──
function Toast({ msg, color = T.ink }) {
  return (
    <div style={{ position: "fixed", top: 24, left: "50%", transform: "translateX(-50%)", background: color, color: T.white, borderRadius: 100, padding: "12px 28px", fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: T.shadowLg, maxWidth: "90%", textAlign: "center", fontFamily: font.body }}>
      {msg}
    </div>
  );
}

function Btn({ label, onClick, disabled, variant = "primary", size = "md", full }) {
  const base = { fontFamily: font.body, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", border: "none", borderRadius: 10, letterSpacing: 0.3, transition: "all 0.15s", width: full ? "100%" : "auto", display: "inline-block" };
  const sizes = { sm: { padding: "8px 16px", fontSize: 12 }, md: { padding: "12px 24px", fontSize: 14 }, lg: { padding: "16px 32px", fontSize: 16 } };
  const variants = {
    primary: { background: disabled ? T.dim : T.ink, color: T.white, boxShadow: disabled ? "none" : T.shadowMd },
    orange: { background: disabled ? T.dim : T.orange, color: T.white, boxShadow: disabled ? "none" : "0 4px 20px rgba(234,88,12,0.35)" },
    outline: { background: "transparent", color: T.ink, border: `2px solid ${T.border}` },
    green: { background: disabled ? T.dim : T.green, color: T.white, boxShadow: "0 4px 16px rgba(22,163,74,0.3)" },
    ghost: { background: "transparent", color: T.muted },
    red: { background: T.red, color: T.white },
  };
  return <button onClick={disabled ? undefined : onClick} style={{ ...base, ...sizes[size], ...variants[variant] }}>{label}</button>;
}

function Input({ label, value, onChange, placeholder, type = "text" }) {
  const [showPwd, setShowPwd] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword ? (showPwd ? "text" : "password") : type;
  return (
    <div style={{ marginBottom: 16 }}>
      {label && <label style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: 1.2, display: "block", marginBottom: 6, fontFamily: font.body, fontWeight: 500 }}>{label}</label>}
      <div style={{ position: "relative" }}>
        <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} type={inputType}
          style={{ width: "100%", border: `1.5px solid ${T.border}`, borderRadius: 10, padding: isPassword ? "12px 44px 12px 14px" : "12px 14px", fontFamily: font.body, fontSize: 14, color: T.ink, background: T.cream, boxSizing: "border-box", outline: "none" }} />
        {isPassword && (
          <button onClick={() => setShowPwd(p => !p)} type="button"
            style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", padding: "4px", color: T.muted, lineHeight: 1 }}>
            {showPwd ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

function Card({ children, style }) {
  return <div style={{ background: T.white, border: `1px solid ${T.border}`, borderRadius: 16, padding: 24, boxShadow: T.shadow, ...style }}>{children}</div>;
}

export default function App() {
  const [screen, setScreen] = useState("landing");
  const [step, setStep] = useState(1);
  const [alerts, setAlerts] = useState([]);
  const [toast, setToast] = useState(null);
  const [bizName, setBizName] = useState("");
  const [industry, setIndustry] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [location, setLocation] = useState("");
  const [rooms, setRooms] = useState([{ name: "Warehouse Floor", stalls: 2, category: "warehouse" }, { name: "Loading Dock", stalls: 1, category: "safety" }]);
  const [alertEmail, setAlertEmail] = useState("");
  const [alertPhone, setAlertPhone] = useState("");
  const [smsConsent, setSmsConsent] = useState(false);
  const [testSent, setTestSent] = useState(false);
  const [reportIssues, setReportIssues] = useState([]);
  const [otherText, setOtherText] = useState("");
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [sending, setSending] = useState(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState(null);
  const [aiSeverity, setAiSeverity] = useState("");
  const [aiDescription, setAiDescription] = useState("");
  const [reportLang, setReportLang] = useState("en");
  const [trialDaysLeft, setTrialDaysLeft] = useState(null); // null = unknown/loading
  const [listening, setListening] = useState(false);
  const [reportDone, setReportDone] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [loadingReports, setLoadingReports] = useState(false);
  const [qrBusiness, setQrBusiness] = useState("");
  const [qrLocation, setQrLocation] = useState("");
  const [qrRoom, setQrRoom] = useState("");
  const [qrStall, setQrStall] = useState("");
  const [qrCategory, setQrCategory] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [acctLoading, setAcctLoading] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSent, setFeedbackSent] = useState(false);

  const showToast = (msg, color) => { setToast({ msg, color }); setTimeout(() => setToast(null), 3500); };
  const totalQRs = rooms.reduce((s, r) => s + Number(r.stalls || 0), 0);
  // Scope reports to THIS client: match one of their location names, or
  // alerts addressed to their team/login email. (Without this every client
  // would see every other client's reports.)
  // Reports arrive already tenant-scoped from fetchReports (server-side
  // filterByFormula) — no client-side filtering needed.
  const open = alerts.filter(a => !a.resolved);
  const resolved = alerts.filter(a => a.resolved);

  const resolve = async (id) => {
    const item = alerts.find(a => a.id === id);
    setAlerts(p => p.map(a => a.id === id ? { ...a, resolved: true } : a));
    const result = await resolveInAirtable(id);
    if (!result.ok) {
      // Persistence failed — revert the optimistic update and say why,
      // otherwise the "resolved" state silently reappears on next login.
      setAlerts(p => p.map(a => a.id === id ? { ...a, resolved: false } : a));
      showToast(`❌ Couldn't save resolve: ${result.error}. Check the "Resolved" field (checkbox type) in Airtable.`, T.red);
      return;
    }
    // Notify the team + management that the issue is closed
    if (item) {
      const recipients = [item.cleaningEmail, MANAGEMENT_EMAIL].filter(Boolean).join(", ");
      sendOrQueueAlert({
        cleaning_email: recipients, to_email: recipients, email: recipients,
        issue: `✅ RESOLVED: ${item.status || item.supply.label}`,
        location: item.location || "",
        location_name: item.location || "", room: item.room, stall: item.stall,
        business: bizName || email, time: new Date().toLocaleString(),
      });
    }
    showToast("✅ Resolved — team notified!", T.green);
  };

  const addRoom = () => setRooms(p => [...p, { name: "", stalls: 1, category: "default" }]);
  const updateRoom = (i, f, v) => setRooms(p => p.map((r, idx) => idx === i ? { ...r, [f]: v } : r));
  const removeRoom = (i) => setRooms(p => p.filter((_, idx) => idx !== i));

  const nav = (s) => {
    setScreen(s);
    window.scrollTo(0, 0);
    setAuthError("");
    setAuthLoading(false);
    if (s === "dashboard") {
      setLoadingReports(true);
      fetchReports({ emails: [alertEmail, email], location, rooms: (rooms || []).map(r => r.name) }).then(data => { setAlerts(data); setLoadingReports(false); });
    }
  };

  // Restore an existing login on page load. Without this a refresh drops the
  // user back to the landing page even though their Supabase session is still
  // valid — it looked like being logged out, but the session was never checked.
  useEffect(() => {
    let cancelled = false;
    const path = window.location.pathname;
    const params = new URLSearchParams(window.location.search);
    const hash = window.location.hash || "";
    // Never hijack QR report links, password reset, or the legal pages.
    const isPublicFlow =
      path === "/r" || path.startsWith("/r/") || params.has("ce") || params.has("l") ||
      path === "/reset" || path === "/terms" || path === "/privacy" ||
      hash.includes("type=recovery");
    if (isPublicFlow) return;

    supabase.auth.getSession().then(async ({ data }) => {
      const sessionEmail = data?.session?.user?.email;
      if (!sessionEmail || cancelled) return;
      setEmail(sessionEmail);
      const profile = await loadClientData(sessionEmail);
      if (cancelled) return;
      const backup = loadProfileBackup(sessionEmail);
      // Airtable is the source of truth; the local backup only fills gaps it
      // left behind (e.g. a rejected write during onboarding).
      const biz = profile?.bizName || backup?.bizName;
      const fac = profile?.facility || backup?.location;
      const ce = profile?.cleaningEmail || backup?.alertEmail;
      const ph = profile?.phone || backup?.alertPhone;
      const rms = (profile?.rooms && profile.rooms.length) ? profile.rooms : backup?.rooms;
      if (biz) setBizName(biz);
      if (fac) setLocation(fac);
      if (ce) setAlertEmail(ce);
      if (ph) setAlertPhone(ph);
      if (rms) setRooms(rms);
      if (!fac) console.warn("[Restore] No Facility Name found in Airtable or local backup for", sessionEmail);
      setScreen("dashboard");
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (screen !== "dashboard") return;
    const scope = { emails: [alertEmail, email], location, rooms: (rooms || []).map(r => r.name) };
    fetchReports(scope).then(data => { setAlerts(data); setLoadingReports(false); });
    const interval = setInterval(() => { fetchReports(scope).then(data => setAlerts(data)); }, 30000);
    return () => clearInterval(interval);
  }, [screen, alertEmail, email, location, rooms]);

  // 14-day trial countdown — based on the account's REAL Supabase signup
  // timestamp, not a stored guess, so it can't drift or be reset by accident.
  useEffect(() => {
    if (screen !== "dashboard") return;
    supabase.auth.getUser().then(({ data }) => {
      const createdAt = data?.user?.created_at;
      if (!createdAt) { setTrialDaysLeft(null); return; }
      const signedUp = new Date(createdAt);
      const msPerDay = 1000 * 60 * 60 * 24;
      const elapsed = Math.floor((Date.now() - signedUp.getTime()) / msPerDay);
      const left = Math.max(0, 14 - elapsed);
      setTrialDaysLeft(left);

      // Notify YOU (management) once per client, at day-3-left and at expiry,
      // so a pilot never silently lapses without a founder follow-up call.
      // De-duped via localStorage so the 30s dashboard refresh doesn't spam.
      const dedupeKey = `sp_trial_notice_${data.user.email}_${left <= 3 ? left : "na"}`;
      if ((left === 3 || left === 0) && !localStorage.getItem(dedupeKey)) {
        localStorage.setItem(dedupeKey, "1");
        sendOrQueueAlert({
          cleaning_email: MANAGEMENT_EMAIL, to_email: MANAGEMENT_EMAIL, email: MANAGEMENT_EMAIL,
          issue: left === 0 ? `⏰ TRIAL ENDED: ${bizName || data.user.email}` : `⏰ Trial ending in 3 days: ${bizName || data.user.email}`,
          location: location || "", room: "", stall: "",
          business: bizName || data.user.email, time: new Date().toLocaleString(),
        });
      }
    }).catch(() => setTrialDaysLeft(null));
  }, [screen]);

  // Offline queue sync: flush on mount and whenever connectivity returns
  useEffect(() => {
    const syncQueue = async () => {
      const flushed = await flushQueue();
      if (flushed > 0) showToast(`📡 Back online — ${flushed} queued report${flushed > 1 ? "s" : ""} sent!`, T.green);
    };
    syncQueue();
    window.addEventListener("online", syncQueue);
    return () => window.removeEventListener("online", syncQueue);
  }, []);

  // QR scan detection + ?location= prefill
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const path = window.location.pathname;
    const isQR = path === "/r" || path.startsWith("/r/") || params.has("ce") || params.has("l");

    // Password reset: Supabase redirects here with a recovery token in the URL hash
    const hash = window.location.hash || "";
    if (path === "/reset" || hash.includes("type=recovery")) {
      setScreen("reset");
      return;
    }
    if (path === "/terms") { setScreen("terms"); return; }
    if (path === "/privacy") { setScreen("privacy"); return; }
    const locationParam = params.get("location");
    if (locationParam) { setLocation(locationParam); setQrLocation(locationParam); }
    if (isQR) {
      setQrBusiness(params.get("b") || "");
      setQrLocation(params.get("l") || locationParam || "");
      setQrRoom(params.get("r") || "");
      setQrStall(params.get("s") || "");
      setAlertEmail(params.get("ce") || "");
      setQrCategory(params.get("category") || params.get("asset_type") || "");
      setScreen("report");
    }
  }, []);

  const sendTestAlert = async () => {
    if (!alertEmail) return;
    const recipients = [alertEmail, MANAGEMENT_EMAIL].filter(Boolean).join(", ");
    const payload = {
      cleaning_email: recipients,
      to_email: recipients,
      email: recipients,
      issue: "🧻 No Toilet Paper (TEST ALERT)",
      location: location || "Test Location",
      location_name: location || "Test Location",
      room: "Test Room",
      stall: "Stall 1",
      business: bizName || "Your Business",
      time: new Date().toLocaleString(),
    };
    const result = await sendOrQueueAlert(payload);
    if (result.status === "sent") { setTestSent(true); showToast("✅ Test alert sent! Check your inbox.", T.green); }
    else if (result.status === "offline") { showToast("📡 Offline — saved, will send when back online.", T.yellow); }
    else { showToast(`❌ Email rejected: ${result.error}`, T.red); }
  };

  // ── LANDING ──
  if (screen === "landing") return (
    <div style={{ fontFamily: font.body, background: T.white, color: T.ink, minHeight: "100vh" }}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        * { box-sizing: border-box; }
      `}</style>
      {toast && <Toast msg={toast.msg} color={toast.color} />}

      <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(255,255,255,0.97)", backdropFilter: "blur(20px)", borderBottom: `1px solid ${T.border}`, padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 72 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 38, height: 38, background: T.ink, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>📋</div>
          <div>
            <div style={{ fontFamily: font.display, fontSize: 18, fontWeight: 700, letterSpacing: -0.5 }}>SupplyPing</div>
            <div style={{ fontSize: 9, color: T.muted, letterSpacing: 2, textTransform: "uppercase" }}>FACILITY SAFETY & OPERATIONS</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Btn label="Log In" onClick={() => nav("login")} variant="ghost" />
          <Btn label="Start Free Trial →" onClick={() => nav("signup")} variant="primary" />
        </div>
      </nav>

      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "80px 24px 64px", textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: T.greenLight, border: `1px solid ${T.greenBorder}`, borderRadius: 100, padding: "6px 20px", fontSize: 12, color: T.green, fontWeight: 600, marginBottom: 32 }}>
          <div style={{ width: 6, height: 6, background: T.green, borderRadius: "50%", animation: "pulse 2s infinite" }} />
          Free 14-Day Pilot — Built for Warehouses & High-Traffic Facilities
        </div>
        <h1 style={{ fontFamily: font.display, fontSize: 56, fontWeight: 700, margin: "0 0 24px", letterSpacing: -2.5, lineHeight: 1.05 }}>
          See it. Scan it.<br />Solve it. <span style={{ color: T.orange }}>⚠️</span>
        </h1>
        <p style={{ fontSize: 18, color: T.muted, maxWidth: 580, margin: "0 auto 16px", lineHeight: 1.7 }}>
          Real-time facility reporting for warehouses, plants, and campuses. Workers scan a QR code to flag a safety hazard, maintenance issue, cleaning need, or supply shortage — and the right team is notified instantly, with a timestamp.
        </p>
        <p style={{ fontSize: 14, color: T.dim, maxWidth: 500, margin: "0 auto 36px", lineHeight: 1.6 }}>
          Lead with safety. Cover everything else in the same scan. Set up in 10 minutes — no app, no IT team.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginBottom: 16 }}>
          <Btn label="Start Free Trial →" onClick={() => nav("signup")} variant="primary" size="lg" />
          <Btn label="See How It Works →" onClick={() => nav("report")} variant="outline" size="lg" />
        </div>
        <div style={{ fontSize: 12, color: T.dim }}>✓ No credit card &nbsp; ✓ Setup in 10 min &nbsp; ✓ Cancel anytime</div>

        <div style={{ marginTop: 48, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          {SUPPLY_CATEGORIES.map(cat => (
            <div key={cat.id} style={{ background: cat.bg, border: `1px solid ${cat.border}`, borderRadius: 100, padding: "7px 16px", fontSize: 12, fontWeight: 600, color: cat.color }}>
              {cat.label}
            </div>
          ))}
        </div>
      </div>

      <div style={{ background: T.cream, borderTop: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}`, padding: "64px 24px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 40 }}>
            <div style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: 2, marginBottom: 12, fontWeight: 600 }}>How It Works</div>
            <h2 style={{ fontFamily: font.display, fontSize: 34, fontWeight: 700, margin: 0, letterSpacing: -1.2 }}>Up and running in 10 minutes</h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16 }}>
            {[
              { n: "01", emoji: "✍️", title: "Sign Up Free", desc: "Create your account and select your industry. No credit card needed." },
              { n: "02", emoji: "📍", title: "Add Locations", desc: "Enter your locations and how many units/assets each has." },
              { n: "03", emoji: "🖨️", title: "Print QR Codes", desc: "Download and print your unique codes. Post at each unit/asset." },
              { n: "04", emoji: "🚀", title: "Go Live!", desc: "Workers scan → tap the issue → the right team is notified instantly." },
            ].map(s => (
              <Card key={s.n}>
                <div style={{ fontSize: 11, color: T.orange, fontWeight: 700, letterSpacing: 2, marginBottom: 10 }}>{s.n}</div>
                <div style={{ fontSize: 28, marginBottom: 12 }}>{s.emoji}</div>
                <div style={{ fontFamily: font.display, fontSize: 17, fontWeight: 700, marginBottom: 8 }}>{s.title}</div>
                <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.6 }}>{s.desc}</div>
              </Card>
            ))}
          </div>
        </div>
      </div>

      <div style={{ padding: "64px 24px" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", textAlign: "center" }}>
          <div style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: 2, marginBottom: 12, fontWeight: 600 }}>Built For Every Facility</div>
          <h2 style={{ fontFamily: font.display, fontSize: 34, fontWeight: 700, margin: "0 0 36px", letterSpacing: -1.2 }}>One solution. Every industry.</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 10 }}>
            {INDUSTRIES.map(i => (
              <div key={i.id} style={{ background: T.cream, border: `1px solid ${T.border}`, borderRadius: 12, padding: "16px 8px", textAlign: "center", cursor: "pointer" }} onClick={() => nav("signup")}>
                <div style={{ fontSize: 22, marginBottom: 6 }}>{i.emoji}</div>
                <div style={{ fontSize: 10, fontWeight: 500, color: T.ink, lineHeight: 1.3 }}>{i.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ background: T.cream, borderTop: `1px solid ${T.border}`, padding: "64px 24px" }}>
        <div style={{ maxWidth: 880, margin: "0 auto", textAlign: "center" }}>
          <div style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: 2, marginBottom: 12, fontWeight: 600 }}>Pricing</div>
          <h2 style={{ fontFamily: font.display, fontSize: 34, fontWeight: 700, margin: "0 0 8px", letterSpacing: -1.2 }}>Simple, honest pricing.</h2>
          <p style={{ color: T.muted, fontSize: 15, marginBottom: 16 }}>No credit card required.</p>
          <div style={{ background: T.greenLight, border: `1.5px solid ${T.greenBorder}`, borderRadius: 12, padding: "14px 20px", marginBottom: 36, fontSize: 14, color: T.green, fontWeight: 600, maxWidth: 560, marginLeft: "auto", marginRight: "auto" }}>
            🎉 Founding Pilot: every plan is <b>FREE for your first 14 days</b>. All we ask is your honest feedback.
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 16 }}>
            {[
              { name: "Starter", price: "$49", mo: "/mo", features: ["1 facility", "Up to 10 locations", "Email alerts to operations staff", "Live dashboard", "QR code generator"], highlight: false },
              { name: "Business", price: "$149", mo: "/mo", features: ["Up to 5 facilities", "Unlimited locations", "SMS + Email alerts", "Weekly summary report", "Priority support"], highlight: true },
              { name: "Enterprise", price: "Custom", mo: "", features: ["Unlimited facilities", "Sensor integration", "Custom branding", "API access", "Dedicated support"], highlight: false },
            ].map(p => (
              <div key={p.name} style={{ background: p.highlight ? T.ink : T.white, border: `2px solid ${p.highlight ? T.ink : T.border}`, borderRadius: 18, padding: 28, textAlign: "left", boxShadow: p.highlight ? T.shadowLg : T.shadow }}>
                <div style={{ fontSize: 11, color: p.highlight ? "#888" : T.muted, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 10, fontWeight: 600 }}>{p.name}</div>
                <div style={{ fontFamily: font.display, fontSize: 38, fontWeight: 700, color: p.highlight ? T.white : T.ink, marginBottom: 4 }}>{p.price}<span style={{ fontSize: 16, fontWeight: 400, fontFamily: font.body }}>{p.mo}</span></div>
                <div style={{ height: 1, background: p.highlight ? "#2a2825" : T.border, margin: "16px 0" }} />
                {p.features.map(f => (
                  <div key={f} style={{ display: "flex", gap: 10, marginBottom: 10, fontSize: 13, color: p.highlight ? "#ccc" : T.ink }}>
                    <span style={{ color: T.green, fontWeight: 700 }}>✓</span>{f}
                  </div>
                ))}
                <div style={{ marginTop: 20 }}>
                  <Btn label="Start Free Trial →" onClick={() => nav("signup")} variant={p.highlight ? "orange" : "outline"} full />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* PUBLIC SMS OPT-IN SECTION (visible to Twilio reviewers without login) */}
      <div id="sms-optin" style={{ background: T.white, borderTop: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}`, padding: "64px 24px" }}>
        <div style={{ maxWidth: 780, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 36 }}>
            <div style={{ fontSize: 11, color: T.hivizDk || T.orange, letterSpacing: 2, fontWeight: 700, marginBottom: 12, textTransform: "uppercase" }}>How SMS Alerts Work</div>
            <h2 style={{ fontFamily: font.display, fontSize: 32, fontWeight: 700, margin: "0 0 12px", letterSpacing: -1 }}>Text alerts are 100% opt-in</h2>
            <p style={{ color: T.muted, fontSize: 15, maxWidth: 560, margin: "0 auto", lineHeight: 1.6 }}>
              SupplyPing only sends SMS to people who explicitly ask for them. Here's exactly how consent is collected.
            </p>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16, marginBottom: 32 }}>
            {[
              { n: "1", t: "You enter your number", d: "During account setup, a facility operator or their staff member types their own mobile number into the SupplyPing onboarding form." },
              { n: "2", t: "You check the consent box", d: "An unchecked opt-in box must be actively checked. It states you agree to receive facility-alert texts, that message & data rates may apply, and that consent is not a condition of purchase." },
              { n: "3", t: "You control it anytime", d: "Reply STOP to any message to unsubscribe immediately, or HELP for assistance. You can opt out at any time." },
            ].map(s => (
              <div key={s.n} style={{ background: T.cream, border: `1px solid ${T.border}`, borderRadius: 14, padding: "22px 20px" }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: T.ink, color: T.white, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, marginBottom: 12 }}>{s.n}</div>
                <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>{s.t}</div>
                <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.55 }}>{s.d}</div>
              </div>
            ))}
          </div>

          <div style={{ background: T.cream, border: `1px solid ${T.border}`, borderRadius: 14, padding: "20px 24px" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.ink, marginBottom: 10 }}>The exact consent language shown at signup:</div>
            <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.6, fontStyle: "italic", marginBottom: 16 }}>
              "By providing a phone number and checking this box, you agree to receive SMS text alerts from SupplyPing about facility issues at this number. Message frequency varies. Message &amp; data rates may apply. Reply STOP to unsubscribe or HELP for help. Consent is not a condition of purchase."
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.ink, marginBottom: 6 }}>Example of a message we send:</div>
            <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.6, fontFamily: font.body }}>
              "SupplyPing Alert: Wet Floor / Spill reported at Warehouse Floor, Building A. Reported 2:14 PM. Reply STOP to opt out."
            </div>
          </div>
          <p style={{ textAlign: "center", fontSize: 12, color: T.dim, marginTop: 18 }}>
            We never sell or share mobile numbers. Full terms in the "SMS Alerts — Terms &amp; Consent" section below.
          </p>
        </div>
      </div>

      <div style={{ background: "linear-gradient(135deg, #1A1814 0%, #2a2420 100%)", padding: "80px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 11, color: "#555", letterSpacing: 3, textTransform: "uppercase", marginBottom: 20, fontWeight: 600 }}>GET STARTED TODAY</div>
        <h2 style={{ fontFamily: font.display, fontSize: 40, fontWeight: 700, color: T.white, margin: "0 0 16px", letterSpacing: -1.5 }}>
          Ready to streamline<br />your facility operations?
        </h2>
        <p style={{ color: "#888", fontSize: 16, marginBottom: 36, maxWidth: 480, marginLeft: "auto", marginRight: "auto", lineHeight: 1.6 }}>
          Free for 14 days. Set up in 10 minutes. No credit card required.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap" }}>
          <Btn label="Start Free Trial →" onClick={() => nav("signup")} variant="orange" size="lg" />
          <a href="https://mail.google.com/mail/?view=cm&fs=1&to=hello@supplyping.com&su=SupplyPing%20Inquiry" target="_blank" rel="noreferrer" style={{ display: "inline-block", background: "transparent", color: "#888", border: "1px solid #333", borderRadius: 10, padding: "16px 32px", fontFamily: font.body, fontSize: 16, fontWeight: 600, textDecoration: "none" }}>
            Email Us →
          </a>
        </div>
        <div style={{ marginTop: 48, paddingTop: 32, borderTop: "1px solid #222", display: "flex", justifyContent: "center", gap: 32, fontSize: 13, color: "#444", flexWrap: "wrap" }}>
          {[{ icon: "📧", text: "hello@supplyping.com" }, { icon: "📞", text: "313-591-3484" }, { icon: "🌐", text: "supplyping.com" }, { icon: "📍", text: "Metro Detroit, MI" }].map(t => (
            <span key={t.text} style={{ display: "flex", alignItems: "center", gap: 6 }}>{t.icon} {t.text}</span>
          ))}
        </div>
        <div id="sms-terms" style={{ maxWidth: 720, margin: "32px auto 0", paddingTop: 24, borderTop: "1px solid #1c1c1c", fontSize: 11, color: "#555", lineHeight: 1.7, textAlign: "left" }}>
          <div style={{ fontWeight: 700, color: "#777", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>SMS Alerts — Terms &amp; Consent</div>
          <p style={{ margin: "0 0 8px" }}>SupplyPing sends SMS text alerts to facility operators and cleaning teams who opt in during account setup. By providing a mobile number and checking the consent box, you agree to receive recurring facility-alert text messages from SupplyPing. Message frequency varies based on facility activity. Message and data rates may apply.</p>
          <p style={{ margin: "0 0 8px" }}>Reply <b>STOP</b> at any time to unsubscribe. Reply <b>HELP</b> for assistance, or contact us at hello@supplyping.com or 313-591-3484. Consent to receive SMS is not a condition of purchase.</p>
          <p style={{ margin: 0 }}>We do not sell or share mobile information with third parties for marketing. © 2026 SupplyPing, Metro Detroit, MI.</p>
        </div>
      </div>
    </div>
  );

  // ── SIGNUP ──
  if (screen === "signup") return (
    <div style={{ fontFamily: font.body, background: T.cream, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <style>{`* { box-sizing: border-box; }`}</style>
      {toast && <Toast msg={toast.msg} color={toast.color} />}
      <div style={{ width: "100%", maxWidth: 480 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 32, cursor: "pointer" }} onClick={() => nav("landing")}>
          <div style={{ width: 32, height: 32, background: T.ink, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>📋</div>
          <span style={{ fontFamily: font.display, fontSize: 16, fontWeight: 700 }}>SupplyPing</span>
          <span style={{ color: T.muted, fontSize: 12 }}>← Back</span>
        </div>
        <h2 style={{ fontFamily: font.display, fontSize: 30, fontWeight: 700, margin: "0 0 6px" }}>Create your account</h2>
        <p style={{ color: T.muted, fontSize: 13, marginBottom: 28 }}>Start your free 14-day pilot. No credit card required.</p>
        <Card>
          <Input label="Business Name" value={bizName} onChange={setBizName} placeholder="Evans Distribution" />
          <Input label="Work Email" value={email} onChange={setEmail} placeholder="you@yourbusiness.com" type="email" />
          <Input label="Password (min 6 characters)" value={password} onChange={setPassword} placeholder="Create a strong password" type="password" />
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 10, fontWeight: 500 }}>Your Industry</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, maxHeight: 280, overflowY: "auto" }}>
              {INDUSTRIES.map(i => (
                <button key={i.id} onClick={() => setIndustry(i.id)}
                  style={{ background: industry === i.id ? T.ink : T.cream, color: industry === i.id ? T.white : T.ink, border: `1.5px solid ${industry === i.id ? T.ink : T.border}`, borderRadius: 10, padding: "10px 12px", fontFamily: font.body, fontSize: 12, fontWeight: 500, cursor: "pointer", textAlign: "left" }}>
                  {i.emoji} {i.label}
                </button>
              ))}
            </div>
          </div>
          {authError && <div style={{ background: T.redLight, border: `1px solid ${T.redBorder}`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: T.red, marginBottom: 14 }}>{authError}</div>}
          <Btn label={authLoading ? "Creating account..." : "Create Account & Continue →"} onClick={async () => {
            if (!bizName || !email || !password || !industry) { setAuthError("Please fill in all fields and select an industry."); return; }
            if (password.length < 6) { setAuthError("Password must be at least 6 characters."); return; }
            setAuthError(""); setAuthLoading(true);
            const { error } = await supabase.auth.signUp({ email, password, options: { data: { business_name: bizName, industry: INDUSTRIES.find(i => i.id === industry)?.label || industry } } });
            setAuthLoading(false);
            if (error) { setAuthError(error.message); return; }
            try {
              await fetch("https://api.web3forms.com/submit", {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ access_key: WEB3FORMS_KEY, subject: `🎉 New SupplyPing Signup — ${bizName}`, "Business Name": bizName, "Email": email, "Industry": INDUSTRIES.find(i => i.id === industry)?.label || industry, "Plan": "Free Trial" })
              });
            } catch (e) {}
            setScreen("onboard"); setStep(1); window.scrollTo(0, 0);
          }} disabled={!bizName || !email || !password || !industry || authLoading} variant="primary" full />
          <div style={{ textAlign: "center", marginTop: 16, fontSize: 13, color: T.muted }}>
            Already have an account? <span onClick={() => nav("login")} style={{ color: T.blue, cursor: "pointer", fontWeight: 500 }}>Log in</span>
          </div>
        </Card>
      </div>
    </div>
  );

  // ── LOGIN ──
  if (screen === "login") return (
    <div style={{ fontFamily: font.body, background: T.cream, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <style>{`* { box-sizing: border-box; }`}</style>
      {toast && <Toast msg={toast.msg} color={toast.color} />}
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 32, cursor: "pointer" }} onClick={() => nav("landing")}>
          <div style={{ width: 32, height: 32, background: T.ink, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>📋</div>
          <span style={{ fontFamily: font.display, fontSize: 16, fontWeight: 700 }}>SupplyPing</span>
          <span style={{ color: T.muted, fontSize: 12 }}>← Back</span>
        </div>
        <h2 style={{ fontFamily: font.display, fontSize: 30, fontWeight: 700, margin: "0 0 6px" }}>Welcome back</h2>
        <p style={{ color: T.muted, fontSize: 13, marginBottom: 28 }}>Log in to your SupplyPing account</p>
        <Card>
          <Input label="Email" value={email} onChange={setEmail} placeholder="you@yourbusiness.com" type="email" />
          <Input label="Password" value={password} onChange={setPassword} placeholder="Your password" type="password" />
          {authError && <div style={{ background: T.redLight, border: `1px solid ${T.redBorder}`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: T.red, marginBottom: 14 }}>{authError}</div>}
          <Btn label={authLoading ? "Logging in..." : "Log In →"} onClick={async () => {
            if (!email || !password) { setAuthError("Please enter your email and password."); return; }
            setAuthError(""); setAuthLoading(true);
            const { error } = await supabase.auth.signInWithPassword({ email, password });
            if (error) { setAuthLoading(false); setAuthError("Invalid email or password. Please try again."); return; }
            const profile = await loadClientData(email);
            const backup = loadProfileBackup(email);
            const biz = profile?.bizName || backup?.bizName;
            const fac = profile?.facility || backup?.location;
            const ce = profile?.cleaningEmail || backup?.alertEmail;
            const ph = profile?.phone || backup?.alertPhone;
            const rms = (profile?.rooms && profile.rooms.length) ? profile.rooms : backup?.rooms;
            if (biz) setBizName(biz);
            if (fac) setLocation(fac);
            if (ce) setAlertEmail(ce);
            if (ph) setAlertPhone(ph);
            if (rms) setRooms(rms);
            // If Airtable had no facility but the local backup did, the earlier
            // write was rejected — repair it now that we're authenticated.
            if (!profile?.facility && fac) {
              saveLocationsToAirtable(email, rms || [], { "Facility Name": fac, "Cleaning Team Email": ce || "", "Business Name": biz || "" });
            }
            setAuthLoading(false);
            nav("dashboard");
          }} disabled={!email || !password || authLoading} variant="primary" full />
          <div style={{ textAlign: "center", marginTop: 14 }}>
            <span onClick={async () => {
              if (!email) { setAuthError("Enter your email above first, then tap 'Forgot password?'"); return; }
              setAuthError("");
              const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: "https://supplyping.com/reset" });
              if (error) { showToast(`❌ ${error.message}`, T.red); return; }
              showToast("✅ Reset link sent! Check your email inbox.", T.green);
            }} style={{ fontSize: 13, color: T.blue, cursor: "pointer", fontWeight: 500 }}>
              Forgot password?
            </span>
          </div>
          <div style={{ textAlign: "center", marginTop: 12, fontSize: 13, color: T.muted }}>
            New to SupplyPing? <span onClick={() => nav("signup")} style={{ color: T.blue, cursor: "pointer", fontWeight: 500 }}>Start free trial</span>
          </div>
        </Card>
      </div>
    </div>
  );

  // ── ONBOARDING ──
  if (screen === "onboard") return (
    <div style={{ fontFamily: font.body, background: T.cream, minHeight: "100vh", color: T.ink }}>
      <style>{`* { box-sizing: border-box; }`}</style>
      {toast && <Toast msg={toast.msg} color={toast.color} />}
      <div style={{ background: T.white, borderBottom: `1px solid ${T.border}`, padding: "20px 24px" }}>
        <div style={{ maxWidth: 620, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 28, height: 28, background: T.ink, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>📋</div>
              <span style={{ fontFamily: font.display, fontSize: 15, fontWeight: 700 }}>SupplyPing Setup</span>
            </div>
            <span style={{ fontSize: 12, color: T.muted, fontWeight: 500 }}>Step {step} of 4</span>
          </div>
          <div style={{ background: T.border, borderRadius: 100, height: 6, overflow: "hidden" }}>
            <div style={{ background: T.ink, width: `${(step / 4) * 100}%`, height: "100%", borderRadius: 100, transition: "width 0.5s ease" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
            {["Your Facility", "Locations", "Set Up Alerts", "QR Codes"].map((s, i) => (
              <div key={i} style={{ fontSize: 10, color: step > i ? T.green : step === i + 1 ? T.ink : T.dim, fontWeight: step === i + 1 ? 700 : 400 }}>{s}</div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 620, margin: "0 auto", padding: "44px 24px" }}>
        {step === 1 && (
          <>
            <div style={{ fontSize: 44, marginBottom: 16 }}>🏢</div>
            <h2 style={{ fontFamily: font.display, fontSize: 28, fontWeight: 700, margin: "0 0 8px" }}>Tell us about your facility</h2>
            <p style={{ color: T.muted, fontSize: 14, lineHeight: 1.6, marginBottom: 28 }}>We'll use this to create your unique QR codes and dashboard.</p>
            <Input label="Facility / Location Name" value={location} onChange={setLocation} placeholder="Building A — Romulus, MI" />
            <div style={{ background: T.greenLight, border: `1px solid ${T.greenBorder}`, borderRadius: 12, padding: "12px 16px", marginBottom: 24, fontSize: 13, color: T.green, fontWeight: 500 }}>
              ✅ Account: <b>{bizName || "Your Business"}</b> · Industry: <b>{INDUSTRIES.find(i => i.id === industry)?.label || "Facility"}</b>
            </div>
            <Btn label="Continue →" onClick={() => setStep(2)} disabled={!location} variant="primary" full />
          </>
        )}

        {step === 2 && (
          <>
            <div style={{ fontSize: 44, marginBottom: 16 }}>📍</div>
            <h2 style={{ fontFamily: font.display, fontSize: 28, fontWeight: 700, margin: "0 0 8px" }}>Add your locations</h2>
            <p style={{ color: T.muted, fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>We'll generate a unique QR code for every unit/asset automatically.</p>
            {rooms.map((room, i) => (
              <div key={i} style={{ background: T.white, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14, marginBottom: 10, boxShadow: T.shadow }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center" }}>
                  <input value={room.name} onChange={e => updateRoom(i, "name", e.target.value)} placeholder="e.g. Warehouse Floor or Breakroom"
                    style={{ border: `1.5px solid ${T.border}`, borderRadius: 8, padding: "10px 12px", fontFamily: font.body, fontSize: 13, color: T.ink, background: T.cream, outline: "none", width: "100%" }} />
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11, color: T.muted, fontWeight: 500, whiteSpace: "nowrap" }}>Units:</span>
                    <select value={room.stalls} onChange={e => updateRoom(i, "stalls", Number(e.target.value))}
                      style={{ border: `1.5px solid ${T.border}`, borderRadius: 8, padding: "10px 8px", fontFamily: font.body, fontSize: 13, background: T.cream, color: T.ink, outline: "none" }}>
                      {[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                  {rooms.length > 1 && <button onClick={() => removeRoom(i)} style={{ background: "transparent", border: "none", color: T.red, cursor: "pointer", fontSize: 16, padding: "4px" }}>✕</button>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
                  <span style={{ fontSize: 11, color: T.muted, fontWeight: 500, whiteSpace: "nowrap" }}>Area type:</span>
                  <select value={room.category || "default"} onChange={e => updateRoom(i, "category", e.target.value)}
                    style={{ flex: 1, border: `1.5px solid ${T.border}`, borderRadius: 8, padding: "10px", fontFamily: font.body, fontSize: 12, background: T.cream, color: T.ink, outline: "none" }}>
                    {AREA_TYPES.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                </div>
              </div>
            ))}
            <button onClick={addRoom} style={{ width: "100%", background: "transparent", border: `2px dashed ${T.border}`, borderRadius: 12, padding: "12px", fontFamily: font.body, fontSize: 13, color: T.muted, cursor: "pointer", marginBottom: 16 }}>
              + Add Another Location
            </button>
            <div style={{ background: T.blueLight, border: `1px solid ${T.blueBorder}`, borderRadius: 12, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: T.blue, fontWeight: 500 }}>
              📲 We'll generate <b>{totalQRs} unique QR codes</b> for {rooms.length} location{rooms.length > 1 ? "s" : ""} at {location}
            </div>
            <Btn label="Continue →" onClick={() => setStep(3)} disabled={rooms.some(r => !r.name)} variant="primary" full />
          </>
        )}

        {step === 3 && (
          <>
            <div style={{ fontSize: 44, marginBottom: 16 }}>🔔</div>
            <h2 style={{ fontFamily: font.display, fontSize: 28, fontWeight: 700, margin: "0 0 8px" }}>Set up instant alerts</h2>
            <p style={{ color: T.muted, fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>Enter your team's contact info. They'll be notified instantly when an issue is reported.</p>
            <Input label="Cleaning / Operations Team Email" value={alertEmail} onChange={setAlertEmail} placeholder="ops@yourbusiness.com" type="email" />
            <Input label="Team Phone (for SMS — optional)" value={alertPhone} onChange={setAlertPhone} placeholder="+1 313 000 0000" />
            <div style={{ background: T.cream, border: `1.5px solid ${T.border}`, borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                <input type="checkbox" checked={smsConsent} onChange={e => setSmsConsent(e.target.checked)} style={{ marginTop: 3, width: 18, height: 18, accentColor: T.green, flexShrink: 0, cursor: "pointer" }} />
                <span style={{ fontSize: 12, color: T.muted, lineHeight: 1.5 }}>
                  By checking this box, you agree to receive SMS text messages from SupplyPing regarding facility hazards, operational alerts, and account notifications. Message frequency varies. Message and data rates may apply. You can reply <b>STOP</b> to opt-out or <b>HELP</b> for help. Consent is not a condition of purchase. See our <a href="/terms" target="_blank" style={{ color: T.blue }}>Terms</a> and <a href="/privacy" target="_blank" style={{ color: T.blue }}>Privacy Policy</a>.
                </span>
              </label>
            </div>
            <div style={{ marginBottom: 20 }}>
              <Btn label={testSent ? "✅ Test Sent!" : "📤 Send Test Alert"} onClick={sendTestAlert} disabled={!alertEmail} variant="outline" size="sm" />
              {testSent && <span style={{ marginLeft: 10, fontSize: 13, color: T.green }}>Check hello@supplyping.com!</span>}
            </div>
            <div style={{ background: T.yellowLight, border: `1px solid ${T.yellowBorder}`, borderRadius: 12, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: T.yellow, fontWeight: 500 }}>
              ⚡ Every time a worker scans a QR code and reports an issue — an alert is sent <b>instantly</b>.
            </div>
            <Btn label="Generate My QR Codes →" onClick={async () => {
              const fields = { "Business Name": bizName, "Email": email, "Industry": INDUSTRIES.find(i => i.id === industry)?.label || industry, "Cleaning Team Email": alertEmail, "Phone Number": alertPhone, "Facility Name": location, "Plan": "Trial", "Client Status": "Trial", "Locations": JSON.stringify(rooms) };
              const savedOk = await saveLocationsToAirtable(email, rooms, fields);
              // Local backup: if Airtable is unavailable or rejects the write,
              // the setup still survives a logout on this device rather than
              // forcing the client through onboarding again.
              saveProfileBackup(email, { bizName, location, alertEmail, alertPhone, rooms });
              if (!savedOk) showToast("⚠️ Setup saved on this device, but syncing failed — contact support if it disappears.", T.yellow);
              setStep(4);
            }} disabled={!alertEmail} variant="primary" full />
          </>
        )}

        {step === 4 && (
          <>
            <div style={{ fontSize: 44, marginBottom: 16 }}>🎉</div>
            <h2 style={{ fontFamily: font.display, fontSize: 28, fontWeight: 700, margin: "0 0 8px" }}>Your QR codes are ready!</h2>
            <p style={{ color: T.muted, fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>{totalQRs} unique QR codes for {location}. Print, laminate, and post at each unit/asset.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12, marginBottom: 24 }}>
              {rooms.flatMap((room, ri) =>
                Array.from({ length: room.stalls }, (_, si) => {
                  const formUrl = buildFormUrl(alertEmail, location, room.name, si + 1, bizName, room.category);
                  return (
                    <div key={`${ri}-${si}`} style={{ background: T.white, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14, textAlign: "center", boxShadow: T.shadow }}>
                      <img src={qr(formUrl)} alt="" style={{ width: 120, height: 120, borderRadius: 8, marginBottom: 8 }} />
                      <div style={{ fontSize: 12, fontWeight: 700 }}>Unit/Asset {si + 1}</div>
                      <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{room.name}</div>
                      <button onClick={() => {
                        const link = document.createElement("a");
                        link.href = qr(formUrl, 400);
                        link.download = `QR-${room.name}-Stall${si+1}.png`;
                        link.click();
                        showToast("📥 QR code downloaded!", T.green);
                      }} style={{ marginTop: 8, background: T.ink, color: T.white, border: "none", borderRadius: 7, padding: "5px 10px", fontFamily: font.body, fontSize: 10, fontWeight: 600, cursor: "pointer", width: "100%" }}>
                        ⬇️ Download
                      </button>
                    </div>
                  );
                })
              )}
            </div>
            <div style={{ background: T.greenLight, border: `1px solid ${T.greenBorder}`, borderRadius: 12, padding: 18, marginBottom: 20 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.green, marginBottom: 10 }}>🖨️ How to install</div>
              {["Print on card stock — 4×4 inches is perfect", "Laminate or cover with clear packing tape", "Post at each unit/asset at eye level", "Test each QR with your phone before leaving", "Workers scan → your team gets an alert instantly"].map((s, i) => (
                <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, fontSize: 13, color: T.green }}>
                  <span style={{ fontWeight: 700 }}>{i+1}.</span><span>{s}</span>
                </div>
              ))}
            </div>
            <Btn label="Go to My Dashboard →" onClick={() => nav("dashboard")} variant="green" full />
          </>
        )}
      </div>
    </div>
  );

  // ── DASHBOARD ──
  if (screen === "dashboard") return (
    <div style={{ fontFamily: font.body, background: T.cream, minHeight: "100vh", color: T.ink }}>
      <style>{`* { box-sizing: border-box; }`}</style>
      {toast && <Toast msg={toast.msg} color={toast.color} />}
      <header style={{ background: T.white, borderBottom: `1px solid ${T.border}`, padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 68, boxShadow: T.shadow, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0" }}>
          <div style={{ width: 32, height: 32, background: T.ink, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>📋</div>
          <div>
            <div style={{ fontFamily: font.display, fontSize: 15, fontWeight: 700 }}>SupplyPing Dashboard</div>
            <div style={{ fontSize: 9, color: T.muted, letterSpacing: 1.5, textTransform: "uppercase" }}>{bizName || "Facility Operations"}</div>
          </div>
        </div>
        {trialDaysLeft !== null && (
          <div style={{
            fontSize: 12, fontWeight: 700, padding: "6px 14px", borderRadius: 100,
            background: trialDaysLeft === 0 ? T.redLight : trialDaysLeft <= 3 ? T.yellowLight : T.greenLight,
            color: trialDaysLeft === 0 ? T.red : trialDaysLeft <= 3 ? T.yellow : T.green,
            border: `1px solid ${trialDaysLeft === 0 ? T.redBorder : trialDaysLeft <= 3 ? "#FDE68A" : T.greenBorder}`,
          }}>
            {trialDaysLeft === 0
              ? "⏰ Trial ended — contact us to continue"
              : trialDaysLeft === 1
              ? "⏰ Last day of your free trial"
              : `🎉 ${trialDaysLeft} days left in your free trial`}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "12px 0" }}>
          <Btn label="📋 Status" onClick={() => nav("status")} variant="outline" size="sm" />
          <Btn label="📍 Manage" onClick={() => nav("manage")} variant="outline" size="sm" />
          <Btn label="⚙️ Account" onClick={() => nav("account")} variant="outline" size="sm" />
          <Btn label={loadingReports ? "⏳" : "🔄 Refresh"} onClick={() => { setLoadingReports(true); fetchReports({ emails: [alertEmail, email], location, rooms: (rooms || []).map(r => r.name) }).then(data => { setAlerts(data); setLoadingReports(false); showToast("✅ Refreshed!", T.green); }); }} variant="outline" size="sm" />
          <Btn label="🚪 Log Out" onClick={async () => {
            await supabase.auth.signOut();
            setBizName(""); setEmail(""); setPassword(""); setIndustry("");
            setLocation(""); setAlertEmail(""); setAlertPhone("");
            setRooms([{ name: "Warehouse Floor", stalls: 2, category: "warehouse" }, { name: "Loading Dock", stalls: 1, category: "safety" }]);
            showToast("👋 Logged out successfully!", T.green);
            nav("landing");
          }} variant="outline" size="sm" />
        </div>
      </header>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px" }}>
        <div style={{ background: open.length === 0 ? T.greenLight : T.redLight, border: `2px solid ${open.length === 0 ? T.greenBorder : T.redBorder}`, borderRadius: 18, padding: "24px 28px", marginBottom: 24, display: "flex", alignItems: "center", gap: 20, boxShadow: T.shadow }}>
          <div style={{ fontSize: 44 }}>{open.length === 0 ? "✅" : "🚨"}</div>
          <div>
            <div style={{ fontFamily: font.display, fontSize: 22, fontWeight: 700, color: open.length === 0 ? T.green : T.red }}>
              {open.length === 0 ? "All Locations Fully Stocked!" : `${open.length} Active Issue${open.length > 1 ? "s" : ""} Need Attention`}
            </div>
            <div style={{ fontSize: 13, color: T.muted, marginTop: 4 }}>
              {open.length === 0 ? "No action needed right now." : "Your team has been notified. Tap ✓ Fixed It when resolved."}
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12, marginBottom: 28 }}>
          {[
            { label: "Open Issues", val: open.length, color: open.length > 0 ? T.red : T.green },
            { label: "Resolved", val: resolved.length, color: T.green },
            { label: "Total Reports", val: alerts.length, color: T.blue },
            { label: "Auto-Refresh", val: "30s", color: T.orange },
          ].map(s => (
            <Card key={s.label} style={{ padding: "16px 18px" }}>
              <div style={{ fontSize: 10, color: T.muted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8, fontWeight: 600 }}>{s.label}</div>
              <div style={{ fontFamily: font.display, fontSize: 28, fontWeight: 700, color: s.color }}>{s.val}</div>
            </Card>
          ))}
        </div>

        <div style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: 1.2, fontWeight: 600, marginBottom: 14 }}>
          Active Issues <span style={{ marginLeft: 8, fontSize: 10, color: T.orange, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>Live · auto-refreshes every 30s</span>
        </div>

        {loadingReports ? (
          <Card style={{ padding: 28, textAlign: "center" }}><div style={{ color: T.blue, fontSize: 14 }}>⏳ Loading live reports...</div></Card>
        ) : open.length === 0 ? (
          <div style={{ background: T.greenLight, border: `1px solid ${T.greenBorder}`, borderRadius: 14, padding: 28, textAlign: "center", color: T.green, fontSize: 14, fontWeight: 500 }}>
            🎉 All clear — every location is fully stocked!
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
            {open.map(a => (
              <div key={a.id} style={{ background: a.supply.bg, border: `1.5px solid ${a.supply.border}`, borderRadius: 14, padding: "18px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: T.shadow, gap: 12 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ fontSize: 32 }}>{a.supply.emoji}</div>
                  <div>
                    <div style={{ fontFamily: font.display, fontSize: 16, fontWeight: 700 }}>{a.status || a.supply.label}</div>
                    <div style={{ fontSize: 12, color: T.muted, marginTop: 3 }}>{a.room} · {a.stall}{a.location ? ` · ${a.location}` : ""} · {a.time}</div>
                    {a.cleaningEmail && <div style={{ fontSize: 11, color: T.green, marginTop: 2 }}>✅ Alert sent to {a.cleaningEmail}</div>}
                  </div>
                </div>
                <Btn label="✓ Fixed It" onClick={() => resolve(a.id)} variant="green" size="sm" />
              </div>
            ))}
          </div>
        )}

        {resolved.length > 0 && (
          <>
            <div style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: 1.2, fontWeight: 600, marginBottom: 12 }}>Resolved</div>
            {resolved.map(a => (
              <div key={a.id} style={{ background: T.white, border: `1px solid ${T.border}`, borderRadius: 12, padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, opacity: 0.55 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, color: T.muted }}>
                  <span>✅</span><span>{a.status || a.supply.label} · {a.room}</span>
                </div>
                <span style={{ fontSize: 11, color: T.green, fontWeight: 600 }}>RESOLVED</span>
              </div>
            ))}
          </>
        )}

        {/* FOUNDING PILOT FEEDBACK */}
        <Card style={{ marginTop: 28 }}>
          <div style={{ fontSize: 11, color: T.orange, textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 700, marginBottom: 6 }}>💬 Founding Pilot Feedback</div>
          <p style={{ fontSize: 13, color: T.muted, margin: "0 0 14px", lineHeight: 1.5 }}>
            Your plan is free for 14 days — all we ask is your honest feedback. What's working? What's missing? What would make this a must-have?
          </p>
          {feedbackSent ? (
            <div style={{ background: T.greenLight, border: `1px solid ${T.greenBorder}`, borderRadius: 10, padding: "12px 16px", fontSize: 13, color: T.green, fontWeight: 500 }}>
              ✅ Thank you! Your feedback was sent — it directly shapes what we build next.
            </div>
          ) : (
            <>
              <textarea value={feedbackText} onChange={e => setFeedbackText(e.target.value)}
                placeholder="Tell us anything — features, bugs, ideas, complaints..."
                rows={4}
                style={{ width: "100%", border: `1.5px solid ${T.border}`, borderRadius: 10, padding: "12px 14px", fontFamily: font.body, fontSize: 14, color: T.ink, background: T.cream, outline: "none", boxSizing: "border-box", resize: "vertical", marginBottom: 12 }} />
              <Btn label="Send Feedback →" onClick={async () => {
                if (!feedbackText.trim()) { showToast("Please write a little feedback first", T.red); return; }
                try {
                  await fetch("https://api.web3forms.com/submit", {
                    method: "POST", headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ access_key: WEB3FORMS_KEY, subject: `💬 SupplyPing Feedback — ${bizName || email}`, "Business": bizName, "Email": email, "Feedback": feedbackText.trim() })
                  });
                  setFeedbackSent(true);
                } catch (e) { showToast("Couldn't send — please try again", T.red); }
              }} disabled={!feedbackText.trim()} variant="orange" />
            </>
          )}
        </Card>
      </div>
    </div>
  );

  // ── MANAGE LOCATIONS ──
  if (screen === "manage") return (
    <div style={{ fontFamily: font.body, background: T.cream, minHeight: "100vh", color: T.ink }}>
      <style>{`* { box-sizing: border-box; }`}</style>
      {toast && <Toast msg={toast.msg} color={toast.color} />}
      <header style={{ background: T.white, borderBottom: `1px solid ${T.border}`, padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 68, boxShadow: T.shadow, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0" }}>
          <div style={{ width: 32, height: 32, background: T.ink, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>📋</div>
          <div>
            <div style={{ fontFamily: font.display, fontSize: 15, fontWeight: 700 }}>Manage Locations</div>
            <div style={{ fontSize: 9, color: T.muted, letterSpacing: 1.5, textTransform: "uppercase" }}>{bizName || "Your Facility"}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, padding: "12px 0" }}>
          <Btn label="← Dashboard" onClick={() => nav("dashboard")} variant="outline" size="sm" />
          <Btn label="🚪 Log Out" onClick={async () => {
            await supabase.auth.signOut();
            setBizName(""); setEmail(""); setPassword(""); setIndustry("");
            setLocation(""); setAlertEmail(""); setAlertPhone("");
            nav("landing");
          }} variant="outline" size="sm" />
        </div>
      </header>
      <div style={{ maxWidth: 760, margin: "0 auto", padding: "32px 24px" }}>
        <Card style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11, color: T.orange, textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 700, marginBottom: 14 }}>+ Add New Location</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center", marginBottom: 12 }}>
            <input placeholder="e.g. Warehouse Floor or Breakroom" id="newRoomInput"
              style={{ border: `1.5px solid ${T.border}`, borderRadius: 10, padding: "12px 14px", fontFamily: font.body, fontSize: 14, color: T.ink, background: T.cream, outline: "none" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: T.muted, fontWeight: 500 }}>Units:</span>
              <select id="newStallCount" style={{ border: `1.5px solid ${T.border}`, borderRadius: 8, padding: "12px 8px", fontFamily: font.body, fontSize: 13, background: T.cream, color: T.ink, outline: "none" }}>
                {[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 12, color: T.muted, fontWeight: 500, whiteSpace: "nowrap" }}>Area type:</span>
            <select id="newAreaType" style={{ flex: 1, border: `1.5px solid ${T.border}`, borderRadius: 8, padding: "12px 10px", fontFamily: font.body, fontSize: 13, background: T.cream, color: T.ink, outline: "none" }}>
              {AREA_TYPES.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </div>
          <Btn label="Add Location & Generate QR Codes →" onClick={() => {
            const name = document.getElementById("newRoomInput").value;
            const stalls = Number(document.getElementById("newStallCount").value);
            const category = document.getElementById("newAreaType").value;
            if (!name) { showToast("Please enter a location name", T.red); return; }
            const updated = [...rooms, { name, stalls, category }];
            setRooms(updated);
            saveLocationsToAirtable(email, updated, { "Facility Name": location, "Cleaning Team Email": alertEmail });
            document.getElementById("newRoomInput").value = "";
            showToast("✅ Location added & saved!", T.green);
          }} variant="orange" />
        </Card>

        <div style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: 1.2, fontWeight: 600, marginBottom: 16 }}>
          {rooms.length} Location{rooms.length > 1 ? "s" : ""} · {totalQRs} QR Code{totalQRs > 1 ? "s" : ""}
        </div>

        {rooms.map((room, ri) => (
          <Card key={ri} style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <div style={{ fontFamily: font.display, fontSize: 16, fontWeight: 700 }}>{room.name}</div>
                <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
                  {room.stalls} unit/asset{room.stalls > 1 ? "s" : ""} · {AREA_TYPES.find(a => a.id === (room.category || "default"))?.label || "All Categories"}
                </div>
              </div>
              <Btn label="Remove" onClick={() => { const updated = rooms.filter((_, i) => i !== ri); setRooms(updated); saveLocationsToAirtable(email, updated, { "Facility Name": location, "Cleaning Team Email": alertEmail }); showToast("🗑️ Location removed & saved", T.red); }} variant="outline" size="sm" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
              {Array.from({ length: room.stalls }, (_, si) => {
                const formUrl = buildFormUrl(alertEmail, location, room.name, si + 1, bizName, room.category);
                return (
                  <div key={si} style={{ background: T.cream, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14, textAlign: "center" }}>
                    <img src={qr(formUrl)} alt="" style={{ width: 110, height: 110, borderRadius: 8, marginBottom: 8 }} />
                    <div style={{ fontSize: 12, fontWeight: 700 }}>Unit/Asset {si + 1}</div>
                    <div style={{ fontSize: 9, color: T.muted, marginTop: 2 }}>{room.name}</div>
                    <button onClick={() => {
                      const link = document.createElement("a");
                      link.href = qr(formUrl, 400);
                      link.download = `QR-${room.name}-Stall${si+1}.png`;
                      link.click();
                      showToast("📥 Downloaded!", T.green);
                    }} style={{ marginTop: 8, background: T.ink, color: T.white, border: "none", borderRadius: 7, padding: "5px 10px", fontFamily: font.body, fontSize: 10, fontWeight: 600, cursor: "pointer", width: "100%" }}>
                      ⬇️ Download
                    </button>
                  </div>
                );
              })}
            </div>
          </Card>
        ))}

        <div style={{ background: T.greenLight, border: `1px solid ${T.greenBorder}`, borderRadius: 12, padding: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: T.green, marginBottom: 10 }}>🖨️ Print & Install Instructions</div>
          {["Download each QR code using the button above", "Print on card stock — 4×4 inches is best", "Laminate or cover with clear packing tape", "Post at each unit/asset at eye level", "Scan with your phone to confirm it opens correctly"].map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, fontSize: 13, color: T.green }}>
              <span style={{ fontWeight: 700 }}>{i+1}.</span><span>{s}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // ── REPORT (QR Scan target) ──
  if (screen === "report") return (
    <div style={{ fontFamily: font.body, background: T.cream, minHeight: "100vh", color: T.ink }}>
      <style>{`* { box-sizing: border-box; }`}</style>
      {toast && <Toast msg={toast.msg} color={toast.color} />}
      <div style={{ maxWidth: 440, margin: "0 auto", padding: "44px 20px" }}>
        {!reportDone ? (
          <>
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div style={{ width: 56, height: 56, background: T.ink, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, margin: "0 auto 16px" }}>📋</div>
              <div style={{ fontFamily: font.display, fontSize: 11, color: T.muted, letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>SupplyPing · Facility Operations</div>
              <h2 style={{ fontFamily: font.display, fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>{tr(reportLang, "Report a Facility Issue")}</h2>
              <p style={{ color: T.muted, fontSize: 13, margin: "0 0 8px" }}>{tr(reportLang, "Select the issue(s). Takes 10 seconds.")}</p>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", marginTop: 8 }}>
                {LANGS.map(l => (
                  <button key={l.id} onClick={() => setReportLang(l.id)}
                    style={{ padding: "5px 12px", borderRadius: 100, fontFamily: font.body, fontSize: 11.5, fontWeight: 600, cursor: "pointer", border: `1.5px solid ${reportLang === l.id ? T.ink : T.border}`, background: reportLang === l.id ? T.ink : T.white, color: reportLang === l.id ? T.white : T.muted }}>
                    {l.label}
                  </button>
                ))}
              </div>
              {(qrRoom || qrLocation) && (
                <div style={{ background: T.blueLight, border: `1px solid ${T.blueBorder}`, borderRadius: 10, padding: "8px 14px", fontSize: 12, color: T.blue, fontWeight: 500, display: "inline-block", marginTop: 6 }}>
                  📍 {[qrLocation, qrRoom, qrStall ? `Unit/Asset ${qrStall}` : ""].filter(Boolean).join(" · ")}
                </div>
              )}
            </div>

            <div style={{ background: T.blueLight, border: `1px solid ${T.blueBorder}`, borderRadius: 10, padding: "8px 14px", fontSize: 12, color: T.blue, fontWeight: 500, textAlign: "center", marginBottom: 16 }}>
              ✓ {tr(reportLang, "Select one or more issues, then tap Send")}
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 16 }}>
              {getReportCategories(qrCategory).map(cat => (
                <div key={cat.id}>
                  <div style={{ fontSize: 11, color: cat.color, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8, padding: "4px 0" }}>{trL(reportLang, cat.label)}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {cat.items.map(s => {
                      const sel = reportIssues.includes(s.id);
                      return (
                        <button key={s.id} onClick={() => setReportIssues(prev => prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id])}
                          style={{ background: sel ? T.ink : T.white, border: `2px solid ${sel ? T.ink : T.border}`, borderRadius: 12, padding: "13px 16px", fontFamily: font.body, cursor: "pointer", display: "flex", alignItems: "center", gap: 12, boxShadow: T.shadow }}>
                          <span style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${sel ? T.white : T.dim}`, background: sel ? T.green : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 12, color: T.white }}>{sel ? "✓" : ""}</span>
                          <span style={{ fontSize: 22 }}>{s.emoji}</span>
                          <span style={{ fontSize: 14, fontWeight: 600, color: sel ? T.white : T.ink }}>{tr(reportLang, s.label)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              <div>
                <div style={{ fontSize: 11, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8, padding: "4px 0" }}>✏️ {tr(reportLang, "Other / Custom Issue")}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={otherText} onChange={e => setOtherText(e.target.value)} placeholder={tr(reportLang, "Describe any other issue here...")}
                    dir={reportLang === "ar" ? "rtl" : "ltr"}
                    style={{ flex: 1, border: `2px solid ${otherText ? T.ink : T.border}`, borderRadius: 12, padding: "13px 16px", fontFamily: font.body, fontSize: 14, color: T.ink, background: T.white, outline: "none", boxSizing: "border-box", boxShadow: T.shadow }} />
                  {(window.SpeechRecognition || window.webkitSpeechRecognition) && (
                    <button type="button" onClick={() => {
                      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
                      const rec = new SR();
                      rec.lang = (LANGS.find(l => l.id === reportLang) || LANGS[0]).voice;
                      rec.interimResults = false;
                      rec.onresult = (ev) => { const t = ev.results[0][0].transcript; setOtherText(prev => (prev ? prev + " " : "") + t); setListening(false); };
                      rec.onerror = () => setListening(false);
                      rec.onend = () => setListening(false);
                      setListening(true); rec.start();
                    }}
                      style={{ width: 52, borderRadius: 12, border: `2px solid ${listening ? T.red : T.border}`, background: listening ? T.redLight : T.white, cursor: "pointer", fontSize: 20, boxShadow: T.shadow }}>
                      {listening ? "🔴" : "🎤"}
                    </button>
                  )}
                </div>
                {listening && <div style={{ fontSize: 12, color: T.red, marginTop: 6, fontWeight: 600 }}>{tr(reportLang, "Listening...")}</div>}
              </div>

              {/* OPTIONAL PHOTO */}
              <div>
                <div style={{ fontSize: 11, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8, padding: "4px 0" }}>📷 {tr(reportLang, "Add a Photo (optional)")}</div>
                {photoPreview ? (
                  <div style={{ position: "relative", borderRadius: 12, overflow: "hidden", border: `2px solid ${T.green}`, boxShadow: T.shadow }}>
                    <img src={photoPreview} alt="Issue" style={{ width: "100%", display: "block", maxHeight: 220, objectFit: "cover" }} />
                    <button onClick={() => { setPhotoFile(null); setPhotoPreview(null); setAiSuggestion(null); setAiAnalyzing(false); setAiSeverity(""); setAiDescription(""); }}
                      style={{ position: "absolute", top: 8, right: 8, background: "rgba(0,0,0,0.65)", color: "#fff", border: "none", borderRadius: 8, padding: "6px 12px", fontFamily: font.body, fontSize: 12, fontWeight: 600, cursor: "pointer" }}>
                      ✕ Remove
                    </button>
                  </div>
                ) : (
                  <>
                    <div style={{ display: "flex", gap: 8 }}>
                      <button type="button" onClick={() => { const el = document.getElementById("photoCam"); if (el) { el.value = ""; el.click(); } }}
                        style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, border: `2px dashed ${T.border}`, borderRadius: 12, padding: "15px 10px", cursor: "pointer", background: T.white, boxShadow: T.shadow, fontFamily: font.body }}>
                        <span style={{ fontSize: 18 }}>📷</span>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: T.muted }}>{tr(reportLang, "Take Photo")}</span>
                      </button>
                      <button type="button" onClick={() => { const el = document.getElementById("photoLib"); if (el) { el.value = ""; el.click(); } }}
                        style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 8, border: `2px dashed ${T.border}`, borderRadius: 12, padding: "15px 10px", cursor: "pointer", background: T.white, boxShadow: T.shadow, fontFamily: font.body }}>
                        <span style={{ fontSize: 18 }}>🖼️</span>
                        <span style={{ fontSize: 12.5, fontWeight: 600, color: T.muted }}>{tr(reportLang, "From Library")}</span>
                      </button>
                    </div>
                    <input id="photoCam" type="file" accept="image/*" capture="environment"
                      style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
                      onChange={async (e) => {
                        const f = e.target.files && e.target.files[0];
                        if (!f) return;
                        setPhotoFile(f);
                        setPhotoPreview(URL.createObjectURL(f));
                        // AI triage — fails soft to manual flow
                        setAiAnalyzing(true); setAiSuggestion(null);
                        const ai = await analyzeHazardPhoto(f, reportLang);
                        setAiAnalyzing(false);
                        if (!ai || ai._error) showToast(`🤖 AI unavailable: ${ai && ai._error ? ai._error : "unknown error"} — fill the form manually.`, T.yellow);
                        if (ai && ai.item) {
                          setAiSuggestion(ai);
                          setAiSeverity(ai.severity || "Medium");
                          // Worker sees the description in THEIR language; English
                          // is reconstructed at submit for supervisors.
                          setAiDescription(ai.description_local || ai.description || "");
                          const match = ALL_ITEMS.find(s => s.label.includes(ai.item) || ai.item.includes(s.label.replace(/^\S+\s/, "")));
                          if (match) setReportIssues(prev => prev.includes(match.id) ? prev : [...prev, match.id]);
                        }
                      }} />
                    <input id="photoLib" type="file" accept="image/*"
                      style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }}
                      onChange={async (e) => {
                        const f = e.target.files && e.target.files[0];
                        if (!f) return;
                        setPhotoFile(f);
                        setPhotoPreview(URL.createObjectURL(f));
                        // AI triage — fails soft to manual flow
                        setAiAnalyzing(true); setAiSuggestion(null);
                        const ai = await analyzeHazardPhoto(f, reportLang);
                        setAiAnalyzing(false);
                        if (!ai || ai._error) showToast(`🤖 AI unavailable: ${ai && ai._error ? ai._error : "unknown error"} — fill the form manually.`, T.yellow);
                        if (ai && ai.item) {
                          setAiSuggestion(ai);
                          setAiSeverity(ai.severity || "Medium");
                          // Worker sees the description in THEIR language; English
                          // is reconstructed at submit for supervisors.
                          setAiDescription(ai.description_local || ai.description || "");
                          const match = ALL_ITEMS.find(s => s.label.includes(ai.item) || ai.item.includes(s.label.replace(/^\S+\s/, "")));
                          if (match) setReportIssues(prev => prev.includes(match.id) ? prev : [...prev, match.id]);
                        }
                      }} />
                  </>
                )}
                {(aiAnalyzing || aiSuggestion) && (
                  <div style={{ marginTop: 10, background: T.white, border: `2px solid ${aiAnalyzing ? T.border : T.greenBorder}`, borderRadius: 12, padding: "14px 16px", boxShadow: T.shadow }}>
                    {aiAnalyzing ? (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: T.muted, fontWeight: 600 }}>
                        <span style={{ fontSize: 18 }}>🤖</span> Analyzing photo…
                      </div>
                    ) : (
                      <>
                        <div style={{ fontSize: 10.5, color: T.green, textTransform: "uppercase", letterSpacing: 1.4, fontWeight: 700, marginBottom: 8 }}>
                          🤖 {tr(reportLang, "AI Suggestion — review & confirm")}
                        </div>
                        <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink, marginBottom: 10 }}>
                          {tr(reportLang, aiSuggestion.item)}{!aiSuggestion.confident && <span style={{ fontWeight: 500, color: T.muted }}> (low confidence — please verify)</span>}
                        </div>
                        <div style={{ fontSize: 11, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>{tr(reportLang, "Suggested severity")}</div>
                        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                          {["Low", "Medium", "High"].map(s => (
                            <button key={s} type="button" onClick={() => setAiSeverity(s)}
                              style={{ flex: 1, padding: "8px 0", borderRadius: 9, fontFamily: font.body, fontSize: 12, fontWeight: 700, cursor: "pointer",
                                border: `2px solid ${aiSeverity === s ? (s === "High" ? T.red : s === "Medium" ? T.yellow : T.green) : T.border}`,
                                background: aiSeverity === s ? (s === "High" ? T.redLight : s === "Medium" ? T.yellowLight : T.greenLight) : T.white,
                                color: aiSeverity === s ? (s === "High" ? T.red : s === "Medium" ? T.yellow : T.green) : T.muted }}>
                              {tr(reportLang, s)}
                            </button>
                          ))}
                        </div>
                        <div style={{ fontSize: 11, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1, marginBottom: 6 }}>{tr(reportLang, "Description (editable)")}</div>
                        <textarea value={aiDescription} onChange={e => setAiDescription(e.target.value)} rows={2}
                          style={{ width: "100%", border: `1.5px solid ${T.border}`, borderRadius: 9, padding: "9px 12px", fontFamily: font.body, fontSize: 13, color: T.ink, background: T.cream, outline: "none", boxSizing: "border-box", resize: "vertical" }} />
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>

            {(reportIssues.length > 0 || otherText.trim()) && (
              <div style={{ background: T.greenLight, border: `1px solid ${T.greenBorder}`, borderRadius: 10, padding: "10px 14px", fontSize: 12, color: T.green, fontWeight: 500, marginBottom: 14 }}>
                {reportIssues.length + (otherText.trim() ? 1 : 0)} issue{(reportIssues.length + (otherText.trim() ? 1 : 0)) > 1 ? "s" : ""} selected
              </div>
            )}

            <Btn label={sending ? tr(reportLang, "Sending...") : tr(reportLang, "Send Report →")} onClick={async () => {
              if (sending) return;
              const selectedLabels = reportIssues.map(id => ALL_ITEMS.find(s => s.id === id)?.label).filter(Boolean);
              if (otherText.trim()) {
                let customEn = otherText.trim();
                if (reportLang !== "en") {
                  // Translate to English for supervisors; keep the original alongside.
                  try {
                    const tRes = await fetch("/api/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: otherText.trim() }) });
                    if (tRes.ok) { const tj = await tRes.json(); if (tj.english) customEn = `${tj.english} (original: ${otherText.trim()})`; }
                  } catch (e) {}
                }
                selectedLabels.push(`Other: ${customEn}`);
              }
              if (selectedLabels.length === 0) return;
              setSending(true);

              // AI description travels to supervisors in English: if the worker's
              // language isn't English, translate their (possibly edited) text.
              let aiDescEn = aiDescription;
              if (aiDescription && reportLang !== "en") {
                try {
                  const dRes = await fetch("/api/translate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: aiDescription }) });
                  if (dRes.ok) { const dj = await dRes.json(); if (dj.english) aiDescEn = dj.english; }
                } catch (e) {}
              }

              // Upload photo first (if one was added). Non-blocking on failure —
              // a report without its photo still beats no report.
              let photoUrl = null;
              if (photoFile) {
                photoUrl = await uploadReportPhoto(photoFile);
                if (!photoUrl) showToast("⚠️ Photo couldn't upload — sending report without it.", T.yellow);
              }
              const issueString = selectedLabels.join(", ");
              const p = new URLSearchParams(window.location.search);
              // Recipient priority: QR-embedded cleaning email → onboarding value
              // → logged-in Supabase manager's account email (fallback when a
              // manager reports from their own session without a QR).
              let cleaningEmail = alertEmail || p.get("ce") || "";
              if (!cleaningEmail) {
                try {
                  const { data } = await supabase.auth.getUser();
                  cleaningEmail = data?.user?.email || "";
                } catch (e) {}
              }
              // Location fallback chain: QR's l= param → logged-in facility name →
              // the QR's business name (old QRs printed before a facility name was
              // saved carry b= but no l=) → last resort label.
              const locName = qrLocation || p.get("l") || location || qrBusiness || p.get("b") || "Unlisted Location";
              const roomName = qrRoom || p.get("r") || "Unknown Room";
              const stallNum = qrStall || p.get("s") || "1";

              // Diagnostic: shows every source the location is drawn from, in
              // priority order, so an "Unlisted Location" result immediately
              // reveals WHICH source was empty rather than guessing.
              console.log("[Report] location sources →", JSON.stringify({
                qrLocation_state: qrLocation || "(empty)",
                url_param_l: p.get("l") || "(empty)",
                account_facility_name: location || "(empty)",
                qrBusiness_state: qrBusiness || "(empty)",
                url_param_b: p.get("b") || "(empty)",
                RESOLVED_locName: locName,
                full_scanned_url: window.location.href,
              }));
              const biz = qrBusiness || p.get("b") || "SupplyPing";

              // 1) Airtable sync
              const reportFields = {
                "Location": locName,
                "Room": roomName,
                "Stall": `Stall ${stallNum}`,
                "Status": issueString,
                "Cleaning Team Email": cleaningEmail,
                "Reported At": new Date().toISOString(),
                "Resolved": false
              };
              if (photoUrl) reportFields["Photo"] = [{ url: photoUrl }];
              // Try with AI fields; if the Airtable table doesn't have them yet,
              // retry with base fields so the report is never lost.
              const extendedFields = { ...reportFields };
              if (aiSeverity) extendedFields["Severity"] = aiSeverity;
              if (aiDescEn) extendedFields["Details"] = aiDescEn;
              // Bathroom Status = high-level operational state of the room,
              // distinct from Status (the specific issue). Restroom/cleaning
              // issues take the room out of service; everything else flags it.
              const restroomIds = ["restroomclean", "tp", "soap", "towels", "sanitizer", "spillclean", "trash"];
              const isRestroomIssue = reportIssues.some(id => restroomIds.includes(id));
              extendedFields["Bathroom Status"] = isRestroomIssue ? "Closed for Maintenance" : "Needs Attention";
              // Progressive fallback: a report must never be lost to one bad
              // field. Try full → base → bare-minimum, logging each attempt so
              // the offending field is named in the console.
              let saved = await submitReportToAirtable(extendedFields, "full (with Severity/Details/Bathroom Status)");
              if (!saved) saved = await submitReportToAirtable(reportFields, "base (core fields + Photo)");
              if (!saved) {
                const minimal = {
                  "Location": locName,
                  "Room": roomName,
                  "Status": issueString,
                  "Cleaning Team Email": cleaningEmail,
                };
                saved = await submitReportToAirtable(minimal, "minimal (4 text fields only)");
              }
              if (!saved) showToast("⚠️ Alert sent, but the dashboard record failed to save — check console.", T.yellow);

              // 2) EmailJS alert (or offline queue).
              // cleaning_email maps to {{cleaning_email}} in template_58s7r9h;
              // management is always CC'd via the combined recipient list.
              const recipients = [cleaningEmail, MANAGEMENT_EMAIL].filter(Boolean).join(", ");
              const result = await sendOrQueueAlert({
                cleaning_email: recipients,
                to_email: recipients,
                email: recipients,
                location_name: locName,
                issue: [
                  issueString,
                  aiSeverity ? `Severity: ${aiSeverity}` : "",
                  aiDescEn ? `Details: ${aiDescEn}` : "",
                  photoUrl ? `📷 Photo: ${photoUrl}` : ""
                ].filter(Boolean).join(" — "),
                location: locName,
                room: roomName,
                stall: `Stall ${stallNum}`,
                business: biz,
                time: new Date().toLocaleString(),
              });

              if (result.status === "sent") showToast("✅ Report sent! Team notified.", T.green);
              else if (result.status === "offline") showToast("📡 No signal — report saved. It'll send automatically when you're back online.", T.yellow);
              else showToast(`❌ Alert rejected: ${result.error} — report was saved to Airtable.`, T.red);
              setSending(false);
              setReportDone(true);
            }} disabled={reportIssues.length === 0 && !otherText.trim()} variant="primary" full size="lg" />

            <div style={{ textAlign: "center", marginTop: 16 }}>
              <span onClick={() => nav("landing")} style={{ fontSize: 12, color: T.muted, cursor: "pointer" }}>← supplyping.com</span>
            </div>
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "48px 0" }}>
            <div style={{ fontSize: 72, marginBottom: 16 }}>✅</div>
            <h2 style={{ fontFamily: font.display, fontSize: 28, fontWeight: 700, color: T.green, margin: "0 0 10px" }}>{tr(reportLang, "Report Sent!")}</h2>
            <p style={{ color: T.muted, fontSize: 15 }}>{tr(reportLang, "The team has been notified and is on the way.")}</p>
            <div style={{ marginTop: 28, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <Btn label={tr(reportLang, "Report Another Issue")} onClick={() => { setReportIssues([]); setOtherText(""); setPhotoFile(null); setPhotoPreview(null); setAiSuggestion(null); setAiSeverity(""); setAiDescription(""); setReportDone(false); }} variant="outline" />
              <Btn label="← supplyping.com" onClick={() => nav("landing")} variant="ghost" />
            </div>
          </div>
        )}
      </div>
    </div>
  );

  // ── STATUS BOARD ──
  if (screen === "status") return (
    <div style={{ fontFamily: font.body, background: T.cream, minHeight: "100vh", color: T.ink }}>
      <style>{`* { box-sizing: border-box; }`}</style>
      {toast && <Toast msg={toast.msg} color={toast.color} />}
      <div style={{ background: T.white, borderBottom: `1px solid ${T.border}`, padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h2 style={{ fontFamily: font.display, fontSize: 22, fontWeight: 700, margin: "0 0 4px" }}>Live Location Status</h2>
          <p style={{ fontSize: 13, color: T.muted, margin: 0 }}>SupplyPing Facility Operations — Updates automatically</p>
        </div>
        <Btn label="← Dashboard" onClick={() => nav("dashboard")} variant="outline" size="sm" />
      </div>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px" }}>
        {alerts.length === 0 ? (
          <div style={{ background: T.greenLight, border: `1px solid ${T.greenBorder}`, borderRadius: 14, padding: 28, textAlign: "center", color: T.green, fontSize: 14 }}>
            🎉 All locations are fully stocked — nothing to report!
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
            {[...new Set(alerts.map(a => a.room))].map((roomName, i) => {
              const roomAlerts = alerts.filter(a => a.room === roomName && !a.resolved);
              const isCleaning = roomAlerts.some(a => a.supply.id === "cleaning");
              const hasIssues = roomAlerts.filter(a => a.supply.id !== "cleaning").length > 0;
              const status = isCleaning ? "cleaning" : hasIssues ? "issues" : "open";
              const cfg = {
                open: { label: "OPEN", color: T.green, bg: T.greenLight, border: T.greenBorder, emoji: "✅", desc: "All supplies available" },
                cleaning: { label: "CLEANING", color: T.purple, bg: T.purpleLight, border: T.purpleBorder, emoji: "🚫", desc: "Being cleaned — check back soon" },
                issues: { label: "NEEDS ATTENTION", color: T.red, bg: T.redLight, border: T.redBorder, emoji: "⚠️", desc: roomAlerts.map(a => a.status || a.supply.label).join(", ") },
              }[status];
              return (
                <div key={i} style={{ background: cfg.bg, border: `2px solid ${cfg.border}`, borderRadius: 16, padding: 22, boxShadow: T.shadow }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                    <div style={{ fontSize: 30 }}>{cfg.emoji}</div>
                    <span style={{ fontSize: 10, fontWeight: 700, color: cfg.color, background: T.white, border: `1px solid ${cfg.border}`, borderRadius: 6, padding: "3px 10px", letterSpacing: 0.5 }}>{cfg.label}</span>
                  </div>
                  <div style={{ fontFamily: font.display, fontSize: 16, fontWeight: 700, marginBottom: 4 }}>{roomName}</div>
                  <div style={{ fontSize: 12, color: cfg.color, fontWeight: 500, lineHeight: 1.5 }}>{cfg.desc}</div>
                </div>
              );
            })}
          </div>
        )}
        <div style={{ marginTop: 20, background: T.white, border: `1px solid ${T.border}`, borderRadius: 12, padding: "12px 18px", textAlign: "center", fontSize: 13, color: T.muted, boxShadow: T.shadow }}>
          📺 Display this screen on break room monitors so staff know before they walk over
        </div>
      </div>
    </div>
  );

  // ── ACCOUNT SETTINGS ──
  if (screen === "account") return (
    <div style={{ fontFamily: font.body, background: T.cream, minHeight: "100vh", color: T.ink }}>
      <style>{`* { box-sizing: border-box; }`}</style>
      {toast && <Toast msg={toast.msg} color={toast.color} />}
      <header style={{ background: T.white, borderBottom: `1px solid ${T.border}`, padding: "0 24px", display: "flex", alignItems: "center", justifyContent: "space-between", minHeight: 68, boxShadow: T.shadow }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 0" }}>
          <div style={{ width: 32, height: 32, background: T.ink, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>⚙️</div>
          <div>
            <div style={{ fontFamily: font.display, fontSize: 15, fontWeight: 700 }}>Account Settings</div>
            <div style={{ fontSize: 9, color: T.muted, letterSpacing: 1.5, textTransform: "uppercase" }}>{email || "Your Account"}</div>
          </div>
        </div>
        <Btn label="← Dashboard" onClick={() => nav("dashboard")} variant="outline" size="sm" />
      </header>

      <div style={{ maxWidth: 480, margin: "0 auto", padding: "32px 24px" }}>
        <Card style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 11, color: T.orange, textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 700, marginBottom: 6 }}>Change Email</div>
          <p style={{ fontSize: 12, color: T.muted, margin: "0 0 16px", lineHeight: 1.5 }}>Your login email is <b>{email}</b>. Enter a new email below — you may need to confirm the change via a link sent to your inbox.</p>
          <Input label="New Email" value={newEmail} onChange={setNewEmail} placeholder="new@yourbusiness.com" type="email" />
          <Btn label={acctLoading ? "Updating..." : "Update Email →"} onClick={async () => {
            if (!newEmail || !newEmail.includes("@")) { showToast("Please enter a valid email", T.red); return; }
            setAcctLoading(true);
            const { error } = await supabase.auth.updateUser({ email: newEmail });
            if (error) { setAcctLoading(false); showToast(`❌ ${error.message}`, T.red); return; }
            // Keep the Airtable client record in sync so locations still load
            try {
              const recordId = await findClientRecordId(email);
              if (recordId) {
                await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/Clients/${recordId}`, {
                  method: "PATCH",
                  headers: { "Authorization": `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
                  body: JSON.stringify({ fields: { "Email": newEmail } })
                });
              }
            } catch (e) {}
            setEmail(newEmail); setNewEmail(""); setAcctLoading(false);
            showToast("✅ Email update requested — check your inbox to confirm.", T.green);
          }} disabled={!newEmail || acctLoading} variant="primary" full />
        </Card>

        <Card>
          <div style={{ fontSize: 11, color: T.orange, textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 700, marginBottom: 6 }}>Change Password</div>
          <p style={{ fontSize: 12, color: T.muted, margin: "0 0 16px", lineHeight: 1.5 }}>Minimum 6 characters. You'll stay logged in after changing it.</p>
          <Input label="New Password" value={newPassword} onChange={setNewPassword} placeholder="New password" type="password" />
          <Input label="Confirm New Password" value={confirmPassword} onChange={setConfirmPassword} placeholder="Type it again" type="password" />
          <Btn label={acctLoading ? "Updating..." : "Update Password →"} onClick={async () => {
            if (newPassword.length < 6) { showToast("Password must be at least 6 characters", T.red); return; }
            if (newPassword !== confirmPassword) { showToast("Passwords don't match", T.red); return; }
            setAcctLoading(true);
            const { error } = await supabase.auth.updateUser({ password: newPassword });
            setAcctLoading(false);
            if (error) { showToast(`❌ ${error.message}`, T.red); return; }
            setNewPassword(""); setConfirmPassword("");
            showToast("✅ Password updated!", T.green);
          }} disabled={!newPassword || !confirmPassword || acctLoading} variant="primary" full />
        </Card>
      </div>
    </div>
  );

  // ── PASSWORD RESET (landed from email link) ──
  if (screen === "reset") return (
    <div style={{ fontFamily: font.body, background: T.cream, minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <style>{`* { box-sizing: border-box; }`}</style>
      {toast && <Toast msg={toast.msg} color={toast.color} />}
      <div style={{ width: "100%", maxWidth: 420 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 32 }}>
          <div style={{ width: 32, height: 32, background: T.ink, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>📋</div>
          <span style={{ fontFamily: font.display, fontSize: 16, fontWeight: 700 }}>SupplyPing</span>
        </div>
        <h2 style={{ fontFamily: font.display, fontSize: 30, fontWeight: 700, margin: "0 0 6px" }}>Set a new password</h2>
        <p style={{ color: T.muted, fontSize: 13, marginBottom: 28 }}>Enter a new password for your account. Minimum 6 characters.</p>
        <Card>
          <Input label="New Password" value={newPassword} onChange={setNewPassword} placeholder="New password" type="password" />
          <Input label="Confirm New Password" value={confirmPassword} onChange={setConfirmPassword} placeholder="Type it again" type="password" />
          {authError && <div style={{ background: T.redLight, border: `1px solid ${T.redBorder}`, borderRadius: 8, padding: "10px 14px", fontSize: 13, color: T.red, marginBottom: 14 }}>{authError}</div>}
          <Btn label={acctLoading ? "Updating..." : "Update Password →"} onClick={async () => {
            if (newPassword.length < 6) { setAuthError("Password must be at least 6 characters."); return; }
            if (newPassword !== confirmPassword) { setAuthError("Passwords don't match."); return; }
            setAuthError(""); setAcctLoading(true);
            const { error } = await supabase.auth.updateUser({ password: newPassword });
            setAcctLoading(false);
            if (error) { setAuthError(error.message + " — the reset link may have expired. Request a new one from the login page."); return; }
            setNewPassword(""); setConfirmPassword("");
            showToast("✅ Password updated! You can log in now.", T.green);
            setTimeout(() => nav("login"), 1500);
          }} disabled={!newPassword || !confirmPassword || acctLoading} variant="primary" full />
          <div style={{ textAlign: "center", marginTop: 16, fontSize: 13, color: T.muted }}>
            <span onClick={() => nav("login")} style={{ color: T.blue, cursor: "pointer", fontWeight: 500 }}>← Back to login</span>
          </div>
        </Card>
      </div>
    </div>
  );

  // ── LEGAL PAGES ──
  if (screen === "terms" || screen === "privacy") {
    const isTerms = screen === "terms";
    return (
      <div style={{ fontFamily: font.body, background: T.cream, minHeight: "100vh", color: T.ink }}>
        <style>{`* { box-sizing: border-box; }`}</style>
        <header style={{ background: T.white, borderBottom: `1px solid ${T.border}`, padding: "14px 24px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, background: T.ink, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>📋</div>
          <span style={{ fontFamily: font.display, fontSize: 16, fontWeight: 700 }}>SupplyPing</span>
          <a href="/" style={{ marginLeft: "auto", fontSize: 13, color: T.blue, textDecoration: "none", fontWeight: 500 }}>← Back to site</a>
        </header>
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "40px 24px", fontSize: 14, lineHeight: 1.8, color: T.muted }}>
          <h1 style={{ fontFamily: font.display, fontSize: 32, fontWeight: 700, color: T.ink, marginBottom: 6 }}>{isTerms ? "Terms of Service" : "Privacy Policy"}</h1>
          <p style={{ fontSize: 12, color: T.dim, marginBottom: 28 }}>SupplyPing · supplyping.com · Last updated July 2026</p>
          {isTerms ? (
            <>
              <h3 style={{ color: T.ink }}>1. The Service</h3>
              <p>SupplyPing provides QR-code-based facility issue reporting with email and SMS notifications, issue logging, and a management dashboard. SupplyPing is a notification and record-keeping tool; it does not guarantee response times and is not a substitute for a facility's own safety, maintenance, or emergency procedures.</p>
              <h3 style={{ color: T.ink }}>2. SMS Messaging Terms</h3>
              <p>By providing a phone number and checking the SMS consent box, you agree to receive SMS text messages from SupplyPing regarding facility hazards, operational alerts, and account notifications. Message frequency varies based on facility activity. Message and data rates may apply. Reply <b>STOP</b> to opt out at any time, or <b>HELP</b> for help. Consent is not a condition of purchase. Carriers are not liable for delayed or undelivered messages.</p>
              <h3 style={{ color: T.ink }}>3. Accounts &amp; Acceptable Use</h3>
              <p>You are responsible for the accuracy of contact information you provide and for maintaining the confidentiality of your login credentials. You agree not to misuse the service, including submitting false reports.</p>
              <h3 style={{ color: T.ink }}>4. Pilot Program</h3>
              <p>Founding pilot accounts receive the service free for 14 days. After the pilot, continued use is subject to the then-current published pricing. Either party may discontinue at any time.</p>
              <h3 style={{ color: T.ink }}>5. Contact</h3>
              <p>Questions: hello@supplyping.com · 313-591-3484</p>
            </>
          ) : (
            <>
              <h3 style={{ color: T.ink }}>1. What We Collect</h3>
              <p>Account details (business name, email, industry), alert contact details (team email addresses and, if provided, mobile phone numbers with SMS consent), facility configuration (locations and areas), and issue reports (category, description, optional photo, timestamp).</p>
              <h3 style={{ color: T.ink }}>2. Mobile Numbers &amp; SMS Consent</h3>
              <p><b style={{ color: T.ink }}>Personal mobile numbers and SMS consent data are never shared, sold, or rented to third parties for marketing purposes.</b> Phone numbers are used solely to deliver the facility alerts and account notifications you opted into. SMS consent records are retained as required for compliance. You may opt out at any time by replying STOP.</p>
              <h3 style={{ color: T.ink }}>3. How Information Is Used</h3>
              <p>To deliver alerts, operate your dashboard, maintain issue records, improve the service, and communicate with you about your account. Report photos are stored to document the reported issue.</p>
              <h3 style={{ color: T.ink }}>4. Service Providers</h3>
              <p>We use infrastructure providers (hosting, database, email and SMS delivery) to operate the service. These providers process data only to provide their service to us and are not permitted to use it for their own marketing.</p>
              <h3 style={{ color: T.ink }}>5. Your Choices</h3>
              <p>You can update account details in Account Settings, opt out of SMS by replying STOP, or request deletion of your data at hello@supplyping.com.</p>
            </>
          )}
        </div>
      </div>
    );
  }

  return null;
}
