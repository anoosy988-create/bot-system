// اختبار جدولة النسخ الاحتياطي (backup-schedule.js)
// تشغيل: node tools/backup-schedule.test.js

const path = require('path');
const s = require(path.join(__dirname, '..', 'backup-schedule.js'));

let pass = 0, fail = 0;
const bad = [];
function ok(name, cond, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; bad.push('  ' + name + (extra ? '  -> ' + extra : '')); console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

console.log('\n--- 1) أول تشغيل ---');

ok('ما فيه نسخة = أول تشغيل', s.isFirstRun({}) === true);
ok('أول تشغيل = مستحق', s.isDue({}) === true);

const first = s.nextAfterBackup(1_000_000);
ok('بعد النسخة lastBackupAt ينضبط', new Date(first.lastBackupAt).getTime() === 1_000_000);
ok('بعد النسخة nextBackupAt بعد 48 ساعة',
    new Date(first.nextBackupAt).getTime() === 1_000_000 + 48 * HOUR);
ok('بعد النسخة delayDays = 0', first.delayDays === 0);
ok('بعد النسخة changeDay = null', first.changeDay === null);

console.log('\n--- 2) الاستحقاق ---');

const base = s.nextAfterBackup(0);
ok('قبل الموعد = غير مستحق', s.isDue(base, 47 * HOUR) === false);
ok('عند الموعد = مستحق', s.isDue(base, 48 * HOUR) === true);
ok('بعد الموعد = مستحق', s.isDue(base, 100 * HOUR) === true);

console.log('\n--- 3) التأجيل عند التعديل ---');

const day1 = 0;
const c1 = s.nextAfterChange(base, day1);
ok('التعديل يرجّع حالة', !!c1);
ok('التعديل يرفع delayDays لـ 1', c1.delayDays === 1);
ok('التعديل يؤجل يوم كامل',
    new Date(c1.nextBackupAt).getTime() === 48 * HOUR + 24 * HOUR);

// نفس اليوم مرة ثانية → null (ما نضاعف)
ok('تعديل ثاني بنفس اليوم = null',
    s.nextAfterChange(c1, day1 + HOUR) === null);

// يوم ثاني → delayDays 2
const c2 = s.nextAfterChange(c1, day1 + DAY);
ok('تعديل يوم ثاني = delayDays 2', c2.delayDays === 2);
ok('تعديل يوم ثاني يؤجل يومين من آخر نسخة',
    new Date(c2.nextBackupAt).getTime() === 48 * HOUR + 2 * 24 * HOUR);

console.log('\n--- 4) الحد الأقصى 7 أيام ---');

let state = base;
for (let i = 1; i <= 12; i++) {
    const next = s.nextAfterChange(state, i * DAY);
    if (next) state = next;
}

ok('delayDays ما يتجاوز 7', state.delayDays === s.BACKUP_MAX_DELAY_DAYS);
ok('الأقصى 7 أيام إضافية',
    new Date(state.nextBackupAt).getTime() === 48 * HOUR + 7 * 24 * HOUR);

console.log('\n--- 5) إعادة التصفير بعد النسخة ---');

const after = s.nextAfterBackup(500 * DAY);
ok('بعد النسخة يرجع delayDays 0', after.delayDays === 0);
ok('بعد النسخة changeDay null', after.changeDay === null);

console.log('\n--- 6) dayKey ---');

ok('dayKey ثابت لنفس اليوم', s.dayKey(0) === s.dayKey(DAY - 1));
ok('dayKey يختلف بين يومين', s.dayKey(0) !== s.dayKey(DAY));

console.log('\n=== ' + pass + ' passed, ' + fail + ' failed ===');
if (bad.length) { console.log('\nFAILURES:'); bad.forEach(b => console.log(b)); }
process.exit(fail ? 1 : 0);
