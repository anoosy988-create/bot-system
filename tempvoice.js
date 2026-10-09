const mongoose = require('mongoose');
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelType,
    PermissionFlagsBits
} = require('discord.js');

// ======================================================
// TEMP VOICE — رومات صوتية مؤقتة (انضمّ → ينصنع لك روم)
// - تنحذف تلقائياً لما تفضى
// - لوحة تحكم لصاحب الروم: قفل/فتح/اسم/طرد/حد/AFK
// - /tempvoice setup | panel
// ======================================================

let client = null;
let deps = {};

const tvSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true, unique: true },
    ownerId: { type: String, required: true },
    createdAt: { type: Date, default: Date.now }
});

const TempVoice = mongoose.models.TempVoice
    || mongoose.model('TempVoice', tvSchema);

// رومات قيد الإنشاء لمنع التكرار السريع
const creating = new Set();

function init(c, d) {
    client = c;
    deps = d || {};
}

function getSettingsSafe(guildId) {
    try {
        return deps.getSettings ? deps.getSettings(guildId) : null;
    } catch {
        return null;
    }
}

function log(guild, title, description) {
    try {
        if (deps.sendLog) deps.sendLog(guild, 'moderation', title, description);
    } catch {}
}

function allowed(interaction) {
    try {
        return deps.isAllowed ? deps.isAllowed(interaction) : false;
    } catch {
        return false;
    }
}

// ======================================================
// VOICE STATE
// ======================================================

async function handleVoiceState(oldState, newState) {
    try {
        const guild = newState.guild || oldState.guild;
        if (!guild) return;

        const settings = await getSettingsSafe(guild.id);
        const creatorId = settings?.voice?.creatorChannelId;

        // 1) انضم للروم المنشئ → أنشئ روم مؤقت
        if (
            creatorId &&
            newState.channelId === creatorId &&
            oldState.channelId !== creatorId &&
            newState.member &&
            !creating.has(`${guild.id}:${newState.member.id}`)
        ) {
            const creator = guild.channels.cache.get(creatorId);
            const me = guild.members.me;
            if (!creator || !me) return;

            const parent = settings?.voice?.categoryId
                || creator.parentId
                || null;

            creating.add(`${guild.id}:${newState.member.id}`);

            try {
                const name = String(settings?.voice?.nameTemplate || '🔊 {user}')
                    .replace('{user}', newState.member.user.username)
                    .slice(0, 90);

                const channel = await guild.channels.create({
                    name,
                    type: ChannelType.GuildVoice,
                    parent,
                    reason: '[TempVoice] روم مؤقت',
                    permissionOverwrites: [
                        {
                            id: newState.member.id,
                            allow: [
                                PermissionFlagsBits.ManageChannels,
                                PermissionFlagsBits.MoveMembers,
                                PermissionFlagsBits.MuteMembers
                            ]
                        }
                    ]
                });

                await TempVoice.create({
                    guildId: guild.id,
                    channelId: channel.id,
                    ownerId: newState.member.id
                });

                await newState.member.voice.setChannel(channel, '[TempVoice] نقل للروم المؤقت')
                    .catch(() => {});
            } catch (error) {
                console.error('[TEMPVC] فشل الإنشاء:', error?.message || error);
            } finally {
                creating.delete(`${guild.id}:${newState.member.id}`);
            }

            return;
        }

        // 2) خرج من روم مؤقت → احذفه إذا فاضي
        if (oldState.channelId && oldState.channelId !== newState.channelId) {
            const doc = await TempVoice.findOne({
                guildId: guild.id,
                channelId: oldState.channelId
            }).lean();

            if (doc) {
                const channel = guild.channels.cache.get(doc.channelId);

                if (!channel) {
                    await TempVoice.deleteOne({ _id: doc._id }).catch(() => {});
                } else if (channel.members.size === 0) {
                    await channel.delete('[TempVoice] الروم فضي').catch(() => {});
                    await TempVoice.deleteOne({ _id: doc._id }).catch(() => {});
                    log(guild, '🔊 Temp Voice Deleted', `انحذف الروم المؤقت <#${doc.channelId}> (فضي).`);
                }
            }
        }
    } catch (error) {
        console.error('[TEMPVC] خطأ voiceState:', error?.message || error);
    }
}

// ======================================================
// SLASH
// ======================================================

async function handleSlash(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (!allowed(interaction)) {
        return interaction.reply({
            content: '❌ ما عندك صلاحية لإعداد الرومات الصوتية.',
            ephemeral: true
        });
    }

    if (sub === 'setup') {
        const creator = interaction.options.getChannel('creator_channel');
        const category = interaction.options.getChannel('category');
        const template = interaction.options.getString('name_template');

        if (!creator || creator.type !== ChannelType.GuildVoice) {
            return interaction.reply({ content: '❌ حدد روم صوتي كروم منشئ.', ephemeral: true });
        }

        const settings = await getSettingsSafe(guild.id);
        if (settings) {
            settings.voice = {
                creatorChannelId: creator.id,
                categoryId: category ? category.id : (creator.parentId || null),
                nameTemplate: template || settings.voice?.nameTemplate || '🔊 {user}'
            };
            settings.markModified('voice');
            await settings.save().catch(() => {});
        }

        return interaction.reply({
            content:
                `✅ تم الإعداد.\n` +
                `روم الانضمام: ${creator}\n` +
                `الكاتيجوري: ${category ? category : (creator.parentId ? `<#${creator.parentId}>` : 'بدون')}\n` +
                'استخدم `{user}` في القالب لينستبدل باسم العضو.',
            ephemeral: true
        });
    }

    // panel
    const channel = interaction.options.getChannel('channel')
        || interaction.channel;

    if (!channel || channel.type !== ChannelType.GuildText) {
        return interaction.reply({ content: '❌ حدد روم نصي للوحة.', ephemeral: true });
    }

    await channel.send(panelMessage());
    return interaction.reply({ content: `✅ تم إرسال لوحة التحكم في ${channel}.`, ephemeral: true });
}

function panelMessage() {
    const embed = new EmbedBuilder()
        .setTitle('🔊 لوحة تحكم الروم الصوتي')
        .setColor(0x5865F2)
        .setDescription(
            'أول ما تدخل الروم المنشئ ينصنع لك روم صوتي خاص.\n' +
            'استخدم الأزرار بالأسفل للتحكم برومك **وأنت داخل الروم**:\n\n' +
            '🔒 قفل · 🔓 فتح · ✏️ تغيير الاسم · 👢 طرد عضو · 👥 الحد · 📣 AFK · ↩️ استرجاع'
        );

    const rows = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('tv_lock').setLabel('قفل').setEmoji('🔒').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('tv_unlock').setLabel('فتح').setEmoji('🔓').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('tv_rename').setLabel('اسم').setEmoji('✏️').setStyle(ButtonStyle.Primary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('tv_limit').setLabel('الحد').setEmoji('👥').setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId('tv_afk').setLabel('AFK').setEmoji('📣').setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId('tv_claim').setLabel('استرجاع').setEmoji('↩️').setStyle(ButtonStyle.Success)
        )
    ];

    return { embeds: [embed], components: rows };
}

// ======================================================
// BUTTONS + MODALS
// ======================================================

async function getOwnedChannel(interaction) {
    const voiceId = interaction.member?.voice?.channelId;
    if (!voiceId) return { error: 'لازم تكون داخل روم صوتي مؤقت.' };

    const doc = await TempVoice.findOne({
        guildId: interaction.guild.id,
        channelId: voiceId
    }).lean();

    if (!doc) return { error: 'هذا مو روم مؤقت تابع لي.' };

    const channel = interaction.guild.channels.cache.get(voiceId);

    if (!channel) return { error: 'الروم مو موجود.' };

    const isOwner = doc.ownerId === interaction.user.id;
    const isAdminInGuild = allowed(interaction);

    if (!isOwner && !isAdminInGuild) {
        return { error: 'هذا الروم مو لك.' };
    }

    return { doc, channel };
}

async function handleButton(interaction) {
    if (!interaction.customId.startsWith('tv_')) return false;

    const ctx = await getOwnedChannel(interaction);

    if (ctx.error) {
        await interaction.reply({ content: `❌ ${ctx.error}`, ephemeral: true });
        return true;
    }

    const { channel } = ctx;
    const action = interaction.customId;

    if (action === 'tv_lock') {
        await channel.permissionOverwrites.edit(
            interaction.guild.roles.everyone,
            { Connect: false }
        ).catch(() => {});
        await interaction.reply({ content: '🔒 تم قفل الروم.', ephemeral: true });
        return true;
    }

    if (action === 'tv_unlock') {
        await channel.permissionOverwrites.edit(
            interaction.guild.roles.everyone,
            { Connect: true }
        ).catch(() => {});
        await interaction.reply({ content: '🔓 تم فتح الروم.', ephemeral: true });
        return true;
    }

    if (action === 'tv_afk') {
        const afkId = interaction.guild.afkChannelId;
        if (!afkId) {
            await interaction.reply({ content: '❌ ما فيه روم AFK بالسيرفر.', ephemeral: true });
            return true;
        }
        let moved = 0;
        for (const member of channel.members.values()) {
            await member.voice.setChannel(afkId).catch(() => {});
            moved++;
        }
        await interaction.reply({ content: `📣 نقلت **${moved}** عضو للـ AFK.`, ephemeral: true });
        return true;
    }

    if (action === 'tv_claim') {
        await TempVoice.updateOne(
            { channelId: channel.id },
            { $set: { ownerId: interaction.user.id } }
        ).catch(() => {});
        await interaction.reply({ content: '↩️ صرت صاحب الروم.', ephemeral: true });
        return true;
    }

    if (action === 'tv_rename') {
        const modal = new ModalBuilder()
            .setCustomId(`tv_modal_rename:${channel.id}`)
            .setTitle('✏️ تغيير اسم الروم');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('tv_name')
                    .setLabel('الاسم الجديد')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(90)
                    .setRequired(true)
            )
        );
        await interaction.showModal(modal);
        return true;
    }

    if (action === 'tv_limit') {
        const modal = new ModalBuilder()
            .setCustomId(`tv_modal_limit:${channel.id}`)
            .setTitle('👥 حد الأعضاء');
        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('tv_limit')
                    .setLabel('الحد (0 = بلا حد)')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(2)
                    .setRequired(true)
            )
        );
        await interaction.showModal(modal);
        return true;
    }

    return false;
}

async function handleModal(interaction) {
    if (!interaction.customId.startsWith('tv_modal_')) return false;

    const [, action, channelId] = interaction.customId.split(':')[0].split('_modal_');
    const id = channelId || interaction.customId.split(':')[1];

    const doc = await TempVoice.findOne({
        guildId: interaction.guild.id,
        channelId: id
    }).lean();

    if (!doc || (doc.ownerId !== interaction.user.id && !allowed(interaction))) {
        await interaction.reply({ content: '❌ هذا الروم مو لك.', ephemeral: true });
        return true;
    }

    const channel = interaction.guild.channels.cache.get(id);
    if (!channel) {
        await interaction.reply({ content: '❌ الروم مو موجود.', ephemeral: true });
        return true;
    }

    if (interaction.customId.startsWith('tv_modal_rename')) {
        const name = interaction.fields.getTextInputValue('tv_name').slice(0, 90);
        await channel.setName(name, '[TempVoice] تغيير الاسم').catch(() => {});
        await interaction.reply({ content: `✏️ تم تغيير الاسم إلى **${name}**.`, ephemeral: true });
        return true;
    }

    const limitRaw = interaction.fields.getTextInputValue('tv_limit');
    const limit = Math.max(0, Math.min(99, parseInt(limitRaw, 10) || 0));
    await channel.setUserLimit(limit, '[TempVoice] الحد').catch(() => {});
    await interaction.reply({
        content: limit === 0 ? '👥 شلت الحد.' : `👥 الحد صار **${limit}**.`,
        ephemeral: true
    });
    return true;
}

module.exports = {
    init,
    handleSlash,
    handleButton,
    handleModal,
    handleVoiceState,
    panelMessage,
    TempVoice
};
