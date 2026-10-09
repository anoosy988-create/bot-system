const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    PermissionFlagsBits
} = require('discord.js');

const DEFAULT_TICKET_MESSAGE =
    'أهلاً بك 👋 اشرح مشكلتك وسيقوم الفريق بمساعدتك بأقرب وقت.';

// علامة تُكتب في موضوع قناة التكت حتى يتمكّن البوت من التعرّف عليها دائماً
// مهما كان اسم الروم (تكت-اسم، support-اسم، إلخ)
const TICKET_TOPIC_PREFIX = '🎫 تكت';

// فاصل يميز قائمة ":دعوت:" داخل الموضوع — نخزّن فيها اللي اتضافوا للتكت
const TOPIC_GUESTS_MARK = ':دعوت:';
const TOPIC_GUESTS_PREFIX = 'زوار:';

const DEFAULT_TICKET_OPTION = { key: 'general', label: 'تكت عام', description: '', emoji: '🎫', staffOnly: false };

// أقصى عدد خيارات (5 أزرار لكل صف × 5 صفوف)
const MAX_OPTIONS = 25;
const BUTTONS_PER_ROW = 5;

let client = null;
let deps = {};

function init(c, d) {
    client = c;
    deps = d || {};
}

// ======================================================
// HELPERS
// ======================================================

// خيارات التكت المضافة من الداشبورد (فارغة = زر واحد فقط)
function ticketOptions(settings) {
    const raw = settings?.tickets?.options;

    if (!Array.isArray(raw) || !raw.length) return [];

    return raw
        .filter(o => o && String(o.label || '').trim())
        .slice(0, MAX_OPTIONS)
        .map((o, i) => ({
            key: String(o.key || o.label || i).slice(0, 40),
            label: String(o.label).trim().slice(0, 80),
            description: String(o.description || '').slice(0, 100),
            emoji: String(o.emoji || '🎫').trim() || '🎫',
            staffOnly: !!o.staffOnly,
            // ⏸️ معلّق: يبقى بالأزرار معطّل — ما يفتح تكت
            suspended: !!o.suspended
        }));
}

function findOption(settings, key) {
    return ticketOptions(settings).find(o => o.key === key) || null;
}

// ======================================================
// كشف قنوات التكت (يعتمد على الموضوع + الاسم + الكاتقري)
// حتى لا يخطئ البوت ويقول "الأمر يشتغل داخل التكت" وهو داخله
// ======================================================
// آيدي صاحب التكت من موضوع القناة (الصيغة الجديدة بذكر <@> والصيغة القديمة)
function ticketOwnerId(channel) {
    const topic = String(channel?.topic || '');

    const mention = topic.match(/<@!?(\d{15,21})>/);

    // ⚠️ نقرا من أول الموضوع فقط — بعد ما نتجاوز كتلة ":دعوت:"
    // وإلا ممكن نرجع آيدي شخص مُضاف بدال صاحب التكت
    if (mention) return mention[1];

    const head = topic.split(TOPIC_GUESTS_MARK)[0];

    // الصيغة القديمة: anoos.1234 | اسم الخيار
    const legacy = head.match(/(\d{15,21})/);

    if (legacy) return legacy[1];

    return null;
}
// هل هذه القناة قناة تكت؟
function isTicketChannel(channel, settings) {
    if (!channel || !channel.isTextBased?.()) return false;

    const topic = String(channel.topic || '');
    if (topic.includes(TICKET_TOPIC_PREFIX)) return true;

    const name = String(channel.name || '').toLowerCase();
    if (name.startsWith('ticket-') || name.startsWith('تكت-')) return true;

    // قنوات التكت القديمة داخل الكاتقري المخصص
    const categoryId = settings?.tickets?.categoryId;
    if (categoryId && channel.parentId === categoryId) return true;

    // تكت قديم بدون علامة في الموضوع لكنه مملوك من عضو
    if (ticketOwnerId(channel)) return true;

    return false;
}

// تكتات العضو المفتوحة حالياً (لحساب الحد الأقصى)
function userOpenTickets(guild, userId, settings) {
    return guild.channels.cache.filter(
        c => isTicketChannel(c, settings) && ticketOwnerId(c) === String(userId)
    );
}

// بناء موضوع القناة مع علامة التكت وصاحبها
function buildTicketTopic(user, option) {
    return [
        TICKET_TOPIC_PREFIX,
        `<@${user.id}>`,
        option ? `| ${option.label}` : ''
    ].join(' ').trim();
}

// ======================================================
// إدارة الأشخاص داخل التكت (إضافة / طرد / عرض)
// ======================================================

// الصلاحيات اللي نعطيها لأي شخص يضاف للتكت
const GUEST_ALLOW = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.ReadMessageHistory,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.EmbedLinks
];

// يقرأ قائمة IDs الإضافيين من موضوع القناة
function topicGuestIds(channel) {
    const topic = String(channel?.topic || '');
    const marker = topic.indexOf(TOPIC_GUESTS_MARK);

    if (marker === -1) return [];

    const tail = topic.slice(marker + TOPIC_GUESTS_MARK.length);
    const stop = tail.indexOf('|');

    const block = (stop === -1 ? tail : tail.slice(0, stop))
        .replace(TOPIC_GUESTS_PREFIX, '')
        .trim();

    return block.match(/\d{15,21}/g) || [];
}

// يكتب قائمة الزوار في الموضوع بدون ما يكسر صيغة التكت
async function writeTopicGuests(channel, ids) {
    const topic = String(channel.topic || '');

    // نشيل أي كتلة زوار قديمة
    const marker = topic.indexOf(TOPIC_GUESTS_MARK);

    let base = marker === -1
        ? topic.trim()
        : (() => {
            const tail = topic.slice(marker + TOPIC_GUESTS_MARK.length);
            const stop = tail.indexOf('|');
            const rest = stop === -1 ? '' : tail.slice(stop);
            return (topic.slice(0, marker) + rest).trim();
        })();

    const clean = [...new Set(ids.map(String))].filter(Boolean);

    if (clean.length) {
        const block = `${TOPIC_GUESTS_MARK} ${TOPIC_GUESTS_PREFIX} ${clean.map(id => `<@${id}>`).join(' ')}`;
        base = base ? `${base} | ${block}` : block;
    }

    const next = base.slice(0, 1024);

    if (next === channel.topic) return;

    await channel.setTopic(next).catch(() => {});
}

// يبحث في كاش الأعضاء — يشتغل مع Collection و Map العادي
function searchCache(guild, predicate) {
    const cache = guild?.members?.cache;

    if (!cache) return null;

    if (typeof cache.find === 'function') return cache.find(predicate) || null;

    for (const m of cache.values()) {
        if (predicate(m)) return m;
    }

    return null;
}

// يبحث عن شخص بالسيرفر: يقبل منشن، آيدي، يوزرنيم، أو جزء منه
async function resolveTicketUser(guild, input) {    const raw = String(input || '').trim();

    if (!raw) return null;

    // 1) منشن أو آيدي
    const digits = raw.match(/\d{15,21}/);

    if (digits && typeof guild?.members?.fetch === 'function') {
        const byId = await guild.members.fetch(digits[0]).catch(() => null);
        if (byId) return byId;
    }

    const needle = raw.replace(/^<@!?|>$/g, '').toLowerCase();

    if (!needle) return null;

    // 2) تطابق بالضبط على اليوزرنيم / اللقب / الاسم الظاهر
    const exact = searchCache(guild, m =>
        m.user.username.toLowerCase() === needle ||
        m.user.tag.toLowerCase() === needle ||
        String(m.displayName || '').toLowerCase() === needle
    );

    if (exact) return exact;

    // 3) تطابق جزئي من الكاش
    const partial = searchCache(guild, m =>
        m.user.username.toLowerCase().includes(needle) ||
        m.user.tag.toLowerCase().includes(needle) ||
        String(m.displayName || '').toLowerCase().includes(needle)
    );

    if (partial) return partial;

    // 4) بحث من ديسكورد (الكاش ما يكفي لو السيرفر كبير)
    if (typeof guild?.members?.fetch !== 'function') return null;

    const fetched = await guild.members.fetch({ query: needle, limit: 10 }).catch(() => null);

    if (fetched?.members?.size) {
        for (const m of fetched.members.values()) {
            if (m.user.username.toLowerCase() === needle) return m;
        }

        return fetched.members.first() || null;
    }

    return null;
}

// هل هذا التفاعل من شخص يقدر يدير أهل التكت؟
// (فريق / دعم / صاحب التكت نفسه)
function canManageTicket(interaction, settings) {
    const t = settings.tickets || {};

    if (deps.isServerAdmin?.(interaction.member, interaction.guild)) return true;
    if (deps.memberHasStaffRole?.(interaction.member, interaction.guild)) return true;
    if (t.supportRoleId && interaction.member.roles.cache.has(t.supportRoleId)) return true;

    return interaction.user.id === ticketOwnerId(interaction.channel);
}

// إضافة شخص للتكت
async function addUserToTicket(interaction, member) {
    const ownerId = ticketOwnerId(interaction.channel);

    if (!ownerId) {
        return interaction.reply({
            content: '❌ ما قدرت أعرف صاحب هذا التكت من موضوع القناة — تأكد إن الموضوع موجود.',
            ephemeral: true
        });
    }

    if (String(member.id) === String(ownerId)) {
        return interaction.reply({
            content: 'ℹ️ هذا العضو **هو صاحب التكت** أصلاً — مافيش داعي تضيفه.',
            ephemeral: true
        });
    }

    if (member.id === interaction.user.id) {
        return interaction.reply({
            content: 'ℹ️ أنت أصلاً داخل التكت هذا.',
            ephemeral: true
        });
    }

    const channel = interaction.channel;
    const guests = topicGuestIds(channel);

    if (guests.includes(String(member.id))) {
        // نتأكد إن الصلاحيات موجودة فعلاً (قد تكون اتمسحت يدوياً)
        await channel.permissionOverwrites
            .create(member.id, { ViewChannel: true }, { reason: 'Ticket: re-add guest' })
            .catch(() => {});
    }

    await channel.permissionOverwrites.create(
        member.id,
        Object.fromEntries(GUEST_ALLOW.map(p => [p, true])),
        { reason: `Ticket: add ${member.user.username}` }
    );

    await writeTopicGuests(channel, [...guests, member.id]);

    await deps.sendLog?.(
        interaction.guild,
        'moderation',
        '🎫 Ticket User Added',
        `**${member}** أضيف للتكت <#${channel.id}> بواسطة ${interaction.user}.`,
        0x57F287
    );

    const mention = await channel
        .send(`${member} — تم إضافتك للتكت ✅`)
        .catch(() => null);

    if (mention) {
        await mention.delete().catch(() => {});
    }

    return interaction.reply({
        content: `✅ تم إضافة ${member} للتكت.\n👤 اليوزر: \`${member.user.username}\`\n🆔 الآيدي: \`${member.id}\``,
        ephemeral: true
    });
}

// طرد شخص من التكت
async function removeUserFromTicket(interaction, member) {
    const ownerId = ticketOwnerId(interaction.channel);
    const channel = interaction.channel;

    if (String(member.id) === String(ownerId)) {
        return interaction.reply({
            content: '❌ ما تقدر تطرد **صاحب التكت** — استخدم زر «إغلاق التكت» بدالها.',
            ephemeral: true
        });
    }

    const guests = topicGuestIds(channel);
    const inOverwrite = channel.permissionOverwrites.cache.has(member.id);

    if (!guests.includes(String(member.id)) && !inOverwrite) {
        return interaction.reply({
            content: `ℹ️ ${member} **مو داخل** هذا التكت أصلاً.`,
            ephemeral: true
        });
    }

    await channel.permissionOverwrites
        .delete(member.id, { reason: `Ticket: remove ${member.user.username}` })
        .catch(() => {});

    await writeTopicGuests(
        channel,
        guests.filter(id => String(id) !== String(member.id))
    );

    await deps.sendLog?.(
        interaction.guild,
        'moderation',
        '🎫 Ticket User Removed',
        `**${member}** انطرد من التكت <#${channel.id}> بواسطة ${interaction.user}.`,
        0xED4245
    );

    return interaction.reply({
        content: `✅ تم طرد ${member} من التكت.\n👤 اليوزر: \`${member.user.username}\`\n🆔 الآيدي: \`${member.id}\``,
        ephemeral: true
    });
}

// عرض كل اللي给他们 صلاحية داخل التكت
async function listTicketMembers(interaction) {
    const channel = interaction.channel;
    const ownerId = ticketOwnerId(channel);
    const settings = interaction.guild
        ? await deps.getSettings(interaction.guild.id)
        : null;
    const t = settings?.tickets || {};

    const members = [];

    if (ownerId) {
        const owner = await interaction.guild.members.fetch(ownerId).catch(() => null);
        if (owner) members.push({ member: owner, role: '👤 صاحب التكت' });
    }

    for (const id of topicGuestIds(channel)) {
        if (String(id) === String(ownerId)) continue;
        const m = await interaction.guild.members.fetch(id).catch(() => null);
        if (m) members.push({ member: m, role: '➕ مضاف' });
    }

    // رتبة الدعم كذلك
    if (t.supportRoleId) {
        const supportRole = interaction.guild.roles.cache.get(t.supportRoleId);

        if (supportRole) {
            for (const m of supportRole.members.values()) {
                if (members.some(x => String(x.member.id) === String(m.id))) continue;
                members.push({ member: m, role: '🛡️ دعم' });
            }
        }
    }

    // أي overwrite عضو موجود بس ما طلع من الموضوع (تمسحه يدوياً قبل)
    for (const overwrite of channel.permissionOverwrites.cache.values()) {
        if (overwrite.type !== 1) continue; // 1 = member
        if (members.some(x => String(x.member.id) === String(overwrite.id))) continue;
        const m = await interaction.guild.members.fetch(overwrite.id).catch(() => null);
        if (m) members.push({ member: m, role: '👥 صلاحية' });
    }

    const e = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle(`👥 أهل التكت`)
        .setDescription(
            members.length
                ? members
                    .slice(0, 25)
                    .map(x => `${x.role} — ${x.member} \`${x.member.user.username}\` \`${x.member.id}\``)
                    .join('\n')
                : 'ما فيه أحد تقدر يتكلم هنا غير صاحب التكت.'
        )
        .addFields({
            name: '📊 الإجمالي',
            value: `${members.length} شخص`,
            inline: true
        })
        .setTimestamp();

    return interaction.reply({ embeds: [e], ephemeral: true });
}

// زر التكت: customId = ticket_open أو ticket_open:<key>
// الخيار المعلق يبقى ظاهر بالأزرار بس معطّل (ما يفتح تكت)
function ticketButton(option) {
    const button = new ButtonBuilder()
        .setCustomId(option ? `ticket_open:${option.key}` : 'ticket_open')
        .setLabel(option ? (option.suspended ? `⏸️ ${option.label}` : option.label) : 'فتح تكت')
        .setStyle(option && option.staffOnly ? ButtonStyle.Secondary : ButtonStyle.Success);

    if (option && option.emoji) button.setEmoji(option.emoji);
    if (!option) button.setEmoji('🎫');
    if (option?.suspended) button.setDisabled(true);

    return button;
}

// اللوحة: صف زر لكل خيار (5 في الصف) أو زر واحد لو ما فيه خيارات
// الخيارات المعلّقة تظهر معطّلة — وما نفتح لها تكت
function panelRows(settings) {
    const options = ticketOptions(settings);

    if (!options.length) {
        return [new ActionRowBuilder().addComponents(ticketButton(null))];
    }

    const rows = [];

    for (let i = 0; i < options.length; i += BUTTONS_PER_ROW) {
        rows.push(
            new ActionRowBuilder().addComponents(
                options.slice(i, i + BUTTONS_PER_ROW).map(ticketButton)
            )
        );
    }

    return rows;
}

function channelNameFor(option, user) {
    if (!option) return `ticket-${user.username}`;

    const slug = String(option.key)
        .toLowerCase()
        .replace(/[^a-z0-9-_]/g, '')
        .slice(0, 24) || 'ticket';

    return `${slug}-${user.username}`.slice(0, 90);
}

async function sendPanelMessage(settings, guild, channelOverride) {
    if (!settings?.tickets?.enabled) return null;

    const targetId = channelOverride?.id || settings.tickets.panelChannelId;
    if (!targetId) return null;

    const channel = guild.channels.cache.get(targetId);
    if (!channel || !channel.isTextBased()) return null;

    const t = settings.tickets;
    const options = ticketOptions(settings);

    const pEmbed = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('🎫 نظام التكتات')
        .setDescription(t.welcomeMessage || DEFAULT_TICKET_MESSAGE)
        .setFooter({ text: guild.name })
        .setTimestamp();

    if (t.panelImage) pEmbed.setImage(t.panelImage);

    if (options.length) {
        pEmbed.addFields(
            {
                name: '🗂️ أنواع التكت',
                value: options
                    .map(o => `${o.emoji} **${o.label}**${o.suspended ? ' ⏸️ *معلّق*' : ''}`)
                    .join('\n')
                    .slice(0, 1024)
            }
        );
    }

    const sent = await channel.send({
        embeds: [pEmbed],
        components: panelRows(settings)
    });

    if (sent?.id) {
        t.panelMessageId = sent.id;
        try {
            if (typeof settings.save === 'function') await settings.save();
        } catch {}
    }

    return sent;
}

// فتح تكت جديد لعضو
async function openTicket(interaction) {
    const settings = await deps.getSettings(interaction.guild.id);
    const t = settings.tickets;

    if (!t?.enabled) {
        return interaction.reply({
            content: '❌ نظام التكتات معطل في هذا السيرفر.',
            ephemeral: true
        });
    }

    // الخيار المختار من الزر (ticket_open:<key>)
    const rawId = String(interaction.customId || 'ticket_open');
    const parts = rawId.split(':');
    const option = parts.length > 1 ? findOption(settings, parts[1]) : null;

    if (parts.length > 1 && !option) {
        return interaction.reply({
            content: '❌ هذا الخيار لم يعد موجوداً في الإعدادات.',
            ephemeral: true
        });
    }

    // ⏸️ الخيار معلّق: ما يفتح تكت حتى يرجع فعّال
    if (option?.suspended) {
        return interaction.reply({
            content: `⏸️ هذا الخيار (**${option.label}**) معلّق مؤقتاً — الفريق يفعّله من الداشبورد أو \`/ticket option\`.`,
            ephemeral: true
        });
    }

    if (option?.staffOnly) {
        const isSupport =
            deps.memberHasStaffRole?.(interaction.member, interaction.guild) ||
            deps.isServerAdmin?.(interaction.member, interaction.guild) ||
            (t.supportRoleId && interaction.member.roles.cache.has(t.supportRoleId));

        if (!isSupport) {
            return interaction.reply({
                content: '❌ هذا التكت مخصص للفريق فقط.',
                ephemeral: true
            });
        }
    }

    const maxPerUser = Math.max(1, Number(t.maxPerUser) || 1);
    const own = userOpenTickets(interaction.guild, interaction.user.id, settings);

    if (own.size >= maxPerUser) {
        return interaction.reply({
            content: `❌ الحد المسموح لك **${maxPerUser}** تكت مفتوح. استعمل تكتك الحالي أو اطلب من الفريق حذفه.`,
            ephemeral: true
        });
    }

    const supportRole = t.supportRoleId ? interaction.guild.roles.cache.get(t.supportRoleId) : null;

    const overwrites = [
        {
            id: interaction.guild.id,
            deny: [PermissionFlagsBits.ViewChannel]
        },
        {
            id: interaction.user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks
            ]
        }
    ];

    if (supportRole) {
        overwrites.push({
            id: supportRole.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.ManageChannels
            ]
        });
    }

    const category = t.categoryId
        ? interaction.guild.channels.cache.get(t.categoryId)
        : null;

    const channel = await interaction.guild.channels.create({
        name: channelNameFor(option, interaction.user),
        type: ChannelType.GuildText,
        parent: category?.type === ChannelType.GuildCategory ? category.id : undefined,
        topic: buildTicketTopic(interaction.user, option),
        permissionOverwrites: overwrites,
        reason: 'Cypher Ticket'
    });

    const welcome = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('🎫 تكت جديد')
        .setDescription(t.welcomeMessage || DEFAULT_TICKET_MESSAGE)
        .addFields(
            { name: '👤 صاحب التكت', value: interaction.user.toString(), inline: true },
            { name: '🆔 الآيدي', value: interaction.user.id, inline: true }
        )
        .setTimestamp();

    if (option) {
        welcome.addFields({
            name: '🗂️ نوع التكت',
            value: `${option.emoji} **${option.label}**${option.description ? `\n${option.description}` : ''}`,
            inline: false
        });
    }

    if (t.welcomeImage) welcome.setImage(t.welcomeImage);

    welcome.addFields({
        name: '👥 المضافون للتكت',
        value: 'ما فيه أحد بعد — استخدم زر **➕ إضافة شخص** تحت.',
        inline: false
    });

    // صف ١: إدارة أهل التكت
    // صف ٢: المطالبة والإغلاق
    const manageRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ticket_add_user')
            .setLabel('إضافة شخص')
            .setStyle(ButtonStyle.Success)
            .setEmoji('➕'),
        new ButtonBuilder()
            .setCustomId('ticket_remove_user')
            .setLabel('طرد شخص')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('➖'),
        new ButtonBuilder()
            .setCustomId('ticket_list_members')
            .setLabel('عرض الأشخاص')
            .setStyle(ButtonStyle.Secondary)
            .setEmoji('👥')
    );

    const controlRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ticket_claim')
            .setLabel('مطالبة / استلام')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🤝'),
        new ButtonBuilder()
            .setCustomId('ticket_close')
            .setLabel('إغلاق التكت')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🔒')
    );

    await channel.send({
        content: `<@${interaction.user.id}>${supportRole ? ' ' + supportRole.toString() : ''}`,
        embeds: [welcome],
        components: [manageRow, controlRow]
    });

    await deps.sendLog(
        interaction.guild,
        'moderation',
        '🎫 Ticket Opened',
        `**${interaction.user}** فتح تكت${option ? ` (${option.label})` : ''}: <#${channel.id}>`,
        0x57F287
    );

    return interaction.reply({
        content: `✅ تم فتح تكتك: <#${channel.id}>`,
        ephemeral: true
    });
}

// إغلاق تكت
async function closeTicket(interaction) {
    const settings = await deps.getSettings(interaction.guild.id);
    const t = settings.tickets;

    if (!isTicketChannel(interaction.channel, settings)) {
        return interaction.reply({
            content: '❌ هذا الزر يعمل داخل قناة تكت فقط.',
            ephemeral: true
        });
    }

    const isSupport =
        deps.memberHasStaffRole?.(interaction.member, interaction.guild) ||
        deps.isServerAdmin?.(interaction.member, interaction.guild) ||
        (t?.supportRoleId && interaction.member.roles.cache.has(t.supportRoleId)) ||
        interaction.user.id === String(interaction.guild.ownerId);

    const openerId = ticketOwnerId(interaction.channel);

    if (!isSupport && interaction.user.id !== openerId) {
        return interaction.reply({
            content: '❌ لا تملك صلاحية إغلاق هذا التكت.',
            ephemeral: true
        });
    }

    await interaction.reply({
        content: '🔒 جاري إغلاق التكت...',
        ephemeral: true
    });

    await deps.sendLog(
        interaction.guild,
        'moderation',
        '🔒 Ticket Closed',
        `تم إغلاق تكت **${interaction.channel.name}** بواسطة ${interaction.user}.\n` +
        `المالك: ${openerId ? `<@${openerId}>` : 'غير معروف'}`,
        0xED4245
    );

    await new Promise(r => setTimeout(r, 2000));
    await interaction.channel.delete('Ticket closed').catch(() => {});
}

// مطالبة التكت
async function claimTicket(interaction) {
    const settings = await deps.getSettings(interaction.guild.id);

    if (!isTicketChannel(interaction.channel, settings)) {
        return interaction.reply({
            content: '❌ هذا الزر يعمل داخل قناة تكت فقط.',
            ephemeral: true
        });
    }

    const isSupport =
        deps.memberHasStaffRole?.(interaction.member, interaction.guild) ||
        deps.isServerAdmin?.(interaction.member, interaction.guild) ||
        (settings.tickets?.supportRoleId && interaction.member.roles.cache.has(settings.tickets.supportRoleId));

    if (!isSupport) {
        return interaction.reply({
            content: '❌ الرتبة المخولة فقط تقدر تطالب بالتكت.',
            ephemeral: true
        });
    }

    // حفظ اسم من استلم التكت في موضوع القناة
    const topic = String(interaction.channel.topic || '')
        .replace(/\s*\|\s*مطالب به:.*$/u, '')
        .trim();

    await interaction.channel.setTopic(`${topic} | مطالب به: ${interaction.user.username}`.slice(0, 1024)).catch(() => {});

    const claimed = new EmbedBuilder()
        .setColor(0xFEE75C)
        .setTitle('🤝 تمت المطالبة')
        .setDescription(`**${interaction.member}** استلم هذا التكت.`)
        .setTimestamp();

    await interaction.reply({ embeds: [claimed] });
}

// ======================================================
// SLASH COMMAND: /ticket
// ======================================================

// نشر اللوحة بروم محدد — تستخدمها /ticket send و /set-ticket
async function handleSendPanel(interaction, channel) {
    const settings = await deps.getSettings(interaction.guild.id);

    if (!settings.tickets?.enabled) {
        return interaction.reply({
            content: '❌ نظام التكتات معطل.\nفعّله من الداشبورد أو بـ /ticket setup أولاً.',
            ephemeral: true
        });
    }

    if (!channel?.isTextBased()) {
        return interaction.reply({
            content: '❌ اختر روم نصي صحيح.',
            ephemeral: true
        });
    }

    const sent = await sendPanelMessage(settings, interaction.guild, channel)
        .catch(() => null);

    if (!sent) {
        return interaction.reply({
            content: '❌ تعذر إرسال اللوحة — تأكد من صلاحيات البوت في الروم.',
            ephemeral: true
        });
    }

    return interaction.reply({
        content: `✅ تم نشر لوحة التكتات في <#${sent.channelId}>.\n${
            ticketOptions(settings).length
                ? 'الأزرار ظاهرة تحت الرسالة.'
                : '⚠️ لا توجد خيارات — زِد خيارات التكت من الداشبورد.'
        }`,
        ephemeral: true
    });
}

async function handleSlash(interaction) {
    const sub = interaction.options.getSubcommand();
    const settings = await deps.getSettings(interaction.guild.id);

    // ⚠️ لازم نقرا subgroup قبل sub — وإلا صار /ticket image set
    // يختلط مع /ticket set
    const group = interaction.options.getSubcommandGroup
        ? interaction.options.getSubcommandGroup()
        : null;

    // ======================================================
    // /ticket image set | panel | remove
    // ======================================================
    if (group === 'image') {

        const canEdit =
            deps.isServerAdmin?.(interaction.member, interaction.guild) ||
            deps.memberHasStaffRole?.(interaction.member, interaction.guild) ||
            (settings.tickets?.supportRoleId &&
                interaction.member.roles.cache.has(settings.tickets.supportRoleId)) ||
            interaction.user.id === String(interaction.guild.ownerId);

        if (!canEdit) {
            return interaction.reply({
                content: '❌ رتبة الدعم فقط تقدر تغيّر صور التكتات.',
                ephemeral: true
            });
        }

        if (sub === 'remove') {
            settings.tickets.welcomeImage = null;
            settings.tickets.panelImage = null;
            await settings.save();

            return interaction.reply({
                content: '🗑️ تم حذف صور التكتات (صورة الإيمبد + صورة اللوحة).',
                ephemeral: true
            });
        }

        const target = sub === 'panel' ? 'panelImage' : 'welcomeImage';
        const url = interaction.options.getString('url');
        const file = interaction.options.getAttachment('file');

        if (url && file) {
            return interaction.reply({
                content: '❌ اختر **واحد فقط**: `url` أو `file` — مو الاثنين.',
                ephemeral: true
            });
        }

        if (!url && !file) {
            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setColor(0x5865F2)
                        .setTitle('🖼️ صور التكتات')
                        .addFields(
                            {
                                name: 'صورة الإيمبد داخل التكت',
                                value: settings.tickets.welcomeImage
                                    ? String(settings.tickets.welcomeImage).slice(0, 1024)
                                    : '❌ ما فيه صورة',
                                inline: false
                            },
                            {
                                name: 'صورة لوحة التكتات',
                                value: settings.tickets.panelImage
                                    ? String(settings.tickets.panelImage).slice(0, 1024)
                                    : '❌ ما فيه صورة',
                                inline: false
                            }
                        )
                        .setFooter({
                            text: 'التعيين: /ticket image set file:📎 أو /ticket image panel file:📎'
                        })
                ],
                ephemeral: true
            });
        }

        let stored;

        if (url) {
            const clean = String(url).trim();

            if (!/^https?:\/\//i.test(clean) || !/\.(png|jpe?g|gif|webp)(\?|#|$)/i.test(clean)) {
                return interaction.reply({
                    content: '❌ لازم رابط مباشر لصورة يبدأ بـ `http(s)://` وينتهي بـ `.png` أو `.jpg` أو `.gif` أو `.webp`',
                    ephemeral: true
                });
            }

            stored = clean;
        } else {
            if (!String(file.contentType || '').startsWith('image/')) {
                return interaction.reply({
                    content: `❌ المرفق مو صورة (نوعه: \`${file.contentType || 'غير معروف'}\`).`,
                    ephemeral: true
                });
            }

            if (Number(file.size) > 8 * 1024 * 1024) {
                return interaction.reply({
                    content: `❌ الصورة كبيرة (${(file.size / 1048576).toFixed(1)}MB) — الحد **8MB**.`,
                    ephemeral: true
                });
            }

            stored = file.url;
        }

        settings.tickets[target] = stored;
        await settings.save();

        const label = target === 'panelImage' ? 'صورة اللوحة' : 'صورة الإيمبد داخل التكت';

        // لو ضبّطنا صورة اللوحة نرسلها فوراً
        if (target === 'panelImage' && settings.tickets.panelChannelId) {
            const sent = await sendPanelMessage(settings, interaction.guild).catch(() => null);

            return interaction.reply({
                content: sent
                    ? `✅ تم حفظ ${label} ورُسلت اللوحة المحدّثة في <#${sent.channelId}>.`
                    : `✅ تم حفظ ${label}.\n⚠️ ما قدرت أرسل اللوحة — تأكد من صلاحيات البوت في روم اللوحة.`,
                ephemeral: true
            });
        }

        return interaction.reply({
            content:
                `✅ تم حفظ ${label}.\n` +
                (target === 'welcomeImage'
                    ? '📤 بتظهر تلقائياً في إيمبد أول رسالة داخل كل تكت جديد.'
                    : '📤 استخدم `/ticket send` لتحديث اللونة في روم اللوحة.'),
            ephemeral: true
        });
    }

    // ======================================================
    // /ticket add | remove | members
    // ======================================================
    if (sub === 'add' || sub === 'remove' || sub === 'members') {

        if (!isTicketChannel(interaction.channel, settings)) {
            return interaction.reply({
                content:
                    '❌ هذا الأمر يشتغل **داخل قناة التكت** فقط.\n' +
                    '💡 افتح التكت اللي تبي تضيف فيه شخص وشغّل الأمر من جوّاها.',
                ephemeral: true
            });
        }

        if (sub === 'members') {
            await listTicketMembers(interaction);
            return true;
        }

        if (!canManageTicket(interaction, settings)) {
            return interaction.reply({
                content: '❌ رتبة الدعم فقط (أو صاحب التكت) تقدر تضيف أو تطرد أشخاص.',
                ephemeral: true
            });
        }

        const target = interaction.options.getUser('user');
        const member = await interaction.guild.members.fetch(target.id).catch(() => null);

        if (!member) {
            return interaction.reply({
                content: `❌ العضو \`${target.username}\` مو موجود في السيرفر.`,
                ephemeral: true
            });
        }

        if (sub === 'add') {
            await addUserToTicket(interaction, member);
        } else {
            await removeUserFromTicket(interaction, member);
        }

        return true;
    }

    if (sub === 'setup') {
        const channel = interaction.options.getChannel('channel');
        const category = interaction.options.getChannel('category');
        const role = interaction.options.getRole('role');
        const logChannel = interaction.options.getChannel('log_channel');
        const message = interaction.options.getString('message');

        const current = settings.tickets || {};

        settings.tickets = {
            ...current,
            enabled: true,
            panelChannelId: channel.id,
            categoryId: category?.type === ChannelType.GuildCategory ? category.id : null,
            supportRoleId: role?.id || null,
            logChannelId: logChannel?.id || null,
            welcomeMessage: message || current.welcomeMessage || DEFAULT_TICKET_MESSAGE,
            panelMessageId: null,
            options: Array.isArray(current.options) ? current.options : []
        };

        await settings.save();

        await sendPanelMessage(settings, interaction.guild);

        return interaction.reply({
            content:
                '✅ تم تفعيل نظام التكتات وإرسال اللوحة بنجاح.\n' +
                '💡 أضف خيارات التكتات (أنواعها) من الداشبورد أو بـ /ticket option.\n' +
                (category?.type === ChannelType.GuildCategory ? '' : '\n⚠️ الكاتقري غير صحيح — التكتات ستُفتح خارج أي كاتقري.'),
            ephemeral: true
        });
    }

    if (sub === 'send' || sub === 'panel') {
        const channel = interaction.options.getChannel('channel');

        return handleSendPanel(interaction, channel);
    }

    if (sub === 'option') {
        const mode = interaction.options.getString('mode');
        const key = interaction.options.getString('key');
        const label = interaction.options.getString('label');
        const description = interaction.options.getString('description');
        const emoji = interaction.options.getString('emoji');
        const state = interaction.options.getString('state');

        const current = settings.tickets || {};
        const options = Array.isArray(current.options) ? current.options.slice() : [];

        if (mode === 'remove') {
            if (!key) {
                return interaction.reply({ content: '❌حدد مفتاح الخيار المراد حذفه.', ephemeral: true });
            }

            const next = options.filter(o => o.key !== key);
            settings.tickets = { ...current, options: next };
            await settings.save();

            return interaction.reply({
                content: next.length === options.length
                    ? '❌ ما لقيت خيار بهذا المفتاح.'
                    : `✅ تم حذف الخيار (${next.length} خيار متبقي).`,
                ephemeral: true
            });
        }

        // ⏸️ تعليق / تفعيل خيار موجود (بالـ key)
        if (mode === 'state') {
            if (!key) {
                return interaction.reply({
                    content: '❌ حدد `key` الخيار اللي تبي تعلّقه أو تفعّله.',
                    ephemeral: true
                });
            }

            const index = options.findIndex(o => o.key === key);
            if (index === -1) {
                return interaction.reply({ content: '❌ ما لقيت خيار بهذا المفتاح.', ephemeral: true });
            }

            const suspended = state === 'suspended';
            options[index] = {
                ...options[index],
                suspended,
                label: label ? String(label).slice(0, 80) : options[index].label,
                description: description !== null && description !== undefined
                    ? String(description).slice(0, 100)
                    : options[index].description,
                emoji: emoji ? String(emoji).slice(0, 4) : options[index].emoji
            };

            settings.tickets = { ...current, options };
            await settings.save();

            return interaction.reply({
                content: suspended
                    ? `⏸️ تم تعليق الخيار **${options[index].label}** — الزر يبان باللوحة بس معطّل.\n📤 استخدم /ticket send لتحديث اللوحة.`
                    : `✅ تم تفعيل الخيار **${options[index].label}**.\n📤 استخدم /ticket send لتحديث اللوحة.`,
                ephemeral: true
            });
        }

        if (!label) {
            return interaction.reply({ content: '❌ اسم الخيار مطلوب.', ephemeral: true });
        }

        const finalKey = String(key || label).toLowerCase().replace(/[^a-z0-9]/g, '') || `opt${options.length + 1}`;

        if (options.some(o => o.key === finalKey)) {
            return interaction.reply({ content: '❌ يوجد خيار بنفس المفتاح.', ephemeral: true });
        }

        if (options.length >= MAX_OPTIONS) {
            return interaction.reply({ content: `❌ أقصى عدد خيارات **${MAX_OPTIONS}**.`, ephemeral: true });
        }

        const suspended = state === 'suspended';

        options.push({
            key: finalKey.slice(0, 40),
            label: String(label).slice(0, 80),
            description: String(description || '').slice(0, 100),
            emoji: String(emoji || '🎫').slice(0, 4),
            staffOnly: false,
            suspended
        });

        settings.tickets = {
            ...current,
            enabled: true,
            options
        };

        await settings.save();

        return interaction.reply({
            content:
                `✅ تم إضافة الخيار **${label}** (المفتاح: \`${finalKey}\`)${suspended ? ' — ⏸️ **معلّق**' : ''}.\n` +
                (settings.tickets.panelChannelId
                    ? '📤 استخدم /ticket send لنشر اللوحة.'
                    : '⚠️ حدّد روم اللوحة بـ /ticket setup أو من الداشبورد.'),
            ephemeral: true
        });
    }

    if (sub === 'disable') {
        settings.tickets = {
            enabled: false,
            panelChannelId: null,
            categoryId: null,
            supportRoleId: null,
            logChannelId: null,
            welcomeMessage: DEFAULT_TICKET_MESSAGE,
            panelImage: null,
            welcomeImage: null,
            panelMessageId: null,
            maxPerUser: 1,
            options: []
        };

        await settings.save();

        return interaction.reply({
            content: '🚫 تم إيقاف نظام التكتات.',
            ephemeral: true
        });
    }

    const t = settings.tickets || {};
    const options = ticketOptions(settings);

    const e = new EmbedBuilder()
        .setColor(0xED4245)
        .setTitle('🎫 حالة نظام التكتات')
        .addFields(
            { name: 'الحالة', value: t.enabled ? '✅ مفعّل' : '❌ معطل', inline: true },
            { name: 'لوحة التكتات', value: t.panelChannelId ? `<#${t.panelChannelId}>` : 'غير محددة', inline: true },
            { name: 'الكاتقري', value: t.categoryId ? `<#${t.categoryId}>` : 'غير محددة', inline: true },
            { name: 'رتبة الدعم', value: t.supportRoleId ? `<@&${t.supportRoleId}>` : 'غير محددة', inline: true },
            {
                name: '🗂️ الخيارات',
                value: options.length
                    ? options.map(o => `${o.emoji} \`${o.key}\` — ${o.label}${o.suspended ? ' ⏸️ معلّق' : ''}`).join('\n').slice(0, 1024)
                    : 'لا توجد خيارات (سيظهر زر واحد)',
                inline: false
            },
            {
                name: '🖼️ الصور',
                value:
                    `صورة الإيمبد: ${t.welcomeImage ? '✅ مضبوطة' : '❌ ما فيه'}\n` +
                    `صورة اللوحة: ${t.panelImage ? '✅ مضبوطة' : '❌ ما فيه'}`,
                inline: true
            }
        )
        .setFooter({
            text: 'إدارة أهل التكت: /ticket add · /ticket remove · /ticket members'
        });

    return interaction.reply({ embeds: [e], ephemeral: true });
}

// ======================================================
// BUTTON HANDLER
// ======================================================

// يحوّل المستخدم لنوع العملية المطلوبة (إضافة أو طرد)
const MEMBER_MODALS = {
    ticket_add_user: { mode: 'add', title: '➕ إضافة شخص للتكت', color: ButtonStyle.Success },
    ticket_remove_user: { mode: 'remove', title: '➖ طرد شخص من التكت', color: ButtonStyle.Danger }
};

// يفتح مودال يطلب اليوزر/الآيدي
function openMemberModal(interaction, config) {
    const input = new TextInputBuilder()
        .setCustomId('member_input')
        .setLabel('اليوزرنيم أو الآيدي')
        .setPlaceholder('مثال: anoos  أو  123456789012345678')
        .setStyle(TextInputStyle.Short)
        .setMinLength(2)
        .setMaxLength(80)
        .setRequired(true);

    const modal = new ModalBuilder()
        .setCustomId(config.mode === 'add' ? 'ticket_add_user_submit' : 'ticket_remove_user_submit')
        .setTitle(config.title)
        .addComponents(new ActionRowBuilder().addComponents(input));

    return interaction.showModal(modal);
}

async function handleButton(interaction) {
    if (!interaction.isButton()) return false;

    if (interaction.customId === 'ticket_open' || interaction.customId.startsWith('ticket_open:')) {
        await openTicket(interaction);
        return true;
    }

    if (interaction.customId === 'ticket_close') {
        await closeTicket(interaction);
        return true;
    }

    if (interaction.customId === 'ticket_claim') {
        await claimTicket(interaction);
        return true;
    }

    if (MEMBER_MODALS[interaction.customId]) {
        const settings = await deps.getSettings(interaction.guild.id);

        if (!isTicketChannel(interaction.channel, settings)) {
            return interaction.reply({
                content: '❌ هذا الزر يعمل داخل قناة تكت فقط.',
                ephemeral: true
            });
        }

        if (!canManageTicket(interaction, settings)) {
            return interaction.reply({
                content: '❌ رتبة الدعم فقط (أو صاحب التكت) تقدر تدير أهل التكت.',
                ephemeral: true
            });
        }

        await openMemberModal(interaction, MEMBER_MODALS[interaction.customId]);
        return true;
    }

    if (interaction.customId === 'ticket_list_members') {
        const settings = await deps.getSettings(interaction.guild.id);

        if (!isTicketChannel(interaction.channel, settings)) {
            return interaction.reply({
                content: '❌ هذا الزر يعمل داخل قناة تكت فقط.',
                ephemeral: true
            });
        }

        await listTicketMembers(interaction);
        return true;
    }

    return false;
}

// ======================================================
// MODAL HANDLER — إضافة / طرد باليوزرنيم
// ======================================================

async function handleModal(interaction) {
    if (!interaction.isModalSubmit()) return false;

    const isAdd = interaction.customId === 'ticket_add_user_submit';
    const isRemove = interaction.customId === 'ticket_remove_user_submit';

    if (!isAdd && !isRemove) return false;

    const settings = await deps.getSettings(interaction.guild.id);

    if (!isTicketChannel(interaction.channel, settings)) {
        return interaction.reply({
            content: '❌ هذي العملية تشتغل داخل قناة تكت فقط.',
            ephemeral: true
        });
    }

    if (!canManageTicket(interaction, settings)) {
        return interaction.reply({
            content: '❌ رتبة الدعم فقط (أو صاحب التكت) تقدر تدير أهل التكت.',
            ephemeral: true
        });
    }

    const raw = interaction.fields.getTextInputValue('member_input');
    const member = await resolveTicketUser(interaction.guild, raw);

    if (!member) {
        return interaction.reply({
            embeds: [
                new EmbedBuilder()
                    .setColor(0xED4245)
                    .setTitle(isAdd ? '➕ إضافة شخص للتكت' : '➖ طرد شخص من التكت')
                    .setDescription(
                        `ما لقيت أي عضو بهيئة \`${String(raw).slice(0, 200)}\`.`
                    )
                    .addFields({
                        name: '💡 تأكد من',
                        value:
                            '• اليوزرنيم صحيح (مثال: `anoos`)\n' +
                            '• أو استخدم الآيدي: `123456789012345678`\n' +
                            '• أو انسخ منشن العضو من ديسكورد والصقه هنا'
                    })
            ],
            ephemeral: true
        });
    }

    if (isAdd) {
        await addUserToTicket(interaction, member);
    } else {
        await removeUserFromTicket(interaction, member);
    }

    return true;
}

// ======================================================
// DASHBOARD HELPERS (تستخدم من الداشبورد)
// ======================================================

function cleanOptions(list) {
    if (!Array.isArray(list)) return [];

    const seen = new Set();

    return list
        .filter(o => o && String(o.label || '').trim())
        .slice(0, MAX_OPTIONS)
        .map((o, i) => {
            const label = String(o.label).trim().slice(0, 80);
            let key = String(o.key || label)
                .toLowerCase()
                .replace(/[^a-z0-9-]/g, '')
                .slice(0, 24);

            if (!key) key = `opt${i + 1}`;
            if (seen.has(key)) key = `${key}${i + 1}`;
            seen.add(key);

            return {
                key,
                label,
                description: String(o.description || '').slice(0, 100),
                emoji: String(o.emoji || '🎫').trim().slice(0, 4) || '🎫',
                staffOnly: !!o.staffOnly,
                suspended: !!o.suspended
            };
        });
}

async function configureFromDashboard(settings, data, guild) {
    const current = settings.tickets || {};

    settings.tickets = {
        enabled: data.enabled !== undefined ? !!data.enabled : current.enabled,
        panelChannelId: data.panelChannelId !== undefined ? (data.panelChannelId || null) : (current.panelChannelId || null),
        categoryId: data.categoryId !== undefined ? (data.categoryId || null) : (current.categoryId || null),
        supportRoleId: data.supportRoleId !== undefined ? (data.supportRoleId || null) : (current.supportRoleId || null),
        logChannelId: data.logChannelId !== undefined ? (data.logChannelId || null) : (current.logChannelId || null),
        welcomeMessage: data.welcomeMessage !== undefined
            ? (data.welcomeMessage || DEFAULT_TICKET_MESSAGE)
            : (current.welcomeMessage || DEFAULT_TICKET_MESSAGE),
        panelImage: data.panelImage !== undefined ? (data.panelImage || null) : (current.panelImage || null),
        welcomeImage: data.welcomeImage !== undefined ? (data.welcomeImage || null) : (current.welcomeImage || null),
        panelMessageId: current.panelMessageId || null,
        maxPerUser: data.maxPerUser !== undefined
            ? Math.max(1, Number(data.maxPerUser) || 1)
            : (Math.max(1, Number(current.maxPerUser) || 1)),
        options: data.options !== undefined
            ? cleanOptions(data.options)
            : cleanOptions(current.options)
    };

    await settings.save();

    if (settings.tickets.enabled && data.sendPanel && guild) {
        await sendPanelMessage(settings, guild);
    }

    return settings.tickets;
}

module.exports = {
    init,
    handleButton,
    handleModal,
    handleSlash,
    handleSendPanel,
    sendPanelMessage,
    configureFromDashboard,
    cleanOptions,
    ticketOptions,
    panelRows,
    topicGuestIds,
    resolveTicketUser,
    isTicketChannel,
    ticketOwnerId,
    DEFAULT_TICKET_MESSAGE,
    DEFAULT_TICKET_OPTION,
    MAX_OPTIONS
};
