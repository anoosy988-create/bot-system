require('dotenv').config();
const {
    Client,
    GatewayIntentBits,
    PermissionsBitField,
    EmbedBuilder,
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelType,
    AttachmentBuilder,
    AuditLogEvent
} = require('discord.js');

const mongoose = require('mongoose');
const express = require('express');
const { createCanvas, loadImage } = require('@napi-rs/canvas');


// ======================================================
// ENV
// ======================================================

const TOKEN = process.env.TOKEN;
const MONGO_URI = process.env.MONGO_URI;

const OWNER_ID = '1364275261398581279';

if (!TOKEN) {
    console.error('❌ TOKEN غير موجود في Environment Variables.');
    process.exit(1);
}

if (!MONGO_URI) {
    console.error('❌ MONGO_URI غير موجود في Environment Variables.');
    process.exit(1);
}


// ======================================================
// WEB SERVER - RENDER
// ======================================================

const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
    res.send('Cypher Security Bot is active!');
});

app.listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT}`);
});


// ======================================================
// CLIENT
// ======================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildModeration
    ]
});


// ======================================================
// HELPERS
// ======================================================

function isOwner(userId) {
    return userId === OWNER_ID;
}

// الرتبة المخوّلة لاستخدام الأوامر (يجب أن تكون فوق رتبة البوت)
const STAFF_ROLE_NAME = process.env.STAFF_ROLE_NAME || 'ستريتر';

// إرجاع رتبة الصلاحيات في سيرفر معين
function getStaffRole(guild) {
    return guild?.roles?.cache?.find(
        role => role.name === STAFF_ROLE_NAME
    ) || null;
}

// هل العضو يملك رتبة الصلاحيات؟
function memberHasStaffRole(member, guild) {
    if (!member || !guild) return false;
    if (member.id === OWNER_ID) return true;

    const staffRole = getStaffRole(guild);
    if (!staffRole) return false;

    return member.roles.cache.has(staffRole.id);
}

function isAdmin(interaction) {
    return memberHasStaffRole(interaction.member, interaction.guild);
}

// فحص كامل لاستخدام الأوامر مع رسائل توضيحية
async function requireStaffPermission(interaction) {
    if (isOwner(interaction.user.id)) return true;

    const member = interaction.member;
    const guild = interaction.guild;

    const replyContent = async content => {
        const options = { content, ephemeral: true };

        if (interaction.replied || interaction.deferred) {
            return interaction.followUp(options);
        }

        return interaction.reply(options);
    };

    const staffRole = getStaffRole(guild);

    if (!staffRole) {
        return replyContent(
            `❌ ما فيه رتبة **${STAFF_ROLE_NAME}** في السيرفر.\n` +
            `أنشئها واجعلها **فوق** رتبة البوت حتى تشتغل الأوامر.`
        );
    }

    if (!memberHasStaffRole(member, guild)) {
        return replyContent(
            `❌ تحتاج رتبة **${STAFF_ROLE_NAME}** لاستخدام هذا الأمر.`
        );
    }

    const botHighest = guild?.members?.me?.roles?.highest;

    if (botHighest && staffRole.position <= botHighest.position) {
        return replyContent(
            `❌ رتبة **${STAFF_ROLE_NAME}** لازم تكون **فوق** رتبة البوت.\n` +
            `من إعدادات السيرفر: Roles = ارفع رتبة **${STAFF_ROLE_NAME}** فوق رتبة البوت ثم أعد المحاولة.`
        );
    }

    return true;
}

async function requireAdmin(interaction) {
    return (await requireStaffPermission(interaction)) === true;
}

function normalizeText(text) {
    return String(text || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

function safeChannelName(channel) {
    return channel?.name ? `#${channel.name}` : 'غير معروف';
}

async function sendLog(guild, type, title, description, color = 0x5865F2) {
    try {
        const settings = await GuildSettings.findById(guild.id);

        if (!settings) return;

        const channelId = settings.logs?.[type];

        if (!channelId) return;

        const channel = guild.channels.cache.get(channelId);

        if (!channel || !channel.isTextBased()) return;

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(color)
            .setTimestamp();

        await channel.send({ embeds: [embed] }).catch(() => {});
    } catch (err) {
        console.error('Log error:', err);
    }
}


// ======================================================
// MONGODB SCHEMAS
// ======================================================

const guildSchema = new mongoose.Schema({
    _id: {
        type: String,
        required: true
    },

    welcome: {
        enabled: {
            type: Boolean,
            default: false
        },

        channelId: {
            type: String,
            default: null
        },

        message: {
            type: String,
            default: 'أهلاً بك {user} في السيرفر ❤️'
        },

        cardEnabled: {
            type: Boolean,
            default: true
        }
    },

    logs: {
        voice: {
            type: String,
            default: null
        },

        role: {
            type: String,
            default: null
        },

        channel: {
            type: String,
            default: null
        },

        webhook: {
            type: String,
            default: null
        },

        member: {
            type: String,
            default: null
        },

        moderation: {
            type: String,
            default: null
        },

        message: {
            type: String,
            default: null
        }
    },

    autoResponses: {
        type: [
            {
                trigger: String,
                response: String
            }
        ],
        default: []
    },

    shortcuts: {
        type: [
            {
                name: String,
                command: String
            }
        ],
        default: []
    },

    levelSettings: {
        enabled: {
            type: Boolean,
            default: true
        },

        messagesPerLevel: {
            type: Number,
            default: 50
        },

        rewards: {
            type: Map,
            of: String,
            default: new Map()
        }
    },

    protections: {
        channels: {
            enabled: { type: Boolean, default: false },
            limit: { type: Number, default: 5 },
            timeframe: { type: Number, default: 60000 },
            action: { type: String, default: 'ban' }
        },
        roles: {
            enabled: { type: Boolean, default: false },
            limit: { type: Number, default: 5 },
            timeframe: { type: Number, default: 60000 },
            action: { type: String, default: 'ban' }
        },
        bans: {
            enabled: { type: Boolean, default: false },
            limit: { type: Number, default: 3 },
            timeframe: { type: Number, default: 60000 },
            action: { type: String, default: 'kick' }
        },
        bots: {
            enabled: { type: Boolean, default: false }
        },
        spam: {
            enabled: { type: Boolean, default: false },
            limit: { type: Number, default: 5 },
            timeframe: { type: Number, default: 5000 },
            maxLength: { type: Number, default: 400 },
            repeatedChar: { type: Number, default: 8 },
            action: { type: String, default: 'timeout' }
        },
        webhooks: {
            enabled: { type: Boolean, default: false },
            limit: { type: Number, default: 5 },
            timeframe: { type: Number, default: 60000 },
            action: { type: String, default: 'ban' }
        }
    },

    autoRole: {
        enabled: {
            type: Boolean,
            default: false
        },
        roleId: {
            type: String,
            default: null
        }
    },

    whitelist: {
        type: [String],
        default: []
    }
});

const GuildSettings = mongoose.model(
    'GuildSettings',
    guildSchema
);


const jailSchema = new mongoose.Schema({
    guildId: String,
    userId: String,
    roles: [String]
});

const JailData = mongoose.model(
    'JailData',
    jailSchema
);


const levelSchema = new mongoose.Schema({
    guildId: String,
    userId: String,
    messages: {
        type: Number,
        default: 0
    },
    level: {
        type: Number,
        default: 0
    }
});

const UserLevel = mongoose.model(
    'UserLevel',
    levelSchema
);


// ======================================================
// DEFAULT SETTINGS
// ======================================================

// إصلاح تلقائي لأي حقل وصل بقاعدة البيانات بشكل خاطئ
// (مثل shortcuts أو autoResponses محفوظة ككائن بدلاً من مصفوفة)
function sanitizeSettings(settings) {
    let changed = false;

    const fixArray = path => {
        const raw = settings[path];

        if (raw === undefined || raw === null) {
            settings[path] = [];
            settings.markModified(path);
            changed = true;
            return;
        }

        if (Array.isArray(raw)) return;

        // كائن قديم (مثل {0:{...},1:{...}}): حولنا إلى مصفوفة
        let fixed = [];

        if (typeof raw === 'object') {
            const values = Object.values(raw);
            fixed = values.filter(
                v => v && typeof v === 'object'
            );
        }

        settings[path] = fixed;
        settings.markModified(path);
        changed = true;
    };

    fixArray('shortcuts');
    fixArray('autoResponses');

    // levelSettings.rewards يجب أن يكون Map وليس كائناً
    try {
        const rewards = settings.levelSettings?.rewards;

        if (rewards && !(rewards instanceof mongoose.Types.Map)) {
            const entries = rewards && typeof rewards.toObject === 'function'
                ? rewards.toObject()
                : rewards;

            if (entries && typeof entries === 'object' && !Array.isArray(entries)) {
                settings.levelSettings.rewards =
                    new Map(Object.entries(entries));
                settings.markModified('levelSettings.rewards');
                changed = true;
            }
        }
    } catch {}

    // autoRole: التأكد من وجوده بالشكل الصحيح
    const ar = settings.autoRole;

    if (!ar || typeof ar !== 'object' || Array.isArray(ar) ||
        ar.enabled === undefined || ar.roleId === undefined) {

        settings.autoRole = {
            enabled: !ar ? false : (ar.enabled === undefined ? false : !!ar.enabled),
            roleId: !ar ? null : (ar.roleId === undefined || ar.roleId === null ? null : String(ar.roleId))
        };
        settings.markModified('autoRole');
        changed = true;
    }

    return changed;
}

// سيرفرات تم إصلاح حقولها في القاعدة (حتى لا يتكرر الإصلاح مع كل رسالة)
const repairedSettingGuilds = new Set();

async function getSettings(guildId) {
    let settings;

    try {
        settings = await GuildSettings.findById(guildId);
    } catch {
        settings = null;
    }

    // إصلاح قسري مباشرة في القاعدة: إجبار الحقول الفاسدة على مصفوفات نظيفة
    // (مرة واحدة لكل سيرفر) لضمان عدم وجود كائن مكان مصفوفة إطلاقاً
    if (!repairedSettingGuilds.has(guildId)) {
        let repairOk = true;

        try {
            const current = await GuildSettings.collection.findOne({ _id: guildId });

            if (current) {
                const patch = {};

                if (!Array.isArray(current.shortcuts)) patch.shortcuts = [];
                if (!Array.isArray(current.autoResponses)) patch.autoResponses = [];

                if (
                    current.levelSettings &&
                    typeof current.levelSettings.rewards === 'object' &&
                    !Array.isArray(current.levelSettings.rewards)
                ) {
                    patch['levelSettings.rewards'] = {};
                }

                if (Object.keys(patch).length) {
                    await GuildSettings.collection.updateOne(
                        { _id: guildId },
                        { $set: patch }
                    );
                    console.log(
                        `🔧 Repaired corrupted settings for server ${guildId}`
                    );
                }
            }
        } catch (error) {
            repairOk = false;
            console.error('Settings force repair error:', error);
        }

        if (repairOk) repairedSettingGuilds.add(guildId);

        // إعادة تحميل النسخة النظيفة بعد الإصلاح
        try {
            settings = await GuildSettings.findById(guildId);
        } catch {
            settings = null;
        }
    }

    if (!settings) {
        settings = await GuildSettings.create({
            _id: guildId
        });
    }

    // إصلاح الحقول الفاسدة في الذاكرة ومواكبتها فوراً
    try {
        if (sanitizeSettings(settings)) {
            await settings.save().catch(() => {});
        }
    } catch (error) {
        console.error('Settings sanitize error:', error);
    }

    return settings;
}



// ======================================================
// WELCOME CARD (Canvas Image)
// ======================================================

async function createWelcomeCard(member) {
    const canvas = createCanvas(800, 350);
    const ctx = canvas.getContext('2d');

    // خلفية متدرجة
    const bg = ctx.createLinearGradient(0, 0, 800, 350);
    bg.addColorStop(0, '#1e1f22');
    bg.addColorStop(1, '#2b2d31');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 800, 350);

    // خطوط زخرفية
    ctx.strokeStyle = '#5865F2';
    ctx.lineWidth = 8;
    ctx.strokeRect(12, 12, 776, 326);

    // الصورة الشخصية
    const avatar = await loadImage(
        member.user.displayAvatarURL({ extension: 'png', size: 256 })
    );

    ctx.save();
    ctx.beginPath();
    ctx.arc(400, 115, 75, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, 325, 40, 150, 150);
    ctx.restore();

    ctx.beginPath();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 6;
    ctx.arc(400, 115, 75, 0, Math.PI * 2);
    ctx.stroke();

    // النصوص
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 34px "Segoe UI", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('WELCOME TO THE SERVER', 400, 245);

    ctx.fillStyle = '#5865F2';
    ctx.font = 'bold 28px "Segoe UI", Arial, sans-serif';
    ctx.fillText(member.user.username, 400, 285);

    ctx.fillStyle = '#b5bac1';
    ctx.font = '20px "Segoe UI", Arial, sans-serif';
    ctx.fillText(`Member #${member.guild.memberCount}`, 400, 318);

    return await canvas.encode('png');
}

function formatWelcomeMessage(template, member) {
    return String(template || '')
        .replace(/\{user\}/gi, `<@${member.id}>`)
        .replace(/\{username\}/gi, member.user.username)
        .replace(/\{tag\}/gi, member.user.tag)
        .replace(/\{id\}/gi, member.id)
        .replace(/\{count\}/gi, String(member.guild.memberCount))
        .replace(/\{server\}/gi, member.guild.name);
}


// ======================================================
// ANTI-NUKE PROTECTION (Channels / Roles / Bans / Bots)
// ======================================================

// عدّادات لكل فضية داخل فترة زمنية
const protectionCounts = {
    channels: new Map(),
    roles: new Map(),
    bans: new Map(),
    spam: new Map(),
    webhooks: new Map()
};

// عدّاد تحذيرات السبام لكل عضو (قبل تطبيق Time-out)
// { count, last }
const spamWarnCounts = new Map();

// فترة صلاحية التحذيرين (لو ما كرر السبام خلالها يصفّر العدّاد)
const SPAM_WARN_WINDOW = 10 * 60 * 1000;

// مدة الـ Time-out عند تجاوز التحذيرين
const SPAM_TIMEOUT_MS = 10 * 60 * 1000;

function recordEvent(counterKey, guildId, userId) {
    const key = `${guildId}-${userId}`;
    return key;
}

async function getAuditExecutor(guild, type, targetId = null) {
    try {
        const audit = await guild.fetchAuditLogs({ type, limit: 1 });
        const entry = audit.entries.first();

        if (!entry) return null;
        if (Date.now() - entry.createdTimestamp > 15000) return null;
        if (targetId && entry.targetId !== targetId) return null;

        return entry.executor?.id || null;
    } catch {
        return null;
    }
}

// إرجاع منشن من نفّذ الفعل من سجل التدقيق
async function executorMention(guild, type, targetId = null) {
    const id = await getAuditExecutor(guild, type, targetId);
    return id ? `<@${id}>` : 'غير معروف';
}

function isLimitExceeded(counter, key, now, limit, timeframe) {
    const list = (counter.get(key) || [])
        .filter(t => now - t <= timeframe);

    list.push(now);
    counter.set(key, list);

    return list.length > limit;
}

async function applyPunishment(member, action, reason) {
    if (!member) return;

    const fullReason = `[Anti-Nuke] ${reason}`;

    try {
        if (action === 'ban') {
            if (member.bannable) await member.ban({ reason: fullReason });
        } else if (action === 'kick') {
            if (member.kickable) await member.kick(fullReason);
        } else if (action === 'timeout') {
            if (member.moderatable) {
                await member.timeout(SPAM_TIMEOUT_MS, fullReason);
            }
        } else if (action === 'removeroles') {
            const removable = member.roles.cache.filter(
                role => role.id !== member.guild.id && role.editable
            );
            if (removable.size) {
                await member.roles.remove(removable, fullReason);
            }
        }
    } catch (error) {
        console.error('Punishment error:', error);
    }
}

async function getMember(guild, userId) {
    return guild.members.fetch(userId).catch(() => null);
}

// فحص صلاحية التجاوز عن الحماية (وايت ليست / مالك البوت / فوق رتبة البوت)
async function protectionAllowed(guild, member, settings) {
    if (!member) return { allowed: true };

    if (member.id === OWNER_ID) {
        return { allowed: true, level: 'owner' };
    }

    if (
        settings?.whitelist &&
        Array.isArray(settings.whitelist) &&
        settings.whitelist.includes(member.id)
    ) {
        return { allowed: true, level: 'whitelist' };
    }

    const botHighest = guild?.members?.me?.roles?.highest;

    if (!botHighest) {
        return { allowed: true, level: 'unknown' };
    }

    const pos = member.roles.highest?.position ?? -1;

    if (pos > botHighest.position) {
        return { allowed: true, level: 'above' };
    }

    if (pos === botHighest.position) {
        return { allowed: false, level: 'equal' };
    }

    return { allowed: false, level: 'below' };
}

// حذف جميع الويب هوك في السيرفر بسرعة
async function deleteAllWebhooks(guild) {
    try {
        const hooks = await guild.fetchWebhooks();

        for (const hook of hooks.values()) {
            await hook.delete('[Anti-Nuke] Webhook Protection').catch(() => {});
        }

        return hooks.size;
    } catch (error) {
        console.error('Webhook cleanup error:', error);
        return 0;
    }
}

// حماية الويب هوك:
//  - الإنشاء: مسموح حتى "الحد" المحدد، وعند التجاوز → عقوبة + حذف كل الويب هوك
//  - الحذف/التعديل من غير مخوّل → حذف كل الويب هوك فوراً
//  - تحت رتبة البوت: عقوبة | بنفس رتبة البوت: حذف فقط
//  - وايت ليست / فوق رتبة البوت / المالك: لا نتدخل
async function runWebhookProtection(guild, auditType, webhookId, label) {
    try {
        const settings = await getSettings(guild.id);
        ensureProtections(settings);
        const prot = settings.protections.webhooks;

        if (!prot || !prot.enabled) return;

        const executorId = await getAuditExecutor(guild, auditType, webhookId);

        if (!executorId || executorId === client.user.id) return;

        const member = await getMember(guild, executorId);
        const check = protectionAllowed(guild, member, settings);

        if (check.allowed) return;

        // ==========================================
        // إنشاء ويب هوك: نحدّ عدد المسموح خلال الفترة
        // ==========================================
        if (auditType === AuditLogEvent.WebhookCreate) {

            const now = Date.now();
            const key = `${guild.id}-${executorId}`;
            const timeframe = prot.timeframe || 60000;
            const limit = prot.limit || 5;

            const exceeded = isLimitExceeded(
                protectionCounts.webhooks,
                key,
                now,
                limit,
                timeframe
            );

            // ضمن الحد المسموح: لا نتدخل
            if (!exceeded) {
                await sendLog(
                    guild,
                    'moderation',
                    '🛡️ Webhook Created (Within Limit)',
                    `<@${executorId}> أنشأ ويب هوك — ضمن الحد المسموح (**${limit}** خلال ${Math.round(timeframe / 1000)} ث).`
                );
                return;
            }

            // تجاوز الحد: عقوبة (لو تحت) + حذف كل الويب هوك
            const exceededDeletedCount = await deleteAllWebhooks(guild);

            if (check.level === 'below') {
                await applyPunishment(
                    member,
                    prot.action || 'ban',
                    `تجاوز حد إنشاء الويب هوك (${limit})`
                );
            }

            await sendLog(
                guild,
                'moderation',
                '🛡️ Webhook Protection',
                `<@${executorId}> تجاوز حد إنشاء الويب هوك (**${limit}**).\n` +
                `المستوى: **${check.level === 'equal' ? 'بنفس رتبة البوت' : 'تحت رتبة البوت'}**\n` +
                `تم حذف **${exceededDeletedCount}** ويب هوك${check.level === 'below' ? `\nالعقوبة: **${prot.action}**` : ''}`
            );

            return;
        }

        // ==========================================
        // حذف / تعديل ويب هوك من شخص غير مخوّل
        // ==========================================
        const deletedCount = await deleteAllWebhooks(guild);

        if (check.level === 'below') {
            await applyPunishment(
                member,
                prot.action || 'ban',
                `Webhook ${label} غير مصرّح (${webhookId || ''})`
            );
        }

        await sendLog(
            guild,
            'moderation',
            '🛡️ Webhook Protection',
            `<@${executorId}> سوى ${label} ويب هوك بدون إذن.\n` +
            `المستوى: **${check.level === 'equal' ? 'بنفس رتبة البوت' : 'تحت رتبة البوت'}**\n` +
            `تم حذف **${deletedCount}** ويب هوك${check.level === 'below' ? `\nالعقوبة: **${prot.action}**` : ''}`
        );
    } catch (error) {
        console.error('Webhook protection error:', error);
    }
}

const PROTECTION_ACTIONS = [
    { name: '🔨 Ban', value: 'ban' },
    { name: '👢 Kick', value: 'kick' },
    { name: '🔇 Time-out (10 دقائق)', value: 'timeout' },
    { name: '🎭 إزالة كل الرتب', value: 'removeroles' }
];

const DEFAULT_PROTECTIONS = {
    channels: { enabled: false, limit: 5, timeframe: 60000, action: 'ban' },
    roles: { enabled: false, limit: 5, timeframe: 60000, action: 'ban' },
    bans: { enabled: false, limit: 3, timeframe: 60000, action: 'kick' },
    bots: { enabled: false },
    spam: { enabled: false, limit: 5, timeframe: 5000, maxLength: 400, repeatedChar: 8, action: 'timeout' },
    webhooks: { enabled: false, limit: 5, timeframe: 60000, action: 'ban' }
};

// سيرفرات تم تحويل عقوبة السبام القديمة (kick) إلى Timeout — مرة واحدة فقط
const migratedSpamActions = new Set();

function ensureProtections(settings) {
    if (!settings.protections) {
        settings.protections = JSON.parse(JSON.stringify(DEFAULT_PROTECTIONS));
        return settings.protections;
    }

    for (const key of Object.keys(DEFAULT_PROTECTIONS)) {
        if (settings.protections[key] === undefined) {
            settings.protections[key] = JSON.parse(
                JSON.stringify(DEFAULT_PROTECTIONS[key])
            );
        }
    }

    // تحويل القيمة القديمة الافتراضية (kick) إلى Timeout — مرة واحدة لكل سيرفر
    try {
        const spam = settings.protections.spam;
        const id = settings._id;

        if (
            spam &&
            spam.action === 'kick' &&
            id &&
            !migratedSpamActions.has(id)
        ) {
            migratedSpamActions.add(id);
            spam.action = 'timeout';
            settings.markModified('protections.spam');
            settings.save().catch(() => {});
        }
    } catch {}

    return settings.protections;
}

// حساب أطول تكرار متتالي لنفس الحرف (الخطوط الكبيرة)
function maxRepeatedRun(text) {
    const clean = String(text || '').replace(/\s+/g, '');
    let run = 0;
    let maxRun = 0;
    let last = '';

    for (const ch of clean) {
        run = ch === last ? run + 1 : 1;
        last = ch;
        if (run > maxRun) maxRun = run;
    }

    return maxRun;
}

// فحص رسالة ضد حماية السبام وإيقاع العقوبة
async function handleSpam(message, prot) {
    if (!prot || !prot.enabled) return false;

    const content = message.content || '';
    let reason = '';

    // الخط الكبير: تكرار نفس الحرف
    if (prot.repeatedChar) {
        const run = maxRepeatedRun(content);
        if (run >= prot.repeatedChar) {
            reason = `خط كبير (تكرار ${run} حرف)`;
        }
    }

    // رسالة طويلة جداً
    if (!reason && prot.maxLength && content.length > prot.maxLength) {
        reason = `رسالة طويلة (${content.length} حرف > ${prot.maxLength})`;
    }

    // إرسال سريع (فلوود)
    if (!reason) {
        const now = Date.now();
        const key = `${message.guild.id}-${message.author.id}`;
        const timeline = prot.timeframe || 5000;

        if (isLimitExceeded(
            protectionCounts.spam,
            key,
            now,
            prot.limit || 5,
            timeline
        )) {
            reason = `إرسال سريع (أكثر من ${prot.limit} رسالة خلال ${Math.round(timeline / 1000)} ثانية)`;
            protectionCounts.spam.delete(key);
        }
    }

    if (!reason) return false;

    const action = prot.action || 'timeout';

    await message.delete().catch(() => {});

    // ==============================================
    // التحذيرين قبل تطبيق العقوبة (Timeout)
    // ==============================================

    const warnKey = `${message.guild.id}-${message.author.id}`;
    const now = Date.now();
    const prev = spamWarnCounts.get(warnKey);

    let warnCount = (prev && now - prev.last <= SPAM_WARN_WINDOW)
        ? prev.count + 1
        : 1;

    spamWarnCounts.set(warnKey, { count: warnCount, last: now });

    // التحذير الأول والثاني فقط — بدون عقوبة بعد
    if (warnCount <= 2) {
        try {
            await message.reply(
                `⚠️ ${message.author} **تحذير ${warnCount} من 2** — توقف عن السبام! (${reason})`
            ).catch(() => {});
        } catch {}

        await sendLog(
            message.guild,
            'moderation',
            '🛡️ Spam Warning',
            `${message.author} تحذير **${warnCount}/2** للسبام: ${reason}`
        );

        return true;
    }

    // وصل للتحذير الثالث: تطبيق العقوبة
    spamWarnCounts.delete(warnKey);

    try {
        await message.reply(
            `🚫 ${message.author} وصلت للحد — تطبيق العقوبة. (${reason})`
        ).catch(() => {});
    } catch {}

    await applyPunishment(
        message.member,
        action,
        reason
    );

    await sendLog(
        message.guild,
        'moderation',
        '🛡️ Spam Protection',
        `${message.author} سبب السبام: ${reason}\n` +
        `التحذيرات: **2** | العقوبة: **${action === 'timeout' ? 'Time-out (10 دقائق)' : action}**`
    );

    return true;
}


// ======================================================
// MUTE ROLE
// ======================================================

async function getMutedRole(guild) {
    let role = guild.roles.cache.find(
        r => r.name === 'Muted'
    );

    if (role) return role;

    role = await guild.roles.create({
        name: 'Muted',
        color: 0x555555,
        reason: 'Cypher Security Muted Role'
    });

    for (const channel of guild.channels.cache.values()) {
        if (!channel.isTextBased()) continue;

        await channel.permissionOverwrites.edit(role, {
            SendMessages: false,
            AddReactions: false,
            Speak: false
        }).catch(() => {});
    }

    return role;
}


// ======================================================
// JAIL
// ======================================================

async function jailMember(member) {
    const existing = await JailData.findOne({
        guildId: member.guild.id,
        userId: member.id
    });

    if (!existing) {
        const roles = member.roles.cache
            .filter(role => role.id !== member.guild.id)
            .map(role => role.id);

        await JailData.create({
            guildId: member.guild.id,
            userId: member.id,
            roles
        });
    }

    let jailRole = member.guild.roles.cache.find(
        role => role.name === 'سجين'
    );

    if (!jailRole) {
        jailRole = await member.guild.roles.create({
            name: 'سجين',
            color: 0x777777,
            reason: 'Cypher Security Jail Role'
        });

        for (const channel of member.guild.channels.cache.values()) {
            if (!channel.isTextBased()) continue;

            await channel.permissionOverwrites.edit(jailRole, {
                SendMessages: false,
                AddReactions: false,
                Speak: false
            }).catch(() => {});
        }
    }

    const removableRoles = member.roles.cache.filter(
        role =>
            role.id !== member.guild.id &&
            role.id !== jailRole.id &&
            role.editable
    );

    await member.roles.remove(
        removableRoles,
        'Jail'
    ).catch(() => {});

    await member.roles.add(
        jailRole,
        'Jail'
    );

    return jailRole;
}


async function unjailMember(member) {
    const data = await JailData.findOne({
        guildId: member.guild.id,
        userId: member.id
    });

    if (!data) return false;

    const jailRole = member.guild.roles.cache.find(
        role => role.name === 'سجين'
    );

    if (jailRole && member.roles.cache.has(jailRole.id)) {
        await member.roles.remove(
            jailRole,
            'Unjail'
        ).catch(() => {});
    }

    const roles = data.roles
        .map(id => member.guild.roles.cache.get(id))
        .filter(Boolean)
        .filter(role => role.editable);

    if (roles.length) {
        await member.roles.add(
            roles,
            'Restore roles after unjail'
        ).catch(() => {});
    }

    await JailData.deleteOne({
        guildId: member.guild.id,
        userId: member.id
    });

    return true;
}


// ======================================================
// SLASH COMMANDS
// EVERY COMMAND = ADMINISTRATOR
// ======================================================

const slashCommands = [

    new SlashCommandBuilder()
        .setName('jail')
        .setDescription('سجن عضو')
        
        .addUserOption(o =>
            o.setName('user')
                .setDescription('العضو المراد سجنه')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('unjail')
        .setDescription('فك سجن عضو')
        
        .addUserOption(o =>
            o.setName('user')
                .setDescription('العضو المراد فك سجنه')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('حظر عضو من السيرفر')
        
        .addUserOption(o =>
            o.setName('user')
                .setDescription('العضو المراد حظره')
                .setRequired(true)
        )
        .addStringOption(o =>
            o.setName('reason')
                .setDescription('سبب الحظر')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('unban')
        .setDescription('فك حظر عضو')
        
        .addStringOption(o =>
            o.setName('user_id')
                .setDescription('آيدي العضو')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('kick')
        .setDescription('طرد عضو')
        
        .addUserOption(o =>
            o.setName('user')
                .setDescription('العضو المراد طرده')
                .setRequired(true)
        )
        .addStringOption(o =>
            o.setName('reason')
                .setDescription('سبب الطرد')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('إعطاء تايم أوت لعضو')
        
        .addUserOption(o =>
            o.setName('user')
                .setDescription('العضو')
                .setRequired(true)
        )
        .addStringOption(o =>
            o.setName('duration')
                .setDescription('المدة مثل 10m أو 1h أو 1d')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('untimeout')
        .setDescription('إزالة التايم أوت')
        
        .addUserOption(o =>
            o.setName('user')
                .setDescription('العضو')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('role-add')
        .setDescription('إعطاء رتبة لعضو')
        
        .addUserOption(o =>
            o.setName('user')
                .setDescription('العضو')
                .setRequired(true)
        )
        .addRoleOption(o =>
            o.setName('role')
                .setDescription('الرتبة')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('role-remove')
        .setDescription('إزالة رتبة من عضو')
        
        .addUserOption(o =>
            o.setName('user')
                .setDescription('العضو')
                .setRequired(true)
        )
        .addRoleOption(o =>
            o.setName('role')
                .setDescription('الرتبة')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('purge')
        .setDescription('حذف عدد من الرسائل')
        
        .addIntegerOption(o =>
            o.setName('amount')
                .setDescription('عدد الرسائل من 1 إلى 100')
                .setMinValue(1)
                .setMaxValue(100)
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('lock')
        .setDescription('قفل الروم')
        
        .addChannelOption(o =>
            o.setName('channel')
                .setDescription('الروم المراد قفله')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('unlock')
        .setDescription('فتح الروم')
        
        .addChannelOption(o =>
            o.setName('channel')
                .setDescription('الروم المراد فتحه')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('إعداد نظام الترحيب')
        
        .addSubcommand(sub =>
            sub.setName('set')
                .setDescription('تعيين الترحيب')
                .addChannelOption(o =>
                    o.setName('channel')
                        .setDescription('روم الترحيب')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
                .addStringOption(o =>
                    o.setName('message')
                        .setDescription('رسالة الترحيب (بالمتغيرات)')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('card')
                .setDescription('تفعيل أو إيقاف صورة الترحيب (Canvas)')
                .addBooleanOption(o =>
                    o.setName('enabled')
                        .setDescription('تفعيل الصورة؟')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('variables')
                .setDescription('عرض متغيرات رسالة الترحيب')
        )
        .addSubcommand(sub =>
            sub.setName('off')
                .setDescription('إيقاف الترحيب')
        ), 

    new SlashCommandBuilder()
        .setName('stats')
        .setDescription('عرض عدد السيرفرات التي فيها البوت'),

    new SlashCommandBuilder()
        .setName('embed')
        .setDescription('إنشاء وإرسال إيمبد مخصص')
        
        .addStringOption(o =>
            o.setName('description')
                .setDescription('نص الإيمبد (مطلوب)')
                .setRequired(true)
        )
        .addStringOption(o =>
            o.setName('title')
                .setDescription('عنوان الإيمبد')
                .setRequired(false)
        )
        .addStringOption(o =>
            o.setName('color')
                .setDescription('اللون بصيغة Hex مثل #5865F2')
                .setRequired(false)
        )
        .addStringOption(o =>
            o.setName('footer')
                .setDescription('النص السفلي للإيمبد')
                .setRequired(false)
        )
        .addStringOption(o =>
            o.setName('image')
                .setDescription('رابط صورة كبيرة للإيمبد')
                .setRequired(false)
        )
        .addStringOption(o =>
            o.setName('thumbnail')
                .setDescription('رابط صورة مصغرة للإيمبد')
                .setRequired(false)
        )
        .addStringOption(o =>
            o.setName('url')
                .setDescription('رابط يفتح عند النقر على العنوان')
                .setRequired(false)
        )
        .addChannelOption(o =>
            o.setName('channel')
                .setDescription('الروم الذي سيظهر فيه الإيمبد (الافتراضي: الروم الحالي)')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)
        )
        .addBooleanOption(o =>
            o.setName('visible')
                .setDescription('إظهار الإيمبد للجميع (الافتراضي: خاص لك فقط)')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('autoresponse')
        .setDescription('إدارة الردود التلقائية')
        
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('إضافة رد تلقائي')
                .addStringOption(o =>
                    o.setName('trigger')
                        .setDescription('الكلمة أو العبارة')
                        .setRequired(true)
                )
                .addStringOption(o =>
                    o.setName('response')
                        .setDescription('الرد')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('حذف رد تلقائي')
        )
        .addSubcommand(sub =>
            sub.setName('edit')
                .setDescription('تعديل رد تلقائي')
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('عرض كل الردود التلقائية')
        ),

    new SlashCommandBuilder()
        .setName('shortcut')
        .setDescription('إدارة الاختصارات')
        
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('إضافة اختصار')
                .addStringOption(o =>
                    o.setName('name')
                        .setDescription('اسم الاختصار')
                        .setRequired(true)
                )
                .addStringOption(o =>
                    o.setName('command')
                        .setDescription('الأمر الإداري الذي سينفذه الاختصار')
                        .setRequired(true)
                        .addChoices(
                            { name: '🔨 ban', value: 'ban' },
                            { name: '🔓 unban', value: 'unban' },
                            { name: '👢 kick', value: 'kick' },
                            { name: '🔒 jail', value: 'jail' },
                            { name: '🔓 unjail', value: 'unjail' },
                            { name: '⏱️ timeout', value: 'timeout' },
                            { name: '⏱️ untimeout', value: 'untimeout' },
                            { name: '🎭 role-add', value: 'role-add' },
                            { name: '🎭 role-remove', value: 'role-remove' },
                            { name: '🗑️ purge', value: 'purge' },
                            { name: '🔒 lock', value: 'lock' },
                            { name: '🔓 unlock', value: 'unlock' }
                        )
                )
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('حذف اختصار')
        )
        .addSubcommand(sub =>
            sub.setName('edit')
                .setDescription('تعديل اختصار')
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('عرض كل الاختصارات')
        ),

    new SlashCommandBuilder()
        .setName('logs')
        .setDescription('إعداد سجلات السيرفر')
        ,

    new SlashCommandBuilder()
        .setName('level')
        .setDescription('عرض مستواك أو مستوى عضو')
        
        .addUserOption(o =>
            o.setName('user')
                .setDescription('العضو')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('level-settings')
        .setDescription('إعداد نظام المستويات')
        
        .addIntegerOption(o =>
            o.setName('messages')
                .setDescription('عدد الرسائل المطلوبة لكل مستوى')
                .setMinValue(1)
                .setRequired(false)
        )
        .addIntegerOption(o =>
            o.setName('level')
                .setDescription('المستوى الذي تعطي عنده رتبة')
                .setMinValue(1)
                .setRequired(false)
        )
        .addRoleOption(o =>
            o.setName('role')
                .setDescription('رتبة المكافأة')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('setlog')
        .setDescription('تعيين روم عام للسجلات')
        
        .addChannelOption(o =>
            o.setName('channel')
                .setDescription('روم السجلات')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('autorole')
        .setDescription('إعداد الرتبة التلقائية للعضو الجديد')

        .addSubcommand(sub =>
            sub.setName('set')
                .setDescription('تحديد رتبة تُعطى تلقائياً لأي عضو جديد')
                .addRoleOption(o =>
                    o.setName('role')
                        .setDescription('الرتبة التي تُعطى عند الدخول')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('off')
                .setDescription('إيقاف الرتبة التلقائية')
        )
        .addSubcommand(sub =>
            sub.setName('status')
                .setDescription('حالة الرتبة التلقائية')
        ),

    new SlashCommandBuilder()
        .setName('protect')
        .setDescription('حماية السيرفر من السبام (رومات/رتب/باند/بوتات)')
        
        .addSubcommand(sub =>
            sub.setName('channels')
                .setDescription('حماية الرومات: عدد الإنشاء المسموح ثم العقوبة')
                .addBooleanOption(o =>
                    o.setName('enabled')
                        .setDescription('تفعيل الحماية')
                        .setRequired(true)
                )
                .addIntegerOption(o =>
                    o.setName('limit')
                        .setDescription('الحد الأقصى لإنشاء الرومات خلال الفترة')
                        .setMinValue(1)
                        .setMaxValue(50)
                )
                .addIntegerOption(o =>
                    o.setName('duration')
                        .setDescription('الفترة الزمنية بالثواني')
                        .setMinValue(5)
                        .setMaxValue(3600)
                )
                .addStringOption(o =>
                    o.setName('action')
                        .setDescription('العقوبة عند التجاوز')
                        .addChoices(...PROTECTION_ACTIONS)
                )
        )
        .addSubcommand(sub =>
            sub.setName('roles')
                .setDescription('حماية الرتب: عدد الإنشاء المسموح ثم العقوبة')
                .addBooleanOption(o =>
                    o.setName('enabled')
                        .setDescription('تفعيل الحماية')
                        .setRequired(true)
                )
                .addIntegerOption(o =>
                    o.setName('limit')
                        .setDescription('الحد الأقصى لإنشاء الرتب خلال الفترة')
                        .setMinValue(1)
                        .setMaxValue(50)
                )
                .addIntegerOption(o =>
                    o.setName('duration')
                        .setDescription('الفترة الزمنية بالثواني')
                        .setMinValue(5)
                        .setMaxValue(3600)
                )
                .addStringOption(o =>
                    o.setName('action')
                        .setDescription('العقوبة عند التجاوز')
                        .addChoices(...PROTECTION_ACTIONS)
                )
        )
        .addSubcommand(sub =>
            sub.setName('bans')
                .setDescription('حماية الباند: عدد الحظر المسموح ثم العقوبة')
                .addBooleanOption(o =>
                    o.setName('enabled')
                        .setDescription('تفعيل الحماية')
                        .setRequired(true)
                )
                .addIntegerOption(o =>
                    o.setName('limit')
                        .setDescription('الحد الأقصى لعمليات الحظر خلال الفترة')
                        .setMinValue(1)
                        .setMaxValue(50)
                )
                .addIntegerOption(o =>
                    o.setName('duration')
                        .setDescription('الفترة الزمنية بالثواني')
                        .setMinValue(5)
                        .setMaxValue(3600)
                )
                .addStringOption(o =>
                    o.setName('action')
                        .setDescription('العقوبة عند التجاوز')
                        .addChoices(...PROTECTION_ACTIONS)
                )
        )
        .addSubcommand(sub =>
            sub.setName('bots')
                .setDescription('حماية دخول البوتات')
                .addBooleanOption(o =>
                    o.setName('enabled')
                        .setDescription('تفعيل الحماية')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('spam')
                .setDescription('حماية السبام: الرسائل السريعة والخطوط الكبيرة')
                .addBooleanOption(o =>
                    o.setName('enabled')
                        .setDescription('تفعيل الحماية')
                        .setRequired(true)
                )
                .addIntegerOption(o =>
                    o.setName('limit')
                        .setDescription('أقصى عدد رسائل خلال الفترة')
                        .setMinValue(1)
                        .setMaxValue(50)
                )
                .addIntegerOption(o =>
                    o.setName('duration')
                        .setDescription('الفترة الزمنية بالثواني')
                        .setMinValue(1)
                        .setMaxValue(3600)
                )
                .addIntegerOption(o =>
                    o.setName('maxlength')
                        .setDescription('أكبر طول مسموح للرسالة (الكلام الطويل)')
                        .setMinValue(10)
                        .setMaxValue(2000)
                )
                .addIntegerOption(o =>
                    o.setName('repeated')
                        .setDescription('عدد تكرار نفس الحرف قبل اعتباره خطاً كبيراً')
                        .setMinValue(3)
                        .setMaxValue(200)
                )
                .addStringOption(o =>
                    o.setName('action')
                        .setDescription('العقوبة عند التجاوز')
                        .addChoices(...PROTECTION_ACTIONS)
                )
        )
        .addSubcommand(sub =>
            sub.setName('webhooks')
                .setDescription('حماية الويب هوك: حد الإنشاء المسموح ثم العقوبة')
                .addBooleanOption(o =>
                    o.setName('enabled')
                        .setDescription('تفعيل الحماية')
                        .setRequired(true)
                )
                .addIntegerOption(o =>
                    o.setName('limit')
                        .setDescription('عدد الويب هوك المسموح إنشاؤها خلال الفترة')
                        .setMinValue(1)
                        .setMaxValue(50)
                )
                .addIntegerOption(o =>
                    o.setName('duration')
                        .setDescription('الفترة الزمنية بالثواني')
                        .setMinValue(5)
                        .setMaxValue(3600)
                )
                .addStringOption(o =>
                    o.setName('action')
                        .setDescription('العقوبة عند المخالف (تحت رتبة البوت)')
                        .addChoices(...PROTECTION_ACTIONS)
                )
        )
        .addSubcommand(sub =>
            sub.setName('status')
                .setDescription('عرض حالة جميع الحمايات')
        ),
    
    new SlashCommandBuilder()
        .setName('whitelist')
        .setDescription('🛡️ إدارة الوايت ليست (الحماية تتجاهلها)')
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('إضافة عضو للوايت ليست — الحماية لن تتدخل معه')
                .addUserOption(o =>
                    o.setName('user')
                        .setDescription('العضو')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('إزالة عضو من الوايت ليست')
                .addUserOption(o =>
                    o.setName('user')
                        .setDescription('العضو')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('عرض أعضاء الوايت ليست')
        ),
].map(command => command.toJSON());


// ======================================================
// REGISTER SLASH COMMANDS
// ======================================================

async function registerGlobalCommands() {

    try {

        await client.application.commands.set(slashCommands);

        console.log(
            `🌐 Slash commands registered globally: ${slashCommands.length} commands for ALL servers`
        );

        // رابط الإضافة الصحيح (بدونه ما تظهر الأوامر في أي سيرفر)
        console.log(
            '🔗 لإضافة البوت بشكل صحيح في كل سيرفر استخدم هذا الرابط (بديل):\n' +
            '    https://discord.com/api/oauth2/authorize?client_id=' +
            `${client.user.id}&permissions=8&scope=bot%20applications.commands` +
            '\nإذا فيه سيرفر ما تظهر فيه الأوامر = البوت أضيف فيه برابط قديم بدون ' +
            "'applications.commands'. أزله منه وأضفه مرة ثانية بالرابط أعلاه."
        );

        return true;

    } catch (error) {

        console.error(
            '❌ Failed registering GLOBAL slash commands:',
            error.message || error
        );

        // Missing Access (50001) = دخل البوت بدون scope الأوامر
        const code = error.code || error.status || error.rawError?.code;

        if (code === 50001 || code === 403) {

            console.error(
                '⚠️ البوت ناقص صلاحية `applications.commands`.\n' +
                'الحل: أعد إضافة البوت للـ (كل) السيرفرات بالرابط الصحيح:\n' +
                `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=8&scope=bot%20applications.commands\n` +
                'ينصح بإزالة البوت من السيرفرات ثم إضافته بالرابط أعلاه.'
            );
        }

        return false;
    }
}

client.once('ready', async () => {

    console.log(`✅ Logged in as ${client.user.tag}`);

    // مسح الأوامر المحلية القديمة من كل السيرفرات حتى لا تتكرر الأوامر
    for (const guild of client.guilds.cache.values()) {
        await guild.commands.set([]).catch(() => {});
    }

    console.log(
        '🧹 Cleared old per-guild (local) slash commands'
    );

    // تسجيل عام يظهر في كل السيرفرات
    await registerGlobalCommands();

    try {
        await mongoose.connect(MONGO_URI);

        console.log('✅ MongoDB connected successfully');

        // فحص وإصلاح شامل لكل مستندات الإعدادات المخزنة
        // (يضمن عدم وجود كائن مكان مصفوفة في shortcuts / autoResponses ...)
        try {
            const cursor = GuildSettings.collection.find({});

            while (await cursor.hasNext()) {
                const doc = await cursor.next();

                const patch = {};

                if (!Array.isArray(doc.shortcuts)) patch.shortcuts = [];
                if (!Array.isArray(doc.autoResponses)) patch.autoResponses = [];

                if (
                    doc.levelSettings &&
                    typeof doc.levelSettings.rewards === 'object' &&
                    !Array.isArray(doc.levelSettings.rewards)
                ) {
                    patch['levelSettings.rewards'] = {};
                }

                if (Object.keys(patch).length) {
                    await GuildSettings.collection.updateOne(
                        { _id: doc._id },
                        { $set: patch }
                    );
                    console.log(
                        `🔧 Repaired settings for server ${doc._id}`
                    );
                }
            }

            console.log('🧹 Settings database scan complete');
        } catch (error) {
            console.error('Settings database scan error:', error);
        }

    } catch (error) {
        console.error('❌ MongoDB connection error:', error);
        console.error(
            '⚠️ سيعمل البوت والأوامر لكن بدون حفظ بيانات دائمة حتى يتصل MongoDB.'
        );
    }

    console.log(
        '🔐 جميع Slash Commands تتطلب رتبة ' + STAFF_ROLE_NAME + ' (فوق رتبة البوت)'
    );
});

// لاحظ: الأوامر عامة الآن، أي سيرفر جديد يظهر به الأوامر تلقائياً
client.on('guildCreate', guild => {

    console.log(
        `📥 Bot added to new server: ${guild.name}`
    );

});


// ======================================================
// INTERACTION HANDLER
// ======================================================

client.on('interactionCreate', async interaction => {

    try {

        // ==============================================
        // SLASH COMMANDS
        // ==============================================

        if (interaction.isChatInputCommand()) {

            const command = interaction.commandName;

            // EVERY SLASH COMMAND = STAFF ROLE ONLY
            const staffOK = await requireStaffPermission(interaction);
            if (staffOK !== true) return staffOK;


            // ==========================================
            // JAIL
            // ==========================================

            if (command === 'jail') {

                const user = interaction.options.getUser('user');
                const member =
                    await interaction.guild.members.fetch(user.id)
                        .catch(() => null);

                if (!member) {
                    return interaction.reply({
                        content: '❌ العضو غير موجود.',
                        ephemeral: true
                    });
                }

                if (member.id === OWNER_ID) {
                    return interaction.reply({
                        content: '❌ لا يمكن سجن مالك البوت.',
                        ephemeral: true
                    });
                }

                await jailMember(member);

                await sendLog(
                    interaction.guild,
                    'moderation',
                    '🔒 Jail',
                    `${member} تم سجنه بواسطة ${interaction.user}.`,
                    0xFFAA00
                );

                return interaction.reply(
                    `🔒 تم سجن ${member}.`
                );
            }


            // ==========================================
            // UNJAIL
            // ==========================================

            if (command === 'unjail') {

                const user = interaction.options.getUser('user');

                const member =
                    await interaction.guild.members.fetch(user.id)
                        .catch(() => null);

                if (!member) {
                    return interaction.reply({
                        content: '❌ العضو غير موجود.',
                        ephemeral: true
                    });
                }

                const success = await unjailMember(member);

                if (!success) {
                    return interaction.reply({
                        content: '❌ هذا العضو ليس مسجونًا.',
                        ephemeral: true
                    });
                }

                await sendLog(
                    interaction.guild,
                    'moderation',
                    '🔓 Unjail',
                    `${member} تم فك سجنه بواسطة ${interaction.user}.`,
                    0x57F287
                );

                return interaction.reply(
                    `🔓 تم فك سجن ${member}.`
                );
            }


            // ==========================================
            // BAN
            // ==========================================

            if (command === 'ban') {

                const user = interaction.options.getUser('user');
                const reason =
                    interaction.options.getString('reason') ||
                    'بدون سبب';

                if (user.id === OWNER_ID) {
                    return interaction.reply({
                        content: '❌ لا يمكن حظر مالك البوت.',
                        ephemeral: true
                    });
                }

                const member =
                    await interaction.guild.members.fetch(user.id)
                        .catch(() => null);

                if (member && !member.bannable) {
                    return interaction.reply({
                        content:
                            '❌ لا أستطيع حظر هذا العضو. تأكد من ترتيب الرتب.',
                        ephemeral: true
                    });
                }

                await interaction.guild.members.ban(
                    user.id,
                    { reason }
                );

                await sendLog(
                    interaction.guild,
                    'moderation',
                    '🔨 Ban',
                    `${user} تم حظره بواسطة ${interaction.user}.\nالسبب: ${reason}`,
                    0xED4245
                );

                return interaction.reply(
                    `🔨 تم حظر ${user}.\nالسبب: ${reason}`
                );
            }


            // ==========================================
            // UNBAN
            // ==========================================

            if (command === 'unban') {

                const userId =
                    interaction.options.getString('user_id');

                try {

                    const ban =
                        await interaction.guild.bans.fetch(userId);

                    await interaction.guild.members.unban(
                        userId,
                        `Unban بواسطة ${interaction.user.tag}`
                    );

                    await sendLog(
                        interaction.guild,
                        'moderation',
                        '🔓 Unban',
                        `${ban.user} تم فك حظره بواسطة ${interaction.user}.`,
                        0x57F287
                    );

                    return interaction.reply(
                        `🔓 تم فك حظر <@${userId}>.`
                    );

                } catch {

                    return interaction.reply({
                        content:
                            '❌ لم أجد هذا العضو ضمن قائمة المحظورين.',
                        ephemeral: true
                    });

                }
            }


            // ==========================================
            // KICK
            // ==========================================

            if (command === 'kick') {

                const user = interaction.options.getUser('user');

                const reason =
                    interaction.options.getString('reason') ||
                    'بدون سبب';

                const member =
                    await interaction.guild.members.fetch(user.id)
                        .catch(() => null);

                if (!member) {
                    return interaction.reply({
                        content: '❌ العضو غير موجود.',
                        ephemeral: true
                    });
                }

                if (user.id === OWNER_ID) {
                    return interaction.reply({
                        content: '❌ لا يمكن طرد مالك البوت.',
                        ephemeral: true
                    });
                }

                if (!member.kickable) {
                    return interaction.reply({
                        content:
                            '❌ لا أستطيع طرد هذا العضو. تأكد من ترتيب الرتب.',
                        ephemeral: true
                    });
                }

                await member.kick(reason);

                await sendLog(
                    interaction.guild,
                    'moderation',
                    '👢 Kick',
                    `${user} تم طرده بواسطة ${interaction.user}.\nالسبب: ${reason}`,
                    0xED4245
                );

                return interaction.reply(
                    `👢 تم طرد ${user}.`
                );
            }


            // ==========================================
            // TIMEOUT
            // ==========================================

            if (command === 'timeout') {

                const user = interaction.options.getUser('user');
                const durationText =
                    interaction.options.getString('duration');

                const member =
                    await interaction.guild.members.fetch(user.id)
                        .catch(() => null);

                if (!member) {
                    return interaction.reply({
                        content: '❌ العضو غير موجود.',
                        ephemeral: true
                    });
                }

                const match =
                    durationText.match(/^(\d+)(s|m|h|d)$/i);

                if (!match) {
                    return interaction.reply({
                        content:
                            '❌ استخدم صيغة مثل `10m` أو `1h` أو `1d`.',
                        ephemeral: true
                    });
                }

                const amount = Number(match[1]);
                const unit = match[2].toLowerCase();

                const multipliers = {
                    s: 1000,
                    m: 60 * 1000,
                    h: 60 * 60 * 1000,
                    d: 24 * 60 * 60 * 1000
                };

                const duration =
                    amount * multipliers[unit];

                const maxDuration =
                    28 * 24 * 60 * 60 * 1000;

                if (duration > maxDuration) {
                    return interaction.reply({
                        content:
                            '❌ أقصى مدة للتايم أوت هي 28 يوم.',
                        ephemeral: true
                    });
                }

                if (!member.moderatable) {
                    return interaction.reply({
                        content:
                            '❌ لا أستطيع إعطاء هذا العضو Timeout.',
                        ephemeral: true
                    });
                }

                await member.timeout(
                    duration,
                    `Timeout بواسطة ${interaction.user.tag}`
                );

                await sendLog(
                    interaction.guild,
                    'moderation',
                    '⏱️ Timeout',
                    `${member} حصل على Timeout لمدة ${durationText} بواسطة ${interaction.user}.`,
                    0xFEE75C
                );

                return interaction.reply(
                    `⏱️ تم إعطاء ${member} تايم أوت لمدة **${durationText}**.`
                );
            }


            // ==========================================
            // UNTIMEOUT
            // ==========================================

            if (command === 'untimeout') {

                const user = interaction.options.getUser('user');

                const member =
                    await interaction.guild.members.fetch(user.id)
                        .catch(() => null);

                if (!member) {
                    return interaction.reply({
                        content: '❌ العضو غير موجود.',
                        ephemeral: true
                    });
                }

                await member.timeout(
                    null,
                    `Untimeout بواسطة ${interaction.user.tag}`
                );

                return interaction.reply(
                    `🔓 تم إزالة التايم أوت عن ${member}.`
                );
            }


            // ==========================================
            // ROLE ADD
            // ==========================================

            if (command === 'role-add') {

                const user = interaction.options.getUser('user');
                const role = interaction.options.getRole('role');

                const member =
                    await interaction.guild.members.fetch(user.id)
                        .catch(() => null);

                if (!member) {
                    return interaction.reply({
                        content: '❌ العضو غير موجود.',
                        ephemeral: true
                    });
                }

                if (!role.editable) {
                    return interaction.reply({
                        content:
                            '❌ لا أستطيع إعطاء هذه الرتبة بسبب ترتيب الرتب.',
                        ephemeral: true
                    });
                }

                await member.roles.add(
                    role,
                    `Role add بواسطة ${interaction.user.tag}`
                );

                return interaction.reply(
                    `🎭 تم إعطاء ${member} الرتبة ${role}.`
                );
            }


            // ==========================================
            // ROLE REMOVE
            // ==========================================

            if (command === 'role-remove') {

                const user = interaction.options.getUser('user');
                const role = interaction.options.getRole('role');

                const member =
                    await interaction.guild.members.fetch(user.id)
                        .catch(() => null);

                if (!member) {
                    return interaction.reply({
                        content: '❌ العضو غير موجود.',
                        ephemeral: true
                    });
                }

                if (!role.editable) {
                    return interaction.reply({
                        content:
                            '❌ لا أستطيع إزالة هذه الرتبة بسبب ترتيب الرتب.',
                        ephemeral: true
                    });
                }

                await member.roles.remove(
                    role,
                    `Role remove بواسطة ${interaction.user.tag}`
                );

                return interaction.reply(
                    `🎭 تم إزالة ${role} من ${member}.`
                );
            }


            // ==========================================
            // PURGE
            // ==========================================

            if (command === 'purge') {

                const amount =
                    interaction.options.getInteger('amount');

                const channel = interaction.channel;

                const deleted =
                    await channel.bulkDelete(
                        amount,
                        true
                    );

                await sendLog(
                    interaction.guild,
                    'moderation',
                    '🗑️ Purge',
                    `${channel} تم حذف **${deleted.size}** رسالة بواسطة ${interaction.user}.`
                );

                return interaction.reply({
                    content:
                        `🗑️ تم حذف **${deleted.size}** رسالة.`,
                    ephemeral: true
                });
            }


            // ==========================================
            // LOCK
            // ==========================================

            if (command === 'lock') {

                const channel =
                    interaction.options.getChannel('channel') ||
                    interaction.channel;

                await channel.permissionOverwrites.edit(
                    interaction.guild.roles.everyone,
                    {
                        SendMessages: false
                    }
                );

                await sendLog(
                    interaction.guild,
                    'moderation',
                    '🔒 Channel Locked',
                    `${channel} تم قفله بواسطة ${interaction.user}.`
                );

                return interaction.reply(
                    `🔒 تم قفل ${channel}.`
                );
            }


            // ==========================================
            // UNLOCK
            // ==========================================

            if (command === 'unlock') {

                const channel =
                    interaction.options.getChannel('channel') ||
                    interaction.channel;

                await channel.permissionOverwrites.edit(
                    interaction.guild.roles.everyone,
                    {
                        SendMessages: null
                    }
                );

                await sendLog(
                    interaction.guild,
                    'moderation',
                    '🔓 Unlock',
                    `${channel} تم فتحه بواسطة ${interaction.user}.`,
                    0x57F287
                );

                return interaction.reply(
                    `🔓 تم فتح ${channel}.`
                );
            }


            // ==========================================
            // WELCOME
            // ==========================================

            if (command === 'welcome') {

                const sub =
                    interaction.options.getSubcommand();

                const settings =
                    await getSettings(interaction.guild.id);

                if (sub === 'set') {

                    const channel =
                        interaction.options.getChannel('channel');

                    const message =
                        interaction.options.getString('message');

                    settings.welcome.enabled = true;
                    settings.welcome.channelId = channel.id;
                    settings.welcome.message = message;

                    await settings.save();

                    return interaction.reply({
                        content:
                            `✅ تم تفعيل الترحيب في ${channel}.\n\n` +
                            `✨ المتغيرات المدعومة:\n` +
                            '`{user}` = منشن العضو\n' +
                            '`{username}` = اسم العضو\n' +
                            '`{tag}` = اسم العضو مع اللقب الرقمي\n' +
                            '`{id}` = آيدي العضو\n' +
                            '`{count}` = عدد أعضاء السيرفر\n' +
                            '`{server}` = اسم السيرفر',
                        ephemeral: true
                    });
                }

                if (sub === 'card') {

                    const enabled =
                        interaction.options.getBoolean('enabled');

                    settings.welcome.cardEnabled = enabled;

                    await settings.save();

                    return interaction.reply(
                        enabled
                            ? '🖼️ تم تفعيل صورة الترحيب (Canvas).'
                            : '🚫 تم إيقاف صورة الترحيب، سيتم إرسال رسالة نصية فقط.'
                    );
                }

                if (sub === 'variables') {

                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle('✨ متغيرات الترحيب')
                                .setColor(0x57F287)
                                .setDescription(
                                    '`{user}` — منشن العضو\n' +
                                    '`{username}` — اسم العضو\n' +
                                    '`{tag}` — الاسم + اللقب الرقمي\n' +
                                    '`{id}` — آيدي العضو\n' +
                                    '`{count}` — عدد أعضاء السيرفر\n' +
                                    '`{server}` — اسم السيرفر\n\n' +
                                    'مثال:\n```\nأهلاً {user} 🌟\nمرحباً بك في {server}!\nأنت العضو رقم {count}\n```'
                                )
                        ],
                        ephemeral: true
                    });
                }

                if (sub === 'off') {

                    settings.welcome.enabled = false;

                    await settings.save();

                    return interaction.reply(
                        '❌ تم إيقاف نظام الترحيب.'
                    );
                }
            }


            // ==========================================
            // AUTORESPONSE
            // ==========================================

            if (command === 'autoresponse') {

                const sub =
                    interaction.options.getSubcommand();

                const settings =
                    await getSettings(interaction.guild.id);

                // ADD
                if (sub === 'add') {

                    const trigger =
                        interaction.options.getString('trigger');

                    const response =
                        interaction.options.getString('response');

                    if (!normalizeText(trigger)) {
                        return interaction.reply({
                            content: '❌ الكلمة المطلوبة للرد التلقائي لا يمكن أن تكون فارغة.',
                            ephemeral: true
                        });
                    }

                    const exists =
                        settings.autoResponses.some(
                            x =>
                                normalizeText(x.trigger) ===
                                normalizeText(trigger)
                        );

                    if (exists) {
                        return interaction.reply({
                            content:
                                '❌ هذا الرد التلقائي موجود مسبقًا.',
                            ephemeral: true
                        });
                    }

                    settings.autoResponses.push({
                        trigger,
                        response
                    });

                    await settings.save();

                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle('🤖 إضافة الرد التلقائي')
                                .setDescription(
                                    `**الرد:** ${trigger}\n` +
                                    `**الإجابة:** ${response}`
                                )
                                .setColor(0x57F287)
                                .setFooter({
                                    text:
                                        `عدد الردود: ${settings.autoResponses.length}`
                                })
                        ]
                    });
                }


                // LIST
                if (sub === 'list') {

                    return sendAutoResponseList(
                        interaction,
                        settings
                    );
                }


                // REMOVE
                if (sub === 'remove') {

                    if (!settings.autoResponses.length) {
                        return interaction.reply({
                            content:
                                '❌ لا توجد ردود تلقائية حاليًا.',
                            ephemeral: true
                        });
                    }

                    return showAutoResponseSelect(
                        interaction,
                        settings,
                        'remove'
                    );
                }


                // EDIT
                if (sub === 'edit') {

                    if (!settings.autoResponses.length) {
                        return interaction.reply({
                            content:
                                '❌ لا توجد ردود تلقائية حاليًا.',
                            ephemeral: true
                        });
                    }

                    return showAutoResponseSelect(
                        interaction,
                        settings,
                        'edit'
                    );
                }
            }


            // ==========================================
            // SHORTCUT
            // ==========================================

            if (command === 'shortcut') {

                const sub =
                    interaction.options.getSubcommand();

                const settings =
                    await getSettings(interaction.guild.id);


                // ADD
                if (sub === 'add') {

                    const name =
                        interaction.options.getString('name');

                    const cmd =
                        interaction.options.getString('command');

                    if (!normalizeText(name)) {
                        return interaction.reply({
                            content: '❌ اسم الاختصار لا يمكن أن يكون فارغاً.',
                            ephemeral: true
                        });
                    }

                    const exists =
                        settings.shortcuts.some(
                            x =>
                                normalizeText(x.name) ===
                                normalizeText(name)
                        );

                    if (exists) {
                        return interaction.reply({
                            content:
                                '❌ هذا الاختصار موجود مسبقًا.',
                            ephemeral: true
                        });
                    }

                    settings.shortcuts.push({
                        name,
                        command: cmd
                    });

                    await settings.save();

                    return sendShortcutList(
                        interaction,
                        settings,
                        '✅ تمت إضافة الاختصار'
                    );
                }


                // LIST
                if (sub === 'list') {

                    return sendShortcutList(
                        interaction,
                        settings,
                        '⚡ جميع الاختصارات'
                    );
                }


                // REMOVE
                if (sub === 'remove') {

                    if (!settings.shortcuts.length) {
                        return interaction.reply({
                            content:
                                '❌ لا توجد اختصارات حاليًا.',
                            ephemeral: true
                        });
                    }

                    return showShortcutSelect(
                        interaction,
                        settings,
                        'remove'
                    );
                }


                // EDIT
                if (sub === 'edit') {

                    if (!settings.shortcuts.length) {
                        return interaction.reply({
                            content:
                                '❌ لا توجد اختصارات حاليًا.',
                            ephemeral: true
                        });
                    }

                    return showShortcutSelect(
                        interaction,
                        settings,
                        'edit'
                    );
                }
            }


            // ==========================================
            // LOGS
            // ==========================================

            if (command === 'logs') {

                const row =
                    new ActionRowBuilder()
                        .addComponents(
                            new StringSelectMenuBuilder()
                                .setCustomId(
                                    `logs_select_${interaction.user.id}`
                                )
                                .setPlaceholder(
                                    'اختر نوع السجل'
                                )
                                .addOptions([
                                    {
                                        label: 'Voice Logs',
                                        value: 'voice',
                                        emoji: '🔊',
                                        description:
                                            'سجلات الرومات الصوتية'
                                    },
                                    {
                                        label: 'Role Logs',
                                        value: 'role',
                                        emoji: '🎭',
                                        description:
                                            'سجلات الرتب'
                                    },
                                    {
                                        label: 'Channel Logs',
                                        value: 'channel',
                                        emoji: '📁',
                                        description:
                                            'سجلات الرومات'
                                    },
                                    {
                                        label: 'Webhook Logs',
                                        value: 'webhook',
                                        emoji: '🔗',
                                        description:
                                            'سجلات الويب هوك'
                                    },
                                    {
                                        label: 'Member Logs',
                                        value: 'member',
                                        emoji: '👤',
                                        description:
                                            'سجلات الأعضاء'
                                    },
                                    {
                                        label: 'Moderation Logs',
                                        value: 'moderation',
                                        emoji: '🛡️',
                                        description:
                                            'سجلات الإدارة'
                                    },
                                    {
                                        label: 'Message Logs',
                                        value: 'message',
                                        emoji: '💬',
                                        description:
                                            'سجلات الرسائل'
                                    }
                                ])
                        );

                return interaction.reply({
                    content:
                        '📝 اختر نوع السجل ثم حدد الروم.',
                    components: [row],
                    ephemeral: true
                });
            }


            // ==========================================
            // LEVEL
            // ==========================================

            if (command === 'level') {

                const user =
                    interaction.options.getUser('user') ||
                    interaction.user;

                const data =
                    await UserLevel.findOne({
                        guildId: interaction.guild.id,
                        userId: user.id
                    });

                const messages = data?.messages || 0;
                const level = data?.level || 0;

                const settings =
                    await getSettings(interaction.guild.id);

                const required =
                    settings.levelSettings.messagesPerLevel;

                const progress = Math.min(
                    ((messages % required) / required) * 100,
                    100
                );

                const filled = Math.round(progress / 10);
                const empty = 10 - filled;

                const bar =
                    '▰'.repeat(filled) +
                    '▱'.repeat(empty);

                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('📊 مستوى العضو')
                            .setThumbnail(user.displayAvatarURL({ extension: 'png', size: 128 }))
                            .setDescription(
                                `${user}\n\n` +
                                `⭐ المستوى: **${level}**\n` +
                                `💬 الرسائل: **${messages}**\n\n` +
                                `📈 التقدم نحو المستوى ${level + 1}:\n` +
                                `\`${bar}\` **${progress.toFixed(0)}%**\n` +
                                `\`${messages % required}/${required}\` رسائل`
                            )
                            .setColor(0x5865F2)
                    ]
                });
            }


            // ==========================================
            // LEVEL SETTINGS
            // ==========================================

            if (command === 'level-settings') {

                const settings =
                    await getSettings(interaction.guild.id);

                const messages =
                    interaction.options.getInteger('messages');

                const level =
                    interaction.options.getInteger('level');

                const role =
                    interaction.options.getRole('role');

                if (messages) {
                    settings.levelSettings.messagesPerLevel =
                        messages;
                }

                if (level && role) {
                    settings.levelSettings.rewards.set(
                        String(level),
                        role.id
                    );
                }

                await settings.save();

                return interaction.reply({
                    content:
                        `✅ تم تحديث إعدادات المستويات.\n` +
                        `💬 الرسائل لكل مستوى: **${settings.levelSettings.messagesPerLevel}**`,
                    ephemeral: true
                });
            }


            // ==========================================
            // STATS (عدد السيرفرات)
            // ==========================================

            if (command === 'stats') {

                const guilds = client.guilds.cache;

                const list = guilds
                    .map(g =>
                        `${g.name} ( ${g.memberCount} عضو )`
                    )
                    .join('\n');

                return interaction.reply({
                    content:
                        `📊 **إحصائيات البوت**\n\n` +
                        `🖥️ السيرفرات: **${guilds.size}**\n` +
                        `👥 إجمالي الأعضاء: **${guilds.reduce((sum, g) => sum + g.memberCount, 0)}**\n\n` +
                        (guilds.size ? `**السيرفرات:**\n${list || 'لا توجد بيانات.'}` : 'البوت غير مفعل في أي سيرفر بعد.'),
                    ephemeral: false
                });
            }


            // ==========================================
            // SETLOG
            // ==========================================

            if (command === 'setlog') {

                const channel =
                    interaction.options.getChannel('channel');

                const settings =
                    await getSettings(interaction.guild.id);

                settings.logs.moderation = channel.id;
                await settings.save();

                return interaction.reply(
                    `✅ تم تعيين ${channel} كروم سجلات الإدارة.`
                );
            }


            // ==========================================
            // AUTO ROLE
            // ==========================================

            if (command === 'autorole') {

                const settings =
                    await getSettings(interaction.guild.id);

                const sub =
                    interaction.options.getSubcommand();

                if (sub === 'set') {

                    const role =
                        interaction.options.getRole('role');

                    // الرتبة لازم تكون تحت رتبة البوت حتى يقدّر يعطيها
                    const botHighest =
                        interaction.guild.members.me?.roles?.highest;

                    if (botHighest && role.position >= botHighest.position) {
                        return interaction.reply({
                            content:
                                `❌ الرتبة ${role} لازم تكون **تحت** رتبة البوت حتى يقدر البوت يعطيها للأعضاء.`,
                            ephemeral: true
                        });
                    }

                    settings.autoRole.enabled = true;
                    settings.autoRole.roleId = role.id;
                    await settings.save();

                    return interaction.reply({
                        content:
                            `✅ الرتبة التلقائية مفعّلة.\n` +
                            `🛡️ أي عضو جديد يدخل السيرفر بيحصل على ${role}.`,
                        ephemeral: true
                    });
                }

                if (sub === 'off') {

                    settings.autoRole.enabled = false;
                    await settings.save();

                    return interaction.reply({
                        content:
                            `⛔ تم إيقاف الرتبة التلقائية.`,
                        ephemeral: true
                    });
                }

                // status
                const autoRole = settings.autoRole;

                const autoRoleRole = autoRole.roleId
                    ? interaction.guild.roles.cache.get(autoRole.roleId)
                    : null;

                return interaction.reply({
                    content:
                        `🛡️ الرتبة التلقائية: **${autoRole.enabled ? 'مفعّلة ✅' : 'متوقفة ❌'}**\n` +
                        `🎭 الرتبة: ${autoRoleRole ? autoRoleRole.toString() : 'غير محددة'}`,
                    ephemeral: true
                });
            }


            // ==========================================
            // EMBED
            // ==========================================

            if (command === 'embed') {

                const channel =
                    interaction.options.getChannel('channel') ||
                    interaction.channel;

                const visible =
                    interaction.options.getBoolean('visible') || false;

                const title =
                    interaction.options.getString('title');

                const description =
                    interaction.options.getString('description');

                const color =
                    interaction.options.getString('color');

                const footer =
                    interaction.options.getString('footer');

                const image =
                    interaction.options.getString('image');

                const thumbnail =
                    interaction.options.getString('thumbnail');

                const url =
                    interaction.options.getString('url');

                if (!channel || !channel.isTextBased()) {
                    return interaction.reply({
                        content: '❌ الروم غير صالح أو غير نصي.',
                        ephemeral: true
                    });
                }

                if (!description ||
                    description.length > 4096 ||
                    (title && title.length > 256)) {
                    return interaction.reply({
                        content: '❌ النص فارغ أو طويل جداً (الوصف 4096 حرفاً والعنوان 256 حرفاً).',
                        ephemeral: true
                    });
                }

                const embed = new EmbedBuilder()
                    .setDescription(description);

                if (title) embed.setTitle(title);
                if (url) embed.setURL(url);
                if (footer) embed.setFooter({ text: footer });

                if (image) embed.setImage(image);
                if (thumbnail) embed.setThumbnail(thumbnail);

                if (color) {
                    const hex = String(color).replace('#', '').trim();
                    const parsed = parseInt(hex, 16);
                    embed.setColor(!isNaN(parsed) && hex.length > 0 && hex.length <= 6
                        ? parsed
                        : 0x5865F2);
                }

                try {

                    await channel.send({ embeds: [embed] });

                } catch (error) {

                    console.error('Embed send error:', error);

                    return interaction.reply({
                        content: `❌ تعذر إرسال الإيمبد: ${error.message}`,
                        ephemeral: true
                    });
                }

                await sendLog(
                    interaction.guild,
                    'moderation',
                    '📝 Embed Sent',
                    `${interaction.user} أرسل إيمبد في ${channel}.\n` +
                    `العنوان: **${title || 'بدون عنوان'}**`
                );

                return interaction.reply({
                    content: `✅ تم إرسال الإيمبد في ${channel}.`,
                    ephemeral: !visible
                });
            }


            // ==========================================
            // PROTECTION (رومات / رتب / باند / بوتات)
            // ==========================================

            if (command === 'protect') {

                const sub =
                    interaction.options.getSubcommand();

                const settings =
                    await getSettings(interaction.guild.id);

                ensureProtections(settings);

                const names = {
                    channels: 'الرومات',
                    roles: 'الرتب',
                    bans: 'الباند',
                    spam: 'السبام',
                    webhooks: 'الويب هوك'
                };

                const applies = ['channels', 'roles', 'bans', 'spam', 'webhooks'];

                if (applies.includes(sub)) {

                    const prot =
                        settings.protections[sub];

                    const enabled =
                        interaction.options.getBoolean('enabled');

                    const limit =
                        interaction.options.getInteger('limit');

                    const timeframe =
                        interaction.options.getInteger('duration');

                    const action =
                        interaction.options.getString('action');

                    prot.enabled = enabled;

                    if (limit) prot.limit = limit;
                    if (timeframe) prot.timeframe = timeframe * 1000;
                    if (action) prot.action = action;

                    if (sub === 'spam') {
                        const maxLength =
                            interaction.options.getInteger('maxlength');
                        const repeated =
                            interaction.options.getInteger('repeated');

                        if (maxLength) prot.maxLength = maxLength;
                        if (repeated) prot.repeatedChar = repeated;
                    }

                    await settings.save();

                    const spamExtra = sub === 'spam'
                        ? `\nأقصى طول للرسالة: **${prot.maxLength}** حرف\n` +
                          `تكرار الحرف: **${prot.repeatedChar}**`
                        : '';

                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle(`🛡️ حماية ${names[sub]}`)
                                .setColor(enabled ? 0x57F287 : 0xED4245)
                                .setDescription(
                                    `الحالة: **${enabled ? 'مفعلة ✅' : 'متوقفة ❌'}**\n` +
                                    `الحد المسموح: **${prot.limit}**\n` +
                                    `الفترة: **${Math.round(prot.timeframe / 1000)} ثانية**\n` +
                                    `العقوبة عند التجاوز: **${prot.action}**${spamExtra}`
                                )
                        ]
                    });
                }

                if (sub === 'bots') {

                    const enabled =
                        interaction.options.getBoolean('enabled');

                    settings.protections.bots.enabled = enabled;

                    await settings.save();

                    return interaction.reply(
                        `🤖 حماية البوتات **${enabled ? 'مفعلة ✅' : 'متوقفة ❌'}**\n` +
                        `المرجع: رتبة البوت\n` +
                        `(أعلى من رتبة البوت: مسموح | بنفس رتبته أو أقل: البوت يدخل يطرد/يحظر المسبب)`
                    );
                }

                if (sub === 'status') {

                    const fmt = p =>
                        `**${p.enabled ? '✅ مفعلة' : '❌ متوقفة'}**\n` +
                        `الحد: **${p.limit}** | الفترة: **${Math.round(p.timeframe / 1000)} ث**\n` +
                        `العقوبة: **${p.action}**`;

const botsDesc = settings.protections.bots.enabled
                        ? '**✅ مفعّلة**\nالمرجع: رتبة البوت (فوقه مسموح، بنفسه/تحته غير مصرّح)'
                        : '**❌ متوقفة**';

                    const webhooksProt = settings.protections.webhooks;

                    const webhooksDesc = `**${webhooksProt.enabled ? '✅ مفعّلة' : '❌ متوقفة'}**\n` +
                        `الحد المسموح: **${webhooksProt.limit}** | الفترة: **${Math.round(webhooksProt.timeframe / 1000)} ث**\n` +
                        `العقوبة (تحت رتبة البوت): **${webhooksProt.action}**\n` +
                        `المرجع: رتبة البوت والفوايت ليست\n` +
                        `(فوقه/وايت ليست: مسموح | ضمن الحد: مسموح | بنفسه: حذف كل الويب هوك | تحته عند التجاوز: حظر + حذف الكل)`;

                    const spamProt = settings.protections.spam;

                    const spamActionLabel =
                        spamProt.action === 'timeout'
                            ? '🔇 Time-out (بعد تحذيرين)'
                            : spamProt.action;

                    const spamDesc = `**${spamProt.enabled ? '✅ مفعلة' : '❌ متوقفة'}**\n` +
                        `الحد: **${spamProt.limit}** | الفترة: **${Math.round(spamProt.timeframe / 1000)} ث**\n` +
                        `أقصى طول: **${spamProt.maxLength}** | تكرار الحرف: **${spamProt.repeatedChar}**\n` +
                        `العقوبة: **${spamActionLabel}**`;

                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle('🛡️ حالة الحمايات')
                                .setColor(0x5865F2)
                                .addFields(
                                    { name: '📁 الرومات', value: fmt(settings.protections.channels), inline: true },
                                    { name: '🎭 الرتب', value: fmt(settings.protections.roles), inline: true },
                                    { name: '🔨 الباند', value: fmt(settings.protections.bans), inline: true },
                                    { name: '💬 السبام', value: spamDesc, inline: true },
                                    { name: '🤖 البوتات', value: botsDesc, inline: false },
                                    { name: '🔗 الويب هوك', value: webhooksDesc, inline: false }
                                )
                        ]
                    });
                }
            }

            // ==========================================
            // WHITELIST (وايت ليست — للحماية فقط)
            // ==========================================

            if (command === 'whitelist') {

                const sub =
                    interaction.options.getSubcommand();

                const settings =
                    await getSettings(interaction.guild.id);

                // ADD
                if (sub === 'add') {

                    const user =
                        interaction.options.getUser('user');

                    if (
                        settings.whitelist &&
                        settings.whitelist.includes(user.id)
                    ) {
                        return interaction.reply({
                            content:
                                `❌ ${user} موجود مسبقاً في الوايت ليست.`,
                            ephemeral: true
                        });
                    }

                    settings.whitelist.push(user.id);
                    await settings.save();

                    return interaction.reply({
                        content:
                            `✅ تمت إضافة ${user} إلى الوايت ليست.\n` +
                            `🛡️ الحماية لن تتدخل معه (رومات/رتب/ويب هوك...).`,
                        ephemeral: true
                    });
                }

                // REMOVE
                if (sub === 'remove') {

                    const user =
                        interaction.options.getUser('user');

                    if (
                        !settings.whitelist ||
                        !settings.whitelist.includes(user.id)
                    ) {
                        return interaction.reply({
                            content:
                                `❌ ${user} ليس في الوايت ليست.`,
                            ephemeral: true
                        });
                    }

                    settings.whitelist =
                        settings.whitelist.filter(
                            id => id !== user.id
                        );

                    await settings.save();

                    return interaction.reply({
                        content:
                            `🗑️ تمت إزالة ${user} من الوايت ليست.\n` +
                            `الآن الحماية تتعامل معه بشكل طبيعي.`,
                        ephemeral: true
                    });
                }

                // LIST
                if (sub === 'list') {

                    const ids =
                        settings.whitelist || [];

                    const lines = [];

                    for (const id of ids) {
                        const member =
                            await getMember(interaction.guild, id);

                        lines.push(
                            member
                                ? `${member.user.tag} \`(${id})\``
                                : `<@${id}> \`(${id})\``
                        );
                    }

                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle('🛡️ الوايت ليست')
                                .setColor(0x57F287)
                                .setDescription(
                                    lines.length
                                        ? lines.join('\n')
                                        : 'لا يوجد أعضاء في الوايت ليست.'
                                )
                                .setFooter({
                                    text:
                                        `عدد الأعضاء: ${lines.length}`
                                })
                        ],
                        ephemeral: true
                    });
                }
            }
        }


        // ==================================================
        // SELECT MENUS
        // ==================================================

        if (interaction.isStringSelectMenu()) {

            const id = interaction.customId;


            // ==============================================
            // SHORTCUT SELECT
            // ==============================================

            if (id.startsWith('shortcut_')) {

                const parts = id.split('_');

                const action = parts[1];

                if (!isAdmin(interaction)) {
                    return interaction.reply({
                        content:
                            `❌ تحتاج رتبة **${STAFF_ROLE_NAME}** لاستخدام هذا الأمر.`,
                        ephemeral: true
                    });
                }

                // في قائمة تعديل الأمر، فهرس الاختصار داخل الـ customId
                const index =
                    action === 'editcommand'
                        ? Number(parts[parts.length - 1])
                        : Number(interaction.values[0]);

                const settings =
                    await getSettings(interaction.guild.id);

                const shortcut =
                    settings.shortcuts[index];

                if (!shortcut) {
                    return interaction.update({
                        content:
                            '❌ هذا الاختصار لم يعد موجودًا.',
                        components: []
                    });
                }


                // REMOVE
                if (action === 'remove') {

                    settings.shortcuts.splice(index, 1);

                    await settings.save();

                    await interaction.update({
                        content:
                            '🗑️ تم حذف الاختصار.',
                        components: []
                    });

                    return sendShortcutList(
                        interaction,
                        settings,
                        '⚡ الاختصارات بعد الحذف',
                        true
                    );
                }


                // EDIT COMMAND
                if (action === 'editcommand') {

                    const newCommand =
                        interaction.values[0];

                    shortcut.command = newCommand;

                    await settings.save();

                    await interaction.update({
                        content:
                            `✅ تم تعديل الاختصار **${shortcut.name}** إلى **${newCommand}**.`,
                        components: []
                    });

                    return sendShortcutList(
                        interaction,
                        settings,
                        '⚡ جميع الاختصارات',
                        true
                    );
                }


                // EDIT SELECTED SHORTCUT
                if (action === 'edit') {

                    const row =
                        new ActionRowBuilder()
                            .addComponents(
                                new StringSelectMenuBuilder()
                                    .setCustomId(
                                        `shortcut_editcommand_${interaction.user.id}_${index}`
                                    )
                                    .setPlaceholder(
                                        'اختر الأمر الجديد'
                                    )
                                    .addOptions(
                                        [
                                            ['ban', '🔨 ban'],
                                            ['unban', '🔓 unban'],
                                            ['kick', '👢 kick'],
                                            ['jail', '🔒 jail'],
                                            ['unjail', '🔓 unjail'],
                                            ['timeout', '⏱️ timeout'],
                                            ['untimeout', '⏱️ untimeout'],
                                            ['role-add', '🎭 role-add'],
                                            ['role-remove', '🎭 role-remove'],
                                            ['purge', '🗑️ purge'],
                                            ['lock', '🔒 lock'],
                                            ['unlock', '🔓 unlock']
                                        ].map(([value, label]) => ({
                                            label,
                                            value
                                        }))
                                    )
                            );

                    return interaction.update({
                        content:
                            `✏️ تعديل الاختصار **${shortcut.name}**\nاختر الأمر الجديد:`,
                        components: [row]
                    });
                }
            }


            // ==============================================
            // SHORTCUT EDIT COMMAND
            // ==============================================

            if (id.startsWith('shortcut_editcommand_')) {

                if (!isAdmin(interaction)) {
                    return interaction.reply({
                        content:
                            `❌ تحتاج رتبة **${STAFF_ROLE_NAME}** لاستخدام هذا الأمر.`,
                        ephemeral: true
                    });
                }

                const parts = id.split('_');

                const index =
                    Number(parts[parts.length - 1]);

                const settings =
                    await getSettings(interaction.guild.id);

                const shortcut =
                    settings.shortcuts[index];

                if (!shortcut) {
                    return interaction.update({
                        content:
                            '❌ الاختصار غير موجود.',
                        components: []
                    });
                }

                shortcut.command =
                    interaction.values[0];

                await settings.save();

                await interaction.update({
                    content:
                        `✅ تم تعديل **${shortcut.name}**.`,
                    components: []
                });

                return sendShortcutList(
                    interaction,
                    settings,
                    '⚡ جميع الاختصارات',
                    true
                );
            }


            // ==============================================
            // AUTORESPONSE
            // ==============================================

            if (id.startsWith('autoresponse_')) {

                if (!isAdmin(interaction)) {
                    return interaction.reply({
                        content:
                            `❌ تحتاج رتبة **${STAFF_ROLE_NAME}** لاستخدام هذا الأمر.`,
                        ephemeral: true
                    });
                }

                const parts = id.split('_');

                const action = parts[1];

                const index =
                    Number(interaction.values[0]);

                const settings =
                    await getSettings(interaction.guild.id);

                const item =
                    settings.autoResponses[index];

                if (!item) {
                    return interaction.update({
                        content:
                            '❌ الرد غير موجود.',
                        components: []
                    });
                }


                // REMOVE
                if (action === 'remove') {

                    settings.autoResponses.splice(index, 1);

                    await settings.save();

                    await interaction.update({
                        content:
                            '🗑️ تم حذف الرد التلقائي.',
                        components: []
                    });

                    return sendAutoResponseList(
                        interaction,
                        settings,
                        true
                    );
                }


                // EDIT
                if (action === 'edit') {

                    const modal =
                        new ModalBuilder()
                            .setCustomId(
                                `autoresponse_modal_${index}`
                            )
                            .setTitle(
                                'تعديل الرد التلقائي'
                            );

                    const triggerInput =
                        new TextInputBuilder()
                            .setCustomId('trigger')
                            .setLabel('الكلمة')
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setRequired(true)
                            .setValue(item.trigger);

                    const responseInput =
                        new TextInputBuilder()
                            .setCustomId('response')
                            .setLabel('الرد')
                            .setStyle(
                                TextInputStyle.Paragraph
                            )
                            .setRequired(true)
                            .setValue(item.response);

                    modal.addComponents(
                        new ActionRowBuilder()
                            .addComponents(triggerInput),
                        new ActionRowBuilder()
                            .addComponents(responseInput)
                    );

                    return interaction.showModal(modal);
                }
            }


            // ==============================================
            // LOG SELECT
            // ==============================================

            if (id.startsWith('logs_select_')) {

                if (!isAdmin(interaction)) {
                    return interaction.reply({
                        content:
                            `❌ تحتاج رتبة **${STAFF_ROLE_NAME}** لاستخدام هذا الأمر.`,
                        ephemeral: true
                    });
                }

                const type =
                    interaction.values[0];

                const row =
                    new ActionRowBuilder()
                        .addComponents(
                            new StringSelectMenuBuilder()
                                .setCustomId(
                                    `logs_channel_${type}`
                                )
                                .setPlaceholder(
                                    'اختر الروم'
                                )
                                .addOptions(
                                    interaction.guild.channels.cache
                                        .filter(
                                            c =>
                                                c.type ===
                                                ChannelType.GuildText
                                        )
                                        .first(25)
                                        .map(channel => ({
                                            label:
                                                channel.name.slice(0, 100),
                                            value:
                                                channel.id,
                                            description:
                                                `تعيين ${channel.name} للسجل`
                                        }))
                                )
                        );

                return interaction.update({
                    content:
                        `📝 اختر الروم لسجل **${type}**`,
                    components: [row]
                });
            }


            // ==============================================
            // LOG CHANNEL
            // ==============================================

            if (id.startsWith('logs_channel_')) {

                const type =
                    id.replace('logs_channel_', '');

                const channelId =
                    interaction.values[0];

                const settings =
                    await getSettings(interaction.guild.id);

                settings.logs[type] =
                    channelId;

                await settings.save();

                const channel =
                    interaction.guild.channels.cache.get(
                        channelId
                    );

                return interaction.update({
                    content:
                        `✅ تم تعيين ${channel} لسجل **${type}**.`,
                    components: []
                });
            }
        }


        // ==================================================
        // MODALS
        // ==================================================

        if (interaction.isModalSubmit()) {

            if (!isAdmin(interaction)) {
                return interaction.reply({
                    content:
                        `❌ تحتاج رتبة **${STAFF_ROLE_NAME}** لاستخدام هذا الأمر.`,
                    ephemeral: true
                });
            }

            const id = interaction.customId;


            // ==============================================
            // AUTORESPONSE EDIT
            // ==============================================

            if (id.startsWith('autoresponse_modal_')) {

                const index =
                    Number(
                        id.replace(
                            'autoresponse_modal_',
                            ''
                        )
                    );

                const settings =
                    await getSettings(interaction.guild.id);

                const item =
                    settings.autoResponses[index];

                if (!item) {
                    return interaction.reply({
                        content:
                            '❌ الرد غير موجود.',
                        ephemeral: true
                    });
                }

                item.trigger =
                    interaction.fields.getTextInputValue(
                        'trigger'
                    );

                item.response =
                    interaction.fields.getTextInputValue(
                        'response'
                    );

                await settings.save();

                await interaction.reply({
                    content:
                        '✅ تم تعديل الرد التلقائي.',
                    ephemeral: true
                });

                return sendAutoResponseList(
                    interaction,
                    settings,
                    true
                );
            }
        }

    } catch (error) {

        console.error(
            '❌ Interaction error:',
            error
        );

        if (!interaction.replied && !interaction.deferred) {

            await interaction.reply({
                content:
                    '❌ حدث خطأ أثناء تنفيذ الأمر.',
                ephemeral: true
            }).catch(() => {});

        }
    }
});


// ======================================================
// SHORTCUT LIST
// ======================================================

async function sendShortcutList(
    interaction,
    settings,
    title = '⚡ جميع الاختصارات',
    followUp = false
) {

    const embed =
        new EmbedBuilder()
            .setTitle(title)
            .setColor(0x5865F2)
            .setTimestamp();

    if (!settings.shortcuts.length) {

        embed.setDescription(
            'لا توجد اختصارات حاليًا.'
        );

    } else {

        embed.setDescription(
            settings.shortcuts
                .map(
                    (shortcut, index) =>
                        `**${index + 1}.** \`${shortcut.name}\` → \`${shortcut.command}\``
                )
                .join('\n')
        );
    }

    embed.setFooter({
        text:
            `عدد الاختصارات: ${settings.shortcuts.length}`
    });

    if (followUp) {
        return interaction.followUp({
            embeds: [embed],
            ephemeral: true
        });
    }

    return interaction.reply({
        embeds: [embed],
        ephemeral: false
    });
}


// ======================================================
// SHORTCUT SELECT
// ======================================================

async function showShortcutSelect(
    interaction,
    settings,
    action
) {

    const options =
        settings.shortcuts
            .slice(0, 25)
            .map((shortcut, index) => ({
                label:
                    shortcut.name.slice(0, 100),
                value:
                    String(index),
                description:
                    `${shortcut.command}`.slice(0, 100)
            }));

    const row =
        new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(
                        `shortcut_${action}_${interaction.user.id}`
                    )
                    .setPlaceholder(
                        'اختر الاختصار'
                    )
                    .addOptions(options)
            );

    return interaction.reply({
        content:
            action === 'remove'
                ? '🗑️ اختر الاختصار الذي تريد حذفه:'
                : '✏️ اختر الاختصار الذي تريد تعديله:',
        components: [row],
        ephemeral: true
    });
}


// ======================================================
// AUTORESPONSE LIST
// ======================================================

async function sendAutoResponseList(
    interaction,
    settings,
    followUp = false
) {

    const embed =
        new EmbedBuilder()
            .setTitle('🤖 جميع الردود التلقائية')
            .setColor(0x5865F2)
            .setTimestamp();

    if (!settings.autoResponses.length) {

        embed.setDescription(
            'لا توجد ردود تلقائية حاليًا.'
        );

    } else {

        embed.setDescription(
            settings.autoResponses
                .map(
                    (item, index) =>
                        `**${index + 1}.** \`${item.trigger}\` → ${item.response}`
                )
                .join('\n')
        );
    }

    embed.setFooter({
        text:
            `عدد الردود: ${settings.autoResponses.length}`
    });

    if (followUp) {

        return interaction.followUp({
            embeds: [embed],
            ephemeral: true
        });

    }

    return interaction.reply({
        embeds: [embed],
        ephemeral: false
    });
}


// ======================================================
// AUTORESPONSE SELECT
// ======================================================

async function showAutoResponseSelect(
    interaction,
    settings,
    action
) {

    const options =
        settings.autoResponses
            .slice(0, 25)
            .map((item, index) => ({
                label:
                    item.trigger.slice(0, 100),
                value:
                    String(index),
                description:
                    item.response.slice(0, 100)
            }));

    const row =
        new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(
                        `autoresponse_${action}_${interaction.user.id}`
                    )
                    .setPlaceholder(
                        'اختر الرد التلقائي'
                    )
                    .addOptions(options)
            );

    return interaction.reply({
        content:
            action === 'remove'
                ? '🗑️ اختر الرد الذي تريد حذفه:'
                : '✏️ اختر الرد الذي تريد تعديله:',
        components: [row],
        ephemeral: true
    });
}


// ======================================================
// WELCOME
// ======================================================

client.on('guildMemberAdd', async member => {

    try {

        const settings =
            await getSettings(member.guild.id);

        // ==============================================
        // حماية دخول البوتات
        // ==============================================

        if (member.user.bot) {

            ensureProtections(settings);

            const botProt = settings.protections.bots;

            if (botProt.enabled) {

                // المرجع: أعلى رتبة للبوت نفسه
                const botSelf =
                    member.guild.members.me ||
                    await member.guild.members.fetch(member.guild.client.user.id).catch(() => null);

                const refRole = botSelf?.roles?.highest || null;

                if (!refRole) {

                    await member.kick('[Anti-Nuke] تعذر تحديد رتبة البوت').catch(() => {});
                    await sendLog(
                        member.guild,
                        'moderation',
                        '🤖 Bot Blocked',
                        `البوت **${member.user.tag}** طُرد لتعذر تحديد رتبة البوت المرجعية.`
                    );
                    return;
                }

                const inviterId = await getAuditExecutor(
                    member.guild,
                    AuditLogEvent.BotAdd,
                    member.id
                );

                const inviter = inviterId
                    ? await getMember(member.guild, inviterId)
                    : null;

                if (!inviter) {

                    await member.kick('[Anti-Nuke] تعذر التحقق من مسبب دخول البوت').catch(() => {});
                    await sendLog(
                        member.guild,
                        'moderation',
                        '🤖 Bot Blocked',
                        `البوت **${member.user.tag}** طُرد لتعذر التحقق من المسبب.\nالمسبب: غير معروف`
                    );
                    return;
                }

                const inviterPos = inviter.roles.highest.position;
                const refPos = refRole.position;

                if (inviterPos < refPos) {

                    // رتبة المسبب تحت رتبة البوت: بند البوت والمسبب معاً
                    await member.ban('[Anti-Nuke] دخول بوت غير مصرّح').catch(() => {});
                    await applyPunishment(inviter, 'ban', 'مسبب دخول بوت غير مصرّح');

                    await sendLog(
                        member.guild,
                        'moderation',
                        '🤖 Bot Banned',
                        `البوت **${member.user.tag}** حُظر لأنه دخول غير مصرّح.\n` +
                        `المسبب: <@${inviter.id}> (تحت رتبة البوت ${refRole})`
                    );
                    return;
                }

                if (inviterPos === refPos) {

                    // بنفس رتبة البوت: البوت لا يقدر يدخل ويُطرد
                    await member.kick('[Anti-Nuke] دخول بوت غير مصرّح').catch(() => {});
                    await sendLog(
                        member.guild,
                        'moderation',
                        '🤖 Bot Kicked',
                        `البوت **${member.user.tag}** طُرد لأنه دخول غير مصرّح.\n` +
                        `المسبب: <@${inviter.id}> (بنفس رتبة البوت ${refRole})`
                    );
                    return;
                }

                // فوق رتبة البوت: مسموح
                await sendLog(
                    member.guild,
                    'moderation',
                    '🤖 Bot Allowed',
                    `البوت **${member.user.tag}** دخل السيرفر.\n` +
                    `المسبب: <@${inviter.id}> (أعلى من رتبة البوت ${refRole})`
                );
            }
        }

        // ==============================================
        // الرتبة التلقائية للعضو الجديد
        // ==============================================

        if (
            !member.user.bot &&
            settings.autoRole &&
            settings.autoRole.enabled &&
            settings.autoRole.roleId
        ) {

            const autoRole = member.guild.roles.cache.get(
                settings.autoRole.roleId
            );

            if (
                autoRole &&
                member.manageable &&
                !member.roles.cache.has(autoRole.id)
            ) {

                await member.roles
                    .add(autoRole, 'Auto Role')
                    .then(() => {

                        sendLog(
                            member.guild,
                            'member',
                            '🎭 Auto Role',
                            `تم منح ${member} رتبة ${autoRole}.`
                        );

                    })
                    .catch(error => {
                        console.error('Auto role error:', error);
                    });
            }
        }

        if (
            !settings.welcome.enabled ||
            !settings.welcome.channelId
        ) return;

        const channel =
            member.guild.channels.cache.get(
                settings.welcome.channelId
            );

        if (!channel || !channel.isTextBased()) return;

        const text = formatWelcomeMessage(
            settings.welcome.message,
            member
        );

        try {

            if (settings.welcome.cardEnabled !== false) {

                const card = await createWelcomeCard(member);

                const attachment = new AttachmentBuilder(
                    card,
                    { name: 'welcome.png' }
                );

                await channel.send({
                    content: text,
                    files: [attachment]
                });

            } else {

                await channel.send(text);

            }

        } catch (error) {

            console.error('Welcome card error:', error);

            await channel.send(text).catch(() => {});

        }

        await sendLog(
            member.guild,
            'member',
            '👋 Member Joined',
            `${member} دخل السيرفر.\n` +
            `ID: \`${member.id}\``
        );

    } catch (error) {

        console.error(
            'Welcome error:',
            error
        );

    }
});


// ======================================================
// MEMBER LEAVE
// ======================================================

client.on('guildMemberRemove', async member => {

    const kickerId = await getAuditExecutor(
        member.guild,
        AuditLogEvent.MemberKick,
        member.id
    );

    if (kickerId) {

        await sendLog(
            member.guild,
            'member',
            '👢 Member Kicked',
            `العضو **${member.user.tag}** طُرد من السيرفر.\n` +
            `ID: \`${member.id}\`\n` +
            `المسبب: <@${kickerId}>`
        );

        return;
    }

    await sendLog(
        member.guild,
        'member',
        '🚪 Member Left',
        `العضو **${member.user.tag}** غادر السيرفر.\n` +
        `ID: \`${member.id}\``
    );

});


// ======================================================
// MEMBER UPDATE LOGS (Roles / Nickname / Timeout)
// ======================================================

client.on('guildMemberUpdate', async (oldMember, newMember) => {

    try {

        // الرتب المضافه والمزالة
        const addedRoles = newMember.roles.cache.filter(
            role =>
                !oldMember.roles.cache.has(role.id) &&
                role.id !== newMember.guild.id
        );

        const removedRoles = oldMember.roles.cache.filter(
            role =>
                !newMember.roles.cache.has(role.id) &&
                role.id !== newMember.guild.id
        );

        const roleExecutor = await executorMention(
            newMember.guild,
            AuditLogEvent.MemberRoleUpdate,
            newMember.id
        );

        if (addedRoles.size) {

            await sendLog(
                newMember.guild,
                'role',
                '🎭 Role Added',
                `${newMember}\n+ ${addedRoles.map(r => r).join(', ')}\n` +
                `المسبب: ${roleExecutor}`
            );
        }

        if (removedRoles.size) {

            await sendLog(
                newMember.guild,
                'role',
                '🎭 Role Removed',
                `${newMember}\n- ${removedRoles.map(r => r.name).join(', ')}\n` +
                `المسبب: ${roleExecutor}`
            );
        }

        // تغيير اللقب
        const nickExecutor = await executorMention(
            newMember.guild,
            AuditLogEvent.MemberUpdate,
            newMember.id
        );

        if (oldMember.nickname !== newMember.nickname) {

            await sendLog(
                newMember.guild,
                'member',
                '🏷️ Nickname Changed',
                `${newMember}\n` +
                `قبل: **${oldMember.nickname || 'بدون لقب'}**\n` +
                `بعد: **${newMember.nickname || 'بدون لقب'}**\n` +
                `المسبب: ${nickExecutor}`
            );
        }

        // الإسكات / فك الإسكات
        const oldTimeout = oldMember.communicationDisabledUntil;
        const newTimeout = newMember.communicationDisabledUntil;

        if ((oldTimeout || null) !== (newTimeout || null)) {

            if (newTimeout) {

                await sendLog(
                    newMember.guild,
                    'moderation',
                    '⏱️ Timeout Added',
                    `${newMember} حصل على Timeout حتى <t:${Math.floor(newTimeout.getTime() / 1000)}:F>.\n` +
                    `المسبب: ${nickExecutor}`
                );

            } else {

                await sendLog(
                    newMember.guild,
                    'moderation',
                    '🔓 Timeout Removed',
                    `${newMember} تم فك الإسكات عنه.\n` +
                    `المسبب: ${nickExecutor}`
                );
            }
        }

    } catch (error) {

        console.error('Member update log error:', error);

    }
});


// ======================================================
// WEBHOOK LOGS
// ======================================================

client.on('webhookCreate', async webhook => {

    const executor = await executorMention(
        webhook.guild,
        AuditLogEvent.WebhookCreate,
        webhook.id
    );

    await sendLog(
        webhook.guild,
        'webhook',
        '🔗 Webhook Created',
        `تم إنشاء ويب هوك **${webhook.name}** في ${webhook.channel}.\n` +
        `المسبب: ${executor}`
    );

    // حماية الويب هوك
    await runWebhookProtection(
        webhook.guild,
        AuditLogEvent.WebhookCreate,
        webhook.id,
        'إنشاء'
    );
});

client.on('webhookDelete', async webhook => {

    const executor = await executorMention(
        webhook.guild,
        AuditLogEvent.WebhookDelete,
        webhook.id
    );

    await sendLog(
        webhook.guild,
        'webhook',
        '🗑️ Webhook Deleted',
        `تم حذف ويب هوك **${webhook.name}** من ${webhook.channel}.\n` +
        `المسبب: ${executor}`
    );

    // حماية الويب هوك
    await runWebhookProtection(
        webhook.guild,
        AuditLogEvent.WebhookDelete,
        webhook.id,
        'حذف'
    );
});

client.on('webhookUpdate', async channel => {

    const executor = await executorMention(
        channel.guild,
        AuditLogEvent.WebhookUpdate
    );

    await sendLog(
        channel.guild,
        'webhook',
        '✏️ Webhook Updated',
        `تم تعديل ويب هوك في ${channel}.\n` +
        `المسبب: ${executor}`
    );

    // حماية الويب هوك
    await runWebhookProtection(
        channel.guild,
        AuditLogEvent.WebhookUpdate,
        null,
        'تعديل'
    );
});


// ======================================================
// VOICE LOGS
// ======================================================

client.on('voiceStateUpdate', async (oldState, newState) => {

    try {

        const guild = newState.guild || oldState.guild;
        const memberId = newState.member?.id || oldState.member?.id;

        if (!oldState.channelId && newState.channelId) {

            // من نقله أو دخله بنفسه
            const mover = await getAuditExecutor(
                guild,
                AuditLogEvent.MoveMember,
                memberId
            );

            const moverText = mover
                ? (mover === memberId ? '' : `\nمنقّل بواسطة: <@${mover}>`)
                : '';

            await sendLog(
                guild,
                'voice',
                '🔊 Voice Join',
                `${newState.member} دخل ${safeChannelName(newState.channel)}.${moverText}`
            );

        } else if (
            oldState.channelId &&
            !newState.channelId
        ) {

            // هل طُرد من الروم الصوتي أم خرج؟
            const kicker = await getAuditExecutor(
                guild,
                AuditLogEvent.MemberDisconnect,
                memberId
            );

            if (kicker) {

                await sendLog(
                    guild,
                    'voice',
                    '👢 Kicked from Voice',
                    `${newState.member} طُرد من الروم الصوتي ${safeChannelName(oldState.channel)}.\n` +
                    `المُخرج: <@${kicker}>`
                );

            } else {

                await sendLog(
                    guild,
                    'voice',
                    '🔊 Voice Leave',
                    `${newState.member} خرج من ${safeChannelName(oldState.channel)}.`
                );
            }

        } else if (
            oldState.channelId !==
            newState.channelId
        ) {

            const mover = await getAuditExecutor(
                guild,
                AuditLogEvent.MoveMember,
                memberId
            );

            const moverText = mover && mover !== memberId
                ? `\nمنقّل بواسطة: <@${mover}>`
                : '';

            await sendLog(
                guild,
                'voice',
                '🔄 Voice Move',
                `${newState.member} انتقل من ${safeChannelName(oldState.channel)} إلى ${safeChannelName(newState.channel)}.${moverText}`
            );
        }

        if (
            oldState.serverMute !==
            newState.serverMute
        ) {

            const executor = await executorMention(
                guild,
                AuditLogEvent.MemberMute,
                memberId
            );

            await sendLog(
                guild,
                'voice',
                newState.serverMute ? '🔇 Voice Muted' : '🔊 Voice Unmuted',
                `${newState.member} ${newState.serverMute ? 'تم كتمه في الروم الصوتي' : 'تم فك كتمه الصوتي'}.\n` +
                `المسبب: ${executor}`
            );
        }

        if (
            oldState.serverDeaf !==
            newState.serverDeaf
        ) {

            const executor = await executorMention(
                guild,
                AuditLogEvent.MemberDeafen,
                memberId
            );

            await sendLog(
                guild,
                'voice',
                newState.serverDeaf ? '🎧 Voice Deafened' : '🎧 Voice Undeafened',
                `${newState.member} ${newState.serverDeaf ? 'تم تعطيل سماعه في الروم' : 'تم تفعيل سماعه في الروم'}.\n` +
                `المسبب: ${executor}`
            );
        }

    } catch (error) {

        console.error(
            'Voice log error:',
            error
        );

    }
});


// ======================================================
// ROLE LOGS
// ======================================================

client.on('roleCreate', async role => {

    const executor = await executorMention(
        role.guild,
        AuditLogEvent.RoleCreate,
        role.id
    );

    await sendLog(
        role.guild,
        'role',
        '🎭 Role Created',
        `تم إنشاء الرتبة ${role}.\n` +
        `المسبب: ${executor}`
    );

    // حماية الرتب
    try {

        const settings = await getSettings(role.guild.id);
        ensureProtections(settings);
        const prot = settings.protections.roles;

        if (prot.enabled) {

            const executorId = await getAuditExecutor(
                role.guild,
                AuditLogEvent.RoleCreate,
                role.id
            );

            if (executorId) {

                const now = Date.now();
                const key = `${role.guild.id}-${executorId}`;

                if (isLimitExceeded(
                    protectionCounts.roles,
                    key,
                    now,
                    prot.limit,
                    prot.timeframe
                )) {

                    const member = await getMember(role.guild, executorId);

                    await applyPunishment(
                        member,
                        prot.action,
                        `تجاوز حد إنشاء الرتب (${prot.limit})`
                    );

                    await role.delete('[Anti-Nuke] تجاوز حد إنشاء الرتب').catch(() => {});

                    await sendLog(
                        role.guild,
                        'moderation',
                        '🛡️ Role Protection',
                        `<@${executorId}> تجاوز حد إنشاء الرتب (**${prot.limit}**).\n` +
                        `طبقت العقوبة: **${prot.action}**`
                    );
                }
            }
        }
    } catch (error) {
        console.error('Role protection error:', error);
    }
});

client.on('roleDelete', async role => {

    const executor = await executorMention(
        role.guild,
        AuditLogEvent.RoleDelete,
        role.id
    );

    await sendLog(
        role.guild,
        'role',
        '🗑️ Role Deleted',
        `تم حذف الرتبة **${role.name}**.\n` +
        `المسبب: ${executor}`
    );

});

client.on('roleUpdate', async (oldRole, newRole) => {

    const changes = [];

    if (oldRole.name !== newRole.name) {
        changes.push(`الاسم: **${oldRole.name}** → **${newRole.name}**`);
    }

    if (oldRole.color !== newRole.color) {
        changes.push(`اللون: \`#${oldRole.color.toString(16) || '000000'}\` → \`#${newRole.color.toString(16)}\``);
    }

    if (oldRole.hoist !== newRole.hoist) {
        changes.push(`عرضها منفصلة في القائمة: ${newRole.hoist ? 'نعم ✅' : 'لا ❌'}`);
    }

    if (oldRole.mentionable !== newRole.mentionable) {
        changes.push(`قابلية المنشن: ${newRole.mentionable ? 'نعم ✅' : 'لا ❌'}`);
    }

    if (!changes.length) return;

    const executor = await executorMention(
        newRole.guild,
        AuditLogEvent.RoleUpdate,
        newRole.id
    );

    await sendLog(
        newRole.guild,
        'role',
        '✏️ Role Updated',
        `الرتبة: ${newRole}\n` +
        changes.join('\n') +
        `\nالمسبب: ${executor}`
    );

    // حماية تعديل اسم الرتبة
    if (oldRole.name !== newRole.name) {
        try {

            const settings = await getSettings(newRole.guild.id);
            ensureProtections(settings);
            const prot = settings.protections.roles;

            if (prot.enabled) {

                const executorId = await getAuditExecutor(
                    newRole.guild,
                    AuditLogEvent.RoleUpdate,
                    newRole.id
                );

                if (executorId && executorId !== client.user.id) {

                    const member =
                        await getMember(newRole.guild, executorId);

                    const check =
                        protectionAllowed(newRole.guild, member, settings);

                    if (!check.allowed) {

                        // إرجاع الاسم الأصلي
                        await newRole.setName(
                            oldRole.name,
                            '[Anti-Nuke] استرجاع اسم الرتبة'
                        ).catch(() => {});

                        const now = Date.now();
                        const key = `${newRole.guild.id}-${executorId}`;

                        if (isLimitExceeded(
                            protectionCounts.roles,
                            key,
                            now,
                            prot.limit,
                            prot.timeframe
                        )) {

                            if (check.level === 'below') {
                                await applyPunishment(
                                    member,
                                    prot.action,
                                    `تعديل اسم رتبة (${prot.limit})`
                                );
                            }

                            await sendLog(
                                newRole.guild,
                                'moderation',
                                '🛡️ Role Name Protection',
                                `<@${executorId}> حاول تعديل اسم الرتبة **${oldRole.name}**.\n` +
                                `تم إرجاع الاسم${check.level === 'below' ? `\nالعقوبة: **${prot.action}**` : ''}`
                            );
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Role name protection error:', error);
        }
    }
});


// ======================================================
// CHANNEL LOGS
// ======================================================

client.on('channelCreate', async channel => {

    if (!channel.guild) return;

    const executor = await executorMention(
        channel.guild,
        AuditLogEvent.ChannelCreate,
        channel.id
    );

    await sendLog(
        channel.guild,
        'channel',
        '📁 Channel Created',
        `تم إنشاء ${channel}.\n` +
        `المسبب: ${executor}`
    );

    // حماية الرومات
    try {

        const settings = await getSettings(channel.guild.id);
        ensureProtections(settings);
        const prot = settings.protections.channels;

        if (prot.enabled && channel.guild) {

            const executorId = await getAuditExecutor(
                channel.guild,
                AuditLogEvent.ChannelCreate,
                channel.id
            );

            if (executorId) {

                const now = Date.now();
                const key = `${channel.guild.id}-${executorId}`;

                if (isLimitExceeded(
                    protectionCounts.channels,
                    key,
                    now,
                    prot.limit,
                    prot.timeframe
                )) {

                    const member = await getMember(channel.guild, executorId);

                    await applyPunishment(
                        member,
                        prot.action,
                        `تجاوز حد إنشاء الرومات (${prot.limit})`
                    );

                    await sendLog(
                        channel.guild,
                        'moderation',
                        '🛡️ Channel Protection',
                        `<@${executorId}> تجاوز حد إنشاء الرومات (**${prot.limit}**).\n` +
                        `طبقت العقوبة: **${prot.action}**`
                    );
                }
            }
        }
    } catch (error) {
        console.error('Channel protection error:', error);
    }
});

client.on('channelDelete', async channel => {

    if (!channel.guild) return;

    const executor = await executorMention(
        channel.guild,
        AuditLogEvent.ChannelDelete,
        channel.id
    );

    await sendLog(
        channel.guild,
        'channel',
        '🗑️ Channel Deleted',
        `تم حذف الروم **${channel.name}**.\n` +
        `المسبب: ${executor}`
    );

});

client.on('channelUpdate', async (oldChannel, newChannel) => {

    if (!newChannel.guild) return;

    const changes = [];

    if (oldChannel.name !== newChannel.name) {
        changes.push(`الاسم: **${oldChannel.name}** → **${newChannel.name}**`);
    }

    if (oldChannel.topic !== newChannel.topic) {
        changes.push(`الموضوع: **${oldChannel.topic || 'بدون'}** → **${newChannel.topic || 'بدون'}**`);
    }

    if (oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
        changes.push(`مهلة الكتابة: ${oldChannel.rateLimitPerUser || 0} ث → ${newChannel.rateLimitPerUser || 0} ث`);
    }

    if (oldChannel.parentId !== newChannel.parentId) {
        changes.push('تم نقل الروم ضمن الفئات (categories)');
    }

    if (!changes.length) return;

    const executor = await executorMention(
        newChannel.guild,
        AuditLogEvent.ChannelUpdate,
        newChannel.id
    );

    await sendLog(
        newChannel.guild,
        'channel',
        '✏️ Channel Updated',
        `${newChannel}\n` +
        changes.join('\n') +
        `\nالمسبب: ${executor}`
    );

    // حماية تعديل اسم الروم
    if (oldChannel.name !== newChannel.name) {
        try {

            const settings = await getSettings(newChannel.guild.id);
            ensureProtections(settings);
            const prot = settings.protections.channels;

            if (prot.enabled) {

                const executorId = await getAuditExecutor(
                    newChannel.guild,
                    AuditLogEvent.ChannelUpdate,
                    newChannel.id
                );

                if (executorId && executorId !== client.user.id) {

                    const member =
                        await getMember(newChannel.guild, executorId);

                    const check =
                        protectionAllowed(newChannel.guild, member, settings);

                    if (!check.allowed) {

                        // إرجاع الاسم الأصلي
                        await newChannel.setName(
                            oldChannel.name,
                            '[Anti-Nuke] استرجاع اسم الروم'
                        ).catch(() => {});

                        const now = Date.now();
                        const key = `${newChannel.guild.id}-${executorId}`;

                        if (isLimitExceeded(
                            protectionCounts.channels,
                            key,
                            now,
                            prot.limit,
                            prot.timeframe
                        )) {

                            if (check.level === 'below') {
                                await applyPunishment(
                                    member,
                                    prot.action,
                                    `تعديل اسم روم (${prot.limit})`
                                );
                            }

                            await sendLog(
                                newChannel.guild,
                                'moderation',
                                '🛡️ Channel Name Protection',
                                `<@${executorId}> حاول تعديل اسم الروم **${oldChannel.name}**.\n` +
                                `تم إرجاع الاسم${check.level === 'below' ? `\nالعقوبة: **${prot.action}**` : ''}`
                            );
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Channel name protection error:', error);
        }
    }
});


// ======================================================
// MESSAGE DELETE LOG
// ======================================================

client.on('messageDelete', async message => {

    if (!message.guild) return;
    if (message.author?.bot) return;

    const executor = await executorMention(
        message.guild,
        AuditLogEvent.MessageDelete,
        message.id
    );

    await sendLog(
        message.guild,
        'message',
        '🗑️ Message Deleted',
        `👤 العضو: ${message.author || 'غير معروف'}\n` +
        `📁 الروم: ${message.channel}\n` +
        `💬 المحتوى: ${message.content || 'غير متوفر'}\n` +
        `🗑️ المسبب: ${executor}`
    );

});


// ======================================================
// MESSAGE UPDATE LOG
// ======================================================

client.on(
    'messageUpdate',
    async (oldMessage, newMessage) => {

        if (!oldMessage.guild) return;
        if (oldMessage.author?.bot) return;

        if (
            oldMessage.content ===
            newMessage.content
        ) return;

        const executor = await executorMention(
            oldMessage.guild,
            AuditLogEvent.MessageUpdate,
            oldMessage.id
        );

        await sendLog(
            oldMessage.guild,
            'message',
            '✏️ Message Edited',
            `👤 العضو: ${oldMessage.author}\n` +
            `📁 الروم: ${oldMessage.channel}\n\n` +
            `قبل:\n${oldMessage.content || 'فارغ'}\n\n` +
            `بعد:\n${newMessage.content || 'فارغ'}\n\n` +
            `✏️ المسبب: ${executor}`
        );
    }
);


// ======================================================
// BAN LOG (حماية الباند)
// ======================================================

client.on('guildBanAdd', async ban => {

    const executor = await executorMention(
        ban.guild,
        AuditLogEvent.MemberBanAdd,
        ban.user?.id
    );

    await sendLog(
        ban.guild,
        'moderation',
        '🔨 Member Banned',
        `العضو **${ban.user?.tag || 'غير معروف'}** حُظر.\n` +
        `السبب: ${ban.reason || 'بدون سبب'}\n` +
        `المسبب: ${executor}`
    );

    try {

        const settings = await getSettings(ban.guild.id);
        ensureProtections(settings);
        const prot = settings.protections.bans;

        if (prot.enabled) {

            const executorId = await getAuditExecutor(
                ban.guild,
                AuditLogEvent.MemberBanAdd,
                ban.user?.id
            );

            if (executorId) {

                const now = Date.now();
                const key = `${ban.guild.id}-${executorId}`;

                if (isLimitExceeded(
                    protectionCounts.bans,
                    key,
                    now,
                    prot.limit,
                    prot.timeframe
                )) {

                    const member = await getMember(ban.guild, executorId);

                    await applyPunishment(
                        member,
                        prot.action,
                        `تجاوز حد الباند (${prot.limit})`
                    );

                    await sendLog(
                        ban.guild,
                        'moderation',
                        '🛡️ Ban Protection',
                        `<@${executorId}> تجاوز حد عمليات الحظر (**${prot.limit}**).\n` +
                        `طبقت العقوبة: **${prot.action}**`
                    );
                }
            }
        }
    } catch (error) {
        console.error('Ban protection error:', error);
    }
});


// ======================================================
// LEVEL SYSTEM
// ======================================================

client.on('messageCreate', async message => {

    try {

        if (!message.guild) return;
        if (message.author.bot) return;

        const settings =
            await getSettings(message.guild.id);

        // ==============================================
        // SPAM PROTECTION (رسائل سريعة / خطوط كبيرة)
        // ==============================================

        const spamProt = ensureProtections(settings).spam;

        const isStaff =
            isOwner(message.author.id) ||
            memberHasStaffRole(message.member, message.guild);

        if (spamProt.enabled && !isStaff) {
            const punished = await handleSpam(message, spamProt);
            if (punished) return;
        }

        // ==============================================
        // SHORTCUTS
        // ==============================================

        const normalizedMessage =
            normalizeText(message.content);

        let usedShortcut = null;

        for (
            const shortcut
            of settings.shortcuts
        ) {

            const shortcutName =
                normalizeText(shortcut.name);

            if (
                normalizedMessage ===
                shortcutName
            ) {

                usedShortcut = {
                    shortcut,
                    args: ''
                };

                break;

            }

            if (
                normalizedMessage.startsWith(
                    shortcutName + ' '
                )
            ) {

                const args =
                    normalizedMessage
                        .slice(
                            shortcutName.length
                        )
                        .trim();

                usedShortcut = {
                    shortcut,
                    args
                };

                break;
            }
        }

        if (usedShortcut) {

            await executeShortcut(
                message,
                usedShortcut.shortcut.command,
                message.content
                    .trim()
                    .slice(
                        usedShortcut.shortcut.name.length
                    )
                    .trim()
            );

            return;
        }


        // ==============================================
        // AUTO RESPONSES
        // ==============================================

        for (
            const auto
            of settings.autoResponses
        ) {

            const trigger =
                normalizeText(auto.trigger);

            if (
                normalizedMessage === trigger
            ) {

                await message.reply(
                    auto.response
                );

                break;
            }
        }


        // ==============================================
        // LEVEL
        // ==============================================

        if (
            !settings.levelSettings.enabled
        ) return;

        let data =
            await UserLevel.findOne({
                guildId: message.guild.id,
                userId: message.author.id
            });

        if (!data) {

            data =
                await UserLevel.create({
                    guildId: message.guild.id,
                    userId: message.author.id
                });

        }

        data.messages++;

        const required =
            settings.levelSettings.messagesPerLevel;

        const newLevel =
            Math.floor(
                data.messages / required
            );

        if (
            newLevel >
            data.level
        ) {

            data.level =
                newLevel;

            await data.save();

            const roleId =
                settings.levelSettings.rewards.get(
                    String(newLevel)
                );

            let rewardText = '';

            if (roleId) {

                const role =
                    message.guild.roles.cache.get(
                        roleId
                    );

                if (
                    role &&
                    role.editable
                ) {

                    await message.member.roles.add(
                        role
                    ).catch(() => {});

                    rewardText =
                        `\n🎁 حصلت على رتبة ${role}!`;
                }
            }

            await message.channel.send({
                content:
                    `🎉 ${message.author} وصل للمستوى **${newLevel}**!${rewardText}`
            });

        } else {

            await data.save();

        }

    } catch (error) {

        console.error(
            'Message system error:',
            error
        );

    }

});


// ======================================================
// SHORTCUT EXECUTOR
// ======================================================

async function executeShortcut(
    message,
    command,
    rawArgs
) {

    if (!memberHasStaffRole(message.member, message.guild)) {
        return message.reply(
            `❌ تحتاج رتبة **${STAFF_ROLE_NAME}** (فوق رتبة البوت) لاستخدام الاختصارات.`
        );
    }


    // ==============================================
    // COMMAND PARSER
    // ==============================================

    const mention =
        message.mentions.members.first();

    const args =
        rawArgs
            .trim()
            .split(/\s+/)
            .filter(Boolean);


    // ==============================================
    // KICK
    // ==============================================

    if (command === 'kick') {

        if (!mention) {
            return message.reply(
                '❌ استخدم الاختصار مع منشن العضو.'
            );
        }

        if (!mention.kickable) {
            return message.reply(
                '❌ لا أستطيع طرد هذا العضو.'
            );
        }

        await mention.kick(
            `Shortcut بواسطة ${message.author.tag}`
        );

        return message.reply(
            `👢 تم طرد ${mention}.`
        );
    }


    // ==============================================
    // BAN
    // ==============================================

    if (command === 'ban') {

        if (!mention) {
            return message.reply(
                '❌ استخدم الاختصار مع منشن العضو.'
            );
        }

        if (mention.id === OWNER_ID) {
            return message.reply(
                '❌ لا يمكن حظر مالك البوت.'
            );
        }

        await mention.ban({
            reason:
                `Shortcut بواسطة ${message.author.tag}`
        });

        return message.reply(
            `🔨 تم حظر ${mention}.`
        );
    }


    // ==============================================
    // JAIL
    // ==============================================

    if (command === 'jail') {

        if (!mention) {
            return message.reply(
                '❌ استخدم الاختصار مع منشن العضو.'
            );
        }

        await jailMember(mention);

        return message.reply(
            `🔒 تم سجن ${mention}.`
        );
    }


    // ==============================================
    // UNJAIL
    // ==============================================

    if (command === 'unjail') {

        if (!mention) {
            return message.reply(
                '❌ استخدم الاختصار مع منشن العضو.'
            );
        }

        const result =
            await unjailMember(mention);

        if (!result) {
            return message.reply(
                '❌ العضو غير مسجون.'
            );
        }

        return message.reply(
            `🔓 تم فك سجن ${mention}.`
        );
    }


    // ==============================================
    // UNTIMEOUT
    // ==============================================

    if (command === 'untimeout') {

        if (!mention) {
            return message.reply(
                '❌ استخدم الاختصار مع منشن العضو.'
            );
        }

        await mention.timeout(
            null,
            `Shortcut بواسطة ${message.author.tag}`
        );

        return message.reply(
            `🔓 تم إزالة التايم أوت عن ${mention}.`
        );
    }


    // ==============================================
    // TIMEOUT
    // ==============================================

    if (command === 'timeout') {

        if (!mention) {
            return message.reply(
                '❌ استخدم الاختصار مع منشن العضو.'
            );
        }

        const duration =
            args.find(x =>
                /^\d+(s|m|h|d)$/i.test(x)
            );

        if (!duration) {
            return message.reply(
                '❌ اكتب المدة مثل `10m` أو `1h`.'
            );
        }

        const match =
            duration.match(
                /^(\d+)(s|m|h|d)$/i
            );

        const amount =
            Number(match[1]);

        const unit =
            match[2].toLowerCase();

        const multipliers = {
            s: 1000,
            m: 60000,
            h: 3600000,
            d: 86400000
        };

        const time =
            amount * multipliers[unit];

        if (
            time >
            28 * 86400000
        ) {
            return message.reply(
                '❌ أقصى مدة 28 يوم.'
            );
        }

        await mention.timeout(
            time,
            `Shortcut بواسطة ${message.author.tag}`
        );

        return message.reply(
            `⏱️ تم إعطاء ${mention} تايم أوت ${duration}.`
        );
    }


    // ==============================================
    // LOCK
    // ==============================================

    if (command === 'lock') {

        await message.channel.permissionOverwrites.edit(
            message.guild.roles.everyone,
            {
                SendMessages: false
            }
        );

        return message.reply(
            `🔒 تم قفل ${message.channel}.`
        );
    }


    // ==============================================
    // UNLOCK
    // ==============================================

    if (command === 'unlock') {

        await message.channel.permissionOverwrites.edit(
            message.guild.roles.everyone,
            {
                SendMessages: null
            }
        );

        return message.reply(
            `🔓 تم فتح ${message.channel}.`
        );
    }


    // ==============================================
    // PURGE
    // ==============================================

    if (command === 'purge') {

        const amount =
            Number(
                args.find(x =>
                    /^\d+$/.test(x)
                )
            );

        if (
            !amount ||
            amount < 1 ||
            amount > 100
        ) {
            return message.reply(
                '❌ استخدم رقم من 1 إلى 100.'
            );
        }

        const deleted =
            await message.channel.bulkDelete(
                amount,
                true
            );

        return message.reply(
            `🗑️ تم حذف ${deleted.size} رسالة.`
        );
    }


    // ==============================================
    // UNKNOWN
    // ==============================================

    return message.reply(
        '❌ هذا الأمر غير مدعوم في الاختصارات.'
    );
}


// ======================================================
// ERROR HANDLERS
// ======================================================

process.on(
    'unhandledRejection',
    error => {
        console.error(
            '❌ Unhandled Rejection:',
            error
        );
    }
);

process.on(
    'uncaughtException',
    error => {
        console.error(
            '❌ Uncaught Exception:',
            error
        );
    }
);


// ======================================================
// LOGIN
// ======================================================

client.login(TOKEN);
