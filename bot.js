const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const ms = require('ms');
const fs = require('fs');
const express = require('express');

const app = express();
const port = process.env.PORT || 3000;
app.get('/', (req, res) => res.send('Bot is active!'));
app.listen(port, () => console.log(`Server listening on port ${port}`));

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// ==================== DATABASE ====================
const DB_FILE = './jailDatabase.json';
const LOG_FILE = './logChannels.json';
const WELCOME_FILE = './welcomeChannels.json';

function loadJSON(file) {
    if (!fs.existsSync(file)) return new Map();
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        return new Map(Object.entries(data));
    } catch {
        return new Map();
    }
}

function saveJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(Object.fromEntries(data), null, 2), 'utf8');
}

const jailDatabase = loadJSON(DB_FILE);
let logChannels = loadJSON(LOG_FILE);
let welcomeChannels = loadJSON(WELCOME_FILE);

function saveJailDB() { saveJSON(DB_FILE, jailDatabase); }
function saveLogChannels() { saveJSON(LOG_FILE, logChannels); }
function saveWelcomeChannels() { saveJSON(WELCOME_FILE, welcomeChannels); }

// ==================== WELCOME IMAGE SYSTEM ====================
const WELCOME_BG_URL = 'https://cdn.discordapp.com/attachments/1538615701231632405/1538615802151047188/1786904133960.png?ex=6a835321&is=6a8201a1&hm=4a2c42a86367463168f6580ab898543f14f3acaf3feb2bef2ad45122e4e525be&';

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
    const logChannelId = logChannels.get(guild.id);
    if (!logChannelId) return;
    const channel = guild.channels.cache.get(logChannelId);
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
}

// ==================== SINGLE INSTANCE LOCK ====================
const fs_lock = require('fs');
const LOCK_FILE = './.bot.lock';

try {
    if (fs_lock.existsSync(LOCK_FILE)) {
        const lock = JSON.parse(fs_lock.readFileSync(LOCK_FILE));
        if (Date.now() - lock.time < 15000) {
            console.log('🔒 بوت شغال، نطلع...');
            process.exit(0);
        }
    }
    fs_lock.writeFileSync(LOCK_FILE, JSON.stringify({pid: process.pid, time: Date.now()}));
    setInterval(() => {
        fs_lock.writeFileSync(LOCK_FILE, JSON.stringify({pid: process.pid, time: Date.now()}));
    }, 5000);
} catch(e) {}

process.on('exit', () => { try{fs_lock.unlinkSync(LOCK_FILE)}catch(e){} });
process.on('SIGINT', () => { try{fs_lock.unlinkSync(LOCK_FILE)}catch(e){} process.exit(0); });
process.on('SIGTERM', () => { try{fs_lock.unlinkSync(LOCK_FILE)}catch(e){} process.exit(0); });

// ==================== ANTI-DUPLICATE ====================
const processedMessages = new Set();

// ==================== COMMANDS LIST ====================
const PREFIX_COMMANDS = [
    'مساعده', 'help',
    'سجن', 'افراج',
    'تف', 'تميم.يسلم.عليك', 'بزبي',
    'طرد', 'kick',
    'تكلم',
    'r', 'شيل',
    'سد حلقك', 'تايم',
    'فك'
];

// ==================== OWNER ID ====================
const OWNER_ID = '1364275261398581279';

// ==================== SLASH COMMANDS ====================
client.on('ready', async () => {
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
            )
    ];

    await client.application.commands.set(commands);
    console.log('✅ Slash commands registered');
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'setlog') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ ما عندك صلاحية.', ephemeral: true });
        }
        const channel = interaction.options.getChannel('channel');
        logChannels.set(interaction.guild.id, channel.id);
        saveLogChannels();
        return interaction.reply({ content: `✅ تم تحديد روم اللوقات: ${channel}`, ephemeral: true });
    }

    if (interaction.commandName === 'setwelcome') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ ما عندك صلاحية.', ephemeral: true });
        }
        const channel = interaction.options.getChannel('channel');
        welcomeChannels.set(interaction.guild.id, channel.id);
        saveWelcomeChannels();
        return interaction.reply({ content: `✅ تم تحديد روم الترحيب: ${channel}`, ephemeral: true });
    }
});

// ==================== WELCOME EVENT ====================
client.on('guildMemberAdd', async (member) => {
    const welcomeChannelId = welcomeChannels.get(member.guild.id);
    if (!welcomeChannelId) return;

    const channel = member.guild.channels.cache.get(welcomeChannelId);
    if (!channel) return;

    try {
        const imageBuffer = await createWelcomeImage(member);

        const messageContent = `𝐖𝐄𝐋𝐂𝐎𝐌𝐄 𝐓𝐎 𓇻 • 𝟏𝟗𝟗𝟒 𝐅𝐀𝐌𝐈𝐋𝐘\n\n〢𝐌𝐄𝐌𝐁𝐄𝐑 : <@${member.id}>\n\n〢𝐂𝐇𝐀𝐓 : <#1451025226342076457>\n\n〢𝐑𝐔𝐋𝐄𝐒 : <#1459481940884459583>\n\n〢𝐍𝐔𝐌𝐁𝐄𝐑 : ${member.guild.memberCount}\n\n〢𝐈𝐍𝐕𝐈𝐓𝐄𝐑 : <@${member.id}>`;

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
        await channel.send({
            content: `𝐖𝐄𝐋𝐂𝐎𝐌𝐄 𝐓𝐎 𓇻 • 𝟏𝟗𝟗𝟒 𝐅𝐀𝐌𝐈𝐋𝐘\n\n〢𝐌𝐄𝐌𝐁𝐄𝐑 : <@${member.id}>\n\n〢𝐂𝐇𝐀𝐓 : <#1451025226342076457>\n\n〢𝐑𝐔𝐋𝐄𝐒 : <#1459481940884459583>\n\n〢𝐍𝐔𝐌𝐁𝐄𝐑 : ${member.guild.memberCount}\n\n〢𝐈𝐍𝐕𝐈𝐓𝐄𝐑 : <@${member.id}>`
        }).catch(() => {});
    }
});

// ==================== MESSAGE COMMANDS ====================
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (processedMessages.has(message.id)) return;
    processedMessages.add(message.id);
    setTimeout(() => processedMessages.delete(message.id), 10000);

    if (message.content === "سلام عليكم") return message.reply("عليكم السلام ورحمة الله وبركاته، منور!");
    if (message.content === ".") return message.reply("العسل ينقط، يلبى بس!");
    if (message.content === "تفاعلو") {
        if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator)) return;
        return message.reply("سم معاليك ما طلبت شي، تفاعلو زي ما يقول @here");
    }

    const args = message.content.trim().split(/ +/);
    const commandName = args.shift().toLowerCase();
    const target = message.mentions.members.first();

    if (!PREFIX_COMMANDS.includes(commandName)) return;

    console.log(`[CMD] ${commandName} | target: ${target?.user?.username || 'none'} | by: ${message.author.username}`);

    const isOwner = message.author.id === OWNER_ID;
    const isAdmin = message.member.permissions.has(PermissionsBitField.Flags.Administrator);

    try {
        if (commandName === 'مساعده' || commandName === 'help') {
            const embed = new EmbedBuilder()
                .setTitle('أوامر البوت')
                .setColor(0xFFD700)
                .setDescription('الأوامر المتاحة:')
                .addFields(
                    { name: 'العقوبات', value: '`سجن @عضو`\n`افراج @عضو`\n`تف @عضو` - بان\n`طرد @عضو`\n`فك آيدي/يوزر` - فك بان', inline: true },
                    { name: 'الإسكات', value: '`تايم @عضو 10m`\n`تكلم @عضو`', inline: true },
                    { name: 'الرتب', value: '`r @عضو اسم_الرتبة`\n`شيل @عضو اسم_الرتبة`', inline: true },
                    { name: 'الإعدادات', value: '`/setlog` - تحديد روم اللوقات\n`/setwelcome` - تحديد روم الترحيب', inline: true }
                )
                .setFooter({ text: 'البوت يعمل بكفاءة' })
                .setTimestamp();
            return message.channel.send({ embeds: [embed] });
        }

        if (commandName === 'سجن') {
            if (!isAdmin && !message.member.permissions.has(PermissionsBitField.Flags.ManageRoles))
                return message.reply('❌ ما عندك صلاحية إدارة الرتب.');
            if (!target) return message.reply('❌ حدد عضو. مثال: `سجن @عضو`');
            if (!isOwner && target.roles.highest.position >= message.member.roles.highest.position)
                return message.reply('❌ ما تقدر تسجن عضو رتبته أعلى منك أو نفسك.');

            await message.guild.roles.fetch();
            let jailRole = message.guild.roles.cache.find(r => r.name === 'سجين')
                || await message.guild.roles.create({ name: 'سجين', color: '#FF0000' });

            jailDatabase.set(target.id, target.roles.cache
                .filter(r => r.id !== message.guild.id)
                .map(r => r.id));
            saveJailDB();

            await target.roles.set([jailRole.id]);
            await sendLog(message.guild, '🔒 سجن', target, `بواسطة: ${message.author.username}`);
            return message.reply(`✅ تم سجن ${target.user.username}.`);
        }

        if (commandName === 'افراج') {
            if (!isAdmin && !message.member.permissions.has(PermissionsBitField.Flags.ManageRoles))
                return message.reply('❌ ما عندك صلاحية.');
            if (!target) return message.reply('❌ حدد عضو.');
            if (!jailDatabase.has(target.id)) return message.reply('❌ هذا العضو مو مسجون.');

            await target.roles.set(jailDatabase.get(target.id));
            jailDatabase.delete(target.id);
            saveJailDB();
            await sendLog(message.guild, '🔓 إفراج', target, `بواسطة: ${message.author.username}`);
            return message.reply(`✅ تم فك السجن عن ${target.user.username}.`);
        }

        if (commandName === 'تف' || commandName === 'تميم.يسلم.عليك' || commandName === 'بزبي') {
            if (!isAdmin && !message.member.permissions.has(PermissionsBitField.Flags.BanMembers))
                return message.reply('❌ ما عندك صلاحية الحظر.');
            if (!target) return message.reply('❌ حدد عضو.');
            if (!isOwner && target.roles.highest.position >= message.member.roles.highest.position)
                return message.reply('❌ ما تقدر تحظر عضو رتبته أعلى منك أو نفسك.');

            await target.ban();
            await sendLog(message.guild, '🔨 حظر', target, `بواسطة: ${message.author.username}`);
            return message.reply(`✅ راح لندن ${target.user.username}.`);
        }

        if (commandName === 'فك') {
            if (!isAdmin && !message.member.permissions.has(PermissionsBitField.Flags.BanMembers))
                return message.reply('❌ ما عندك صلاحية فك الحظر.');
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

            await message.guild.members.unban(userId);
            await sendLog(message.guild, '🔓 فك حظر', {id: userId, username: username}, `بواسطة: ${message.author.username}`, 0x00FF00);
            return message.reply(`✅ تم فك الحظر عن **${username}**.`);
        }

        if (commandName === 'طرد' || commandName === 'kick') {
            if (!isAdmin && !message.member.permissions.has(PermissionsBitField.Flags.KickMembers))
                return message.reply('❌ ما عندك صلاحية الطرد.');
            if (!target) return message.reply('❌ حدد عضو.');
            if (!isOwner && target.roles.highest.position >= message.member.roles.highest.position)
                return message.reply('❌ ما تقدر تطير عضو رتبته أعلى منك أو نفسك.');

            await target.kick();
            await sendLog(message.guild, '👢 طرد', target, `بواسطة: ${message.author.username}`);
            return message.reply(`✅ تم تسفيره ${target.user.username}.`);
        }

        if (commandName === 'تايم' || commandName === 'سد حلقك') {
            if (!isAdmin && !message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
                return message.reply('❌ ما عندك صلاحية الإسكات.');
            if (!target) return message.reply('❌ حدد عضو. مثال: `تايم @عضو 10m`');

            const timeStr = args.slice(1).join(' ').trim() || args.find(arg => ms(arg));
            if (!timeStr) return message.reply('❌ حدد المدة. مثال: `تايم @عضو 10m`');

            const duration = ms(timeStr);
            if (!duration) return message.reply('❌ مدة غير صحيحة. أمثلة: `10m`, `1h`, `1d`');

            if (!isOwner && target.roles.highest.position >= message.member.roles.highest.position)
                return message.reply('❌ ما تقدر تعطي تايم لعضو رتبته أعلى منك أو نفسك.');

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

        if (commandName === 'تكلم') {
            if (!isAdmin && !message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
                return message.reply('❌ ما عندك صلاحية.');
            if (!target) return message.reply('❌ حدد عضو.');

            try { await target.timeout(null); } catch (e) {}

            const muteRole = message.guild.roles.cache.find(r => r.name === 'Muted' || r.name === 'ميوت');
            if (muteRole && target.roles.cache.has(muteRole.id)) await target.roles.remove(muteRole);

            await sendLog(message.guild, '🔊 فك التايم', target, `بواسطة: ${message.author.username}`);
            return message.reply(`✅ تم فك التايم عن ${target.user.username}.`);
        }

        if (commandName === 'r') {
            if (!isAdmin && !message.member.permissions.has(PermissionsBitField.Flags.ManageRoles))
                return message.reply('❌ ما معك صلاحية.');
            if (!target) return message.reply('❌ حدد عضو. مثال: `r @عضو اسم_الرتبة`');

            const filteredArgs = args.filter(a => !a.match(/^<@!?\d+$/) && !a.match(/^\d{17,19}$/));
            const roleName = filteredArgs.join(' ').trim();
            const roleId = args.find(a => a.match(/^\d{17,19}$/));

            if (!roleName && !roleId) return message.reply('❌ حدد اسم الرتبة.');

            await message.guild.roles.fetch();
            const role = message.guild.roles.cache.get(roleId) ||
                message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());

            if (!role) return message.reply(`❌ ما لقيت رتبة باسم "${roleName}".`);
            if (!isOwner && role.position >= message.member.roles.highest.position)
                return message.reply('❌ ما تقدر تعطي رتبة أعلى منك أو نفس رتبتك.');

            await target.roles.add(role);
            await sendLog(message.guild, '🏷️ إعطاء رتبة', target, `الرتبة: ${role.name} | بواسطة: ${message.author.username}`, 0x00FF00);
            return message.reply(`✅ تم إعطاء ${target.user.username} رتبة ${role.name}.`);
        }

        if (commandName === 'شيل') {
            if (!isAdmin && !message.member.permissions.has(PermissionsBitField.Flags.ManageRoles))
                return message.reply('❌ ما معك صلاحية.');
            if (!target) return message.reply('❌ حدد عضو. مثال: `شيل @عضو اسم_الرتبة`');

            const filteredArgs = args.filter(a => !a.match(/^<@!?\d+$/) && !a.match(/^\d{17,19}$/));
            const roleName = filteredArgs.join(' ').trim();
            const roleId = args.find(a => a.match(/^\d{17,19}$/));

            if (!roleName && !roleId) return message.reply('❌ حدد اسم الرتبة.');

            await message.guild.roles.fetch();
            const role = message.guild.roles.cache.get(roleId) ||
                message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());

            if (!role) return message.reply(`❌ ما لقيت رتبة باسم "${roleName}".`);
            if (!isOwner && role.position >= message.member.roles.highest.position)
                return message.reply('❌ ما تقدر تشيل رتبة أعلى منك أو نفس رتبتك.');
            if (!target.roles.cache.has(role.id))
                return message.reply(`❌ ${target.user.username} ما معه رتبة **${role.name}**.`);

            await target.roles.remove(role);
            await sendLog(message.guild, '🗑️ تجريد من رتبة', target, `الرتبة: ${role.name} | بواسطة: ${message.author.username}`, 0xFFA500);
            return message.reply(`✅ تم تجريد ${target.user.username} من رتبة **${role.name}**.`);
        }

    } catch (error) {
        console.error(`[ERROR] في أمر "${commandName}":`, error);
        message.reply(`❌ صار خطأ: \`${error.message}\``).catch(() => {});
    }
});

client.login(process.env.TOKEN).catch(err => {
    console.error('❌ خطأ في تسجيل الدخول:', err);
});
