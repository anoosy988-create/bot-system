// اختبارات منطق التكتات — تشغيل: npm test
const { Collection } = require('discord.js');
const t = require('../tickets.js');

let pass = 0, fail = 0;
function ok(name, cond, extra) {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
}

function mkMember(id, username, tag) {
    return {
        id, displayName: username,
        user: { id, username, tag: tag || (username + '#0001') }
    };
}

const cache = new Collection();
cache.set('111111111111111111', mkMember('111111111111111111', 'anoos'));
cache.set('222222222222222222', mkMember('222222222222222222', 'ahmed', 'ahmed#1234'));
cache.set('333333333333333333', mkMember('333333333333333333', 'mohammed_alx'));

const byId = {
    '111111111111111111': mkMember('111111111111111111', 'anoos'),
    '222222222222222222': mkMember('222222222222222222', 'ahmed', 'ahmed#1234')
};

const guild = {
    members: {
        cache,
        fetch: async (arg) => {
            if (typeof arg === 'string') return byId[arg] || null;
            if (arg && arg.query) {
                const q = arg.query.toLowerCase();
                const hits = [...cache.values()].filter(
                    m => m.user.username.toLowerCase().includes(q)
                );
                return { members: new Collection(hits.map(m => [m.id, m])), size: hits.length };
            }
            return null;
        }
    }
};

(async () => {
    console.log('\n--- topicGuestIds ---');
    ok('null topic', t.topicGuestIds(null).length === 0);
    ok('no marker', t.topicGuestIds({ topic: 'hello' }).length === 0);
    ok('one guest',
        JSON.stringify(t.topicGuestIds({
            topic: '\u{1F3AB} تكت <@111111111111111111> | عام | :دعوت: زوار: <@222222222222222222>'
        })) === '["222222222222222222"]',
        JSON.stringify(t.topicGuestIds({
            topic: '\u{1F3AB} تكت <@111111111111111111> | عام | :دعوت: زوار: <@222222222222222222>'
        })));
    ok('two guests + trailing pipe',
        JSON.stringify(t.topicGuestIds({
            topic: '\u{1F3AB} تكت <@111111111111111111> | عام | :دعوت: زوار: <@222222222222222222> <@333333333333333333> | مطالب به: x'
        })) === '["222222222222222222","333333333333333333"]',
        JSON.stringify(t.topicGuestIds({
            topic: '\u{1F3AB} تكت <@111111111111111111> | عام | :دعوت: زوار: <@222222222222222222> <@333333333333333333> | مطالب به: x'
        })));
    ok('digits-only guests need marker -> ignored',
        t.topicGuestIds({ topic: '\u{1F3AB} تكت <@111111111111111111> | زوار: 222222222222222222' }).length === 0);
    ok('digits-only guests with marker',
        JSON.stringify(t.topicGuestIds({
            topic: '\u{1F3AB} تكت <@111111111111111111> | :دعوت: زوار: 222222222222222222 333333333333333333'
        })) === '["222222222222222222","333333333333333333"]');

    console.log('\n--- ticketOwnerId ---');
    ok('owner from mention', t.ticketOwnerId({ topic: '\u{1F3AB} تكت <@111111111111111111> | عام' }) === '111111111111111111');
    ok('owner legacy digits', t.ticketOwnerId({ topic: 'anoos.111111111111111111 | عام' }) === '111111111111111111');
    ok('owner raw digits', t.ticketOwnerId({ topic: '111111111111111111' }) === '111111111111111111');
    ok('owner none', t.ticketOwnerId({ topic: 'nothing' }) === null);
    ok('guest id never becomes owner (legacy topic)',
        t.ticketOwnerId({ topic: 'zzz | :دعوت: زوار: 222222222222222222' }) === null,
        String(t.ticketOwnerId({ topic: 'zzz | :دعوت: زوار: 222222222222222222' })));
    ok('owner still found with guests present',
        t.ticketOwnerId({
            topic: '\u{1F3AB} تكت <@111111111111111111> | عام | :دعوت: زوار: <@222222222222222222>'
        }) === '111111111111111111');

    console.log('\n--- resolveTicketUser ---');
    ok('by exact username', (await t.resolveTicketUser(guild, 'anoos'))?.id === '111111111111111111');
    ok('by id', (await t.resolveTicketUser(guild, '222222222222222222'))?.id === '222222222222222222');
    ok('by mention', (await t.resolveTicketUser(guild, '<@222222222222222222>'))?.id === '222222222222222222');
    ok('by partial', (await t.resolveTicketUser(guild, 'mohammed'))?.id === '333333333333333333');
    ok('case insensitive', (await t.resolveTicketUser(guild, 'ANOOS'))?.id === '111111111111111111');
    ok('via discord search fallback', (await t.resolveTicketUser(guild, 'ahmed'))?.id === '222222222222222222');
    ok('not found', (await t.resolveTicketUser(guild, 'zzz_nobody_here')) === null);
    ok('empty input', (await t.resolveTicketUser(guild, '')) === null);
    ok('not-a-guild-safe', (await t.resolveTicketUser({}, 'anoos')) === null);
    ok('null guild safe', (await t.resolveTicketUser(null, 'anoos')) === null);

    console.log('\n--- isTicketChannel ---');
    ok('by topic marker', t.isTicketChannel({ isTextBased: () => true, topic: '\u{1F3AB} تكت <@1>', name: 'x' }, {}) === true);
    ok('by name ticket-', t.isTicketChannel({ isTextBased: () => true, topic: '', name: 'ticket-bob' }, {}) === true);
    ok('by name arabic', t.isTicketChannel({ isTextBased: () => true, topic: '', name: 'تكت-بوب' }, {}) === true);
    ok('normal channel', t.isTicketChannel({ isTextBased: () => true, topic: 'hi', name: 'general' }, {}) === false);
    ok('voice channel', t.isTicketChannel({ isTextBased: () => false, topic: '', name: 'general' }, {}) === false);
    ok('null', t.isTicketChannel(null, {}) === false);

    console.log('\n--- cleanOptions ---');
    ok('empty', t.cleanOptions(null).length === 0);
    ok('dedup keys',
        t.cleanOptions([{ label: 'A' }, { label: 'A' }, { label: 'B' }]).map(o => o.key).join(',') === 'a,a2,b',
        t.cleanOptions([{ label: 'A' }, { label: 'A' }, { label: 'B' }]).map(o => o.key).join(','));
    ok('max 25', t.cleanOptions(
        Array.from({ length: 40 }, (_, i) => ({ label: 'L' + i, key: 'k' + i }))
    ).length === 25);
    ok('suspended flag kept', t.cleanOptions([{ label: 'A', suspended: true }])[0].suspended === true);
    ok('staffOnly flag kept', t.cleanOptions([{ label: 'A', staffOnly: true }])[0].staffOnly === true);

    console.log('\n--- panelRows / ticketOptions ---');
    const s0 = { tickets: { options: [] } };
    ok('no options -> 1 row', t.panelRows(s0).length === 1);
    ok('no options -> 1 button', t.panelRows(s0)[0].toJSON().components.length === 1);
    const s12 = { tickets: { options: Array.from({ length: 12 }, (_, i) => ({ key: 'k' + i, label: 'L' + i })) } };
    ok('12 options -> 3 rows', t.panelRows(s12).length === 3);
    ok('12 options -> max 5 per row', t.panelRows(s12).every(r => r.toJSON().components.length <= 5));
    ok('25 options -> 5 rows', t.panelRows({
        tickets: { options: Array.from({ length: 25 }, (_, i) => ({ key: 'k' + i, label: 'L' + i })) }
    }).length === 5);
    ok('suspended option disabled',
        t.panelRows({ tickets: { options: [{ key: 'a', label: 'A', suspended: true }] } })[0]
            .toJSON().components[0].disabled === true);
    ok('filter blank labels',
        t.ticketOptions({ tickets: { options: [{ key: 'a', label: '  ' }, { key: 'b', label: 'B' }] } }).length === 1);

    console.log('\n=== ' + pass + ' passed, ' + fail + ' failed ===');
    process.exit(fail ? 1 : 0);
})();
