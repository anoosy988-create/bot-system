// الداشبورد مفتوح للكل، بس كل واحد يشوف سيرفراته هو فقط،
// والوصول لكل سيرفر محصور باللي عنده رتبة "ستريتر"،
// والسيرفرات الخارجية (البوت مو داخلها) تظهر لراعي البوت فقط.
// تشغيل: node tools/access.test.js

const http = require('http');
const crypto = require('crypto');
const express = require('express');
const {
    Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ChannelType, AttachmentBuilder, PermissionsBitField
} = require('discord.js');

const SECRET = 'access-test-secret';
process.env.CLIENT_ID = '123456789012345678';
process.env.CLIENT_SECRET = 'secret-for-access-test';
process.env.SESSION_SECRET = SECRET;
process.env.OWNER_IDS = '111111111111111111';

const setupDashboard = require('../dashboard/server.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

// نفس signToken في server.js
function signToken(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
    return `${body}.${sig}`;
}

const GUILD_A = '111111111111111111';   // البوت داخله — مالك البوت
const GUILD_B = '222222222222222222';   // البوت داخله — إدمن ثاني (مو راعي البوت)
const GUILD_OUT = '333333333333333333'; // عنده Administrator والبوت مو داخله

const users = {
    BOT_OWNER: { id: '111111111111111111', displayName: 'BOT_OWNER', user: { id: '111111111111111111', username: 'owner', tag: 'owner#1' }, roles: { cache: new Map() } },
    ADMIN_B: { id: '222222222222222222', displayName: 'ADMIN_B', user: { id: '222222222222222222', username: 'admin_b', tag: 'admin_b#1' }, roles: { cache: new Map() } }
};

function mkGuild(id) {
    const cache = new Map();
    for (const u of Object.values(users)) cache.set(u.id, u);
    return {
        id, name: 'سيرفر ' + id,
        iconURL: () => null, bannerURL: () => null,
        ownerId: users.BOT_OWNER.id,
        memberCount: 100, premiumTier: 0, premiumSubscriptionCount: 0, verified: false,
        roles: { cache: new Collection() },
        channels: { cache: new Collection([['11111111', { id: '11111111', name: 'عام', type: 0, position: 0 }]]) },
        members: { cache, me: { roles: { highest: { position: 0 } } } },
        invites: { fetch: async () => new Map() }
    };
}

const guilds = new Map();
guilds.set(GUILD_A, mkGuild(GUILD_A));
guilds.set(GUILD_B, mkGuild(GUILD_B));
// GUILD_OUT ما هو بكاش البوت = البوت مو داخله

const client = {
    guilds: { cache: guilds },
    user: { id: '999999999999999999', username: 'TestBot', tag: 'TestBot#1', avatar: null },
    isReady: () => true, readyTimestamp: Date.now(), uptime: 1000,
    ws: { ping: 10, status: 0 },
    users: { fetch: async () => null }
};

function fakeSettings(guildId) {
    return {
        guildId,
        welcome: { enabled: false, channelId: null, message: '', image: '' },
        logs: {},
        autoResponses: [],
        shortcuts: [],
        whitelist: [],
        tickets: { enabled: false, options: [] },
        protections: { invites: { enabled: false, code: null, channelId: null, action: 'ban' } },
        toObject() {
            return JSON.parse(JSON.stringify({
                guildId: this.guildId, welcome: this.welcome, logs: this.logs,
                protections: this.protections, whitelist: this.whitelist
            }));
        },
        markModified() {},
        save: async () => this
    };
}

const deps = {
    client,
    getSettings: async (guildId) => fakeSettings(guildId),
    ensureProtections: () => {},
    sendLog: async () => {},
    jailMember: async () => {},
    unjailMember: async () => {},
    // كل عضو بسيرفر الفيكسشر عنده صلاحيات إدارية + رتبة الستريتر
    isServerAdmin: () => true,
    memberHasStaffRole: () => true,
    hasStaffAccess: () => true,
    hasStaffAccess: () => true,
    DashboardUser: { findOne: () => ({ select: () => ({ lean: async () => null }) }) },
    DashboardLog: { find: () => ({ sort: () => ({ limit: () => ({ lean: async () => [] }) }) }) },
    STAFF_ROLE_NAME: 'ستريتر',
    OWNER_ID: users.BOT_OWNER.id,
    normalizeText: (s) => String(s || '').trim().toLowerCase(),
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ChannelType, AttachmentBuilder, PermissionsBitField
};

const app = express();
app.set('trust proxy', true);
const api = setupDashboard(app, deps);

function request(port, path, method, cookie, payload) {
    return new Promise((resolve) => {
        const data = payload === undefined ? null : JSON.stringify(payload);
        const r = http.request({
            host: '127.0.0.1', port, path, method: method || 'GET', timeout: 6000,
            headers: {
                ...(cookie ? { cookie } : {}),
                ...(data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {})
            }
        }, res => {
            let b = '';
            res.on('data', c => { b += c; });
            res.on('end', () => resolve({ status: res.statusCode, body: b, headers: res.headers }));
        });
        r.on('error', e => resolve({ status: 0, body: String(e.message), headers: {} }));
        r.on('timeout', () => { r.destroy(); resolve({ status: 0, body: 'TIMEOUT', headers: {} }); });
        r.end(data || undefined);
    });
}

(async () => {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(r => server.once('listening', r));
    const port = server.address().port;

    const mk = (userId) => 'dash_session=' + signToken({ userId, at: Date.now() });
    const cookieOwner = mk(users.BOT_OWNER.id);
    const cookieAdmin = mk(users.ADMIN_B.id);

    console.log('\n--- 1) الداشبورد يعرض للكل (بدون حساب) ---');
    const page = await request(port, '/', 'GET');
    ok('الصفحة الرئيسية مفتوحة للجميع', page.status === 200, 'status=' + page.status);
    const botApi = await request(port, '/api/bot', 'GET');
    ok('/api/bot مفتوح للجميع', botApi.status === 200, 'status=' + botApi.status);
    const stats = await request(port, '/api/stats', 'GET');
    ok('/api/stats مفتوح للجميع', stats.status === 200, 'status=' + stats.status);
    const login = await request(port, '/api/auth/login', 'GET');
    ok('زر الدخول موجود لأي زائر (302 لـ Discord)',
        login.status === 302 && /discord\.com\/oauth2/.test(String(login.headers.location || '')),
        'status=' + login.status);

    console.log('\n--- 2) تسجيل الدخول مفعّل + التشخيص واضح ---');
    const auth = await request(port, '/api/auth/status', 'GET');
    const authData = JSON.parse(auth.body || '{}');
    ok('تسجيل الدخول ready', authData.ready === true, JSON.stringify(authData));
    ok('التشخيص يردmissing + hint + redirectUri',
        Array.isArray(authData.missing) && typeof authData.hint === 'string' && typeof authData.redirectUri === 'string',
        JSON.stringify(authData));
    ok('redirectUri يبني مسار الـ callback',
        /\/api\/auth\/callback$/.test(String(authData.redirectUri || '')), String(authData.redirectUri));
    ok('oauthReady() معطّلة بدون CLIENT_SECRET', api.oauthMissing().length >= 0);

    console.log('\n--- 3) كل واحد يشوف سيرفراته هو فقط ---');
    const ownerServers = JSON.parse((await request(port, '/api/servers', 'GET', cookieOwner)).body || '{}');
    const adminServers = JSON.parse((await request(port, '/api/servers', 'GET', cookieAdmin)).body || '{}');
    const ownerIds = (ownerServers.guilds || []).map(g => g.id);
    const adminIds = (adminServers.guilds || []).map(g => g.id);

    ok('البوت الجاي من كاش البوت موجود بالقائمة', ownerIds.length === 2, JSON.stringify(ownerIds));
    ok('كل السيرفرات معلّم عليها botInside = true',
        (ownerServers.guilds || []).every(g => g.botInside === true && g.notInBot === false),
        JSON.stringify(ownerServers.guilds));
    ok('ما في تداخل بين حسابين', JSON.stringify(ownerIds) === JSON.stringify(adminIds), JSON.stringify({ ownerIds, adminIds }));

    console.log('\n--- 4) القائمة الموحّدة: البوت داخل ولا لا ---');
    const oauthList = [{ id: GUILD_A, name: 'مكرر', hasAdministrator: true }, { id: GUILD_OUT, name: 'مو داخل', approximate_member_count: 55 }];
    const merged = api.mergeUserServers(
        [guilds.get(GUILD_A)],
        oauthList,
        users.BOT_OWNER.id
    );
    ok('السيرفر اللي البوت داخله موجود مرة واحدة بس', merged.length === 2, JSON.stringify(merged.map(g => g.id)));
    ok('السيرفر اللي البوت داخله: botInside = true', merged[0].botInside === true && merged[0].notInBot === false);
    ok('السيرفر اللي البوت مو داخله: botInside = false', merged[1].botInside === false && merged[1].notInBot === true);
    ok('السيرفر الخارجي يجيب عدد أعضائه', merged[1].memberCount === 55, JSON.stringify(merged[1]));
    ok('botInside() يطّلع على الواقع', api.botInside(GUILD_A) === true && api.botInside(GUILD_OUT) === false);
    // السيرفر الخارجي ما يظهر لغير راعي البوت
    const mergedNonOwner = api.mergeUserServers([guilds.get(GUILD_A)], oauthList, users.ADMIN_B.id);
    ok('السيرفر الخارجي مخفي لغير راعي البوت',
        mergedNonOwner.length === 1 && mergedNonOwner[0].id === GUILD_A,
        JSON.stringify(mergedNonOwner.map(g => g.id)));

    console.log('\n--- 5) إعدادات الحماية مفتوحة لكل إدمن على سيرفره ---');
    ok('isBotOwner يعرف المالك', api.isBotOwner(users.BOT_OWNER.id) === true);
    ok('isBotOwner ما يعرف الإدمن الثاني', api.isBotOwner(users.ADMIN_B.id) === false);

    const ownerPage = JSON.parse((await request(port, '/api/server/' + GUILD_A, 'GET', cookieOwner)).body || '{}');
    const adminPage = JSON.parse((await request(port, '/api/server/' + GUILD_B, 'GET', cookieAdmin)).body || '{}');
    ok('صفحة السيرفر تفتح الحماية للمالك', ownerPage.canManageProtections === true, JSON.stringify(ownerPage.canManageProtections));
    ok('صفحة السيرفر تفتح الحماية للإدمن الثاني', adminPage.canManageProtections === true, JSON.stringify(adminPage.canManageProtections));

    const adminProt = await request(port, '/api/server/' + GUILD_B + '/settings', 'POST', cookieAdmin, {
        section: 'protections', data: { channels: { enabled: true, metrics: { create: 3 } } }
    });
    ok('إدمن ثاني يعدّل إعدادات سيرفره -> 200', adminProt.status === 200, 'status=' + adminProt.status + ' body=' + adminProt.body.slice(0, 120));

    const ownerProt = await request(port, '/api/server/' + GUILD_A + '/settings', 'POST', cookieOwner, {
        section: 'protections', data: { channels: { enabled: true, metrics: { create: 3 } } }
    });
    ok('راعي البوت يعدّل إعدادات الحماية -> 200', ownerProt.status === 200, 'status=' + ownerProt.status + ' body=' + ownerProt.body.slice(0, 120));

    const adminWelcome = await request(port, '/api/server/' + GUILD_B + '/settings', 'POST', cookieAdmin, {
        section: 'welcome', data: { message: 'أهلاً' }
    });
    ok('إدمن ثاني يعدّل الترحيب (مو حماية) -> 200', adminWelcome.status === 200, 'status=' + adminWelcome.status);

    const adminInvites = await request(port, '/api/server/' + GUILD_B + '/invites', 'POST', cookieAdmin, { mode: 'off' });
    ok('إدمن ثاني يدير حماية اختصار سيرفره -> 200', adminInvites.status === 200, 'status=' + adminInvites.status);
    const ownerInvites = await request(port, '/api/server/' + GUILD_A + '/invites', 'POST', cookieOwner, { mode: 'off' });
    ok('راعي البوت يدير حماية الاختصار -> 200', ownerInvites.status === 200, 'status=' + ownerInvites.status);

    const adminBan = await request(port, '/api/server/' + GUILD_B + '/action', 'POST', cookieAdmin, {
        action: 'ban', userId: '999999999999999991', reason: 'test'
    });
    ok('الإجراءات الإدارية tetap شغالة للإدمن (ما انحذفت)', adminBan.status !== 403, 'status=' + adminBan.status);

    console.log('\n--- 6) الواجهة ---');
    const appjs = (await request(port, '/assets/app.js', 'GET')).body;
    ok('الواجهة تعرض حالة البوت على كل سيرفر', /serverCardHTML/.test(appjs) && /البوت مو داخل السيرفر/.test(appjs));
    ok('الواجهة ما تقفل تبويب الحماية على أحد', !/if \(!GUILD\.canManageProtections\)/.test(appjs));
    ok('الواجهة تعرض المتغيّرات الناقصة القادمة من السيرفر', /المتغيّرات الناقصة/.test(appjs));

    console.log('\n--- 7) CLIENT_ID ما يحتاج متغيّر: يجيبه من البوت نفسه ---');
    // نفس الوحدة بدون أي متغيّر عملي ولا ملف .env → لازم يستخدم آيدي البوت
    process.env.DASHBOARD_ENV_FILE = '0';
    for (const key of ['CLIENT_ID', 'DASHBOARD_CLIENT_ID', 'DISCORD_CLIENT_ID', 'CLIENT_SECRET', 'DASHBOARD_CLIENT_SECRET', 'DISCORD_CLIENT_SECRET']) {
        delete process.env[key];
    }
    // نركّب الشاشة أولاً بدون أي سر → لازم يقول لنا الناقص بالضبط
    delete require.cache[require.resolve('../dashboard/server.js')];
    const noSecretSetup = require('../dashboard/server.js');

    const app3 = express();
    app3.set('trust proxy', true);
    const secretless = noSecretSetup(app3, deps);
    const server3 = app3.listen(0, '127.0.0.1');
    await new Promise(r => server3.once('listening', r));

    const st3 = JSON.parse((await request(server3.address().port, '/api/auth/status', 'GET')).body || '{}');
    ok('بدون أي سر: الدخول مو مفعّل ويحدد الناقص',
        st3.ready === false && JSON.stringify(st3.missing) === JSON.stringify(['CLIENT_SECRET']),
        JSON.stringify({ ready: st3.ready, missing: st3.missing }));
    ok('التشخيص يعطي الحل بالتفصيل (/api/auth/status)',
        /CLIENT_SECRET/.test(String(st3.hint || '')) && /\/api\/auth\/callback$/.test(String(st3.redirectUri || '')),
        JSON.stringify({ hint: st3.hint, redirectUri: st3.redirectUri }));
    ok('oauthMissing() ترجع CLIENT_SECRET', JSON.stringify(secretless.oauthMissing()) === JSON.stringify(['CLIENT_SECRET']));
    ok('ما يطالبك بـ CLIENT_ID (ياخذه من البوت)', secretless.oauthMissing().includes('CLIENT_ID') === false,
        JSON.stringify(secretless.oauthMissing()));

    // الحين بدون CLIENT_ID بس مع السر → الدخول لازم يشتغل بآيدي البوت
    process.env.CLIENT_SECRET = 'secret-only-no-client-id';

    delete require.cache[require.resolve('../dashboard/server.js')];
    const bareSetup = require('../dashboard/server.js');

    const app2 = express();
    app2.set('trust proxy', true);
    const bare = bareSetup(app2, deps);

    ok('بدون CLIENT_ID بالاستضافة → ياخذ آيدي البوت', bare.oauthReady() === true && bare.oauthMissing().length === 0,
        JSON.stringify(bare.oauthMissing()));

    const server2 = app2.listen(0, '127.0.0.1');
    await new Promise(r => server2.once('listening', r));
    const port2 = server2.address().port;

    const st2 = JSON.parse((await request(port2, '/api/auth/status', 'GET')).body || '{}');
    ok('التشخيص يقول إن الآيدي جاي من البوت', st2.clientId === client.user.id && st2.clientIdSource === 'bot',
        JSON.stringify({ id: st2.clientId, src: st2.clientIdSource }));

    const login2 = await request(port2, '/api/auth/login', 'GET');
    ok('زر الدخول يشتغل بدون CLIENT_ID', login2.status === 302 && String(login2.headers.location || '').includes(client.user.id),
        'status=' + login2.status);

    server2.close();
    server3.close();

    console.log('\n=== ' + pass + ' passed, ' + fail + ' failed ===');
    server.close();
    process.exit(fail ? 1 : 0);
})();
