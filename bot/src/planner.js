/* The planner side: today's view, task lists, reminders, the morning brief and the evening review,
   and the buttons on them (✓ done, +1 hour, tomorrow). */
import { openDashboard, live, isTask, boardList, boardName, openTasks, byDue } from './dashboard.js';
import { today, now, addDays, addMinutes, persianDate } from './time.js';
import { words } from './i18n.js';
import { esc, ltr } from './telegram.js';

function dueLabel(c, due) {
  if (!due) return '';
  const w = words(c), day = today(c.tz), time = due.length > 10 ? ' ' + ltr(due.slice(11, 16)) : '';
  const diff = Math.round((new Date(due.slice(0, 10)) - new Date(day)) / 864e5);
  if (diff < 0) return ` — <b>${w.daysLate(-diff)}</b>`;
  if (diff === 0) return ` — ${w.today}${time}`;
  if (diff === 1) return ` — ${w.tomorrow}${time}`;
  return ` — ${ltr(due.slice(0, 10))}${time}`;
}
const lines = (c, s, tasks, showBoard = true) => tasks.map(t => `○ ${esc(t.title)}${dueLabel(c, t.due)}${showBoard ? `  <i>${esc(boardName(s, t.boardId))}</i>` : ''}`).join('\n');
export const doneButtons = tasks => (tasks.length ? { reply_markup: { inline_keyboard: tasks.slice(0, 20).map(t => [{ text: '✓ ' + t.title.slice(0, 40), callback_data: 'done:' + t.id }]) } } : {});

export function todayView(c, s, greeting = '') {
  const w = words(c), day = today(c.tz), open = openTasks(s);
  const late = open.filter(t => t.due && t.due.slice(0, 10) < day).sort(byDue);
  const due = open.filter(t => t.due && t.due.slice(0, 10) === day).sort(byDue);
  const doneN = live(s.tasks).filter(t => t.doneOn === day).length;
  let msg = `${greeting ? greeting + '\n' : ''}<b>${persianDate(c.tz)}</b>  ·  ${ltr(day)}\n`;
  if (late.length) msg += `\n<b>${w.late}</b>\n${lines(c, s, late)}\n`;
  if (due.length) msg += `\n<b>${w.dueToday}</b>\n${lines(c, s, due)}\n`;
  if (!late.length && !due.length) msg += `\n${w.nothingToday} ${w.open(open.length)}`;
  if (doneN) msg += `\n${w.doneToday(doneN)}`;
  return { msg, tasks: [...late, ...due] };
}

export function listView(c, s) {
  const open = openTasks(s).sort(byDue);
  if (!open.length) return { msg: words(c).noOpen, tasks: [] };
  const msg = boardList(s).map(b => [b, open.filter(t => t.boardId === b.id)]).filter(([, l]) => l.length)
    .map(([b, l]) => `<b>${esc(b.name)}</b>\n${lines(c, s, l, false)}`).join('\n\n');
  return { msg: `${msg}\n\n${words(c).tap}`, tasks: open };
}

function eveningView(c, s) {
  const w = words(c), day = today(c.tz), tmr = addDays(day, 1);
  const done = live(s.tasks).filter(t => isTask(t) && t.doneOn === day);
  const next = openTasks(s).filter(t => t.due && t.due.slice(0, 10) <= tmr).sort(byDue);
  if (!done.length && !next.length) return null;
  let msg = `${w.evening}\n`;
  if (done.length) msg += `\n${w.doneToday(done.length)}\n${done.map(t => `<s>${esc(t.title)}</s>`).join('\n')}\n`;
  if (next.length) msg += `\n<b>${w.forTomorrow}</b>\n${lines(c, s, next)}`;
  return { msg, tasks: next };
}

// Every 5 minutes: reminders for tasks whose time has come, the morning brief and the evening review.
export async function planTick(c, tg, state) {
  if (!c.gist.token) return;
  const w = words(c), d = await openDashboard(c), s = d.s;
  const t = now(c.tz), day = t.slice(0, 10), hm = t.slice(11);
  const reminded = (await state.get('reminded')) || {};

  for (const task of openTasks(s)) {
    if (!task.due || task.due.length <= 10 || task.due > t || task.due < addMinutes(t, -120) || reminded[task.id] === task.due) continue;
    reminded[task.id] = task.due;
    await tg.send(`${w.reminder}\n<b>${esc(task.title)}</b>  <i>${esc(boardName(s, task.boardId))}</i>`, { reply_markup: { inline_keyboard: [[
      { text: w.btnDone, callback_data: 'done:' + task.id }, { text: w.btn1h, callback_data: 'snooze:' + task.id }, { text: w.btnTmr, callback_data: 'tmr:' + task.id },
    ]] } });
  }
  for (const id of Object.keys(reminded)) if (!s.tasks.some(x => x.id === id && !x.deleted && !x.done)) delete reminded[id];
  await state.put('reminded', reminded);

  if (c.morning && hm >= c.morning && (await state.get('morningOn')) !== day) {
    await state.put('morningOn', day);
    const v = todayView(c, s, w.morning); await tg.send(v.msg, doneButtons(v.tasks));
  }
  if (c.evening && hm >= c.evening && (await state.get('eveningOn')) !== day) {
    await state.put('eveningOn', day);
    const v = eveningView(c, s); if (v) await tg.send(v.msg, doneButtons(v.tasks));
  }
}

// ✓ done / +1 hour / tomorrow, on reminders and lists.
export async function taskButton(c, tg, q, act, id) {
  const w = words(c), d = await openDashboard(c), task = d.s.tasks.find(x => x.id === id && !x.deleted);
  if (!task) return tg.answerButton(q.id, w.gone);
  let note;
  if (act === 'done') { task.done = true; task.doneOn = today(c.tz); note = `${w.ticked}: ${task.title}`; }
  if (act === 'snooze') { task.due = addMinutes(now(c.tz), 60); note = w.snoozed; }
  if (act === 'tmr') { task.due = addDays(today(c.tz), 1) + (task.due?.length > 10 ? task.due.slice(10) : ''); note = w.moved; }
  task.updated = Date.now();
  await d.save();
  await tg.answerButton(q.id, note);
  const rows = (q.message?.reply_markup?.inline_keyboard || []).filter(row => !row.some(b => b.callback_data?.endsWith(':' + id)));
  if (q.message) await tg.buttons(q.message.message_id, rows);
}
