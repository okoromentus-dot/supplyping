import { useState, useEffect } from "react";
import { supabase } from "./supabase.js";
import emailjs from "@emailjs/browser";

const EMAILJS_SERVICE = "service_9f62cg2";
const EMAILJS_TEMPLATE = "template_58s7r9h";
const EMAILJS_PUBLIC_KEY = "WZ68pLc75xuy8hcHi";
const MANAGEMENT_EMAIL = "hello@supplyping.com";

// Initialize EmailJS once at startup
try { emailjs.init(EMAILJS_PUBLIC_KEY); } catch(e) {}

const AIRTABLE_TOKEN = "patkVT1Wc5FP40iAq.f98ab9293b37172e41e3d7a1ce3b58ce2ebcdc1b2b55aeff15a5b47198194d77";
const AIRTABLE_BASE = "appOkUWfKR5sb2Br4";
const AIRTABLE_BASE_FORM = "https://airtable.com/appOkUWfKR5sb2Br4/shr6E9eQcAhQ5I7En";

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

const SUPPLY_CATEGORIES = [
  {
    id: "restroom", label: "🚻 Restroom Supplies", color: T.blue, bg: T.blueLight, border: T.blueBorder,
    items: [
      { id: "soap", emoji: "🧼", label: "No Soap" },
      { id: "towels", emoji: "🖐️", label: "No Paper Towels" },
      { id: "tp", emoji: "🧻", label: "No Toilet Paper" },
      { id: "pads", emoji: "🌸", label: "No Feminine Products" },
      { id: "sanitizer", emoji: "🧴", label: "No Hand Sanitizer" },
      { id: "cleaning", emoji: "🚫", label: "Cleaning Needed" },
    ]
  },
  {
    id: "breakroom", label: "☕ Breakroom & Kitchen", color: T.orange, bg: T.orangeLight, border: T.orangeBorder,
    items: [
      { id: "coffee", emoji: "☕", label: "Coffee Machine Down" },
      { id: "water", emoji: "💧", label: "Water Dispenser Empty" },
      { id: "fridge", emoji: "❄️", label: "Fridge Issue" },
      { id: "utensils", emoji: "🍴", label: "Utensils Needed" },
    ]
  },
  {
    id: "conference", label: "📽️ Conference & Meeting Rooms", color: T.purple, bg: T.purpleLight, border: T.purpleBorder,
    items: [
      { id: "av", emoji: "📽️", label: "AV / Projector Failure" },
      { id: "cables", emoji: "🔌", label: "Missing Cables" },
      { id: "whiteboard", emoji: "🖊️", label: "Whiteboard Supplies Needed" },
    ]
  },
  {
    id: "office", label: "🖨️ Office & Printing Supplies", color: T.yellow, bg: T.yellowLight, border: T.yellowBorder,
    items: [
      { id: "paperjam", emoji: "🖨️", label: "Printer Paper Jam" },
      { id: "toner", emoji: "🖋️", label: "Ink / Toner Low" },
      { id: "stationery", emoji: "📎", label: "General Stationery Needed" },
    ]
  },
  {
    id: "safety", label: "⚠️ Safety & Maintenance", color: T.red, bg: T.redLight, border: T.redBorder,
    items: [
      { id: "spill", emoji: "⚠️", label: "Spill / Hazard" },
      { id: "lights", emoji: "💡", label: "Flickering Lights" },
      { id: "hvac", emoji: "🌡️", label: "HVAC / Temperature Issue" },
    ]
  },
];

const SUPPLIES = SUPPLY_CATEGORIES.flatMap(cat =>
  cat.items.map(item => ({
    ...item,
    category: cat.id,
    color: cat.color,
    bg: cat.bg,
    border: cat.border,
  }))
);

const buildFormUrl = (cleaningEmail, locationName, roomName, stallNum, bizNameVal) => {
  const base = "https://supplyping.com/r";
  const params = new URLSearchParams();
  if (cleaningEmail) params.set("ce", cleaningEmail);
  if (locationName) params.set("l", locationName);
  if (roomName) params.set("r", roomName);
  if (stallNum) params.set("s", stallNum);
  if (bizNameVal) params.set("b", bizNameVal);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
};

const qr = (url, size = 130) =>
  `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}&color=1A1814&bgcolor=F8F7F4&margin=8`;

async function fetchReports() {
  try {
    const res = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE}/Reports?sort[0][field]=Created Time&sort[0][direction]=desc&maxRecords=50`,
      { headers: { "Authorization": `Bearer ${AIRTABLE_TOKEN}` } }
    );
    const data = await res.json();
    if (!data.records) return [];
    return data.records.map(r => {
      const status = r.fields["Status"] || "";
      const supply = SUPPLIES.find(s => s.label === status) || SUPPLIES[0];
      const createdAt = r.fields["Created Time"] ? new Date(r.fields["Created Time"]) : new Date();
      const diff = Math.round((Date.now() - createdAt.getTime()) / 60000);
      const timeAgo = diff < 1 ? "just now" : diff < 60 ? `${diff} min ago` : diff < 1440 ? `${Math.round(diff/60)} hr ago` : `${Math.round(diff/1440)}d ago`;
      return {
        id: r.id,
        room: r.fields["Room"] || "Unknown Room",
        stall: r.fields["Stall"] || "General",
        location: r.fields["Location"] || "",
        cleaningEmail: r.fields["Cleaning Team Email"] || "",
        supply,
        time: timeAgo,
        resolved: r.fields["Resolved"] || false,
      };
    });
  } catch(e) { return []; }
}

async function resolveInAirtable(id) {
  try {
    await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/Reports/${id}`, {
      method: "PATCH",
      headers: { "Authorization": `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { "Resolved": true } })
    });
  } catch(e) {}
}

function Toast({ msg, color = T.ink }) {
  return (
    <div style={{ position: "fixed", top: 24, left: "50%", transform: "translateX(-50%)", background: color, color: T.white, borderRadius: 100, padding: "12px 28px", fontSize: 13, fontWeight: 600, zIndex: 9999, boxShadow: T.shadowLg, whiteSpace: "nowrap", fontFamily: font.body }}>
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
  const [rooms, setRooms] = useState([{ name: "Men's Room", stalls: 2 }, { name: "Women's Room", stalls: 2 }]);
  const [alertEmail, setAlertEmail] = useState("");
  const [alertPhone, setAlertPhone] = useState("");
  const [smsConsent, setSmsConsent] = useState(false);
  const [testSent, setTestSent] = useState(false);
  const [reportIssues, setReportIssues] = useState([]);
  const [otherText, setOtherText] = useState("");
  const [reportDone, setReportDone] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authLoading, setAuthLoading] = useState(false);
  const [loadingReports, setLoadingReports] = useState(false);
  const [qrBusiness, setQrBusiness] = useState("");
  const [qrLocation, setQrLocation] = useState("");
  const [qrRoom, setQrRoom] = useState("");
  const [qrStall, setQrStall] = useState("");

  const showToast = (msg, color) => { setToast({ msg, color }); setTimeout(() => setToast(null), 3000); };
  const totalQRs = rooms.reduce((s, r) => s + Number(r.stalls || 0), 0);
  const open = alerts.filter(a => !a.resolved);
  const resolved = alerts.filter(a => a.resolved);

  const resolve = async (id) => {
    setAlerts(p => p.map(a => a.id === id ? { ...a, resolved: true } : a));
    await resolveInAirtable(id);
    showToast("✅ Issue marked as resolved!", T.green);
  };

  const addRoom = () => setRooms(p => [...p, { name: "", stalls: 1 }]);
  const updateRoom = (i, f, v) => setRooms(p => p.map((r, idx) => idx === i ? { ...r, [f]: v } : r));
  const removeRoom = (i) => setRooms(p => p.filter((_, idx) => idx !== i));

  const nav = (s) => {
    setScreen(s);
    window.scrollTo(0, 0);
    setAuthError("");
    setAuthLoading(false);
    if (s === "dashboard") {
      setLoadingReports(true);
      fetchReports().then(data => { setAlerts(data); setLoadingReports(false); });
    }
  };

  useEffect(() => {
    if (screen !== "dashboard") return;
    const interval = setInterval(() => {
      fetchReports().then(data => setAlerts(data));
    }, 30000);
    return () => clearInterval(interval);
  }, [screen]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const path = window.location.pathname;
    const isQR = path === "/r" || path.startsWith("/r/") || params.has("ce") || params.has("l");

    // Pre-fill location from ?location= URL param (works on any page)
    const locationParam = params.get("location");
    if (locationParam) {
      setLocation(locationParam);
      setQrLocation(locationParam);
    }

    if (isQR) {
      setQrBusiness(params.get("b") || "");
      setQrLocation(params.get("l") || locationParam || "");
      setQrRoom(params.get("r") || "");
      setQrStall(params.get("s") || "");
      setAlertEmail(params.get("ce") || "");
      setScreen("report");
    }
  }, []);

  const sendTestAlert = async () => {
    if (!alertEmail) return;
    try {
      await emailjs.send(EMAILJS_SERVICE, EMAILJS_TEMPLATE, {
        cleaning_email: `${alertEmail}, ${MANAGEMENT_EMAIL}`,
        to_email: `${alertEmail}, ${MANAGEMENT_EMAIL}`,
        email: alertEmail,
        issue: "🧻 No Toilet Paper (TEST ALERT)",
        location: location || "Test Location",
        room: "Test Room",
        stall: "Stall 1",
        business: bizName || "Your Business",
        time: new Date().toLocaleString(),
      });
      setTestSent(true);
      showToast("✅ Test alert sent! Check your email.", T.green);
    } catch(e) {
      showToast("❌ Test failed. Check your email settings.", T.red);
    }
  };

  const sendAlert = async (issue, loc, room, stall, cleaningEmail, business) => {
    if (!cleaningEmail) return;
    try {
      await emailjs.send(EMAILJS_SERVICE, EMAILJS_TEMPLATE, {
        cleaning_email: cleaningEmail,
        issue: issue,
        location: loc,
        room: room,
        stall: stall,
        business: business,
        time: new Date().toLocaleString(),
      }, EMAILJS_PUBLIC_KEY);
    } catch(e) { console.log("Alert error:", e); }
  };

  // ── LANDING ──
  if (screen === "landing") return (
    <div style={{ fontFamily: font.body, background: T.white, color: T.ink, minHeight: "100vh" }}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.4}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
        * { box-sizing: border-box; }
      `}</style>
      {toast && <Toast msg={toast.msg} color={toast.color} />}

      {/* NAV */}
      <nav style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(255,255,255,0.97)", backdropFilter: "blur(20px)", borderBottom: `1px solid ${T.border}`, padding: "0 48px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 72 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 38, height: 38, background: T.ink, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🚻</div>
          <div>
            <div style={{ fontFamily: font.display, fontSize: 18, fontWeight: 700, letterSpacing: -0.5 }}>SupplyPing</div>
            <div style={{ fontSize: 9, color: T.muted, letterSpacing: 2, textTransform: "uppercase", fontFamily: font.body }}>FACILITY OPERATIONS PLATFORM</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Btn label="Log In" onClick={() => nav("login")} variant="ghost" />
          <Btn label="Start Free Trial →" onClick={() => nav("signup")} variant="primary" />
        </div>
      </nav>

      {/* HERO */}
      <div style={{ maxWidth: 1000, margin: "0 auto", padding: "100px 48px 80px", textAlign: "center" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: T.greenLight, border: `1px solid ${T.greenBorder}`, borderRadius: 100, padding: "6px 20px", fontSize: 12, color: T.green, fontWeight: 600, marginBottom: 32 }}>
          <div style={{ width: 6, height: 6, background: T.green, borderRadius: "50%", animation: "pulse 2s infinite" }} />
          Free 30-Day Pilot — Metro Detroit Businesses & Facilities
        </div>
        <h1 style={{ fontFamily: font.display, fontSize: 68, fontWeight: 700, margin: "0 0 24px", letterSpacing: -3, lineHeight: 1.0 }}>
          Know Before<br />You Go <span style={{ color: T.orange }}>🚻</span>
        </h1>
        <p style={{ fontSize: 19, color: T.muted, maxWidth: 580, margin: "0 auto 16px", lineHeight: 1.7 }}>
          Real-time workplace supply & facility alerts for offices, warehouses, retail, and campuses. From restroom supplies to equipment failures — covered.
        </p>
        <p style={{ fontSize: 14, color: T.dim, maxWidth: 500, margin: "0 auto 40px", lineHeight: 1.6 }}>
          Workers scan a QR code → tap the issue → the right team is notified instantly. Set up in 10 minutes. No IT team needed.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginBottom: 16 }}>
          <Btn label="Start Free Trial — No Credit Card →" onClick={() => nav("signup")} variant="primary" size="lg" />
          <Btn label="See How It Works →" onClick={() => nav("report")} variant="outline" size="lg" />
        </div>
        <div style={{ fontSize: 12, color: T.dim }}>✓ No credit card &nbsp;&nbsp; ✓ Setup in 10 min &nbsp;&nbsp; ✓ Cancel anytime</div>

        {/* Category badges */}
        <div style={{ marginTop: 56, display: "flex", gap: 8, justifyContent: "center", flexWrap: "wrap" }}>
          {SUPPLY_CATEGORIES.map(cat => (
            <div key={cat.id} style={{ background: cat.bg, border: `1px solid ${cat.border}`, borderRadius: 100, padding: "7px 16px", fontSize: 12, fontWeight: 600, color: cat.color }}>
              {cat.label}
            </div>
          ))}
        </div>
      </div>

      {/* HOW IT WORKS */}
      <div style={{ background: T.cream, borderTop: `1px solid ${T.border}`, borderBottom: `1px solid ${T.border}`, padding: "80px 48px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ textAlign: "center", marginBottom: 48 }}>
            <div style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: 2, marginBottom: 12, fontWeight: 600 }}>How It Works</div>
            <h2 style={{ fontFamily: font.display, fontSize: 40, fontWeight: 700, margin: 0, letterSpacing: -1.5 }}>Up and running in 10 minutes</h2>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 20 }}>
            {[
              { n: "01", emoji: "✍️", title: "Sign Up Free", desc: "Create your account and select your industry. No credit card needed." },
              { n: "02", emoji: "🚻", title: "Add Bathrooms", desc: "Enter your locations, rooms, and stall counts. We generate everything." },
              { n: "03", emoji: "🖨️", title: "Print QR Codes", desc: "Download and print your unique codes. Post inside each stall door." },
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

      {/* INDUSTRIES */}
      <div style={{ padding: "80px 48px" }}>
        <div style={{ maxWidth: 1000, margin: "0 auto", textAlign: "center" }}>
          <div style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: 2, marginBottom: 12, fontWeight: 600 }}>Built For Every Facility</div>
          <h2 style={{ fontFamily: font.display, fontSize: 40, fontWeight: 700, margin: "0 0 40px", letterSpacing: -1.5 }}>One solution. Every industry.</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 10 }}>
            {INDUSTRIES.map(i => (
              <div key={i.id} style={{ background: T.cream, border: `1px solid ${T.border}`, borderRadius: 12, padding: "16px 8px", textAlign: "center", cursor: "pointer" }}
                onClick={() => nav("signup")}>
                <div style={{ fontSize: 22, marginBottom: 6 }}>{i.emoji}</div>
                <div style={{ fontSize: 10, fontWeight: 500, color: T.ink, lineHeight: 1.3 }}>{i.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* PRICING */}
      <div style={{ background: T.cream, borderTop: `1px solid ${T.border}`, padding: "80px 48px" }}>
        <div style={{ maxWidth: 860, margin: "0 auto", textAlign: "center" }}>
          <div style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: 2, marginBottom: 12, fontWeight: 600 }}>Pricing</div>
          <h2 style={{ fontFamily: font.display, fontSize: 40, fontWeight: 700, margin: "0 0 8px", letterSpacing: -1.5 }}>Simple, honest pricing.</h2>
          <p style={{ color: T.muted, fontSize: 15, marginBottom: 48 }}>Start free for 30 days. No credit card required.</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
            {[
              { name: "Starter", price: "$49", mo: "/mo", features: ["1 facility", "Up to 10 bathrooms", "Email alerts to operations staff", "Live dashboard", "QR code generator"], highlight: false },
              { name: "Business", price: "$149", mo: "/mo", features: ["Up to 5 facilities", "Unlimited bathrooms", "SMS + Email alerts", "Weekly summary report", "Priority support"], highlight: true },
              { name: "Enterprise", price: "Custom", mo: "", features: ["Unlimited facilities", "Door sensor integration", "Custom branding", "API access", "Dedicated support"], highlight: false },
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

      {/* FOOTER CTA */}
      <div style={{ background: "linear-gradient(135deg, #1A1814 0%, #2a2420 100%)", padding: "100px 48px", textAlign: "center" }}>
        <div style={{ fontSize: 11, color: "#555", letterSpacing: 3, textTransform: "uppercase", marginBottom: 20, fontWeight: 600 }}>GET STARTED TODAY</div>
        <h2 style={{ fontFamily: font.display, fontSize: 48, fontWeight: 700, color: T.white, margin: "0 0 16px", letterSpacing: -2 }}>
          Ready to streamline<br />your facility operations?
        </h2>
        <p style={{ color: "#888", fontSize: 16, marginBottom: 40, maxWidth: 480, margin: "0 auto 40px", lineHeight: 1.6 }}>
          Free for 30 days. Set up in 10 minutes. No credit card required.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap", marginBottom: 16 }}>
          <Btn label="Start Free Trial →" onClick={() => nav("signup")} variant="orange" size="lg" />
          <a href="https://mail.google.com/mail/?view=cm&fs=1&to=hello@supplyping.com&su=SupplyPing%20Inquiry" target="_blank" rel="noreferrer" style={{ display: "inline-block", background: "transparent", color: "#888", border: "1px solid #333", borderRadius: 10, padding: "16px 32px", fontFamily: font.body, fontSize: 16, fontWeight: 600, textDecoration: "none" }}>
            Email Us →
          </a>
        </div>
        <div style={{ marginTop: 48, paddingTop: 32, borderTop: "1px solid #222", display: "flex", justifyContent: "center", gap: 40, fontSize: 13, color: "#444", flexWrap: "wrap" }}>
          {[{ icon: "📧", text: "hello@supplyping.com" }, { icon: "📞", text: "313-591-3484" }, { icon: "🌐", text: "supplyping.com" }, { icon: "📍", text: "Metro Detroit, MI" }].map(t => (
            <span key={t.text} style={{ display: "flex", alignItems: "center", gap: 6 }}>{t.icon} {t.text}</span>
          ))}
        </div>
        <div id="sms-terms" style={{ maxWidth: 720, margin: "32px auto 0", paddingTop: 24, borderTop: "1px solid #1c1c1c", fontSize: 11, color: "#555", lineHeight: 1.7, textAlign: "left" }}>
          <div style={{ fontWeight: 700, color: "#777", marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>SMS Alerts — Terms &amp; Consent</div>
          <p style={{ margin: "0 0 8px" }}>
            SupplyPing sends SMS text alerts to facility operators and cleaning teams who opt in during account setup. By providing a mobile number and checking the consent box, you agree to receive recurring facility-alert text messages from SupplyPing. Message frequency varies based on facility activity. Message and data rates may apply.
          </p>
          <p style={{ margin: "0 0 8px" }}>
            Reply <b>STOP</b> at any time to unsubscribe. Reply <b>HELP</b> for assistance, or contact us at hello@supplyping.com or 313-591-3484. Consent to receive SMS is not a condition of purchase.
          </p>
          <p style={{ margin: 0 }}>
            We do not sell or share mobile information with third parties for marketing. See our Privacy Policy and Terms of Service for details. © 2026 SupplyPing, Metro Detroit, MI.
          </p>
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
          <div style={{ width: 32, height: 32, background: T.ink, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🚻</div>
          <span style={{ fontFamily: font.display, fontSize: 16, fontWeight: 700 }}>SupplyPing</span>
          <span style={{ color: T.muted, fontSize: 12 }}>← Back</span>
        </div>
        <h2 style={{ fontFamily: font.display, fontSize: 30, fontWeight: 700, margin: "0 0 6px" }}>Create your account</h2>
        <p style={{ color: T.muted, fontSize: 13, marginBottom: 28 }}>Start your free 30-day trial. No credit card required.</p>
        <Card>
          <Input label="Business Name" value={bizName} onChange={setBizName} placeholder="Evans Distribution" />
          <Input label="Work Email" value={email} onChange={setEmail} placeholder="you@yourbusiness.com" type="email" />
          <Input label="Password (min 6 characters)" value={password} onChange={setPassword} placeholder="Create a strong password" type="password" />
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 10, fontWeight: 500 }}>Your Industry</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, maxHeight: 300, overflowY: "auto" }}>
              {INDUSTRIES.map(i => (
                <button key={i.id} onClick={() => setIndustry(i.id)}
                  style={{ background: industry === i.id ? T.ink : T.cream, color: industry === i.id ? T.white : T.ink, border: `1.5px solid ${industry === i.id ? T.ink : T.border}`, borderRadius: 10, padding: "10px 12px", fontFamily: font.body, fontSize: 12, fontWeight: 500, cursor: "pointer", textAlign: "left", transition: "all 0.15s" }}>
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
                body: JSON.stringify({ access_key: "7f502c28-1de9-4159-807c-773d5f4d5cbb", subject: `🎉 New SupplyPing Signup — ${bizName}`, "Business Name": bizName, "Email": email, "Industry": INDUSTRIES.find(i => i.id === industry)?.label || industry, "Plan": "Free Trial" })
              });
            } catch(e) {}
            setScreen("onboard"); setStep(1);
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
          <div style={{ width: 32, height: 32, background: T.ink, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🚻</div>
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
            setAuthLoading(false);
            if (error) { setAuthError("Invalid email or password. Please try again."); return; }
            nav("dashboard");
          }} disabled={!email || !password || authLoading} variant="primary" full />
          <div style={{ textAlign: "center", marginTop: 16, fontSize: 13, color: T.muted }}>
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
      <div style={{ background: T.white, borderBottom: `1px solid ${T.border}`, padding: "20px 48px" }}>
        <div style={{ maxWidth: 620, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 28, height: 28, background: T.ink, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>🚻</div>
              <span style={{ fontFamily: font.display, fontSize: 15, fontWeight: 700 }}>SupplyPing Setup</span>
            </div>
            <span style={{ fontSize: 12, color: T.muted, fontWeight: 500 }}>Step {step} of 4</span>
          </div>
          <div style={{ background: T.border, borderRadius: 100, height: 6, overflow: "hidden" }}>
            <div style={{ background: T.ink, width: `${(step / 4) * 100}%`, height: "100%", borderRadius: 100, transition: "width 0.5s ease" }} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
            {["Your Facility", "Bathrooms", "Set Up Alerts", "QR Codes"].map((s, i) => (
              <div key={i} style={{ fontSize: 10, color: step > i ? T.green : step === i + 1 ? T.ink : T.dim, fontWeight: step === i + 1 ? 700 : 400 }}>{s}</div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 620, margin: "0 auto", padding: "52px 40px" }}>

        {step === 1 && (
          <>
            <div style={{ fontSize: 44, marginBottom: 16 }}>🏢</div>
            <h2 style={{ fontFamily: font.display, fontSize: 30, fontWeight: 700, margin: "0 0 8px" }}>Tell us about your facility</h2>
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
            <div style={{ fontSize: 44, marginBottom: 16 }}>🚻</div>
            <h2 style={{ fontFamily: font.display, fontSize: 30, fontWeight: 700, margin: "0 0 8px" }}>Add your bathrooms</h2>
            <p style={{ color: T.muted, fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>We'll generate a unique QR code for every stall automatically.</p>
            {rooms.map((room, i) => (
              <div key={i} style={{ background: T.white, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14, marginBottom: 10, display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, alignItems: "center", boxShadow: T.shadow }}>
                <input value={room.name} onChange={e => updateRoom(i, "name", e.target.value)} placeholder="e.g. Men's Room — Floor 1"
                  style={{ border: `1.5px solid ${T.border}`, borderRadius: 8, padding: "10px 12px", fontFamily: font.body, fontSize: 13, color: T.ink, background: T.cream, outline: "none", width: "100%" }} />
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, color: T.muted, fontWeight: 500, whiteSpace: "nowrap" }}>Stalls:</span>
                  <select value={room.stalls} onChange={e => updateRoom(i, "stalls", Number(e.target.value))}
                    style={{ border: `1.5px solid ${T.border}`, borderRadius: 8, padding: "10px 8px", fontFamily: font.body, fontSize: 13, background: T.cream, color: T.ink, outline: "none" }}>
                    {[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                </div>
                {rooms.length > 1 && <button onClick={() => removeRoom(i)} style={{ background: "transparent", border: "none", color: T.red, cursor: "pointer", fontSize: 16, padding: "4px" }}>✕</button>}
              </div>
            ))}
            <button onClick={addRoom} style={{ width: "100%", background: "transparent", border: `2px dashed ${T.border}`, borderRadius: 12, padding: "12px", fontFamily: font.body, fontSize: 13, color: T.muted, cursor: "pointer", marginBottom: 16 }}>
              + Add Another Bathroom
            </button>
            <div style={{ background: T.blueLight, border: `1px solid ${T.blueBorder}`, borderRadius: 12, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: T.blue, fontWeight: 500 }}>
              📲 We'll generate <b>{totalQRs} unique QR codes</b> for {rooms.length} bathroom{rooms.length > 1 ? "s" : ""} at {location}
            </div>
            <Btn label="Continue →" onClick={() => setStep(3)} disabled={rooms.some(r => !r.name)} variant="primary" full />
          </>
        )}

        {step === 3 && (
          <>
            <div style={{ fontSize: 44, marginBottom: 16 }}>🔔</div>
            <h2 style={{ fontFamily: font.display, fontSize: 30, fontWeight: 700, margin: "0 0 8px" }}>Set up instant alerts</h2>
            <p style={{ color: T.muted, fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>Enter your cleaning team's contact info. They'll be notified instantly when a supply issue is reported.</p>
            <Input label="Cleaning Team Email" value={alertEmail} onChange={setAlertEmail} placeholder="cleaning@yourbusiness.com" type="email" />
            <Input label="Cleaning Team Phone (for SMS)" value={alertPhone} onChange={setAlertPhone} placeholder="+1 313 000 0000" />
            <div style={{ background: T.cream, border: `1.5px solid ${T.border}`, borderRadius: 12, padding: "14px 16px", marginBottom: 16 }}>
              <label style={{ display: "flex", gap: 10, alignItems: "flex-start", cursor: "pointer" }}>
                <input type="checkbox" checked={smsConsent} onChange={e => setSmsConsent(e.target.checked)}
                  style={{ marginTop: 3, width: 18, height: 18, accentColor: T.green, flexShrink: 0, cursor: "pointer" }} />
                <span style={{ fontSize: 12, color: T.muted, lineHeight: 1.5, fontFamily: font.body }}>
                  By providing a phone number and checking this box, you agree to receive SMS text alerts from SupplyPing about facility supply issues at this number. Message frequency varies. Message &amp; data rates may apply. Reply <b>STOP</b> to unsubscribe or <b>HELP</b> for help. Consent is not a condition of purchase.
                </span>
              </label>
            </div>
            <div style={{ marginBottom: 20 }}>
              <Btn label={testSent ? "✅ Test Sent!" : "📤 Send Test Alert"} onClick={sendTestAlert} disabled={!alertEmail || testSent} variant="outline" size="sm" />
              {testSent && <span style={{ marginLeft: 10, fontSize: 13, color: T.green }}>Check {alertEmail} for the test alert!</span>}
            </div>
            <div style={{ background: T.yellowLight, border: `1px solid ${T.yellowBorder}`, borderRadius: 12, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: T.yellow, fontWeight: 500 }}>
              ⚡ Every time a worker scans a QR code and reports an issue — your cleaning team is notified <b>instantly</b> via email.
            </div>
            <Btn label="Generate My QR Codes →" onClick={async () => {
              try {
                const searchRes = await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/Clients?filterByFormula=${encodeURIComponent(`{Email}="${email}"`)}`, { headers: { "Authorization": `Bearer ${AIRTABLE_TOKEN}` } });
                const searchData = await searchRes.json();
                const fields = { "Business Name": bizName, "Email": email, "Industry": INDUSTRIES.find(i => i.id === industry)?.label || industry, "Cleaning Team Email": alertEmail, "Phone Number": alertPhone, "Facility Name": location, "Plan": "Trial", "Client Status": "Trial" };
                if (searchData.records && searchData.records.length > 0) {
                  await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/Clients/${searchData.records[0].id}`, { method: "PATCH", headers: { "Authorization": `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ fields }) });
                } else {
                  await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/Clients`, { method: "POST", headers: { "Authorization": `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ fields }) });
                }
              } catch(e) {}
              setStep(4);
            }} disabled={!alertEmail} variant="primary" full />
          </>
        )}

        {step === 4 && (
          <>
            <div style={{ fontSize: 44, marginBottom: 16 }}>🎉</div>
            <h2 style={{ fontFamily: font.display, fontSize: 30, fontWeight: 700, margin: "0 0 8px" }}>Your QR codes are ready!</h2>
            <p style={{ color: T.muted, fontSize: 14, lineHeight: 1.6, marginBottom: 24 }}>{totalQRs} unique QR codes for {location}. Print, laminate, and post inside each stall.</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 12, marginBottom: 24 }}>
              {rooms.flatMap((room, ri) =>
                Array.from({ length: room.stalls }, (_, si) => {
                  const formUrl = buildFormUrl(alertEmail, location, room.name, si + 1);
                  return (
                    <div key={`${ri}-${si}`} style={{ background: T.white, border: `1px solid ${T.border}`, borderRadius: 14, padding: 14, textAlign: "center", boxShadow: T.shadow }}>
                      <img src={qr(formUrl)} alt="" style={{ width: 120, height: 120, borderRadius: 8, marginBottom: 8 }} />
                      <div style={{ fontSize: 12, fontWeight: 700 }}>Stall {si + 1}</div>
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
              {["Print on card stock — 4×4 inches is perfect", "Laminate or cover with clear packing tape", "Post inside each stall door at eye level", "Test each QR with your phone before leaving", "Workers scan → cleaning team gets email alert instantly"].map((s, i) => (
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
      <header style={{ background: T.white, borderBottom: `1px solid ${T.border}`, padding: "0 32px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 68, boxShadow: T.shadow, flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, background: T.ink, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🚻</div>
          <div>
            <div style={{ fontFamily: font.display, fontSize: 15, fontWeight: 700 }}>SupplyPing Dashboard</div>
            <div style={{ fontSize: 9, color: T.muted, letterSpacing: 1.5, textTransform: "uppercase" }}>{bizName || "Facility Operations"}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Btn label="🚻 Status Board" onClick={() => nav("status")} variant="outline" size="sm" />
          <Btn label="🚿 Manage Bathrooms" onClick={() => nav("manage")} variant="outline" size="sm" />
          <Btn label={loadingReports ? "⏳ Loading..." : "🔄 Refresh"} onClick={() => { setLoadingReports(true); fetchReports().then(data => { setAlerts(data); setLoadingReports(false); showToast("✅ Refreshed!", T.green); }); }} variant="outline" size="sm" />
          <Btn label="🚪 Log Out" onClick={async () => {
            await supabase.auth.signOut();
            setBizName(""); setEmail(""); setPassword(""); setIndustry("");
            setLocation(""); setAlertEmail(""); setAlertPhone("");
            setRooms([{ name: "Men's Room", stalls: 2 }, { name: "Women's Room", stalls: 2 }]);
            showToast("👋 Logged out successfully!", T.green);
            nav("landing");
          }} variant="outline" size="sm" />
        </div>
      </header>

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px" }}>
        {/* Status Banner */}
        <div style={{ background: open.length === 0 ? T.greenLight : T.redLight, border: `2px solid ${open.length === 0 ? T.greenBorder : T.redBorder}`, borderRadius: 18, padding: "24px 28px", marginBottom: 24, display: "flex", alignItems: "center", gap: 20, boxShadow: T.shadow }}>
          <div style={{ fontSize: 44 }}>{open.length === 0 ? "✅" : "🚨"}</div>
          <div>
            <div style={{ fontFamily: font.display, fontSize: 22, fontWeight: 700, color: open.length === 0 ? T.green : T.red }}>
              {open.length === 0 ? "All Bathrooms Fully Stocked!" : `${open.length} Active Issue${open.length > 1 ? "s" : ""} Need Attention`}
            </div>
            <div style={{ fontSize: 13, color: T.muted, marginTop: 4 }}>
              {open.length === 0 ? "No action needed right now." : "Cleaning team has been notified. Tap ✓ Fixed It when resolved."}
            </div>
          </div>
        </div>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 28 }}>
          {[
            { label: "Open Issues", val: open.length, color: open.length > 0 ? T.red : T.green },
            { label: "Resolved Today", val: resolved.length, color: T.green },
            { label: "Total Reports", val: alerts.length, color: T.blue },
            { label: "Auto-Refresh", val: "30s", color: T.orange },
          ].map(s => (
            <Card key={s.label} style={{ padding: "16px 18px" }}>
              <div style={{ fontSize: 10, color: T.muted, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8, fontWeight: 600 }}>{s.label}</div>
              <div style={{ fontFamily: font.display, fontSize: 28, fontWeight: 700, color: s.color }}>{s.val}</div>
            </Card>
          ))}
        </div>

        {/* Active Alerts */}
        <div style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: 1.2, fontWeight: 600, marginBottom: 14 }}>
          Active Issues
          <span style={{ marginLeft: 8, fontSize: 10, color: T.orange, fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>Live from Airtable · auto-refreshes every 30s</span>
        </div>

        {loadingReports ? (
          <Card style={{ padding: 28, textAlign: "center" }}>
            <div style={{ color: T.blue, fontSize: 14 }}>⏳ Loading live reports from Airtable...</div>
          </Card>
        ) : open.length === 0 ? (
          <div style={{ background: T.greenLight, border: `1px solid ${T.greenBorder}`, borderRadius: 14, padding: 28, textAlign: "center", color: T.green, fontSize: 14, fontWeight: 500 }}>
            🎉 All clear — every bathroom is fully stocked!
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 28 }}>
            {open.map(a => (
              <div key={a.id} style={{ background: a.supply.bg, border: `1.5px solid ${a.supply.border}`, borderRadius: 14, padding: "18px 22px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: T.shadow }}>
                <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                  <div style={{ fontSize: 32 }}>{a.supply.emoji}</div>
                  <div>
                    <div style={{ fontFamily: font.display, fontSize: 16, fontWeight: 700 }}>{a.supply.label}</div>
                    <div style={{ fontSize: 12, color: T.muted, marginTop: 3 }}>{a.room} · {a.stall}{a.location ? ` · ${a.location}` : ""} · {a.time}</div>
                    {a.cleaningEmail && <div style={{ fontSize: 11, color: T.green, marginTop: 2 }}>✅ Alert sent to {a.cleaningEmail}</div>}
                  </div>
                </div>
                <Btn label="✓ Fixed It" onClick={() => resolve(a.id)} variant="green" size="sm" />
              </div>
            ))}
          </div>
        )}

        {/* Resolved */}
        {resolved.length > 0 && (
          <>
            <div style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: 1.2, fontWeight: 600, marginBottom: 12 }}>Resolved</div>
            {resolved.map(a => (
              <div key={a.id} style={{ background: T.white, border: `1px solid ${T.border}`, borderRadius: 12, padding: "12px 18px", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, opacity: 0.55 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13, color: T.muted }}>
                  <span>✅</span><span>{a.supply.label} · {a.room}</span>
                </div>
                <span style={{ fontSize: 11, color: T.green, fontWeight: 600 }}>RESOLVED</span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );

  // ── MANAGE BATHROOMS ──
  if (screen === "manage") return (
    <div style={{ fontFamily: font.body, background: T.cream, minHeight: "100vh", color: T.ink }}>
      <style>{`* { box-sizing: border-box; }`}</style>
      {toast && <Toast msg={toast.msg} color={toast.color} />}
      <header style={{ background: T.white, borderBottom: `1px solid ${T.border}`, padding: "0 32px", display: "flex", alignItems: "center", justifyContent: "space-between", height: 68, boxShadow: T.shadow }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 32, height: 32, background: T.ink, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>🚻</div>
          <div>
            <div style={{ fontFamily: font.display, fontSize: 15, fontWeight: 700 }}>Manage Bathrooms</div>
            <div style={{ fontSize: 9, color: T.muted, letterSpacing: 1.5, textTransform: "uppercase" }}>{bizName || "Facility Operations"}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
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

        {/* Add New */}
        <Card style={{ marginBottom: 28 }}>
          <div style={{ fontSize: 11, color: T.orange, textTransform: "uppercase", letterSpacing: 1.5, fontWeight: 700, marginBottom: 14 }}>+ Add New Bathroom</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center", marginBottom: 14 }}>
            <input placeholder="e.g. Men's Room — Floor 3" id="newRoomInput"
              style={{ border: `1.5px solid ${T.border}`, borderRadius: 10, padding: "12px 14px", fontFamily: font.body, fontSize: 14, color: T.ink, background: T.cream, outline: "none" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 12, color: T.muted, fontWeight: 500 }}>Stalls:</span>
              <select id="newStallCount" style={{ border: `1.5px solid ${T.border}`, borderRadius: 8, padding: "12px 8px", fontFamily: font.body, fontSize: 13, background: T.cream, color: T.ink, outline: "none" }}>
                {[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
          <Btn label="Add Bathroom & Generate QR Codes →" onClick={() => {
            const name = document.getElementById("newRoomInput").value;
            const stalls = Number(document.getElementById("newStallCount").value);
            if (!name) { showToast("Please enter a bathroom name", T.red); return; }
            setRooms(p => [...p, { name, stalls }]);
            document.getElementById("newRoomInput").value = "";
            showToast("✅ Bathroom added! QR codes generated below.", T.green);
          }} variant="orange" />
        </Card>

        {/* Existing Bathrooms */}
        <div style={{ fontSize: 11, color: T.muted, textTransform: "uppercase", letterSpacing: 1.2, fontWeight: 600, marginBottom: 16 }}>
          {rooms.length} Bathroom{rooms.length > 1 ? "s" : ""} · {totalQRs} QR Code{totalQRs > 1 ? "s" : ""}
        </div>

        {rooms.map((room, ri) => (
          <Card key={ri} style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <div style={{ fontFamily: font.display, fontSize: 16, fontWeight: 700 }}>{room.name}</div>
                <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{room.stalls} stall{room.stalls > 1 ? "s" : ""} · {room.stalls} QR code{room.stalls > 1 ? "s" : ""}</div>
              </div>
              <Btn label="Remove" onClick={() => { setRooms(p => p.filter((_, i) => i !== ri)); showToast("🗑️ Bathroom removed", T.red); }} variant="outline" size="sm" />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 12 }}>
              {Array.from({ length: room.stalls }, (_, si) => {
                const formUrl = buildFormUrl(alertEmail, location, room.name, si + 1);
                return (
                  <div key={si} style={{ background: T.cream, border: `1px solid ${T.border}`, borderRadius: 12, padding: 14, textAlign: "center" }}>
                    <img src={qr(formUrl)} alt="" style={{ width: 110, height: 110, borderRadius: 8, marginBottom: 8 }} />
                    <div style={{ fontSize: 12, fontWeight: 700 }}>Stall {si + 1}</div>
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
          {["Download each QR code using the button above", "Print on card stock — 4×4 inches is best", "Laminate or cover with clear packing tape", "Post inside each stall door at eye level", "Scan with your phone to confirm it opens correctly"].map((s, i) => (
            <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6, fontSize: 13, color: T.green }}>
              <span style={{ fontWeight: 700 }}>{i+1}.</span><span>{s}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  // ── REPORT (QR Scan) ──
  if (screen === "report") return (
    <div style={{ fontFamily: font.body, background: T.cream, minHeight: "100vh", color: T.ink }}>
      <style>{`* { box-sizing: border-box; }`}</style>
      {toast && <Toast msg={toast.msg} color={toast.color} />}
      <div style={{ maxWidth: 440, margin: "0 auto", padding: "52px 24px" }}>
        {!reportDone ? (
          <>
            <div style={{ textAlign: "center", marginBottom: 32 }}>
              <div style={{ width: 56, height: 56, background: T.ink, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26, margin: "0 auto 16px" }}>🚻</div>
              <div style={{ fontFamily: font.display, fontSize: 11, color: T.muted, letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>SupplyPing · Facility Operations Platform</div>
              <h2 style={{ fontFamily: font.display, fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>Report a Facility Issue</h2>
              <p style={{ color: T.muted, fontSize: 13, margin: "0 0 8px" }}>Select the issue category. Takes 10 seconds.</p>
              {(qrRoom || qrLocation) && (
                <div style={{ background: T.blueLight, border: `1px solid ${T.blueBorder}`, borderRadius: 10, padding: "8px 14px", fontSize: 12, color: T.blue, fontWeight: 500, display: "inline-block", marginTop: 6 }}>
                  📍 {[qrLocation, qrRoom, qrStall ? `Stall ${qrStall}` : ""].filter(Boolean).join(" · ")}
                </div>
              )}
              {!qrLocation && !qrRoom && (
                <div style={{ marginTop: 12 }}>
                  <input
                    placeholder="Enter your location (e.g. Building A, Floor 2)"
                    value={qrLocation}
                    onChange={e => setQrLocation(e.target.value)}
                    style={{ width: "100%", border: `1.5px solid ${T.border}`, borderRadius: 10, padding: "10px 14px", fontFamily: font.body, fontSize: 13, color: T.ink, background: T.cream, outline: "none", boxSizing: "border-box" }}
                  />
                </div>
              )}
            </div>
            <div style={{ background: T.blueLight, border: `1px solid ${T.blueBorder}`, borderRadius: 10, padding: "8px 14px", fontSize: 12, color: T.blue, fontWeight: 500, textAlign: "center", marginBottom: 16 }}>
              ✓ Select one or more issues, then tap Send
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 16 }}>
              {SUPPLY_CATEGORIES.map(cat => (
                <div key={cat.id}>
                  <div style={{ fontSize: 11, color: cat.color, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8, fontFamily: font.body, padding: "4px 0" }}>
                    {cat.label}
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {cat.items.map(s => {
                      const sel = reportIssues.includes(s.id);
                      return (
                        <button key={s.id} onClick={() => setReportIssues(prev => prev.includes(s.id) ? prev.filter(x => x !== s.id) : [...prev, s.id])}
                          style={{ background: sel ? T.ink : T.white, border: `2px solid ${sel ? T.ink : T.border}`, borderRadius: 12, padding: "13px 16px", fontFamily: font.body, cursor: "pointer", display: "flex", alignItems: "center", gap: 12, boxShadow: T.shadow, transition: "all 0.15s" }}>
                          <span style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${sel ? T.white : T.dim}`, background: sel ? T.green : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 12, color: T.white }}>{sel ? "✓" : ""}</span>
                          <span style={{ fontSize: 22 }}>{s.emoji}</span>
                          <span style={{ fontSize: 14, fontWeight: 600, color: sel ? T.white : T.ink }}>{s.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* OTHER — custom issue */}
              <div>
                <div style={{ fontSize: 11, color: T.muted, fontWeight: 700, textTransform: "uppercase", letterSpacing: 1.2, marginBottom: 8, fontFamily: font.body, padding: "4px 0" }}>
                  ✏️ Other / Custom Issue
                </div>
                <input
                  value={otherText}
                  onChange={e => setOtherText(e.target.value)}
                  placeholder="Describe any other issue here..."
                  style={{ width: "100%", border: `2px solid ${otherText ? T.ink : T.border}`, borderRadius: 12, padding: "13px 16px", fontFamily: font.body, fontSize: 14, color: T.ink, background: T.white, outline: "none", boxSizing: "border-box", boxShadow: T.shadow }}
                />
              </div>
            </div>

            {(reportIssues.length > 0 || otherText.trim()) && (
              <div style={{ background: T.greenLight, border: `1px solid ${T.greenBorder}`, borderRadius: 10, padding: "10px 14px", fontSize: 12, color: T.green, fontWeight: 500, marginBottom: 14 }}>
                {reportIssues.length + (otherText.trim() ? 1 : 0)} issue{(reportIssues.length + (otherText.trim() ? 1 : 0)) > 1 ? "s" : ""} selected
              </div>
            )}

            <Btn label="Send Report →" onClick={async () => {
              const selectedLabels = reportIssues.map(id => SUPPLIES.find(s => s.id === id)?.label).filter(Boolean);
              if (otherText.trim()) selectedLabels.push(`Other: ${otherText.trim()}`);
              if (selectedLabels.length === 0) return;
              const issueString = selectedLabels.join(", ");
              const cleaningEmail = alertEmail || new URLSearchParams(window.location.search).get("ce") || "";
              const locName = qrLocation || new URLSearchParams(window.location.search).get("l") || "Unknown Location";
              const roomName = qrRoom || new URLSearchParams(window.location.search).get("r") || "Unknown Room";
              const stallNum = qrStall || new URLSearchParams(window.location.search).get("s") || "1";
              const biz = qrBusiness || new URLSearchParams(window.location.search).get("b") || "SupplyPing";

              // Submit to Airtable
              try {
                await fetch(`https://api.airtable.com/v0/${AIRTABLE_BASE}/Reports`, {
                  method: "POST",
                  headers: { "Authorization": `Bearer ${AIRTABLE_TOKEN}`, "Content-Type": "application/json" },
                  body: JSON.stringify({ fields: {
                    "Location": locName,
                    "Room": roomName,
                    "Stall": `Stall ${stallNum}`,
                    "Status": issueString,
                    "Cleaning Team Email": cleaningEmail,
                    "Reported At": new Date().toISOString(),
                    "Resolved": false
                  }})
                });
              } catch(e) { console.log("Airtable error:", e); }

              // Build recipient list: cleaning team + management (always notified)
              const recipients = [];
              if (cleaningEmail) recipients.push(cleaningEmail);
              recipients.push(MANAGEMENT_EMAIL);
              const toField = recipients.join(", ");

              // Send email alert via EmailJS to cleaning team AND management
              let emailOk = false;
              try {
                await emailjs.send(EMAILJS_SERVICE, EMAILJS_TEMPLATE, {
                  cleaning_email: toField,
                  to_email: toField,
                  email: toField,
                  issue: issueString,
                  location: locName,
                  room: roomName,
                  stall: `Stall ${stallNum}`,
                  business: biz,
                  time: new Date().toLocaleString(),
                });
                emailOk = true;
              } catch(e) {
                console.log("Email error:", e);
              }

              if (emailOk) {
                showToast("✅ Report sent! Team notified.", T.green);
              } else {
                showToast("⚠️ Report saved. Email alert may be delayed.", T.yellow);
              }
              setReportDone(true);
            }} disabled={reportIssues.length === 0 && !otherText.trim()} variant="primary" full size="lg" />
            <div style={{ textAlign: "center", marginTop: 16 }}>
              <span onClick={() => nav("landing")} style={{ fontSize: 12, color: T.muted, cursor: "pointer" }}>← supplyping.com</span>
            </div>
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "48px 0" }}>
            <div style={{ fontSize: 72, marginBottom: 16 }}>✅</div>
            <h2 style={{ fontFamily: font.display, fontSize: 28, fontWeight: 700, color: T.green, margin: "0 0 10px" }}>Report Sent!</h2>
            <p style={{ color: T.muted, fontSize: 15 }}>The cleaning team has been notified and is on their way.</p>
            <div style={{ marginTop: 28, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <Btn label="Report Another Issue" onClick={() => { setReportIssues([]); setOtherText(""); setReportDone(false); }} variant="outline" />
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
      <div style={{ background: T.white, borderBottom: `1px solid ${T.border}`, padding: "20px 32px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h2 style={{ fontFamily: font.display, fontSize: 22, fontWeight: 700, margin: "0 0 4px" }}>Live Bathroom Status</h2>
          <p style={{ fontSize: 13, color: T.muted, margin: 0 }}>SupplyPing Facility Operations — Updates automatically</p>
        </div>
        <Btn label="← Dashboard" onClick={() => nav("dashboard")} variant="outline" size="sm" />
      </div>
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "32px 24px" }}>
        {alerts.length === 0 ? (
          <div style={{ background: T.greenLight, border: `1px solid ${T.greenBorder}`, borderRadius: 14, padding: 28, textAlign: "center", color: T.green, fontSize: 14 }}>
            🎉 All bathrooms are fully stocked — nothing to report!
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            {[...new Set(alerts.map(a => a.room))].map((roomName, i) => {
              const roomAlerts = alerts.filter(a => a.room === roomName && !a.resolved);
              const isCleaning = roomAlerts.some(a => a.supply.id === "cleaning");
              const hasIssues = roomAlerts.filter(a => a.supply.id !== "cleaning").length > 0;
              const status = isCleaning ? "cleaning" : hasIssues ? "issues" : "open";
              const cfg = {
                open: { label: "OPEN", color: T.green, bg: T.greenLight, border: T.greenBorder, emoji: "✅", desc: "All supplies available" },
                cleaning: { label: "CLEANING", color: T.purple, bg: T.purpleLight, border: T.purpleBorder, emoji: "🚫", desc: "Being cleaned — check back soon" },
                issues: { label: "NEEDS ATTENTION", color: T.red, bg: T.redLight, border: T.redBorder, emoji: "⚠️", desc: roomAlerts.map(a => a.supply.label).join(", ") },
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
          📺 Display this screen on break room monitors so associates know before they walk over
        </div>
      </div>
    </div>
  );

  return null;
}
