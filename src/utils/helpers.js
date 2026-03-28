// Utility helpers

export const uid = () => Math.random().toString(36).slice(2, 10);
export const todayStr = () => new Date().toISOString().split("T")[0];
export const pad = (n) => String(n).padStart(2, "0");
export const fmtTime = (h, m) => `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${pad(m)} ${h >= 12 ? "PM" : "AM"}`;
export const parseTime = (s) => { if (!s) return null; const [h, m] = s.split(":").map(Number); return { h, m, mins: h * 60 + m }; };
export const minsToStr = (m) => { const h = Math.floor(m / 60), mm = m % 60; return h > 0 ? (mm > 0 ? `${h}h ${mm}m` : `${h}h`) : `${mm}m`; };
export const nowMins = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
export const fmtDateLong = (d) => new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
export const diffDays = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 86400000);
export const fileToBase64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(file); });
