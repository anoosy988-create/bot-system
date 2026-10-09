// ظٹطھط­ظ‚ظ‚ ظ…ظ† طµط­ط© طھط¹ط±ظٹظپط§طھ ط³ظ„ط§ط´ ظƒظˆظ…ط§ظ†ط¯ط² ظ…ظ‚ط§ط¨ظ„ ط­ط¯ظˆط¯ ط¯ظٹط³ظƒظˆط±ط¯ ط§ظ„ط­ظ‚ظٹظ‚ظٹط©
// ط¨ط¯ظˆظ† ظ…ط§ ظٹط´ط؛ظ‘ظ„ ط§ظ„ط¨ظˆطھ â€” ظ†ط³طھط®ط±ط¬ ط§ظ„ظ…طµظپظˆظپط© ظ…ظ† index.js ظپظ‚ط·
const path = require('path');

const ROOT = path.join(__dirname, '..');

// ✅ المصدر الوحيد لتعريفات الأوامر صار ./commands.js
let cmds;
try {
    cmds = require(path.join(ROOT, 'commands.js')).slashCommands;
} catch (e) {
    console.error('FAIL: definitions threw while building:\n  ' + e.message);
    process.exit(1);
}

let pass = 0, fail = 0;
const bad = [];
function ok(name, cond, extra) {
    if (cond) pass++; else { fail++; bad.push('  ' + name + (extra ? '  -> ' + extra : '')); }
}

const NAME_RE = /^[-_\p{L}\p{N}]+$/u;
const TOTAL_LIMIT = 4000;

function checkCommand(c) {
    const n = c.name;
    ok('cmd name valid: ' + n, typeof n === 'string' && n.length >= 1 && n.length <= 32 && NAME_RE.test(n));
    ok('cmd name lowercase: ' + n, n === n.toLowerCase(), n);
    ok('cmd desc len<=100: ' + n, typeof c.description === 'string' && c.description.length >= 1 && c.description.length <= 100, 'len=' + (c.description || '').length);

    const subs = c.options || [];
    ok('cmd has <=25 options: ' + n, subs.length <= 25, 'got ' + subs.length);

    const walkSub = (s, where) => {
        ok(where + ' name valid: ' + s.name, typeof s.name === 'string' && s.name.length >= 1 && s.name.length <= 32 && NAME_RE.test(s.name), s.name);
        ok(where + ' name lowercase: ' + s.name, s.name === s.name.toLowerCase(), s.name);
        ok(where + ' desc<=100: ' + s.name, typeof s.description === 'string' && s.description.length >= 1 && s.description.length <= 100, 'len=' + (s.description || '').length);
        const opts = s.options || [];
        ok(where + ' <=25 opts: ' + s.name, opts.length <= 25, 'got ' + opts.length);
        for (const o of opts) {
            ok(where + '/' + s.name + ' opt name: ' + o.name, typeof o.name === 'string' && o.name.length >= 1 && o.name.length <= 32 && NAME_RE.test(o.name), o.name);
            ok(where + '/' + s.name + ' opt name lowercase: ' + o.name, o.name === o.name.toLowerCase(), o.name);
            ok(where + '/' + s.name + ' opt desc: ' + o.name, typeof o.description === 'string' && o.description.length >= 1 && o.description.length <= 100, 'len=' + (o.description || '').length);
            if (o.type === 2) {
                ok(where + '/' + s.name + ' group <=25 subs', (o.options || []).length <= 25, 'got ' + (o.options || []).length);
                (o.options || []).forEach(x => walkSub(x, where + '/' + s.name + '/' + o.name));
            }
        }
    };

    for (const s of subs) walkSub(s, n);

    const size = JSON.stringify(c).length;
    ok('cmd json <=4000: ' + n, size <= TOTAL_LIMIT, 'size=' + size);
}

console.log('Total commands: ' + cmds.length);
cmds.forEach(checkCommand);

const names = cmds.map(c => c.name);
const dupes = names.filter((x, i) => names.indexOf(x) !== i);
ok('no duplicate command names', dupes.length === 0, dupes.join(','));

const namesWanted = ['welcome', 'ticket', 'set-ticket', 'dashboard'];
namesWanted.forEach(w => ok('command exists: ' + w, names.includes(w)));

const welcome = cmds.find(c => c.name === 'welcome');
const ticket = cmds.find(c => c.name === 'ticket');

if (welcome) {
    const grp = (welcome.options || []).find(o => o.type === 2 && o.name === 'image');
    ok('welcome has image group', !!grp);
    if (grp) {
        const n2 = grp.options.map(o => o.name).sort();
        ok('welcome image subcommands set/remove', n2.join(',') === 'remove,set', n2.join(','));
    }
    const flat = (welcome.options || []).filter(o => o.type !== 11).map(o => o.name);
    ok('welcome keeps flat set/card/variables/off',
        ['set', 'card', 'variables', 'off'].every(x => flat.includes(x)), flat.join(','));
}

if (ticket) {
    console.log('\nticket top-level options: ' + (ticket.options || [])
        .map(o => o.name + '(t' + o.type + ')').join(', '));

    const grp = (ticket.options || []).find(o => o.type === 2 && o.name === 'image');
    ok('ticket has image group', !!grp);
    if (grp) {
        ok('ticket image subcommands set/panel/remove',
            grp.options.map(o => o.name).sort().join(',') === 'panel,remove,set',
            grp.options.map(o => o.name).sort().join(','));
    }
    const flat = (ticket.options || []).filter(o => o.type !== 11).map(o => o.name);
    ok('ticket keeps flat setup/send/option/disable/info',
        ['setup', 'send', 'option', 'disable', 'info'].every(x => flat.includes(x)), flat.join(','));
    ok('ticket has flat add/remove/members',
        ['add', 'remove', 'members'].every(x => flat.includes(x)), flat.join(','));
    ok('flat remove AND group image.remove both exist',
        flat.includes('remove') && !!grp && grp.options.some(o => o.name === 'remove'));
}

let attachCount = 0;
const scan = o => {
    if (o.type === 11) {
        attachCount++;
        ok('attachment opt has no min/max: ' + o.name, !('min_value' in o) && !('max_value' in o));
    }
    (o.options || []).forEach(scan);
};
cmds.forEach(c => (c.options || []).forEach(scan));
ok('attachment options present', attachCount >= 3, 'count=' + attachCount);

// 🚨 أهم اختبار: لو أي أمر عدّى 4000 حرف، تسجيل كل الأوامر يفشل
// (client.application.commands.set يرجع 400 والولا أمر يظهر)
const over = cmds.filter(c => JSON.stringify(c).length > 4000);
ok('NO command exceeds Discord 4000-char limit', over.length === 0,
    over.map(c => c.name + '=' + JSON.stringify(c).length).join(', '));
const near = cmds.filter(c => JSON.stringify(c).length > 3500);
console.log('\nnear limit (>3500): ' + (near.length ? near.map(c => c.name + '=' + JSON.stringify(c).length).join(', ') : 'none'));

// الأوامر اللي فُصلت
ok('antispam command exists', names.includes('antispam'));
const antispam = cmds.find(c => c.name === 'antispam');
if (antispam) {
    const a = (antispam.options || []).map(o => o.name).sort();
    ok('antispam has spam+scams', a.join(',') === 'scams,spam', a.join(','));
}
const protect = cmds.find(c => c.name === 'protect');
if (protect) {
    const p = (protect.options || []).map(o => o.name).sort();
    ok('protect kept channels/roles/bans/bots/webhooks/invites/status',
        ['channels', 'roles', 'bans', 'bots', 'webhooks', 'invites', 'status'].every(x => p.includes(x)), p.join(','));
    ok('protect no longer has spam/scams',
        !p.includes('spam') && !p.includes('scams'), p.join(','));
}

console.log('\nPassed: ' + pass + '  Failed: ' + fail);
if (bad.length) { console.log('\nFAILURES:'); bad.forEach(b => console.log(b)); }
process.exit(fail ? 1 : 0);
