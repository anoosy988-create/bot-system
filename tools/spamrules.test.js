// اختبار قواعد السبام (spamrules.js) — منطق صِرف
// تشغيل: node tools/spamrules.test.js

const path = require('path');
const rules = require(path.join(__dirname, '..', 'spamrules.js'));

let pass = 0, fail = 0;
const bad = [];
function ok(name, cond, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; bad.push('  ' + name + (extra ? '  -> ' + extra : '')); console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

function msg(content, opts = {}) {
    return {
        content: content || '',
        mentions: {
            users: { size: opts.users || 0 },
            roles: { size: opts.roles || 0 },
            everyone: !!opts.everyone
        },
        attachments: { size: opts.files || 0 }
    };
}

const metrics = list => list.map(x => x.metric);
const has = (list, m) => metrics(list).includes(m);

console.log('\n--- 1) منشنات ---');

ok('منشن عادي ما ينفّع',
    !has(rules.detect(msg('hi @someone', { users: 1 }), {}), 'mentions'));

ok('منشنات كثيرة (>=6) تنفّع',
    has(rules.detect(msg('spam', { users: 6 }), {}), 'mentions'));

ok('everyone مع منشن ينفّع',
    has(rules.detect(msg('@everyone hi', { everyone: true, users: 1 }), {}), 'mentions'));

ok('تعطيل فحص المنشنات يمنعها',
    !has(rules.detect(msg('spam', { users: 50 }), { onMentions: false }), 'mentions'));

console.log('\n--- 2) مسافات ---');

ok('مسافات متتالية كثيرة تنفّع',
    has(rules.detect(msg('a' + ' '.repeat(12) + 'b'), {}), 'spaces'));

ok('مسافتين ما تنفّع',
    !has(rules.detect(msg('a  b'), {}), 'spaces'));

ok('maxSpaceRun يرجّع أطول سلسلة',
    rules.maxSpaceRun('a' + ' '.repeat(5) + 'b' + ' '.repeat(9) + 'c') === 9);

console.log('\n--- 3) تكبير الخط ---');

ok('نص كامل العرض ينفّع',
    has(rules.detect(msg('Ｈｅｌｌｏ Ｗｏｒｌｄ Ｔｅｓｔ'), {}), 'bigtext'));

ok('نص عادي ما ينفّع',
    !has(rules.detect(msg('Hello World normal text'), {}), 'bigtext'));

ok('bigCharRatio يحسب نسبة معقولة',
    rules.bigCharRatio('Ｈｅｌｌｏ') >= 0.99);

ok('نص قصير (<4 أحرف) ما ينفّع حتى لو كبير',
    !has(rules.detect(msg('Ｈｅ'), {}), 'bigtext'));

console.log('\n--- 4) الملفات ---');

ok('ملفات كثيرة (>=4) تنفّع',
    has(rules.detect(msg('take these', { files: 4 }), {}), 'files'));

ok('ملفين ما تنفّع',
    !has(rules.detect(msg('take these', { files: 2 }), {}), 'files'));

console.log('\n--- 5) الروابط والدعوات ---');

ok('رابط https ينفّع لما onLinks مفعّل',
    has(rules.detect(msg('check https://example.com'), { onLinks: true }), 'links'));

ok('رابط https ما ينفّع افتراضياً',
    !has(rules.detect(msg('check https://example.com'), {}), 'links'));

ok('رابط دعوة ينفّع لما onInvites مفعّل',
    has(rules.detect(msg('join discord.gg/abc123'), { onInvites: true }), 'invites'));

ok('رابط دعوة ما ينفّع افتراضياً',
    !has(rules.detect(msg('join discord.gg/abc123'), {}), 'invites'));

console.log('\n--- 6) حدود مخصصة ---');

ok('حد منشنات مخصص 3',
    has(rules.detect(msg('x', { users: 3 }), { maxMentions: 3 }), 'mentions'));

ok('حد ملفات مخصص 10 لا ينفّع عند 4',
    !has(rules.detect(msg('x', { files: 4 }), { maxFiles: 10 }), 'files'));

ok('رسالة فاضية ما تنفّع أي شي',
    rules.detect(msg(''), {}).length === 0);

console.log('\n=== ' + pass + ' passed, ' + fail + ' failed ===');
if (bad.length) { console.log('\nFAILURES:'); bad.forEach(b => console.log(b)); }
process.exit(fail ? 1 : 0);
