require('dotenv').config({ path: `${__dirname}/.env` });
const {
    Client,
    GatewayIntentBits,
    PermissionsBitField,
    EmbedBuilder,
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelType,
    AttachmentBuilder,
    StickerFormatType,
    AuditLogEvent,
    PermissionFlagBits,
    Partials
} = require('discord.js');

const mongoose = require('mongoose');
const express = require('express');
const fs = require('fs');
const path = require('path');
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const tickets = require('./tickets.js');
const spamRules = require('./spamrules.js');
const temproles = require('./temproles.js');
const giveaways = require('./giveaways.js');
const puzzle = require('./puzzle.js');
const reactionroles = require('./reactionroles.js');
const tempvoice = require('./tempvoice.js');
const feedback = require('./feedback.js');
const securityAudit = require('./security-audit.js');

// 📇 المصدر الوحيد لتعريفات أوامر Slash (يُشارك مع deploy.js)
const { slashCommands, PROTECTION_ACTIONS } = require('./commands.js');


// ======================================================
// ENV
// ======================================================

// بعض لوحات الاستضافة (Pterodactyl / WispByte / Render) تحط متغيّر "TOKEN"
// خاص فيها — فكان الكود يقرا توكن اللوحة بدال توكن البوت.
// الحل: ننضّف أي قيمة (مسافات، \r، تنصيص، BOM، لصق السطر كامل) ثم نتحقق من الشكل
function cleanTokenValue(value) {
    let s = String(value == null ? '' : value);

    s = s.replace(/^\uFEFF/, '');              // BOM من ويندوز
    s = s.replace(/^['"]|['"]$/g, '');         // تنصيص أول وآخر
    s = s.replace(/^DISCORD_TOKEN\s*=\s*/i, ''); // لو لصق السطر كامل
    s = s.replace(/^TOKEN\s*=\s*/i, '');
    s = s.replace(/\s+/g, '');                 // كل المسافات والأسطر الزايغة

    return s.trim();
}

function looksLikeDiscordToken(value) {
    const s = cleanTokenValue(value);

    // توكن البوت: base64.timestamp.base64signature (٣ أجزاء، الطول ~٥٩-٧٢)
    const parts = s.split('.');

    return (
        parts.length === 3 &&
        parts.every(p => p.length >= 5 && /^[A-Za-z0-9_-]+$/.test(p)) &&
        s.length >= 55 &&
        s.length <= 100
    );
}

const TOKEN_SOURCES = [
    ['DISCORD_TOKEN', process.env.DISCORD_TOKEN],
    ['TOKEN', process.env.TOKEN]
];

let TOKEN = '';
let TOKEN_SOURCE = '';

for (const [name, value] of TOKEN_SOURCES) {
    if (looksLikeDiscordToken(value)) {
        TOKEN = cleanTokenValue(value);
        TOKEN_SOURCE = name;
        break;
    }
}

// ما لقي شكل صحيح؟ استخدم الأول اللي فيه قيمة (عشان نطبع رسالة أدق)
if (!TOKEN) {
    for (const [name, value] of TOKEN_SOURCES) {
        const cleaned = cleanTokenValue(value);

        if (cleaned) {
            TOKEN = cleaned;
            TOKEN_SOURCE = name;
            break;
        }
    }
}

const MONGO_URI = String(process.env.MONGO_URI || '').trim();

const OWNER_ID = process.env.OWNER_ID || '1364275261398581279';

// أصحاب التنبيهات (المالك / راعي البوت) — افصل بينهم بفاصلة
const OWNER_IDS = String(process.env.OWNER_IDS || OWNER_ID)
    .split(',')
    .map(id => id.trim())
    .filter(id => /^\d{15,21}$/.test(id));

// رابط الداشبورد العام (مثال: https://my-bot.onrender.com)
// لو ما حددته، يكتشفه البوت تلقائياً من أول طلب يجيه (يشتغل على أي استضافة)
// رابط الداشبورد العام — نرجّع دومين نظيف https بدون بورت، ونتجاهل أي localhost
function normalizeDashboardUrl(url) {
    const host = String(url || '')
        .trim()
        .replace(/^https?:\/\//i, '')
        .split('/')[0]
        .split(':')[0];

    if (!host) return '';
    if (/^(localhost|127\.0\.0\.1|0\.0\.0\.0)$/i.test(host)) return '';

    return `https://${host}`;
}

let RUNTIME_DASHBOARD_URL = '';

// بعض الاستضافات تعطيك الدومين في متغيّر بيئة جاهز — ناخذه تلقائياً
function envDashboardUrl() {
    const raw = [
        process.env.DASHBOARD_URL,
        process.env.DASHBOARD_PUBLIC_URL,
        process.env.PUBLIC_URL,
        process.env.APP_URL,
        process.env.APP_BASE_URL,
        process.env.RENDER_EXTERNAL_URL,
        process.env.RAILWAY_PUBLIC_DOMAIN && `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`,
        process.env.WEBSITE_HOSTNAME && `https://${process.env.WEBSITE_HOSTNAME}`,
        process.env.DOMAIN && (/^https?:\/\//i.test(process.env.DOMAIN) ? process.env.DOMAIN : `https://${process.env.DOMAIN}`),
        process.env.PUBLIC_DOMAIN && (/^https?:\/\//i.test(process.env.PUBLIC_DOMAIN) ? process.env.PUBLIC_DOMAIN : `https://${process.env.PUBLIC_DOMAIN}`)
    ];

    for (const value of raw) {
        const clean = normalizeDashboardUrl(value);
        if (clean) return clean;
    }

    return '';
}

// نحفظ الدومين اللي انكشف مرة — عشان يبقى بعد إعادة تشغيل الاستضافة
const DASHBOARD_URL_FILE = path.join(__dirname, '.dashboard-url');

try {
    RUNTIME_DASHBOARD_URL = normalizeDashboardUrl(fs.readFileSync(DASHBOARD_URL_FILE, 'utf8'));
} catch {}

// ما فيه دومين محفوظ؟ ناخذه من متغيّرات الاستضافة لو موجود
if (!RUNTIME_DASHBOARD_URL) RUNTIME_DASHBOARD_URL = envDashboardUrl();

const DASHBOARD_URL = String(process.env.DASHBOARD_URL || '').replace(/\/+$/, '');

function setRuntimeDashboardUrl(url) {
    const clean = normalizeDashboardUrl(url);

    if (!clean || clean === RUNTIME_DASHBOARD_URL) return;

    RUNTIME_DASHBOARD_URL = clean;

    try {
        fs.writeFileSync(DASHBOARD_URL_FILE, clean, 'utf8');
    } catch {}
}

// ======================================================
// وضع التشخيص:  node index.js --check-env
// يقول لك بالضبط وش البوت شايف — بدون ما يسجّل دخول
// ======================================================

function printEnvDiagnostic() {
    const fs = require('fs');
    const envPath = `${__dirname}/.env`;
    const mask = (v) => {
        const s = String(v || '');

        if (!s) return '(فاضي)';

        return `${s.slice(0, 6)}...${s.slice(-4)} (طول ${s.length})`;
    };

    console.log('\n================ تشخيص البيئة ================\n');
    console.log(`📁 مجلد المشروع : ${__dirname}`);
    console.log(`📄 ملف .env     : ${fs.existsSync(envPath) ? 'موجود ✅' : 'غير موجود ❌'}`);

    if (fs.existsSync(envPath)) {
        const raw = fs.readFileSync(envPath, 'utf8');
        const keys = raw
            .split(/\r?\n/)
            .filter(l => l.trim() && !l.trim().startsWith('#'))
            .map(l => l.split('=')[0].trim());

        console.log(`🔑 متغيّرات .env : ${keys.length ? keys.join(', ') : '(ما فيه متغيّرات)'}`);
        console.log(`⚠️  BOM في أول سطر: ${raw.charCodeAt(0) === 0xFEFF ? 'نعم ❌ (هذي تسوي البوت ما يقرا الملف)' : 'لا ✅'}`);
        console.log(`📏 حجم الملف     : ${raw.length} حرف`);
    }

    console.log('\n---- التوكن ----');

    for (const [name, value] of TOKEN_SOURCES) {
        const cleaned = cleanTokenValue(value);
        const isReal = looksLikeDiscordToken(value);

        console.log(`  ${name}`);
        console.log(`    موجود؟  ${value ? 'نعم' : 'لا ❌'}`);
        console.log(`    بعد التنضيف: ${mask(cleaned)}`);
        console.log(`    شكل توكن ديسكورد؟ ${isReal ? 'نعم ✅' : 'لا ❌'}`);
    }

    console.log(`\n  ✅ المستخدم: ${TOKEN_SOURCE || '(ولا وحدة!)'}`);
    console.log(`  ✅ القيمة   : ${mask(TOKEN)}`);
    console.log(`  ✅ صالح؟    ${looksLikeDiscordToken(TOKEN) ? 'نعم — المفروض يشتغل' : 'لا ❌ — ديسكورد راح يرفضه'}`);

    const parts = TOKEN.split('.');

    console.log(`  ℹ️  عدد أجزاء التوكن: ${parts.length} (المفروض 3)`);

    if (parts.length === 3) {
        console.log(`     طول كل جزء: ${parts.map(p => p.length).join(' / ')}`);
    }

    console.log('\n---- باقي المتغيّرات ----');
    console.log(`  MONGO_URI    : ${MONGO_URI ? `موجود (طول ${MONGO_URI.length})` : 'ناقص ❌'}`);
    console.log(`  OWNER_ID     : ${OWNER_ID}`);
    console.log(`  OWNER_IDS    : ${OWNER_IDS.length ? OWNER_IDS.join(', ') : '(فاضي)'}`);
    console.log(`  PORT         : ${process.env.PORT || '(افتراضي 10000)'}`);
    console.log(`  DASHBOARD_URL: ${DASHBOARD_URL || '(فاضي)'}`);
    console.log('\n==============================================\n');
}

if (process.argv.includes('--check-env')) {
    printEnvDiagnostic();

    process.exit(0);
}

// فحص مبكر — نطبع التشخيص المفصّل بدال رسالة عامة (هذا يشتغل قبل كل شي)
if (!TOKEN) {
    console.error('❌ ما لقيت توكن البوت (DISCORD_TOKEN). التفاصيل:\n');
    printEnvDiagnostic();

    process.exit(1);
}


// ======================================================
// WEB SERVER - RENDER
// ======================================================

const app = express();
// بعض الاستضافات (Pterodactyl/Wispbyte) تحط البورت في SERVER_PORT مو PORT —
// لو أخذنا الغلط، الدومين يوجّه لبورت ثاني ويطلع "رفض الاتصال".
const PORT = Number(
    process.env.PORT ||
    process.env.SERVER_PORT ||
    process.env.DASHBOARD_PORT ||
    process.env.HTTP_PORT
) || 10000;

// ✅ ضروري لـ Render / أي استضافة خلف بروكسي: بدونه req.protocol يطلع http دائماً
//    في constructions رابط OAuth callback بيطلع غلط و Discord يرفضه.
app.set('trust proxy', true);
app.disable('x-powered-by');

const server = app.listen(PORT, '0.0.0.0', () => {
    const portFromEnv = process.env.PORT || process.env.SERVER_PORT || process.env.DASHBOARD_PORT || process.env.HTTP_PORT;
    console.log(`🌐 Web server running on port ${PORT} (bound 0.0.0.0)`);
    console.log(`   ↳ مصدر البورت: ${portFromEnv ? `env (${portFromEnv})` : 'افتراضي 10000 — لو استضافتك تعطيك بورت ثاني، اضبط PORT أو SERVER_PORT'}`);

    const announceUrl = dashboardBaseUrl();
    if (announceUrl) {
        console.log(`🔗 [داشبورد] افتح: ${announceUrl}`);
        console.log(`🔗 [داشبورد] رابط OAuth callback (ضيفه لدى Discord إن لم يكن موجوداً): ${announceUrl}/api/auth/callback`);
    } else {
        console.log('🔗 [داشبورد] الرابط حيتكشف تلقائياً — افتح دومين الاستضافة مرة وحدة وبيتكمل لوحده (وينحفظ).');
    }
});

// Render /Railway يرسلون SIGTERM قبل الإيقاف — نغلق بشكل نظيف
for (const signal of ['SIGTERM', 'SIGINT']) {
    process.on(signal, () => {
        console.log(`\n⚠️  ${signal} received — closing web server...`);
        server.close(() => process.exit(0));
        setTimeout(() => process.exit(0), 5000).unref();
    });
}

// نقطة فحص الصحة — Render يستخدمها ليتأكد إن الخدمة شغالة
app.get('/healthz', (req, res) => {
    res.status(200).json({ ok: true, uptime: Math.round(process.uptime()) });
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
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.Reaction
    ]
});

// 🎭 رتب الإيموجي
client.on('messageReactionAdd', (reaction, user) => {
    reactionroles.handleReaction(reaction, user, true);
});

client.on('messageReactionRemove', (reaction, user) => {
    reactionroles.handleReaction(reaction, user, false);
});

// 🔊 الرومات الصوتية المؤقتة
client.on('voiceStateUpdate', (oldState, newState) => {
    tempvoice.handleVoiceState(oldState, newState);
});


// ======================================================
// HELPERS
// ======================================================

// الرتبة المخوّلة لاستخدام الأوامر (يجب أن تكون فوق رتبة البوت)
const STAFF_ROLE_NAME = process.env.STAFF_ROLE_NAME || 'ستريتر';

// إرجاع رتبة الصلاحيات في سيرفر معين
function getStaffRole(guild) {
    return guild?.roles?.cache?.find(
        role => role.name === STAFF_ROLE_NAME
    ) || null;
}

// هل العضو يملك صلاحية إدارية حقيقية في السيرفر؟
// (مالك السيرفر / صلاحية Administrator / رتبته فوق رتبة البوت)
function isServerAdmin(member, guild) {
    if (!member || !guild) return false;
    if (member.id === guild.ownerId) return true;
    if (member.permissions?.has(PermissionsBitField.Flags.Administrator)) return true;

    const botHighest = guild?.members?.me?.roles?.highest;

    if (botHighest && member.roles?.highest?.position > botHighest.position) {
        return true;
    }

    return false;
}

// هل العضو يملك صلاحية استخدام أوامر الإدارة؟
// (رتبة الستريتر أو صلاحية إدارية حقيقية — بدون تجاوز أعمى لأي آيدي)
function hasStaffAccess(member, guild) {
    if (!member || !guild) return false;
    return memberHasStaffRole(member, guild) || isServerAdmin(member, guild);
}

// هل العضو يملك رتبة الصلاحيات؟
function memberHasStaffRole(member, guild) {
    if (!member || !guild) return false;

    const staffRole = getStaffRole(guild);
    if (!staffRole) return false;

    return member.roles.cache.has(staffRole.id);
}

function isAdmin(interaction) {
    return hasStaffAccess(interaction.member, interaction.guild);
}

// فحص امتلاك رتبة الستريتر فقط (بدون شرط رفعها فوق البوت)
// تُستخدم لمعظم الأوامر الإدارية.
// أوامر /ticket الفرعية اللي صاحب التكت العادي يقدر يستخدمها
// (يضيف/يطرد أشخاص من تكتّه). أي أمر ثاني يظل محجوب على الرتبة.
const TICKET_MEMBER_SUBCOMMANDS = ['add', 'remove', 'members'];

async function requireStaffPermission(interaction, opts = {}) {
    const member = interaction.member;
    const guild = interaction.guild;

    if (isServerAdmin(member, guild)) return true;

    // استثناءات اختيارية: بعض أوامر slash مفتوحة لغير الرتب
    // (مثال: صاحب التكت يضيف ناس لتكتّه)
    if (opts?.allow && opts.allowCheck && interaction.isChatInputCommand()) {
        const sub = interaction.options.getSubcommand();
        const group = interaction.options.getSubcommandGroup
            ? interaction.options.getSubcommandGroup()
            : null;

        if (opts.allow.includes(sub) && opts.allowCheck(sub, group)) {
            return true;
        }
    }

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
            `أنشئها في إعدادات السيرفر حتى تشتغل الأوامر.`
        );
    }

    if (!memberHasStaffRole(member, guild)) {
        return replyContent(
            `❌ تحتاج رتبة **${STAFF_ROLE_NAME}** لاستخدام هذا الأمر.`
        );
    }

    return true;
}

// فحص صارم لأوامر الحماية: رتبة الستريتر لازم تكون فوق رتبة البوت
async function requireProtectionPermission(interaction) {
    const member = interaction.member;
    const guild = interaction.guild;

    if (isServerAdmin(member, guild)) return true;

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
            `أنشئها واجعلها **فوق** رتبة البوت حتى تشتغل أوامر الحماية.`
        );
    }

    if (!memberHasStaffRole(member, guild)) {
        return replyContent(
            `❌ تحتاج رتبة **${STAFF_ROLE_NAME}** لاستخدام أوامر الحماية.`
        );
    }

    const botHighest = guild?.members?.me?.roles?.highest;

    if (botHighest && staffRole.position <= botHighest.position) {
        return replyContent(
            `❌ لأوامر الحماية رتبة **${STAFF_ROLE_NAME}** لازم تكون **فوق** رتبة البوت.\n` +
            `من إعدادات السيرفر: Roles = ارفع رتبة **${STAFF_ROLE_NAME}** فوق رتبة البوت ثم أعد المحاولة.`
        );
    }

    // ==========================================
    // صلاحيات البوت الضرورية للحماية الفعلية
    // ==========================================
    const neededPerms = {
        [PermissionsBitField.Flags.ViewAuditLog]: 'مشاهدة سجل التدقيق',
        [PermissionsBitField.Flags.ManageChannels]: 'إدارة الرومات',
        [PermissionsBitField.Flags.ManageRoles]: 'إدارة الرتب',
        [PermissionsBitField.Flags.ManageWebhooks]: 'إدارة الويب هوك',
        [PermissionsBitField.Flags.BanMembers]: 'حظر الأعضاء',
        [PermissionsBitField.Flags.KickMembers]: 'طرد الأعضاء'
    };

    const missingPerms = Object.entries(neededPerms)
        .filter(([flag]) => !guild?.members?.me?.permissions?.has(flag))
        .map(([, label]) => `- ${label}`);

    if (missingPerms.length) {
        return replyContent(
            `⚠️ البوت محتاج هذه الصلاحيات حتى تشتغل الحماية فعلاً:\n` +
            missingPerms.join('\n') +
            `\n(أسهل حل: أعطه صلاحية **Administrator** أو اعتمد عليه من إعدادات الرتب).`
        );
    }

    return true;
}

// 🔎 راعي البوت (OWNER_IDS + OWNER_ID القديم)
function isBotOwner(userId) {
    const id = String(userId || '');
    if (!id) return false;
    return OWNER_IDS.includes(id) || (Boolean(OWNER_ID) && id === String(OWNER_ID));
}

// 🔒 الوايت ليست: راعي البوت (المالك) أو راعي السيرفر فقط
// ما نسمح لرتبة الستريتر أو الأدمن يحطون أعضاء بالوايت ليست
async function requireWhitelistPermission(interaction) {
    const userId = String(interaction.user?.id || interaction.member?.id || '');
    const guild = interaction.guild;

    const botOwner = isBotOwner(userId);
    const isGuildOwner = Boolean(guild?.ownerId) && String(guild.ownerId) === userId;

    if (botOwner || isGuildOwner) return true;

    return interaction.reply({
        content:
            `🔒 **الوايت ليست للمالك فقط**\n` +
            ` تقدر تستخدمها: **راعي البوت** أو **راعي السيرفر** (<@${guild?.ownerId || '؟'}>) فقط.\n` +
            `الستريتر والأدمن ما يقدرون يضيفون أو يحذفون من الوايت ليست.`,
        ephemeral: true
    });
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

function attachmentKind(contentType) {
    const ct = contentType || '';
    if (ct.startsWith('image/')) return '🖼️ صورة';
    if (ct.startsWith('video/')) return '🎬 فيديو';
    if (ct.startsWith('audio/')) return '🔊 صوت';
    return '📄 ملف';
}

function describeMessageMedia(message) {
    const lines = [];

    const stickers = message?.stickers ? [...message.stickers.values()] : [];
    if (stickers.length) {
        lines.push('🧩 ستيكر: ' + stickers.map(s => s.name || 'ستيكر').join(', '));
    }

    const attachments = message?.attachments ? [...message.attachments.values()] : [];
    if (attachments.length) {
        lines.push('📎 المرفقات:');
        for (const a of attachments) {
            lines.push(`> ${attachmentKind(a.contentType)} — ${a.name || 'ملف'} — ${a.url}`);
        }
    }

    const embedCount = message?.embeds?.length || 0;
    if (embedCount) lines.push(`🔗 إيمبدات: ${embedCount}`);

    return lines.join('\n');
}

function firstImageUrl(message) {
    const attachments = message?.attachments ? [...message.attachments.values()] : [];
    const img = attachments.find(a => (a.contentType || '').startsWith('image/'));
    return img?.url || null;
}

// بيانات كل نوع لوق: اسم واضح + لون ثابت + أيقونة
const LOG_TYPE_META = {
    voice: { label: 'القنوات الصوتية', color: 0x5865F2, icon: '🔊' },
    role: { label: 'الرتب', color: 0xEB459E, icon: '🎭' },
    channel: { label: 'القنوات', color: 0xF1C40F, icon: '📁' },
    webhook: { label: 'الويب هوك', color: 0x9B59B6, icon: '🪝' },
    member: { label: 'الأعضاء', color: 0x57F287, icon: '👤' },
    moderation: { label: 'الإجراءات الإدارية', color: 0xED4245, icon: '🛡️' },
    message: { label: 'الرسائل', color: 0x95A5A6, icon: '💬' },
    protection: { label: 'الحماية', color: 0xE67E22, icon: '🚨' }
};

async function sendLog(guild, type, title, description, color, extra) {
    try {
        const settings = await GuildSettings.findById(guild.id);

        if (!settings) return;

        const channelId = settings.logs?.[type];

        if (!channelId) return;

        const channel = guild.channels.cache.get(channelId);

        if (!channel || !channel.isTextBased()) return;

        const meta = LOG_TYPE_META[type] || { label: type, color: 0x5865F2, icon: '📌' };
        const guildIcon = guild.iconURL({ size: 128 }) || undefined;

        const embed = new EmbedBuilder()
            .setAuthor({
                name: `${meta.icon}  سجل ${meta.label}`,
                iconURL: guildIcon
            })
            .setTitle(title)
            .setDescription(description ? String(description).slice(0, 4000) : '—')
            .setColor(color ?? meta.color)
            .setFooter({
                text: `${meta.label} • ${guild.name}`,
                iconURL: guildIcon
            })
            .setTimestamp();

        if (extra?.thumbnail) embed.setThumbnail(extra.thumbnail);
        if (extra?.image) embed.setImage(extra.image);
        if (Array.isArray(extra?.fields) && extra.fields.length) {
            embed.addFields(extra.fields.slice(0, 25));
        }

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
        },

        image: {
            type: String,
            default: null
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
        },

        protection: {
            type: String,
            default: null
        }
    },

    autoResponses: {
        type: [
            {
                trigger: String,
                response: String,
                staffOnly: {
                    type: Boolean,
                    default: false
                }
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
            action: { type: String, default: 'ban' },
            metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
            metricActions: { type: mongoose.Schema.Types.Mixed, default: {} }
        },
        roles: {
            enabled: { type: Boolean, default: false },
            limit: { type: Number, default: 5 },
            action: { type: String, default: 'ban' },
            metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
            metricActions: { type: mongoose.Schema.Types.Mixed, default: {} }
        },
        bans: {
            enabled: { type: Boolean, default: false },
            limit: { type: Number, default: 3 },
            action: { type: String, default: 'kick' },
            metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
            metricActions: { type: mongoose.Schema.Types.Mixed, default: {} }
        },
        bots: {
            enabled: { type: Boolean, default: false },
            metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
            metricActions: { type: mongoose.Schema.Types.Mixed, default: {} }
        },
        spam: {
            enabled: { type: Boolean, default: false },
            limit: { type: Number, default: 5 },
            timeframe: { type: Number, default: 5000 },
            maxLength: { type: Number, default: 400 },
            repeatedChar: { type: Number, default: 8 },
            // 🧩 قواعد الحماية الإضافية
            maxMentions: { type: Number, default: 6 },
            maxSpaces: { type: Number, default: 10 },
            maxBigText: { type: Number, default: 60 },
            maxFiles: { type: Number, default: 4 },
            onMentions: { type: Boolean, default: true },
            onSpaces: { type: Boolean, default: true },
            onBigText: { type: Boolean, default: true },
            onFiles: { type: Boolean, default: true },
            onLinks: { type: Boolean, default: true },
            onInvites: { type: Boolean, default: true },
            action: { type: String, default: 'timeout' },
            metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
            metricActions: { type: mongoose.Schema.Types.Mixed, default: {} }
        },
        webhooks: {
            enabled: { type: Boolean, default: false },
            limit: { type: Number, default: 5 },
            action: { type: String, default: 'ban' },
            metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
            metricActions: { type: mongoose.Schema.Types.Mixed, default: {} }
        },
        invites: {
            enabled: { type: Boolean, default: false },
            code: { type: String, default: null },
            channelId: { type: String, default: null },
            action: { type: String, default: 'ban' },
            // ⛔ مافيها تجاوز ولا حد تأخير: أول ما ينحذف الاختصار = عقوبة فورية
            // (الاستثناء الوحيد: راعي البوت)
            metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
            metricActions: { type: mongoose.Schema.Types.Mixed, default: {} }
        },
        scams: {
            enabled: { type: Boolean, default: false },
            // الرومات المحمية — لازم واحد على الأقل للتفعيل
            channelIds: { type: [String], default: [] },
            // القاعدة لكل نوع محتوى (كل وحدة مفعّلة/معطّلة لحالها)
            onTalk: { type: Boolean, default: false },
            onImage: { type: Boolean, default: false },
            onLink: { type: Boolean, default: false },
            action: { type: String, default: 'ban' },
            metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
            metricActions: { type: mongoose.Schema.Types.Mixed, default: {} }
        }
    },

    tickets: {
        enabled: { type: Boolean, default: false },
        panelChannelId: { type: String, default: null },
        categoryId: { type: String, default: null },
        supportRoleId: { type: String, default: null },
        logChannelId: { type: String, default: null },
        welcomeMessage: { type: String, default: 'أهلاً بك 👋 اشرح مشكلتك وسيقوم الفريق بمساعدتك بأقرب وقت.' },
        panelImage: { type: String, default: null },
        welcomeImage: { type: String, default: null },
        panelMessageId: { type: String, default: null },
        maxPerUser: { type: Number, default: 1 },
        options: {
            type: [
                {
                    key: { type: String, default: null },
                    label: { type: String, default: 'تكت' },
                    description: { type: String, default: '' },
                    emoji: { type: String, default: '🎫' },
                    staffOnly: { type: Boolean, default: false },
                    // ⏸️ معلق: الزر يبقى باللوحة بس معطّل — ولا يفتح تكت
                    suspended: { type: Boolean, default: false }
                }
            ],
            default: []
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
    },

    // 🛡️ رومات محمية ما تُمسح أبداً بالتنظيف أو الاسترجاع
    protectedChannelIds: {
        type: [String],
        default: []
    },

    // 📦 حالة النسخ الاحتياطي المجدول
    backupState: {
        lastBackupAt: { type: Date, default: null },
        nextBackupAt: { type: Date, default: null },
        delayDays: { type: Number, default: 0 },
        changeDay: { type: String, default: null }
    },

    // 🎁 روم القيف اواي
    giveawayChannelId: {
        type: String,
        default: null
    },

    // 🔊 الرومات الصوتية المؤقتة
    voice: {
        creatorChannelId: { type: String, default: null },
        categoryId: { type: String, default: null },
        nameTemplate: { type: String, default: '🔊 {user}' }
    },

    // 💬 روم الفيدباك
    feedbackChannelId: {
        type: String,
        default: null
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

// نسخة احتياطية كاملة للسيرفر (قنوات + رتب) للاسترجاع اليدوي بعد التهكير
const backupSchema = new mongoose.Schema({
    guildId: {
        type: String,
        required: true
    },
    capturedAt: {
        type: Date,
        default: Date.now
    },
    channels: {
        type: mongoose.Schema.Types.Mixed,
        default: []
    },
    roles: {
        type: mongoose.Schema.Types.Mixed,
        default: []
    },
    emojis: {
        type: mongoose.Schema.Types.Mixed,
        default: []
    },
    stickers: {
        type: mongoose.Schema.Types.Mixed,
        default: []
    },
    protections: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    }
});

backupSchema.index({ guildId: 1 }, { unique: true });

const GuildBackup = mongoose.model(
    'GuildBackup',
    backupSchema
);


// 📦 سجل النسخ الاحتياطية — آخر 7 نسخ لكل سيرفر (نرجع لأي وحدة منها)
const backupHistorySchema = new mongoose.Schema({
    guildId: { type: String, required: true, index: true },
    capturedAt: { type: Date, default: Date.now },
    kind: { type: String, default: 'auto' },
    channels: { type: mongoose.Schema.Types.Mixed, default: [] },
    roles: { type: mongoose.Schema.Types.Mixed, default: [] },
    emojis: { type: mongoose.Schema.Types.Mixed, default: [] },
    stickers: { type: mongoose.Schema.Types.Mixed, default: [] },
    protections: { type: mongoose.Schema.Types.Mixed, default: {} }
});

backupHistorySchema.index({ guildId: 1, capturedAt: -1 });

const GuildBackupHistory = mongoose.model(
    'GuildBackupHistory',
    backupHistorySchema
);

const BACKUP_HISTORY_LIMIT = 7;


// سيرفرات المستخدم المحفوظة في الداشبورد (كاش فوري عند الدخول ثانية)
const dashboardUserSchema = new mongoose.Schema({
    userId: {
        type: String,
        required: true,
        unique: true
    },
    guilds: {
        type: mongoose.Schema.Types.Mixed,
        default: []
    },
    username: String,
    authorized: {
        type: Boolean,
        default: true
    },
    authorizedAt: Date,
    authorizedGuilds: {
        type: [String],
        default: []
    },
    loginCount: {
        type: Number,
        default: 0
    },
    lastLoginAt: Date,
    lastLoginIp: String,
    lastLoginDevice: String,
    firstLoginAt: Date,
    firstLoginIp: String,
    firstLoginDevice: String,
    firstLoginNotificationSentAt: Date,
    firstLoginNotificationPending: Boolean,
    firstLoginNotificationPendingAt: Date,
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

const DashboardUser = mongoose.model(
    'DashboardUser',
    dashboardUserSchema
);


// سجل تعديلات الداشبورد (من عدّل ماذا ومتى)
const dashboardLogSchema = new mongoose.Schema({
    guildId: {
        type: String,
        index: true
    },
    userId: String,
    username: String,
    action: String,
    details: String,
    createdAt: {
        type: Date,
        default: Date.now
    }
});

dashboardLogSchema.index({ guildId: 1, createdAt: -1 });

const DashboardLog = mongoose.model(
    'DashboardLog',
    dashboardLogSchema
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

// إصلاحات شغّالة الآن — لو 20 سيرفر يطلبون إعداداتهم بنفس اللحظة
// ما نبي كل واحد يطبع "Repaired" لنفس السيرفر (تكرار في اللوق)
const settingRepairInFlight = new Map();

// البوت يستقبل رسائل قبل ما Mongo يوصّل (الاتصال يجي بعد تسجيل الدخول بكم ثانية).
// bufferCommands=false يفشل فورًا عندها، فننتظر الاتصال بدل ما نرمي استثناء.
let dbWaitWarned = false;

async function waitForDatabase(timeoutMs = 20000) {
    if (mongoose.connection.readyState === 1) return true;

    if (!dbWaitWarned) {
        dbWaitWarned = true;
        console.log('⏳ طلب من القاعدة قبل الاتصال — بانتظر MongoDB (مرة واحدة فقط)');
    }

    return new Promise(resolve => {
        const timer = setTimeout(() => resolve(false), timeoutMs);

        mongoose.connection.once('connected', () => {
            clearTimeout(timer);
            resolve(true);
        });
    });
}

// حالات تعيين روم السجل بواسطة المنشن:
// userId -> { type, guildId, expires }
const pendingLogChannelSet = new Map();

async function getSettings(guildId) {
    await waitForDatabase();

    let settings;

    try {
        settings = await GuildSettings.findById(guildId);
    } catch {
        settings = null;
    }

    // إصلاح قسري مباشرة في القاعدة: إجبار الحقول الفاسدة على مصفوفات نظيفة
    // (مرة واحدة لكل سيرفر) لضمان عدم وجود كائن مكان مصفوفة إطلاقاً
    if (!repairedSettingGuilds.has(guildId)) {
        if (!settingRepairInFlight.has(guildId)) {
            settingRepairInFlight.set(guildId, (async () => {
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
            })());
        }

        await settingRepairInFlight.get(guildId);
        settingRepairInFlight.delete(guildId);

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

    // تحديث كاش الحماية السريع
    try {
        const protSnapshot = JSON.parse(JSON.stringify(
            settings.protections || {}
        ));
        const wlSnapshot = Array.isArray(settings.whitelist)
            ? settings.whitelist.slice()
            : [];

        protectionsCache.set(guildId, {
            protections: protSnapshot,
            whitelist: wlSnapshot
        });
    } catch {}

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
// IMAGE RESOLVER — يقبل رابط أو مرفقSlash ويحوّله لِينك
// ======================================================

// أقصى حجم مرفق نقبله (ديسكورد نفسه 25MB للعضو، بس للصور 8MB يكفي)
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp)(\?|#|$)/i;

// ينشئ اسم ملف صحيح الامتداد من لينك الصورة — الكود القديم كان
// يفرض welcome-image.png على أي صورة وتتكسر صور jpg/gif
function imageFileName(url, fallback = 'image.png') {
    const ext = String(url || '').match(IMAGE_EXT_RE);
    return ext ? `welcome-image.${ext[1].toLowerCase()}` : fallback;
}

// يقرأ خيار url أو file من أمر slash ويرجّع { url, source } أو { error }
function resolveImageOption(interaction, urlName = 'url', fileName = 'file') {
    const rawUrl = interaction.options.getString(urlName);
    const attachment = interaction.options.getAttachment(fileName);

    if (rawUrl && attachment) {
        return { error: '❌ اختر **واحد فقط**: رابط `url` أو مرفق `file` — مو الاثنين مع بعض.' };
    }

    if (rawUrl) {
        const url = String(rawUrl).trim();

        if (!/^https?:\/\//i.test(url)) {
            return { error: '❌ الرابط لازم يبدأ بـ `http://` أو `https://`.\n💡 تأكد أنه **رابط مباشر** للصورة مو رابط صفحة.' };
        }

        if (!IMAGE_EXT_RE.test(url)) {
            return { error: '❌ ما قدرت أعرف نوع الصورة من الرابط.\n💡 لازم ينتهي بـ `.png` أو `.jpg` أو `.jpeg` أو `.gif` أو `.webp`' };
        }

        return { url, source: 'url' };
    }

    if (attachment) {
        if (!String(attachment.contentType || '').startsWith('image/')) {
            return { error: `❌ الملف المرفق مو صورة (نوعه: \`${attachment.contentType || 'غير معروف'}\`).\n💡 ارفع صورة بصيغة png أو jpg أو gif أو webp.` };
        }

        if (Number(attachment.size) > MAX_IMAGE_BYTES) {
            return { error: `❌ الصورة كبيرة (${(attachment.size / 1048576).toFixed(1)}MB) — الحد الأقصى **8MB**.\n💡 صغّرها أو استخدم رابط مباشرة.` };
        }

        // نخزّن لينك الـ CDN بتاع ديسكورد — يشتغل كـ URL للإيمبد
        // وكمرفق في رسالة الترحيب على أي استضافة
        return { url: attachment.url, source: 'file' };
    }

    return { url: null, source: null };
}


// ======================================================
// ANTI-NUKE PROTECTION (Channels / Roles / Bans / Bots)
// ======================================================

// عدّادات لكل فضية داخل فترة زمنية
// ملاحظة: لكل عملية عدّاد مستقل (channels/roles للإضافة+الحذف معاً،
// وchannelUpdates/roleUpdates للتعديل فقط) حتى ما تتداخل الحدود
const protectionCounts = {
    channels: new Map(),
    channelUpdates: new Map(),
    roles: new Map(),
    roleUpdates: new Map(),
    bans: new Map(),
    spam: new Map(),
    webhooks: new Map(),
    webhookDeletes: new Map(),
    invites: new Map(),
    botJoins: new Map(),
    scams: new Map()
};

// تتبّع الأشياء (رومات/رتب/ويب هوك) المنشأة على يد كل فاعل:
// guildId-executorId -> [{ id, ts }] — لنحذف كل ما سواه عند تجاوز الحد
// (الويب هوك مُضاف حتى نمسحه "أين ما كان" — رومات مختلفة/كاتوقريز)
const createdByActor = {
    channels: new Map(),
    roles: new Map(),
    webhooks: new Map()
};

// سجّل إبداع الفاعل (لحذفه لاحقاً عند العقوبة)
function trackCreatedItem(tracker, guildId, executorId, itemId, windowMs = 20 * 60 * 1000) {
    try {
        const now = Date.now();
        const key = `${guildId}-${executorId}`;
        const list = (tracker.get(key) || [])
            .filter(it => now - it.ts <= windowMs);
        list.push({ id: itemId, ts: now });
        tracker.set(key, list);
    } catch {}
}

// احذف كل إبداعات الفاعل (أو مرّر قائمة أهداف للحذف)
async function removeCreatedByActor(tracker, guild, executorId, currentlyCreated) {
    const key = `${guild.id}-${executorId}`;
    const list = tracker.get(key) || [];

    const ids = new Set(list.map(it => it.id));
    if (currentlyCreated) ids.add(currentlyCreated.id);

    // 🛡️ ما نلمس الرومات المحمية حتى لو أنشأها الفاعل
    let protectedIds = new Set();
    try {
        const settings = await getSettings(guild.id);
        protectedIds = await getProtectedChannelIds(guild, settings);
    } catch {}

    let removed = 0;

    for (const itemId of ids) {
        try {
            const item = guild.channels.cache.get(itemId) ||
                         guild.roles.cache.get(itemId);
            if (item?.deletable && !protectedIds.has(item.id)) {
                await item.delete('[Anti-Nuke] حذف إبداعات غير مصرّح بها');
                removed++;
            }
        } catch {}
    }

    tracker.delete(key);
    return removed;
}

// احذف الويب هوك التي أنشأها الفاعل — أين ما كانت (روم/كاتوقري مختلف)
async function removeTrackedWebhooks(guild, executorId) {
    const key = `${guild.id}-${executorId}`;
    const list = createdByActor.webhooks.get(key) || [];

    if (!list.length) return 0;

    createdByActor.webhooks.delete(key);

    try {
        const hooks = await guild.fetchWebhooks();
        let removed = 0;

        for (const entry of list) {
            const hook = hooks.get(entry.id);
            if (!hook) continue;

            await hook.delete('[Anti-Nuke] ويب هوك أنشأه فاعل مخالف').catch(() => {});
            removed++;
        }

        return removed;
    } catch (error) {
        console.error('Tracked webhook cleanup error:', error);
        return 0;
    }
}

// عدّاد تحذيرات السبام لكل عضو (قبل تطبيق Time-out)
// { count, last }
const spamWarnCounts = new Map();

// عدّادات الفيضان (نوك) لكل سيرفر — تعمل حتى لو ما تحددنا الفاعل من سجل التدقيق
const protectionFloods = {
    channels: new Map(),
    channelDeletes: new Map(),
    roles: new Map(),
    roleDeletes: new Map(),
    webhooks: new Map(),
    botJoins: new Map()
};

// كاش فوري لإعدادات الحماية (يُحدَّث مع كل قراءة من القاعدة)
// الغرض: فحص "هل الحماية مفعّلة" بدون قراءة من قاعدة البيانات في مسار الأحداث السريع
const protectionsCache = new Map();

// بوتات ومستخدمون انضموا مؤخراً وتحت المراقبة (تُنظّف تلقائياً)
// guildId -> [{ userId, joinedAt }]
const suspectedBots = new Map();

const SUSPECT_WINDOW = 15 * 60 * 1000;   // كم دقيقة نظل نراقب العضو الجديد
const SUSPECT_BAN_WINDOW = 10 * 60 * 1000; // كم دقيقة نعيد فيها البند لو حصل فيضان

function addSuspectedBot(guildId, userId) {
    try {
        const now = Date.now();
        const list = (suspectedBots.get(guildId) || [])
            .filter(b => now - b.joinedAt <= SUSPECT_WINDOW);

        list.push({ userId, joinedAt: now });
        suspectedBots.set(guildId, list);
    } catch {}
}

function getSuspectedBots(guildId, withinMs = SUSPECT_BAN_WINDOW) {
    try {
        const now = Date.now();
        const list = (suspectedBots.get(guildId) || [])
            .filter(b => now - b.joinedAt <= withinMs);

        suspectedBots.set(guildId, list);
        return list.map(b => b.userId);
    } catch {
        return [];
    }
}

// هل عدد الأحداث خلال فترة قصيرة تجاوز الحد (نوك سريع)؟
function isNukeFlood(tracker, guildId, limit, windowMs = 8000) {
    const now = Date.now();
    const list = (tracker.get(guildId) || [])
        .filter(t => now - t <= windowMs);

    list.push(now);
    tracker.set(guildId, list);

    return list.length > limit;
}

// فترة صلاحية التحذيرين (لو ما كرر السبام خلالها يصفّر العدّاد)
const SPAM_WARN_WINDOW = 10 * 60 * 1000;

// مدة الـ Time-out عند تجاوز التحذيرين
const SPAM_TIMEOUT_MS = 10 * 60 * 1000;

function recordEvent(counterKey, guildId, userId) {
    const key = `${guildId}-${userId}`;
    return key;
}

// أخطاء سجل التدقيق المتوقّعة (البوت انطرد/مو بالسيرفر أو ما عنده View Audit Log)
// ما تستاهل تطبّع وتزحم اللوق — نتعامل معها كـ "ما فيه فاعل" ونكمل.
function isIgnorableAuditError(error) {
    const code = error?.code || error?.status || error?.rawError?.code;
    return code === 10004 || code === 50013 || code === 50001;
}

async function getAuditExecutor(guild, type, targetId = null) {
    try {
        const audit = await guild.fetchAuditLogs({ type, limit: 1 });
        const entry = audit.entries.first();

        if (!entry) return null;
        if (Date.now() - entry.createdTimestamp > 30000) return null;
        if (targetId && entry.targetId !== targetId) return null;

        return entry.executor?.id || null;
    } catch (error) {
        if (!isIgnorableAuditError(error)) {
            console.error(
                `Audit log fetch error (${guild?.id}, type ${type}): ${error.message}`
            );
        }
        return null;
    }
}

// إرجاع منشن من نفّذ الفعل من سجل التدقيق
async function executorMention(guild, type, targetId = null) {
    const id = await getAuditExecutor(guild, type, targetId);
    return id ? `<@${id}>` : 'غير معروف';
}

// اصطياد الفاعل في حالات الفيضان: بدل الاعتماد على "آخر إدخال يطابق التارجت"
// (الذي يفشل وقت 100 روم دفعة واحدة)، نجيب أحدث الفاعلين غير البوت
async function getFloodExecutor(guild, type, maxEntries = 25, windowMs = 120000) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const audit = await guild.fetchAuditLogs({ type, limit: maxEntries });
            const now = Date.now();

            const entry = audit.entries.find(
                e => e.executor?.id &&
                     e.executor.id !== client.user.id &&
                     now - e.createdTimestamp <= windowMs
            );

            if (entry?.executor?.id) return entry.executor.id;

            // السجل ما زال يتحدّث — ننتظر قليلاً ونعيد المحاولة
            if (attempt < 3) {
                await new Promise(r => setTimeout(r, 1500 * attempt));
            }
        } catch (error) {
            if (!isIgnorableAuditError(error)) {
                console.error(
                    `Audit flood fetch error (${guild.id}, type ${type}): ${error.message}`
                );
            }

            if (attempt < 3) {
                await new Promise(r => setTimeout(r, 1500 * attempt));
            }
        }
    }

    return null;
}

// تحديد موثوق للفاعل حتى في الحركة البطيئة:
// سجل التدقيق أحياناً يتأخر عن الحدث → نعيد المحاولة، ثم نرجع لأي منفذ حديث
async function resolveAbuseExecutor(guild, auditType, targetId) {
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const audit = await guild.fetchAuditLogs({ type: auditType, limit: 25 });
            const now = Date.now();

            // 1) أولاً: entry مطابق للهدف خلال 30 ثانية
            const byTarget = audit.entries.find(
                e => e.targetId === targetId &&
                     e.executor?.id &&
                     e.executor.id !== client.user.id &&
                     now - e.createdTimestamp <= 30000
            );

            if (byTarget?.executor?.id) return byTarget.executor.id;

            // 2) ثم: أحدث منفذ غير البوت خلال دقيقتين (ينجح مع الحذف الجماعي)
            const anyExecutor = audit.entries.find(
                e => e.executor?.id &&
                     e.executor.id !== client.user.id &&
                     now - e.createdTimestamp <= 120000
            );

            if (anyExecutor?.executor?.id) return anyExecutor.executor.id;

            if (attempt === 1) {
                console.log(
                    `[PROTECT] resolveAbuseExecutor: لا منفذ مطابق في أول جلب ` +
                    `(type=${auditType} entries=${audit.entries.size})`
                );
            }
        } catch (error) {
            if (!isIgnorableAuditError(error)) {
                console.error(
                    `[PROTECT] resolveAbuseExecutor ERROR ` +
                    `(type=${auditType} guild=${guild.id}):`, error.message
                );
            }
        }

        if (attempt < 3) {
            await new Promise(r => setTimeout(r, 1000 * attempt));
        }
    }

    // ما لقينا من ينطبق على التارجت — نرجع لأحدث منفذ نشط غير البوت
    return getFloodExecutor(guild, auditType, 25, 120000);
}

function isLimitExceeded(counter, key, now, limit, timeframe) {
    const list = (counter.get(key) || [])
        .filter(t => now - t <= timeframe);

    list.push(now);
    counter.set(key, list);

    return list.length > limit;
}

// عدّاد تراكمي بدون فترة زمنية:
// أي تجاوز للحد يتعاقب عليه حتى لو كان على مدى ساعات
function countExceeded(counter, key, limit) {
    const count = (counter.get(key) || 0) + 1;
    counter.set(key, count);
    return count > limit;
}

// تصفير عدّاد المخالف بعد تطبيق العقوبة (حتى لا يتراكم في الذاكرة)
function clearCount(counter, key) {
    counter.delete(key);
}

// ======================================================
// 🛡️ حصانة الوايت ليست
// ======================================================
// قاعدة واحدة: أي شخص بقائمة الوايت ليسْت ما يعاقبه البوت أبداً —
// لا سبام، لا رَيَد، لا نوك، لا عقوبة مسبّب، لا بند مشبوه.
//
// قبل كانت الحماية تتحقق من الوايت ليسْت بس عند protectionAllowed() ودخول
// البوتات، وباقي مسارات العقوبة كانت تنفّذ على العضو وهو بالقايمة.
async function whitelistExempt(guildId, userId) {
    if (!guildId || !userId) return false;

    const id = String(userId);
    const key = String(guildId);

    // 1) الكاش (يكون معبّأ قبل تنفيذ العقوبة بـ getProtectionConfig)
    const cached = protectionsCache.get(key);
    if (cached && Array.isArray(cached.whitelist)) {
        return cached.whitelist.includes(id);
    }

    // 2) القاعدة مباشرة
    try {
        const settings = await getSettings(guildId);
        const list = Array.isArray(settings?.whitelist) ? settings.whitelist : [];
        return list.includes(id);
    } catch {
        return false;
    }
}

// بند المتهمين (البشر والبوتات اللي دخلوا مؤخراً) عند حصول فيضان بدون مسبب مشخص
// يرجّع مصفوفة بأيدي الذين تم بنودهم فعلاً
async function banSuspectedBots(guild, prot, context) {
    const suspects = getSuspectedBots(guild.id);
    const banned = [];

    const botHighest = guild.members.me?.roles?.highest;

    for (const suspectId of suspects) {
        try {
            const member = await getMember(guild, suspectId);

            // 🛡️ بالقايمة البيضاء: البوت ما يمسّه أبداً
            if (await whitelistExempt(guild.id, member?.id || suspectId)) {
                console.log(
                    `[PROTECT] تخطّي بند المشبوه ${suspectId} ` +
                    `(${guild.id}) — بالقايمة البيضاء (${context})`
                );
                continue;
            }

            // بنفس/فوق رتبة البوت: الديسكورد ما يسمح — نخطيه
            if (member?.roles?.highest && botHighest) {
                const pos = member.roles.highest.position;
                if (pos >= botHighest.position) continue;
            }

            const reason = `[Anti-Nuke] نوك مشبوه (${context})`;

            if (member?.bannable) {
                await member.ban({ reason });
            } else {
                // البيت غادر/غير موجود: البند بالقوة عبر الأيدي
                await guild.bans.create(suspectId, { reason });
            }

            banned.push(suspectId);
            console.log(
                `[PROTECT] بند المشبوه ${suspectId} (${guild.id}) | ${context}`
            );
        } catch (error) {
            console.error('Suspect ban error:', error);
        }
    }

    return banned;
}

async function applyPunishment(member, action, reason) {
    if (!member) return;

    // 🛡️ بالقايمة البيضاء: البوت ما يتدخل أبداً مهما كانت العقوبة
    if (await whitelistExempt(member.guild?.id, member.id)) {
        console.log(
            `[PROTECT] تخطّي العقوبة "${action}" على ${member.id} — بالقايمة البيضاء`
        );
        return;
    }

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
        } else if (action === 'jail') {
            // 🔒 سجن: رتبة «سجن» حمراء + ما تشوف ولا روم (ينشئها لو ما موجودة)
            await jailMember(member);
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

// تحميل صورة/ملف من رابط (CDN) لاستخدامه في استرجاع الإيموجي/الستيكرات
async function downloadBuffer(url) {
    // يعمل مع Node 16+ (بلا fetch مدمج): يستخدم https القياسي
    if (typeof fetch === 'undefined') {
        return await downloadWithHttps(url);
    }

    try {
        const res = await fetch(url);

        if (!res.ok) return null;

        const buf = Buffer.from(await res.arrayBuffer());

        if (!buf || !buf.length) return null;

        return buf;
    } catch (error) {
        console.error(`[BACKUP] فشل تحميل ${url}:`, error.message);
        return null;
    }
}

// fallback للنسخ القديمة من Node دون fetch مدمج
async function downloadWithHttps(url) {
    const { get } = require('https');

    return new Promise(resolve => {
        get(url, res => {
            if (res.statusCode < 200 || res.statusCode >= 300) {
                res.resume();
                return resolve(null);
            }

            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const buf = Buffer.concat(chunks);
                resolve(buf.length ? buf : null);
            });
        }).on('error', error => {
            console.error(`[BACKUP] فشل تحميل ${url}:`, error.message);
            resolve(null);
        });
    });
}

// عقوبة قوية للمسبب المحدد: الباند يتم حتى لو غادر السيرفر (بالأيدي)
async function punishFor(guild, member, executorId, action, reason) {
    // 🛡️ بالقايمة البيضاء: ما نعدّم على المسبّب إطلاقاً
    if (await whitelistExempt(guild?.id, executorId)) {
        console.log(
            `[PROTECT] تخطّي عقوبة "${action}" على ${executorId} — بالقايمة البيضاء`
        );
        return false;
    }

    const fullReason = `[Anti-Nuke] ${reason}`;

    // ==============================================
    // 🛡️ سلامة الرتب: ما نقدر نعدّل على اللي فوق أو同级 البوت
    // (يشمل العقوبة الأساسية والاختصار معاً)
    // ==============================================
    const botHighest = guild?.members?.me?.roles?.highest;
    const pos = member?.roles?.highest?.position ?? -1;

    if (botHighest && pos >= botHighest.position) {
        console.error(
            `[PROTECT] فشل تنفيذ ${action} على ${executorId}: ` +
            `رتبة الفاعل (${pos}) >= رتبة البوت (${botHighest.position}) — لم يُعدّل ترتيب الحماية`
        );
        return false;
    }

    // ==============================================
    // ⚡ عقوبة مختصرة: shortcut:<اسم الاختصار>
    // ينفّذ أمر الاختصار المحفوظ على العضو المسبّب
    // ==============================================
    if (typeof action === 'string' && action.startsWith('shortcut:')) {
        const wanted = normalizeText(action.slice('shortcut:'.length).trim());
        const settings = await getSettings(guild.id).catch(() => null);
        const shortcut = (settings?.shortcuts || []).find(
            s => normalizeText(String(s?.name || '')) === wanted
        );

        if (!shortcut?.command) {
            console.error(`[PROTECT] الاختصار "${action.slice(9)}" غير موجود في السيرفر ${guild.id} — تم تجاهله`);
            return false;
        }

        const cmd = shortcut.command;

        // نرجّع true/false صراحةً بدل الاعتماد على قيمة الإرجاع من ديسكورد
        const runShortcutPunish = async () => {
            if (cmd === 'ban' && executorId) {
                if (member?.bannable) {
                    await member.ban({ reason: fullReason });
                } else {
                    // العضو غادر أو ما نقدر نشدّه → نبنّد بالـ ID
                    await guild.bans.create(executorId, { reason: fullReason });
                }
                return true;
            }

            if (cmd === 'kick' && member?.kickable) {
                await member.kick(fullReason);
                return true;
            }

            if (cmd === 'timeout' && member?.moderatable) {
                await member.timeout(SPAM_TIMEOUT_MS, fullReason);
                return true;
            }

            if (cmd === 'jail' && member) {
                await jailMember(member);
                return true;
            }

            return false;
        };

        const result = await runShortcutPunish().catch(error => {
            console.error(`[PROTECT] خطأ في اختصار "${shortcut.name}":`, error?.message || error);
            return null;
        });

        if (result) {
            console.log(`[PROTECT] تم تنفيذ اختصار "${shortcut.name}" (${cmd}) على ${executorId}`);
            return true;
        }

        console.error(
            `[PROTECT] الاختصار "${shortcut.name}" (${cmd}) ما ينطبق على ${executorId}: ` +
            `bannable=${!!member?.bannable} kickable=${!!member?.kickable} ` +
            `moderatable=${!!member?.moderatable} member=${!!member}`
        );
        return false;
    }

    try {
        if (action === 'ban' && executorId) {
            if (member?.bannable) {
                await member.ban({ reason: fullReason });
                console.log(`[PROTECT] تم تنفيذ ban على ${executorId}`);
                return true;
            }

            // العضو غادر أو الموجودة ما تقدر تشد — نبنّد بالـ ID
            await guild.bans.create(executorId, { reason: fullReason });
            console.log(`[PROTECT] تم تنفيذ ban (by ID) على ${executorId}`);
            return true;
        }

        if (action === 'kick' && member?.kickable) {
            await member.kick(fullReason);
            console.log(`[PROTECT] تم تنفيذ kick على ${executorId}`);
            return true;
        }

        if (action === 'timeout' && member?.moderatable) {
            await member.timeout(SPAM_TIMEOUT_MS, fullReason);
            console.log(`[PROTECT] تم تنفيذ timeout على ${executorId}`);
            return true;
        }

        if (action === 'removeroles' && member) {
            const removable = member.roles.cache.filter(
                role => role.id !== member.guild.id && role.editable
            );
            if (removable.size) {
                await member.roles.remove(removable, fullReason);
                console.log(`[PROTECT] تم تنفيذ removeroles على ${executorId}`);
            }
            return true;
        }

        console.error(
            `[PROTECT] لم ينفّذ ${action} على ${executorId}: ` +
            `bannable=${!!member?.bannable} kickable=${!!member?.kickable} ` +
            `moderatable=${!!member?.moderatable} member=${!!member}`
        );
    } catch (error) {
        console.error(`PunishFor error (${action} on ${executorId}):`, error);
    }

    return false;
}

// ======================================================
// ⚖️ تسلسل العقوبة على البوت المخالف (المطلوب):
//    (1) الباند أولاً — يوقف الفاعل فوراً قبل أي شيء
//    (2) ثم مسح الرومات/الرتب/الويب هوك اللي أنشأها — أين ما كانت
// ======================================================

// بند فوري للفاعل: مباشر ← إزالة الرتب القابلة للتعديل ← بند بالـ ID
async function banActorFirst(guild, member, executorId, fullReason) {
    // 1) الباند المباشر (أسرع مسار)
    if (member?.bannable) {
        try {
            await member.ban({ reason: fullReason });
            console.log(`[PROTECT] باند مباشر على ${executorId} (أولاً)`);
            return true;
        } catch (error) {
            console.error(`[PROTECT] فشل الباند المباشر على ${executorId}:`, error?.message || error);
        }
    }

    // 2) رتبته عالية؟ نشيل الرتب القابلة للتعديل ثم نجرّب مرة ثانية
    const target = member || await getMember(guild, executorId);

    if (target?.roles?.cache) {
        const removable = target.roles.cache.filter(
            r => r.id !== guild.id && r.editable && !r.managed
        );

        if (removable.size) {
            await target.roles.remove(removable, fullReason).catch(() => {});
        }
    }

    const after = await getMember(guild, executorId);

    if (after?.bannable) {
        try {
            await after.ban({ reason: fullReason });
            console.log(`[PROTECT] باند ${executorId} بعد إزالة الرتب (أولاً)`);
            return true;
        } catch {}
    }

    // 3) الباند بالـ ID — يشتغل حتى لو غادر السيرفر
    try {
        await guild.bans.create(executorId, { reason: fullReason });
        console.log(`[PROTECT] باند ${executorId} بالـ ID (أولاً)`);
        return true;
    } catch (error) {
        console.error(
            `[PROTECT] فشل بند ${executorId} (أولاً): ${error?.message || error} — ` +
            `راقب رتب البوت/الصلاحيات`
        );
        return false;
    }
}

// مسح كل ما أنشأه الفاعل: رومات + رتب + ويب هوك — أين ما كانت
async function purgeActorCreations(guild, executorId, extraChannel = null, extraRole = null) {
    let removed = 0;

    removed += await removeCreatedByActor(
        createdByActor.channels, guild, executorId, extraChannel
    );

    removed += await removeCreatedByActor(
        createdByActor.roles, guild, executorId, extraRole
    );

    removed += await removeTrackedWebhooks(guild, executorId);

    return removed;
}

// العقوبة الكاملة على بوت تجاوز الحماية: الباند أولاً ثم المسح
// يرجع { banned, removed } — أو null إذا كان الفاعل بالقايمة البيضاء
async function punishBotExceeder(guild, member, executorId, reason, extraChannel = null, extraRole = null) {
    if (await whitelistExempt(guild.id, executorId)) {
        console.log(
            `[PROTECT] تخطّي بند البوت ${executorId} (${guild.id}) — بالقايمة البيضاء`
        );
        return null;
    }

    const fullReason = `[Anti-Nuke] ${reason}`;

    // (1) الباند أولاً
    const banned = await banActorFirst(guild, member, executorId, fullReason);

    // (2) ثم مسح الرومات/الرتب/الويب هوك — أين ما كانت
    const removed = await purgeActorCreations(guild, executorId, extraChannel, extraRole);

    console.log(
        `[PROTECT] تسلسل البوت ${executorId} (${guild.id}): ` +
        `باند=${banned ? '✅' : '❌'} ثم مسح=${removed} إبداع`
    );

    return { banned, removed };
}

// ======================================================
// 🔗 عقوبة حماية الاختصار — وضع "ممنوع التجاوز"
// ما نقارن رتبة الفاعل برتبة البوت: أول ما ينشال الاختصار ينزل العقوبة
// على اللي شالله (نحاول نسوي بند بالـ ID بعد ما نشيل رتبه القابلة للتعديل)
// ======================================================
async function punishInviteOffender(guild, member, executorId, action, reason) {
    // 🛡️ بالقايمة البيضاء: البوت ما يتدخل أبداً مهما كانت العقوبة
    if (await whitelistExempt(guild?.id, executorId)) {
        console.log(
            `[PROTECT] تخطّي عقوبة حماية الاختصار "${action}" ` +
            `على ${executorId} — بالقايمة البيضاء`
        );
        return { done: false, label: 'القائمة البيضاء — البوت لم يتدخل' };
    }

    const fullReason = `[Anti-Nuke] ${reason}`;

    // ⚡ اختصار مخصص: shortcut:<name> → ننفّذ أمره بدون قيود الرتبة
    let realAction = action;

    if (typeof action === 'string' && action.startsWith('shortcut:')) {
        const wanted = normalizeText(action.slice('shortcut:'.length).trim());
        const settings = await getSettings(guild.id).catch(() => null);
        const shortcut = (settings?.shortcuts || []).find(
            s => normalizeText(String(s?.name || '')) === wanted
        );

        if (!shortcut?.command) {
            console.error(`[PROTECT] اختصار حماية الاختصار "${wanted}" غير موجود في السيرفر ${guild.id}`);
            return { done: false, label: 'اختصار غير موجود' };
        }

        realAction = shortcut.command;
    }

    // نلف دالة التنفيذ مرة وحدة عشان ما تتكرر محاولة/خطأ
    const done = async fn => {
        try {
            const ok = await fn();
            return ok !== false;
        } catch (error) {
            console.error(`[PROTECT] فشل ${realAction} على ${executorId}:`, error?.message || error);
            return false;
        }
    };

    // ==============================================
    // 🎭 إزالة الرتب (قبل الـ ban: لو العقوبة أصلاً إزالة رتب)
    // ==============================================
    if (realAction === 'removeroles' && member) {
        const removable = member.roles.cache.filter(
            role => role.id !== member.guild.id && role.editable && !role.managed
        );

        if (removable.size && await done(() => member.roles.remove(removable, fullReason))) {
            return { done: true, label: '🎭 إزالة الرتب' };
        }

        // ما عنده رتب قابلة للإزالة → نكمل بـ ban على أي حال (لو نقدر)
        if (member?.bannable && await done(() => member.ban({ reason: fullReason }))) {
            return { done: true, label: '🔨 Ban' };
        }
    }

    // ==============================================
    // 🔨 Ban — بالمحاولة المباشرة، ثم بالـ ID بعد إزالة الرتب
    // ==============================================
    if (realAction === 'ban') {
        if (member?.bannable && await done(() => member.ban({ reason: fullReason }))) {
            return { done: true, label: '🔨 Ban' };
        }

        // رتبه أعلى/يساوي البوت؟ نشيل رتبه القابلة للتعديل ونعيد المحاولة بالـ ID
        if (member) {
            const removable = member.roles.cache.filter(
                role => role.id !== member.guild.id && role.editable && !role.managed
            );

            if (removable.size) {
                await done(() => member.roles.remove(removable, fullReason));
            }
        }

        const memberAfter = member || await getMember(guild, executorId);

        if (memberAfter?.bannable && await done(() => memberAfter.ban({ reason: fullReason }))) {
            return { done: true, label: '🔨 Ban' };
        }

        if (await done(() => guild.bans.create(executorId, { reason: fullReason }))) {
            return { done: true, label: '🔨 Ban (by ID)' };
        }
    }

    // ==============================================
    // 👢 Kick
    // ==============================================
    if (realAction === 'kick') {
        if (member?.kickable && await done(() => member.kick(fullReason))) {
            return { done: true, label: '👢 Kick' };
        }
    }

    // ==============================================
    // 🔇 Time-out
    // ==============================================
    if (realAction === 'timeout') {
        if (member?.moderatable && await done(() => member.timeout(SPAM_TIMEOUT_MS, fullReason))) {
            return { done: true, label: '🔇 Time-out' };
        }
    }

    // ==============================================
    // 🔒 Jail
    // ==============================================
    if (realAction === 'jail' && member) {
        if (await done(() => jailMember(member))) {
            return { done: true, label: '🔒 Jail' };
        }
    }

    console.error(
        `[PROTECT] ما نقدر نطبق ${action} على ${executorId} (حماية الاختصار): ` +
        `bannable=${!!member?.bannable} kickable=${!!member?.kickable} moderatable=${!!member?.moderatable}`
    );

    return { done: false, label: String(action) };
}

// فحص صلاحية التجاوز عن الحماية (وايت ليست / مالك البوت / فوق رتبة البوت)
async function protectionAllowed(guild, member, settings) {
    // عضو غير معروف = مش مخوّل (نحمي ولا نثق بالمجانين)
    if (!member) {
        console.log(
            `[PROTECT] protectionAllowed: member=null → unknown ` +
            `(guild=${guild?.id})`
        );
        return { allowed: false, level: 'unknown' };
    }

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
        return { allowed: false, level: 'unknown' };
    }

    const pos = member.roles.highest?.position ?? -1;

    console.log(
        `[PROTECT] protectionAllowed: user=${member.id} ` +
        `pos=${pos} botHighest=${botHighest.position} ` +
        `isOwner=${member.id === guild?.ownerId}`
    );

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

// ======================================================
// SNAPSHOT + RESTORE (استرجاع الرومات/الكاتوقريز)
// ======================================================

// لقطات الرومات والكاتوقريز وصلاحياتها:
// guildId -> { capturedAt, items: [...] }
const channelSnapshots = new Map();

const CHANNEL_SNAPSHOT_INTERVAL = 60 * 1000; // نحدّث اللقطة كل دقيقة

// هل فلوض حذف مفعّل حالياً لسيرفر؟ (حتى لا نلتقط صورة "بعد الخراب")
function isDeleteFloodActive(guildId, windowMs = 8000) {
    const deletes = protectionFloods.channelDeletes.get(guildId) || [];
    const now = Date.now();
    return deletes.some(t => now - t <= windowMs);
}

// الثريدات (والقنوات الخاصة) ما عندها permissionOverwrites — لو قنّينا لقطة روم واحد
// كان يطيح السنشوت كله ويطبع خطأ كل دقيقة
function isSnapshotableChannel(ch) {
    if (!ch) return false;
    if (ch.isThread?.() || ch.isDMBased?.()) return false;
    return true;
}

function mapChannelOverwrites(ch) {
    const cache = ch?.permissionOverwrites?.cache;

    if (!cache || typeof cache.values !== 'function') return [];

    return [...cache.values()].map(o => ({
        id: o.id,
        type: o.type,
        allow: o.allow.bitfield,
        deny: o.deny.bitfield
    }));
}

// لقطة روم واحد (يُستدعى عند الإنشاء/التعديل ليظل السنشوت طازجاً)
function captureSingleChannel(channel) {
    try {
        if (!channel?.guild) return;
        if (!isSnapshotableChannel(channel)) return;

        const now = Date.now();

        // لا نلتقط أثناء نوك حذف أو إنشاء — لئلا نحفظ "حالة الخراب"
        const delFlood = (protectionFloods.channelDeletes.get(channel.guild.id) || [])
            .some(t => now - t <= 8000);
        const createFlood = (protectionFloods.channels.get(channel.guild.id) || [])
            .some(t => now - t <= 8000);

        if (delFlood || createFlood) return;

        const snap = channelSnapshots.get(channel.guild.id);

        if (!snap) return;

        const index = snap.items.findIndex(i => i.id === channel.id);

        const item = {
            id: channel.id,
            name: channel.name,
            type: channel.type,
            position: channel.position,
            parentId: channel.parentId,
            topic: channel.topic || null,
            nsfw: !!channel.nsfw,
            rateLimitPerUser: channel.rateLimitPerUser || 0,
            overwrites: mapChannelOverwrites(channel)
        };

        if (index >= 0) {
            snap.items[index] = item;
        } else {
            snap.items.push(item);
        }

        snap.capturedAt = Date.now();
    } catch {}
}

// لقطة كاملة للسيرفر (تُستدعى دورياً)
function captureChannels(guild) {
    try {
        if (!guild || isDeleteFloodActive(guild.id)) return;

        const items = [];

        for (const ch of guild.channels.cache.values()) {
            if (!isSnapshotableChannel(ch)) continue;

            items.push({
                id: ch.id,
                name: ch.name,
                type: ch.type,
                position: ch.position,
                parentId: ch.parentId,
                topic: ch.topic || null,
                nsfw: !!ch.nsfw,
                rateLimitPerUser: ch.rateLimitPerUser || 0,
                overwrites: mapChannelOverwrites(ch)
            });
        }

        channelSnapshots.set(guild.id, {
            capturedAt: Date.now(),
            items
        });
    } catch (error) {
        console.error('Channel snapshot error:', error);
    }
}

// استرجاع الرومات والكاتوقريز المفقودة من آخر لقطة (بصلاحياتها)
async function restoreChannels(guild) {
    const snap = channelSnapshots.get(guild.id);

    if (!snap || !snap.items?.length) {
        return { restored: 0, total: 0, categories: 0 };
    }

    const existing = new Set(guild.channels.cache.keys());
    const missing = snap.items.filter(i => !existing.has(i.id));

    if (!missing.length) return { restored: 0, total: 0, categories: 0 };

    // الكاتوقريز أولاً ثم الرومات عشان ما نعلق قالب مع الوالد
    const parents = missing.filter(
        i => i.type === ChannelType.GuildCategory
    );
    const children = missing.filter(
        i => i.type !== ChannelType.GuildCategory
    );

    let restored = 0;
    const restoredIds = new Set();

    const createOne = async item => {
        try {
            const created = await guild.channels.create({
                name: item.name,
                type: item.type,
                topic: item.topic,
                nsfw: item.nsfw,
                rateLimitPerUser: item.rateLimitPerUser,
                parent: item.parentId,
                permissionOverwrites: item.overwrites.map(o => ({
                    id: o.id,
                    type: o.type,
                    allow: o.allow,
                    deny: o.deny
                }))
            });

            if (created) {
                restored++;
                restoredIds.add(item.id);
                captureSingleChannel(created); // حتّى لا نعيد استرجاعه ثانيةً
                console.log(
                    `[PROTECT] استرجاع ${item.type === ChannelType.GuildCategory ? 'كاتوقري' : 'روم'} "${item.name}" (${item.id})`
                );
            }
        } catch (error) {
            console.error(
                `[PROTECT] فشل استرجاع "${item.name}": ${error.message}`
            );
        }
    };

    for (const item of parents) await createOne(item);

    // مررنا بعد الكاتوقريز: أي ولد والده غير موجود → نعيد محاولة تشغيله بعد الكاتوقريز
    for (const item of children) {
        if (item.parentId && !existing.has(item.parentId) && !restoredIds.has(item.parentId)) {
            item.parentId = null; // بدون والد، أفضل من الفشل
        }
        await createOne(item);
    }

    return { restored, total: missing.length, categories: parents.length };
}

// ======================================================
// BACKUP / RESTORE
// ======================================================

// حفظ نسخة كاملة من السيرفر (قنوات + رتب) في قاعدة البيانات
async function captureGuildBackup(guild, kind = 'auto') {
    try {
        if (!guild) return { saved: false, error: 'no-guild' };

        const channels = [];
        for (const ch of guild.channels.cache.values()) {
            if (ch.isThread?.() || ch.isDMBased?.()) continue;

            channels.push({
                id: ch.id,
                name: ch.name,
                type: ch.type,
                position: ch.position,
                parentId: ch.parentId,
                topic: ch.topic || null,
                nsfw: !!ch.nsfw,
                rateLimitPerUser: ch.rateLimitPerUser || 0,
                bitrate: ch.bitrate || null,
                userLimit: ch.userLimit || 0,
                rtcRegion: ch.rtcRegion || null,
                overwrites: mapChannelOverwrites(ch)
            });
        }

        const roles = [];
        for (const r of guild.roles.cache.values()) {
            roles.push({
                id: r.id,
                name: r.name,
                color: r.color,
                hoist: r.hoist,
                mentionable: r.mentionable,
                position: r.position,
                permissions: r.permissions.bitfield,
                managed: r.managed,
                isEveryone: r.id === guild.id,
                icon: r.icon,
                unicodeEmoji: r.unicodeEmoji
            });
        }

        // الإيموجي (المخصصة فقط — القياسية تُستعاد تلقائياً من Discord)
        const emojis = [];
        for (const e of guild.emojis.cache.values()) {
            if (!e.managed) {
                emojis.push({
                    id: e.id,
                    name: e.name,
                    animated: !!e.animated,
                    url: e.url || null
                });
            }
        }

        // الستيكرات المخصصة (المجموعات والدخول المخزّن في الرابط)
        const stickers = [];
        for (const s of guild.stickers.cache.values()) {
            if (!s.managed) {
                let ext = 'png';
                if (s.format === StickerFormatType.Lottie) ext = 'json';
                else if (s.format === StickerFormatType.GIF) ext = 'gif';

                stickers.push({
                    id: s.id,
                    name: s.name,
                    description: s.description || null,
                    tags: s.tags || null,
                    format: s.format || null,
                    url: `https://cdn.discordapp.com/stickers/${s.id}.${ext}`
                });
            }
        }

        // إعدادات الحماية (رومات/رتب/باند/بوتات/سبام/ويب هوك/إنفايت)
        let protections = null;
        try {
            const settings = await getSettings(guild.id);
            protections = settings?.protections
                ? JSON.parse(JSON.stringify(settings.protections))
                : null;
        } catch {
            protections = null;
        }

        const doc = {
            guildId: guild.id,
            capturedAt: new Date(),
            kind,
            channels,
            roles,
            emojis,
            stickers,
            protections
        };

        // updateOne + upsert حتى لا يدمج mongoose الـ Mixed بعمق (يختفي المصفوفات)
        await GuildBackup.collection.updateOne(
            { guildId: guild.id },
            { $set: doc },
            { upsert: true }
        );

        // 📦 السجل التاريخي: نحفظ كل نسخة ونبقي آخر 7 فقط
        try {
            await GuildBackupHistory.collection.insertOne({ ...doc });

            const extra = await GuildBackupHistory.find({ guildId: guild.id })
                .sort({ capturedAt: -1 })
                .skip(BACKUP_HISTORY_LIMIT)
                .select('_id')
                .lean();

            if (extra.length) {
                await GuildBackupHistory.deleteMany({
                    _id: { $in: extra.map(d => d._id) }
                });
            }
        } catch (error) {
            console.error('[BACKUP] فشل حفظ السجل:', error?.message || error);
        }

        return {
            saved: true,
            channels: channels.length,
            roles: roles.length,
            emojis: emojis.length,
            stickers: stickers.length,
            protections: !!protections,
            capturedAt: doc.capturedAt
        };
    } catch (error) {
        console.error('[BACKUP] فشل الحفظ:', error);
        return { saved: false, error: error.message };
    }
}

// ⏱️ النسخ الاحتياطي التلقائي: كل 48 ساعة، +يوم لكل يوم فيه تعديلات (بحد أقصى 7 أيام)
const backupSchedule = require('./backup-schedule.js');

// يُنادى من أحداث إنشاء/حذف الرومات والرتب — يأجّل النسخة الجاية يوم كامل
// (عشان لو صار اختراق قريب من وقت النسخة، ما ننسخ حالة الاختراق)
async function noteStructuralChange(guildId) {
    try {
        const settings = await getSettings(guildId);
        if (!settings) return;

        const next = backupSchedule.nextAfterChange(
            settings.backupState || {},
            Date.now()
        );

        if (!next) return; // محسوب من قبل اليوم

        settings.backupState = next;
        settings.markModified('backupState');
        await settings.save();
    } catch (error) {
        console.error('[BACKUP] فشل تسجيل التعديل:', error?.message || error);
    }
}

// يفحص موعد النسخة التالية لكل سيرفر
async function runBackupScheduler(guild) {
    try {
        const settings = await getSettings(guild.id);
        if (!settings) return;

        const state = settings.backupState || {};
        const now = Date.now();

        // أول تشغيل: نسخة فورية + ضبط العدّاد (48 ساعة)
        if (backupSchedule.isFirstRun(state)) {
            const res = await captureGuildBackup(guild, 'auto');

            settings.backupState = backupSchedule.nextAfterBackup(now);
            settings.markModified('backupState');
            await settings.save();

            console.log(`[BACKUP] نسخة أولى ${guild.id} — ${res.saved ? 'نجحت' : res.error}`);
            return;
        }

        if (!backupSchedule.isDue(state, now)) return;

        const res = await captureGuildBackup(guild, 'auto');

        settings.backupState = backupSchedule.nextAfterBackup(now);
        settings.markModified('backupState');
        await settings.save();

        if (res.saved) {
            console.log(`[BACKUP] نسخة مجدولة ${guild.id} | رومات=${res.channels} رتب=${res.roles}`);
        }
    } catch (error) {
        console.error('[BACKUP] فشل الجدولة:', error?.message || error);
    }
}

// 🛡️ الرومات المحمية تلقائياً (لوق/ترحيب/تكت/فيدباك/قيف اواي/صوتيات) — تُضاف لقائمة الحماية
function autoProtectedChannelIds(settings) {
    const ids = new Set();
    const add = id => { if (id) ids.add(String(id)); };

    Object.values(settings?.logs || {}).forEach(add);
    add(settings?.welcome?.channelId);
    add(settings?.tickets?.panelChannelId);
    add(settings?.tickets?.logChannelId);
    add(settings?.tickets?.categoryId);
    add(settings?.feedbackChannelId);
    add(settings?.giveawayChannelId);
    add(settings?.voice?.creatorChannelId);
    add(settings?.voice?.categoryId);

    return ids;
}

// كل الرومات المحمية (التلقائية + اليدوية + الكاتيجوري الأب)
async function getProtectedChannelIds(guild, settings) {
    const set = autoProtectedChannelIds(settings);
    (settings?.protectedChannelIds || []).forEach(id => set.add(String(id)));

    for (const id of [...set]) {
        const ch = guild.channels.cache.get(id);
        if (ch?.parentId) set.add(String(ch.parentId));
    }

    return set;
}

// استرجاع السيرفر من آخر نسخة:
//  - يعيد إنشاء الرتب المفقودة
//  - يحذف الرتب والقنوات الزائدة (التي أنشأها المخترق)
//  - يعيد إنشاء القنوات المفقودة بصلاحياتها
async function restoreGuildFromBackup(guild, backupDoc = null) {
    try {
        if (!guild) return { error: 'no-guild' };

        const backup = backupDoc || await GuildBackup.findOne({ guildId: guild.id });

        if (!backup) return { error: 'no-backup' };

        const backedChannels = Array.isArray(backup.channels) ? backup.channels : [];
        const backedRoles = Array.isArray(backup.roles) ? backup.roles : [];

        if (!backedChannels.length && !backedRoles.length) {
            return { error: 'empty-backup' };
        }

        const botMember = guild.members.me;
        const botPos = botMember ? botMember.roles.highest.position : 0;
        const managedRoleIds = new Set();

        for (const r of guild.roles.cache.values()) {
            if (r.managed || r.id === guild.id) managedRoleIds.add(r.id);
        }

        // ---------- الرتب ----------
        const backedRoleIds = new Set(backedRoles.map(r => r.id));
        const restoredRoles = [];
        const roleIdMap = new Map();

        // 1) حذف الرتب الزائدة (غير الموجودة بالنسخة) — تحت رتبة البوت فقط
        const rolesToDelete = guild.roles.cache
            .filter(r =>
                !backedRoleIds.has(r.id) &&
                !r.managed &&
                r.id !== guild.id &&
                r.editable &&
                r.position < botPos
            )
            .sort((a, b) => b.position - a.position);

        let deletedRoles = 0;
        for (const r of rolesToDelete.values()) {
            try {
                await r.delete('[Anti-Nuke] استرجاع النسخة — رتبة زائدة');
                deletedRoles++;
            } catch {}
        }

        // 2) إعادة إنشاء الرتب المفقودة (تنازلياً بالموقع حتى تترتب صح)
        const sortedBackedRoles = backedRoles
            .filter(r => !managedRoleIds.has(r.id))
            .sort((a, b) => b.position - a.position);

        for (const r of sortedBackedRoles) {

            const existing = guild.roles.cache.get(r.id);

            if (existing) {
                roleIdMap.set(r.id, existing.id);
                continue;
            }

            if (r.isEveryone || r.managed) {
                roleIdMap.set(r.id, r.id);
                continue;
            }

            try {
                const perms = typeof r.permissions === 'bigint'
                    ? r.permissions
                    : BigInt(r.permissions || 0);

                const created = await guild.roles.create({
                    name: r.name,
                    color: r.color || 0,
                    hoist: !!r.hoist,
                    mentionable: !!r.mentionable,
                    permissions: perms,
                    reason: '[Anti-Nuke] استرجاع النسخة الاحتياطية'
                });

                if (created) {
                    restoredRoles.push({
                        id: r.id,
                        name: r.name
                    });
                    roleIdMap.set(r.id, created.id);

                    if (r.icon) {
                        created.setIcon(r.icon).catch(() => {});
                    }
                    if (r.unicodeEmoji) {
                        created.setUnicodeEmoji(r.unicodeEmoji).catch(() => {});
                    }
                }
            } catch (error) {
                console.error(`[BACKUP] فشل استرجاع رتبة "${r.name}": ${error.message}`);
            }
        }

        // ---------- القنوات ----------
        const backedChannelIds = new Set(backedChannels.map(c => c.id));
        const restoredChannels = [];

        // 🛡️ الرومات المحمية: ما تُحذف أبداً حتى لو مو بالنسخة
        const restoreSettings = await getSettings(guild.id).catch(() => null);
        const protectedIds = await getProtectedChannelIds(guild, restoreSettings);

        // 3) حذف القنوات الزائدة (أنشأها المخترق بعد النسخة) — مع تخطي المحمية
        let deletedChannels = 0;
        const channelsToDelete = guild.channels.cache
            .filter(ch =>
                !backedChannelIds.has(ch.id) &&
                !protectedIds.has(ch.id) &&
                ch.deletable
            )
            .sort((a, b) => a.position - b.position);

        for (const ch of channelsToDelete.values()) {
            try {
                await ch.delete('[Anti-Nuke] استرجاع النسخة — قناة زائدة');
                deletedChannels++;
            } catch {}
        }

        const existingChannels = new Set(guild.channels.cache.keys());
        const missing = backedChannels.filter(c => !existingChannels.has(c.id));

        // تحويل overwrites: ربط ID الرتبة القديمة مع الجديدة
        const mapOverwrites = overwrites =>
            (overwrites || [])
                .map(o => {
                    const mappedId = o.type === 0 && roleIdMap.has(o.id)
                        ? roleIdMap.get(o.id)
                        : o.id;
                    return {
                        id: mappedId,
                        type: o.type,
                        allow: BigInt(o.allow || 0),
                        deny: BigInt(o.deny || 0)
                    };
                })
                .filter(o => o.type === 1 || guild.roles.cache.has(o.id));

        // الكاتوقريز أولاً ثم باقي القنوات (عشان ما نعلق ولد بوالد مفقود)
        const parents = missing.filter(
            c => c.type === ChannelType.GuildCategory
        );
        const children = missing.filter(
            c => c.type !== ChannelType.GuildCategory
        );

        const existingNow = new Set(guild.channels.cache.keys());
        const restoredIds = new Set();

        const createOne = async item => {
            try {
                let parentId = item.parentId || null;
                if (parentId && !existingNow.has(parentId) && !restoredIds.has(parentId)) {
                    parentId = null;
                }

                const created = await guild.channels.create({
                    name: item.name,
                    type: item.type,
                    topic: item.topic || null,
                    nsfw: !!item.nsfw,
                    rateLimitPerUser: item.rateLimitPerUser || 0,
                    parent: parentId,
                    bitrate: item.bitrate || undefined,
                    userLimit: item.userLimit || 0,
                    rtcRegion: item.rtcRegion || null,
                    permissionOverwrites: mapOverwrites(item.overwrites),
                    reason: '[Anti-Nuke] استرجاع النسخة الاحتياطية'
                });

                if (created) {
                    restoredChannels.push({
                        id: item.id,
                        name: item.name
                    });
                    restoredIds.add(item.id);
                    existingNow.add(item.id);
                }
            } catch (error) {
                console.error(`[BACKUP] فشل استرجاع قناة "${item.name}": ${error.message}`);
            }
        };

        for (const item of parents) await createOne(item);
        for (const item of children) await createOne(item);

        // ---------- الإيموجي ----------
        let restoredEmojis = 0;
        const backedEmojis = Array.isArray(backup.emojis) ? backup.emojis : [];

        for (const emoji of backedEmojis) {
            try {
                if (!emoji?.name || !emoji?.url) continue;
                if (guild.emojis.cache.some(e => e.name === emoji.name)) continue;

                const buffer = await downloadBuffer(emoji.url);
                if (!buffer) continue;

                const created = await guild.emojis.create({
                    attachment: buffer,
                    name: emoji.name,
                    reason: '[Anti-Nuke] استرجاع النسخة الاحتياطية'
                });
                if (created) restoredEmojis++;
            } catch (error) {
                console.error(
                    `[BACKUP] فشل استرجاع إيموجي "${emoji?.name}": ${error.message}`
                );
            }
        }

        // ---------- الستيكرات ----------
        let restoredStickers = 0;
        const backedStickers = Array.isArray(backup.stickers) ? backup.stickers : [];

        for (const sticker of backedStickers) {
            try {
                if (!sticker?.name || !sticker?.url) continue;
                if (guild.stickers.cache.some(s => s.name === sticker.name)) continue;

                const buffer = await downloadBuffer(sticker.url);
                if (!buffer) continue;

                const created = await guild.stickers.create({
                    file: buffer,
                    name: sticker.name,
                    description: sticker.description || '',
                    tags: sticker.tags || '',
                    reason: '[Anti-Nuke] استرجاع النسخة الاحتياطية'
                });
                if (created) restoredStickers++;
            } catch (error) {
                console.error(
                    `[BACKUP] فشل استرجاع ستيكر "${sticker?.name}": ${error.message}`
                );
            }
        }

        // ---------- إعدادات الحماية ----------
        const backedProtections = backup.protections;

        if (backedProtections && typeof backedProtections === 'object') {
            try {
                const settings = await getSettings(guild.id);

                if (settings) {
                    let changedProt = false;

                    for (const key of Object.keys(backedProtections)) {
                        const val = backedProtections[key];

                        // نتجاهل الإعدادات الفارغة/المعطّلة تلقائياً إلا الإعدادات الأصلية فعلية
                        if (!settings.protections) {
                            settings.protections = {};
                        }

                        settings.protections[key] = JSON.parse(
                            JSON.stringify(val)
                        );
                        changedProt = true;
                    }

                    if (changedProt) {
                        settings.markModified('protections');
                        await settings.save().catch(() => {});

                        // تحديث الكاش المحلي
                        try {
                            protectionsCache.set(guild.id, {
                                protections: JSON.parse(
                                    JSON.stringify(settings.protections)
                                ),
                                whitelist: settings.whitelist || []
                            });
                        } catch {}
                    }
                }
            } catch (error) {
                console.error('[BACKUP] فشل استرجاع إعدادات الحماية:', error.message);
            }
        }

        // ---------- ترتيب المواقع (أفضل محاولة) ----------
        try {
            const mapping = [];
            for (const c of guild.channels.cache.values()) {
                const backed = backedChannels.find(b => b.id === c.id);
                if (backed) {
                    mapping.push({
                        channel: c,
                        position: backed.position
                    });
                }
            }
            for (const backupRole of sortedBackedRoles) {
                const actual = roleIdMap.get(backupRole.id);
                const role = actual && guild.roles.cache.get(actual);
                if (role && role.position < botPos) {
                    try { await role.setPosition(backupRole.position); } catch {}
                }
            }
            // setChannelPositions دفعة واحدة أفضل أداءً
            if (mapping.length) {
                await guild.setChannelPositions(
                    mapping.map(m => ({ channel: m.channel, position: m.position }))
                ).catch(() => {});
            }
        } catch {}

        console.log(
            `[BACKUP] استرجاع ${guild.id} | رومات🔄=${restoredChannels.length} رتب🔄=${restoredRoles.length} رومات deleted=${deletedChannels} رتب deleted=${deletedRoles} إيموجي🔄=${restoredEmojis} ستيكرات🔄=${restoredStickers}`
        );

        return {
            restoredChannels,
            restoredRoles,
            deletedChannels,
            deletedRoles,
            restoredEmojis,
            restoredStickers,
            protectionsApplied: !!backedProtections,
            failed: 0
        };
    } catch (error) {
        console.error('[BACKUP] فشل الاسترجاع:', error);
        return { error: error.message };
    }
}

// حماية الويب هوك:
//  - الإنشاء: مسموح حتى "الحد" المحدد، وعند التجاوز → عقوبة + حذف كل الويب هوك
//  - الحذف/التعديل من غير مخوّل → حذف كل الويب هوك فوراً
//  - تحت رتبة البوت: عقوبة | بنفس رتبة البوت: حذف فقط
//  - وايت ليست / فوق رتبة البوت / المالك: لا نتدخل
async function runWebhookProtection(guild, auditType, webhookId, label) {
    try {
        const { prot, cached } = await getProtectionConfig(guild.id, 'webhooks');

        if (!prot || !prot.enabled) return;

        console.log(
            `[PROTECT] webhook (${label}) ${guild.id} | enabled=${prot.enabled}`
        );

        // كشف فيضان إنشاء الويب هوك فوراً — بدون انتظار سجل التدقيق
        const hookLimit = metricLimit(prot, 'webhooks', 'create', 5);

        if (auditType === AuditLogEvent.WebhookCreate &&
            isNukeFlood(protectionFloods.webhooks, guild.id, hookLimit)) {

            const deletedCount = await deleteAllWebhooks(guild);

            const executorId = await resolveAbuseExecutor(
                guild,
                AuditLogEvent.WebhookCreate,
                webhookId
            );

            console.log(
                `[PROTECT] webhook flood — حذف ${deletedCount} ويب هوك (${guild.id}) | الفاعل=${executorId || 'غير مشخص'}`
            );

            if (executorId && executorId !== client.user.id) {
                const member = await getMember(guild, executorId);
                const check = await protectionAllowed(guild, member, {
                    whitelist: cached?.whitelist || []
                });

                if (check.allowed === false) {
                    const hookAction = metricAction(prot, 'webhooks', 'create', 'ban');
                    const banned = await punishFor(
                        guild,
                        member,
                        executorId,
                        hookAction,
                        `فيضان إنشاء ويب هوك (أكثر من ${hookLimit})`
                    );

                    await sendLog(
                        guild,
                        'moderation',
                        '🛡️ Webhook Flood',
                        `فيضان إنشاء ويب هوك.\n` +
                        `تم حذف **${deletedCount}** ويب هوك.` +
                        (banned
                            ? `\n✅ تم بند الفاعل: <@${executorId}>`
                            : `\n❌ فشلت العقوبة على <@${executorId}> — تأكد من رتب البوت/الصلاحيات.`)
                    );
                } else {
                    await sendLog(
                        guild,
                        'moderation',
                        '🛡️ Webhook Flood',
                        `فيضان إنشاء ويب هوك.\n` +
                        `تم حذف **${deletedCount}** ويب هوك.\n` +
                        `<@${executorId}> فوق/بنفس رتبة البوت — تم التسجيل فقط.`
                    );
                }
            } else {
                await sendLog(
                    guild,
                    'moderation',
                    '🛡️ Webhook Flood',
                    `فيضان إنشاء ويب هوك.\n` +
                    `تم حذف **${deletedCount}** ويب هوك.\n` +
                    'المسبب غير مشخص (تأكد من صلاحية **View Audit Log**).'
                );
            }

            return;
        }

        const executorId = await getAuditExecutor(guild, auditType, webhookId);

        if (!executorId) return;

        if (executorId === client.user.id) return;

const member = await getMember(guild, executorId);
                const check = await protectionAllowed(guild, member, {
                    whitelist: cached?.whitelist || []
                });

        if (check.allowed) return;

        // ==========================================
        // إنشاء ويب هوك: نحدّ العدد المسموح تراكمياً
        // (أي تجاوز للحد حتى لو على مدى ساعات = عقوبة)
        // ==========================================
        if (auditType === AuditLogEvent.WebhookCreate) {

            const key = `${guild.id}-${executorId}`;
            const limit = hookLimit;
            const hookAction = metricAction(prot, 'webhooks', 'create', 'ban');

            const exceeded = countExceeded(
                protectionCounts.webhooks,
                key,
                limit
            );

            // ضمن الحد المسموح: لا نتدخل
            if (!exceeded) {
                await sendLog(
                    guild,
                    'moderation',
                    '🛡️ Webhook Created (Within Limit)',
                    `<@${executorId}> أنشأ ويب هوك — ضمن الحد المسموح (**${limit}**).`
                );
                return;
            }

            // تجاوز الحد: عقوبة (لو تحت) + حذف كل الويب هوك
            const exceededDeletedCount = await deleteAllWebhooks(guild);

            if (check.allowed === false) {
                const punished = await punishFor(
                    guild,
                    member,
                    executorId,
                    hookAction,
                    `تجاوز حد إنشاء الويب هوك (${limit})`
                );
                console.log(
                    `[PROTECT] عقوبة ${hookAction} على ${executorId} ` +
                    `لتجاوز حد الويب هوك (${guild.id}) — نجحت=${punished}`
                );
            }

            clearCount(protectionCounts.webhooks, key);

            await sendLog(
                guild,
                'moderation',
                '🛡️ Webhook Protection',
                `<@${executorId}> تجاوز حد إنشاء الويب هوك (**${limit}**).\n` +
                `المستوى: **${check.level === 'equal' ? 'بنفس رتبة البوت' : check.level === 'above' ? 'أعلى من رتبة البوت' : 'تحت رتبة البوت'}**\n` +
                `تم حذف **${exceededDeletedCount}** ويب هوك${check.allowed === false ? `\nالعقوبة: **${hookAction}**` : ''}`
            );

            return;
        }

        // ==========================================
        // حذف ويب هوك: نعدّ المحاولات (الحد يحدده صاحب السيرفر)
        // ==========================================
        if (auditType === AuditLogEvent.WebhookDelete) {
            const key = `${guild.id}-${executorId}`;
            const deleteLimit = metricLimit(prot, 'webhooks', 'delete', 5);

            if (!countExceeded(protectionCounts.webhookDeletes, key, deleteLimit)) {
                return;
            }

            clearCount(protectionCounts.webhookDeletes, key);
        }

        // ==========================================
        // حذف / تعديل ويب هوك من شخص غير مخوّل
        // ==========================================
        const deleteAction = metricAction(prot, 'webhooks', 'delete', 'ban');
        const deletedCount = await deleteAllWebhooks(guild);

        if (check.allowed === false) {
            const punished = await punishFor(
                guild,
                member,
                executorId,
                deleteAction,
                `Webhook ${label} غير مصرّح (${webhookId || ''})`
            );
            console.log(
                `[PROTECT] عقوبة ${deleteAction} على ${executorId} ` +
                `ل${label} ويب هوك بدون إذن (${guild.id}) — نجحت=${punished}`
            );
        }

        await sendLog(
            guild,
            'moderation',
            '🛡️ Webhook Protection',
            `<@${executorId}> سوى ${label} ويب هوك بدون إذن.\n` +
            `المستوى: **${check.level === 'equal' ? 'بنفس رتبة البوت' : check.level === 'above' ? 'أعلى من رتبة البوت' : 'تحت رتبة البوت'}**\n` +
            `تم حذف **${deletedCount}** ويب هوك${check.allowed === false ? `\nالعقوبة: **${deleteAction}**` : ''}`
        );
    } catch (error) {
        console.error('Webhook protection error:', error);
    }
}

// إعدادات الحماية الافتراضية: مفعّلة من أول إنشاء السيرفر
// (المالك يقدر يوقفها أو يعدّل العقوبة من /protect)
const DEFAULT_PROTECTIONS = {
    channels: { enabled: true, limit: 5, action: 'ban' },
    roles: { enabled: true, limit: 5, action: 'ban' },
    bans: { enabled: true, limit: 3, action: 'kick' },
    bots: { enabled: true },
    spam: { enabled: true, limit: 5, timeframe: 5000, maxLength: 400, repeatedChar: 8, action: 'timeout' },
    webhooks: { enabled: true, limit: 5, action: 'ban' },
    invites: { enabled: false, code: null, channelId: null, action: 'ban' },
    scams: { enabled: false, channelIds: [], action: 'ban' }
};

// ======================================================
// مقاييس الحماية — كل حماية لها خيارات يحدد صاحب السيرفر
// حدّها بنفسه (عدد المحاولات / الإنشاء / الحذف / التعديل...)
// ======================================================

// ⚠️ أسماء الخيارات قصيرة عن قصد: ديسكورد يرفض أي أمر يتجاوز 4000 حرف
// (APPLICATION_COMMAND_MAX_LENGTH)، و /protect فيه 6 خيارات من هذي.
// الأسماء الطويلة كانت تسحب حجم الأمر فوق الحد وتُسقط تسجيل *كل* الأوامر.
// لو تبي تضيف وصف هنا — لا تطوّل، الاسم القصير يوصل نفس المعلومة.
// PROTECTION_ACTIONS صارت تُستورد من ./commands.js (المصدر الوحيد)

const PROTECTION_LABELS = {
    channels: 'الرومات',
    roles: 'الرتب',
    bans: 'الباند',
    bots: 'البوتات',
    spam: 'السبام والخط الكبير',
    webhooks: 'الويب هوك',
    invites: 'اختصار السيرفر',
    scams: 'النصب (رومات محددة)'
};

const PROTECTION_METRICS = {
    channels: [
        { key: 'create', label: 'عدد مرات إنشاء الرومات', def: 5, min: 1, max: 1000 },
        { key: 'delete', label: 'عدد مرات حذف الرومات', def: 5, min: 1, max: 1000 },
        { key: 'update', label: 'عدد مرات تعديل الرومات', def: 20, min: 1, max: 1000 }
    ],
    roles: [
        { key: 'create', label: 'عدد مرات إنشاء الرتب', def: 5, min: 1, max: 1000 },
        { key: 'delete', label: 'عدد مرات حذف الرتب', def: 5, min: 1, max: 1000 },
        { key: 'update', label: 'عدد مرات تعديل الرتب', def: 20, min: 1, max: 1000 }
    ],
    bans: [
        { key: 'count', label: 'عدد عمليات الحظر المسموحة', def: 3, min: 1, max: 1000 }
    ],
    bots: [
        { key: 'joins', label: 'عدد البوتات المنضمة المسموح', def: 3, min: 1, max: 1000 }
    ],
    spam: [
        { key: 'messages', label: 'عدد الرسائل المسموحة قبل السبام', def: 5, min: 1, max: 1000 },
        { key: 'length', label: 'أقصى طول للرسالة (حرف)', def: 400, min: 1, max: 4000 },
        { key: 'repeat', label: 'عدد تكرار الحرف (يُعتبر خط كبير)', def: 8, min: 1, max: 1000 },
        { key: 'mentions', label: 'أقصى عدد منشنات بالرسالة', def: 6, min: 0, max: 100 },
        { key: 'spaces', label: 'أقصى مسافات متتالية', def: 10, min: 0, max: 200 },
        { key: 'bigtext', label: 'أقصى نسبة تكبير خط (%)', def: 60, min: 0, max: 100 },
        { key: 'files', label: 'أقصى عدد ملفات بالرسالة', def: 4, min: 0, max: 20 }
    ],
    webhooks: [
        { key: 'create', label: 'عدد مرات إنشاء ويب هوك', def: 5, min: 1, max: 1000 },
        { key: 'delete', label: 'عدد مرات حذف ويب هوك', def: 5, min: 1, max: 1000 }
    ],
    invites: [
        { key: 'redirect', label: 'عدد مرات إعادة توجيه اختصار السيرفر', def: 1, min: 1, max: 1000 }
    ],
    scams: [
        { key: 'talk', label: 'عدد الرسائل المسموحة في الروم', def: 1, min: 1, max: 100 },
        { key: 'image', label: 'عدد الصور/الملفات المرئية المسموحة', def: 1, min: 1, max: 100 },
        { key: 'links', label: 'عدد الروابط المسموحة', def: 1, min: 1, max: 100 }
    ]
};

// كل المقاييس المعرّفة لـنوع حماية
function metricsFor(typeKey) {
    return PROTECTION_METRICS[typeKey] || [];
}

function metricDef(typeKey, metricKey) {
    return metricsFor(typeKey).find(m => m.key === metricKey) || null;
}

// يقرأ حدّ المقياس الذي حدده صاحب السيرفر (وإلا يرجع الافتراضي)
function metricLimit(prot, typeKey, metricKey, fallback) {
    const def = metricDef(typeKey, metricKey);
    const stored = prot?.metrics ? prot.metrics[metricKey] : undefined;
    const value = Number(stored);

    if (Number.isFinite(value) && value >= 0) return value;
    if (def) return def.def;
    return fallback;
}

// يقرأ عقوبة المقياس (وإلا يرجع عقوبة الحماية العامة)
function metricAction(prot, typeKey, metricKey, fallback = 'ban') {
    const stored = prot?.metricActions ? prot.metricActions[metricKey] : undefined;
    const allowed = PROTECTION_ACTIONS.map(a => a.value);

    // ⚡ اختصار مخصص: shortcut:<اسم الاختصار>
    const isShortcut = v => typeof v === 'string' && v.startsWith('shortcut:') && v.slice(9).trim().length > 0;
    if (isShortcut(stored)) return stored;
    if (typeof stored === 'string' && allowed.includes(stored)) return stored;
    if (isShortcut(prot?.action)) return prot.action;
    if (prot?.action && allowed.includes(prot.action)) return prot.action;

    return allowed.includes(fallback) ? fallback : 'ban';
}

// يضمن وجود خريطة المقاييس في الإعدادات القديمة
function ensureMetricMaps(protections) {
    let anyChanged = false;

    for (const typeKey of Object.keys(PROTECTION_METRICS)) {
        const prot = protections?.[typeKey];
        if (!prot) continue;

        let changed = false;

        if (!prot.metrics || typeof prot.metrics !== 'object' || Array.isArray(prot.metrics)) {
            prot.metrics = {};
            changed = true;
        }

        if (!prot.metricActions || typeof prot.metricActions !== 'object' || Array.isArray(prot.metricActions)) {
            prot.metricActions = {};
            changed = true;
        }

        for (const m of PROTECTION_METRICS[typeKey]) {
            if (prot.metrics[m.key] === undefined) {
                prot.metrics[m.key] = m.def;
                changed = true;
            }

            if (!prot.metricActions[m.key]) {
                prot.metricActions[m.key] = prot.action || 'ban';
                changed = true;
            }
        }

        if (changed) anyChanged = true;
    }

    return anyChanged;
}

// سيرفرات تم تحويل عقوبة السبام القديمة (kick) إلى Timeout — مرة واحدة فقط
const migratedSpamActions = new Set();

function ensureProtections(settings) {
    if (!settings.protections) {
        settings.protections = JSON.parse(JSON.stringify(DEFAULT_PROTECTIONS));

        try {
            protectionsCache.set(String(settings._id), {
                protections: JSON.parse(JSON.stringify(settings.protections)),
                whitelist: (settings.whitelist || []).slice()
            });
        } catch {}

        return settings.protections;
    }

    for (const key of Object.keys(DEFAULT_PROTECTIONS)) {
        if (settings.protections[key] === undefined) {
            settings.protections[key] = JSON.parse(
                JSON.stringify(DEFAULT_PROTECTIONS[key])
            );
        }
    }

    // خرائط المقاييس: حماية لكل نوع + قيمة افتراضية لكل مقياس
    if (ensureMetricMaps(settings.protections)) {
        settings.markModified('protections');
        settings.save().catch(() => {});
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

    try {
        protectionsCache.set(String(settings._id), {
            protections: JSON.parse(JSON.stringify(settings.protections)),
            whitelist: (settings.whitelist || []).slice()
        });
    } catch {}

    return settings.protections;
}

// قراءة إعدادات حماية سريعة وبلا فشل:
// 1) كاش 2) قاعدة البيانات 3) افتراضي مفعّل — الحماية تشتغل دائماً
async function getProtectionConfig(guildId, type) {
    const cached = protectionsCache.get(guildId);

    if (cached?.protections?.[type]) {
        return { prot: cached.protections[type], cached };
    }

    let settings = null;

    try {
        settings = await getSettings(guildId);
        ensureProtections(settings);
    } catch (error) {
        console.error(
            `[PROTECT] DB read failed (${guildId}/${type}): ${error.message}`
        );
    }

    const fresh = protectionsCache.get(guildId);

    if (fresh?.protections?.[type]) {
        return { prot: fresh.protections[type], cached: fresh };
    }

    return {
        prot: JSON.parse(
            JSON.stringify(DEFAULT_PROTECTIONS[type] || { enabled: true })
        ),
        cached: cached || { protections: {}, whitelist: [] }
    };
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
    // المقياس المتسبب + العقوبة الخاصة به (كل نوع سبام له عقوبته)
    let sourceMetric = 'messages';

    // الحدود التي يحددها صاحب السيرفر بنفسه من الداشبورد
    const msgLimit = metricLimit(prot, 'spam', 'messages', 5);
    const lengthLimit = metricLimit(prot, 'spam', 'length', 400);
    const repeatLimit = metricLimit(prot, 'spam', 'repeat', 8);

    // الخط الكبير: تكرار نفس الحرف
    if (repeatLimit > 0) {
        const run = maxRepeatedRun(content);
        if (run >= repeatLimit) {
            reason = `خط كبير (تكرار ${run} حرف)`;
            sourceMetric = 'repeat';
        }
    }

    // رسالة طويلة جداً
    if (!reason && lengthLimit > 0 && content.length > lengthLimit) {
        reason = `رسالة طويلة (${content.length} حرف > ${lengthLimit})`;
        sourceMetric = 'length';
    }

    // 🧩 القواعد الإضافية: منشنات / مسافات / خط كبير / ملفات / روابط
    if (!reason) {
        const maxMentions = metricLimit(prot, 'spam', 'mentions', 6);
        const maxSpaces = metricLimit(prot, 'spam', 'spaces', 10);
        const maxBigText = metricLimit(prot, 'spam', 'bigtext', 60);
        const maxFiles = metricLimit(prot, 'spam', 'files', 4);

        const spamCfg = {
            maxMentions,
            maxSpaces,
            maxBigText,
            maxFiles,
            onMentions: prot.onMentions !== false && maxMentions > 0,
            onSpaces: prot.onSpaces !== false && maxSpaces > 0,
            onBigText: prot.onBigText !== false && maxBigText > 0,
            onFiles: prot.onFiles !== false && maxFiles > 0,
            onLinks: prot.onLinks !== false,
            onInvites: prot.onInvites !== false
        };

        const hit = spamRules.detect(message, spamCfg)[0];

        if (hit) {
            reason = hit.reason;
            sourceMetric = hit.metric;
        }
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
            msgLimit,
            timeline
        )) {
            reason = `إرسال سريع (أكثر من ${msgLimit} رسالة خلال ${Math.round(timeline / 1000)} ثانية)`;
            sourceMetric = 'messages';
            protectionCounts.spam.delete(key);
        }
    }

    if (!reason) return false;

    const action = metricAction(prot, 'spam', sourceMetric, 'timeout');

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
        `السبب (${sourceMetric}) | التحذيرات: **2** | العقوبة: **${action === 'timeout' ? 'Time-out (10 دقائق)' : action}**`
    );

    return true;
}

// ======================================================
// 🛡️ حماية النصب — رومات محددة + قواعد (كلام / صورة / رابط)
// ======================================================

// رابط داخل الرسالة: http(s) / www / discord.gg / t.me وأشهرهم
const LINK_REGEX = /(https?:\/\/|www\.|discord\.gg\/|discord(?:app)?\.com\/invite\/|t\.me\/|wa\.me\/|bit\.ly\/|tinyurl\.com\/)/i;

// صورة أو ملف مرئي مرفوع مع الرسالة
function messageHasImage(message) {
    return (message.attachments?.size || 0) > 0
        && [...message.attachments.values()].some(
            a => (a.contentType || '').startsWith('image/') || !!a.imageUrl
        );
}

// رسالة فيها رابط (أولوية للمحتوى، وبعدها الروابط المرفقة)
function messageHasLink(message) {
    if (LINK_REGEX.test(message.content || '')) return true;
    return [...(message.attachments?.values() || [])].some(
        a => LINK_REGEX.test(a.url || '')
    );
}

// فحص رسالة ضد حماية النصب وتنفيذ العقوبة فوراً
// ترجع true إذا تعاقبنا (وعندها الفرع يوقف معالجة الرسالة)
async function handleScamProtection(message, prot) {
    if (!prot || !prot.enabled) return false;

    const channels = Array.isArray(prot.channelIds) ? prot.channelIds.map(String) : [];
    if (!channels.length) return false;

    // الروم لازم يكون ضمن المحمية المختارة
    if (!channels.includes(String(message.channel?.id))) return false;

    // البوتات ما تتعاقب (ولا البوت نفسه)
    if (message.author?.bot) return false;

    // راعي البوت مستثنى دائماً حتى ما نخسر السيرفر
    if (isBotOwner(message.author?.id)) return false;

    const content = String(message.content || '').trim();
    const hasImage = messageHasImage(message);
    const hasLink = messageHasLink(message);

    // الاسم + المقياس المتسبب + سبب واضح للسجل
    let sourceMetric = null;
    let reason = '';
    if (prot.onTalk) {
        // قاعدة "يتكلم" = أي رسالة (نص أو محتوى)
        if (content || hasImage || hasLink || (message.attachments?.size || 0) > 0 || (message.embeds?.length || 0) > 0) {
            sourceMetric = 'talk';
            reason = `كلام داخل روم النصب (${message.channel?.name || message.channel?.id})`;
        }
    }

    if (!sourceMetric && prot.onImage && hasImage) {
        sourceMetric = 'image';
        reason = `إرسال صورة في روم النصب (${message.channel?.name || message.channel?.id})`;
    }

    if (!sourceMetric && prot.onLink && hasLink) {
        sourceMetric = 'links';
        reason = `إرسال رابط في روم النصب (${message.channel?.name || message.channel?.id})`;
    }

    if (!sourceMetric) return false;

    // الحد: كم مرة يسمح قبل العقوبة (افتراضياً 1 = فوراً)
    const limit = metricLimit(prot, 'scams', sourceMetric, 1);
    const counterKey = `${message.guild.id}-${message.author.id}-${sourceMetric}`;

    if (limit > 1) {
        // مع حدود أكبر من 1: نعدّ خلال دقيقة
        if (!isLimitExceeded(protectionCounts.scams, counterKey, Date.now(), limit, 60 * 1000)) {
            return false;
        }
        protectionCounts.scams.delete(counterKey);
    }

    const action = metricAction(prot, 'scams', sourceMetric, 'ban');

    // نحذف الرسالة قبل العقوبة (لو البوت عنده صلاحية)
    await message.delete().catch(() => {});

    await applyPunishment(message.member, action, reason);

    const applied = action === 'ban'
        ? (message.member?.bannable ? '🔨 Ban' : '⚠️ ما قدرنا نبند (رتبة أعلى من البوت)')
        : action;

    await sendLog(
        message.guild,
        'protection',
        '🛡️ حماية النصب',
        `${message.author} في <#${message.channel?.id}> — ${reason}\n` +
        `القاعدة: **${sourceMetric}** | الحد: **${limit}** | العقوبة: **${applied}**\n` +
        `<#${message.channel?.id}>`,
        0xED4245
    );

    // نبلّغ العضو قبل العقوبة (لو قدرنا)
    try {
        await message.author.send(
            `⛔ **حماية النصب** — ${reason}\n` +
            `مخالفتك: **${action}**\n` +
            `إذا كانت غلط، راسل فريق السيرفر.`
        );
    } catch {}

    console.log(
        `[PROTECT] scam author=${message.author.id} metric=${sourceMetric} ` +
        `channel=${message.channel?.id} action=${action}`
    );

    return true;
}



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

// 'سجين' الاسم القديم — نبحث فيه عشان ما نكسر سيرفات موجودة
const JAIL_ROLE_NAMES = ['سجن', 'سجين'];
const JAIL_ROLE_COLOR = 0xE74C3C; // أحمر

// يمنع السجين من رؤية أي روم (نص/صوت/فئة) + الإرسال + التفاعل
async function applyJailRolePermissions(guild, role) {
    for (const channel of guild.channels.cache.values()) {
        await channel.permissionOverwrites.edit(
            role,
            {
                ViewChannel: false,
                SendMessages: false,
                AddReactions: false,
                Speak: false,
                Connect: false
            },
            { reason: 'Cypher Security Jail Role' }
        ).catch(() => {});
    }
}

// هل الرتبة عندها منع المشاهدة مطبّق بالفعل؟ (حتى ما نكتب على كل روم كل مرة)
function jailRoleConfigured(guild, role) {
    for (const channel of guild.channels.cache.values()) {
        const overwrite = channel.permissionOverwrites?.cache?.get(role.id);
        if (overwrite && overwrite.deny.has(PermissionFlagBits.ViewChannel)) return true;
    }
    return false;
}

// يرجّع رتبة السجن (وينشئها لو ما موجودة): اسم «سجن» + أحمر + ما تشوف ولا روم
async function getJailRole(guild, { create = true } = {}) {
    let role = guild.roles.cache.find(r => JAIL_ROLE_NAMES.includes(r.name));

    if (!role) {
        if (!create) return null;

        role = await guild.roles.create({
            name: 'سجن',
            color: JAIL_ROLE_COLOR,
            reason: 'Cypher Security Jail Role'
        }).catch(() => null);

        if (!role) return null;
    }

    // ننزّل اللون الأحمر حتى لو الرتبة كانت موجودة بلون ثاني
    if (role.color !== JAIL_ROLE_COLOR) {
        await guild.roles.edit(role, { color: JAIL_ROLE_COLOR }, 'Cypher Security Jail Role').catch(() => {});
    }

    // نرفعها فوق باقي الرتب عشان المنع يشتغل حتى لو معه رتب ثانية
    try {
        const top = guild.roles.cache
            .filter(r => r.editable && r.id !== role.id)
            .sort((a, b) => b.position - a.position)
            .first();

        if (top && role.position < top.position - 1) {
            await guild.roles.edit(
                role,
                { position: top.position - 1 },
                'Cypher Security Jail Role'
            ).catch(() => {});
        }
    } catch {}

    if (!jailRoleConfigured(guild, role)) {
        await applyJailRolePermissions(guild, role);
    }

    return role;
}

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

    const jailRole = await getJailRole(member.guild);

    if (!jailRole) return null;

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

    const jailRole = await getJailRole(member.guild, { create: false });

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

// أوامر Slash صارت مُعرّفة في ./commands.js (المصدر الوحيد)
// ويتم استيرادها في أعلى الملف: const { slashCommands } = require('./commands.js');


// ======================================================
// REGISTER SLASH COMMANDS
// ======================================================

// ⚠️ حد ديسكورد الثابت لأي أمر واحد: 4000 حرف على الـ JSON.
// set() يرسل كل الأوامر دفعة وحدة (PUT)، فلو أمر واحد عدّى الحد
// ديسكورد يرجّع 400 للطلب كله → *ولا أمر* يظهر لأي سيرفر.
// الكود كان يسجّل بهدوء ويطبع "✅" بدون ما يكتشف المشكلة — هذا الحارس يوقفها.
const DISCORD_COMMAND_MAX_CHARS = 4000;

function findOversizedCommands() {
    return slashCommands
        .map(command => {
            let size;

            try {
                size = JSON.stringify(command).length;
            } catch {
                size = Infinity;
            }

            return { name: command.name, size };
        })
        .filter(c => c.size > DISCORD_COMMAND_MAX_CHARS);
}

// 🧾 بصمة آخر نسخة مسجّلة — نتجنب بها إرسال نفس الأوامر لديسكورد كل تشغيل
// (ديسكورد يحسب عدد تحديثات الأوامر العامة ويحدّها، فالإرسال المتكرر يفشل)
const COMMANDS_HASH_FILE = path.join(__dirname, '.commands-hash');

function commandsHash() {
    return require('crypto')
        .createHash('sha256')
        .update(JSON.stringify(slashCommands))
        .digest('hex');
}

async function registerGlobalCommands() {

    // 🚨 نفحص قبل ما نرسل — يفشل صريح بدل 400 صامت
    const oversized = findOversizedCommands();

    if (oversized.length) {
        console.error(
            '\n==============================================\n' +
            '  🚨 تم إيقاف تسجيل الأوامر — أمر واحد تجاوز الحد\n' +
            '==============================================\n'
        );

        for (const c of oversized) {
            console.error(
                `  /${c.name} = ${c.size} حرف (الحد ${DISCORD_COMMAND_MAX_CHARS})\n` +
                '  قلل الأوصاف أو قسّم الأمر لأمرين — لا ترسل للأمر أرقام/وصف طويل.'
            );
        }

        console.error(
            '\n  ليش يهم: set() يرسل كل الأوامر مع بعض،\n' +
            '  فالأمر الطويل يسقط *كل* أوامر البوت مو بس نفسه.\n'
        );

        return false;
    }

    const hash = commandsHash();
    let lastHash = '';

    try {
        lastHash = fs.readFileSync(COMMANDS_HASH_FILE, 'utf8').trim();
    } catch {}

    const changed = hash !== lastHash;

    let globalOk = true;

    if (changed) {
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

        } catch (error) {

            globalOk = false;

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
        }
    } else {
        console.log(
            `ℹ️ الأوامر العامة ما تغيّرت (${slashCommands.length}) — تخطينا إعادة الإرسال لتفادي حد ديسكورد.`
        );
    }

    // ⚡ تسجيل فوري داخل كل سيرفر — يظهر فوراً بدون انتظار انتشار الأوامر العامة (حتى ساعة)
    let guildOk = 0;

    for (const guild of client.guilds.cache.values()) {
        try {
            await guild.commands.set(slashCommands);
            guildOk++;
        } catch (error) {
            console.error(
                `❌ فشل تسجيل أوامر السيرفر ${guild.id}:`,
                error.message || error
            );
        }
    }

    console.log(
        `⚡ تحديث فوري للأوامر في ${guildOk}/${client.guilds.cache.size} سيرفر`
    );

    // نحفظ البصمة بعد نجاح التسجيل (عشان المرة الجاية ما نعيد الإرسال بلا داعي)
    if (changed && (globalOk || guildOk > 0)) {
        try {
            fs.writeFileSync(COMMANDS_HASH_FILE, hash, 'utf8');
        } catch {}
    }

    return globalOk || guildOk > 0;
}

client.once('ready', async () => {

    console.log(`✅ Logged in as ${client.user.tag}`);

    // تسجيل الأوامر: عام (لكل السيرفرات) + فوري داخل كل سيرفر
    await registerGlobalCommands();

    // عمليات القاعدة تفشل فوراً لو DB مقطوع بدل التجمد الصامت 30 ثانية
    // (بتصير الحماية "تشتغل" حتى لو DB معطّلة — الإعدادات الافتراضية مفعّلة)
    mongoose.set('bufferCommands', false);

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
        '🔐 أوامر الحماية تتطلب رتبة ' + STAFF_ROLE_NAME + ' **فوق** رتبة البوت — باقي الأوامر تكفي رتبة ' + STAFF_ROLE_NAME + ' فقط'
    );

    runProtectionDiagnostics();

    // لقطات دورية لرومات كل سيرفر (لاسترجاعها فوراً إذا انحذفت بنوك)
    setInterval(() => {
        for (const guild of client.guilds.cache.values()) {
            captureChannels(guild);
            runBackupScheduler(guild);
        }
    }, CHANNEL_SNAPSHOT_INTERVAL).unref?.();
});

// تشخيص حالة الحماية: هل المفعّلة، وهل البوت يملك الصلاحيات الفعلية؟
async function runProtectionDiagnostics() {
    try {
        for (const guild of client.guilds.cache.values()) {
            let settings = null;
            try {
                settings = await getSettings(guild.id);
                ensureProtections(settings);
            } catch {}

            const me = guild.members.me;
            const perms = me?.permissions || null;
            const has = flag => (perms?.has(flag) ? '✅' : '❌');

            const flagLines = [
                `ViewAuditLog:${has(PermissionsBitField.Flags.ViewAuditLog)}`,
                `ManageChannels:${has(PermissionsBitField.Flags.ManageChannels)}`,
                `ManageRoles:${has(PermissionsBitField.Flags.ManageRoles)}`,
                `ManageWebhooks:${has(PermissionsBitField.Flags.ManageWebhooks)}`,
                `ManageMessages:${has(PermissionsBitField.Flags.ManageMessages)}`,
                `KickMembers:${has(PermissionsBitField.Flags.KickMembers)}`,
                `BanMembers:${has(PermissionsBitField.Flags.BanMembers)}`
            ].join('  ');

            const p = settings?.protections;

            const protLine = p
                ? [
                    `Channels:${p.channels?.enabled ? 'ON' : 'off'}`,
                    `Roles:${p.roles?.enabled ? 'ON' : 'off'}`,
                    `Webhooks:${p.webhooks?.enabled ? 'ON' : 'off'}`,
                    `Bots:${p.bots?.enabled ? 'ON' : 'off'}`,
                    `Bans:${p.bans?.enabled ? 'ON' : 'off'}`,
                    `Spam:${p.spam?.enabled ? 'ON' : 'off'}`,
                    `Scams:${p.scams?.enabled ? 'ON' : 'off'}`
                ].join('  ')
                : 'غير محملة (اضغط /protect لتأكيد التفعيل)';

            console.log(`🛡️ [${guild.name}] (${guild.id})`);
            console.log(`   مفعّلة: ${protLine}`);
            console.log(`   صلاحيات البوت: ${flagLines}`);
            console.log(`   أعلى رتبة للبوت position=${me?.roles?.highest?.position ?? '?'}`);
        }

        const dbState = [
            'مقطوع ❌',
            'متصل ✅',
            'يتصل...',
            'يقطع...'
        ][mongoose?.connection?.readyState] ?? 'مجهول';

        console.log(`🗄️ MongoDB: ${dbState} (readyState=${mongoose?.connection?.readyState})`);

        console.log('🛡️ Protection diagnostics done');
    } catch (error) {
        console.error('Protection diagnostics error:', error);
    }
}

// لاحظ: الأوامر عامة الآن، أي سيرفر جديد يظهر به الأوامر تلقائياً
client.on('guildCreate', guild => {

    console.log(
        `📥 Bot added to new server: ${guild.name}`
    );

    // تشخيص فوري عند دخول سيرفر جديد + لقطة أولية للرومات
    setTimeout(() => {
        runProtectionDiagnostics();
        captureChannels(guild);
    }, 5000).unref?.();
});


// ======================================================
// DASHBOARD — تفعيل حساب للداشبورد (بدون ما أحد يضيف آيدي بالملف)
// ======================================================

// السيرفرات اللي عند العضو فيها صلاحية Admin أو رتبة الستريتر
async function userManagedGuilds(userId) {
    const found = [];

    for (const guild of client.guilds.cache.values()) {
        const member = guild.members.cache.get(userId) ||
            await guild.members.fetch(userId).catch(() => null);

        if (!member) continue;

        if (isServerAdmin(member, guild) || memberHasStaffRole(member, guild)) {
            found.push({ id: guild.id, name: guild.name });
        }
    }

    return found;
}

function dashboardBaseUrl() {
    // نرجّع دومين https نظيف بدون بورت؛ أي localhost أو قيمة فاضية تتجاهل
    return normalizeDashboardUrl(DASHBOARD_URL) || normalizeDashboardUrl(RUNTIME_DASHBOARD_URL);
}

function dashboardLinkLine() {
    const base = dashboardBaseUrl();

    return base ? `${base}/#servers` : null;
}

async function handleDashboardCommand(interaction) {
    const sub = interaction.options.getSubcommand();
    const user = interaction.user;

    // ---------- activate ----------
    if (sub === 'activate') {
        const link = dashboardLinkLine();

        if (!link) {
            return interaction.reply({
                content:
                    '⚠️ رابط الداشبورد غير مضبوط على البوت.\n' +
                    'أضف `DASHBOARD_URL=https://دومينك` في ملف `.env` ثم أعد تشغيل البوت.',
                ephemeral: true
            });
        }

        const managed = await userManagedGuilds(user.id);

        // الداشبورد مفتوح للكل: ما يحتاج تفعيل — نخزّن الدخول بس عشان
        // المالك يشوف من دخل، ويقدر يلغي أي حساب بـ /dashboard revoke
        await DashboardUser.updateOne(
            { userId: user.id },
            {
                $set: {
                    authorized: true,
                    authorizedAt: new Date(),
                    authorizedGuilds: managed.map(g => g.id),
                    username: user.tag,
                    updatedAt: new Date()
                },
                $setOnInsert: { firstLoginAt: new Date() }
            },
            { upsert: true }
        ).catch(() => {});

        const dmText =
            '✅ **رابط دخولك للداشبورد**\n\n' +
            `🔗 ${link}\n\n` +
            'افتح الرابط واضغط **دخول بحساب Discord** (بدون آيدي وبدون كود وبدون باسوورد).\n' +
            'بتطلع لك **سيرفراتك أنت** اللي عندك فيها صلاحية Admin أو رتبة ستريتر، ' +
            'وتشوف على كل سيرفر: **البوت داخله ولا لا**.\n' +
            (managed.length
                ? '\nسيرفراتك اللي عندك صلاحية فيها:\n' + managed.map(g => `• ${g.name}`).join('\n') + '\n'
                : '\nما لقيت لك سيرفر بالبوت حالياً — أضف البوت لسيرفرك من زر "إضافة البوت" بالداشبورد.\n') +
            '\n> كل واحد يدخل لحاله، وما يشوف إلا سيرفراته هو.';

        const delivered = await user.send(dmText).then(() => true).catch(() => false);


        return interaction.reply({
            content: delivered
                ? `✅ أرسلت لك رابط الدخول بالخاص.\n\n${link}\n\n> ما يحتاج تفعيل — أي حساب ديسكورد يقدر يدخل ويشوف سيرفراته هو فقط.`
                : `✅ رابط الدخول:\n${link}\n\n> ما يحتاج تفعيل — أي حساب ديسكورد يقدر يدخل ويشوف سيرفراته هو فقط.`,
            ephemeral: true
        });
    }

    // ---------- status ----------
    if (sub === 'status') {
        const record = await DashboardUser.findOne({ userId: user.id }).lean().catch(() => null);
        const managed = await userManagedGuilds(user.id);
        const link = dashboardLinkLine();

        const lines = [
            `👤 الحساب: ${user.tag}`,
            `🆔 الآيدي: \`${user.id}\``,
            `✅ مفعّل: ${record?.authorized === false ? '❌ لا' : '✅ نعم'}`,
            `📥 عدد مرات الدخول: ${record?.loginCount || 0}`,
            record?.lastLoginAt ? `🕒 آخر دخول: <t:${Math.floor(new Date(record.lastLoginAt).getTime() / 1000)}:F>` : '🕒 آخر دخول: ما دخل بعد',
            record?.lastLoginIp ? `🌐 آخر آيبي: \`${record.lastLoginIp}\`` : '',
            record?.lastLoginDevice ? `📱 آخر جهاز: ${record.lastLoginDevice}` : '',
            '',
            `🏛️ سيرفراتك (${managed.length}):`,
            managed.length ? managed.map(g => `• ${g.name}`).join('\n') : 'ما فيه',
            link ? `\n🔗 ${link}` : '\n⚠️ رابط الداشبورد غير مضبوط (DASHBOARD_URL)'
        ].filter(Boolean);

        return interaction.reply({ content: lines.join('\n'), ephemeral: true });
    }

    // ---------- login (زر "تسجيل دخول" داخل السيرفر) ----------
    if (sub === 'login') {
        const channel = interaction.options.getChannel('channel') || interaction.channel;
        const link = dashboardLinkLine();

        if (!link) {
            return interaction.reply({
                content:
                    '⚠️ رابط الداشبورد غير مضبوط على البوت.\n' +
                    'أضف `DASHBOARD_URL=https://دومينك` في ملف `.env` ثم أعد تشغيل البوت.',
                ephemeral: true
            });
        }

        if (!channel.isTextBased()) {
            return interaction.reply({ content: '❌ اختر روم نصي.', ephemeral: true });
        }

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setLabel('تسجيل الدخول')
                .setStyle(ButtonStyle.Link)
                .setURL(`${dashboardBaseUrl()}/api/auth/login?silent=1`)
                .setEmoji('🔐')
        );

        const embed = new EmbedBuilder()
            .setColor(0xED4245)
            .setTitle('🔐 تسجيل دخول الداشبورد')
            .setDescription(
                'اضغط **تسجيل الدخول** تحت، بيوديك لصفحة ديسكورد الرسمية، ' +
                'وبعدها مباشرة تفتح لك لوحة التحكم وتطلع سيرفراتك اللي عندك فيها صلاحية.'
            )
            .addFields(
                { name: '1️⃣ ادخل بحسابك', value: 'اضغط الزر — ديسكورد يطلب موافقتك (بدون آيدي ولا كود).', inline: false },
                { name: '2️⃣ تطلع سيرفراتك', value: 'بتشوف كل سيرفر تملك فيه صلاحية **Admin** أو رتبة **ستريتر**.', inline: false },
                { name: '🔒 أمانك', value: 'ما نطلب باسوورد أبداً، ونرسل لك تنبيه特別 على الخاص عند كل دخول.', inline: false }
            )
            .setFooter({ text: `${interaction.guild.name} • ${STAFF_ROLE_NAME}` })
            .setTimestamp();

        const sent = await channel.send({ embeds: [embed], components: [row] }).catch(() => null);

        if (!sent) {
            return interaction.reply({ content: '❌ ما قدرت أرسل الرسالة — تأكد من صلاحياتي في الروم.', ephemeral: true });
        }

        return interaction.reply({
            content: `✅ انشر رسالة "تسجيل الدخول" في ${channel}.`,
            ephemeral: true
        });
    }

    // ---------- list (المالك فقط) ----------
    if (sub === 'list') {
        if (user.id !== OWNER_ID && !OWNER_IDS.includes(user.id)) {
            return interaction.reply({ content: '❌ هذا الأمر للمالك فقط.', ephemeral: true });
        }

        const records = await DashboardUser.find({ authorized: { $ne: false } })
            .sort({ updatedAt: -1 })
            .limit(50)
            .lean()
            .catch(() => []);

        if (!records.length) {
            return interaction.reply({ content: '📭 ما فيه أي حساب دخل الداشبورد بعد.', ephemeral: true });
        }

        const lines = records.map(r =>
            `• **${r.username || 'غير معروف'}** — \`${r.userId}\`\n` +
            `   دخولات: ${r.loginCount || 0} | آخر آيبي: \`${r.lastLoginIp || 'ما دخل'}\` | ${r.lastLoginDevice || 'غير معروف'}`
        );

        return interaction.reply({
            content: `📋 الحسابات اللي دخلت الداشبورد (${records.length}):\n${lines.join('\n')}`,
            ephemeral: true
        });
    }

    // ---------- revoke (المالك فقط) ----------
    if (sub === 'revoke') {
        if (user.id !== OWNER_ID && !OWNER_IDS.includes(user.id)) {
            return interaction.reply({ content: '❌ هذا الأمر للمالك فقط.', ephemeral: true });
        }

        const target = interaction.options.getUser('user');

        await DashboardUser.updateOne(
            { userId: target.id },
            { $set: { authorized: false, updatedAt: new Date() } },
            { upsert: true }
        ).catch(() => {});

        return interaction.reply({
            content: `🚫 تم إلغاء تفعيل ${target.tag} (\`${target.id}\`) من الداشبورد.`,
            ephemeral: true
        });
    }
}


// ======================================================
// 🔒 WHITELIST COMMAND (راعي البوت أو راعي السيرفر فقط)
// يُستدعى بعد requireWhitelistPermission
// ======================================================

async function handleWhitelistCommand(interaction) {
    const sub = interaction.options.getSubcommand();
    const settings = await getSettings(interaction.guild.id);
    const invitesProt = settings.protections?.invites;

    // ADD
    if (sub === 'add') {
        const user = interaction.options.getUser('user');

        if (settings.whitelist?.includes(user.id)) {
            return interaction.reply({
                content: `❌ ${user} موجود مسبقاً في الوايت ليست.`,
                ephemeral: true
            });
        }

        settings.whitelist.push(user.id);
        await settings.save();
        ensureProtections(settings);

        return interaction.reply({
            content:
                `✅ تمت إضافة ${user} إلى الوايت ليست.\n` +
                `🛡️ الحماية لن تتدخل معه (رومات/رتب/ويب هوك/باند/سبام).\n` +
                (invitesProt?.enabled
                    ? '⛔ **ملاحظة**: حماية الاختصار ما تتجاوز — الوايت ليست ما تنفع عنده (العقوبة فورية على أول حذف).'
                    : '💡 حماية الاخصار مو مفعّلة حالياً — لو فعّلتها ما تتجاوز الوايت ليست أبداً.'),
            ephemeral: true
        });
    }

    // REMOVE
    if (sub === 'remove') {
        const user = interaction.options.getUser('user');

        if (!settings.whitelist?.includes(user.id)) {
            return interaction.reply({
                content: `❌ ${user} ليس في الوايت ليست.`,
                ephemeral: true
            });
        }

        settings.whitelist = settings.whitelist.filter(id => id !== user.id);

        await settings.save();
        ensureProtections(settings);

        return interaction.reply({
            content:
                `🗑️ تمت إزالة ${user} من الوايت ليست.\n` +
                `الآن الحماية تتعامل معه بشكل طبيعي.`,
            ephemeral: true
        });
    }

    // LIST
    if (sub === 'list') {
        const ids = settings.whitelist || [];
        const lines = [];

        for (const id of ids) {
            const member = await getMember(interaction.guild, id);
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
                        text: `عدد الأعضاء: ${lines.length} • 🔒 للمالك فقط`
                    })
            ],
            ephemeral: true
        });
    }
}


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

            // أوامر الحماية = رتبة ستريتر لازم تكون فوق رتبة البوت
            // باقي الأوامر = رتبة ستريتر فقط
            // /antispam هو نفس نظام /protect بس للحمايات المحتوى
            const isProtectionCommand =
                command === 'protect' || command === 'antispam';

            // 🔒 الوايت ليست: راعي البوت أو راعي السيرفر فقط
            // (نفّذها ونوقف — ما نطلب رتبة الستريتر من راعي السيرفر)
            if (command === 'whitelist') {
                const wlOK = await requireWhitelistPermission(interaction);
                if (wlOK !== true) return;
                return handleWhitelistCommand(interaction);
            }

            const staffOK = isProtectionCommand
                ? await requireProtectionPermission(interaction)
                : await requireStaffPermission(interaction, {
                    // 🎫 صاحب التكت العادي لازم يدير تكتّه (يضيف/يطرد ناس)
                    // بدون ما يكون أدمن — فبنسمح له بأوامر التكت الداخلية فقط.
                    // باقي أوامر التكت (setup / image / option...) تفضل للفريق.
                    allow: TICKET_MEMBER_SUBCOMMANDS,
                    allowCheck: (sub, group) => group === null
                });

            if (staffOK !== true) return staffOK;


            // ==========================================
            // DASHBOARD
            // ==========================================

            if (command === 'dashboard') {

                return handleDashboardCommand(interaction);
            }


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

                // ===== /welcome image ... =====
                // لازم نتحقق من المجموعة قبل sub، وإلا صار
                // /welcome image set يختلط مع /welcome set
                const welcomeGroup =
                    interaction.options.getSubcommandGroup
                        ? interaction.options.getSubcommandGroup()
                        : null;

                if (welcomeGroup === 'image') {

                    if (!hasStaffAccess(interaction.member, interaction.guild)) {
                        return interaction.reply({
                            content: '❌ الرتب المسؤولة فقط تقدر تغيّر صورة الترحيب.',
                            ephemeral: true
                        });
                    }

                    if (sub === 'remove') {

                        settings.welcome.image = null;
                        settings.welcome.cardEnabled = true;

                        await settings.save();

                        return interaction.reply({
                            content: '🗑️ تم حذف صورة الترحيب — رجعنا للبطاقة الافتراضية.\n' +
                                '💡 تقدر تعطّل البطاقة كلياً بـ `/welcome card enabled:False`.',
                            ephemeral: true
                        });
                    }

                    const resolved =
                        await resolveImageOption(interaction);

                    if (resolved.error) {
                        return interaction.reply({
                            content: resolved.error,
                            ephemeral: true
                        });
                    }

                    if (!resolved.url) {
                        const current = settings.welcome.image;

                        return interaction.reply({
                            embeds: [
                                new EmbedBuilder()
                                    .setColor(current ? 0x57F287 : 0xFEE75C)
                                    .setTitle('🖼️ صورة الترحيب')
                                    .setDescription(
                                        current
                                            ? 'الصورة الحالية مسجّلة — هذي لينكها:'
                                            : 'ما فيه صورة ترحيب مسجّلة حالياً.'
                                    )
                                    .addFields(
                                        {
                                            name: 'الحالة',
                                            value: current
                                                ? '✅ صورة مخصّصة مفعّلة'
                                                : '🖼️ بطاقة Canvas الافتراضية',
                                            inline: true
                                        },
                                        {
                                            name: 'الرابط',
                                            value: current
                                                ? String(current).slice(0, 1024)
                                                : '—',
                                            inline: false
                                        }
                                    )
                                    .setFooter({
                                        text: 'التعيين: /welcome image set file:📎 أو url:…'
                                    })
                            ],
                            ephemeral: true
                        });
                    }

                    settings.welcome.image = resolved.url;
                    settings.welcome.cardEnabled = false;

                    await settings.save();

                    const chLabel = settings.welcome.channelId
                        ? `<#${settings.welcome.channelId}>`
                        : 'ما فيه روم ترحيب محدد — استخدم `/welcome set`';

                    return interaction.reply({
                        content:
                            `✅ تم حفظ صورة الترحيب.\n` +
                            `🖼️ ${resolved.source === 'file' ? 'من المرفق المرفوع' : 'من الرابط'}\n` +
                            `📡 ${settings.welcome.enabled ? `ترسل في ${chLabel}` : '⚠️ الترحيب معطّل — فعّله بـ `/welcome set`'}`
                    });
                }

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

                    const staffOnly =
                        interaction.options.getBoolean('staff_only') || false;

                    settings.autoResponses.push({
                        trigger,
                        response,
                        staffOnly
                    });

                    await settings.save();

                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle('🤖 إضافة الرد التلقائي')
                                .setDescription(
                                    `**الرد:** ${trigger}\n` +
                                    `**الإجابة:** ${response}\n` +
                                    `**من يستجيب له:** ${staffOnly ? `🔒 رتبة ${STAFF_ROLE_NAME} فقط` : '🌐 أي عضو'}`
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
                                    },
                                    {
                                        label: 'Protection Logs',
                                        value: 'protection',
                                        emoji: '🛡️',
                                        description:
                                            'سجلات الحماية (أنتي-نوك... إلخ)'
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

            if (command === 'protect' || command === 'antispam') {

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

                        // مزامنة الحدود مع خريطة المقاييس (المصدر الفعلي للفحص)
                        prot.metrics = prot.metrics || {};
                        if (limit) prot.metrics.messages = limit;
                        if (maxLength) prot.metrics.length = maxLength;
                        if (repeated) prot.metrics.repeat = repeated;

                        for (const key of ['mentions', 'spaces', 'bigtext', 'files']) {
                            const v = interaction.options.getInteger(key);
                            if (v !== null && v !== undefined) prot.metrics[key] = v;
                        }

                        const links = interaction.options.getBoolean('links');
                        const invites = interaction.options.getBoolean('invites');
                        if (links !== null && links !== undefined) prot.onLinks = links;
                        if (invites !== null && invites !== undefined) prot.onInvites = invites;
                    }

                    await settings.save();

                    const spamExtra = sub === 'spam'
                        ? `\nأقصى طول للرسالة: **${prot.maxLength}** حرف\n` +
                          `أقصى تكرار لنفس الحرف ورا بعض: **${prot.repeatedChar}**\n` +
                          `منشنات: **${metricLimit(prot, 'spam', 'mentions', 6)}** | ` +
                          `مسافات: **${metricLimit(prot, 'spam', 'spaces', 10)}** | ` +
                          `خط كبير: **${metricLimit(prot, 'spam', 'bigtext', 60)}%** | ` +
                          `ملفات: **${metricLimit(prot, 'spam', 'files', 4)}**\n` +
                          `روابط خارجية: **${prot.onLinks !== false ? 'محظورة 🚫' : 'مسموحة ✅'}** | ` +
                          `دعوات سيرفرات: **${prot.onInvites !== false ? 'محظورة 🚫' : 'مسموحة ✅'}**`
                        : '';

                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle(`🛡️ حماية ${names[sub]}`)
                                .setColor(enabled ? 0x57F287 : 0xED4245)
                                .setDescription(
                                    `الحالة: **${enabled ? 'مفعلة ✅' : 'متوقفة ❌'}**\n` +
                                    `الحد المسموح: **${prot.limit}**\n` +
                                    (sub === 'spam' ? `الفترة: **${Math.round(prot.timeframe / 1000)} ثانية**\n` : '') +
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

                if (sub === 'scams') {

                    const enabled =
                        interaction.options.getBoolean('enabled');

                    const prot =
                        settings.protections.scams;

                    const channel =
                        interaction.options.getChannel('channel');

                    const clear =
                        interaction.options.getBoolean('clear');

                    const talk =
                        interaction.options.getBoolean('talk');

                    const image =
                        interaction.options.getBoolean('image');

                    const link =
                        interaction.options.getBoolean('link');

                    const action =
                        interaction.options.getString('action');

                    if (channel) {
                        prot.channelIds = [channel.id];
                    }

                    if (clear) {
                        prot.channelIds = [];
                    }

                    if (talk !== null) prot.onTalk = talk;
                    if (image !== null) prot.onImage = image;
                    if (link !== null) prot.onLink = link;
                    if (action) prot.action = action;

                    prot.enabled = enabled;

                    // تفعيل بدون روم أو بدون قاعدة = ما يسوي شي
                    const rules = [];
                    if (prot.onTalk) rules.push('كلام');
                    if (prot.onImage) rules.push('صورة');
                    if (prot.onLink) rules.push('رابط');

                    if (enabled && (!prot.channelIds?.length || !rules.length)) {
                        return interaction.reply({
                            content:
                                `❌ **ناقص الإعداد**\n` +
                                (prot.channelIds?.length
                                    ? ''
                                    : `• حدّد روم محمي بـ \`channel\` أو فعّل \`clear:False\` لإيقاف الحماية.\n`) +
                                (rules.length
                                    ? ''
                                    : `• فعّل قاعدة واحدة على الأقل: \`talk\` أو \`image\` أو \`link\`.\n`),
                            ephemeral: true
                        });
                    }

                    await settings.save();

                    const rooms = (prot.channelIds || []).map(id => `<#${id}>`).join(' ') || '—';

                    return interaction.reply({
                        embeds: [
                            new EmbedBuilder()
                                .setTitle(`🛡️ حماية النصب ${enabled ? 'مفعلة ✅' : 'متوقفة ❌'}`)
                                .setColor(enabled ? 0x57F287 : 0xED4245)
                                .setDescription(
                                    `الروم المحمي: ${rooms}\n` +
                                    `القواعد:\n` +
                                    `• كلام: **${prot.onTalk ? '✅ مفعّل' : '❌ متوقف'}**\n` +
                                    `• صورة: **${prot.onImage ? '✅ مفعّل' : '❌ متوقف'}**\n` +
                                    `• رابط: **${prot.onLink ? '✅ مفعّل' : '❌ متوقف'}**\n` +
                                    `العقوبة: **${prot.action}**\n` +
                                    `الاستثناءات: راعي البوت + البوتات + رتبة الستريتر.\n` +
                                    `💡 الحدود والعقوبة التفصيلية لكل قاعدة تضبطها من الداشبورد → 🛡️ الحماية.`
                                )
                        ]
                    });
                }

                if (sub === 'invites') {

                    const enabled =
                        interaction.options.getBoolean('enabled');

                    const prot =
                        settings.protections.invites;

                    // ==============================
                    // إيقاف الحماية
                    // ==============================
                    if (!enabled) {
                        prot.enabled = false;
                        await settings.save();
                        return interaction.reply(
                            `⛔ تم إيقاف حماية الاختصار.`,
                            { ephemeral: true }
                        );
                    }

                    const code =
                        interaction.options.getString('code');

                    const actionOption =
                        interaction.options.getString('action');

                    if (actionOption) {
                        prot.action = actionOption;
                        prot.metricActions = {
                            ...(prot.metricActions || {}),
                            redirect: actionOption
                        };
                    }

                    let protectedCode = null;
                    let protectedChannelId = null;

                    // 1) المستخدم حدد الكود
                    if (code) {
                        const invites =
                            await interaction.guild.invites.fetch()
                                .catch(() => new Map());

                        const found = Array.from(invites.values())
                            .find(i => i.code === code);

                        if (found) {
                            protectedCode = found.code;
                            protectedChannelId = found.channel?.id || null;
                        } else {
                            // 🔗 يمكن الاختصار رابط السيرفر المخصص (Vanity)
                            const vanity = await interaction.guild
                                .fetchVanityData()
                                .catch(() => null);

                            if (vanity?.code && vanity.code === code) {
                                protectedCode = vanity.code;
                                protectedChannelId = null;
                            }
                        }

                        if (!protectedCode) {
                            return interaction.reply({
                                content: `❌ ما لقيت اختصار **${code}** في السيرفر. تأكد من الكود، أو مرره بدون code عشان آخذ أكثر اختصار مستخدم تلقائياً.`,
                                ephemeral: true
                            });
                        }
                    }

                    // 2) اختيار أكثر اختصار مستخدم تلقائياً (بدون إنشاء أي رابط)
                    if (!protectedCode) {
                        const invites =
                            await interaction.guild.invites.fetch()
                                .catch(() => new Map());

                        const existing = Array.from(invites.values())
                            .filter(i => i.channel)
                            .sort((a, b) => (b.uses || 0) - (a.uses || 0))[0];

                        if (existing) {
                            protectedCode = existing.code;
                            protectedChannelId = existing.channel.id;
                        } else {
                            const vanity = await interaction.guild
                                .fetchVanityData()
                                .catch(() => null);

                            if (vanity?.code) {
                                protectedCode = vanity.code;
                                protectedChannelId = null;
                            }
                        }
                    }

                    if (!protectedCode) {
                        return interaction.reply({
                            content: '❌ ما فيه اختصار بالسيرفر. أنشئ رابط دعوة من ديسكورد ثم أعد المحاولة.',
                            ephemeral: true
                        });
                    }

                    prot.enabled = true;
                    prot.code = protectedCode;
                    prot.channelId = protectedChannelId;

                    await settings.save();

                    return interaction.reply(
                        `🛡️ تم تفعيل حماية الاختصار: **discord.gg/${protectedCode}**\n` +
                        `⛔ **ممنوع التجاوز**: الحد صفر — ما أحد يتجاوز، ولا الوايت ليست ولا رتبة المشرف.\n` +
                        `أول ما ينشال → عقوبة **${prot.action || 'ban'}** على اللي شالله فوراً (بدون انتظار).\n` +
                        `استثناء واحد: راعي البوت.\n` +
                        `💡 تقدر تضبطها كلها من الداشبورد → 🛡️ الحماية.`
                    );
                }

                if (sub === 'status') {

                    const fmt = p =>
                        `**${p.enabled ? '✅ مفعلة' : '❌ متوقفة'}**\n` +
                        `الحد: **${p.limit}**\n` +
                        `العقوبة: **${p.action}**`;

const botsDesc = settings.protections.bots.enabled
                        ? '**✅ مفعّلة**\nالمرجع: رتبة البوت (فوقه مسموح، بنفسه/تحته غير مصرّح)'
                        : '**❌ متوقفة**';

                    const webhooksProt = settings.protections.webhooks;

                    const webhooksDesc = `**${webhooksProt.enabled ? '✅ مفعّلة' : '❌ متوقفة'}**\n` +
                        `الحد المسموح: **${webhooksProt.limit}**\n` +
                        `العقوبة (تحت رتبة البوت): **${webhooksProt.action}**\n` +
                        `المرجع: رتبة البوت والفوايت ليست\n` +
                        `(فوقه/وايت ليست: مسموح | ضمن الحد: مسموح | بنفسه: حذف كل الويب هوك | تحته عند التجاوز: حظر + حذف الكل)`;

                    const spamProt = settings.protections.spam;

                    const spamActionLabel =
                        spamProt.action === 'timeout'
                            ? '🔇 Time-out (بعد تحذيرين)'
                            : spamProt.action;

                    const spamDesc = `**${spamProt.enabled ? '✅ مفعلة' : '❌ متوقفة'}**\n` +
                        `الحد: **${metricLimit(spamProt, 'spam', 'messages', 5)}** | الفترة: **${Math.round(spamProt.timeframe / 1000)} ث**\n` +
                        `أقصى طول: **${metricLimit(spamProt, 'spam', 'length', 400)}** | تكرار الحرف: **${metricLimit(spamProt, 'spam', 'repeat', 8)}**\n` +
                        `منشنات: **${metricLimit(spamProt, 'spam', 'mentions', 6)}** | مسافات: **${metricLimit(spamProt, 'spam', 'spaces', 10)}** | ` +
                        `خط كبير: **${metricLimit(spamProt, 'spam', 'bigtext', 60)}%** | ملفات: **${metricLimit(spamProt, 'spam', 'files', 4)}**\n` +
                        `روابط https: **${spamProt.onLinks !== false ? 'محظورة' : 'مسموحة'}** | دعوات: **${spamProt.onInvites !== false ? 'محظورة' : 'مسموحة'}**\n` +
                        `العقوبة: **${spamActionLabel}**`;

                    const invitesProt = settings.protections.invites;

                    const invitesDesc =
                        `**${invitesProt.enabled ? '✅ مفعلة' : '❌ متوقفة'}**\n` +
                        `الاختصار المحمي: **${invitesProt.code ? 'discord.gg/' + invitesProt.code : 'غير محدد — عيّنه من الداشبورد'}**\n` +
                        `العقوبة فوراً: **${metricAction(invitesProt, 'invites', 'redirect', 'ban')}**\n` +
                        `التجاوز: **⛔ ممنوع للجميع (الحد صفر — حتى الوايت ليست)**\n` +
                        `الاستثناء: **راعي البوت فقط**`;

                    const scamsProt = settings.protections.scams;
                    const scamRooms = (scamsProt.channelIds || []).map(id => `<#${id}>`).join(' ') || 'غير محدد';

                    const scamsDesc =
                        `**${scamsProt.enabled ? '✅ مفعلة' : '❌ متوقفة'}**\n` +
                        `الروم: ${scamRooms}\n` +
                        `كلام: **${scamsProt.onTalk ? '✅' : '❌'}** (حد ${metricLimit(scamsProt, 'scams', 'talk', 1)}) | ` +
                        `صورة: **${scamsProt.onImage ? '✅' : '❌'}** (حد ${metricLimit(scamsProt, 'scams', 'image', 1)}) | ` +
                        `رابط: **${scamsProt.onLink ? '✅' : '❌'}** (حد ${metricLimit(scamsProt, 'scams', 'links', 1)})\n` +
                        `العقوبة العامة: **${scamsProt.action}**\n` +
                        `الاستثناءات: راعي البوت + البوتات + رتبة الستريتر`;

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
                                    { name: '🔗 الويب هوك', value: webhooksDesc, inline: false },
                                    { name: '🔗 حماية الاختصار', value: invitesDesc, inline: false },
                                    { name: '🚨 حماية النصب', value: scamsDesc, inline: false }
                                )
                        ]
                    });
                }
            }

            // ==========================================
            // WHITELIST (وايت ليست — للحماية فقط)
            // ملاحظة: يتكفل بها requireWhitelistPermission فوق
            // ==========================================

            // ==========================================
            // BACKUP (حفظ نسخة كاملة من السيرفر)
            // ==========================================

            if (command === 'backup') {

                if (!isAdmin(interaction)) {
                    return interaction.reply({
                        content:
                            `❌ تحتاج رتبة **${STAFF_ROLE_NAME}** لاستخدام هذا الأمر.`,
                        ephemeral: true
                    });
                }

                await interaction.deferReply({ ephemeral: true });

                const result = await captureGuildBackup(
                    interaction.guild,
                    'manual'
                );

                if (!result.saved) {
                    return interaction.editReply({
                        content:
                            `❌ فشل الحفظ: ${result.error || 'خطأ غير معروف'}`
                    });
                }

                console.log(
                    `[BACKUP] تم الحفظ ${interaction.guild.id} | رومات=${result.channels} رتب=${result.roles} إيموجي=${result.emojis} ستيكرات=${result.stickers} حماية=${result.protections}`
                );

                await sendLog(
                    interaction.guild,
                    'moderation',
                    '📦 Backup Saved',
                    `تم حفظ نسخة كاملة من السيرفر بواسطة <@${interaction.user.id}>.\n` +
                    `القنوات: **${result.channels}**\n` +
                    `الرتب: **${result.roles}**\n` +
                    `الإيموجي: **${result.emojis}**\n` +
                    `الستيكرات: **${result.stickers}**\n` +
                    `إعدادات الحماية: **${result.protections ? 'نعم' : 'لا'}**\n` +
                    `الوقت: <t:${Math.floor(result.capturedAt.getTime() / 1000)}:f>`
                );

                return interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('📦 Backup Saved')
                            .setDescription(
                                'تم حفظ نسخة كاملة من السيرفر.\n' +
                                'إذا تم تهكير السيرفر لاحقاً استخدم **/restore** لاسترجاع كل شيء.'
                            )
                            .setColor(0x57F287)
                            .addFields(
                                {
                                    name: '📁 القنوات',
                                    value: String(result.channels),
                                    inline: true
                                },
                                {
                                    name: '🎭 الرتب',
                                    value: String(result.roles),
                                    inline: true
                                },
                                {
                                    name: '😀 الإيموجي',
                                    value: String(result.emojis),
                                    inline: true
                                },
                                {
                                    name: '🖼️ ستيكرات',
                                    value: String(result.stickers),
                                    inline: true
                                },
                                {
                                    name: '🛡️ إعدادات الحماية',
                                    value: result.protections ? '✓ محفوظة' : '—',
                                    inline: true
                                }
                            )
                            .setFooter({
                                text: 'النسخ الاحتياطية محفوظة في قاعدة البيانات'
                            })
                    ]
                });
            }

            // ==========================================
            // RESTORE (استرجاع كل شيء — للمالك فقط)
            // ==========================================

            if (command === 'restore') {

                const isOwner =
                    interaction.user.id === interaction.guild.ownerId ||
                    interaction.user.id === OWNER_ID;

                if (!isOwner) {
                    return interaction.reply({
                        content:
                            `❌ هذا الأمر للمالك فقط.\n` +
                            `لا يمكن لأي شخص آخر استرجاع النسخة.`,
                        ephemeral: true
                    });
                }

                await interaction.deferReply({ ephemeral: true });

                let backups = [];
                try {
                    backups = await GuildBackupHistory.find({ guildId: interaction.guild.id })
                        .sort({ capturedAt: -1 })
                        .limit(BACKUP_HISTORY_LIMIT)
                        .lean();
                } catch {}

                // توافق مع النسخ القديمة (قبل ما نضيف السجل)
                if (!backups.length) {
                    const latest = await GuildBackup
                        .findOne({ guildId: interaction.guild.id })
                        .lean();

                    if (latest) {
                        backups = [{
                            ...latest,
                            _id: 'latest',
                            kind: 'latest'
                        }];
                    }
                }

                if (!backups.length) {
                    return interaction.editReply({
                        content:
                            '❌ لا توجد نسخ احتياطية لهذا السيرفر.\nاستخدم **/backup** أولاً.'
                    });
                }

                const options = backups.map((b, i) => {
                    const ts = new Date(b.capturedAt || Date.now());
                    const kindLabel =
                        b.kind === 'manual'
                            ? 'يدوية'
                            : b.kind === 'latest'
                                ? 'النسخة الحالية'
                                : 'تلقائية';

                    const label =
                        `${i === 0 ? '🟢 الأحدث · ' : ''}` +
                        `${ts.toLocaleDateString('ar')} ${ts.toLocaleTimeString('ar', { hour: '2-digit', minute: '2-digit' })}`;

                    return {
                        label: label.slice(0, 100),
                        description:
                            `${kindLabel} · رومات ${(b.channels || []).length} · رتب ${(b.roles || []).length}`.slice(0, 100),
                        value: String(b._id)
                    };
                });

                return interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('♻️ استرجاع من نسخة')
                            .setDescription(
                                'اختر النسخة اللي تبي ترجع لها من القائمة بالأسفل.\n' +
                                '⚠️ **الأحدث ممكن تكون انحفظت بعد الاختراق** — إذا الشكل غلط، جرّب نسخة أقدم.'
                            )
                            .setColor(0xFEE75C)
                    ],
                    components: [
                        new ActionRowBuilder().addComponents(
                            new StringSelectMenuBuilder()
                                .setCustomId('restore_pick')
                                .setPlaceholder('اختر النسخة...')
                                .addOptions(options)
                        )
                    ]
                });
            }

            if (command === 'safe-channel') {

                if (!isAdmin(interaction)) {
                    return interaction.reply({
                        content: `❌ تحتاج رتبة **${STAFF_ROLE_NAME}** لاستخدام هذا الأمر.`,
                        ephemeral: true
                    });
                }

                const sub = interaction.options.getSubcommand();
                const settings = await getSettings(interaction.guild.id);

                if (!Array.isArray(settings.protectedChannelIds)) {
                    settings.protectedChannelIds = [];
                }

                if (sub === 'add') {
                    const ch = interaction.options.getChannel('channel');

                    if (settings.protectedChannelIds.includes(ch.id)) {
                        return interaction.reply({
                            content: `ℹ️ ${ch} محمي من قبل.`,
                            ephemeral: true
                        });
                    }

                    settings.protectedChannelIds.push(ch.id);
                    settings.markModified('protectedChannelIds');
                    await settings.save();

                    return interaction.reply({
                        content: `🛡️ تمت حماية ${ch} — ما بينحذف بالتنظيف ولا الاسترجاع.`,
                        ephemeral: true
                    });
                }

                if (sub === 'remove') {
                    const ch = interaction.options.getChannel('channel');
                    const before = settings.protectedChannelIds.length;

                    settings.protectedChannelIds =
                        settings.protectedChannelIds.filter(id => id !== ch.id);

                    if (settings.protectedChannelIds.length !== before) {
                        settings.markModified('protectedChannelIds');
                        await settings.save();

                        return interaction.reply({
                            content: `✅ أزلت حماية ${ch}.`,
                            ephemeral: true
                        });
                    }

                    return interaction.reply({
                        content: `ℹ️ ${ch} مو محمي يدوياً.`,
                        ephemeral: true
                    });
                }

                const manual = settings.protectedChannelIds;
                const auto = autoProtectedChannelIds(settings);

                const fmt = ids => [...ids].map(id => {
                    const ch = interaction.guild.channels.cache.get(String(id));
                    return ch
                        ? `• ${ch} (\`${ch.name}\`)`
                        : `• \`${id}\` (محذوف/غير معروف)`;
                }).join('\n') || '— لا شيء —';

                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('🛡️ الرومات المحمية')
                            .setColor(0x5865F2)
                            .addFields(
                                {
                                    name: 'يدوي',
                                    value: fmt(manual).slice(0, 1024),
                                    inline: false
                                },
                                {
                                    name: 'تلقائي (لوق/ترحيب/تكت/فيدباك/قيف اواي/صوتيات)',
                                    value: fmt(auto).slice(0, 1024),
                                    inline: false
                                }
                            )
                    ],
                    ephemeral: true
                });
            }

            if (command === 'temprole') {
                return temproles.handleSlash(interaction);
            }

            if (command === 'giveaway') {
                return giveaways.handleSlash(interaction);
            }

            if (command === 'puzzle') {
                return puzzle.handleSlash(interaction);
            }

            if (command === 'reactionrole') {
                return reactionroles.handleSlash(interaction);
            }

            if (command === 'tempvoice') {
                return tempvoice.handleSlash(interaction);
            }

            if (command === 'feedback') {
                return feedback.handleSlash(interaction);
            }

            if (command === 'security-audit') {
                return securityAudit.handleSlash(interaction);
            }

            if (command === 'ticket') {
                return tickets.handleSlash(interaction);
            }

            if (command === 'set-ticket') {
                return tickets.handleSendPanel(
                    interaction,
                    interaction.options.getChannel('channel')
                );
            }
        }

        if (interaction.isStringSelectMenu()) {

            const id = interaction.customId;


            // ==============================================
            // RESTORE — اختيار النسخة
            // ==============================================

            if (id === 'restore_pick') {

                const isOwner =
                    interaction.user.id === interaction.guild.ownerId ||
                    interaction.user.id === OWNER_ID;

                if (!isOwner) {
                    return interaction.reply({
                        content: '❌ هذا الأمر للمالك فقط.',
                        ephemeral: true
                    });
                }

                const backupId = interaction.values[0];
                const chosen = await GuildBackupHistory
                    .findById(backupId)
                    .lean()
                    .catch(() => null);

                const when = chosen?.capturedAt
                    ? `<t:${Math.floor(new Date(chosen.capturedAt).getTime() / 1000)}:f>`
                    : 'النسخة الحالية';

                return interaction.update({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('⚠️ تأكيد الاسترجاع')
                            .setDescription(
                                `بتسترجع السيرفر من نسخة: **${when}**\n\n` +
                                '• المفقود من الرومات والرتب بينعاد إنشاؤه.\n' +
                                '• الزائد اللي أضافه المخترق بينحذف.\n' +
                                '• 🛡️ الرومات المحمية **ما تتأثر** أبداً.\n\n' +
                                'هل أنت متأكد؟'
                            )
                            .setColor(0xED4245)
                    ],
                    components: [
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId(`restore_confirm:${backupId}`)
                                .setLabel('تأكيد الاسترجاع')
                                .setStyle(ButtonStyle.Danger),
                            new ButtonBuilder()
                                .setCustomId('restore_cancel')
                                .setLabel('إلغاء')
                                .setStyle(ButtonStyle.Secondary)
                        )
                    ]
                });
            }


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

                    const permissionInput =
                        new TextInputBuilder()
                            .setCustomId('permission')
                            .setLabel('الصلاحية — staff = الفريق فقط | غير ذلك = الجميع')
                            .setStyle(
                                TextInputStyle.Short
                            )
                            .setRequired(true)
                            .setValue(
                                item.staffOnly
                                    ? 'staff'
                                    : 'any'
                            );

                    modal.addComponents(
                        new ActionRowBuilder()
                            .addComponents(triggerInput),
                        new ActionRowBuilder()
                            .addComponents(responseInput),
                        new ActionRowBuilder()
                            .addComponents(permissionInput)
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

                pendingLogChannelSet.set(
                    interaction.user.id,
                    {
                        type,
                        guildId: interaction.guild.id,
                        expires:
                            Date.now() + 60000
                    }
                );

                return interaction.update({
                    content:
                        `✏️ اكتب الآن منشن الروم لسجل **${type}**.\n` +
                        `مثال: <#CHANNEL_ID> أو #اسم-الروم\n` +
                        `(انتظر خلال **60 ثانية**)`,
                    components: []
                });
            }
        }


        // ==================================================
        // TICKET BUTTONS
        // ==================================================

        if (interaction.isButton()) {

            // ==============================================
            // RESTORE — تأكيد / إلغاء
            // ==============================================

            if (interaction.customId.startsWith('restore_confirm')) {

                const isOwner =
                    interaction.user.id === interaction.guild.ownerId ||
                    interaction.user.id === OWNER_ID;

                if (!isOwner) {
                    return interaction.reply({
                        content: '❌ هذا الأمر للمالك فقط.',
                        ephemeral: true
                    });
                }

                const backupId = interaction.customId.split(':')[1];

                await interaction.deferUpdate();

                let backupDoc = null;

                if (backupId && backupId !== 'latest') {
                    backupDoc = await GuildBackupHistory
                        .findById(backupId)
                        .lean()
                        .catch(() => null);
                }

                if (!backupDoc) {
                    backupDoc = await GuildBackup
                        .findOne({ guildId: interaction.guild.id })
                        .lean();
                }

                if (!backupDoc) {
                    return interaction.editReply({
                        content: '❌ النسخة غير موجودة.',
                        embeds: [],
                        components: []
                    });
                }

                const result = await restoreGuildFromBackup(
                    interaction.guild,
                    backupDoc
                );

                if (result.error) {
                    const messages = {
                        'no-backup': 'لا توجد نسخة احتياطية لهذا السيرفر.',
                        'no-guild': 'تعذر الوصول للسيرفر.',
                        'empty-backup': 'النسخة الاحتياطية فارغة.'
                    };
                    return interaction.editReply({
                        content: `❌ ${messages[result.error] || result.error}`,
                        embeds: [],
                        components: []
                    });
                }

                console.log(
                    `[BACKUP] استرجاع ${interaction.guild.id} بواسطة <@${interaction.user.id}> | نسخة=${backupId} رومات↺=${result.restoredChannels.length} رتب↺=${result.restoredRoles.length} deleted=${result.deletedChannels}/${result.deletedRoles}`
                );

                await sendLog(
                    interaction.guild,
                    'moderation',
                    '♻️ Restore Completed',
                    `تم استرجاع السيرفر بواسطة المالك <@${interaction.user.id}>.\n` +
                    `🔄 قنوات معاد إنشاؤها: **${result.restoredChannels.length}**\n` +
                    `🔄 رتب معاد إنشاؤها: **${result.restoredRoles.length}**\n` +
                    `🔄 إيموجي معاد: **${result.restoredEmojis || 0}**\n` +
                    `🔄 ستيكرات معادة: **${result.restoredStickers || 0}**\n` +
                    `🛡️ إعدادات الحماية: **${result.protectionsApplied ? 'تم استرجاعها' : 'لا إعدادات في النسخة'}**\n` +
                    `🗑️ قنوات زائدة حُذفت: **${result.deletedChannels}**\n` +
                    `🗑️ رتب زائدة حُذفت: **${result.deletedRoles}**`
                );

                return interaction.editReply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('♻️ Restore Completed')
                            .setDescription(
                                'تم استرجاع السيرفر من النسخة الاحتياطية.\n' +
                                'تم إعادة إنشاء المفقود وحذف كل ما أضافه المخترق.\n' +
                                '🛡️ الرومات المحمية ما تأثرت.'
                            )
                            .setColor(0x57F287)
                            .addFields(
                                {
                                    name: '🔄 قنوات معاد إنشاؤها',
                                    value: String(result.restoredChannels.length),
                                    inline: true
                                },
                                {
                                    name: '🔄 رتب معاد إنشاؤها',
                                    value: String(result.restoredRoles.length),
                                    inline: true
                                },
                                {
                                    name: '🔄 إيموجي معاد',
                                    value: String(result.restoredEmojis || 0),
                                    inline: true
                                },
                                {
                                    name: '🔄 ستيكرات معادة',
                                    value: String(result.restoredStickers || 0),
                                    inline: true
                                },
                                {
                                    name: '🗑️ قنوات زائدة حُذفت',
                                    value: String(result.deletedChannels),
                                    inline: true
                                },
                                {
                                    name: '🗑️ رتب زائدة حُذفت',
                                    value: String(result.deletedRoles),
                                    inline: true
                                }
                            )
                    ],
                    components: []
                });
            }

            if (interaction.customId === 'restore_cancel') {
                return interaction.update({
                    content: '✅ تم إلغاء الاسترجاع.',
                    embeds: [],
                    components: []
                });
            }


            // أزرار السحوبات
            if (await giveaways.handleButton(interaction)) return;


            // أزرار القفل
            if (await puzzle.handleButton(interaction)) return;


            // أزرار الرومات الصوتية المؤقتة
            if (await tempvoice.handleButton(interaction)) return;


            // أزرار الفيدباك
            if (await feedback.handleButton(interaction)) return;


            // أزرار التكت: فتح / إغلاق / استلام / إضافة شخص / طرد شخص / عرض الأشخاص
            // ما تحتاج رتبة — كل عضو يقدر يفتح تكت
            if (await tickets.handleButton(interaction)) return;

        }


        // ==================================================
        // MODALS
        // ==================================================

        if (interaction.isModalSubmit()) {

            // 🎫 موديلات التكت أولاً وبالشرط ذاتها (الأزرار تتحقق منها):
            // صاحب التكت العادي لازم يقدر يضيف/يطرد ناس من تكتّه
            // بدون ما يكون أدمن. فلازم تسبق فحص isAdmin اللي تحت.
            if (await tickets.handleModal(interaction)) return;

            // مودال القفل (متاح للجميع)
            if (await puzzle.handleModal(interaction)) return;

            // مودالات الرومات الصوتية المؤقتة (لصاحب الروم)
            if (await tempvoice.handleModal(interaction)) return;

            // مودالات الفيدباك (إرسال للجميع / رد للمشرفين)
            if (await feedback.handleModal(interaction)) return;

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

                const permission =
                    interaction.fields
                        .getTextInputValue('permission')
                        .trim()
                        .toLowerCase();

                item.staffOnly =
                    permission === 'staff';

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
                        `**${index + 1}.** ${item.staffOnly ? '🔒' : '🌐'} \`${item.trigger}\` → ${item.response}`
                )
                .join('\n') +
            `\n\n🔒 رتبة ${STAFF_ROLE_NAME} فقط | 🌐 أي عضو يستجيب`
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

        // تسجيل كل دخول حديث (بشر + بوتات) كمرشح مراقبة —
        // عند الفيضان بدون مسبب مشخص نقفل عليهم/نبندهم
        addSuspectedBot(member.guild.id, member.id);

        // ==============================================
        // حماية دخول البوتات
        // ==============================================

        if (member.user.bot) {

            ensureProtections(settings);

            const botProt = settings.protections.bots;

            if (botProt.enabled) {

                console.log(
                    `[PROTECT] BotAdd ${member.guild.id} | bot=${member.user.tag} | enabled=true`
                );

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

                    console.log(
                        `[PROTECT] BotAdd ${member.guild.id} | مضيف مجهول → طرد البوت ${member.user.tag}`
                    );

                    await member.kick('[Anti-Nuke] تعذر التحقق من مسبب دخول البوت').catch(() => {});
                    await sendLog(
                        member.guild,
                        'moderation',
                        '🤖 Bot Blocked',
                        `البوت **${member.user.tag}** طُرد لتعذر التحقق من المسبب.\nالمسبب: غير معروف`
                    );
                    return;
                }

                // ✅ المالك / الوايت ليست / مالك البوت: أي بوت يضيفونه يدخل بدون طرد مهما كانت رتبتهم
                const botWhitelist = Array.isArray(settings.whitelist)
                    ? settings.whitelist
                    : [];

                if (
                    inviter.id === member.guild.ownerId ||
                    inviter.id === OWNER_ID ||
                    botWhitelist.includes(inviter.id)
                ) {
                    await sendLog(
                        member.guild,
                        'moderation',
                        '🤖 Bot Allowed',
                        `البوت **${member.user.tag}** دخل السيرفر.\n` +
                        `المسبب: <@${inviter.id}> (معتمد ${inviter.id === member.guild.ownerId ? 'المالك' : inviter.id === OWNER_ID ? 'مالك البوت' : 'القائمة البيضاء'})`
                    );
                    return;
                }

                const inviterPos = inviter.roles.highest.position;
                const refPos = refRole.position;

                // ==============================================
                // حد عدد البوتات المنضمة في وقت قصير
                // (الحد والعقوبة يحددهما صاحب السيرفر من الداشبورد)
                // ==============================================
                const joinLimit = metricLimit(botProt, 'bots', 'joins', 3);

                if (isNukeFlood(protectionFloods.botJoins, member.guild.id, joinLimit)) {
                    const joinAction = metricAction(botProt, 'bots', 'joins', 'ban');

                    await member.ban(
                        `[Anti-Nuke] فيضان دخول بوتات (أكثر من ${joinLimit})`
                    ).catch(() => {});

                    await punishFor(
                        member.guild,
                        inviter,
                        inviter.id,
                        joinAction,
                        `مسبب فيضان دخول بوتات (${joinLimit})`
                    );

                    await sendLog(
                        member.guild,
                        'moderation',
                        '🤖 Bot Join Flood',
                        `فيضان دخول بوتات (**${joinLimit}** خلال 8 ثوانٍ).\n` +
                        `البوت **${member.user.tag}** حُظر.\n` +
                        `المسبب: <@${inviter.id}>\n` +
                        `العقوبة: **${joinAction}**`
                    );

                    return;
                }

                if (inviterPos < refPos) {

                    // رتبة المسبب تحت رتبة البوت: نطرد/نبند البوت المضافة والمسبب معاً
                    let botRemoved = false;

                    console.log(
                        `[PROTECT] BotAdd ${member.guild.id} | المضيف <@${inviter.id}> تحت البوت → حظر ${member.user.tag}`
                    );

                    try {
                        await member.ban('[Anti-Nuke] دخول بوت غير مصرّح');
                        botRemoved = true;
                    } catch {
                        botRemoved = await member.kick(
                            '[Anti-Nuke] دخول بوت غير مصرّح'
                        ).then(() => true).catch(() => false);
                    }

                    await punishFor(
                        member.guild,
                        inviter,
                        inviter.id,
                        'ban',
                        'مسبب دخول بوت غير مصرّح'
                    );

                    await sendLog(
                        member.guild,
                        'moderation',
                        botRemoved ? '🤖 Bot Banned' : '🤖 Bot Removal Failed',
                        `البوت **${member.user.tag}** ${botRemoved ? 'حُظر لأنه' : 'تعذر حذفه رغم أنه'} دخول غير مصرّح.\n` +
                        `المسبب: <@${inviter.id}> (تحت رتبة البوت ${refRole})\n` +
                        (botRemoved ? '' : '⚠️ البوت بقي في السيرفر — افحص رتب البوتات المرتفعة أو صلاحيات البوت.')
                    );
                    return;
                }

                if (inviterPos === refPos) {

                    // بنفس رتبة البوت: البوت لا يقدر يدخل ويُطرد
                    const kicked =
                        await member.kick('[Anti-Nuke] دخول بوت غير مصرّح')
                            .then(() => true)
                            .catch(() => false);

                    await sendLog(
                        member.guild,
                        'moderation',
                        kicked ? '🤖 Bot Kicked' : '🤖 Bot Removal Failed',
                        `البوت **${member.user.tag}** ${kicked ? 'طُرد لأنه' : 'تعذر طرده رغم أنه'} دخول غير مصرّح.\n` +
                        `المسبب: <@${inviter.id}> (بنفس رتبة البوت ${refRole})\n` +
                        (kicked ? '' : '⚠️ البوت بقي في السيرفر — رتبه أعلى أو مساوية لرتبة البوت.')
                    );
                    return;
                }

                // فوق رتبة البوت لكنه ليس المالك/الوايت ليست → لا يمر
                    const nokicked =
                        await member.kick('[Anti-Nuke] إضافة بوت من غير المالك/الوايت ليست')
                            .then(() => true)
                            .catch(() => false);

                    console.log(
                        `[PROTECT] BotAdd kick(non-owner) ${member.guild.id} | البوت=${member.user.tag} | المضيف=<@${inviter.id}> | طرد=${nokicked}`
                    );

                    await sendLog(
                        member.guild,
                        'moderation',
                        nokicked ? '🤖 Bot Kicked' : '🤖 Bot Removal Failed',
                        `البوت **${member.user.tag}** ${nokicked ? 'طُرد لأنه' : 'تعذر طرده رغم أنه'} أُضيف من غير المالك/الوايت ليست.\n` +
                        `المسبب: <@${inviter.id}> (فوق رتبة البوت لكنه غير موثوق)\n` +
                        (nokicked ? '' : '⚠️ رتبة البوت المضافة تعادل/تعلو رتبة بوت الحماية.')
                    );
                    return;
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

            const customImage = settings.welcome.image;

            if (customImage) {

                // ⚠️ كان يفرض اسم welcome-image.png على أي صورة —
                // صور jpg/gif كانت تنكسر أو تتحوّل لصور مكسورة.
                // الحين نطلع الامتداد الصحيح من لينك الصورة نفسها.
                await channel.send({
                    content: text,
                    files: [{
                        attachment: customImage,
                        name: imageFileName(customImage, 'welcome-image.png')
                    }]
                });

            } else if (settings.welcome.cardEnabled !== false) {

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
// INVITE PROTECTION (حماية اختصار السيرفر)
// ======================================================

// إرسال إشعار خاص لمالك السيرفر
async function notifyInviteOwner(guild, executorId, restoredCode, punished, punishmentLabel = '🔨 Ban') {
    try {
        const owner = await guild.fetchOwner();

        await owner.send(
            `⚠️ **تنبيه حماية** — تغيّر اختصار سيرفرك **${guild.name}**!\n\n` +
            `المسبب: <@${executorId}>\n` +
            (restoredCode
                ? `✅ تم إنشاء اختصار بديل: **discord.gg/${restoredCode}**`
                : '⚠️ تعذر إعادة إنشاء اختصار بديل (تحقق من صلاحيات البوت).') +
            '\n' +
            (punished
                ? `🔨 المسبب **تم معاقبته** (${punishmentLabel}).`
                : '⚠️ **ديسكورد ما سمح** بمعاقبة المسبب (رتبة المالك أو صلاحيات البوت ناقصة).'
            )
        ).catch(() => {});
    } catch (error) {
        console.error('Invite owner DM error:', error);
    }
}

client.on('inviteDelete', async invite => {

    try {

        if (!invite.guild) return;

        const guild = invite.guild;
        const settings = await getSettings(guild.id);
        ensureProtections(settings);
        const prot = settings.protections.invites;

        if (!prot || !prot.enabled || !prot.code) return;
        if (invite.code !== prot.code) return;

        const executorId = await getAuditExecutor(
            guild,
            AuditLogEvent.InviteDelete,
            invite.code
        );

        if (!executorId || executorId === client.user.id) return;

        const member = await getMember(guild, executorId);

        // ==============================
        // ⛔ ممنوع أي تجاوز — الحد صفر
        // ما نراعي الوايت ليست ولا رتبة الفاعل: أول ما ينشال
        // الاختصار ينزل العقوبة فوراً على اللي شالله
        // الاستثناء الوحيد: راعي البوت (عشان ما نخسر السيرفر)
        // ==============================
        if (isBotOwner(executorId)) {
            await sendLog(
                guild,
                'protection',
                '🛡️ Invite Deleted (راعي البوت)',
                `<@${executorId}> (راعي البوت) حذف الاختصار **discord.gg/${invite.code}**.\n` +
                `مستثنى من العقوبة ✅`
            );
            return;
        }

        // ==============================
        // العقوبة فوراً (أول حذف)
        // ==============================
        const redirectAction = metricAction(prot, 'invites', 'redirect', 'ban');

        const result = await punishInviteOffender(
            guild,
            member,
            executorId,
            redirectAction,
            `حذف اختصار السيرفر المحمي (${invite.code}) — ممنوع التجاوز`
        );

        const punished = !!result.done;
        const punishmentLabel = result.label;

        console.log(
            `[PROTECT] inviteDelete executor=${executorId} ` +
            `action=${redirectAction} done=${punished}`
        );

        // ==============================
        // محاولة إعادة إنشاء اختصار بديل
        // ==============================
        let restoredCode = null;

        const targetChannelId = prot.channelId || invite.channel?.id || null;

        if (targetChannelId) {
            const targetChannel = guild.channels.cache.get(targetChannelId);

            if (targetChannel && targetChannel.isTextBased()) {
                const restored = await targetChannel.createInvite({
                    maxAge: 0,
                    maxUses: 0,
                    reason: '[Anti-Nuke] استرجاع اختصار السيرفر'
                }).catch(() => null);

                if (restored) {
                    restoredCode = restored.code;
                    // حماية الاختصار الجديد بدل المحذوف
                    prot.code = restored.code;
                    prot.channelId = restored.channel?.id || targetChannelId;
                    await settings.save().catch(() => {});
                }
            }
        }

        // ==============================
        // لوق الحماية + إشعار المالك
        // ==============================
        await sendLog(
            guild,
            'protection',
            '🛡️ Invite Protection',
            `<@${executorId}> حذف اختصار السيرفر **discord.gg/${invite.code}**.\n` +
            `⛔ **ممنوع التجاوز** — ما استثنينا أحد (ولا الوايت ليست)\n` +
            (restoredCode
                ? `✅ تم إنشاء اختصار بديل: **discord.gg/${restoredCode}**`
                : '⚠️ تعذر إعادة إنشاء اختصار بديل (صلاحيات البوت؟)') +
            (punished
                ? `\n🔨 العقوبة: **${punishmentLabel}**`
                : '\n⚠️ ديسكورد ما سمح بمعاقبة المسبب (رتبة المالك أو صلاحيات البوت ناقصة).')
        );

        await notifyInviteOwner(guild, executorId, restoredCode, punished, punishmentLabel);

    } catch (error) {
        console.error('Invite protection error:', error);
    }
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

    const guild = role.guild;

    noteStructuralChange(guild.id);

    // ==============================================
    // 1) الحماية: كشف الفيضان والرد عليه فوراً
    // ==============================================

    const { prot, cached } = await getProtectionConfig(guild.id, 'roles');

    console.log(
        `[PROTECT] roleCreate ${guild.id} | enabled=${prot?.enabled} | floodCheck...`
    );

    if (prot && prot.enabled) {

        const limit = metricLimit(prot, 'roles', 'create', 5);
        let floodLocked = false;

        try {
            floodLocked = isNukeFlood(
                protectionFloods.roles,
                guild.id,
                limit
            );
        } catch {}

        console.log(
            `[PROTECT] roleCreate ${guild.id} | flood=${floodLocked} | limit=${limit}`
        );

        // حذف فوري — بدون انتظار أي استعلام
        if (floodLocked) {
            await role.delete('[Anti-Nuke] فيضان إنشاء رتب')
                .catch(err => console.error(
                    `[PROTECT] فشل حذف الرتبة ${role.id}: ${err.message}`
                ));
            console.log(`[PROTECT] roleCreate تم حذف الرتبة ${role.id} (فيضان)`);
        }

        // تحديد الفاعل وتطبيق العقوبة (بعد الحذف الفوري)
        try {
            const executorId = await resolveAbuseExecutor(
                guild,
                AuditLogEvent.RoleCreate,
                role.id
            );

            if (executorId && executorId !== client.user.id) {

                // سجّل الرتبة كإبداع لهذا الفاعل لكي نمسحها كلها عند العقوبة
                trackCreatedItem(
                    createdByActor.roles,
                    guild.id,
                    executorId,
                    role.id
                );

                const member = await getMember(guild, executorId);
                const check = await protectionAllowed(guild, member, {
                    whitelist: cached?.whitelist || []
                });

                let punished = false;

                if (!check.allowed) {

                    const key = `${guild.id}-${executorId}`;

                    const exceeded =
                        floodLocked ||
                        countExceeded(
                            protectionCounts.roles,
                            key,
                            limit
                        );

                    if (exceeded) {

                        clearCount(protectionCounts.roles, key);

                        // حذف كل الرتب اللي سواها الفاعل (حتى في الحركة البطيئة)
                        const removed = await removeCreatedByActor(
                            createdByActor.roles,
                            guild,
                            executorId,
                            role
                        );

                        if (
                            check.allowed === false
                        ) {
                            const createAction = metricAction(prot, 'roles', 'create', 'ban');
                            const punishedNow = await punishFor(
                                guild,
                                member,
                                executorId,
                                createAction,
                                floodLocked
                                    ? `فيضان إنشاء رتب (أكثر من ${limit})`
                                    : `تجاوز حد إنشاء الرتب (${limit})`
                            );
                            if (punishedNow) punished = true;
                            console.log(
                                `[PROTECT] عقوبة ${createAction} على ${executorId} | حذف ${removed} رتبة (${guild.id}) — نجحت=${punishedNow}`
                            );
                        } else {
                            console.log(
                                `[PROTECT] تم التخطي: المستوى ${check.level} ` +
                                `للمخالف ${executorId} — لا عقوبة (Discord يمنع)`
                            );
                        }
                    }
                }

                await sendLog(
                    guild,
                    'moderation',
                    '🛡️ Role Protection',
                    `<@${executorId}> ${floodLocked ?
                        'يعمل فيضان إنشاء رتب' :
                        `تجاوز حد إنشاء الرتب (**${limit}**)`}.\n` +
                    (floodLocked
                        ? 'تم حذف الرتب المنشأة فورياً.'
                        : `تم حذف الرتب.${!check.allowed ? `\nالعقوبة: **${prot.action || 'ban'}**` : ''}`) +
                    (punished
                        ? `\n✅ تم تطبيق العقوبة على ${executorId}.`
                        : check.allowed === false
                            ? `\n(تمت محاولة العقوبة — تأكد من صلاحية البوت)`
                            : '')
                );
            } else if (floodLocked) {
                await sendLog(
                    guild,
                    'moderation',
                    '🛡️ Role Flood Detected',
                    'فيضان إنشاء رتب — تم حذف الرتبة المنشأة فورياً.\n' +
                    'المسبب غير مشخص (تأكد من صلاحية **View Audit Log**).'
                );
            }
        } catch (error) {
            console.error('Role protection punish error:', error);
        }
    }

    // ==============================================
    // 2) سجل الإنشاء
    // ==============================================

    const executor = await executorMention(
        guild,
        AuditLogEvent.RoleCreate,
        role.id
    );

    await sendLog(
        guild,
        'role',
        '🎭 Role Created',
        `تم إنشاء الرتبة ${role}.\n` +
        `المسبب: ${executor}`
    );
});

client.on('roleDelete', async role => {

    noteStructuralChange(role.guild.id);

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

    // حماية حذف الرتب
    try {

        const guild = role.guild;
        const { prot, cached } = await getProtectionConfig(guild.id, 'roles');

        if (prot && prot.enabled) {

            const limit = metricLimit(prot, 'roles', 'delete', 5);

            const executorId = await resolveAbuseExecutor(
                guild,
                AuditLogEvent.RoleDelete,
                role.id
            );

            // حذف البوت لنفسه (تنظيف إبداعات/استرجاع) لا يتم عده ولا معاقبته
            if (!executorId || executorId === client.user.id) {
                console.log(
                    `[PROTECT] roleDelete ${guild.id} | سببه البوت نفسه أو غير مشخص — تم التجاهل لتجنب الفيضان الكاذب`
                );
                return;
            }

            let floodLocked = false;

            try {
                floodLocked = isNukeFlood(
                    protectionFloods.roleDeletes,
                    guild.id,
                    limit
                );
            } catch {}

            console.log(
                `[PROTECT] roleDelete ${guild.id} | executor=${executorId} | flood=${floodLocked} | limit=${limit}`
            );

            if (executorId && executorId !== client.user.id) {

                const member = await getMember(guild, executorId);
                const check = await protectionAllowed(guild, member, {
                    whitelist: cached?.whitelist || []
                });

                if (!check.allowed) {

                    const key = `${guild.id}-${executorId}`;

                    const exceeded =
                        floodLocked ||
                        countExceeded(
                            protectionCounts.roles,
                            key,
                            Math.max(Math.round(limit / 2), 1)
                        );

                    console.log(
                        `[PROTECT] roleDelete executor=${executorId} ` +
                        `level=${check.level} exceeded=${exceeded} ` +
                        `flood=${floodLocked} action=${prot.action || 'ban'}`
                    );

                    if (exceeded) {

                        clearCount(protectionCounts.roles, key);

                        let punished = false;

                        if (
                            check.allowed === false
                        ) {
                            const deleteAction = metricAction(prot, 'roles', 'delete', 'ban');
                            punished = await punishFor(
                                guild,
                                member,
                                executorId,
                                deleteAction,
                                floodLocked
                                    ? `فيضان حذف رتب (أكثر من ${limit})`
                                    : `حذف رتب غير مصرّح (نوك)`
                            );
                            console.log(
                                `[PROTECT] عقوبة ${deleteAction} على ${executorId} ` +
                                `للفيضان/حذف رتب (${guild.id}) — نجحت=${punished}`
                            );
                        } else {
                            console.log(
                                `[PROTECT] تم التخطي: المستوى ${check.level} ` +
                                `للمخالف ${executorId} — لا عقوبة (Discord يمنع)`
                            );
                        }

                        await sendLog(
                            guild,
                            'moderation',
                            '🛡️ Role Deletion Protection',
                            `<@${executorId}> ${floodLocked ?
                                'يعمل فيضان حذف رتب' :
                                'حذف رتب بدون إذن'}.\n` +
                            `المستوى: **${check.level === 'equal' ? 'بنفس رتبة البوت' : check.level === 'above' ? 'أعلى من رتبة البوت' : 'تحت رتبة البوت'}**\n` +
                            (check.allowed === false
                                ? punished
                                    ? `✅ العقوبة: **${prot.action || 'ban'}** تم تنفيذها`
                                    : `❌ العقوبة: **${prot.action || 'ban'}** فشلت — ` +
                                      (member?.id === guild.ownerId
                                          ? 'الهدف هو مالك السيرفر (لا يمكن بنده)'
                                          : 'تحقق من صلاحيات البوت/رتب الرتب')
                                : 'نفس/أعلى رتبة البوت — تم التسجيل فقط')
                        );
                    }
                }
            } else if (floodLocked) {
                console.log(
                    `[PROTECT] فيضان حذف رتب ${guild.id} — المسبب غير مشخص`
                );

                await sendLog(
                    guild,
                    'moderation',
                    '🛡️ Role Deletion Flood',
                    'فيضان حذف رتب — المسبب غير مشخص.\n' +
                    'تأكد من صلاحية **View Audit Log**.'
                );
            }
        }
    } catch (error) {
        console.error('Role deletion protection error:', error);
    }

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
                        await protectionAllowed(newRole.guild, member, settings);

                    if (!check.allowed) {

                        // إرجاع الاسم الأصلي
                        await newRole.setName(
                            oldRole.name,
                            '[Anti-Nuke] استرجاع اسم الرتبة'
                        ).catch(() => {});

                        const key = `${newRole.guild.id}-${executorId}`;
                        const updateLimit = metricLimit(prot, 'roles', 'update', 20);
                        const updateAction = metricAction(prot, 'roles', 'update', 'ban');

                        if (countExceeded(
                            protectionCounts.roleUpdates,
                            key,
                            updateLimit
                        )) {

                            if (check.allowed === false) {
                                await applyPunishment(
                                    member,
                                    updateAction,
                                    `تعديل اسم رتبة (${updateLimit})`
                                );
                            }

                            clearCount(protectionCounts.roleUpdates, key);

                            await sendLog(
                                newRole.guild,
                                'moderation',
                                '🛡️ Role Name Protection',
                                `<@${executorId}> حاول تعديل اسم الرتبة **${oldRole.name}**.\n` +
                                `تم إرجاع الاسم${check.allowed === false ? `\nالعقوبة: **${updateAction}**` : ''}`
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

    const guild = channel.guild;

    noteStructuralChange(guild.id);

    // تحديث اللقطة بالروم الجديد (قبل الفيضان) — حتى يظهر في الاسترجاع
    captureSingleChannel(channel);

    // ==============================================
    // 1) الحماية: كشف الفيضان والرد عليه فوراً
    // (محددوا سجل التدقيق زيادة — الفيضان يُحذف لحظياً)
    // ==============================================

    const { prot, cached } = await getProtectionConfig(guild.id, 'channels');

    console.log(
        `[PROTECT] channelCreate ${guild.id} | enabled=${prot?.enabled} | floodCheck...`
    );

    if (prot && prot.enabled) {

        const limit = metricLimit(prot, 'channels', 'create', 5);
        let floodLocked = false;

        try {
            floodLocked = isNukeFlood(
                protectionFloods.channels,
                guild.id,
                limit
            );
        } catch {}

        console.log(
            `[PROTECT] channelCreate ${guild.id} | flood=${floodLocked} | limit=${limit}`
        );

        // حذف فوري — بدون انتظار أي استعلام
        if (floodLocked) {
            await channel.delete('[Anti-Nuke] فيضان إنشاء رومات')
                .catch(err => console.error(
                    `[PROTECT] فشل حذف الروم ${channel.id}: ${err.message}`
                ));
            console.log(`[PROTECT] channelCreate تم حذف الروم ${channel.id} (فيضان)`);
        }

        // تحديد الفاعل وتطبيق العقوبة (بعد الحذف الفوري، بدون تعطيله)
        try {
            const executorId = await resolveAbuseExecutor(
                guild,
                AuditLogEvent.ChannelCreate,
                channel.id
            );

            if (executorId && executorId !== client.user.id) {

                // سجّل الروم كإبداع لهذا الفاعل لكي نمسحها كلها عند العقوبة
                trackCreatedItem(
                    createdByActor.channels,
                    guild.id,
                    executorId,
                    channel.id
                );

                const member = await getMember(guild, executorId);
                const check = await protectionAllowed(guild, member, {
                    whitelist: cached?.whitelist || []
                });

                let punished = false;

                if (!check.allowed) {

                    const key = `${guild.id}-${executorId}`;

                    const exceeded =
                        floodLocked ||
                        countExceeded(
                            protectionCounts.channels,
                            key,
                            limit
                        );

                    if (exceeded) {

                        clearCount(protectionCounts.channels, key);

                        const createAction = metricAction(prot, 'channels', 'create', 'ban');
                        const exceedReason = floodLocked
                            ? `فيضان إنشاء رومات (أكثر من ${limit})`
                            : `تجاوز حد إنشاء الرومات (${limit})`;

                        let removed = 0;

                        if (member?.user?.bot) {
                            // ⚖️ تسلسل البوت المخالف: (1) الباند أولاً
                            //    (2) ثم مسح الرومات/الرتب/الويب هوك — أين ما كانت
                            const res = await punishBotExceeder(
                                guild, member, executorId, exceedReason, channel, null
                            );

                            if (res) {
                                punished = res.banned;
                                removed = res.removed;
                            }
                        } else {
                            // حذف كل الرومات اللي سواها الفاعل (حتى في الحركة البطيئة)
                            removed = await removeCreatedByActor(
                                createdByActor.channels,
                                guild,
                                executorId,
                                channel
                            );

                            if (check.allowed === false) {
                                const punishedNow = await punishFor(
                                    guild,
                                    member,
                                    executorId,
                                    createAction,
                                    exceedReason
                                );
                                if (punishedNow) punished = true;
                                console.log(
                                    `[PROTECT] عقوبة ${createAction} على ${executorId} | حذف ${removed} روم (${guild.id}) — نجحت=${punishedNow}`
                                );
                            } else {
                                console.log(
                                    `[PROTECT] المسبب ${executorId} منع العقوبة: المستوى=${check.level} (فوق/بنفس رتبة البوت — الديسكورد يمنع الباند على الأصاغر)`
                                );
                            }
                        }
                    }
                }

                await sendLog(
                    guild,
                    'moderation',
                    '🛡️ Channel Protection',
                    `<@${executorId}> ${floodLocked ?
                        'يعمل فيضان إنشاء رومات' :
                        `تجاوز حد إنشاء الرومات (**${limit}**)`}.\n` +
                    (floodLocked
                        ? 'تم حذف الروم المنشأ فورياً.'
                        : `تم حذف الروم.${!check.allowed ? `\nالعقوبة: **${metricAction(prot, 'channels', 'create', 'ban')}**` : ''}`) +
                    (punished
                        ? `\n✅ تم تطبيق العقوبة على ${executorId} (باند أولاً ثم المسح).`
                        : check.allowed === false
                            ? `\n(تمت محاولة العقوبة — تأكد من صلاحية البوت فوق المخرب)`
                            : '')
                );
            } else if (floodLocked) {
                await sendLog(
                    guild,
                    'moderation',
                    '🛡️ Channel Flood Detected',
                    'فيضان إنشاء رومات — تم حذف الروم المنشأ فورياً.\n' +
                    'المسبب غير مشخص (تأكد من صلاحية **View Audit Log**).'
                );
            }
        } catch (error) {
            console.error('Channel protection punish error:', error);
        }
    }

    // ==============================================
    // 2) سجل الإنشاء
    // ==============================================

    const executor = await executorMention(
        guild,
        AuditLogEvent.ChannelCreate,
        channel.id
    );

    await sendLog(
        guild,
        'channel',
        '📁 Channel Created',
        `تم إنشاء ${channel}.\n` +
        `المسبب: ${executor}`
    );
});

client.on('channelDelete', async channel => {

    if (!channel.guild) return;

    noteStructuralChange(channel.guild.id);

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

    // حماية حذف الرومات
    try {

        const guild = channel.guild;
        const { prot, cached } = await getProtectionConfig(guild.id, 'channels');

        if (prot && prot.enabled) {

            const limit = metricLimit(prot, 'channels', 'delete', 5);

            const executorId = await resolveAbuseExecutor(
                guild,
                AuditLogEvent.ChannelDelete,
                channel.id
            );

            // حذف البوت لنفسه (تنظيف إبداعات/استرجاع) لا يتم عده ولا معاقبته
            if (!executorId || executorId === client.user.id) {
                console.log(
                    `[PROTECT] channelDelete ${guild.id} | سببه البوت نفسه أو غير مشخص — تم التجاهل لتجنب الفيضان الكاذب`
                );
                return;
            }

            let floodLocked = false;

            try {
                floodLocked = isNukeFlood(
                    protectionFloods.channelDeletes,
                    guild.id,
                    limit
                );
            } catch {}

            console.log(
                `[PROTECT] channelDelete ${guild.id} | executor=${executorId} | flood=${floodLocked} | limit=${limit}`
            );

            // بدون استرجاع تلقائي — الاسترجاع يدوياً عبر سلاش /restore
            if (floodLocked) {
                console.log(
                    `[PROTECT] فيضان حذف رومات ${guild.id} — سيتم عقاب المسبب <@${executorId}> فوراً`
                );
            }

            if (executorId && executorId !== client.user.id) {

                const member = await getMember(guild, executorId);
                const check = await protectionAllowed(guild, member, {
                    whitelist: cached?.whitelist || []
                });

                if (!check.allowed) {

                    const key = `${guild.id}-${executorId}`;

                    const exceeded =
                        floodLocked ||
                        countExceeded(
                            protectionCounts.channels,
                            key,
                            Math.max(Math.round(limit / 2), 1)
                        );

                    console.log(
                        `[PROTECT] channelDelete executor=${executorId} ` +
                        `level=${check.level} exceeded=${exceeded} ` +
                        `flood=${floodLocked} action=${metricAction(prot, 'channels', 'delete', 'ban')}`
                    );

                    if (exceeded) {

                        clearCount(protectionCounts.channels, key);

                        let punished = false;

                        if (
                            check.allowed === false
                        ) {
                            const deleteAction = metricAction(prot, 'channels', 'delete', 'ban');
                            punished = await punishFor(
                                guild,
                                member,
                                executorId,
                                deleteAction,
                                floodLocked
                                    ? `فيضان حذف رومات (أكثر من ${limit})`
                                    : `حذف رومات غير مصرّح (نوك)`
                            );
                            console.log(
                                `[PROTECT] عقوبة ${deleteAction} على ${executorId} ` +
                                `للفيضان/حذف رومات (${guild.id}) — نجحت=${punished}`
                            );

                            if (!punished && executorId === guild.ownerId) {
                                console.warn(
                                    `[PROTECT] ${executorId} هو مالك السيرفر — ` +
                                    `الديسكورد يمنع بند المالك، لاحظ أن الحماية لا تشمل مالك السيرفر`
                                );
                            }
                        } else {
                            console.log(
                                `[PROTECT] تم التخطي: المستوى ${check.level} ` +
                                `للمخالف ${executorId} — لا عقوبة (Discord يمنع)`
                            );
                        }

                        await sendLog(
                            guild,
                            'moderation',
                            '🛡️ Channel Deletion Protection',
                            `<@${executorId}> ${floodLocked ?
                                'يعمل فيضان حذف رومات' :
                                'حذف رومات بدون إذن'}.\n` +
                            `المستوى: **${check.level === 'equal' ? 'بنفس رتبة البوت' : check.level === 'above' ? 'أعلى من رتبة البوت' : 'تحت رتبة البوت'}**\n` +
                            (check.allowed === false
                                ? punished
                                    ? `✅ العقوبة: **${deleteAction}** تم تنفيذها`
                                    : `❌ العقوبة: **${deleteAction}** فشلت — ` +
                                      (member?.id === guild.ownerId
                                          ? 'الهدف هو مالك السيرفر (لا يمكن بنده)'
                                          : 'تحقق من صلاحيات البوت/رتب الرتب')
                                : 'نفس/أعلى رتبة البوت — تم التسجيل فقط')
                        );
                    }
                }
            } else if (floodLocked) {
                console.log(
                    `[PROTECT] فيضان حذف رومات ${guild.id} — المسبب غير مشخص`
                );

                await sendLog(
                    guild,
                    'moderation',
                    '🛡️ Channel Deletion Flood',
                    'فيضان حذف رومات — المسبب غير مشخص.\n' +
                    'تأكد من صلاحية **View Audit Log**.'
                );
            }
        }
    } catch (error) {
        console.error('Channel deletion protection error:', error);
    }

});

client.on('channelUpdate', async (oldChannel, newChannel) => {

    if (!newChannel.guild) return;

    // تحديث اللقطة بأي تغيير (اسم/صلاحيات/والد) — للاسترجاع لاحقاً
    captureSingleChannel(newChannel);

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
                        await protectionAllowed(newChannel.guild, member, settings);

                    if (!check.allowed) {

                        // إرجاع الاسم الأصلي
                        await newChannel.setName(
                            oldChannel.name,
                            '[Anti-Nuke] استرجاع اسم الروم'
                        ).catch(() => {});

                        const key = `${newChannel.guild.id}-${executorId}`;
                        const updateLimit = metricLimit(prot, 'channels', 'update', 20);
                        const updateAction = metricAction(prot, 'channels', 'update', 'ban');

                        if (countExceeded(
                            protectionCounts.channelUpdates,
                            key,
                            updateLimit
                        )) {

                            if (check.allowed === false) {
                                await applyPunishment(
                                    member,
                                    updateAction,
                                    `تعديل اسم روم (${updateLimit})`
                                );
                            }

                            clearCount(protectionCounts.channelUpdates, key);

                            await sendLog(
                                newChannel.guild,
                                'moderation',
                                '🛡️ Channel Name Protection',
                                `<@${executorId}> حاول تعديل اسم الروم **${oldChannel.name}**.\n` +
                                `تم إرجاع الاسم${check.allowed === false ? `\nالعقوبة: **${updateAction}**` : ''}`
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

    const media = describeMessageMedia(message);

    const lines = [
        `👤 العضو: ${message.author ? `<@${message.author.id}> (${message.author.tag || message.author.username})` : 'غير معروف'}`,
        `📁 الروم: ${message.channel || 'غير معروف'}`
    ];

    if (message.content) {
        lines.push(`💬 المحتوى:\n${message.content.slice(0, 1000)}`);
    }
    if (media) lines.push(media);
    if (!message.content && !media) {
        lines.push('💬 المحتوى: غير متوفر (رسالة غير محفوظة بالمخزن)');
    }
    lines.push(`🗑️ المسبب: ${executor}`);

    await sendLog(
        message.guild,
        'message',
        '🗑️ حذف رسالة',
        lines.join('\n'),
        undefined,
        {
            thumbnail: message.author?.displayAvatarURL?.({ size: 128 }) || undefined,
            image: firstImageUrl(message) || undefined
        }
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

        const contentChanged = oldMessage.content !== newMessage.content;
        const mediaChanged =
            (oldMessage.attachments?.size || 0) !== (newMessage.attachments?.size || 0) ||
            (oldMessage.stickers?.size || 0) !== (newMessage.stickers?.size || 0);

        if (!contentChanged && !mediaChanged) return;

        const executor = await executorMention(
            oldMessage.guild,
            AuditLogEvent.MessageUpdate,
            oldMessage.id
        );

        const media = describeMessageMedia(newMessage);

        const lines = [
            `👤 العضو: ${oldMessage.author ? `<@${oldMessage.author.id}> (${oldMessage.author.tag || oldMessage.author.username})` : 'غير معروف'}`,
            `📁 الروم: ${oldMessage.channel || 'غير معروف'}`,
            `🔗 الرابط: ${newMessage.url || '—'}`
        ];

        if (contentChanged) {
            lines.push('', `قبل:\n${oldMessage.content || 'فارغ'}`);
            lines.push('', `بعد:\n${newMessage.content || 'فارغ'}`);
        }
        if (media) lines.push('', media);
        lines.push('', `✏️ المسبب: ${executor}`);

        await sendLog(
            oldMessage.guild,
            'message',
            '✏️ تعديل رسالة',
            lines.join('\n'),
            undefined,
            {
                thumbnail: oldMessage.author?.displayAvatarURL?.({ size: 128 }) || undefined,
                image: firstImageUrl(newMessage) || undefined
            }
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

            if (executorId && executorId !== client.user.id) {

                const member = await getMember(ban.guild, executorId);
                const check = await protectionAllowed(ban.guild, member, settings);

                if (!check.allowed) {

                    const key = `${ban.guild.id}-${executorId}`;
                    const banLimit = metricLimit(prot, 'bans', 'count', 3);
                    const banAction = metricAction(prot, 'bans', 'count', 'kick');

                    if (countExceeded(
                        protectionCounts.bans,
                        key,
                        banLimit
                    )) {

                        if (check.allowed === false) {
                            await applyPunishment(
                                member,
                                banAction,
                                `تجاوز حد الباند (${banLimit})`
                            );
                        }

                        clearCount(protectionCounts.bans, key);

                        await sendLog(
                            ban.guild,
                            'moderation',
                            '🛡️ Ban Protection',
                            `<@${executorId}> تجاوز حد عمليات الحظر (**${banLimit}**).\n` +
                            `المستوى: **${check.level === 'equal' ? 'بنفس رتبة البوت' : check.level === 'above' ? 'أعلى من رتبة البوت' : 'تحت رتبة البوت'}**\n` +
                            (check.allowed === false ? `العقوبة: **${banAction}**` : '')
                        );
                    }
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

// رسالة محذوفة؟ ديسكورد يرمي 50035 (Unknown Message) على أي reply —
// ننعيد الإرسال بدون reference بدل ما نطبع خطأ ضخم ونفقد الرد
function isUnknownMessageError(error) {
    const code = error?.code;
    if (code === 50035) return true;
    if (error?.rawError?.errors?.message_reference) return true;
    return /unknown message|message_reference/i.test(String(error?.message || ''));
}

async function safeReply(message, payload) {
    try {
        return await message.reply(payload);
    } catch (error) {
        if (!isUnknownMessageError(error)) throw error;

        const clean = { ...payload };
        delete clean.messageReference;
        delete clean.message_reference;

        return await message.channel.send(clean);
    }
}

client.on('messageCreate', async message => {

    try {

        if (!message.guild) return;
        if (message.author.bot) return;

        // ==============================================
        // تعيين روم السجل بواسطة منشن المستخدم
        // ==============================================

        const pendingLog =
            pendingLogChannelSet.get(message.author.id);

        if (pendingLog) {

            const stillStaff =
                hasStaffAccess(message.member, message.guild);

            if (!stillStaff) {
                pendingLogChannelSet.delete(message.author.id);
            } else if (
                Date.now() > pendingLog.expires ||
                message.guild.id !== pendingLog.guildId
            ) {
                pendingLogChannelSet.delete(message.author.id);
            } else {

                const mentionedChannel =
                    message.mentions.channels.first();

                if (
                    !mentionedChannel ||
                    !mentionedChannel.isTextBased()
                ) {
                    await message.reply(
                        '❌ منشن روم كتابي صحيح، مثال: #logs'
                    ).catch(() => {});
                    return;
                }

                const logSettings =
                    await getSettings(message.guild.id);

                logSettings.logs[pendingLog.type] =
                    mentionedChannel.id;

                await logSettings.save();

                pendingLogChannelSet.delete(message.author.id);

                await message.reply(
                    `✅ تم تعيين ${mentionedChannel} لسجل **${pendingLog.type}**.`
                ).catch(() => {});

                return;
            }
        }

        // ==============================================
        // 💬 روم الفيدباك: تُمسح رسالة العضو وتُنشر إيمبد
        // ==============================================

        if (await feedback.handleMessage(message)) return;

        // ==============================================
        // 📨 سجل الرسائل اللي فيها وسائط (صورة / فيديو / ستيكر / ملف)
        // ==============================================

        if ((message.attachments?.size || 0) > 0 || (message.stickers?.size || 0) > 0) {
            await sendLog(
                message.guild,
                'message',
                '📨 رسالة جديدة',
                `👤 العضو: ${message.author} (${message.author.id})\n` +
                `📁 الروم: ${message.channel}\n` +
                `🔗 الرابط: ${message.url}\n\n` +
                describeMessageMedia(message),
                undefined,
                {
                    thumbnail: message.author.displayAvatarURL?.({ size: 128 }) || undefined,
                    image: firstImageUrl(message) || undefined
                }
            );
        }

        const settings =
            await getSettings(message.guild.id);

        // ==============================================
        // SPAM PROTECTION (رسائل سريعة / خطوط كبيرة)
        // ==============================================

        const spamProt = ensureProtections(settings).spam;

        const isStaff =
            hasStaffAccess(message.member, message.guild);

        if (spamProt.enabled && !isStaff) {
            const punished = await handleSpam(message, spamProt);
            if (punished) return;
        }

        // ==============================================
        // 🛡️ حماية النصب (رومات محددة: كلام / صورة / رابط)
        // ==============================================

        const scamProt = ensureProtections(settings).scams;

        if (scamProt.enabled && !isStaff) {
            const punished = await handleScamProtection(message, scamProt);
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
                normalizeText(shortcut?.name || '');

            if (!shortcutName) continue;

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
                // ⛔ كان نقص هنا بـ slice(اسم الاختصار) بالطول — لو الاسم
                // فيه مسافات متكررة أو حالة أحرف مختلفة كان الباقي ينقطع غلط
                stripShortcutPrefix(
                    message.content,
                    usedShortcut.shortcut.name
                )
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

                if (
                    auto.staffOnly &&
                    !hasStaffAccess(
                        message.member,
                        message.guild
                    )
                ) {
                    break;
                }

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

        // الرسالة الأصلية انحذفت أثناء المعالجة — خطأ معروف وما يستاهل خطأ ضخم
        if (isUnknownMessageError(error)) {
            console.warn(
                '⚠️ تعذّر الرد على رسالة (انحذفت أثناء المعالجة) في: '
                + (message?.channel?.name || '?')
            );
        } else {
            console.error(
                'Message system error:',
                error
            );
        }

    }

});


// ======================================================
// SHORTCUT TARGET RESOLVERS
// ======================================================

// ⛔ كان الاختصار يعتمد على message.mentions.members.first() فقط،
// وديسكورد ما يردّ عضواً إلا لو كان بالكاش. لو العضو مو بالكاش
// (سيرفر كبير، أو البوت ما شاف العضو قبل) يفشل المنشن ويطلع
// "استخدم الاخصار مع منشن العضو" — فأخذناresolver يغطي كل الحالات.

// يشيل اسم الاختصار من بداية الرسالة حتى لو اختلفت حالة الأحرف
// أو تكرّرت المسافات، ويرجّع الباقي As-Is (بدون lowercase)
function stripShortcutPrefix(content, name) {
    const raw = String(content || '').trim();

    const wanted = normalizeText(name);

    if (!wanted) return raw;

    const tokens = raw.split(/\s+/);

    let collected = '';

    for (let i = 0; i < tokens.length; i++) {

        collected = normalizeText(
            collected ? `${collected} ${tokens[i]}` : tokens[i]
        );

        if (collected === wanted) {
            return tokens.slice(i + 1).join(' ');
        }
    }

    return raw;
}

// يحوّل نص الاختصار لكلمات "اسمية" — يشيل المنشنات والآيدي والمدة
// (10m / 1h / 2d) عشان ما تتحوّل لاسم عضو بالخطأ
function shortcutNameTokens(text) {
    return String(text || '')
        .split(/\s+/)
        .filter(Boolean)
        .filter(t => !/^<@[!&]?\d{15,21}>$/.test(t))
        .filter(t => !/^<#\d{15,21}>$/.test(t))
        .filter(t => !/^\d{15,21}$/.test(t))
        .filter(t => !/^\d+[smhdwy]+$/i.test(t));
}

// يستهدف العضو: منشن → منشن موجود بالـ API بس مو بالكاش →
// آيدي → يوزرنيم/لقب/اسم ظاهر (بالضبط ثم جزئي)
async function resolveShortcutMember(message, args) {

    const guild = message.guild;

    const text = String(args || '');

    // 1) منشن جاهز بالكاش
    const cachedMention = message.mentions?.members?.first?.();

    if (cachedMention) return cachedMention;

    // 2) كل المعرّفات المذكورة بالرسالة — بالترتيب اللي شفناه فيها
    const ids = [];

    const addId = id => {
        if (/^\d{15,21}$/.test(id) && !ids.includes(id)) {
            ids.push(id);
        }
    };

    for (const match of text.matchAll(/<@!?(\d{15,21})>/g)) {
        addId(match[1]);
    }

    for (const match of text.matchAll(/(\d{15,21})/g)) {
        addId(match[0]);
    }

    if (message.mentions?.users) {
        for (const user of message.mentions.users.values()) {
            addId(user.id);
        }
    }

    for (const id of ids) {

        const fromCache = guild.members.cache.get(id);

        if (fromCache) return fromCache;

        // ⬆️ هذا هو الإصلاح الأساسي: المنشن اللي مو بالكاش
        // كان يرجع null قبل كذا وما كان فيه أي محاولة ثانية
        const fetched = await guild.members
            .fetch(id)
            .catch(() => null);

        if (fetched) return fetched;
    }

    // 3) يوزرنيم / لقب / اسم ظاهر — من الكاش ثم بحث ديسكورد
    const needle = shortcutNameTokens(text)
        .join(' ')
        .toLowerCase()
        .trim();

    if (!needle) return null;

    const compact = needle.replace(/[\s._\-]/g, '');

    const compactValue = value =>
        String(value || '')
            .toLowerCase()
            .replace(/[\s._\-]/g, '');

    const equals = member => {

        const user = member?.user;

        if (!user) return false;

        return (
            compactValue(user.username) === compact ||
            compactValue(user.globalName) === compact ||
            compactValue(member.displayName) === compact ||
            compactValue(user.username) === needle ||
            compactValue(member.displayName) === needle
        );
    };

    const startsWith = member => {

        if (compact.length < 2) return false;

        const user = member?.user;

        if (!user) return false;

        return (
            compactValue(user.username).startsWith(compact) ||
            compactValue(user.globalName).startsWith(compact) ||
            compactValue(member.displayName).startsWith(compact)
        );
    };

    for (const member of guild.members.cache.values()) {
        if (equals(member)) return member;
    }

    for (const member of guild.members.cache.values()) {
        if (startsWith(member)) return member;
    }

    if (typeof guild.members.fetch === 'function') {

        const found = await guild.members
            .fetch({ query: needle, limit: 10 })
            .catch(() => null);

        if (found?.members?.size) {

            for (const member of found.members.values()) {
                if (equals(member)) return member;
            }

            return found.members.first() || null;
        }
    }

    return null;
}

// يستهدف الرتبة: منشن → <@&id> → آيدي → اسمها بالضبط ثم جزئي
function resolveShortcutRole(message, args) {

    const guild = message.guild;

    const text = String(args || '');

    const roles = [...guild.roles.cache.values()];

    // 1) منشن الرتبة
    const mentioned = message.mentions?.roles?.first?.();

    if (mentioned) return mentioned;

    // 2) <@&id> أو آيدي مكتوب عادي
    const ids = [];

    const addId = id => {
        if (/^\d{15,21}$/.test(id) && !ids.includes(id)) {
            ids.push(id);
        }
    };

    for (const match of text.matchAll(/<@&(\d{15,21})>/g)) {
        addId(match[1]);
    }

    for (const match of text.matchAll(/(\d{15,21})/g)) {
        addId(match[0]);
    }

    for (const id of ids) {

        const role = roles.find(r => r.id === id);

        if (role) return role;
    }

    // 3) اسم الرتبة أو جزء منه — مو لازم منشن
    const needle = shortcutNameTokens(text)
        .join(' ')
        .toLowerCase()
        .trim();

    if (!needle) return null;

    const normalizeName = value =>
        String(value || '')
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .trim();

    const compactName = value =>
        normalizeName(value).replace(/[\s._\-]/g, '');

    const wanted = normalizeName(needle);

    const wantedCompact = compactName(needle);

    const exact = roles.find(
        role =>
            normalizeName(role.name) === wanted ||
            compactName(role.name) === wantedCompact
    );

    if (exact) return exact;

    const partial = roles.find(
        role => compactName(role.name).includes(wantedCompact)
    );

    if (partial) return partial;

    return null;
}

// ======================================================
// SHORTCUT EXECUTOR
// ======================================================

async function executeShortcut(
    message,
    command,
    rawArgs
) {

    if (!hasStaffAccess(message.member, message.guild)) {
        return message.reply(
            `❌ تحتاج رتبة **${STAFF_ROLE_NAME}** لاستخدام الاختصارات.`
        );
    }


    // ==============================================
    // COMMAND PARSER
    // ==============================================

    // ⬆️ مو لازم منشن: منشن، آيدي، يوزرنيم، أو جزء من الاسم
    const mention =
        await resolveShortcutMember(
            message,
            rawArgs
        );

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
                '❌ ما لقيت العضو — انشرنه، أو اكتب يوزرنيمه، أو آيديه.'
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
                '❌ ما لقيت العضو — انشرنه، أو اكتب يوزرنيمه، أو آيديه.'
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
    // UNBAN
    // ==============================================

    if (command === 'unban') {

        const userId =
            mention?.id ||
            args.find(x =>
                /^\d{17,20}$/.test(x)
            );

        if (!userId) {
            return message.reply(
                '❌ اكتب آيدي العضو، مثال: <الاختصار> 123456789012345678'
            );
        }

        const banned =
            await message.guild.bans.fetch(userId)
                .catch(() => null);

        if (!banned) {
            return message.reply(
                '❌ العضو غير محظور.'
            );
        }

        await message.guild.bans.remove(
            userId,
            `Shortcut بواسطة ${message.author.tag}`
        );

        return message.reply(
            `🔓 تم فك حظر العضو **${banned.user.tag || userId}**.`
        );
    }


    // ==============================================
    // JAIL
    // ==============================================

    if (command === 'jail') {

        if (!mention) {
            return message.reply(
                '❌ ما لقيت العضو — انشرنه، أو اكتب يوزرنيمه، أو آيديه.'
            );
        }

        const jailRole = await jailMember(mention);

        return message.reply(
            `🔒 تم سجن ${mention}.\n` +
            `الرتبة: **${jailRole ? jailRole.name : 'سجن'}** — ما يشوف ولا روم.\n` +
            `فكّه: \`unjail @${mention.id}\``
        );
    }


    // ==============================================
    // UNJAIL
    // ==============================================

    if (command === 'unjail') {

        if (!mention) {
            return message.reply(
                '❌ ما لقيت العضو — انشرنه، أو اكتب يوزرنيمه، أو آيديه.'
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
    // ROLE ADD
    // ==============================================

    if (command === 'role-add') {

        // ⬆️ مو لازم منشن للرتبة: منشن، آيدي، أو اسمها (حتى جزئي)
        const role =
            resolveShortcutRole(message, rawArgs);

        if (!mention || !role) {
            return message.reply(
                '❌ استخدم الاختصار مع العضو والرتبة.\n' +
                'مثال: `<الاختصار> @عضو @رتبة`\n' +
                'أو: `<الاختصار> @عضو مشرف` (اسم الرتبة أو جزء منه)\n' +
                'أو: `<الاختصار> @عضو 123456789012345678` (آيدي الرتبة)'
            );
        }

        if (role.managed || !role.editable) {
            return message.reply(
                `❌ لا أستطيع إعطاء رتبة ${role}.`
            );
        }

        await mention.roles.add(
            role,
            `Shortcut بواسطة ${message.author.tag}`
        );

        return message.reply(
            `🎭 تم إعطاء ${role} لـ ${mention}.`
        );
    }


    // ==============================================
    // ROLE REMOVE
    // ==============================================

    if (command === 'role-remove') {

        // ⬆️ نفس الشي: منشن، آيدي، أو اسمها (حتى جزئي)
        const role =
            resolveShortcutRole(message, rawArgs);

        if (!mention || !role) {
            return message.reply(
                '❌ استخدم الاختصار مع العضو والرتبة.\n' +
                'مثال: `<الاختصار> @عضو @رتبة`\n' +
                'أو: `<الاختصار> @عضو مشرف` (اسم الرتبة أو جزء منه)\n' +
                'أو: `<الاختصار> @عضو 123456789012345678` (آيدي الرتبة)'
            );
        }

        if (role.managed || !role.editable) {
            return message.reply(
                `❌ لا أستطيع إزالة رتبة ${role}.`
            );
        }

        await mention.roles.remove(
            role,
            `Shortcut بواسطة ${message.author.tag}`
        );

        return message.reply(
            `🎭 تم إزالة ${role} من ${mention}.`
        );
    }


    // ==============================================
    // UNTIMEOUT
    // ==============================================

    if (command === 'untimeout') {

        if (!mention) {
            return message.reply(
                '❌ ما لقيت العضو — انشرنه، أو اكتب يوزرنيمه، أو آيديه.'
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
                '❌ ما لقيت العضو — انشرنه، أو اكتب يوزرنيمه، أو آيديه.'
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

        return safeReply(
            message,
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

        return safeReply(
            message,
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
        '❌ هذا الأمر غير مدعوم في الاختصارات.\n' +
        `الأمر المستلم: \`${command || '(فارغ)'}\`\n` +
        'الأوامر المدعومة: ban / unban / kick / jail / unjail / timeout / untimeout / role-add / role-remove / purge / lock / unlock'
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
// MOUNT DASHBOARD — ما يوقفش البوت إذا المجلد ناقص
// ======================================================

// يبحث عن dashboard/server.js في المجلد الحالي وفي مجلدين فرعيين
// (يغطي فك الضغط داخل مجلد مثل bot/ أو dist/bot/ بدل الجذر)
function resolveDashboardRoot() {
    const IGNORED = new Set(['node_modules', '.git', '.cache', 'tmp', 'temp', 'vendor', 'logs']);

    const candidates = [__dirname];

    for (const name of fs.existsSync(__dirname) ? fs.readdirSync(__dirname, { withFileTypes: true }) : []) {
        if (!name.isDirectory() || IGNORED.has(name.name) || name.name.startsWith('.')) continue;
        candidates.push(path.join(__dirname, name.name));
    }

    for (const root of candidates.slice()) {
        if (IGNORED.has(path.basename(root)) && root !== __dirname) continue;
        for (const name of fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }) : []) {
            if (!name.isDirectory() || IGNORED.has(name.name) || name.name.startsWith('.')) continue;
            candidates.push(path.join(root, name.name));
        }
    }

    for (const root of candidates) {
        const entry = path.join(root, 'dashboard', 'server.js');
        if (!fs.existsSync(entry)) continue;

        const publicDir = path.join(root, 'dashboard', 'public');

        return {
            root,
            entry,
            public: publicDir,
            publicHTML: path.join(publicDir, 'index.html')
        };
    }

    return null;
}

const DASHBOARD_PATHS = resolveDashboardRoot();
const DASHBOARD_ENTRY = DASHBOARD_PATHS ? DASHBOARD_PATHS.entry : path.join(__dirname, 'dashboard', 'server.js');
const DASHBOARD_PUBLIC = DASHBOARD_PATHS ? DASHBOARD_PATHS.public : path.join(__dirname, 'dashboard', 'public');

if (DASHBOARD_PATHS && DASHBOARD_PATHS.root !== __dirname) {
    console.log('📁 لقيت مجلد dashboard/ داخل: ' + DASHBOARD_PATHS.root);
}

// صفحة تشخيص بديلة بدل 404 أبيض — تقول بالضبط وش ناقص وكيف تحله
function dashboardFallbackPage(reason) {
    const rows = [
        ['dashboard/server.js', fs.existsSync(DASHBOARD_ENTRY)],
        ['dashboard/public/index.html', fs.existsSync(path.join(DASHBOARD_PUBLIC, 'index.html'))],
        ['dashboard/public/app.js', fs.existsSync(path.join(DASHBOARD_PUBLIC, 'app.js'))],
        ['dashboard/public/style.css', fs.existsSync(path.join(DASHBOARD_PUBLIC, 'style.css'))]
    ]
        .map(
            ([name, ok]) =>
                `<li>${ok ? '✅' : '❌'} ${name}</li>`
        )
        .join('');

    // قائمة الملفات الموجودة فعليًا — تكشف فورًا هل المشكلة "مجلد فرعي" أو "الملف مو مرفوع"
    let dirListing = '';

    try {
        const entries = fs
            .readdirSync(__dirname, { withFileTypes: true })
            .filter(e => e.name !== 'node_modules' && e.name !== '.git')
            .map(e => (e.isDirectory() ? e.name + '/' : e.name))
            .sort();

        dirListing =
            '<p style="margin-top:18px">ما موجود فعليًا في <code>' +
            __dirname +
            '</code> (' +
            entries.length +
            ' عنصر):</p><div class="ls">' +
            (entries.length ? entries.join('<br>') : '(فاضي)') +
            '</div>';
    } catch (error) {
        dirListing = '';
    }

    return `<!DOCTYPE html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard Missing</title>
<style>
 body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0f1117;
      color:#e6e8ee;font-family:system-ui,"Segoe UI",Tahoma,sans-serif;padding:24px}
 .box{max-width:640px;width:100%;background:#171a23;border:1px solid #262b38;border-radius:16px;padding:28px}
 h1{margin:0 0 6px;font-size:22px}
 p{color:#a6adbb;line-height:1.9;font-size:14px;margin:8px 0}
 code{background:#0b0d13;padding:2px 7px;border-radius:6px;color:#7ee787;
      font-family:ui-monospace,Consolas,monospace;direction:ltr;display:inline-block}
 ul{list-style:none;padding:0;margin:14px 0}
 li{padding:7px 12px;background:#0b0d13;border-radius:8px;margin:5px 0;
    font-family:ui-monospace,Consolas,monospace;font-size:13px;direction:ltr;text-align:left}
  .err{background:#2a1416;border:1px solid #5c2028;color:#ffb4ab;padding:10px 14px;
       border-radius:8px;font-size:12px;direction:ltr;text-align:left;overflow:auto}
  .ls{background:#0b0d13;border-radius:8px;padding:10px 14px;margin:6px 0 0;
      font-family:ui-monospace,Consolas,monospace;font-size:12px;direction:ltr;
      text-align:left;color:#a6adbb;max-height:220px;overflow:auto}
</style></head><body><div class="box">
<h1>⚠️ الداشبورد غير مركّب</h1>
<p>البوت شغّال عادي، بس ملفات الواجهة ما وصلت للاستضافة. الملفات الناقصة:</p>
<ul>${rows}</ul>
<p><b>الحل:</b> ارفع مجلد <code>dashboard/</code> كامل (بما فيه <code>public/</code>)
بجانب ملف <code>index.js</code> في <code>/home/container</code> — مو داخل مجلد فرعي.</p>
<p>أو ارفع المشروع من GitHub جديد (الملفات كلها داخله) بدل ما ترفع <code>index.js</code> لحاله.</p>
${dirListing}
<div class="err">${String(reason).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</div>
</div></body></html>`;
}

// ======================================================
// منفّذ أوامر الداشبورد — ينفّذ أوامر السلاش من الداشبورد
// مباشرة على السيرفر (بدون الحاجة لديسكورد).
// يقرأ { guild, actorId, channelId, command, sub, group, options }
// ويرجّع { ok, message, data?, unsupported? }.
// الوصول محمي بالداشبورد (ستريتر فقط). الأوامر غير المدعومة
// ترجع unsupported:true مع رسالة تحوّل المستخدم لديسكورد.
// ======================================================

// القائمة الرسمية لأوامر (وأزواجها الفرعية) اللي تقدر تنفذ من الداشبورد:
// '*' يعني كل الأزواج الفرعية.
const DASHBOARD_SUPPORTED = {
    jail: '*', unjail: '*', ban: '*', unban: '*', kick: '*',
    timeout: '*', untimeout: '*', 'role-add': '*', 'role-remove': '*',
    purge: '*', lock: '*', unlock: '*', embed: '*',
    autoresponse: ['add', 'list', 'remove', 'edit'],
    shortcut: ['add', 'list', 'remove', 'edit'],
    setlog: '*',
    'level-settings': '*',
    autorole: ['set', 'off', 'status'],
    welcome: ['set', 'card', 'variables', 'off', 'image'],
    whitelist: ['add', 'remove', 'list'],
    protect: ['channels', 'roles', 'bans', 'bots', 'webhooks', 'invites', 'status'],
    antispam: ['spam', 'scams'],
    giveaway: ['setup', 'start', 'end', 'reroll', 'list'],
    temprole: ['add', 'remove', 'list'],
    puzzle: ['start', 'end', 'list'],
    ticket: ['setup', 'send', 'option', 'disable', 'info', 'image'],
    backup: '*', restore: '*', 'security-audit': '*', stats: '*'
};

// هل هذا الأمر يقدر ينفذ من الداشبورد؟
function isDashboardCommandSupported(command, sub = null) {
    const entry = DASHBOARD_SUPPORTED[command];
    if (!entry) return false;
    if (!sub) return true;
    if (entry === '*') return true;
    if (Array.isArray(entry)) return entry.includes(sub);
    return false;
}

// المقابلة الجاهزة لأوامر يحتاجون ديسكورد حقيقي
// (زر/رسالة/إيموجي تفاعلي) — نستخدمها في واجهة الأوامر.
function dashboardUnsupportedReason(command) {
    if (isDashboardCommandSupported(command)) return null;

    return 'ينفّذ من ديسكورد فقط (يحتاج تفاعل مثل زر/إيموجي/رسالة حية).';
}

async function executeDashboardCommand(ctx) {
    const {
        guild,
        actorId,
        channelId,
        command,
        sub = null,
        group = null,
        options = {}
    } = ctx || {};

    if (!guild || !actorId) return { ok: false, error: 'بيانات ناقصة (سيرفر أو منفّذ).' };

    const opt = key => (
        options && options[key] !== undefined && options[key] !== null
            ? options[key]
            : undefined
    );

    const idOf = value => {
        if (value == null) return '';
        return String(value).replace(/<@!?&?#?(\d{15,21})>/g, '$1').trim();
    };

    const resolveMember = async value => getMember(guild, idOf(value));
    const resolveRole = value => guild.roles.cache.get(idOf(value)) || null;
    const resolveChannel = value => guild.channels.cache.get(idOf(value)) || null;

    // روم نصي افتراضي للرسائل (لو ما حدد المستخدم روم)
    function defaultTextChannel() {
        return guild.channels.cache
            .filter(c => c.isTextBased())
            .sort((a, b) => a.position - b.position)
            .first() || null;
    }

    function pickChannel(value) {
        const ch = resolveChannel(value) || resolveChannel(channelId);
        if (ch) return ch;
        return defaultTextChannel();
    }

    const settings = await getSettings(guild.id);
    ensureProtections(settings);

    const fail = (error = 'فشل التنفيذ.') => ({ ok: false, error: String(error) });
    const done = message => ({ ok: true, message: String(message) });

    try {
        // ================= JAIL / UNJAIL =================
        if (command === 'jail') {
            const member = await resolveMember(opt('user'));
            if (!member) return fail('العضو غير موجود بالسيرفر.');
            if (String(member.id) === String(OWNER_ID)) return fail('لا يمكن سجن مالك البوت.');
            await jailMember(member);
            await sendLog(guild, 'moderation', '🔒 Jail', `${member} تم سجنه من الداشبورد بواسطة <@${actorId}>.`, 0xFFAA00);
            return done(`🔒 تم سجن ${member} من الداشبورد.`);
        }

        if (command === 'unjail') {
            const member = await resolveMember(opt('user'));
            if (!member) return fail('العضو غير موجود بالسيرفر.');
            const ok = await unjailMember(member);
            if (!ok) return fail('هذا العضو ليس مسجوناً.');
            await sendLog(guild, 'moderation', '🔓 Unjail', `${member} تم فك سجنه من الداشبورد بواسطة <@${actorId}>.`, 0x57F287);
            return done(`🔓 تم فك سجن ${member} من الداشبورد.`);
        }

        // ================= BAN / UNBAN =================
        if (command === 'ban') {
            const reason = opt('reason') || 'بدون سبب';
            const uid = idOf(opt('user'));
            if (!uid) return fail('حدد العضو.');
            if (uid === String(OWNER_ID)) return fail('لا يمكن حظر مالك البوت.');
            const member = await getMember(guild, uid);
            const target = member || await client.users.fetch(uid).catch(() => null);
            if (!target) return fail('ما لقيت العضو.');
            await guild.members.ban(target.id, { reason: `من الداشبورد — ${reason}` });
            await sendLog(guild, 'moderation', '🔨 Ban', `${target} تم حظره من الداشبورد بواسطة <@${actorId}>.`, 0xED4245);
            return done(`🔨 تم حظر ${target} من الداشبورد.`);
        }

        if (command === 'unban') {
            const reason = opt('reason') || 'بدون سبب';
            const uid = idOf(opt('user_id') || opt('user'));
            if (!uid) return fail('حدد آيدي العضو.');
            const bans = await guild.bans.fetch().catch(() => null);
            const banned = bans ? bans.get(uid) : null;
            if (!banned) return fail('هذا المستخدم مو محظور أصلاً.');
            await guild.members.unban(uid, `من الداشبورد — ${reason}`);
            await sendLog(guild, 'moderation', '🔨 Unban', `<@${uid}> تم رفع حظره من الداشبورد بواسطة <@${actorId}>.`, 0x57F287);
            return done(`🔨 تم رفع حظر <@${uid}>.`);
        }

        // ================= KICK / TIMEOUT / UNTIMEOUT =================
        if (command === 'kick') {
            const member = await resolveMember(opt('user'));
            if (!member) return fail('العضو غير موجود بالسيرفر.');
            const reason = opt('reason') || 'بدون سبب';
            await member.kick(`من الداشبورد — ${reason}`);
            await sendLog(guild, 'moderation', '👢 Kick', `${member} تم طرده من الداشبورد بواسطة <@${actorId}>.`, 0xF1C40F);
            return done(`👢 تم طرد ${member} من الداشبورد.`);
        }

        if (command === 'timeout') {
            const member = await resolveMember(opt('user'));
            if (!member) return fail('العضو غير موجود بالسيرفر.');
            const duration = String(opt('duration') || '').trim();
            const dm = duration.match(/^(\d+)(s|m|h|d)$/i);
            if (!dm) return fail('صيغة المدة غلط — اكتب مثل 10m أو 1h أو 1d.');
            const ms = Number(dm[1]) * ({ s: 1000, m: 60000, h: 3600000, d: 86400000 })[dm[2].toLowerCase()];
            if (!ms || ms > 28 * 86400000) return fail('أقصى مدة تايم أوت 28 يوم.');
            const reason = opt('reason') || 'بدون سبب';
            await member.timeout(ms, `من الداشبورد — ${reason}`);
            await sendLog(guild, 'moderation', '⏳ Timeout', `${member} كتم ${duration} من الداشبورد بواسطة <@${actorId}>.`, 0xF1C40F);
            return done(`⏳ تم كتم ${member} لمدة **${duration}**.`);
        }

        if (command === 'untimeout') {
            const member = await resolveMember(opt('user'));
            if (!member) return fail('العضو غير موجود بالسيرفر.');
            const reason = opt('reason') || 'بدون سبب';
            await member.timeout(null, `من الداشبورد — ${reason}`);
            return done(`✅ تم فك الكتم عن ${member}.`);
        }

        // ================= ROLE ADD / REMOVE =================
        if (command === 'role-add') {
            const member = await resolveMember(opt('user'));
            const role = resolveRole(opt('role'));
            if (!member || !role) return fail('حدد العضو والرتبة.');
            if (!role.editable || role.managed) return fail('ما أقدر أعطي رتبة بوت أو رتبة فوق رتبتي.');
            const reason = opt('reason') || 'من الداشبورد';
            await member.roles.add(role, reason);
            await sendLog(guild, 'moderation', '🎭 Role Add', `${member} أخذ ${role} من الداشبورد بواسطة <@${actorId}>.`, 0x57F287);
            return done(`🎭 تم إعطاء ${role} للعضو ${member}.`);
        }

        if (command === 'role-remove') {
            const member = await resolveMember(opt('user'));
            const role = resolveRole(opt('role'));
            if (!member || !role) return fail('حدد العضو والرتبة.');
            if (!role.editable) return fail('ما أقدر أسحب رتبة بوت أو رتبة فوق رتبتي.');
            const reason = opt('reason') || 'من الداشبورد';
            await member.roles.remove(role, reason);
            await sendLog(guild, 'moderation', '🎭 Role Remove', `${member} سُحبت منه ${role} من الداشبورد بواسطة <@${actorId}>.`, 0xF1C40F);
            return done(`🎭 تم سحب ${role} من ${member}.`);
        }

        // ================= PURGE =================
        if (command === 'purge') {
            const ch = pickChannel(opt('channel'));
            if (!ch || !ch.isTextBased()) return fail('حدد روم نصي.');
            const amount = Math.min(100, Math.max(1, Number(opt('amount')) || 10));
            const deleted = await ch.bulkDelete(amount, true).catch(() => null);
            if (deleted === null) return fail('ما قدرت أحذف الرسائل (تأكد من صلاحياتي).');
            await sendLog(guild, 'moderation', '🧹 Purge', `حُذفت **${deleted.size}** رسالة من ${ch} من الداشبورد بواسطة <@${actorId}>.`, 0x9B59B6);
            return done(`🧹 حذفت **${deleted.size}** رسالة من ${ch}.`);
        }

        // ================= LOCK / UNLOCK =================
        if (command === 'lock') {
            const ch = pickChannel(opt('channel'));
            if (!ch || !ch.isTextBased()) return fail('حدد روم.');
            await ch.permissionOverwrites.edit(guild.id, { SendMessages: false }, { reason: 'من الداشبورد' });
            await sendLog(guild, 'moderation', '🔒 Lock', `قفل روم ${ch} من الداشبورد بواسطة <@${actorId}>.`, 0xED4245);
            return done(`🔒 تم قفل الروم ${ch}.`);
        }

        if (command === 'unlock') {
            const ch = pickChannel(opt('channel'));
            if (!ch || !ch.isTextBased()) return fail('حدد روم.');
            await ch.permissionOverwrites.edit(guild.id, { SendMessages: null }, { reason: 'من الداشبورد' });
            await sendLog(guild, 'moderation', '🔓 Unlock', `فتح روم ${ch} من الداشبورد بواسطة <@${actorId}>.`, 0x57F287);
            return done(`🔓 تم فتح الروم ${ch}.`);
        }

        // ================= EMBED =================
        if (command === 'embed') {
            const ch = pickChannel(opt('channel'));
            if (!ch || !ch.isTextBased()) return fail('حدد روم نصي.');
            const description = String(opt('description') || '').trim();
            if (!description) return fail('نص الإيمبد مطلوب.');

            const eb = new EmbedBuilder().setDescription(description);
            if (opt('title')) eb.setTitle(String(opt('title')));
            if (opt('color')) eb.setColor(/^#?[0-9a-fA-F]{6}$/.test(String(opt('color'))) ? parseInt(String(opt('color')).replace('#', ''), 16) : 0x5865F2);
            if (opt('footer')) eb.setFooter({ text: String(opt('footer')) });
            if (opt('image')) eb.setImage(String(opt('image')));
            if (opt('thumbnail')) eb.setThumbnail(String(opt('thumbnail')));
            if (opt('url')) eb.setURL(String(opt('url')));

            await ch.send({ embeds: [eb] });
            await sendLog(guild, 'moderation', '📄 Embed', `أُرسل إيمبد في ${ch} من الداشبورد بواسطة <@${actorId}>.`, 0x5865F2);
            return done(`✅ تم إرسال الإيمبد في ${ch}.`);
        }

        // ================= WELCOME =================
        if (command === 'welcome') {
            if (sub === 'set') {
                const ch = resolveChannel(opt('channel'));
                const message = String(opt('message') || '').trim();
                if (!ch) return fail('حدد روم نصي للترحيب.');
                if (!message) return fail('رسالة الترحيب مطلوبة.');
                settings.welcome.enabled = true;
                settings.welcome.channelId = ch.id;
                settings.welcome.message = message;
                await settings.save();
                await sendLog(guild, 'moderation', '👋 Welcome', `<@${actorId}> فعّل الترحيب في ${ch} من الداشبورد.`, 0x57F287);
                return done(`✅ تم تفعيل الترحيب في ${ch}.`);
            }

            if (sub === 'card') {
                const enabled = opt('enabled');
                if (typeof enabled !== 'boolean') return fail('اختر تفعيل/إيقاف.');
                settings.welcome.cardEnabled = enabled;
                await settings.save();
                return done(`🖼️ صورة الترحيب (Canvas) ${enabled ? 'مفعّلة ✅' : 'متوقفة ❌'}.`);
            }

            if (sub === 'variables') {
                return done(
                    'متغيرات رسالة الترحيب:\n' +
                    '· `{user}` — المنشن\n· `{username}` — الاسم\n· `{server}` — اسم السيرفر\n' +
                    '· `{members}` — عدد الأعضاء\n· `{joinedAt}` — تاريخ الدخول\n· `{inviter}` — الداعي'
                    + '\n· `{invites}` — عدد دعوات الداعي\n· `{userCount}` — ترتيب العضو'
                );
            }

            if (sub === 'off') {
                settings.welcome.enabled = false;
                await settings.save();
                await sendLog(guild, 'moderation', '👋 Welcome Off', `<@${actorId}> أوقف الترحيب من الداشبورد.`, 0xED4245);
                return done(`⛔ تم إيقاف الترحيب.`);
            }

            if (sub === 'image') {
                if (group === 'set') {
                    const url = String(opt('url') || '').trim();
                    if (!/^https?:\/\/.+/i.test(url)) return fail('أرسل رابط صورة مباشر (https://...).');
                    settings.welcome.image = url;
                    settings.welcome.cardEnabled = false;
                    await settings.save();
                    return done(`🖼️ تم تعيين صورة الترحيب من الداشبورد.`);
                }
                if (group === 'remove') {
                    settings.welcome.image = null;
                    settings.welcome.cardEnabled = true;
                    await settings.save();
                    return done(`🖼️ حذفنا صورة الترحيب — رجعنا للبطاقة (Canvas).`);
                }
            }

            return fail('أمر welcome فرعي غير معروف.');
        }

        // ================= AUTORESPONSE =================
        if (command === 'autoresponse') {
            if (sub === 'add') {
                const trigger = String(opt('trigger') || '').trim();
                const response = String(opt('response') || '').trim();
                if (!normalizeText(trigger)) return fail('الكلمة المطلوبة للرد التلقائي لا يمكن أن تكون فارغة.');
                if (settings.autoResponses.some(x => normalizeText(x.trigger) === normalizeText(trigger))) {
                    return fail('هذا الرد التلقائي موجود مسبقاً.');
                }
                settings.autoResponses.push({ trigger, response, staffOnly: !!opt('staff_only') });
                await settings.save();
                await sendLog(guild, 'moderation', '🤖 Autoresponse', `<@${actorId}> أضاف رد تلقائي "**${trigger}**" من الداشبورد.`, 0x57F287);
                return done(`✅ أضفت الرد التلقائي **"${trigger}"** (العدد: ${settings.autoResponses.length}).`);
            }

            if (sub === 'list') {
                if (!settings.autoResponses.length) return done('ℹ️ ما فيه ردود تلقائية حاليًا.');
                const lines = settings.autoResponses.map((x, i) =>
                    `**${i + 1}.** \`${x.trigger}\` → ${String(x.response).slice(0, 60)}${x.staffOnly ? ' 🔒' : ''}`
                );
                return done(lines.join('\n'));
            }

            if (sub === 'remove') {
                const target = String(opt('target') || '').trim();
                if (!target) return fail('حدد الرد من القائمة.');
                const idx = settings.autoResponses.findIndex(x => normalizeText(x.trigger) === normalizeText(target));
                if (idx === -1) return fail('هذا الرد مو موجود.');
                settings.autoResponses.splice(idx, 1);
                await settings.save();
                return done(`🗑️ حذفت الرد **"${target}"**.`);
            }

            if (sub === 'edit') {
                const target = String(opt('target') || '').trim();
                const response = String(opt('response') || '').trim();
                const idx = settings.autoResponses.findIndex(x => normalizeText(x.trigger) === normalizeText(target));
                if (idx === -1) return fail('هذا الرد مو موجود.');
                if (response) settings.autoResponses[idx].response = response;
                if (opt('staff_only') !== undefined) settings.autoResponses[idx].staffOnly = !!opt('staff_only');
                await settings.save();
                return done(`✏️ عدّلت الرد **"${target}"**.`);
            }

            return fail('أمر autoreponse فرعي غير معروف.');
        }

        // ================= SHORTCUT =================
        if (command === 'shortcut') {
            if (sub === 'add') {
                const name = String(opt('name') || '').trim();
                const cmd = String(opt('command') || '').trim();
                if (!normalizeText(name)) return fail('اسم الاختصار لا يمكن أن يكون فارغاً.');
                if (settings.shortcuts.some(x => normalizeText(x.name) === normalizeText(name))) {
                    return fail('هذا الاختصار موجود مسبقاً.');
                }
                settings.shortcuts.push({ name, command: cmd });
                await settings.save();
                await sendLog(guild, 'moderation', '⚡ Shortcut', `<@${actorId}> أضاف اختصار "**${name}**" → \`${cmd}\` من الداشبورد.`, 0x00B0F4);
                return done(`⚡ أضفت الاختصار **"${name}"** → \`${cmd}\`.`);
            }

            if (sub === 'list') {
                if (!settings.shortcuts.length) return done('ℹ️ ما فيه اختصارات حاليًا.');
                const lines = settings.shortcuts.map((x, i) => `**${i + 1}.** \`${x.name}\` → \`${x.command}\``);
                return done(lines.join('\n'));
            }

            if (sub === 'remove') {
                const target = String(opt('target') || '').trim();
                const idx = settings.shortcuts.findIndex(x => normalizeText(x.name) === normalizeText(target));
                if (idx === -1) return fail('هذا الاختصار مو موجود.');
                settings.shortcuts.splice(idx, 1);
                await settings.save();
                return done(`🗑️ حذفت الاختصار **"${target}"**.`);
            }

            if (sub === 'edit') {
                const target = String(opt('target') || '').trim();
                const idx = settings.shortcuts.findIndex(x => normalizeText(x.name) === normalizeText(target));
                if (idx === -1) return fail('هذا الاختصار مو موجود.');
                if (opt('name')) settings.shortcuts[idx].name = String(opt('name'));
                if (opt('command')) settings.shortcuts[idx].command = String(opt('command'));
                await settings.save();
                return done(`✏️ عدّلت الاختصار **"${target}"**.`);
            }

            return fail('أمر shortcut فرعي غير معروف.');
        }

        // ================= SETLOG =================
        if (command === 'setlog') {
            const ch = resolveChannel(opt('channel'));
            if (!ch) return fail('حدد روم.');
            settings.logs.moderation = ch.id;
            await settings.save();
            await sendLog(guild, 'moderation', '📑 SetLog', `${ch} أصبح روم سجلات الإدارة من الداشبورد بواسطة <@${actorId}>.`, 0x5865F2);
            return done(`✅ ${ch} أصبح روم سجلات الإدارة.`);
        }

        // ================= LEVEL SETTINGS =================
        if (command === 'level-settings') {
            const messages = Number(opt('messages'));
            const level = Number(opt('level'));
            const role = opt('role') ? resolveRole(opt('role')) : null;

            if (messages > 0) {
                const next = Math.max(1, Math.min(100000, Math.round(messages)));
                settings.levelSettings.messagesPerLevel = next;
            }

            if (level > 0 && role) {
                settings.levelSettings.rewards.set(String(Math.round(level)), role.id);
                settings.markModified('levelSettings.rewards');
            }

            if (!(messages > 0) && !(level > 0 && role)) {
                return fail('أرسل عدد الرسائل لكل مستوى، أو مستوى + رتبة كمكافأة.');
            }

            await settings.save();
            await sendLog(guild, 'moderation', '📊 Level Settings', `<@${actorId}> حدّث إعدادات المستويات من الداشبورد.`, 0x57F287);
            return done(`✅ تم تحديث إعدادات المستويات.\n💬 الرسائل لكل مستوى: **${settings.levelSettings.messagesPerLevel}**`);
        }

        // ================= AUTO ROLE =================
        if (command === 'autorole') {
            if (sub === 'set') {
                const role = resolveRole(opt('role'));
                if (!role) return fail('حدد رتبة.');
                const botHighest = guild.members.me?.roles?.highest;
                if (botHighest && role.position >= botHighest.position) {
                    return fail('الرتبة لازم تكون **تحت** رتبة البوت.');
                }
                settings.autoRole.enabled = true;
                settings.autoRole.roleId = role.id;
                await settings.save();
                await sendLog(guild, 'moderation', '🛡️ AutoRole', `<@${actorId}> فعّل الرتبة التلقائية ${role} من الداشبورد.`, 0x57F287);
                return done(`✅ الرتبة التلقائية مفعّلة — أي عضو جديد بيحصل على ${role}.`);
            }

            if (sub === 'off') {
                settings.autoRole.enabled = false;
                settings.autoRole.roleId = null;
                await settings.save();
                return done(`⛔ تم إيقاف الرتبة التلقائية.`);
            }

            if (sub === 'status') {
                const role = settings.autoRole.roleId ? guild.roles.cache.get(settings.autoRole.roleId) : null;
                return done(
                    `🛡️ الرتبة التلقائية: **${settings.autoRole.enabled ? 'مفعّلة ✅' : 'متوقفة ❌'}**\n` +
                    `🎭 الرتبة: ${role ? role.toString() : 'غير محددة'}`
                );
            }

            return fail('أمر autorole فرعي غير معروف.');
        }

        // ================= WHITELIST =================
        if (command === 'whitelist') {
            const isOwnerHere = String(guild.ownerId) === String(actorId) || isBotOwner(actorId);
            if (!isOwnerHere) {
                return fail('🔒 الوايت ليست للمالك فقط — راعي السيرفر أو راعي البوت.');
            }

            const list = () => {
                if (!settings.whitelist?.length) return 'ℹ️ الوايت ليست فاضية.';
                return settings.whitelist.map((id, i) => `**${i + 1}.** <@${id}>`).join('\n');
            };

            if (sub === 'add') {
                const uid = idOf(opt('user'));
                if (!uid) return fail('حدد العضو.');
                if (settings.whitelist.includes(uid)) return fail('هذا العضو موجود مسبقاً بالوايت ليست.');
                settings.whitelist.push(uid);
                await settings.save();
                ensureProtections(settings);
                return done(`✅ أضفت <@${uid}> إلى الوايت ليست — الحماية ما تتدخل معه.`);
            }

            if (sub === 'remove') {
                const uid = idOf(opt('user'));
                if (!uid) return fail('حدد العضو.');
                if (!settings.whitelist.includes(uid)) return fail('هذا العضو ليس بالوايت ليست.');
                settings.whitelist = settings.whitelist.filter(id => id !== uid);
                await settings.save();
                ensureProtections(settings);
                return done(`🗑️ أزلت <@${uid}> من الوايت ليست.`);
            }

            if (sub === 'list') return done(list());

            return fail('أمر whitelist فرعي غير معروف.');
        }

        // ================= PROTECT =================
        if (command === 'protect') {
            const names = {
                channels: 'الرومات', roles: 'الرتب', bans: 'الباند',
                spam: 'السبام', webhooks: 'الويب هوك'
            };

            const applies = ['channels', 'roles', 'bans', 'webhooks'];

            if (applies.includes(sub)) {
                const prot = settings.protections[sub];
                const enabled = opt('enabled');
                const limit = Number(opt('limit'));
                const timeframe = Number(opt('duration'));
                const action = opt('action');

                if (typeof enabled !== 'boolean') return fail(`اختر تفعيل/إيقاف لحماية ${names[sub]}.`);
                prot.enabled = enabled;
                if (limit > 0 && Number.isInteger(limit) && limit <= 50) prot.limit = limit;
                if (timeframe > 0) prot.timeframe = timeframe * 1000;
                if (action && PROTECTION_ACTIONS.includes(action)) prot.action = action;

                await settings.save();
                return done(
                    `🛡️ حماية ${names[sub]}\n` +
                    `الحالة: **${enabled ? 'مفعلة ✅' : 'متوقفة ❌'}**\n` +
                    `الحد: **${prot.limit}**\n` +
                    `العقوبة عند التجاوز: **${prot.action}**`
                );
            }

            if (sub === 'bots') {
                const enabled = opt('enabled');
                if (typeof enabled !== 'boolean') return fail('اختر تفعيل/إيقاف.');
                settings.protections.bots.enabled = enabled;
                await settings.save();
                return done(`🤖 حماية البوتات **${enabled ? 'مفعّلة ✅' : 'متوقفة ❌'}** (المرجع: رتبة البوت).`);
            }

            if (sub === 'invites') {
                const prot = settings.protections.invites;
                const enabled = opt('enabled');
                const code = String(opt('code') || '').trim().replace(/[^a-zA-Z0-9-]/g, '');
                const action = opt('action');
                const ch = resolveChannel(opt('channel'));

                if (typeof enabled !== 'boolean') return fail('اختر تفعيل/إيقاف.');

                if (enabled && !code) {
                    const invites = await guild.invites.fetch().catch(() => null);
                    const best = invites
                        ? Array.from(invites.values())
                            .filter(i => i.channel)
                            .sort((a, b) => (b.uses || 0) - (a.uses || 0))[0]
                        : null;
                    if (best) {
                        prot.code = best.code;
                        prot.channelId = best.channel.id;
                    } else {
                        return fail('ما فيه اختصار بالسيرفر — فعّل الحماية بعد ما ينشئ أحد اختصار.');
                    }
                } else if (enabled && code) {
                    prot.code = code;
                    if (ch) prot.channelId = ch.id;
                }

                prot.enabled = enabled;
                if (action && PROTECTION_ACTIONS.includes(action)) prot.action = action;
                await settings.save();
                return done(`🔗 حماية اختصار السيرفر **${enabled ? 'مفعّلة ✅' : 'متوقفة ❌'}**\nاختصار محمي: \`${prot.code || '—'}\``);
            }

            if (sub === 'status') {
                const p = settings.protections;
                const on = v => (v ? '✅' : '❌');
                const lines = [
                    `الرومات: ${on(p.channels?.enabled)}`,
                    `الرتب: ${on(p.roles?.enabled)}`,
                    `الباند: ${on(p.bans?.enabled) || on(p.ban?.enabled)}`,
                    `البوتات: ${on(p.bots?.enabled)}`,
                    `السبام: ${on(p.spam?.enabled)}`,
                    `الويب هوك: ${on(p.webhooks?.enabled)}`,
                    `الاختصار: ${on(p.invites?.enabled)}`
                ];
                return done(`🛡️ **حالة الحمايات**\n${lines.join('\n')}`);
            }

            return fail('أمر protect فرعي غير معروف.');
        }

        // ================= ANTISPAM =================
        if (command === 'antispam') {
            if (sub === 'spam') {
                const prot = settings.protections.spam;
                const enabled = opt('enabled');
                const limit = Number(opt('limit'));
                const timeframe = Number(opt('duration'));
                const action = opt('action');
                const maxLength = Number(opt('maxlength'));
                const repeated = Number(opt('repeated'));

                if (typeof enabled !== 'boolean') return fail('اختر تفعيل/إيقاف.');
                prot.enabled = enabled;
                if (limit > 0) prot.limit = limit;
                if (timeframe > 0) prot.timeframe = timeframe * 1000;
                if (action && PROTECTION_ACTIONS.includes(action)) prot.action = action;
                if (maxLength > 0) prot.maxLength = maxLength;
                if (repeated > 0) prot.repeatedChar = repeated;

                prot.metrics = prot.metrics || {};
                if (limit > 0) prot.metrics.messages = limit;
                if (maxLength > 0) prot.metrics.length = maxLength;
                if (repeated > 0) prot.metrics.repeat = repeated;
                for (const key of ['mentions', 'spaces', 'bigtext', 'files']) {
                    const v = Number(opt(key));
                    if (v >= 0) prot.metrics[key] = v;
                }

                const links = opt('links');
                const invitesOpt = opt('invites');
                if (typeof links === 'boolean') prot.onLinks = links;
                if (typeof invitesOpt === 'boolean') prot.onInvites = invitesOpt;

                await settings.save();
                return done(
                    `🛡️ حماية السبام\n` +
                    `الحالة: **${enabled ? 'مفعّلة ✅' : 'متوقفة ❌'}**\n` +
                    `الحد: **${prot.limit}** رسالة | الفترة: **${Math.round((prot.timeframe || 5000) / 1000)} ثانية**\n` +
                    `أقصى طول رسالة: **${prot.maxLength}** | تكرار الحرف: **${prot.repeatedChar}**\n` +
                    `روابط خارجية: **${prot.onLinks !== false ? 'محظورة 🚫' : 'مسموحة ✅'}** | دعوات: **${prot.onInvites !== false ? 'محظورة 🚫' : 'مسموحة ✅'}**`
                );
            }

            if (sub === 'scams') {
                const prot = settings.protections.scams;
                const enabled = opt('enabled');
                const channel = resolveChannel(opt('channel'));
                const clear = opt('clear');
                const talk = opt('talk');
                const image = opt('image');
                const link = opt('link');
                const action = opt('action');

                if (typeof enabled !== 'boolean') return fail('اختر تفعيل/إيقاف.');

                if (channel) prot.channelIds = [channel.id];
                if (clear === true) prot.channelIds = [];
                if (typeof talk === 'boolean') prot.onTalk = talk;
                if (typeof image === 'boolean') prot.onImage = image;
                if (typeof link === 'boolean') prot.onLink = link;
                if (action && PROTECTION_ACTIONS.includes(action)) prot.action = action;

                prot.enabled = enabled;

                const hasChannels = (prot.channelIds || []).length > 0;
                const hasRules = prot.onTalk || prot.onImage || prot.onLink;
                if (enabled && (!hasChannels || !hasRules)) {
                    return fail('حدد روم محمي واحد + قاعدة واحدة على الأقل قبل التفعيل.');
                }

                await settings.save();
                return done(`🛡️ حماية النصب **${enabled ? 'مفعّلة ✅' : 'متوقفة ❌'}**\nرومات محمية: ${(prot.channelIds || []).length} | قواعد: ${['كلام', 'صورة', 'رابط'].filter((_, i) => [prot.onTalk, prot.onImage, prot.onLink][i]).join('، ') || '—'}`);
            }

            return fail('أمر antispam فرعي غير معروف.');
        }

        // ================= GIVEAWAY =================
        if (command === 'giveaway') {
            if (sub === 'setup') {
                const ch = resolveChannel(opt('channel'));
                if (!ch) return fail('حدد روم نصي.');
                settings.giveawayChannelId = ch.id;
                await settings.save();
                return done(`✅ تم تحديد روم السحوبات: ${ch}`);
            }

            if (sub === 'start') {
                const prize = String(opt('prize') || '').trim();
                const minutes = Number(opt('duration'));
                const winners = Math.max(1, Number(opt('winners')) || 1);
                const role = opt('role') ? resolveRole(opt('role')) : null;
                const requireAvatar = opt('require_avatar') !== false;
                const requireTag = opt('require_tag') !== false;

                if (!prize) return fail('الجائزة مطلوبة.');
                if (!(minutes > 0)) return fail('حدد مدة السحب بالدقائق.');

                let ch = resolveChannel(opt('channel'));
                if (!ch) ch = settings.giveawayChannelId ? guild.channels.cache.get(settings.giveawayChannelId) : null;
                if (!ch || !ch.isTextBased()) return fail('حدد روم نصي أو اضبطه أولاً عبر /giveaway setup.');

                const endsAt = new Date(Date.now() + minutes * 60 * 1000);
                const gw = await giveaways.Giveaway.create({
                    guildId: guild.id,
                    channelId: ch.id,
                    hostId: actorId,
                    prize,
                    winnersCount: winners,
                    endsAt,
                    requirements: { roleId: role ? role.id : null, requireAvatar, requireTag },
                    entries: []
                });

                const msg = await ch.send({
                    embeds: [giveaways.buildEmbed(gw.toObject(), guild, false)],
                    components: [giveaways.actionRow(gw._id.toString())]
                });
                gw.messageId = msg.id;
                await gw.save();

                giveaways.log(guild, '🎁 Giveaway Started', `تم إنشاء سحب **${prize}** في ${ch} من الداشبورد بواسطة <@${actorId}>.`);
                return done(`🎁 تم إنشاء السحب في ${ch} — ينتهي بعد **${minutes}** دقيقة.`);
            }

            if (sub === 'end') {
                const messageId = String(opt('message_id') || '').trim();
                const gw = await giveaways.Giveaway.findOne({ guildId: guild.id, messageId, ended: false }).lean();
                if (!gw) return fail('ما لقيت سحب نشط بهذا الـ ID.');
                const doc = await giveaways.Giveaway.findById(gw._id).catch(() => null);
                if (!doc) return fail('ما لقيت السحب.');
                await giveaways.endGiveaway(doc);
                return done(`✅ تم إنهاء السحب **${gw.prize}**.`);
            }

            if (sub === 'reroll') {
                const messageId = String(opt('message_id') || '').trim();
                const gw = await giveaways.Giveaway.findOne({ guildId: guild.id, messageId }).lean();
                if (!gw || !gw.ended) return fail('ما لقيت سحب منتهي بهذا الـ ID.');
                const doc = await giveaways.Giveaway.findById(gw._id).catch(() => null);
                const picked = await giveaways.pickWinners(guild, doc);
                return done(picked && picked.length
                    ? `🎉 أُعيد سحب الفائزين: ${picked.map(id => `<@${id}>`).join('، ')}`
                    : '😔 ما فيه مشارك ينطبق عليه الشرط.');
            }

            if (sub === 'list') {
                const list = await giveaways.Giveaway.find({ guildId: guild.id })
                    .sort({ createdAt: -1 })
                    .limit(20)
                    .lean();
                if (!list.length) return done('ℹ️ ما فيه سحوبات بعد.');
                return done(list.map(gw =>
                    `**${gw.prize}** — ${gw.ended ? '⛔ منتهي' : `⏳ <t:${Math.floor(new Date(gw.endsAt).getTime() / 1000)}:R>`} · مشاركون ${(gw.entries || []).length} · \`id:${gw.messageId || '—'}\``
                ).join('\n'));
            }

            return fail('أمر giveaway فرعي غير معروف.');
        }

        // ================= TEMPROLE =================
        if (command === 'temprole') {
            if (sub === 'add') {
                const member = await resolveMember(opt('member'));
                const role = resolveRole(opt('role'));
                const key = String(opt('duration') || 'week');

                if (!member || !role) return fail('حدد العضو والرتبة.');
                const me = guild.members.me;
                if (!role.editable || role.managed || (me && role.position >= me.roles.highest.position)) {
                    return fail('ما أقدر أعطي رتبة فوق رتبتي أو رتبة بوت/مدارة.');
                }

                const durationMs = temproles.DURATIONS[key];
                if (durationMs === undefined) {
                    return fail(`المدة غير معروفة. المتاح: ${Object.keys(temproles.DURATIONS).join('، ')}`);
                }

                const expiresAt = durationMs === null ? null : new Date(Date.now() + durationMs);

                await member.roles.add(role, `[TempRole] ${temproles.DURATION_LABELS[key]} بواسطة <@${actorId}> (داشبورد)`);

                await temproles.TempRole.findOneAndUpdate(
                    { guildId: guild.id, userId: member.id, roleId: role.id },
                    { $set: { assignedBy: actorId, assignedAt: new Date(), expiresAt, notified: false } },
                    { upsert: true }
                );

                temproles.log(guild, '⏳ Temp Role Added', `أعطى <@${actorId}> رتبة **${role.name}** للعضو ${member} من الداشبورد (${temproles.DURATION_LABELS[key]}).`);
                return done(`⏳ تم إعطاء ${member} الرتبة ${role} لمدة **${temproles.DURATION_LABELS[key]}**.`);
            }

            if (sub === 'remove') {
                const member = await resolveMember(opt('member'));
                const role = resolveRole(opt('role'));
                if (!member || !role) return fail('حدد العضو والرتبة.');
                const doc = await temproles.TempRole.findOne({
                    guildId: guild.id, userId: member.id, roleId: role.id
                }).lean();
                if (!doc) return fail('ما فيه رتبة مؤقتة مسجلة بهذي البيانات.');
                await temproles.removeTempRole(doc, 'manual');
                temproles.log(guild, '⏳ Temp Role Removed', `أزال <@${actorId}> الرتبة المؤقتة **${role.name}** من ${member} من الداشبورد.`);
                return done(`✅ تمت إزالة الرتبة **${role.name}** من ${member}.`);
            }

            if (sub === 'list') {
                const list = await temproles.TempRole.find({ guildId: guild.id })
                    .sort({ expiresAt: 1 })
                    .limit(20)
                    .lean();
                if (!list.length) return done('ℹ️ ما فيه رتب مؤقتة مسجلة في هذا السيرفر.');
                return done(list.map((doc, i) => {
                    const r = guild.roles.cache.get(doc.roleId);
                    const expired = doc.expiresAt && new Date(doc.expiresAt).getTime() <= Date.now();
                    return `**${i + 1}.** <@${doc.userId}> — **${r ? r.name : doc.roleId}**\n└ ${doc.expiresAt ? (expired ? '⛔ منتهية' : `⏳ ${temproles.format(doc.expiresAt)}`) : '🔒 دائم'}`;
                }).join('\n'));
            }

            return fail('أمر temprole فرعي غير معروف.');
        }

        // ================= PUZZLE =================
        if (command === 'puzzle') {
            if (sub === 'start') {
                const code = String(opt('code') || '').trim();
                const prize = String(opt('prize') || '').trim();
                const hint = String(opt('hint') || '').trim();
                const role = opt('role') ? resolveRole(opt('role')) : null;
                const ch = resolveChannel(opt('channel'));

                if (!/^\d{4}$/.test(code)) return fail('الرمز لازم يكون **4 أرقام** بالضبط.');
                if (!prize) return fail('الجائزة مطلوبة.');
                if (!ch || !ch.isTextBased()) return fail('حدد روم نصي.');

                const pz = await puzzle.Puzzle.create({
                    guildId: guild.id,
                    channelId: ch.id,
                    code,
                    prize,
                    prizeRoleId: role ? role.id : null,
                    hint: hint || null,
                    createdBy: actorId
                });

                try {
                    const msg = await ch.send({
                        embeds: [puzzle.buildEmbed(pz.toObject())],
                        components: [puzzle.actionRow(pz._id.toString())]
                    });
                    pz.messageId = msg.id;
                    await pz.save();
                } catch (error) {
                    await pz.deleteOne().catch(() => {});
                    return fail(`فشل إرسال رسالة القفل: ${error.message}`);
                }

                puzzle.log(guild, '🔒 Puzzle Started', `قفل جديد من الداشبورد بواسطة <@${actorId}> في ${ch} — الجائزة: **${prize}**.`);
                return done(`🔒 تم إنشاء القفل في ${ch}.\n🔐 الرمز: \`${code}\` (خاص — ما يعرض لأحد).`);
            }

            if (sub === 'end') {
                const messageId = String(opt('message_id') || '').trim();
                const pz = await puzzle.Puzzle.findOne({ guildId: guild.id, messageId, solved: false }).lean();
                if (!pz) return fail('ما لقيت قفل نشط بهذا الـ ID.');

                await puzzle.Puzzle.updateOne({ _id: pz._id }, { $set: { solved: true } });

                const ch = guild.channels.cache.get(pz.channelId);
                if (ch && pz.messageId) {
                    const msg = await ch.messages.fetch(pz.messageId).catch(() => null);
                    if (msg) {
                        await msg.edit({
                            embeds: [new EmbedBuilder()
                                .setTitle('🔒 قفل ومفتاح')
                                .setColor(0xED4245)
                                .setDescription('⛔ تم إلغاء هذا القفل.')],
                            components: [puzzle.actionRow(pz._id.toString(), true)]
                        }).catch(() => {});
                    }
                }

                return done('✅ تم إلغاء القفل.');
            }

            if (sub === 'list') {
                const list = await puzzle.Puzzle.find({ guildId: guild.id, solved: false })
                    .sort({ createdAt: -1 })
                    .limit(20)
                    .lean();
                if (!list.length) return done('ℹ️ ما فيه أقفال نشطة.');
                return done(list.map(pz =>
                    `**${pz.prize}** — ${pz.hint ? `تلميح: ${pz.hint}` : 'بلا تلميح'} · \`id:${pz.messageId || '—'}\``
                ).join('\n'));
            }

            return fail('أمر puzzle فرعي غير معروف.');
        }

        // ================= TICKET =================
        if (command === 'ticket') {
            if (sub === 'setup') {
                const ch = resolveChannel(opt('channel'));
                const category = resolveChannel(opt('category'));
                const role = opt('role') ? resolveRole(opt('role')) : null;
                const logCh = resolveChannel(opt('log_channel'));
                const message = String(opt('message') || '').trim();

                if (!ch) return fail('حدد روم لوحة التكتات.');

                const data = {
                    enabled: true,
                    panelChannelId: ch.id,
                    categoryId: category ? category.id : undefined,
                    supportRoleId: role ? role.id : undefined,
                    logChannelId: logCh ? logCh.id : undefined,
                    welcomeMessage: message || undefined,
                    sendPanel: false
                };

                await tickets.configureFromDashboard(settings, data, guild);
                const sent = await tickets.sendPanelMessage(settings, guild, ch);
                return done(`🎫 تم تفعيل نظام التكتات — لوحة التكتات في ${ch}${sent ? ' 🛎️ نُشرت اللوحة.' : ' (فشل نشر اللوحة — راجع رتبة الوصول).'}`);
            }

            if (sub === 'send') {
                const ch = resolveChannel(opt('channel')) || (settings.tickets?.panelChannelId ? guild.channels.cache.get(settings.tickets.panelChannelId) : null);
                if (!ch) return fail('حدد روم النشر (أو عيّن روم اللوحة أولاً).');
                const sent = await tickets.sendPanelMessage(settings, guild, ch);
                return sent ? done(`🛎️ نُشرت لوحة التكتات في ${ch}.`) : fail('فشل النشر — النظام معطّل أو الروم ما ينفع.');
            }

            if (sub === 'option') {
                const mode = String(opt('mode') || '');
                const label = String(opt('label') || '').trim();
                const key = String(opt('key') || '').trim();
                const description = String(opt('description') || '').trim();
                const emoji = String(opt('emoji') || '').trim();
                const state = String(opt('state') || 'active');

                const cur = settings.tickets || { enabled: false, options: [] };

                if (mode === 'add') {
                    if (!label) return fail('اسم الخيار (label) مطلوب للإضافة.');
                    const cleanOpts = tickets.cleanOptions(cur.options || []);
                    if (cleanOpts.length >= tickets.MAX_OPTIONS) {
                        return fail(`ما تقدر تضيف أكثر من **${tickets.MAX_OPTIONS}** خيار.`);
                    }
                    const newKey = key || `opt-${Date.now()}`;
                    cleanOpts.push({
                        key: newKey, label, description: description || null,
                        emoji: emoji || null, suspended: state === 'suspended'
                    });
                    await tickets.configureFromDashboard(settings, { options: cleanOpts }, guild);
                    return done(`➕ أضفت خيار **"${label}"** للتكتات.`);
                }

                if (mode === 'state') {
                    if (!key) return fail('عيّن مفتاح الخيار key.');
                    const cleanOpts = tickets.cleanOptions(cur.options || []);
                    const found = cleanOpts.find(o => o.key === key);
                    if (!found) return fail('ما لقيت خيار بهذا المفتاح.');
                    found.suspended = state === 'suspended';
                    await tickets.configureFromDashboard(settings, { options: cleanOpts }, guild);
                    return done(`⏸️ الخيار **"${found.label}"** أصبح ${state === 'suspended' ? 'معلّقاً' : 'مفعّلاً'}.`);
                }

                if (mode === 'remove') {
                    if (!key) return fail('عيّن مفتاح الخيار key.');
                    const cleanOpts = tickets.cleanOptions(cur.options || []).filter(o => o.key !== key);
                    await tickets.configureFromDashboard(settings, { options: cleanOpts }, guild);
                    return done(`➖ حذفت الخيار بمفتاح **"${key}"**.`);
                }

                return fail('اختر mode: add / state / remove.');
            }

            if (sub === 'disable') {
                await tickets.configureFromDashboard(settings, { enabled: false }, guild);
                return done('⛔ تم إيقاف نظام التكتات بالكامل.');
            }

            if (sub === 'info') {
                const t = settings.tickets || {};
                const options = tickets.ticketOptions(settings);
                const lines = [
                    `🎫 نظام التكتات: **${t.enabled ? 'مفعّل ✅' : 'متوقف ❌'}**`,
                    `🖥️ روم اللوحة: ${t.panelChannelId ? `<#${t.panelChannelId}>` : '—'}`,
                    `🗂️ الكاتقري: ${t.categoryId ? `<#${t.categoryId}>` : '—'}`,
                    `🛎️ رتبة الدعم: ${t.supportRoleId ? `<@&${t.supportRoleId}>` : '—'}`,
                    `📑 سجل التكتات: ${t.logChannelId ? `<#${t.logChannelId}>` : '—'}`,
                    `🗂️ الخيارات: **${options.length}**`
                ];
                if (options.length) {
                    lines.push(options.map(o => `· ${o.emoji || '🎯'} **${o.label}**${o.suspended ? ' ⏸️' : ''} — \`${o.key}\``).join('\n'));
                }
                return done(lines.join('\n'));
            }

            if (sub === 'image') {
                if (group === 'set') {
                    const url = String(opt('url') || '').trim();
                    if (!/^https?:\/\/.+/i.test(url)) return fail('أرسل رابط صورة مباشر.');
                    const cur = settings.tickets || {};
                    const data = { welcomeImage: url, panelImage: cur.panelImage || null };
                    await tickets.configureFromDashboard(settings, data, guild);
                    return done('🖼️ تم تعيين صورة الإيمبد داخل التكت.');
                }
                if (group === 'panel') {
                    const url = String(opt('url') || '').trim();
                    if (!/^https?:\/\/.+/i.test(url)) return fail('أرسل رابط صورة مباشر.');
                    const cur = settings.tickets || {};
                    const data = { panelImage: url, welcomeImage: cur.welcomeImage || null };
                    await tickets.configureFromDashboard(settings, data, guild);
                    return done('🖼️ تم تعيين صورة لوحة التكتات.');
                }
                if (group === 'remove') {
                    await tickets.configureFromDashboard(settings, { panelImage: null, welcomeImage: null }, guild);
                    return done('🖼️ حذفت كل صور التكتات.');
                }
            }

            return fail('أمر ticket فرعي غير معروف.');
        }

        // ================= BACKUP / RESTORE =================
        if (command === 'backup') {
            const res = await captureGuildBackup(guild, 'manual');
            if (!res.saved) return fail(res.error || 'ما نجحت النسخة.');
            await sendLog(guild, 'moderation', '📦 Backup', `<@${actorId}> أنشأ نسخة احتياطية من الداشبورد.`, 0x5865F2);
            return done(
                `📦 تم حفظ نسخة احتياطية كاملة.\n` +
                `الرومات: **${res.channels}** | الرتب: **${res.roles}** | الإيموجي: **${res.emojis}** | ستيكرات: **${res.stickers}**\n` +
                (res.protections ? `🛡️ إعدادات الحماية مضمّنة أيضاً.` : '')
            );
        }

        if (command === 'restore') {
            const res = await restoreGuildFromBackup(guild, null);
            if (res.error) {
                const map = { 'no-backup': 'ما فيه نسخة احتياطية لهذا السيرفر.', 'empty-backup': 'النسخة فاضية.' };
                return fail(map[res.error] || res.error);
            }
            await sendLog(guild, 'moderation', '♻️ Restore', `<@${actorId}> استرجع نسخة احتياطية من الداشبورد.`, 0x57F287);
            return done(
                `♻️ اكتمل الاسترجاع من النسخة الاحتياطية.\n` +
                `رومات أنشئت: **${res.restoredChannels.length}** | رتب أنشئت: **${res.restoredRoles.length}**\n` +
                `رومات حُذفت: **${res.deletedChannels}** | رتب حُذفت: **${res.deletedRoles}**\n` +
                (res.protectionsApplied ? '🛡️ إعدادات الحماية استرجعت أيضاً.' : '')
            );
        }

        // ================= SECURITY AUDIT =================
        if (command === 'security-audit') {
            const isOwnerHere = String(guild.ownerId) === String(actorId) || isBotOwner(actorId);
            if (!isOwnerHere) return fail('❌ هذا التقرير للمالك فقط.');
            const embed = await securityAudit.buildReport(guild);
            return {
                ok: true,
                message: '🛡️ تقرير أمني شامل — محضّر:',
                data: { type: 'report', report: embed.toJSON() }
            };
        }

        // ================= STATS =================
        if (command === 'stats') {
            const guilds = client.guilds.cache;
            const top = guilds
                .map(g => `${g.name} (${g.memberCount} عضو)`)
                .sort((a, b) => b.length - a.length)
                .slice(0, 10)
                .join('\n');
            return done(
                `📊 **إحصائيات البوت**\n\n` +
                `🖥️ السيرفرات: **${guilds.size}**\n` +
                `👥 إجمالي الأعضاء: **${guilds.reduce((s, g) => s + g.memberCount, 0)}**\n\n` +
                (guilds.size ? `**أكبر ${10} سيرفرات:**\n${top}` : 'البوت غير مفعل في أي سيرفر بعد.')
            );
        }
    } catch (error) {
        console.error('[DASHBOARD-EXEC]', error);
        return { ok: false, error: error?.message || 'خطأ غير متوقع.' };
    }

    // الأمر مو ضمن المدعومين
    return {
        ok: false,
        unsupported: true,
        error: `أمر \`/${command}\` ما يقدر ينفذ من الداشبورد.${dashboardUnsupportedReason(command) ? ` ${dashboardUnsupportedReason(command)}` : ''}`
    };
}

function mountDashboard(targetApp, deps) {
    try {
        if (!DASHBOARD_PATHS) {
            throw new Error(
                'ما لقيت dashboard/server.js — حطيت البوت في /home/container بس مجلد dashboard/ مو مرفوع أو فكّيت الضغط بمجلد فرعي.'
            );
        }

        require(DASHBOARD_ENTRY)(targetApp, deps);
        console.log('✅ Dashboard mounted on /  (' + DASHBOARD_ENTRY + ')');
        return true;
    } catch (error) {
        console.error(
            '\n==============================================\n' +
            '  ⚠️  تعذّر تركيب الداشبورد — البوت سيعمل بدون واجهة\n' +
            '==============================================\n' +
            '  السبب: ' + (error && error.message ? error.message : error) + '\n' +
            '  المتوقع هنا: ' + path.join(__dirname, 'dashboard', 'server.js') + '\n' +
            '  الحل: ارفع مجلد dashboard/ كامل بجانب index.js ثم أعد التشغيل.\n'
        );

        // صفحة تشخيص بديلة — أوضح من 404 أبيض
        targetApp.get('/', (req, res) => {
            res.status(503).type('html').send(dashboardFallbackPage(error.message || error));
        });

        return false;
    }
}


// ======================================================
// LOGIN
// ======================================================

// نظام التكتات — ربط الدوال الداخلية للبوت
tickets.init(client, {
    getSettings,
    sendLog,
    memberHasStaffRole,
    isServerAdmin
});

temproles.init(client, {
    getSettings,
    sendLog,
    isAllowed: interaction => isAdmin(interaction)
});

giveaways.init(client, {
    getSettings,
    sendLog,
    isAllowed: interaction => isAdmin(interaction)
});

puzzle.init(client, {
    getSettings,
    sendLog,
    isAllowed: interaction => isAdmin(interaction)
});

reactionroles.init(client, {
    getSettings,
    sendLog,
    isAllowed: interaction => isAdmin(interaction)
});

tempvoice.init(client, {
    getSettings,
    sendLog,
    isAllowed: interaction => isAdmin(interaction)
});

feedback.init(client, {
    getSettings,
    sendLog,
    isAllowed: interaction => isAdmin(interaction)
});

securityAudit.init({
    getSettings,
    ensureProtections,
    OWNER_ID,
    STAFF_ROLE_NAME,
    GuildBackup,
    GuildBackupHistory
});

// الداشبورد — جبل على نفس الـ express app
// ⚠️was: require('./dashboard/server.js')(app, {...}) بدون حماية.
// أي إهمال لمجلد dashboard/ عند الرفع كان يوقف البوت كله بالكامل
// (Cannot find module './dashboard/server.js') والويب يطلع بعده 404.
mountDashboard(app, {
    client,
    GuildSettings,
    getSettings,
    ensureProtections,
    sendLog,
    jailMember,
    unjailMember,
    isServerAdmin,
    memberHasStaffRole,
    hasStaffAccess,
    DashboardUser,
    DashboardLog,
    STAFF_ROLE_NAME,
    OWNER_ID,
    normalizeText,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    AttachmentBuilder,
    PermissionsBitField,
    setRuntimeDashboardUrl,
    slashCommands,
    executeDashboardCommand,
    isDashboardCommandSupported
});

// ======================================================
// PRE-FLIGHT — افحص المتغيرات قبل ما تحاول تسجّل دخول
// ======================================================

if (!TOKEN) {
    console.error(
        '\n' +
        '==============================================\n' +
        '  ❌ ما لقيت توكن البوت!\n' +
        '==============================================\n' +
        '  المتغيّر المطلوب: DISCORD_TOKEN\n' +
        '  الملف المتوقع:   ' + __dirname + '/.env\n' +
        '  هل الملف موجود؟ ' + (require('fs').existsSync(`${__dirname}/.env`) ? 'نعم' : 'لا ❌ — ارفعه يدوياً') + '\n'
    );

    if (!MONGO_URI) {
        console.error('  وتحذير: MONGO_URI برضو ناقص — بدونه البوت ما راح يسجّل أي إعدادات.\n');
    }

    console.error('  ملاحظة: .env ما يرفع مع git — انسخه يدوياً لكل استضافة.\n');
    process.exit(1);
}

if (!looksLikeDiscordToken(TOKEN)) {
    // ❌ ما نرسل توكن فاشل لـ Discord — نطبع التشخيص ونوقف (أوضح بكثير من "TokenInvalid")
    console.error(
        '\n==============================================\n' +
        '  ❌ التوكن الموجود مو توكن ديسكورد!\n' +
        '==============================================\n' +
        '  المتغيّر اللي استخدمناه: ' + TOKEN_SOURCE + '\n' +
        '  الطول: ' + TOKEN.length + ' (المفروض ٥٩-٧٢)\n' +
        '  قطعنا كل المسافات وعلامات التنصيص — فالمشكلة بالمحتوى نفسه.\n\n' +
        '  غالباً واحد من هذي:\n' +
        '  ١. متغيّر ' + TOKEN_SOURCE + ' في اللوحة فيه توكن اللوحة مو توكنك\n' +
        '  ٢. نسخت المتغيّر بدون قيمة أو ناقص\n' +
        '  ٣. نسخت Application ID أو الـ Public Key بدال الـ Bot Token\n\n' +
        '  راجع المتغيّرات بالأسفل:\n'
    );

    printEnvDiagnostic();

    process.exit(1);
}

if (TOKEN_SOURCE === 'TOKEN') {
    console.warn(
        '⚠️  استخدمنا المتغيّر "TOKEN" مو "DISCORD_TOKEN" —\n' +
        '   غيّر اسمه في إعدادات الاستضافة إلى DISCORD_TOKEN لتفادي التعارض مع اللوحة.'
    );
}

if (!MONGO_URI) {
    console.warn('⚠️  MONGO_URI مو موجود — المونغو ما راح يتصل (كل الإعدادات بتضيع).');
} else if (!/^mongodb(\+srv)?:\/\//.test(MONGO_URI)) {
    console.error('❌ MONGO_URI شكله غلط — لازم يبدأ بـ mongodb:// أو mongodb+srv://');
    process.exit(1);
}

console.log('✅ ENV: التوكن موجود (طول ' + TOKEN.length + ') + MONGO_URI موجود');


client.login(TOKEN).catch((err) => {
    const code = err && err.code;
    const map = {
        TokenInvalid: 'التوكن غلط أو ملغى — روح https://discord.com/developers/applications → بوتك → Reset Token ونسخه من جديد.',
        TokenMissing: 'ما انبعت ولا توكن (فاضي).',
        TokenType: 'نوع التوكن غلط — لازم يكون Bot Token.',
        TokenPrivileges: 'التوكن ناقصه صلاحيات — فعّل Message Content Intent و Server Members Intent.'
    };

    console.error(
        '\n' +
        '==============================================\n' +
        '  ❌ فشل تسجيل الدخول: ' + (code || 'unknown') + '\n' +
        '==============================================\n' +
        '  ' + (map[code] || (err && err.message) || 'خطأ غير معروف') + '\n'
    );

    process.exit(1);
});
