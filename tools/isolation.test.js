// إثبات العزل: كل حساب يشوف بس سيرفراته، وما حدا يقدر يشوف/يعدّل سيرفرات غيره
// تشغيل: node tools/isolation.test.js
//
// ملاحظة: hasSession() بيقبل أي كوكي dash_session موقّع بـ SESSION_SECRET
// (server.js:113) — فنقدر نبني جلسة حقيقية ونختبر المسارات فعلياً عبر HTTP.

const http = require('http');
const crypto = require('crypto');
const express = require('express');
const {
    Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ChannelType, AttachmentBuilder, PermissionsBitField
} = require('discord.js');

const SECRET = 'isolation-test-secret';
process.env.CLIENT_ID = '123456789012345678';
process.env.CLIENT_SECRET = 'secret-for-isolation-test';
process.env.SESSION_SECRET = SECRET;
process.env.SESSION_COOKIE_NAME = 'iso_sid';

const setupDashboard = require('../dashboard/server.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

// نفس signToken في server.js:76
function signToken(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
    return `${body}.${sig}`;
}

// ── 3 سيرفرات: كل واحد "له" عضو واحد بس يقدر يديره
const ALLOWED = {
    '111111111111111111': 'OWNER_A',
    '222222222222222222': 'OWNER_B',
    '333333333333333333': 'OWNER_C'
};

const USERS = {
    OWNER_A: { id: 'OWNER_A', displayName: 'OWNER_A', user: { id: 'OWNER_A', username: 'owner_a', tag: 'owner_a#0001' }, roles: { cache: new Map() } },
    OWNER_B: { id: 'OWNER_B', displayName: 'OWNER_B', user: { id: 'OWNER_B', username: 'owner_b', tag: 'owner_b#0001' }, roles: { cache: new Map() } },
    OWNER_C: { id: 'OWNER_C', displayName: 'OWNER_C', user: { id: 'OWNER_C', username: 'owner_c', tag: 'owner_c#0001' }, roles: { cache: new Map() } },
    RANDOM: { id: 'RANDOM', displayName: 'RANDOM', user: { id: 'RANDOM', username: 'random_guy', tag: 'random#0001' }, roles: { cache: new Map() } }
};

function mkGuild(id, name) {
    const cache = new Map();
    // كل الأعضاء موجودين بالسيرفر (كلهم نظرياً)
    for (const u of Object.values(USERS)) cache.set(u.id, u);
    return {
        id, name,
        iconURL: () => null, bannerURL: () => null,
        ownerId: ALLOWED[id],
        memberCount: 100, premiumTier: 0, premiumSubscriptionCount: 0, verified: false,
        roles: { cache: new Collection() },
        channels: { cache: new Collection([['11111111', { id: '11111111', name: 'عام', type: 0, position: 0 }]]) },
        members: { cache, me: { roles: { highest: { position: 0 } } } }
    };
}

const guilds = new Map();
guilds.set('111111111111111111', mkGuild('111111111111111111', 'سيرفر أ'));
guilds.set('222222222222222222', mkGuild('222222222222222222', 'سيرفر ب'));
guilds.set('333333333333333333', mkGuild('333333333333333333', 'سيرفر ج'));

const client = {
    guilds: { cache: guilds },
    user: { id: '999999999999999999', username: 'TestBot', tag: 'TestBot#1', avatar: null },
    isReady: () => true, readyTimestamp: Date.now(), uptime: 1000,
    ws: { ping: 10, status: 0 }, userManager: { resolve: async () => null }
};

function fakeSettings(guildId) {
    return {
        guildId,
        welcome: { enabled: false, message: '', image: '' },
        tickets: { enabled: false, options: [] },
        protections: {},
        toObject() { return { guildId: this.guildId, welcome: this.welcome, tickets: this.tickets, protections: this.protections }; },
        save: async () => this
    };
}

const deps = {
    client,
    GuildSettings: { findOne: async ({ guildId }) => fakeSettings(guildId) },
    getSettings: async (guildId) => fakeSettings(guildId),
    ensureProtections: () => {},
    sendLog: async () => {}, jailMember: async () => {}, unjailMember: async () => {},
    // صلاحية = بس صاحب السيرفر (محاكاة: عنده رتبة ستريتر/صلاحيات إدارية)
    isServerAdmin: (member, guild) => Boolean(member && guild && member.id === guild.ownerId),
    memberHasStaffRole: (member, guild) => Boolean(member && guild && member.id === guild.ownerId),
    hasStaffAccess: (member, guild) => Boolean(member && guild && member.id === guild.ownerId),
    // لازم findOne يرجّع chain متزامن: .select().lean()
    // (لو عملناه async بيرجع Promise و .select ما بيكون موجود)
    DashboardUser: { findOne: () => ({ select: () => ({ lean: async () => null }) }) },
    DashboardLog: { find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }) },
    STAFF_ROLE_NAME: 'ستريتر', OWNER_ID: 'OWNER_A',
    normalizeText: (s) => String(s || '').trim().toLowerCase(),
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ChannelType, AttachmentBuilder, PermissionsBitField
};

const app = express();
app.set('trust proxy', true);
setupDashboard(app, deps);

function req(port, path, cookie) {
    return new Promise((resolve) => {
        const r = http.request(
            { host: '127.0.0.1', port, path, method: 'GET', headers: cookie ? { cookie } : {}, timeout: 6000 },
            res => {
                let b = '';
                res.on('data', c => b += c);
                res.on('end', () => resolve({ status: res.statusCode, body: b, headers: res.headers }));
            }
        );
        r.on('error', e => resolve({ status: 0, body: String(e.message), headers: {} }));
        r.on('timeout', () => { r.destroy(); resolve({ status: 0, body: 'TIMEOUT', headers: {} }); });
        r.end();
    });
}

(async () => {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    const port = server.address().port;

    // payload لازم فيه userId + at (server.js:94)
    const mk = (userId) => 'dash_session=' + signToken({ userId, at: Date.now() });

    const cookieA = mk('OWNER_A');
    const cookieB = mk('OWNER_B');
    const cookieC = mk('OWNER_C');
    const cookieR = mk('RANDOM');
    const cookieFake = 'dash_session=' + 'eyJ1c2VySWQiOiJISUNLIiwiaXQiOjF9.bogus_signature_xxxxxxxx';

    console.log('\n--- 1) الدخول مفتوح للجميع، بس محتاج تسجيل دخول ---');
    const login = await req(port, '/api/auth/login');
    ok('زر الدخول موجود لأي زائر (302 لـ Discord)',
        login.status === 302 && /discord\.com/.test(String(login.headers.location || '')),
        'status=' + login.status);
    const anon = await req(port, '/api/servers');
    ok('بدون جلسة -> 401', anon.status === 401, 'status=' + anon.status);
    const badCookie = await req(port, '/api/servers', cookieFake);
    ok('كوكي مزيّف -> 401', badCookie.status === 401, 'status=' + badCookie.status);

    console.log('\n--- 2) كل حساب يشوف سيرفره بس ---');
    const seenA = await req(port, '/api/servers?refresh=1', cookieA);
    const seenB = await req(port, '/api/servers?refresh=1', cookieB);
    const seenR = await req(port, '/api/servers?refresh=1', cookieR);

    const idsA = JSON.parse(seenA.body).guilds.map(g => g.id);
    const idsB = JSON.parse(seenB.body).guilds.map(g => g.id);
    const idsR = JSON.parse(seenR.body).guilds.map(g => g.id);

    ok('OWNER_A logged in', seenA.status === 200, 'status=' + seenA.status);
    ok('OWNER_A يشوف سيرفر واحد بس', idsA.length === 1, JSON.stringify(idsA));
    ok('OWNER_A يشوف سيرفره هو', idsA[0] === '111111111111111111', JSON.stringify(idsA));
    ok('OWNER_B يشوف سيرفر واحد بس', idsB.length === 1, JSON.stringify(idsB));
    ok('OWNER_B يشوف سيرفره هو', idsB[0] === '222222222222222222', JSON.stringify(idsB));
    ok('ما في تداخل بين A و B', !idsA.includes('222222222222222222') && !idsB.includes('111111111111111111'), JSON.stringify({ idsA, idsB }));
    ok('عضو بلا صلاحية ما يشوف ولا سيرفر', idsR.length === 0, JSON.stringify(idsR));

    console.log('\n--- 3) ما حدا يقدر يوصل لسيرفر التاني ---');
    const aTriesB = await req(port, '/api/server/222222222222222222', cookieA);
    ok('A يطلب سيرفر B -> 403', aTriesB.status === 403, 'status=' + aTriesB.status);
    const bTriesA = await req(port, '/api/server/111111111111111111', cookieB);
    ok('B يطلب سيرفر A -> 403', bTriesA.status === 403, 'status=' + bTriesA.status);
    const rTriesA = await req(port, '/api/server/111111111111111111', cookieR);
    ok('عضو عادي يطلب سيرفر A -> 403', rTriesA.status === 403, 'status=' + rTriesA.status);
    const aTriesOwn = await req(port, '/api/server/111111111111111111', cookieA);
    ok('A يطلب سيرفه هو -> 200', aTriesOwn.status === 200, 'status=' + aTriesOwn.status);

    const leaked = seenA.body.includes('سيرفر ب') || seenA.body.includes('222222222222222222');
    ok('قائمة A ما فيها أي أثر لسيرفر B', leaked === false, 'leaked=' + leaked);

    console.log('\n--- 4) الإعدادات مقفولة على صاحبها ---');
    // POST يحتاج requireGuild → نتحقق إنه رجّع 403 مو 200
    const post = (path, cookie, payload) => new Promise((resolve) => {
        const data = JSON.stringify(payload || {});
        const r = http.request({
            host: '127.0.0.1', port, path, method: 'POST', timeout: 6000,
            headers: { cookie, 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) }
        }, res => {
            let b = '';
            res.on('data', c => b += c);
            res.on('end', () => resolve({ status: res.statusCode, body: b }));
        });
        r.on('error', e => resolve({ status: 0, body: String(e.message) }));
        r.end(data);
    });

    const attack = await post('/api/server/222222222222222222/settings', cookieA, { section: 'welcome', data: { message: 'اختراق' } });
    ok('A يحاول يعدّل إعدادات B -> 403', attack.status === 403, 'status=' + attack.status);
    const attack2 = await post('/api/server/222222222222222222/action', cookieA, { action: 'ban', userId: 'RANDOM' });
    ok('A يحاول ينفّذ أمر على B -> 403', attack2.status === 403, 'status=' + attack2.status);
    const attack3 = await post('/api/server/222222222222222222/invites', cookieA, { mode: 'create', channelId: '1' });
    ok('A يحاول يدير دعوات B -> 403', attack3.status === 403, 'status=' + attack3.status);

    console.log('\n=== ' + pass + ' passed, ' + fail + ' failed ===');
    server.close();
    process.exit(fail ? 1 : 0);
})();
