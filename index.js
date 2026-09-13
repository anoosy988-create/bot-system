const { Client, GatewayIntentBits, PermissionsBitField, EmbedBuilder, SlashCommandBuilder } = require('discord.js');
const ms = require('ms');
const fs = require('fs');
const express = require('express');
const mongoose = require('mongoose');

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

// ==================== OWNER ID ====================
const OWNER_ID = '1364275261398581279';

function isOwner(userId) {
    return userId === OWNER_ID;
}

/* ─── Helper: canExecute ─── */
function canExecute(message, target = null, requiredPermission = null, roleTarget = null) {
    const authorIsOwner = isOwner(message.author.id);

    // الأونر يقدر يسوي أي شي
    if (authorIsOwner) return { allowed: true };

    // لو الهدف هو الأونر → ممنوع
    if (target && isOwner(target.id)) {
        return { allowed: false, reason: 'معالي المطيري ماتقدر تسوي له شي' };
    }

    // تحقق من الصلاحية المطلوبة
    if (requiredPermission && !message.member.permissions.has(requiredPermission)) {
        return { allowed: false, reason: '❌ ما عندك صلاحية.' };
    }

    // تحقق من الرتب (الهدف فوق المنفذ)
    if (target && target.roles.highest.position >= message.member.roles.highest.position) {
        return { allowed: false, reason: '❌ ما تقدر تسوي شي لعضو رتبته أعلى منك أو نفسك.' };
    }

    // تحقق من رتبة الـ Role نفسها (لأوامر r / شيل)
    if (roleTarget && !isOwner(message.author.id) && roleTarget.position >= message.member.roles.highest.position) {
        return { allowed: false, reason: '❌ ما تقدر تسوي شي على رتبة أعلى منك أو نفس رتبتك.' };
    }

    return { allowed: true };
}

// ==================== MONGODB DATABASE ====================
const guildSchema = new mongoose.Schema({
    _id: { type: String, required: true }, // guildId
    logChannelId: { type: String, default: null },
    welcomeChannelId: { type: String, default: null },
    jailRoles: {
        type: Map,
        of: [String],
        default: new Map()
    }
});

const GuildSettings = mongoose.model('GuildSettings', guildSchema);

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
    'تكلم', 'تميم.يقولك.تكلم',
    'r', 'شيل',
    'سد حلقك', 'تايم', 'تميم.يقولك.اسكت',
    'فك', 'تميم.يبيك.ترجع'
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
            )
    ];

    await client.application.commands.set(commands);
    console.log('✅ Slash commands registered');
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    if (interaction.commandName === 'setlog') {
        if (!isOwner(interaction.user.id) && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ ما عندك صلاحية.', ephemeral: true });
        }
        const channel = interaction.options.getChannel('channel');
        
        await GuildSettings.findByIdAndUpdate(
            interaction.guild.id,
            { logChannelId: channel.id },
            { upsert: true, new: true }
        );
        
        return interaction.reply({ content: `✅ تم تحديد روم اللوقات: ${channel}`, ephemeral: true });
    }

    if (interaction.commandName === 'setwelcome') {
        if (!isOwner(interaction.user.id) && !interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            return interaction.reply({ content: '❌ ما عندك صلاحية.', ephemeral: true });
        }
        const channel = interaction.options.getChannel('channel');
        
        await GuildSettings.findByIdAndUpdate(
            interaction.guild.id,
            { welcomeChannelId: channel.id },
            { upsert: true, new: true }
        );
        
        return interaction.reply({ content: `✅ تم تحديد روم الترحيب: ${channel}`, ephemeral: true });
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

        if (commandName === 'تف' || commandName === 'تميم.يسلم.عليك' || commandName === 'بزبي') {
            if (!target) return message.reply('❌ حدد عضو.');
            
            const check = canExecute(message, target, PermissionsBitField.Flags.BanMembers);
            if (!check.allowed) return message.reply(check.reason);

            await target.ban();
            await sendLog(message.guild, '🔨 حظر', target, `بواسطة: ${message.author.username}`);
            return message.reply(`✅ راح لندن ${target.user.username}.`);
        }

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

            // حماية: ما يفك بان الأونر
            if (isOwner(userId)) {
                return message.reply('معالي المطيري ماتقدر تسوي له شي');
            }

            await message.guild.members.unban(userId);
            await sendLog(message.guild, '🔓 فك حظر', {id: userId, username: username}, `بواسطة: ${message.author.username}`, 0x00FF00);
            return message.reply(`✅ تم فك الحظر عن **${username}**.`);
        }

        if (commandName === 'طرد' || commandName === 'kick') {
            if (!target) return message.reply('❌ حدد عضو.');
            
            const check = canExecute(message, target, PermissionsBitField.Flags.KickMembers);
            if (!check.allowed) return message.reply(check.reason);

            await target.kick();
            await sendLog(message.guild, '👢 طرد', target, `بواسطة: ${message.author.username}`);
            return message.reply(`✅ تم تسفيره ${target.user.username}.`);
        }

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

        if (commandName === 'شيل') {
            if (!target) return message.reply('❌ حدد عضو. مثال: `شيل @عضو اسم_الرتبة`');

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

    } catch (error) {
        console.error(`[ERROR] في أمر "${commandName}":`, error);
        message.reply(`❌ صار خطأ: \`${error.message}\``).catch(() => {});
    }
});

client.login(process.env.TOKEN).catch(err => {
    console.error('❌ خطأ في تسجيل الدخول:', err);
});
