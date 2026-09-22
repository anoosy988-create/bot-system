const {
    Client,
    GatewayIntentBits,
    PermissionsBitField,
    EmbedBuilder,
    SlashCommandBuilder,
    ChannelType
} = require('discord.js');

const mongoose = require('mongoose');
const ms = require('ms');
const express = require('express');

/* =========================================================
   CONFIG
========================================================= */

const TOKEN = process.env.TOKEN?.trim();
const OWNER_ID = '1364275261398581279';
const PORT = process.env.PORT || 3000;

/*
   تنظيف رابط MongoDB:
   - يشيل المسافات
   - يشيل علامات الاقتباس إذا كانت موجودة بالغلط
*/
const MONGO_URI = process.env.MONGO_URI
    ?.trim()
    .replace(/^["']|["']$/g, '');

if (!TOKEN) {
    console.error('❌ TOKEN غير موجود في Environment Variables.');
    process.exit(1);
}

if (!MONGO_URI) {
    console.error('❌ MONGO_URI غير موجود في Environment Variables.');
    process.exit(1);
}

if (
    !MONGO_URI.startsWith('mongodb://') &&
    !MONGO_URI.startsWith('mongodb+srv://')
) {
    console.error('❌ MONGO_URI غير صحيح.');
    console.error(
        'يجب أن يبدأ بـ mongodb:// أو mongodb+srv://'
    );
    console.error(
        'القيمة المستلمة تبدأ بـ:',
        JSON.stringify(MONGO_URI.substring(0, 20))
    );
    process.exit(1);
}

/* =========================================================
   EXPRESS
========================================================= */

const app = express();

app.get('/', (req, res) => {
    res.status(200).send('Bot is active!');
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Web server running on port ${PORT}`);
});

/* =========================================================
   CLIENT
========================================================= */

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

/* =========================================================
   MONGODB
========================================================= */

mongoose.connect(MONGO_URI)
    .then(() => {
        console.log('✅ MongoDB connected successfully');
    })
    .catch(error => {
        console.error('❌ MongoDB connection error:');
        console.error(error);
        process.exit(1);
    });

/* =========================================================
   SCHEMAS
========================================================= */

const guildSchema = new mongoose.Schema({
    _id: String,

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
            default: 'هلا والله {user} 👋'
        }
    },

    logs: {
        moderation: {
            type: String,
            default: null
        },
        messages: {
            type: String,
            default: null
        },
        members: {
            type: String,
            default: null
        },
        roles: {
            type: String,
            default: null
        },
        channels: {
            type: String,
            default: null
        },
        voice: {
            type: String,
            default: null
        },
        webhooks: {
            type: String,
            default: null
        }
    },

    shortcuts: {
        type: Map,
        of: String,
        default: new Map()
    },

    autoResponses: {
        type: Map,
        of: String,
        default: new Map()
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

/* =========================================================
   HELPERS
========================================================= */

function isOwner(userId) {
    return userId === OWNER_ID;
}

function hasAdministrator(interaction) {
    return (
        isOwner(interaction.user.id) ||
        interaction.member?.permissions?.has(
            PermissionsBitField.Flags.Administrator
        )
    );
}

async function requireAdministrator(interaction) {
    if (hasAdministrator(interaction)) {
        return true;
    }

    await interaction.reply({
        content:
            '❌ تحتاج صلاحية **Administrator** لاستخدام هذا الأمر.',
        ephemeral: true
    });

    return false;
}

async function getSettings(guildId) {
    let settings = await GuildSettings.findById(guildId);

    if (!settings) {
        settings = await GuildSettings.create({
            _id: guildId
        });
    }

    return settings;
}

/* =========================================================
   EMBEDS
========================================================= */

function shortcutsEmbed(settings) {
    const list = [...settings.shortcuts.entries()];

    const embed = new EmbedBuilder()
        .setTitle('⚡ جميع الاختصارات')
        .setColor(0x2b2d31)
        .setTimestamp()
        .setFooter({
            text: `عدد الاختصارات: ${list.length}`
        });

    if (!list.length) {
        embed.setDescription(
            'لا توجد اختصارات حالياً.'
        );

        return embed;
    }

    for (const [name, command] of list) {
        embed.addFields({
            name: `🔹 ${name}`,
            value: `الأمر: \`${command}\``,
            inline: false
        });
    }

    return embed;
}

function autoResponsesEmbed(settings) {
    const list = [...settings.autoResponses.entries()];

    const embed = new EmbedBuilder()
        .setTitle('💬 جميع الردود التلقائية')
        .setColor(0x2b2d31)
        .setTimestamp()
        .setFooter({
            text: `عدد الردود: ${list.length}`
        });

    if (!list.length) {
        embed.setDescription(
            'لا توجد ردود تلقائية حالياً.'
        );

        return embed;
    }

    for (const [trigger, response] of list) {
        embed.addFields({
            name: `💬 ${trigger}`,
            value:
                response.length > 1000
                    ? response.substring(0, 1000) + '...'
                    : response,
            inline: false
        });
    }

    return embed;
}

/* =========================================================
   LOGS
========================================================= */

async function sendLog(
    guild,
    type,
    title,
    description
) {
    try {
        const settings =
            await getSettings(guild.id);

        const channelId =
            settings.logs[type];

        if (!channelId) return;

        const channel =
            guild.channels.cache.get(channelId);

        if (!channel) return;

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(0x2b2d31)
            .setTimestamp();

        await channel.send({
            embeds: [embed]
        });

    } catch (error) {
        console.error('Log error:', error);
    }
}

/* =========================================================
   JAIL ROLE
========================================================= */

async function getJailRole(guild) {
    let role = guild.roles.cache.find(
        r => r.name === 'سجين'
    );

    if (role) {
        return role;
    }

    role = await guild.roles.create({
        name: 'سجين',
        reason: 'Create jail role'
    });

    for (const channel of guild.channels.cache.values()) {
        try {
            await channel.permissionOverwrites.edit(
                role,
                {
                    SendMessages: false,
                    AddReactions: false,
                    Speak: false
                }
            );
        } catch {}
    }

    return role;
}

/* =========================================================
   SLASH COMMANDS
   كل أمر Administrator
========================================================= */

const commands = [

    new SlashCommandBuilder()
        .setName('jail')
        .setDescription('سجن عضو')
        .setDefaultMemberPermissions(
            PermissionsBitField.Flags.Administrator
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('العضو المراد سجنه')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('unjail')
        .setDescription('فك سجن عضو')
        .setDefaultMemberPermissions(
            PermissionsBitField.Flags.Administrator
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('العضو المراد فك سجنه')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('حظر عضو')
        .setDefaultMemberPermissions(
            PermissionsBitField.Flags.Administrator
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('العضو المراد حظره')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('unban')
        .setDescription('فك حظر عضو')
        .setDefaultMemberPermissions(
            PermissionsBitField.Flags.Administrator
        )
        .addStringOption(option =>
            option
                .setName('userid')
                .setDescription('ايدي العضو')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('kick')
        .setDescription('طرد عضو')
        .setDefaultMemberPermissions(
            PermissionsBitField.Flags.Administrator
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('العضو المراد طرده')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('إعطاء تايم أوت لعضو')
        .setDefaultMemberPermissions(
            PermissionsBitField.Flags.Administrator
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('العضو')
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName('duration')
                .setDescription('المدة مثل 10m أو 1h أو 1d')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('untimeout')
        .setDescription('إزالة التايم أوت')
        .setDefaultMemberPermissions(
            PermissionsBitField.Flags.Administrator
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('العضو')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('role-add')
        .setDescription('إضافة رتبة لعضو')
        .setDefaultMemberPermissions(
            PermissionsBitField.Flags.Administrator
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('العضو')
                .setRequired(true)
        )
        .addRoleOption(option =>
            option
                .setName('role')
                .setDescription('الرتبة')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('role-remove')
        .setDescription('إزالة رتبة من عضو')
        .setDefaultMemberPermissions(
            PermissionsBitField.Flags.Administrator
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('العضو')
                .setRequired(true)
        )
        .addRoleOption(option =>
            option
                .setName('role')
                .setDescription('الرتبة')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('purge')
        .setDescription('مسح رسائل')
        .setDefaultMemberPermissions(
            PermissionsBitField.Flags.Administrator
        )
        .addIntegerOption(option =>
            option
                .setName('amount')
                .setDescription('عدد الرسائل من 1 إلى 100')
                .setMinValue(1)
                .setMaxValue(100)
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('lock')
        .setDescription('قفل الروم')
        .setDefaultMemberPermissions(
            PermissionsBitField.Flags.Administrator
        )
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('الروم المراد قفله')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('unlock')
        .setDescription('فتح الروم')
        .setDefaultMemberPermissions(
            PermissionsBitField.Flags.Administrator
        )
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('الروم المراد فتحه')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('إدارة الترحيب')
        .setDefaultMemberPermissions(
            PermissionsBitField.Flags.Administrator
        )
        .addSubcommand(sub =>
            sub
                .setName('set')
                .setDescription('تفعيل الترحيب')
                .addChannelOption(option =>
                    option
                        .setName('channel')
                        .setDescription('روم الترحيب')
                        .addChannelTypes(ChannelType.GuildText)
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('message')
                        .setDescription('رسالة الترحيب')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('disable')
                .setDescription('إيقاف الترحيب')
        )
        .addSubcommand(sub =>
            sub
                .setName('show')
                .setDescription('عرض إعدادات الترحيب')
        ),

    new SlashCommandBuilder()
        .setName('shortcut')
        .setDescription('إدارة الاختصارات')
        .setDefaultMemberPermissions(
            PermissionsBitField.Flags.Administrator
        )
        .addSubcommand(sub =>
            sub
                .setName('list')
                .setDescription('عرض جميع الاختصارات')
        )
        .addSubcommand(sub =>
            sub
                .setName('add')
                .setDescription('إضافة اختصار')
                .addStringOption(option =>
                    option
                        .setName('name')
                        .setDescription('اسم الاختصار')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('command')
                        .setDescription('الأمر الذي ينفذه الاختصار')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('edit')
                .setDescription('تعديل اختصار')
                .addStringOption(option =>
                    option
                        .setName('name')
                        .setDescription('اسم الاختصار')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('command')
                        .setDescription('الأمر الجديد')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('remove')
                .setDescription('حذف اختصار')
                .addStringOption(option =>
                    option
                        .setName('name')
                        .setDescription('اسم الاختصار')
                        .setRequired(true)
                )
        ),

    new SlashCommandBuilder()
        .setName('autoresponse')
        .setDescription('إدارة الردود التلقائية')
        .setDefaultMemberPermissions(
            PermissionsBitField.Flags.Administrator
        )
        .addSubcommand(sub =>
            sub
                .setName('list')
                .setDescription('عرض جميع الردود')
        )
        .addSubcommand(sub =>
            sub
                .setName('add')
                .setDescription('إضافة رد تلقائي')
                .addStringOption(option =>
                    option
                        .setName('trigger')
                        .setDescription('الكلمة التي تشغل الرد')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('response')
                        .setDescription('الرد')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('edit')
                .setDescription('تعديل رد تلقائي')
                .addStringOption(option =>
                    option
                        .setName('trigger')
                        .setDescription('الكلمة')
                        .setRequired(true)
                )
                .addStringOption(option =>
                    option
                        .setName('response')
                        .setDescription('الرد الجديد')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('remove')
                .setDescription('حذف رد تلقائي')
                .addStringOption(option =>
                    option
                        .setName('trigger')
                        .setDescription('الكلمة')
                        .setRequired(true)
                )
        ),

    new SlashCommandBuilder()
        .setName('logs')
        .setDescription('إعداد اللوقز')
        .setDefaultMemberPermissions(
            PermissionsBitField.Flags.Administrator
        )
        .addStringOption(option =>
            option
                .setName('type')
                .setDescription('نوع اللوق')
                .setRequired(true)
                .addChoices(
                    {
                        name: 'Moderation',
                        value: 'moderation'
                    },
                    {
                        name: 'Messages',
                        value: 'messages'
                    },
                    {
                        name: 'Members',
                        value: 'members'
                    },
                    {
                        name: 'Roles',
                        value: 'roles'
                    },
                    {
                        name: 'Channels',
                        value: 'channels'
                    },
                    {
                        name: 'Voice',
                        value: 'voice'
                    },
                    {
                        name: 'Webhooks',
                        value: 'webhooks'
                    }
                )
        )
        .addChannelOption(option =>
            option
                .setName('channel')
                .setDescription('روم اللوق')
                .addChannelTypes(ChannelType.GuildText)
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('level')
        .setDescription('عرض مستوى عضو')
        .setDefaultMemberPermissions(
            PermissionsBitField.Flags.Administrator
        )
        .addUserOption(option =>
            option
                .setName('user')
                .setDescription('العضو')
                .setRequired(false)
        ),

    new SlashCommandBuilder()
        .setName('level-settings')
        .setDescription('إعدادات نظام المستويات')
        .setDefaultMemberPermissions(
            PermissionsBitField.Flags.Administrator
        )
        .addSubcommand(sub =>
            sub
                .setName('messages')
                .setDescription('عدد الرسائل لكل مستوى')
                .addIntegerOption(option =>
                    option
                        .setName('amount')
                        .setDescription('عدد الرسائل')
                        .setMinValue(1)
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('reward')
                .setDescription('رتبة مكافأة لمستوى')
                .addIntegerOption(option =>
                    option
                        .setName('level')
                        .setDescription('رقم المستوى')
                        .setMinValue(1)
                        .setRequired(true)
                )
                .addRoleOption(option =>
                    option
                        .setName('role')
                        .setDescription('الرتبة')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub
                .setName('disable')
                .setDescription('إيقاف نظام المستويات')
        )
];

/* =========================================================
   REGISTER SLASH COMMANDS
========================================================= */

client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);

    try {
        await client.application.commands.set(
            commands.map(command => command.toJSON())
        );

        console.log('✅ Slash commands registered');
        console.log('🔐 All slash commands require Administrator');
    } catch (error) {
        console.error(
            '❌ Slash command registration error:',
            error
        );
    }
});

/* =========================================================
   INTERACTIONS
========================================================= */

client.on('interactionCreate', async interaction => {

    if (!interaction.isChatInputCommand()) {
        return;
    }

    /*
       🔴 كل Slash Commands تحتاج Administrator
       والـOwner مستثنى
    */

    if (!(await requireAdministrator(interaction))) {
        return;
    }

    try {

        /* =========================
           JAIL
        ========================= */

        if (interaction.commandName === 'jail') {

            const member =
                interaction.options.getMember('user');

            if (!member) {
                return interaction.reply({
                    content: '❌ العضو غير موجود.',
                    ephemeral: true
                });
            }

            if (member.id === OWNER_ID) {
                return interaction.reply({
                    content:
                        '❌ لا يمكنك سجن صاحب البوت.',
                    ephemeral: true
                });
            }

            const jailRole =
                await getJailRole(interaction.guild);

            const roles =
                member.roles.cache
                    .filter(role =>
                        role.id !== interaction.guild.id
                    )
                    .map(role => role.id);

            await JailData.findOneAndUpdate(
                {
                    guildId: interaction.guild.id,
                    userId: member.id
                },
                {
                    roles
                },
                {
                    upsert: true
                }
            );

            await member.roles.set([
                jailRole.id
            ]);

            await sendLog(
                interaction.guild,
                'moderation',
                '🔒 Jail',
                `${member} تم سجنه بواسطة ${interaction.user}.`
            );

            return interaction.reply(
                `🔒 تم سجن ${member}.`
            );
        }

        /* =========================
           UNJAIL
        ========================= */

        if (interaction.commandName === 'unjail') {

            const member =
                interaction.options.getMember('user');

            if (!member) {
                return interaction.reply({
                    content: '❌ العضو غير موجود.',
                    ephemeral: true
                });
            }

            const data =
                await JailData.findOne({
                    guildId: interaction.guild.id,
                    userId: member.id
                });

            if (!data) {
                return interaction.reply({
                    content:
                        '❌ هذا العضو ليس مسجوناً.',
                    ephemeral: true
                });
            }

            const roles = data.roles
                .filter(roleId =>
                    interaction.guild.roles.cache.has(roleId)
                );

            await member.roles.set(roles);

            await JailData.deleteOne({
                guildId: interaction.guild.id,
                userId: member.id
            });

            await sendLog(
                interaction.guild,
                'moderation',
                '🔓 Unjail',
                `${member} تم فك سجنه بواسطة ${interaction.user}.`
            );

            return interaction.reply(
                `🔓 تم فك سجن ${member}.`
            );
        }

        /* =========================
           BAN
        ========================= */

        if (interaction.commandName === 'ban') {

            const member =
                interaction.options.getMember('user');

            if (!member) {
                return interaction.reply({
                    content: '❌ العضو غير موجود.',
                    ephemeral: true
                });
            }

            if (member.id === OWNER_ID) {
                return interaction.reply({
                    content:
                        '❌ لا يمكنك حظر صاحب البوت.',
                    ephemeral: true
                });
            }

            await member.ban({
                reason:
                    `Banned by ${interaction.user.tag}`
            });

            await sendLog(
                interaction.guild,
                'moderation',
                '🔨 Ban',
                `${member.user.tag} تم حظره بواسطة ${interaction.user}.`
            );

            return interaction.reply(
                `🔨 تم حظر ${member.user.tag}.`
            );
        }

        /* =========================
           UNBAN
        ========================= */

        if (interaction.commandName === 'unban') {

            const userId =
                interaction.options.getString(
                    'userid'
                );

            try {

                await interaction.guild.members.unban(
                    userId
                );

                await sendLog(
                    interaction.guild,
                    'moderation',
                    '🔓 Unban',
                    `${userId} تم فك حظره بواسطة ${interaction.user}.`
                );

                return interaction.reply(
                    `🔓 تم فك حظر \`${userId}\`.`
                );

            } catch {
                return interaction.reply({
                    content:
                        '❌ لم أجد هذا العضو ضمن قائمة المحظورين.',
                    ephemeral: true
                });
            }
        }

        /* =========================
           KICK
        ========================= */

        if (interaction.commandName === 'kick') {

            const member =
                interaction.options.getMember('user');

            if (!member) {
                return interaction.reply({
                    content: '❌ العضو غير موجود.',
                    ephemeral: true
                });
            }

            if (member.id === OWNER_ID) {
                return interaction.reply({
                    content:
                        '❌ لا يمكنك طرد صاحب البوت.',
                    ephemeral: true
                });
            }

            await member.kick(
                `Kicked by ${interaction.user.tag}`
            );

            await sendLog(
                interaction.guild,
                'moderation',
                '👢 Kick',
                `${member.user.tag} تم طرده بواسطة ${interaction.user}.`
            );

            return interaction.reply(
                `👢 تم طرد ${member.user.tag}.`
            );
        }

        /* =========================
           TIMEOUT
        ========================= */

        if (interaction.commandName === 'timeout') {

            const member =
                interaction.options.getMember('user');

            const durationText =
                interaction.options.getString(
                    'duration'
                );

            const duration =
                ms(durationText);

            if (!duration) {
                return interaction.reply({
                    content:
                        '❌ المدة غير صحيحة.',
                    ephemeral: true
                });
            }

            if (
                duration >
                28 * 24 * 60 * 60 * 1000
            ) {
                return interaction.reply({
                    content:
                        '❌ الحد الأقصى للتايم أوت هو 28 يوم.',
                    ephemeral: true
                });
            }

            await member.timeout(
                duration,
                `Timeout by ${interaction.user.tag}`
            );

            await sendLog(
                interaction.guild,
                'moderation',
                '⏱️ Timeout',
                `${member} تم إعطاؤه تايم أوت لمدة \`${durationText}\` بواسطة ${interaction.user}.`
            );

            return interaction.reply(
                `⏱️ تم إعطاء ${member} تايم أوت لمدة ${durationText}.`
            );
        }

        /* =========================
           UNTIMEOUT
        ========================= */

        if (interaction.commandName === 'untimeout') {

            const member =
                interaction.options.getMember('user');

            await member.timeout(
                null,
                `Untimeout by ${interaction.user.tag}`
            );

            return interaction.reply(
                `🔓 تم إزالة التايم أوت عن ${member}.`
            );
        }

        /* =========================
           ROLE ADD
        ========================= */

        if (interaction.commandName === 'role-add') {

            const member =
                interaction.options.getMember('user');

            const role =
                interaction.options.getRole('role');

            await member.roles.add(role);

            return interaction.reply(
                `✅ تمت إضافة ${role} إلى ${member}.`
            );
        }

        /* =========================
           ROLE REMOVE
        ========================= */

        if (interaction.commandName === 'role-remove') {

            const member =
                interaction.options.getMember('user');

            const role =
                interaction.options.getRole('role');

            await member.roles.remove(role);

            return interaction.reply(
                `✅ تمت إزالة ${role} من ${member}.`
            );
        }

        /* =========================
           PURGE
        ========================= */

        if (interaction.commandName === 'purge') {

            const amount =
                interaction.options.getInteger(
                    'amount'
                );

            await interaction.channel.bulkDelete(
                amount,
                true
            );

            return interaction.reply({
                content:
                    `🧹 تم مسح ${amount} رسالة.`,
                ephemeral: true
            });
        }

        /* =========================
           LOCK
        ========================= */

        if (interaction.commandName === 'lock') {

            const channel =
                interaction.options.getChannel(
                    'channel'
                ) || interaction.channel;

            await channel.permissionOverwrites.edit(
                interaction.guild.roles.everyone,
                {
                    SendMessages: false
                }
            );

            await sendLog(
                interaction.guild,
                'moderation',
                '🔒 Lock',
                `${channel} تم قفله بواسطة ${interaction.user}.`
            );

            return interaction.reply(
                `🔒 تم قفل ${channel}.`
            );
        }

        /* =========================
           UNLOCK
        ========================= */

        if (interaction.commandName === 'unlock') {

            const channel =
                interaction.options.getChannel(
                    'channel'
                ) || interaction.channel;

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
                `${channel} تم فتحه بواسطة ${interaction.user}.`
            );

            return interaction.reply(
                `🔓 تم فتح ${channel}.`
            );
        }

        /* =========================
           WELCOME
        ========================= */

        if (interaction.commandName === 'welcome') {

            const subcommand =
                interaction.options.getSubcommand();

            const settings =
                await getSettings(
                    interaction.guild.id
                );

            if (subcommand === 'set') {

                const channel =
                    interaction.options.getChannel(
                        'channel'
                    );

                const message =
                    interaction.options.getString(
                        'message'
                    );

                settings.welcome.enabled = true;
                settings.welcome.channelId =
                    channel.id;
                settings.welcome.message =
                    message;

                await settings.save();

                return interaction.reply(
                    `✅ تم تفعيل الترحيب في ${channel}.`
                );
            }

            if (subcommand === 'disable') {

                settings.welcome.enabled = false;

                await settings.save();

                return interaction.reply(
                    '✅ تم إيقاف الترحيب.'
                );
            }

            if (subcommand === 'show') {

                const embed =
                    new EmbedBuilder()
                        .setTitle(
                            '👋 إعدادات الترحيب'
                        )
                        .setColor(0x2b2d31)
                        .addFields(
                            {
                                name: 'الحالة',
                                value:
                                    settings.welcome.enabled
                                        ? '🟢 مفعل'
                                        : '🔴 متوقف',
                                inline: true
                            },
                            {
                                name: 'الروم',
                                value:
                                    settings.welcome.channelId
                                        ? `<#${settings.welcome.channelId}>`
                                        : 'غير محدد',
                                inline: true
                            },
                            {
                                name: 'الرسالة',
                                value:
                                    settings.welcome.message
                            }
                        );

                return interaction.reply({
                    embeds: [embed]
                });
            }
        }

        /* =========================
           SHORTCUT
        ========================= */

        if (interaction.commandName === 'shortcut') {

            const subcommand =
                interaction.options.getSubcommand();

            const settings =
                await getSettings(
                    interaction.guild.id
                );

            if (subcommand === 'list') {

                return interaction.reply({
                    embeds: [
                        shortcutsEmbed(settings)
                    ]
                });
            }

            if (subcommand === 'add') {

                const name =
                    interaction.options.getString(
                        'name'
                    ).trim();

                const command =
                    interaction.options.getString(
                        'command'
                    ).trim();

                settings.shortcuts.set(
                    name,
                    command
                );

                await settings.save();

                return interaction.reply({
                    content:
                        '✅ تم إضافة الاختصار.',
                    embeds: [
                        shortcutsEmbed(settings)
                    ]
                });
            }

            if (subcommand === 'edit') {

                const name =
                    interaction.options.getString(
                        'name'
                    ).trim();

                const command =
                    interaction.options.getString(
                        'command'
                    ).trim();

                if (!settings.shortcuts.has(name)) {
                    return interaction.reply({
                        content:
                            '❌ الاختصار غير موجود.',
                        ephemeral: true
                    });
                }

                settings.shortcuts.set(
                    name,
                    command
                );

                await settings.save();

                return interaction.reply({
                    content:
                        '✅ تم تعديل الاختصار.',
                    embeds: [
                        shortcutsEmbed(settings)
                    ]
                });
            }

            if (subcommand === 'remove') {

                const name =
                    interaction.options.getString(
                        'name'
                    ).trim();

                if (!settings.shortcuts.has(name)) {
                    return interaction.reply({
                        content:
                            '❌ الاختصار غير موجود.',
                        ephemeral: true
                    });
                }

                settings.shortcuts.delete(name);

                await settings.save();

                return interaction.reply({
                    content:
                        '🗑️ تم حذف الاختصار.',
                    embeds: [
                        shortcutsEmbed(settings)
                    ]
                });
            }
        }

        /* =========================
           AUTO RESPONSE
        ========================= */

        if (
            interaction.commandName ===
            'autoresponse'
        ) {

            const subcommand =
                interaction.options.getSubcommand();

            const settings =
                await getSettings(
                    interaction.guild.id
                );

            if (subcommand === 'list') {

                return interaction.reply({
                    embeds: [
                        autoResponsesEmbed(
                            settings
                        )
                    ]
                });
            }

            if (subcommand === 'add') {

                const trigger =
                    interaction.options.getString(
                        'trigger'
                    ).trim();

                const response =
                    interaction.options.getString(
                        'response'
                    ).trim();

                settings.autoResponses.set(
                    trigger,
                    response
                );

                await settings.save();

                return interaction.reply({
                    content:
                        '✅ تم إضافة الرد التلقائي.',
                    embeds: [
                        autoResponsesEmbed(
                            settings
                        )
                    ]
                });
            }

            if (subcommand === 'edit') {

                const trigger =
                    interaction.options.getString(
                        'trigger'
                    ).trim();

                const response =
                    interaction.options.getString(
                        'response'
                    ).trim();

                if (
                    !settings.autoResponses.has(
                        trigger
                    )
                ) {
                    return interaction.reply({
                        content:
                            '❌ الرد التلقائي غير موجود.',
                        ephemeral: true
                    });
                }

                settings.autoResponses.set(
                    trigger,
                    response
                );

                await settings.save();

                return interaction.reply({
                    content:
                        '✅ تم تعديل الرد التلقائي.',
                    embeds: [
                        autoResponsesEmbed(
                            settings
                        )
                    ]
                });
            }

            if (subcommand === 'remove') {

                const trigger =
                    interaction.options.getString(
                        'trigger'
                    ).trim();

                if (
                    !settings.autoResponses.has(
                        trigger
                    )
                ) {
                    return interaction.reply({
                        content:
                            '❌ الرد التلقائي غير موجود.',
                        ephemeral: true
                    });
                }

                settings.autoResponses.delete(
                    trigger
                );

                await settings.save();

                return interaction.reply({
                    content:
                        '🗑️ تم حذف الرد التلقائي.',
                    embeds: [
                        autoResponsesEmbed(
                            settings
                        )
                    ]
                });
            }
        }

        /* =========================
           LOGS
        ========================= */

        if (interaction.commandName === 'logs') {

            const type =
                interaction.options.getString(
                    'type'
                );

            const channel =
                interaction.options.getChannel(
                    'channel'
                );

            const settings =
                await getSettings(
                    interaction.guild.id
                );

            settings.logs[type] =
                channel.id;

            await settings.save();

            return interaction.reply(
                `✅ تم تعيين لوق **${type}** في ${channel}.`
            );
        }

        /* =========================
           LEVEL
        ========================= */

        if (interaction.commandName === 'level') {

            const member =
                interaction.options.getMember(
                    'user'
                ) || interaction.member;

            const data =
                await UserLevel.findOne({
                    guildId:
                        interaction.guild.id,
                    userId: member.id
                });

            const level =
                data?.level || 0;

            const messages =
                data?.messages || 0;

            const settings =
                await getSettings(
                    interaction.guild.id
                );

            const required =
                settings.levelSettings
                    .messagesPerLevel;

            const embed =
                new EmbedBuilder()
                    .setTitle(
                        `📊 مستوى ${member.user.username}`
                    )
                    .setColor(0x2b2d31)
                    .addFields(
                        {
                            name: 'المستوى',
                            value: `${level}`,
                            inline: true
                        },
                        {
                            name: 'الرسائل',
                            value: `${messages}`,
                            inline: true
                        },
                        {
                            name:
                                'المطلوب للمستوى التالي',
                            value:
                                `${required}`,
                            inline: true
                        }
                    );

            return interaction.reply({
                embeds: [embed]
            });
        }

        /* =========================
           LEVEL SETTINGS
        ========================= */

        if (
            interaction.commandName ===
            'level-settings'
        ) {

            const subcommand =
                interaction.options.getSubcommand();

            const settings =
                await getSettings(
                    interaction.guild.id
                );

            if (subcommand === 'messages') {

                const amount =
                    interaction.options.getInteger(
                        'amount'
                    );

                settings.levelSettings
                    .messagesPerLevel = amount;

                settings.levelSettings
                    .enabled = true;

                await settings.save();

                return interaction.reply(
                    `✅ كل ${amount} رسالة = مستوى جديد.`
                );
            }

            if (subcommand === 'reward') {

                const level =
                    interaction.options.getInteger(
                        'level'
                    );

                const role =
                    interaction.options.getRole(
                        'role'
                    );

                settings.levelSettings
                    .rewards.set(
                        String(level),
                        role.id
                    );

                await settings.save();

                return interaction.reply(
                    `✅ تم تعيين ${role} كمكافأة للمستوى ${level}.`
                );
            }

            if (subcommand === 'disable') {

                settings.levelSettings
                    .enabled = false;

                await settings.save();

                return interaction.reply(
                    '✅ تم إيقاف نظام المستويات.'
                );
            }
        }

    } catch (error) {

        console.error(
            '❌ Interaction error:',
            error
        );

        if (
            interaction.replied ||
            interaction.deferred
        ) {
            return interaction.followUp({
                content:
                    '❌ حدث خطأ أثناء تنفيذ الأمر.',
                ephemeral: true
            });
        }

        return interaction.reply({
            content:
                '❌ حدث خطأ أثناء تنفيذ الأمر.',
            ephemeral: true
        });
    }
});

/* =========================================================
   MESSAGE CREATE
========================================================= */

client.on('messageCreate', async message => {

    if (message.author.bot) return;
    if (!message.guild) return;

    try {

        const settings =
            await getSettings(
                message.guild.id
            );

        /* =========================
           AUTO RESPONSE
        ========================= */

        const content =
            message.content.trim();

        const response =
            settings.autoResponses.get(
                content
            );

        if (response) {
            await message.reply(response);
        }

        /* =========================
           SHORTCUTS
        ========================= */

        const words =
            content.split(/\s+/);

        const shortcutName =
            words[0];

        const shortcut =
            settings.shortcuts.get(
                shortcutName
            );

        if (shortcut) {

            /*
               الاختصارات أيضاً تحتاج Administrator
               مثل السلاشات.
            */

            if (
                !isOwner(message.author.id) &&
                !message.member.permissions.has(
                    PermissionsBitField.Flags.Administrator
                )
            ) {
                return;
            }

            const command =
                shortcut.toLowerCase().trim();

            const target =
                message.mentions.members.first();

            if (
                command === 'kick' &&
                target
            ) {

                if (target.id === OWNER_ID) {
                    return;
                }

                await target.kick(
                    `Shortcut by ${message.author.tag}`
                );

                await message.reply(
                    `👢 تم طرد ${target}.`
                );
            }

            else if (
                command === 'ban' &&
                target
            ) {

                if (target.id === OWNER_ID) {
                    return;
                }

                await target.ban();

                await message.reply(
                    `🔨 تم حظر ${target}.`
                );
            }

            else if (
                command === 'jail' &&
                target
            ) {

                const jailRole =
                    await getJailRole(
                        message.guild
                    );

                const roles =
                    target.roles.cache
                        .filter(role =>
                            role.id !==
                            message.guild.id
                        )
                        .map(role => role.id);

                await JailData.findOneAndUpdate(
                    {
                        guildId:
                            message.guild.id,
                        userId:
                            target.id
                    },
                    {
                        roles
                    },
                    {
                        upsert: true
                    }
                );

                await target.roles.set([
                    jailRole.id
                ]);

                await message.reply(
                    `🔒 تم سجن ${target}.`
                );
            }

            else if (
                command === 'unjail' &&
                target
            ) {

                const data =
                    await JailData.findOne({
                        guildId:
                            message.guild.id,
                        userId:
                            target.id
                    });

                if (!data) return;

                const roles =
                    data.roles.filter(
                        roleId =>
                            message.guild.roles.cache.has(
                                roleId
                            )
                    );

                await target.roles.set(
                    roles
                );

                await JailData.deleteOne({
                    guildId:
                        message.guild.id,
                    userId:
                        target.id
                });

                await message.reply(
                    `🔓 تم فك سجن ${target}.`
                );
            }

            else if (
                command === 'timeout' &&
                target
            ) {

                const durationText =
                    words[1];

                if (!durationText) return;

                const duration =
                    ms(durationText);

                if (!duration) return;

                if (
                    duration >
                    28 * 24 * 60 * 60 * 1000
                ) {
                    return;
                }

                await target.timeout(
                    duration
                );

                await message.reply(
                    `⏱️ تم إعطاء ${target} تايم أوت لمدة ${durationText}.`
                );
            }

            else if (
                command === 'untimeout' &&
                target
            ) {

                await target.timeout(null);

                await message.reply(
                    `🔓 تم إزالة التايم أوت عن ${target}.`
                );
            }

            else if (command === 'lock') {

                await message.channel
                    .permissionOverwrites.edit(
                        message.guild.roles.everyone,
                        {
                            SendMessages: false
                        }
                    );

                await message.reply(
                    '🔒 تم قفل الروم.'
                );
            }

            else if (command === 'unlock') {

                await message.channel
                    .permissionOverwrites.edit(
                        message.guild.roles.everyone,
                        {
                            SendMessages: null
                        }
                    );

                await message.reply(
                    '🔓 تم فتح الروم.'
                );
            }

            else if (command === 'purge') {

                const amount =
                    parseInt(words[1]);

                if (
                    !amount ||
                    amount < 1 ||
                    amount > 100
                ) {
                    return;
                }

                await message.channel.bulkDelete(
                    amount + 1,
                    true
                );
            }
        }

        /* =========================
           LEVEL SYSTEM
        ========================= */

        if (
            settings.levelSettings.enabled
        ) {

            let data =
                await UserLevel.findOne({
                    guildId:
                        message.guild.id,
                    userId:
                        message.author.id
                });

            if (!data) {
                data =
                    await UserLevel.create({
                        guildId:
                            message.guild.id,
                        userId:
                            message.author.id
                    });
            }

            data.messages++;

            const required =
                settings.levelSettings
                    .messagesPerLevel;

            if (data.messages >= required) {

                data.messages = 0;
                data.level++;

                const rewardRoleId =
                    settings.levelSettings
                        .rewards.get(
                            String(data.level)
                        );

                await data.save();

                if (rewardRoleId) {

                    const role =
                        message.guild.roles.cache.get(
                            rewardRoleId
                        );

                    if (role) {
                        try {
                            await message.member.roles.add(
                                role
                            );
                        } catch {}
                    }
                }

                await message.channel.send(
                    `🎉 مبروك ${message.author}! وصلت للمستوى **${data.level}**.`
                );

            } else {
                await data.save();
            }
        }

    } catch (error) {
        console.error(
            '❌ Message error:',
            error
        );
    }
});

/* =========================================================
   WELCOME
========================================================= */

client.on('guildMemberAdd', async member => {

    try {

        const settings =
            await getSettings(
                member.guild.id
            );

        if (!settings.welcome.enabled) {
            return;
        }

        const channel =
            member.guild.channels.cache.get(
                settings.welcome.channelId
            );

        if (!channel) return;

        const text =
            settings.welcome.message
                .replace(
                    /{user}/g,
                    `<@${member.id}>`
                )
                .replace(
                    /{username}/g,
                    member.user.username
                )
                .replace(
                    /{server}/g,
                    member.guild.name
                )
                .replace(
                    /{count}/g,
                    String(
                        member.guild.memberCount
                    )
                );

        await channel.send(text);

        await sendLog(
            member.guild,
            'members',
            '📥 Member Join',
            `${member} دخل السيرفر.`
        );

    } catch (error) {
        console.error(
            '❌ Welcome error:',
            error
        );
    }
});

/* =========================================================
   MEMBER LEAVE
========================================================= */

client.on('guildMemberRemove', async member => {

    try {

        await sendLog(
            member.guild,
            'members',
            '📤 Member Leave',
            `**${member.user.tag}** خرج من السيرفر.`
        );

    } catch {}
});

/* =========================================================
   MESSAGE DELETE
========================================================= */

client.on('messageDelete', async message => {

    if (!message.guild) return;

    await sendLog(
        message.guild,
        'messages',
        '🗑️ Message Delete',
        `تم حذف رسالة في ${message.channel}.`
    );
});

/* =========================================================
   MESSAGE UPDATE
========================================================= */

client.on(
    'messageUpdate',
    async (oldMessage, newMessage) => {

        if (!newMessage.guild) return;

        if (
            oldMessage.content ===
            newMessage.content
        ) {
            return;
        }

        await sendLog(
            newMessage.guild,
            'messages',
            '✏️ Message Edit',
            `تم تعديل رسالة في ${newMessage.channel}.`
        );
    }
);

/* =========================================================
   VOICE LOGS
========================================================= */

client.on(
    'voiceStateUpdate',
    async (oldState, newState) => {

        const guild =
            newState.guild;

        if (
            !oldState.channelId &&
            newState.channelId
        ) {

            await sendLog(
                guild,
                'voice',
                '🔊 Voice Join',
                `${newState.member} دخل ${newState.channel}.`
            );

            return;
        }

        if (
            oldState.channelId &&
            !newState.channelId
        ) {

            await sendLog(
                guild,
                'voice',
                '🔇 Voice Leave',
                `${newState.member} خرج من الروم الصوتي.`
            );

            return;
        }

        if (
            oldState.channelId !==
            newState.channelId
        ) {

            await sendLog(
                guild,
                'voice',
                '🔄 Voice Move',
                `${newState.member} انتقل من <#${oldState.channelId}> إلى <#${newState.channelId}>.`
            );
        }
    }
);

/* =========================================================
   ROLE LOGS
========================================================= */

client.on('roleCreate', async role => {

    await sendLog(
        role.guild,
        'roles',
        '➕ Role Create',
        `تم إنشاء الرتبة ${role}.`
    );
});

client.on('roleDelete', async role => {

    await sendLog(
        role.guild,
        'roles',
        '➖ Role Delete',
        `تم حذف الرتبة **${role.name}**.`
    );
});

client.on(
    'roleUpdate',
    async (oldRole, newRole) => {

        if (
            oldRole.name ===
            newRole.name
        ) {
            return;
        }

        await sendLog(
            newRole.guild,
            'roles',
            '✏️ Role Update',
            `تم تعديل الرتبة من **${oldRole.name}** إلى **${newRole.name}**.`
        );
    }
);

/* =========================================================
   CHANNEL LOGS
========================================================= */

client.on(
    'channelCreate',
    async channel => {

        if (!channel.guild) return;

        await sendLog(
            channel.guild,
            'channels',
            '➕ Channel Create',
            `تم إنشاء ${channel}.`
        );
    }
);

client.on(
    'channelDelete',
    async channel => {

        if (!channel.guild) return;

        await sendLog(
            channel.guild,
            'channels',
            '➖ Channel Delete',
            `تم حذف الروم **${channel.name}**.`
        );
    }
);

client.on(
    'channelUpdate',
    async (oldChannel, newChannel) => {

        if (!newChannel.guild) return;

        await sendLog(
            newChannel.guild,
            'channels',
            '✏️ Channel Update',
            `تم تعديل الروم ${newChannel}.`
        );
    }
);

/* =========================================================
   ERRORS
========================================================= */

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

/* =========================================================
   LOGIN
========================================================= */

client.login(TOKEN)
    .then(() => {
        console.log('🔄 Discord login started...');
    })
    .catch(error => {
        console.error(
            '❌ Discord login failed:',
            error
        );
        process.exit(1);
    });