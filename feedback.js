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

function buildEmbed(fb) {
    const embed = new EmbedBuilder()
        .setTitle('💬 فيدباك')
        .setColor(fb.status === 'answered' ? 0x57F287 : 0xFEE75C)
        .setAuthor({ name: 'عضو' })
        .setDescription(`**${fb.subject || 'بدون عنوان'}**\n\n${fb.body}`)
        .setFooter({ text: `الحالة: ${fb.status === 'answered' ? 'تم الرد' : 'بانتظار الرد'}` });

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

function actionRow(fbId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`feedback_reply:${fbId}`)
            .setLabel('رد الإدارة')
            .setEmoji('💬')
            .setStyle(ButtonStyle.Primary)
    );
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
            components: [actionRow(fb._id.toString())]
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
                await target.edit({ embeds: [buildEmbed(fb.toObject())] }).catch(() => {});
            } else {
                await channel.send({ content }).catch(() => {});
            }
        }

        await interaction.reply({ content: '✅ تم إرسال الرد علناً.', ephemeral: true });
        return true;
    }

    return false;
}

module.exports = {
    init,
    handleSlash,
    handleButton,
    handleModal,
    Feedback
};
