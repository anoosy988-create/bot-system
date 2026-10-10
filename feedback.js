const mongoose = require('mongoose');
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelType
} = require('discord.js');

// ======================================================
// FEEDBACK — روم فيدباك عام + رد الإدارة
// - /feedback setup channel
// - /feedback send  → مودال يكتب فيه العضو ملاحظته
// - رد الإدارة بزر على الرسالة (يرد علنياً)
// ======================================================

let client = null;
let deps = {};

const feedbackSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    messageId: { type: String, default: null },
    userId: { type: String, required: true },
    subject: { type: String, default: null },
    body: { type: String, required: true },
    rating: { type: Number, default: 0 },
    ratedBy: { type: String, default: null },
    attachments: {
        type: [{
            url: { type: String, required: true },
            name: { type: String, default: null },
            contentType: { type: String, default: null }
        }],
        default: []
    },
    stickers: { type: [String], default: [] },
    status: { type: String, default: 'open' },
    replies: {
        type: [{
            by: { type: String, required: true },
            text: { type: String, required: true },
            at: { type: Date, default: Date.now }
        }],
        default: []
    },
    createdAt: { type: Date, default: Date.now }
});

const Feedback = mongoose.models.Feedback
    || mongoose.model('Feedback', feedbackSchema);

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

function allowed(interaction) {
    try {
        return deps.isAllowed ? deps.isAllowed(interaction) : false;
    } catch {
        return false;
    }
}

function log(guild, title, description) {
    try {
        if (deps.sendLog) deps.sendLog(guild, 'moderation', title, description);
    } catch {}
}

function ratingText(rating) {
    const r = Math.max(0, Math.min(5, Number(rating) || 0));
    return '⭐'.repeat(r) + '☆'.repeat(5 - r);
}

function memberOf(fb) {
    const guild = client?.guilds?.cache?.get(fb.guildId);
    if (!guild) return null;
    return guild.members.cache.get(fb.userId)
        || client.users.cache.get(fb.userId)
        || null;
}

function buildEmbed(fb) {
    const member = memberOf(fb);
    const displayName = member?.displayName || member?.globalName || member?.username || 'عضو';
    const avatar = member?.displayAvatarURL?.({ size: 128 }) || undefined;
    const rating = Number(fb.rating) || 0;
    const attachments = fb.attachments || [];
    const stickers = fb.stickers || [];

    const embed = new EmbedBuilder()
        .setTitle('💬 فيدباك')
        .setColor(fb.status === 'answered' ? 0x57F287 : 0xFEE75C)
        .setAuthor({ name: displayName, iconURL: avatar });

    if (avatar) embed.setThumbnail(avatar);

    let desc = `**${fb.subject || 'بدون عنوان'}**\n\n${fb.body}`;

    if (attachments.length) {
        desc += '\n\n📎 **المرفقات:**\n' + attachments
            .map(a => `> ${a.name || 'ملف'} — ${a.url}`)
            .join('\n');
    }

    if (stickers.length) {
        desc += '\n\n🧩 **ستيكر:** ' + stickers.join(', ');
    }

    embed.setDescription(desc.slice(0, 4000));

    const image = attachments.find(a => (a.contentType || '').startsWith('image/'));
    if (image) embed.setImage(image.url);

    embed.addFields(
        { name: '⭐ التقييم', value: ratingText(rating), inline: true },
        { name: '📌 الحالة', value: fb.status === 'answered' ? '✅ تم الرد' : '⏳ بانتظار الرد', inline: true }
    );

    if ((fb.replies || []).length) {
        embed.addFields({
            name: '💬 رد الإدارة',
            value: fb.replies
                .map(r => `> ${r.text}\n— <@${r.by}>`)
                .join('\n\n')
                .slice(0, 1000)
        });
    }

    return embed;
}

function starRow(fb) {
    const fbId = fb._id ? fb._id.toString() : fb.id;
    const rating = Number(fb.rating) || 0;
    const row = new ActionRowBuilder();

    for (let i = 1; i <= 5; i++) {
        row.addComponents(
            new ButtonBuilder()
                .setCustomId(`feedback_rate:${fbId}:${i}`)
                .setLabel(String(i))
                .setEmoji('⭐')
                .setStyle(i <= rating ? ButtonStyle.Success : ButtonStyle.Secondary)
        );
    }

    return row;
}

function actionRow(fbId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`feedback_reply:${fbId}`)
            .setLabel('رد الإدارة')
            .setEmoji('💬')
            .setStyle(ButtonStyle.Primary)
    );
}

function componentsFor(fb) {
    const fbId = fb._id ? fb._id.toString() : fb.id;
    return [starRow(fb), actionRow(fbId)];
}

// ======================================================
// SLASH
// ======================================================

async function handleSlash(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (sub === 'setup') {
        if (!allowed(interaction)) {
            return interaction.reply({ content: '❌ ما عندك صلاحية.', ephemeral: true });
        }

        const channel = interaction.options.getChannel('channel');
        const settings = await getSettingsSafe(guild.id);

        if (settings) {
            settings.feedbackChannelId = channel.id;
            await settings.save().catch(() => {});
        }

        return interaction.reply({
            content: `✅ تم تحديد روم الفيدباك: ${channel}`,
            ephemeral: true
        });
    }

    if (sub === 'send') {
        const modal = new ModalBuilder()
            .setCustomId('feedback_modal:send')
            .setTitle('💬 أرسل فيدباك');

        modal.addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('fb_subject')
                    .setLabel('الموضوع')
                    .setStyle(TextInputStyle.Short)
                    .setMaxLength(100)
                    .setRequired(true)
            ),
            new ActionRowBuilder().addComponents(
                new TextInputBuilder()
                    .setCustomId('fb_body')
                    .setLabel('ملاحظتك / اقتراحك')
                    .setStyle(TextInputStyle.Paragraph)
                    .setMaxLength(1500)
                    .setRequired(true)
            )
        );

        return interaction.showModal(modal);
    }

    // list
    if (!allowed(interaction)) {
        return interaction.reply({ content: '❌ ما عندك صلاحية.', ephemeral: true });
    }

    const list = await Feedback.find({ guildId: guild.id })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();

    if (!list.length) {
        return interaction.reply({ content: 'ℹ️ ما فيه فيدباك.', ephemeral: true });
    }

    const lines = list.map(fb =>
        `**${fb.subject || 'بدون عنوان'}** — <@${fb.userId}> · ` +
        `${ratingText(fb.rating)} · ` +
        `${fb.status === 'answered' ? '✅ تم الرد' : '⏳ بانتظار'} · \`${(fb.body || '').slice(0, 60)}\``
    );

    return interaction.reply({
        embeds: [
            new EmbedBuilder()
                .setTitle('💬 الفيدباك')
                .setColor(0x5865F2)
                .setDescription(lines.join('\n').slice(0, 4000))
        ],
        ephemeral: true
    });
}

// ======================================================
// BUTTONS + MODALS
// ======================================================

async function handleButton(interaction) {
    // ⭐ تقييم الفيدباك بالنجوم (صاحب الفيدباك أو الإدارة)
    if (interaction.customId.startsWith('feedback_rate:')) {
        const [, fbId, starRaw] = interaction.customId.split(':');
        const stars = Number(starRaw);

        const fb = await Feedback.findById(fbId).catch(() => null);

        if (!fb) {
            await interaction.reply({ content: '❌ الفيدباك مو موجود.', ephemeral: true });
            return true;
        }

        const isAuthor = interaction.user.id === fb.userId;

        if (!isAuthor && !allowed(interaction)) {
            await interaction.reply({ content: '❌ صاحب الفيدباك أو الإدارة فقط يقيّمون.', ephemeral: true });
            return true;
        }

        fb.rating = stars;
        fb.ratedBy = interaction.user.id;
        await fb.save().catch(() => {});

        const guild = interaction.guild;
        const channel = guild.channels.cache.get(fb.channelId)
            || await guild.channels.fetch(fb.channelId).catch(() => null);

        if (channel && fb.messageId) {
            const target = await channel.messages.fetch(fb.messageId).catch(() => null);
            if (target) {
                await target.edit({
                    embeds: [buildEmbed(fb.toObject())],
                    components: componentsFor(fb.toObject())
                }).catch(() => {});
            }
        }

        await interaction.reply({
            content: `✅ تم تسجيل تقييمك: ${'⭐'.repeat(stars)} (${stars}/5)`,
            ephemeral: true
        });
        return true;
    }

    if (!interaction.customId.startsWith('feedback_reply:')) return false;

    if (!allowed(interaction)) {
        await interaction.reply({ content: '❌ رد الإدارة للمشرفين فقط.', ephemeral: true });
        return true;
    }

    const fbId = interaction.customId.split(':')[1];

    const modal = new ModalBuilder()
        .setCustomId(`feedback_reply_modal:${fbId}`)
        .setTitle('💬 رد على الفيدباك');

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('fb_reply')
                .setLabel('الرد')
                .setStyle(TextInputStyle.Paragraph)
                .setMaxLength(1000)
                .setRequired(true)
        )
    );

    await interaction.showModal(modal);
    return true;
}

async function handleModal(interaction) {
    // إرسال فيدباك جديد
    if (interaction.customId === 'feedback_modal:send') {
        const guild = interaction.guild;
        const subject = interaction.fields.getTextInputValue('fb_subject').trim();
        const body = interaction.fields.getTextInputValue('fb_body').trim();

        const settings = await getSettingsSafe(guild.id);
        const channelId = settings?.feedbackChannelId;

        const channel = channelId
            ? (guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null))
            : null;

        if (!channel) {
            await interaction.reply({
                content: '❌ روم الفيدباك ما مضبوط. كلّم الإدارة تستخدم **/feedback setup**.',
                ephemeral: true
            });
            return true;
        }

        const fb = await Feedback.create({
            guildId: guild.id,
            channelId: channel.id,
            userId: interaction.user.id,
            subject,
            body
        });

        const msg = await channel.send({
            embeds: [buildEmbed(fb.toObject())],
            components: componentsFor(fb.toObject())
        }).catch(() => null);

        if (msg) {
            fb.messageId = msg.id;
            await fb.save();
        }

        await interaction.reply({
            content: `✅ وصلنا فيدباكك في ${channel}. شكراً لك!`,
            ephemeral: true
        });

        log(guild, '💬 New Feedback', `فيدباك جديد من <@${interaction.user.id}>: **${subject}**`);
        return true;
    }

    // رد على فيدباك
    if (interaction.customId.startsWith('feedback_reply_modal:')) {
        if (!allowed(interaction)) {
            await interaction.reply({ content: '❌ للمشرفين فقط.', ephemeral: true });
            return true;
        }

        const fbId = interaction.customId.split(':')[1];
        const text = interaction.fields.getTextInputValue('fb_reply').trim();

        const fb = await Feedback.findById(fbId).catch(() => null);

        if (!fb) {
            await interaction.reply({ content: '❌ الفيدباك مو موجود.', ephemeral: true });
            return true;
        }

        fb.replies.push({ by: interaction.user.id, text });
        fb.status = 'answered';
        await fb.save();

        const guild = interaction.guild;
        const channel = guild.channels.cache.get(fb.channelId)
            || await guild.channels.fetch(fb.channelId).catch(() => null);

        if (channel) {
            const target = fb.messageId
                ? await channel.messages.fetch(fb.messageId).catch(() => null)
                : null;

            const content = `💬 رد على <@${fb.userId}>: ${text}`;

            if (target) {
                await target.reply({ content }).catch(async () => {
                    await channel.send({ content }).catch(() => {});
                });
                await target.edit({
                    embeds: [buildEmbed(fb.toObject())],
                    components: componentsFor(fb.toObject())
                }).catch(() => {});
            } else {
                await channel.send({ content }).catch(() => {});
            }
        }

        await interaction.reply({ content: '✅ تم إرسال الرد علناً.', ephemeral: true });
        return true;
    }

    return false;
}

// ======================================================
// رسائل روم الفيدباك: تُمسح وتُنشر من البوت كإيمبد
// ======================================================

async function handleMessage(message) {
    try {
        if (!message.guild || message.author?.bot || message.system) return false;

        const settings = await getSettingsSafe(message.guild.id);
        if (!settings?.feedbackChannelId) return false;
        if (message.channel.id !== settings.feedbackChannelId) return false;

        const body = (message.content || '').trim();
        const attachments = message.attachments ? [...message.attachments.values()] : [];
        const stickers = message.stickers ? [...message.stickers.values()] : [];

        if (!body && !attachments.length && !stickers.length) return false;

        const deleted = await message.delete().then(() => true).catch(() => false);
        if (!deleted) return false;

        const fb = await Feedback.create({
            guildId: message.guild.id,
            channelId: message.channel.id,
            userId: message.author.id,
            subject: null,
            body: body || '(مرفق بدون نص)',
            attachments: attachments.map(a => ({
                url: a.url,
                name: a.name || null,
                contentType: a.contentType || null
            })),
            stickers: stickers.map(s => s.name || s.id)
        });

        const msg = await message.channel.send({
            embeds: [buildEmbed(fb.toObject())],
            components: componentsFor(fb.toObject())
        }).catch(() => null);

        if (msg) {
            fb.messageId = msg.id;
            await fb.save().catch(() => {});
        }

        log(message.guild, '💬 فيدباك جديد', `فيدباك من <@${message.author.id}> في ${message.channel}`);
        return true;
    } catch (err) {
        console.error('feedback.handleMessage:', err);
        return false;
    }
}

module.exports = {
    init,
    handleSlash,
    handleButton,
    handleModal,
    handleMessage,
    Feedback,
    buildEmbed,
    componentsFor,
    ratingText
};
