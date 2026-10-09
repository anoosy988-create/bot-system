const mongoose = require('mongoose');
const {
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType
} = require('discord.js');

// ======================================================
// GIVEAWAYS — سحوبات مع شروط (رتبة + صورة + تاق)
// - زر اشتراك/انسحاب
// - اختيار فائزين عشوائي عند الانتهاء
// - /giveaway start | end | reroll | list | setup
// ======================================================

let client = null;
let deps = {};

const TICK_MS = 30 * 1000;

const giveawaySchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    messageId: { type: String, default: null },
    hostId: { type: String, default: null },
    prize: { type: String, required: true },
    winnersCount: { type: Number, default: 1 },
    endsAt: { type: Date, required: true },
    ended: { type: Boolean, default: false },
    requirements: {
        roleId: { type: String, default: null },
        requireAvatar: { type: Boolean, default: false },
        requireTag: { type: Boolean, default: false }
    },
    entries: { type: [String], default: [] },
    winnerIds: { type: [String], default: [] }
});

giveawaySchema.index({ guildId: 1, ended: 1, endsAt: 1 });

const Giveaway = mongoose.models.Giveaway
    || mongoose.model('Giveaway', giveawaySchema);

function init(c, d) {
    client = c;
    deps = d || {};
    startLoop();
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

function getSettingsSafe(guildId) {
    try {
        return deps.getSettings ? deps.getSettings(guildId) : null;
    } catch {
        return null;
    }
}

function reqLines(req) {
    const lines = [];
    if (req.roleId) lines.push(`• رتبة <@&${req.roleId}>`);
    if (req.requireAvatar) lines.push('• صورة بروفايل شخصية');
    if (req.requireTag) lines.push('• تاق السيرفر (اسمك يبيّن التاق)');
    return lines.length ? lines.join('\n') : '• لا شروط — أي أحد يقدر يشارك';
}

async function meetsRequirements(member, req, guild) {
    if (!member) return false;

    if (req.roleId && !member.roles.cache.has(req.roleId)) return false;

    if (req.requireAvatar && !member.user.avatar) return false;

    if (req.requireTag) {
        const pg = member.user.primaryGuild;
        const hasTag = !!(pg && String(pg.identityGuildId) === String(guild.id));
        // دعم احتياطي لو discord.js ما يدعم التاق
        if (pg && !hasTag) return false;
        if (!pg && !member.nickname) return false;
    }

    return true;
}

function buildEmbed(gw, guild, ended = false) {
    const req = gw.requirements || {};
    const base = new EmbedBuilder()
        .setTitle(ended ? `🎉 انتهى السحب — ${gw.prize}` : `🎁 سحب — ${gw.prize}`)
        .setColor(ended ? 0x57F287 : 0xEB459E)
        .setFooter({ text: `عدد الفائزين: ${gw.winnersCount}` });

    if (ended) {
        base.setDescription(
            gw.winnerIds.length
                ? `الفائزون: ${gw.winnerIds.map(id => `<@${id}>`).join(', ')}`
                : '😔 ما فيه أحد انطبق عليه الشرط. لا فائز.'
        );
    } else {
        base.setDescription(
            `اضغط **شارك** للاشتراك.\n\n**الشروط:**\n${reqLines(req)}\n\n` +
            `ينتهي: <t:${Math.floor(new Date(gw.endsAt).getTime() / 1000)}:R>\n` +
            `المشاركون: **${gw.entries.length}**`
        );
    }

    base.addFields({
        name: '🎁 الجائزة',
        value: gw.prize,
        inline: true
    });

    return base;
}

function actionRow(gwId, disabled = false) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`giveaway_join:${gwId}`)
            .setLabel(disabled ? 'انتهى' : 'شارك')
            .setEmoji('🎉')
            .setStyle(ButtonStyle.Primary)
            .setDisabled(disabled)
    );
}

async function pickWinners(guild, gw) {
    const valid = [];

    for (const userId of gw.entries || []) {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (await meetsRequirements(member, gw.requirements || {}, guild)) {
            valid.push(userId);
        }
    }

    // خلط فيشر-ييتس
    for (let i = valid.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [valid[i], valid[j]] = [valid[j], valid[i]];
    }

    return valid.slice(0, Math.max(1, gw.winnersCount || 1));
}

async function endGiveaway(gw, options = {}) {
    try {
        const guild = client?.guilds?.cache?.get(gw.guildId);
        if (!guild) {
            await Giveaway.updateOne({ _id: gw._id }, { $set: { ended: true } }).catch(() => {});
            return null;
        }

        const winners = await pickWinners(guild, gw);

        await Giveaway.updateOne(
            { _id: gw._id },
            { $set: { ended: true, winnerIds: winners } }
        ).catch(() => {});

        gw.ended = true;
        gw.winnerIds = winners;

        const channel = guild.channels.cache.get(gw.channelId)
            || await guild.channels.fetch(gw.channelId).catch(() => null);

        if (channel && gw.messageId) {
            const msg = await channel.messages.fetch(gw.messageId).catch(() => null);
            if (msg) {
                await msg.edit({
                    embeds: [buildEmbed(gw, guild, true)],
                    components: [actionRow(gw._id.toString(), true)]
                }).catch(() => {});
            }
        }

        if (channel && winners.length) {
            await channel.send({
                content:
                    `🎉 مبروك ${winners.map(id => `<@${id}>`).join(', ')}! ` +
                    `فزتوا بـ **${gw.prize}**`
            }).catch(() => {});
        } else if (channel) {
            await channel.send({
                content: `😔 انتهى سحب **${gw.prize}** بدون فائزين (ما انطبق الشرط على أحد).`
            }).catch(() => {});
        }

        log(
            guild,
            options.reroll ? '🎲 Giveaway Reroll' : '🎁 Giveaway Ended',
            `سحب **${gw.prize}** — الفائزون: ${
                winners.length ? winners.map(id => `<@${id}>`).join(', ') : 'لا أحد'
            }`
        );

        return winners;
    } catch (error) {
        console.error('[GIVEAWAY] فشل الإنهاء:', error?.message || error);
        return null;
    }
}

async function tick() {
    if (!client?.isReady?.()) return;

    try {
        const due = await Giveaway.find({
            ended: false,
            endsAt: { $lte: new Date() }
        }).limit(10).lean();

        for (const gw of due) {
            await endGiveaway(gw);
        }
    } catch (error) {
        console.error('[GIVEAWAY] خطأ بالفحص الدوري:', error?.message || error);
    }
}

let loopTimer = null;

function startLoop() {
    if (loopTimer) return;
    loopTimer = setInterval(tick, TICK_MS);
    loopTimer.unref?.();
}

// ======================================================
// SLASH
// ======================================================

async function handleSlash(interaction) {
    const sub = interaction.options.getSubcommand();
    const guild = interaction.guild;

    if (!allowed(interaction)) {
        return interaction.reply({
            content: '❌ ما عندك صلاحية لإدارة السحوبات.',
            ephemeral: true
        });
    }

    // ---------------- setup ----------------
    if (sub === 'setup') {
        const channel = interaction.options.getChannel('channel');
        const settings = await getSettingsSafe(guild.id);

        if (settings) {
            settings.giveawayChannelId = channel.id;
            await settings.save().catch(() => {});
        }

        return interaction.reply({
            content: `✅ تم تحديد روم السحوبات: ${channel}`,
            ephemeral: true
        });
    }

    // ---------------- start ----------------
    if (sub === 'start') {
        const prize = interaction.options.getString('prize');
        const minutes = interaction.options.getInteger('duration');
        const winners = interaction.options.getInteger('winners') || 1;
        const role = interaction.options.getRole('role');
        const requireAvatar = interaction.options.getBoolean('require_avatar') ?? true;
        const requireTag = interaction.options.getBoolean('require_tag') ?? true;

        let channel = interaction.options.getChannel('channel');

        if (!channel) {
            const settings = await getSettingsSafe(guild.id);
            channel = settings?.giveawayChannelId
                ? guild.channels.cache.get(settings.giveawayChannelId)
                : null;
        }

        if (!channel || channel.type !== ChannelType.GuildText) {
            return interaction.reply({
                content:
                    '❌ حدد روم نصي باستخدام خيار `channel`، أو اضبط الروم أول بـ **/giveaway setup**.',
                ephemeral: true
            });
        }

        const endsAt = new Date(Date.now() + minutes * 60 * 1000);

        const gw = await Giveaway.create({
            guildId: guild.id,
            channelId: channel.id,
            hostId: interaction.user.id,
            prize,
            winnersCount: winners,
            endsAt,
            requirements: {
                roleId: role ? role.id : null,
                requireAvatar,
                requireTag
            },
            entries: []
        });

        const embed = buildEmbed(gw.toObject(), guild, false);
        const row = actionRow(gw._id.toString());

        await interaction.reply({
            content: `✅ تم إنشاء السحب في ${channel}.`,
            ephemeral: true
        });

        try {
            const msg = await channel.send({ embeds: [embed], components: [row] });
            gw.messageId = msg.id;
            await gw.save();
        } catch (error) {
            return interaction.followUp({
                content: `⚠️ أنشأت السحب بس ما قدرت أرسل الرسالة: ${error.message}`,
                ephemeral: true
            });
        }

        log(
            guild,
            '🎁 Giveaway Started',
            `سحب **${prize}** في ${channel} بواسطة <@${interaction.user.id}>.`
        );

        return;
    }

    // ---------------- end ----------------
    if (sub === 'end') {
        const messageId = interaction.options.getString('message_id');

        const gw = await Giveaway.findOne({
            guildId: guild.id,
            messageId,
            ended: false
        }).lean();

        if (!gw) {
            return interaction.reply({
                content: '❌ ما لقيت سحب نشط بهذا الـ ID.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });
        const winners = await endGiveaway(gw);

        return interaction.editReply({
            content: winners && winners.length
                ? `🎉 تم إنهاء السحب — الفائزون: ${winners.map(id => `<@${id}>`).join(', ')}`
                : 'تم إنهاء السحب — لا فائزين.'
        });
    }

    // ---------------- reroll ----------------
    if (sub === 'reroll') {
        const messageId = interaction.options.getString('message_id');

        const gw = await Giveaway.findOne({
            guildId: guild.id,
            messageId,
            ended: true
        }).lean();

        if (!gw) {
            return interaction.reply({
                content: '❌ ما لقيت سحب منتهي بهذا الـ ID.',
                ephemeral: true
            });
        }

        await interaction.deferReply({ ephemeral: true });

        const winners = await pickWinners(guild, gw);

        if (!winners.length) {
            return interaction.editReply({
                content: '😔 ما فيه مشارك ينطبق عليه الشرط.'
            });
        }

        await Giveaway.updateOne({ _id: gw._id }, { $set: { winnerIds: winners } });

        const channel = guild.channels.cache.get(gw.channelId);
        if (channel) {
            await channel.send({
                content:
                    `🎲 إعادة سحب **${gw.prize}** — الفائزون الجدد: ` +
                    winners.map(id => `<@${id}>`).join(', ')
            }).catch(() => {});
        }

        return interaction.editReply({
            content: `🎲 الفائزون الجدد: ${winners.map(id => `<@${id}>`).join(', ')}`
        });
    }

    // ---------------- list ----------------
    const list = await Giveaway.find({ guildId: guild.id })
        .sort({ endsAt: -1 })
        .limit(20)
        .lean();

    if (!list.length) {
        return interaction.reply({
            content: 'ℹ️ ما فيه سحوبات في هذا السيرفر.',
            ephemeral: true
        });
    }

    const lines = list.map(gw =>
        `**${gw.prize}** — ${gw.ended ? '⛔ منتهي' : `⏳ <t:${Math.floor(new Date(gw.endsAt).getTime() / 1000)}:R>`} · ` +
        `مشاركون ${(gw.entries || []).length} · \`id:${gw.messageId || '—'}\``
    );

    return interaction.reply({
        embeds: [
            new EmbedBuilder()
                .setTitle('🎁 السحوبات')
                .setColor(0xEB459E)
                .setDescription(lines.join('\n').slice(0, 4000))
        ],
        ephemeral: true
    });
}

// ======================================================
// BUTTONS
// ======================================================

async function handleButton(interaction) {
    if (!interaction.customId.startsWith('giveaway_join:')) return false;

    const gwId = interaction.customId.split(':')[1];

    const gw = await Giveaway.findById(gwId).catch(() => null);

    if (!gw) {
        await interaction.reply({
            content: '❌ هذا السحب مو موجود.',
            ephemeral: true
        });
        return true;
    }

    if (gw.ended || new Date(gw.endsAt).getTime() <= Date.now()) {
        await interaction.reply({
            content: '⛔ انتهى هذا السحب.',
            ephemeral: true
        });
        return true;
    }

    const member = interaction.member;

    if (!(await meetsRequirements(member, gw.requirements || {}, interaction.guild))) {
        await interaction.reply({
            content:
                '❌ ما تنطبق عليك شروط السحب:\n' +
                `${reqLines(gw.requirements || {})}`,
            ephemeral: true
        });
        return true;
    }

    const idx = gw.entries.indexOf(interaction.user.id);

    if (idx >= 0) {
        gw.entries.splice(idx, 1);
        await interaction.reply({
            content: '👋 انسحبت من السحب.',
            ephemeral: true
        });
    } else {
        gw.entries.push(interaction.user.id);
        await interaction.reply({
            content: '🎉 تم تسجيلك في السحب!',
            ephemeral: true
        });
    }

    await gw.save();

    // تحديث عدّاد المشاركين بالرسالة
    try {
        const channel = interaction.guild.channels.cache.get(gw.channelId);
        if (channel && gw.messageId) {
            const msg = await channel.messages.fetch(gw.messageId).catch(() => null);
            if (msg) {
                await msg.edit({
                    embeds: [buildEmbed(gw.toObject(), interaction.guild, false)]
                }).catch(() => {});
            }
        }
    } catch {}

    return true;
}

module.exports = {
    init,
    handleSlash,
    handleButton,
    tick,
    Giveaway,
    endGiveaway
};
