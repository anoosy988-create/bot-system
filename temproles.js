const mongoose = require('mongoose');
const { EmbedBuilder } = require('discord.js');

// ======================================================
// TEMP ROLES — رتب مؤقتة (أسبوع / شهر / دائم)
// - تنحذف تلقائياً عند الانتهاء
// - رسالة خاصة للعضو قبل ساعة من الانتهاء
// ======================================================

let client = null;
let deps = {};

const DURATIONS = {
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
    permanent: null
};

const DURATION_LABELS = {
    week: 'أسبوع',
    month: 'شهر',
    permanent: 'دائم'
};

// مهلة التذكير قبل الانتهاء
const LEAD_MS = 60 * 60 * 1000;

// كل دقيقة نفحص
const TICK_MS = 60 * 1000;

const tempRoleSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    userId: { type: String, required: true },
    roleId: { type: String, required: true },
    assignedBy: { type: String, default: null },
    assignedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null },
    notified: { type: Boolean, default: false }
});

tempRoleSchema.index({ guildId: 1, userId: 1, roleId: 1 }, { unique: true });
tempRoleSchema.index({ expiresAt: 1 });

const TempRole = mongoose.models.TempRole
    || mongoose.model('TempRole', tempRoleSchema);

function init(c, d) {
    client = c;
    deps = d || {};

    startLoop();
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

function format(ts) {
    if (!ts) return 'دائم';
    return `<t:${Math.floor(new Date(ts).getTime() / 1000)}:R>`;
}

async function dmMember(guild, userId, content) {
    try {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (member) await member.send(content).catch(() => {});
    } catch {}
}

async function removeTempRole(doc, reason = 'expired') {
    try {
        const guild = client?.guilds?.cache?.get(doc.guildId);
        if (!guild) {
            await TempRole.deleteOne({ _id: doc._id }).catch(() => {});
            return;
        }

        const member = await guild.members.fetch(doc.userId).catch(() => null);
        const role = guild.roles.cache.get(doc.roleId)
            || await guild.roles.fetch(doc.roleId).catch(() => null);

        if (member && role && member.roles.cache.has(role.id)) {
            await member.roles
                .remove(role, '[TempRole] انتهت المدة / إزالة')
                .catch(() => {});
        }

        await TempRole.deleteOne({ _id: doc._id }).catch(() => {});

        if (reason === 'expired') {
            await dmMember(
                guild,
                doc.userId,
                `⌛ انتهت مدة رتبتك **${role ? role.name : doc.roleId}** في **${guild.name}** وتمت إزالتها.`
            );

            log(
                guild,
                '⌛ Temp Role Expired',
                `انتهت رتبة <@${doc.userId}> — **${role ? role.name : doc.roleId}** وتمت إزالتها تلقائياً.`
            );
        }
    } catch (error) {
        console.error('[TEMPROLE] فشل الإزالة:', error?.message || error);
    }
}

async function tick() {
    if (!client?.isReady?.()) return;

    const now = Date.now();

    try {
        // 1) تذكير قبل ساعة
        const soon = await TempRole.find({
            expiresAt: { $ne: null, $gt: new Date(now), $lte: new Date(now + LEAD_MS) },
            notified: false
        }).lean();

        for (const doc of soon) {
            const guild = client.guilds.cache.get(doc.guildId);
            if (!guild) continue;

            const role = guild.roles.cache.get(doc.roleId);
            await dmMember(
                guild,
                doc.userId,
                `🔔 تنبيه: رتبتك **${role ? role.name : doc.roleId}** في **${guild.name}** بتنتهي بعد ساعة تقريباً.`
            );

            await TempRole.updateOne(
                { _id: doc._id },
                { $set: { notified: true } }
            ).catch(() => {});
        }

        // 2) إزالة المنتهية
        const expired = await TempRole.find({
            expiresAt: { $ne: null, $lte: new Date(now) }
        }).lean();

        for (const doc of expired) {
            await removeTempRole(doc, 'expired');
        }
    } catch (error) {
        console.error('[TEMPROLE] خطأ بالفحص الدوري:', error?.message || error);
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

    if (!allowed(interaction)) {
        return interaction.reply({
            content: '❌ ما عندك صلاحية لإدارة الرتب المؤقتة.',
            ephemeral: true
        });
    }

    const guild = interaction.guild;

    // ---------------- إضافة ----------------
    if (sub === 'add') {
        const member = interaction.options.getMember('member');
        const role = interaction.options.getRole('role');
        const key = interaction.options.getString('duration') || 'week';

        if (!member || !role) {
            return interaction.reply({
                content: '❌ لازم تحدد العضو والرتبة.',
                ephemeral: true
            });
        }

        const me = guild.members.me;
        if (!role.editable || role.managed || role.position >= me.roles.highest.position) {
            return interaction.reply({
                content: '❌ ما أقدر أعطي هذي الرتبة — تأكد إنها **تحت** رتبة البوت ومو رتبة بوت/مدارة.',
                ephemeral: true
            });
        }

        const expiresAt = DURATIONS[key] === null
            ? null
            : new Date(Date.now() + DURATIONS[key]);

        try {
            await member.roles.add(role, `[TempRole] ${DURATION_LABELS[key]} بواسطة ${interaction.user.tag}`);

            await TempRole.findOneAndUpdate(
                { guildId: guild.id, userId: member.id, roleId: role.id },
                {
                    $set: {
                        assignedBy: interaction.user.id,
                        assignedAt: new Date(),
                        expiresAt,
                        notified: false
                    }
                },
                { upsert: true }
            );

            log(
                guild,
                '⏳ Temp Role Added',
                `أعطى <@${interaction.user.id}> رتبة **${role.name}** للعضو ${member}.\n` +
                `المدة: **${DURATION_LABELS[key]}** — تنتهي: ${format(expiresAt)}`
            );

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle('⏳ رتبة مؤقتة')
                        .setColor(0x57F287)
                        .setDescription(
                            `تم إعطاء ${member} الرتبة ${role}.\n` +
                            `المدة: **${DURATION_LABELS[key]}**\n` +
                            (expiresAt
                                ? `بتنتهي: <t:${Math.floor(expiresAt.getTime() / 1000)}:f>`
                                : '🔒 رتبة دائمة (ما بتنتهي)')
                        )
                ],
                ephemeral: true
            });
        } catch (error) {
            return interaction.reply({
                content: `❌ فشل إعطاء الرتبة: ${error.message}`,
                ephemeral: true
            });
        }
    }

    // ---------------- إزالة ----------------
    if (sub === 'remove') {
        const member = interaction.options.getMember('member');
        const role = interaction.options.getRole('role');

        if (!member || !role) {
            return interaction.reply({
                content: '❌ لازم تحدد العضو والرتبة.',
                ephemeral: true
            });
        }

        const doc = await TempRole.findOne({
            guildId: guild.id,
            userId: member.id,
            roleId: role.id
        }).lean();

        if (!doc) {
            return interaction.reply({
                content: 'ℹ️ ما فيه رتبة مؤقتة مسجلة بهذي البيانات.',
                ephemeral: true
            });
        }

        await removeTempRole(doc, 'manual');

        log(
            guild,
            '⏳ Temp Role Removed',
            `أزال <@${interaction.user.id}> الرتبة المؤقتة **${role.name}** من ${member}.`
        );

        return interaction.reply({
            content: `✅ تمت إزالة الرتبة **${role.name}** من ${member}.`,
            ephemeral: true
        });
    }

    // ---------------- عرض ----------------
    const list = await TempRole.find({ guildId: guild.id })
        .sort({ expiresAt: 1 })
        .limit(50)
        .lean();

    if (!list.length) {
        return interaction.reply({
            content: 'ℹ️ ما فيه رتب مؤقتة مسجلة في هذا السيرفر.',
            ephemeral: true
        });
    }

    const lines = list.map((doc, i) => {
        const role = guild.roles.cache.get(doc.roleId);
        const expired = doc.expiresAt && new Date(doc.expiresAt).getTime() <= Date.now();
        return (
            `**${i + 1}.** <@${doc.userId}> — **${role ? role.name : doc.roleId}**\n` +
            `└ ${doc.expiresAt ? (expired ? '⛔ منتهية' : `⏳ ${format(doc.expiresAt)}`) : '🔒 دائم'}`
        );
    });

    const chunks = [];
    let current = '';
    for (const line of lines) {
        if ((current + '\n' + line).length > 3800) {
            chunks.push(current);
            current = line;
        } else {
            current = current ? current + '\n' + line : line;
        }
    }
    if (current) chunks.push(current);

    return interaction.reply({
        embeds: [
            new EmbedBuilder()
                .setTitle(`⏳ الرتب المؤقتة (${list.length})`)
                .setColor(0x5865F2)
                .setDescription(chunks[0] || '—')
        ],
        ephemeral: true
    });
}

module.exports = {
    init,
    handleSlash,
    tick,
    TempRole,
    DURATIONS,
    DURATION_LABELS
};
