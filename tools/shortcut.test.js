// اختبار مستهدفي الاختصارات: لازم تشتغل بالمنشن وبالآيدي وبالاسم (أو جزء منه)
// تشغيل:  node tools/shortcut.test.js
//
// نفس طريقة check-commands.js: نقطع الدوال من index.js ونشغّلها لوحدها
// (index.js نفسه ما ينصدر لأنه سكربت فيه client.login)

const fs = require('fs');
const path = require('path');
const { Collection } = require('discord.js');

const ROOT = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'index.js'), 'utf8');

let pass = 0, fail = 0;
const bad = [];
function ok(name, cond, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; bad.push('  ' + name + (extra ? '  -> ' + extra : '')); console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

function slice(from, to) {
    const a = src.indexOf(from);
    if (a === -1) { console.error('FAIL: marker not found -> ' + from); process.exit(1); }
    const b = src.indexOf(to, a);
    if (b === -1) { console.error('FAIL: end marker not found -> ' + to); process.exit(1); }
    return src.slice(a, b);
}

const normalizeTextSrc = slice(
    'function normalizeText(text) {',
    'function safeChannelName('
);

const resolverSrc = slice(
    'function stripShortcutPrefix(content, name) {',
    '// SHORTCUT EXECUTOR'
);

const tmp = path.join(ROOT, '_sctest_' + process.pid + '.js');
fs.writeFileSync(
    tmp,
    normalizeTextSrc + '\n' + resolverSrc + '\nmodule.exports = { stripShortcutPrefix, shortcutNameTokens, resolveShortcutMember, resolveShortcutRole };\n',
    'utf8'
);

let api;
try {
    api = require(tmp);
} catch (e) {
    console.error('FAIL: could not load resolvers:\n  ' + e.message);
    process.exit(1);
} finally {
    try { fs.unlinkSync(tmp); } catch {}
}

const { stripShortcutPrefix, shortcutNameTokens, resolveShortcutMember, resolveShortcutRole } = api;

// منشن/رتبة بالشكل الحقيقي اللي يوصل من ديسكورد
const M = id => '<@' + id + '>';
const R = id => '<@&' + id + '>';

// ── وهمية ديسكورد ────────────────────────────────────────
const AHMED = { id: '111111111111111111', displayName: 'أحمد', user: { id: '111111111111111111', username: 'ahmed', globalName: 'Ahmed Alharbi', tag: 'ahmed#0001' } };
const SARA = { id: '222222222222222222', displayName: 'سارة', user: { id: '222222222222222222', username: 'sara', globalName: 'Sara', tag: 'sara#0002' } };
const MEMBER_X = { id: '333333333333333333', displayName: 'x', user: { id: '333333333333333333', username: 'Member', tag: 'Member#0003' } };

const ROLE_MOD = { id: '900000000000000001', name: 'مشرف عام', managed: false, editable: true };
const ROLE_VIP = { id: '900000000000000002', name: 'VIP', managed: false, editable: true };
const ROLE_ADMIN = { id: '900000000000000003', name: 'Admin', managed: true, editable: false };

function mkGuild(opts = {}) {
    const cached = opts.cachedMembers || new Collection();
    const remote = opts.remoteMembers || new Map();
    return {
        roles: { cache: new Collection((opts.roles || [ROLE_MOD, ROLE_VIP, ROLE_ADMIN]).map(r => [r.id, r])) },
        members: {
            cache: cached,
            fetch: async (arg) => {
                if (typeof arg === 'string') {
                    if (!remote.has(arg)) throw new Error('Unknown Member ' + arg);
                    return remote.get(arg);
                }
                const q = String(arg.query || '').toLowerCase();
                const hits = [...remote.values()].filter(m =>
                    String(m.user.username).toLowerCase().includes(q)
                );
                return { members: new Collection(hits.map(m => [m.id, m])) };
            }
        }
    };
}

// note = نص رسالة الاختصار بعد ما ينقص منه الاسم
function mkMessage(guild, note, { memberIds = [], roleIds = [] } = {}) {
    return {
        guild,
        content: 'اختصار ' + note,
        mentions: {
            members: { first: () => memberIds.map(id => guild.members.cache.get(id)).find(Boolean) || null },
            users: { values: () => memberIds.map(id => ({ id }))[Symbol.iterator]() },
            roles: { first: () => roleIds.map(id => guild.roles.cache.get(id)).find(Boolean) || null }
        }
    };
}

// ── 1) stripShortcutPrefix ────────────────────────────────
console.log('\n--- 1) قصّ اسم الاختصار من الرسالة ---');
ok('اسم عادي: "ر @عضو" -> "@عضو"',
    stripShortcutPrefix('ر @عضو', 'ر') === '@عضو', stripShortcutPrefix('ر @عضو', 'ر'));
ok('اسم من كلمتين: "فك سجن 123" -> "123"',
    stripShortcutPrefix('فك سجن 123', 'فك سجن') === '123', stripShortcutPrefix('فك سجن 123', 'فك سجن'));
ok('مسافات متكررة ما تقطع الـ args غلط',
    stripShortcutPrefix('  ر   @عضو  ', 'ر') === '@عضو', stripShortcutPrefix('  ر   @عضو  ', 'ر'));
ok('اسم متعدد المسافات يطابق',
    stripShortcutPrefix('فك  سجن  123', 'فك سجن') === '123', stripShortcutPrefix('فك  سجن  123', 'فك سجن'));
ok('اسم بدون args يرجّع فاضي',
    stripShortcutPrefix('سجن', 'سجن') === '', JSON.stringify(stripShortcutPrefix('سجن', 'سجن')));
ok('الاسم يطلع مع الأحرف الكبيرة',
    stripShortcutPrefix('BAN 123', 'ban') === '123', stripShortcutPrefix('BAN 123', 'ban'));
ok('منشن ما ينمسّش (ترتيب الكلمات محفوظ)',
    stripShortcutPrefix('ر ' + M(AHMED.id) + ' مشرف', 'ر') === M(AHMED.id) + ' مشرف',
    stripShortcutPrefix('ر ' + M(AHMED.id) + ' مشرف', 'ر'));

// ── 2) توكنات الاسم (المدة والآيدي ما تتحوّل لاسم) ─────
console.log('\n--- 2) توكنات الاسم (المدة والآيدي ما تتحوّل لاسم) ---');
ok('يشيل المنشن', !shortcutNameTokens(M(AHMED.id) + ' مشرف').includes(M(AHMED.id)));
ok('يشيل المدة 10m', !shortcutNameTokens('ahmed 10m').includes('10m'));
ok('يشيل الآيدي', !shortcutNameTokens(AHMED.id + ' مشرف').includes(AHMED.id));
ok('يبقي الاسم', shortcutNameTokens('ahmed 10m').join(' ') === 'ahmed', shortcutNameTokens('ahmed 10m').join(' '));

// ── 3) resolveShortcutMember ─────────────────────────────
(async () => {

    console.log('\n--- 3) العضو: منشن / آيدي / اسم ---');

    // 3.1 المنشن موجود بالكاش (الحالة الطبيعية)
    const g1 = mkGuild({ cachedMembers: new Collection([[AHMED.id, AHMED]]) });
    ok('منشن العضو موجود بالكاش',
        (await resolveShortcutMember(mkMessage(g1, M(AHMED.id), { memberIds: [AHMED.id] }), M(AHMED.id)))?.id === AHMED.id);

    // 3.2 ⭐ الإصلاح الأساسي: المنشن موجود بالـ API بس مو بالكاش
    const g2 = mkGuild({
        cachedMembers: new Collection(),
        remoteMembers: new Map([[SARA.id, SARA]])
    });
    const found2 = await resolveShortcutMember(mkMessage(g2, M(SARA.id), { memberIds: [SARA.id] }), M(SARA.id));
    ok('منشن العضو مو بالكاش → ينجلب من ديسكورد (هذا اللي كان يفشل)',
        found2?.id === SARA.id, 'got=' + (found2?.id || 'null'));

    // 3.3 آيدي مكتوب عادي
    const g3 = mkGuild({ remoteMembers: new Map([[AHMED.id, AHMED]]) });
    ok('آيدي العضو',
        (await resolveShortcutMember(mkMessage(g3, AHMED.id), AHMED.id))?.id === AHMED.id);

    // 3.4 يوزرنيم / اسم ظاهر / جزء من الاسم
    const g4 = mkGuild({ cachedMembers: new Collection([[AHMED.id, AHMED], [SARA.id, SARA]]) });
    ok('يوزرنيم',
        (await resolveShortcutMember(mkMessage(g4, 'ahmed'), 'ahmed'))?.id === AHMED.id);
    ok('الاسم الظاهر',
        (await resolveShortcutMember(mkMessage(g4, 'سارة'), 'سارة'))?.id === SARA.id);
    ok('جزء من الاسم (startsWith)',
        (await resolveShortcutMember(mkMessage(g4, 'ahm'), 'ahm'))?.id === AHMED.id);

    // 3.5 الكاش فاضي والعضو ما شفناه → بحث من ديسكورد بالاسم
    const g5 = mkGuild({ remoteMembers: new Map([[AHMED.id, AHMED]]) });
    ok('بحث بالاسم من ديسكورد',
        (await resolveShortcutMember(mkMessage(g5, 'ahmed'), 'ahmed'))?.id === AHMED.id);

    // 3.6 ⛔ المدة ما تتحوّل لاسم عضو ("Member" ما تختارش خطأ)
    const g6 = mkGuild({ cachedMembers: new Collection([[MEMBER_X.id, MEMBER_X]]) });
    ok('المدة لحالها ما تجيب عضو (m ما تطابق Member)',
        (await resolveShortcutMember(mkMessage(g6, '10m'), '10m')) === null);

    // 3.7 منشن + مدة → العضو هو المنشن
    ok('منشن + مدة يرجّع المنشن',
        (await resolveShortcutMember(mkMessage(g6, M(MEMBER_X.id) + ' 10m', { memberIds: [MEMBER_X.id] }), M(MEMBER_X.id) + ' 10m'))?.id === MEMBER_X.id);

    // 3.8 فاضي → null
    ok('ما في args → null',
        (await resolveShortcutMember(mkMessage(g4, ''), '')) === null);

    // ── 4) resolveShortcutRole ────────────────────────────
    console.log('\n--- 4) الرتبة: مو لازم منشن (اسم / آيدي / جزئي) ---');
    const g7 = mkGuild({ cachedMembers: new Collection([[AHMED.id, AHMED]]) });
    const who = { memberIds: [AHMED.id] };

    ok('منشن الرتبة',
        resolveShortcutRole(mkMessage(g7, M(AHMED.id) + ' ' + R(ROLE_MOD.id), { ...who, roleIds: [ROLE_MOD.id] }), M(AHMED.id) + ' ' + R(ROLE_MOD.id))?.id === ROLE_MOD.id);

    ok('نسخة <@&id>',
        resolveShortcutRole(mkMessage(g7, M(AHMED.id) + ' ' + R(ROLE_VIP.id), who), M(AHMED.id) + ' ' + R(ROLE_VIP.id))?.id === ROLE_VIP.id);

    ok('الرتبة بآيدي عادي  ⭐',
        resolveShortcutRole(mkMessage(g7, M(AHMED.id) + ' ' + ROLE_MOD.id, who), M(AHMED.id) + ' ' + ROLE_MOD.id)?.id === ROLE_MOD.id);

    ok('الرتبة باسمها  ⭐',
        resolveShortcutRole(mkMessage(g7, M(AHMED.id) + ' مشرف', who), M(AHMED.id) + ' مشرف')?.id === ROLE_MOD.id);

    ok('الرتبة VIP باسمها',
        resolveShortcutRole(mkMessage(g7, M(AHMED.id) + ' vip', who), M(AHMED.id) + ' vip')?.id === ROLE_VIP.id);

    ok('الرتبة باسم جزئي (بدون مسافة)',
        resolveShortcutRole(mkMessage(g7, M(AHMED.id) + ' مشرف عام', who), M(AHMED.id) + ' مشرف عام')?.id === ROLE_MOD.id);

    ok('ما اكفي شي → null',
        resolveShortcutRole(mkMessage(g7, M(AHMED.id), who), M(AHMED.id)) === null);

    ok('المنشن يغلب على الاسم',
        resolveShortcutRole(mkMessage(g7, M(AHMED.id) + ' مشرف', { ...who, roleIds: [ROLE_VIP.id] }), M(AHMED.id) + ' مشرف')?.id === ROLE_VIP.id);

    console.log('\n=== ' + pass + ' passed, ' + fail + ' failed ===');
    if (bad.length) { console.log('\nFAILURES:'); bad.forEach(b => console.log(b)); }
    process.exit(fail ? 1 : 0);
})();
