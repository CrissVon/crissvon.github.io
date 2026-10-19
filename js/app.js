/* Web-розклад: фронтенд-візуалізатор для schedule_data.json
 *
 * Тестування часу: ?date=2026-10-24&time=08:25  (час далі йде самостійно)
 * Іншого джерела даних:  ?data=https://.../schedule_data.json
 */
(() => {
  'use strict';

  const CONFIG = {
    // Джерела JSON за порядком: спершу бот на Render, далі запасний файл поруч із сайтом.
    DATA_URLS: [
      'https://substitution-3s9d.onrender.com/schedule_data.json',
    ],
    // Запасний файл з репозиторію: лише якщо бот недоступний І в браузері ще немає збереженої копії
    FALLBACK_URL: 'schedule_data.json',
    FETCH_TIMEOUT_MS: 8000,           // скільки чекати на одне джерело перед переходом до наступного
    JOIN_BEFORE_MIN: 10,              // за скільки хвилин до початку з'являється кнопка
    TZ: 'Europe/Kyiv',
    ALERT_URL: 'https://substitution-3s9d.onrender.com/alert',                    // адреса /alert на боті (Render); порожньо = тривоги вимкнені
    BOT_URL: 'https://t.me/KaiTeh_zaminy_bot',                      // посилання на Telegram-бота із замінами, напр. 'https://t.me/your_bot' (порожньо = не показувати)
  };

  const DAY_KEYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const DAY_LABELS = { monday: 'ПН', tuesday: 'ВТ', wednesday: 'СР', thursday: 'ЧТ', friday: 'ПТ', saturday: 'СБ' };
  const DAY_FULL = { monday: 'понеділок', tuesday: 'вівторок', wednesday: 'середа', thursday: 'четвер', friday: "п'ятниця", saturday: 'субота' };
  const DAY_ACC = { sunday: 'у неділю', monday: 'в понеділок', tuesday: 'у вівторок', wednesday: 'у середу', thursday: 'у четвер', friday: "у п'ятницю", saturday: 'у суботу' };
  const DAY_MS = 86400000;

  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  /* ---------- Час ---------- */
  // Працюємо з "настінним часом" Києва, збереженим як UTC-мс (wallMs).
  const params = new URLSearchParams(location.search);
  const loadedAt = performance.now();
  let fakeStart = null;

  function realWallMs() {
    const d = new Date();
    try {
      const p = Object.fromEntries(
        new Intl.DateTimeFormat('en-GB', {
          timeZone: CONFIG.TZ, hourCycle: 'h23',
          year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', second: '2-digit',
        }).formatToParts(d).map((x) => [x.type, x.value])
      );
      return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
    } catch (e) {
      return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds());
    }
  }

  if (params.get('date') || params.get('time')) {
    const real = new Date(realWallMs());
    const dateStr = params.get('date') || real.toISOString().slice(0, 10);
    const [h, m] = (params.get('time') || real.toISOString().slice(11, 16)).split(':').map(Number);
    const [y, mo, d] = dateStr.split('-').map(Number);
    fakeStart = Date.UTC(y, mo - 1, d, h, m, 0);
  }

  function nowWallMs() {
    return fakeStart !== null ? fakeStart + (performance.now() - loadedAt) : realWallMs();
  }

  const dateKeyOf = (ms) => new Date(ms).toISOString().slice(0, 10);
  const secOfDay = (ms) => Math.floor((ms % DAY_MS) / 1000);
  const parseKey = (key) => { const [y, m, d] = key.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const addDays = (key, n) => dateKeyOf(parseKey(key) + n * DAY_MS);
  const weekdayOf = (key) => DAY_KEYS[new Date(parseKey(key)).getUTCDay()];
  const mondayOf = (key) => addDays(key, -((new Date(parseKey(key)).getUTCDay() + 6) % 7));
  const hmToSec = (s) => { const [h, m] = s.split(':').map(Number); return h * 3600 + m * 60; };

  function fmtDuration(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h} год ${String(m).padStart(2, '0')} хв`;
    return `${m} хв ${String(s).padStart(2, '0')} с`;
  }

  /* ---------- Логіка розкладу ---------- */
  let DATA = null;

  function weekNumberFor(key) {
    const a = DATA.meta.week_anchor;
    const diff = Math.floor((parseKey(mondayOf(key)) - parseKey(mondayOf(a.date))) / (7 * DAY_MS));
    const sameAsAnchor = ((diff % 2) + 2) % 2 === 0;
    return sameAsAnchor ? a.week : 3 - a.week;
  }

  // Робоча субота: "tuesday" або {day: "tuesday", week: 2}; без week береться тиждень самої дати
  function specialFor(key) {
    const sp = DATA.special_days && DATA.special_days[key];
    if (!sp) return null;
    const o = typeof sp === 'string' ? { day: sp } : sp;
    return { day: o.day, week: o.week || weekNumberFor(key) };
  }

  /* ---------- Назви предметів у замінах ---------- */
  // У замінах предмет часто пишуть з малої літери або скорочено («економ.теорія»). Підбираємо повну назву
  // з базового розкладу: спершу серед предметів цього ж викладача, потім серед усіх.
  // Якщо збіг неоднозначний або предмета немає — лише велика перша літера.
  let subjectIndex = null;

  const wordsOf = (s) =>
    String(s).toLowerCase().replace(/[’`ʼ]/g, "'").split(/[^a-zа-яіїєґ0-9']+/u).filter(Boolean);

  function buildSubjectIndex() {
    const map = new Map();
    const bs = DATA.base_schedule || {};
    for (const week of Object.values(bs)) {
      for (const day of Object.values(week || {})) {
        for (const l of day || []) {
          if (!l.subject) continue;
          let e = map.get(l.subject);
          if (!e) { e = { name: l.subject, words: wordsOf(l.subject), teachers: new Set() }; map.set(l.subject, e); }
          const ids = l.teacher_ids || (l.teacher_id ? [l.teacher_id] : []);
          ids.forEach((id) => e.teachers.add(id));
        }
      }
    }
    return [...map.values()];
  }

  // 3 — слова збігаються; 1 — скорочення («економ.теорія» → «Економічна теорія»); 0 — не підходить
  function subjectScore(inWords, cand) {
    if (inWords.length === cand.words.length && inWords.every((w, i) => w === cand.words[i])) return { s: 3, extra: 0 };
    let ci = 0;
    for (const iw of inWords) {
      if (iw.length < 2) return { s: 0 };
      while (ci < cand.words.length && !cand.words[ci].startsWith(iw)) ci++;
      if (ci >= cand.words.length) return { s: 0 };
      ci++;
    }
    return { s: 1, extra: cand.words.length - inWords.length };
  }

  // wide=false (пошук серед усіх предметів без підказки викладача): скорочення з одного слова не вгадуємо
  function bestSubject(inWords, list, wide) {
    let top = null;
    let tie = false;
    for (const c of list) {
      const r = subjectScore(inWords, c);
      if (!r.s) continue;
      if (!wide && r.s === 1 && inWords.length < 2) continue;
      if (!top || r.s > top.s || (r.s === top.s && r.extra < top.extra)) { top = { ...r, c }; tie = false; }
      else if (r.s === top.s && r.extra === top.extra) tie = true;
    }
    return top && !tie ? top.c.name : null;
  }

  function fixSubject(raw, teacherIds) {
    if (typeof raw !== 'string' || !raw.trim()) return raw;
    const text = raw.trim().replace(/\s+/g, ' ');
    const cap = text.charAt(0).toUpperCase() + text.slice(1);
    const inWords = wordsOf(text);
    if (!inWords.length) return cap;
    if (!subjectIndex) subjectIndex = buildSubjectIndex();
    const own = subjectIndex.filter((e) => (teacherIds || []).some((id) => e.teachers.has(id)));
    return bestSubject(inWords, own, true) || bestSubject(inWords, subjectIndex, false) || cap;
  }

  function getLessons(key) {
    const sp = specialFor(key);
    const week = sp ? sp.week : weekNumberFor(key);
    const day = sp ? sp.day : weekdayOf(key);
    const base = (((DATA.base_schedule || {})['week_' + week] || {})[day] || []).map((l) => ({ ...l }));
    const byNo = new Map(base.map((l) => [Number(l.lesson), l]));

    const subs = (DATA.substitutions || {})[key] || {};
    for (const [no, sub] of Object.entries(subs)) {
      const subIds = sub.teacher_ids || (sub.teacher_id ? [sub.teacher_id] : []);
      byNo.set(Number(no), { lesson: Number(no), ...sub, subject: fixSubject(sub.subject, subIds), substituted: true });
    }

    return [...byNo.values()]
      .sort((a, b) => a.lesson - b.lesson)
      .map((l) => {
        const bell = DATA.bell_schedule[String(l.lesson)];
        const ids = l.teacher_ids || (l.teacher_id ? [l.teacher_id] : []);
        const teachers = ids.map((id) => DATA.teachers[id]).filter(Boolean);
        const withLink = teachers.find((t) => t.link);
        const teacherList = teachers.map((t) => ({
          name: t.name,
          // для єдиного викладача беремо посилання пари (може бути своє на предмет), інакше — посилання викладача
          link: (teachers.length === 1 && l.link) || t.link || null,
        }));
        return {
          ...l,
          teacherList,
          start: bell ? hmToSec(bell.start) : null,
          end: bell ? hmToSec(bell.end) : null,
          startStr: bell ? bell.start : '',
          endStr: bell ? bell.end : '',
          teacherName: teachers.map((t) => t.name).join(', '),
          link: l.link || (withLink ? withLink.link : null),
        };
      });
  }

  /* ---------- Тривога ---------- */
  // Джерело: Cloudflare Worker (worker/alert-proxy.js) → { ok, alert: null | { level: 'red'|'yellow', text, since } }
  // Тест без реальної тривоги:  ?alert=red  або  ?alert=yellow  (і необов'язково &alerttext=Ваш текст)
  const ALERT_POLL_MS = 45 * 1000;
  const ALERT_STALE_MS = 3 * 60 * 1000; // дані старіші — ховаємо тривогу, а не показуємо «все спокійно»
  const alertState = { data: null, at: 0 };

  const forcedAlert = (() => {
    const lvl = params.get('alert');
    if (lvl !== 'red' && lvl !== 'yellow') return null;
    return {
      level: lvl,
      text: params.get('alerttext') || (lvl === 'red' ? 'Ракетна загроза' : 'Дронова загроза'),
      since: new Date().toISOString(),
    };
  })();

  function currentAlert() {
    if (forcedAlert) return forcedAlert;
    if (!alertState.data) return null;
    if (Date.now() - alertState.at > ALERT_STALE_MS) return null;
    return alertState.data;
  }

  const alertKey = () => {
    const a = currentAlert();
    return a ? a.level + '|' + a.text : '';
  };

  const lowerFirst = (s) => s.charAt(0).toLowerCase() + s.slice(1);

  function fmtHM(iso) {
    const d = new Date(iso);
    if (!iso || isNaN(d)) return '';
    try {
      return new Intl.DateTimeFormat('uk-UA', { timeZone: CONFIG.TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
    } catch (e) {
      return '';
    }
  }

  async function pollAlert() {
    if (!CONFIG.ALERT_URL || forcedAlert) return;
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 8000);
      const res = await fetch(CONFIG.ALERT_URL, { cache: 'no-store', signal: ctl.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      if (!j || j.ok !== true) throw new Error('bad payload');
      alertState.data = j.alert || null;
      alertState.at = Date.now();
    } catch (e) {
      /* лишаємо попередній стан; після ALERT_STALE_MS він сам зникне */
    }
  }

  function startAlertPolling() {
    if (!CONFIG.ALERT_URL || forcedAlert) return;
    const run = () => { if (!document.hidden) pollAlert(); };
    run();
    setInterval(run, ALERT_POLL_MS);
    document.addEventListener('visibilitychange', run);
  }

  // Тривога: плашка з причиною справа вгорі, а вся велика картка фарбується в колір рівня (замість зеленого)
  function renderHeroAlert() {
    const pill = $('heroAlert');
    const hero = $('hero');
    const al = currentAlert();
    hero.classList.toggle('is-alert-red', !!al && al.level === 'red');
    hero.classList.toggle('is-alert-yellow', !!al && al.level === 'yellow');
    if (!al) {
      pill.hidden = true;
      pill.textContent = '';
      pill.title = '';
      return;
    }
    const text = 'Пари немає — ' + lowerFirst(al.text);
    if (pill.textContent !== text) pill.textContent = text;
    pill.className = 'hero__alert is-' + al.level;
    const since = fmtHM(al.since);
    pill.title = since ? 'З ' + since : '';
    pill.hidden = false;
  }

  /* ---------- Дашборд ---------- */
  // Найближча пара після сьогодні: шукаємо до 14 днів уперед (з урахуванням робочих субот)
  function nextLessonText(todayKey) {
    for (let i = 1; i <= 14; i++) {
      const key = addDays(todayKey, i);
      const first = getLessons(key).find((l) => !l.cancelled && l.start != null);
      if (first) {
        const when = i === 1 ? 'завтра' : DAY_ACC[weekdayOf(key)];
        return `Наступна пара ${when} о ${first.startStr} — ${first.subject}`;
      }
    }
    return '';
  }

  // Уся велика картка клікабельна, коли є посилання на пару
  function setHeroLink(hero, url) {
    hero.dataset.link = url || '';
    hero.classList.toggle('is-link', !!url);
    if (url) {
      hero.setAttribute('role', 'link');
      hero.tabIndex = 0;
    } else {
      hero.removeAttribute('role');
      hero.removeAttribute('tabindex');
    }
  }

  // Плашки викладачів у великій картці (для пар з кількома викладачами).
  // Перебудовуємо лише при зміні, бо renderHero йде щосекунди і інакше клік губиться.
  function renderHeroTeachers(box, list) {
    const key = list.map((t) => t.name + '|' + (t.link || '')).join(';');
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.textContent = '';
    for (const t of list) {
      if (t.link) {
        const a = el('a', 'chip', t.name);
        a.href = t.link;
        a.target = '_blank';
        a.rel = 'noopener';
        box.appendChild(a);
      } else {
        box.appendChild(el('span', 'chip chip--plain', t.name));
      }
    }
  }

  function renderHero() {
    const now = nowWallMs();
    const todayKey = dateKeyOf(now);
    const sec = secOfDay(now);
    const lessons = getLessons(todayKey).filter((l) => !l.cancelled && l.start != null);

    const hero = $('hero');
    const label = $('heroLabel');
    const subject = $('heroSubject');
    const meta = $('heroMeta');
    const timer = $('heroTimer');
    const progress = $('heroProgress');
    const bar = $('heroProgressBar');
    const join = $('joinBtn');
    const teachersBox = $('heroTeachers');

    $('heroClock').textContent = new Date(now).toISOString().slice(11, 16);

    hero.classList.remove('is-live', 'is-idle');
    progress.hidden = true;
    join.hidden = true;

    renderHeroAlert();

    const current = lessons.find((l) => sec >= l.start && sec < l.end);
    const next = lessons.find((l) => l.start > sec);
    const target = current || next;

    if (!target) {
      setHeroLink(hero, null);
      renderHeroTeachers(teachersBox, []);
      hero.classList.add('is-idle');
      if (lessons.length === 0) {
        label.textContent = 'Сьогодні';
        subject.textContent = 'Пар немає';
        meta.textContent = nextLessonText(todayKey) || 'Можна відпочити';
      } else {
        label.textContent = 'Сьогодні';
        subject.textContent = 'Пари закінчились';
        meta.textContent = nextLessonText(todayKey) || 'Гарного вечора!';
      }
      timer.textContent = '';
      return;
    }

    subject.textContent = target.subject;
    meta.textContent = `${target.lesson} пара · ${target.startStr}–${target.endStr}` +
      (target.teacherName ? ` · ${target.teacherName}` : '');

    if (current) {
      hero.classList.add('is-live');
      label.textContent = 'Зараз іде';
      timer.textContent = 'Залишилось до кінця:';
      const strong = el('strong', null, fmtDuration(current.end - sec));
      timer.appendChild(strong);
      progress.hidden = false;
      bar.style.width = (((sec - current.start) / (current.end - current.start)) * 100).toFixed(1) + '%';
    } else {
      label.textContent = 'Наступна пара';
      timer.textContent = 'Початок через:';
      timer.appendChild(el('strong', null, fmtDuration(next.start - sec)));
    }

    // Кілька викладачів (підгрупи) — посилання на плашках, картка сама не клікається
    const multi = target.teacherList.length > 1;
    const cardLink = multi ? null : target.link;
    setHeroLink(hero, cardLink);
    renderHeroTeachers(teachersBox, multi ? target.teacherList : []);

    const joinFrom = target.start - CONFIG.JOIN_BEFORE_MIN * 60;
    if (cardLink && sec >= joinFrom) {
      join.href = cardLink;
      join.hidden = false;
    }
  }

  /* ---------- Розклад ---------- */
  const state = { monA: null, monB: null, viewMonday: null, selectedKey: null };

  function visibleDays(monday) {
    const days = [];
    for (let i = 0; i < 6; i++) {
      const key = addDays(monday, i);
      if (i === 5 && !(DATA.special_days && DATA.special_days[key])) continue;
      days.push(key);
    }
    return days;
  }

  function renderWeeks() {
    const week = weekNumberFor(state.viewMonday);
    document.querySelectorAll('.weeks__btn').forEach((b) => {
      b.classList.toggle('is-active', Number(b.dataset.week) === week);
    });
  }

  function renderDays() {
    const box = $('days');
    box.textContent = '';
    const todayKey = dateKeyOf(nowWallMs());
    for (const key of visibleDays(state.viewMonday)) {
      const wd = weekdayOf(key);
      const btn = el('button', 'day');
      btn.type = 'button';
      btn.setAttribute('role', 'tab');
      btn.appendChild(el('span', 'day__name', DAY_LABELS[wd]));
      btn.appendChild(el('span', 'day__num', String(Number(key.slice(8)))));
      if (key === state.selectedKey) btn.classList.add('is-active');
      if (key === todayKey) btn.classList.add('is-today');
      if (DATA.special_days && DATA.special_days[key]) btn.classList.add('is-special');
      btn.addEventListener('click', () => { state.selectedKey = key; renderSchedule(); });
      box.appendChild(btn);
    }
  }

  function renderLessons() {
    const key = state.selectedKey;
    const box = $('lessons');
    const note = $('dayNote');
    box.textContent = '';

    const special = specialFor(key);
    if (special) {
      note.hidden = false;
      note.textContent = `Робоча субота: розклад — ${DAY_FULL[special.day]}, ${special.week} тиждень.`;
    } else {
      note.hidden = true;
    }

    const lessons = getLessons(key);
    const now = nowWallMs();
    const isToday = key === dateKeyOf(now);
    const sec = secOfDay(now);

    // Тривога: кольором підсвічуємо лише картку пари, що йде зараз (тільки для сьогоднішнього дня)
    const al = isToday ? currentAlert() : null;

    if (lessons.length === 0) {
      box.appendChild(el('div', 'empty', 'Пар немає'));
      return;
    }

    for (const l of lessons) {
      const card = el('div', 'card');
      if (l.substituted) card.classList.add('is-sub');
      if (l.cancelled) card.classList.add('is-cancelled');
      if (isToday && !l.cancelled && l.start != null && sec >= l.start && sec < l.end) {
        card.classList.add(al ? 'is-alert-' + al.level : 'is-now');
      }

      card.appendChild(el('div', 'card__num', String(l.lesson)));
      const when = el('div', 'card__when');
      when.appendChild(el('span', 'card__start', l.startStr || ''));
      when.appendChild(el('span', 'card__end', l.endStr || ''));
      card.appendChild(when);
      const body = el('div');

      const title = el('div', 'card__subject', l.cancelled ? (l.subject || 'Пару скасовано') : l.subject);
      if (l.cancelled) title.appendChild(el('span', 'badge', 'Скасовано'));
      else if (l.substituted) title.appendChild(el('span', 'badge', 'Заміна'));
      body.appendChild(title);

      if (l.teacherList.length) {
        const row = el('div', 'card__teachers');
        for (const t of l.teacherList) {
          if (t.link && !l.cancelled) {
            const a = el('a', 'chip', t.name);
            a.href = t.link;
            a.target = '_blank';
            a.rel = 'noopener';
            row.appendChild(a);
          } else {
            row.appendChild(el('span', 'chip chip--plain', t.name));
          }
        }
        body.appendChild(row);
      }
      card.appendChild(body);
      box.appendChild(card);
    }
  }

  function renderSchedule() {
    renderWeeks();
    renderDays();
    renderLessons();
    // кнопка «Сьогодні» завжди на місці, неактивна, коли вже дивишся сьогоднішній день
    $('todayBtn').disabled = state.selectedKey === homeKey();
  }

  function setWeek(w) {
    if (weekNumberFor(state.viewMonday) === w) return;
    const idx = (new Date(parseKey(state.selectedKey)).getUTCDay() + 6) % 7;
    state.viewMonday = weekNumberFor(state.monA) === w ? state.monA : state.monB;
    const days = visibleDays(state.viewMonday);
    const wanted = addDays(state.viewMonday, idx);
    state.selectedKey = days.includes(wanted) ? wanted : days[0];
    renderSchedule();
  }

  /* ---------- Підвал ---------- */
  function fmtUpdated(iso) {
    const d = new Date(iso);
    if (!iso || isNaN(d)) return '';
    try {
      return new Intl.DateTimeFormat('uk-UA', {
        timeZone: CONFIG.TZ, day: '2-digit', month: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(d);
    } catch (e) {
      return '';
    }
  }

  function renderFooter() {
    const foot = $('foot');
    foot.textContent = '';
    const upd = fmtUpdated(DATA.meta && DATA.meta.generated_at);
    if (upd) foot.appendChild(el('span', null, 'Оновлено ' + upd));
    if (CONFIG.BOT_URL) {
      const a = el('a', 'foot__link', 'Заміни в Telegram');
      a.href = CONFIG.BOT_URL;
      a.target = '_blank';
      a.rel = 'noopener';
      foot.appendChild(a);
    }
  }

  /* ---------- Тема ---------- */
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem('theme', t); } catch (e) { /* не критично */ }
    const m = document.querySelector('meta[name="theme-color"]');
    if (m) m.setAttribute('content', t === 'light' ? '#e9e9e9' : '#121212');
  }

  function initTheme() {
    $('themeBtn').addEventListener('click', () => {
      const light = document.documentElement.getAttribute('data-theme') === 'light';
      applyTheme(light ? 'dark' : 'light');
    });
  }

  /* ---------- Старт ---------- */
  // День, який показуємо при старті і по кнопці «Сьогодні»: сьогодні, а у вихідний — найближчий понеділок
  function homeKey() {
    let start = dateKeyOf(nowWallMs());
    const wd = weekdayOf(start);
    const hasTab = wd !== 'sunday' && (wd !== 'saturday' || (DATA.special_days && DATA.special_days[start]));
    if (!hasTab) start = addDays(mondayOf(start), 7);
    return start;
  }

  function initState() {
    const start = homeKey();

    state.monA = mondayOf(start);
    state.monB = addDays(state.monA, 7);
    state.viewMonday = state.monA;
    state.selectedKey = start;
  }

  async function load() {
    const custom = params.get('data');
    const urls = custom ? [custom] : CONFIG.DATA_URLS;
    let lastError = new Error('немає джерела даних');
    for (const url of urls) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), CONFIG.FETCH_TIMEOUT_MS);
      try {
        const sep = url.includes('?') ? '&' : '?';
        const res = await fetch(url + sep + 't=' + Date.now(), { cache: 'no-store', signal: ctrl.signal });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        if (!custom) {
          try { localStorage.setItem('schedule_cache', JSON.stringify(data)); } catch (e) { /* не критично */ }
        }
        return data;
      } catch (e) {
        lastError = e; // пробуємо наступне джерело
      } finally {
        clearTimeout(timer);
      }
    }
    // Жодне джерело не відповіло (офлайн, бот спить): остання успішно завантажена копія
    if (!custom) {
      try {
        const cached = localStorage.getItem('schedule_cache');
        if (cached) return JSON.parse(cached);
      } catch (e) { /* не критично */ }
      // Перший захід без збереженої копії: беремо запасний файл з репозиторію
      if (CONFIG.FALLBACK_URL) {
        try {
          const res = await fetch(CONFIG.FALLBACK_URL + '?t=' + Date.now(), { cache: 'no-store' });
          if (res.ok) return await res.json();
        } catch (e) {
          lastError = e;
        }
      }
    }
    throw lastError;
  }

  async function main() {
    initTheme();
    // офлайн-кеш (працює лише на https/localhost)
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    try {
      DATA = await load();
    } catch (e) {
      $('heroLabel').textContent = 'Помилка';
      $('heroSubject').textContent = 'Не вдалося завантажити розклад';
      $('heroMeta').textContent = String(e.message || e);
      $('lessons').appendChild(el('div', 'error', 'Спробуйте оновити сторінку пізніше.'));
      return;
    }

    initState();
    if (DATA.meta && DATA.meta.group) $('groupName').textContent = DATA.meta.group;
    renderFooter();
    document.querySelectorAll('.weeks__btn').forEach((b) =>
      b.addEventListener('click', () => setWeek(Number(b.dataset.week)))
    );

    renderSchedule();
    renderHero();
    startAlertPolling();

    $('todayBtn').addEventListener('click', () => { initState(); renderSchedule(); });

    const hero = $('hero');
    const openHero = () => {
      const url = hero.dataset.link;
      if (url) window.open(url, '_blank', 'noopener');
    };
    hero.addEventListener('click', (e) => { if (!e.target.closest('a')) openHero(); });
    hero.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('a')) { e.preventDefault(); openHero(); }
    });

    let lastMinute = Math.floor(nowWallMs() / 60000);
    let lastAlertKey = alertKey();
    setInterval(() => {
      renderHero();
      const minute = Math.floor(nowWallMs() / 60000);
      const ak = alertKey();
      if (minute !== lastMinute || ak !== lastAlertKey) { // підсвітка "зараз"/"сьогодні" або зміна стану тривоги
        lastMinute = minute;
        lastAlertKey = ak;
        renderSchedule();
      }
    }, 1000);
  }

  main();
})();
