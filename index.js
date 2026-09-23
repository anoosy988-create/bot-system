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
    AuditLogEvent
} = require('discord.js');

const mongoose = require('mongoose');
const express = require('express');

// ======================================================
// ENV
// ======================================================

const TOKEN = process.env.TOKEN;
const MONGO_URI = process.env.MONGO_URI;

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
        GatewayIntentBits.GuildVoiceStates
    ]
});

// ======================================================
// PERMISSIONS
// ======================================================

const ADMIN = PermissionsBitField.Flags.Administrator;

/*
    مهم:
    لا يوجد Owner Bypass هنا.
    أي Slash Command يحتاج Administrator.
*/

function isAdmin(interaction) {
    return interaction.member?.permissions?.has(ADMIN) === true;
}

async function requireAdmin(interaction) {
    if (isAdmin(interaction)) {
        return true;
    }

    const reply = {
        content: '❌ تحتاج صلاحية **Administrator** لاستخدام هذا الأمر.',
        ephemeral: true
    };

    if (interaction.replied || interaction.deferred) {
        await interaction.followUp(reply).catch(() => {});
    } else {
        await interaction.reply(reply).catch(() => {});
    }

    return false;
}

// ======================================================
// TEXT HELPERS
// ======================================================

function normalizeText(text) {
    return String(text || '')
        .trim()
        .replace(/\s+/g, ' ')
        .toLowerCase();
}

function safeChannelName(channel) {
    return channel?.name ? `#${channel.name}` : 'غير معروف';
}

// ======================================================
// WELCOME VARIABLES
// ======================================================

function replaceWelcomeVariables(message, member) {
    const guild = member.guild;

    /*
        guild.memberCount = العدد الحالي للسيرفر
        لذلك لو كان العدد 50 ثم خرج شخص وأصبح 49
        وبعدها دخل شخص جديد، يرجع العدد 50.
    */

    return String(message || '')
        .replace(/\{user\}/gi, `<@${member.id}>`)
        .replace(/\{username\}/gi, member.user.username)
        .replace(/\{tag\}/gi, member.user.tag)
        .replace(/\{server\}/gi, guild.name)
        .replace(/\{members\}/gi, String(guild.memberCount))
        .replace(/\{membercount\}/gi, String(guild.memberCount))
        .replace(/\{count\}/gi, String(guild.memberCount))
        .replace(/\{member\}/gi, String(guild.memberCount));
}

// ======================================================
// VANITY / INVITE HELPER
// ======================================================

function extractVanityCode(text) {
    const match = String(text || '').match(
        /(?:discord\.gg\/|discord\.com\/invite\/|discordapp\.com\/invite\/)([a-zA-Z0-9-]+)/i
    );

    if (match) {
        return match[1].toLowerCase();
    }

    const clean = String(text || '').trim().toLowerCase();

    if (/^[a-z0-9][a-z0-9-]*$/.test(clean)) {
        return clean;
    }

    return null;
}

// ======================================================
// LOG HELPER
// ======================================================

async function sendLog(
    guild,
    type,
    title,
    description,
    color = 0x5865F2
) {
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

        await channel.send({
            embeds: [embed]
        }).catch(() => {});
    } catch (error) {
        console.error('Log error:', error);
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

    // ==================================================
    // WELCOME
    // ==================================================

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
            default: 'أهلاً بك {user} في {server} ❤️'
        },

        image: {
            type: String,
            default: null
        }
    },

    // ==================================================
    // LOGS
    // ==================================================

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

    // ==================================================
    // AI
    // ==================================================

    aiChatChannelId: {
        type: String,
        default: null
    },

    aiCodeChannelId: {
        type: String,
        default: null
    },

    // ==================================================
    // AUTO RESPONSES
    // ==================================================

    autoresponses: {
        type: [
            {
                trigger: String,
                response: String,
                enabled: {
                    type: Boolean,
                    default: true
                }
            }
        ],
        default: []
    },

    // ==================================================
    // SHORTCUTS
    // ==================================================

    shortcuts: {
        type: [
            {
                name: String,
                command: String
            }
        ],
        default: []
    },

    // ==================================================
    // LEVEL SYSTEM
    // ==================================================

    levels: {
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

    // ==================================================
    // OLD GENERAL LOG
    // ==================================================

    logChannelId: {
        type: String,
        default: null
    }
});

const GuildSettings = mongoose.model(
    'GuildSettings',
    guildSchema
);


// ======================================================
// JAIL DATA
// ======================================================

const jailSchema = new mongoose.Schema({
    guildId: {
        type: String,
        required: true
    },

    userId: {
        type: String,
        required: true
    },

    roles: {
        type: [String],
        default: []
    }
});

jailSchema.index(
    {
        guildId: 1,
        userId: 1
    },
    {
        unique: true
    }
);

const JailData = mongoose.model(
    'JailData',
    jailSchema
);


// ======================================================
// LEVEL DATA
// ======================================================

const levelSchema = new mongoose.Schema({
    guildId: {
        type: String,
        required: true
    },

    userId: {
        type: String,
        required: true
    },

    messages: {
        type: Number,
        default: 0
    },

    level: {
        type: Number,
        default: 0
    }
});

levelSchema.index(
    {
        guildId: 1,
        userId: 1
    },
    {
        unique: true
    }
);

const UserLevel = mongoose.model(
    'UserLevel',
    levelSchema
);


// ======================================================
// GET GUILD SETTINGS
// ======================================================

async function getSettings(guildId) {
    let settings = await GuildSettings.findById(guildId);

    if (!settings) {
        settings = await GuildSettings.create({
            _id: guildId
        });
    }

    return settings;
}
// ======================================================
// SLASH COMMANDS
// EVERY COMMAND = ADMINISTRATOR
// ======================================================

const slashCommands = [

    // =========================
    // MODERATION
    // =========================

    new SlashCommandBuilder()
        .setName('jail')
        .setDescription('سجن عضو')
        .setDefaultMemberPermissions(ADMIN)
        .addUserOption(o =>
            o.setName('user')
                .setDescription('العضو المراد سجنه')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('unjail')
        .setDescription('فك سجن عضو')
        .setDefaultMemberPermissions(ADMIN)
        .addUserOption(o =>
            o.setName('user')
                .setDescription('العضو المراد فك سجنه')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('حظر عضو من السيرفر')
        .setDefaultMemberPermissions(ADMIN)
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
        .setDefaultMemberPermissions(ADMIN)
        .addStringOption(o =>
            o.setName('user_id')
                .setDescription('آيدي العضو')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('kick')
        .setDescription('طرد عضو')
        .setDefaultMemberPermissions(ADMIN)
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
        .setDefaultMemberPermissions(ADMIN)
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
        .setDefaultMemberPermissions(ADMIN)
        .addUserOption(o =>
            o.setName('user')
                .setDescription('العضو')
                .setRequired(true)
        ),

    // =========================
    // ROLES
    // =========================

    new SlashCommandBuilder()
        .setName('role-add')
        .setDescription('إعطاء رتبة لعضو')
        .setDefaultMemberPermissions(ADMIN)
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
        .setDefaultMemberPermissions(ADMIN)
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

    // =========================
    // MESSAGES
    // =========================

    new SlashCommandBuilder()
        .setName('purge')
        .setDescription('حذف عدد من الرسائل')
        .setDefaultMemberPermissions(ADMIN)
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
        .setDefaultMemberPermissions(ADMIN)
        .addChannelOption(o =>
            o.setName('channel')
                .setDescription('الروم المراد قفله')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('unlock')
        .setDescription('فتح الروم')
        .setDefaultMemberPermissions(ADMIN)
        .addChannelOption(o =>
            o.setName('channel')
                .setDescription('الروم المراد فتحه')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)
        ),

    // =========================
    // WELCOME
    // =========================

    new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('إعداد رسالة الترحيب')
        .setDefaultMemberPermissions(ADMIN)
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('تفعيل وإعداد الترحيب')
                .addChannelOption(o =>
                    o.setName('channel')
                        .setDescription('روم الترحيب')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
                .addStringOption(o =>
                    o.setName('message')
                        .setDescription('رسالة الترحيب')
                        .setRequired(true)
                )
                .addStringOption(o =>
                    o.setName('image')
                        .setDescription('رابط صورة الترحيب - اختياري')
                        .setRequired(false)
                )
        )
        .addSubcommand(sub =>
            sub.setName('disable')
                .setDescription('إيقاف الترحيب')
        ),

    // =========================
    // AUTO RESPONSE
    // =========================

    new SlashCommandBuilder()
        .setName('autoresponse')
        .setDescription('إدارة الردود التلقائية')
        .setDefaultMemberPermissions(ADMIN)
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('إضافة رد تلقائي')
                .addStringOption(o =>
                    o.setName('trigger')
                        .setDescription('الكلمة التي تشغل الرد')
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
                .setDescription('عرض الردود التلقائية')
        ),

    // =========================
    // SHORTCUT
    // =========================

    new SlashCommandBuilder()
        .setName('shortcut')
        .setDescription('إدارة اختصارات الأوامر')
        .setDefaultMemberPermissions(ADMIN)
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('إضافة اختصار')
                .addStringOption(o =>
                    o.setName('name')
                        .setDescription('اسم الاختصار مثل برا')
                        .setRequired(true)
                )
                .addStringOption(o =>
                    o.setName('command')
                        .setDescription('الأمر الذي ينفذه الاختصار')
                        .setRequired(true)
                        .addChoices(
                            { name: '🔒 jail', value: 'jail' },
                            { name: '🔓 unjail', value: 'unjail' },
                            { name: '🔨 ban', value: 'ban' },
                            { name: '♻️ unban', value: 'unban' },
                            { name: '👢 kick', value: 'kick' },
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
                .setDescription('عرض الاختصارات')
        ),

    // =========================
    // LOGS
    // =========================

    new SlashCommandBuilder()
        .setName('logs')
        .setDescription('إعداد سجلات السيرفر')
        .setDefaultMemberPermissions(ADMIN),

    // =========================
    // LEVEL
    // =========================

    new SlashCommandBuilder()
        .setName('level')
        .setDescription('عرض مستوى عضو')
        .setDefaultMemberPermissions(ADMIN)
        .addUserOption(o =>
            o.setName('user')
                .setDescription('العضو')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('level-settings')
        .setDescription('إعداد نظام المستويات')
        .setDefaultMemberPermissions(ADMIN)
        .addIntegerOption(o =>
            o.setName('messages')
                .setDescription('عدد الرسائل لكل مستوى')
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

    // =========================
    // AI
    // =========================

    new SlashCommandBuilder()
        .setName('setchat')
        .setDescription('تعيين روم الذكاء الاصطناعي')
        .setDefaultMemberPermissions(ADMIN)
        .addChannelOption(o =>
            o.setName('channel')
                .setDescription('روم الذكاء الاصطناعي')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('setcode')
        .setDescription('تعيين روم توليد الأكواد')
        .setDefaultMemberPermissions(ADMIN)
        .addChannelOption(o =>
            o.setName('channel')
                .setDescription('روم الأكواد')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('setlog')
        .setDescription('تعيين روم السجلات العام')
        .setDefaultMemberPermissions(ADMIN)
        .addChannelOption(o =>
            o.setName('channel')
                .setDescription('روم السجلات')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
        )
].map(command => command.toJSON());
// ======================================================
// MONGODB CONNECTION
// ======================================================

mongoose.connect(MONGO_URI)
    .then(() => {
        console.log('✅ Connected to MongoDB');
    })
    .catch(error => {
        console.error('❌ MongoDB connection error:', error);
    });


// ======================================================
// REGISTER SLASH COMMANDS
// ======================================================

client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);

    try {
        await client.application.commands.set(slashCommands);

        console.log(
            `✅ Registered ${slashCommands.length} slash commands`
        );
    } catch (error) {
        console.error(
            '❌ Failed to register slash commands:',
            error
        );
    }
});
// ======================================================
// WELCOME SYSTEM
// ======================================================

client.on('guildMemberAdd', async member => {
    try {
        const settings = await getSettings(member.guild.id);

        if (!settings.welcome?.enabled) return;

        if (!settings.welcome.channelId) return;

        const channel = member.guild.channels.cache.get(
            settings.welcome.channelId
        );

        if (!channel || !channel.isTextBased()) return;

        // العدد الحالي الحقيقي للسيرفر وقت دخول العضو
        const memberCount = member.guild.memberCount;

        const message = replaceWelcomeVariables(
            settings.welcome.message,
            member
        );

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setDescription(message)
            .addFields(
                {
                    name: '👤 العضو',
                    value: `${member}`,
                    inline: true
                },
                {
                    name: '👥 عدد الأعضاء',
                    value: `**${memberCount}**`,
                    inline: true
                }
            )
            .setThumbnail(
                member.user.displayAvatarURL({
                    extension: 'png',
                    size: 256
                })
            )
            .setTimestamp();

        // إذا فيه صورة مخصصة للترحيب
        if (settings.welcome.image) {
            embed.setImage(settings.welcome.image);
        }

        await channel.send({
            content: `${member}`,
            embeds: [embed]
        });

        await sendLog(
            member.guild,
            'member',
            '👋 Member Joined',
            `**${member.user.tag}** دخل السيرفر.\n\nعدد الأعضاء الحالي: **${memberCount}**`,
            0x57F287
        );

    } catch (error) {
        console.error('❌ Welcome error:', error);
    }
});
// ======================================================
// CONTINUATION OF INTERACTION HANDLER
// ======================================================

// ==========================================
// BAN
// ==========================================

if (command === 'ban') {

    const user = interaction.options.getUser('user');

    const reason =
        interaction.options.getString('reason') ||
        'بدون سبب';

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

    try {

        await interaction.guild.members.ban(
            user.id,
            {
                reason: `${reason} | بواسطة ${interaction.user.tag}`
            }
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

    } catch (error) {

        console.error('Ban error:', error);

        return interaction.reply({
            content:
                '❌ حدث خطأ أثناء محاولة حظر العضو.',
            ephemeral: true
        });
    }
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

    const user =
        interaction.options.getUser('user');

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

    // لا يوجد Owner Protection هنا
    if (!member.kickable) {
        return interaction.reply({
            content:
                '❌ لا أستطيع طرد هذا العضو. تأكد من ترتيب الرتب.',
            ephemeral: true
        });
    }

    try {

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

    } catch (error) {

        console.error('Kick error:', error);

        return interaction.reply({
            content:
                '❌ حدث خطأ أثناء محاولة طرد العضو.',
            ephemeral: true
        });
    }
}


// ==========================================
// TIMEOUT
// ==========================================

if (command === 'timeout') {

    const user =
        interaction.options.getUser('user');

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

    try {

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

    } catch (error) {

        console.error('Timeout error:', error);

        return interaction.reply({
            content:
                '❌ حدث خطأ أثناء إعطاء الـ Timeout.',
            ephemeral: true
        });
    }
}


// ==========================================
// UNTIMEOUT
// ==========================================

if (command === 'untimeout') {

    const user =
        interaction.options.getUser('user');

    const member =
        await interaction.guild.members.fetch(user.id)
            .catch(() => null);

    if (!member) {
        return interaction.reply({
            content: '❌ العضو غير موجود.',
            ephemeral: true
        });
    }

    try {

        await member.timeout(
            null,
            `Untimeout بواسطة ${interaction.user.tag}`
        );

        return interaction.reply(
            `🔓 تم إزالة التايم أوت عن ${member}.`
        );

    } catch (error) {

        console.error('Untimeout error:', error);

        return interaction.reply({
            content:
                '❌ حدث خطأ أثناء إزالة الـ Timeout.',
            ephemeral: true
        });
    }
}


// ==========================================
// ROLE ADD
// ==========================================

if (command === 'role-add') {

    const user =
        interaction.options.getUser('user');

    const role =
        interaction.options.getRole('role');

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

    try {

        await member.roles.add(
            role,
            `Role add بواسطة ${interaction.user.tag}`
        );

        await sendLog(
            interaction.guild,
            'moderation',
            '🎭 Role Added',
            `${interaction.user} أعطى ${role} إلى ${member}.`
        );

        return interaction.reply(
            `🎭 تم إعطاء ${member} الرتبة ${role}.`
        );

    } catch (error) {

        console.error('Role add error:', error);

        return interaction.reply({
            content:
                '❌ حدث خطأ أثناء إعطاء الرتبة.',
            ephemeral: true
        });
    }
}


// ==========================================
// ROLE REMOVE
// ==========================================

if (command === 'role-remove') {

    const user =
        interaction.options.getUser('user');

    const role =
        interaction.options.getRole('role');

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

    try {

        await member.roles.remove(
            role,
            `Role remove بواسطة ${interaction.user.tag}`
        );

        await sendLog(
            interaction.guild,
            'moderation',
            '🎭 Role Removed',
            `${interaction.user} أزال ${role} من ${member}.`
        );

        return interaction.reply(
            `🎭 تم إزالة ${role} من ${member}.`
        );

    } catch (error) {

        console.error('Role remove error:', error);

        return interaction.reply({
            content:
                '❌ حدث خطأ أثناء إزالة الرتبة.',
            ephemeral: true
        });
    }
}


// ==========================================
// PURGE
// ==========================================

if (command === 'purge') {

    const amount =
        interaction.options.getInteger('amount');

    const channel = interaction.channel;

    if (!channel || !channel.isTextBased()) {
        return interaction.reply({
            content: '❌ هذا الأمر يعمل داخل روم كتابي فقط.',
            ephemeral: true
        });
    }

    try {

        const deleted =
            await channel.bulkDelete(
                amount,
                true
            );

        return interaction.reply({
            content:
                `🗑️ تم حذف **${deleted.size}** رسالة.`,
            ephemeral: true
        });

    } catch (error) {

        console.error('Purge error:', error);

        return interaction.reply({
            content:
                '❌ حدث خطأ أثناء حذف الرسائل.',
            ephemeral: true
        });
    }
}


// ==========================================
// LOCK
// ==========================================

if (command === 'lock') {

    const channel =
        interaction.options.getChannel('channel') ||
        interaction.channel;

    try {

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

    } catch (error) {

        console.error('Lock error:', error);

        return interaction.reply({
            content:
                '❌ لم أستطع قفل الروم.',
            ephemeral: true
        });
    }
}


// ==========================================
// UNLOCK
// ==========================================

if (command === 'unlock') {

    const channel =
        interaction.options.getChannel('channel') ||
        interaction.channel;

    try {

        await channel.permissionOverwrites.edit(
            interaction.guild.roles.everyone,
            {
                SendMessages: null
            }
        );

        await sendLog(
            interaction.guild,
            'moderation',
            '🔓 Channel Unlocked',
            `${channel} تم فتحه بواسطة ${interaction.user}.`
        );

        return interaction.reply(
            `🔓 تم فتح ${channel}.`
        );

    } catch (error) {

        console.error('Unlock error:', error);

        return interaction.reply({
            content:
                '❌ لم أستطع فتح الروم.',
            ephemeral: true
        });
    }
}
// ======================================================
// WELCOME SYSTEM
// ======================================================

client.on('guildMemberAdd', async member => {
    try {
        const settings = await getSettings(member.guild.id);

        if (!settings.welcome?.enabled) return;
        if (!settings.welcome.channelId) return;

        const channel = member.guild.channels.cache.get(
            settings.welcome.channelId
        );

        if (!channel || !channel.isTextBased()) return;

        // العدد الحقيقي للسيرفر وقت دخول العضو
        const count = member.guild.memberCount;

        const message = String(settings.welcome.message || '')
            .replace(/\{user\}/gi, `${member}`)
            .replace(/\{username\}/gi, member.user.username)
            .replace(/\{tag\}/gi, member.user.tag)
            .replace(/\{server\}/gi, member.guild.name)
            .replace(/\{count\}/gi, String(count))
            .replace(/\{members\}/gi, String(count))
            .replace(/\{membercount\}/gi, String(count));

        const embed = new EmbedBuilder()
            .setColor(0x5865F2)
            .setDescription(message)
            .addFields(
                {
                    name: '👤 العضو',
                    value: `${member}`,
                    inline: true
                },
                {
                    name: '👥 أعضاء السيرفر',
                    value: `**${count}**`,
                    inline: true
                }
            )
            .setThumbnail(
                member.user.displayAvatarURL({
                    extension: 'png',
                    size: 256
                })
            )
            .setTimestamp();

        // صورة الترحيب المخصصة
        if (settings.welcome.image) {
            embed.setImage(settings.welcome.image);
        }

        await channel.send({
            content: `${member}`,
            embeds: [embed]
        });

        await sendLog(
            member.guild,
            'member',
            '👋 Member Joined',
            `${member} دخل السيرفر.\nعدد الأعضاء الحالي: **${count}**`,
            0x57F287
        );

    } catch (error) {
        console.error('Welcome error:', error);
    }
});
new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('إعداد نظام الترحيب')
    .setDefaultMemberPermissions(ADMIN)

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
                    .setDescription('رسالة الترحيب')
                    .setRequired(true)
            )

            .addStringOption(o =>
                o.setName('image')
                    .setDescription('رابط صورة الترحيب')
                    .setRequired(false)
            )
    )

    .addSubcommand(sub =>
        sub.setName('off')
            .setDescription('إيقاف الترحيب')
    ),if (command === 'welcome') {

    const sub =
        interaction.options.getSubcommand();

    const settings =
        await getSettings(interaction.guild.id);

    if (sub === 'set') {

        const channel =
            interaction.options.getChannel('channel');

        const message =
            interaction.options.getString('message');

        const image =
            interaction.options.getString('image');

        settings.welcome.enabled = true;
        settings.welcome.channelId = channel.id;
        settings.welcome.message = message;
        settings.welcome.image = image || null;

        await settings.save();

        return interaction.reply({
            content:
                `✅ تم إعداد الترحيب في ${channel}.\n\n` +
                `المتغيرات المتاحة:\n` +
                '`{user}` = منشن العضو\n' +
                '`{username}` = اسم العضو\n' +
                '`{tag}` = تاق العضو\n' +
                '`{server}` = اسم السيرفر\n' +
                '`{count}` = عدد أعضاء السيرفر\n' +
                '`{members}` = عدد أعضاء السيرفر\n' +
                '`{membercount}` = عدد أعضاء السيرفر\n\n' +
                `🖼️ الصورة: ${image ? 'مضافة ✅' : 'بدون صورة'}`,
            ephemeral: true
        });
    }

    if (sub === 'off') {

        settings.welcome.enabled = false;

        await settings.save();

        return interaction.reply({
            content: '❌ تم إيقاف نظام الترحيب.',
            ephemeral: true
        });
    }
}
// ======================================================
// AUTO RESPONSE LIST
// ======================================================

async function sendAutoResponseList(
    interaction,
    settings,
    followUp = false
) {
    const embed = new EmbedBuilder()
        .setTitle('🤖 الردود التلقائية')
        .setColor(0x5865F2)
        .setTimestamp();

    if (!settings.autoResponses?.length) {

        embed.setDescription(
            'لا توجد ردود تلقائية حاليًا.'
        );

    } else {

        embed.setDescription(
            settings.autoResponses
                .map((item, index) =>
                    `**${index + 1}.** \`${item.trigger}\` → ${item.response}`
                )
                .join('\n')
        );
    }

    embed.setFooter({
        text:
            `عدد الردود: ${settings.autoResponses?.length || 0}`
    });

    if (followUp) {
        return interaction.followUp({
            embeds: [embed],
            ephemeral: true
        });
    }

    return interaction.reply({
        embeds: [embed],
        ephemeral: true
    });
}


// ======================================================
// AUTO RESPONSE SELECT
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
                label: item.trigger.slice(0, 100),
                value: String(index),
                description:
                    item.response.slice(0, 100)
            }));

    const row =
        new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(
                        `autoresponse_${action}`
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
}if (command === 'autoresponse') {

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

        const exists =
            settings.autoResponses.some(item =>
                normalizeText(item.trigger) ===
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

        return sendAutoResponseList(
            interaction,
            settings
        );
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
                    '❌ لا توجد ردود تلقائية.',
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
                    '❌ لا توجد ردود تلقائية.',
                ephemeral: true
            });
        }

        return showAutoResponseSelect(
            interaction,
            settings,
            'edit'
        );
    }
}// ======================================================
// AUTO RESPONSE MESSAGE SYSTEM
// ======================================================

client.on('messageCreate', async message => {

    try {

        if (message.author.bot) return;
        if (!message.guild) return;

        const settings =
            await getSettings(message.guild.id);

        if (!settings.autoResponses?.length) return;

        const content =
            normalizeText(message.content);

        const response =
            settings.autoResponses.find(item =>
                item.enabled !== false &&
                normalizeText(item.trigger) === content
            );

        if (!response) return;

        await message.reply(
            response.response
        );

    } catch (error) {

        console.error(
            'Auto response error:',
            error
        );

    }
});// ======================================================
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

    if (!settings.shortcuts?.length) {

        embed.setDescription(
            'لا توجد اختصارات حاليًا.'
        );

    } else {

        embed.setDescription(
            settings.shortcuts
                .map((shortcut, index) =>
                    `**${index + 1}.** \`${shortcut.name}\` → \`${shortcut.command}\``
                )
                .join('\n')
        );
    }

    embed.setFooter({
        text:
            `عدد الاختصارات: ${settings.shortcuts?.length || 0}`
    });

    if (followUp) {
        return interaction.followUp({
            embeds: [embed],
            ephemeral: true
        });
    }

    return interaction.reply({
        embeds: [embed],
        ephemeral: true
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
                    shortcut.command.slice(0, 100)
            }));

    const row =
        new ActionRowBuilder()
            .addComponents(
                new StringSelectMenuBuilder()
                    .setCustomId(
                        `shortcut_${action}`
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
}if (command === 'shortcut') {

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

        const exists =
            settings.shortcuts.some(item =>
                normalizeText(item.name) ===
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
            settings
        );
    }

    // REMOVE
    if (sub === 'remove') {

        if (!settings.shortcuts.length) {
            return interaction.reply({
                content:
                    '❌ لا توجد اختصارات.',
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
                    '❌ لا توجد اختصارات.',
                ephemeral: true
            });
        }

        return showShortcutSelect(
            interaction,
            settings,
            'edit'
        );
    }
}// ======================================================
// SHORTCUT EXECUTION
// ======================================================

client.on('messageCreate', async message => {

    try {

        if (message.author.bot) return;
        if (!message.guild) return;

        const settings =
            await getSettings(message.guild.id);

        if (!settings.shortcuts?.length) return;

        const content =
            message.content.trim();

        if (!content) return;

        const parts =
            content.split(/\s+/);

        const shortcutName =
            normalizeText(parts.shift());

        const shortcut =
            settings.shortcuts.find(item =>
                normalizeText(item.name) ===
                shortcutName
            );

        if (!shortcut) return;

        // الاختصارات إدارية
        if (
            !message.member.permissions.has(
                PermissionsBitField.Flags.Administrator
            )
        ) {
            return message.reply(
                '❌ تحتاج صلاحية **Administrator** لاستخدام هذا الاختصار.'
            );
        }

        const command =
            shortcut.command;

        // ==============================================
        // TARGET USER
        // ==============================================

        let targetMember = null;

        const mentioned =
            message.mentions.members.first();

        if (mentioned) {

            targetMember = mentioned;

        } else if (parts[0]) {

            const id =
                parts[0].replace(/[<@!>]/g, '');

            if (/^\d+$/.test(id)) {

                targetMember =
                    await message.guild.members.fetch(id)
                        .catch(() => null);
            }
        }

        // ==============================================
        // KICK
        // ==============================================

        if (command === 'kick') {

            if (!targetMember) {
                return message.reply(
                    '❌ حدد العضو.\nمثال: `برا @member`'
                );
            }

            if (!targetMember.kickable) {
                return message.reply(
                    '❌ لا أستطيع طرد هذا العضو بسبب ترتيب الرتب.'
                );
            }

            await targetMember.kick(
                `Shortcut بواسطة ${message.author.tag}`
            );

            return message.reply(
                `👢 تم طرد ${targetMember}.`
            );
        }

        // ==============================================
        // BAN
        // ==============================================

        if (command === 'ban') {

            if (!targetMember) {
                return message.reply(
                    '❌ حدد العضو.'
                );
            }

            if (!targetMember.bannable) {
                return message.reply(
                    '❌ لا أستطيع حظر هذا العضو بسبب ترتيب الرتب.'
                );
            }

            await targetMember.ban({
                reason:
                    `Shortcut بواسطة ${message.author.tag}`
            });

            return message.reply(
                `🔨 تم حظر ${targetMember}.`
            );
        }

        // ==============================================
        // JAIL
        // ==============================================

        if (command === 'jail') {

            if (!targetMember) {
                return message.reply(
                    '❌ حدد العضو.'
                );
            }

            await jailMember(targetMember);

            return message.reply(
                `🔒 تم سجن ${targetMember}.`
            );
        }

        // ==============================================
        // UNJAIL
        // ==============================================

        if (command === 'unjail') {

            if (!targetMember) {
                return message.reply(
                    '❌ حدد العضو.'
                );
            }

            const success =
                await unjailMember(targetMember);

            if (!success) {
                return message.reply(
                    '❌ العضو ليس مسجونًا.'
                );
            }

            return message.reply(
                `🔓 تم فك سجن ${targetMember}.`
            );
        }

        // ==============================================
        // ROLE ADD
        // ==============================================

        if (command === 'role-add') {

            if (!targetMember) {
                return message.reply(
                    '❌ حدد العضو.'
                );
            }

            const role =
                message.mentions.roles.first();

            if (!role) {
                return message.reply(
                    '❌ منشن الرتبة أيضًا.'
                );
            }

            if (!role.editable) {
                return message.reply(
                    '❌ لا أستطيع إعطاء هذه الرتبة.'
                );
            }

            await targetMember.roles.add(role);

            return message.reply(
                `🎭 تم إعطاء ${role} إلى ${targetMember}.`
            );
        }

        // ==============================================
        // ROLE REMOVE
        // ==============================================

        if (command === 'role-remove') {

            if (!targetMember) {
                return message.reply(
                    '❌ حدد العضو.'
                );
            }

            const role =
                message.mentions.roles.first();

            if (!role) {
                return message.reply(
                    '❌ منشن الرتبة أيضًا.'
                );
            }

            if (!role.editable) {
                return message.reply(
                    '❌ لا أستطيع إزالة هذه الرتبة.'
                );
            }

            await targetMember.roles.remove(role);

            return message.reply(
                `🎭 تم إزالة ${role} من ${targetMember}.`
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
                '🔒 تم قفل الروم.'
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
                '🔓 تم فتح الروم.'
            );
        }

    } catch (error) {

        console.error(
            'Shortcut error:',
            error
        );

    }
});// ======================================================
// LOG CHANNEL PANEL
// ======================================================

async function sendLogsPanel(interaction) {

    const embed = new EmbedBuilder()
        .setTitle('📋 إعدادات السجلات')
        .setDescription(
            'اختر نوع السجل الذي تريد تحديد روم له.'
        )
        .setColor(0x2b2d31);

    const menu = new StringSelectMenuBuilder()
        .setCustomId('logs_type_select')
        .setPlaceholder('اختر نوع السجل')
        .addOptions([
            {
                label: 'Voice',
                value: 'voice',
                description: 'سجل دخول وخروج وتغيير الرومات الصوتية'
            },
            {
                label: 'Role',
                value: 'role',
                description: 'سجل إنشاء وحذف وتعديل الرتب'
            },
            {
                label: 'Channel',
                value: 'channel',
                description: 'سجل إنشاء وحذف وتعديل الرومات'
            },
            {
                label: 'Webhook',
                value: 'webhook',
                description: 'سجل تغييرات Webhooks'
            },
            {
                label: 'Member',
                value: 'member',
                description: 'سجل دخول وخروج الأعضاء'
            },
            {
                label: 'Moderation',
                value: 'moderation',
                description: 'سجل العقوبات الإدارية'
            },
            {
                label: 'Message',
                value: 'message',
                description: 'سجل حذف وتعديل الرسائل'
            }
        ]);

    return interaction.reply({
        embeds: [embed],
        components: [
            new ActionRowBuilder().addComponents(menu)
        ],
        ephemeral: true
    });
}// ======================================================
// LOG TYPE SELECT
// ======================================================

client.on('interactionCreate', async interaction => {

    try {

        if (!interaction.isStringSelectMenu()) return;

        if (interaction.customId !== 'logs_type_select') return;

        if (!interaction.member.permissions.has(
            PermissionsBitField.Flags.Administrator
        )) {
            return interaction.reply({
                content:
                    '❌ تحتاج صلاحية **Administrator**.',
                ephemeral: true
            });
        }

        const type = interaction.values[0];

        const menu = new ChannelSelectMenuBuilder()
            .setCustomId(`logs_channel_select:${type}`)
            .setPlaceholder('اختر روم السجل')
            .setChannelTypes(ChannelType.GuildText);

        await interaction.update({
            content:
                `📋 اختر روم سجل **${type}**:`,
            embeds: [],
            components: [
                new ActionRowBuilder()
                    .addComponents(menu)
            ]
        });

    } catch (error) {

        console.error(
            'Logs select error:',
            error
        );

    }

});// ======================================================
// SAVE LOG CHANNEL
// ======================================================

client.on('interactionCreate', async interaction => {

    try {

        if (!interaction.isChannelSelectMenu()) return;

        if (!interaction.customId.startsWith(
            'logs_channel_select:'
        )) return;

        if (!interaction.member.permissions.has(
            PermissionsBitField.Flags.Administrator
        )) {
            return interaction.reply({
                content:
                    '❌ تحتاج صلاحية **Administrator**.',
                ephemeral: true
            });
        }

        const type =
            interaction.customId.split(':')[1];

        const channel =
            interaction.channels.first();

        if (!channel) {
            return interaction.reply({
                content:
                    '❌ لم يتم اختيار روم.',
                ephemeral: true
            });
        }

        const settings =
            await getSettings(interaction.guild.id);

        settings.logs[type] = channel.id;

        settings.markModified('logs');

        await settings.save();

        await interaction.update({
            content:
                `✅ تم تعيين روم سجل **${type}** إلى ${channel}.`,
            components: []
        });

    } catch (error) {

        console.error(
            'Save log channel error:',
            error
        );

    }

});// ======================================================
// SEND LOG
// ======================================================

async function sendLog(guild, type, embed) {

    try {

        const settings =
            await getSettings(guild.id);

        const channelId =
            settings.logs?.[type];

        if (!channelId) return;

        const channel =
            guild.channels.cache.get(channelId);

        if (!channel) return;

        await channel.send({
            embeds: [embed]
        });

    } catch (error) {

        console.error(
            `Log error [${type}]:`,
            error
        );

    }
}// ======================================================
// MEMBER JOIN
// ======================================================

client.on('guildMemberAdd', async member => {

    try {

        const embed = new EmbedBuilder()
            .setTitle('📥 Member Joined')
            .setDescription(
                `${member} دخل السيرفر.`
            )
            .addFields(
                {
                    name: 'Username',
                    value: member.user.tag,
                    inline: true
                },
                {
                    name: 'Member Count',
                    value: `${member.guild.memberCount}`,
                    inline: true
                }
            )
            .setTimestamp();

        await sendLog(
            member.guild,
            'member',
            embed
        );

    } catch (error) {

        console.error(
            'Member join log:',
            error
        );

    }

});// ======================================================
// MEMBER LEAVE
// ======================================================

client.on('guildMemberRemove', async member => {

    try {

        const embed = new EmbedBuilder()
            .setTitle('📤 Member Left')
            .setDescription(
                `${member.user.tag} خرج من السيرفر.`
            )
            .addFields({
                name: 'Member Count',
                value: `${member.guild.memberCount}`,
                inline: true
            })
            .setTimestamp();

        await sendLog(
            member.guild,
            'member',
            embed
        );

    } catch (error) {

        console.error(
            'Member leave log:',
            error
        );

    }

});// ======================================================
// CHANNEL CREATE
// ======================================================

client.on('channelCreate', async channel => {

    if (!channel.guild) return;

    const embed = new EmbedBuilder()
        .setTitle('📁 Channel Created')
        .setDescription(
            `تم إنشاء الروم ${channel}.`
        )
        .addFields({
            name: 'Name',
            value: channel.name,
            inline: true
        })
        .setTimestamp();

    await sendLog(
        channel.guild,
        'channel',
        embed
    );

});// ======================================================
// CHANNEL DELETE
// ======================================================

client.on('channelDelete', async channel => {

    if (!channel.guild) return;

    const embed = new EmbedBuilder()
        .setTitle('🗑️ Channel Deleted')
        .setDescription(
            `تم حذف الروم **${channel.name}**.`
        )
        .setTimestamp();

    await sendLog(
        channel.guild,
        'channel',
        embed
    );

});// ======================================================
// ROLE CREATE
// ======================================================

client.on('roleCreate', async role => {

    const embed = new EmbedBuilder()
        .setTitle('🎭 Role Created')
        .setDescription(
            `تم إنشاء الرتبة ${role}.`
        )
        .addFields({
            name: 'Name',
            value: role.name,
            inline: true
        })
        .setTimestamp();

    await sendLog(
        role.guild,
        'role',
        embed
    );

});// ======================================================
// ROLE DELETE
// ======================================================

client.on('roleDelete', async role => {

    const embed = new EmbedBuilder()
        .setTitle('🗑️ Role Deleted')
        .setDescription(
            `تم حذف الرتبة **${role.name}**.`
        )
        .setTimestamp();

    await sendLog(
        role.guild,
        'role',
        embed
    );

});// ======================================================
// MESSAGE DELETE
// ======================================================

client.on('messageDelete', async message => {

    if (!message.guild) return;
    if (message.author?.bot) return;

    const content =
        message.content?.slice(0, 1000) ||
        'لا يوجد محتوى محفوظ.';

    const embed = new EmbedBuilder()
        .setTitle('🗑️ Message Deleted')
        .setDescription(
            `تم حذف رسالة في ${message.channel}.`
        )
        .addFields({
            name: 'Content',
            value: content
        })
        .setTimestamp();

    await sendLog(
        message.guild,
        'message',
        embed
    );

});// ======================================================
// MESSAGE UPDATE
// ======================================================

client.on(
    'messageUpdate',
    async (oldMessage, newMessage) => {

        if (!newMessage.guild) return;
        if (newMessage.author?.bot) return;

        if (
            oldMessage.content ===
            newMessage.content
        ) return;

        const embed = new EmbedBuilder()
            .setTitle('✏️ Message Edited')
            .setDescription(
                `تم تعديل رسالة في ${newMessage.channel}.`
            )
            .addFields(
                {
                    name: 'قبل',
                    value:
                        oldMessage.content?.slice(0, 1000) ||
                        'فارغة'
                },
                {
                    name: 'بعد',
                    value:
                        newMessage.content?.slice(0, 1000) ||
                        'فارغة'
                }
            )
            .setTimestamp();

        await sendLog(
            newMessage.guild,
            'message',
            embed
        );

    }
);// ======================================================
// LEVEL SYSTEM
// ======================================================

async function addMessageXP(message) {

    if (!message.guild) return;
    if (message.author.bot) return;

    const settings =
        await getSettings(message.guild.id);

    if (!settings.levels?.enabled) return;

    const perLevel =
        Number(settings.levels.messagesPerLevel) || 50;

    let data =
        await UserLevel.findOne({
            guildId: message.guild.id,
            userId: message.author.id
        });

    if (!data) {
        data = await UserLevel.create({
            guildId: message.guild.id,
            userId: message.author.id,
            messages: 1,
            level: 0
        });

        return;
    }

    data.messages++;

    const newLevel =
        Math.floor(data.messages / perLevel);

    const oldLevel = data.level;

    data.level = newLevel;

    await data.save();

    if (newLevel <= oldLevel) return;

    const member =
        message.member;

    if (!member) return;

    // إعطاء رتب الجوائز
    for (
        let level = oldLevel + 1;
        level <= newLevel;
        level++
    ) {

        const roleId =
            settings.levels.rewards?.get(
                String(level)
            );

        if (!roleId) continue;

        const role =
            message.guild.roles.cache.get(roleId);

        if (!role) continue;

        if (!role.editable) continue;

        if (!member.roles.cache.has(role.id)) {
            await member.roles.add(
                role,
                `Level ${level} reward`
            ).catch(() => {});
        }
    }

    await message.channel.send({
        content:
            `🎉 مبروك ${member}! وصلت إلى **Level ${newLevel}**.`
    }).catch(() => {});

}// ======================================================
// LEVEL MESSAGE TRACKER
// ======================================================

client.on('messageCreate', async message => {

    try {

        if (!message.guild) return;
        if (message.author.bot) return;

        await addMessageXP(message);

    } catch (error) {

        console.error(
            'Level system error:',
            error
        );

    }

});// ======================================================
// LEVEL SETTINGS HANDLER
// ======================================================

async function handleLevelSettings(interaction) {

    const settings =
        await getSettings(interaction.guild.id);

    const subcommand =
        interaction.options.getSubcommand();

    if (subcommand === 'set') {

        const amount =
            interaction.options.getInteger('messages');

        if (!amount || amount < 1) {

            return interaction.reply({
                content:
                    '❌ يجب أن يكون عدد الرسائل أكبر من 0.',
                ephemeral: true
            });

        }

        settings.levels.enabled = true;

        settings.levels.messagesPerLevel =
            amount;

        await settings.save();

        return interaction.reply({
            content:
                `✅ كل **${amount} رسالة** = Level جديد.`,
            ephemeral: true
        });
    }

    if (subcommand === 'reward') {

        const level =
            interaction.options.getInteger('level');

        const role =
            interaction.options.getRole('role');

        if (!level || !role) {

            return interaction.reply({
                content:
                    '❌ حدد المستوى والرتبة.',
                ephemeral: true
            });
        }

        if (!role.editable) {

            return interaction.reply({
                content:
                    '❌ البوت لا يستطيع إعطاء هذه الرتبة.',
                ephemeral: true
            });
        }

        settings.levels.enabled = true;

        settings.levels.rewards.set(
            String(level),
            role.id
        );

        settings.markModified(
            'levels.rewards'
        );

        await settings.save();

        return interaction.reply({
            content:
                `✅ تم ربط ${role} بالمستوى **${level}**.`,
            ephemeral: true
        });
    }

    if (subcommand === 'off') {

        settings.levels.enabled = false;

        await settings.save();

        return interaction.reply({
            content:
                '🔴 تم إيقاف نظام الـ Levels.',
            ephemeral: true
        });
    }
}// ======================================================
// VOICE LOGS
// ======================================================

client.on(
    'voiceStateUpdate',
    async (oldState, newState) => {

        try {

            const member =
                newState.member || oldState.member;

            if (!member) return;

            let description = '';

            if (
                !oldState.channelId &&
                newState.channelId
            ) {

                description =
                    `${member} دخل الروم الصوتي ${newState.channel}.`;

            } else if (
                oldState.channelId &&
                !newState.channelId
            ) {

                description =
                    `${member} خرج من الروم الصوتي **${oldState.channel?.name || 'Unknown'}**.`;

            } else if (
                oldState.channelId !==
                newState.channelId
            ) {

                description =
                    `${member} انتقل من **${oldState.channel?.name || 'Unknown'}** إلى **${newState.channel?.name || 'Unknown'}**.`;

            } else {

                return;
            }

            const embed =
                new EmbedBuilder()
                    .setTitle('🔊 Voice Log')
                    .setDescription(description)
                    .addFields({
                        name: 'Member',
                        value: member.user.tag,
                        inline: true
                    })
                    .setTimestamp();

            await sendLog(
                member.guild,
                'voice',
                embed
            );

        } catch (error) {

            console.error(
                'Voice log error:',
                error
            );

        }

    }
);// ======================================================
// ROLE UPDATE
// ======================================================

client.on(
    'roleUpdate',
    async (oldRole, newRole) => {

        try {

            const changes = [];

            if (
                oldRole.name !==
                newRole.name
            ) {
                changes.push(
                    `الاسم: **${oldRole.name}** → **${newRole.name}**`
                );
            }

            if (
                oldRole.color !==
                newRole.color
            ) {
                changes.push(
                    `اللون: **${oldRole.color}** → **${newRole.color}**`
                );
            }

            if (
                oldRole.permissions.bitfield !==
                newRole.permissions.bitfield
            ) {
                changes.push(
                    'تم تغيير صلاحيات الرتبة.'
                );
            }

            if (!changes.length) return;

            const embed =
                new EmbedBuilder()
                    .setTitle('🎭 Role Updated')
                    .setDescription(
                        changes.join('\n')
                    )
                    .addFields({
                        name: 'Role',
                        value: `${newRole}`,
                        inline: true
                    })
                    .setTimestamp();

            await sendLog(
                newRole.guild,
                'role',
                embed
            );

        } catch (error) {

            console.error(
                'Role update log:',
                error
            );

        }

    }
);// ======================================================
// CHANNEL UPDATE
// ======================================================

client.on(
    'channelUpdate',
    async (oldChannel, newChannel) => {

        try {

            if (!newChannel.guild) return;

            const changes = [];

            if (
                oldChannel.name !==
                newChannel.name
            ) {

                changes.push(
                    `الاسم: **${oldChannel.name}** → **${newChannel.name}**`
                );
            }

            if (
                oldChannel.parentId !==
                newChannel.parentId
            ) {

                changes.push(
                    'تم تغيير تصنيف الروم.'
                );
            }

            if (!changes.length) return;

            const embed =
                new EmbedBuilder()
                    .setTitle('📁 Channel Updated')
                    .setDescription(
                        changes.join('\n')
                    )
                    .addFields({
                        name: 'Channel',
                        value: `${newChannel}`,
                        inline: true
                    })
                    .setTimestamp();

            await sendLog(
                newChannel.guild,
                'channel',
                embed
            );

        } catch (error) {

            console.error(
                'Channel update log:',
                error
            );

        }

    }
);// ======================================================
// WEBHOOK UPDATE
// ======================================================

client.on(
    'webhookUpdate',
    async channel => {

        try {

            if (!channel.guild) return;

            const embed =
                new EmbedBuilder()
                    .setTitle('🔗 Webhook Updated')
                    .setDescription(
                        `حدث تغيير في Webhook داخل ${channel}.`
                    )
                    .setTimestamp();

            await sendLog(
                channel.guild,
                'webhook',
                embed
            );

        } catch (error) {

            console.error(
                'Webhook log:',
                error
            );

        }

    }
);// ======================================================
// MODERATION LOG
// ======================================================

async function sendModerationLog(
    guild,
    action,
    moderator,
    target,
    reason = 'بدون سبب'
) {

    const embed =
        new EmbedBuilder()
            .setTitle(`🛡️ ${action}`)
            .addFields(
                {
                    name: 'Moderator',
                    value: `${moderator}`,
                    inline: true
                },
                {
                    name: 'Target',
                    value: `${target}`,
                    inline: true
                },
                {
                    name: 'Reason',
                    value: reason,
                    inline: false
                }
            )
            .setTimestamp();

    await sendLog(
        guild,
        'moderation',
        embed
    );
}// ======================================================
// AUTORESPONSE LIST
// ======================================================

async function sendAutoResponseList(interaction) {

    const settings =
        await getSettings(interaction.guild.id);

    const responses =
        settings.autoResponses || [];

    if (!responses.length) {

        return interaction.reply({
            content:
                '📭 لا توجد ردود تلقائية.',
            ephemeral: true
        });
    }

    const description =
        responses
            .map((item, index) =>
                `**${index + 1}.** \`${item.trigger}\` → ${item.response}`
            )
            .join('\n');

    const embed =
        new EmbedBuilder()
            .setTitle('🤖 Auto Responses')
            .setDescription(description)
            .setColor(0x2b2d31);

    return interaction.reply({
        embeds: [embed],
        ephemeral: true
    });
}// ======================================================
// AUTORESPONSE SELECT
// ======================================================

async function showAutoResponseSelect(
    interaction,
    action
) {

    const settings =
        await getSettings(interaction.guild.id);

    const responses =
        settings.autoResponses || [];

    if (!responses.length) {

        return interaction.reply({
            content:
                '📭 لا توجد ردود تلقائية.',
            ephemeral: true
        });
    }

    const options =
        responses
            .slice(0, 25)
            .map((item, index) => ({
                label:
                    item.trigger.slice(0, 100),

                value:
                    `${action}:${index}`,

                description:
                    item.response.slice(0, 100)
            }));

    const menu =
        new StringSelectMenuBuilder()
            .setCustomId(
                'autoresponse_action'
            )
            .setPlaceholder(
                'اختر الرد'
            )
            .addOptions(options);

    return interaction.reply({
        content:
            action === 'remove'
                ? '🗑️ اختر الرد الذي تريد حذفه.'
                : '✏️ اختر الرد الذي تريد تعديله.',

        components: [
            new ActionRowBuilder()
                .addComponents(menu)
        ],

        ephemeral: true
    });
}autoResponses: {
    type: [
        {
            trigger: String,
            response: String
        }
    ],
    default: []
},// ======================================================
// AUTORESPONSE EXECUTION
// ======================================================

client.on('messageCreate', async message => {

    try {

        if (!message.guild) return;
        if (message.author.bot) return;

        const settings =
            await getSettings(message.guild.id);

        const responses =
            settings.autoResponses || [];

        if (!responses.length) return;

        const content =
            normalizeText(message.content);

        const found =
            responses.find(item =>
                normalizeText(item.trigger) ===
                content
            );

        if (!found) return;

        await message.reply(
            found.response
        );

    } catch (error) {

        console.error(
            'AutoResponse error:',
            error
        );

    }

});// ======================================================
// INTERACTION ERROR HANDLER
// ======================================================

process.on(
    'unhandledRejection',
    error => {

        console.error(
            'Unhandled Rejection:',
            error
        );

    }
);

process.on(
    'uncaughtException',
    error => {

        console.error(
            'Uncaught Exception:',
            error
        );

    }
);// ======================================================
// BOT LOGIN
// ======================================================

client.login(TOKEN);const TOKEN = process.env.TOKEN;
const MONGO_URI = process.env.MONGO_URI;
