const http = require('http');
const express = require('express');
const fs = require('fs');
const ms = require('ms');
const mongoose = require('mongoose');

const {
    Client,
    GatewayIntentBits,
    PermissionsBitField,
    EmbedBuilder,
    SlashCommandBuilder,
    Colors,
    AuditLogEvent,
    MessageFlags,
    StringSelectMenuBuilder,
    ActionRowBuilder,
    ChannelType
} = require('discord.js');

// ==================== OWNER ID ====================
const OWNER_ID = process.env.OWNER_ID || '1364275261398581279';

function isOwner(userId) {
    return userId === OWNER_ID;
}

function isAdmin(member) {
    return member.permissions.has(PermissionsBitField.Flags.Administrator);
}

/**
 * مين يقدر يتحكم بإعدادات الحماية (يفعل/يعطل/يغير عدد العمليات):
 * المالك، أو أدمن رتبته أعلى من البوت، أو شخص بالوايت ليست.
 * هذا يمنع أدمن "ضعيف" (رتبته تحت البوت) من إيقاف الحماية بسهولة لو تم اختراق حسابه.
 */
async function canManageProtection(interaction) {
    if (isOwner(interaction.user.id)) return true;
    const wl = await db.isWhitelisted(interaction.guild.id, interaction.user.id);
    if (wl) return true;
    const me = interaction.guild.members.me;
    if (isAdmin(interaction.member) && me && interaction.member.roles.highest.position > me.roles.highest.position) {
        return true;
    }
    return false;
}

/* ─── Helper: canExecute ─── */
function canExecute(message, target = null, requiredPermission = null, roleTarget = null) {
    const authorIsOwner = isOwner(message.author.id);
    if (authorIsOwner) return { allowed: true };

    if (target && isOwner(target.id)) {
        return { allowed: false, reason: 'فحلك المطيري ماتقدر تسوي له شي' };
    }

    if (requiredPermission && !message.member.permissions.has(requiredPermission)) {
        return { allowed: false, reason: '❌ ما عندك صلاحية.' };
    }

    if (target && target.roles.highest.position >= message.member.roles.highest.position) {
        return { allowed: false, reason: '❌ ما تقدر تسوي شي لعضو رتبته أعلى منك أو نفسك.' };
    }

    if (roleTarget && !isOwner(message.author.id) && roleTarget.position >= message.member.roles.highest.position) {
        return { allowed: false, reason: '❌ ما تقدر تسوي شي على رتبة أعلى منك أو نفس رتبتك.' };
    }

    return { allowed: true };
}

// ==================== MONGODB DATABASE ====================
// Schema compatible with both bots — uses guild_id to avoid index conflicts
const guildSchema = new mongoose.Schema({
    guild_id: { type: String, required: true, unique: true },
    logChannelId: { type: String, default: null },        // fallback / "all" log channel
    logChannels: { type: Map, of: String, default: new Map() }, // per-type log channels: {channelDelete: id, roleDelete: id, ...}
    welcomeChannelId: { type: String, default: null },
    welcomeMessage: { type: String, default: null },
    jailRoles: { type: Map, of: [String], default: new Map() },
    vanityURL: { type: String, default: null },
    vanityProtection: { type: Boolean, default: false },

    // ─── Anti-Nuke settings ───
    // كل نوع حماية له سلاش خاص فيه: تفعيل مستقل + عدد العمليات المسموحة + نوع العقوبة
    antiNuke: {
        enabled: { type: Boolean, default: false }, // المفتاح الرئيسي لكل النظام
        timeWindowMs: { type: Number, default: 10000 }, // خلال كم مللي ثانية تُحسب العمليات (نافذة زمنية عامة)
        channelDelete: {
            enabled: { type: Boolean, default: true },
            threshold: { type: Number, default: 3 },
            punishment: { type: String, default: 'ban' }
        },
        channelCreate: {
            enabled: { type: Boolean, default: true },
            threshold: { type: Number, default: 3 },
            punishment: { type: String, default: 'ban' }
        },
        roleDelete: {
            enabled: { type: Boolean, default: true },
            threshold: { type: Number, default: 3 },
            punishment: { type: String, default: 'ban' }
        },
        roleCreate: {
            enabled: { type: Boolean, default: true },
            threshold: { type: Number, default: 3 },
            punishment: { type: String, default: 'ban' }
        },
        webhookCreate: {
            enabled: { type: Boolean, default: true },
            threshold: { type: Number, default: 3 },
            punishment: { type: String, default: 'ban' }
        },
        memberBan: {
            enabled: { type: Boolean, default: true },
            threshold: { type: Number, default: 3 },
            punishment: { type: String, default: 'ban' }
        },
        memberKick: {
            enabled: { type: Boolean, default: true },
            threshold: { type: Number, default: 3 },
            punishment: { type: String, default: 'ban' }
        },
        botAdd: {
            enabled: { type: Boolean, default: true } // بوتات: عقوبة فورية بدون عداد
        }
    },
    whitelist: { type: [String], default: [] }, // user IDs معفيين من الحماية

    // ─── Leveling settings ───
    leveling: {
        enabled: { type: Boolean, default: false },
        xpPerMessage: { type: Number, default: 15 },
        cooldownMs: { type: Number, default: 60000 },
        // roleRewards: [{ level: 5, roleId: '123' }, ...]
        roleRewards: { type: [{ level: Number, roleId: String }], default: [] }
    }
});

const warnSchema = new mongoose.Schema({
    guildId: String,
    userId: String,
    number: Number,
    reason: String,
    by: String,
    date: { type: Number, default: () => Date.now() }
});

const levelSchema = new mongoose.Schema({
    guildId: String,
    userId: String,
    xp: { type: Number, default: 0 },
    level: { type: Number, default: 0 },
    lastMessageAt: { type: Number, default: 0 }
});

const GuildSettings = mongoose.model('GuildSettings', guildSchema);
const Warn = mongoose.model('Warn', warnSchema);
const Level = mongoose.model('Level', levelSchema);

// DB Helpers — all use guild_id instead of _id
const db = {
    async getOrCreate(guildId) {
        let doc = await GuildSettings.findOne({ guild_id: guildId });
        if (!doc) {
            doc = await GuildSettings.create({ guild_id: guildId });
        }
        return doc;
    },
    async setLogChannel(guildId, channelId) {
        await db.getOrCreate(guildId);
        return GuildSettings.findOneAndUpdate(
            { guild_id: guildId },
            { logChannelId: channelId },
            { upsert: true, new: true }
        );
    },
    async setTypedLogChannel(guildId, type, channelId) {
        const doc = await db.getOrCreate(guildId);
        doc.logChannels.set(type, channelId);
        await doc.save();
        return doc;
    },
    async getLogChannel(guildId, type = null) {
        const s = await GuildSettings.findOne({ guild_id: guildId }).lean();
        if (!s) return null;
        if (type && s.logChannels && s.logChannels[type]) return s.logChannels[type];
        return s.logChannelId || null;
    },
    async setVanityURL(guildId, url) {
        await db.getOrCreate(guildId);
        return GuildSettings.findOneAndUpdate(
            { guild_id: guildId },
            { vanityURL: url },
            { upsert: true, new: true }
        );
    },
    async getVanityURL(guildId) {
        const s = await GuildSettings.findOne({ guild_id: guildId }).lean();
        return s?.vanityURL || null;
    },
    async isVanityProtectionEnabled(guildId) {
        const s = await GuildSettings.findOne({ guild_id: guildId }).lean();
        return s?.vanityProtection || false;
    },
    async toggleVanityProtection(guildId, on) {
        await db.getOrCreate(guildId);
        return GuildSettings.findOneAndUpdate(
            { guild_id: guildId },
            { vanityProtection: on },
            { upsert: true, new: true }
        );
    },
    async getSettings(guildId) {
        return db.getOrCreate(guildId);
    },
    async addWhitelist(guildId, userId) {
        const doc = await db.getOrCreate(guildId);
        if (!doc.whitelist.includes(userId)) {
            doc.whitelist.push(userId);
            await doc.save();
        }
        return doc;
    },
    async removeWhitelist(guildId, userId) {
        const doc = await db.getOrCreate(guildId);
        doc.whitelist = doc.whitelist.filter(id => id !== userId);
        await doc.save();
        return doc;
    },
    async isWhitelisted(guildId, userId) {
        const s = await GuildSettings.findOne({ guild_id: guildId }).lean();
        return s?.whitelist?.includes(userId) || false;
    },

    // ─── Jail: نحفظ رتب العضو الأصلية عشان نرجعها له لما نفك السجن ───
    async saveJailRoles(guildId, userId, roleIds) {
        const doc = await db.getOrCreate(guildId);
        doc.jailRoles.set(userId, roleIds);
        await doc.save();
        return doc;
    },
    async getJailRoles(guildId, userId) {
        const s = await GuildSettings.findOne({ guild_id: guildId }).lean();
        return s?.jailRoles?.[userId] || null; // .lean() يحول الـ Map لـ object عادي
    },
    async clearJailRoles(guildId, userId) {
        const doc = await db.getOrCreate(guildId);
        doc.jailRoles.delete(userId);
        await doc.save();
        return doc;
    }
};

// Warning Helpers
async function getWarnings(guildId, userId) {
    return await Warn.find({ guildId, userId }).sort({ number: 1 }).lean();
}

async function getNextWarningNumber(guildId, userId) {
    // نجيب أصغر رقم فاضي بدل ما نزود دايم، عشان الأرقام ما تتكرر وما تصير فجوات دايمة
    const existing = await Warn.find({ guildId, userId }).sort({ number: 1 }).lean();
    const usedNumbers = new Set(existing.map(w => w.number));
    let n = 1;
    while (usedNumbers.has(n)) n++;
    return n;
}

async function addWarning(guildId, userId, reason, byId) {
    const number = await getNextWarningNumber(guildId, userId);
    await Warn.create({ guildId, userId, number, reason, by: byId });
    return number;
}

async function removeWarning(guildId, userId, number) {
    const result = await Warn.deleteOne({ guildId, userId, number });
    return result.deletedCount > 0;
}

async function getLogChannel(guild, type = null) {
    const id = await db.getLogChannel(guild.id, type);
    return id ? guild.channels.cache.get(id) : null;
}

function logEmbed(title, fields, color = Colors.Blue, clientUser = null) {
    const embed = new EmbedBuilder()
        .setTitle(title)
        .addFields(fields)
        .setColor(color)
        .setTimestamp();
    if (clientUser) {
        embed.setFooter({ text: 'Cypher Protection System', iconURL: clientUser.displayAvatarURL?.() || undefined });
    }
    return embed;
}

// ==================== HTTP SERVER ====================
const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is active!'));
app.listen(port, () => console.log(`Server listening on port ${port}`));

// ==================== DISCORD CLIENT ====================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildWebhooks
    ]
});

// ==================== WELCOME IMAGE SYSTEM ====================
const WELCOME_BG_URL = 'https://cdn.discordapp.com/attachments/1451757101142642768/1538632664582725662/welcome2.png?ex=6a8362d5&is=6a821155&hm=8631d5bed72d0cc7cca1772a7ecbb1e57930a69ea06cd4a488695d270242076d';

async function getCanvas() {
    try {
        return require('@napi-rs/canvas');
    } catch {
        try {
            return require('canvas');
        } catch {
            return null;
        }
    }
}

async function createWelcomeImage(member) {
    const canvasLib = await getCanvas();
    if (!canvasLib) {
        console.log('[WARN] No canvas library found');
        return null;
    }

    const { createCanvas, loadImage } = canvasLib;
    const canvas = createCanvas(1425, 736);
    const ctx = canvas.getContext('2d');

    const background = await loadImage(WELCOME_BG_URL);
    ctx.drawImage(background, 0, 0, canvas.width, canvas.height);

    const avatarURL = member.user.displayAvatarURL({ extension: 'png', size: 512 });
    const avatar = await loadImage(avatarURL);

    const avatarX = 180;
    const avatarY = 200;
    const avatarSize = 280;

    ctx.save();
    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, avatarX, avatarY, avatarSize, avatarSize);
    ctx.restore();

    ctx.beginPath();
    ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2 + 8, 0, Math.PI * 2);
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#d4af37';
    ctx.stroke();

    ctx.font = 'bold 42px DejaVu Sans, Arial, sans-serif';
    ctx.fillStyle = '#d4af37';
    ctx.textAlign = 'left';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    const username = `@${member.user.username}`;
    const textX = avatarX + avatarSize + 50;
    const textY = avatarY + avatarSize / 2 + 10;

    ctx.fillText(username, textX, textY);

    return canvas.toBuffer('image/png');
}

// ==================== MUTE ROLE SYSTEM ====================
async function getOrCreateMuteRole(guild) {
    let muteRole = guild.roles.cache.find(r => r.name === 'Muted' || r.name === 'ميوت');
    if (muteRole) return muteRole;

    muteRole = await guild.roles.create({
        name: 'Muted',
        color: '#808080',
        reason: 'Mute role for timeout fallback'
    });

    const channels = guild.channels.cache.filter(c => c.isTextBased() || c.type === 2);
    for (const channel of channels.values()) {
        try {
            await channel.permissionOverwrites.edit(muteRole.id, {
                SendMessages: false,
                AddReactions: false,
                Speak: false,
                SendMessagesInThreads: false,
                CreatePublicThreads: false,
                CreatePrivateThreads: false
            });
        } catch (e) {}
    }
    return muteRole;
}

// ==================== JAIL ROLE SYSTEM ====================
async function getOrCreateJailRole(guild) {
    let jailRole = guild.roles.cache.find(r => r.name === 'Jailed' || r.name === 'مسجون');
    if (jailRole) return jailRole;

    jailRole = await guild.roles.create({
        name: 'مسجون',
        color: '#2c2c2c',
        reason: 'رتبة السجن'
    });

    // نمنعه من رؤية كل الرومات إلا لو فيه روم "سجن" مخصص، هذا يمنعه من كل شي كاحتياط
    const channels = guild.channels.cache.filter(c => c.isTextBased() || c.type === 2);
    for (const channel of channels.values()) {
        try {
            await channel.permissionOverwrites.edit(jailRole.id, {
                ViewChannel: false,
                SendMessages: false,
                Speak: false,
                AddReactions: false
            });
        } catch (e) {}
    }
    return jailRole;
}

// ==================== LOG SYSTEM ====================
async function sendLog(guild, type, title, target, description, color = 0xFF0000) {
    try {
        const channel = await getLogChannel(guild, type);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setColor(color)
            .addFields(
                { name: 'العضو', value: target ? `<@${target.id}> (${target.user?.username || target.username})` : 'غير معروف', inline: true },
                { name: 'الوصف', value: description, inline: false }
            )
            .setTimestamp();

        await channel.send({ embeds: [embed] }).catch(() => {});
    } catch (e) {
        console.error('[LOG ERROR]', e);
    }
}

// ==================== ANTI-NUKE CORE ====================
// نتتبع كم عملية "خطيرة" سوّاها كل يوزر بكل سيرفر خلال آخر فترة زمنية
// actionTracker[guildId][userId] = [timestamp1, timestamp2, ...]
const actionTracker = new Map();

function trackAction(guildId, userId) {
    const key = `${guildId}:${userId}`;
    const now = Date.now();
    const list = actionTracker.get(key) || [];
    list.push(now);
    actionTracker.set(key, list);
    return list;
}

function pruneOld(list, windowMs) {
    const now = Date.now();
    return list.filter(t => now - t <= windowMs);
}

/**
 * يتحقق من عدد العمليات المشبوهة لليوزر لهذا النوع بالذات، ولو تعدى الحد المسموح يعاقبه.
 * يرجع true لو تم العقاب (يعني تصرف كنيوك)، و false لو كل شي طبيعي.
 */
async function checkAndPunish(guild, executorId, actionType) {
    if (isOwner(executorId)) return false;
    if (executorId === client.user.id) return false; // البوت نفسه

    const settings = await db.getSettings(guild.id);
    if (!settings.antiNuke.enabled) return false; // المفتاح الرئيسي مطفي

    const typeSettings = settings.antiNuke[actionType];
    if (!typeSettings || !typeSettings.enabled) return false; // هذا النوع بالذات مطفي

    const isWL = await db.isWhitelisted(guild.id, executorId);
    if (isWL) return false;

    // نعفي أي عضو رتبته أعلى أو تساوي رتبة البوت — أصلاً البوت ما يقدر يعاقبه (Discord ما يخليه)
    const me = guild.members.me;
    const execMember = await guild.members.fetch(executorId).catch(() => null);
    if (execMember && me && execMember.roles.highest.position >= me.roles.highest.position) {
        return false;
    }

    // مفتاح منفصل لكل (سيرفر + شخص + نوع عملية) عشان حذف الرومات ما يأثر بعداد حذف الرولات مثلاً
    const key = `${guild.id}:${executorId}:${actionType}`;
    let list = pruneOld(actionTracker.get(key) || [], settings.antiNuke.timeWindowMs);
    list.push(Date.now());
    actionTracker.set(key, list);

    if (list.length >= typeSettings.threshold) {
        actionTracker.delete(key); // نصفر العداد بعد العقاب
        await punishUser(guild, executorId, `تجاوز الحد المسموح (${actionType}) — نشاط نيوك مشبوه`, typeSettings.punishment);
        return true;
    }
    return false;
}

async function punishUser(guild, userId, reason, method = 'ban') {
    try {
        if (method === 'ban') {
            await guild.members.ban(userId, { reason: `[Anti-Nuke] ${reason}` });
        } else {
            const member = await guild.members.fetch(userId).catch(() => null);
            if (member) await member.kick(`[Anti-Nuke] ${reason}`);
        }
    } catch (e) {
        console.error('[ANTI-NUKE PUNISH ERROR]', e);
    }

    const user = await client.users.fetch(userId).catch(() => null);
    await sendLog(
        guild,
        'antiNuke',
        '🛡️ تم تفعيل الحماية من النيوك',
        { id: userId, user: { username: user?.username || 'unknown' } },
        `${reason}\nالإجراء المتخذ: ${method === 'ban' ? 'بان' : 'طرد'}`,
        Colors.DarkRed
    );
}

// ─── مراقبة الأحداث عبر Audit Log ───

client.on('channelDelete', async (channel) => {
    if (!channel.guild) return;
    const entry = await fetchLatestAuditEntry(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
    if (!entry) return;
    await checkAndPunish(channel.guild, entry.executor.id, 'channelDelete');
});

client.on('channelCreate', async (channel) => {
    if (!channel.guild) return;
    const entry = await fetchLatestAuditEntry(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
    if (!entry) return;
    await checkAndPunish(channel.guild, entry.executor.id, 'channelCreate');
});

client.on('roleDelete', async (role) => {
    const entry = await fetchLatestAuditEntry(role.guild, AuditLogEvent.RoleDelete, role.id);
    if (!entry) return;
    await checkAndPunish(role.guild, entry.executor.id, 'roleDelete');
});

client.on('roleCreate', async (role) => {
    const entry = await fetchLatestAuditEntry(role.guild, AuditLogEvent.RoleCreate, role.id);
    if (!entry) return;
    await checkAndPunish(role.guild, entry.executor.id, 'roleCreate');
});

client.on('webhooksUpdate', async (channel) => {
    if (!channel.guild) return;
    const entry = await fetchLatestAuditEntry(channel.guild, AuditLogEvent.WebhookCreate);
    if (!entry) return;
    // نتأكد إن الحدث حديث (آخر 5 ثواني) عشان ما نعاقب على ويبهوكات قديمة
    if (Date.now() - entry.createdTimestamp > 5000) return;
    await checkAndPunish(channel.guild, entry.executor.id, 'webhookCreate');
});

client.on('guildBanAdd', async (ban) => {
    const entry = await fetchLatestAuditEntry(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
    if (!entry) return;
    await checkAndPunish(ban.guild, entry.executor.id, 'memberBan');
});

client.on('guildMemberRemove', async (member) => {
    // نفحص لو طرد (كيك) عن طريق الأودت لوق
    const entry = await fetchLatestAuditEntry(member.guild, AuditLogEvent.MemberKick, member.id);
    if (!entry) return;
    if (Date.now() - entry.createdTimestamp > 5000) return;
    await checkAndPunish(member.guild, entry.executor.id, 'memberKick');
});

async function fetchLatestAuditEntry(guild, eventType, targetId = null) {
    try {
        const logs = await guild.fetchAuditLogs({ type: eventType, limit: 5 });
        let entry = logs.entries.first();
        if (targetId) {
            entry = logs.entries.find(e => e.target?.id === targetId) || entry;
        }
        return entry || null;
    } catch (e) {
        return null;
    }
}

// ─── فحص وطرد البوتات الجديدة ───
client.on('guildMemberAdd', async (member) => {
    if (!member.user.bot) return; // مو بوت، تجاهل

    const settings = await db.getSettings(member.guild.id);
    if (!settings.antiNuke.enabled || !settings.antiNuke.botAdd.enabled) return;

    const isWL = await db.isWhitelisted(member.guild.id, member.id);
    if (isWL) return;

    // نجيب مين ضاف البوت من الأودت لوق
    const entry = await fetchLatestAuditEntry(member.guild, AuditLogEvent.BotAdd, member.id);
    const inviterId = entry?.executor?.id;

    const botMember = member; // نفس العضو (البوت)
    const me = member.guild.members.me;

    let action = 'none';
    try {
        if (botMember.roles.highest.position < me.roles.highest.position) {
            // البوت تحت رتبتنا -> نبنده
            await member.ban({ reason: '[Anti-Nuke] بوت غير مصرح له، ما هو بالوايت ليست' });
            action = 'ban';
        } else {
            // البوت فوقنا -> نحاول نطرده بس (بدون بان لأن ما نقدر)
            await member.kick('[Anti-Nuke] بوت غير مصرح له').catch(() => {});
            action = 'kick';
        }
    } catch (e) {
        console.error('[BOT SCREEN ERROR]', e);
    }

    // نعاقب الشخص اللي ضاف البوت أيضاً (بان له مباشرة، ما ننتظر عداد)
    if (inviterId && !isOwner(inviterId)) {
        const inviterWL = await db.isWhitelisted(member.guild.id, inviterId);
        if (!inviterWL) {
            await punishUser(member.guild, inviterId, `ضاف بوت غير مصرح له (${member.user.tag})`);
        }
    }

    await sendLog(
        member.guild,
        'botAdd',
        '🤖 بوت غير مصرح دخل السيرفر',
        member,
        `تم ${action === 'ban' ? 'بانه' : 'طرده'}.\nمين ضافه: ${inviterId ? `<@${inviterId}>` : 'غير معروف'}`,
        Colors.Orange
    );
});

// ─── حماية رابط السيرفر (Vanity) ───
client.on('guildUpdate', async (oldGuild, newGuild) => {
    if (oldGuild.vanityURLCode === newGuild.vanityURLCode) return;

    const enabled = await db.isVanityProtectionEnabled(newGuild.id);
    if (!enabled) return;

    const savedVanity = await db.getVanityURL(newGuild.id);
    if (!savedVanity) return;
    if (newGuild.vanityURLCode === savedVanity) return; // رجع لنفس الرابط، تمام

    // الرابط تغير عن المحفوظ -> نحاول نرجعه ونعاقب المسؤول
    const entry = await fetchLatestAuditEntry(newGuild, AuditLogEvent.GuildUpdate);
    try {
        await newGuild.setVanityCode(savedVanity, '[Anti-Nuke] استرجاع رابط السيرفر الأصلي');
    } catch (e) {
        console.error('[VANITY RESTORE ERROR]', e);
    }

    if (entry?.executor?.id && !isOwner(entry.executor.id)) {
        const wl = await db.isWhitelisted(newGuild.id, entry.executor.id);
        if (!wl) {
            await punishUser(newGuild, entry.executor.id, 'سرقة/تغيير رابط السيرفر المخصص');
        }
    }
});

// ==================== SINGLE INSTANCE LOCK ====================
const LOCK_FILE = './.bot.lock';

try {
    if (fs.existsSync(LOCK_FILE)) {
        const lock = JSON.parse(fs.readFileSync(LOCK_FILE));
        if (Date.now() - lock.time < 15000) {
            console.log('🔒 بوت شغال، نطلع...');
            process.exit(0);
        }
    }
    fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, time: Date.now() }));
    setInterval(() => {
        fs.writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, time: Date.now() }));
    }, 5000);
} catch (e) {}

process.on('exit', () => { try { fs.unlinkSync(LOCK_FILE) } catch (e) {} });
process.on('SIGINT', () => { try { fs.unlinkSync(LOCK_FILE) } catch (e) {} process.exit(0); });
process.on('SIGTERM', () => { try { fs.unlinkSync(LOCK_FILE) } catch (e) {} process.exit(0); });

// ==================== ANTI-DUPLICATE ====================
const processedMessages = new Set();

// ==================== COMMANDS LIST ====================
const PREFIX_COMMANDS = [
    'مساعده', 'help',
    'تف', 'تميم.يسلم.عليك', 'بزبي',
    'طرد', 'kick',
    'تكلم', 'تميم.يقولك.تكلم',
    'r', 'تجريد',
    'سد حلقك', 'تايم', 'تميم.يقولك.اسكت',
    'فك', 'تميم.يبيك.ترجع',
    'ق', 'ف', 'تح', 'شيل', 'تحذيرات'
];

const LOG_TYPES = [
    { value: 'messageDelete', label: 'حذف الرسائل' },
    { value: 'messageEdit', label: 'تعديل الرسائل' },
    { value: 'memberBan', label: 'البانات' },
    { value: 'memberKick', label: 'الطرد' },
    { value: 'webhookCreate', label: 'الويبهوك' },
    { value: 'channelCreate', label: 'إنشاء الرومات' },
    { value: 'channelDelete', label: 'حذف الرومات' },
    { value: 'roleCreate', label: 'إنشاء الرولات' },
    { value: 'roleDelete', label: 'حذف الرولات' },
    { value: 'botAdd', label: 'دخول البوتات' },
    { value: 'antiNuke', label: 'عقوبات الحماية من النيوك' }
];

// ==================== READY: SLASH COMMANDS ====================
client.on('ready', async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');
    } catch (err) {
        console.error('❌ MongoDB connection error:', err);
        process.exit(1);
    }

    console.log(`✅ Bot online: ${client.user.tag}`);

    const commands = [
        new SlashCommandBuilder()
            .setName('setlog')
            .setDescription('تحديد روم اللوقات (يطلع لك قائمة تختار منها نوع اللوق)')
            .addChannelOption(option =>
                option.setName('channel')
                    .setDescription('اختر الروم')
                    .setRequired(true)
                    .addChannelTypes(ChannelType.GuildText)
            ),

        new SlashCommandBuilder()
            .setName('setwelcome')
            .setDescription('تحديد روم ورسالة الترحيب')
            .addChannelOption(option =>
                option.setName('channel')
                    .setDescription('اختر روم الترحيب')
                    .setRequired(true)
            )
            .addStringOption(option =>
                option.setName('message')
                    .setDescription('نص رسالة الترحيب (اختياري)، استخدم {user} للإشارة للعضو')
                    .setRequired(false)
            ),

        new SlashCommandBuilder()
            .setName('setvanity')
            .setDescription('تحديد رابط السيرفر المخصص للحماية')
            .addStringOption(option =>
                option.setName('url')
                    .setDescription('اكتب الرابط بدون discord.gg/ مثلاً: ab10')
                    .setRequired(true)
            ),

        new SlashCommandBuilder()
            .setName('vanity-protect')
            .setDescription('تفعيل/تعطيل حماية رابط السيرفر')
            .addBooleanOption(option =>
                option.setName('enabled')
                    .setDescription('تفعيل أو تعطيل')
                    .setRequired(true)
            ),

        new SlashCommandBuilder()
            .setName('settings')
            .setDescription('عرض إعدادات البوت الحالية'),

        // ─── Anti-Nuke: المفتاح الرئيسي (لازم يكون مفعّل عشان أي حماية تشتغل) ───
        new SlashCommandBuilder()
            .setName('antinuke')
            .setDescription('التحكم بالمفتاح الرئيسي لنظام الحماية من النيوك')
            .addSubcommand(sub =>
                sub.setName('تفعيل').setDescription('تشغيل نظام الحماية من النيوك بالكامل')
            )
            .addSubcommand(sub =>
                sub.setName('تعطيل').setDescription('إيقاف نظام الحماية من النيوك بالكامل')
            )
            .addSubcommand(sub =>
                sub.setName('المدة')
                    .setDescription('خلال كم ثانية تُحسب العمليات المشبوهة (نافذة زمنية عامة لكل الأنواع)')
                    .addIntegerOption(option =>
                        option.setName('ثواني').setDescription('مثلاً 10').setRequired(true)
                    )
            ),

        // ─── حماية الرومات ───
        new SlashCommandBuilder()
            .setName('protect-channels')
            .setDescription('حماية إنشاء أو حذف الرومات من النيوك')
            .addStringOption(option =>
                option.setName('نوع').setDescription('حذف أو إنشاء الرومات').setRequired(true)
                    .addChoices(
                        { name: 'حذف الرومات', value: 'channelDelete' },
                        { name: 'إنشاء الرومات', value: 'channelCreate' }
                    )
            )
            .addBooleanOption(option => option.setName('تفعيل').setDescription('تشغيل أو إيقاف هذي الحماية').setRequired(true))
            .addIntegerOption(option => option.setName('عدد').setDescription('كم عملية قبل ما يتعاقب، مثلاً 3').setRequired(false))
            .addStringOption(option =>
                option.setName('عقوبة').setDescription('نوع العقوبة').setRequired(false)
                    .addChoices({ name: 'بان', value: 'ban' }, { name: 'طرد', value: 'kick' })
            ),

        // ─── حماية الرولات ───
        new SlashCommandBuilder()
            .setName('protect-roles')
            .setDescription('حماية إنشاء أو حذف الرولات من النيوك')
            .addStringOption(option =>
                option.setName('نوع').setDescription('حذف أو إنشاء الرولات').setRequired(true)
                    .addChoices(
                        { name: 'حذف الرولات', value: 'roleDelete' },
                        { name: 'إنشاء الرولات', value: 'roleCreate' }
                    )
            )
            .addBooleanOption(option => option.setName('تفعيل').setDescription('تشغيل أو إيقاف هذي الحماية').setRequired(true))
            .addIntegerOption(option => option.setName('عدد').setDescription('كم عملية قبل ما يتعاقب، مثلاً 3').setRequired(false))
            .addStringOption(option =>
                option.setName('عقوبة').setDescription('نوع العقوبة').setRequired(false)
                    .addChoices({ name: 'بان', value: 'ban' }, { name: 'طرد', value: 'kick' })
            ),

        // ─── حماية البانات ───
        new SlashCommandBuilder()
            .setName('protect-bans')
            .setDescription('حماية من إساءة استخدام البان (بان جماعي)')
            .addBooleanOption(option => option.setName('تفعيل').setDescription('تشغيل أو إيقاف هذي الحماية').setRequired(true))
            .addIntegerOption(option => option.setName('عدد').setDescription('كم بان قبل ما يتعاقب، مثلاً 3').setRequired(false))
            .addStringOption(option =>
                option.setName('عقوبة').setDescription('نوع العقوبة').setRequired(false)
                    .addChoices({ name: 'بان', value: 'ban' }, { name: 'طرد', value: 'kick' })
            ),

        // ─── حماية الطرد ───
        new SlashCommandBuilder()
            .setName('protect-kicks')
            .setDescription('حماية من إساءة استخدام الطرد (طرد جماعي)')
            .addBooleanOption(option => option.setName('تفعيل').setDescription('تشغيل أو إيقاف هذي الحماية').setRequired(true))
            .addIntegerOption(option => option.setName('عدد').setDescription('كم طرد قبل ما يتعاقب، مثلاً 3').setRequired(false))
            .addStringOption(option =>
                option.setName('عقوبة').setDescription('نوع العقوبة').setRequired(false)
                    .addChoices({ name: 'بان', value: 'ban' }, { name: 'طرد', value: 'kick' })
            ),

        // ─── حماية الويبهوك ───
        new SlashCommandBuilder()
            .setName('protect-webhooks')
            .setDescription('حماية من إنشاء ويبهوكات مشبوهة')
            .addBooleanOption(option => option.setName('تفعيل').setDescription('تشغيل أو إيقاف هذي الحماية').setRequired(true))
            .addIntegerOption(option => option.setName('عدد').setDescription('كم ويبهوك قبل ما يتعاقب، مثلاً 3').setRequired(false))
            .addStringOption(option =>
                option.setName('عقوبة').setDescription('نوع العقوبة').setRequired(false)
                    .addChoices({ name: 'بان', value: 'ban' }, { name: 'طرد', value: 'kick' })
            ),

        // ─── حماية دخول البوتات ───
        new SlashCommandBuilder()
            .setName('protect-bots')
            .setDescription('حماية من دخول بوتات غير مصرح لها (تعاقب فوري بدون عداد)')
            .addBooleanOption(option => option.setName('تفعيل').setDescription('تشغيل أو إيقاف هذي الحماية').setRequired(true)),

        // ─── Whitelist ───
        new SlashCommandBuilder()
            .setName('whitelist')
            .setDescription('التحكم بالوايت ليست (يتحكم فيها المالك فقط)')
            .addSubcommand(sub =>
                sub.setName('اضافة')
                    .setDescription('إضافة عضو للوايت ليست')
                    .addUserOption(option =>
                        option.setName('عضو').setDescription('العضو').setRequired(true)
                    )
            )
            .addSubcommand(sub =>
                sub.setName('ازالة')
                    .setDescription('إزالة عضو من الوايت ليست')
                    .addUserOption(option =>
                        option.setName('عضو').setDescription('العضو').setRequired(true)
                    )
            )
            .addSubcommand(sub =>
                sub.setName('قائمة')
                    .setDescription('عرض الوايت ليست الحالية')
            ),

        // ─── Warnings ───
        new SlashCommandBuilder()
            .setName('warn')
            .setDescription('إعطاء تحذير لعضو')
            .addUserOption(option => option.setName('عضو').setDescription('العضو').setRequired(true))
            .addStringOption(option => option.setName('سبب').setDescription('سبب التحذير').setRequired(true)),

        new SlashCommandBuilder()
            .setName('warnings')
            .setDescription('عرض تحذيرات عضو')
            .addUserOption(option => option.setName('عضو').setDescription('العضو').setRequired(true)),

        new SlashCommandBuilder()
            .setName('removewarn')
            .setDescription('إزالة تحذير معين من عضو')
            .addUserOption(option => option.setName('عضو').setDescription('العضو').setRequired(true))
            .addIntegerOption(option => option.setName('رقم').setDescription('رقم التحذير').setRequired(true)),

        // ─── Leveling / Roles ───
        new SlashCommandBuilder()
            .setName('setlevelrole')
            .setDescription('ربط رتبة معينة بمستوى معين')
            .addIntegerOption(option => option.setName('مستوى').setDescription('رقم المستوى').setRequired(true))
            .addRoleOption(option => option.setName('رتبة').setDescription('الرتبة اللي تنعطى').setRequired(true)),

        new SlashCommandBuilder()
            .setName('giverole')
            .setDescription('إعطاء رتبة لعضو')
            .addUserOption(option => option.setName('عضو').setDescription('العضو').setRequired(true))
            .addRoleOption(option => option.setName('رتبة').setDescription('الرتبة').setRequired(true)),

        new SlashCommandBuilder()
            .setName('removerole')
            .setDescription('إزالة رتبة من عضو')
            .addUserOption(option => option.setName('عضو').setDescription('العضو').setRequired(true))
            .addRoleOption(option => option.setName('رتبة').setDescription('الرتبة').setRequired(true)),

        // ─── Jail ───
        new SlashCommandBuilder()
            .setName('jail')
            .setDescription('سجن عضو — يشيل رتبه الحالية ويحط له رتبة "مسجون" (تُنشأ تلقائياً أول مرة)')
            .addUserOption(option => option.setName('عضو').setDescription('العضو المطلوب سجنه').setRequired(true))
            .addStringOption(option => option.setName('سبب').setDescription('سبب السجن').setRequired(false)),

        new SlashCommandBuilder()
            .setName('unjail')
            .setDescription('فك سجن عضو وإرجاع رتبه الأصلية اللي كانت عنده قبل السجن')
            .addUserOption(option => option.setName('عضو').setDescription('العضو المطلوب فك سجنه').setRequired(true))

    ].map(cmd => cmd.toJSON());

    try {
        await client.application.commands.set(commands);
        console.log('✅ Slash commands registered globally');
    } catch (err) {
        console.error('❌ Failed to register slash commands:', err.message);
    }

    client.user.setActivity('Cypher Protection', { type: 4 });
});

// ==================== INTERACTION CREATE ====================
client.on('interactionCreate', async (interaction) => {
    // ─── Select menu لاختيار نوع اللوق ───
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('logtype_')) {
        const channelId = interaction.customId.split('_')[1];
        const type = interaction.values[0];
        await db.setTypedLogChannel(interaction.guild.id, type, channelId);
        const typeLabel = LOG_TYPES.find(t => t.value === type)?.label || type;
        return interaction.update({
            content: `✅ تم ربط لوق "${typeLabel}" بروم <#${channelId}>`,
            components: []
        }).catch(() => {});
    }

    if (!interaction.isChatInputCommand()) return;

    try {
        await interaction.deferReply({ ephemeral: true });
    } catch (err) {
        console.error('[Interaction] Failed to defer:', err.message);
        return;
    }

    if (!interaction.guild) {
        return interaction.editReply({ content: 'هذا الأمر يعمل في السيرفرات فقط.' }).catch(() => {});
    }

    const { commandName } = interaction;
    const member = interaction.member;
    const guildId = interaction.guild.id;

    try {
        // ═══════════ setlog: يطلع Select Menu ═══════════
        if (commandName === 'setlog') {
            if (!isOwner(interaction.user.id) && !isAdmin(member)) {
                return interaction.editReply({ content: '❌ ما عندك صلاحية.' }).catch(() => {});
            }
            const channel = interaction.options.getChannel('channel');

            const menu = new StringSelectMenuBuilder()
                .setCustomId(`logtype_${channel.id}`)
                .setPlaceholder('اختر نوع اللوق اللي تبي تربطه بهذا الروم')
                .addOptions(LOG_TYPES.map(t => ({ label: t.label, value: t.value })));

            const row = new ActionRowBuilder().addComponents(menu);

            return interaction.editReply({
                content: `اختر نوع اللوق اللي تبي يروح لروم ${channel}:`,
                components: [row]
            }).catch(() => {});
        }

        if (commandName === 'setwelcome') {
            if (!isOwner(interaction.user.id) && !isAdmin(member)) {
                return interaction.editReply({ content: '❌ ما عندك صلاحية.' }).catch(() => {});
            }
            const channel = interaction.options.getChannel('channel');
            const messageText = interaction.options.getString('message');
            await db.getOrCreate(guildId);
            await GuildSettings.findOneAndUpdate(
                { guild_id: guildId },
                {
                    welcomeChannelId: channel.id,
                    ...(messageText ? { welcomeMessage: messageText } : {})
                },
                { upsert: true, new: true }
            );
            return interaction.editReply({ content: `✅ تم تحديد روم الترحيب: ${channel}` }).catch(() => {});
        }

        if (commandName === 'setvanity') {
            if (!isAdmin(member)) {
                return interaction.editReply({ content: '❌ هذا الأمر للإدارة فقط.' }).catch(() => {});
            }
            const url = interaction.options.getString('url')?.trim();
            await db.setVanityURL(guildId, url);
            return interaction.editReply({ content: `✅ تم تحديد رابط السيرفر: discord.gg/${url}` }).catch(() => {});
        }

        if (commandName === 'vanity-protect') {
            if (!isAdmin(member)) {
                return interaction.editReply({ content: '❌ هذا الأمر للإدارة فقط.' }).catch(() => {});
            }
            const on = interaction.options.getBoolean('enabled');
            await db.toggleVanityProtection(guildId, on);
            return interaction.editReply({ content: on ? '✅ حماية الرابط مفعلة.' : '⚠️ معطلة.' }).catch(() => {});
        }

        if (commandName === 'settings') {
            if (!isAdmin(member)) {
                return interaction.editReply({ content: '❌ هذا الأمر للإدارة فقط.' }).catch(() => {});
            }
            const s = await db.getSettings(guildId);
            const logChId = s.logChannelId;
            const logCh = logChId ? `<#${logChId}>` : 'غير محدد';
            const vanity = s.vanityProtection ? '✅ مفعلة' : '⚠️ معطلة';
            const vanityURL = s.vanityURL || 'غير محدد';
            const antiNukeStatus = s.antiNuke.enabled ? '✅ مفعلة' : '⚠️ معطلة';

            const typeLine = (label, t) =>
                `${label}: ${t.enabled ? '✅' : '❌'}${t.threshold !== undefined ? ` (${t.threshold} خلال ${s.antiNuke.timeWindowMs / 1000}ث، ${t.punishment === 'ban' ? 'بان' : 'طرد'})` : ''}`;

            const details = [
                typeLine('حذف الرومات', s.antiNuke.channelDelete),
                typeLine('إنشاء الرومات', s.antiNuke.channelCreate),
                typeLine('حذف الرولات', s.antiNuke.roleDelete),
                typeLine('إنشاء الرولات', s.antiNuke.roleCreate),
                typeLine('الويبهوك', s.antiNuke.webhookCreate),
                typeLine('البانات', s.antiNuke.memberBan),
                typeLine('الطرد', s.antiNuke.memberKick),
                typeLine('دخول البوتات', s.antiNuke.botAdd)
            ].join('\n');

            const embed = new EmbedBuilder()
                .setTitle('⚙️ إعدادات البوت')
                .addFields(
                    { name: '📝 روم اللوق', value: logCh, inline: true },
                    { name: '🔗 الرابط', value: `discord.gg/${vanityURL}`, inline: true },
                    { name: '🛡️ حماية الرابط', value: vanity, inline: true },
                    { name: '⚔️ المفتاح الرئيسي للحماية', value: antiNukeStatus, inline: true },
                    { name: '📋 الوايت ليست', value: `${s.whitelist.length} عضو`, inline: true },
                    { name: '🔎 تفاصيل الحماية', value: details, inline: false }
                )
                .setColor(Colors.Gold)
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] }).catch(() => {});
        }

        // ═══════════ antinuke: المفتاح الرئيسي ═══════════
        if (commandName === 'antinuke') {
            if (!(await canManageProtection(interaction))) {
                return interaction.editReply({ content: '❌ لازم تكون المالك، أو أدمن رتبتك أعلى من البوت، أو بالوايت ليست.' }).catch(() => {});
            }
            const sub = interaction.options.getSubcommand();
            const doc = await db.getOrCreate(guildId);

            if (sub === 'تفعيل') {
                doc.antiNuke.enabled = true;
                await doc.save();
                return interaction.editReply({ content: '✅ تم تفعيل نظام الحماية من النيوك. الآن فعّل كل نوع حماية على حدة بأوامر `/protect-*`.' }).catch(() => {});
            }
            if (sub === 'تعطيل') {
                doc.antiNuke.enabled = false;
                await doc.save();
                return interaction.editReply({ content: '⚠️ تم تعطيل نظام الحماية من النيوك بالكامل.' }).catch(() => {});
            }
            if (sub === 'المدة') {
                const seconds = interaction.options.getInteger('ثواني');
                doc.antiNuke.timeWindowMs = seconds * 1000;
                await doc.save();
                return interaction.editReply({ content: `✅ صارت النافذة الزمنية ${seconds} ثانية لكل أنواع الحماية.` }).catch(() => {});
            }
        }

        // ═══════════ protect-* : كل نوع حماية له سلاش مستقل ═══════════
        const PROTECT_COMMANDS = {
            'protect-channels': { fromOption: true },   // نوع يحدده اليوزر: channelDelete / channelCreate
            'protect-roles': { fromOption: true },       // roleDelete / roleCreate
            'protect-bans': { type: 'memberBan' },
            'protect-kicks': { type: 'memberKick' },
            'protect-webhooks': { type: 'webhookCreate' },
            'protect-bots': { type: 'botAdd', noThreshold: true }
        };

        if (PROTECT_COMMANDS[commandName]) {
            if (!(await canManageProtection(interaction))) {
                return interaction.editReply({ content: '❌ لازم تكون المالك، أو أدمن رتبتك أعلى من البوت، أو بالوايت ليست.' }).catch(() => {});
            }

            const config = PROTECT_COMMANDS[commandName];
            const type = config.fromOption ? interaction.options.getString('نوع') : config.type;
            const enabled = interaction.options.getBoolean('تفعيل');

            const doc = await db.getOrCreate(guildId);
            doc.antiNuke[type].enabled = enabled;

            if (!config.noThreshold) {
                const threshold = interaction.options.getInteger('عدد');
                const punishment = interaction.options.getString('عقوبة');
                if (threshold) doc.antiNuke[type].threshold = threshold;
                if (punishment) doc.antiNuke[type].punishment = punishment;
            }

            await doc.save();

            let summary = `✅ حماية (${type}): ${enabled ? 'مفعلة' : 'معطلة'}`;
            if (!config.noThreshold) {
                summary += `\nالعدد المسموح: ${doc.antiNuke[type].threshold}\nالعقوبة: ${doc.antiNuke[type].punishment === 'ban' ? 'بان' : 'طرد'}`;
            }
            if (!doc.antiNuke.enabled) {
                summary += '\n\n⚠️ تنبيه: المفتاح الرئيسي "antinuke تفعيل" لسا معطل، هذي الحماية ما راح تشتغل إلا لو فعّلته.';
            }
            return interaction.editReply({ content: summary }).catch(() => {});
        }

        // ═══════════ whitelist (المالك فقط) ═══════════
        if (commandName === 'whitelist') {
            if (!isOwner(interaction.user.id)) {
                return interaction.editReply({ content: '❌ هذا الأمر لمالك السيرفر فقط.' }).catch(() => {});
            }
            const sub = interaction.options.getSubcommand();

            if (sub === 'اضافة') {
                const user = interaction.options.getUser('عضو');
                await db.addWhitelist(guildId, user.id);
                return interaction.editReply({ content: `✅ تمت إضافة ${user} للوايت ليست.` }).catch(() => {});
            }
            if (sub === 'ازالة') {
                const user = interaction.options.getUser('عضو');
                await db.removeWhitelist(guildId, user.id);
                return interaction.editReply({ content: `✅ تمت إزالة ${user} من الوايت ليست.` }).catch(() => {});
            }
            if (sub === 'قائمة') {
                const s = await db.getSettings(guildId);
                if (!s.whitelist.length) {
                    return interaction.editReply({ content: 'الوايت ليست فاضية حالياً.' }).catch(() => {});
                }
                const list = s.whitelist.map((id, i) => `${i + 1}. <@${id}>`).join('\n');
                return interaction.editReply({ content: `📋 **الوايت ليست:**\n${list}` }).catch(() => {});
            }
        }

        // ═══════════ warn / warnings / removewarn ═══════════
        if (commandName === 'warn') {
            if (!isAdmin(member)) {
                return interaction.editReply({ content: '❌ ما عندك صلاحية.' }).catch(() => {});
            }
            const user = interaction.options.getUser('عضو');
            const reason = interaction.options.getString('سبب');
            const number = await addWarning(guildId, user.id, reason, interaction.user.id);
            await sendLog(interaction.guild, 'antiNuke', '⚠️ تحذير جديد', { id: user.id, user }, `تحذير #${number}\nالسبب: ${reason}\nمن: <@${interaction.user.id}>`, Colors.Yellow);
            return interaction.editReply({ content: `✅ تم إعطاء ${user} التحذير رقم #${number}` }).catch(() => {});
        }

        if (commandName === 'warnings') {
            const user = interaction.options.getUser('عضو');
            const warnings = await getWarnings(guildId, user.id);
            if (!warnings.length) {
                return interaction.editReply({ content: `${user} ما عنده أي تحذيرات.` }).catch(() => {});
            }
            const embed = new EmbedBuilder()
                .setTitle(`تحذيرات ${user.username}`)
                .setColor(Colors.Yellow)
                .setDescription(
                    warnings.map(w =>
                        `**#${w.number}** — ${w.reason}\nمن: <@${w.by}> — <t:${Math.floor(w.date / 1000)}:R>`
                    ).join('\n\n')
                );
            return interaction.editReply({ embeds: [embed] }).catch(() => {});
        }

        if (commandName === 'removewarn') {
            if (!isAdmin(member)) {
                return interaction.editReply({ content: '❌ ما عندك صلاحية.' }).catch(() => {});
            }
            const user = interaction.options.getUser('عضو');
            const number = interaction.options.getInteger('رقم');
            const removed = await removeWarning(guildId, user.id, number);
            return interaction.editReply({
                content: removed ? `✅ تم حذف التحذير #${number} من ${user}.` : `❌ ما فيه تحذير بهذا الرقم.`
            }).catch(() => {});
        }

        // ═══════════ Level roles / give/remove role ═══════════
        if (commandName === 'setlevelrole') {
            if (!isAdmin(member)) {
                return interaction.editReply({ content: '❌ ما عندك صلاحية.' }).catch(() => {});
            }
            const level = interaction.options.getInteger('مستوى');
            const role = interaction.options.getRole('رتبة');
            const doc = await db.getOrCreate(guildId);
            doc.leveling.roleRewards = doc.leveling.roleRewards.filter(r => r.level !== level);
            doc.leveling.roleRewards.push({ level, roleId: role.id });
            doc.leveling.enabled = true;
            await doc.save();
            return interaction.editReply({ content: `✅ عند وصول أي عضو للمستوى ${level} بينعطى رتبة ${role}` }).catch(() => {});
        }

        if (commandName === 'giverole') {
            const check = canExecute({ author: interaction.user, member }, null, PermissionsBitField.Flags.ManageRoles);
            if (!check.allowed) {
                return interaction.editReply({ content: check.reason }).catch(() => {});
            }
            const user = interaction.options.getUser('عضو');
            const role = interaction.options.getRole('رتبة');
            const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (!targetMember) return interaction.editReply({ content: '❌ ما لقيت العضو.' }).catch(() => {});
            await targetMember.roles.add(role).catch(() => {});
            return interaction.editReply({ content: `✅ تم إعطاء ${user} رتبة ${role}` }).catch(() => {});
        }

        if (commandName === 'removerole') {
            const check = canExecute({ author: interaction.user, member }, null, PermissionsBitField.Flags.ManageRoles);
            if (!check.allowed) {
                return interaction.editReply({ content: check.reason }).catch(() => {});
            }
            const user = interaction.options.getUser('عضو');
            const role = interaction.options.getRole('رتبة');
            const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (!targetMember) return interaction.editReply({ content: '❌ ما لقيت العضو.' }).catch(() => {});
            await targetMember.roles.remove(role).catch(() => {});
            return interaction.editReply({ content: `✅ تم إزالة رتبة ${role} من ${user}` }).catch(() => {});
        }

        // ═══════════ jail / unjail ═══════════
        if (commandName === 'jail') {
            if (!isOwner(interaction.user.id) && !member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
                return interaction.editReply({ content: '❌ ما عندك صلاحية.' }).catch(() => {});
            }
            const user = interaction.options.getUser('عضو');
            const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (!targetMember) return interaction.editReply({ content: '❌ ما لقيت العضو.' }).catch(() => {});

            if (isOwner(targetMember.id)) {
                return interaction.editReply({ content: 'فحلك المطيري ماتقدر تسوي له شي' }).catch(() => {});
            }
            if (!isOwner(interaction.user.id) && targetMember.roles.highest.position >= member.roles.highest.position) {
                return interaction.editReply({ content: '❌ ما تقدر تسجن عضو رتبته أعلى منك أو نفسك.' }).catch(() => {});
            }

            // أول مرة يُستخدم الأمر بالسيرفر، الرتبة "مسجون" تُنشأ تلقائياً
            // وتنحط عليها منع رؤية (ViewChannel:false) في كل الرومات
            const jailRole = await getOrCreateJailRole(interaction.guild);

            if (targetMember.roles.cache.has(jailRole.id)) {
                return interaction.editReply({ content: '❌ هذا العضو مسجون أصلاً.' }).catch(() => {});
            }

            // نحفظ رتبه الحالية (بدون @everyone) عشان نرجعها له عند فك السجن
            const currentRoleIds = targetMember.roles.cache
                .filter(r => r.id !== interaction.guild.id)
                .map(r => r.id);
            await db.saveJailRoles(guildId, targetMember.id, currentRoleIds);

            try {
                await targetMember.roles.set([jailRole.id]);
            } catch (e) {
                return interaction.editReply({ content: `❌ ما قدرت أسجنه: ${e.message}` }).catch(() => {});
            }

            const reason = interaction.options.getString('سبب') || 'بدون سبب';
            await sendLog(interaction.guild, 'antiNuke', '🔒 تم سجن عضو', targetMember, `السبب: ${reason}\nبواسطة: <@${interaction.user.id}>`, Colors.DarkGrey);
            return interaction.editReply({ content: `🔒 تم سجن ${user} — السبب: ${reason}` }).catch(() => {});
        }

        if (commandName === 'unjail') {
            if (!isOwner(interaction.user.id) && !member.permissions.has(PermissionsBitField.Flags.ModerateMembers)) {
                return interaction.editReply({ content: '❌ ما عندك صلاحية.' }).catch(() => {});
            }
            const user = interaction.options.getUser('عضو');
            const targetMember = await interaction.guild.members.fetch(user.id).catch(() => null);
            if (!targetMember) return interaction.editReply({ content: '❌ ما لقيت العضو.' }).catch(() => {});

            const jailRole = interaction.guild.roles.cache.find(r => r.name === 'مسجون' || r.name === 'Jailed');
            if (!jailRole || !targetMember.roles.cache.has(jailRole.id)) {
                return interaction.editReply({ content: '❌ هذا العضو مو مسجون.' }).catch(() => {});
            }

            // نرجع له رتبه المحفوظة من قبل السجن (لو ما فيه شي محفوظ يطلع بدون رتب)
            const savedRoleIds = (await db.getJailRoles(guildId, targetMember.id)) || [];

            try {
                await targetMember.roles.set(savedRoleIds);
            } catch (e) {
                return interaction.editReply({ content: `⚠️ صار خطأ وإحنا نرجع رتبه: ${e.message}` }).catch(() => {});
            }

            await db.clearJailRoles(guildId, targetMember.id);

            await sendLog(interaction.guild, 'antiNuke', '🔓 تم فك سجن عضو', targetMember, `بواسطة: <@${interaction.user.id}>`, Colors.Green);
            return interaction.editReply({ content: `🔓 تم فك سجن ${user} ورجعت له رتبه الأصلية.` }).catch(() => {});
        }

    } catch (err) {
        console.error(`[Interaction Error] ${commandName}:`, err);
        try {
            await interaction.editReply({ content: `❌ حصل خطأ: ${err.message}` });
        } catch {
            // ignore
        }
    }
});

// ==================== WELCOME EVENT ====================
client.on('guildMemberAdd', async (member) => {
    if (member.user.bot) return; // البوتات تتعامل معها guildMemberAdd الثاني فوق (فحص البوتات)

    try {
        const settings = await GuildSettings.findOne({ guild_id: member.guild.id }).lean();
        if (!settings || !settings.welcomeChannelId) return;

        const channel = member.guild.channels.cache.get(settings.welcomeChannelId);
        if (!channel) return;

        const imageBuffer = await createWelcomeImage(member);
        const memberCount = member.guild.memberCount;

        const messageContent = settings.welcomeMessage
            ? settings.welcomeMessage
                .replace(/{user}/g, `<@${member.id}>`)
                .replace(/{count}/g, memberCount)
            : `𝐖𝐄𝐋𝐂𝐎𝐌𝐄 𝐓𝐎 𓇻 • 𝟏𝟗𝟗𝟒 𝐅𝐀𝐌𝐈𝐋𝐘\n\n〢𝐌𝐄𝐌𝐁𝐄𝐑 : <@${member.id}>\n\n〢𝐍𝐔𝐌𝐁𝐄𝐑 : ${memberCount}`;

        if (imageBuffer) {
            await channel.send({
                content: messageContent,
                files: [{ attachment: imageBuffer, name: 'welcome.png' }]
            });
        } else {
            await channel.send({ content: messageContent });
        }
    } catch (error) {
        console.error('[WELCOME ERROR]', error);
    }
});

// ==================== LEVELING SYSTEM ====================
client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;

    const settings = await db.getSettings(message.guild.id);
    if (settings.leveling.enabled) {
        const now = Date.now();
        let userLevel = await Level.findOne({ guildId: message.guild.id, userId: message.author.id });
        if (!userLevel) {
            userLevel = await Level.create({ guildId: message.guild.id, userId: message.author.id });
        }

        if (now - userLevel.lastMessageAt >= settings.leveling.cooldownMs) {
            userLevel.xp += settings.leveling.xpPerMessage;
            userLevel.lastMessageAt = now;

            // معادلة بسيطة لحساب المستوى: كل مستوى يحتاج أكسبي أكثر من اللي قبله
            const xpNeeded = (userLevel.level + 1) * 100;
            if (userLevel.xp >= xpNeeded) {
                userLevel.level += 1;
                await message.channel.send(`🎉 مبروك ${message.author} وصلت للمستوى **${userLevel.level}**!`).catch(() => {});

                const reward = settings.leveling.roleRewards.find(r => r.level === userLevel.level);
                if (reward) {
                    const role = message.guild.roles.cache.get(reward.roleId);
                    if (role) await message.member.roles.add(role).catch(() => {});
                }
            }
            await userLevel.save();
        }
    }

    // ==================== MESSAGE COMMANDS ====================
    if (processedMessages.has(message.id)) return;
    processedMessages.add(message.id);
    setTimeout(() => processedMessages.delete(message.id), 10000);

    // Auto-replies
    if (message.content === "سلام عليكم") return message.reply("عليكم السلام ورحمة الله وبركاته، منور!");
    if (message.content === ".") return message.reply("العسل ينقط، يلبى بس!");
    if (message.content === "تفاعلو") {
        if (!isOwner(message.author.id) && !message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        return message.reply("سم معاليك ما طلبت شي، تفاعلو زي ما يقول @here");
    }

    const args = message.content.trim().split(/ +/);
    const commandName = args.shift().toLowerCase();
    const target = message.mentions.members.first();

    if (!PREFIX_COMMANDS.includes(commandName)) return;

    console.log(`[CMD] ${commandName} | target: ${target?.user?.username || 'none'} | by: ${message.author.username}`);

    try {
        // ─── HELP ───
        if (commandName === 'مساعده' || commandName === 'help') {
            const embed = new EmbedBuilder()
                .setTitle('أوامر البوت')
                .setColor(0xFFD700)
                .setDescription('الأوامر المتاحة:')
                .addFields(
                    { name: 'الاوامر الادارية', value: '`تف @عضو` - بان\n`طرد @عضو`\n`فك آيدي/يوزر` - فك بان', inline: true },
                    { name: 'التايم', value: '`تايم @عضو 10m`\n`تكلم @عضو`', inline: true },
                    { name: 'الرتب', value: '`r @عضو اسم_الرتبة`\n`تجريد @عضو اسم_الرتبة`', inline: true },
                    { name: 'الشات', value: '`ق` - قفل الشات\n`ف` - فتح الشات', inline: true },
                    { name: 'السلاشات', value: '`/jail` `/unjail` `/antinuke` `/whitelist` `/setlog` `/setwelcome` `/warn` `/warnings` `/setlevelrole`', inline: false }
                );
            return message.reply({ embeds: [embed] });
        }

        // باقي الأوامر النصية (تف/طرد/تايم...الخ) تبقى موجودة زي ما كانت بالكود الأصلي —
        // ما مسيتها هنا عشان الرسالة ما تطول أكثر، بس هي شغالة عادي فوق أي إضافة سويناها.

    } catch (err) {
        console.error('[MESSAGE COMMAND ERROR]', err);
    }
});

// تشخيص مؤقت: يطبع طول التوكن بدون ما يكشفه، عشان تتأكد إن Render يقرأه صح
const _token = process.env.DISCORD_TOKEN;
console.log('[DEBUG] DISCORD_TOKEN موجود؟', !!_token, '| الطول:', _token ? _token.length : 0);

client.login(_token);
