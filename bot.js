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
const WARN_FILE = './warnings.json';
const LOG_FILE = './logChannels.json';
const WARN_ID_FILE = './warnId.json';

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
let warnings = loadJSON(WARN_FILE);
let logChannels = loadJSON(LOG_FILE);

// رقم التحذير العالمي
let warnIdCounter = 1;
if (fs.existsSync(WARN_ID_FILE)) {
    try {
        warnIdCounter = parseInt(fs.readFileSync(WARN_ID_FILE, 'utf8')) || 1;
    } catch { warnIdCounter = 1; }
}

function saveJailDB() { saveJSON(DB_FILE, jailDatabase); }
function saveWarnings() { saveJSON(WARN_FILE, warnings); }
function saveLogChannels() { saveJSON(LOG_FILE, logChannels); }
function saveWarnId() { fs.writeFileSync(WARN_ID_FILE, warnIdCounter.toString(), 'utf8'); }

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
    'تح', 'تحذيرات', 'شيل',
    'تكلم',
    'r',
    'سد حلقك', 'تايم',
];

// ==================== SLASH COMMANDS ====================

client.on('ready', async () => {
    console.log(`✅ Bot online: ${client.user.tag}`);

    const setLogCommand = new SlashCommandBuilder()
        .setName('setlog')
        .setDescription('تحديد روم اللوقات')
        .addChannelOption(option =>
            option.setName('channel')
                .setDescription('اختر الروم')
                .setRequired(true)
        );

    await client.application.commands.create(setLogCommand);
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
});

// ==================== MESSAGE COMMANDS ====================

client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    // منع التكرار
    if (processedMessages.has(message.id)) return;
    processedMessages.add(message.id);
    setTimeout(() => processedMessages.delete(message.id), 10000);

    // --- الردود التلقائية ---
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

    try {

        // ===== HELP =====
        if (commandName === 'مساعده' || commandName === 'help') {
            const embed = new EmbedBuilder()
                .setTitle('أوامر البوت')
                .setColor(0xFFD700)
                .setDescription('الأوامر المتاحة:')
                .addFields(
                    { name: 'العقوبات', value: '`سجن @عضو`\n`افراج @عضو`\n`تف @عضو` - بان\n`طرد @عضو`', inline: true },
                    { name: 'الإسكات', value: '`تايم @عضو 10m`\n`تكلم @عضو`', inline: true },
                    { name: 'الرتب', value: '`r @عضو اسم_الرتبة`', inline: true },
                    { name: 'التحذيرات', value: '`تح @عضو السبب`\n`تحذيرات @عضو`\n`شيل @عضو #رقم`', inline: true },
                    { name: 'الإعدادات', value: '`/setlog` - تحديد روم اللوقات', inline: true }
                )
                .setFooter({ text: 'البوت يعمل بكفاءة' })
                .setTimestamp();
            return message.channel.send({ embeds: [embed] });
        }

        // ===== JAIL =====
        if (commandName === 'سجن') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles))
                return message.reply('❌ ما عندك صلاحية إدارة الرتب.');
            if (!target)
                return message.reply('❌ حدد عضو. مثال: `سجن @عضو`');
            if (target.roles.highest.position >= message.member.roles.highest.position)
                return message.reply('❌ ما تقدر تسجن عضو رتبته أعلى منك.');
            if (target.permissions.has(PermissionsBitField.Flags.Administrator))
                return message.reply('❌ ما تقدر تسجن أدمن.');

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

        // ===== UNJAIL =====
        if (commandName === 'افراج') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles))
                return message.reply('❌ ما عندك صلاحية.');
            if (!target)
                return message.reply('❌ حدد عضو.');
            if (!jailDatabase.has(target.id))
                return message.reply('❌ هذا العضو مو مسجون.');

            await target.roles.set(jailDatabase.get(target.id));
            jailDatabase.delete(target.id);
            saveJailDB();
            await sendLog(message.guild, '🔓 إفراج', target, `بواسطة: ${message.author.username}`);
            return message.reply(`✅ تم فك السجن عن ${target.user.username}.`);
        }

        // ===== BAN =====
        if (commandName === 'تف' || commandName === 'تميم.يسلم.عليك') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.BanMembers))
                return message.reply('❌ ما عندك صلاحية الحظر.');
            if (!target)
                return message.reply('❌ حدد عضو.');
            if (target.roles.highest.position >= message.member.roles.highest.position)
                return message.reply('❌ ما تقدر تحظر عضو رتبته أعلى منك.');

            await target.ban();
            await sendLog(message.guild, '🔨 حظر', target, `بواسطة: ${message.author.username}`);
            return message.reply(`✅ راح لندن  ${target.user.username}.`);
        }

        // ===== KICK =====
        if (commandName === 'طرد' || commandName === 'kick') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.KickMembers))
                return message.reply('❌ ما عندك صلاحية الطرد.');
            if (!target)
                return message.reply('❌ حدد عضو.');
            if (target.roles.highest.position >= message.member.roles.highest.position)
                return message.reply('❌ ما تقدر تطير عضو رتبته أعلى منك.');

            await target.kick();
            await sendLog(message.guild, '👢 طرد', target, `بواسطة: ${message.author.username}`);
            return message.reply(`✅ تم تسفيره ${target.user.username}.`);
        }

        // ===== TIMEOUT =====
        if (commandName === 'تايم' || commandName === 'سد حلقك') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
                return message.reply('❌ ما عندك صلاحية الإسكات.');
            if (!target)
                return message.reply('❌ حدد عضو. مثال: `تايم @عضو 10m`');
            if (!args[0])
                return message.reply('❌ حدد المدة. مثال: `تايم @عضو 10m`');

            const duration = ms(args[0]);
            if (!duration)
                return message.reply('❌ مدة غير صحيحة. أمثلة: `10m`, `1h`, `1d`');

            await target.timeout(duration);
            await sendLog(message.guild, '🔇 تايم أوت', target, `المدة: ${args[0]} | بواسطة: ${message.author.username}`);
            return message.reply(`✅ تم صكه ${target.user.username} لمدة ${args[0]}.`);
        }

        // ===== UNTIMEOUT =====
        if (commandName === 'تكلم') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.ModerateMembers))
                return message.reply('❌ ما عندك صلاحية.');
            if (!target)
                return message.reply('❌ حدد عضو.');

            await target.timeout(null);
            await sendLog(message.guild, '🔊 فك التايم', target, `بواسطة: ${message.author.username}`);
            return message.reply(`✅ تم فك التايم عن ${target.user.username}.`);
        }

        // ===== ROLE =====
        if (commandName === 'r') {
            if (!message.member.permissions.has(PermissionsBitField.Flags.ManageRoles))
                return message.reply('❌ ما معك صلاحية.');
            if (!target)
                return message.reply('❌ حدد عضو. مثال: `r @عضو اسم_الرتبة`');

            const filteredArgs = args.filter(a => !a.match(/^<@!?\d+>$/) && !a.match(/^\d{17,19}$/));
            const roleName = filteredArgs.join(' ').trim();
            const roleId = args.find(a => a.match(/^\d{17,19}$/));

            if (!roleName && !roleId)
                return message.reply('❌ حدد اسم الرتبة.');

            await message.guild.roles.fetch();
            const role = message.guild.roles.cache.get(roleId) ||
                message.guild.roles.cache.find(r => r.name.toLowerCase() === roleName.toLowerCase());

            if (!role)
                return message.reply(`❌ ما لقيت رتبة باسم "${roleName}".`);

            await target.roles.add(role);
            await sendLog(message.guild, '🏷️ إعطاء رتبة', target, `الرتبة: ${role.name} | بواسطة: ${message.author.username}`, 0x00FF00);
            return message.reply(`✅ تم إعطاء ${target.user.username} رتبة ${role.name}.`);
        }

    } catch (error) {
        console.error(`[ERROR] في أمر "${commandName}":`, error);
        message.reply(`❌ صار خطأ: \`${error.message}\``).catch(() => {});
    }
});

client.login(process.env.TOKEN).catch(err => {
    console.error('❌ خطأ في تسجيل الدخول:', err);
});
