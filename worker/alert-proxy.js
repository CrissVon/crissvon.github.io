/* Cloudflare Worker: проксі статусу повітряної тривоги для Києва.
 *
 * Навіщо: браузер не дозволяє сайту на GitHub Pages ходити напряму до siren.pp.ua
 * (немає CORS-заголовка), а також ми кешуємо відповідь, щоб не перевищувати
 * ліміт джерела (50 запитів/хв з одного IP), скільки б людей не відкрило сайт.
 *
 * Відповідь сайту:
 *   { ok: true,  alert: null }                                    — тривоги немає
 *   { ok: true,  alert: { level: 'red'|'yellow', text, since } }  — є тривога / загроза
 *   { ok: false }                                                 — джерело недоступне
 *
 * Змінні (Settings → Variables у Cloudflare, усі необов'язкові):
 *   ALLOWED_ORIGIN — наприклад https://crisswen.github.io (за замовчуванням *)
 *   UPSTREAM       — інша адреса джерела (формат як у siren.pp.ua /api/v3/alerts/31)
 *   UPSTREAM_AUTH  — значення заголовка Authorization, якщо джерело вимагає ключ
 *                    (наприклад офіційний api.ukrainealarm.com)
 */

const DEFAULT_UPSTREAM = 'https://siren.pp.ua/api/v3/alerts/31'; // 31 = м. Київ
const CACHE_SECONDS = 20;

const TYPE_TEXT = {
  AIR: { red: 'Повітряна тривога', yellow: 'Загроза повітряного нападу' },
  ARTILLERY: { red: 'Загроза артобстрілу', yellow: 'Загроза артобстрілу' },
  URBAN_FIGHTS: { red: 'Вуличні бої', yellow: 'Вуличні бої' },
  CHEMICAL: { red: 'Хімічна загроза', yellow: 'Хімічна загроза' },
  NUCLEAR: { red: 'Радіаційна загроза', yellow: 'Радіаційна загроза' },
};

function cleanReason(reason) {
  // «Дронова загроза (жовтий рівень)» → «Дронова загроза»
  const s = String(reason || '').replace(/\s*\([^)]*рівень[^)]*\)\s*$/iu, '').trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
}

function normalize(data) {
  const region = Array.isArray(data) ? data[0] : data;
  if (!region || typeof region !== 'object' || !Array.isArray(region.activeAlerts)) return null;

  let best = null;
  const rank = (c) => (c.level === 'red' ? 2 : 1) + (c.reason ? 0.5 : 0);

  for (const a of region.activeAlerts) {
    const levels = Array.isArray(a.activeAlertLevels) && a.activeAlertLevels.length
      ? a.activeAlertLevels
      : [{ alertLevel: 'Red', reason: '', createdAt: a.lastUpdate }];
    for (const l of levels) {
      const level = String(l.alertLevel).toLowerCase() === 'yellow' ? 'yellow' : 'red';
      const cand = { level, type: a.type, reason: cleanReason(l.reason), since: l.createdAt || a.lastUpdate || null };
      if (!best || rank(cand) > rank(best)) best = cand;
    }
  }

  if (!best) return { ok: true, alert: null };
  const fallback = (TYPE_TEXT[best.type] || TYPE_TEXT.AIR)[best.level];
  return { ok: true, alert: { level: best.level, text: best.reason || fallback, since: best.since } };
}

function withCors(response, env) {
  const h = new Headers(response.headers);
  h.set('Access-Control-Allow-Origin', (env && env.ALLOWED_ORIGIN) || '*');
  h.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  h.set('Vary', 'Origin');
  return new Response(response.body, { status: response.status, headers: h });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }), env);
    if (request.method !== 'GET') return withCors(new Response('Method Not Allowed', { status: 405 }), env);

    const cache = caches.default;
    const cacheKey = new Request('https://alert-cache.invalid/kyiv');
    const hit = await cache.match(cacheKey);
    if (hit) return withCors(hit, env);

    try {
      const headers = { Accept: 'application/json' };
      if (env && env.UPSTREAM_AUTH) headers.Authorization = env.UPSTREAM_AUTH;
      const res = await fetch((env && env.UPSTREAM) || DEFAULT_UPSTREAM, {
        headers,
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) throw new Error('upstream HTTP ' + res.status);
      const payload = normalize(await res.json());
      if (!payload) throw new Error('unexpected upstream payload');

      const out = new Response(JSON.stringify(payload), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=' + CACHE_SECONDS,
        },
      });
      ctx.waitUntil(cache.put(cacheKey, out.clone()));
      return withCors(out, env);
    } catch (e) {
      // Не кешуємо помилку: сайт сам покаже «немає даних» і спробує ще раз
      return withCors(
        new Response(JSON.stringify({ ok: false }), {
          status: 502,
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
        }),
        env
      );
    }
  },
};
