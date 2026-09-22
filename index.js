const {
    Client,
    GatewayIntentBits,
    PermissionsBitField,
    EmbedBuilder,
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType
} = require('discord.js');

const mongoose = require('mongoose');
const ms = require('ms');
const fs = require('fs');
const express = require('express');

// ======================================================
// SERVER
// ======================================================

const app = express();
const port = process.env.PORT || 3000;

app.get('/', (req, res) => {
    res.send('Bot is active!');
});

app.listen(port, () => {
    console.log(`Server listening on ${port}`);
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
// OWNER
// ======================================================

const OWNER_ID = '1364275261398581279';

function isOwner(id) {
    return id === OWNER_ID;
}

// ======================================================
// DATABASE
// ======================================================

const guildSchema = new mongoose.Schema({
    _id: String,

    // اللوقات
    logs: {
        moderation: { type: String, default: null },
        member: { type: String, default: null },
        voice: { type: String, default: null },
        role: { type: String, default: null },
        channel: { type: String, default: null },
        webhook: { type: String, default: null },
        message: { type: String, default: null }
    },

    // الترحيب
    welcome: {
        enabled: { type: Boolean, default: false },
        channel: { type: String, default: null },
        message: {
            type: String,
            default:
                '𝐖𝐄𝐋𝐂𝐎𝐌𝐄 {user}\n\nنورت السيرفر ❤️\nعدد الأعضاء: {membercount}'
        }
    },

    // الردود التلقائية
    autoResponses: {
        type: Map,
        of: String,
        default: {}
    },

    // الاختصارات
    shortcuts: {
        type: Map,
        of: String,
        default: {}
    },

    // اللفلات
    levels: {
        enabled: { type: Boolean, default: true },
        messagesPerLevel: { type: Number, default: 50 },
        rewards: {
            type: Map,
            of: String,
            default: {}
        }
    }
});

const GuildSettings = mongoose.model('GuildSettings', guildSchema);

// ======================================================
// USER LEVEL DATABASE
// ======================================================

const userSchema = new mongoose.Schema({
    guildId: String,
    userId: String,
    messages: { type: Number, default: 0 },
    level: { type: Number, default: 0 }
});

userSchema.index({ guildId: 1, userId: 1 }, { unique: true });

const UserLevel = mongoose.model('UserLevel', userSchema);

// ======================================================
// JAIL DATABASE
// ======================================================

const jailSchema = new mongoose.Schema({
    guildId: String,
    userId: String,
    roles: [String]
});

jailSchema.index({ guildId: 1, userId: 1 }, { unique: true });

const JailData = mongoose.model('JailData', jailSchema);

// ======================================================
// HELPERS
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

async function permissionCheck(interaction, permission) {
    if (isOwner(interaction.user.id)) return true;

    return interaction.member.permissions.has(permission);
}

function canTarget(interaction, target) {
    if (!target) {
        return {
            allowed: false,
            reason: '❌ حدد العضو.'
        };
    }

    if (isOwner(target.id)) {
        return {
            allowed: false,
            reason: '❌ ما تقدر تسوي أي إجراء على الأونر.'
        };
    }

    if (
        !isOwner(interaction.user.id) &&
        target.roles.highest.position >= interaction.member.roles.highest.position
    ) {
        return {
            allowed: false,
            reason: '❌ رتبة العضو أعلى منك أو مساوية لرتبتك.'
        };
    }

    return {
        allowed: true
    };
}

// ======================================================
// LOG SYSTEM
// ======================================================

async function sendLog(
    guild,
    type,
    title,
    description,
    color = 0x5865F2
) {
    try {
        const settings = await getSettings(guild.id);

        const channelId = settings.logs[type];

        if (!channelId) return;

        const channel = guild.channels.cache.get(channelId);

        if (!channel) return;

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setDescription(description)
            .setColor(color)
            .setTimestamp();

        await channel.send({
            embeds: [embed]
        }).catch(() => {});
    } catch (error) {
        console.error('[LOG ERROR]', error);
    }
}

// ======================================================
// WELCOME VARIABLES
// ======================================================

function parseWelcome(text, member) {
    return text
        .replaceAll('{user}', `<@${member.id}>`)
        .replaceAll('{username}', member.user.username)
        .replaceAll('{server}', member.guild.name)
        .replaceAll('{membercount}', String(member.guild.memberCount))
        .replaceAll('{channel}', `<#${member.guild.systemChannelId || ''}>`);
}

// ======================================================
// JAIL ROLE
// ======================================================

async function getJailRole(guild) {
    let role = guild.roles.cache.find(r => r.name === 'Jailed');

    if (role) return role;

    role = await guild.roles.create({
        name: 'Jailed',
        color: '#FF0000',
        reason: 'Jail system'
    });

    for (const channel of guild.channels.cache.values()) {
        if (!channel.isTextBased()) continue;

        try {
            await channel.permissionOverwrites.edit(role.id, {
                SendMessages: false,
                AddReactions: false,
                CreatePublicThreads: false,
                CreatePrivateThreads: false
            });
        } catch {}
    }

    return role;
}

// ======================================================
// SLASH COMMANDS
// ======================================================

const commands = [

    // ================= MODERATION =================

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
                .setDescription('العضو')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('ban')
        .setDescription('حظر عضو')
        .addUserOption(o =>
            o.setName('user')
                .setDescription('العضو')
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
            o.setName('user')
                .setDescription('آيدي العضو')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('kick')
        .setDescription('طرد عضو')
        .addUserOption(o =>
            o.setName('user')
                .setDescription('العضو')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('timeout')
        .setDescription('إعطاء تايم أوت')
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
        .setDescription('فك التايم أوت')
        .addUserOption(o =>
            o.setName('user')
                .setDescription('العضو')
                .setRequired(true)
        ),

    // ================= ROLES =================

    new SlashCommandBuilder()
        .setName('role-add')
        .setDescription('إعطاء عضو رتبة')
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

    // ================= MESSAGES =================

    new SlashCommandBuilder()
        .setName('purge')
        .setDescription('مسح رسائل')
        .addIntegerOption(o =>
            o.setName('amount')
                .setDescription('عدد الرسائل من 1 إلى 100')
                .setMinValue(1)
                .setMaxValue(100)
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('lock')
        .setDescription('قفل الشات'),

    new SlashCommandBuilder()
        .setName('unlock')
        .setDescription('فتح الشات'),

    // ================= WELCOME =================

    new SlashCommandBuilder()
        .setName('welcome')
        .setDescription('إعداد نظام الترحيب')
        .addSubcommand(sub =>
            sub.setName('setup')
                .setDescription('إنشاء الترحيب')
                .addChannelOption(o =>
                    o.setName('channel')
                        .setDescription('روم الترحيب')
                        .setRequired(true)
                )
                .addStringOption(o =>
                    o.setName('message')
                        .setDescription('رسالة الترحيب')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('disable')
                .setDescription('إيقاف الترحيب')
        ),

    // ================= AUTO RESPONSE =================

    new SlashCommandBuilder()
        .setName('autoresponse')
        .setDescription('إدارة الردود التلقائية')
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
            sub.setName('edit')
                .setDescription('تعديل رد تلقائي')
                .addStringOption(o =>
                    o.setName('trigger')
                        .setDescription('الكلمة')
                        .setRequired(true)
                )
                .addStringOption(o =>
                    o.setName('response')
                        .setDescription('الرد الجديد')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('حذف رد تلقائي')
                .addStringOption(o =>
                    o.setName('trigger')
                        .setDescription('الكلمة')
                        .setRequired(true)
                )
        ),

    // ================= SHORTCUTS =================

    new SlashCommandBuilder()
        .setName('shortcut')
        .setDescription('إدارة اختصارات الأوامر')
        .addSubcommand(sub =>
            sub.setName('add')
                .setDescription('إضافة اختصار')
                .addStringOption(o =>
                    o.setName('command')
                        .setDescription('الأمر مثل jail أو kick')
                        .setRequired(true)
                        .addChoices(
                            { name: 'jail', value: 'jail' },
                            { name: 'unjail', value: 'unjail' },
                            { name: 'ban', value: 'ban' },
                            { name: 'kick', value: 'kick' },
                            { name: 'timeout', value: 'timeout' },
                            { name: 'untimeout', value: 'untimeout' },
                            { name: 'purge', value: 'purge' },
                            { name: 'lock', value: 'lock' },
                            { name: 'unlock', value: 'unlock' }
                        )
                )
                .addStringOption(o =>
                    o.setName('shortcut')
                        .setDescription('الاختصار الذي تريده')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('remove')
                .setDescription('حذف اختصار')
                .addStringOption(o =>
                    o.setName('shortcut')
                        .setDescription('الاختصار')
                        .setRequired(true)
                )
        )
        .addSubcommand(sub =>
            sub.setName('list')
                .setDescription('عرض الاختصارات')
        ),

    // ================= LOGS =================

    new SlashCommandBuilder()
        .setName('logs')
        .setDescription('فتح لوحة إعدادات اللوقات'),

    // ================= LEVELS =================

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
        .setDescription('إعدادات نظام اللفلات')
        .addIntegerOption(o =>
            o.setName('messages')
                .setDescription('عدد الرسائل لكل لفل')
                .setMinValue(1)
                .setRequired(true)
        )
];

// ======================================================
// READY
// ======================================================

client.once('ready', async () => {

    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');
    } catch (error) {
        console.error('❌ MongoDB Error:', error);
        process.exit(1);
    }

    console.log(`✅ Logged in as ${client.user.tag}`);

    await client.application.commands.set(
        commands.map(command => command.toJSON())
    );

    console.log('✅ Slash Commands Registered');
});

// ======================================================
// INTERACTIONS
// ======================================================

client.on('interactionCreate', async interaction => {

    try {

        // ==================================================
        // BUTTONS
        // ==================================================

        if (interaction.isButton()) {

            if (!interaction.customId.startsWith('logs_')) return;

            const type = interaction.customId.replace('logs_', '');

            const settings = await getSettings(interaction.guild.id);

            const channel = interaction.channel;

            settings.logs[type] = channel.id;

            await settings.save();

            return interaction.reply({
                content: `✅ تم تحديد هذا الروم كلوق **${type}**.`,
                ephemeral: true
            });
        }

        // ==================================================
        // SELECT MENU
        // ==================================================

        if (interaction.isStringSelectMenu()) {

            if (interaction.customId === 'logs_menu') {

                const type = interaction.values[0];

                const row = new ActionRowBuilder()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(`logs_${type}`)
                            .setLabel('تحديد هذا الروم')
                            .setStyle(ButtonStyle.Primary)
                    );

                return interaction.reply({
                    content:
                        `اختر الروم الذي تريد استخدامه للوق **${type}**.\n` +
                        `اضغط الزر بالأسفل لتعيين الروم الحالي.`,
                    components: [row],
                    ephemeral: true
                });
            }

            return;
        }

        // ==================================================
        // SLASH
        // ==================================================

        if (!interaction.isChatInputCommand()) return;

        const command = interaction.commandName;

        // ==================================================
        // JAIL
        // ==================================================

        if (command === 'jail') {

            if (!await permissionCheck(
                interaction,
                PermissionsBitField.Flags.ManageRoles
            )) {
                return interaction.reply({
                    content: '❌ ما عندك صلاحية Manage Roles.',
                    ephemeral: true
                });
            }

            const target = interaction.options.getMember('user');

            const check = canTarget(interaction, target);

            if (!check.allowed) {
                return interaction.reply({
                    content: check.reason,
                    ephemeral: true
                });
            }

            const existing = await JailData.findOne({
                guildId: interaction.guild.id,
                userId: target.id
            });

            if (existing) {
                return interaction.reply({
                    content: '❌ العضو مسجون بالفعل.',
                    ephemeral: true
                });
            }

            const roles = target.roles.cache
                .filter(r => r.id !== interaction.guild.id)
                .map(r => r.id);

            await JailData.create({
                guildId: interaction.guild.id,
                userId: target.id,
                roles
            });

            const jailRole = await getJailRole(interaction.guild);

            await target.roles.set([jailRole.id]);

            await sendLog(
                interaction.guild,
                'moderation',
                '🔒 Jail',
                `العضو: <@${target.id}>\nبواسطة: <@${interaction.user.id}>`
            );

            return interaction.reply(
                `🔒 تم سجن **${target.user.username}**.`
            );
        }

        // ==================================================
        // UNJAIL
        // ==================================================

        if (command === 'unjail') {

            if (!await permissionCheck(
                interaction,
                PermissionsBitField.Flags.ManageRoles
            )) {
                return interaction.reply({
                    content: '❌ ما عندك صلاحية.',
                    ephemeral: true
                });
            }

            const target = interaction.options.getMember('user');

            const data = await JailData.findOne({
                guildId: interaction.guild.id,
                userId: target.id
            });

            if (!data) {
                return interaction.reply({
                    content: '❌ العضو غير مسجون.',
                    ephemeral: true
                });
            }

            await target.roles.set(data.roles);

            await JailData.deleteOne({
                guildId: interaction.guild.id,
                userId: target.id
            });

            await sendLog(
                interaction.guild,
                'moderation',
                '🔓 Unjail',
                `العضو: <@${target.id}>\nبواسطة: <@${interaction.user.id}>`,
                0x00FF00
            );

            return interaction.reply(
                `🔓 تم فك سجن **${target.user.username}**.`
            );
        }

        // ==================================================
        // BAN
        // ==================================================

        if (command === 'ban') {

            if (!await permissionCheck(
                interaction,
                PermissionsBitField.Flags.BanMembers
            )) {
                return interaction.reply({
                    content: '❌ ما عندك صلاحية Ban Members.',
                    ephemeral: true
                });
            }

            const target = interaction.options.getMember('user');

            const check = canTarget(interaction, target);

            if (!check.allowed) {
                return interaction.reply({
                    content: check.reason,
                    ephemeral: true
                });
            }

            const reason =
                interaction.options.getString('reason') ||
                'بدون سبب';

            await target.ban({
                reason
            });

            await sendLog(
                interaction.guild,
                'moderation',
                '🔨 Ban',
                `العضو: <@${target.id}>\nالسبب: ${reason}\nبواسطة: <@${interaction.user.id}>`,
                0xFF0000
            );

            return interaction.reply(
                `🔨 تم حظر **${target.user.username}**.`
            );
        }

        // ==================================================
        // UNBAN
        // ==================================================

        if (command === 'unban') {

            if (!await permissionCheck(
                interaction,
                PermissionsBitField.Flags.BanMembers
            )) {
                return interaction.reply({
                    content: '❌ ما عندك صلاحية.',
                    ephemeral: true
                });
            }

            const userId = interaction.options.getString('user');

            if (isOwner(userId)) {
                return interaction.reply({
                    content: '❌ ما تقدر تفك/تعدل على الأونر.',
                    ephemeral: true
                });
            }

            await interaction.guild.members.unban(userId);

            await sendLog(
                interaction.guild,
                'moderation',
                '🔓 Unban',
                `العضو ID: ${userId}\nبواسطة: <@${interaction.user.id}>`,
                0x00FF00
            );

            return interaction.reply(
                `🔓 تم فك الحظر عن \`${userId}\`.`
            );
        }

        // ==================================================
        // KICK
        // ==================================================

        if (command === 'kick') {

            if (!await permissionCheck(
                interaction,
                PermissionsBitField.Flags.KickMembers
            )) {
                return interaction.reply({
                    content: '❌ ما عندك صلاحية Kick Members.',
                    ephemeral: true
                });
            }

            const target = interaction.options.getMember('user');

            const check = canTarget(interaction, target);

            if (!check.allowed) {
                return interaction.reply({
                    content: check.reason,
                    ephemeral: true
                });
            }

            await target.kick();

            await sendLog(
                interaction.guild,
                'moderation',
                '👢 Kick',
                `العضو: <@${target.id}>\nبواسطة: <@${interaction.user.id}>`,
                0xFFA500
            );

            return interaction.reply(
                `👢 تم طرد **${target.user.username}**.`
            );
        }

        // ==================================================
        // TIMEOUT
        // ==================================================

        if (command === 'timeout') {

            if (!await permissionCheck(
                interaction,
                PermissionsBitField.Flags.ModerateMembers
            )) {
                return interaction.reply({
                    content: '❌ ما عندك صلاحية Moderate Members.',
                    ephemeral: true
                });
            }

            const target = interaction.options.getMember('user');
            const durationText =
                interaction.options.getString('duration');

            const check = canTarget(interaction, target);

            if (!check.allowed) {
                return interaction.reply({
                    content: check.reason,
                    ephemeral: true
                });
            }

            const duration = ms(durationText);

            if (!duration) {
                return interaction.reply({
                    content: '❌ مدة غير صحيحة. مثال: `10m` أو `1h` أو `1d`.',
                    ephemeral: true
                });
            }

            const MAX_TIMEOUT = 28 * 24 * 60 * 60 * 1000;

            if (duration > MAX_TIMEOUT) {
                return interaction.reply({
                    content: '❌ أقصى مدة تايم أوت هي 28 يوم.',
                    ephemeral: true
                });
            }

            await target.timeout(
                duration,
                `بواسطة ${interaction.user.username}`
            );

            await sendLog(
                interaction.guild,
                'moderation',
                '🔇 Timeout',
                `العضو: <@${target.id}>\nالمدة: ${durationText}\nبواسطة: <@${interaction.user.id}>`
            );

            return interaction.reply(
                `🔇 تم إعطاء **${target.user.username}** تايم لمدة **${durationText}**.`
            );
        }

        // ==================================================
        // UNTIMEOUT
        // ==================================================

        if (command === 'untimeout') {

            if (!await permissionCheck(
                interaction,
                PermissionsBitField.Flags.ModerateMembers
            )) {
                return interaction.reply({
                    content: '❌ ما عندك صلاحية.',
                    ephemeral: true
                });
            }

            const target = interaction.options.getMember('user');

            const check = canTarget(interaction, target);

            if (!check.allowed) {
                return interaction.reply({
                    content: check.reason,
                    ephemeral: true
                });
            }

            await target.timeout(null);

            await sendLog(
                interaction.guild,
                'moderation',
                '🔊 Remove Timeout',
                `العضو: <@${target.id}>\nبواسطة: <@${interaction.user.id}>`,
                0x00FF00
            );

            return interaction.reply(
                `🔊 تم فك التايم عن **${target.user.username}**.`
            );
        }

        // ==================================================
        // ROLE ADD
        // ==================================================

        if (command === 'role-add') {

            if (!await permissionCheck(
                interaction,
                PermissionsBitField.Flags.ManageRoles
            )) {
                return interaction.reply({
                    content: '❌ ما عندك صلاحية Manage Roles.',
                    ephemeral: true
                });
            }

            const target = interaction.options.getMember('user');
            const role = interaction.options.getRole('role');

            const check = canTarget(interaction, target);

            if (!check.allowed) {
                return interaction.reply({
                    content: check.reason,
                    ephemeral: true
                });
            }

            if (
                !isOwner(interaction.user.id) &&
                role.position >= interaction.member.roles.highest.position
            ) {
                return interaction.reply({
                    content: '❌ ما تقدر تستخدم رتبة أعلى منك أو مساوية لك.',
                    ephemeral: true
                });
            }

            await target.roles.add(role);

            await sendLog(
                interaction.guild,
                'role',
                '🏷️ Role Added',
                `العضو: <@${target.id}>\nالرتبة: <@&${role.id}>\nبواسطة: <@${interaction.user.id}>`,
                0x00FF00
            );

            return interaction.reply(
                `✅ تم إعطاء <@${target.id}> رتبة **${role.name}**.`
            );
        }

        // ==================================================
        // ROLE REMOVE
        // ==================================================

        if (command === 'role-remove') {

            if (!await permissionCheck(
                interaction,
                PermissionsBitField.Flags.ManageRoles
            )) {
                return interaction.reply({
                    content: '❌ ما عندك صلاحية.',
                    ephemeral: true
                });
            }

            const target = interaction.options.getMember('user');
            const role = interaction.options.getRole('role');

            const check = canTarget(interaction, target);

            if (!check.allowed) {
                return interaction.reply({
                    content: check.reason,
                    ephemeral: true
                });
            }

            await target.roles.remove(role);

            await sendLog(
                interaction.guild,
                'role',
                '🗑️ Role Removed',
                `العضو: <@${target.id}>\nالرتبة: <@&${role.id}>\nبواسطة: <@${interaction.user.id}>`,
                0xFFA500
            );

            return interaction.reply(
                `🗑️ تم إزالة رتبة **${role.name}** من <@${target.id}>.`
            );
        }

        // ==================================================
        // PURGE
        // ==================================================

        if (command === 'purge') {

            if (!await permissionCheck(
                interaction,
                PermissionsBitField.Flags.ManageMessages
            )) {
                return interaction.reply({
                    content: '❌ ما عندك صلاحية Manage Messages.',
                    ephemeral: true
                });
            }

            const amount = interaction.options.getInteger('amount');

            const deleted =
                await interaction.channel.bulkDelete(amount, true);

            await sendLog(
                interaction.guild,
                'message',
                '🗑️ Purge',
                `تم حذف **${deleted.size}** رسالة\nالروم: <#${interaction.channel.id}>\nبواسطة: <@${interaction.user.id}>`,
                0xFFA500
            );

            return interaction.reply({
                content: `🗑️ تم حذف **${deleted.size}** رسالة.`,
                ephemeral: true
            });
        }

        // ==================================================
        // LOCK
        // ==================================================

        if (command === 'lock') {

            if (!await permissionCheck(
                interaction,
                PermissionsBitField.Flags.ManageChannels
            )) {
                return interaction.reply({
                    content: '❌ ما عندك صلاحية Manage Channels.',
                    ephemeral: true
                });
            }

            await interaction.channel.permissionOverwrites.edit(
                interaction.guild.roles.everyone,
                {
                    SendMessages: false
                }
            );

            await sendLog(
                interaction.guild,
                'channel',
                '🔒 Channel Locked',
                `الروم: <#${interaction.channel.id}>\nبواسطة: <@${interaction.user.id}>`
            );

            return interaction.reply('🔒 تم قفل الشات.');
        }

        // ==================================================
        // UNLOCK
        // ==================================================

        if (command === 'unlock') {

            if (!await permissionCheck(
                interaction,
                PermissionsBitField.Flags.ManageChannels
            )) {
                return interaction.reply({
                    content: '❌ ما عندك صلاحية.',
                    ephemeral: true
                });
            }

            await interaction.channel.permissionOverwrites.edit(
                interaction.guild.roles.everyone,
                {
                    SendMessages: true
                }
            );

            await sendLog(
                interaction.guild,
                'channel',
                '🔓 Channel Unlocked',
                `الروم: <#${interaction.channel.id}>\nبواسطة: <@${interaction.user.id}>`,
                0x00FF00
            );

            return interaction.reply('🔓 تم فتح الشات.');
        }

        // ==================================================
        // WELCOME
        // ==================================================

        if (command === 'welcome') {

            if (!await permissionCheck(
                interaction,
                PermissionsBitField.Flags.Administrator
            )) {
                return interaction.reply({
                    content: '❌ تحتاج Administrator.',
                    ephemeral: true
                });
            }

            const sub = interaction.options.getSubcommand();

            const settings = await getSettings(interaction.guild.id);

            if (sub === 'setup') {

                const channel =
                    interaction.options.getChannel('channel');

                const message =
                    interaction.options.getString('message');

                settings.welcome.enabled = true;
                settings.welcome.channel = channel.id;
                settings.welcome.message = message;

                await settings.save();

                return interaction.reply({
                    content:
                        `✅ تم إنشاء الترحيب.\n\n` +
                        `الروم: ${channel}\n` +
                        `الرسالة: ${message}`,
                    ephemeral: true
                });
            }

            if (sub === 'disable') {

                settings.welcome.enabled = false;

                await settings.save();

                return interaction.reply({
                    content: '✅ تم إيقاف الترحيب.',
                    ephemeral: true
                });
            }
        }

        // ==================================================
        // AUTO RESPONSE
        // ==================================================

        if (command === 'autoresponse') {

            if (!await permissionCheck(
                interaction,
                PermissionsBitField.Flags.ManageGuild
            )) {
                return interaction.reply({
                    content: '❌ ما عندك صلاحية Manage Server.',
                    ephemeral: true
                });
            }

            const settings = await getSettings(interaction.guild.id);
            const sub = interaction.options.getSubcommand();

            if (sub === 'add') {

                const trigger =
                    interaction.options.getString('trigger')
                        .toLowerCase();

                const response =
                    interaction.options.getString('response');

                settings.autoResponses.set(
                    trigger,
                    response
                );

                await settings.save();

                return interaction.reply(
                    `✅ تمت إضافة الرد التلقائي للكلمة **${trigger}**.`
                );
            }

            if (sub === 'edit') {

                const trigger =
                    interaction.options.getString('trigger')
                        .toLowerCase();

                const response =
                    interaction.options.getString('response');

                if (!settings.autoResponses.has(trigger)) {
                    return interaction.reply({
                        content: '❌ الرد غير موجود.',
                        ephemeral: true
                    });
                }

                settings.autoResponses.set(
                    trigger,
                    response
                );

                await settings.save();

                return interaction.reply(
                    `✅ تم تعديل الرد التلقائي **${trigger}**.`
                );
            }

            if (sub === 'remove') {

                const trigger =
                    interaction.options.getString('trigger')
                        .toLowerCase();

                if (!settings.autoResponses.has(trigger)) {
                    return interaction.reply({
                        content: '❌ الرد غير موجود.',
                        ephemeral: true
                    });
                }

                settings.autoResponses.delete(trigger);

                await settings.save();

                return interaction.reply(
                    `🗑️ تم حذف الرد التلقائي **${trigger}**.`
                );
            }
        }

        // ==================================================
        // SHORTCUT
        // ==================================================

        if (command === 'shortcut') {

            if (!await permissionCheck(
                interaction,
                PermissionsBitField.Flags.ManageGuild
            )) {
                return interaction.reply({
                    content: '❌ ما عندك صلاحية Manage Server.',
                    ephemeral: true
                });
            }

            const settings = await getSettings(interaction.guild.id);

            const sub = interaction.options.getSubcommand();

            if (sub === 'add') {

                const action =
                    interaction.options.getString('command');

                const shortcut =
                    interaction.options.getString('shortcut')
                        .toLowerCase();

                settings.shortcuts.set(
                    shortcut,
                    action
                );

                await settings.save();

                return interaction.reply(
                    `✅ تم إنشاء الاختصار:\n\`${shortcut}\` → \`${action}\``
                );
            }

            if (sub === 'remove') {

                const shortcut =
                    interaction.options.getString('shortcut')
                        .toLowerCase();

                if (!settings.shortcuts.has(shortcut)) {
                    return interaction.reply({
                        content: '❌ الاختصار غير موجود.',
                        ephemeral: true
                    });
                }

                settings.shortcuts.delete(shortcut);

                await settings.save();

                return interaction.reply(
                    `🗑️ تم حذف الاختصار **${shortcut}**.`
                );
            }

            if (sub === 'list') {

                const shortcuts =
                    [...settings.shortcuts.entries()];

                if (!shortcuts.length) {
                    return interaction.reply(
                        '❌ ما عندك اختصارات.'
                    );
                }

                const text = shortcuts
                    .map(([shortcut, action]) =>
                        `\`${shortcut}\` → \`${action}\``
                    )
                    .join('\n');

                return interaction.reply({
                    embeds: [
                        new EmbedBuilder()
                            .setTitle('اختصارات السيرفر')
                            .setDescription(text)
                            .setColor(0x5865F2)
                    ]
                });
            }
        }

        // ==================================================
        // LOG PANEL
        // ==================================================

        if (command === 'logs') {

            if (!await permissionCheck(
                interaction,
                PermissionsBitField.Flags.ManageGuild
            )) {
                return interaction.reply({
                    content: '❌ ما عندك صلاحية Manage Server.',
                    ephemeral: true
                });
            }

            const menu = new StringSelectMenuBuilder()
                .setCustomId('logs_menu')
                .setPlaceholder('اختر نوع اللوق')
                .addOptions(
                    {
                        label: 'Moderation Logs',
                        value: 'moderation',
                        description: 'لوق الباند والكِك والسجن والتايم'
                    },
                    {
                        label: 'Member Logs',
                        value: 'member',
                        description: 'لوق دخول وخروج الأعضاء'
                    },
                    {
                        label: 'Voice Logs',
                        value: 'voice',
                        description: 'لوق الفويس'
                    },
                    {
                        label: 'Role Logs',
                        value: 'role',
                        description: 'لوق الرتب'
                    },
                    {
                        label: 'Channel Logs',
                        value: 'channel',
                        description: 'لوق الرومات'
                    },
                    {
                        label: 'Webhook Logs',
                        value: 'webhook',
                        description: 'لوق الويب هوك'
                    },
                    {
                        label: 'Message Logs',
                        value: 'message',
                        description: 'لوق الرسائل'
                    }
                );

            const row = new ActionRowBuilder()
                .addComponents(menu);

            return interaction.reply({
                content:
                    '📋 **لوحة اللوقات**\n\n' +
                    'اختر نوع اللوق ثم اضغط تحديد الروم.',
                components: [row],
                ephemeral: true
            });
        }

        // ==================================================
        // LEVEL
        // ==================================================

        if (command === 'level') {

            const target =
                interaction.options.getMember('user') ||
                interaction.member;

            const data =
                await UserLevel.findOne({
                    guildId: interaction.guild.id,
                    userId: target.id
                });

            const messages = data?.messages || 0;
            const level = data?.level || 0;

            const settings =
                await getSettings(interaction.guild.id);

            const needed =
                (level + 1) *
                settings.levels.messagesPerLevel;

            return interaction.reply({
                embeds: [
                    new EmbedBuilder()
                        .setTitle(`📊 Level - ${target.user.username}`)
                        .setDescription(
                            `**المستوى:** ${level}\n` +
                            `**الرسائل:** ${messages}\n` +
                            `**الرسائل المطلوبة للفل القادم:** ${needed}`
                        )
                        .setColor(0x5865F2)
                ]
            });
        }

        // ==================================================
        // LEVEL SETTINGS
        // ==================================================

        if (command === 'level-settings') {

            if (!await permissionCheck(
                interaction,
                PermissionsBitField.Flags.ManageGuild
            )) {
                return interaction.reply({
                    content: '❌ ما عندك صلاحية.',
                    ephemeral: true
                });
            }

            const amount =
                interaction.options.getInteger('messages');

            const settings =
                await getSettings(interaction.guild.id);

            settings.levels.messagesPerLevel = amount;

            await settings.save();

            return interaction.reply(
                `✅ كل **${amount} رسالة** = Level Up.`
            );
        }

    } catch (error) {

        console.error('[INTERACTION ERROR]', error);

        if (interaction.replied || interaction.deferred) {

            await interaction.followUp({
                content: `❌ صار خطأ: \`${error.message}\``,
                ephemeral: true
            }).catch(() => {});

        } else {

            await interaction.reply({
                content: `❌ صار خطأ: \`${error.message}\``,
                ephemeral: true
            }).catch(() => {});
        }
    }
});

// ======================================================
// WELCOME EVENT
// ======================================================

client.on('guildMemberAdd', async member => {

    try {

        const settings =
            await getSettings(member.guild.id);

        if (!settings.welcome.enabled) return;

        const channel =
            member.guild.channels.cache.get(
                settings.welcome.channel
            );

        if (!channel) return;

        const message =
            parseWelcome(
                settings.welcome.message,
                member
            );

        await channel.send({
            content: message
        });

        await sendLog(
            member.guild,
            'member',
            '📥 Member Joined',
            `العضو: <@${member.id}>\n` +
            `اسم الحساب: ${member.user.username}\n` +
            `تاريخ إنشاء الحساب: <t:${Math.floor(member.user.createdTimestamp / 1000)}:F>\n` +
            `وقت الدخول: <t:${Math.floor(Date.now() / 1000)}:F>`,
            0x00FF00
        );

    } catch (error) {
        console.error('[WELCOME ERROR]', error);
    }
});

// ======================================================
// MEMBER LEAVE
// ======================================================

client.on('guildMemberRemove', async member => {

    await sendLog(
        member.guild,
        'member',
        '📤 Member Left',
        `العضو: <@${member.id}>\n` +
        `اسم الحساب: ${member.user.username}\n` +
        `وقت الخروج: <t:${Math.floor(Date.now() / 1000)}:F>`
    );
});

// ======================================================
// VOICE LOGS
// ======================================================

client.on('voiceStateUpdate', async (oldState, newState) => {

    try {

        if (!oldState.channelId && newState.channelId) {

            await sendLog(
                newState.guild,
                'voice',
                '🔊 Voice Join',
                `<@${newState.id}> دخل <#${newState.channelId}>`,
                0x00FF00
            );

            return;
        }

        if (oldState.channelId && !newState.channelId) {

            await sendLog(
                newState.guild,
                'voice',
                '🔇 Voice Leave',
                `<@${newState.id}> خرج من <#${oldState.channelId}>`,
                0xFF0000
            );

            return;
        }

        if (
            oldState.channelId &&
            newState.channelId &&
            oldState.channelId !== newState.channelId
        ) {

            await sendLog(
                newState.guild,
                'voice',
                '🔄 Voice Move',
                `<@${newState.id}>\n` +
                `من <#${oldState.channelId}>\n` +
                `إلى <#${newState.channelId}>`
            );
        }

        if (
            !oldState.serverMute &&
            newState.serverMute
        ) {

            await sendLog(
                newState.guild,
                'voice',
                '🔇 Server Mute',
                `<@${newState.id}> تم عمل ميوت له في الفويس`
            );
        }

        if (
            oldState.serverMute &&
            !newState.serverMute
        ) {

            await sendLog(
                newState.guild,
                'voice',
                '🔊 Server Unmute',
                `<@${newState.id}> تم فك الميوت عنه في الفويس`,
                0x00FF00
            );
        }

        if (
            !oldState.serverDeaf &&
            newState.serverDeaf
        ) {

            await sendLog(
                newState.guild,
                'voice',
                '🔇 Server Deaf',
                `<@${newState.id}> تم عمل Deaf له`
            );
        }

        if (
            oldState.serverDeaf &&
            !newState.serverDeaf
        ) {

            await sendLog(
                newState.guild,
                'voice',
                '🔊 Server Undeaf',
                `<@${newState.id}> تم فك الـ Deaf عنه`,
                0x00FF00
            );
        }

    } catch (error) {
        console.error('[VOICE LOG ERROR]', error);
    }
});

// ======================================================
// MESSAGE SYSTEM
// ======================================================

client.on('messageCreate', async message => {

    if (message.author.bot) return;

    try {

        const settings =
            await getSettings(message.guild.id);

        // ==================================================
        // AUTO RESPONSES
        // ==================================================

        const trigger =
            message.content.trim().toLowerCase();

        const autoResponse =
            settings.autoResponses.get(trigger);

        if (autoResponse) {
            await message.reply(autoResponse);
        }

        // ==================================================
        // LEVEL SYSTEM
        // ==================================================

        if (settings.levels.enabled) {

            let data =
                await UserLevel.findOne({
                    guildId: message.guild.id,
                    userId: message.author.id
                });

            if (!data) {

                data = await UserLevel.create({
                    guildId: message.guild.id,
                    userId: message.author.id,
                    messages: 0,
                    level: 0
                });
            }

            data.messages++;

            const required =
                (data.level + 1) *
                settings.levels.messagesPerLevel;

            if (data.messages >= required) {

                data.level++;

                await message.channel.send(
                    `🎉 مبروك <@${message.author.id}>! وصلت للمستوى **${data.level}**.`
                );

                // رتبة المستوى
                const reward =
                    settings.levels.rewards.get(
                        String(data.level)
                    );

                if (reward) {

                    const role =
                        message.guild.roles.cache.get(reward);

                    if (role) {

                        const member =
                            message.member;

                        await member.roles.add(role)
                            .catch(() => {});
                    }
                }
            }

            await data.save();
        }

        // ==================================================
        // SHORTCUTS
        // ==================================================

        const firstWord =
            message.content
                .trim()
                .split(/\s+/)[0]
                .toLowerCase();

        const action =
            settings.shortcuts.get(firstWord);

        if (!action) return;

        const target =
            message.mentions.members.first();

        // الاختصار يطبق نفس نظام الصلاحيات
        if (action === 'kick') {

            if (
                !message.member.permissions.has(
                    PermissionsBitField.Flags.KickMembers
                ) &&
                !isOwner(message.author.id)
            ) return;

            const check =
                canTarget(message, target);

            if (!check.allowed) {
                return message.reply(check.reason);
            }

            await target.kick();

            return message.reply(
                `👢 تم طرد ${target.user.username}.`
            );
        }

        if (action === 'ban') {

            if (
                !message.member.permissions.has(
                    PermissionsBitField.Flags.BanMembers
                ) &&
                !isOwner(message.author.id)
            ) return;

            const check =
                canTarget(message, target);

            if (!check.allowed) {
                return message.reply(check.reason);
            }

            await target.ban();

            return message.reply(
                `🔨 تم حظر ${target.user.username}.`
            );
        }

        if (action === 'jail') {

            if (
                !message.member.permissions.has(
                    PermissionsBitField.Flags.ManageRoles
                ) &&
                !isOwner(message.author.id)
            ) return;

            const check =
                canTarget(message, target);

            if (!check.allowed) {
                return message.reply(check.reason);
            }

            const existing =
                await JailData.findOne({
                    guildId: message.guild.id,
                    userId: target.id
                });

            if (existing) {
                return message.reply(
                    '❌ العضو مسجون بالفعل.'
                );
            }

            const roles =
                target.roles.cache
                    .filter(r => r.id !== message.guild.id)
                    .map(r => r.id);

            await JailData.create({
                guildId: message.guild.id,
                userId: target.id,
                roles
            });

            const jailRole =
                await getJailRole(message.guild);

            await target.roles.set([
                jailRole.id
            ]);

            return message.reply(
                `🔒 تم سجن ${target.user.username}.`
            );
        }

        if (action === 'purge') {

            if (
                !message.member.permissions.has(
                    PermissionsBitField.Flags.ManageMessages
                ) &&
                !isOwner(message.author.id)
            ) return;

            const amount =
                parseInt(message.content.split(/\s+/)[1]);

            if (
                isNaN(amount) ||
                amount < 1 ||
                amount > 100
            ) {
                return message.reply(
                    '❌ مثال: `مسح 50`'
                );
            }

            await message.channel.bulkDelete(
                amount,
                true
            );

            return;
        }

        if (action === 'lock') {

            if (
                !message.member.permissions.has(
                    PermissionsBitField.Flags.ManageChannels
                ) &&
                !isOwner(message.author.id)
            ) return;

            await message.channel.permissionOverwrites.edit(
                message.guild.roles.everyone,
                {
                    SendMessages: false
                }
            );

            return message.reply(
                '🔒 تم قفل الشات.'
            );
        }

        if (action === 'unlock') {

            if (
                !message.member.permissions.has(
                    PermissionsBitField.Flags.ManageChannels
                ) &&
                !isOwner(message.author.id)
            ) return;

            await message.channel.permissionOverwrites.edit(
                message.guild.roles.everyone,
                {
                    SendMessages: true
                }
            );

            return message.reply(
                '🔓 تم فتح الشات.'
            );
        }

    } catch (error) {
        console.error('[MESSAGE ERROR]', error);
    }
});

// ======================================================
// MESSAGE EDIT LOG
// ======================================================

client.on('messageUpdate', async (oldMessage, newMessage) => {

    if (oldMessage.author?.bot) return;

    if (
        oldMessage.content === newMessage.content
    ) return;

    await sendLog(
        oldMessage.guild,
        'message',
        '✏️ Message Edited',
        `العضو: <@${oldMessage.author?.id}>\n` +
        `الروم: <#${oldMessage.channel?.id}>\n\n` +
        `قبل:\n${oldMessage.content?.slice(0, 900) || 'فارغ'}\n\n` +
        `بعد:\n${newMessage.content?.slice(0, 900) || 'فارغ'}`
    );
});

// ======================================================
// MESSAGE DELETE LOG
// ======================================================

client.on('messageDelete', async message => {

    if (!message.guild) return;
    if (message.author?.bot) return;

    await sendLog(
        message.guild,
        'message',
        '🗑️ Message Deleted',
        `العضو: <@${message.author?.id || 'غير معروف'}>\n` +
        `الروم: <#${message.channel?.id}>\n\n` +
        `المحتوى:\n${message.content?.slice(0, 1500) || 'غير متوفر'}`
    );
});

// ======================================================
// ERROR PROTECTION
// ======================================================

process.on('unhandledRejection', error => {
    console.error('[UNHANDLED REJECTION]', error);
});

process.on('uncaughtException', error => {
    console.error('[UNCAUGHT EXCEPTION]', error);
});

// ======================================================
// LOGIN
// ======================================================

client.login(process.env.TOKEN)
    .then(() => {
        console.log('🔵 Login successful');
    })
    .catch(error => {
        console.error('❌ Login Error:', error);
    });