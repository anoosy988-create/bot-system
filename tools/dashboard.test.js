// اختبار الداشبورد بدون ديسكورد حقيقي — بنركّب السيرفر على express مع client وهمي
// الهدف: نتأكد إن mountDashboard يخدم الصفحة والأصول generically،
// وإن مسارات الـ API ترجّع 200/302 بدل 404 أو 500.
// تشغيل: node tools/dashboard.test.js

process.env.CLIENT_ID = '123456789012345678';
process.env.CLIENT_SECRET = 'oauth-client-secret-test';
process.env.SESSION_SECRET = 'test-secret-for-dashboard-only';
process.env.DASHBOARD_CLIENT_ID = '123456789012345678';
process.env.DASHBOARD_CLIENT_SECRET = 'oauth-client-secret-test';
process.env.PORT = '0';

const http = require('http');
const express = require('express');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, AttachmentBuilder, PermissionsBitField } = require('discord.js');
const setupDashboard = require('../dashboard/server.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

function req(port, path, headers) {
    return new Promise((resolve) => {
        const r = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers: headers || {}, timeout: 8000 }, res => {
            let b = '';
            res.on('data', c => { b += c; });
            res.on('end', () => resolve({ status: res.statusCode, body: b, headers: res.headers }));
        });
        r.on('error', e => resolve({ status: 0, body: String(e.message), headers: {} }));
        r.on('timeout', () => { r.destroy(); resolve({ status: 0, body: 'TIMEOUT', headers: {} }); });
        r.end();
    });
}

(async () => {
    console.log('\n--- setup ---');
    const app = express();
    app.set('trust proxy', true);

    // client وهمي
    const client = {
        guilds: { cache: new Map() },
        user: { id: '999999999999999999', username: 'TestBot', tag: 'TestBot#0001', avatar: null },
        isReady: () => true,
        readyTimestamp: Date.now() - 60000,
        uptime: 60000,
        ws: { ping: 42, status: 0 },
        userManager: { resolve: async () => null }
    };

    // موديل إعدادات وهمي
    function fakeSettings(extra) {
        const doc = {
            guildId: '111111111111111111',
            welcome: { enabled: true, channelId: null, message: 'أهلاً', image: '' },
            tickets: { enabled: false, panelChannelId: null, categoryId: null, logChannelId: null, supportRoleId: null, image: '', options: [] },
            protections: {},
            toObject() { return JSON.parse(JSON.stringify({ guildId: this.guildId, welcome: this.welcome, tickets: this.tickets, protections: this.protections })); },
            save: async () => this
        };
        return Object.assign(doc, extra || {});
    }

    const deps = {
        client,
        GuildSettings: { findOne: async () => fakeSettings() },
        getSettings: async () => fakeSettings(),
        ensureProtections: async () => {},
        sendLog: async () => {},
        jailMember: async () => {},
        unjailMember: async () => {},
        isServerAdmin: () => true,
        memberHasStaffRole: () => true,
        hasStaffAccess: () => true,
        hasDashboardAccess: () => true,
        DashboardUser: { findOne: async () => null },
        DashboardLog: { find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }) },
        STAFF_ROLE_NAME: 'Staff',
        OWNER_ID: '123456789012345678',
        normalizeText: (s) => String(s || '').trim().toLowerCase(),
        EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, AttachmentBuilder, PermissionsBitField
    };

    try {
        setupDashboard(app, deps);
        ok('setupDashboard بدون exception', true);
    } catch (e) {
        ok('setupDashboard بدون exception', false, e.message);
        process.exit(1);
    }

    const server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    const port = server.address().port;
    ok('express listening', port > 0);

    console.log('\n--- static + page ---');
    const root = await req(port, '/');
    ok('/ -> 200', root.status === 200, 'status=' + root.status);
    ok('/ serves html', /<html/i.test(root.body), 'len=' + root.body.length);
    ok('/ not the fallback', !/unavailable/i.test(root.body));

    const appjs = await req(port, '/assets/app.js');
    ok('/assets/app.js -> 200', appjs.status === 200, 'status=' + appjs.status);
    ok('app.js has refreshImagePreviews()', /function refreshImagePreviews/.test(appjs.body));
    ok('app.js has w-image preview box', /w-image-prev/.test(appjs.body));
    ok('app.js has t-panel-image preview box', /t-panel-image-prev/.test(appjs.body));
    ok('app.js has t-welcome-image preview box', /t-welcome-image-prev/.test(appjs.body));
    ok('app.js wires input listener', /t-panel-image'\s*\|\|/.test(appjs.body));

    const css = await req(port, '/assets/style.css');
    ok('/assets/style.css -> 200', css.status === 200, 'status=' + css.status);
    ok('css has .img-preview', /\.img-preview/.test(css.body));
    ok('css has .form-hint', /\.form-hint/.test(css.body));
    ok('css no-store on assets', String(css.headers['cache-control'] || '').includes('no-store'), css.headers['cache-control']);
    ok('css has .no-servers', /\.no-servers/.test(css.body));

    console.log('\n--- no-servers notice (حساب بدون سيرفرات) ---');
    ok('noServersNotice() is a function', /function noServersNotice/.test(appjs.body));
    ok('notice states the reason clearly', /ما عندك أي سيرفر/.test(appjs.body));
    ok('notice mentions the staff role', /staffRoleName/.test(appjs.body));
    ok('notice explains bot-not-in-server', /البوت مو داخل سيرفرك/.test(appjs.body));
    ok('notice offers the invite button', /إضافة البوت إلى سيرفر/.test(appjs.body));
    ok('notice offers a re-check button', /إعادة الفحص/.test(appjs.body));
    ok('both pages use the same notice',
        (appjs.body.match(/noServersNotice\(/g) || []).length >= 3,
        'calls=' + (appjs.body.match(/noServersNotice\(/g) || []).length);
    ok('INVITE_URL global exists', /let INVITE_URL/.test(appjs.body));
    ok('servers page loads the invite link', /INVITE_URL = botData\.bot\?\.inviteUrl/.test(appjs.body));

    // أي حساب يقدر يدخل — الـ API ما يرفض Based on وجود سيرفرات
    const servers2 = await req(port, '/api/servers');
    ok('/api/servers without session -> 401 (login required)',
        servers2.status === 401, 'status=' + servers2.status);
    const guild403 = await req(port, '/api/server/111111111111111111', { cookie: 'none' });
    ok('/api/server/:id without session -> 401',
        guild403.status === 401, 'status=' + guild403.status);

    console.log('\n--- api routes (expect 200/302, not 404/500) ---');
    const st = await req(port, '/api/auth/status');
    ok('/api/auth/status not 404', st.status !== 404, 'status=' + st.status);

    const se = await req(port, '/api/session');
    ok('/api/session not 404', se.status !== 404, 'status=' + se.status);

    const me = await req(port, '/api/me');
    ok('/api/me not 404', me.status !== 404, 'status=' + me.status);

    const bot = await req(port, '/api/bot');
    ok('/api/bot not 404', bot.status !== 404, 'status=' + bot.status);

    const av = await req(port, '/api/bot/avatar');
    ok('/api/bot/avatar -> 200', av.status === 200, 'status=' + av.status);
    ok('avatar content-type svg', String(av.headers['content-type'] || '').includes('svg'), av.headers['content-type']);

    const login = await req(port, '/api/auth/login');
    ok('/api/auth/login -> 302 to discord',
        login.status === 302 && /discord\.com\/oauth2/.test(String(login.headers.location || '')),
        'status=' + login.status + ' loc=' + String(login.headers.location || '').slice(0, 80));

    const cbNo = await req(port, '/api/auth/callback');
    ok('/api/auth/callback without code -> handled', cbNo.status !== 500, 'status=' + cbNo.status);

    console.log('\n--- security ---');
    const xss = await req(port, '/assets/../server.js');
    ok('no path traversal', xss.status !== 200 || !/DISCORD_TOKEN/.test(xss.body), 'status=' + xss.status);

    console.log('\n=== ' + pass + ' passed, ' + fail + ' failed ===');
    server.close();
    process.exit(fail ? 1 : 0);
})();
