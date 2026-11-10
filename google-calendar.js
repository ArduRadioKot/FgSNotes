// Google Calendar for the desktop app: sign-in through the system browser (OAuth with PKCE and a loopback redirect) and
// the events API. The refresh token and the OAuth client stay in the main process, encrypted by the keystore; the page
// only ever sees calendars and events.
const http = require('http');
const crypto = require('crypto');

const SCOPE = 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
const SIGN_IN_TIMEOUT = 5 * 60000;
const pad = n => String(n).padStart(2, '0');
const localDay = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
function shiftDay(day, delta) {
    const [y, m, d] = day.split('-').map(Number);
    return localDay(new Date(y, m - 1, d + delta));
}
const base64url = buffer => buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// A Google event as the calendar plugin stores events. All-day end dates are exclusive in the API, inclusive here.
function fromGoogle(item, calendarId) {
    const out = { id: `g:${calendarId}|${item.id}`, gid: item.id, title: item.summary || 'Без названия', notes: item.description || '', calendar: `g:${calendarId}`, remote: true, start: '', end: '', endDate: '', allDay: false };
    if (item.start && item.start.date) {
        out.allDay = true;
        out.date = item.start.date;
        const last = item.end && item.end.date ? shiftDay(item.end.date, -1) : out.date;
        if (last > out.date) out.endDate = last;
        return out;
    }
    const start = new Date(item.start.dateTime), end = new Date(item.end ? item.end.dateTime : item.start.dateTime);
    out.date = localDay(start);
    out.start = localTime(start);
    out.end = localTime(end);
    if (localDay(end) > out.date) out.endDate = localDay(end);
    return out;
}
function toGoogle(event, timeZone) {
    const body = { summary: event.title, description: event.notes || '' };
    if (event.allDay) {
        body.start = { date: event.date };
        body.end = { date: shiftDay(event.endDate || event.date, 1) };
        return body;
    }
    const start = event.start || '09:00';
    let endDay = event.endDate || event.date, end = event.end || start;
    if (endDay === event.date && end <= start) {         // no real end was given: one hour, or the API refuses the event
        const [h, m] = start.split(':').map(Number);
        const later = new Date(2000, 0, 1, h + 1, m);
        end = localTime(later);
        if (later.getDate() !== 1) endDay = shiftDay(event.date, 1);
    }
    body.start = { dateTime: `${event.date}T${start}:00`, timeZone };
    body.end = { dateTime: `${endDay}T${end}:00`, timeZone };
    return body;
}

function createGoogleCalendar({ keystore, openBrowser, fetch: fetchImpl = fetch, timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone }) {
    let access = { token: '', until: 0 };
    let signingIn = null;
    const client = () => { try { return JSON.parse(keystore.get('client')) || null; } catch { return null; } };

    async function tokenRequest(params) {
        const response = await fetchImpl(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(params).toString() });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw Object.assign(new Error(data.error_description || data.error || `HTTP ${response.status}`), { code: data.error });
        return data;
    }
    function remember(data) { access = { token: data.access_token, until: Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60000 }; }

    // A one-shot server on a free local port: Google sends the browser back here with the sign-in code.
    function listenForCode(state) {
        let settle;
        const code = new Promise((resolve, reject) => { settle = { resolve, reject }; });
        const server = http.createServer((request, response) => {
            const url = new URL(request.url, 'http://127.0.0.1');
            if (url.pathname !== '/') { response.writeHead(404); response.end(); return; }
            const ok = url.searchParams.get('state') === state && url.searchParams.get('code');
            response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
            response.end(`<!doctype html><meta charset="utf-8"><title>FgSNotes</title><body style="font:16px system-ui;padding:48px;text-align:center">${ok ? 'Готово. Можно вернуться в FgSNotes.' : 'Вход не выполнен. Можно закрыть эту страницу.'}</body>`);
            if (ok) settle.resolve(ok); else settle.reject(new Error(url.searchParams.get('error') || 'Вход отменён'));
        });
        const timer = setTimeout(() => settle.reject(new Error('Время на вход истекло')), SIGN_IN_TIMEOUT);
        code.catch(() => {}).finally(() => { clearTimeout(timer); server.close(); });
        return new Promise((ready, fail) => {
            server.once('error', fail);
            server.listen(0, '127.0.0.1', () => ready({ port: server.address().port, code }));
        });
    }

    async function connect({ clientId, clientSecret } = {}) {
        if (signingIn) return signingIn;
        const id = String(clientId || '').trim(), secret = String(clientSecret || '').trim();
        if (!id) throw new Error('Нужен Client ID');
        signingIn = (async () => {
            const verifier = base64url(crypto.randomBytes(48));
            const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
            const state = base64url(crypto.randomBytes(16));
            const { port, code: pending } = await listenForCode(state);
            const redirect = `http://127.0.0.1:${port}`;
            const params = new URLSearchParams({ client_id: id, redirect_uri: redirect, response_type: 'code', scope: SCOPE, code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent' });
            await openBrowser(`${AUTH_URL}?${params}`);
            const code = await pending;
            const data = await tokenRequest({ code, client_id: id, ...(secret ? { client_secret: secret } : {}), redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier });
            if (!data.refresh_token) throw new Error('Google не выдал ключ для постоянного доступа');
            keystore.set('client', JSON.stringify({ id, secret }));
            keystore.set('refresh', data.refresh_token);
            remember(data);
            return status();
        })().finally(() => { signingIn = null; });
        return signingIn;
    }
    function disconnect() {
        keystore.clear('refresh');
        access = { token: '', until: 0 };
        return status();
    }
    function status() {
        const known = client();
        return { connected: keystore.has('refresh'), hasClient: !!known, clientId: known ? known.id : '' };
    }

    async function token() {
        if (access.token && Date.now() < access.until) return access.token;
        const refresh = keystore.get('refresh'), known = client();
        if (!refresh || !known) throw new Error('Нет входа в Google');
        try {
            remember(await tokenRequest({ refresh_token: refresh, client_id: known.id, ...(known.secret ? { client_secret: known.secret } : {}), grant_type: 'refresh_token' }));
        } catch (error) {
            if (error.code === 'invalid_grant') disconnect();    // revoked in the Google account: sign in again
            throw error;
        }
        return access.token;
    }
    async function api(path, options = {}, retry = true) {
        const response = await fetchImpl(API + path, { ...options, headers: { Authorization: `Bearer ${await token()}`, ...(options.body ? { 'Content-Type': 'application/json' } : {}) } });
        if (response.status === 401 && retry) { access = { token: '', until: 0 }; return api(path, options, false); }
        if (response.status === 204) return null;
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error((data.error && data.error.message) || `HTTP ${response.status}`);
        return data;
    }

    async function calendars() {
        const data = await api('/users/me/calendarList?minAccessRole=reader&maxResults=250');
        return (data.items || []).filter(item => !item.deleted).map(item => ({
            id: item.id, name: item.summaryOverride || item.summary, color: item.backgroundColor || '#4285f4',
            writable: item.accessRole === 'owner' || item.accessRole === 'writer', selected: !!item.selected
        }));
    }
    async function events({ calendarId, timeMin, timeMax }) {
        const out = [];
        let pageToken = '';
        do {
            const query = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', maxResults: '2500', timeMin, timeMax, ...(pageToken ? { pageToken } : {}) });
            const data = await api(`/calendars/${encodeURIComponent(calendarId)}/events?${query}`);
            for (const item of data.items || []) if (item.status !== 'cancelled' && item.start) out.push(fromGoogle(item, calendarId));
            pageToken = data.nextPageToken || '';
        } while (pageToken);
        return out;
    }
    const save = async ({ calendarId, eventId, event }) => fromGoogle(await api(
        `/calendars/${encodeURIComponent(calendarId)}/events${eventId ? '/' + encodeURIComponent(eventId) : ''}`,
        { method: eventId ? 'PATCH' : 'POST', body: JSON.stringify(toGoogle(event, timeZone())) }
    ), calendarId);
    const remove = async ({ calendarId, eventId }) => { await api(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`, { method: 'DELETE' }); return true; };

    return { connect, disconnect, status, calendars, events, save, remove };
}

// Only Google's secret iCal addresses can be fetched this way: the page has no general way out to the network through here.
function isGoogleIcsUrl(address) {
    try {
        const url = new URL(String(address));
        return url.protocol === 'https:' && url.hostname === 'calendar.google.com' && url.pathname.startsWith('/calendar/ical/') && url.pathname.endsWith('.ics');
    } catch { return false; }
}

module.exports = { createGoogleCalendar, fromGoogle, toGoogle, isGoogleIcsUrl };
