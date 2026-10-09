// اختبار حصانة الوايت ليست: أي عضو بالقايمة البيضاء ما يعاقبه البوت أبداً
// تشغيل:  node tools/whitelist.test.js
//
// المشكلة اللي كانت موجودة: protectionAllowed() ودخول البوتات كانوا
// يتحققون من الوايت ليست، بس applyPunishment / banSuspectedBots /
// punishFor / punishInviteOffender كانوا ينفّذون العقوبة عليه وهو بالقايمة.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');
const dashSrc = fs.readFileSync(path.join(ROOT, 'dashboard', 'server.js'), 'utf8');

let pass = 0, fail = 0;
const bad = [];
function ok(name, cond, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; bad.push('  ' + name + (extra ? '  -> ' + extra : '')); console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

// يقصّ دالة كاملة من المصدر بعدد الأقواس المعتدلة
function extractFn(signature) {
    const a = src.indexOf(signature);
    if (a === -1) { console.error('FAIL: marker not found -> ' + signature); process.exit(1); }

    const open = src.indexOf('{', a);
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) return src.slice(a, i + 1);
        }
    }
    console.error('FAIL: unbalanced braces -> ' + signature);
    process.exit(1);
}

// ======================================================
// 1) سلوك whitelistExempt
// ======================================================

const fnSrc = extractFn('async function whitelistExempt(guildId, userId) {');

const tmp = path.join(ROOT, '_wltest_' + process.pid + '.js');
fs.writeFileSync(
    tmp,
    `
    const mock = () => globalThis.__wlMock;
    const protectionsCache = {
        get: k => mock().cache.get(String(k)),
        set: (k, v) => mock().cache.set(String(k), v)
    };
    async function getSettings(id) {
        if (mock().settingsThrows) throw new Error('db down');
        const s = mock().settings;
        return s && s._id === id ? s : { _id: id, whitelist: [] };
    }
    ${fnSrc}
    module.exports = { whitelistExempt };
    `,
    'utf8'
);

globalThis.__wlMock = { cache: new Map(), settings: null, settingsThrows: false };

let api;
try {
    api = require(tmp);
} catch (e) {
    console.error('FAIL: could not load whitelistExempt:\n  ' + e.message);
    try { fs.unlinkSync(tmp); } catch {}
    process.exit(1);
} finally {
    try { fs.unlinkSync(tmp); } catch {}
}

const { whitelistExempt } = api;

async function run(overrides) {
    globalThis.__wlMock = {
        cache: overrides.cache || new Map(),
        settings: overrides.settings ?? null,
        settingsThrows: !!overrides.settingsThrows
    };
    return whitelistExempt(overrides.guildId, overrides.userId);
}

console.log('\n--- 1) سلوك whitelistExempt ---');

(async () => {

    ok('ما يرجع true بدون مدخلات',
        (await run({ cache: new Map() })) === false);

    // الكاش فيه العضو
    ok('القائمة بالكاش → true',
        (await run({
            cache: new Map([['g1', { protections: {}, whitelist: ['111'] }]]),
            guildId: 'g1', userId: '111'
        })) === true);

    // الكاش ما فيه العضو
    ok('العضو مو بالقائمة → false',
        (await run({
            cache: new Map([['g1', { protections: {}, whitelist: ['222'] }]]),
            guildId: 'g1', userId: '111'
        })) === false);

    // الكاش فيه قائمة فاضية = مو exempt (ما يرجع للـ DB)
    ok('قائمة فاضية بالكاش = مو exempt',
        (await run({
            cache: new Map([['g1', { protections: {}, whitelist: [] }]]),
            guildId: 'g1', userId: '111'
        })) === false);

    // بدون كاش → يروح للـ DB
    ok('بدون كاش يرجّع للقاعدة → true',
        (await run({
            cache: new Map(),
            settings: { _id: 'g1', whitelist: ['111'] },
            guildId: 'g1', userId: '111'
        })) === true);

    ok('بدون كاش والقاعدة ما فيه → false',
        (await run({
            cache: new Map(),
            settings: { _id: 'g1', whitelist: [] },
            guildId: 'g1', userId: '111'
        })) === false);

    ok('القاعدة فشلت → false (ما نعاقبهاش)',
        (await run({
            cache: new Map(),
            settingsThrows: true,
            guildId: 'g1', userId: '111'
        })) === false);

    ok('الآيدي الرقمي يُطابَق كنص',
        (await run({
            cache: new Map([['g1', { protections: {}, whitelist: ['111'] }]]),
            guildId: 'g1', userId: 111
        })) === true);

    // ======================================================
    // 2) كل مسار عقوبة لازم يتحقق قبل ما ينفّذ
    // ======================================================
    console.log('\n--- 2) كل مسار عقوبة محمي بالوايت ليست ---');

    const PUNISH_CALLS = ['.ban(', '.kick(', '.timeout(', 'jailMember(', 'guild.bans.create(', 'roles.add(', 'roles.remove('];

    const guards = [
        ['applyPunishment', 'async function applyPunishment(member, action, reason) {'],
        ['banSuspectedBots', 'async function banSuspectedBots(guild, prot, context) {'],
        ['punishFor', 'async function punishFor(guild, member, executorId, action, reason) {'],
        ['punishInviteOffender', 'async function punishInviteOffender(guild, member, executorId, action, reason) {']
    ];

    for (const [name, sig] of guards) {
        const body = extractFn(sig);
        const gi = body.indexOf('whitelistExempt(');

        ok(name + ' يتحقق من الوايت ليست', gi !== -1);

        if (gi === -1) continue;

        const firstPunish = PUNISH_CALLS
            .map(c => body.indexOf(c))
            .filter(i => i !== -1)
            .sort((a, b) => a - b)[0];

        ok(
            name + ' يفحص الوايت ليست قبل أي عقوبة',
            firstPunish === undefined || gi < firstPunish,
            firstPunish === undefined ? '' : 'guard@' + gi + ' punish@' + firstPunish
        );
    }

    // ======================================================
    // 3) تبويب الوايت ليست يبقى مقفول
    // ======================================================
    console.log('\n--- 3) إدارة القايمة تبقى مقفولة ---');

    ok('الداشبورد يعرض canManageWhitelist',
        /canManageWhitelist:\s*isWhitelistManager\(/.test(dashSrc));

    ok('قسم whitelist فيه حارس isWhitelistManager',
        /section === 'whitelist'[\s\S]{0,400}isWhitelistManager/.test(dashSrc));

    const ownerOnlyBody = dashSrc.slice(
        dashSrc.indexOf('const OWNER_ONLY_SECTIONS'),
        dashSrc.indexOf('const OWNER_ONLY_SECTIONS') + 200
    );
    ok('ما فيه قسم مقفل بالمالك فاضي',
        /OWNER_ONLY_SECTIONS = new Set\(\)\s*;/.test(ownerOnlyBody),
        'OWNER_ONLY_SECTIONS فاضي — بس حارس whitelist مستقل موجود');

    console.log('\n=== ' + pass + ' passed, ' + fail + ' failed ===');
    if (bad.length) { console.log('\nFAILURES:'); bad.forEach(b => console.log(b)); }
    process.exit(fail ? 1 : 0);
})();