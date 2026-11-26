/* Dates and times in the user's time zone. Local times are written 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM'. */
const parts = (tz, d) => Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
}).formatToParts(d).map(p => [p.type, p.value]));

export const today = (tz, d = new Date()) => { const p = parts(tz, d); return `${p.year}-${p.month}-${p.day}`; };
export const now = (tz, d = new Date()) => { const p = parts(tz, d); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; };
export const addDays = (key, n) => { const d = new Date(key.slice(0, 10) + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const addMinutes = (key, min) => new Date(new Date(key + ':00Z').getTime() + min * 60000).toISOString().slice(0, 16);
export const weekday = (tz, d = new Date()) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(d);
export const persianDate = (tz, d = new Date()) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    .formatToParts(d).map(x => [x.type, x.value]));
  return `${p.weekday} ${p.day} ${p.month} ${p.year}`; // پنجشنبه ۵ آذر ۱۴۰۵
};
