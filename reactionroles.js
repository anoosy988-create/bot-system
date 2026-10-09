const mongoose = require('mongoose');
const {
    EmbedBuilder,
    ChannelType
} = require('discord.js');

// ======================================================
// REACTION ROLES — رتب بالإيموجي
// - /reactionrole panel  : ينشئ رسالة لوحة
// - /reactionrole add    : يربط إيموجي برتبة على رسالة
// - /reactionrole remove : يفك الربط
// - /reactionrole list   : يعرض الروابط
// عند التفاعل: يُعطى/يُسحب الرول تلقائياً
// ======================================================

let client = null;
let deps = {};

const rrSchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    channelId: { type: String, required: true },
    messageId: { type: String, required: true },
    title: { type: String, default: null },
    entries: {
        type: [{
            emojiKey: { type: String, required: true },
            raw: { type: String, required: true },
            roleId: { type: String, required: true }
        }],
        default: []
    },
    createdAt: { type: Date, default: Date.now }
});

rrSchema.index({ guildId: 1, messageId: 1 }, { unique: true });

const ReactionRole = mongoose.models.ReactionRole
    || mongoose.model('ReactionRole', rrSchema);

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

// مفتاح موحّد للإيموجي: مخصص بالـ id، عادي بالاسم
function storedKey(raw) {
    const s = String(raw || '').trim();
    const custom = s.match(/^<a?:[^:]+:(\d+)>$/);
    if (custom) return `id:${custom[1]}`;
    return `name:${s}`;
}

function reactionKey(emoji) {
    if (emoji.id) return `id:${emoji.id}`;
    return `name:${emoji.name}`;
}

async function applyRole(member, roleId, add, reason) {
    try {
        const role = member.guild.roles.cache.get(roleId)
            || await member.guild.roles.fetch(roleId).catch(() => null);
        if (!role || !role.editable) return false;

        if (add) {
            if (!member.roles.cache.has(role.id)) {
                await member.roles.add(role, reason).catch(() => {});
            }
        } else if (member.roles.cache.has(role.id)) {
            await member.roles.remove(role, reason).catch(() => {});
        }
        return true;
    } catch {
        return false;
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
            content: '❌ ما عندك صلاحية لإدارة رتب الإيموجي.',
            ephemeral: true
        });
    }

    // ---------------- panel ----------------
    if (sub === 'panel') {
        const channel = interaction.options.getChannel('channel');
        const title = interaction.options.getString('title') || '🎭 اختر رتبك';
        const description = interaction.options.getString('description')
            || 'تفاعل بالإيموجي بالأسفل عشان تاخذ الرتبة (أو تزيلها).';

        if (!channel || channel.type !== ChannelType.GuildText) {
            return interaction.reply({ content: '❌ حدد روم نصي.', ephemeral: true });
        }

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setColor(0x5865F2)
            .setDescription(
                `${description}\n\n_لا أنسى: استخدم \`/reactionrole add\` عشان تربط إيموجي برتبة على هذي الرسالة._`
            );

        const msg = await channel.send({ embeds: [embed] }).catch(() => null);

        if (!msg) {
            return interaction.reply({ content: '❌ فشل إرسال اللوحة.', ephemeral: true });
        }

        await ReactionRole.findOneAndUpdate(
            { guildId: guild.id, messageId: msg.id },
            {
                $set: {
                    channelId: channel.id,
                    title
                }
            },
            { upsert: true, setDefaultsOnInsert: true }
        );

        return interaction.reply({
            content:
                `✅ تم إنشاء اللوحة في ${channel}.\n` +
                `رسالة ID: \`${msg.id}\`\n` +
                `الحين اربط الإيموجيز بالرتب:\n` +
                `\`/reactionrole add channel:${channel} message_id:${msg.id} role:@الرتبة emoji:🎉\``,
            ephemeral: true
        });
    }

    // ---------------- add ----------------
    if (sub === 'add') {
        const channel = interaction.options.getChannel('channel');
        const messageId = interaction.options.getString('message_id').trim();
        const role = interaction.options.getRole('role');
        const emoji = interaction.options.getString('emoji').trim();

        if (!role.editable || role.managed) {
            return interaction.reply({
                content: '❌ هذي الرتبة مو قابلة للإعطاء (بوت/مديرة/فوق رتبة البوت).',
                ephemeral: true
            });
        }

        const message = await channel.messages.fetch(messageId).catch(() => null);

        if (!message) {
            return interaction.reply({
                content: '❌ ما لقيت الرسالة — تأكد من الـ ID والروم.',
                ephemeral: true
            });
        }

        const key = storedKey(emoji);

        // نتفاعل بالرسالة (نتجاهل لو متفاعل من قبل)
        await message.react(emoji).catch(() => {});

        const panel = await ReactionRole.findOneAndUpdate(
            { guildId: guild.id, messageId },
            {
                $set: { channelId: channel.id },
                $pull: { entries: { emojiKey: key } }
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        panel.entries.push({ emojiKey: key, raw: emoji, roleId: role.id });
        await panel.save();

        log(
            guild,
            '🎭 Reaction Role Added',
            `${emoji} → <@&${role.id}> على رسالة \`${messageId}\` بواسطة <@${interaction.user.id}>.`
        );

        return interaction.reply({
            content: `✅ ربطت ${emoji} بالرتبة **${role.name}**.`,
            ephemeral: true
        });
    }

    // ---------------- remove ----------------
    if (sub === 'remove') {
        const channel = interaction.options.getChannel('channel');
        const messageId = interaction.options.getString('message_id').trim();
        const emoji = interaction.options.getString('emoji').trim();

        const panel = await ReactionRole.findOne({ guildId: guild.id, messageId });

        if (!panel) {
            return interaction.reply({ content: '❌ ما فيه لوحة بهذي الرسالة.', ephemeral: true });
        }

        const key = storedKey(emoji);
        const before = panel.entries.length;
        panel.entries = panel.entries.filter(e => e.emojiKey !== key);

        if (panel.entries.length === before) {
            return interaction.reply({ content: 'ℹ️ ما فيه ربط لهذا الإيموجي.', ephemeral: true });
        }

        await panel.save();

        // نشيل تفاعل البوت (اختياري)
        try {
            const message = await channel.messages.fetch(messageId).catch(() => null);
            if (message) {
                const reaction = message.reactions.cache.find(r => reactionKey(r.emoji) === key);
                if (reaction) await reaction.users.remove(client.user.id).catch(() => {});
            }
        } catch {}

        return interaction.reply({
            content: `✅ فككت ربط ${emoji}.`,
            ephemeral: true
        });
    }

    // ---------------- list ----------------
    const panels = await ReactionRole.find({ guildId: guild.id }).lean();

    if (!panels.length) {
        return interaction.reply({ content: 'ℹ️ ما فيه لوحات رتب بالإيموجي.', ephemeral: true });
    }

    const lines = panels.map(panel => {
        const entries = (panel.entries || [])
            .map(e => `${e.raw} → <@&${e.roleId}>`)
            .join(' · ') || '—';
        return `**#${panel.channelId}** · \`${panel.messageId}\`\n└ ${entries}`;
    });

    return interaction.reply({
        embeds: [
            new EmbedBuilder()
                .setTitle('🎭 رتب الإيموجي')
                .setColor(0x5865F2)
                .setDescription(lines.join('\n').slice(0, 4000))
        ],
        ephemeral: true
    });
}

// ======================================================
// REACTION EVENTS
// ======================================================

async function handleReaction(reaction, user, add) {
    try {
        if (user?.bot) return;

        if (reaction.partial) {
            await reaction.fetch().catch(() => {});
        }
        if (reaction.message?.partial) {
            await reaction.message.fetch().catch(() => {});
        }

        const message = reaction.message;
        if (!message?.guildId) return;

        const panel = await ReactionRole.findOne({
            guildId: message.guildId,
            messageId: message.id
        }).lean();

        if (!panel) return;

        const key = reactionKey(reaction.emoji);
        const entry = (panel.entries || []).find(e => e.emojiKey === key);
        if (!entry) return;

        const guild = message.guild
            || client.guilds.cache.get(message.guildId);
        if (!guild) return;

        const member = await guild.members.fetch(user.id).catch(() => null);
        if (!member) return;

        await applyRole(
            member,
            entry.roleId,
            add,
            `[ReactionRole] ${add ? 'إضافة' : 'إزالة'} بواسطة تفاعل`
        );
    } catch (error) {
        console.error('[REACTIONROLE] خطأ:', error?.message || error);
    }
}

module.exports = {
    init,
    handleSlash,
    handleReaction,
    ReactionRole,
    storedKey,
    reactionKey
};
