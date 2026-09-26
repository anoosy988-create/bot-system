const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    PermissionFlagsBits
} = require('discord.js');

const DEFAULT_TICKET_MESSAGE =
    'أهلاً بك 👋 اشرح مشكلتك وسيقوم الفريق بمساعدتك بأقرب وقت.';

// علامة تُكتب في موضوع قناة التكت حتى يتمكّن البوت من التعرّف عليها دائماً
// مهما كان اسم الروم (تكت-اسم، support-اسم، إلخ)
const TICKET_TOPIC_PREFIX = '🎫 تكت';

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

// آيدي صاحب التكت من موضوع القناة (الصيغة الجديدة بذكر<mension> والصيغة القديمة)
function ticketOwnerId(channel) {
    const topic = String(channel?.topic || '');

    const mention = topic.match(/<@!?(\d{15,21})>/);
    if (mention) return mention[1];

    // الصيغة القديمة:anoos.1234 | اسم الخيار
    const legacy = topic.match(/(\d{15,21})/);
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

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('ticket_close')
            .setLabel('إغلاق التكت')
            .setStyle(ButtonStyle.Danger)
            .setEmoji('🔒'),
        new ButtonBuilder()
            .setCustomId('ticket_claim')
            .setLabel('مطالبة / استلام')
            .setStyle(ButtonStyle.Primary)
            .setEmoji('🤝')
    );

    await channel.send({
        content: `<@${interaction.user.id}>${supportRole ? ' ' + supportRole.toString() : ''}`,
        embeds: [welcome],
        components: [row]
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
            }
        );

    return interaction.reply({ embeds: [e] });
}

// ======================================================
// BUTTON HANDLER
// ======================================================

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

    return false;
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
    handleSlash,
    handleSendPanel,
    sendPanelMessage,
    configureFromDashboard,
    cleanOptions,
    ticketOptions,
    panelRows,
    DEFAULT_TICKET_MESSAGE,
    DEFAULT_TICKET_OPTION,
    MAX_OPTIONS
};
