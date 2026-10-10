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
// PUZZLE — قفل ومفتاح: رمز من 4 أرقام
// - رسالة عامة + زر يفتح مودال لإدخال الرمز
// - أول واحد يجيب الرمز الصحيح يفوز
// - /puzzle start | list | end
// ======================================================

let client = null;
let deps = {};

const puzzleSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    messageId: { type: String, default: null },
    code: { type: String, required: true },
    prize: { type: String, default: 'جائزة' },
    prizeRoleId: { type: String, default: null },
    hint: { type: String, default: null },
    solved: { type: Boolean, default: false },
    winnerId: { type: String, default: null },
    createdBy: { type: String, default: null },
    createdAt: { type: Date, default: Date.now }
});

const Puzzle = mongoose.models.Puzzle
    || mongoose.model('Puzzle', puzzleSchema);

function init(c, d) {
    client = c;
    deps = d || {};
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

function buildEmbed(pz) {
    return new EmbedBuilder()
        .setTitle('🔒 قفل ومفتاح')
        .setColor(pz.solved ? 0x57F287 : 0xE67E22)
        .setDescription(
            pz.solved
                ? `✅ انحل القفل! الفائز: <@${pz.winnerId}>\n**الجائزة:** ${pz.prize}`
                : `فيه قفل مقفّل برمز من **4 أرقام**.\n` +
                  (pz.hint ? `💡 تلميح: **${pz.hint}**\n\n` : '\n') +
                  `اضغط الزر وجرّب رمزك — أول واحد يصيب يفوز!\n\n` +
                  `**الجائزة:** ${pz.prize}`
        )
        .setFooter({ text: 'بالتوفيق 🔐' });
}

function actionRow(pzId, disabled = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`puzzle_try:${pzId}`)
            .setLabel(disabled ? 'انحل القفل' : '🔓 جرّب الرمز')
            .setStyle(disabled ? ButtonStyle.Success : ButtonStyle.Primary)
            .setDisabled(disabled)
    );
}

// ======================================================
// SLASH
// ======================================================

async function handleSlash(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (!allowed(interaction)) {
        return interaction.reply({
            content: '❌ ما عندك صلاحية لإدارة الأقفال.',
            ephemeral: true
        });
    }

    // ---------------- start ----------------
    if (sub === 'start') {
        const code = String(interaction.options.getString('code')).trim();
        const prize = interaction.options.getString('prize');
        const channel = interaction.options.getChannel('channel');
        const role = interaction.options.getRole('role');
        const hint = interaction.options.getString('hint');

        if (!/^\d{4}$/.test(code)) {
            return interaction.reply({
                content: '❌ الرمز لازم يكون **4 أرقام** بالضبط.',
                ephemeral: true
            });
        }

        if (!channel || channel.type !== ChannelType.GuildText) {
            return interaction.reply({
                content: '❌ حدد روم نصي.',
                ephemeral: true
            });
        }

        const pz = await Puzzle.create({
            guildId: guild.id,
            channelId: channel.id,
            code,
            prize,
            prizeRoleId: role ? role.id : null,
            hint: hint || null,
            createdBy: interaction.user.id
        });

        // نرسل الرسالة العامة أول
        let msg;
        try {
            msg = await channel.send({
                embeds: [buildEmbed(pz.toObject())],
                components: [actionRow(pz._id.toString())]
            });
            pz.messageId = msg.id;
            await pz.save();
        } catch (error) {
            return interaction.reply({
                content: `❌ فشل إرسال رسالة القفل: ${error.message}`,
                ephemeral: true
            });
        }

        // سر الرمز للأدمن فقط
        await interaction.reply({
            content: `✅ تم إنشاء القفل في ${channel}.\n🔐 الرمز: \`${code}\` (هذي بس أنت تشوفها).`,
            ephemeral: true
        });

        log(
            guild,
            '🔒 Puzzle Started',
            `قفل جديد بواسطة <@${interaction.user.id}> في ${channel} — الجائزة: **${prize}**.`
        );

        return;
    }

    // ---------------- end ----------------
    if (sub === 'end') {
        const messageId = interaction.options.getString('message_id');

        const pz = await Puzzle.findOne({
            guildId: guild.id,
            messageId,
            solved: false
        }).lean();

        if (!pz) {
            return interaction.reply({
                content: '❌ ما لقيت قفل نشط بهذا الـ ID.',
                ephemeral: true
            });
        }

        await Puzzle.updateOne({ _id: pz._id }, { $set: { solved: true } });

        const channel = guild.channels.cache.get(pz.channelId);
        if (channel && pz.messageId) {
            const msg = await channel.messages.fetch(pz.messageId).catch(() => null);
            if (msg) {
                await msg.edit({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('🔒 قفل ومفتاح')
                            .setColor(0xED4245)
                            .setDescription('⛔ تم إلغاء هذا القفل.')
                    ],
                    components: [actionRow(pz._id.toString(), true)]
                }).catch(() => {});
            }
        }

        return interaction.reply({
            content: '✅ تم إلغاء القفل.',
            ephemeral: true
        });
    }

    // ---------------- list ----------------
    const list = await Puzzle.find({ guildId: guild.id, solved: false })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean();

    if (!list.length) {
        return interaction.reply({
            content: 'ℹ️ ما فيه أقفال نشطة.',
            ephemeral: true
        });
    }

    const lines = list.map(pz =>
        `**${pz.prize}** — ${pz.hint ? `تلميح: ${pz.hint}` : 'بلا تلميح'} · \`id:${pz.messageId || '—'}\``
    );

    return interaction.reply({
        embeds: [
            new EmbedBuilder()
                .setTitle('🔒 الأقفال النشطة')
                .setColor(0xE67E22)
                .setDescription(lines.join('\n').slice(0, 4000))
        ],
        ephemeral: true
    });
}

// ======================================================
// BUTTON + MODAL
// ======================================================

async function handleButton(interaction) {
    if (!interaction.customId.startsWith('puzzle_try:')) return false;

    const pzId = interaction.customId.split(':')[1];

    const pz = await Puzzle.findById(pzId).catch(() => null);

    if (!pz) {
        await interaction.reply({ content: '❌ القفل مو موجود.', ephemeral: true });
        return true;
    }

    if (pz.solved) {
        await interaction.reply({ content: '✅ انحل هذا القفل من قبل.', ephemeral: true });
        return true;
    }

    const modal = new ModalBuilder()
        .setCustomId(`puzzle_modal:${pzId}`)
        .setTitle('🔐 أدخل رمز القفل');

    modal.addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('puzzle_code')
                .setLabel('الرمز (4 أرقام)')
                .setStyle(TextInputStyle.Short)
                .setMinLength(4)
                .setMaxLength(4)
                .setPlaceholder('1234')
                .setRequired(true)
        )
    );

    await interaction.showModal(modal);
    return true;
}

async function handleModal(interaction) {
    if (!interaction.customId.startsWith('puzzle_modal:')) return false;

    const pzId = interaction.customId.split(':')[1];
    const guess = String(interaction.fields.getTextInputValue('puzzle_code') || '').trim();

    const pz = await Puzzle.findById(pzId).catch(() => null);

    if (!pz) {
        await interaction.reply({ content: '❌ القفل مو موجود.', ephemeral: true });
        return true;
    }

    if (pz.solved) {
        await interaction.reply({ content: '✅ انحل هذا القفل من قبل.', ephemeral: true });
        return true;
    }

    const guild = interaction.guild;

    // غلط
    if (guess !== pz.code) {
        await interaction.reply({
            content: '❌ رمز غلط — جرّب مرة ثانية 🔒',
            ephemeral: true
        });
        return true;
    }

    // صح — أول فائز
    pz.solved = true;
    pz.winnerId = interaction.user.id;
    await pz.save();

    // نعطي الرتبة الجائزة إن وجدت
    if (pz.prizeRoleId) {
        const member = await guild.members.fetch(interaction.user.id).catch(() => null);
        const role = guild.roles.cache.get(pz.prizeRoleId);
        if (member && role && role.editable) {
            await member.roles.add(role, '[Puzzle] فاز بلغز القفل').catch(() => {});
        }
    }

    const channel = guild.channels.cache.get(pz.channelId);
    if (channel && pz.messageId) {
        const msg = await channel.messages.fetch(pz.messageId).catch(() => null);
        if (msg) {
            await msg.edit({
                embeds: [buildEmbed(pz.toObject())],
                components: [actionRow(pz._id.toString(), true)]
            }).catch(() => {});
        }
    }

    await interaction.reply({
        content: `🎉 صح! فتحت القفل وفزت بـ **${pz.prize}**.`,
        ephemeral: false
    });

    log(
        guild,
        '🏆 Puzzle Solved',
        `<@${interaction.user.id}> فتح القفل وفاز بـ **${pz.prize}**.`
    );

    return true;
}

module.exports = {
    init,
    handleSlash,
    handleButton,
    handleModal,
    Puzzle,
    buildEmbed,
    actionRow,
    log
};
