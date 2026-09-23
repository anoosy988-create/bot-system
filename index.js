const {
    Client,
    GatewayIntentBits,
    PermissionsBitField,
    EmbedBuilder,
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    ChannelType
} = require('discord.js');

const mongoose = require('mongoose');
const express = require('express');

// ======================================================
// ENV VARIABLES & CONFIGURATION
// ======================================================
const TOKEN = process.env.TOKEN;
const MONGO_URI = process.env.MONGO_URI;
const AI_API_KEY = process.env.AI_API_KEY; 
const AI_BASE_URL = process.env.AI_BASE_URL || 'https://api.groq.com/openai/v1/chat/completions'; 
const AI_MODEL = process.env.AI_MODEL || 'llama3-8b-8192'; 
const OWNER_ID = '1364275261398581279';

if (!TOKEN || !MONGO_URI) {
    console.error('❌ تأكد من توفر TOKEN و MONGO_URI في متغيرات البيئة (Environment Variables).');
    process.exit(1);
}

// ======================================================
// WEB SERVER (UptimeRobot / Render / Hosting)
// ======================================================
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/', (req, res) => {
    res.send('Cypher Security Bot is active and running 24/7!');
});

app.listen(PORT, () => {
    console.log(`🌐 Web server running on port ${PORT}`);
});

// ======================================================
// DISCORD CLIENT INITIALIZATION
// ======================================================
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildWebhooks
    ]
});

// ======================================================
// MONGODB SCHEMAS & MODELS
// ======================================================
const guildSchema = new mongoose.Schema({
    _id: { type: String, required: true },
    welcome: {
        enabled: { type: Boolean, default: false },
        channelId: { type: String, default: null },
        message: { type: String, default: 'أهلاً بك {user} في السيرفر ❤️' },
        imageUrl: { type: String, default: null }
    },
    logs: {
        voice: { type: String, default: null },
        role: { type: String, default: null },
        channel: { type: String, default: null },
        webhook: { type: String, default: null },
        member: { type: String, default: null },
        moderation: { type: String, default: null },
        message: { type: String, default: null },
        command: { type: String, default: null }
    },
    autoResponses: { type: [{ trigger: String, response: String }], default: [] },
    shortcuts: { type: [{ name: String, command: String }], default: [] },
    levelSettings: {
        enabled: { type: Boolean, default: true },
        messagesPerLevel: { type: Number, default: 50 },
        rewards: { type: Map, of: String, default: new Map() }
    },
    aiChatChannelId: { type: String, default: null },
    aiCodeChannelId: { type: String, default: null }
});
const GuildSettings = mongoose.model('GuildSettings', guildSchema);

const jailSchema = new mongoose.Schema({
    guildId: String,
    userId: String,
    roles: [String]
});
const JailData = mongoose.model('JailData', jailSchema);

const levelSchema = new mongoose.Schema({
    guildId: String,
    userId: String,
    messages: { type: Number, default: 0 },
    level: { type: Number, default: 0 }
});
const UserLevel = mongoose.model('UserLevel', levelSchema);

// ======================================================
// HELPER FUNCTIONS
// ======================================================
function isOwner(userId) { return userId === OWNER_ID; }
function isAdmin(interaction) {
    return isOwner(interaction.user.id) || interaction.member?.permissions?.has(PermissionsBitField.Flags.Administrator);
}
function normalizeText(text) { return String(text || '').trim().replace(/\s+/g, ' ').toLowerCase(); }

async function getSettings(guildId) {
    let settings = await GuildSettings.findById(guildId);
    if (!settings) settings = await GuildSettings.create({ _id: guildId });
    return settings;
}

async function sendLog(guild, type, title, description, color = 0x5865F2) {
    try {
        const settings = await GuildSettings.findById(guild.id);
        if (!settings || !settings.logs?.[type]) return;
        const channel = guild.channels.cache.get(settings.logs[type]);
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
// JAIL SYSTEM
// ======================================================
async function jailMember(member) {
    const existing = await JailData.findOne({ guildId: member.guild.id, userId: member.id });
    if (!existing) {
        const roles = member.roles.cache.filter(role => role.id !== member.guild.id).map(role => role.id);
        await JailData.create({ guildId: member.guild.id, userId: member.id, roles });
    }

    let jailRole = member.guild.roles.cache.find(role => role.name === 'سجين' || role.name === 'Jail');
    if (!jailRole) {
        jailRole = await member.guild.roles.create({ name: 'سجين', color: 0x777777, reason: 'Cypher Jail System' });
        for (const channel of member.guild.channels.cache.values()) {
            if (channel.isTextBased() || channel.isVoiceBased()) {
                await channel.permissionOverwrites.edit(jailRole, {
                    SendMessages: false, AddReactions: false, Speak: false, Connect: false
                }).catch(() => {});
            }
        }
    }

    const removableRoles = member.roles.cache.filter(r => r.id !== member.guild.id && r.id !== jailRole.id && r.editable);
    await member.roles.remove(removableRoles, 'Jailed').catch(() => {});
    await member.roles.add(jailRole, 'Jailed').catch(() => {});
    return jailRole;
}

async function unjailMember(member) {
    const data = await JailData.findOne({ guildId: member.guild.id, userId: member.id });
    if (!data) return false;

    const jailRole = member.guild.roles.cache.find(role => role.name === 'سجين' || role.name === 'Jail');
    if (jailRole && member.roles.cache.has(jailRole.id)) {
        await member.roles.remove(jailRole, 'Unjailed').catch(() => {});
    }

    const roles = data.roles.map(id => member.guild.roles.cache.get(id)).filter(Boolean).filter(r => r.editable);
    if (roles.length) await member.roles.add(roles, 'Restored roles after unjail').catch(() => {});
    await JailData.deleteOne({ guildId: member.guild.id, userId: member.id });
    return true;
}

// ======================================================
// SLASH COMMANDS SETUP
// ======================================================
const ADMIN = PermissionsBitField.Flags.Administrator;
const slashCommands = [
    new SlashCommandBuilder().setName('jail').setDescription('سجن عضو').setDefaultMemberPermissions(ADMIN).addUserOption(o => o.setName('user').setDescription('العضو').setRequired(true)),
    new SlashCommandBuilder().setName('unjail').setDescription('فك سجن عضو').setDefaultMemberPermissions(ADMIN).addUserOption(o => o.setName('user').setDescription('العضو').setRequired(true)),
    new SlashCommandBuilder().setName('ban').setDescription('حظر عضو').setDefaultMemberPermissions(ADMIN).addUserOption(o => o.setName('user').setDescription('العضو').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('السبب')),
    new SlashCommandBuilder().setName('unban').setDescription('فك حظر عضو').setDefaultMemberPermissions(ADMIN).addStringOption(o => o.setName('user_id').setDescription('آيدي العضو').setRequired(true)),
    new SlashCommandBuilder().setName('kick').setDescription('طرد عضو').setDefaultMemberPermissions(ADMIN).addUserOption(o => o.setName('user').setDescription('العضو').setRequired(true)).addStringOption(o => o.setName('reason').setDescription('السبب')),
    new SlashCommandBuilder().setName('timeout').setDescription('إسكات عضو').setDefaultMemberPermissions(ADMIN).addUserOption(o => o.setName('user').setDescription('العضو').setRequired(true)).addStringOption(o => o.setName('duration').setDescription('المدة (مثال: 10m, 1h)').setRequired(true)),
    new SlashCommandBuilder().setName('untimeout').setDescription('فك الإسكات').setDefaultMemberPermissions(ADMIN).addUserOption(o => o.setName('user').setDescription('العضو').setRequired(true)),
    new SlashCommandBuilder().setName('role-add').setDescription('إعطاء رتبة').setDefaultMemberPermissions(ADMIN).addUserOption(o => o.setName('user').setDescription('العضو').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('الرتبة').setRequired(true)),
    new SlashCommandBuilder().setName('role-remove').setDescription('إزالة رتبة').setDefaultMemberPermissions(ADMIN).addUserOption(o => o.setName('user').setDescription('العضو').setRequired(true)).addRoleOption(o => o.setName('role').setDescription('الرتبة').setRequired(true)),
    new SlashCommandBuilder().setName('purge').setDescription('مسح رسائل').setDefaultMemberPermissions(ADMIN).addIntegerOption(o => o.setName('amount').setDescription('العدد (1-100)').setMinValue(1).setMaxValue(100).setRequired(true)),
    new SlashCommandBuilder().setName('lock').setDescription('قفل الروم').setDefaultMemberPermissions(ADMIN).addChannelOption(o => o.setName('channel').setDescription('الروم').addChannelTypes(ChannelType.GuildText)),
    new SlashCommandBuilder().setName('unlock').setDescription('فتح الروم').setDefaultMemberPermissions(ADMIN).addChannelOption(o => o.setName('channel').setDescription('الروم').addChannelTypes(ChannelType.GuildText)),
    new SlashCommandBuilder().setName('welcome').setDescription('إعداد الترحيب').setDefaultMemberPermissions(ADMIN)
        .addSubcommand(s => s.setName('set').setDescription('تفعيل الترحيب').addChannelOption(o => o.setName('channel').setDescription('الروم').setRequired(true).addChannelTypes(ChannelType.GuildText)).addStringOption(o => o.setName('message').setDescription('الرسالة').setRequired(true)).addStringOption(o => o.setName('image_url').setDescription('رابط الصورة (اختياري)')))
        .addSubcommand(s => s.setName('off').setDescription('إيقاف الترحيب')),
    new SlashCommandBuilder().setName('autoresponse').setDescription('إدارة الردود التلقائية').setDefaultMemberPermissions(ADMIN)
        .addSubcommand(s => s.setName('add').setDescription('إضافة رد').addStringOption(o => o.setName('trigger').setDescription('الكلمة').setRequired(true)).addStringOption(o => o.setName('response').setDescription('الرد').setRequired(true)))
        .addSubcommand(s => s.setName('remove').setDescription('حذف رد').addStringOption(o => o.setName('trigger').setDescription('الكلمة').setRequired(true)))
        .addSubcommand(s => s.setName('list').setDescription('عرض الردود')),
    new SlashCommandBuilder().setName('shortcut').setDescription('إدارة الاختصارات').setDefaultMemberPermissions(ADMIN)
        .addSubcommand(s => s.setName('add').setDescription('إضافة اختصار').addStringOption(o => o.setName('name').setDescription('اسم الاختصار').setRequired(true)).addStringOption(o => o.setName('command').setDescription('الأمر المرتبط').setRequired(true).addChoices({name:'ban',value:'ban'},{name:'kick',value:'kick'},{name:'jail',value:'jail'},{name:'unjail',value:'unjail'},{name:'purge',value:'purge'},{name:'lock',value:'lock'},{name:'unlock',value:'unlock'})))
        .addSubcommand(s => s.setName('remove').setDescription('حذف اختصار').addStringOption(o => o.setName('name').setDescription('اسم الاختصار').setRequired(true)))
        .addSubcommand(s => s.setName('list').setDescription('عرض الاختصارات')),
    new SlashCommandBuilder().setName('logs').setDescription('إعداد السجلات').setDefaultMemberPermissions(ADMIN),
    new SlashCommandBuilder().setName('level').setDescription('عرض المستوى').setDefaultMemberPermissions(ADMIN).addUserOption(o => o.setName('user').setDescription('العضو')),
    new SlashCommandBuilder().setName('level-settings').setDescription('إعداد المستويات').setDefaultMemberPermissions(ADMIN).addIntegerOption(o => o.setName('messages').setDescription('رسائل لكل مستوى')).addIntegerOption(o => o.setName('level').setDescription('المستوى المكافأ')).addRoleOption(o => o.setName('role').setDescription('الرتبة المكافأة')),
    new SlashCommandBuilder().setName('setchat').setDescription('روم الذكاء الاصطناعي').setDefaultMemberPermissions(ADMIN).addChannelOption(o => o.setName('channel').setDescription('الروم').setRequired(true).addChannelTypes(ChannelType.GuildText)),
    new SlashCommandBuilder().setName('setcode').setDescription('روم كتابة الأكواد').setDefaultMemberPermissions(ADMIN).addChannelOption(o => o.setName('channel').setDescription('الروم').setRequired(true).addChannelTypes(ChannelType.GuildText))
].map(c => c.toJSON());

// ======================================================
// BOT READY EVENT
// ======================================================
client.once('ready', async () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
    try {
        await mongoose.connect(MONGO_URI);
        console.log('✅ MongoDB connected successfully');
    } catch (err) {
        console.error('❌ MongoDB connection error:', err);
    }
    for (const guild of client.guilds.cache.values()) {
        try { await guild.commands.set(slashCommands); } 
        catch (err) { console.error(`Failed registering commands in ${guild.name}`); }
    }
});

// ======================================================
// INTERACTION HANDLER
// ======================================================
client.on('interactionCreate', async interaction => {
    try {
        if (interaction.isChatInputCommand()) {
            if (!isAdmin(interaction)) return interaction.reply({ content: '❌ تحتاج صلاحية **Administrator**.', ephemeral: true });
            const cmd = interaction.commandName;

            await sendLog(interaction.guild, 'command', '💻 Command Used', `استخدم ${interaction.user} الأمر \`/${cmd}\` في الروم ${interaction.channel}`, 0x2B2D31);

            // Moderation Commands
            if (cmd === 'jail') {
                const user = interaction.options.getUser('user');
                const member = await interaction.guild.members.fetch(user.id).catch(() => null);
                if (!member || member.id === OWNER_ID) return interaction.reply({ content: '❌ لا يمكن سجن هذا العضو.', ephemeral: true });
                await jailMember(member);
                await sendLog(interaction.guild, 'moderation', '🔒 Jail', `${member} سُجن بواسطة ${interaction.user}.`, 0xFFAA00);
                return interaction.reply(`🔒 تم سجن ${member}.`);
            }
            if (cmd === 'unjail') {
                const user = interaction.options.getUser('user');
                const member = await interaction.guild.members.fetch(user.id).catch(() => null);
                if (!member) return interaction.reply({ content: '❌ العضو غير موجود.', ephemeral: true });
                if (await unjailMember(member)) {
                    await sendLog(interaction.guild, 'moderation', '🔓 Unjail', `فك سجن ${member} بواسطة ${interaction.user}.`, 0x57F287);
                    return interaction.reply(`🔓 تم فك سجن ${member}.`);
                }
                return interaction.reply({ content: '❌ العضو ليس مسجوناً.', ephemeral: true });
            }
            if (cmd === 'ban') {
                const user = interaction.options.getUser('user');
                const reason = interaction.options.getString('reason') || 'بدون سبب';
                if (user.id === OWNER_ID) return interaction.reply({ content: '❌ لا يمكن حظر المالك.', ephemeral: true });
                await interaction.guild.members.ban(user.id, { reason });
                await sendLog(interaction.guild, 'moderation', '🔨 Ban', `${user} حُظر بواسطة ${interaction.user}.\nالسبب: ${reason}`, 0xED4245);
                return interaction.reply(`🔨 تم حظر ${user}.\nالسبب: ${reason}`);
            }
            if (cmd === 'unban') {
                const userId = interaction.options.getString('user_id');
                try {
                    await interaction.guild.members.unban(userId);
                    await sendLog(interaction.guild, 'moderation', '🔓 Unban', `تم فك حظر <@${userId}> بواسطة ${interaction.user}.`, 0x57F287);
                    return interaction.reply(`🔓 تم فك حظر <@${userId}>.`);
                } catch { return interaction.reply({ content: '❌ العضو غير محظور.', ephemeral: true }); }
            }
            if (cmd === 'kick') {
                const user = interaction.options.getUser('user');
                const reason = interaction.options.getString('reason') || 'بدون سبب';
                const member = await interaction.guild.members.fetch(user.id).catch(() => null);
                if (!member || !member.kickable) return interaction.reply({ content: '❌ لا يمكن طرد العضو.', ephemeral: true });
                await member.kick(reason);
                await sendLog(interaction.guild, 'moderation', '👢 Kick', `${user} طُرد بواسطة ${interaction.user}.\nالسبب: ${reason}`, 0xED4245);
                return interaction.reply(`👢 تم طرد ${user}.`);
            }
            if (cmd === 'timeout') {
                const user = interaction.options.getUser('user');
                const durStr = interaction.options.getString('duration');
                const member = await interaction.guild.members.fetch(user.id).catch(() => null);
                if (!member || !member.moderatable) return interaction.reply({ content: '❌ لا يمكن إسكات العضو.', ephemeral: true });
                const match = durStr.match(/^(\d+)(s|m|h|d)$/i);
                if (!match) return interaction.reply({ content: '❌ صيغة خاطئة (مثال: 10m).', ephemeral: true });
                const ms = Number(match[1]) * { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2].toLowerCase()];
                if (ms > 2419200000) return interaction.reply({ content: '❌ أقصى مدة هي 28 يوم.', ephemeral: true });
                await member.timeout(ms, `بواسطة ${interaction.user.tag}`);
                await sendLog(interaction.guild, 'moderation', '⏱️ Timeout', `${member} أُسكت لمدة ${durStr} بواسطة ${interaction.user}.`, 0xFEE75C);
                return interaction.reply(`⏱️ تم إسكات ${member} لمدة **${durStr}**.`);
            }
            if (cmd === 'untimeout') {
                const user = interaction.options.getUser('user');
                const member = await interaction.guild.members.fetch(user.id).catch(() => null);
                if (!member) return interaction.reply({ content: '❌ العضو غير موجود.', ephemeral: true });
                await member.timeout(null);
                await sendLog(interaction.guild, 'moderation', '🔓 Untimeout', `فُك إسكات ${member} بواسطة ${interaction.user}.`, 0x57F287);
                return interaction.reply(`🔓 تم فك التايم أوت عن ${member}.`);
            }
            if (cmd === 'role-add') {
                const user = interaction.options.getUser('user');
                const role = interaction.options.getRole('role');
                const member = await interaction.guild.members.fetch(user.id).catch(() => null);
                if (!member || !role.editable) return interaction.reply({ content: '❌ لا أستطيع إعطاء الرتبة.', ephemeral: true });
                await member.roles.add(role);
                return interaction.reply(`🎭 تم إعطاء ${member} رتبة ${role}.`);
            }
            if (cmd === 'role-remove') {
                const user = interaction.options.getUser('user');
                const role = interaction.options.getRole('role');
                const member = await interaction.guild.members.fetch(user.id).catch(() => null);
                if (!member || !role.editable) return interaction.reply({ content: '❌ لا أستطيع إزالة الرتبة.', ephemeral: true });
                await member.roles.remove(role);
                return interaction.reply(`🎭 تم إزالة رتبة ${role} من ${member}.`);
            }
            if (cmd === 'purge') {
                const amount = interaction.options.getInteger('amount');
                const deleted = await interaction.channel.bulkDelete(amount, true);
                await sendLog(interaction.guild, 'moderation', '🗑️ Purge', `تم مسح ${deleted.size} رسالة في ${interaction.channel} بواسطة ${interaction.user}.`);
                return interaction.reply({ content: `🗑️ تم مسح **${deleted.size}** رسالة.`, ephemeral: true });
            }
            if (cmd === 'lock') {
                const channel = interaction.options.getChannel('channel') || interaction.channel;
                await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: false });
                await sendLog(interaction.guild, 'moderation', '🔒 Lock', `قُفل ${channel} بواسطة ${interaction.user}.`);
                return interaction.reply(`🔒 تم قفل ${channel}.`);
            }
            if (cmd === 'unlock') {
                const channel = interaction.options.getChannel('channel') || interaction.channel;
                await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { SendMessages: null });
                return interaction.reply(`🔓 تم فتح ${channel}.`);
            }

            // Settings & Configurations
            if (cmd === 'welcome') {
                const sub = interaction.options.getSubcommand();
                const settings = await getSettings(interaction.guild.id);
                if (sub === 'set') {
                    settings.welcome.enabled = true;
                    settings.welcome.channelId = interaction.options.getChannel('channel').id;
                    settings.welcome.message = interaction.options.getString('message');
                    settings.welcome.imageUrl = interaction.options.getString('image_url') || null;
                    await settings.save();
                    return interaction.reply({ content: '✅ تم تفعيل وإعداد نظام الترحيب.', ephemeral: true });
                } else {
                    settings.welcome.enabled = false;
                    await settings.save();
                    return interaction.reply({ content: '❌ تم إيقاف نظام الترحيب.' });
                }
            }
            if (cmd === 'autoresponse') {
                const sub = interaction.options.getSubcommand();
                const settings = await getSettings(interaction.guild.id);
                if (sub === 'add') {
                    const trigger = interaction.options.getString('trigger');
                    const response = interaction.options.getString('response');
                    settings.autoResponses.push({ trigger, response });
                    await settings.save();
                    return interaction.reply({ content: `✅ تم إضافة الرد التلقائي للكلمة: \`${trigger}\``, ephemeral: true });
                } else if (sub === 'remove') {
                    const trigger = interaction.options.getString('trigger');
                    settings.autoResponses = settings.autoResponses.filter(a => a.trigger !== trigger);
                    await settings.save();
                    return interaction.reply({ content: `🗑️ تم حذف الرد التلقائي.`, ephemeral: true });
                } else if (sub === 'list') {
                    if (!settings.autoResponses.length) return interaction.reply({ content: 'لا يوجد ردود تلقائية.', ephemeral: true });
                    const list = settings.autoResponses.map((a, i) => `${i + 1}. **${a.trigger}** ->${a.response}`).join('\n');
                    return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🤖 الردود التلقائية').setDescription(list).setColor(0x5865F2)], ephemeral: true });
                }
            }
            if (cmd === 'shortcut') {
                const sub = interaction.options.getSubcommand();
                const settings = await getSettings(interaction.guild.id);
                if (sub === 'add') {
                    const name = interaction.options.getString('name');
                    const command = interaction.options.getString('command');
                    settings.shortcuts.push({ name, command });
                    await settings.save();
                    return interaction.reply({ content: `✅ تم إضافة الاختصار \`${name}\` للأمر \`${command}\``, ephemeral: true });
                } else if (sub === 'remove') {
                    const name = interaction.options.getString('name');
                    settings.shortcuts = settings.shortcuts.filter(s => s.name !== name);
                    await settings.save();
                    return interaction.reply({ content: `🗑️ تم حذف الاختصار.`, ephemeral: true });
                } else if (sub === 'list') {
                    if (!settings.shortcuts.length) return interaction.reply({ content: 'لا يوجد اختصارات.', ephemeral: true });
                    const list = settings.shortcuts.map((s, i) => `${i + 1}. **${s.name}** => \`/${s.command}\``).join('\n');
                    return interaction.reply({ embeds: [new EmbedBuilder().setTitle('⚡ الاختصارات الإدارية').setDescription(list).setColor(0x5865F2)], ephemeral: true });
                }
            }
            if (cmd === 'logs') {
                const row = new ActionRowBuilder().addComponents(
                    new StringSelectMenuBuilder().setCustomId(`logs_select_${interaction.user.id}`).setPlaceholder('اختر نوع السجل لربطه بروم')
                    .addOptions([
                        { label: 'Voice Logs', value: 'voice', emoji: '🔊' },
                        { label: 'Role Logs', value: 'role', emoji: '🎭' },
                        { label: 'Channel Logs', value: 'channel', emoji: '📁' },
                        { label: 'Webhook Logs', value: 'webhook', emoji: '🔗' },
                        { label: 'Member Logs', value: 'member', emoji: '👤' },
                        { label: 'Moderation Logs', value: 'moderation', emoji: '🛡️' },
                        { label: 'Message Logs', value: 'message', emoji: '💬' },
                        { label: 'Command Logs', value: 'command', emoji: '⌨️' }
                    ])
                );
                return interaction.reply({ content: '📝 اختر نوع السجل لتخصيصه:', components: [row], ephemeral: true });
            }
            if (cmd === 'level') {
                const user = interaction.options.getUser('user') || interaction.user;
                const data = await UserLevel.findOne({ guildId: interaction.guild.id, userId: user.id });
                const lvl = data ? data.level : 0;
                const msgs = data ? data.messages : 0;
                return interaction.reply(`📊 العضو ${user} في المستوى **${lvl}** (إجمالي الرسائل: **${msgs}**).`);
            }
            if (cmd === 'level-settings') {
                const settings = await getSettings(interaction.guild.id);
                const msgs = interaction.options.getInteger('messages');
                const lvl = interaction.options.getInteger('level');
                const role = interaction.options.getRole('role');

                if (msgs) settings.levelSettings.messagesPerLevel = msgs;
                if (lvl && role) settings.levelSettings.rewards.set(String(lvl), role.id);

                await settings.save();
                return interaction.reply({ content: '✅ تم تحديث إعدادات نظام المستويات والمكافآت.', ephemeral: true });
            }
            if (cmd === 'setchat') {
                const settings = await getSettings(interaction.guild.id);
                settings.aiChatChannelId = interaction.options.getChannel('channel').id;
                await settings.save();
                return interaction.reply(`🤖 تم تعيين روم المحادثة والذكاء الاصطناعي.`);
            }
            if (cmd === 'setcode') {
                const settings = await getSettings(interaction.guild.id);
                settings.aiCodeChannelId = interaction.options.getChannel('channel').id;
                await settings.save();
                return interaction.reply(`💻 تم تعيين روم برمجة وكتابة الأكواد.`);
            }
        }

        // Select Menus Handler for Logs
        if (interaction.isStringSelectMenu() && interaction.customId.startsWith('logs_select_')) {
            const type = interaction.values[0];
            const channels = interaction.guild.channels.cache.filter(c => c.type === ChannelType.GuildText).first(25);
            const row = new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId(`logs_channel_${type}`).setPlaceholder('اختر الروم لسجل ' + type)
                .addOptions(channels.map(c => ({ label: c.name, value: c.id })))
            );
            return interaction.update({ content: `اختر الروم المخصص لسجل \`${type}\`:`, components: [row] });
        }

        if (interaction.isStringSelectMenu() && interaction.customId.startsWith('logs_channel_')) {
            const type = interaction.customId.replace('logs_channel_', '');
            const settings = await getSettings(interaction.guild.id);
            settings.logs[type] = interaction.values[0];
            await settings.save();
            return interaction.update({ content: `✅ تم ربط سجل \`${type}\` بالروم المحدد بنجاح!`, components: [] });
        }
    } catch (err) {
        console.error('Interaction Error:', err);
    }
});

// ======================================================
// EVENT LISTENERS (WELCOMES & LOGS)
// ======================================================
client.on('guildMemberAdd', async member => {
    try {
        await sendLog(member.guild, 'member', '👋 Member Joined', `${member} (${member.user.tag}) دخل السيرفر.`, 0x57F287);
        const settings = await getSettings(member.guild.id);
        if (!settings.welcome.enabled || !settings.welcome.channelId) return;

        const channel = member.guild.channels.cache.get(settings.welcome.channelId);
        if (channel && channel.isTextBased()) {
            const msg = settings.welcome.message
                .replace(/\{user\}/gi, `<@${member.id}>`)
                .replace(/\{username\}/gi, member.user.username)
                .replace(/\{count\}/gi, member.guild.memberCount)
                .replace(/\{server\}/gi, member.guild.name);
            
            const embed = new EmbedBuilder().setDescription(msg).setColor(0x5865F2).setThumbnail(member.user.displayAvatarURL());
            if (settings.welcome.imageUrl) embed.setImage(settings.welcome.imageUrl);
            await channel.send({ embeds: [embed] });
        }
    } catch (err) { console.error('Welcome Error:', err); }
});

client.on('guildMemberRemove', async member => {
    await sendLog(member.guild, 'member', '🚪 Member Left', `${member.user.tag} غادر السيرفر.`, 0xED4245);
});

client.on('messageDelete', async message => {
    if (!message.guild || message.author?.bot) return;
    await sendLog(message.guild, 'message', '🗑️ Message Deleted', `**العضو:** ${message.author}\n**الروم:** ${message.channel}\n**المحتوى:** ${message.content || 'لا يوجد نص'}`, 0xED4245);
});

client.on('messageUpdate', async (oldMsg, newMsg) => {
    if (!oldMsg.guild || oldMsg.author?.bot || oldMsg.content === newMsg.content) return;
    await sendLog(oldMsg.guild, 'message', '✏️ Message Edited', `**العضو:** ${oldMsg.author}\n**الروم:** ${oldMsg.channel}\n**قبل:** ${oldMsg.content}\n**بعد:** ${newMsg.content}`, 0xFEE75C);
});

client.on('webhookUpdate', async channel => {
    await sendLog(channel.guild, 'webhook', '🔗 Webhook Updated', `تم تحديث الويبهوك في الروم ${channel}.`);
});
client.on('roleUpdate', async (oldRole, newRole) => {
    await sendLog(newRole.guild, 'role', '🎭 Role Updated', `تم تحديث الرتبة ${newRole.name}.`);
});
client.on('channelUpdate', async (oldChannel, newChannel) => {
    await sendLog(newChannel.guild, 'channel', '📁 Channel Updated', `تم تحديث الروم ${newChannel.name}.`);
});

// ======================================================
// SINGLE MESSAGE_CREATE EVENT (SHORTCUTS, AUTO-RESPONSES, AI, LEVELING)
// ======================================================
client.on('messageCreate', async message => {
    if (!message.guild || message.author.bot) return;
    try {
        const settings = await getSettings(message.guild.id);
        const normMsg = normalizeText(message.content);

        // 1. Administrative Shortcuts
        const shortcut = settings.shortcuts.find(s => normMsg === normalizeText(s.name) || normMsg.startsWith(normalizeText(s.name) + ' '));
        if (shortcut && isAdmin({ user: message.author, member: message.member })) {
            const args = message.content.trim().slice(shortcut.name.length).trim().split(/\s+/).filter(Boolean);
            const mention = message.mentions.members.first();

            if (shortcut.command === 'jail' && mention) { await jailMember(mention); message.reply(`🔒 تم سجن ${mention}`); }
            else if (shortcut.command === 'unjail' && mention) { await unjailMember(mention); message.reply(`🔓 تم فك سجن ${mention}`); }
            else if (shortcut.command === 'purge' && args[0]) { await message.channel.bulkDelete(Number(args[0]), true); message.reply(`🗑️ تم الحذف.`); }
            else if (shortcut.command === 'lock') { await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false }); message.reply('🔒 تم القفل.'); }
            else if (shortcut.command === 'unlock') { await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: null }); message.reply('🔓 تم الفتح.'); }
            return;
        }

        // 2. Auto Responses
        const auto = settings.autoResponses.find(a => normalizeText(a.trigger) === normMsg);
        if (auto) return message.reply(auto.response);

        // 3. AI Chat & Code Generation (REST API Integration)
        if (settings.aiChatChannelId === message.channel.id || settings.aiCodeChannelId === message.channel.id) {
            await message.channel.sendTyping();
            try {
                if (!AI_API_KEY) return message.reply('❌ مفتاح API الخاص بالذكاء الاصطناعي غير متوفر.');
                
                const isCodeChannel = settings.aiCodeChannelId === message.channel.id;
                const systemPrompt = isCodeChannel 
                    ? "أنت خبير برمجة ومهندس برمجيات. قدم إجابات برمجية دقيقة مع تنسيق الكود والشرح المباشر." 
                    : "أنت مساعد ذكي ومفيد في سيرفر ديسكورد. أجب بشكل دقيق وواضح.";

                const response = await fetch(AI_BASE_URL, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${AI_API_KEY}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        model: AI_MODEL,
                        messages: [
                            { role: "system", content: systemPrompt },
                            { role: "user", content: message.content }
                        ]
                    })
                }).then(res => res.json());

                if (response.choices && response.choices[0]) {
                    let aiReply = response.choices[0].message.content;
                    if (aiReply.length > 2000) aiReply = aiReply.substring(0, 1997) + '...';
                    await message.reply(aiReply);
                }
            } catch (err) {
                console.error('AI Error:', err);
            }
            return;
        }

        // 4. Leveling System
        if (settings.levelSettings.enabled) {
            let data = await UserLevel.findOne({ guildId: message.guild.id, userId: message.author.id });
            if (!data) data = await UserLevel.create({ guildId: message.guild.id, userId: message.author.id });
            data.messages++;

            const newLevel = Math.floor(data.messages / settings.levelSettings.messagesPerLevel);
            if (newLevel > data.level) {
                data.level = newLevel;
                const roleId = settings.levelSettings.rewards.get(String(newLevel));
                let rewardText = '';
                if (roleId) {
                    const role = message.guild.roles.cache.get(roleId);
                    if (role && role.editable) {
                        await message.member.roles.add(role).catch(() => {});
                        rewardText = `\n🎁 وحصلت على رتبة ${role}!`;
                    }
                }
                await message.channel.send(`🎉 التهاني لـ ${message.author}! لقد وصلت إلى المستوى **${newLevel}**!${rewardText}`);
            }
            await data.save();
        }

    } catch (error) { console.error('Message Event Error:', error); }
});

// ======================================================
// GLOBAL UNHANDLED ERROR HANDLERS
// ======================================================
process.on('unhandledRejection', error => console.error('❌ Unhandled Rejection:', error));
process.on('uncaughtException', error => console.error('❌ Uncaught Exception:', error));

// LOGIN
client.login(TOKEN);
