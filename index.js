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
    MessageFlags
} = require('discord.js');

// ==================== OWNER ID ====================
const OWNER_ID = process.env.OWNER_ID || '1364275261398581279';

function isOwner(userId) {
    return userId === OWNER_ID;
}

function isAdmin(member) {
    return member.permissions.has(PermissionsBitField.Flags.Administrator);
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
    logChannelId: { type: String, default: null },
    welcomeChannelId: { type: String, default: null },
    jailRoles: { type: Map, of: [String], default: new Map() },
    vanityURL: { type: String, default: null },
    vanityProtection: { type: Boolean, default: false }
});

const warnSchema = new mongoose.Schema({
    guildId: String,
    userId: String,
    number: Number,
    reason: String,
    by: String,
    date: { type: Number, default: () => Date.now() }
});

const GuildSettings = mongoose.model('GuildSettings', guildSchema);
const Warn = mongoose.model('Warn', warnSchema);

// DB Helpers — all use guild_id instead of _id
const db = {
    async getOrCreate(guildId) {
        let doc = await GuildSettings.findOne({ guild_id: guildId }).lean();
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
    async getLogChannel(guildId) {
        const s = await GuildSettings.findOne({ guild_id: guildId }).lean();
        return s?.logChannelId || null;
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
    }
};

// Warning Helpers
async function getWarnings(guildId, userId) {
    return await Warn.find({ guildId, userId }).sort({ number: 1 }).lean();
}

async function getNextWarningNumber(guildId, userId) {
    const lastWarn = await Warn.findOne({ guildId, userId }).sort({ number: -1 }).lean();
    return (lastWarn?.number || 0) + 1;
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

async function getLogChannel(guild) {
    const id = await db.getLogChannel(guild.id);
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
        GatewayIntentBits.GuildInvites
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

// ==================== LOG SYSTEM ====================
async function sendLog(guild, title, target, description, color = 0xFF0000) {
    try {
        const settings = await GuildSettings.findOne({ guild_id: guild.id }).lean();
        if (!settings || !settings.logChannelId) return;

        const channel = guild.channels.cache.get(settings.logChannelId);
        if (!channel) return;

        const embed = new EmbedBuilder()
            .setTitle(title)
            .setColor(color)
            .addFields(
                { name: 'العضو', value: `<@${target.id}> (${target.user?.username || target.username})`, inline: true },
                { name: 'الوصف', value: description, inline: false }
            )
            .setTimestamp();

        await channel.send({ embeds: [embed] }).catch(() => {});
    } catch (e) {
        console.error('[LOG ERROR]', e);
    }
}

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
    'سجن', 'افراج',
    'تف', 'تميم.يسلم.عليك', 'بزبي',
    'طرد', 'kick',
    'تكلم', 'تميم.يقولك.تكلم',
    'r', 'تجريد',
    'سد حلقك', 'تايم', 'تميم.يقولك.اسكت',
    'فك', 'تميم.يبيك.ترجع',
    'ق', 'ف', 'تح', 'شيل', 'تحذيرات'
];

// ==================== SLASH COMMANDS ====================
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
            .setDescription('تحديد روم اللوقات')
            .addChannelOption(option =>
                option.setName('channel')
                    .setDescription('اختر الروم')
                    .setRequired(true)
            ),
        new SlashCommandBuilder()
            .setName('setwelcome')
            .setDescription('تحديد روم الترحيب')
            .addChannelOption(option =>
                option.setName('channel')
                    .setDescription('اختر روم الترحيب')
                    .setRequired(true)
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
            .setDescription('عرض إعدادات البوت الحالية')
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
        if (commandName === 'setlog') {
            if (!isOwner(interaction.user.id) && !isAdmin(member)) {
                return interaction.editReply({ content: '❌ ما عندك صلاحية.' }).catch(() => {});
            }
            const channel = interaction.options.getChannel('channel');
            await db.setLogChannel(guildId, channel.id);
            return interaction.editReply({ content: `✅ تم تحديد روم اللوقات: ${channel}` }).catch(() => {});
        }

        if (commandName === 'setwelcome') {
            if (!isOwner(interaction.user.id) && !isAdmin(member)) {
                return interaction.editReply({ content: '❌ ما عندك صلاحية.' }).catch(() => {});
            }
            const channel = interaction.options.getChannel('channel');
            await db.getOrCreate(guildId);
            await GuildSettings.findOneAndUpdate(
                { guild_id: guildId },
                { welcomeChannelId: channel.id },
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
            const logChId = await db.getLogChannel(guildId);
            const logCh = logChId ? `<#${logChId}>` : 'غير محدد';
            const vanity = await db.isVanityProtectionEnabled(guildId) ? '✅ مفعلة' : '⚠️ معطلة';
            const vanityURL = await db.getVanityURL(guildId) || 'غير محدد';

            const embed = new EmbedBuilder()
                .setTitle('⚙️ إعدادات البوت')
                .addFields(
                    { name: '📝 روم اللوق', value: logCh, inline: true },
                    { name: '🔗 الرابط', value: `discord.gg/${vanityURL}`, inline: true },
                    { name: '🛡️ الحماية', value: vanity, inline: true }
                )
                .setColor(Colors.Gold)
                .setTimestamp();
            return interaction.editReply({ embeds: [embed] }).catch(() => {});
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
    try {
        const settings = await GuildSettings.findOne({ guild_id: member.guild.id }).lean();
        if (!settings || !settings.welcomeChannelId) return;

        const channel = member.guild.channels.cache.get(settings.welcomeChannelId);
        if (!channel) return;

        const imageBuffer = await createWelcomeImage(member);
        const memberCount = member.guild.memberCount;

        const messageContent = `𝐖𝐄𝐋𝐂𝐎𝐌𝐄 𝐓𝐎 𓇻 • 𝟏𝟗𝟗𝟒 𝐅𝐀𝐌𝐈𝐋𝐘\n\n〢𝐌𝐄𝐌𝐁𝐄𝐑 : <@${member.id}>\n\n〢𝐂𝐇𝐀𝐓 : <#1451025226342076457>\n\n〢𝐑𝐔𝐋𝐄𝐒 : <#1459481940884459583>\n\n〢𝐍𝐔𝐌𝐁𝐄𝐑 : ${memberCount}\n\n〢𝐈𝐍𝐕𝐈𝐓𝐄𝐑 : <@${member.id}>`;

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

// ==================== MESSAGE COMMANDS ====================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
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
                    { name: 'الاوامر الادارية', value: '`سجن @عضو`\n`افراج @عضو`\n`تف @عضو` - بان\n`طرد @عضو`\n`فك آيدي/يوزر` - فك بان', inline: true },
                    { name: 'التايم', value: '`تايم @عضو 10m`\n`تكلم @عضو`', inline: true },
                    { name: 'الرتب', value: '`r @عضو اسم_الرتبة`\n`تجريد @عضو اسم_الرتبة`', inline: true },
                    { name: 'الشات', value: '`ق` - قفل الشات\n`ف` - فتح الشات', inline: true },
                    { name: 'ا