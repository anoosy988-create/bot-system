// ⭐ Guarantees: أي أمر تضيفه بـ /shortcut add (سلاش) لازم يظهر بالموقع
// تشغيل:  node tools/sync.test.js
//
// المشكلة اللي كانت موجودة: /shortcut add كان يعرض untimeout بالسلاش بس
// SHORTCUT_COMMANDS في app.js ما كان فيها -> الاختصار يختفي من الداشبورد.
// الاختبار يربط القائمتين ببعض عشان ما يرجعون يفترقون.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const indexSrc = fs.readFileSync(path.join(ROOT, 'commands.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'dashboard', 'public', 'app.js'), 'utf8');

let pass = 0, fail = 0;
const bad = [];
function ok(name, cond, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; bad.push('  ' + name + (extra ? '  -> ' + extra : '')); console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

// ── 1) كل value في قائمة /shortcut add ────────────────────
const addStart = indexSrc.indexOf(".setName('add')", indexSrc.indexOf(".setName('shortcut')"));
ok('لقينا أمر /shortcut add', addStart !== -1);
if (addStart === -1) { console.log('\n=== ' + pass + ' passed, ' + fail + ' failed ==='); process.exit(1); }

const choicesEnd = indexSrc.indexOf(')', indexSrc.indexOf('addChoices', addStart) !== -1
    ? indexSrc.indexOf('addChoices', addStart)
    : addStart);

// نأخذ كل { name: '...', value: '...' } بين addSlash وقفله
const addBlock = indexSrc.slice(addStart, addStart + 4000);
const slashCommands = [...addBlock.matchAll(/value:\s*'([a-z][a-z-]*)'/g)].map(m => m[1]);

console.log('\n--- 1) أوامر /shortcut add في index.js ---');
console.log('  ' + slashCommands.join(', '));
ok('لقينا قائمة الأوامر', slashCommands.length > 0, 'count=' + slashCommands.length);
ok('في untimeout (كان ناقص بالموقع)', slashCommands.includes('untimeout'));
ok('في role-add', slashCommands.includes('role-add'));
ok('في role-remove', slashCommands.includes('role-remove'));

// ── 2) SHORTCUT_COMMANDS في app.js ───────────────────────
const listStart = appSrc.indexOf('const SHORTCUT_COMMANDS = [');
const listEnd = appSrc.indexOf('];', listStart);
ok('لقينا SHORTCUT_COMMANDS', listStart !== -1 && listEnd !== -1);

const listBlock = appSrc.slice(listStart, listEnd);
const siteCommands = [...listBlock.matchAll(/key:\s*'([a-z][a-z-]*)'/g)].map(m => m[1]);

console.log('\n--- 2) قائمة الداشبورد SHORTCUT_COMMANDS ---');
console.log('  ' + siteCommands.join(', '));
ok('لقينا قائمة الموقع', siteCommands.length > 0, 'count=' + siteCommands.length);

// ── 3) المقارنة: هذا هو الاختبار الحاسم ──────────────────
console.log('\n--- 3) كل أمر سلاش لازم يطلع بالموقع ---');
const missing = slashCommands.filter(c => !siteCommands.includes(c));
ok('ما فيه أي أمر سلاش ناقص بالموقع',
    missing.length === 0,
    missing.length ? 'ناقص: ' + missing.join(', ') : '');

const extra = siteCommands.filter(c => !slashCommands.includes(c));
ok('ما فيه comando بالموقع مو موجود بالسلاش',
    extra.length === 0,
    extra.length ? 'increase: ' + extra.join(', ') : '');

// ── 4) شبكة الأمان موجودة (لوPSLاش توسّع بعدين) ──────────
console.log('\n--- 4) شبكة الأمان للأوامر الجديدة ---');
ok('في دالة orphanShortcutGroups', /function orphanShortcutGroups/.test(appSrc));
ok('renderShortcuts تستدعيها', /\$\{orphanShortcutGroups\(\)\}/.test(appSrc));
ok('تعرض الأوامر المجهولة', /أمر إداري أضافه أمر سلاش/.test(appSrc));

// ── 5) الردود التلقائية (كل شي من سلاش يطلع بالموقع) ────
console.log('\n--- 5) الردود التلقائية والاختصارات من سلاش ---');
ok('الداشبورد يقرأ settings.autoResponses', /GUILD\.settings\.autoResponses/.test(appSrc));
ok('الداشبورد يقرأ settings.shortcuts', /GUILD\.settings\.shortcuts/.test(appSrc));
ok('ال السيرفر يرجّع settings كاملة', /settings:\s*jsonSettings\(settings\)/.test(fs.readFileSync(path.join(ROOT, 'dashboard', 'server.js'), 'utf8')));

console.log('\n=== ' + pass + ' passed, ' + fail + ' failed ===');
if (bad.length) { console.log('\nFAILURES:'); bad.forEach(b => console.log(b)); }
process.exit(fail ? 1 : 0);
