require('dotenv').config();
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
const guildSchema = new mongoose.Schema({
    _id: { type: String, required: true },
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

// DB Helpers
const db = {
    setLogChannel(guildId, channelId) {
        return GuildSettings.findByIdAndUpdate(guildId, { logChannelId: channelId }, { upsert: true });
    },
    async getLogChannel(guildId) {
        const s = await GuildSettings.findById(guildId).lean();
        return s?.logChannelId || null;
    },
    setVanityURL(guildId, url) {
        return GuildSettings.findByIdAndUpdate(guildId, { vanityURL: url }, { upsert: true });
    },
    async getVanityURL(guildId) {
        const s = await GuildSettings.findById(guildId).lean();
        return s?.vanityURL || null;
    },
    async isVanityProtectionEnabled(guildId) {
        const s = await GuildSettings.findById(guildId).lean();
        return s?.vanityProtection || false;
    },
    toggleVanityProtection(guildId, on) {
        return GuildSettings.findByIdAndUpdate(guildId, { vanityProtection: on }, { upsert: true });
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

function getLogChannel(guild) {
    const id = db.getLogChannel(guild.id);
    return id ? guild.channels.cache.get(id) : null;
}

function logEmbed(title, fields, color = Colors.Blue) {
    return new EmbedBuilder()
        .setTitle(title)
        .addFields(fields)
        .setColor(color)
        .setTimestamp()
        .setFooter({ text: 'Cypher Protection System', iconURL: client.user?.displayAvatarURL?.() || undefined });
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
        const settings = await GuildSettings.findById(guild.id).lean();
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
    ];

    await client.application.commands.set(commands);
    console.log('✅ Slash commands registered');

    client.user.setActivity('Cypher Protection', { type: 4 });
});

// ==================== INTERACTION CREATE ====================
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (!interaction.guild) {
        return interaction.reply({ content: 'هذا الأمر يعمل في السيرفرات فقط.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    const { commandName } = interaction;
    const member = interaction.member;

    if (commandName === 'setlog') {
        if (!isOwner(interaction.user.id) && !isAdmin(member)) {
            return interaction.reply({ content: '❌ ما عندك صلاحية.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        const channel = interaction.options.getChannel('channel');
        await db.setLogChannel(interaction.guild.id, channel.id);
        return interaction.reply({ content: `✅ تم تحديد روم اللوقات: ${channel}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    if (commandName === 'setwelcome') {
        if (!isOwner(interaction.user.id) && !isAdmin(member)) {
            return interaction.reply({ content: '❌ ما عندك صلاحية.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        const channel = interaction.options.getChannel('channel');
        await GuildSettings.findByIdAndUpdate(
            interaction.guild.id,
            { welcomeChannelId: channel.id },
            { upsert: true, new: true }
        );
        return interaction.reply({ content: `✅ تم تحديد روم الترحيب: ${channel}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    if (commandName === 'setvanity') {
        if (!isAdmin(member)) {
            return interaction.reply({ content: '❌ هذا الأمر للإدارة فقط.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        const url = interaction.options.getString('url')?.trim();
        await db.setVanityURL(interaction.guild.id, url);
        return interaction.reply({ content: `✅ تم تحديد رابط السيرفر: discord.gg/${url}`, flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    if (commandName === 'vanity-protect') {
        if (!isAdmin(member)) {
            return interaction.reply({ content: '❌ هذا الأمر للإدارة فقط.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        const on = interaction.options.getBoolean('enabled');
        await db.toggleVanityProtection(interaction.guild.id, on);
        return interaction.reply({ content: on ? '✅ حماية الرابط مفعلة.' : '⚠️ معطلة.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }

    if (commandName === 'settings') {
        if (!isAdmin(member)) {
            return interaction.reply({ content: '❌ هذا الأمر للإدارة فقط.', flags: MessageFlags.Ephemeral }).catch(() => {});
        }
        const guildId = interaction.guild.id;
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
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => {});
    }
});

// ==================== WELCOME EVENT ====================
client.on('guildMemberAdd', async (member) => {
    try {
        const settings = await GuildSettings.findById(member.guild.id).lean();
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

    // Prefix commands check
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
                    { name: 'التحذيرات', value: '`تح @عضو السبب`\n`شيل @عضو #رقم`\n`تحذيرات @عضو`', inline: true },
                    { name: 'الإعدادات', value: '`/setlog` - تحديد روم اللوقات\n`/setwelcome` - تحديد روم الترحيب\n`/setvanity` - تحديد رابط السيرفر\n`/vanity-protect` - حماية الرابط', inline: true }
                )
                .setFooter({ text: 'البوت يعمل عشانك يلبى' })
                .setTimestamp();
            return message.channel.send({ embeds: [embed] });
        }

        // ─── JAIL ───
        if (commandName === 'سجن') {
            if (!target) return message.reply('❌ حدد عضو. مثال: `سجن @عضو`');

            const check = canExecute(message, target, PermissionsBitField.Flags.ManageRoles);
            if (!check.allowed) return message.reply(check.reason);

            await message.guild.roles.fetch();
            let jailRole = message.guild.roles.cache.find(r => r.name === 'سجين')
                || await message.guild.roles.create({ name: 'سجين', color: '#FF0000' });

            const savedRoles = target.roles.cache
                .filter(r => r.id !== message.guild.id)
                .map(r => r.id);

            await GuildSettings.findByIdAndUpdate(
                message.guild.id,
                { $set: { [`jailRoles.${target.id}`]: savedRoles } },
                { upsert: true }
            );

            await target.roles.set([jailRole.id]);
            await sendLog(message.guild, '🔒 سجن', target, `بواسطة: ${message.author.username}`);
            return message.reply(`✅ تم سجن ${target.user.username}.`);
        }

        // ─── UNJAIL ───
        if (commandName === 'افراج') {
            if (!target) return message.reply('❌ حدد عضو.');

            const check = canExecute(message, target);
            if (!check.allowed) return message.reply(check.reason);

            const settings = await GuildSettings.findById(message.guild.id).lean();
            if (!settings || !settings.jailRoles || !settings.jailRoles.get(target.id))
                return message.reply('❌ هذا العضو مو مسجون.');

            const roles = settings.jailRoles.get(target.id);
            await target.roles.set(roles);

            await GuildSettings.findByIdAndUpdate(
                message.guild.id,
                { $unset: { [`jailRoles.${target.id}`]: 1 } }
            );

            await sendLog(message.guild, '🔓 إفراج', target, `بواسطة: ${message.author.username}`);
            return message.reply(`✅ تم فك السجن عن ${target.user.username}.`);
        }

        // ─── BAN ───
        if (commandName === 'تف' || commandName === 'تميم.يسلم.عليك' || commandName === 'بزبي') {
            if (!target) return message.reply('❌ حدد عضو.');

            const check = canExecute(message, target, PermissionsBitField.Flags.BanMembers);
            if (!check.allowed) return message.reply(check.reason);

            await target.ban();
            await sendLog(message.guild, '🔨 حظر', target, `بواسطة: ${message.author.username}`);
            return message.reply(`✅ راح لندن ${target.user.username}.`);
        }

        // ─── UNBAN ───
        if (commandName === 'فك' || commandName === 'تميم.يبيك.ترجع') {
            const check = canExecute(message, null, PermissionsBitField.Flags.BanMembers);
            if (!check.allowed) return message.reply(check.reason);

            if (!args[0]) return message.reply('❌ حدد آيدي أو يوزر. مثال: `فك 123456789` أو `فك username`');

            const input = args[0];
            let userId = input;
            let username = input;

            const mentionMatch = input.match(/^<@!?(\d{17,19})>$/);
            if (mentionMatch) {
                userId = mentionMatch[1];
            } else if (!/^\d{17,19}$/.test(input)) {
                const bans = await message.guild.bans.fetch();
                const banned = bans.find(b => b.user.username.toLowerCase() === input.toLowerCase());
                if (!banned) return message.reply(`❌ ما لقيت محظور باسم "${input}".`);
                userId = banned.user.id;
                username = banned.user.username;
            }

            if (!username || username === userId) {
                try {
                    const user = await client.users.fetch(userId);
                    username = user.username;
                } catch {
                    username = userId;
                }
            }

            if (isOwner(userId)) {
                return message.reply('معالي المطيري ماتقدر تسوي له شي');
            }

            await message.guild.members.unban(userId);
            await sendLog(message.guild, '🔓 فك حظر', { id: userId, username: username }, `بواسطة: ${message.author.username}`, 0x00FF00);
            return message.reply(`✅ تم فك الحظر عن **${username}**.`);
        }

        // ─── KICK ───
        if (commandName === 'طرد' || commandName === 'kick') {
            if (!target) return message.reply('❌ حدد عضو.');

            const check = canExecute(message, target, PermissionsBitField.Flags.KickMembers);
            if (!check.allowed) return message.reply(check.reason);

            await target.kick();
            await sendLog(message.guild, '👢 طرد', target, `بواسطة: ${message.author.username}`);
            return message.reply(`✅ تم تسفيره ${target.user.username}.`);
        }

        // ─── TIMEOUT ───
        if (commandName === 'تايم' || commandName === 'سد حلقك' || commandName === 'تميم.يقولك.اسكت') {
            if (!target) return message.reply('❌ حدد عضو. مثال: `تايم @عضو 10m`');

            const check = canExecute(message, target, PermissionsBitField.Flags.ModerateMembers);
            if (!check.allowed) return message.reply(check.reason);

            const timeStr = args.slice(1).join(' ').trim() || args.find(arg => ms(arg));
            if (!timeStr) return message.reply('❌ حدد المدة. مثال: `تايم @عضو 10m`');

            const duration = ms(timeStr);
            if (!duration) return message.reply('❌ مدة غير صحيحة. أمثلة: `10m`, `1h`, `1d`');

            try {
                await target.timeout(duration, `بواسطة: ${message.author.username}`);
                await sendLog(message.guild, '🔇 تايم أوت', target, `المدة: ${timeStr} | بواسطة: ${message.author.username}`);
                return message.reply(`✅ تم صكه ${target.user.username} لمدة ${timeStr}.`);
            } catch (err) {
                if (err.code === 50013) {
                    const muteRole = await getOrCreateMuteRole(message.guild);
                    await target.roles.add(muteRole);
                    setTimeout(async () => {
                        try {
                            const freshMember = await message.guild.members.fetch(target.id);
                            if (freshMember.roles.cache.has(muteRole.id)) {
                                await freshMember.roles.remove(muteRole);
                            }
                        } catch (e) {}
                    }, duration);
                    await sendLog(message.guild, '🔇 تايم أوت (رتبة)', target, `المدة: ${timeStr} | بواسطة: ${message.author.username}`);
                    return message.reply(`✅ تم صكه ${target.user.username} لمدة ${timeStr} (باستخدام رتبة الميوت).`);
                }
                throw err;
            }
        }

        // ─── UNTIMEOUT ───
        if (commandName === 'تكلم' || commandName === 'تميم.يقولك.تكلم') {
            if (!target) return message.reply('❌ حدد عضو.');

            const check = canExecute(message, target, PermissionsBitField.Flags.ModerateMembers);
            if (!check.allowed) return message.reply(check.reason);

            try { await target.timeout(null); } catch (e) {}

            const muteRole = message.guild.roles.cache.find(r => r.name === 'Muted' || r.name === 'ميوت');
            if (muteRole && target.roles.cache.has(muteRole.id)) await target.roles.remove(muteRole);

            await sendLog(message.guild, '🔊 فك التايم', target, `بواسطة: ${message.author.username}`);
            return message.reply(`✅ تم فك التايم عن ${target.user.username}.`);
        }

        // ─── ADD ROLE ───
        if (commandName === 'r') {
            if (!target) return message.reply('❌ حدد عضو. مثال: `r @عضو اسم_الرتبة`');

            const filteredArgs = args.filter(a => !a.match(/^<@!?\d+>$/) && !a.match(/^\d{17,19}$/));
            const roleName = filteredArgs.join(' ').trim();
            const roleId = args.find(a => a.match(/^\d{17,19}$/));

            if (!roleName && !roleId) return message.reply('❌ حدد اسم الرتبة.');

            await message.guild.roles.fetch();
            const role = message.guild.roles.cache.get(roleId) ||
                message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());

            if (!role) return message.reply(`❌ ما لقيت رتبة باسم "${roleName}".`);

            const check = canExecute(message, target, PermissionsBitField.Flags.ManageRoles, role);
            if (!check.allowed) return message.reply(check.reason);

            await target.roles.add(role);
            await sendLog(message.guild, '🏷️ إعطاء رتبة', target, `الرتبة: ${role.name} | بواسطة: ${message.author.username}`, 0x00FF00);
            return message.reply(`✅ تم إعطاء ${target.user.username} رتبة ${role.name}.`);
        }

        // ─── REMOVE ROLE ───
        if (commandName === 'تجريد') {
            if (!target) return message.reply('❌ حدد عضو. مثال: `تجريد @عضو اسم_الرتبة`');

            const filteredArgs = args.filter(a => !a.match(/^<@!?\d+>$/) && !a.match(/^\d{17,19}$/));
            const roleName = filteredArgs.join(' ').trim();
            const roleId = args.find(a => a.match(/^\d{17,19}$/));

            if (!roleName && !roleId) return message.reply('❌ حدد اسم الرتبة.');

            await message.guild.roles.fetch();
            const role = message.guild.roles.cache.get(roleId) ||
                message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());

            if (!role) return message.reply(`❌ ما لقيت رتبة باسم "${roleName}".`);
            if (!target.roles.cache.has(role.id))
                return message.reply(`❌ ${target.user.username} ما معه رتبة **${role.name}**.`);

            const check = canExecute(message, target, PermissionsBitField.Flags.ManageRoles, role);
            if (!check.allowed) return message.reply(check.reason);

            await target.roles.remove(role);
            await sendLog(message.guild, '🗑️ تجريد من رتبة', target, `الرتبة: ${role.name} | بواسطة: ${message.author.username}`, 0xFFA500);
            return message.reply(`✅ تم تجريد ${target.user.username} من رتبة **${role.name}**.`);
        }

        // ─── LOCK CHAT ───
        if (commandName === 'ق') {
            if (!isAdmin(message.member)) return;
            try {
                await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false });
                const logCh = await getLogChannel(message.guild);
                if (logCh) {
                    await logCh.send({ embeds: [logEmbed('🔒 تم قفل الشات', [
                        { name: '👤 بواسطة', value: `<@${message.author.id}>`, inline: true },
                        { name: '📢 القناة', value: `<#${message.channel.id}>`, inline: true },
                    ], Colors.Red)] }).catch(() => {});
                }
                await message.reply('🔒 تم قفل الشات بنجاح.').catch(() => {});
            } catch (err) {
                await message.reply('❌ ما قدرت أقفل الشات.').catch(() => {});
            }
            return;
        }

        // ─── UNLOCK CHAT ───
        if (commandName === 'ف') {
            if (!isAdmin(message.member)) return;
            try {
                await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: true });
                const logCh = await getLogChannel(message.guild);
                if (logCh) {
                    await logCh.send({ embeds: [logEmbed('🔓 تم فتح الشات', [
                        { name: '👤 بواسطة', value: `<@${message.author.id}>`, inline: true },
                        { name: '📢 القناة', value: `<#${message.channel.id}>`, inline: true },
                    ], Colors.Green)] }).catch(() => {});
                }
                await message.reply('🔓 تم فتح الشات بنجاح.').catch(() => {});
            } catch (err) {
                await message.reply('❌ ما قدرت أفتح الشات.').catch(() => {});
            }
            return;
        }

        // ─── WARN ───
        if (commandName === 'تح') {
            if (!isAdmin(message.member)) return;
            const warnTarget = message.mentions.members.first();
            if (!warnTarget) return message.reply('❌ استخدم: `تح @العضو السبب`').catch(() => {});
            const reason = args.slice(2).join(' ');
            if (!reason) return message.reply('❌ اكتب سبب التحذير.').catch(() => {});

            try {
                const warnNumber = await addWarning(message.guild.id, warnTarget.id, reason, message.author.id);
                const logCh = await getLogChannel(message.guild);
                if (logCh) {
                    await logCh.send({ embeds: [logEmbed('⚠️ تحذير جديد', [
                        { name: '👤 العضو', value: `<@${warnTarget.id}>`, inline: true },
                        { name: '⚡ بواسطة', value: `<@${message.author.id}>`, inline: true },
                        { name: '📋 السبب', value: reason, inline: false },
                        { name: '#️⃣ الرقم', value: `#${warnNumber}`, inline: true },
                    ], Colors.Orange)] }).catch(() => {});
                }
                await message.reply(`⚠️ تم إعطاء التحذير #${warnNumber} لـ <@${warnTarget.id}>\n**السبب:** ${reason}`).catch(() => {});
            } catch (err) {
                console.error('[Warn Error]', err);
                await message.reply('❌ حصل خطأ في حفظ التحذير.').catch(() => {});
            }
            return;
        }

        // ─── REMOVE WARN ───
        if (commandName === 'شيل') {
            if (!isAdmin(message.member)) return;
            const warnTarget = message.mentions.members.first();
            if (!warnTarget) {
                return message.reply('❌ استخدم: `شيل @العضو #رقم`\nمثال: `شيل @Anas #2`').catch(() => {});
            }

            const numArg = args.find(a => a.startsWith('#'));
            if (!numArg) {
                return message.reply('❌ حدد رقم التحذير مثلاً: `#2`\nاستخدم: `شيل @العضو #رقم`').catch(() => {});
            }

            const number = parseInt(numArg.replace('#', ''));
            if (isNaN(number) || number < 1) {
                return message.reply('❌ الرقم غير صحيح. استخدم رقم صحيح مثل `#2`.').catch(() => {});
            }

            try {
                const deleted = await removeWarning(message.guild.id, warnTarget.id, number);
                if (!deleted) {
                    return message.reply(`⚠️ ما لقيت تحذير رقم **#${number}** لـ <@${warnTarget.id}>.`).catch(() => {});
                }

                const logCh = await getLogChannel(message.guild);
                if (logCh) {
                    await logCh.send({ embeds: [logEmbed('🗑️ تم إزالة تحذير', [
                        { name: '👤 العضو', value: `<@${warnTarget.id}>`, inline: true },
                        { name: '⚡ بواسطة', value: `<@${message.author.id}>`, inline: true },
                        { name: '#️⃣ الرقم المحذوف', value: `#${number}`, inline: true },
                    ], Colors.Purple)] }).catch(() => {});
                }

                await message.reply(`🗑️ تم إزالة التحذير **#${number}** من <@${warnTarget.id}>.`).catch(() => {});
            } catch (err) {
                console.error('[Remove Warn Error]', err);
                await message.reply('❌ حصل خطأ في إزالة التحذير.').catch(() => {});
            }
            return;
        }

        // ─── VIEW WARNS ───
        if (commandName === 'تحذيرات') {
            if (!isAdmin(message.member)) return;
            const warnTarget = message.mentions.members.first();
            if (!warnTarget) return message.reply('❌ استخدم: `تحذيرات @العضو`').catch(() => {});

            try {
                const userWarns = await getWarnings(message.guild.id, warnTarget.id);
                if (userWarns.length === 0) {
                    return message.reply(`✅ <@${warnTarget.id}> ما عنده تحذيرات.`).catch(() => {});
                }

                const fields = userWarns.map(w => ({
                    name: `تحذير #${w.number}`,
                    value: `**السبب:** ${w.reason}\n**بواسطة:** <@${w.by}>\n**التاريخ:** <t:${Math.floor(w.date / 1000)}:R>`,
                    inline: false
                }));

                const embed = new EmbedBuilder()
                    .setTitle(`⚠️ تحذيرات ${warnTarget.user.tag}`)
                    .setDescription(`عدد التحذيرات: ${userWarns.length}`)
                    .addFields(fields)
                    .setColor(Colors.Orange)
                    .setThumbnail(warnTarget.user.displayAvatarURL({ dynamic: true }))
                    .setTimestamp();

                await message.reply({ embeds: [embed] }).catch(() => {});
            } catch (err) {
                console.error('[Warns View Error]', err);
                await message.reply('❌ حصل خطأ في عرض التحذيرات.').catch(() => {});
            }
            return;
        }

    } catch (error) {
        console.error(`[ERROR] في أمر "${commandName}":`, error);
        message.reply(`❌ صار خطأ: \`${error.message}\``).catch(() => {});
    }
});

/* ═══════════════════════════════════════════════════════════
   ═══ Vanity Protection (Detection + Ban + Alert Only) ═══
   ═══════════════════════════════════════════════════════════ */

const vanityState = new Map();

// ── اكتشاف فوري عبر Audit Log Entry Create ──
client.on('guildAuditLogEntryCreate', async (auditLogEntry, guild) => {
    if (auditLogEntry.action !== AuditLogEvent.GuildUpdate) return;

    const guildId = guild.id;
    if (!await db.isVanityProtectionEnabled(guildId)) return;

    const savedURL = await db.getVanityURL(guildId);
    if (!savedURL) return;

    const vanityChange = auditLogEntry.changes.find(c => c.key === 'vanity_url_code');
    if (!vanityChange) return;

    const newCode = vanityChange.new;
    const oldCode = vanityChange.old;
    if (newCode === savedURL) return;

    const executor = auditLogEntry.executor;
    console.log(`[Vanity Audit] ${guild.name}: ${oldCode} -> ${newCode} by ${executor?.tag || 'unknown'}`);

    await handleVanityChange(guild, savedURL, oldCode, newCode, executor, 'audit');
});

// ── الحدث التقليدي (احتياطي) ──
client.on('guildUpdate', async (oldGuild, newGuild) => {
    const guildId = newGuild.id;
    if (!await db.isVanityProtectionEnabled(guildId)) return;

    const savedURL = await db.getVanityURL(guildId);
    if (!savedURL) return;

    const oldVanity = oldGuild.vanityURLCode;
    const newVanity = newGuild.vanityURLCode;

    if (oldVanity === newVanity || newVanity === savedURL) return;

    console.log(`[Vanity Event] ${newGuild.name}: ${oldVanity} -> ${newVanity}`);
    await handleVanityChange(newGuild, savedURL, oldVanity, newVanity, null, 'event');
});

// ── فحص دوري (كل ثانية) ──
setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
        const guildId = guild.id;
        if (!await db.isVanityProtectionEnabled(guildId)) continue;

        const savedURL = await db.getVanityURL(guildId);
        if (!savedURL) continue;

        try {
            const vanity = await guild.fetchVanityData().catch(() => null);
            if (!vanity) continue;

            const currentCode = vanity.code;
            const lastCode = vanityState.get(guildId)?.lastCode;

            if (currentCode !== savedURL && currentCode !== lastCode) {
                console.log(`[Vanity Poll] ${guild.name}: detected ${currentCode} != ${savedURL}`);
                await handleVanityChange(guild, savedURL, lastCode || 'unknown', currentCode, null, 'poll');
            }

            vanityState.set(guildId, { lastCode: currentCode });
        } catch (err) {
            // تجاهل
        }
    }
}, 1000);

// ── المعالج الرئيسي (باند + إزالة رتب + تنبيه) ──
async function handleVanityChange(guild, savedURL, oldCode, newCode, executor, source) {
    const guildId = guild.id;
    if (vanityState.get(guildId)?.handling) return;
    vanityState.set(guildId, { ...vanityState.get(guildId), handling: true });

    console.log(`[Vanity] 🚨 ALERT in ${guild.name} | Source: ${source}`);

    const logCh = await getLogChannel(guild);
    let rolesRemoved = false;
    let banned = false;

    // ── 1. إزالة جميع الرتب من المنفذ (Quarantine) ──
    if (executor && executor.id !== client.user.id) {
        try {
            const member = await guild.members.fetch(executor.id).catch(() => null);
            if (member) {
                const roles = member.roles.cache.filter(r => r.id !== guild.roles.everyone.id && r.position < guild.members.me.roles.highest.position);
                if (roles.size > 0) {
                    await member.roles.remove(roles, '🛡️ محاولة تغيير Vanity URL');
                    rolesRemoved = true;
                    console.log(`[Vanity] 🗑️ Removed ${roles.size} roles from ${executor.tag}`);
                }
            }
        } catch (err) {
            console.error(`[Vanity] Remove roles failed:`, err.message);
        }
    }

    // ── 2. باند فوري ──
    if (executor && executor.id !== client.user.id) {
        try {
            const member = await guild.members.fetch(executor.id).catch(() => null);
            if (member) {
                await member.ban({
                    reason: '🛡️ Cypher Protection - تغيير Vanity URL',
                    deleteMessageSeconds: 0
                });
                banned = true;
                console.log(`[Vanity] 🔨 BANNED ${executor.tag}`);
            }
        } catch (err) {
            console.error(`[Vanity] Ban failed:`, err.message);
        }
    }

    // ── 3. تنبيه الأونر في الخاص ──
    if (OWNER_ID) {
        try {
            const owner = await client.users.fetch(OWNER_ID);
            const alertEmbed = new EmbedBuilder()
                .setTitle('🚨 تنبيه فوري: تغيير Vanity URL!')
                .setDescription(`السيرفر: **${guild.name}**\nالاختصار تغيّر من \`discord.gg/${oldCode}\` إلى \`discord.gg/${newCode}\``)
                .addFields(
                    { name: '👤 المنفذ', value: executor ? `<@${executor.id}> (${executor.tag})` : 'غير معروف', inline: true },
                    { name: '🔨 الحظر', value: banned ? '✅ تم الحظر' : '❌ فشل', inline: true },
                    { name: '🗑️ الرتب', value: rolesRemoved ? '✅ تم إزالتها' : '❌ فشل', inline: true },
                    { name: '⚡ المصدر', value: source === 'audit' ? 'Audit Log (فوري)' : source === 'event' ? 'Guild Update' : 'فحص دوري', inline: false }
                )
                .setColor(Colors.Red)
                .setTimestamp();

            await owner.send({ embeds: [alertEmbed] });
            console.log(`[Vanity] 📩 Alert sent to owner`);
        } catch (err) {
            console.error(`[Vanity] Owner DM failed:`, err.message);
        }
    }

    // ── 4. إرسال اللوق ──
    if (logCh) {
        const embed = new EmbedBuilder()
            .setTitle('🚨 Vanity URL تغيّر!')
            .setDescription(`**الاختصار القديم:** discord.gg/${oldCode || 'غير معروف'}\n**الاختصار الجديد:** discord.gg/${newCode}`)
            .addFields(
                { name: '👤 المنفذ', value: executor ? `<@${executor.id}> (${executor.tag})` : 'غير معروف', inline: true },
                { name: '🔗 الكود المطلوب', value: `discord.gg/${savedURL}`, inline: true },
                { name: '⚡ المصدر', value: source === 'audit' ? 'Audit Log (فوري)' : source === 'event' ? 'Guild Update' : 'فحص دوري', inline: true },
                { name: '🔨 الحظر', value: banned ? `✅ تم حظر <@${executor.id}>` : (executor ? '❌ فشل' : 'لا يوجد'), inline: true },
                { name: '🗑️ إزالة الرتب', value: rolesRemoved ? '✅ تمت' : '❌ فشل', inline: true }
            )
            .setColor(Colors.Red)
            .setTimestamp();

        logCh.send({ embeds: [embed] }).catch(() => {});
    }

    vanityState.set(guildId, { ...vanityState.get(guildId), handling: false });
}

// ==================== ERROR HANDLERS ====================
client.on('error', (err) => console.error('[Discord Client Error]', err));
process.on('unhandledRejection', (reason) => console.error('[Unhandled Rejection]', reason));
process.on('uncaughtException', (err) => console.error('[Uncaught Exception]', err));

client.login(process.env.TOKEN).catch(err => {
    console.error('❌ خطأ في تسجيل الدخول:', err);
    process.exit(1);
});
