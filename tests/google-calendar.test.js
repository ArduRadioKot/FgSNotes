const { test } = require('node:test');
const assert = require('node:assert/strict');
const { fromGoogle, toGoogle, isGoogleIcsUrl, createGoogleCalendar } = require('../google-calendar');

test('all-day events: Google ends the day after, the calendar ends on the last day', () => {
    const one = fromGoogle({ id: 'x', summary: 'Отпуск', start: { date: '2026-03-02' }, end: { date: '2026-03-03' } }, 'me');
    assert.equal(one.allDay, true);
    assert.equal(one.date, '2026-03-02');
    assert.equal(one.endDate, '');
    const three = fromGoogle({ id: 'y', start: { date: '2026-03-02' }, end: { date: '2026-03-05' } }, 'me');
    assert.equal(three.endDate, '2026-03-04');
    assert.deepEqual(toGoogle({ title: 't', allDay: true, date: '2026-03-02', endDate: '2026-03-04' }, 'UTC').end, { date: '2026-03-05' });
});

test('calendar ids with # survive in event ids', () => {
    const event = fromGoogle({ id: 'e1', start: { date: '2026-01-01' }, end: { date: '2026-01-02' } }, 'ru.russian#holiday@group.v.calendar.google.com');
    assert.equal(event.calendar, 'g:ru.russian#holiday@group.v.calendar.google.com');
    assert.equal(event.gid, 'e1');
});

test('a timed event without a real end lasts an hour, across midnight if needed', () => {
    const body = toGoogle({ title: 't', date: '2026-03-02', start: '23:30', end: '23:30' }, 'Europe/Moscow');
    assert.deepEqual(body.start, { dateTime: '2026-03-02T23:30:00', timeZone: 'Europe/Moscow' });
    assert.deepEqual(body.end, { dateTime: '2026-03-03T00:30:00', timeZone: 'Europe/Moscow' });
});

test('only Google secret iCal addresses can be fetched', () => {
    assert.equal(isGoogleIcsUrl('https://calendar.google.com/calendar/ical/me%40gmail.com/private-abc/basic.ics'), true);
    assert.equal(isGoogleIcsUrl('http://calendar.google.com/calendar/ical/x/basic.ics'), false);
    assert.equal(isGoogleIcsUrl('https://evil.test/calendar/ical/x/basic.ics'), false);
    assert.equal(isGoogleIcsUrl('https://calendar.google.com.evil.test/calendar/ical/x.ics'), false);
});

function memoryKeystore(initial = {}) {
    const data = { ...initial };
    return { has: k => !!data[k], get: k => data[k] || '', set: (k, v) => { data[k] = v; }, clear: k => { delete data[k]; }, data };
}

test('sign-in: PKCE in the browser URL, the code comes back to the loopback and is exchanged', async () => {
    const keystore = memoryKeystore();
    const calls = [];
    const fetchMock = async (url, options) => {
        calls.push({ url, body: options.body });
        return { ok: true, status: 200, json: async () => ({ access_token: 'A', refresh_token: 'R', expires_in: 3600 }) };
    };
    let authUrl;
    const openBrowser = async url => {
        authUrl = new URL(url);
        const back = new URL(authUrl.searchParams.get('redirect_uri'));
        back.searchParams.set('state', authUrl.searchParams.get('state'));
        back.searchParams.set('code', 'the-code');
        setTimeout(() => globalThis.fetch(back).catch(() => {}), 0);
    };
    const google = createGoogleCalendar({ keystore, openBrowser, fetch: fetchMock });
    const status = await google.connect({ clientId: 'cid', clientSecret: 'sec' });
    assert.equal(status.connected, true);
    assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
    assert.match(authUrl.searchParams.get('redirect_uri'), /^http:\/\/127\.0\.0\.1:\d+$/);
    const sent = new URLSearchParams(calls[0].body);
    assert.equal(sent.get('code'), 'the-code');
    assert.ok(sent.get('code_verifier').length >= 43);
    assert.equal(keystore.data.refresh, 'R');
});

test('an expired token is renewed once, a revoked one signs the person out', async () => {
    const keystore = memoryKeystore({ refresh: 'R', client: JSON.stringify({ id: 'cid', secret: '' }) });
    const fetchMock = async url => (url.includes('oauth2')
        ? { ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) }
        : { ok: true, status: 200, json: async () => ({}) });
    const google = createGoogleCalendar({ keystore, openBrowser: async () => {}, fetch: fetchMock });
    await assert.rejects(google.calendars());
    assert.equal(google.status().connected, false);
});
